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

Hit **AI Analysis** and Claude reads the timeline and tells you the likely root cause, contributing factors, and next steps — in under 10 seconds.

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
git clone https://github.com/yourname/opsbridge
cd opsbridge

cp backend/.env.example backend/.env
# edit backend/.env — add your AWS keys, GitHub token, Anthropic key

# backend
cd backend && pip install -r requirements.txt
uvicorn main:app --reload

# frontend (new terminal)
cd opsbridge && npm install && npm run dev
# open http://localhost:3000
```

## Configuration

All config lives in `backend/.env`. You only need credentials for the sources you actually use — everything else is gracefully skipped.

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

# AI analysis (optional — Claude via Anthropic API)
ANTHROPIC_API_KEY=sk-ant-...
```

The UI shows a green dot next to each source that's configured and a ✕ for ones that aren't.

---

## Contributing

The connector interface is intentionally small — if you want to add Grafana, PagerDuty, or anything else, look at `backend/connectors/github.py` as a template. A connector is just a class with one `async def fetch(start, end) -> list[TimelineEvent]` method.

PRs welcome. If you're adding a connector, open an issue first so we can coordinate.

## License

MIT
