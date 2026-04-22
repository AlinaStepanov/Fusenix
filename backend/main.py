import os
import asyncio
import logging
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
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

app = FastAPI(title="OpsBridge API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:5173", "http://127.0.0.1:3000", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

@app.get("/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.get("/timeline", response_model=TimelineResponse)
async def get_timeline(
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
async def analyze_incident(req: AnalyzeRequest):
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    if not req.events:
        raise HTTPException(status_code=400, detail="No events provided for analysis")

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
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": anthropic_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 1200,
                "system": system_prompt,
                "messages": [{"role": "user", "content": f"Analyze this incident timeline:\n\n{summary}"}],
            }
        )

    if resp.status_code != 200:
        logger.error("Claude API error %d: %s", resp.status_code, resp.text[:200])
        raise HTTPException(status_code=502, detail=f"Claude API error {resp.status_code}")

    data = resp.json()
    text = next((b["text"] for b in data["content"] if b["type"] == "text"), "{}")

    import json
    try:
        analysis = json.loads(text.strip())
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Claude response: %s", e)
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
        "anthropic": {
            "configured": bool(os.environ.get("ANTHROPIC_API_KEY")),
        }
    }
