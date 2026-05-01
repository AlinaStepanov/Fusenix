"""
Unit tests for CloudWatchConnector helper methods.

These tests exercise pure parsing logic — no boto3 calls, no AWS credentials.
The connector is instantiated with __new__ to skip __init__ (which creates
the boto3 clients we don't need here).
"""
import pytest
from datetime import datetime, timezone

from connectors.cloudwatch import CloudWatchConnector


@pytest.fixture
def cw():
    """Bare CloudWatchConnector instance — no boto3, no AWS calls."""
    connector = CloudWatchConnector.__new__(CloudWatchConnector)
    connector.region = "us-east-1"
    connector.log_groups = []
    connector.alarm_prefix = ""
    return connector


class TestParseCwTs:
    """_parse_cw_ts converts CloudWatch Insights timestamps to UTC ISO strings."""

    def test_standard_format(self, cw):
        result = cw._parse_cw_ts("2026-04-25 14:31:04.000")
        assert result == "2026-04-25T14:31:04+00:00"

    def test_without_milliseconds(self, cw):
        result = cw._parse_cw_ts("2026-04-25 09:00:00")
        assert result == "2026-04-25T09:00:00+00:00"

    def test_result_is_always_utc(self, cw):
        result = cw._parse_cw_ts("2026-01-01 00:00:00.000")
        dt = datetime.fromisoformat(result)
        assert dt.tzinfo == timezone.utc

    def test_invalid_input_falls_back_gracefully(self, cw):
        """Garbage input must not raise — falls back to current UTC time."""
        result = cw._parse_cw_ts("not-a-timestamp")
        dt = datetime.fromisoformat(result)
        assert dt.tzinfo is not None  # must still be timezone-aware

    def test_empty_string_falls_back_gracefully(self, cw):
        result = cw._parse_cw_ts("")
        dt = datetime.fromisoformat(result)
        assert dt.tzinfo is not None


class TestAlarmSeverity:
    """_alarm_severity reads HistorySummary to classify severity."""

    def test_alarm_state_is_critical(self, cw):
        item = {"HistorySummary": "Alarm updated from OK to ALARM"}
        assert cw._alarm_severity(item) == "critical"

    def test_ok_state_is_info(self, cw):
        item = {"HistorySummary": "Alarm updated from ALARM to OK"}
        # "alarm" appears but so does "ok" → not critical → info
        assert cw._alarm_severity(item) == "info"

    def test_insufficient_data_is_warning(self, cw):
        item = {"HistorySummary": "Alarm updated from OK to INSUFFICIENT_DATA"}
        assert cw._alarm_severity(item) == "warning"

    def test_missing_history_summary_returns_info(self, cw):
        assert cw._alarm_severity({}) == "info"


class TestAlarmTitle:
    """_alarm_title extracts alarm name and new state from HistorySummary."""

    def test_extracts_alarm_name(self, cw):
        item = {
            "AlarmName": "api-5xx-rate",
            "HistorySummary": "Alarm updated from OK to ALARM",
        }
        title = cw._alarm_title(item)
        assert "api-5xx-rate" in title

    def test_extracts_new_state(self, cw):
        item = {
            "AlarmName": "cpu-high",
            "HistorySummary": "Alarm updated from OK to ALARM",
        }
        title = cw._alarm_title(item)
        assert "ALARM" in title

    def test_missing_summary_falls_back(self, cw):
        item = {"AlarmName": "my-alarm", "HistorySummary": ""}
        title = cw._alarm_title(item)
        assert "my-alarm" in title
        assert title  # must not be empty
