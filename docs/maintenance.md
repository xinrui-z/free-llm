# Catalog and monitoring maintenance

Reviewed on 2026-11-16. This review used public official documents and model catalogs, not authenticated completion calls. Each provider JSON includes source URLs and retrieval dates. Source verification does not guarantee access for every account, region or model.

| Provider | Result and primary source |
| --- | --- |
| AIHubMix | Updated the documented recurring-free selection; omitted finite signup promotions. RPM and daily token caps must be checked per model. [Guide](https://docs.aihubmix.com/cn/blogs/free-ai-models) |
| OpenRouter | Replaced the free catalog with 14 currently published variants; refreshed surviving tracked paid prices. Numeric free caps were absent from the rendered limits documentation, so use the account's `/api/v1/key` response. [Catalog](https://openrouter.ai/api/v1/models) · [Limits](https://openrouter.ai/docs/api/reference/limits) |
| Groq | Selected GPT-OSS 120B/20B and Qwen 3.8 27B from the current free-plan table. Older Llama entries are marked Enterprise. [Models](https://console.groq.com/docs/models) · [Limits](https://console.groq.com/docs/rate-limits) |
| Cohere | Replaced retired Command aliases with current IDs. The monthly 1,000-call evaluation cap is not a fixed 33-RPD limit. [Models](https://docs.cohere.com/docs/models) · [Limits](https://docs.cohere.com/docs/rate-limits) |
| BigModel | Updated the explicitly zero-priced GLM Flash text/vision selection. Zero token price does not establish unlimited requests. [Pricing](https://docs.bigmodel.cn/cn/guide/start/pricing) |
| Google AI Studio | Updated selected text/vision models with an explicit free tier; paid figures are for standard text input. Gemini 3.8/3.6 Flash promotional prices require another review by 2026-12-31. [Pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| SambaNova | Current documented free models have 20 RPM, 20 RPD and 200,000 TPD; excluded preview models without a documented free allowance. [Limits](https://docs.sambanova.ai/docs/en/models/rate-limits) |
| GitHub Models | Archived: all service features retired on 2026-07-30. [Notice](https://docs.github.com/en/github-models) |
| Hugging Face | Archived: free accounts receive no monthly Inference Providers credits. [Pricing](https://huggingface.co/docs/inference-providers/pricing) |
| Cerebras | Archived: $5 trial expires in 30 days and requires a verified payment method; no recurring free tier. [Limits](https://inference-docs.cerebras.ai/support/rate-limits) |
| Mistral | Archived: free mode excludes API access. Paid models/prices remain in the comparison. [Usage](https://docs.mistral.ai/admin/billing-usage/usage-limits) · [Prices](https://docs.mistral.ai/inference/pricing) |
| Ollama Cloud | Archived: cloud inference is token-priced, including the $0 subscription plan. Local inference is still free. [Pricing](https://ollama.com/pricing) |

## Which mode you are maintaining

The repository supports two catalog modes, selected by the repository variable `CATALOG_MODE` (default `static`). Check which one production uses before editing: in dynamic mode the provider JSON files are no longer the live catalog. The checker's public `/api/catalog` reports `revision: "legacy"` when it has no D1 binding.

| | Static mode | Dynamic mode |
| --- | --- | --- |
| Live catalog | `site/src/data/providers/*.json` in `main` | D1 catalog revisions in the private checker |
| Model updates | `sync-catalog.yml` commits generated changes | Checker cron syncs sources (every 6h) and discovery (daily) |
| Manual edits | Pull request to the JSON files | Maintained in the private checker |
| Changelog | `changelog.json` + `gen-changelog.mjs` → checker KV | D1 `catalog_change` / `status_change` events |
| Site | Prerendered, Cloudflare Pages | Request-time rendering, Cloudflare Workers |

## Static mode

Use Node 24. Preview the configured public sources, then apply validated changes:

```bash
npm run catalog:sync
npm run catalog:sync -- --write
npm run check
```

For a reproducible review of an already downloaded response (preview only; `--from` never writes):

```bash
npm run catalog:sync -- --provider openrouter --from /path/to/models.json --date YYYY-MM-DD
```

OpenRouter updates its free model selection and existing curated paid prices. AIHubMix discovery produces pending candidates without changing free eligibility; catalogued models missing upstream are reported as warnings but never removed automatically. The legacy OpenRouter command also defaults to preview; add `--write` to apply. Machine updates preserve the policy's `last_verified` date and use a separate `catalog_checked_at` date, written only when the catalog content actually changes. Empty, incomplete and unusually large changes are blocked; missing models require spaced confirmation. See [automatic catalog maintenance](automatic-catalog.md) for scheduling, evidence, ownership and recovery rules.

For manual provider changes, update `sources` with the exact URL, label and `checked_at`, and update `last_verified` only after reviewing the represented claims (never just because an API call or sync succeeded). Active providers must have at least one source. Keep monthly credit/token budgets in `quota_note`; never convert them into invented daily request limits. `pricing` values are per million tokens, with `source_url` and `checked_at`; time-limited promotional prices also set `valid_until` (last day, YYYY-MM-DD). `npm run validate` warns 30 days before that date and fails once it has passed, so PR validation turns red until someone updates or removes the price; the site labels such prices as promotional. Scheduled syncs, deployments (`CATALOG_ALLOW_EXPIRED=1` / `validate.mjs --allow-expired`) and `build-providers-bundle.mjs` only warn about expired prices, so one provider's deadline cannot block unrelated releases or local tooling. An active provider whose `last_verified` is more than 90 days old also produces a warning.

Deployment (`.github/workflows/deploy.yml`) runs on pushes to `main` and on dispatch from the catalog sync:

1. `verify` runs `npm run check` and both browser suites, then uploads the built site.
2. `sync-providers` replaces the checker's KV catalog with the complete provider bundle (`PUT /api/providers`) and the curated changelog (`POST /api/changelog/replace`). It then appends generated catalog changelog entries with `gen-changelog.mjs`, comparing against the head of the most recent deployment whose append step succeeded, so a superseded queued run does not lose changes. If no valid base exists it warns and skips the generated entries; the deployment continues. A push (not a catalog dispatch) also triggers one authorized probe refresh.
3. `deploy-site` publishes `site/dist` to Pages.

`gen-changelog.mjs` reads `WORKER_URL` and `REFRESH_SECRET` from the environment only. The legacy checker probes each provider once per hour.

## Dynamic mode

The live catalog is maintained in the private checker and served read-only from `/api/catalog`; its operations runbook lives with the private infrastructure. In this repository:

- `sync-catalog.yml` and the deployment's KV catalog replacement are skipped. The deployment still posts `changelog.json` to the checker ("Sync curated changelog (dynamic)"), which keeps those entries permanently. The site Worker deploys only after the checker's `/api/catalog` returns a non-legacy revision with providers.
- The provider JSON files are the checker's seed and the site's bundled fallback snapshot. Maintainers refresh them from the live catalog through a pull request.

## Checks and deployment

- `npm run check` validates data, runs logic regressions, checks Astro types and builds the production site.
- `npm --prefix site run test:e2e` builds and tests static pages separately. Install Chromium first with `cd site && npx playwright install chromium`; local runs can instead point `PW_CHROME_PATH` at an installed Chrome (for example `PW_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`). The dynamic suite (`npm --prefix site run test:dynamic`) runs its fake catalog API on `CATALOG_TEST_PORT` (default 4334).
- PRs and main-branch deployments run these checks. PR validation uploads Playwright results on failure.
- The frontend shows `unknown` until it obtains a recent snapshot. A provider's observations count as fresh for its `fresh_ms` window from `/api/status` (dynamic mode: at least 2 hours, longer for providers probed less often), otherwise two hours. No Worker URL is required for the static directory or checked-in changelog.
- The checker Worker is private and deployed separately; publishing this repository does not deploy it. Its `/api/catalog` reports the public commit it was built from as `source_sha`.
- `REFRESH_SECRET` is a deployment-only credential: the checker accepts it solely for catalog/changelog sync and probe refresh, and every request fails closed without it. It grants no management access. Public status reads never trigger upstream completions. Probe 4xx errors are account/model/quota issues (`unknown`), rather than provider-wide outages.

The project uses Astro 7. `.node-version` and CI select Node 24; use Node 24 or later locally. No production deployment is performed by the local maintenance commands above.
