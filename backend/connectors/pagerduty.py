"""
PagerDuty connector — fetches incidents from the PagerDuty REST API v2.

Required env vars:
  PAGERDUTY_API_KEY    — REST API key (read-only token is sufficient)

Optional:
  PAGERDUTY_SERVICE_IDS — comma-separated service IDs to filter by
"""
import hashlib
import logging
from datetime import datetime
from typing import Optional

import httpx

logger = logging.getLogger("fusenix.pagerduty")


def _make_id(key: str) -> str:
    return hashlib.md5(f"pagerduty:{key}".encode()).hexdigest()


def _severity(urgency: str, status: str) -> str:
    if status == "resolved":
        return "success"
    if urgency == "high":
        return "critical"
    if urgency == "low":
        return "warning"
    return "info"


class PagerDutyConnector:
    BASE_URL = "https://api.pagerduty.com"

    def __init__(self, api_key: str, service_ids: Optional[list] = None):
        self.api_key = api_key
        self.service_ids = [s.strip() for s in (service_ids or []) if s.strip()]

    def _headers(self) -> dict:
        return {
            "Authorization": f"Token token={self.api_key}",
            "Accept": "application/vnd.pagerduty+json;version=2",
            "Content-Type": "application/json",
        }

    # ── Timeline fetch ────────────────────────────────────────────────────────

    async def fetch(self, start: datetime, end: datetime) -> list:
        from main import TimelineEvent  # local import avoids circular at module load

        events: list = []
        since = start.strftime("%Y-%m-%dT%H:%M:%SZ")
        until = end.strftime("%Y-%m-%dT%H:%M:%SZ")

        async with httpx.AsyncClient(headers=self._headers(), timeout=30) as client:
            offset = 0
            while True:
                params: dict = {
                    "since": since,
                    "until": until,
                    "time_zone": "UTC",
                    "offset": offset,
                    "limit": 100,
                    "sort_by": "created_at:desc",
                    "statuses[]": ["triggered", "acknowledged", "resolved"],
                    "include[]": ["services", "assignments", "escalation_policies"],
                }
                if self.service_ids:
                    params["service_ids[]"] = self.service_ids

                try:
                    r = await client.get(f"{self.BASE_URL}/incidents", params=params)
                    if r.status_code != 200:
                        logger.error("PagerDuty HTTP %d: %s", r.status_code, r.text[:200])
                        break

                    data = r.json()
                    for inc in data.get("incidents", []):
                        inc_id   = inc.get("id", "")
                        status   = inc.get("status", "triggered")
                        urgency  = inc.get("urgency", "high")
                        severity = _severity(urgency, status)

                        created_at = inc.get("created_at", "")
                        try:
                            ts = datetime.fromisoformat(created_at.replace("Z", "+00:00")).isoformat()
                        except Exception:
                            ts = start.isoformat()

                        service    = inc.get("service", {}).get("summary", "Unknown service")
                        title      = inc.get("title") or "PagerDuty incident"
                        assigned   = [
                            a.get("assignee", {}).get("summary", "")
                            for a in inc.get("assignments", [])
                        ]
                        escalation = inc.get("escalation_policy", {}).get("summary", "")

                        tags = ["incident", status, urgency]
                        if service:
                            tags.append(f"service:{service}")
                        if escalation:
                            tags.append(f"policy:{escalation}")

                        detail_parts = [f"Status: {status}", f"Service: {service}", f"Urgency: {urgency}"]
                        if assigned:
                            detail_parts.append(f"Assigned: {', '.join(filter(None, assigned))}")

                        events.append(TimelineEvent(
                            id=_make_id(inc_id),
                            source="pagerduty",
                            time=ts,
                            severity=severity,
                            title=f"[PD] {title}",
                            detail=" | ".join(detail_parts),
                            tags=tags,
                            url=inc.get("html_url"),
                            raw=inc,
                        ))

                    if not data.get("more", False):
                        break
                    offset += 100

                except Exception as exc:
                    logger.error("PagerDuty fetch error: %s", exc)
                    break

        logger.info("PagerDuty returned %d events", len(events))
        return events

    # ── Active incidents ──────────────────────────────────────────────────────

    async def get_active_incidents(self, service_ids: Optional[list] = None) -> list:
        """
        Fetch all currently triggered or acknowledged incidents.
        Returns a list of incident dicts ready for the frontend.
        """
        if not self.api_key:
            return []

        incidents: list = []
        params: dict = {
            "statuses[]": ["triggered", "acknowledged"],
            "limit": 100,
            "sort_by": "created_at:desc",
            "include[]": ["services", "assignments", "escalation_policies"],
        }
        ids = service_ids or self.service_ids
        if ids:
            params["service_ids[]"] = ids

        async with httpx.AsyncClient(headers=self._headers(), timeout=20) as client:
            offset = 0
            while True:
                params["offset"] = offset
                try:
                    r = await client.get(f"{self.BASE_URL}/incidents", params=params)
                    if r.status_code != 200:
                        logger.warning("PagerDuty active incidents HTTP %d", r.status_code)
                        break
                    data = r.json()
                    for inc in data.get("incidents", []):
                        incidents.append({
                            "id":                inc.get("id", ""),
                            "title":             inc.get("title", ""),
                            "status":            inc.get("status", ""),
                            "urgency":           inc.get("urgency", ""),
                            "url":               inc.get("html_url", ""),
                            "created_at":        inc.get("created_at", ""),
                            "service":           inc.get("service", {}).get("summary", ""),
                            "service_id":        inc.get("service", {}).get("id", ""),
                            "assigned_to":       [
                                a.get("assignee", {}).get("summary", "")
                                for a in inc.get("assignments", [])
                            ],
                            "escalation_policy": inc.get("escalation_policy", {}).get("summary", ""),
                        })
                    if not data.get("more", False):
                        break
                    offset += 100
                except Exception as exc:
                    logger.error("PagerDuty active incidents error: %s", exc)
                    break

        return incidents

    # ── On-call schedule ──────────────────────────────────────────────────────

    async def get_oncall(self) -> list:
        """
        Fetch who is currently on-call for each escalation policy / schedule.
        Returns a list of on-call assignment dicts.
        """
        if not self.api_key:
            return []

        oncall_list: list = []
        async with httpx.AsyncClient(headers=self._headers(), timeout=20) as client:
            params: dict = {
                "include[]": ["users", "escalation_policies", "schedules"],
                "limit": 100,
            }

            # Optionally restrict to escalation policies for our services
            if self.service_ids:
                try:
                    r = await client.get(
                        f"{self.BASE_URL}/services",
                        params={"ids[]": self.service_ids, "include[]": ["escalation_policies"]},
                    )
                    if r.status_code == 200:
                        eps = [
                            svc.get("escalation_policy", {}).get("id")
                            for svc in r.json().get("services", [])
                            if svc.get("escalation_policy", {}).get("id")
                        ]
                        if eps:
                            params["escalation_policy_ids[]"] = eps
                except Exception:
                    pass

            try:
                r = await client.get(f"{self.BASE_URL}/oncalls", params=params)
                if r.status_code != 200:
                    logger.warning("PagerDuty /oncalls HTTP %d: %s", r.status_code, r.text[:200])
                    return []

                for entry in r.json().get("oncalls", []):
                    user     = entry.get("user", {})
                    policy   = entry.get("escalation_policy", {})
                    schedule = entry.get("schedule") or {}
                    oncall_list.append({
                        "user_name":         user.get("name", ""),
                        "user_email":        user.get("email", ""),
                        "user_avatar":       user.get("avatar_url", ""),
                        "escalation_policy": policy.get("summary", ""),
                        "escalation_level":  entry.get("escalation_level", 1),
                        "schedule":          schedule.get("summary", ""),
                        "start":             entry.get("start", ""),
                        "end":               entry.get("end", ""),
                        "pd_url":            policy.get("html_url", ""),
                    })
            except Exception as exc:
                logger.error("PagerDuty oncall fetch error: %s", exc)

        return oncall_list

    # ── Configuration audit ───────────────────────────────────────────────────

    async def audit(self) -> dict:
        """
        Audit PagerDuty service configuration for common misconfigurations.
        """
        items: list = []
        summary = {"total": 0, "ok": 0, "warning": 0, "critical": 0, "info": 0}

        if not self.api_key:
            return {"configured": False, "items": [], "summary": summary}

        async with httpx.AsyncClient(headers=self._headers(), timeout=30) as client:

            # Fetch escalation policies
            ep_map: dict = {}
            try:
                offset = 0
                while True:
                    r = await client.get(
                        f"{self.BASE_URL}/escalation_policies",
                        params={"offset": offset, "limit": 100, "include[]": ["targets"]},
                    )
                    if r.status_code != 200:
                        break
                    data = r.json()
                    for ep in data.get("escalation_policies", []):
                        ep_map[ep["id"]] = ep
                    if not data.get("more", False):
                        break
                    offset += 100
            except Exception as exc:
                logger.warning("PagerDuty escalation_policies fetch failed: %s", exc)

            # Fetch all services
            try:
                offset = 0
                while True:
                    params: dict = {
                        "offset": offset,
                        "limit": 100,
                        "include[]": ["escalation_policies", "integrations"],
                    }
                    if self.service_ids:
                        params["ids[]"] = self.service_ids

                    r = await client.get(f"{self.BASE_URL}/services", params=params)
                    if r.status_code != 200:
                        logger.warning("PagerDuty services HTTP %d", r.status_code)
                        break

                    data = r.json()
                    for svc in data.get("services", []):
                        svc_id       = svc.get("id", "")
                        name         = svc.get("name", "Unnamed service")
                        status       = svc.get("status", "active")
                        ep           = svc.get("escalation_policy", {})
                        ep_id        = ep.get("id", "")
                        integrations = svc.get("integrations", [])

                        issues: list = []

                        if status == "disabled":
                            issues.append({"code": "SERVICE_DISABLED", "severity": "warning",
                                           "message": "Service is disabled — it will not create incidents"})

                        if not ep_id:
                            issues.append({"code": "NO_ESCALATION_POLICY", "severity": "critical",
                                           "message": "Service has no escalation policy — incidents will not be routed"})
                        else:
                            ep_detail = ep_map.get(ep_id, ep)
                            rules = ep_detail.get("escalation_rules", [])
                            if not rules:
                                issues.append({"code": "EMPTY_ESCALATION_POLICY", "severity": "critical",
                                               "message": f"Escalation policy '{ep.get('summary', ep_id)}' has no rules"})
                            elif all(not rule.get("targets") for rule in rules):
                                issues.append({"code": "NO_ONCALL_TARGETS", "severity": "critical",
                                               "message": "All escalation rules have empty target lists"})

                        if not integrations:
                            issues.append({"code": "NO_INTEGRATIONS", "severity": "warning",
                                           "message": "Service has no integrations — cannot receive alerts"})

                        health = "ok"
                        if any(i["severity"] == "critical" for i in issues):
                            health = "critical"
                        elif any(i["severity"] == "warning" for i in issues):
                            health = "warning"
                        elif issues:
                            health = "info"

                        items.append({
                            "name": name, "id": svc_id, "status": status, "health": health,
                            "issues_count": len(issues), "issues": issues,
                            "escalation_policy": ep.get("summary", ""),
                            "integrations_count": len(integrations),
                            "url": svc.get("html_url"),
                        })

                    if not data.get("more", False):
                        break
                    offset += 100

            except Exception as exc:
                logger.error("PagerDuty audit fetch error: %s", exc)

        for item in items:
            summary["total"] += 1
            summary[item["health"]] = summary.get(item["health"], 0) + 1

        return {"configured": True, "items": items, "summary": summary}
