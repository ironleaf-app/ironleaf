// The meaning runner's files that ship with Ironleaf (10.0 Wave 2, 2 Nov 2026: real find-by-meaning runs on
// WebAssembly in the main process): the Node runner, the one threaded WASM build it loads, and the small shared
// package the runner requires — nothing else (no asyncify, no jsep, no browser bundles, no type files). Both doors use
// this list: tools/pack-win.mjs trims the installed copies to it, tools/build-embedded.mjs copies the set beside the
// bundle for the former host app (with the shared package in a node_modules beside the runner, as require() finds it).
// tests/meaning-embed.test.mjs proves the set runs (real inference from a trimmed copy) and nothing else is needed.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/** The onnxruntime-web dist files that ship (the runner, its WASM glue, its WASM). */
export const ORT_SHIP_FILES = ['ort.node.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

/** The runner's name beside the bundle: CommonJS under any scope (6 Nov 2026, speakers-apart — the installed app
 *  reads as a module, and require() of the .js threw there, so every transcript stayed You and Others). */
export const ORT_EMBED_FILE = 'ort.node.min.cjs';

/** The model folder that ships (whole: the model, its words, its source note). */
export const MEANING_MODEL_DIR = 'all-MiniLM-L6-v2';

/** The rerank model folder that ships beside it (10.0 m10rerank: the cross-encoder, whole, as above). */
export const RERANK_MODEL_DIR = 'ms-marco-MiniLM-L-6-v2';

/** The speaker model folder that ships beside it (6 Nov 2026, speakers: the segmentation and the voice model, whole,
 *  with their licence texts and source note). */
export const SPEAKER_MODEL_DIR = 'speaker';

/** Trims an installed onnxruntime-web/dist to the shipped set; returns what was kept and removed. */
export function trimOrtDist(distDir) {
  const kept = [];
  const removed = [];
  for (const name of readdirSync(distDir)) {
    if (ORT_SHIP_FILES.includes(name)) kept.push(name);
    else {
      rmSync(path.join(distDir, name), { recursive: true, force: true });
      removed.push(name);
    }
  }
  const missing = ORT_SHIP_FILES.filter((n) => !kept.includes(n));
  if (missing.length) throw new Error(`ort-ship: no ${missing.join(', ')} in ${distDir} (run npm ci first)`);
  return { kept, removed };
}

/** Trims an installed onnxruntime-common to what the runner requires (its manifest, its plain scripts). */
export function trimOrtCommon(pkgDir) {
  const kept = [];
  const removed = [];
  for (const name of readdirSync(pkgDir)) {
    if (name === 'package.json' || name === 'dist') continue;
    rmSync(path.join(pkgDir, name), { recursive: true, force: true });
    removed.push(name);
  }
  const cjs = path.join(pkgDir, 'dist', 'cjs');
  if (!existsSync(path.join(cjs, 'index.js')) || !existsSync(path.join(pkgDir, 'package.json'))) {
    throw new Error(`ort-ship: onnxruntime-common is not installed in ${pkgDir} (run npm ci first)`);
  }
  for (const name of readdirSync(path.join(pkgDir, 'dist'))) {
    if (name === 'cjs') continue;
    rmSync(path.join(pkgDir, 'dist', name), { recursive: true, force: true });
    removed.push(`dist/${name}`);
  }
  for (const name of readdirSync(cjs)) {
    // Its scripts, and the manifest naming them CommonJS (the package itself reads as a module).
    if (name === 'package.json' || (/\.js$/.test(name) && !/\.map$/.test(name))) kept.push(`dist/cjs/${name}`);
    else {
      rmSync(path.join(cjs, name), { recursive: true, force: true });
      removed.push(`dist/cjs/${name}`);
    }
  }
  kept.unshift('package.json');
  return { kept, removed };
}

/** Copies the shipped set beside a bundle (for the former host app's embedded copy). The runner is renamed to CommonJS on
 *  the way (its upstream name would read as a module under the installed app's package, and require() would throw). */
export function copyOrtShip(distDir, commonDir, toDir) {
  for (const name of ORT_SHIP_FILES) {
    if (!existsSync(path.join(distDir, name))) throw new Error(`ort-ship: no ${name} in ${distDir} (run npm ci first)`);
  }
  if (!existsSync(path.join(commonDir, 'package.json')) || !existsSync(path.join(commonDir, 'dist', 'cjs', 'index.js'))) {
    throw new Error(`ort-ship: onnxruntime-common is not installed in ${commonDir} (run npm ci first)`);
  }
  mkdirSync(toDir, { recursive: true });
  for (const name of ORT_SHIP_FILES) cpSync(path.join(distDir, name), path.join(toDir, name === ORT_SHIP_FILES[0] ? ORT_EMBED_FILE : name));
  const commonTo = path.join(toDir, 'node_modules', 'onnxruntime-common');
  mkdirSync(path.join(commonTo, 'dist', 'cjs'), { recursive: true });
  cpSync(path.join(commonDir, 'package.json'), path.join(commonTo, 'package.json'));
  for (const name of readdirSync(path.join(commonDir, 'dist', 'cjs'))) {
    if (name === 'package.json' || (/\.js$/.test(name) && !/\.map$/.test(name))) cpSync(path.join(commonDir, 'dist', 'cjs', name), path.join(commonTo, 'dist', 'cjs', name));
  }
  return [ORT_EMBED_FILE, ...ORT_SHIP_FILES.slice(1), 'node_modules/onnxruntime-common'];
}
