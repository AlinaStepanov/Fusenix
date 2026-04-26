"""
Shared fixtures for all Fusenix backend tests.

Run from backend/:
    pytest tests/ -v
"""
import os
import sys

# Ensure `backend/` is on sys.path so `import main` and `import connectors.*` work
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from fastapi.testclient import TestClient

from main import app
from tests.helpers import FakeAIProvider  # noqa: F401 — re-exported for tests that import it


# ── App client ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def client():
    """FastAPI TestClient — created once per session for speed."""
    return TestClient(app)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def fake_analysis():
    """Deterministic analysis payload that satisfies the /analyze schema."""
    return {
        "root_cause": "Deploy v2.4.1 introduced a regression in the auth middleware",
        "timeline_summary": "Deploy at 14:23 UTC triggered 5xx alarms at 14:31 UTC (8 min lag)",
        "contributing_factors": [
            "No canary rollout — 100% traffic switch",
            "Missing pre-deploy smoke test",
        ],
        "key_insight": "Error rate spiked exactly 8 minutes after deploy completed",
        "next_steps": [
            "Rollback v2.4.1 to v2.4.0",
            "Add smoke tests to deploy pipeline",
        ],
        "risk_score": 8,
    }


@pytest.fixture
def sample_events():
    """Two realistic events covering different sources — used across tests."""
    return [
        {
            "id": "evt_001",
            "source": "github",
            "time": "2026-04-25T14:23:00+00:00",
            "severity": "info",
            "title": "Deploy → production: v2.4.1",
            "detail": "Deployed by alice via GitHub Actions",
            "tags": ["github", "deploy"],
            "url": "https://github.com/org/repo/actions/runs/123",
            "raw": None,
        },
        {
            "id": "evt_002",
            "source": "cloudwatch",
            "time": "2026-04-25T14:31:00+00:00",
            "severity": "critical",
            "title": "Alarm 'api-5xx-rate': OK → ALARM",
            "detail": "Threshold: 5 errors/min. Evaluated: 12 errors/min",
            "tags": ["cloudwatch", "alarm"],
            "url": None,
            "raw": None,
        },
    ]
