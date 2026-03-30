#!/usr/bin/env node
/**
 * validate.mjs
 *
 * Schema validation for providers.json and changelog.json.
 * Run automatically on every PR via GitHub Actions, and as a pre-commit hook.
 *
 * Usage:
 *   node scripts/validate.mjs
 *
 * Exit code 0 → all files valid
 * Exit code 1 → one or more validation errors found
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
let hasError = false;

/**
 * Reads and parses a JSON file, then calls the provided validator function.
 * Sets `hasError = true` on parse failure so the process exits with code 1.
 *
 * @param {string} relPath - Path relative to the repo root
 * @param {(data: unknown, path: string) => void} fn - Validator callback
 */
function validate(relPath, fn) {
  const abs = resolve(ROOT, relPath);
  let data;
  try {
    data = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    console.error(`❌ ${relPath}: invalid JSON — ${e.message}`);
    hasError = true;
    return;
  }
  fn(data, relPath);
}

// ── providers.json ────────────────────────────────────────────────────────
validate('site/src/data/providers.json', (data, path) => {
  const required = ['id', 'name', 'base_url', 'status', 'auth', 'top_models', 'models', 'last_verified'];

  // 'degraded' and 'dead' are runtime states stored in Cloudflare KV.
  // Only 'active' and 'archived' are valid values in the static JSON file.
  const validStatuses = ['active', 'archived'];

  const errors = [];

  data.forEach((p, i) => {
    const label = `providers[${i}] (${p.id || 'unknown'})`;

    // Check all required fields are present
    required.forEach(field => {
      if (p[field] === undefined) errors.push(`${label}: missing '${field}'`);
    });

    // Validate status value
    if (p.status && !validStatuses.includes(p.status)) {
      errors.push(`${label}: invalid status '${p.status}' (allowed: ${validStatuses.join(', ')})`);
    }

    // uptime_90d must contain exactly 90 daily entries if present
    if (p.uptime_90d && p.uptime_90d.length !== 90) {
      errors.push(`${label}: uptime_90d must have exactly 90 entries (got ${p.uptime_90d.length})`);
    }
  });

  if (errors.length > 0) {
    console.error(`❌ ${path}:\n  ` + errors.join('\n  '));
    hasError = true;
  } else {
    console.log(`✅ ${path} (${data.length} providers)`);
  }
});

// ── changelog.json ────────────────────────────────────────────────────────
validate('site/src/data/changelog.json', (data, path) => {
  const required = ['id', 'date', 'provider_id', 'type', 'title'];
  const errors = [];

  data.forEach((c, i) => {
    const label = `changelog[${i}]`;

    // Check all required fields are present
    required.forEach(field => {
      if (c[field] === undefined) errors.push(`${label}: missing '${field}'`);
    });

    // Date must follow YYYY-MM-DD format
    if (c.date && !/^\d{4}-\d{2}-\d{2}$/.test(c.date)) {
      errors.push(`${label}: date must be YYYY-MM-DD (got '${c.date}')`);
    }
  });

  if (errors.length > 0) {
    console.error(`❌ ${path}:\n  ` + errors.join('\n  '));
    hasError = true;
  } else {
    console.log(`✅ ${path} (${data.length} entries)`);
  }
});

if (hasError) process.exit(1);
