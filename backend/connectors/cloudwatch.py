"""
CloudWatch connector — fetches:
  1. Alarms that changed state in the time window
  2. Log Insights query across configured log groups (errors / exceptions)
  3. Key metric anomalies (5xx, CPU, RDS latency, Lambda errors) via GetMetricStatistics

NOTE: boto3 is synchronous. All blocking calls are wrapped in asyncio.to_thread()
so they don't block the FastAPI event loop.
"""
import asyncio
import hashlib
import logging
import re
import time
from datetime import datetime, timezone
from typing import Optional

import boto3
from botocore.config import Config

logger = logging.getLogger("opsbridge.cloudwatch")


def _get_event_model():
    from main import TimelineEvent
    return TimelineEvent


class CloudWatchConnector:
    def __init__(
        self,
        region: str,
        access_key: Optional[str],
        secret_key: Optional[str],
        log_groups: list[str],
        alarm_prefix: str = "",
    ):
        self.region = region
        self.log_groups = [g.strip() for g in log_groups if g.strip()]
        self.alarm_prefix = alarm_prefix

        session_kwargs: dict = {"region_name": region}
        if access_key and secret_key:
            session_kwargs["aws_access_key_id"] = access_key
            session_kwargs["aws_secret_access_key"] = secret_key

        cfg = Config(retries={"max_attempts": 3, "mode": "standard"})
        session = boto3.Session(**session_kwargs)
        self._cw   = session.client("cloudwatch", config=cfg)
        self._logs = session.client("logs",        config=cfg)

    # ── public ───────────────────────────────────────────────────────────────

    async def fetch(self, start: datetime, end: datetime) -> list:
        """Fetch all event types concurrently, each in its own thread."""
        results = await asyncio.gather(
            asyncio.to_thread(self._fetch_alarms, start, end),
            asyncio.to_thread(self._fetch_log_errors, start, end),
            asyncio.to_thread(self._fetch_metric_anomalies, start, end),
            return_exceptions=True,
        )
        events = []
        for name, r in zip(("alarms", "log_errors", "metric_anomalies"), results):
            if isinstance(r, Exception):
                logger.warning("CloudWatch %s fetch failed: %s", name, r)
            else:
                logger.debug("CloudWatch %s: %d events", name, len(r))
                events.extend(r)
        return events

    # ── alarms ───────────────────────────────────────────────────────────────

    def _fetch_alarms(self, start: datetime, end: datetime) -> list:
        TimelineEvent = _get_event_model()
        events = []
        try:
            # AlarmNamePrefix is only valid on describe_alarms, NOT describe_alarm_history.
            # When a prefix is configured, first resolve matching alarm names, then fetch
            # history per alarm. Without a prefix, fetch all history in one paginated call.
            if self.alarm_prefix:
                alarm_names = self._resolve_alarm_names(self.alarm_prefix)
                logger.debug("Resolved %d alarms for prefix %r", len(alarm_names), self.alarm_prefix)
                items = []
                for name in alarm_names:
                    paginator = self._cw.get_paginator("describe_alarm_history")
                    for page in paginator.paginate(
                        AlarmName=name,
                        HistoryItemType="StateUpdate",
                        StartDate=start,
                        EndDate=end,
                        ScanBy="TimestampAscending",
                    ):
                        items.extend(page.get("AlarmHistoryItems", []))
            else:
                paginator = self._cw.get_paginator("describe_alarm_history")
                items = []
                for page in paginator.paginate(
                    HistoryItemType="StateUpdate",
                    StartDate=start,
                    EndDate=end,
                    ScanBy="TimestampAscending",
                ):
                    items.extend(page.get("AlarmHistoryItems", []))

            for item in items:
                sev    = self._alarm_severity(item)
                title  = self._alarm_title(item)
                detail = item.get("HistorySummary", "")

                events.append(TimelineEvent(
                    id=self._uid("cw_alarm", item["AlarmName"], str(item["Timestamp"])),
                    source="cloudwatch",
                    time=item["Timestamp"].isoformat(),
                    severity=sev,
                    title=title,
                    detail=detail,
                    tags=self._alarm_tags(item),
                    url=(
                        f"https://{self.region}.console.aws.amazon.com/cloudwatch/home"
                        f"?region={self.region}#alarmsV2:alarm/{item['AlarmName']}"
                    ),
                    raw={"alarm_name": item["AlarmName"], "type": "alarm_history"},
                ))
        except Exception as e:
            logger.error("Failed to fetch CloudWatch alarms: %s", e)
            raise
        return events


    def _resolve_alarm_names(self, prefix: str) -> list[str]:
        """Return alarm names matching any of the comma-separated prefixes."""
        names: list[str] = []
        prefixes = [p.strip() for p in prefix.split(",") if p.strip()]
        for pfx in prefixes:
            paginator = self._cw.get_paginator("describe_alarms")
            for page in paginator.paginate(AlarmNamePrefix=pfx, AlarmTypes=["MetricAlarm", "CompositeAlarm"]):
                names.extend(a["AlarmName"] for a in page.get("MetricAlarms", []))
                names.extend(a["AlarmName"] for a in page.get("CompositeAlarms", []))
        return names

    def _alarm_severity(self, item: dict) -> str:
        summary = item.get("HistorySummary", "").lower()
        if "alarm" in summary and "ok" not in summary:
            return "critical"
        if "insufficient" in summary:
            return "warning"
        return "info"

    def _alarm_title(self, item: dict) -> str:
        name    = item["AlarmName"]
        summary = item.get("HistorySummary", "")
        match   = re.search(r"to (\w+)", summary)
        state   = match.group(1) if match else "state changed"
        return f"Alarm {repr(name)}: -> {state.upper()}"

    def _alarm_tags(self, item: dict) -> list[str]:
        tags = ["cloudwatch", "alarm"]
        name = item["AlarmName"].lower()
        for kw in ("cpu", "5xx", "4xx", "latency", "error", "memory", "disk", "rds", "elb", "lambda"):
            if kw in name:
                tags.append(kw)
        return tags

    # ── log errors ───────────────────────────────────────────────────────────

    def _fetch_log_errors(self, start: datetime, end: datetime) -> list:
        if not self.log_groups:
            return []

        TimelineEvent = _get_event_model()
        events    = []
        start_ms  = int(start.timestamp() * 1000)
        end_ms    = int(end.timestamp()   * 1000)

        query = (
            "fields @timestamp, @message, @logStream\n"
            "| filter @message like /(?i)(error|exception|fatal|critical|traceback)/\n"
            "| sort @timestamp asc\n"
            "| limit 200"
        )

        try:
            resp     = self._logs.start_query(
                logGroupNames=self.log_groups,
                startTime=start_ms,
                endTime=end_ms,
                queryString=query,
            )
            query_id = resp["queryId"]
            result   = None

            for _ in range(30):   # poll up to 30 s (runs in thread — time.sleep is fine here)
                time.sleep(1)
                result = self._logs.get_query_results(queryId=query_id)
                if result["status"] in ("Complete", "Failed", "Cancelled"):
                    break

            if not result or result["status"] != "Complete":
                logger.warning(
                    "CloudWatch Logs Insights query did not complete (status=%s)",
                    result["status"] if result else "unknown",
                )
                return []

            for row in result.get("results", []):
                fields = {f["field"]: f["value"] for f in row}
                ts     = fields.get("@timestamp", "")
                msg    = fields.get("@message", "")[:400]
                stream = fields.get("@logStream", "unknown")

                sev     = "critical" if re.search(r"(?i)(fatal|critical|exception)", msg) else "warning"
                snippet = msg[:120].replace("\n", " ")

                events.append(TimelineEvent(
                    id=self._uid("cw_log", ts, msg[:40]),
                    source="cloudwatch",
                    time=self._parse_cw_ts(ts),
                    severity=sev,
                    title=f"Log error [{stream}]: {snippet}",
                    detail=msg,
                    tags=["cloudwatch", "logs", "error"],
                    raw={"log_stream": stream, "type": "log_error"},
                ))
        except Exception as e:
            logger.error("Failed to fetch CloudWatch log errors: %s", e)
            raise

        return events

    def _parse_cw_ts(self, ts: str) -> str:
        """CloudWatch Insights returns '2024-01-15 14:30:00.000'"""
        try:
            dt = datetime.strptime(ts[:19], "%Y-%m-%d %H:%M:%S")
            return dt.replace(tzinfo=timezone.utc).isoformat()
        except Exception:
            return datetime.now(tz=timezone.utc).isoformat()

    # ── metric anomalies ─────────────────────────────────────────────────────

    def _fetch_metric_anomalies(self, start: datetime, end: datetime) -> list:
        TimelineEvent = _get_event_model()
        metrics = [
            {
                "id": "elb_5xx",
                "label": "ELB 5xx count",
                "namespace": "AWS/ApplicationELB",
                "metric": "HTTPCode_Target_5XX_Count",
                "stat": "Sum",
                "threshold": 10,
                "unit": " errors",
                "tags": ["elb", "5xx"],
            },
            {
                "id": "ec2_cpu",
                "label": "EC2 CPU utilization",
                "namespace": "AWS/EC2",
                "metric": "CPUUtilization",
                "stat": "Average",
                "threshold": 80,
                "unit": "%",
                "tags": ["ec2", "cpu"],
            },
            {
                "id": "rds_latency",
                "label": "RDS read latency",
                "namespace": "AWS/RDS",
                "metric": "ReadLatency",
                "stat": "Average",
                "threshold": 0.1,
                "unit": "s",
                "tags": ["rds", "latency"],
            },
            {
                "id": "lambda_errors",
                "label": "Lambda errors",
                "namespace": "AWS/Lambda",
                "metric": "Errors",
                "stat": "Sum",
                "threshold": 5,
                "unit": " errors",
                "tags": ["lambda", "error"],
            },
        ]

        events = []
        for m in metrics:
            try:
                resp       = self._cw.get_metric_statistics(
                    Namespace=m["namespace"],
                    MetricName=m["metric"],
                    StartTime=start,
                    EndTime=end,
                    Period=60,
                    Statistics=[m["stat"]],
                )
                datapoints = sorted(resp.get("Datapoints", []), key=lambda d: d["Timestamp"])

                for dp in datapoints:
                    val = dp.get(m["stat"], 0)
                    if val > m["threshold"]:
                        sev = "critical" if val > m["threshold"] * 2 else "warning"
                        events.append(TimelineEvent(
                            id=self._uid("cw_metric", m["id"], str(dp["Timestamp"])),
                            source="cloudwatch",
                            time=dp["Timestamp"].isoformat(),
                            severity=sev,
                            title=(
                                f"{m['label']} spike: {val:.2f}{m['unit']} "
                                f"(threshold {m['threshold']}{m['unit']})"
                            ),
                            detail=(
                                f"Namespace: {m['namespace']} | Metric: {m['metric']} | "
                                f"Stat: {m['stat']} | Period: 1m | Value: {val:.4f}"
                            ),
                            tags=["cloudwatch", "metric"] + m["tags"],
                            url=(
                                f"https://{self.region}.console.aws.amazon.com/cloudwatch/home"
                                f"?region={self.region}#metricsV2:namespace={m['namespace']}"
                            ),
                            raw={"metric": m["metric"], "value": val, "type": "metric_anomaly"},
                        ))
            except Exception as e:
                # Metric may not exist in this account — log at debug level only
                logger.debug("Metric %s/%s not available: %s", m["namespace"], m["metric"], e)

        return events

    # ── helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _uid(*parts: str) -> str:
        return "cw_" + hashlib.md5("|".join(parts).encode()).hexdigest()[:12]

    # ── alarm audit ──────────────────────────────────────────────────────────

    async def audit_alarms(self) -> list[dict]:
        """
        Return full configuration for all alarms matching the configured prefix,
        plus a list of flagged issues for each alarm.
        """
        return await asyncio.to_thread(self._describe_alarms_config)

    def _describe_alarms_config(self) -> list[dict]:
        audited: list[dict] = []

        try:
            paginator = self._cw.get_paginator("describe_alarms")
            page_kwargs: dict = {"AlarmTypes": ["MetricAlarm", "CompositeAlarm"]}
            if self.alarm_prefix:
                # Support comma-separated prefixes — iterate each
                prefixes = [p.strip() for p in self.alarm_prefix.split(",") if p.strip()]
            else:
                prefixes = [""]  # empty string = no prefix filter

            seen: set[str] = set()
            metric_alarms: list[dict] = []
            composite_alarms: list[dict] = []

            for pfx in prefixes:
                kw = dict(page_kwargs)
                if pfx:
                    kw["AlarmNamePrefix"] = pfx
                for page in paginator.paginate(**kw):
                    for a in page.get("MetricAlarms", []):
                        if a["AlarmName"] not in seen:
                            seen.add(a["AlarmName"])
                            metric_alarms.append(a)
                    for a in page.get("CompositeAlarms", []):
                        if a["AlarmName"] not in seen:
                            seen.add(a["AlarmName"])
                            composite_alarms.append(a)

            for alarm in metric_alarms:
                audited.append(self._audit_metric_alarm(alarm))

            for alarm in composite_alarms:
                audited.append(self._audit_composite_alarm(alarm))

        except Exception as e:
            logger.error("Failed to audit CloudWatch alarms: %s", e)
            raise

        # Sort: issues first, then by name
        audited.sort(key=lambda a: (len(a["issues"]) == 0, a["name"]))
        return audited

    def _audit_metric_alarm(self, a: dict) -> dict:
        issues: list[dict] = []

        # 1. No alarm actions (fires silently)
        if not a.get("AlarmActions"):
            issues.append({
                "severity": "critical",
                "code": "NO_ALARM_ACTION",
                "message": "No notification action configured — alarm fires silently.",
            })

        # 2. No OK actions (never notified when it recovers)
        if not a.get("OKActions"):
            issues.append({
                "severity": "warning",
                "code": "NO_OK_ACTION",
                "message": "No OK action — recovery is never notified.",
            })

        # 3. INSUFFICIENT_DATA state
        if a.get("StateValue") == "INSUFFICIENT_DATA":
            issues.append({
                "severity": "warning",
                "code": "INSUFFICIENT_DATA",
                "message": "Alarm is in INSUFFICIENT_DATA — metric may not be reporting.",
            })

        # 4. Treat missing data as 'missing' (default) vs 'breaching'
        treat_missing = a.get("TreatMissingData", "missing")
        if treat_missing == "missing":
            issues.append({
                "severity": "info",
                "code": "MISSING_DATA_IGNORED",
                "message": (
                    "TreatMissingData=missing: gaps in metric data won't trigger the alarm. "
                    "Consider 'breaching' if missing data indicates a problem."
                ),
            })

        # 5. Very short evaluation period (< 2 periods) — noisy
        eval_periods = a.get("EvaluationPeriods", 1)
        period       = a.get("Period", 60)
        if eval_periods == 1 and period <= 60:
            issues.append({
                "severity": "info",
                "code": "SINGLE_PERIOD_EVAL",
                "message": (
                    f"Evaluates only 1 period of {period}s — may produce noisy alerts. "
                    "Consider EvaluationPeriods ≥ 2."
                ),
            })

        # 6. Alarm has been in ALARM state for a long time
        state_updated = a.get("StateUpdatedTimestamp")
        if a.get("StateValue") == "ALARM" and state_updated:
            try:
                age_hours = (
                    datetime.now(tz=timezone.utc) - state_updated
                ).total_seconds() / 3600
                if age_hours > 24:
                    issues.append({
                        "severity": "warning",
                        "code": "STUCK_IN_ALARM",
                        "message": f"Alarm has been ALARM for {age_hours:.0f}h — may be stale or misconfigured.",
                    })
            except Exception:
                pass

        return {
            "name": a["AlarmName"],
            "type": "metric",
            "state": a.get("StateValue", "UNKNOWN"),
            "description": a.get("AlarmDescription", ""),
            "metric": {
                "namespace": a.get("Namespace", ""),
                "name": a.get("MetricName", ""),
                "dimensions": [
                    {"name": d["Name"], "value": d["Value"]}
                    for d in a.get("Dimensions", [])
                ],
                "statistic": a.get("Statistic") or a.get("ExtendedStatistic", ""),
                "period_seconds": a.get("Period"),
                "evaluation_periods": a.get("EvaluationPeriods"),
                "datapoints_to_alarm": a.get("DatapointsToAlarm"),
                "threshold": a.get("Threshold"),
                "comparison_operator": a.get("ComparisonOperator", ""),
                "treat_missing_data": a.get("TreatMissingData", "missing"),
                "unit": a.get("Unit", ""),
            },
            "actions": {
                "alarm": a.get("AlarmActions", []),
                "ok": a.get("OKActions", []),
                "insufficient_data": a.get("InsufficientDataActions", []),
            },
            "state_updated": state_updated.isoformat() if state_updated else None,
            "url": (
                f"https://{self.region}.console.aws.amazon.com/cloudwatch/home"
                f"?region={self.region}#alarmsV2:alarm/{a['AlarmName']}"
            ),
            "issues": issues,
            "issues_count": len(issues),
            "health": (
                "critical" if any(i["severity"] == "critical" for i in issues)
                else "warning" if any(i["severity"] == "warning" for i in issues)
                else "info" if issues
                else "ok"
            ),
        }

    def _audit_composite_alarm(self, a: dict) -> dict:
        issues: list[dict] = []

        if not a.get("AlarmActions"):
            issues.append({
                "severity": "critical",
                "code": "NO_ALARM_ACTION",
                "message": "Composite alarm has no notification action — fires silently.",
            })

        if a.get("StateValue") == "INSUFFICIENT_DATA":
            issues.append({
                "severity": "warning",
                "code": "INSUFFICIENT_DATA",
                "message": "Composite alarm is in INSUFFICIENT_DATA.",
            })

        return {
            "name": a["AlarmName"],
            "type": "composite",
            "state": a.get("StateValue", "UNKNOWN"),
            "description": a.get("AlarmDescription", ""),
            "rule": a.get("AlarmRule", ""),
            "actions": {
                "alarm": a.get("AlarmActions", []),
                "ok": a.get("OKActions", []),
                "insufficient_data": a.get("InsufficientDataActions", []),
            },
            "state_updated": (
                a["StateUpdatedTimestamp"].isoformat()
                if a.get("StateUpdatedTimestamp") else None
            ),
            "url": (
                f"https://{self.region}.console.aws.amazon.com/cloudwatch/home"
                f"?region={self.region}#alarmsV2:alarm/{a['AlarmName']}"
            ),
            "issues": issues,
            "issues_count": len(issues),
            "health": (
                "critical" if any(i["severity"] == "critical" for i in issues)
                else "warning" if any(i["severity"] == "warning" for i in issues)
                else "ok"
            ),
        }
