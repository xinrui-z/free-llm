// Parsers for official provider pricing pages that have no price API. They are used for drift reports only:
// nothing here writes catalog files. Each parser reads one page and returns the standard per-million-token
// text input/output prices it can recognise, failing closed (throwing) when the page structure is not the one
// it was written for, so a redesign shows up as a blocked source instead of as wrong prices.
//
// parse(text, { date }) returns { rows: Map<id, { input, output, valid_until? } | { unpriced: reason }> }.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MODEL_ID = /^[A-Za-z0-9_.:/@+-]+$/;

// Accepts plain decimal dollar amounts only; "$1,000", "1e-3" and blank cells are not prices.
function dollars(value) {
  const match = /^\$((?:0|[1-9]\d*)(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

const collapse = value => value.replace(/\s+/g, ' ').trim();

function isoDate(text) {
  const match = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(text.trim());
  const month = match && MONTHS.indexOf(match[1].toLowerCase());
  if (!match || month < 0) return null;
  const iso = `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

function addRow(rows, id, value) {
  if (!MODEL_ID.test(id)) throw new Error(`Unrecognised model ID on pricing page: ${JSON.stringify(id.slice(0, 80))}`);
  // A model listed twice with different prices is ambiguous; keep the conflict visible rather than pick one.
  if (rows.has(id) && JSON.stringify(rows.get(id)) !== JSON.stringify(value)) rows.set(id, { unpriced: 'listed more than once with different prices' });
  else rows.set(id, value);
}

// Splits a GitHub-flavoured Markdown table line into trimmed cells.
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

// Groq: https://console.groq.com/docs/models.md (generated Markdown of the models page).
// Tables: | MODEL ID | SPEED (T/SEC) | PRICE PER 1M TOKENS | RATE LIMITS (DEVELOPER PLAN) | CONTEXT WINDOW (TOKENS) | ...
// MODEL ID cell: [<logo>Name](/docs/model/<id>)[Enterprise]<id>; price cell: "$0.15 input$0.60 output".
function parseGroq(text) {
  const rows = new Map(), lines = text.split('\n');
  let tables = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\|\s*MODEL ID\s*\|/.test(lines[i])) continue;
    const head = cells(lines[i]);
    if (head[0] !== 'MODEL ID' || head[2] !== 'PRICE PER 1M TOKENS') throw new Error(`Unexpected Groq table header: ${head.join(' | ')}`);
    if (!/^\|[\s|:-]+\|$/.test(lines[i + 1]?.trim() ?? '')) throw new Error('Groq table header has no separator row');
    tables++;
    for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
      const row = cells(lines[i]);
      if (row.length !== head.length) throw new Error('Groq table row has an unexpected number of columns');
      const link = /\]\(\/docs\/model\/([^)\s]+)\)([^[\]()]*)$/.exec(row[0]);
      if (!link || !link[2].endsWith(link[1])) throw new Error(`Unrecognised Groq model cell: ${JSON.stringify(row[0].slice(-80))}`);
      const price = row[2];
      const tokens = /^\$([\d.]+) input\$([\d.]+) output$/.exec(price);
      const input = tokens && dollars(`$${tokens[1]}`), output = tokens && dollars(`$${tokens[2]}`);
      addRow(rows, link[1], input != null && output != null ? { input, output } : { unpriced: price || 'empty price cell' });
    }
    i--;
  }
  if (!tables || rows.size < 3) throw new Error('No Groq model price tables found');
  return { rows };
}

// Mistral: https://docs.mistral.ai/inference/pricing.md
// Tables: | Model | API name | Price |, API name in backticks, price segments joined with <br>.
function parseMistral(text) {
  const rows = new Map(), lines = text.split('\n');
  let tables = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\|\s*Model\s*\|/.test(lines[i])) continue;
    const head = cells(lines[i]);
    if (head.join('|') !== 'Model|API name|Price') throw new Error(`Unexpected Mistral table header: ${head.join(' | ')}`);
    tables++;
    for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
      const row = cells(lines[i]);
      // Some listed models have no public API name or price (e.g. contact-only); they cannot be catalogued.
      if (row.length === 3 && !row[1] && !row[2]) continue;
      const id = /^`([^`]+)`$/.exec(row[1] ?? '')?.[1];
      if (row.length !== 3 || !id) throw new Error(`Unrecognised Mistral table row: ${JSON.stringify(lines[i].slice(0, 120))}`);
      const parts = row[2].split(/<br\s*\/?>/i).map(collapse);
      const pick = label => {
        const found = parts.map(p => new RegExp(`^${label} (\\$\\S+) /M Tokens$`).exec(p)).filter(Boolean);
        return found.length === 1 ? dollars(found[0][1]) : null;
      };
      const input = pick('Input'), output = pick('Output');
      addRow(rows, id, input != null && output != null ? { input, output } : { unpriced: row[2] || 'empty price cell' });
    }
    i--;
  }
  if (!tables || rows.size < 3) throw new Error('No Mistral price tables found');
  return { rows };
}

// Google AI Studio: https://aistudio.google.com/docs/pricing.md (Markdoc). Each model is a
// "## Name {% id="<id>" %}" section whose "Standard" tab holds a table of "* " items separated by "---".
// Only the Standard paid-tier text price is read: batch/flex/priority tabs, caching and audio rates are ignored.
function googleCell(cell, date) {
  const lines = cell.split('\n').map(collapse).filter(Boolean);
  const single = lines.length === 1 && /^(\$[\d.]+)(?: \(([^)]*)\))?$/.exec(lines[0]);
  if (single && (!single[2] || /\btext\b/.test(single[2]))) return { value: dollars(single[1]) };
  // Promotion: "$0.75 through December 31, 2026." / "$1.50 starting January 1, 2027."
  const promo = lines.length === 2 && /^(\$[\d.]+) through ([A-Za-z]+ \d{1,2}, \d{4})\.?$/.exec(lines[0]);
  const after = promo && /^(\$[\d.]+) starting ([A-Za-z]+ \d{1,2}, \d{4})\.?$/.exec(lines[1]);
  if (after) {
    const until = isoDate(promo[2]), from = isoDate(after[2]);
    if (!until || !from || from <= until) return null;
    // Google does not state a time zone; switching on the UTC date is accurate to within a day.
    return date <= until ? { value: dollars(promo[1]), valid_until: until } : { value: dollars(after[1]) };
  }
  // Per-modality lines: "$0.25 (text / image / video)" / "$0.50 (audio)"; the text line is the standard rate.
  const modal = lines.map(l => /^(\$[\d.]+) \(([^)]*)\)$/.exec(l));
  if (lines.length > 1 && modal.every(Boolean)) {
    const text = modal.filter(m => /\btext\b/.test(m[2]));
    return text.length === 1 ? { value: dollars(text[0][1]) } : null;
  }
  // Context tiers: "$2.00, prompts <= 200k tokens" / "$4.00, prompts > 200k tokens"; the lower tier is listed.
  const tiers = lines.map(l => /^(\$[\d.]+), prompts (<=|>) (\d+)k(?: tokens)?$/.exec(l));
  if (lines.length === 2 && tiers.every(Boolean) && tiers[0][2] === '<=' && tiers[1][2] === '>' && tiers[0][3] === tiers[1][3]) {
    return { value: dollars(tiers[0][1]), note: `prompts <= ${tiers[0][3]}k tokens` };
  }
  return null;
}

function parseGoogle(text, { date }) {
  const rows = new Map();
  const headings = [...text.matchAll(/^## .*\{% id="([^"]+)" %\}\s*$/gm)];
  for (let h = 0; h < headings.length; h++) {
    const id = headings[h][1];
    if (!id.startsWith('gemini-')) continue;
    const section = text.slice(headings[h].index, h + 1 < headings.length ? headings[h + 1].index : undefined);
    const start = section.indexOf('{% tab title="Standard" %}');
    if (start < 0) { addRow(rows, id, { unpriced: 'no Standard pricing tab' }); continue; }
    const table = section.slice(start, section.indexOf('{% /table %}', start));
    const items = table.split(/\n\s*---\s*\n/).map(block => block.split(/^\s*\* /m).slice(1).map(s => s.trim()));
    const head = items[0] ?? [];
    if (head[0] !== 'Feature' || !/^Paid Tier, per 1M tokens in USD$/.test(head[2] ?? '')) {
      addRow(rows, id, { unpriced: `unexpected Standard table header: ${head.join(' | ').slice(0, 80)}` });
      continue;
    }
    const find = label => {
      const matches = items.slice(1).filter(row => row.length === 3 && new RegExp(`^${label} price\\b`).test(row[0]));
      return matches.length === 1 ? googleCell(matches[0][2], date) : null;
    };
    const input = find('Input'), output = find('Output');
    if (input?.value == null || output?.value == null) {
      addRow(rows, id, { unpriced: 'unrecognised Standard input/output price format' });
      continue;
    }
    // One valid_until per row: promotions that end on different days for input and output are not representable.
    if (input.valid_until && output.valid_until && input.valid_until !== output.valid_until) {
      addRow(rows, id, { unpriced: 'input and output promotions end on different dates' });
      continue;
    }
    const until = input.valid_until ?? output.valid_until;
    addRow(rows, id, { input: input.value, output: output.value, ...(until ? { valid_until: until } : {}) });
  }
  if (rows.size < 3) throw new Error('No Gemini model sections found on the Google pricing page');
  return { rows };
}

// Ollama Cloud: https://ollama.com/pricing (server-rendered HTML). The "Model pricing" table has
// Model | Input | Cached input | Output columns in dollars per million tokens; "(Off-Peak)" rows are discounts.
const htmlText = html => collapse(html.replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));

function parseOllama(text) {
  const heading = /<h2\b[^>]*>\s*Model pricing\s*<\/h2>/i.exec(text);
  if (!heading) throw new Error('No "Model pricing" heading on the Ollama pricing page');
  const rest = text.slice(heading.index);
  const tableStart = rest.search(/<table\b/i), tableEnd = rest.search(/<\/table>/i);
  if (tableStart < 0 || tableEnd < tableStart) throw new Error('No Ollama model pricing table');
  if (!/Prices are per million tokens\./.test(htmlText(rest.slice(0, tableStart)))) throw new Error('Ollama pricing unit statement changed');
  const table = rest.slice(tableStart, tableEnd);
  const head = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => htmlText(m[1]));
  if (head.join('|') !== 'Model|Input|Cached input|Output') throw new Error(`Unexpected Ollama table header: ${head.join(' | ')}`);
  const rows = new Map();
  for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const td = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => htmlText(m[1]));
    if (!td.length) continue;
    if (td.length !== 4) throw new Error('Ollama table row has an unexpected number of columns');
    if (/\(off-peak\)$/i.test(td[0])) continue;
    const input = dollars(td[1]), output = dollars(td[3]);
    addRow(rows, td[0], input != null && output != null ? { input, output } : { unpriced: `input ${td[1]}, output ${td[3]}` });
  }
  if (rows.size < 5) throw new Error('Too few rows in the Ollama model pricing table');
  return { rows };
}

// Cohere: https://cohere.com/pricing (Next.js). Model cards are CMS objects in the page's flight payload:
// {"modelName":"Command R","per":"1M tokens",...,"pricings":[{"inputLabel":"Input","inputPrice":0.15,"outputLabel":"Output","outputPrice":0.6}]}
// Card names are display names, so they are mapped to API IDs explicitly. Legacy rates are server-rendered
// FAQ sentences: "Command R+ 08-2024 pricing is $2.50/1M tokens for input and $10.00/1M tokens for output".
const COHERE_CARDS = { 'Command R7B': 'command-r7b-12-2024', 'Command R': 'command-r-08-2024' };
const COHERE_LEGACY = { 'Command R+ 08-2024': 'command-r-plus-08-2024' };

function parseCohere(text) {
  const page = text.replace(/\\"/g, '"');
  if (!/All prices in USD/.test(page)) throw new Error('Cohere pricing currency statement changed');
  const rows = new Map();
  for (const [name, id] of Object.entries(COHERE_CARDS)) {
    const cards = [...page.matchAll(new RegExp(`"modelName":"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'))];
    if (cards.length !== 1) { addRow(rows, id, { unpriced: `${cards.length} "${name}" pricing cards` }); continue; }
    // A card ends where the next one starts, so a card without prices never borrows the next card's.
    const start = cards[0].index, next = page.indexOf('"modelName":', start + 1);
    const card = page.slice(start, Math.min(next < 0 ? Infinity : next, start + 4000));
    const per = /"per":"([^"]*)"/.exec(card)?.[1];
    const pricing = /"pricings":\[(\{[^\]]*\})\]/.exec(card)?.[1];
    const input = pricing && /"inputLabel":"Input","inputPrice":((?:0|[1-9]\d*)(?:\.\d+)?)/.exec(pricing);
    const output = pricing && /"outputLabel":"Output","outputPrice":((?:0|[1-9]\d*)(?:\.\d+)?)/.exec(pricing);
    addRow(rows, id, per === '1M tokens' && input && output ? { input: Number(input[1]), output: Number(output[1]) } : { unpriced: `card "${name}" is not priced per 1M input/output tokens` });
  }
  const plain = htmlText(text);
  for (const [name, id] of Object.entries(COHERE_LEGACY)) {
    const found = [...plain.matchAll(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} pricing is (\\$[\\d.]+)/1M tokens for input and (\\$[\\d.]+)/1M tokens for output`, 'g'))];
    const input = found.length && dollars(found[0][1]), output = found.length && dollars(found[0][2]);
    const same = found.every(f => f[1] === found[0][1] && f[2] === found[0][2]);
    addRow(rows, id, found.length && same && input != null && output != null ? { input, output } : { unpriced: `no unique legacy price sentence for ${name}` });
  }
  if (![...rows.values()].some(r => !r.unpriced)) throw new Error('No Cohere per-token prices recognised');
  return { rows };
}

// SambaNova: https://api.sambanova.ai/v1/models (public JSON, no auth). data[].pricing.prompt/completion
// are USD per token as decimal strings; the pricing page states USD.
function parseSambaNova(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('SambaNova model list is not valid JSON'); }
  if (!Array.isArray(raw?.data) || !raw.data.length) throw new Error('SambaNova model list is empty');
  const rows = new Map();
  for (const m of raw.data) {
    if (typeof m?.id !== 'string') throw new Error('SambaNova model entry without an ID');
    const parse = v => typeof v === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) ? Number(v) : null;
    const input = parse(m.pricing?.prompt), output = parse(m.pricing?.completion);
    addRow(rows, m.id, input != null && output != null
      ? { input: Number((input * 1e6).toFixed(6)), output: Number((output * 1e6).toFixed(6)) }
      : { unpriced: 'no per-token prompt/completion price' });
  }
  return { rows };
}

// Cerebras: one Markdown page per model (https://inference-docs.cerebras.ai/models/<page>.md), each with a summary
// line "Model ID: `<id>`. ... Pricing: $X per million input tokens(,| and) $Y per million output tokens."
function parseCerebras(text) {
  const rows = new Map();
  const lines = text.split('\n').filter(l => l.startsWith('Model ID: `'));
  if (!lines.length) throw new Error('No Cerebras model summary lines');
  for (const line of lines) {
    const id = /^Model ID: `([^`]+)`\./.exec(line)?.[1];
    if (!id) throw new Error('Unrecognised Cerebras model summary line');
    const price = [...line.matchAll(/Pricing: (\$[\d.]+) per million input tokens(?:,| and) (\$[\d.]+) per million output tokens\./g)];
    const input = price.length === 1 ? dollars(price[0][1]) : null, output = price.length === 1 ? dollars(price[0][2]) : null;
    addRow(rows, id, input != null && output != null ? { input, output } : { unpriced: 'no unique per-million input/output price in the model summary' });
  }
  return { rows };
}

// Each entry: page_url is what catalog source_url values should cite; urls are fetched (concatenated with a
// newline when there are several) and passed to parse.
export const pricePages = {
  cohere: { urls: ['https://cohere.com/pricing'], page_url: 'https://cohere.com/pricing', contentTypes: ['text/html'], parse: parseCohere },
  sambanova: { urls: ['https://api.sambanova.ai/v1/models'], page_url: 'https://cloud.sambanova.ai/plans/pricing', contentTypes: ['application/json'], parse: parseSambaNova },
  cerebras: { urls: ['https://inference-docs.cerebras.ai/models/openai-oss.md', 'https://inference-docs.cerebras.ai/models/qwen-3.8-27b.md'], page_url: 'https://www.cerebras.ai/pricing', contentTypes: ['text/markdown', 'text/plain'], parse: parseCerebras },
  groq: { urls: ['https://console.groq.com/docs/models.md'], page_url: 'https://console.groq.com/docs/models', contentTypes: ['text/markdown', 'text/plain'], parse: parseGroq },
  mistral: { urls: ['https://docs.mistral.ai/inference/pricing.md'], page_url: 'https://docs.mistral.ai/inference/pricing', contentTypes: ['text/markdown', 'text/plain'], parse: parseMistral },
  'google-ai-studio': { urls: ['https://aistudio.google.com/docs/pricing.md'], page_url: 'https://aistudio.google.com/docs/pricing', contentTypes: ['text/markdown', 'text/plain'], parse: parseGoogle },
  'ollama-cloud': { urls: ['https://ollama.com/pricing'], page_url: 'https://ollama.com/pricing', contentTypes: ['text/html'], parse: parseOllama },
};

const same = (a, b) => Math.abs(a - b) < 1e-9;

// Compares a provider's catalogued model prices with a parsed page. Only models that carry `pricing` are compared;
// page rows for other models are listed as `untracked` for information.
export function comparePrices(provider, parsed, page) {
  const changed = [], unpriced = [], missing = [], sourceUrl = [];
  let matched = 0;
  const catalogued = [...(provider.models ?? []), ...(provider.paid_models ?? [])].filter(Boolean);
  const priced = catalogued.filter(m => m.pricing);
  for (const m of priced) {
    const p = m.pricing, row = parsed.rows.get(m.id);
    if (p.source_url !== page.page_url) sourceUrl.push({ id: m.id, catalog: p.source_url ?? null, expected: page.page_url });
    if (!row) { missing.push(m.id); continue; }
    if (row.unpriced) { unpriced.push({ id: m.id, reason: row.unpriced }); continue; }
    if (p.currency !== 'USD') { unpriced.push({ id: m.id, reason: `catalog currency ${p.currency} is not USD` }); continue; }
    const fields = {};
    if (!same(p.input_per_million, row.input)) fields.input_per_million = { catalog: p.input_per_million, page: row.input };
    if (!same(p.output_per_million, row.output)) fields.output_per_million = { catalog: p.output_per_million, page: row.output };
    if ((p.valid_until ?? null) !== (row.valid_until ?? null)) fields.valid_until = { catalog: p.valid_until ?? null, page: row.valid_until ?? null };
    if (Object.keys(fields).length) changed.push({ id: m.id, fields });
    else matched++;
  }
  // Models priced on the page that the catalog does not list at all: candidates for a maintainer to review.
  const known = new Set(catalogued.map(m => m.id));
  const candidates = [...parsed.rows].filter(([id, row]) => !known.has(id) && !row.unpriced)
    .map(([id, row]) => ({ id, input_per_million: row.input, output_per_million: row.output, ...(row.valid_until ? { valid_until: row.valid_until } : {}) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { tracked: priced.length, matched, changed, unpriced, missing, source_url: sourceUrl, candidates };
}
