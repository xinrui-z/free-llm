# Free LLM APIs

**[English](README.md)** · [中文](README-CN.md)

Free LLM API directory with sourced limits, prices and probe monitoring, including status, latency and 90-day daily probe history.

**Website: https://free-llm-site.free-llm-status.workers.dev**

[![Live Site](https://img.shields.io/badge/Live_Site-free--llm--site.free--llm--status.workers.dev-22c55e?style=flat-square)](https://free-llm-site.free-llm-status.workers.dev)
[![Providers](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Ffree-llm-site.free-llm-status.workers.dev%2Fdata%2Fstatus_summary.json&query=%24.total&label=providers&style=flat-square&color=3b82f6)](https://free-llm-site.free-llm-status.workers.dev/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

---

## Overview

Each provider page shows current status, response latency, RPM / RPD limits, model list, sources and a 90-day daily probe history. Provider data comes from official documents and model APIs; health comes from a private Cloudflare checker Worker. Browsers refresh status every 5 minutes while the tab is visible.

### Pages

| Page | Description |
|------|-------------|
| `/` | Provider directory: quickest first calls, then every free provider with search, filters and sort, plus recent changes |
| `/providers` | Redirects to `/`, keeping the query string (301 in dynamic mode; JS or meta refresh in static mode) |
| `/providers/{id}` | Detail: models, rate limits, sources, code examples and daily probe history |
| `/models` | Browse model families and published free quotas |
| `/pricing` | Compare sourced per-token prices with verification dates, grouped by currency |
| `/configs` | Tools: LiteLLM config for the providers you pick, and the values to paste into Open WebUI, LobeChat and Cursor |
| `/changelog` | Provider status changes and model updates |
| `/changelog.json` | Machine-readable changelog feed, newest first |
| `/data/status_summary.json` | Catalog counts (`total` = active providers, used by the badge); no probe health |

---

## Features

- **Health checks** — dynamic mode: the checker cron runs every 15 minutes and probes sampled models within per-provider budgets; legacy mode: one check per provider every hour
- **90-day daily probe history** — per-provider history, one cell per day
- **Automated catalog maintenance** — official model APIs are collected on a schedule; only material changes are written ([details](docs/automatic-catalog.md))
- **Automated changelog** — model/provider additions and removals and status changes are recorded automatically; hand-written entries live in `site/src/data/changelog.json`
- **Tools** — download a LiteLLM YAML config for the providers you pick, or copy base URLs, model IDs and key names for Cursor, LobeChat and Open WebUI
- **OpenAI-compatible** — all listed providers use the `/v1/chat/completions` format

---

## What counts as free

A provider is listed as `active` only when its official documentation describes a **recurring** free API allowance (daily/monthly quota or explicitly zero-priced models). One-off trial credits, signup promotions and finite budgets that expire do not qualify; such providers are `archived` with an `archive_reason` and their sources. `auth: credit_card_required` marks a free tier that needs a payment method on file.

Evidence rules:

- `sources` is optional: an array of official HTTPS URLs with a label and `checked_at` date, kept for maintainers (not shown on the site). When present it must be nonempty and valid.
- Missing, blank or boolean prices never count as zero. A model API's `:free`/`-free` suffix alone is not evidence; automated free classification also requires explicit zero billing values.
- A `null` RPM/RPD means unpublished or account-dependent, never unlimited. Monthly credit or token budgets go in `quota_note`, not invented daily request limits.
- Catalog `active` means listed, not operational. Health checks sample specific models with the monitoring account; missing or stale observations and account/quota errors (401/402/403/429) are `unknown`, not outages. Daily history records the worst result each day; the percentage is healthy days / observed days, not a time-based uptime SLA.

---

## Contributing

In static mode, each provider is a single JSON file under [`site/src/data/providers/`](site/src/data/providers/). To add or update a provider, edit (or create) the matching file and open a Pull Request. CI runs the validator on every PR. In dynamic mode these files are the seed and fallback snapshot for the live catalog, which maintainers update and periodically export back into this directory.

### Steps

1. Fork this repository
2. **Add a provider** — create `site/src/data/providers/<id>.json` (see schema below) and append `<id>` to `_order.json` to control display position
3. **Update a provider** — edit `site/src/data/providers/<id>.json`
4. Run `npm run validate` locally
5. Open a Pull Request

### Provider schema

The authoritative rules are in [`scripts/lib/catalog-validation.mjs`](scripts/lib/catalog-validation.mjs), shared by the CLI, sync jobs, site and checker Worker.

```jsonc
{
  "id": "my-provider",              // slug matching the filename: lowercase letters, digits, hyphens
  "name": "My Provider",
  "description": "One-line description.",   // text fields must be strings
  "base_url": "https://api.example.com/v1",  // HTTPS, no trailing slash, no {placeholders}
  "signup_url": "https://example.com/keys",  // optional, HTTPS
  "website_url": "https://example.com",      // optional, HTTPS
  "logo": "https://example.com/logo.svg",    // optional, HTTPS; square SVG preferred
  "status": "active",               // active | archived
  "auth": "required",               // required | optional | none | credit_card_required
  "latency_ms": null,               // leave null — filled by the checker
  "rpm": 20,                        // provider-wide requests per minute, or null if unpublished
  "rpd": 200,                       // provider-wide requests per day, or null if unpublished
  "context_window": "128K",         // optional string: largest context window
  "tags": ["openai-compatible"],
  "top_models": ["model-id-1"],     // 1–5 unique IDs of active (non-deprecated) entries in models
  "model_order": ["model-id-1"],    // optional: models shown first on the provider page; the rest follow models order
  "models": [                       // nonempty; IDs unique; array order is display order (synced: upstream API order)
    {
      "id": "model-id-1",           // model ID used in API requests
      "name": "Model Name",
      "context_window": "128K",     // optional string
      "modalities": ["text"],       // text | vision | code | embedding
      "rpm": 20,                    // nonnegative number or null
      "rpd": 200,
      "status": "active",           // active | deprecated
      "pricing": {                  // optional: standard paid price per million tokens
        "input_per_million": 0.5,
        "output_per_million": 1.5,
        "currency": "USD",          // ISO 4217 code
        "source_url": "https://example.com/pricing",
        "checked_at": "2026-11-16", // not in the future
        "valid_until": "2026-12-31" // optional: last day of a promotional price
      }
    }
  ],
  "paid_models": [],                // optional, same shape; curated paid comparison, IDs must not repeat models
  "sources": [                      // optional; nonempty when present
    { "label": "Official free tier", "url": "https://example.com/pricing", "checked_at": "2026-11-16" }
  ],
  "last_verified": "2026-11-16",    // YYYY-MM-DD: date the policy claims were reviewed
  "catalog_checked_at": "2026-11-16", // optional; written by automated catalog sync
  "quota_note": "Monthly credits…", // optional strings: quota_note, catalog_note, archive_reason, pricing_note
  "geo_restrictions": [],           // e.g. ["requires-vpn-in-china"]
  "api_key_env": "MY_PROVIDER_API_KEY" // optional: checker secret name (must be on the Worker's allowlist)
}
```

`last_verified`, `catalog_checked_at` and every `checked_at` must be real dates and not in the future (one day of timezone grace). `npm run validate` prints `warning:` lines without failing for an active provider whose `last_verified` is more than 90 days old and for prices expiring within 30 days. A `valid_until` in the past fails PR validation until the price is updated or removed; deployments and scheduled syncs only warn. Validation also checks `_order.json`, `changelog.json` provider IDs, `catalog/sources.json` and `catalog/state/*.json`. When deleting a provider that `changelog.json` still mentions, add its ID to `REMOVED_PROVIDER_IDS` in the validation library.

**Available tags:** `openai-compatible` · `aggregator` · `multi-provider` · `china-available` · `vision` · `thinking` · `function-call` · `deepseek` · `llama` · `embedding`

### Checklist before submitting

- [ ] `id` is unique and uses only lowercase letters, digits, and hyphens
- [ ] `base_url` is HTTPS with no trailing slash
- [ ] `top_models` only lists active IDs from the `models` array
- [ ] `sources` links the official pages behind every free-tier, quota and price claim
- [ ] `last_verified` is the date you reviewed those claims, updated only after a review (see [maintenance](docs/maintenance.md))
- [ ] The provider has a recurring free tier, not just trial credits
- [ ] `api_key_env`, if set, names a secret on the checker Worker's allowlist

---

## Development

Use **Node.js 24** or later (see `.node-version`).

```bash
npm ci --prefix site
npm run check
cd site
npx playwright install chromium   # or set PW_CHROME_PATH to an installed Chrome
npm run test:e2e                  # static pages
npm run test:dynamic              # dynamic mode against a fake catalog API
npm run dev                       # http://localhost:4321
```

`npm run check` runs catalog validation, logic regressions, Astro type checking and a production build. Browser tests use separate build directories and mocked monitoring endpoints, so they spend no provider quota.

The dev server reads `site/src/data/providers/` (aggregated by `index.ts`). For live status from a checker Worker, copy `site/.env.local.example` to `site/.env.local` and set `PUBLIC_STATUS_WORKER_URL`.

`npm run catalog:sync` previews changes from the configured official model APIs; add `--write` to save them. See [automatic catalog maintenance](docs/automatic-catalog.md).

### Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `CATALOG_MODE` | Repository variable / build env | `static` (default) or `dynamic`; any other value fails the build |
| `PUBLIC_STATUS_WORKER_URL` | Repository secret / build env / `site/.env.local` | Checker origin for browser status and changelog requests; dynamic-mode catalog fallback |
| `CATALOG_API_URL` | Site Worker runtime variable (or build env) | HTTP catalog API origin for dynamic rendering when the Worker has no `CHECKER` service binding (`astro dev`, or a build with `CATALOG_CHECKER_BINDING=off`); defaults to `PUBLIC_STATUS_WORKER_URL` |
| `CATALOG_CHECKER_BINDING` | Build env | `on` (default) or `off`; `off` builds a dynamic site that ignores the `CHECKER` binding and always uses `CATALOG_API_URL` |
| `CATALOG_CACHE_TTL_MS` | Site Worker runtime variable (or build env) | Dynamic-mode per-isolate catalog cache, default 60000; `0` disables |
| `PUBLIC_SITE_URL` | Repository variable / build env | Canonical site URL for canonical links, sitemap and `robots.txt` |
| `CATALOG_ALLOW_EXPIRED` | Build env | `1` makes expired promotional prices warnings instead of errors (deploy and sync use this) |
| `CATALOG_TEST_PORT` | Local e2e | Port of the dynamic suite's fake catalog API (default 4334) |
| `PW_CHROME_PATH` | Local e2e | Use an installed Chrome instead of Playwright's Chromium |

---

## Self-hosting

The project runs on Cloudflare's free tier.

### Static mode (default)

```bash
npm ci --prefix site
npm --prefix site run build
cd site && npx wrangler pages deploy dist --project-name=your-project-name
```

The site is prerendered from the provider JSON files and deployed to Cloudflare Pages; it works without any Worker (status shows unknown). Set `PUBLIC_STATUS_WORKER_URL` at build time for live status.

### Dynamic mode

Pages are rendered on Cloudflare Workers from a catalog API (`GET /api/catalog`), so new providers appear without a rebuild. Set `CATALOG_MODE=dynamic`. The `free-llm-site` Worker reads the catalog from the `free-llm-checker` Worker through the `CHECKER` service binding in [`site/wrangler.jsonc`](site/wrangler.jsonc), because a `workers.dev` Worker cannot fetch another `workers.dev` Worker on the same account; deploy the checker first. Browsers still call the checker's public `/api/status` and `/api/changelog` over HTTPS. Without the binding (`astro dev`) the site uses `CATALOG_API_URL`. A production build keeps the binding in a local preview as well, so without a running `free-llm-checker` the preview shows the bundled snapshot; build with `CATALOG_CHECKER_BINDING=off` for a preview that reads `CATALOG_API_URL`. If the catalog is unreachable or invalid, pages fall back to the last validated catalog and then to the bundled provider JSON, with a visible notice.

After the dynamic cutover the site is served at https://free-llm-site.free-llm-status.workers.dev, and https://free-llm-apis.pages.dev redirects there with a 301 (see [`redirect/`](redirect/README.md)). The links at the top of this README change at cutover.

### GitHub Actions secrets

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Deploy to Cloudflare Pages (static) or Workers (dynamic) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `PUBLIC_STATUS_WORKER_URL` | Build-time public checker URL used by browser status requests |
| `WORKER_URL` | Checker URL for the deployment's catalog/changelog sync and probe refresh |
| `REFRESH_SECRET` | Deployment-only credential: limited to catalog/changelog sync and probe refresh; it cannot reach any management route |

The checker Worker is not included in this repository. It is private infrastructure that runs the health checks and serves the public read-only `/api/status`, `/api/changelog` and `/api/catalog`. You can implement a compatible API yourself, or omit `PUBLIC_STATUS_WORKER_URL` to run the static site without live status.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | [Astro](https://astro.build) v7 + [Tailwind CSS](https://tailwindcss.com) v4 |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com) (static) or Cloudflare Workers (dynamic) |
| Health checks | Cloudflare Workers cron (private): KV in legacy mode, D1 + KV in dynamic mode |
| CI/CD | GitHub Actions |
| Data | JSON in `site/src/data/` and `catalog/`; D1 catalog revisions in dynamic mode |

---

## Architecture

```
sync-catalog.yml (static mode, manual; 6-hourly schedule ready to enable)
  ├── collect: fetch official model APIs, plan changes (read-only, no npm)
  ├── check:   npm run check on the generated changes
  └── publish: commit material changes; dispatch Deploy if provider files changed

GitHub repo (site/src/data/providers/*.json, catalog/)
        │ push to main / dispatch
        ▼
  Deploy workflow
  ├── npm run check + browser tests
  ├── static: sync catalog + changelog → checker KV, gen-changelog.mjs
  └── static: astro build → Pages  |  dynamic: astro build → Workers

Checker Worker (private, cron every 15 min)
  ├── legacy (no D1): checks each provider hourly, stores status in KV
  ├── dynamic (D1):   source sync, budgeted model probes
  └── serves read-only /api/status, /api/changelog, /api/catalog

Browser
  └── fetches /api/status → updates status badges without a rebuild
```

---

## License

[MIT](LICENSE) © 2026
