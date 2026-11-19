import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { findLeaks } from '../scripts/check-public-tree.mjs';

test('the public tree contains no private checker or management material', () => {
  assert.deepEqual(findLeaks(), []);
});

test('the leak guard catches private paths and management routes', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'public-tree-'));
  try {
    mkdirSync(resolve(dir, 'checker-worker'));
    mkdirSync(resolve(dir, 'site/src'), { recursive: true });
    // Fixture strings are assembled at runtime so this file does not itself trip the guard.
    writeFileSync(resolve(dir, 'site/src/x.ts'), `fetch('/api/${'ad' + 'min'}/catalog')`);
    writeFileSync(resolve(dir, 'site/src/y.md'), `set ${'ADMIN' + '_SECRET'} first`);
    const leaks = findLeaks(dir).join('\n');
    assert.match(leaks, /checker-worker: private/);
    assert.match(leaks, /site\/src\/x\.ts/);
    assert.match(leaks, /site\/src\/y\.md/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
