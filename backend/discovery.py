"""
discovery.py — Auto-discover services from connected APIs.

Queries CloudWatch, PagerDuty, Grafana, and GitHub to build a suggested
services.yml without manual configuration.

Usage:
  GET  /discover           → returns raw discoveries + suggested services + YAML
  POST /discover/save      → writes the YAML to services.yml (with backup)
"""
import asyncio
import logging
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import boto3
import httpx
from botocore.config import Config

logger = logging.getLogger("fusenix.discovery")

_SERVICES_YML = Path(__file__).resolve().parent.parent / "services.yml"

# ── Runtime inference from CloudWatch alarm namespace ────────────────────────
_NAMESPACE_RUNTIME = {
    "aws/ecs":              "ECS",
    "ecs":                  "ECS",
    "aws/lambda":           "Lambda",
    "lambda":               "Lambda",
    "aws/rds":              "RDS",
    "rds":                  "RDS",
    "aws/ec2":              "EC2",
    "ec2":                  "EC2",
    "aws/applicationelb":   "EKS",
    "aws/alb":              "EKS",
    "aws/eks":              "EKS",
    "eks":                  "EKS",
    "containerinsights":    "EKS",
}

# ── ENV prefix/suffix noise to strip when normalising names ──────────────────
_ENV_NOISE = re.compile(
    r'^(prod|production|staging|stage|dev|development|test|testing|qa)[_\-]|'
    r'[_\-](prod|production|staging|stage|dev|development|test|testing|qa)$',
    re.IGNORECASE,
)


def _normalise(name: str) -> str:
    """Lowercase, strip env prefixes/suffixes, collapse non-alphanumeric."""
    name = name.lower().strip()
    name = _ENV_NOISE.sub("", name)
    name = re.sub(r'[^a-z0-9]+', '-', name).strip('-')
    return name


def _env_tag(name: str) -> str:
    """Detect env (production/staging/etc.) from a service name."""
    n = name.lower()
    if any(t in n for t in ("prod", "production")):
        return "production"
    if any(t in n for t in ("stage", "staging")):
        return "staging"
    if any(t in n for t in ("dev", "development")):
        return "development"
    if "test" in n or "qa" in n:
        return "testing"
    return "production"


# ═══════════════════════════════════════════════════════════════════════════
# Per-source discovery
# ═══════════════════════════════════════════════════════════════════════════

async def _discover_cloudwatch(
    region: str,
    access_key: Optional[str],
    secret_key: Optional[str],
) -> dict:
    """
    List all CloudWatch alarms and group them by name prefix to infer services.
    Returns { services: [{name, alarm_prefix, runtime, env, alarm_count}] }
    """
    def _list_alarms():
        kwargs: dict = {"region_name": region}
        if access_key and secret_key:
            kwargs["aws_access_key_id"] = access_key
            kwargs["aws_secret_access_key"] = secret_key
        cfg = Config(retries={"max_attempts": 3, "mode": "standard"})
        cw_client = boto3.client("cloudwatch", config=cfg, **kwargs)
        alarms = []
        paginator = cw_client.get_paginator("describe_alarms")
        for page in paginator.paginate(AlarmTypes=["MetricAlarm", "CompositeAlarm"]):
            alarms.extend(page.get("MetricAlarms", []))
            alarms.extend(page.get("CompositeAlarms", []))
        return alarms

    try:
        alarms = await asyncio.to_thread(_list_alarms)
    except Exception as exc:
        logger.warning("CloudWatch discovery failed: %s", exc)
        return {"configured": False, "error": str(exc), "services": [], "alarms": []}

    # Build raw alarm list for reference
    raw_alarms = [
        {
            "name":      a.get("AlarmName", ""),
            "namespace": a.get("Namespace", ""),
            "state":     a.get("StateValue", ""),
        }
        for a in alarms
    ]

    # ── Group by prefix ───────────────────────────────────────────────────────
    # Strategy: split alarm name on '-', try 1,2,3-token prefixes and pick the
    # grouping with the best coverage (≥2 alarms sharing a prefix).
    prefix_map: dict[str, list] = {}
    for alarm in alarms:
        name = alarm.get("AlarmName", "")
        parts = re.split(r'[-_]', name)
        # Try prefixes of length 1..4
        for length in range(1, min(len(parts), 5)):
            prefix = "-".join(parts[:length]) + "-"
            prefix_map.setdefault(prefix, []).append(alarm)

    # Keep only prefixes that cover ≥2 alarms
    viable = {p: al for p, al in prefix_map.items() if len(al) >= 2}

    # Deduplicate: remove prefixes fully covered by a longer prefix
    sorted_prefixes = sorted(viable.keys(), key=len, reverse=True)
    covered: set[str] = set()
    selected: list[str] = []
    for prefix in sorted_prefixes:
        alarm_names = {a["AlarmName"] for a in viable[prefix]}
        if alarm_names & covered:
            continue  # already claimed by a longer (more specific) prefix
        covered |= alarm_names
        selected.append(prefix)

    # Include alarms not matched by any prefix as singleton services
    matched_names = {a["AlarmName"] for p in selected for a in viable[p]}
    singletons = [a for a in alarms if a.get("AlarmName", "") not in matched_names]

    services: list[dict] = []

    for prefix in selected:
        group_alarms = viable[prefix]
        service_name = prefix.rstrip("-")
        # Infer runtime from namespaces present in this group
        namespaces = {a.get("Namespace", "").lower() for a in group_alarms}
        runtime = "Generic"
        for ns in namespaces:
            runtime = _NAMESPACE_RUNTIME.get(ns, runtime)
            if runtime != "Generic":
                break
        services.append({
            "name":         service_name,
            "alarm_prefix": prefix,
            "runtime":      runtime,
            "env":          _env_tag(service_name),
            "alarm_count":  len(group_alarms),
            "namespaces":   list(namespaces - {""}),
        })

    # Singletons — each alarm becomes its own service entry if unclaimed
    for alarm in singletons:
        aname = alarm.get("AlarmName", "")
        ns = alarm.get("Namespace", "").lower()
        runtime = _NAMESPACE_RUNTIME.get(ns, "Generic")
        services.append({
            "name":         aname,
            "alarm_prefix": aname,
            "runtime":      runtime,
            "env":          _env_tag(aname),
            "alarm_count":  1,
            "namespaces":   [ns] if ns else [],
        })

    return {
        "configured": True,
        "alarm_count": len(alarms),
        "services": services,
        "alarms": raw_alarms,
    }


async def _discover_pagerduty(api_key: str) -> dict:
    """
    List all PagerDuty services via /services API.
    Returns { services: [{id, name, description, status}] }
    """
    if not api_key:
        return {"configured": False, "services": []}

    services = []
    offset = 0
    limit = 100
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            while True:
                resp = await client.get(
                    "https://api.pagerduty.com/services",
                    headers={
                        "Authorization": f"Token token={api_key}",
                        "Accept": "application/vnd.pagerduty+json;version=2",
                    },
                    params={"limit": limit, "offset": offset, "total": "true"},
                )
                resp.raise_for_status()
                data = resp.json()
                for svc in data.get("services", []):
                    services.append({
                        "id":          svc.get("id", ""),
                        "name":        svc.get("name", ""),
                        "description": svc.get("description", ""),
                        "status":      svc.get("status", ""),
                        "html_url":    svc.get("html_url", ""),
                    })
                if not data.get("more", False):
                    break
                offset += limit
    except Exception as exc:
        logger.warning("PagerDuty discovery failed: %s", exc)
        return {"configured": False, "error": str(exc), "services": []}

    return {"configured": True, "services": services}


async def _discover_grafana(url: str, api_key: str) -> dict:
    """
    List all Grafana dashboards via /api/search.
    Returns { dashboards: [{uid, title, url}] }
    """
    if not url or not api_key:
        return {"configured": False, "dashboards": []}

    dashboards = []
    page = 1
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            while True:
                resp = await client.get(
                    f"{url.rstrip('/')}/api/search",
                    headers={"Authorization": f"Bearer {api_key}"},
                    params={"type": "dash-db", "limit": 100, "page": page},
                )
                resp.raise_for_status()
                items = resp.json()
                if not items:
                    break
                for item in items:
                    dashboards.append({
                        "uid":   item.get("uid", ""),
                        "title": item.get("title", ""),
                        "url":   f"{url.rstrip('/')}{item.get('url', '')}",
                    })
                if len(items) < 100:
                    break
                page += 1
    except Exception as exc:
        logger.warning("Grafana discovery failed: %s", exc)
        return {"configured": False, "error": str(exc), "dashboards": []}

    return {"configured": True, "dashboards": dashboards}


def _discover_github_env() -> dict:
    """
    Parse GITHUB_REPOS env var (comma-separated list of owner/repo).
    Returns { repos: [{owner, repo, full_name}] }
    """
    raw = os.environ.get("GITHUB_REPOS", "")
    repos = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split("/")
        if len(parts) == 2:
            repos.append({"owner": parts[0], "repo": parts[1], "full_name": entry})
        else:
            repos.append({"owner": "", "repo": entry, "full_name": entry})
    return {"configured": bool(repos), "repos": repos}


# ═══════════════════════════════════════════════════════════════════════════
# Merge + fuzzy match
# ═══════════════════════════════════════════════════════════════════════════

def _similarity(a: str, b: str) -> float:
    """Simple token overlap score 0-1."""
    a_tokens = set(re.split(r'[^a-z0-9]+', a.lower())) - {"", "svc", "service", "app"}
    b_tokens = set(re.split(r'[^a-z0-9]+', b.lower())) - {"", "svc", "service", "app"}
    if not a_tokens or not b_tokens:
        return 0.0
    intersection = a_tokens & b_tokens
    union = a_tokens | b_tokens
    return len(intersection) / len(union)


def _best_match(name: str, candidates: list[dict], key: str, threshold: float = 0.35) -> Optional[dict]:
    """Find the best fuzzy match for name among candidates[key]."""
    norm_name = _normalise(name)
    best_score = 0.0
    best = None
    for cand in candidates:
        cand_name = _normalise(cand.get(key, ""))
        score = _similarity(norm_name, cand_name)
        if score > best_score:
            best_score = score
            best = cand
    return best if best_score >= threshold else None


def _merge_discoveries(raw: dict) -> list[dict]:
    """
    Cross-reference CloudWatch services against PagerDuty services,
    Grafana dashboards, and GitHub repos by fuzzy name matching.
    Returns a list of merged service dicts ready for services.yml.
    """
    cw_services  = raw.get("cloudwatch", {}).get("services", [])
    pd_services  = raw.get("pagerduty",  {}).get("services", [])
    gf_dashboards = raw.get("grafana",   {}).get("dashboards", [])
    gh_repos     = raw.get("github",     {}).get("repos", [])

    # If no CloudWatch services, try to build from PagerDuty
    if not cw_services and pd_services:
        cw_services = [
            {
                "name":         svc["name"],
                "alarm_prefix": "",
                "runtime":      "Generic",
                "env":          "production",
                "alarm_count":  0,
                "namespaces":   [],
            }
            for svc in pd_services
        ]

    merged: list[dict] = []
    seen_names: set[str] = set()

    for cw_svc in cw_services:
        name = cw_svc["name"]
        norm = _normalise(name)

        if norm in seen_names:
            continue
        seen_names.add(norm)

        # Slug-ify the id
        svc_id = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

        # Match PagerDuty
        pd_match = _best_match(name, pd_services, "name")
        pd_id = pd_match["id"] if pd_match else ""

        # Match Grafana dashboard
        gf_match = _best_match(name, gf_dashboards, "title")
        gf_uid = gf_match["uid"] if gf_match else ""

        # Match GitHub repo
        gh_match = _best_match(name, gh_repos, "repo")
        gh_repo = gh_match["full_name"] if gh_match else ""

        merged.append({
            "id":           svc_id,
            "name":         name,
            "runtime":      cw_svc.get("runtime", "Generic"),
            "env":          cw_svc.get("env", "production"),
            "alarm_prefix": cw_svc.get("alarm_prefix", ""),
            "alarm_count":  cw_svc.get("alarm_count", 0),
            "pagerduty_id": pd_id,
            "grafana_uid":  gf_uid,
            "github_repo":  gh_repo,
            # For display: matched names
            "_pd_name":  pd_match["name"] if pd_match else None,
            "_gf_title": gf_match["title"] if gf_match else None,
            "_gh_repo":  gh_match["full_name"] if gh_match else None,
        })

    return merged


# ═══════════════════════════════════════════════════════════════════════════
# YAML renderer
# ═══════════════════════════════════════════════════════════════════════════

_RUNTIME_ICON = {
    "EKS":     "⚡",
    "ECS":     "🐳",
    "Lambda":  "λ",
    "RDS":     "🗄",
    "EC2":     "🖥",
    "Generic": "⬡",
}

_ENV_TEAM = {
    "production":  "backend",
    "staging":     "backend",
    "development": "backend",
    "testing":     "backend",
}


def _render_yaml(services: list[dict]) -> str:
    """Render the suggested services list as a services.yml string."""
    lines: list[str] = [
        "# ══════════════════════════════════════════════════════════════════════════════",
        "# Fusenix — Service Map configuration  (auto-generated by /discover)",
        f"# Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "# ══════════════════════════════════════════════════════════════════════════════",
        "",
        "teams:",
        '  - id: backend',
        '    name: Backend',
        '    color: "#60a5fa"',
        '    emoji: "⚡"',
        '  - id: data',
        '    name: Data Eng',
        '    color: "#a78bfa"',
        '    emoji: "◈"',
        '  - id: payments',
        '    name: Payments',
        '    color: "#10b981"',
        '    emoji: "💳"',
        '  - id: infra',
        '    name: Infra',
        '    color: "#fb923c"',
        '    emoji: "⬡"',
        '  - id: frontend',
        '    name: Frontend',
        '    color: "#f472b6"',
        '    emoji: "⊞"',
        "",
        "services:",
    ]

    for svc in services:
        runtime = svc.get("runtime", "Generic")
        icon = _RUNTIME_ICON.get(runtime, "⬡")
        lines.append("")
        lines.append(f"  - id: {svc['id']}")
        lines.append(f"    name: {svc['name']}")
        lines.append("    team: backend")
        lines.append(f"    runtime: {runtime}")
        lines.append(f"    env: {svc.get('env', 'production')}")
        lines.append(f'    icon: "{icon}"')

        alarm_prefix = svc.get("alarm_prefix", "")
        if alarm_prefix:
            lines.append("    cloudwatch:")
            lines.append(f"      alarm_prefix: \"{alarm_prefix}\"")

        gf_uid = svc.get("grafana_uid", "")
        if gf_uid:
            lines.append("    grafana:")
            lines.append(f'      dashboard_uid: "{gf_uid}"')

        gh_repo = svc.get("github_repo", "")
        lines.append("    github:")
        lines.append(f'      repo: "{gh_repo}"')

        pd_id = svc.get("pagerduty_id", "")
        lines.append("    pagerduty:")
        lines.append(f'      service_id: "{pd_id}"')

    lines.append("")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════
# Main entry points
# ═══════════════════════════════════════════════════════════════════════════

async def run_discovery() -> dict:
    """
    Run all source discoveries in parallel and merge results.
    Returns { raw, suggested_services, yaml }
    """
    region      = os.environ.get("AWS_REGION", "us-east-1")
    access_key  = os.environ.get("AWS_ACCESS_KEY_ID")
    secret_key  = os.environ.get("AWS_SECRET_ACCESS_KEY")
    pd_key      = os.environ.get("PAGERDUTY_API_KEY", "")
    grafana_url = os.environ.get("GRAFANA_URL", "")
    grafana_key = os.environ.get("GRAFANA_API_KEY", "")

    cw_task  = _discover_cloudwatch(region, access_key, secret_key)
    pd_task  = _discover_pagerduty(pd_key)
    gf_task  = _discover_grafana(grafana_url, grafana_key)

    cw_result, pd_result, gf_result = await asyncio.gather(
        cw_task, pd_task, gf_task, return_exceptions=True
    )

    # Swallow exceptions — partial results are fine
    if isinstance(cw_result, Exception):
        logger.error("CW discovery error: %s", cw_result)
        cw_result = {"configured": False, "error": str(cw_result), "services": []}
    if isinstance(pd_result, Exception):
        logger.error("PD discovery error: %s", pd_result)
        pd_result = {"configured": False, "error": str(pd_result), "services": []}
    if isinstance(gf_result, Exception):
        logger.error("GF discovery error: %s", gf_result)
        gf_result = {"configured": False, "error": str(gf_result), "dashboards": []}

    gh_result = _discover_github_env()

    raw = {
        "cloudwatch": cw_result,
        "pagerduty":  pd_result,
        "grafana":    gf_result,
        "github":     gh_result,
    }

    suggested = _merge_discoveries(raw)
    yaml_str  = _render_yaml(suggested)

    return {
        "raw":               raw,
        "suggested_services": suggested,
        "yaml":              yaml_str,
        "summary": {
            "cloudwatch_alarms":    cw_result.get("alarm_count", 0),
            "cloudwatch_services":  len(cw_result.get("services", [])),
            "pagerduty_services":   len(pd_result.get("services", [])),
            "grafana_dashboards":   len(gf_result.get("dashboards", [])),
            "github_repos":         len(gh_result.get("repos", [])),
            "suggested_services":   len(suggested),
        },
    }


def save_discovery(yaml_str: str) -> dict:
    """
    Write yaml_str to services.yml. Backs up the existing file first.
    Returns { path, backup_path, service_count }
    """
    backup_path: Optional[str] = None

    if _SERVICES_YML.exists():
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        backup = _SERVICES_YML.with_suffix(f".yml.bak.{ts}")
        shutil.copy2(_SERVICES_YML, backup)
        backup_path = str(backup)
        logger.info("Backed up services.yml → %s", backup_path)

    _SERVICES_YML.write_text(yaml_str, encoding="utf-8")
    logger.info("Wrote services.yml (%d bytes)", len(yaml_str))

    # Count services in the written YAML (quick parse)
    service_count = yaml_str.count("\n  - id:")

    return {
        "path":          str(_SERVICES_YML),
        "backup_path":   backup_path,
        "service_count": service_count,
        "bytes_written": len(yaml_str),
    }
