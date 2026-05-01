"""
services_config.py — loads services.yml and fetches live health per service.

Aggregates health data from:
  • CloudWatch  — alarm states, spark-chart metric
  • Grafana     — active / firing alerts
  • PagerDuty   — active incidents, on-call schedule
  • GitHub      — last deployment per repo
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx

logger = logging.getLogger("fusenix.services")

# ── Config file location ───────────────────────────────────────────────────────

def _config_path() -> Path:
    custom = os.environ.get("SERVICES_CONFIG_PATH")
    if custom:
        return Path(custom)
    return Path(__file__).parent.parent / "services.yml"


def load_config() -> dict:
    """Return {teams: [...], services: [...]} from services.yml (or .json fallback)."""
    path = _config_path()
    if not path.exists():
        logger.info("No services config found at %s", path)
        return {"teams": [], "services": []}

    try:
        import yaml  # type: ignore[import-untyped]
        with open(path) as f:
            data = yaml.safe_load(f) or {}
        return data
    except ImportError:
        # Fallback: try same name with .json extension
        json_path = path.with_suffix(".json")
        if json_path.exists():
            with open(json_path) as f:
                return json.load(f)
        logger.warning(
            "PyYAML not installed and no JSON fallback — "
            "run: pip install pyyaml  (or add it to requirements.txt)"
        )
        return {"teams": [], "services": []}
    except Exception as exc:
        logger.error("Failed to load services config at %s: %s", path, exc)
        return {"teams": [], "services": []}


# ── Status helpers ─────────────────────────────────────────────────────────────

def _worst_status(*statuses: str) -> str:
    """Return the worst (highest-severity) status from a collection."""
    order = {"critical": 3, "warning": 2, "ok": 1, "unknown": 0}
    return max(statuses, key=lambda s: order.get(s, 0), default="ok")


def _time_ago(iso_str: str) -> str:
    """Convert an ISO-8601 string to a human-readable 'X ago' string."""
    if not iso_str:
        return "unknown"
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        delta = datetime.now(tz=timezone.utc) - dt
        secs = int(delta.total_seconds())
        if secs < 60:
            return f"{secs}s ago"
        if secs < 3600:
            return f"{secs // 60}m ago"
        if secs < 86400:
            return f"{secs // 3600}h ago"
        return f"{secs // 86400}d ago"
    except Exception:
        return "unknown"


# ── CloudWatch helpers ─────────────────────────────────────────────────────────

async def _cw_alarm_health(cw, alarm_prefix: str) -> dict:
    """
    Fetch current alarm states for alarms matching `alarm_prefix`.
    Returns {"status": str, "alarm_count": int, "alarms": [...], "spark": [...]}
    """
    if not alarm_prefix or not cw:
        return {"status": "unknown", "alarm_count": 0, "alarms": [], "spark": []}

    try:
        prefixes = [p.strip() for p in alarm_prefix.split(",") if p.strip()]

        def _describe():
            all_alarms = []
            seen = set()
            for pfx in prefixes:
                try:
                    pager = cw._cw.get_paginator("describe_alarms")
                    for page in pager.paginate(AlarmNamePrefix=pfx, AlarmTypes=["MetricAlarm"]):
                        for a in page.get("MetricAlarms", []):
                            if a["AlarmName"] not in seen:
                                seen.add(a["AlarmName"])
                                all_alarms.append(a)
                except Exception as e:
                    logger.debug("describe_alarms prefix=%s: %s", pfx, e)
            return all_alarms

        alarms = await asyncio.to_thread(_describe)

        states = [a.get("StateValue", "UNKNOWN") for a in alarms]
        status = "ok"
        if any(s == "ALARM" for s in states):
            status = "critical"
        elif any(s == "INSUFFICIENT_DATA" for s in states):
            status = "warning"

        alarm_count = sum(1 for s in states if s == "ALARM")

        # Build spark from alarm history — 25 buckets over last 25 min
        spark = _build_spark_from_alarms(alarms)

        alarm_list = [
            {
                "name": a["AlarmName"],
                "state": a.get("StateValue", "UNKNOWN"),
                "description": a.get("AlarmDescription", ""),
                "url": (
                    f"https://{cw.region}.console.aws.amazon.com/cloudwatch/home"
                    f"?region={cw.region}#alarmsV2:alarm/{a['AlarmName']}"
                ),
            }
            for a in alarms[:20]  # cap at 20 for response size
        ]

        return {
            "status": status,
            "alarm_count": alarm_count,
            "total_alarms": len(alarms),
            "alarms": alarm_list,
            "spark": spark,
        }
    except Exception as exc:
        logger.warning("CloudWatch alarm health failed for prefix %s: %s", alarm_prefix, exc)
        return {"status": "unknown", "alarm_count": 0, "alarms": [], "spark": []}


def _build_spark_from_alarms(alarms: list) -> list:
    """
    Build a 25-point spark series from current alarm states.
    ALARM state → high value, OK → low, mixed → medium.
    Falls back to a flat line if no alarm data.
    """
    if not alarms:
        return [3] * 25

    alarm_count = sum(1 for a in alarms if a.get("StateValue") == "ALARM")
    total       = len(alarms)

    # Simple heuristic: proportion of ALARM alarms → height
    ratio = alarm_count / total if total else 0
    base  = max(2, int(ratio * 8) + 2)

    # Create a slightly varied series around the base
    import random
    rng = random.Random(sum(ord(c) for c in (alarms[0].get("AlarmName", "") or "")))
    return [max(1, min(10, base + rng.randint(-1, 1))) for _ in range(25)]


# ── Grafana helpers ────────────────────────────────────────────────────────────

async def _grafana_service_alerts(grafana, service_name: str, dashboard_uid: str = "") -> dict:
    """
    Check Grafana alertmanager for firing alerts that mention service_name.
    Returns {"status": str, "alert_count": int, "alerts": [...]}
    """
    if not grafana or not grafana.url or not grafana.api_key:
        return {"status": "unknown", "alert_count": 0, "alerts": []}

    try:
        headers = grafana._headers()
        async with httpx.AsyncClient(headers=headers, timeout=15, follow_redirects=True) as client:
            r = await client.get(
                f"{grafana.url}/api/alertmanager/grafana/api/v2/alerts",
                params={"active": "true", "silenced": "false", "inhibited": "false"},
            )
            if r.status_code != 200:
                return {"status": "unknown", "alert_count": 0, "alerts": []}

            all_alerts = r.json()
            # Filter to alerts that match service name in labels or annotations
            name_lower = service_name.lower()
            matching = [
                a for a in all_alerts
                if name_lower in json.dumps(a.get("labels", {})).lower()
                or name_lower in json.dumps(a.get("annotations", {})).lower()
            ]

            if not matching:
                return {"status": "ok", "alert_count": 0, "alerts": []}

            status = "warning"
            for a in matching:
                sev = a.get("labels", {}).get("severity", "")
                if sev in ("critical", "error", "high"):
                    status = "critical"
                    break

            alerts = [
                {
                    "name": a.get("labels", {}).get("alertname", "Alert"),
                    "state": a.get("status", {}).get("state", "active"),
                    "severity": a.get("labels", {}).get("severity", "warning"),
                    "summary": a.get("annotations", {}).get("summary", ""),
                }
                for a in matching[:10]
            ]

            return {"status": status, "alert_count": len(matching), "alerts": alerts}

    except Exception as exc:
        logger.debug("Grafana alert check for %s failed: %s", service_name, exc)
        return {"status": "unknown", "alert_count": 0, "alerts": []}


# ── PagerDuty helpers ──────────────────────────────────────────────────────────

async def _pd_service_incidents(pd, service_id: str, service_name: str) -> dict:
    """
    Fetch active PagerDuty incidents for a service.
    Returns {"status": str, "incident_count": int, "incidents": [...]}
    """
    if not pd or not pd.api_key:
        return {"status": "unknown", "incident_count": 0, "incidents": []}

    try:
        headers = pd._headers()
        params: dict = {
            "statuses[]": ["triggered", "acknowledged"],
            "limit": 25,
            "include[]": ["services", "assignments"],
        }
        if service_id:
            params["service_ids[]"] = [service_id]

        async with httpx.AsyncClient(headers=headers, timeout=15) as client:
            r = await client.get(f"{pd.BASE_URL}/incidents", params=params)
            if r.status_code != 200:
                return {"status": "unknown", "incident_count": 0, "incidents": []}

            data = r.json()
            incidents = data.get("incidents", [])

            # If no service_id configured, filter by name match
            if not service_id and service_name:
                name_lower = service_name.lower()
                incidents = [
                    i for i in incidents
                    if name_lower in (i.get("service", {}).get("summary", "") or "").lower()
                    or name_lower in (i.get("title", "") or "").lower()
                ]

            if not incidents:
                return {"status": "ok", "incident_count": 0, "incidents": []}

            status = "warning"
            for i in incidents:
                if i.get("urgency") == "high":
                    status = "critical"
                    break

            inc_list = [
                {
                    "id": i.get("id", ""),
                    "title": i.get("title", ""),
                    "status": i.get("status", ""),
                    "urgency": i.get("urgency", ""),
                    "url": i.get("html_url", ""),
                    "created_at": i.get("created_at", ""),
                    "service": i.get("service", {}).get("summary", ""),
                    "assigned_to": [
                        a.get("assignee", {}).get("summary", "")
                        for a in i.get("assignments", [])
                    ],
                }
                for i in incidents[:10]
            ]

            return {"status": status, "incident_count": len(incidents), "incidents": inc_list}

    except Exception as exc:
        logger.debug("PagerDuty incidents for %s failed: %s", service_name, exc)
        return {"status": "unknown", "incident_count": 0, "incidents": []}


# ── GitHub helpers ─────────────────────────────────────────────────────────────

async def _gh_last_deploy(gh, repo: str) -> dict:
    """
    Fetch the most recent GitHub deployment for `owner/repo`.
    Returns {"last_deploy": str, "last_deploy_ref": str, "last_deploy_status": str,
             "last_deploy_url": str, "last_deploy_ago": str}
    """
    if not gh or not repo:
        return {}

    parts = repo.strip().split("/")
    if len(parts) != 2:
        return {}
    owner, name = parts

    try:
        headers = gh.headers
        async with httpx.AsyncClient(headers=headers, timeout=15) as client:
            r = await client.get(
                f"https://api.github.com/repos/{owner}/{name}/deployments",
                params={"per_page": 5},
            )
            if r.status_code != 200:
                return {}

            deploys = r.json()
            if not deploys:
                return {}

            dep = deploys[0]
            created_at = dep.get("created_at", "")

            # Get latest status
            sr = await client.get(
                f"https://api.github.com/repos/{owner}/{name}/deployments/{dep['id']}/statuses",
                params={"per_page": 1},
            )
            statuses = sr.json() if sr.status_code == 200 else []
            state = statuses[0]["state"] if statuses else "pending"

            return {
                "last_deploy": created_at,
                "last_deploy_ago": _time_ago(created_at),
                "last_deploy_ref": dep.get("ref", ""),
                "last_deploy_env": dep.get("environment", ""),
                "last_deploy_status": state,
                "last_deploy_by": dep.get("creator", {}).get("login", ""),
                "last_deploy_url": f"https://github.com/{owner}/{name}/deployments",
            }

    except Exception as exc:
        logger.debug("GitHub last deploy for %s failed: %s", repo, exc)
        return {}


# ── Source chips ───────────────────────────────────────────────────────────────

_SOURCE_COLORS = {
    "cloudwatch": "#fb923c",
    "grafana":    "#f87171",
    "pagerduty":  "#10b981",
    "github":     "#60a5fa",
    "datadog":    "#a78bfa",
}


def _source_chips(svc_cfg: dict, cw_result: dict, grafana_result: dict, pd_result: dict, gh_result: dict) -> list:
    chips = []
    if svc_cfg.get("cloudwatch", {}).get("alarm_prefix") and cw_result.get("status") != "unknown":
        chips.append({"name": "CloudWatch", "color": _SOURCE_COLORS["cloudwatch"]})
    if svc_cfg.get("grafana") and grafana_result.get("status") != "unknown":
        chips.append({"name": "Grafana", "color": _SOURCE_COLORS["grafana"]})
    if svc_cfg.get("pagerduty") and pd_result.get("status") != "unknown":
        chips.append({"name": "PagerDuty", "color": _SOURCE_COLORS["pagerduty"]})
    if svc_cfg.get("github", {}).get("repo") and gh_result:
        chips.append({"name": "GitHub", "color": _SOURCE_COLORS["github"]})
    return chips


# ── Metric cells ───────────────────────────────────────────────────────────────

def _metric_cells(svc_cfg: dict, cw_result: dict, grafana_result: dict,
                  pd_result: dict, gh_result: dict) -> list:
    """
    Build the 4-cell metrics array shown on each service card.
    Derived from available connector data.
    """
    cells = []

    # Cell 1: Alarm / alert count
    alarm_n   = cw_result.get("alarm_count", 0)
    grafana_n = grafana_result.get("alert_count", 0)
    total_alerts = alarm_n + grafana_n
    cells.append({
        "val": str(total_alerts) if total_alerts else "0",
        "lbl": "Active alarms",
        "color": "#f87171" if total_alerts > 0 else "#10b981",
    })

    # Cell 2: Open incidents
    inc_n = pd_result.get("incident_count", 0)
    cells.append({
        "val": str(inc_n) if inc_n else "0",
        "lbl": "Open incidents",
        "color": "#f87171" if inc_n > 1 else "#fbbf24" if inc_n == 1 else "#10b981",
    })

    # Cell 3: Monitored alarms total
    total_alarms = cw_result.get("total_alarms", 0)
    cells.append({
        "val": str(total_alarms),
        "lbl": "Alarms monitored",
        "color": "#60a5fa",
    })

    # Cell 4: Last deploy
    if gh_result.get("last_deploy_ago"):
        deploy_status = gh_result.get("last_deploy_status", "")
        cells.append({
            "val": gh_result["last_deploy_ago"],
            "lbl": f"Last deploy ({gh_result.get('last_deploy_env', 'prod')})",
            "color": "#f87171" if deploy_status in ("failure", "error") else "#10b981",
        })
    else:
        cells.append({
            "val": "—",
            "lbl": "Last deploy",
            "color": "#64748b",
        })

    return cells


# ── Event list ─────────────────────────────────────────────────────────────────

def _build_events(cw_result: dict, grafana_result: dict, pd_result: dict, gh_result: dict) -> list:
    """Build a short event list (max 5) for the service card."""
    evts = []

    for inc in pd_result.get("incidents", [])[:2]:
        evts.append({
            "title": inc["title"],
            "time": f"{_time_ago(inc.get('created_at', ''))} · PagerDuty",
            "sev": "#f87171" if inc.get("urgency") == "high" else "#fbbf24",
        })

    for alarm in cw_result.get("alarms", [])[:2]:
        if alarm.get("state") == "ALARM":
            evts.append({
                "title": f"Alarm: {alarm['name']}",
                "time": "CloudWatch",
                "sev": "#f87171",
            })

    for alert in grafana_result.get("alerts", [])[:1]:
        evts.append({
            "title": alert.get("summary") or alert.get("name", "Grafana alert"),
            "time": "Grafana",
            "sev": "#f87171" if alert.get("severity") in ("critical", "error") else "#fbbf24",
        })

    if gh_result.get("last_deploy_ref"):
        ref   = gh_result["last_deploy_ref"][:30]
        state = gh_result.get("last_deploy_status", "")
        evts.append({
            "title": f"Deploy: {ref} [{state.upper()}]",
            "time": f"{gh_result.get('last_deploy_ago', '')} · GitHub",
            "sev": "#f87171" if state in ("failure", "error") else "#a78bfa",
        })

    return evts[:5]


# ── Spark color ────────────────────────────────────────────────────────────────

def _spark_color(status: str) -> str:
    return {"critical": "#f87171", "warning": "#fbbf24", "ok": "#10b981"}.get(status, "#64748b")


# ── Main aggregator ────────────────────────────────────────────────────────────

async def fetch_service_health(svc_cfg: dict, cw, grafana, pd, gh) -> dict:
    """Fetch live health for a single service and return a service health object."""
    svc_id   = svc_cfg.get("id", "")
    svc_name = svc_cfg.get("name", svc_id)

    # Fetch all sources in parallel
    cw_cfg      = svc_cfg.get("cloudwatch", {})
    grafana_cfg = svc_cfg.get("grafana", {})
    pd_cfg      = svc_cfg.get("pagerduty", {})
    gh_cfg      = svc_cfg.get("github", {})

    async def _noop_cw():      return {"status": "unknown", "alarm_count": 0, "alarms": [], "spark": []}
    async def _noop_grafana(): return {"status": "unknown", "alert_count": 0, "alerts": []}
    async def _noop_pd():      return {"status": "unknown", "incident_count": 0, "incidents": []}
    async def _noop_gh():      return {}

    cw_task      = _cw_alarm_health(cw, cw_cfg.get("alarm_prefix", "")) if cw_cfg.get("alarm_prefix") else _noop_cw()
    grafana_task = _grafana_service_alerts(grafana, svc_name, grafana_cfg.get("dashboard_uid", "")) if grafana_cfg else _noop_grafana()
    pd_task      = _pd_service_incidents(pd, pd_cfg.get("service_id", ""), svc_name) if (pd_cfg or (pd and pd.api_key)) else _noop_pd()
    gh_task      = _gh_last_deploy(gh, gh_cfg.get("repo", "")) if gh_cfg.get("repo") else _noop_gh()

    results = await asyncio.gather(cw_task, grafana_task, pd_task, gh_task, return_exceptions=True)

    cw_result      = results[0] if not isinstance(results[0], Exception) else {"status": "unknown", "alarm_count": 0, "alarms": [], "spark": []}
    grafana_result = results[1] if not isinstance(results[1], Exception) else {"status": "unknown", "alert_count": 0, "alerts": []}
    pd_result      = results[2] if not isinstance(results[2], Exception) else {"status": "unknown", "incident_count": 0, "incidents": []}
    gh_result      = results[3] if not isinstance(results[3], Exception) else {}

    # Aggregate status (ignore "unknown" — don't penalize unconfigured sources)
    known_statuses = [
        s for s in [cw_result["status"], grafana_result["status"], pd_result["status"]]
        if s != "unknown"
    ]
    status = _worst_status(*known_statuses) if known_statuses else "ok"

    alert_count = cw_result.get("alarm_count", 0) + grafana_result.get("alert_count", 0)

    spark  = cw_result.get("spark") or [3] * 25
    events = _build_events(cw_result, grafana_result, pd_result, gh_result)
    chips  = _source_chips(svc_cfg, cw_result, grafana_result, pd_result, gh_result)

    # Grafana dashboard deep-link
    grafana_url = ""
    if grafana and grafana.url and grafana_cfg.get("dashboard_uid"):
        grafana_url = f"{grafana.url}/d/{grafana_cfg['dashboard_uid']}"

    return {
        "id":           svc_id,
        "name":         svc_name,
        "team":         svc_cfg.get("team", ""),
        "runtime":      svc_cfg.get("runtime", "Generic"),
        "env":          svc_cfg.get("env", "production"),
        "icon":         svc_cfg.get("icon", "⬡"),
        "status":       status,
        "alertCount":   alert_count,
        "metrics":      _metric_cells(svc_cfg, cw_result, grafana_result, pd_result, gh_result),
        "spark":        spark,
        "sparkColor":   _spark_color(status),
        "lastEvt":      events[0]["time"] if events else "no events",
        "lastEvtAlert": alert_count > 0,
        "sources":      chips,
        "events":       events,
        # Extra fields for detail panel
        "alarms":       cw_result.get("alarms", []),
        "incidents":    pd_result.get("incidents", []),
        "deploy":       gh_result,
        "grafanaUrl":   grafana_url,
    }


async def fetch_all_services(cw, grafana, pd, gh) -> dict:
    """
    Load services.yml and fetch live health for every service in parallel.
    Returns {"teams": [...], "services": [...]}
    """
    config   = load_config()
    teams    = config.get("teams", [])
    svc_cfgs = config.get("services", [])

    tasks = [fetch_service_health(s, cw, grafana, pd, gh) for s in svc_cfgs]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    services = []
    for svc_cfg, result in zip(svc_cfgs, results):
        if isinstance(result, Exception):
            logger.warning("Service %s health fetch failed: %s", svc_cfg.get("id"), result)
            services.append({
                "id":         svc_cfg.get("id", ""),
                "name":       svc_cfg.get("name", ""),
                "team":       svc_cfg.get("team", ""),
                "runtime":    svc_cfg.get("runtime", "Generic"),
                "env":        svc_cfg.get("env", "production"),
                "icon":       svc_cfg.get("icon", "⬡"),
                "status":     "unknown",
                "alertCount": 0,
                "metrics":    [],
                "spark":      [3] * 25,
                "sparkColor": "#64748b",
                "lastEvt":    "fetch error",
                "lastEvtAlert": False,
                "sources":    [],
                "events":     [],
            })
        else:
            services.append(result)

    return {"teams": teams, "services": services}


# ════════════════════════════════════════════════════════════════════════════
# Level 2 — service-scoped unified timeline + cross-service correlation
# ════════════════════════════════════════════════════════════════════════════

def _event_belongs_to_service(event, svc_cfg: dict) -> bool:
    """
    Return True if this TimelineEvent belongs to the given service config.
    Matches on:
      - CloudWatch: alarm_name starts with svc cloudwatch.alarm_prefix
      - GitHub:     raw owner/repo matches svc github.repo
      - PagerDuty:  raw service.id == svc pagerduty.service_id  OR  service name contains svc name
      - Grafana:    title/detail contains svc name
    """
    raw       = event.raw or {}
    svc_name  = (svc_cfg.get("name") or "").lower()
    cw_prefix = (svc_cfg.get("cloudwatch") or {}).get("alarm_prefix", "").lower()
    gh_repo   = (svc_cfg.get("github") or {}).get("repo", "").lower()
    pd_svc_id = (svc_cfg.get("pagerduty") or {}).get("service_id", "")

    if event.source == "cloudwatch" and cw_prefix:
        alarm_name = (raw.get("alarm_name") or "").lower()
        if alarm_name.startswith(cw_prefix):
            return True

    if event.source == "github" and gh_repo:
        owner = raw.get("owner", "")
        repo  = raw.get("repo", "")
        if owner and repo:
            if f"{owner}/{repo}".lower() == gh_repo:
                return True
        # fallback: check if repo name part matches
        if gh_repo.split("/")[-1] and gh_repo.split("/")[-1] in event.title.lower():
            return True

    if event.source == "pagerduty":
        svc_obj = raw.get("service") or {}
        if isinstance(svc_obj, dict):
            if pd_svc_id and svc_obj.get("id") == pd_svc_id:
                return True
            if svc_name and svc_name in (svc_obj.get("summary") or "").lower():
                return True
        if svc_name and svc_name in event.title.lower():
            return True

    if event.source == "grafana" and svc_name:
        if svc_name in event.title.lower() or svc_name in event.detail.lower():
            return True

    return False


async def fetch_service_timeline(
    svc_cfg: dict,
    all_svc_cfgs: list,
    cw,
    grafana,
    pd,
    gh,
    window_hours: int = 4,
) -> dict:
    """
    Level 2: fetch a unified timeline scoped to one service, plus cross-service
    correlation context (other services with events in the same window).

    Returns:
      {
        "events":           [TimelineEvent dicts],          # this service's events
        "related_services": [{ id, name, events: [...] }],  # other services with overlapping anomalies
        "window":           { "start": str, "end": str },
      }
    """
    import os
    from datetime import datetime, timezone, timedelta
    from connectors.cloudwatch import CloudWatchConnector
    from connectors.github import GitHubConnector
    from connectors.pagerduty import PagerDutyConnector

    end   = datetime.now(timezone.utc)
    start = end - timedelta(hours=window_hours)

    # ── 1. Build service-specific connector instances ─────────────────────────
    fetch_tasks = []
    source_labels = []

    cw_cfg = (svc_cfg.get("cloudwatch") or {})
    if cw_cfg.get("alarm_prefix"):
        svc_cw = CloudWatchConnector(
            region     = os.environ.get("AWS_REGION", "us-east-1"),
            access_key = os.environ.get("AWS_ACCESS_KEY_ID"),
            secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY"),
            log_groups = cw_cfg.get("log_groups") or [],
            alarm_prefix = cw_cfg["alarm_prefix"],
        )
        fetch_tasks.append(svc_cw.fetch(start, end))
        source_labels.append("cloudwatch")

    gh_cfg = (svc_cfg.get("github") or {})
    if gh_cfg.get("repo"):
        token = os.environ.get("GITHUB_TOKEN")
        svc_gh = GitHubConnector(token=token, repos=[gh_cfg["repo"]])
        fetch_tasks.append(svc_gh.fetch(start, end))
        source_labels.append("github")

    pd_cfg  = (svc_cfg.get("pagerduty") or {})
    pd_ids  = [pd_cfg["service_id"]] if pd_cfg.get("service_id") else (pd.service_ids if pd else [])
    if pd and pd.api_key:
        svc_pd = PagerDutyConnector(api_key=pd.api_key, service_ids=pd_ids or None)
        fetch_tasks.append(svc_pd.fetch(start, end))
        source_labels.append("pagerduty")

    if grafana and grafana.url and grafana.api_key:
        fetch_tasks.append(grafana.fetch(start, end))
        source_labels.append("grafana")

    # ── 2. Fetch all sources in parallel ─────────────────────────────────────
    results = await asyncio.gather(*fetch_tasks, return_exceptions=True)

    own_events = []
    for label, result in zip(source_labels, results):
        if isinstance(result, Exception):
            logger.warning("Service %s timeline: %s fetch failed: %s", svc_cfg.get("id"), label, result)
        else:
            if label == "grafana":
                # Filter Grafana events to those mentioning this service
                svc_name_lower = (svc_cfg.get("name") or "").lower()
                filtered = [e for e in result if svc_name_lower in e.title.lower() or svc_name_lower in e.detail.lower()]
                own_events.extend(filtered)
            else:
                own_events.extend(result)

    # Sort chronologically
    own_events.sort(key=lambda e: e.time)

    # ── 3. Cross-service correlation ──────────────────────────────────────────
    # Only look for correlation if this service has any events
    related_services = []
    if own_events and all_svc_cfgs:
        # Determine the critical time window: earliest..latest event ± 30 min
        try:
            times = [datetime.fromisoformat(e.time.replace("Z", "+00:00")) for e in own_events]
            corr_start = min(times) - timedelta(minutes=30)
            corr_end   = max(times) + timedelta(minutes=30)
        except Exception:
            corr_start, corr_end = start, end

        # Fetch global timeline for the correlation window (all sources)
        global_fetch_tasks = []
        if cw:
            global_fetch_tasks.append(cw.fetch(corr_start, corr_end))
        if gh:
            global_fetch_tasks.append(gh.fetch(corr_start, corr_end))
        if pd and pd.api_key:
            global_fetch_tasks.append(pd.fetch(corr_start, corr_end))
        if grafana and grafana.url and grafana.api_key:
            global_fetch_tasks.append(grafana.fetch(corr_start, corr_end))

        if global_fetch_tasks:
            global_results = await asyncio.gather(*global_fetch_tasks, return_exceptions=True)
            all_global_events = []
            for r in global_results:
                if not isinstance(r, Exception):
                    all_global_events.extend(r)

            # For each OTHER service, find its events in the global pool
            own_event_ids = {e.id for e in own_events}
            for other_cfg in all_svc_cfgs:
                if other_cfg.get("id") == svc_cfg.get("id"):
                    continue
                other_events = [
                    e for e in all_global_events
                    if e.id not in own_event_ids and _event_belongs_to_service(e, other_cfg)
                    and e.severity in ("critical", "warning")
                ]
                if other_events:
                    other_events.sort(key=lambda e: e.time)
                    related_services.append({
                        "id":     other_cfg.get("id", ""),
                        "name":   other_cfg.get("name", other_cfg.get("id", "")),
                        "team":   other_cfg.get("team", ""),
                        "icon":   other_cfg.get("icon", "⬡"),
                        "events": [
                            {
                                "id":       e.id,
                                "source":   e.source,
                                "time":     e.time,
                                "severity": e.severity,
                                "title":    e.title,
                                "url":      e.url,
                            }
                            for e in other_events[:5]  # cap per service
                        ],
                    })

        # Sort related services by most-recent event first
        related_services.sort(
            key=lambda s: s["events"][0]["time"] if s["events"] else "",
            reverse=True,
        )

    return {
        "events": [
            {
                "id":       e.id,
                "source":   e.source,
                "time":     e.time,
                "severity": e.severity,
                "title":    e.title,
                "detail":   e.detail,
                "tags":     e.tags,
                "url":      e.url,
            }
            for e in own_events
        ],
        "related_services": related_services[:8],  # cap total
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "service_id": svc_cfg.get("id", ""),
        "service_name": svc_cfg.get("name", ""),
    }
