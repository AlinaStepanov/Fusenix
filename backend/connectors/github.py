"""
GitHub connector — fetches per repo:
  1. Commits pushed in the time window (branches: main, master)
  2. Pull Requests merged in the window
  3. Deployments and their statuses
  4. Workflow runs (GitHub Actions) completed in the window

FIX: removed invalid 'created' date-range filter from workflow runs API call.
The GitHub Actions API does not support that param format; filtering is done
in Python after fetching the most recent 100 completed runs.
"""
import asyncio
import hashlib
import logging
from datetime import datetime
from typing import Optional

import httpx

logger = logging.getLogger("opsbridge.github")

GH_API       = "https://api.github.com"
HEADERS_BASE = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def _get_event_model():
    from main import TimelineEvent
    return TimelineEvent


class GitHubConnector:
    def __init__(self, token: Optional[str], repos: list[str]):
        self.repos   = [r.strip() for r in repos if r.strip()]
        self.headers = {**HEADERS_BASE}
        if token:
            self.headers["Authorization"] = f"Bearer {token}"

    # ── public ───────────────────────────────────────────────────────────────

    async def fetch(self, start: datetime, end: datetime) -> list:
        events = []
        async with httpx.AsyncClient(headers=self.headers, timeout=20) as client:
            tasks = [
                self._fetch_repo(client, *self._split_repo(repo), start, end)
                for repo in self.repos
                if self._split_repo(repo)[0]
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for repo, result in zip(self.repos, results):
                if isinstance(result, Exception):
                    logger.warning("GitHub repo %s failed: %s", repo, result)
                else:
                    events.extend(result)
        return events

    # ── per-repo ─────────────────────────────────────────────────────────────

    async def _fetch_repo(self, client, owner, name, start, end) -> list:
        results = await asyncio.gather(
            self._fetch_commits(client, owner, name, start, end),
            self._fetch_pull_requests(client, owner, name, start, end),
            self._fetch_deployments(client, owner, name, start, end),
            self._fetch_workflow_runs(client, owner, name, start, end),
            return_exceptions=True,
        )
        events = []
        for fetch_name, r in zip(("commits", "pull_requests", "deployments", "workflow_runs"), results):
            if isinstance(r, list):
                events.extend(r)
            elif isinstance(r, Exception):
                logger.warning("GitHub %s/%s %s failed: %s", owner, name, fetch_name, r)
        return events

    # ── commits ───────────────────────────────────────────────────────────────

    async def _fetch_commits(self, client, owner, name, start, end) -> list:
        TimelineEvent = _get_event_model()
        events = []
        for branch in ("main", "master"):
            try:
                resp = await client.get(
                    f"{GH_API}/repos/{owner}/{name}/commits",
                    params={
                        "sha": branch,
                        "since": start.isoformat(),
                        "until": end.isoformat(),
                        "per_page": 100,
                    }
                )
                if resp.status_code == 422:
                    continue   # branch does not exist
                if resp.status_code == 404:
                    logger.warning("Repo %s/%s not found", owner, name)
                    break
                resp.raise_for_status()

                for c in resp.json():
                    commit     = c.get("commit", {})
                    author     = commit.get("author", {})
                    msg        = commit.get("message", "")
                    first_line = msg.split("\n")[0][:120]
                    ts         = author.get("date", "")

                    msg_lower = msg.lower()
                    sev = (
                        "critical" if any(kw in msg_lower for kw in ("critical", "hotfix"))
                        else "warning" if any(kw in msg_lower for kw in ("fix:", "revert", "rollback"))
                        else "info"
                    )

                    events.append(TimelineEvent(
                        id=self._uid("gh_commit", c["sha"]),
                        source="github",
                        time=self._norm_ts(ts),
                        severity=sev,
                        title=f"Commit -> {owner}/{name}:{branch} — {first_line}",
                        detail=(
                            f"SHA: {c['sha'][:8]} | "
                            f"Author: {author.get('name', 'unknown')} | "
                            f"Branch: {branch}"
                        ),
                        tags=self._commit_tags(msg, branch),
                        url=c.get("html_url"),
                        raw={"sha": c["sha"], "branch": branch, "type": "commit"},
                    ))
                break   # found the default branch; do not try master
            except httpx.HTTPStatusError as e:
                logger.debug("Commit fetch %s/%s branch=%s: %s", owner, name, branch, e)
                continue
        return events

    def _commit_tags(self, msg: str, branch: str) -> list[str]:
        tags      = ["github", "commit", branch]
        msg_lower = msg.lower()
        for kw in ("feat", "fix", "hotfix", "revert", "chore", "refactor", "deps", "security", "breaking"):
            if kw in msg_lower:
                tags.append(kw)
        return tags

    # ── pull requests ─────────────────────────────────────────────────────────

    async def _fetch_pull_requests(self, client, owner, name, start, end) -> list:
        TimelineEvent = _get_event_model()
        events = []
        resp   = await client.get(
            f"{GH_API}/repos/{owner}/{name}/pulls",
            params={"state": "closed", "sort": "updated", "direction": "desc", "per_page": 100}
        )
        resp.raise_for_status()

        for pr in resp.json():
            merged_at = pr.get("merged_at")
            if not merged_at:
                continue
            merged_dt = datetime.fromisoformat(merged_at.replace("Z", "+00:00"))
            if not (start <= merged_dt <= end):
                continue

            title  = pr.get("title", "")
            author = pr.get("user", {}).get("login", "unknown")
            t_low  = title.lower()
            sev    = (
                "critical" if any(kw in t_low for kw in ("critical", "hotfix"))
                else "warning" if any(kw in t_low for kw in ("revert", "rollback", "fix"))
                else "info"
            )
            labels = [lb["name"] for lb in pr.get("labels", [])]

            events.append(TimelineEvent(
                id=self._uid("gh_pr", str(pr["number"])),
                source="github",
                time=merged_at,
                severity=sev,
                title=f"PR #{pr['number']} merged -> {owner}/{name}: {title[:80]}",
                detail=(
                    f"Author: @{author} | "
                    f"Base: {pr.get('base', {}).get('ref', 'main')} | "
                    f"Changed files: {pr.get('changed_files', '?')} | "
                    f"+{pr.get('additions', 0)} -{pr.get('deletions', 0)}"
                ),
                tags=["github", "pr", "merge"] + labels,
                url=pr.get("html_url"),
                raw={"pr_number": pr["number"], "type": "pull_request"},
            ))
        return events

    # ── deployments ──────────────────────────────────────────────────────────

    async def _fetch_deployments(self, client, owner, name, start, end) -> list:
        TimelineEvent = _get_event_model()
        events = []
        resp   = await client.get(
            f"{GH_API}/repos/{owner}/{name}/deployments",
            params={"per_page": 100}
        )
        resp.raise_for_status()

        for dep in resp.json():
            created_at = dep.get("created_at", "")
            dep_dt     = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            if not (start <= dep_dt <= end):
                continue

            env     = dep.get("environment", "unknown")
            ref     = dep.get("ref", "")
            creator = dep.get("creator", {}).get("login", "unknown")

            status_resp = await client.get(
                f"{GH_API}/repos/{owner}/{name}/deployments/{dep['id']}/statuses",
                params={"per_page": 1}
            )
            statuses = status_resp.json() if status_resp.status_code == 200 else []
            state    = statuses[0]["state"] if statuses else "pending"

            sev_map = {
                "success": "success", "failure": "critical", "error": "critical",
                "inactive": "info",   "pending": "info",     "in_progress": "info",
                "queued":   "info",
            }
            sev = sev_map.get(state, "info")

            events.append(TimelineEvent(
                id=self._uid("gh_deploy", str(dep["id"])),
                source="github",
                time=created_at,
                severity=sev,
                title=f"Deploy -> {env}: {ref[:40]} [{state.upper()}]",
                detail=f"Env: {env} | Ref: {ref} | By: @{creator} | Status: {state}",
                tags=["github", "deployment", env.lower(), state],
                url=f"https://github.com/{owner}/{name}/deployments",
                raw={"deployment_id": dep["id"], "environment": env, "type": "deployment"},
            ))
        return events

    # ── workflow runs ─────────────────────────────────────────────────────────

    async def _fetch_workflow_runs(self, client, owner, name, start, end) -> list:
        """
        FIX: removed invalid 'created' query param.
        GitHub Actions API does not support date-range filtering via that param;
        we fetch the 100 most recent completed runs and filter by updated_at in Python.
        """
        TimelineEvent = _get_event_model()
        events = []
        resp   = await client.get(
            f"{GH_API}/repos/{owner}/{name}/actions/runs",
            params={"status": "completed", "per_page": 100}
        )
        if resp.status_code != 200:
            logger.debug("Workflow runs %s/%s: HTTP %d", owner, name, resp.status_code)
            return []

        for run in resp.json().get("workflow_runs", []):
            updated_at = run.get("updated_at", "")
            if not updated_at:
                continue
            run_dt = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
            if not (start <= run_dt <= end):
                continue

            conclusion    = run.get("conclusion", "unknown") or "unknown"
            workflow_name = run.get("name", "unknown")
            branch        = run.get("head_branch", "")
            actor         = run.get("actor", {}).get("login", "unknown")

            duration_s = None
            if run.get("created_at") and run.get("updated_at"):
                s          = datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
                e          = datetime.fromisoformat(run["updated_at"].replace("Z", "+00:00"))
                duration_s = int((e - s).total_seconds())

            sev_map = {
                "success":         "success",
                "failure":         "critical",
                "cancelled":       "warning",
                "skipped":         "info",
                "timed_out":       "critical",
                "action_required": "warning",
                "startup_failure": "critical",
            }
            sev          = sev_map.get(conclusion, "info")
            duration_str = f" | Duration: {duration_s}s" if duration_s else ""

            events.append(TimelineEvent(
                id=self._uid("gh_run", str(run["id"])),
                source="github",
                time=updated_at,
                severity=sev,
                title=f"CI: {workflow_name} [{conclusion.upper()}] on {branch}",
                detail=(
                    f"Workflow: {workflow_name} | Branch: {branch} | "
                    f"Actor: @{actor} | Run #{run['run_number']}{duration_str}"
                ),
                tags=["github", "actions", "cicd", conclusion, branch],
                url=run.get("html_url"),
                raw={"run_id": run["id"], "workflow": workflow_name, "type": "workflow_run"},
            ))
        return events

    # ── helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _split_repo(repo: str) -> tuple[str, str]:
        parts = repo.strip().split("/")
        if len(parts) == 2:
            return parts[0], parts[1]
        return "", ""

    @staticmethod
    def _norm_ts(ts: str) -> str:
        return ts.replace("Z", "+00:00") if ts.endswith("Z") else ts

    @staticmethod
    def _uid(*parts: str) -> str:
        return "gh_" + hashlib.md5("|".join(parts).encode()).hexdigest()[:12]
