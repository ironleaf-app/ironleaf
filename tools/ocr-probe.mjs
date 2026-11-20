// The Windows recogniser proven on a real PC (9.0 w123ocr): the reviewer runs this on the laptop against a test
// picture or a scanned PDF's page, and it prints the lines it read (or plainly why it can't):
//   node tools/ocr-probe.mjs C:\Pictures\receipt.png [lang]
//   node tools/ocr-probe.mjs C:\Docs\letter.pdf 2 [lang]
// It bundles src/main/ocr.ts (the production seam and Windows runner) and drives the real engine: no copies, no fakes.
// Off Windows it says the recogniser isn't on this PC (exit 2).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [file, second, third] = process.argv.slice(2);
if (!file) {
  console.error('Give a picture or a PDF: node tools/ocr-probe.mjs <picture.png|scan.pdf> [page] [lang]');
  process.exit(2);
}
const isPdf = /\.pdf$/i.test(file);
const page = isPdf && second && /^\d+$/.test(second) ? Number(second) : 1;
const lang = (isPdf && /^\d+$/.test(second ?? '') ? third : second) ?? '';

const work = mkdtempSync(path.join(tmpdir(), 'nv-ocr-probe-'));
try {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/ocr.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'o.mjs'), format: 'esm' }, logLevel: 'silent' });
  const M = await import(pathToFileURL(path.join(work, 'o.mjs')).href);
  const engine = new M.WindowsOcrEngine();
  const availability = await engine.available();
  if (!availability.ok) {
    const why = { 'not-windows': 'this PC isn’t Windows', 'no-ocr': 'this Windows has no text recogniser', 'no-languages': 'no language for reading is installed in Windows' }[availability.reason] ?? availability.reason;
    console.log(`The recogniser isn’t available: ${why}.`);
    process.exit(2);
  }
  const langs = await engine.languages();
  console.log(`Recogniser ready. Languages: ${langs.map((l) => `${l.name} (${l.tag})`).join(', ') || 'none'}.`);
  const read = isPdf ? await engine.readPdfPage(path.resolve(file), page, lang) : await engine.readImage(path.resolve(file), lang);
  console.log(`${isPdf ? `Page ${page}` : 'Picture'} ${read.width}x${read.height}${read.lang ? `, read as ${read.lang}` : ''}: ${read.lines.length} lines.`);
  for (const l of read.lines) console.log(`- ${l.text}  [${l.box.map((n) => Math.round(n)).join(', ')}]`);
} catch (err) {
  console.error(`Could not be read: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
