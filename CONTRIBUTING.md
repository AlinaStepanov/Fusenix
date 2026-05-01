# Contributing to Fusenix

Thanks for your interest in contributing! Fusenix is a read-only incident timeline aggregator — contributions that make it easier to connect new sources, improve AI analysis, or reduce setup friction are especially welcome.

-----

## Before you open a PR

- **Bug fixes and docs** — go ahead and open a PR directly.
- **New connectors or AI providers** — open an issue first to coordinate. This avoids duplicate work and lets us agree on the connector interface before you write it.
- **New features or significant changes** — open an issue describing what you want to build and why. A quick discussion saves everyone time.

-----

## Development setup

```bash
git clone https://github.com/AlinaStepanov/Fusenix
cd Fusenix

cp .env.example .env
# fill in credentials for the sources you want to test against

# Backend
cd backend && pip install -r requirements.txt
uvicorn main:app --reload --port 8003

# Frontend (new terminal, from repo root)
npm install && npm run dev
# open http://localhost:3000
```

Or with Docker:

```bash
docker compose up --build
```

-----

## Adding a connector

A connector is a single Python file in `backend/connectors/`. The interface is intentionally small:

```python
# backend/connectors/myservice.py
class MyServiceConnector:
    async def fetch(self, start: datetime, end: datetime) -> list[TimelineEvent]:
        """Return timeline events within the given range."""
        ...

    async def audit(self) -> dict:
        """Optional — implement for Config Audit support."""
        ...
```

A complete connector PR must include:

|File                             |What to add                                                                                  |
|---------------------------------|---------------------------------------------------------------------------------------------|
|`backend/connectors/myservice.py`|Connector class with `fetch()` and, where possible, `audit()`                                |
|`backend/main.py`                |Factory function, `/timeline` route update, `/audit` endpoint update, `/sources/status` entry|
|`.env.example`                   |All new variables with inline documentation and example values                               |
|`src/constants.js`               |Source badge entry (label, colour, icon)                                                     |
|`README.md`                      |Row in the “What it connects” table and configuration section                                |

Connectors must handle missing credentials gracefully — if the required env vars are not set, the source should be silently skipped (not crash the backend).

-----

## Adding an AI provider

Implement the `AIProvider` abstract base class. See `AnthropicProvider` in `backend/ai/` for a non-OpenAI-compatible example. Then add a branch in `get_ai_provider()` in `backend/main.py`.

-----

## Code style

**Python** — the backend follows standard Python conventions. Run `ruff check backend/` before submitting. Type annotations are expected for all public methods.

**JavaScript/React** — the frontend uses standard React 18 patterns. No extra lint config is enforced right now; just match the style of the surrounding code.

Keep connector logic isolated to its own file. Avoid adding shared state or cross-connector dependencies.

-----

## Running tests

```bash
cd backend
pip install -r requirements-test.txt
pytest
```

Tests cover the main API routes, the AI provider abstraction layer, and individual connectors (CloudWatch, GitHub). Integration tests that call live APIs are skipped automatically when the relevant credentials aren't in `.env` — you don't need real accounts to run the suite.

CI runs on every push. If you're adding a connector, add tests for the `fetch()` method at minimum. Use the existing `test_cloudwatch.py` as a reference for how to mock API responses.

-----

## Commit messages

Plain English, imperative mood, present tense. Examples:

```
Add Splunk connector with fetch() and audit()
Fix CloudWatch rate-limit retry on 429
Update .env.example with GRAFANA_ORG_ID documentation
```

No ticket numbers or emoji required.

-----

## Pull request checklist

- [ ] Issue opened (if adding a connector, AI provider, or significant feature)
- [ ] New connector includes both `fetch()` and `audit()` where applicable
- [ ] `.env.example` updated and documented
- [ ] `README.md` updated if user-facing behaviour changed
- [ ] Credentials are never logged or included in responses
- [ ] Unconfigured sources are silently skipped, not erroring

-----

## Reporting bugs

Open a GitHub issue. Include:

- What you did
- What you expected to happen
- What actually happened
- Relevant log output (redact credentials and internal hostnames)
- Your OS, Python version, and Node version

-----

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).