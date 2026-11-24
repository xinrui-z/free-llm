# Automatic catalog maintenance

This document covers source adapters and scheduled catalog maintenance in static mode, where the provider JSON files in `main` are the live catalog. It does not add inference routing or automatic registration of new providers. The same adapters also run inside the private checker in [dynamic mode](#dynamic-mode).

## Sources and authority

Sources are configured in [`catalog/sources.json`](../catalog/sources.json). New protocols are implemented in [`scripts/catalog/adapters.mjs`](../scripts/catalog/adapters.mjs).

| Source | Adapter | Where it runs | What is automated | What still needs evidence |
| --- | --- | --- | --- | --- |
| OpenRouter public model API | `openrouter` | Static (`catalog/sources.json`) and dynamic | Free text variants with `:free` IDs and explicit zero prices; metadata; prices of the existing curated paid selection | Account limits, regional access, provider policy, actual inference availability |
| AIHubMix public `/v1/models` | `openai-discovery` (suffix `-free`) | Static and dynamic | Discovery of new `-free` IDs, reporting of missing existing models, and keeping catalogued models in upstream order | Recurring free eligibility, capabilities and quotas; a suffix alone is insufficient |
| ZenMux public model API | `zenmux` | Dynamic only, registered after its provider is approved | `-free` variants whose every pricing tier, including additional billing items, is explicitly zero | Same as OpenRouter |
| ModelScope `/v1/models` | `openai-discovery` (`candidate_match: all`) | Dynamic only, registered after approval | Every unknown model ID becomes a candidate; missing models are reported | Everything: the list has no prices or allowances |
| models.dev registry | Provider discovery | Dynamic only (checker cron, daily) | New provider candidates with zero-price hints; `reactivation` candidates for archived providers | Official recurring free policy, API origin and protocol |

Provider discovery matches existing providers only by ID and API (`base_url`) origin, so sharing a website or docs domain does not hide a candidate. A match with an archived provider yields a `kind: "reactivation"` candidate that must be restored manually. Subscription coding/token plans (for example `alibaba-coding-plan`, `kimi-code-plan-global`, `zhipuai-coding-plan`) are dropped before review: the registry lists their models at $0 because usage is prepaid by the plan, not free. They are recognized by the plan wording in the registry ID, name or API path (`isSubscriptionPlan`). Skipped registry entries and their reasons are available from `discoverProvidersReport().filtered`.

The AIHubMix endpoint was checked without credentials on 2026-11-17. It returns IDs and ownership, but no prices or recurring allowance. Its official guide also describes finite promotional calls. Candidates therefore remain outside the published free-model directory until their policy is reviewed. Any pending ID may be a trial, an image model, or otherwise outside this site's scope.

`catalog/state/<provider>.json` stores observation state and pending candidates. Commit these generated files with catalog changes: removal confirmation must survive between CI runners. The sources manifest is intentionally a small, reviewed configuration; static mode does not discover or authorize new provider domains.

`--write` only rewrites files whose content materially changes, so a quiet run leaves no diff:

- State is written only when removal evidence, pending candidates, the source URL or the source policy changes. A new `checked_at` or `source_hash` alone does not rewrite it.
- `catalog_checked_at` and the live source's `checked_at` in `sources` advance only when the catalog content changes (or the live source has never been recorded). Discovery sources never stamp either (see [Model order](#model-order)).
- A tracked paid price's `checked_at` advances only when the price itself changes. A manually set `valid_until` survives an unchanged price and is dropped when the price changes.

## Local use

Use Node 24 LTS. None of these commands makes inference calls or needs provider API keys.

```bash
# List configured sources.
npm run catalog:sources

# Fetch all enabled sources and preview changes without changing catalog/state.
npm run catalog:sync

# Save validated changes and observation state.
npm run catalog:sync -- --write

# Preview one provider, or replay a saved public API response (preview only).
npm run catalog:sync -- --provider openrouter
npm run catalog:sync -- --provider openrouter --from /tmp/models.json --date 2026-11-17

# Run the repository's validation, regressions, type check and build.
npm run check
```

`scripts/refresh-openrouter.mjs` remains as a compatibility entry point. It defaults to preview and requires `--write` to save changes. Unknown options, invalid dates, disabled sources and multi-provider use of `--from` fail explicitly.

Offline replay (`--from FILE`) is a preview-only diff against the current catalog and never writes catalog or state; `--from` with `--write` is rejected. `--date` is only valid with `--from` and must not be in the future. If saved state is newer than the replay date, it is ignored (the provider's report entry has `state_ignored: true`) instead of failing or being rewound.

Reports and public source snapshots are written to the gitignored `.catalog-reports/` directory. `--report-dir DIR` selects another location. `report.json` includes model additions/removals, changed field values, pending removals, candidate IDs, source URL and response SHA-256, plus:

- `catalog_changed` / `state_changed` per provider, and `written` (files actually saved) for an applied run;
- `reordered`: models present before and after the run changed relative order (additions and removals alone do not set it);
- `missing_upstream`: catalogued models absent from the source. Each one prints a warning (a `::warning::` annotation in GitHub Actions) and an `Attention:` summary line, without changing the exit status. Priced sources keep the model until removal is confirmed; discovery sources never remove models, so review and remove them manually;
- `quarantined`: new `:free`/`-free` entries with malformed prices or metadata, set aside with a warning while the rest of the source syncs. Malformed data for an already catalogued model still blocks the source;
- `conflict`: set when the catalog or state changed during the run; nothing is written.

## Publication rules

- Machine updates preserve provider descriptions, policy review dates, quotas, curated recommendations and explicit model deprecations. New models get unknown limits rather than copying account-wide quotas into each model.
- `last_verified` remains the policy review date. `catalog_checked_at` and the model API's source date record catalog observation; tracked prices have their own `checked_at`.
- Models are listed in upstream API order (see [Model order](#model-order)). Surviving recommendations remain stable. If a recommended model is removed, an eligible remaining model fills the slot deterministically, in display order (pinned models first).
- Missing/blank/boolean prices never count as zero. A `:free` suffix must also have explicit zero billing values and text output. Unknown billing structures block publication for review.
- A missing model is retained until two successful complete observations at least six hours apart. Repeated requests within that interval cannot confirm a removal. Reappearance clears the pending removal. Changing the source policy resets its confirmation history.
- An explicitly positive price revokes free eligibility immediately, subject to the same bulk-change protection. A model that is no longer free is removed from the free list; it is not automatically selected for the curated paid comparison.
- Empty catalogs, duplicate IDs, malformed tracked metadata, advertised pagination, and mismatched total counts are rejected. More than 25 additions or more than 25% missing entries in either tracked selection require manual review. A response can still be incomplete without advertising it; repeat observations and bulk thresholds reduce that risk but cannot prove upstream completeness.
- A blocked source leaves all selected catalog/state files unchanged. No partial publication occurs because one source fetched successfully. Reports retain the reason and raw public response.
- Fetches have timeouts and a 10 MiB response cap, reject redirects, retry transient errors twice, and never attach credentials. HTTP 429/503 retries honor `Retry-After` up to 60 seconds; a longer requested delay fails immediately and waits for the next scheduled run. An empty response body is a permanent error. Files are replaced individually using temporary files and rename. Concurrent edits detected during collection abort the write.

### Model order

A provider page lists models in the order the upstream model API returns them, with any manually pinned models first:

- Priced sources (`openrouter`, `zenmux`) write `models` and `paid_models` in upstream order on every sync, new additions included (they are no longer appended alphabetically). Models awaiting removal confirmation stay at the end in their previous relative order.
- Discovery sources (`openai-discovery`) still never add or remove models, but when the catalogued models that are listed upstream are out of upstream order, the run rewrites `models` in that order (models missing upstream go to the end in their previous order). Only the order changes: `sources`, `catalog_checked_at`, `top_models`, prices and labels are left as reviewed, because a reorder is presentation and discovery is not price or eligibility evidence. Such a run reports `catalog_changed: true` and `reordered: true`, so `--write` saves the provider file (and the private checker publishes a release).
- An unchanged upstream order produces no diff: a repeated run is quiet.
- `model_order` (optional) is the manual override: these IDs are shown first, in this order, and every other model follows in `models` order. Sync never reorders it; it only drops IDs that are no longer in `models` and removes the field once it is empty. Validation accepts IDs that are not in `models` (the site ignores them), so a stale pin can never block a provider. See [maintenance](maintenance.md#model-display-order).

For a legitimate large change, inspect the official source and generated report, manually update the reviewed baseline, then run sync again. Do not treat an empty API response as evidence that a provider has permanently closed. Archived providers require an explicit manual reactivation.

## Scheduled updates and deployment

[`sync-catalog.yml`](../.github/workflows/sync-catalog.yml) currently runs only when triggered manually (Actions → Sync catalog → Run workflow; `apply` saves and deploys, otherwise it previews). Its schedule (00:23, 06:23, 12:23 and 18:23 UTC) is commented out until the workflow has been observed; uncomment the `schedule` block to enable it. GitHub scheduled runs can be delayed. It is skipped when the repository variable `CATALOG_MODE` is `dynamic`.

The workflow is split so that no job both runs third-party code and holds write credentials:

1. **collect** (`contents: read`, no persisted git credentials): checks out `main` and runs `scripts/sync-catalog.mjs` with Node built-ins only, before any dependency is installed. Changed provider/state files are uploaded as an artifact together with their digest; reports and raw responses are uploaded separately for 14 days, including on failure.
2. **check** (`contents: read`, no persisted credentials): applies the artifact to the baseline commit, runs `npm ci --prefix site --ignore-scripts` and `npm run check`. It can fail the run but cannot change what publish accepts.
3. **publish** (`contents: write`, `actions: write`; never installs or runs npm): verifies the artifact digest, applies only allowlisted files (existing `site/src/data/providers/<id>.json` and `catalog/state/<id>.json`), runs `node scripts/validate.mjs --allow-expired`, and commits and pushes only when there is a diff. A concurrent update of `main` makes the push fail safely; the next run starts from the new baseline.

Deployment is dispatched explicitly (pushes made with `GITHUB_TOKEN` do not trigger push workflows) and only when provider files changed, passing the baseline commit for changelog generation. State-only commits and runs without changes do not deploy, except that a run redeploys when the latest `main` deployment failed, so a failed deployment recovers within one sync interval. You can also rerun `deploy.yml` manually. Catalog-triggered deployments skip the extra forced inference probe; the hourly checker remains responsible for health checks.

Branch rules must allow the bot's generated commit; if direct pushes are prohibited, use the workflow in preview mode and integrate the generated change through your existing PR process. No branch-protection bypass is configured.

Manual **Run workflow** defaults to `apply=false` for a preview. `apply=true` performs the same write and deployment path as the scheduled run. Failed collections or checks stop publication.

## Price sync from official pricing pages

Cohere, SambaNova, Cerebras, Groq, Mistral, Google AI Studio and Ollama Cloud publish prices only on their pricing pages. [`scripts/check-prices.mjs`](../scripts/check-prices.mjs) reads those pages, compares them with `models[].pricing` and `paid_models`, and with `--write` applies the differences to the provider JSON. The [Price sync workflow](#daily-price-sync) does this every day without a person; the private checker then copies the merged prices into the live catalog.

| Provider | Page read | Parsed as |
| --- | --- | --- |
| Cohere | `https://cohere.com/pricing` | Pricing cards in the page payload (`"per":"1M tokens"`, `inputPrice`/`outputPrice`), mapped from display names to IDs (Command R7B → `command-r7b-12-2024`, Command R → `command-r-08-2024`); the legacy FAQ sentence for Command R+ 08-2024. Requires "All prices in USD" |
| SambaNova | `https://api.sambanova.ai/v1/models` (public JSON) | `pricing.prompt`/`pricing.completion` (USD per token) × 1,000,000; catalog cites `https://cloud.sambanova.ai/plans/pricing` |
| Cerebras | `https://inference-docs.cerebras.ai/models/openai-oss.md`, `.../qwen-3.8-27b.md` | The `Model ID: ... Pricing: $X per million input tokens, $Y per million output tokens` summary line; catalog cites `https://www.cerebras.ai/pricing` |
| Groq | `https://console.groq.com/docs/models.md` | `PRICE PER 1M TOKENS` cell `$X input$Y output`; `ContactSales` and per-hour/per-character rows are not token prices |
| Mistral | `https://docs.mistral.ai/inference/pricing.md` | `Input $X /M Tokens` and `Output $Y /M Tokens`; cached input is ignored |
| Google AI Studio | `https://aistudio.google.com/docs/pricing.md` | The paid tier of the **Standard** tab only. Promotions (`$X through <date>` / `$Y starting <date>`) give the promotional price and `valid_until` until that date, then the later price; per-modality cells use the text line; context-tier cells use the lower tier |
| Ollama Cloud | `https://ollama.com/pricing` | The `Model pricing` table (Model, Input, Cached input, Output); `(Off-Peak)` rows are ignored |

Parsers fail closed: a changed table header, column count, unit statement or model cell blocks that provider (`⛔ blocked`) rather than producing prices, and a catalogued model whose price cell is in an unknown format is reported as not parsed. Fetches use the same transport rules as the catalog sync (no credentials, no redirects, timeouts, size cap) and also require the expected content type. Each report row records `page_sha256`.

Compared per catalogued model with `pricing` (in `models` or `paid_models`): input and output price, `valid_until`, and whether `source_url` is the page above.

### What `--write` changes

[`scripts/catalog/price-apply.mjs`](../scripts/catalog/price-apply.mjs) applies a report and touches pricing data only:

- a changed price or promotion end date: the new values, `source_url` set to the page and `checked_at` to the check date. A promotion that ended drops `valid_until`, so the standard rate replaces the promotional one without an expiry error;
- a moved pricing page: `source_url` only (`checked_at` stays, the price did not change);
- a new model priced on the page (in neither list and not ignored): added to `paid_models` with its ID as name (the site derives a readable name), `modalities: ["text"]` and null limits. A model with a free tier belongs in `models`; moving it there, with its limits, stays a manual decision.

It never removes a model, never edits `models` membership, and writes nothing for a blocked page, an unrecognised price or a model missing from its page; those stay in the report and the workflow's issue. Each provider is validated before it is saved.

To keep a model out of the catalog, list it in [`catalog/price-candidates-ignore.json`](../catalog/price-candidates-ignore.json) under its provider with a short reason (for example a classifier, audio or superseded model). Ignored models are reported in `report.json` as `ignored`. A model that is in the catalog must not also be in the ignore list; a unit test checks this.

```bash
npm run prices:check                                     # report only, against site/src/data/providers/*.json
npm run prices:check -- --write                          # apply to that JSON
npm run prices:check -- --catalog-url https://<checker>  # report against a live /api/catalog
npm run prices:check -- --provider groq --from page.md --date 2026-11-24   # offline replay
```

Reports are written to `.catalog-reports/prices/` (`report.json`, `report.md`). The exit status is 0 when every tracked price matches and there are no candidates, 1 when anything differs or needs review, and 2 when the check could not run (usage error, invalid ignore list, unreadable catalog or catalog API).

### Daily price sync

[`price-sync.yml`](../.github/workflows/price-sync.yml) runs daily at 03:41 UTC and on demand, on `main` only:

1. **collect** (read-only, Node built-ins only): `check-prices --write` on `main`; uploads the changed provider files and their digest.
2. **verify** (read-only): applies those files to the same commit, reads every pricing page **again** and fails unless the second reading agrees with them, then runs `npm run check` (validation, unit tests, type check, build). Both must pass.
3. **publish** (`contents: write`, runs no repository code): checks the digest and that only existing `site/src/data/providers/<id>.json` files changed, commits as `github-actions[bot]`, pushes to `main` (a concurrent update makes the push fail safely; the next run starts from the new `main`) and dispatches the Deploy workflow.
4. **report** (`issues: write` only): keeps one issue titled "Price sync: needs attention", opened by `github-actions`, for what still needs a person: blocked pages, prices the parser could not read, models missing from their page, a provider that would fail validation, or a run whose changes were not published. It closes the issue once a run applies everything on its own.

There is no size limit on a price change: a run is published whenever both readings agree and the checks pass.

### Live catalog (dynamic mode)

The private checker pulls the reviewed prices from `main` every hour (`raw.githubusercontent.com/<repo>/main/site/src/data/providers/<id>.json` for these seven providers) and merges them into the live catalog with `mergePricing`: each model's `pricing`, new `paid_models`, `pricing_note` and the cited pricing-page source. All other live fields, including free-model membership and limits edited in the review console, are kept. No management credential leaves Cloudflare. A change therefore reaches the live site within about an hour of the workflow's push.

## Promoting an AIHubMix candidate

Read `catalog/state/aihubmix.json` and verify the candidate's official model page and policy. Confirm recurring free access, model modality, constraints and exact callable ID. Then add it to `site/src/data/providers/aihubmix.json`, attach its official sources and update the human policy review date. Run `npm run check`. The next discovery run automatically drops that ID from the pending candidate list. If it is a finite trial or outside the site's scope, leave it unlisted; a reusable rejection/override workflow is deferred to the next phase.

## Dynamic mode

In dynamic mode the private checker runs these same adapters on a schedule (source sync every 6 hours) against its own catalog store, and the GitHub file-sync job is disabled. The file-based workflow in this document is the static mode.
