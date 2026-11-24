import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pricePages, comparePrices } from '../scripts/catalog/price-pages.mjs';
import { checkPrices, main, renderMarkdown } from '../scripts/check-prices.mjs';
import { fetchText } from '../scripts/catalog/fetch.mjs';

const parse = (id, text, date = '2026-11-24') => pricePages[id].parse(text, { date }).rows;

// Excerpts in the shape of the official pages on 2026-11-24.
const GROQ_HEAD = '| MODEL ID | SPEED (T/SEC) | PRICE PER 1M TOKENS | RATE LIMITS (DEVELOPER PLAN) | CONTEXT WINDOW (TOKENS) | MAX COMPLETION TOKENS | MAX FILE SIZE |\n| --- | --- | --- | --- | --- | --- | --- |\n';
const groqRow = (id, price, enterprise = '') => `| [![Logo](https://console.groq.com/x.svg)Name](/docs/model/${id})${enterprise}${id} | 500 | ${price} | 250K TPM1K RPM | 131,072 | 65,536 | \\- |\n`;
const GROQ = '# Models\n\n' + GROQ_HEAD + groqRow('llama-3.1-8b-instant', 'ContactSales', 'Enterprise') +
  groqRow('openai/gpt-oss-120b', '$0.15 input$0.60 output') + groqRow('openai/gpt-oss-20b', '$0.075 input$0.30 output') +
  groqRow('whisper-large-v3', '$0.111 per hour') + '\n## Preview\n\n' + GROQ_HEAD + groqRow('qwen/qwen3.8-27b', '$0.80 input$4.00 output');

const MISTRAL = `# API pricing

| Model | API name | Price |
| --- | --- | --- |
| [Mistral Large 4](/models/mistral-large-4-0) | \`mistral-large-4\` | Input $0.7 /M Tokens<br>Cached input $0.07 /M Tokens<br>Output $2.1 /M Tokens |
| [Ministral 3 3B](/models/ministral-3-3b-25-12) | \`ministral-3b-2512\` | Input $0.1 /M Tokens<br>Output $0.1 /M Tokens |
| [Shieldstral 1.0](/models/shieldstral-1-0) |  |  |

## OCR models

| Model | API name | Price |
| --- | --- | --- |
| [OCR 4.1](/models/ocr-4-1) | \`mistral-ocr-4-1\` | Input $4 /1000 Pages<br>Input $5 /1000 Annotated Pages |
| [Codestral](/models/codestral) | \`codestral-2508\` | Input $0.3 /M Tokens<br>Output $0.9 /M Tokens |
`;

const googleSection = (id, input, output, tab = 'Standard') => `## Gemini ${id}  {% id="${id}" %}

{% tabs %}
  {% tab title="${tab}" %}
  {% table %}
  * Feature
  * Free Tier
  * Paid Tier, per 1M tokens in USD

  ---

  * Input price
  * Free of charge
  * ${input}

  ---

  * Output price (including thinking tokens)
  * Free of charge
  * ${output}

  ---

  * Context caching price
  * Free of charge
  * $0.075
  {% /table %}
  {% /tab %}
  {% tab title="Batch" %}
  {% table %}
  * Feature
  * Free Tier
  * Paid Tier, per 1M tokens in USD

  ---

  * Input price
  * Not available
  * $0.01
  {% /table %}
  {% /tab %}
{% /tabs %}

`;
const GOOGLE = '# Gemini API pricing\n\n' +
  googleSection('gemini-4-hydrogen', '$1.50', '$7.50') +
  googleSection('gemini-3.8-flash', '$0.75 through December 31, 2026.   \n  $1.50 starting January 1, 2027.', '$3.75 through December 31, 2026.   \n  $7.50 starting January 1, 2027.') +
  googleSection('gemini-3.1-flash-lite', '$0.25 (text / image / video)    \n  $0.50 (audio)', '$1.50') +
  googleSection('gemini-3.5-flash-lite', '$0.30 (text / image / video / audio)', '$2.50') +
  googleSection('gemini-2.5-pro', '$1.25, prompts <= 200k tokens    \n  $2.50, prompts > 200k tokens', '$10.00, prompts <= 200k tokens    \n  $15.00, prompts > 200k') +
  googleSection('gemini-embedding', '$0.15', '$0.15 per 1,000 characters');

const ollamaRow = (name, input, cached, output) => `
          <tr>
            <td class="border-t px-4 py-3"><a href="/library/${name.split(' ')[0]}" class="hover:underline">${name}</a></td>
            <td class="border-l text-right">${input}</td>
            <td class="border-l text-right">${cached}</td>
            <td class="border-l text-right">${output}</td>
          </tr>`;
const OLLAMA = `<html><body><h2 class="text-xl">Model pricing</h2>
    <p class="text-sm">Pay as you go with usage credits. Prices are per million tokens.
       Off-peak pricing apply outside 12:00 and 18:00 UTC on weekdays and all day on weekends.</p>
    <table class="w-full"><thead><tr>
      <th class="px-4">Model</th><th class="border-l">Input</th><th class="border-l">Cached input</th><th class="border-l">Output</th>
    </tr></thead><tbody>` +
  ollamaRow('beam', '$0.125', '$0.015', '$0.40') + ollamaRow('clef', '$0.24', '-', '-') +
  ollamaRow('deepseek-v4-pro', '$1.32', '$0.13', '$3.96') + ollamaRow('deepseek-v4-pro (Off-Peak)', '$0.66', '$0.07', '$1.98') +
  ollamaRow('gpt-oss:20b', '$0.07', '$0.07', '$0.30') + ollamaRow('hy4', '$0.834', '$0.042', '$2.501') +
  ollamaRow('nemotron-3-super', '$0.015', '$0.015', '$0.60') +
  `</tbody></table><h2>FAQ</h2><table><tr><td>$999</td></tr></table></body></html>`;

test('Groq parser reads token prices and marks non-token rows unpriced', () => {
  const rows = parse('groq', GROQ);
  assert.deepEqual(rows.get('openai/gpt-oss-120b'), { input: 0.15, output: 0.6 });
  assert.deepEqual(rows.get('openai/gpt-oss-20b'), { input: 0.075, output: 0.3 });
  assert.deepEqual(rows.get('qwen/qwen3.8-27b'), { input: 0.8, output: 4 });
  assert.deepEqual(rows.get('llama-3.1-8b-instant'), { unpriced: 'ContactSales' });
  assert.deepEqual(rows.get('whisper-large-v3'), { unpriced: '$0.111 per hour' });
});

test('Groq parser fails closed on layout changes', () => {
  assert.throws(() => parse('groq', GROQ.replaceAll('PRICE PER 1M TOKENS', 'PRICE')), /Unexpected Groq table header/);
  assert.throws(() => parse('groq', GROQ.replaceAll('| 500 |', '|')), /unexpected number of columns/);
  assert.throws(() => parse('groq', GROQ.replace('Enterprisellama-3.1-8b-instant', 'llama-3.1-8b')), /Unrecognised Groq model cell/);
  assert.throws(() => parse('groq', '# Models\n\nNothing here'), /No Groq model price tables/);
});

test('Mistral parser reads token prices, ignores cached input and skips rows without an API name', () => {
  const rows = parse('mistral', MISTRAL);
  assert.deepEqual(rows.get('mistral-large-4'), { input: 0.7, output: 2.1 });
  assert.deepEqual(rows.get('ministral-3b-2512'), { input: 0.1, output: 0.1 });
  assert.deepEqual(rows.get('codestral-2508'), { input: 0.3, output: 0.9 });
  assert.ok(rows.get('mistral-ocr-4-1').unpriced);
  assert.equal(rows.size, 4);
  assert.throws(() => parse('mistral', MISTRAL.replaceAll('| Model | API name | Price |', '| Model | ID | Price |')), /Unexpected Mistral table header/);
  assert.throws(() => parse('mistral', MISTRAL.replace('`mistral-large-4`', 'mistral-large-4')), /Unrecognised Mistral table row/);
  // A price that changes unit is no longer read as a per-token price.
  assert.ok(parse('mistral', MISTRAL.replace('Output $2.1 /M Tokens', 'Output $2.1 /K Tokens')).get('mistral-large-4').unpriced);
});

test('Google parser reads the Standard tab: plain, promotion, per-modality and context-tier cells', () => {
  const rows = parse('google-ai-studio', GOOGLE);
  assert.deepEqual(rows.get('gemini-4-hydrogen'), { input: 1.5, output: 7.5 });
  assert.deepEqual(rows.get('gemini-3.8-flash'), { input: 0.75, output: 3.75, valid_until: '2026-12-31' });
  assert.deepEqual(rows.get('gemini-3.1-flash-lite'), { input: 0.25, output: 1.5 });
  assert.deepEqual(rows.get('gemini-3.5-flash-lite'), { input: 0.3, output: 2.5 });
  assert.deepEqual(rows.get('gemini-2.5-pro'), { input: 1.25, output: 10 });
  assert.ok(rows.get('gemini-embedding').unpriced);
});

test('Google promotion switches to the later price after its last day', () => {
  assert.deepEqual(parse('google-ai-studio', GOOGLE, '2026-12-31').get('gemini-3.8-flash').valid_until, '2026-12-31');
  assert.deepEqual(parse('google-ai-studio', GOOGLE, '2027-01-01').get('gemini-3.8-flash'), { input: 1.5, output: 7.5 });
  // Dates out of order or invalid are not trusted.
  assert.ok(parse('google-ai-studio', GOOGLE.replaceAll('January 1, 2027', 'January 1, 2026')).get('gemini-3.8-flash').unpriced);
  assert.ok(parse('google-ai-studio', GOOGLE.replaceAll('December 31, 2026', 'Smarch 31, 2026')).get('gemini-3.8-flash').unpriced);
});

test('Google parser ignores non-Standard tabs and reports unexpected tables per model', () => {
  const batchOnly = GOOGLE.replace('{% tab title="Standard" %}', '{% tab title="Flex" %}');
  assert.match(parse('google-ai-studio', batchOnly).get('gemini-4-hydrogen').unpriced, /no Standard pricing tab/);
  const header = GOOGLE.replace('* Paid Tier, per 1M tokens in USD', '* Paid Tier, per 1K tokens in USD');
  assert.match(parse('google-ai-studio', header).get('gemini-4-hydrogen').unpriced, /unexpected Standard table header/);
  assert.throws(() => parse('google-ai-studio', '# Pricing\n'), /No Gemini model sections/);
});

test('Ollama parser reads the model pricing table and skips off-peak rows', () => {
  const rows = parse('ollama-cloud', OLLAMA);
  assert.deepEqual(rows.get('deepseek-v4-pro'), { input: 1.32, output: 3.96 });
  assert.deepEqual(rows.get('gpt-oss:20b'), { input: 0.07, output: 0.3 });
  assert.deepEqual(rows.get('hy4'), { input: 0.834, output: 2.501 });
  assert.ok(rows.get('clef').unpriced);
  assert.equal([...rows.keys()].some(id => /off-peak/i.test(id)), false);
});

test('Ollama parser fails closed on layout and unit changes', () => {
  assert.throws(() => parse('ollama-cloud', OLLAMA.replace('Model pricing', 'Prices')), /No "Model pricing" heading/);
  assert.throws(() => parse('ollama-cloud', OLLAMA.replace('Prices are per million tokens.', 'Prices are per thousand tokens.')), /unit statement changed/);
  assert.throws(() => parse('ollama-cloud', OLLAMA.replace('>Cached input<', '>Cache<')), /Unexpected Ollama table header/);
  assert.throws(() => parse('ollama-cloud', OLLAMA.replace('<td class="border-l text-right">$0.015</td>', '')), /unexpected number of columns/);
  assert.throws(() => parse('ollama-cloud', OLLAMA.replace(/<tr>\s*<td[\s\S]*<\/tbody>/, '</tbody>')), /Too few rows/);
});

test('A model listed twice with different prices is reported instead of picking one', () => {
  const rows = parse('ollama-cloud', OLLAMA.replace('</tbody>', ollamaRow('beam', '$0.20', '$0.02', '$0.50') + '</tbody>'));
  assert.match(rows.get('beam').unpriced, /more than once/);
});

const pricing = (input, output, extra = {}) => ({ input_per_million: input, output_per_million: output, currency: 'USD', source_url: 'https://ollama.com/pricing', checked_at: '2026-11-16', ...extra });
const ollamaProvider = () => ({ id: 'ollama-cloud', status: 'archived', models: [
  { id: 'beam', pricing: pricing(0.125, 0.4) },
  { id: 'deepseek-v4-pro', pricing: pricing(1.32, 3.96) },
  { id: 'gpt-oss:20b', pricing: pricing(0.07, 0.3) },
  { id: 'nemotron-3-super', pricing: pricing(0.015, 0.6) },
  { id: 'unpriced-model' },
] });

test('comparePrices reports matches, changes, unparsed rows, missing models and source URL drift', () => {
  const provider = ollamaProvider();
  assert.deepEqual(comparePrices(provider, pricePages['ollama-cloud'].parse(OLLAMA, {}), pricePages['ollama-cloud']), {
    tracked: 4, matched: 4, changed: [], unpriced: [], missing: [], source_url: [], candidates: [{ id: 'hy4', input_per_million: 0.834, output_per_million: 2.501 }],
  });
  provider.models[0].pricing.output_per_million = 0.45;
  provider.models[1].pricing.source_url = 'https://ollama.com/old-pricing';
  provider.models.push({ id: 'clef', pricing: pricing(0.24, 0) }, { id: 'gone', pricing: pricing(1, 1) });
  const diff = comparePrices(provider, pricePages['ollama-cloud'].parse(OLLAMA, {}), pricePages['ollama-cloud']);
  assert.deepEqual(diff.changed, [{ id: 'beam', fields: { output_per_million: { catalog: 0.45, page: 0.4 } } }]);
  assert.deepEqual(diff.unpriced.map(u => u.id), ['clef']);
  assert.deepEqual(diff.missing, ['gone']);
  assert.deepEqual(diff.source_url, [{ id: 'deepseek-v4-pro', catalog: 'https://ollama.com/old-pricing', expected: 'https://ollama.com/pricing' }]);
});

test('comparePrices flags promotion end dates that differ from the page', () => {
  const page = pricePages['google-ai-studio'];
  const provider = { id: 'google-ai-studio', models: [
    { id: 'gemini-3.8-flash', pricing: { ...pricing(0.75, 3.75), source_url: page.page_url } },
    { id: 'gemini-4-hydrogen', pricing: { ...pricing(1.5, 7.5, { valid_until: '2026-12-31' }), source_url: page.page_url } },
  ] };
  const diff = comparePrices(provider, page.parse(GOOGLE, { date: '2026-11-24' }), page);
  assert.deepEqual(diff.changed, [
    { id: 'gemini-3.8-flash', fields: { valid_until: { catalog: null, page: '2026-12-31' } } },
    { id: 'gemini-4-hydrogen', fields: { valid_until: { catalog: '2026-12-31', page: null } } },
  ]);
});

function tempRoot(provider = ollamaProvider(), ignore = { 'ollama-cloud': { hy4: 'Reviewed and left out' } }) {
  const root = mkdtempSync(resolve(tmpdir(), 'check-prices-'));
  mkdirSync(resolve(root, 'site/src/data/providers'), { recursive: true });
  mkdirSync(resolve(root, 'catalog'), { recursive: true });
  if (ignore) writeFileSync(resolve(root, 'catalog/price-candidates-ignore.json'), JSON.stringify({ version: 1, providers: ignore }));
  writeFileSync(resolve(root, 'site/src/data/providers/ollama-cloud.json'), JSON.stringify(provider));
  writeFileSync(resolve(root, 'page.html'), OLLAMA);
  return root;
}

test('check-prices CLI writes JSON and Markdown reports and exits 0 when prices match', async () => {
  const root = tempRoot(), logs = [];
  const code = await main(['--provider', 'ollama-cloud', '--from', resolve(root, 'page.html'), '--date', '2026-11-24'], { root, log: m => logs.push(m) });
  assert.equal(code, 0);
  const report = JSON.parse(readFileSync(resolve(root, '.catalog-reports/prices/report.json'), 'utf8'));
  assert.equal(report.attention, false);
  assert.equal(report.replay, true);
  assert.equal(report.providers[0].matched, 4);
  assert.match(readFileSync(resolve(root, '.catalog-reports/prices/report.md'), 'utf8'), /✅ matches/);
  assert.deepEqual(report.providers[0].ignored, ['hy4']);
  assert.equal(report.candidates, 0);
  assert.doesNotMatch(logs.join(''), /New model candidates/);
});

test('check-prices lists uncatalogued priced models as candidates with a paste-ready entry', async () => {
  const root = tempRoot(undefined, null), logs = [];
  const code = await main(['--provider', 'ollama-cloud', '--from', resolve(root, 'page.html'), '--date', '2026-11-24'], { root, log: m => logs.push(m) });
  assert.equal(code, 1, 'candidates need review');
  const report = JSON.parse(readFileSync(resolve(root, '.catalog-reports/prices/report.json'), 'utf8'));
  assert.equal(report.attention, false, 'prices still match');
  assert.equal(report.candidates, 1);
  assert.deepEqual(report.providers[0].candidates[0].entry, {
    id: 'hy4', name: 'hy4', modalities: ['text'], rpm: null, tpm: null, status: 'active',
    pricing: { input_per_million: 0.834, output_per_million: 2.501, currency: 'USD', source_url: 'https://ollama.com/pricing', checked_at: '2026-11-24' },
  });
  const md = logs.join('');
  assert.match(md, /## New model candidates/);
  assert.match(md, /hy4 \(\$0\.834 \/ \$2\.501\)/);
  assert.match(md, /```json\n\{\n  "id": "hy4"/);
  // Models already listed (including paid_models) are never candidates; unpriced rows (clef) never are either.
  const provider = ollamaProvider();
  provider.paid_models = [{ id: 'hy4', name: 'HY4', status: 'active', pricing: pricing(0.834, 2.501) }];
  const listed = tempRoot(provider, null);
  assert.equal(await main(['--provider', 'ollama-cloud', '--from', resolve(listed, 'page.html')], { root: listed, log() {}, error() {} }), 0);
});

test('the candidate ignore list must be well formed', async () => {
  const quiet = { log() {}, error() {} };
  for (const ignore of [{ nope: { a: 'x' } }, { 'ollama-cloud': ['hy4'] }, { 'ollama-cloud': { hy4: '' } }]) {
    const root = tempRoot(undefined, ignore);
    assert.equal(await main(['--provider', 'ollama-cloud', '--from', resolve(root, 'page.html')], { root, ...quiet }), 2, JSON.stringify(ignore));
  }
});

test('check-prices CLI exits 1 on drift and 2 on usage errors', async () => {
  const provider = ollamaProvider();
  provider.models[1].pricing.input_per_million = 1.5;
  const root = tempRoot(provider), quiet = { log() {}, error() {} };
  assert.equal(await main(['--provider', 'ollama-cloud', '--from', resolve(root, 'page.html')], { root, ...quiet }), 1);
  assert.match(readFileSync(resolve(root, '.catalog-reports/prices/report.md'), 'utf8'), /\*\*deepseek-v4-pro\*\*: input \$1\.5 → \$1\.32/);
  assert.equal(await main(['--date', '2026-11-24'], { root, ...quiet }), 2);
  assert.equal(await main(['--from', 'x'], { root, ...quiet }), 2);
  assert.equal(await main(['--provider', 'nope'], { root, ...quiet }), 2);
  assert.equal(await main(['--bogus'], { root, ...quiet }), 2);
});

test('check-prices reads a live catalog API and reports blocked pages without failing other providers', async () => {
  const pages = { 'https://ollama.com/pricing': [OLLAMA, 'text/html; charset=utf-8'], 'https://docs.mistral.ai/inference/pricing.md': ['<html>login</html>', 'text/html'] };
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, undefined);
    if (url === 'https://checker.example/api/catalog') {
      return new Response(JSON.stringify({ revision: 'r1', providers: [ollamaProvider(), { id: 'mistral', status: 'archived', models: [] }] }), { headers: { 'Content-Type': 'application/json' } });
    }
    const page = pages[url];
    return page ? new Response(page[0], { headers: { 'Content-Type': page[1] } }) : new Response('', { status: 404 });
  };
  const report = await checkPrices({ catalogUrl: 'https://checker.example', fetchImpl, date: '2026-11-24' });
  const by = Object.fromEntries(report.providers.map(r => [r.provider_id, r]));
  assert.equal(report.catalog_revision, 'r1');
  assert.equal(by['ollama-cloud'].status, 'ok');
  assert.equal(by.mistral.status, 'blocked');
  assert.match(by.mistral.error, /content type "text\/html"/);
  assert.match(by.groq.error, /not in the catalog/);
  assert.equal(report.attention, true);
  assert.match(renderMarkdown(report), /⛔ blocked/);
  await assert.rejects(checkPrices({ catalogUrl: 'http://checker.example', fetchImpl }), /https/);
});

test('fetchText keeps the catalog transport rules', async () => {
  await assert.rejects(fetchText('https://example.com', async () => new Response('', { status: 301, headers: { Location: 'https://x' } })), /HTTP 301/);
  await assert.rejects(fetchText('https://example.com', async () => new Response('x'.repeat(20)), 10), /size limit/);
  await assert.rejects(fetchText('https://example.com', async () => new Response('ok', { headers: { 'Content-Type': 'text/html' } }), undefined, { contentTypes: ['text/markdown'] }), /content type/);
  assert.equal(await fetchText('https://example.com', async () => new Response('# ok', { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }), undefined, { contentTypes: ['text/markdown'] }), '# ok');
});

const cohereCard = (name, per, input, output) =>
  `self.__next_f.push([1,"{\\"modelName\\":\\"${name}\\",\\"per\\":\\"${per}\\",\\"features\\":[\\"128K token context window\\"],\\"pricings\\":[{\\"_key\\":\\"k\\",\\"_type\\":\\"pricing\\",\\"inputLabel\\":\\"Input\\",\\"inputPrice\\":${input},\\"outputLabel\\":\\"Output\\",\\"outputPrice\\":${output}}]}"])`;
const COHERE = `<html><body><p>All prices in USD</p><script>${cohereCard('Command A+', 'Free', 0, 0)}${cohereCard('Command R7B', '1M tokens', 0.0375, 0.15)}${cohereCard('Command R', '1M tokens', 0.15, 0.6)}</script>
<ul><li><p>Command R+ 08-2024 pricing is $2.50/1M tokens for input and $10.00/1M tokens for output</p></li></ul></body></html>`;

test('Cohere parser maps pricing cards and legacy FAQ sentences to API IDs', () => {
  const rows = parse('cohere', COHERE);
  assert.deepEqual(rows.get('command-r7b-12-2024'), { input: 0.0375, output: 0.15 });
  assert.deepEqual(rows.get('command-r-08-2024'), { input: 0.15, output: 0.6 });
  assert.deepEqual(rows.get('command-r-plus-08-2024'), { input: 2.5, output: 10 });
  assert.match(parse('cohere', COHERE.replace('\\"per\\":\\"1M tokens\\",\\"features\\":[\\"128K token context window\\"],\\"pricings\\":[{\\"_key\\":\\"k\\",\\"_type\\":\\"pricing\\",\\"inputLabel\\":\\"Input\\",\\"inputPrice\\":0.15', '\\"per\\":\\"1K tokens\\",\\"features\\":[],\\"pricings\\":[{\\"inputLabel\\":\\"Input\\",\\"inputPrice\\":0.15')).get('command-r-08-2024').unpriced, /not priced per 1M/);
  assert.match(parse('cohere', COHERE + cohereCard('Command R', '1M tokens', 1, 2)).get('command-r-08-2024').unpriced, /2 "Command R" pricing cards/);
  assert.throws(() => parse('cohere', COHERE.replace('All prices in USD', 'All prices in EUR')), /currency statement changed/);
  assert.throws(() => parse('cohere', '<p>All prices in USD</p>'), /No Cohere per-token prices/);
});

test('SambaNova parser converts per-token API prices to per-million rates', () => {
  const rows = parse('sambanova', JSON.stringify({ data: [
    { id: 'gpt-oss-120b', pricing: { prompt: '0.00000022', completion: '0.00000059' } },
    { id: 'gemma-4-31B-it', pricing: { prompt: '0.00000038', completion: '0.00000115' } },
    { id: 'Whisper', pricing: { per_minute: '0.001' } },
  ] }));
  assert.deepEqual(rows.get('gpt-oss-120b'), { input: 0.22, output: 0.59 });
  assert.deepEqual(rows.get('gemma-4-31B-it'), { input: 0.38, output: 1.15 });
  assert.ok(rows.get('Whisper').unpriced);
  assert.throws(() => parse('sambanova', '<html></html>'), /not valid JSON/);
  assert.throws(() => parse('sambanova', '{"data":[]}'), /empty/);
});

test('Cerebras parser reads model summary lines from concatenated model pages', () => {
  const text = '# GPT OSS\n\nModel ID: `gpt-oss-120b`. Pricing: $0.35 per million input tokens, $0.75 per million output tokens. Context window: 65k.\n' +
    '\n# Qwen\n\nModel ID: `qwen-3.8-27b`. Context window: 64K. Pricing: $0.99 per million input tokens and $1.49 per million output tokens. Free Trial rate limits.\n';
  const rows = parse('cerebras', text);
  assert.deepEqual(rows.get('gpt-oss-120b'), { input: 0.35, output: 0.75 });
  assert.deepEqual(rows.get('qwen-3.8-27b'), { input: 0.99, output: 1.49 });
  assert.ok(parse('cerebras', text.replace('per million input tokens, $0.75', 'per thousand input tokens, $0.75')).get('gpt-oss-120b').unpriced);
  assert.throws(() => parse('cerebras', '# Moved\n'), /No Cerebras model summary/);
});

test('the repository ignore list is valid and never hides a catalogued model', async () => {
  const { loadIgnored } = await import('../scripts/check-prices.mjs');
  const root = new URL('..', import.meta.url).pathname;
  for (const [id, models] of Object.entries(loadIgnored(root))) {
    const provider = JSON.parse(readFileSync(resolve(root, `site/src/data/providers/${id}.json`), 'utf8'));
    const listed = new Set([...provider.models, ...(provider.paid_models ?? [])].map(m => m.id));
    for (const model of Object.keys(models)) assert.ok(!listed.has(model), `${id}/${model} is catalogued and also ignored`);
  }
});

test('a Cohere card without prices never borrows the next card\'s prices', () => {
  const bare = `self.__next_f.push([1,"{\\"modelName\\":\\"Command R\\",\\"per\\":\\"1M tokens\\",\\"features\\":[\\"Contact sales\\"]}"])`;
  const text = `<p>All prices in USD</p><script>${bare}${'x'.repeat(500)}${cohereCard('Command R7B', '1M tokens', 0.0375, 0.15)}</script>`;
  const rows = parse('cohere', text);
  assert.ok(rows.get('command-r-08-2024').unpriced);
  assert.deepEqual(rows.get('command-r7b-12-2024'), { input: 0.0375, output: 0.15 });
});

test('Google input and output promotions ending on different days are not merged into one row', () => {
  const text = '# Pricing\n\n' + googleSection('gemini-x', '$1 through December 31, 2026.   \n  $2 starting January 1, 2027.', '$3 through November 30, 2026.   \n  $6 starting December 1, 2026.') +
    googleSection('gemini-4-hydrogen', '$1.50', '$7.50') + googleSection('gemini-3.5-flash-lite', '$0.30', '$2.50');
  assert.match(parse('google-ai-studio', text).get('gemini-x').unpriced, /different dates/);
});

test('pricing page fetch errors name the page, not the catalog', async () => {
  const fetchImpl = async url => url.endsWith('/api/catalog')
    ? new Response(JSON.stringify({ providers: [ollamaProvider()] }), { headers: { 'Content-Type': 'application/json' } })
    : new Response('', { status: 404 });
  const report = await checkPrices({ providerId: 'ollama-cloud', catalogUrl: 'https://checker.example', fetchImpl });
  assert.equal(report.providers[0].error, 'Pricing page https://ollama.com/pricing returned HTTP 404');
});
