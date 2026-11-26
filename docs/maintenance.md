# Catalog and monitoring maintenance

Reviewed on 2026-11-16. This review used public official documents and model catalogs, not authenticated completion calls. Each provider JSON includes source URLs and retrieval dates. Source verification does not guarantee access for every account, region or model.

| Provider | Result and primary source |
| --- | --- |
| AIHubMix | Updated the documented recurring-free selection; omitted finite signup promotions. RPM and daily token caps must be checked per model. [Guide](https://docs.aihubmix.com/cn/blogs/free-ai-models) |
| OpenRouter | Replaced the free catalog with 14 currently published variants; refreshed surviving tracked paid prices. Numeric free caps were absent from the rendered limits documentation, so use the account's `/api/v1/key` response. [Catalog](https://openrouter.ai/api/v1/models) · [Limits](https://openrouter.ai/docs/api/reference/limits) |
| Groq | Selected GPT-OSS 120B/20B and Qwen 3.8 27B from the current free-plan table. Older Llama entries are marked Enterprise. [Models](https://console.groq.com/docs/models) · [Limits](https://console.groq.com/docs/rate-limits) |
| Cohere | Replaced retired Command aliases with current IDs. The monthly 1,000-call evaluation cap is not a fixed 33-RPD limit. [Models](https://docs.cohere.com/docs/models) · [Limits](https://docs.cohere.com/docs/rate-limits) |
| BigModel | Updated the explicitly zero-priced GLM Flash text/vision selection. Zero token price does not establish unlimited requests. [Pricing](https://docs.bigmodel.cn/cn/guide/start/pricing) |
| Google AI Studio | Updated selected text/vision models with an explicit free tier; paid figures are for standard text input. Gemini 3.8/3.6 Flash promotional prices require another review by 2026-12-31. [Pricing](https://aistudio.google.com/docs/pricing) |
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

### Model display order

Provider pages list models in `models` array order, which catalog sync keeps in upstream API order (see [model order](automatic-catalog.md#model-order)). To put specific models first, add `model_order` to the provider file:

```json
"model_order": ["coding-glm-5.1-free", "kimi-for-coding-free"]
```

Pinned IDs are shown first in the listed order; every other model follows in `models` order. Entries must be unique, nonempty strings. To restore the pure upstream order, delete the field (do not leave `[]`). Sync removes pins for models that leave the catalog; an ID that is not in `models` is ignored by the site and does not fail validation. Do not reorder `models` by hand to change the display: the next sync of a source with a model list restores upstream order. In dynamic mode, set the pins in the review console instead.

### Structured limits, capabilities and output length

These optional fields let the site show exactly what a provider discloses. They are reviewed data: add them only from an official page, and leave anything unknown out.

- `limits` (provider): one entry per published number, with `metric` (`rpm`, `tpm`, `rpd`, `tpd`, `requests_per_month`, `tokens_per_month`, `concurrent_requests`), `value`, `scope`, `source_url` and `checked_at`, plus an optional `note` and `models` (the IDs a per-model limit covers). Scopes: `provider` (one value for the whole free tier), `account` (per account, organization or project; may depend on tier), `model` (a separate counter per model) and `key` (per API key). Keep the headline `rpm` / `tpm` as they are; the provider page lists RPM, TPM, RPD and TPD in every case and shows "Not disclosed" for any that has no value. Never convert a daily or monthly cap into a per-minute value, and keep the prose in `quota_note` in step.
- `capabilities` (model): documented flags only, `reasoning`, `tool_calling` and `structured_output`, each `true` or `false`. Omit a flag when the provider's documentation does not state it. The site never infers these from model families; a model name that merely suggests reasoning or coding is shown as a dashed "name hint" chip (`site/src/lib/capabilities.ts`).
- `max_output_tokens` (model): the documented maximum completion length as a string ("8K", "65536"). The provider page adds a "Max output" column once any model has one.
- `modalities`: omit the field when the catalog does not state it. The site shows "Not disclosed" rather than assuming text input.

**Dynamic mode:** the checker's public `/api/catalog` DTO exposes only the fields listed in `site/tests/public-catalog-fields.mjs`. Until the private checker adds `limits` (provider) and `capabilities` / `max_output_tokens` (model) to its DTO and its review console, the live site shows only the headline RPM/TPM rows (daily caps stay in the terms text and are not labelled "Not disclosed"); nothing breaks. Update `public-catalog-fields.mjs` together with the checker so the dynamic e2e suite covers the new fields. Data edits made in this repository (for example the `openai-compatible` tag added to OpenRouter on 2026-11-26) must also be made in the review console, or the live site keeps the old value.

### Model family pages

`/models/<family>/` pages are generated from the explicit families in `site/src/data/model-families.ts` when the active catalog has at least two providers or three free listings of that family (`site/src/lib/families.ts`). Auto-generated vendor groups never get a page, so URLs stay stable. A page disappears (404) when its family falls below the threshold; add a family to `MODEL_FAMILIES` to give it a page once it has enough data.

For manual provider changes, update `sources` with the exact URL, label and `checked_at`, and update `last_verified` only after reviewing the represented claims (never just because an API call or sync succeeded). Active providers must have at least one source. Keep monthly credit/token budgets in `quota_note`; never convert them into invented daily request limits. `pricing` values are per million tokens, with `source_url` and `checked_at`; time-limited promotional prices also set `valid_until` (last day, YYYY-MM-DD). `npm run validate` warns 30 days before that date and fails once it has passed, so PR validation turns red until someone updates or removes the price; the site labels such prices as promotional. Scheduled syncs, deployments (`CATALOG_ALLOW_EXPIRED=1` / `validate.mjs --allow-expired`) and `build-providers-bundle.mjs` only warn about expired prices, so one provider's deadline cannot block unrelated releases or local tooling. An active provider whose `last_verified` is more than 90 days old also produces a warning.

Deployment (`.github/workflows/deploy.yml`) runs on pushes to `main` and on dispatch from the catalog sync:

1. `verify` runs `npm run check` and both browser suites, then uploads the built site.
2. `sync-providers` replaces the checker's KV catalog with the complete provider bundle (`PUT /api/providers`) and the curated changelog (`POST /api/changelog/replace`). It then appends generated catalog changelog entries with `gen-changelog.mjs`, comparing against the head of the most recent deployment whose append step succeeded, so a superseded queued run does not lose changes. If no valid base exists it warns and skips the generated entries; the deployment continues. A push (not a catalog dispatch) also triggers one authorized probe refresh.
3. `deploy-site` publishes `site/dist` to Pages (static mode) or deploys the `free-llm-site` Worker (dynamic mode).

`gen-changelog.mjs` reads `WORKER_URL` and `REFRESH_SECRET` from the environment only. The legacy checker probes each provider once per hour.

## Dynamic mode

The live catalog is maintained in the private checker and served read-only from `/api/catalog`; its operations runbook lives with the private infrastructure. In this repository:

- `sync-catalog.yml` and the deployment's KV catalog replacement are skipped. The deployment still posts `changelog.json` to the checker ("Sync curated changelog (dynamic)"), which keeps those entries permanently. The site Worker deploys only after the checker's `/api/catalog` returns a non-legacy revision with providers.
- The provider JSON files are the checker's seed and the site's bundled fallback snapshot. Maintainers refresh them from the live catalog through a pull request.
- The `free-llm-site` Worker reads the catalog through its `CHECKER` service binding to `free-llm-checker` ([`site/wrangler.jsonc`](../site/wrangler.jsonc)). A `workers.dev` Worker cannot fetch another `workers.dev` Worker on the same account over HTTP (error 1042), so the binding is required in production; the deploy job fails if the generated `site/dist/server/wrangler.json` lacks it. `astro dev` has no binding and uses `CATALOG_API_URL` (or `PUBLIC_STATUS_WORKER_URL`). A production build keeps the `CHECKER` binding in a local preview too: without a running `free-llm-checker` the preview serves the bundled snapshot. Build with `CATALOG_CHECKER_BINDING=off` to make a preview read `CATALOG_API_URL`. Browsers call the checker's public `/api/status` and `/api/changelog` directly.
- `npm --prefix site run test:dynamic` runs a stand-in `free-llm-checker` Worker (`site/tests/fake-checker/worker.mjs`) next to the site, so the suite covers the service binding path.

### Cutover to dynamic mode on workers.dev

The checker answers CORS for one origin only (`ALLOWED_ORIGIN`). Until the Pages site becomes a redirect, it keeps serving visitors and their browsers still call the checker's `/api/status` and `/api/changelog` (`site/src/lib/status-client.ts`, `changelog-client.ts`); with the checker's origin set to the Worker site, those calls fail CORS and the Pages site loses its live status and changelog.

The private runbook covers the checker side (D1, bootstrap and its own deployment). For this repository, in order:

1. The checker (`https://free-llm-checker.free-llm-status.workers.dev`) is deployed with a bootstrapped D1 catalog and its `/api/catalog` returns a non-legacy revision. Deploy it with its CORS origin still on the Pages site (`npm run deploy -- --var ALLOWED_ORIGIN:https://free-llm-apis.pages.dev` in `checker-worker/`), not the `https://free-llm-site.free-llm-status.workers.dev` value from its `wrangler.toml`.
2. Set the repository variables `CATALOG_MODE=dynamic` and `PUBLIC_SITE_URL=https://free-llm-site.free-llm-status.workers.dev`, and point the `PUBLIC_STATUS_WORKER_URL` secret at the checker. Run the deploy workflow. It checks the checker's catalog, then deploys `free-llm-site` with `wrangler deploy --config dist/server/wrangler.json`.
3. Check https://free-llm-site.free-llm-status.workers.dev: pages return `X-Catalog-Source: live` and show no snapshot notice. Then redeploy the checker without the override, so `ALLOWED_ORIGIN` is `https://free-llm-site.free-llm-status.workers.dev`. From this moment the Pages site's live status and changelog stop loading, so go straight on to step 4.
4. Deploy [`redirect/`](../redirect/README.md) once by hand to the `free-llm-apis` Pages project. From then on, https://free-llm-apis.pages.dev answers every path with a 301 to the same path on the Worker site. The workflow deploys nothing to Pages while `CATALOG_MODE=dynamic`; switching back to `static` would redeploy the static site over the redirect.
5. Update the README links and badges to the new URL.

Rollback:

- Before step 4 the static Pages site is still live. If the checker's CORS origin already points at the Worker site, redeploy the checker with `--var ALLOWED_ORIGIN:https://free-llm-apis.pages.dev` so the Pages site's status and changelog work again.
- Back to static mode: a checker bound to D1 rejects the static deployment's full catalog replacement (`PUT /api/providers` returns 409), so `sync-providers` fails and nothing is published. Return the checker to legacy KV mode first, following the private runbook's full legacy rollback, and deploy it with `ALLOWED_ORIGIN=https://free-llm-apis.pages.dev`. Then set `CATALOG_MODE` back to `static` and `PUBLIC_SITE_URL` to the Pages URL, and rerun the deploy workflow. It republishes the static site to Pages, replacing the redirect.

## Checks and deployment

Prices of Cohere, SambaNova, Cerebras, Groq, Mistral, Google AI Studio and Ollama Cloud are synced daily from their official pricing pages by the [Price sync workflow](automatic-catalog.md#daily-price-sync), which pushes verified changes to `main`; the private checker copies them into the live catalog. Its issue ("Price sync: needs attention") lists only what it could not apply on its own. To keep a newly priced model out, add it to `catalog/price-candidates-ignore.json`.

- `npm run check` validates data, runs logic regressions, checks Astro types and builds the production site.
- `npm --prefix site run test:e2e` builds and tests static pages separately. Install Chromium first with `cd site && npx playwright install chromium`; local runs can instead point `PW_CHROME_PATH` at an installed Chrome (for example `PW_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`). The dynamic suite (`npm --prefix site run test:dynamic`) runs its fake catalog API on `CATALOG_TEST_PORT` (default 4334).
- PRs and main-branch deployments run these checks. PR validation uploads Playwright results on failure.
- The frontend shows `unknown` until it obtains a recent snapshot. A provider's observations count as fresh for its `fresh_ms` window from `/api/status` (dynamic mode: at least 2 hours, longer for providers probed less often), otherwise two hours. No Worker URL is required for the static directory or checked-in changelog.
- The checker Worker is private and deployed separately; publishing this repository does not deploy it. Its `/api/catalog` reports the public commit it was built from as `source_sha`.
- `REFRESH_SECRET` is a deployment-only credential: the checker accepts it solely for catalog/changelog sync and probe refresh, and every request fails closed without it. It grants no management access. Public status reads never trigger upstream completions. Probe 4xx errors are account/model/quota issues (`unknown`), rather than provider-wide outages.

The project uses Astro 7. `.node-version` and CI select Node 24; use Node 24 or later locally. No production deployment is performed by the local maintenance commands above.
