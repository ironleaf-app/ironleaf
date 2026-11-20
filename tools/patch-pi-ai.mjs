// node tools/patch-pi-ai.mjs — Ironleaf's changes to its copy of pi-ai (the model library), so model calls fail in
// plain words and keep their prompt cache. The three modules in tools/pi-ai-patches/ (network-errors, prompt-cache-key,
// provider-error-labels) each refuse to apply if pi-ai's code has changed shape, so a pi-ai upgrade can't silently
// drop one. pi-ai stays at the exact version these were written for (package.json pins it).
// Runs on install and before every build; applying twice changes nothing.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const network = require('./pi-ai-patches/network-errors.cjs');
const cacheKey = require('./pi-ai-patches/prompt-cache-key.cjs');
const labels = require('./pi-ai-patches/provider-error-labels.cjs');

const dist = path.join(root, 'node_modules', '@earendil-works', 'pi-ai', 'dist');
if (!existsSync(dist)) {
  console.log('patch-pi-ai: pi-ai is not installed yet; nothing to patch');
  process.exit(0);
}
const version = JSON.parse(readFileSync(path.join(dist, '..', 'package.json'), 'utf8')).version;
if (version !== '0.87.1') throw new Error(`patch-pi-ai: pi-ai ${version} found; these patches are for 0.87.1 (see package.json)`);

// The network reasons as written name another app and its Settings › Network; here they name Ironleaf.
const ownWords = (source) =>
  source
    .replace(/ Check Settings \\u203a Network\./g, ' Check this PC\\u2019s network and proxy settings.');

const steps = [
  ['utils/error-body.js', (s) => ownWords(network.patch(s))],
  ['api/openai-completions.js', (s) => cacheKey.patch(s)],
  ['api/openai-responses.js', (s) => labels.patch(cacheKey.patchResponses(s)).out],
];
// A copy patched by an earlier version of these patches carries the old app's name in its labels: renamed first, so
// the checks below see the patch as applied and nothing ships naming another product.
const renamed = (source) =>
  source
    .replace(/neuralSparkNetworkReason/g, 'networkReasonFromCause')
    .replace(/\/\/ NeuralSpark \([^)]*\): /g, '// Ironleaf: ')
    .replace(/\/\/ NeuralSpark: /g, '// Ironleaf: ')
    .replace(/\/\* NeuralSpark: /g, '/* Ironleaf: ');

let changed = 0;
for (const [rel, change] of steps) {
  const file = path.join(dist, rel);
  const before = readFileSync(file, 'utf8');
  const after = change(renamed(before));
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
  }
}
console.log(`patch-pi-ai: pi-ai changes in place (${changed} file${changed === 1 ? '' : 's'} updated now)`);
