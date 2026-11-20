// node tools/build-meaning-worker.mjs [--to <folder>] — the meaning models' worker as one file its thread runs:
// src/main/meaning-worker.ts (the embedder and reranker, bundled) with only Node's own modules beside it. Into
// out/main/ beside the built app normally; --to lays it beside an embedded main.cjs instead. Run by `npm run build`
// after electron-vite, and by tools/build-embedded.mjs for the embed. Fails rather than shipping no worker: without
// it the models run in-process, which the app allows, but the product promises its own thread (9 Nov 2026, the
// owner's stutters).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const toAt = process.argv.indexOf('--to');
const to = toAt > 0 ? path.resolve(process.argv[toAt + 1] || '') : null;
const out = to ? path.join(to, 'meaning-worker.cjs') : path.join(root, 'out', 'main', 'meaning-worker.cjs');
mkdirSync(path.dirname(out), { recursive: true });

const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
await build({
  input: path.join(root, 'src', 'main', 'meaning-worker.ts'),
  platform: 'node',
  external: [/^node:/, 'electron'],
  // Minified with no comments, like the app's own bundle (electron.vite.config.ts).
  output: { file: out, format: 'cjs', exports: 'named', minify: true, comments: false },
  logLevel: 'warn',
});

// The worker needs nothing it doesn't carry: Node's own modules, and onnxruntime-web loaded lazily at run time
// (never bundled, never imported statically — the shipped files sit beside the bundle instead).
const bundle = readFileSync(out, 'utf8');
const { builtinModules } = await import('node:module');
const stray = [...bundle.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]).filter((m) => m !== 'electron' && !m.startsWith('node:') && !builtinModules.includes(m));
if (stray.length) throw new Error('build-meaning-worker: the bundle needs ' + [...new Set(stray)].join(', '));
if (!existsSync(out)) throw new Error('build-meaning-worker: no worker was written.');
console.log(`build-meaning-worker: ${path.relative(root, out)}`);
