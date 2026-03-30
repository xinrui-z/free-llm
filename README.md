# Free LLM APIs

**[English](README.md)** · [中文](README-CN.md)

Real-time status monitoring for free LLM API providers — live status, latency, rate limits, and 90-day uptime history, updated hourly.

**Website: https://free-llm-apis.pages.dev**

[![Live Site](https://img.shields.io/badge/Live_Site-free--llm--apis.pages.dev-22c55e?style=flat-square)](https://free-llm-apis.pages.dev)
[![Providers](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Ffree-llm-apis.pages.dev%2Fdata%2Fstatus_summary.json&query=%24.total&label=providers&style=flat-square&color=3b82f6)](https://free-llm-apis.pages.dev/providers)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

---

## Overview

Each provider page shows current status, response latency, RPM / RPD limits, model list, and a 90-day uptime heatmap. A Cloudflare Worker checks every provider hourly and writes results to KV.

### Pages

| Page | Description |
|------|-------------|
| `/` | Status dashboard — real-time grid of all providers |
| `/providers` | Provider list with search, filters, and sort |
| `/providers/{id}` | Detail: models, rate limits, code examples, uptime heatmap |
| `/configs` | Config export for LiteLLM, Cursor, LobeChat, Open WebUI |
| `/changelog` | Provider status changes and model updates |

---

## Features

- **Hourly health checks** — runs on a cron schedule via Cloudflare Workers
- **90-day uptime heatmap** — per-provider history, one cell per day
- **Automated changelog** — outages, recoveries, and model changes are detected and logged without manual intervention
- **Config export** — download ready-to-use YAML / JSON / TOML for popular LLM tools
- **OpenAI-compatible** — all listed providers use the `/v1/chat/completions` format

---

## Contributing

To add or update a provider, edit [`site/src/data/providers.json`](site/src/data/providers.json) and open a Pull Request. CI runs the schema validator automatically on every PR.

### Steps

1. Fork this repository
2. Add your entry to `site/src/data/providers.json`
3. Run `npm run validate` locally to check the schema
4. Open a Pull Request

### Provider schema

```jsonc
{
  "id": "my-provider",              // unique slug: lowercase letters, digits, hyphens
  "name": "My Provider",            // display name shown on the site
  "description": "One-line description of what this provider offers.",
  "base_url": "https://api.example.com/v1",  // no trailing slash
  "signup_url": "https://example.com/keys",
  "website_url": "https://example.com",
  "logo": "https://example.com/logo.svg",    // square SVG preferred
  "status": "active",               // active | archived
  "latency_ms": null,               // leave null — filled by the checker
  "rpm": 20,                        // requests per minute (null if unknown)
  "rpd": 200,                       // requests per day (null if unknown)
  "context_window": "128K",         // largest context window across all models
  "auth": "required",               // required | optional | none
  "tags": ["openai-compatible"],
  "top_models": ["model-id-1", "model-id-2"],  // 1–5 featured model IDs
  "models": [
    {
      "id": "model-id-1",           // model ID used in API requests
      "name": "Model Name",
      "context_window": "128K",
      "modalities": ["text"],       // text | vision | code | embedding
      "rpm": 20,
      "rpd": 200,
      "status": "active"            // active | deprecated
    }
  ],
  "last_verified": "2026-03-30",    // YYYY-MM-DD — date you verified this data
  "geo_restrictions": [],           // e.g. ["requires-vpn-in-china"]
  "api_key_env": "MY_PROVIDER_API_KEY"  // name of the secret in the checker worker's env
}
```

**Available tags:** `openai-compatible` · `aggregator` · `multi-provider` · `china-available` · `vision` · `thinking` · `function-call` · `deepseek` · `llama` · `embedding`

### Checklist before submitting

- [ ] `id` is unique and uses only lowercase letters, digits, and hyphens
- [ ] `base_url` has no trailing slash
- [ ] `top_models` only lists IDs that also appear in the `models` array
- [ ] `last_verified` is today's date
- [ ] The provider has a permanently free tier, not just trial credits
- [ ] `api_key_env` is set to the Cloudflare Worker secret name for this provider's API key

---

## Local development

```bash
cd site
npm install
npm run dev   # http://localhost:4321
```

The dev server reads from static `providers.json`. For live status from the checker worker, create `site/.env.local`:

```
PUBLIC_STATUS_WORKER_URL=https://free-llm-checker.YOUR_SUBDOMAIN.workers.dev
```

To validate data files without starting the dev server:

```bash
# run from the repo root
npm run validate
```

---

## Self-hosting

The project runs entirely on Cloudflare's free tier.

### 1. Frontend (Cloudflare Pages)

```bash
cd site
npm run build
npx wrangler pages deploy dist --project-name=your-project-name
```

Set this environment variable in the Cloudflare Pages dashboard:

| Variable | Value |
|----------|-------|
| `PUBLIC_STATUS_WORKER_URL` | URL of your deployed checker worker |

### 2. GitHub Actions secrets

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Deploy to Cloudflare Pages |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `PUBLIC_STATUS_WORKER_URL` | Injected at build time for the SSR status snapshot |
| `WORKER_URL` | Used by the changelog generation script |
| `REFRESH_SECRET` | Protects the `/api/refresh` endpoint |

The checker worker (`checker-worker/`) is not included in this repository. It is private infrastructure that runs the health checks and serves `/api/status` and `/api/changelog`. You can implement a compatible API yourself, or omit `PUBLIC_STATUS_WORKER_URL` to run the site in static mode.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | [Astro](https://astro.build) v6 + [Tailwind CSS](https://tailwindcss.com) v4 |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com) |
| Health checks | Cloudflare Workers + KV (hourly cron, private) |
| CI/CD | GitHub Actions |
| Data | Static JSON in `site/src/data/` + live KV snapshot |

---

## Architecture

```
GitHub repo (providers.json)
        │
        ▼ push to main
  GitHub Actions
  ├── validate.mjs      — schema check on every PR
  ├── sync → Worker KV  — update the live provider catalog
  ├── gen-changelog.mjs — diff git history, push changelog entries
  └── astro build → Cloudflare Pages

Cloudflare Worker (private, hourly cron)
  ├── checks each provider's /v1/chat/completions endpoint
  ├── stores status and latency in KV
  └── serves /api/status and /api/changelog

Browser
  └── fetches /api/status on load → updates status badges without a full rebuild
```

---

## License

[MIT](LICENSE) © 2026
