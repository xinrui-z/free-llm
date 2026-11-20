import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { MODEL_FAMILIES, classifyModels, vendorKey, vendorFamily, isListableModel } from '../site/src/data/model-families.ts';

// Active, non-deprecated models of the live catalog snapshot (2026-11-20) that the
// dynamic site renders on /models. Kept inline so the test needs no network.
const LIVE = {
  aihubmix: ['coding-glm-5.1-free', 'coding-glm-5-free', 'coding-glm-5-turbo-free', 'coding-glm-4.7-free', 'glm-4.7-flash-free', 'coding-glm-4.6-free', 'coding-minimax-m2.7-free', 'coding-minimax-m2.5-free', 'coding-minimax-m2.1-free', 'coding-minimax-m2-free', 'kimi-for-coding-free', 'mimo-v2-flash-free', 'k2.6-code-preview-free'],
  openrouter: ['inclusionai/ling-3.2-flash:free', 'baidu/ernie-5.5-flash-preview:free', 'thinkingmachines/inkling-2-small:free', 'liquid/lfm-3-1.7b:free', 'particle-ai/particle-1:free', 'recursive/flint-v1.0:free', 'nvidia/nemotron-3.5-super-vl:free', 'dots-studio/dots-3-note-preview:free', 'nvidia/nemotron-3.5-lightning:free', 'cohere/north-mini-code:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'google/gemma-4-26b-a4b-it:free', 'google/gemma-4-31b-it:free'],
  'nvidia-nim': ['nvidia/nemotron-3-ultra-550b-a55b', 'z-ai/glm-5.3-flash', 'moonshotai/kimi-k3.1-pro', 'google/gemma-4-31b-it', 'mistralai/mistral-large-4-1t-a52b', 'minimaxai/minimax-m3.1-flash', 'nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'poolside/laguna-xs-2.1'],
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
  cohere: ['command-a-plus-05-2026', 'command-a-03-2025', 'command-r7b-12-2024', 'command-r-08-2024', 'command-r-plus-08-2024', 'command-a-reasoning-08-2025', 'command-a-vision-07-2025'],
  sambanova: ['DeepSeek-V3.1', 'Meta-Llama-3.3-70B-Instruct', 'gpt-oss-120b', 'DeepSeek-V3.2', 'gemma-4-31B-it'],
  modelscope: ['Qwen/Qwen3.5-35B-A3B', 'Qwen/Qwen3.5-27B', 'ZhipuAI/GLM-4.7-Flash'],
  bigmodel: ['glm-4.7-flash', 'glm-4-flash-250414', 'glm-z1-flash', 'glm-4.6v-flash', 'glm-4v-flash', 'glm-4.1v-thinking-flash'],
  'google-ai-studio': ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  agnes: ['agnes-2.5-flash', 'agnes-3.0-flash'],
  amd: ['DeepSeek-V4-Flash', 'DeepSeek-V4.1-Flash', 'GLM-5.3-Flash', 'Gemma-4-31B-IT', 'MiMo-V2.6-Flash', 'MiniCPM-V-4.7-1B', 'MiniCPM-V-4.7-35B-A3B', 'MiniCPM5-2B', 'Qwen3.8-27B', 'Qwen3.8-Flash-Next'],
};
const live = Object.entries(LIVE).map(([id, ids]) => ({ id, status: 'active', models: ids.map(m => ({ id: m })) }));

const dir = new URL('../site/src/data/providers/', import.meta.url);
const bundled = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => JSON.parse(readFileSync(new URL(f, dir))));

// IDs that may legitimately stay in "Other" (no org prefix and no vendor token). Keep this tiny.
const OTHER_ALLOWLIST = new Set([]);

const familiesOf = (classification, providerId, modelId) =>
  classification.families
    .filter(({ entries }) => entries.some(e => e.provider.id === providerId && e.models.some(m => m.id === modelId)))
    .map(({ family }) => family.id);

const otherIds = classification => classification.other.flatMap(e => e.models.map(m => `${e.provider.id}:${m.id}`));

test('live snapshot: every listable model is classified, none fall into Other', () => {
  const result = classifyModels(live);
  assert.deepEqual(otherIds(result).filter(id => !OTHER_ALLOWLIST.has(id)), []);
  const total = live.reduce((n, p) => n + p.models.length, 0);
  const placed = new Set(result.families.flatMap(f => f.entries.flatMap(e => e.models.map(m => `${e.provider.id}:${m.id}`))));
  assert.equal(placed.size + otherIds(result).length, total);
});

test('live snapshot: newly onboarded providers land in their expected families', () => {
  const result = classifyModels(live);
  const expected = {
    amd: {
      'DeepSeek-V4-Flash': 'deepseek-v4', 'DeepSeek-V4.1-Flash': 'deepseek-v4', 'GLM-5.3-Flash': 'glm', 'Gemma-4-31B-IT': 'gemma',
      'MiMo-V2.6-Flash': 'mimo', 'MiniCPM-V-4.7-1B': 'minicpm', 'MiniCPM-V-4.7-35B-A3B': 'minicpm', 'MiniCPM5-2B': 'minicpm',
      'Qwen3.8-27B': 'qwen3', 'Qwen3.8-Flash-Next': 'qwen3',
    },
    agnes: { 'agnes-2.5-flash': 'agnes', 'agnes-3.0-flash': 'agnes' },
    'nvidia-nim': { 'poolside/laguna-xs-2.1': 'laguna', 'moonshotai/kimi-k3.1-pro': 'kimi', 'minimaxai/minimax-m3.1-flash': 'minimax', 'z-ai/glm-5.3-flash': 'glm' },
    groq: { 'qwen/qwen3.8-27b': 'qwen3' },
    sambanova: { 'DeepSeek-V3.1': 'deepseek-v3', 'DeepSeek-V3.2': 'deepseek-v3', 'Meta-Llama-3.3-70B-Instruct': 'llama3' },
    aihubmix: { 'k2.6-code-preview-free': 'kimi', 'coding-glm-5.1-free': 'glm', 'mimo-v2-flash-free': 'mimo' },
    bigmodel: { 'glm-z1-flash': 'glm', 'glm-4v-flash': 'glm' },
  };
  for (const [providerId, models] of Object.entries(expected)) {
    for (const [modelId, familyId] of Object.entries(models)) {
      assert.deepEqual(familiesOf(result, providerId, modelId), [familyId], `${providerId}:${modelId}`);
    }
  }
});

test('no model sits in two explicit families (live snapshot and bundled catalog)', () => {
  for (const providers of [live, bundled]) {
    for (const provider of providers) {
      for (const model of provider.models.filter(isListableModel)) {
        const hits = MODEL_FAMILIES.filter(f => f.match(model.id)).map(f => f.id);
        assert.ok(hits.length <= 1, `${provider.id}:${model.id} matches ${hits.join(', ')}`);
      }
    }
  }
});

test('bundled catalog: active providers have nothing in Other', () => {
  assert.deepEqual(otherIds(classifyModels(bundled)).filter(id => !OTHER_ALLOWLIST.has(id)), []);
});

test('family regexes avoid obvious false positives', () => {
  const family = id => MODEL_FAMILIES.filter(f => f.match(id)).map(f => f.id);
  assert.deepEqual(family('qwen2.5-32b-instruct'), []);
  assert.deepEqual(family('deepseek-v4-pro'), ['deepseek-v4']);
  assert.deepEqual(family('deepseek-v3.2-exp'), ['deepseek-v3']);
  assert.deepEqual(family('glm4-9b-chat'), ['glm']);
  assert.deepEqual(family('openbmb/minicpm-o-2.6'), ['minicpm']);
  assert.deepEqual(family('stepfun-ai/step-3'), ['step']);
  assert.deepEqual(family('lfm2-1.2b'), ['lfm']);
});

test('vendor fallback groups unmatched models by org prefix or leading vendor token', () => {
  assert.equal(vendorKey('acme/foo-1'), 'acme');
  assert.equal(vendorKey('deepseek-v9-pro'), 'deepseek');
  assert.equal(vendorKey('poolside/malibu-1'), 'poolside');
  assert.equal(vendorKey('nvidia/some-new-model:free'), 'nvidia');
  assert.equal(vendorKey('deepseek-ai/janus-pro'), 'deepseek');
  assert.equal(vendorKey('yi-lightning'), 'yi');
  assert.equal(vendorKey('yield-7b'), null);
  assert.equal(vendorKey('mystery-model'), null);

  assert.deepEqual(
    { name: vendorFamily('acme').name, description: vendorFamily('acme').description, auto: vendorFamily('acme').auto },
    { name: 'Acme', description: 'Other Acme models', auto: true },
  );
  assert.equal(vendorFamily('nvidia').name, 'NVIDIA');
  assert.equal(vendorFamily('some-lab').name, 'Some Lab');

  const providers = [
    ...live,
    { id: 'synthetic', status: 'active', models: [{ id: 'acme/foo-1' }, { id: 'deepseek-v9-pro' }, { id: 'mystery-model' }, { id: 'acme/old', status: 'deprecated' }] },
    { id: 'archived', status: 'archived', models: [{ id: 'zeta/bar-2' }] },
  ];
  const result = classifyModels(providers);
  assert.deepEqual(familiesOf(result, 'synthetic', 'acme/foo-1'), ['vendor-acme']);
  assert.deepEqual(familiesOf(result, 'synthetic', 'deepseek-v9-pro'), ['vendor-deepseek']);
  assert.deepEqual(otherIds(result), ['synthetic:mystery-model']);
  assert.ok(!result.families.some(f => f.family.id === 'vendor-zeta'), 'inactive providers are skipped');
  const acme = result.families.find(f => f.family.id === 'vendor-acme');
  assert.deepEqual(acme.entries[0].models.map(m => m.id), ['acme/foo-1'], 'deprecated models are hidden');

  // Explicit families keep their order and come before auto cards, which are sorted by name.
  const ids = result.families.map(f => f.family.id);
  const explicit = ids.filter(id => !id.startsWith('vendor-'));
  assert.deepEqual(explicit, MODEL_FAMILIES.map(f => f.id).filter(id => explicit.includes(id)));
  assert.ok(ids.findIndex(id => id.startsWith('vendor-')) > ids.lastIndexOf(explicit.at(-1)));
  const auto = result.families.filter(f => f.family.auto).map(f => f.family.name);
  assert.deepEqual(auto, [...auto].sort((a, b) => a.localeCompare(b)));
});

test('family tags agree with catalog modalities (MiniCPM entries are text-only)', () => {
  const minicpm = MODEL_FAMILIES.find(f => f.id === 'minicpm');
  assert.ok(!minicpm.tags?.includes('vision'));
});

test('archived providers, if reactivated, get one card per vendor and readable names', () => {
  const reactivated = bundled.map(p => ({ ...p, status: 'active' }));
  const result = classifyModels(reactivated);
  const family = (providerId, modelId) => familiesOf(result, providerId, modelId);
  for (const id of ['ministral-14b-2512', 'ministral-8b-2512', 'ministral-3b-2512']) {
    const owner = reactivated.find(p => p.models.some(m => m.id === id));
    if (owner) assert.deepEqual(family(owner.id, id), ['mistral'], id);
  }
  assert.deepEqual(MODEL_FAMILIES.filter(f => f.match('devstral-small-2')).map(f => f.id), ['mistral']);
  assert.deepEqual(MODEL_FAMILIES.filter(f => f.match('openai/o3-mini')).map(f => f.id), ['o-series']);
  assert.equal(vendorKey('ai21-labs/ai21-jamba-1.5-large'), 'jamba');
  assert.equal(vendorFamily('jamba').name, 'Jamba');

  // An auto card whose category already has an explicit family must not read as
  // that family's duplicate: its vendor must not be one an explicit family owns.
  const explicitByCategory = new Map();
  for (const f of MODEL_FAMILIES) explicitByCategory.set(f.category, [...(explicitByCategory.get(f.category) ?? []), f]);
  for (const { family: auto, entries } of result.families.filter(f => f.family.auto)) {
    const explicit = explicitByCategory.get(auto.category) ?? [];
    for (const f of explicit) {
      assert.ok(!f.name.toLowerCase().startsWith(auto.name.toLowerCase()), `auto card "${auto.name}" duplicates "${f.name}"`);
    }
    const ids = entries.flatMap(e => e.models.map(m => m.id));
    assert.ok(!['vendor-mistral', 'vendor-openai'].includes(auto.id), `${auto.id} should be absorbed by an explicit family: ${ids.join(', ')}`);
  }
});
