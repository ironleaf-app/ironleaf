// node --test tests/vault-notices.test.mjs — the Vault's own third-party notices (6 Nov 2026;
// tools/vault-notices.mjs, tools/build-embedded.mjs): Ironleaf builds its window from its own packages
// (Apache ECharts draws its charts), so the embed it hands the former host app carries their names,
// versions and licence texts (THIRD_PARTY_NOTICES.txt beside the bundle), which the release build folds
// into the product's notices. Made-up packages in fixtures; the ECharts licence itself is read from this
// repo's own installed copy.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vault-notices-'));
after(() => rmSync(work, { recursive: true, force: true }));

test('each shipped package with its licence text, grouped like the product’s notices', async () => {
  const { collectVaultNotices } = await import(pathToFileURL(path.join(root, 'tools/vault-notices.mjs')).href);
  const dir = path.join(work, 'fake');
  mkdirSync(path.join(dir, 'node_modules/alpha'), { recursive: true });
  mkdirSync(path.join(dir, 'node_modules/@scope/gamma'), { recursive: true });
  mkdirSync(path.join(dir, 'node_modules/beta'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'neuralvault', version: '1.0.0', dependencies: { alpha: '^1.0.0', '@scope/gamma': '~2.1.0', beta: '3.0.0' } }));
  writeFileSync(path.join(dir, 'node_modules/alpha/package.json'), JSON.stringify({ name: 'alpha', version: '1.0.0', license: 'MIT' }));
  writeFileSync(path.join(dir, 'node_modules/alpha/LICENSE'), 'MIT License\nFake alpha text.');
  writeFileSync(path.join(dir, 'node_modules/@scope/gamma/package.json'), JSON.stringify({ name: '@scope/gamma', version: '2.1.3', license: 'Apache-2.0' }));
  writeFileSync(path.join(dir, 'node_modules/@scope/gamma/LICENSE.txt'), 'Apache License\nFake gamma text.');
  writeFileSync(path.join(dir, 'node_modules/beta/package.json'), JSON.stringify({ name: 'beta', version: '3.0.0', license: 'ISC' }));
  const { text, packages } = await collectVaultNotices(dir, { version: '1.0.0' });
  assert.match(text, /Third-party notices for Ironleaf 1\.0\.0/);
  assert.match(text, /alpha 1\.0\.0 \(MIT\)/);
  assert.match(text, /Fake alpha text\./);
  assert.match(text, /@scope\/gamma 2\.1\.3 \(Apache-2\.0\)/);
  assert.match(text, /Fake gamma text\./);
  assert.match(text, /beta 3\.0\.0 \(ISC\)/, 'a package whose licence lives only in its package information is still named');
  assert.equal(packages, 3);
});

test('the ECharts licence, from this repo’s own installed copy', async () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'node_modules/echarts/package.json'), 'utf8'));
  assert.equal(manifest.license, 'Apache-2.0');
  const text = readFileSync(path.join(root, 'node_modules/echarts/LICENSE'), 'utf8');
  assert.ok(text.includes('Apache License') && text.length > 1000, 'the full Apache text travels with the package');
  const { collectVaultNotices } = await import(pathToFileURL(path.join(root, 'tools/vault-notices.mjs')).href);
  const { text: notices } = await collectVaultNotices(root, { version: '1.0.0' });
  assert.match(notices, new RegExp(`echarts ${manifest.version.replace(/\./g, '\\.')} \\(Apache-2\\.0\\)`));
});

test('the speaker models and adapted code ride the notices with their licence texts', async () => {
  const { collectVaultNotices } = await import(pathToFileURL(path.join(root, 'tools/vault-notices.mjs')).href);
  const { text } = await collectVaultNotices(root, { version: '1.0.0' });
  assert.match(text, /== Models and adapted code ==/);
  assert.match(text, /pyannote segmentation 3\.0 model.*MIT/);
  assert.match(text, /3D-Speaker CAM\+\+ voice model.*Apache-2\.0/);
  assert.match(text, /sherpa-onnx speaker-diarization pipeline, adapted/);
  assert.match(text, /kaldi-native-fbank filterbank, adapted/);
  assert.match(text, /MIT License/);
  assert.match(text, /Apache License/);
});
