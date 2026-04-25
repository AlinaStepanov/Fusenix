import os
import asyncio
import logging
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

from pathlib import Path
try:
    from dotenv import load_dotenv
    # Resolve .env from repo root (one level up from backend/)
    _env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(_env_path)
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("opsbridge")

from connectors.cloudwatch import CloudWatchConnector
from connectors.github import GitHubConnector

# ── Rate limiting ─────────────────────────────────────────────────────────────
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

app = FastAPI(title="OpsBridge API", version="1.1.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Production: set ALLOWED_ORIGINS=https://opsbridge.example.com in your env.
# Defaults to localhost dev origins when the variable is absent.
_default_origins = (
    "http://localhost:5173,http://localhost:3000,http://localhost:3001,"
    "http://127.0.0.1:5173,http://127.0.0.1:3000,http://127.0.0.1:3001"
)
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", _default_origins).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)


def get_cloudwatch():
    return CloudWatchConnector(
        region=os.environ.get("AWS_REGION", "us-east-1"),
        access_key=os.environ.get("AWS_ACCESS_KEY_ID"),
        secret_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        log_groups=os.environ.get("CW_LOG_GROUPS", "").split(","),
        alarm_prefix=os.environ.get("CW_ALARM_PREFIX", ""),
    )

def get_github():
    return GitHubConnector(
        token=os.environ.get("GITHUB_TOKEN"),
        repos=os.environ.get("GITHUB_REPOS", "").split(","),
    )

class TimelineEvent(BaseModel):
    id: str
    source: str
    time: str
    severity: str
    title: str
    detail: str
    tags: list[str]
    url: Optional[str] = None
    raw: Optional[dict] = None

class TimelineResponse(BaseModel):
    events: list[TimelineEvent]
    errors: list[dict]
    meta: dict

class AnalyzeRequest(BaseModel):
    events: list[TimelineEvent]

    class Config:
        # Reject payloads with extra fields
        extra = "forbid"


@app.get("/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.get("/timeline", response_model=TimelineResponse)
@limiter.limit("30/minute")
async def get_timeline(
    request: Request,
    start: str = Query(..., description="ISO8601 start time"),
    end:   str = Query(..., description="ISO8601 end time"),
    sources: Optional[str] = Query(None, description="Comma-separated: cloudwatch,github"),
):
    try:
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_dt   = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid time format: {e}")

    requested = set((sources or "cloudwatch,github").split(","))
    logger.info("Timeline request: %s -> %s, sources=%s", start, end, requested)

    tasks = {}
    if "cloudwatch" in requested:
        tasks["cloudwatch"] = get_cloudwatch().fetch(start_dt, end_dt)
    if "github" in requested:
        tasks["github"] = get_github().fetch(start_dt, end_dt)

    results = await asyncio.gather(*tasks.values(), return_exceptions=True)

    all_events: list[TimelineEvent] = []
    errors: list[dict] = []

    for source, result in zip(tasks.keys(), results):
        if isinstance(result, Exception):
            logger.error("Source %s failed: %s", source, result)
            errors.append({"source": source, "error": str(result)})
        else:
            logger.info("Source %s returned %d events", source, len(result))
            all_events.extend(result)

    all_events.sort(key=lambda e: e.time)
    sources_ok = list(set(tasks.keys()) - {e["source"] for e in errors})

    return TimelineResponse(
        events=all_events,
        errors=errors,
        meta={
            "start": start,
            "end": end,
            "total": len(all_events),
            "sources_ok": sources_ok,
            "sources_failed": [e["source"] for e in errors],
        }
    )


@app.post("/analyze")
@limiter.limit("5/minute")
async def analyze_incident(request: Request, req: AnalyzeRequest):
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    if not openrouter_key:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY not configured")
    if not req.events:
        raise HTTPException(status_code=400, detail="No events provided for analysis")
    if len(req.events) > 500:
        raise HTTPException(status_code=400, detail="Too many events: limit is 500 per analysis")

    logger.info("Analyze request: %d events", len(req.events))

    summary_lines = [
        f"[{e.time}] [{e.source.upper()}] {e.severity.upper()}: {e.title} - {e.detail}"
        for e in req.events
    ]
    summary = "\n".join(summary_lines)

    system_prompt = (
        "You are a senior SRE performing root-cause analysis on a production incident.\n"
        "Respond ONLY with a valid JSON object - no markdown, no backticks, no preamble.\n"
        "Schema:\n{\n"
        '  \"root_cause\": \"string\",\n'
        '  \"timeline_summary\": \"string\",\n'
        '  \"contributing_factors\": [\"string\"],\n'
        '  \"key_insight\": \"string\",\n'
        '  \"next_steps\": [\"string\"],\n'
        '  \"risk_score\": 1\n}\n'
        "risk_score must be an integer 1-10."
    )

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {openrouter_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": os.environ.get("OPENROUTER_MODEL", "openrouter/auto"),
                "max_tokens": 1200,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Analyze this incident timeline:\n\n{summary}"}
                ],
            }
        )

    if resp.status_code != 200:
        logger.error("OpenRouter API error %d: %s", resp.status_code, resp.text[:200])
        raise HTTPException(status_code=502, detail=f"OpenRouter API error {resp.status_code}")

    data = resp.json()
    text = data["choices"][0]["message"]["content"]

    import json
    try:
        analysis = json.loads(text.strip())
    except json.JSONDecodeError as e:
        logger.error("Failed to parse OpenRouter response: %s", e)
        raise HTTPException(status_code=502, detail="Failed to parse analysis response")

    return {"analysis": analysis}


@app.get("/sources/status")
async def sources_status():
    return {
        "cloudwatch": {
            "configured": bool(os.environ.get("AWS_ACCESS_KEY_ID")),
            "region": os.environ.get("AWS_REGION", "us-east-1"),
            "log_groups": [g for g in os.environ.get("CW_LOG_GROUPS", "").split(",") if g],
        },
        "github": {
            "configured": bool(os.environ.get("GITHUB_TOKEN")),
            "repos": [r for r in os.environ.get("GITHUB_REPOS", "").split(",") if r],
        },
        "openrouter": {
            "configured": bool(os.environ.get("OPENROUTER_API_KEY")),
        }
    }


@app.get("/audit/alarms")
@limiter.limit("10/minute")
async def audit_alarms(request: Request):
    """
    Return full CloudWatch alarm configurations with flagged misconfigurations.
    Checks for: missing notification actions, INSUFFICIENT_DATA state, noisy
    evaluation windows, missing data treatment, and stuck-in-ALARM alarms.
    """
    try:
        connector = get_cloudwatch()
        alarms = await connector.audit_alarms()
    except Exception as e:
        logger.error("Alarm audit failed: %s", e)
        raise HTTPException(status_code=502, detail=f"CloudWatch audit failed: {e}")

    total   = len(alarms)
    ok      = sum(1 for a in alarms if a["health"] == "ok")
    warning = sum(1 for a in alarms if a["health"] == "warning")
    critical= sum(1 for a in alarms if a["health"] == "critical")
    info    = sum(1 for a in alarms if a["health"] == "info")

    return {
        "alarms": alarms,
        "summary": {
            "total":    total,
            "ok":       ok,
            "info":     info,
            "warning":  warning,
            "critical": critical,
        },
    }
