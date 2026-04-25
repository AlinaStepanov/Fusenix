"""
Grafana connector — fetches:
  1. Alert annotations (state-change history) via /api/annotations
  2. Active alerts from the Unified Alertmanager API
"""
import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger("fusenix.grafana")


def _make_id(key: str) -> str:
    return hashlib.md5(f"grafana:{key}".encode()).hexdigest()


def _severity_from_state(state: str) -> str:
    s = (state or "").lower()
    if s in ("alerting", "firing", "error", "critical"):
        return "critical"
    if s in ("no_data", "nodata", "pending", "warning", "warn"):
        return "warning"
    if s in ("ok", "normal", "resolved"):
        return "success"
    return "info"


class GrafanaConnector:
    """
    Connects to Grafana REST API using a service-account or API token.

    Required env vars:
      GRAFANA_URL      — e.g. https://grafana.mycompany.com
      GRAFANA_API_KEY  — service-account token with Viewer role

    Optional:
      GRAFANA_ORG_ID   — numeric org ID (default: 1)
    """

    def __init__(self, url: str, api_key: str, org_id: Optional[str] = None):
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.org_id = org_id

    def _headers(self) -> dict:
        h: dict = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if self.org_id:
            h["X-Grafana-Org-Id"] = self.org_id
        return h

    async def fetch(self, start: datetime, end: datetime) -> list:
        from main import TimelineEvent  # local import avoids circular at module load

        events: list = []
        start_ms = int(start.timestamp() * 1000)
        end_ms = int(end.timestamp() * 1000)

        async with httpx.AsyncClient(
            headers=self._headers(), timeout=30, follow_redirects=True
        ) as client:

            # ── 1. Alert annotations (historical state changes) ───────────────
            try:
                r = await client.get(
                    f"{self.url}/api/annotations",
                    params={"from": start_ms, "to": end_ms, "type": "alert", "limit": 500},
                )
                if r.status_code == 200:
                    for ann in r.json():
                        alert_name = ann.get("alertName") or ann.get("text") or "Alert"
                        new_state = ann.get("newState") or "alerting"
                        severity = _severity_from_state(new_state)

                        time_ms = ann.get("time", 0)
                        try:
                            ts = datetime.fromtimestamp(time_ms / 1000, tz=timezone.utc).isoformat()
                        except Exception:
                            ts = start.isoformat()

                        tags = ["annotation", "alert", new_state.lower()]
                        if ann.get("dashboardId"):
                            tags.append(f"dashboard:{ann['dashboardId']}")

                        url = None
                        if ann.get("dashboardUID"):
                            url = f"{self.url}/d/{ann['dashboardUID']}"

                        events.append(TimelineEvent(
                            id=_make_id(f"ann:{ann.get('id', '')}"),
                            source="grafana",
                            time=ts,
                            severity=severity,
                            title=f"Alert: {alert_name} → {new_state}",
                            detail=(
                                f"Panel: {ann.get('panelId', 'N/A')} | "
                                f"Dashboard: {ann.get('dashboardId', 'N/A')}"
                            ),
                            tags=tags,
                            url=url,
                            raw=ann,
                        ))
                else:
                    logger.warning("Grafana annotations HTTP %d: %s", r.status_code, r.text[:200])
            except Exception as exc:
                logger.warning("Grafana annotations fetch failed: %s", exc)

            # ── 2. Alertmanager — currently active / recently firing alerts ───
            try:
                r = await client.get(
                    f"{self.url}/api/alertmanager/grafana/api/v2/alerts",
                    params={"active": "true", "silenced": "false", "inhibited": "false"},
                )
                if r.status_code == 200:
                    for alert in r.json():
                        labels = alert.get("labels", {})
                        anns = alert.get("annotations", {})
                        status_obj = alert.get("status", {})
                        state = status_obj.get("state", "active")
                        sev_label = labels.get("severity", "warning")

                        if sev_label in ("critical", "error", "high"):
                            severity = "critical"
                        elif sev_label in ("warning", "warn"):
                            severity = "warning"
                        elif state == "resolved":
                            severity = "success"
                        else:
                            severity = "info"

                        starts_at = alert.get("startsAt", "")
                        try:
                            evt_dt = datetime.fromisoformat(starts_at.replace("Z", "+00:00"))
                            # Include active alerts even outside window; skip resolved out-of-range
                            if state != "active" and (evt_dt < start or evt_dt > end):
                                continue
                            ts = evt_dt.isoformat()
                        except Exception:
                            ts = start.isoformat()

                        alert_name = labels.get("alertname", "Unknown alert")
                        summary = anns.get("summary") or anns.get("description") or ""
                        tags = ["alertmanager", state, sev_label]
                        if labels.get("namespace"):
                            tags.append(f"ns:{labels['namespace']}")

                        events.append(TimelineEvent(
                            id=_make_id(f"am:{alert_name}:{starts_at}"),
                            source="grafana",
                            time=ts,
                            severity=severity,
                            title=f"[Alertmanager] {alert_name}",
                            detail=(
                                summary
                                or f"Labels: {', '.join(f'{k}={v}' for k, v in labels.items())}"
                            ),
                            tags=tags,
                            url=None,
                            raw=alert,
                        ))
                else:
                    logger.warning("Grafana alertmanager HTTP %d: %s", r.status_code, r.text[:200])
            except Exception as exc:
                logger.warning("Grafana alertmanager fetch failed: %s", exc)

        logger.info("Grafana returned %d events", len(events))
        return events


# ── Configuration audit ───────────────────────────────────────────────────────

async def audit(self) -> dict:
    """
    Audit Grafana alert-rule configuration for common misconfigurations.
    Returns a dict matching the per-source shape used by /audit.
    """
    items = []
    summary = {"total": 0, "ok": 0, "warning": 0, "critical": 0, "info": 0}

    if not self.url or not self.api_key:
        return {"configured": False, "items": [], "summary": summary}

    async with httpx.AsyncClient(
        headers=self._headers(), timeout=30, follow_redirects=True
    ) as client:

        # Fetch contact points so we can cross-reference
        contact_points: list = []
        try:
            r = await client.get(f"{self.url}/api/v1/provisioning/contact-points")
            if r.status_code == 200:
                contact_points = r.json()
        except Exception as exc:
            logger.warning("Grafana contact-points fetch failed: %s", exc)

        cp_names = {cp.get("name", "") for cp in contact_points}

        # Fetch notification policy tree
        default_receiver = ""
        try:
            r = await client.get(f"{self.url}/api/v1/provisioning/policies")
            if r.status_code == 200:
                policy = r.json()
                default_receiver = policy.get("receiver", "")
        except Exception as exc:
            logger.warning("Grafana policies fetch failed: %s", exc)

        # Fetch all alert rules
        rules: list = []
        try:
            r = await client.get(f"{self.url}/api/v1/provisioning/alert-rules")
            if r.status_code == 200:
                rules = r.json()
            elif r.status_code == 404:
                # Older Grafana — try legacy endpoint
                r2 = await client.get(f"{self.url}/api/ruler/grafana/api/v1/rules")
                if r2.status_code == 200:
                    for ns_rules in r2.json().values():
                        for group in ns_rules:
                            rules.extend(group.get("rules", []))
        except Exception as exc:
            logger.warning("Grafana alert-rules fetch failed: %s", exc)

        for rule in rules:
            uid = rule.get("uid", rule.get("id", ""))
            title = rule.get("title", "Unnamed rule")
            is_paused = rule.get("isPaused", False)
            annotations = rule.get("annotations", {})
            labels = rule.get("labels", {})

            # Check: rule is paused/disabled
            if is_paused:
                items.append({
                    "name": title,
                    "uid": uid,
                    "health": "warning",
                    "issues_count": 1,
                    "issues": [{
                        "code": "RULE_PAUSED",
                        "severity": "warning",
                        "message": "Alert rule is paused and will not fire",
                    }],
                    "url": f"{self.url}/alerting/{uid}/edit" if uid else None,
                })
                continue

            issues = []

            # Check: no notification policy routing (no labels to match on)
            if not labels and not default_receiver:
                issues.append({
                    "code": "NO_ROUTING",
                    "severity": "critical",
                    "message": "Rule has no labels and no default notification policy receiver",
                })

            # Check: missing runbook annotation
            if not annotations.get("runbook_url") and not annotations.get("runbook"):
                issues.append({
                    "code": "NO_RUNBOOK",
                    "severity": "info",
                    "message": "No runbook URL annotation — responders have no documented response procedure",
                })

            # Check: missing summary/description
            if not annotations.get("summary") and not annotations.get("description"):
                issues.append({
                    "code": "NO_DESCRIPTION",
                    "severity": "info",
                    "message": "No summary or description annotation — alert messages will be cryptic",
                })

            health = "ok"
            if any(i["severity"] == "critical" for i in issues):
                health = "critical"
            elif any(i["severity"] == "warning" for i in issues):
                health = "warning"
            elif issues:
                health = "info"

            items.append({
                "name": title,
                "uid": uid,
                "health": health,
                "issues_count": len(issues),
                "issues": issues,
                "folder": rule.get("folderUID", ""),
                "url": f"{self.url}/alerting/{uid}/edit" if uid else None,
            })

    for item in items:
        summary["total"] += 1
        h = item["health"]
        summary[h] = summary.get(h, 0) + 1

    return {"configured": True, "items": items, "summary": summary}
