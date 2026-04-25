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
| **Grafana** | Alert annotations (state-change history), Alertmanager active alerts |
| **PagerDuty** | Incidents with status, urgency, service, and assignee |
| **Datadog** | Events stream, triggered/degraded monitors |

You only need credentials for the sources you use — everything else is gracefully skipped. The source filter bar shows a green dot next to each configured integration.

## Why not just use Datadog / Grafana / PagerDuty?

Those tools show their own slice. Datadog doesn't know about your GitHub deploys. PagerDuty doesn't show your log errors. Grafana doesn't know a revert commit just landed. Fusenix is **read-only and source-agnostic** — it doesn't replace your existing stack, it aggregates the timeline across all of it.

Self-hosted, free, and takes about 5 minutes to configure.

---

## Quick start

```bash
git clone https://github.com/AlinaStepanov/Fusenix
cd Fusenix

cp .env.example .env
# edit .env — fill in credentials for the sources you want

# Backend
cd backend && pip install -r requirements.txt
uvicorn main:app --reload --port 8003

# Frontend (new terminal, from repo root)
npm install && npm run dev
# open http://localhost:3000
```

### Docker

```bash
cp .env.example .env   # fill in credentials
docker compose up --build
# open http://localhost:3000
```

---

## Configuration

Everything lives in a single `.env` file at the repo root. Copy `.env.example` to get started — it's fully documented with examples for every provider.

### Data sources

```env
# AWS CloudWatch
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
CW_LOG_GROUPS=/aws/lambda/my-api,/ecs/my-service
CW_ALARM_PREFIX=prod-        # optional: filter alarms by prefix

# GitHub
GITHUB_TOKEN=ghp_...
GITHUB_REPOS=myorg/api,myorg/frontend

# Grafana
GRAFANA_URL=https://grafana.mycompany.com
GRAFANA_API_KEY=glsa_...      # service-account token with Viewer role
GRAFANA_ORG_ID=1              # optional

# PagerDuty
PAGERDUTY_API_KEY=...         # read-only REST API key
PAGERDUTY_SERVICE_IDS=P1A2B3,P4D5E6   # optional filter

# Datadog
DD_API_KEY=...
DD_APP_KEY=...
DD_SITE=datadoghq.com         # datadoghq.eu for EU customers
```

### AI provider

Set `AI_PROVIDER` to your preferred backend, then fill in the matching credentials:

```env
AI_PROVIDER=openrouter   # see table below for all options
```

| `AI_PROVIDER` | Required variable | Default model |
|---|---|---|
| `openrouter` | `OPENROUTER_API_KEY` | `openrouter/auto` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-haiku-4-5-20251001` |
| `ollama` | *(none)* | `llama3` |
| `azure_openai` | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` | deployment name |
| `groq` | `GROQ_API_KEY` | `llama3-8b-8192` |
| `together` | `TOGETHER_API_KEY` | `mistralai/Mixtral-8x7B-Instruct-v0.1` |
| `mistral` | `MISTRAL_API_KEY` | `mistral-small-latest` |
| *(any name)* | `AI_API_KEY` + `AI_BASE_URL` | `AI_MODEL` |

Override the model for any provider with `AI_MODEL` (universal) or the provider-specific variable (e.g. `OPENROUTER_MODEL`).

---

## Features

### Timeline
Select a preset time window (1h / 4h / 24h / 7d) or set a custom range. Events from all configured sources are merged into one chronological list, colour-coded by severity. Click any event to inspect its full detail and raw payload.

### Source filtering
Toggle individual sources on/off in real time without refetching. The filter bar shows event counts and whether each source is configured.

### AI Analysis
Click **AI Analysis** to send the visible timeline to the configured AI provider. The response includes:
- Root cause and key insight
- Risk score (1–10)
- Contributing factors
- Recommended next steps

Works with any of the 8+ supported AI providers.

### Config Audit
Click **Config Audit** to run a cross-source configuration health check across every connected integration simultaneously:

| Source | What's checked |
|--------|----------------|
| **CloudWatch** | Missing alarm actions, stuck alarms, single-period evaluation, missing-data policy |
| **Grafana** | Paused alert rules, rules without routing labels, missing runbook/description annotations |
| **Datadog** | Monitors with no notification recipients, muted monitors, no-data policy gaps, missing tags |
| **PagerDuty** | Disabled services, services without escalation policies, empty escalation rules, services without integrations |

Each finding links directly to the affected resource and includes a suggested fix.

### Persistent state
Time range selection, active source filters, and theme preference are all persisted to `localStorage` — they survive page refreshes and browser restarts.

### Dark mode
Click the ☀/☾ toggle in the header to switch between light and dark themes. Preference is saved automatically.

### Export
Export the current filtered timeline as JSON for post-incident review or ingestion into other tools.

---

## API

The backend runs on port `8000` (proxied through nginx in Docker). All endpoints are rate-limited.

### `GET /health`
```json
{ "status": "ok", "time": "2026-04-24T14:31:00", "ai_provider": "openrouter" }
```

### `GET /timeline?start=<ISO8601>&end=<ISO8601>&sources=cloudwatch,github,grafana,pagerduty,datadog`
Returns merged, chronologically sorted events from all requested configured sources. Unconfigured sources are silently skipped.

### `POST /analyze`
Body: `{ "events": [...] }` (up to 500 events)

```json
{
  "provider": "openrouter",
  "analysis": {
    "root_cause": "string",
    "timeline_summary": "string",
    "contributing_factors": ["string"],
    "key_insight": "string",
    "next_steps": ["string"],
    "risk_score": 7
  }
}
```

### `GET /audit`
Multi-source configuration audit. Returns findings grouped by source:
```json
{
  "sources": {
    "cloudwatch": { "configured": true, "items": [...], "summary": { "total": 12, "ok": 9, "warning": 2, "critical": 1, "info": 0 } },
    "grafana":    { "configured": true, "items": [...], "summary": { ... } },
    "datadog":    { "configured": true, "items": [...], "summary": { ... } },
    "pagerduty":  { "configured": true, "items": [...], "summary": { ... } }
  },
  "summary": { "total": 42, "ok": 31, "warning": 6, "critical": 3, "info": 2 }
}
```

### `GET /audit/alarms`
CloudWatch-only alarm audit (legacy endpoint, still supported).

### `GET /sources/status`
Reports which integrations and AI provider are configured, without exposing credentials.

### Rate limits

| Endpoint | Limit |
|---|---|
| `/timeline` | 30 / minute |
| `/analyze` | 5 / minute |
| `/audit` | 10 / minute |
| All others | 60 / minute |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│   React 18 + Vite · IBM Plex fonts               │
│   useLocalStorage · dark/light theme toggle      │
└──────────────────┬───────────────────���──────────┘
                   │ HTTP (proxied by nginx)
┌──────────────────▼──────────────────────────────┐
│              FastAPI backend (Python 3.11)        │
│                                                  │
│  Connectors (async, parallel):                   │
│    CloudWatch  GitHub  Grafana  PagerDuty  Datadog│
│                                                  │
│  AI providers (pluggable):                       │
│    OpenRouter  OpenAI  Anthropic  Ollama  +more  │
└─────────────────────────────────────────────────┘
```

The connector interface is intentionally small. Adding a new source means creating one file with one method:

```python
# backend/connectors/myservice.py
class MyServiceConnector:
    async def fetch(self, start: datetime, end: datetime) -> list[TimelineEvent]:
        ...

    async def audit(self) -> dict:          # optional — for Config Audit
        ...
```

Then register it in `backend/main.py` (factory function + `/timeline` route + `/audit` endpoint + `/sources/status`).

To add a new AI provider, implement the `AIProvider` ABC (see `AnthropicProvider` for a non-OpenAI-compatible example) and add a branch in `get_ai_provider()`.

---

## Contributing

PRs welcome. If you're adding a connector or AI provider, open an issue first to coordinate. Please include:
- The connector file with both `fetch()` and `audit()` methods
- `.env.example` additions with full documentation
- `constants.js` entry for the source badge

## License

MIT
