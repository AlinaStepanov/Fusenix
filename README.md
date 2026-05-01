# Fusenix

**Unified incident context — one screen for everything that happened.**

When something breaks in production, the context is scattered: alarms firing in CloudWatch, a monitor triggering in Datadog, an incident in PagerDuty, a suspicious deploy on GitHub, Grafana alerts going off. Fusenix pulls it all into a single chronological timeline so you can see *what happened and in what order* — without switching between six tabs.

```
14:23  ◉ github      Deploy → production: v2.4.1 [SUCCESS]
14:31  ☁ cloudwatch  Alarm 'api-5xx-rate': → ALARM
14:31  ⬡ datadog     [DD Monitor] API Error Rate > 5% — State: Alert
14:33  🚨 pagerduty   [PD] API latency degraded — Status: triggered | Urgency: high
14:35  ◈ grafana     [Alertmanager] HighErrorRate → firing
14:35  ☁ cloudwatch  Log error [api-service]: TypeError: Cannot read...
```

Hit **AI Analysis** and the configured AI reads the full timeline and gives you root cause, contributing factors, and next steps in under 10 seconds. Works with OpenRouter, Anthropic, OpenAI, Ollama, Groq, and any OpenAI-compatible endpoint.

![Description](fusenix.gif)

---

## What it connects

| Source | What it pulls |
|--------|--------------|
| **AWS CloudWatch** | Alarm state changes, log errors (Logs Insights), metric anomalies (ELB 5xx, EC2 CPU, RDS latency, Lambda errors) |
| **GitHub** | Commits, merged PRs, deployments, GitHub Actions workflow runs |
| **Grafana** | Alert annotations (state-change history), Alertmanager active alerts — self-hosted and Grafana Cloud both work |
| **PagerDuty** | Incidents with status, urgency, service, assignee, on-call schedule |
| **Datadog** | Events stream, triggered/degraded monitors |

You only need credentials for the sources you actually use — everything else is gracefully skipped. The source filter bar shows a green dot next to each configured and responding integration.

## Why not just use Datadog / Grafana / PagerDuty?

Those tools show their own slice. Datadog doesn't know about your GitHub deploys. PagerDuty doesn't show your log errors. Grafana doesn't know a revert commit just landed. Fusenix is **read-only and source-agnostic** — it doesn't replace your existing stack, it aggregates the timeline across all of it.

Self-hosted, free, and takes about 5 minutes to configure.

---

<details>
<summary>Quick start</summary>

## Quick start

### Local dev (no Docker)

```bash
git clone https://github.com/AlinaStepanov/Fusenix
cd Fusenix

cp .env.example .env
# Open .env and fill in credentials for the sources you want to connect.
# You only need to fill in the ones you actually use — everything else is skipped.

npm install          # installs frontend deps + sets up the backend venv
npm run dev          # starts FastAPI on :8000 AND Vite on :3000 together
# open http://localhost:3000
```

`npm run dev` uses `concurrently` to run both processes in one terminal. The Vite dev server proxies all API calls to the backend — no CORS configuration needed.

### Docker (production-like)

```bash
cp .env.example .env   # fill in credentials
docker compose up --build
# open http://localhost:3000
```

Two containers: the FastAPI backend (internal only, port 8000) and nginx on port 3000 that serves the compiled React app and proxies API calls to the backend. The backend is never directly reachable from the host.

</details>

---

<details>
<summary>Configuration</summary>

## Configuration

Everything lives in a **single `.env` file at the repo root**. Copy `.env.example` to get started — every variable is documented there with example values.

### Data sources

```env
# ── AWS CloudWatch ────────────────────────────────────────────────────────────
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
CW_LOG_GROUPS=/aws/lambda/my-api,/ecs/my-service   # comma-separated
CW_ALARM_PREFIX=prod-    # optional: filter alarms by name prefix (blank = all)

# ── GitHub ────────────────────────────────────────────────────────────────────
# Personal access token — needs scopes: repo, read:org, workflow
GITHUB_TOKEN=ghp_...
GITHUB_REPOS=myorg/api,myorg/frontend   # comma-separated owner/repo pairs
# Optional: track specific branches per repo
# GITHUB_REPOS=myorg/api:main|release,myorg/frontend

# ── Grafana ───────────────────────────────────────────────────────────────────
GRAFANA_URL=https://grafana.mycompany.com   # or https://yourorg.grafana.net
GRAFANA_API_KEY=glsa_...                    # service-account token, Viewer role
GRAFANA_ORG_ID=1                            # optional, defaults to 1

# ── PagerDuty ─────────────────────────────────────────────────────────────────
PAGERDUTY_API_KEY=...                       # read-only REST API key
PAGERDUTY_SERVICE_IDS=P1A2B3,P4D5E6F       # optional: filter to specific services

# ── Datadog ───────────────────────────────────────────────────────────────────
DD_API_KEY=...
DD_APP_KEY=...
DD_SITE=datadoghq.com    # datadoghq.eu for EU, us3.datadoghq.com for US3, etc.
```

### AI provider

Set `AI_PROVIDER` to your preferred backend, then fill in the matching credentials:

```env
AI_PROVIDER=openrouter
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

Override the model for any provider with `AI_MODEL`, or a provider-specific variable like `OPENROUTER_MODEL=anthropic/claude-3-haiku`.

### CORS

In production, lock it down to your actual frontend origin:

```env
ALLOWED_ORIGINS=https://fusenix.mycompany.com
```

Local dev defaults to allowing `localhost:3000` and `localhost:5173`.

---

### Service map (services.yml)

`services.yml` lives at the repo root and drives the Service Map view. You can generate a starter file with **⬡ Auto-discover** in the UI, or write it by hand:

```yaml
teams:
  - id: backend
    name: Backend
    color: "#60a5fa"
    emoji: "⚡"

services:
  - id: my-api
    name: my-api
    team: backend
    runtime: ECS          # Lambda, ECS, EC2, K8s, RDS — display only
    env: production
    icon: "⚡"
    cloudwatch:
      alarm_prefix: "prod-my-api-"   # matches alarms by name prefix
    github:
      repo: myorg/my-api
    pagerduty:
      service_id: P1A2B3             # optional — scopes PD incidents to this service
```

Missing fields are silently ignored — you don't need every integration filled in for every service. If `services.yml` doesn't exist, the Service Map tab is empty but everything else works normally.

---

### Grafana: self-hosted vs Grafana Cloud

Both work identically — the only difference is the URL.

**Self-hosted:** `GRAFANA_URL=https://grafana.mycompany.com`

**Grafana Cloud:** `GRAFANA_URL=https://yourorg.grafana.net` (your stack URL: grafana.com → My Account → Stacks)

**Creating a service account token** (same steps for both):
1. In Grafana: **Administration → Service accounts → Add service account** → role: **Viewer**
2. Click **Add service account token** → copy the `glsa_...` value
3. Set `GRAFANA_API_KEY=glsa_...`

Legacy API keys still work but are deprecated. Service account tokens have cleaner scope, appear in audit logs, and can be revoked independently.

</details>

---

<details>
<summary>Features</summary>

## Features

### Timeline

Select a preset window (1h / 4h / 24h / 7d) or set a custom range. Events from all configured sources are fetched in parallel, merged, and sorted chronologically. Click any event to expand its full detail and raw API payload. Time range, active source filters, and theme preference are persisted to `localStorage` across refreshes.

### Morning Brief

Hit **☀ Morning Brief** to pull up an overnight summary of the 01:00–09:00 window — what fired, what resolved, what deployed while you were asleep. If you're the one starting the day with a "how are things?" check, this is your first stop. It runs the same AI analysis on overnight events and surfaces the digest in a focused modal. If nothing happened, it tells you that too.

### Service Map

A live grid of your services and their current health, driven by `services.yml`. Each card shows the owning team, runtime environment, and an aggregated health status from CloudWatch alarms, Grafana alerts, and PagerDuty incidents. Filter by team, environment, or health state. Click a service to drill into its own scoped timeline.

The fastest way to populate it is **⬡ Auto-discover** (see below) or edit `services.yml` directly — schema is in the Configuration section.

### Auto-discovery

Click **⬡ Auto-discover** to scan your configured integrations and generate a suggested `services.yml`. It groups CloudWatch alarms, PagerDuty services, Grafana alert groups, and GitHub repos by detected name patterns and suggests team assignments. Review the output, edit as needed, and click **Save** to write it to disk — existing file is backed up automatically.

The preview (`GET /discover`) has no side effects. Writing only happens on explicit confirm.

### AI Analysis

Click **AI Analysis** to send the visible timeline to the configured AI provider. The backend sends up to 500 events as structured text with a system prompt that asks the AI to act as a senior SRE doing root-cause analysis. Response:

- `root_cause` — what the AI thinks caused the incident
- `timeline_summary` — narrative of what happened in what order
- `contributing_factors` — compounding issues
- `key_insight` — single most important observation
- `next_steps` — concrete remediation steps
- `risk_score` — 1–10 severity estimate

Rate-limited to **5 calls/minute** — each call triggers a real AI API request.

### Config Audit

Click **Config Audit** to run a health check across all configured integrations simultaneously:

| Source | What's checked |
|--------|----------------|
| **CloudWatch** | Missing alarm actions (no SNS topic), alarms in INSUFFICIENT_DATA, single-period evaluation windows |
| **Grafana** | Paused alert rules, rules missing routing labels, rules without runbook or description annotations |
| **Datadog** | Monitors with no notification recipients, indefinitely muted monitors, no-data policy not set, monitors without tags |
| **PagerDuty** | Disabled services, services without escalation policies, empty escalation rules, services without integrations |

Each finding includes the resource name, health status (ok / info / warning / critical), and a suggested fix.

### Export

Export the current filtered timeline as JSON for postmortems, scripting, or piping into other tooling.

</details>

---

<details>
<summary>API endpoints</summary>

## API endpoints

The backend runs on port `8000`. In Docker, nginx proxies everything from port `3000` so the backend is never directly reachable from the host. In dev mode, Vite proxies to port `8000`.

| Endpoint | Method | Rate limit | Description |
|----------|--------|------------|-------------|
| `/health` | GET | 60/min | Liveness check |
| `/timeline` | GET | 30/min | Unified event feed from all configured sources |
| `/analyze` | POST | 5/min | AI root-cause analysis — hits a real AI API |
| `/sources/status` | GET | 60/min | Which integrations are configured (no credentials exposed) |
| `/audit` | GET | 10/min | Cross-source config health check |
| `/audit/alarms` | GET | 10/min | CloudWatch-only alarm audit (backwards compat) |
| `/services` | GET | 30/min | All services from `services.yml` with live health |
| `/services/{id}` | GET | 30/min | Single service with full health detail |
| `/services/{id}/timeline` | GET | 30/min | Timeline scoped to one service |
| `/oncall` | GET | 60/min | Current on-call from PagerDuty |
| `/incidents/active` | GET | 60/min | Active PagerDuty incidents |
| `/discover` | GET | 10/min | Scan integrations and suggest `services.yml` — read-only |
| `/discover/save` | POST | 10/min | Write suggested YAML to `services.yml` (backs up first) |
| `/github/deploy-diff` | GET | 30/min | Commits and PRs between two Git refs |

Rate limit violations return HTTP `429`. Limiting is per client IP via slowapi. One broken integration never blocks the others — `/timeline` and `/audit` return partial results with an `errors` key when a source fails.

</details>

---

<details>
<summary>Architecture</summary>

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser                        │
│   React 18 + Vite · IBM Plex fonts               │
│   localStorage · dark/light theme               │
└──────────────────┬──────────────────────────────┘
                   │ HTTP (relative URLs)
┌──────────────────▼──────────────────────────────┐
│              nginx  (port 3000)                  │
│  • Serves compiled React SPA from /dist          │
│  • SPA fallback → index.html                     │
│  • Proxies /timeline /analyze /health /audit     │
│    /sources /services /oncall /incidents         │
│    /discover /github → backend:8000              │
│  • Security headers · gzip · 1-year asset cache  │
└──────────────────┬──────────────────────────────┘
                   │ Internal Docker network only
┌──────────────────▼──────────────────────────────┐
│         FastAPI  (Python 3.11, port 8000)        │
│                                                  │
│  Connectors (async, parallel per request):       │
│    CloudWatch · GitHub · Grafana                 │
│    PagerDuty  · Datadog                          │
│                                                  │
│  Service Map:                                    │
│    services_config.py — loads services.yml,      │
│    enriches with live health from connectors     │
│    discovery.py — scans APIs, generates YAML     │
│                                                  │
│  AI (pluggable via AI_PROVIDER):                 │
│    OpenRouter · OpenAI · Anthropic · Ollama      │
│    Azure OpenAI · Groq · Mistral · + more        │
│                                                  │
│  Rate limiting via slowapi (per client IP)       │
└─────────────────────────────────────────────────┘
```

### Adding a connector

One file, two methods:

```python
# backend/connectors/myservice.py
class MyServiceConnector:
    async def fetch(self, start: datetime, end: datetime) -> list[TimelineEvent]:
        # call the API, normalize to TimelineEvent, return list
        ...

    async def audit(self) -> dict:   # optional — enables Config Audit for this source
        # { "configured": bool, "items": [...], "summary": {total,ok,warning,critical,info} }
        ...
```

Then in `backend/main.py`: add a factory, add to `/timeline` tasks, add to `/audit` if audit is implemented, add to `/sources/status`. Add a `SOURCE_META` entry in `frontend/src/constants.js` for the badge.

### Adding an AI provider

Implement the `AIProvider` ABC (see `AnthropicProvider` for a non-OpenAI-compatible example) and add a branch in `get_ai_provider()`. If the provider has a standard OpenAI chat-completions endpoint, just add entries to `BASE_URLS` and `DEFAULT_MODELS` — no new class needed.

</details>

---

<details>
<summary>Contributing</summary>

## Contributing

PRs welcome. For bug fixes and docs, just open a PR. For new connectors, AI providers, or significant features, open an issue first — saves time on both sides. See `CONTRIBUTING.md` for the full guide.

### Running tests

```bash
cd backend
pip install -r requirements-test.txt
pytest
```

Tests cover the main API routes, AI provider abstraction, and CloudWatch/GitHub connectors. Integration tests that hit live APIs are skipped automatically when credentials aren't present in `.env`.

CI runs on every push via `.github/workflows/ci.yml`.

</details>

---

<details>
<summary>Security</summary>

## Security

See `SECURITY.md`. Short version: never commit `.env` (it's gitignored), use read-only API credentials everywhere, and don't expose Fusenix to the public internet without an auth proxy or VPN in front of it. Fusenix has no built-in auth layer by design — the expectation is that network-level controls handle access.

</details>

---

<details>
<summary>License</summary>

## License

AGPL-3.0 — see [LICENSE](./LICENSE).

</details>
