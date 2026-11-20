// node --test tests/utf16-decode.test.mjs — one safe UTF-16 decode (t225, 11 Nov 2026: Node's UTF-16 decoder
// corrupts the heap when handed bytes at an odd offset — `buf.subarray(1).toString('utf16le')` crashed the runtime
// with STATUS_HEAP_CORRUPTION. src/main/utf16.ts copies to a fresh even-length buffer and decodes with the platform
// decoder; doc-text.ts and vault-files.ts read through it, and the last check scans nv/src for the raw shape).
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-utf16-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { decodeUtf16le, decodeUtf16be } from ${JSON.stringify(path.join(root, 'src/main/utf16.ts'))};`,
      `export { plainText } from ${JSON.stringify(path.join(root, 'src/main/doc-text.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'u.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'u.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const ref = new TextDecoder('utf-16le');

test('little-endian decodes whole, from any start', () => {
  const words = 'Ring the mill at 9 — gros pois';
  const buf = Buffer.from(words, 'utf16le');
  assert.equal(M.decodeUtf16le(buf), words);
  assert.equal(M.decodeUtf16le(buf, 4), words.slice(2));
  assert.equal(M.decodeUtf16le(buf, 2, 8), words.slice(1, 4));
});

test('the crash shape — a subarray at an odd offset — decodes like the platform decoder', () => {
  const words = 'Harbour fit-out quote 42';
  const parent = Buffer.concat([Buffer.from([0x99]), Buffer.from(words, 'utf16le')]);
  const odd = parent.subarray(1);
  assert.equal(odd.byteOffset % 2, 1, 'the fixture really starts odd');
  assert.equal(M.decodeUtf16le(odd), ref.decode(odd));
  assert.equal(M.decodeUtf16le(odd), words);
  const again = Buffer.concat([Buffer.from('pad'), Buffer.from(words, 'utf16le')]).subarray(3);
  assert.equal(M.decodeUtf16le(again), words);
});

test('big-endian decodes whole, including the vault-files title shape', () => {
  const words = 'Dulwich Hill cottage';
  const be = Buffer.from(words, 'utf16le').swap16();
  assert.equal(M.decodeUtf16be(be), words);
  const oddBe = Buffer.concat([Buffer.from([0x00]), be]).subarray(1);
  assert.equal(oddBe.byteOffset % 2, 1, 'the big-endian fixture really starts odd');
  assert.equal(M.decodeUtf16be(oddBe), words);
  // vault-files.ts reads a PDF title after a þÿ (FE FF) marker through latin1 bytes.
  const latin = Buffer.from(`þÿ${Buffer.from(words, 'utf16le').swap16().toString('latin1')}`, 'latin1');
  assert.equal(M.decodeUtf16be(latin.subarray(2)), words);
});

test('a trailing odd byte is left off, never throws; empty stays empty', () => {
  const buf = Buffer.concat([Buffer.from('ab', 'utf16le'), Buffer.from([0x41])]);
  assert.equal(M.decodeUtf16le(buf), 'ab');
  const beOdd = Buffer.concat([Buffer.from('ab', 'utf16le').swap16(), Buffer.from([0x42])]);
  assert.equal(M.decodeUtf16be(beOdd), 'ab');
  assert.equal(M.decodeUtf16le(Buffer.alloc(0)), '');
  assert.equal(M.decodeUtf16le(Buffer.from('x'), 9), '');
});

test('text files with a UTF-16 marker read through the helper', () => {
  const words = 'Line one\r\nLine two';
  assert.equal(M.plainText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(words, 'utf16le')]), 'txt'), 'Line one\nLine two');
  assert.equal(M.plainText(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(words, 'utf16le').swap16()]), 'txt'), 'Line one\nLine two');
  assert.equal(M.plainText(Buffer.from('plain words', 'utf8'), 'txt'), 'plain words');
});

test('no raw UTF-16 decode is left in nv/src', () => {
  const raw = /\.toString\(\s*['"](utf-?16le|ucs-?2)['"]/i;
  const bad = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) {
        const src = readFileSync(full, 'utf8');
        if (raw.test(src)) bad.push(path.relative(root, full));
      }
    }
  };
  walk(path.join(root, 'src'));
  assert.deepEqual(bad, [], `raw UTF-16 decodes left (${bad.join(', ')}) — read through src/main/utf16.ts`);
});
