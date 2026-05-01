"""
Route-level tests for the Fusenix API.

Covers:
  - /health          — smoke test
  - /timeline        — input validation
  - /analyze         — input validation (unit) + full round-trip (integration)
"""
import json
from unittest.mock import patch


from tests.helpers import FakeAIProvider


# ── /health ───────────────────────────────────────────────────────────────────

class TestHealth:
    def test_returns_200(self, client):
        assert client.get("/health").status_code == 200

    def test_body_has_required_keys(self, client):
        body = client.get("/health").json()
        assert body["status"] == "ok"
        assert "time" in body
        assert "ai_provider" in body

    def test_time_is_valid_iso(self, client):
        from datetime import datetime
        ts = client.get("/health").json()["time"]
        dt = datetime.fromisoformat(ts)   # raises if malformed
        assert dt.tzinfo is not None      # must be timezone-aware (not naive)


# ── /timeline ─────────────────────────────────────────────────────────────────

class TestTimeline:
    def test_missing_start_returns_422(self, client):
        assert client.get("/timeline?end=2026-04-25T15:00:00Z").status_code == 422

    def test_missing_end_returns_422(self, client):
        assert client.get("/timeline?start=2026-04-25T14:00:00Z").status_code == 422

    def test_invalid_time_format_returns_400(self, client):
        resp = client.get("/timeline?start=not-a-date&end=also-not-a-date")
        assert resp.status_code == 400
        assert "Invalid time format" in resp.json()["detail"]

    def test_valid_range_returns_timeline_shape(self, client):
        resp = client.get(
            "/timeline"
            "?start=2026-04-25T14:00:00Z"
            "&end=2026-04-25T15:00:00Z"
            "&sources=github"   # limit to one source so no AWS creds needed
        )
        # Even with no credentials the endpoint must succeed and return the shape
        assert resp.status_code == 200
        body = resp.json()
        assert "events" in body
        assert "errors" in body
        assert "meta" in body


# ── /analyze — input validation (unit tests) ──────────────────────────────────

class TestAnalyzeValidation:
    def test_empty_events_returns_400(self, client):
        resp = client.post("/analyze", json={"events": []})
        assert resp.status_code == 400
        assert "No events" in resp.json()["detail"]

    def test_over_500_events_returns_400(self, client):
        event = {
            "id": "x", "source": "github", "time": "2026-04-25T14:00:00Z",
            "severity": "info", "title": "t", "detail": "d", "tags": [],
        }
        resp = client.post("/analyze", json={"events": [event] * 501})
        assert resp.status_code == 400
        assert "500" in resp.json()["detail"]

    def test_unknown_field_rejected_by_pydantic(self, client, sample_events):
        # AnalyzeRequest has extra="forbid"
        resp = client.post("/analyze", json={"events": sample_events, "injected": True})
        assert resp.status_code == 422

    def test_missing_events_field_returns_422(self, client):
        assert client.post("/analyze", json={}).status_code == 422

    def test_event_missing_required_field_returns_422(self, client):
        # TimelineEvent requires `source` — omit it
        bad_event = {
            "id": "x", "time": "2026-04-25T14:00:00Z",
            "severity": "info", "title": "t", "detail": "d", "tags": [],
        }
        resp = client.post("/analyze", json={"events": [bad_event]})
        assert resp.status_code == 422


# ── /analyze — integration test ───────────────────────────────────────────────

class TestAnalyzeIntegration:
    def test_returns_structured_analysis(self, client, sample_events, fake_analysis):
        """
        Full round-trip: POST /analyze → AI stub → structured JSON response.

        The AI provider is replaced with FakeAIProvider so the test is
        self-contained (no API key, no network call).  What we're testing:
          - The endpoint accepts valid events
          - It calls the provider and parses the JSON it returns
          - The response shape matches the documented contract
        """
        stub = FakeAIProvider(json.dumps(fake_analysis))

        with patch("main.get_ai_provider", return_value=stub):
            resp = client.post("/analyze", json={"events": sample_events})

        assert resp.status_code == 200
        body = resp.json()

        # Top-level shape
        assert body["provider"] == "fake"
        assert "analysis" in body

        analysis = body["analysis"]

        # All required keys present
        required = (
            "root_cause", "timeline_summary", "contributing_factors",
            "key_insight", "next_steps", "risk_score",
        )
        for key in required:
            assert key in analysis, f"Missing key in analysis: {key}"

        # Type contracts
        assert isinstance(analysis["root_cause"], str) and analysis["root_cause"]
        assert isinstance(analysis["contributing_factors"], list)
        assert isinstance(analysis["next_steps"], list)
        assert isinstance(analysis["risk_score"], int)

        # Risk score must be in valid range
        assert 1 <= analysis["risk_score"] <= 10

    def test_malformed_ai_response_returns_502(self, client, sample_events):
        """
        If the AI returns prose instead of JSON, the endpoint must return 502
        (bad gateway) — not 500 (unhandled crash).
        """
        stub = FakeAIProvider("Here is my analysis: the deploy was probably bad.")

        with patch("main.get_ai_provider", return_value=stub):
            resp = client.post("/analyze", json={"events": sample_events})

        assert resp.status_code == 502
        assert "Failed to parse" in resp.json()["detail"]

    def test_single_event_is_accepted(self, client, fake_analysis):
        """Boundary: exactly one event — should not hit the empty-events guard."""
        event = {
            "id": "single",
            "source": "pagerduty",
            "time": "2026-04-25T14:00:00Z",
            "severity": "critical",
            "title": "API latency degraded",
            "detail": "p99 > 2 s",
            "tags": ["pagerduty"],
        }
        stub = FakeAIProvider(json.dumps(fake_analysis))

        with patch("main.get_ai_provider", return_value=stub):
            resp = client.post("/analyze", json={"events": [event]})

        assert resp.status_code == 200
