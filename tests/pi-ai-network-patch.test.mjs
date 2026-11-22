// node --test tests/pi-ai-network-patch.test.mjs — the network-errors patch to pi-ai (tools/pi-ai-patches/network-errors.cjs)
// lands once, whatever an earlier version of it left. A copy patched under the old helper name and then again under
// the new one declared `network` twice, so pi-ai's error-body.js failed to load and every model call failed with
// "Identifier 'network' has already been declared". Patching such a copy repairs it; patching twice changes nothing.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const N = require('../tools/pi-ai-patches/network-errors.cjs');

// pi-ai's own shape around the patched place, small.
const PLAIN = `const extractStatus = (e) => e.status;\n${N.BEFORE}\n    return { message: error.message, messageCarriesBody: true };\n}\n//# sourceMappingURL=error-body.js.map\n`;
const count = (s, re) => (s.match(re) || []).length;
const loads = (s) => {
  // Parsed as a function body (no module syntax needed for the check): a second `const network` throws here.
  new Function(s.replace(/^export /gm, ''));
  return true;
};

test('pi-ai’s plain code is patched once, and patching again changes nothing', () => {
  const once = N.patch(PLAIN);
  assert.equal(count(once, /const network = status/g), 1);
  assert.equal(count(once, /\nfunction networkReasonFromCause\(/g), 1);
  assert.ok(loads(once));
  assert.equal(N.patch(once), once);
});

test('a copy patched twice (old name, then new) is repaired to one patch', () => {
  const once = N.patch(PLAIN);
  const call = once.slice(once.indexOf('\n    // Ironleaf: a call'), once.indexOf('messageCarriesBody: true };') + 'messageCarriesBody: true };'.length);
  const helper = once.slice(once.indexOf('\n// Ironleaf: the reason'));
  // As found on a build machine: the old block (renamed to the new helper name) under the new one, and two helpers.
  const twice = once.replace(call, call + call.replace('// Ironleaf:', '// NeuralVault:')) + helper;
  assert.throws(() => loads(twice), /already been declared/, 'the doubled copy does not load');
  const repaired = N.patch(twice);
  assert.equal(count(repaired, /const network = status/g), 1, 'one call');
  assert.equal(count(repaired, /\nfunction networkReasonFromCause\(/g), 1, 'one helper');
  assert.ok(loads(repaired));
  assert.equal(repaired, once, 'the same as patching pi-ai’s own code');
});

test('an old copy under the old helper name alone is renamed into one patch', () => {
  const once = N.patch(PLAIN);
  const old = once.replace(/networkReasonFromCause/g, 'neuralSparkNetworkReason').replace(/\/\/ Ironleaf: /g, '// NeuralSpark: ');
  assert.equal(N.patch(old), once);
  assert.equal(N.unpatch(once), PLAIN, 'unpatched, it is pi-ai’s own code again');
});
