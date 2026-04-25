## What does this PR do?

<!-- One or two sentences. What changed and why. -->

## Type of change

- [ ] Bug fix
- [ ] New connector
- [ ] New AI provider
- [ ] UI / timeline improvement
- [ ] Config Audit improvement
- [ ] Docs / configuration
- [ ] Other: <!-- describe -->

## Checklist

- [ ] I opened an issue first (required for new connectors, AI providers, and significant features)
- [ ] Connector includes both `fetch()` and `audit()` where applicable
- [ ] `.env.example` updated with all new variables, documented with examples
- [ ] `README.md` updated if user-facing behaviour changed
- [ ] `src/constants.js` updated with source badge (new connectors only)
- [ ] Credentials are never logged or returned by any endpoint
- [ ] Unconfigured sources are silently skipped, not erroring

## Testing

<!-- How did you verify this works? Which sources / AI providers did you test against?
     If you can't test against a live service, say so. -->

## Screenshots or output

<!-- Optional but helpful for UI changes or new connectors. -->