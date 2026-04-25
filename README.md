# Fusenix

**Unified incident context — one screen for everything that happened.**

When something breaks in production, the context is scattered: alarms firing in CloudWatch, a monitor triggering in Datadog, an incident in PagerDuty, a suspicious deploy on GitHub, Grafana alerts going off. Fusenix pulls it all into a single chronological timeline so you can see *what happened in what order* — without switching between six tabs.

```
14:23  ◉ github      Deploy → production: v2.4.1 [SUCCESS]
14:31  ☁ cloudwatch  Alarm 'api-5xx-rate': → ALARM
14:31  ⬡ datadog     [DD Monitor] API Error Rate > 5% — State: Alert
14:33  🚨 pagerduty   [PD] API latency degraded — Status: triggered | Urgency: high
14:35  ◈ grafana     [Alertmanager] HighErrorRate → firing
14:35  ☁ cloudwatch  Log error [api-service]: TypeError: Cannot read...
```

Hit **AI Analysis** and the configured AI reads the full timeline and gives you root cause, contributing factors, and next steps in under 10 seconds. Works with OpenRouter, Anthropic, OpenAI, Ollama, Groq, and any OpenAI-compatible endpoint.

---

## What it connects

| Source | What it pulls |
|--------|--------------|
| **AWS CloudWatch** | Alarm state changes, log errors (Logs Insights), metric anomalies (ELB 5xx, EC2 CPU, RDS latency, Lambda errors) |
| **GitHub** | Commits, merged PRs, deployments, GitHub Actions workflow runs |
| **Grafana** | Alert annotations (state-change history), Alertmanager active alerts. Works with both self-hosted and Grafana Cloud. |
| **PagerDuty** | Incidents with status, urgency, service, and assignee |
| **Datadog** | Events stream, triggered/degraded monitors |

You only need credentials for the sources you use — everything else is gracefully skipped. The source filter bar shows a green dot next to each configured integration.

## Why not just use Datadog / Grafana / PagerDuty?

Those tools show their own slice. Datadog doesn't know about your GitHub deploys. PagerDuty doesn't show your log errors. Grafana doesn't know a revert commit just landed. Fusenix is **read-only and source-agnostic** — it doesn't replace your existing stack, it aggregates the timeline across all of it.

Self-hosted, free, and takes about 5 minutes to configure.

---

## Quick start

### Local (dev mode — no Docker)

```bash
git clone https://github.com/AlinaStepanov/Fusenix
cd Fusenix

cp .env.example .env
# Open .env and fill in credentials for the sources you want to connect
# (you only need to fill the sources you actually use)

npm install          # installs frontend deps + sets up backend venv
npm run dev          # starts FastAPI on :8003 AND Vite on :3000 together
# open http://localhost:3000
```

> `npm run dev` uses `concurrently` to launch both the Python backend (port 8003) and the Vite dev server (port 3000) in a single terminal. The Vite dev server proxies all API calls to the backend automatically — no CORS setup needed.

### Docker (production-like)

```bash
cp .env.example .env   # fill in credentials
docker compose up --build
# open http://localhost:3000
```

Docker spins up two containers: the FastAPI backend (internal only, port 8000) and an nginx container that serves the built React app and proxies `/timeline`, `/analyze`, `/health`, `/audit`, `/sources` to the backend. The backend is never directly exposed to the host.

---

## Configuration

All configuration lives in a **single `.env` file at the repo root**. Copy `.env.example` to get started — every variable is documented there.

> **Note:** There is also a `backend/.env.example` in the repo, but it is an older, incomplete copy. Use the **root `.env.example`** as the canonical reference. The backend loads from the root `.env` automatically (via `python-dotenv`).

### Data sources

```env
# ── AWS CloudWatch ────────────────────────────────────────────────────────────
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
CW_LOG_GROUPS=/aws/lambda/my-api,/ecs/my-service   # comma-separated log group names
CW_ALARM_PREFIX=prod-    # optional: filter alarms by name prefix (leave blank for all)

# ── GitHub ────────────────────────────────────────────────────────────────────
# Personal access token — needs scopes: repo, read:org, workflow
GITHUB_TOKEN=ghp_...
GITHUB_REPOS=myorg/api,myorg/frontend   # comma-separated owner/repo pairs

# ── Grafana ───────────────────────────────────────────────────────────────────
# Works with self-hosted AND Grafana Cloud (see Grafana section below)
GRAFANA_URL=https://grafana.mycompany.com      # or https://yourorg.grafana.net
GRAFANA_API_KEY=glsa_...                       # service-account token with Viewer role
GRAFANA_ORG_ID=1                               # optional, defaults to org 1

# ── PagerDuty ─────────────────────────────────────────────────────────────────
PAGERDUTY_API_KEY=...                          # read-only REST API key
PAGERDUTY_SERVICE_IDS=P1A2B3,P4D5E6F          # optional: filter to specific services

# ── Datadog ───────────────────────────────────────────────────────────────────
DD_API_KEY=...
DD_APP_KEY=...
DD_SITE=datadoghq.com    # use datadoghq.eu for EU, us3.datadoghq.com for US3, etc.
```

### AI provider

Set `AI_PROVIDER` to your preferred backend, then fill in only the matching credentials block:

```env
AI_PROVIDER=openrouter   # see table below for all options
```

| `AI_PROVIDER` | Required env var | Default model |
|---|---|---|
| `openrouter` | `OPENROUTER_API_KEY` | `openrouter/auto` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-haiku-4-5-20251001` |
| `ollama` | *(none — run `ollama serve` locally)* | `llama3` |
| `azure_openai` | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` | deployment name |
| `groq` | `GROQ_API_KEY` | `llama3-8b-8192` |
| `together` | `TOGETHER_API_KEY` | `mistralai/Mixtral-8x7B-Instruct-v0.1` |
| `mistral` | `MISTRAL_API_KEY` | `mistral-small-latest` |
| *(any name)* | `AI_API_KEY` + `AI_BASE_URL` | set via `AI_MODEL` |

Override the model for any provider with `AI_MODEL` (universal) or a provider-specific variable (e.g. `OPENROUTER_MODEL=anthropic/claude-3-haiku`).

### CORS

In production, restrict the backend to your actual frontend origin:

```env
ALLOWED_ORIGINS=https://fusenix.mycompany.com
```

In local dev, the default allows `localhost:3000` and `localhost:5173`.

---

## Grafana — self-hosted and Grafana Cloud

Both work identically. The only difference is the URL.

**Self-hosted Grafana:**
```env
GRAFANA_URL=https://grafana.mycompany.com
```

**Grafana Cloud:**
```env
GRAFANA_URL=https://yourorg.grafana.net   # your stack URL from grafana.com/orgs
```

To find your Grafana Cloud stack URL: log in at [grafana.com](https://grafana.com) → My Account → Your stacks → click the stack name → copy the "Stack URL".

**Creating a service-account token (same steps for both):**
1. In your Grafana instance, go to **Administration → Service accounts**
2. Click **Add service account** → set the role to **Viewer**
3. Click **Add service account token** → copy the `glsa_...` value
4. Set `GRAFANA_API_KEY=glsa_...` in your `.env`

> **Why not a legacy API key?** Legacy Grafana API keys still work and are supported, but they are deprecated. Service account tokens are the current recommended approach — they have clearer scope, appear in audit logs, and can be revoked independently.

What Fusenix fetches from Grafana:
- **Alert annotations** — historical alert state changes (firing → resolved) from `/api/annotations`
- **Active Alertmanager alerts** — currently firing rules from the Unified Alerting API
- **Config Audit** — paused rules, rules missing runbook/description annotations, rules without routing labels

---

## Features

### Timeline
Select a preset time window (1h / 4h / 24h / 7d) or set a custom range. Events from all configured sources are fetched in parallel, merged, and sorted chronologically. Click any event to inspect its full detail and raw payload.

### Source filtering
Toggle individual sources on/off in real time without refetching. The filter bar shows event counts and a green dot for each configured (and responding) integration.

### AI Analysis
Click **AI Analysis** to send the currently visible timeline to the configured AI provider. The backend sends up to 500 events as structured text with a system prompt that instructs the AI to act as a senior SRE performing root-cause analysis. The response is structured JSON with:
- `root_cause` — what the AI believes caused the incident
- `timeline_summary` — narrative of what happened and in what order
- `contributing_factors` — list of compounding issues
- `key_insight` — the single most important observation
- `next_steps` — concrete remediation actions
- `risk_score` — severity estimate, 1–10

The endpoint is rate-limited to **5 calls per minute** because each call triggers a real (and potentially costly) AI API request. If the AI provider is not configured, the endpoint returns `500` with a descriptive message.

### Config Audit
Click **Config Audit** to run a cross-source configuration health check. Fusenix connects to each integration simultaneously and looks for common misconfigurations:

| Source | What's checked |
|--------|----------------|
| **CloudWatch** | Missing alarm actions (no SNS topic), alarms stuck in INSUFFICIENT_DATA, single-period evaluation windows, missing-data-as-ok policy |
| **Grafana** | Paused alert rules, rules without routing labels, missing runbook or description annotations |
| **Datadog** | Monitors with no notification recipients, muted monitors, missing no-data policy, monitors without tags |
| **PagerDuty** | Disabled services, services without escalation policies, empty escalation rules, services without integrations |

Each finding includes the affected resource name, health status (ok / info / warning / critical), and a suggested fix.

### Persistent state
Time range selection, active source filters, and theme preference are all persisted to `localStorage` — they survive page refreshes and browser restarts.

### Dark mode
Click the ☀/☾ toggle in the header to switch themes. Preference is saved automatically.

### Export
Export the current filtered timeline as JSON for post-incident review or ingestion into other tools.

---

## API reference

The backend runs on port `8000`. In Docker, nginx proxies all requests from port `3000` to the backend — the backend is never directly reachable from the host. In local dev mode, the Vite dev server proxies API calls to the backend on port `8003`.

All endpoints return JSON. Errors follow the format `{ "detail": "error message" }`.

---

### `GET /health`

Liveness check. Used by the docker-compose healthcheck and any external uptime monitor.

**Response:**
```json
{
  "status": "ok",
  "time": "2026-04-24T14:31:00.000000",
  "ai_provider": "openrouter"
}
```

---

### `GET /timeline?start=&end=&sources=`

Fetches events from all configured integrations in parallel and returns a unified, time-sorted list.

**Query parameters:**

| Parameter | Required | Example | Description |
|-----------|----------|---------|-------------|
| `start` | yes | `2026-04-24T13:00:00Z` | ISO 8601 start timestamp |
| `end` | yes | `2026-04-24T15:00:00Z` | ISO 8601 end timestamp |
| `sources` | no | `cloudwatch,github` | Comma-separated list of sources to include. Defaults to all. Sources that aren't configured are silently skipped regardless. |

**Rate limit:** 30 requests / minute

**Response:**
```json
{
  "events": [
    {
      "id": "abc123",
      "source": "github",
      "time": "2026-04-24T14:23:00Z",
      "severity": "info",
      "title": "Deploy → production: v2.4.1",
      "detail": "Merged by alice. 3 commits.",
      "tags": ["deploy", "production"],
      "url": "https://github.com/myorg/api/actions/runs/12345",
      "raw": { "...": "full original payload from the source API" }
    }
  ],
  "errors": [
    { "source": "grafana", "error": "connection refused" }
  ],
  "meta": {
    "start": "2026-04-24T13:00:00Z",
    "end": "2026-04-24T15:00:00Z",
    "total": 47,
    "sources_ok": ["cloudwatch", "github", "pagerduty"],
    "sources_failed": ["grafana"]
  }
}
```

`errors` is populated when a configured source fails to respond. The other sources still return their events — one broken integration never blocks the whole timeline.

---

### `POST /analyze`

Sends timeline events to the configured AI provider for root-cause analysis. Each call hits a real AI API.

**Rate limit:** 5 requests / minute

**Request body:**
```json
{
  "events": [ ...array of timeline event objects... ]
}
```

Maximum 500 events per request. Returns `400` if `events` is empty or over the limit. Returns `502` if the AI provider is unreachable or returns an unparseable response.

**Response:**
```json
{
  "provider": "openrouter",
  "analysis": {
    "root_cause": "Deployment of v2.4.1 introduced a memory leak in the API service, causing error rates to climb within 8 minutes of going live.",
    "timeline_summary": "At 14:23 a deploy landed. By 14:31 CloudWatch alarms and Datadog monitors fired simultaneously. PagerDuty paged at 14:33. Grafana confirmed at 14:35.",
    "contributing_factors": [
      "No canary deployment — change went to 100% traffic immediately",
      "CloudWatch alarm evaluated over only 1 period, too short to catch gradual degradation"
    ],
    "key_insight": "The 8-minute gap between deploy and alarms is consistent with a memory leak requiring time to accumulate.",
    "next_steps": [
      "Roll back v2.4.1 immediately",
      "Profile memory in staging with the new code path active",
      "Extend alarm evaluation to 3 periods before alerting"
    ],
    "risk_score": 8
  }
}
```

---

### `GET /sources/status`

Reports which integrations are configured and which AI provider is active. Does not expose credential values — only whether a key is present.

**Rate limit:** 60 requests / minute

**Response:**
```json
{
  "cloudwatch": { "configured": true,  "region": "us-east-1", "log_groups": ["/aws/lambda/my-api"] },
  "github":     { "configured": true,  "repos": ["myorg/api"] },
  "grafana":    { "configured": true,  "url": "https://yourorg.grafana.net" },
  "pagerduty":  { "configured": false, "service_ids": [] },
  "datadog":    { "configured": false, "site": "datadoghq.com" },
  "ai": {
    "provider": "openrouter",
    "configured": true,
    "model": "openrouter/auto",
    "base_url": "(provider default)"
  }
}
```

---

### `GET /audit`

Multi-source configuration audit. Runs health checks on all configured integrations in parallel and returns a unified report.

**Rate limit:** 10 requests / minute

**Response:**
```json
{
  "sources": {
    "cloudwatch": {
      "configured": true,
      "items": [
        {
          "name": "prod-api-5xx-rate",
          "health": "warning",
          "issues_count": 1,
          "issues": ["Missing alarm action — no SNS topic configured"],
          "state": "OK"
        }
      ],
      "summary": { "total": 12, "ok": 9, "warning": 2, "critical": 1, "info": 0 }
    },
    "grafana":   { "configured": true,  "items": [...], "summary": { "total": 5, "ok": 4, "warning": 1, "critical": 0, "info": 0 } },
    "datadog":   { "configured": false, "items": [],    "summary": { "total": 0, "ok": 0, "warning": 0, "critical": 0, "info": 0 } },
    "pagerduty": { "configured": false, "items": [],    "summary": { "total": 0, "ok": 0, "warning": 0, "critical": 0, "info": 0 } }
  },
  "summary": { "total": 17, "ok": 13, "warning": 3, "critical": 1, "info": 0 }
}
```

---

### `GET /audit/alarms`

CloudWatch-only alarm audit. Returns the same alarm data as the `cloudwatch` key in `/audit`, as a standalone endpoint kept for backwards compatibility.

**Rate limit:** 10 requests / minute

---

### Rate limits at a glance

| Endpoint | Limit | Why |
|----------|-------|-----|
| `GET /timeline` | 30 / min | Each call fans out to up to 5 external APIs in parallel |
| `POST /analyze` | 5 / min | Triggers a real AI API call — can be slow and costly |
| `GET /audit` | 10 / min | Fans out to multiple external APIs simultaneously |
| `GET /audit/alarms` | 10 / min | Calls AWS CloudWatch describe APIs |
| All others | 60 / min | Cheap reads — generous limit |

Rate limit violations return HTTP `429`. The key is the client IP address.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│   React 18 + Vite · IBM Plex fonts               │
│   useLocalStorage · dark/light theme toggle      │
└──────────────────┬──────────────────────────────┘
                   │ HTTP (relative URLs — no hardcoded host)
                   │
┌──────────────────▼──────────────────────────────┐
│              nginx (port 3000)                   │
│                                                  │
│  • Serves compiled React SPA from /dist          │
│  • SPA fallback: unknown paths → index.html      │
│  • Proxies /timeline /analyze /health            │
│    /audit /sources → backend:8000                │
│  • Security headers (CSP, X-Frame-Options, …)    │
│  • Gzip compression + 1-year cache on assets     │
│  • 1 MB request body limit (protects /analyze)   │
└──────────────────┬──────────────────────────────┘
                   │ Internal Docker network only
                   │ (backend:8000 — not exposed to host)
┌──────────────────▼──────────────────────────────┐
│         FastAPI backend (Python 3.11)            │
│                   port 8000                      │
│                                                  │
│  Connectors (async, run in parallel per request):│
│    CloudWatch · GitHub · Grafana                 │
│    PagerDuty  · Datadog                          │
│                                                  │
│  AI providers (pluggable via AI_PROVIDER env):   │
│    OpenRouter · OpenAI · Anthropic               │
│    Ollama · Azure OpenAI · Groq · + more         │
│                                                  │
│  Rate limiting via slowapi (per client IP)       │
└─────────────────────────────────────────────────┘
```

**Why nginx sits in front of the backend:**
The browser always talks to one origin (`localhost:3000`). nginx routes static file requests directly to disk and proxies `/api/*` paths to the Python process. This eliminates CORS entirely, enforces security headers at one layer, enables gzip and asset caching without touching the Python code, and keeps the backend process off the public network.

### Adding a connector

The connector interface is intentionally minimal. One file, two methods:

```python
# backend/connectors/myservice.py
class MyServiceConnector:
    async def fetch(self, start: datetime, end: datetime) -> list[TimelineEvent]:
        # Call your service's API, normalize results to TimelineEvent, return list.
        ...

    async def audit(self) -> dict:   # optional — enables Config Audit for this source
        # Return: { "configured": bool, "items": [...], "summary": {total,ok,warning,critical,info} }
        ...
```

Then register it in `backend/main.py`: add a factory function, add it to the `tasks` dict in `/timeline`, add it to `/audit` if it has `audit()`, add it to `/sources/status`, and add a `SOURCE_META` entry in `frontend/src/constants.js`.

### Adding an AI provider

Implement the `AIProvider` ABC (see `AnthropicProvider` for a non-OpenAI-compatible example) and add a branch in `get_ai_provider()`. If your provider exposes a standard OpenAI chat-completions endpoint, just add entries to `BASE_URLS` and `DEFAULT_MODELS` — no new class needed.

---

## Contributing

PRs welcome. If you're adding a connector or AI provider, open an issue first to coordinate. See `CONTRIBUTING.md` for the full guide. Please include:
- The connector file with both `fetch()` and `audit()` methods
- `.env.example` additions with inline documentation
- `constants.js` entry for the source badge

## Security

See `SECURITY.md` for the vulnerability disclosure process. Key points: never commit your `.env` (it's gitignored), use read-only API credentials wherever possible, and run behind a VPN or auth proxy if Fusenix is deployed on an internal network.

## License

MIT