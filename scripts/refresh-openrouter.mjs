#!/usr/bin/env node
// Compatibility entry point. Explicit --write is now required to change files.
import { main } from './sync-catalog.mjs';
main(['--provider', 'openrouter', ...process.argv.slice(2)])
  .then(code => { process.exitCode = code; })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
