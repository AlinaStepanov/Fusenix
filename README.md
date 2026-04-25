# OpsBridge

**One screen for incident investigation.**

When something breaks in production, the context is scattered: alarms firing in CloudWatch, a suspicious deploy in GitHub, CI going red, metrics spiking. OpsBridge pulls all of it into a single chronological timeline so you can see *what happened in what order* — without switching between six tabs.

```
14:23  ◉ github      Deploy → production: v2.4.1 [SUCCESS]
14:31  ☁ cloudwatch  Alarm 'api-5xx-rate': → ALARM
14:31  ☁ cloudwatch  ELB 5xx spike: 847 errors (threshold 10)
14:33  ◉ github      CI: test suite [FAILURE] on main
14:35  ☁ cloudwatch  Log error [api-service]: TypeError: Cannot read...
```

Hit **AI Analysis** and the configured AI reads the timeline and tells you the likely root cause, contributing factors, and next steps — in under 10 seconds. Works with OpenRouter, Anthropic, OpenAI, Ollama, Groq, and any OpenAI-compatible endpoint.

---

## What it connects

| Source | What it pulls |
|--------|--------------|
| **AWS CloudWatch** | Alarm state changes, log errors, metric anomalies (ELB 5xx, EC2 CPU, RDS latency, Lambda errors) |
| **GitHub** | Commits, merged PRs, deployments, GitHub Actions runs |
| Grafana *(coming soon)* | Dashboard annotations, alert rules |
| PagerDuty *(coming soon)* | Incidents, on-call escalations |
| Datadog *(coming soon)* | Monitors, events |

## Why not just use [Datadog / Grafana / PagerDuty]?

Those tools are great but they each show their own slice. Datadog doesn't know about your GitHub deploys. PagerDuty doesn't show your log errors. Grafana doesn't know a revert commit just landed. OpsBridge is **read-only and source-agnostic** — it doesn't replace your existing stack, it just aggregates the timeline across all of it.

It's also free to self-host and takes about 5 minutes to configure.

---

## Quick start

```bash
git clone https://github.com/AlinaStepanov/OpsBridge
cd OpsBridge

cp .env.example .env
# edit .env — fill in your AWS keys, GitHub token, and AI provider credentials

# Backend
cd backend && pip install -r requirements.txt
uvicorn main:app --reload

# Frontend (new terminal)
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
CW_ALARM_PREFIX=prod-          # optional: filter alarms by prefix

# GitHub
GITHUB_TOKEN=ghp_...
GITHUB_REPOS=myorg/api,myorg/frontend

# CORS (defaults to localhost dev origins if unset)
ALLOWED_ORIGINS=https://opsbridge.example.com
```

You only need credentials for the sources you actually use — everything else is gracefully skipped. The UI shows a green dot next to each configured source.

### AI provider

Set `AI_PROVIDER` to your preferred backend, then fill in the matching credentials. The rest of the provider blocks are ignored.

```env
AI_PROVIDER=openrouter   # see table below for all options
```

| `AI_PROVIDER` | Required variable | Default model | Notes |
|---|---|---|---|
| `openrouter` | `OPENROUTER_API_KEY` | `openrouter/auto` | 200+ models; auto picks the best available |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` | |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-haiku-4-5-20251001` | Native Messages API |
| `ollama` | *(none)* | `llama3` | Local inference — run `ollama serve` first |
| `azure_openai` | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` | deployment name | |
| `groq` | `GROQ_API_KEY` | `llama3-8b-8192` | |
| `together` | `TOGETHER_API_KEY` | `mistralai/Mixtral-8x7B-Instruct-v0.1` | |
| `mistral` | `MISTRAL_API_KEY` | `mistral-small-latest` | |
| *(any name)* | `AI_API_KEY` + `AI_BASE_URL` | `AI_MODEL` | Custom OpenAI-compatible endpoint |

To override the model for any provider, set `AI_MODEL` (universal) or the provider-specific variable (e.g. `OPENROUTER_MODEL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`).

**Example — switch to local Ollama:**
```env
AI_PROVIDER=ollama
# AI_MODEL=mistral                            # override the default
# AI_BASE_URL=http://192.168.1.50:11434/v1   # if not running on localhost
```

**Example — custom OpenAI-compatible endpoint (vLLM, LM Studio, etc.):**
```env
AI_PROVIDER=my_provider
AI_BASE_URL=https://api.my-llm.internal/v1
AI_API_KEY=my-secret-key
AI_MODEL=my-model-name
```

---

## API

The backend runs on port `8000`. All endpoints are proxied through nginx in the Docker setup.

### `GET /health`
```json
{ "status": "ok", "time": "2026-04-24T14:31:00", "ai_provider": "openrouter" }
```

### `GET /timeline?start=<ISO8601>&end=<ISO8601>&sources=cloudwatch,github`
Returns a merged, chronologically sorted list of events from all requested sources.

### `POST /analyze`
Body: `{ "events": [...] }` (up to 500 events, same shape as timeline response)

Returns root-cause analysis from the configured AI provider:
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

### `GET /sources/status`
Reports which data sources and AI provider are configured, without exposing credentials.

### `GET /audit/alarms`
Returns CloudWatch alarm configurations flagged for misconfigurations (missing notifications, INSUFFICIENT_DATA state, stuck-in-ALARM, etc.).

### Rate limits
| Endpoint | Limit |
|---|---|
| `/timeline` | 30 / minute |
| `/analyze` | 5 / minute |
| `/audit/alarms` | 10 / minute |
| All others | 60 / minute |

---

## Contributing

The connector interface is intentionally small — if you want to add Grafana, PagerDuty, or anything else, look at `backend/connectors/github.py` as a template. A connector is just a class with one async method:

```python
async def fetch(self, start: datetime, end: datetime) -> list[TimelineEvent]:
    ...
```

To add a new AI provider, implement the `AIProvider` ABC in `backend/main.py` (see `AnthropicProvider` for a non-OpenAI-compatible example) and add a branch in `get_ai_provider()`.

PRs welcome. If you're adding a connector or provider, open an issue first so we can coordinate.

## License

MIT
