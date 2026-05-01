# Security Policy

## Scope

Fusenix is a self-hosted tool. You run it on your own infrastructure; Fusenix itself does not have servers, a SaaS deployment, or user accounts. The security boundary is therefore **your deployment** — the host running the backend, the network it is exposed on, and the credentials you provide via `.env`.

This policy covers the Fusenix codebase. It does not cover issues in upstream dependencies (report those to the respective projects) or misconfigurations in your own environment.

-----

## Credential handling

Fusenix reads secrets from environment variables at startup. A few things worth knowing:

- **Credentials are never returned by any API endpoint.** The `/sources/status` endpoint reports which integrations are configured (boolean) but does not expose keys or tokens.
- **Credentials are never logged.** If you find a code path that logs a secret, that is a bug — please report it.
- **All integrations are read-only by design.** Fusenix only calls read/list/get operations on connected services. It does not write, delete, or modify anything in any connected source.

You should treat the `.env` file and the host environment as sensitive. Restrict access accordingly.

-----

## Network exposure

By default, the backend binds to `localhost:8003` (dev) or is exposed via nginx on port 80 (Docker). Fusenix has no built-in authentication layer. **Do not expose it to the public internet** without adding authentication in front of it (e.g. an auth proxy, VPN, or firewall rule).

The backend applies rate limits to all endpoints — see the [API section in README.md](README.md#rate-limits) for details.

-----

## Supported versions

Only the latest commit on the `main` branch is actively maintained. There are no versioned releases yet — if you're running an older commit, update to `main` before reporting a vulnerability.

-----

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Report privately via GitHub’s built-in mechanism:

1. Go to the repository on GitHub.
1. Click **Security** → **Report a vulnerability**.
1. Fill in the details — what you found, how to reproduce it, and what the potential impact is.

Alternatively, email **alina.m.stepanov@gmail.com** with the subject line `[Fusenix] Security Report`. Use that address for initial contact only; follow-up will move to GitHub’s private advisory flow.

**What to include:**

- A clear description of the vulnerability
- Steps to reproduce (minimal config, exact requests, or a proof-of-concept script)
- Potential impact in a realistic self-hosted deployment
- Any suggested fix, if you have one

**What to expect:**

|                            |Target                                                             |
|----------------------------|-------------------------------------------------------------------|
|Acknowledgement             |Within 48 hours                                                    |
|Triage / severity assessment|Within 5 business days                                             |
|Fix or workaround           |Depends on complexity — communicated promptly                      |
|Credit                      |Offered in the release notes / advisory unless you prefer anonymity|

-----

## Out of scope

The following are **not** treated as security vulnerabilities in Fusenix:

- Rate limits being bypassable if Fusenix is deployed without a reverse proxy
- Issues that require an attacker to already have access to the host running Fusenix
- Vulnerabilities in third-party libraries (report upstream; we’ll update dependencies promptly if notified)
- Missing authentication — Fusenix is intentionally auth-free and relies on network-level controls

-----

## Dependency updates

If a dependency has a known CVE that affects Fusenix’s runtime behaviour, please report it using the process above and we’ll update promptly.