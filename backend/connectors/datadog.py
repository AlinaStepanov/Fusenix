"""
Datadog connector — fetches:
  1. Events stream (/api/v1/events) — alerts, deploys, config changes
  2. Monitor state changes (triggered/warn/no-data monitors via /api/v1/monitor)

Required env vars:
  DD_API_KEY  — Datadog API key
  DD_APP_KEY  — Datadog Application key (read-only scope is fine)

Optional:
  DD_SITE     — Datadog site (default: datadoghq.com; EU users: datadoghq.eu)
"""
import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger("fusenix.datadog")


def _make_id(key: str) -> str:
    return hashlib.md5(f"datadog:{key}".encode()).hexdigest()


def _severity(alert_type: str, overall_state: str = "") -> str:
    t = (alert_type or "").lower()
    s = (overall_state or "").lower()
    if s in ("resolved", "recovered", "ok") or t == "success":
        return "success"
    if t in ("error", "critical") or s == "alert":
        return "critical"
    if t in ("warning", "warn") or s == "warn":
        return "warning"
    return "info"


class DatadogConnector:
    def __init__(
        self,
        api_key: str,
        app_key: str,
        site: str = "datadoghq.com",
    ):
        self.api_key = api_key
        self.app_key = app_key
        self.base_url = f"https://api.{site}"

    def _headers(self) -> dict:
        return {
            "DD-API-KEY": self.api_key,
            "DD-APPLICATION-KEY": self.app_key,
            "Content-Type": "application/json",
        }

    async def fetch(self, start: datetime, end: datetime) -> list:
        from main import TimelineEvent  # local import avoids circular at module load

        events: list = []
        start_epoch = int(start.timestamp())
        end_epoch = int(end.timestamp())

        async with httpx.AsyncClient(headers=self._headers(), timeout=30) as client:

            # ── 1. Events stream ──────────────────────────────────────────────
            try:
                r = await client.get(
                    f"{self.base_url}/api/v1/events",
                    params={"start": start_epoch, "end": end_epoch, "priority": "all"},
                )
                if r.status_code == 200:
                    for evt in r.json().get("events", []):
                        alert_type = evt.get("alert_type", "info")
                        severity = _severity(alert_type)

                        ts_epoch = evt.get("date_happened", 0)
                        try:
                            ts = datetime.fromtimestamp(ts_epoch, tz=timezone.utc).isoformat()
                        except Exception:
                            ts = start.isoformat()

                        title = evt.get("title") or "Datadog event"
                        text = (evt.get("text") or "")[:200]
                        source_type = evt.get("source_type_name") or "datadog"

                        raw_tags = evt.get("tags") or []
                        tags = [t for t in raw_tags if isinstance(t, str) and len(t) < 60][:8]
                        tags.append(alert_type)

                        events.append(TimelineEvent(
                            id=_make_id(f"evt:{evt.get('id', '')}"),
                            source="datadog",
                            time=ts,
                            severity=severity,
                            title=f"[DD] {title}",
                            detail=f"Source: {source_type}" + (f" | {text}" if text else ""),
                            tags=tags,
                            url=evt.get("url"),
                            raw=evt,
                        ))
                else:
                    logger.warning(
                        "Datadog events HTTP %d: %s", r.status_code, r.text[:200]
                    )
            except Exception as exc:
                logger.warning("Datadog events fetch failed: %s", exc)

            # ── 2. Triggered / degraded monitors ──────────────────────────────
            try:
                r = await client.get(
                    f"{self.base_url}/api/v1/monitor",
                    params={"page": 0, "page_size": 100, "with_downtimes": "false"},
                )
                if r.status_code == 200:
                    for mon in r.json():
                        overall_state = mon.get("overall_state", "OK")
                        if overall_state not in ("Alert", "Warn", "No Data", "Unknown"):
                            continue  # skip healthy monitors

                        state_obj = mon.get("state") or {}
                        last_triggered = state_obj.get("last_triggered_ts")
                        if not last_triggered:
                            continue

                        try:
                            ts_dt = datetime.fromtimestamp(last_triggered, tz=timezone.utc)
                            if ts_dt < start or ts_dt > end:
                                continue
                            ts = ts_dt.isoformat()
                        except Exception:
                            continue

                        name = mon.get("name", "Unknown monitor")
                        mon_type = mon.get("type", "")
                        severity = _severity("", overall_state)

                        raw_tags = mon.get("tags") or []
                        tags = [t for t in raw_tags if isinstance(t, str) and len(t) < 60][:8]
                        tags += ["monitor", overall_state.lower().replace(" ", "_")]

                        query = (mon.get("query") or "")[:120]

                        events.append(TimelineEvent(
                            id=_make_id(f"mon:{mon.get('id', '')}"),
                            source="datadog",
                            time=ts,
                            severity=severity,
                            title=f"[DD Monitor] {name}",
                            detail=(
                                f"State: {overall_state} | Type: {mon_type}"
                                + (f" | Query: {query}" if query else "")
                            ),
                            tags=tags,
                            url=f"https://app.datadoghq.com/monitors/{mon.get('id')}",
                            raw={
                                "id": mon.get("id"),
                                "name": name,
                                "state": overall_state,
                                "type": mon_type,
                            },
                        ))
                else:
                    logger.warning(
                        "Datadog monitors HTTP %d: %s", r.status_code, r.text[:200]
                    )
            except Exception as exc:
                logger.warning("Datadog monitors fetch failed: %s", exc)

        logger.info("Datadog returned %d events", len(events))
        return events


# ── Configuration audit ───────────────────────────────────────────────────────

async def audit(self) -> dict:
    """
    Audit Datadog monitor configuration for common misconfigurations.
    Returns a dict matching the per-source shape used by /audit.
    """
    items = []
    summary = {"total": 0, "ok": 0, "warning": 0, "critical": 0, "info": 0}

    if not self.api_key or not self.app_key:
        return {"configured": False, "items": [], "summary": summary}

    async with httpx.AsyncClient(headers=self._headers(), timeout=30) as client:

        # Fetch active downtimes so we know which monitors are muted
        muted_monitor_ids: set = set()
        try:
            r = await client.get(f"{self.base_url}/api/v1/downtime", params={"currentOnly": "true"})
            if r.status_code == 200:
                for dt in r.json():
                    scope = dt.get("scope", [])
                    monitor_id = dt.get("monitor_id")
                    if monitor_id:
                        muted_monitor_ids.add(monitor_id)
        except Exception as exc:
            logger.warning("Datadog downtime fetch failed: %s", exc)

        # Paginate through all monitors
        page = 0
        while True:
            try:
                r = await client.get(
                    f"{self.base_url}/api/v1/monitor",
                    params={"page": page, "page_size": 100, "with_downtimes": "true"},
                )
                if r.status_code != 200:
                    logger.warning("Datadog monitors HTTP %d", r.status_code)
                    break

                batch = r.json()
                if not batch:
                    break

                for mon in batch:
                    mon_id = mon.get("id")
                    name = mon.get("name", "Unnamed monitor")
                    mon_type = mon.get("type", "")
                    overall_state = mon.get("overall_state", "OK")
                    message = mon.get("message", "")
                    options = mon.get("options", {})
                    is_muted = mon_id in muted_monitor_ids or bool(options.get("silenced"))
                    tags = mon.get("tags", [])

                    issues = []

                    # Check: no notification recipients in message
                    has_notify = "@" in message or "{{" in message
                    if not has_notify:
                        issues.append({
                            "code": "NO_NOTIFICATION",
                            "severity": "critical",
                            "message": "Monitor message has no @mentions or template variables — alerts fire silently",
                        })

                    # Check: monitor is muted/silenced indefinitely
                    if is_muted:
                        silenced = options.get("silenced", {})
                        # silenced = {} means indefinitely muted
                        if silenced == {} or (isinstance(silenced, dict) and "*" in silenced):
                            issues.append({
                                "code": "MONITOR_MUTED",
                                "severity": "warning",
                                "message": "Monitor is muted indefinitely — no alerts will be sent",
                            })
                        else:
                            issues.append({
                                "code": "MONITOR_MUTED",
                                "severity": "info",
                                "message": "Monitor has an active downtime/mute scheduled",
                            })

                    # Check: stuck in No Data state
                    if overall_state == "No Data":
                        no_data_policy = options.get("no_data_timeframe")
                        if not no_data_policy:
                            issues.append({
                                "code": "NO_DATA_UNCONFIGURED",
                                "severity": "warning",
                                "message": "Monitor is in No Data state with no no_data_timeframe policy set",
                            })

                    # Check: no tags (makes it hard to find/filter)
                    if not tags:
                        issues.append({
                            "code": "NO_TAGS",
                            "severity": "info",
                            "message": "Monitor has no tags — hard to filter in dashboards and incident response",
                        })

                    # Check: renotify disabled for critical monitors
                    if overall_state in ("Alert",) and not options.get("renotify_interval"):
                        issues.append({
                            "code": "NO_RENOTIFY",
                            "severity": "info",
                            "message": "No renotification interval set — responders get one alert then silence",
                        })

                    health = "ok"
                    if any(i["severity"] == "critical" for i in issues):
                        health = "critical"
                    elif any(i["severity"] == "warning" for i in issues):
                        health = "warning"
                    elif issues:
                        health = "info"

                    items.append({
                        "name": name,
                        "id": mon_id,
                        "type": mon_type,
                        "state": overall_state,
                        "health": health,
                        "issues_count": len(issues),
                        "issues": issues,
                        "url": f"https://app.datadoghq.com/monitors/{mon_id}",
                        "tags": tags[:8],
                    })

                if len(batch) < 100:
                    break
                page += 1

            except Exception as exc:
                logger.error("Datadog audit fetch error: %s", exc)
                break

    for item in items:
        summary["total"] += 1
        summary[item["health"]] = summary.get(item["health"], 0) + 1

    return {"configured": True, "items": items, "summary": summary}
