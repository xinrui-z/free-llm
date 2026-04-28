#!/usr/bin/env node
/**
 * validate.mjs
 *
 * Schema validation for the per-provider JSON files under
 * `site/src/data/providers/` and `site/src/data/changelog.json`.
 * Run automatically on every PR via GitHub Actions, and as a pre-commit hook.
 *
 * Usage:
 *   node scripts/validate.mjs
 *
 * Exit code 0 → all files valid
 * Exit code 1 → one or more validation errors found
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const PROVIDERS_DIR = resolve(ROOT, 'site/src/data/providers');
let hasError = false;

function loadJSON(absPath, label) {
  try {
    return JSON.parse(readFileSync(absPath, 'utf8'));
  } catch (e) {
    console.error(`❌ ${label}: invalid JSON — ${e.message}`);
    hasError = true;
    return null;
  }
}

// ── per-provider files ────────────────────────────────────────────────────
const required = ['id', 'name', 'base_url', 'status', 'auth', 'top_models', 'models', 'last_verified'];
// 'degraded' and 'dead' are runtime states stored in Cloudflare KV.
// Only 'active' and 'archived' are valid values in the static JSON files.
const validStatuses = ['active', 'archived'];

const files = readdirSync(PROVIDERS_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'))
  .sort();

const seenIds = new Set();
const providerErrors = [];

for (const file of files) {
  const relPath = `site/src/data/providers/${file}`;
  const data = loadJSON(resolve(PROVIDERS_DIR, file), relPath);
  if (!data) continue;

  const label = `${relPath}`;
  const expectedId = file.replace(/\.json$/, '');

  required.forEach(field => {
    if (data[field] === undefined) providerErrors.push(`${label}: missing '${field}'`);
  });

  if (data.id !== expectedId) {
    providerErrors.push(`${label}: id '${data.id}' does not match filename '${expectedId}'`);
  }
  if (seenIds.has(data.id)) {
    providerErrors.push(`${label}: duplicate id '${data.id}'`);
  }
  seenIds.add(data.id);

  if (data.status && !validStatuses.includes(data.status)) {
    providerErrors.push(`${label}: invalid status '${data.status}' (allowed: ${validStatuses.join(', ')})`);
  }
  if (data.uptime_90d && data.uptime_90d.length !== 90) {
    providerErrors.push(`${label}: uptime_90d must have exactly 90 entries (got ${data.uptime_90d.length})`);
  }
}

// ── _order.json sanity ────────────────────────────────────────────────────
const orderPath = resolve(PROVIDERS_DIR, '_order.json');
const orderData = loadJSON(orderPath, 'site/src/data/providers/_order.json');
if (orderData) {
  if (!Array.isArray(orderData.order)) {
    providerErrors.push(`_order.json: 'order' must be an array`);
  } else {
    const fileIds = new Set(files.map(f => f.replace(/\.json$/, '')));
    for (const id of orderData.order) {
      if (!fileIds.has(id)) providerErrors.push(`_order.json: references unknown id '${id}'`);
    }
    for (const id of fileIds) {
      if (!orderData.order.includes(id)) providerErrors.push(`_order.json: missing id '${id}' (found a file but not listed)`);
    }
  }
}

if (providerErrors.length > 0) {
  console.error(`❌ providers/:\n  ` + providerErrors.join('\n  '));
  hasError = true;
} else {
  console.log(`✅ site/src/data/providers/ (${files.length} providers)`);
}

// ── changelog.json ────────────────────────────────────────────────────────
const changelogPath = resolve(ROOT, 'site/src/data/changelog.json');
const changelog = loadJSON(changelogPath, 'site/src/data/changelog.json');
if (changelog) {
  const clRequired = ['id', 'date', 'provider_id', 'type', 'title'];
  const errors = [];
  changelog.forEach((c, i) => {
    const label = `changelog[${i}]`;
    clRequired.forEach(field => {
      if (c[field] === undefined) errors.push(`${label}: missing '${field}'`);
    });
    if (c.date && !/^\d{4}-\d{2}-\d{2}$/.test(c.date)) {
      errors.push(`${label}: date must be YYYY-MM-DD (got '${c.date}')`);
    }
  });
  if (errors.length > 0) {
    console.error(`❌ site/src/data/changelog.json:\n  ` + errors.join('\n  '));
    hasError = true;
  } else {
    console.log(`✅ site/src/data/changelog.json (${changelog.length} entries)`);
  }
}

if (hasError) process.exit(1);
