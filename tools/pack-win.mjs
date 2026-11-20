// node tools/pack-win.mjs — Ironleaf as a Windows app folder (dist/Ironleaf), until the real installer and updater
// (plan phase 5): Electron's own runtime with electron.exe as Ironleaf.exe, and resources/app holding the built app,
// its icon and only the libraries it runs (the production packages, copied as installed, so the former host app's pi-ai
// patches come with them). Run on Windows after `npm ci` and `npm run build`; tools/install-win.ps1 installs the
// folder.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEANING_MODEL_DIR, RERANK_MODEL_DIR, SPEAKER_MODEL_DIR, trimOrtCommon, trimOrtDist } from './ort-ship.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, 'node_modules', 'electron', 'dist');
const out = path.join(root, 'dist', 'Ironleaf');
const fail = (words) => { console.error('pack-win: ' + words); process.exit(1); };
// npm 11 may leave out Electron's own download step (seen on Office-PC, 16 Oct 2026): it is run once here when missing.
if (!existsSync(path.join(runtime, 'electron.exe')) && existsSync(path.join(root, 'node_modules', 'electron', 'install.js'))) execFileSync(process.execPath, [path.join(root, 'node_modules', 'electron', 'install.js')], { cwd: path.join(root, 'node_modules', 'electron'), stdio: 'inherit' });
if (!existsSync(path.join(runtime, 'electron.exe'))) fail('the Windows Electron runtime is not in node_modules/electron/dist (run npm ci on Windows).');
if (!existsSync(path.join(root, 'out', 'main', 'index.js'))) fail('the app is not built (run npm run build).');

rmSync(out, { recursive: true, force: true });
mkdirSync(path.dirname(out), { recursive: true });
cpSync(runtime, out, { recursive: true });
renameSync(path.join(out, 'electron.exe'), path.join(out, 'Ironleaf.exe'));
// Electron's own sample app would otherwise answer when resources/app is missing.
rmSync(path.join(out, 'resources', 'default_app.asar'), { force: true });

const app = path.join(out, 'resources', 'app');
mkdirSync(app, { recursive: true });
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: pkg.name, productName: 'Ironleaf', version: pkg.version, description: pkg.description, main: pkg.main, dependencies: pkg.dependencies }, null, 2));
cpSync(path.join(root, 'out'), path.join(app, 'out'), { recursive: true });
cpSync(path.join(root, 'resources'), path.join(app, 'resources'), { recursive: true });
// The web clipper's extension (8.8): Settings' Get the extension shows this folder to load unpacked.
if (existsSync(path.join(root, 'extensions', 'clipper'))) cpSync(path.join(root, 'extensions', 'clipper'), path.join(app, 'extensions', 'clipper'), { recursive: true });
// The extra far-side capture (m6-any-speaker-capture, 6 Nov 2026): the contained child beside its library, as the
// manager resolves them (extra-loopback-paths walk up from out/main to this folder's vendor and src copies in a dev
// tree; the packed app carries them whole).
cpSync(path.join(root, 'src', 'main', 'extra-loopback-child.cjs'), path.join(app, 'extra-loopback', 'child.cjs'));
cpSync(path.join(root, 'vendor', 'native-recorder-nodejs'), path.join(app, 'extra-loopback', 'vendor', 'native-recorder-nodejs'), { recursive: true });

// The production packages, each copied without its own node_modules (the nested ones are listed and copied in turn).
const listed = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
let copied = 0;
for (const dir of listed) {
  const rel = path.relative(root, dir);
  if (!rel || rel.startsWith('..') || !rel.split(path.sep).includes('node_modules')) continue;
  cpSync(dir, path.join(app, rel), { recursive: true, filter: (src) => !path.relative(dir, src).split(path.sep).includes('node_modules') });
  copied++;
}
const size = (p) => { const s = statSync(p); return s.isDirectory() ? readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0) : s.size; };
// The on-device models ship with resources/ above (10.0 m10rerank adds the cross-encoder beside the meaning model):
// a missing model file fails the pack rather than shipping search that silently falls back.
for (const m of [MEANING_MODEL_DIR, RERANK_MODEL_DIR]) {
  if (!existsSync(path.join(app, 'resources', 'models', m, 'onnx', 'model_quantized.onnx')) || !existsSync(path.join(app, 'resources', 'models', m, 'tokenizer.json'))) {
    fail(`the ${m} model is not in resources/models (it ships with the app; check the folder is complete).`);
  }
}
// The speaker models beside them (6 Nov 2026, speakers): a missing model fails the pack rather than shipping
// meetings whose voices silently stay You and Others.
for (const f of ['segmentation-3-0-int8.onnx', 'campplus-zh-en-advanced.onnx']) {
  if (!existsSync(path.join(app, 'resources', 'models', SPEAKER_MODEL_DIR, f))) {
    fail(`the speaker model ${f} is not in resources/models (it ships with the app; check the folder is complete).`);
  }
}
// The speaker worker beside the app (built by tools/build-speaker-worker.mjs through `npm run build`).
if (!existsSync(path.join(app, 'out', 'main', 'speaker-worker.cjs'))) {
  fail('the speaker worker (out/main/speaker-worker.cjs) was not built; run `npm run build` first.');
}
// The meaning worker beside it (9 Nov 2026, off the main thread; built by tools/build-meaning-worker.mjs).
if (!existsSync(path.join(app, 'out', 'main', 'meaning-worker.cjs'))) {
  fail('the meaning worker (out/main/meaning-worker.cjs) was not built; run `npm run build` first.');
}
// Real find-by-meaning (10.0 Wave 2): the runner ships trimmed (its one WASM build, not the dozen; its shared
// package's plain scripts, not the browser builds or type files), the model with resources/ above.
const ort = trimOrtDist(path.join(app, 'node_modules', 'onnxruntime-web', 'dist'));
trimOrtCommon(path.join(app, 'node_modules', 'onnxruntime-common'));
console.log(`pack-win: dist/Ironleaf (${copied} packages, ${Math.round(size(out) / 1048576)} MB; meaning runner: ${ort.kept.join(', ')}; meaning: ${MEANING_MODEL_DIR}, ${RERANK_MODEL_DIR})`);
