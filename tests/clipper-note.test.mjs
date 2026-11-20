// node --test tests/clipper-note.test.mjs — the clipped note (8.8 round 2): what fileClip files renders with its
// pictures (names with spaces, duplicates across notes, odd characters), its published date in the vault's own words,
// and a line-alone embed inside a longer paragraph (a clipped article's pictures) is drawn inline by the editor rather
// than left as raw text. Rendered with the page renderer and the window's own file lookups, on a host that mirrors the
// app (per-note Files folders, free names, links that name the path).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-clipnote-'));
let C;
let M;
let R;
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entryC = path.join(work, 'entry-c.ts');
  writeFileSync(entryC, `export * from ${JSON.stringify(path.join(root, 'src/shared/clipper.ts'))};\nexport { readProps } from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};\nexport { filesFolderFor } from ${JSON.stringify(path.join(root, 'src/shared/file-records.ts'))};\n`);
  await build({ input: entryC, platform: 'node', external: ['yaml', /^node:/], output: { file: path.join(work, 'c.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
  const entryM = path.join(work, 'entry-m.ts');
  writeFileSync(entryM, `export * from ${JSON.stringify(path.join(root, 'src/main/clipper.ts'))};\n`);
  await build({ input: entryM, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  // The window's own file lookups (renderer/lib/resolve.ts), with the window's store stood in for.
  const storeStub = path.join(work, 'store-stub.ts');
  writeFileSync(storeStub, 'export const getState = () => ((globalThis as Record<string, unknown>).__NV_CLIPNOTE__ as { notes: unknown[]; files: unknown[]; vault: { path: string } | null });\n');
  const storePlugin = { name: 'stub-store', resolveId: (id, importer) => (id === '../state/store' && importer?.endsWith('lib/resolve.ts') ? storeStub : null) };
  const resolveEntry = path.join(work, 'entry-r.ts');
  writeFileSync(resolveEntry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/resolve.ts'))};\n`);
  const resolveOut = path.join(work, 'resolve.mjs');
  await build({ input: resolveEntry, platform: 'node', plugins: [storePlugin], output: { file: resolveOut, format: 'esm' }, logLevel: 'silent' });
  const resolvePlugin = { name: 'real-resolve', resolveId: (id, importer) => (id === './resolve' && importer?.endsWith('markdownRender.ts') ? resolveOut : null) };
  const renderEntry = path.join(work, 'entry-v.ts');
  writeFileSync(renderEntry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/markdownRender.ts'))};\n`);
  await build({ input: renderEntry, platform: 'node', plugins: [resolvePlugin], output: { file: path.join(work, 'v.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'v.mjs')).href);
  // The editor's parser with Ironleaf's extensions, and its embed decision (what Live Preview draws from).
  const parserEntry = path.join(work, 'entry-p.ts');
  writeFileSync(
    parserEntry,
    `import { parser } from ${JSON.stringify(path.join(root, 'node_modules/@lezer/markdown/dist/index.js'))};\nimport { embedFillsParagraph, ironleafMarkdown } from ${JSON.stringify(path.join(root, 'src/renderer/src/editor/markdown-ext.ts'))};\nexport const md = parser.configure(ironleafMarkdown);\nexport { embedFillsParagraph };\n`,
  );
  await build({ input: parserEntry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** Made-up picture bytes: a 1x1 PNG and a 1x1 GIF. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DOT_GIF = 'R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const newsHtml = () => readFileSync(path.join(root, 'tests/fixtures/clipper/news.html'), 'utf8');

/** A file's name as the app writes it (src/main/app.ts): nothing Windows refuses, else the fallback. */
const cleanName = (raw, fallback) => {
  const name = String(raw ?? '').split(/[\\/]/).pop().replace(/[<>:\"|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').trim();
  return name.slice(0, 180) || fallback;
};
const splitName = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: '' };
};

/** A host that mirrors the app: per-note Files folders, free names, links that name the path. */
function realHost() {
  const notes = new Map();
  const files = new Map();
  const taken = new Set();
  const unique = (folder, base, ext) => {
    for (let i = 0; i < 10000; i++) {
      const rel = `${folder ? `${folder}/` : ''}${i === 0 ? base : `${base} ${i}`}${ext}`;
      if (!taken.has(rel)) {
        taken.add(rel);
        return rel;
      }
    }
    throw new Error('No free name was found.');
  };
  return {
    notes,
    files,
    host: {
      dataDir: mkdtempSync(path.join(tmpdir(), 'nv-clipnote-data-')),
      version: '9.9.9',
      clipperOn: () => true,
      extensionDir: () => path.join(root, 'extensions/clipper'),
      ready: async () => {},
      requireCreate: async () => {},
      vaultName: () => 'Test Vault',
      places: async () => ({ folders: ['Clippings'], projects: [] }),
      freeNote: async (folder, title) => {
        const { base, ext } = splitName(cleanName(title, 'Web clip'));
        return unique(folder, base, ext || '.md');
      },
      writeNote: async (rel, text) => void notes.set(rel, text),
      findClip: async (url) => {
        for (const [rel, text] of notes) {
          if (C.readProps(text).source && C.canonicalClipUrl(C.readProps(text).source) === url) return { path: rel, title: rel.split('/').pop().replace(/\.md$/, '') };
        }
        return null;
      },
      saveImage: async (folder, name, bytes) => {
        const { base, ext } = splitName(cleanName(name, 'Picture.png'));
        const rel = unique(folder, base, ext.toLowerCase());
        files.set(rel, bytes);
        return rel;
      },
      link: (rel) => `[[${rel}]]`,
      attachmentsFor: (note) => C.filesFolderFor(note),
      log: () => {},
    },
  };
}

/** A note's body as the page shows it (reading view), with the files the vault holds. */
const render = (body, from, rels) => {
  globalThis.__NV_CLIPNOTE__ = { notes: [], files: rels.map((rel) => ({ rel, mtime: 0, size: 1, kind: 'image' })), vault: { path: '/vault' } };
  return R.renderMarkdown(body, { from });
};
const bodyOf = (note) => note.slice(note.indexOf('---', 3)).replace(/^---\s*/, '');

test('a clipped article: its pictures beside it by their own names, its date in the vault’s words, rendered', async () => {
  const { host, notes, files } = realHost();
  const done = await M.fileClip(host, {
    kind: 'article',
    url: 'https://www.harbourgazette.example/news/harbour-tunnel-decision',
    title: 'Harbour tunnel decision due before Christmas',
    html: newsHtml(),
    images: [
      { url: 'https://images.harbourgazette.example/tunnel-1200.jpg', data: PIXEL, type: 'image/png' },
      { url: 'https://www.harbourgazette.example/images/drilling-rig.jpg', data: DOT_GIF, type: 'image/gif' },
    ],
    tags: ['reads'],
    note: 'For the commute.',
  });
  assert.equal(done.path, 'Clippings/Harbour tunnel decision due before Christmas.md');
  const note = notes.get(done.path);
  const props = C.readProps(note);
  assert.equal(props.published, '30 Oct 2026 06:15');
  assert.deepEqual([...files.keys()].sort(), [
    'Clippings/Files/Harbour tunnel decision due before Christmas/drilling-rig.gif',
    'Clippings/Files/Harbour tunnel decision due before Christmas/tunnel-1200.png',
  ]);
  for (const rel of files.keys()) assert.ok(note.includes(`![[${rel}]]`), `embedded by path: ${rel}`);
  const html = render(bodyOf(note), done.path, [...files.keys()]);
  assert.match(html, /<img[^>]*data-path="Clippings\/Files\/Harbour tunnel decision due before Christmas\/tunnel-1200\.png"/);
  assert.match(html, /<img[^>]*data-path="Clippings\/Files\/Harbour tunnel decision due before Christmas\/drilling-rig\.gif"/);
});

test('duplicates: two notes with same-named pictures each show their own', async () => {
  const { host, notes, files } = realHost();
  const clip = (title, site) => M.fileClip(host, { kind: 'bookmark', url: `https://${site}/`, title, description: 'A shop.', images: [{ url: `https://${site}/logo.png`, data: PIXEL, type: 'image/png' }] });
  const a = await clip('A', 'a.example');
  const b = await clip('A much longer title here', 'b.example');
  assert.equal(files.size, 2);
  const [relA] = [...files.keys()].filter((r) => r.includes('/A/'));
  const [relB] = [...files.keys()].filter((r) => r.includes('/A much longer title here/'));
  assert.ok(relA.endsWith('/logo.png') && relB.endsWith('/logo.png'), 'same file name, beside their own notes');
  const htmlA = render(bodyOf(notes.get(a.path)), a.path, [...files.keys()]);
  const htmlB = render(bodyOf(notes.get(b.path)), b.path, [...files.keys()]);
  assert.ok(htmlA.includes(`data-path="${relA}"`), 'the first note shows its own picture');
  assert.ok(htmlB.includes(`data-path="${relB}"`), 'the second note shows its own picture, not the first’s');
});

test('a bookmark keeps every picture sent with it, not only the first', async () => {
  const { host, notes, files } = realHost();
  const done = await M.fileClip(host, {
    kind: 'bookmark',
    url: 'https://shop.example/',
    title: 'Shop',
    description: 'Nice shop.',
    images: [
      { url: 'https://shop.example/logo.png', data: PIXEL, type: 'image/png' },
      { url: 'https://shop.example/front.jpg', data: PIXEL, type: 'image/jpeg' },
    ],
  });
  assert.equal(files.size, 2);
  assert.match(notes.get(done.path), /logo\.png/);
  assert.match(notes.get(done.path), /front\.png/, 'named for its address, typed by its bytes');
});

test('clipping the same address twice keeps the first save, never a second note', async () => {
  const { host, notes } = realHost();
  const a = await M.fileClip(host, { kind: 'bookmark', url: 'https://shop.example/', title: 'Shop', description: 'Nice shop.', images: [] });
  const b = await M.fileClip(host, { kind: 'bookmark', url: 'https://shop.example/?utm_source=x', title: 'Shop new', description: 'Changed.', images: [] });
  assert.equal(b.path, a.path);
  assert.match(b.words, /already clipped/);
  assert.equal(notes.size, 1, 'one address, one note');
  assert.match(notes.get(a.path), /Nice shop/);
});

test('odd characters: a picture whose address would break a link clips and renders', async () => {
  const { host, notes, files } = realHost();
  const done = await M.fileClip(host, {
    kind: 'bookmark',
    url: 'https://example.com/',
    title: 'Odd',
    description: 'Odd.',
    images: [{ url: 'https://example.com/weird%20%231%20%5Bfinal%5D%7C100%25.jpg', data: PIXEL, type: 'image/png' }],
  });
  const [rel] = [...files.keys()];
  assert.ok(!/[#[\]|]/.test(rel), `nothing a link cannot name: ${rel}`);
  assert.ok(notes.get(done.path).includes(`![[${rel}]]`));
  const html = render(bodyOf(notes.get(done.path)), done.path, [...files.keys()]);
  assert.match(html, /<img[^>]*data-path="/);
});

test('the editor draws a line-alone embed inside a longer paragraph instead of raw text', () => {
  const body = ['By Priya Nair | 30 Oct 2026, 6:15am', '![[Clippings/Files/Harbour/tunnel-1200.png]]', 'The eastern entrance of the proposed second tunnel.'].join('\n');
  const found = [];
  P.md.parse(body).iterate({ enter: (n) => void found.push({ name: n.name, text: body.slice(n.from, n.to), parent: n.node.parent?.name ?? null, from: n.from, to: n.to }) });
  const embed = found.find((n) => n.name === 'Embed');
  assert.ok(embed, 'the clipped picture parses as an embed');
  const parent = found.find((n) => n.name === 'Paragraph' && n.from <= embed.from && n.to >= embed.to);
  assert.ok(parent && parent.text.includes('\n'), 'inside a paragraph with other lines, as clipped articles hold');
  const line = body.split('\n')[1];
  assert.equal(line.trim(), body.slice(embed.from, embed.to), 'alone on its line');
  assert.equal(P.embedFillsParagraph(parent.name, parent.text, body.slice(embed.from, embed.to)), false, 'not the whole paragraph: the inline layer draws it');
  assert.equal(P.embedFillsParagraph('Paragraph', '![[pic.png]]', '![[pic.png]]'), true, 'the whole paragraph: drawn as a block');
});
