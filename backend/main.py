"""
main.py — Fusenix API (provider-agnostic AI backend)

AI provider is selected via AI_PROVIDER in .env (repo root).
Supported: openrouter | openai | anthropic | ollama | azure_openai
"""

import os
import json
import asyncio
import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

from pathlib import Path

try:
    from dotenv import load_dotenv
    _root = Path(__file__).resolve().parent.parent
    # Loads .env from repo root (one level up from backend/)
    load_dotenv(_root / ".env")
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("Fusenix")

from connectors.cloudwatch import CloudWatchConnector
from connectors.github import GitHubConnector

# ── Rate limiting ─────────────────────────────────────────────────────────────
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

app = FastAPI(title="Fusenix API", version="2.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ──────────────────────────────────────────────────────────────────────
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


# ════════════════════════════════════════════════════════════════════════════
# AI Provider Abstraction
# ════════════════════════════════════════════════════════════════════════════

class AIProvider(ABC):
    """Common interface every provider must implement."""

    @abstractmethod
    async def complete(self, system_prompt: str, user_message: str) -> str:
        """Send a prompt and return the raw text response."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider name used in logs and /sources/status."""


class OpenAICompatibleProvider(AIProvider):
    """
    Covers any provider that exposes an OpenAI-style chat-completions endpoint:
      - OpenAI       (AI_BASE_URL=https://api.openai.com/v1)
      - OpenRouter   (AI_BASE_URL=https://openrouter.ai/api/v1)
      - Ollama       (AI_BASE_URL=http://localhost:11434/v1)
      - LM Studio, vLLM, Together, Groq, Mistral, …
    """

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str,
        provider_name: str,
        extra_headers: Optional[dict] = None,
    ):
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._provider_name = provider_name
        self._extra_headers = extra_headers or {}

    @property
    def name(self) -> str:
        return self._provider_name

    async def complete(self, system_prompt: str, user_message: str) -> str:
        headers = {
            "Content-Type": "application/json",
            **self._extra_headers,
        }
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        payload = {
            "model": self._model,
            "max_tokens": 1200,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_message},
            ],
        }

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{self._base_url}/chat/completions",
                headers=headers,
                json=payload,
            )

        if resp.status_code != 200:
            logger.error("%s API error %d: %s", self.name, resp.status_code, resp.text[:200])
            raise HTTPException(
                status_code=502,
                detail=f"{self.name} API error {resp.status_code}: {resp.text[:200]}",
            )

        return resp.json()["choices"][0]["message"]["content"]


class AnthropicProvider(AIProvider):
    """Native Anthropic Messages API."""

    def __init__(self, *, api_key: str, model: str):
        self._api_key = api_key
        self._model = model

    @property
    def name(self) -> str:
        return "anthropic"

    async def complete(self, system_prompt: str, user_message: str) -> str:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self._api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": self._model,
                    "max_tokens": 1200,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_message}],
                },
            )

        if resp.status_code != 200:
            logger.error("Anthropic API error %d: %s", resp.status_code, resp.text[:200])
            raise HTTPException(
                status_code=502,
                detail=f"Anthropic API error {resp.status_code}: {resp.text[:200]}",
            )

        data = resp.json()
        return next((b["text"] for b in data["content"] if b["type"] == "text"), "")


class AzureOpenAIProvider(AIProvider):
    """Azure OpenAI Service (uses deployment name instead of model)."""

    def __init__(self, *, api_key: str, endpoint: str, deployment: str, api_version: str):
        self._api_key = api_key
        self._endpoint = endpoint.rstrip("/")
        self._deployment = deployment
        self._api_version = api_version

    @property
    def name(self) -> str:
        return "azure_openai"

    async def complete(self, system_prompt: str, user_message: str) -> str:
        url = (
            f"{self._endpoint}/openai/deployments/{self._deployment}"
            f"/chat/completions?api-version={self._api_version}"
        )

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                url,
                headers={
                    "api-key": self._api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "max_tokens": 1200,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user",   "content": user_message},
                    ],
                },
            )

        if resp.status_code != 200:
            logger.error("Azure OpenAI error %d: %s", resp.status_code, resp.text[:200])
            raise HTTPException(
                status_code=502,
                detail=f"Azure OpenAI error {resp.status_code}: {resp.text[:200]}",
            )

        return resp.json()["choices"][0]["message"]["content"]


def get_ai_provider() -> AIProvider:
    """
    Build and return the configured AI provider.
    Selection is driven by AI_PROVIDER in .env (defaults to 'openrouter').
    """
    provider = os.environ.get("AI_PROVIDER", "openrouter").strip().lower()
    logger.debug("AI_PROVIDER=%s", provider)

    if provider == "anthropic":
        key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("AI_API_KEY")
        if not key:
            raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
        return AnthropicProvider(
            api_key=key,
            model=os.environ.get("ANTHROPIC_MODEL") or os.environ.get("AI_MODEL", "claude-haiku-4-5-20251001"),
        )

    if provider == "azure_openai":
        key      = os.environ.get("AZURE_OPENAI_API_KEY") or os.environ.get("AI_API_KEY")
        endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
        deploy   = os.environ.get("AZURE_OPENAI_DEPLOYMENT") or os.environ.get("AI_MODEL", "gpt-4o")
        version  = os.environ.get("AZURE_OPENAI_API_VERSION", "2024-02-01")
        if not key or not endpoint:
            raise HTTPException(status_code=500, detail="AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT are required")
        return AzureOpenAIProvider(api_key=key, endpoint=endpoint, deployment=deploy, api_version=version)

    # ── OpenAI-compatible providers ───────────────────────────────────────────
    BASE_URLS = {
        "openrouter": "https://openrouter.ai/api/v1",
        "openai":     "https://api.openai.com/v1",
        "ollama":     "http://localhost:11434/v1",
        "groq":       "https://api.groq.com/openai/v1",
        "together":   "https://api.together.xyz/v1",
        "mistral":    "https://api.mistral.ai/v1",
    }

    DEFAULT_MODELS = {
        "openrouter": "openrouter/auto",
        "openai":     "gpt-4o-mini",
        "ollama":     "llama3",
        "groq":       "llama3-8b-8192",
        "together":   "mistralai/Mixtral-8x7B-Instruct-v0.1",
        "mistral":    "mistral-small-latest",
    }

    # Allow a fully custom base URL for any unlisted OpenAI-compatible provider
    base_url = (
        os.environ.get("AI_BASE_URL")
        or BASE_URLS.get(provider)
    )
    if not base_url:
        raise HTTPException(
            status_code=500,
            detail=f"Unknown AI_PROVIDER '{provider}'. Set AI_BASE_URL for custom providers.",
        )

    # API key: provider-namespaced var takes priority, then universal AI_API_KEY
    key_env_map = {
        "openrouter": "OPENROUTER_API_KEY",
        "openai":     "OPENAI_API_KEY",
        "groq":       "GROQ_API_KEY",
        "together":   "TOGETHER_API_KEY",
        "mistral":    "MISTRAL_API_KEY",
    }
    key = (
        os.environ.get(key_env_map.get(provider, ""), "")
        or os.environ.get("AI_API_KEY", "")
    )

    # Model: provider-namespaced var → universal AI_MODEL → sensible default
    model_env_map = {
        "openrouter": "OPENROUTER_MODEL",
        "openai":     "OPENAI_MODEL",
        "groq":       "GROQ_MODEL",
        "together":   "TOGETHER_MODEL",
        "mistral":    "MISTRAL_MODEL",
    }
    model = (
        os.environ.get(model_env_map.get(provider, ""), "")
        or os.environ.get("AI_MODEL", "")
        or DEFAULT_MODELS.get(provider, "")
    )

    # Ollama typically runs locally without auth
    if provider == "ollama" and not key:
        key = "ollama"

    if not key:
        raise HTTPException(status_code=500, detail=f"API key not configured for provider '{provider}'")

    return OpenAICompatibleProvider(
        api_key=key,
        model=model,
        base_url=base_url,
        provider_name=provider,
    )


# ════════════════════════════════════════════════════════════════════════════
# Data connectors
# ════════════════════════════════════════════════════════════════════════════

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


# ════════════════════════════════════════════════════════════════════════════
# Pydantic models
# ════════════════════════════════════════════════════════════════════════════

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
        extra = "forbid"


# ════════════════════════════════════════════════════════════════════════════
# Routes
# ════════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    provider_name = os.environ.get("AI_PROVIDER", "openrouter")
    return {
        "status": "ok",
        "time": datetime.utcnow().isoformat(),
        "ai_provider": provider_name,
    }


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
        },
    )


@app.post("/analyze")
@limiter.limit("5/minute")
async def analyze_incident(request: Request, req: AnalyzeRequest):
    if not req.events:
        raise HTTPException(status_code=400, detail="No events provided for analysis")
    if len(req.events) > 500:
        raise HTTPException(status_code=400, detail="Too many events: limit is 500 per analysis")

    provider = get_ai_provider()
    logger.info("Analyze request: %d events via provider=%s", len(req.events), provider.name)

    summary = "\n".join(
        f"[{e.time}] [{e.source.upper()}] {e.severity.upper()}: {e.title} - {e.detail}"
        for e in req.events
    )

    system_prompt = (
        "You are a senior SRE performing root-cause analysis on a production incident.\n"
        "Respond ONLY with a valid JSON object - no markdown, no backticks, no preamble.\n"
        "Schema:\n{\n"
        '  "root_cause": "string",\n'
        '  "timeline_summary": "string",\n'
        '  "contributing_factors": ["string"],\n'
        '  "key_insight": "string",\n'
        '  "next_steps": ["string"],\n'
        '  "risk_score": 1\n}\n'
        "risk_score must be an integer 1-10."
    )

    text = await provider.complete(
        system_prompt=system_prompt,
        user_message=f"Analyze this incident timeline:\n\n{summary}",
    )

    try:
        analysis = json.loads(text.strip())
    except json.JSONDecodeError as e:
        logger.error("Failed to parse %s response: %s | raw: %s", provider.name, e, text[:300])
        raise HTTPException(status_code=502, detail="Failed to parse analysis response from AI provider")

    return {"analysis": analysis, "provider": provider.name}


@app.get("/sources/status")
async def sources_status():
    provider_name = os.environ.get("AI_PROVIDER", "openrouter").strip().lower()

    # Determine which key env var is relevant for the selected provider
    key_configured = bool(
        os.environ.get("ANTHROPIC_API_KEY")        if provider_name == "anthropic"   else
        os.environ.get("AZURE_OPENAI_API_KEY")     if provider_name == "azure_openai" else
        os.environ.get("OPENROUTER_API_KEY")       if provider_name == "openrouter"   else
        os.environ.get("OPENAI_API_KEY")           if provider_name == "openai"       else
        os.environ.get("GROQ_API_KEY")             if provider_name == "groq"         else
        os.environ.get("AI_API_KEY")
    )

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
        "ai": {
            "provider": provider_name,
            "configured": key_configured,
            "model": (
                os.environ.get("AI_MODEL")
                or os.environ.get("ANTHROPIC_MODEL")
                or os.environ.get("OPENROUTER_MODEL")
                or os.environ.get("OPENAI_MODEL")
                or "(default)"
            ),
            "base_url": os.environ.get("AI_BASE_URL") or "(provider default)",
        },
    }


@app.get("/audit/alarms")
@limiter.limit("10/minute")
async def audit_alarms(request: Request):
    """
    Return full CloudWatch alarm configurations with flagged misconfigurations.
    """
    try:
        connector = get_cloudwatch()
        alarms = await connector.audit_alarms()
    except Exception as e:
        logger.error("Alarm audit failed: %s", e)
        raise HTTPException(status_code=502, detail=f"CloudWatch audit failed: {e}")

    total    = len(alarms)
    ok       = sum(1 for a in alarms if a["health"] == "ok")
    warning  = sum(1 for a in alarms if a["health"] == "warning")
    critical = sum(1 for a in alarms if a["health"] == "critical")
    info     = sum(1 for a in alarms if a["health"] == "info")

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
