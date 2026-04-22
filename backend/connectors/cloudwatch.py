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
