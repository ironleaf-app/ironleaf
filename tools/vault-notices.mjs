// The Vault's own third-party notices (6 Nov 2026): Ironleaf builds its window from its own packages
// (Apache ECharts draws its charts), so the embed it hands the former host app carries their names,
// versions and licence texts beside the bundle (THIRD_PARTY_NOTICES.txt, written by
// tools/build-embedded.mjs), which the release build folds into the product's notices. Only runtime
// dependencies ship in the bundle; development packages never do. Shaped like recovery-build/notices.cjs in
// the former host app: each package under its licence text, packages whose licence lives only in their
// package information named at the end.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const LICENCE_FILE = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?(?:\.(?:md|txt|markdown|rst))?$/i;
const tidy = (text) => text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

async function licenceTexts(dir) {
  const texts = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !LICENCE_FILE.test(entry.name)) continue;
    const text = await readFile(path.join(dir, entry.name), 'utf8').catch(() => '');
    if (text && text.trim()) texts.push(tidy(text));
  }
  return texts;
}

/** The notices for the Vault's shipped packages, from its package.json and installed copies. */
export async function collectVaultNotices(root, { version = '' } = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8').catch(() => '{}'));
  const deps = Object.keys(manifest.dependencies || {}).sort();
  const groups = new Map(), noText = [];
  const one = async (dir, fallback) => {
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8').catch(() => 'null'));
    if (!pkg && !fallback) return false;
    const label = `${pkg?.name || fallback} ${pkg?.version || ''}`.trim();
    const licence = typeof pkg?.license === 'string' ? pkg.license : pkg?.license?.type || '';
    const texts = await licenceTexts(dir);
    if (!texts.length) { noText.push(label + (licence ? ` (${licence})` : '')); return true; }
    for (const text of texts) {
      const row = groups.get(text) || { text, labels: new Set() };
      row.labels.add(label + (licence ? ` (${licence})` : ''));
      groups.set(text, row);
    }
    return true;
  };
  for (const name of deps) await one(path.join(root, 'node_modules', ...name.split('/')), name);
  // Vendored libraries (vendor/*, shipped beside the bundle rather than installed: the extra capture's recorder).
  let vendored = 0;
  for (const entry of await readdir(path.join(root, 'vendor'), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    if (await one(path.join(root, 'vendor', entry.name), entry.name)) vendored++;
  }
  const ordered = [...groups.values()].sort((a, b) => [...a.labels][0].localeCompare([...b.labels][0]));
  const lines = [`Third-party notices for Ironleaf${version ? ` ${version}` : ''}`, '',
    'Ironleaf includes the open-source software listed below, as bundled in its window. Each is used under its own licence, whose text follows the packages it covers.', '',
    '== Libraries ==', ''];
  for (const row of ordered) lines.push([...row.labels].sort().join('\n'), '', row.text, '', '----', '');
  if (noText.length) lines.push('Packages whose licence is named in their package information without a separate licence file:', '', noText.sort().join('\n'), '');
  // The on-device models and the adapted code that runs them (6 Nov 2026, speakers): their licence texts ship
  // beside them in resources/models/speaker/ and ride here, so the product's notices name them.
  const speakerDir = path.join(root, 'resources', 'models', 'speaker');
  const mit = await readFile(path.join(speakerDir, 'LICENSE-pyannote-segmentation-3.0'), 'utf8').catch(() => '');
  const apache = await readFile(path.join(speakerDir, 'LICENSE-Apache-2.0'), 'utf8').catch(() => '');
  if (mit.trim() || apache.trim()) {
    lines.push('== Models and adapted code ==', '');
    if (mit.trim()) {
      lines.push('pyannote segmentation 3.0 model, sherpa-onnx export (MIT, CNRS) — resources/models/speaker/segmentation-3-0-int8.onnx', '', tidy(mit), '', '----', '');
    }
    if (apache.trim()) {
      lines.push(
        ['3D-Speaker CAM++ voice model, sherpa-onnx export (Apache-2.0, Alibaba DAMO) — resources/models/speaker/campplus-zh-en-advanced.onnx',
          'sherpa-onnx speaker-diarization pipeline, adapted (Apache-2.0, k2-fsa/sherpa-onnx, Copyright Xiaomi Corporation)',
          'kaldi-native-fbank filterbank, adapted (Apache-2.0, csukuangfj/kaldi-native-fbank)'].join('\n'),
        '', tidy(apache), '', '----', '');
    }
  }
  return { text: lines.join('\n'), packages: deps.length + vendored, licenceTexts: groups.size };
}
