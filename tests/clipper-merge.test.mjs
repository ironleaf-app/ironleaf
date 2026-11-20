// node --test tests/clipper-merge.test.mjs — 10.0 item 16 re-saved web clips: saving the same
// page again merges its new lines into the kept note (the person's note and edits untouched,
// pictures reused by their bytes, never doubled). Nothing new leaves the kept note alone.
// Screenshots still always make a new note. Each check fails on keep-first.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-clipmerge-'));
let C;
let M;
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
});
after(() => rmSync(work, { recursive: true, force: true }));

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DOT_GIF = 'R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const cleanName = (raw, fallback) => {
  const name = String(raw ?? '').split(/[\\/]/).pop().replace(/[<>:\"|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').trim();
  return name.slice(0, 180) || fallback;
};
const splitName = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: '' };
};

/** A host that mirrors the app, with readers for merging (notes, files, free names, links by path). */
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
      dataDir: mkdtempSync(path.join(tmpdir(), 'nv-clipmerge-data-')),
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
      readNote: async (rel) => notes.get(rel) ?? null,
      readFile: async (rel) => files.get(rel) ?? null,
      findClip: async (url) => {
        for (const [rel, text] of notes) {
          if (C.readProps(text).source && C.canonicalClipUrl(C.readProps(text).source) === url) return { path: rel, title: rel.split('/').pop().replace(/\.md$/, '') };
        }
        return null;
      },
      saveImage: async (folder, name, bytes) => {
        const { base, ext } = splitName(cleanName(name, 'Picture.png'));
        // Taken names get a number, as the app does; an exact reuse is decided before calling.
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

const article = (paragraphs) =>
  `<html><head><title>Garden notes</title></head><body><article>${paragraphs.map((p) => `<p>${p}</p>`).join('')}</article></body></html>`;

test('the same page unchanged: nothing new, nothing written, no new pictures', async () => {
  const { host, notes, files } = realHost();
  const clip = {
    kind: 'article',
    url: 'https://example.com/garden',
    title: 'Garden notes',
    html: article(['Water deeply, not often.']),
    images: [{ url: 'https://example.com/plot.png', data: PIXEL, type: 'image/png' }],
  };
  const a = await M.fileClip(host, clip, new Date(2026, 10, 2, 9, 0));
  const before = notes.get(a.path);
  const fileCount = files.size;
  const b = await M.fileClip(host, { ...clip }, new Date(2026, 10, 2, 10, 0));
  assert.equal(b.path, a.path, 'one address, one note');
  assert.match(b.words, /already clipped/);
  assert.match(b.words, /nothing new/, 'said plainly');
  assert.equal(notes.get(a.path), before, 'the kept note untouched');
  assert.equal(files.size, fileCount, 'no pictures doubled');
});

test('a changed page merges its additions; the person note and edits stay first and untouched', async () => {
  const { host, notes } = realHost();
  const url = 'https://example.com/garden';
  const a = await M.fileClip(
    host,
    { kind: 'article', url, title: 'Garden notes', html: article(['Water deeply, not often.']), images: [], note: 'For the weekend.' },
    new Date(2026, 10, 2, 9, 0),
  );
  // The person edits the kept note.
  notes.set(a.path, `${notes.get(a.path)}\nMy own tip: mulch first.\n`);
  const b = await M.fileClip(
    host,
    { kind: 'article', url, title: 'Garden notes', html: article(['Water deeply, not often.', 'Feed in spring.']), images: [], note: 'Also for Friday.' },
    new Date(2026, 10, 3, 9, 0),
  );
  assert.equal(b.path, a.path);
  assert.match(b.words, /already clipped/);
  assert.match(b.words, /updated with what changed/);
  assert.equal(notes.size, 1, 'still one note');
  const note = notes.get(a.path);
  assert.match(note, /Water deeply, not often\./, 'the old lines stay');
  assert.match(note, /Feed in spring\./, 'the new lines merged in');
  assert.match(note, /Merged from the page/, 'additions under a plain heading');
  assert.match(note, /For the weekend\./, 'the first note kept');
  assert.match(note, /Also for Friday\./, 'the new note kept, first');
  assert.match(note, /My own tip: mulch first\./, 'the person edits untouched');
  assert.ok(note.indexOf('Also for Friday.') < note.indexOf('For the weekend.'), 'the newest note first');
  assert.ok(note.indexOf('My own tip') < note.indexOf('Merged from the page'), 'the person part above the merged additions');
});

test('a bookmark re-saved with new words and tags merges both; tags alone update without a merged section', async () => {
  const { host, notes } = realHost();
  const url = 'https://shop.example/';
  const a = await M.fileClip(host, { kind: 'bookmark', url, title: 'Shop', description: 'Nice shop.', images: [], tags: ['reads'] }, new Date(2026, 10, 2, 9, 0));
  const firstClipped = C.readProps(notes.get(a.path)).clipped;
  const b = await M.fileClip(
    host,
    { kind: 'bookmark', url, title: 'Shop new', description: 'Nice shop. Open late.', images: [], tags: ['reads', 'food'] },
    new Date(2026, 10, 3, 9, 0),
  );
  assert.equal(b.path, a.path);
  assert.match(b.words, /updated with what changed/);
  const note = notes.get(a.path);
  assert.match(note, /Nice shop\./);
  assert.match(note, /Open late\./);
  const props = C.readProps(note);
  assert.deepEqual([...props.tags].sort(), ['food', 'reads'], 'tags unioned');
  assert.equal(props.clipped, firstClipped, 'the first clipped kept');
  assert.ok(props.updated, 'an updated stamp added');
  // Tags alone: no new lines, no merged section, tags still unioned.
  const c = await M.fileClip(host, { kind: 'bookmark', url, title: 'Shop', description: 'Nice shop. Open late.', images: [], tags: ['reads', 'food', 'weekend'] }, new Date(2026, 10, 4, 9, 0));
  assert.match(c.words, /updated with what changed/);
  const again = notes.get(a.path);
  assert.deepEqual([...C.readProps(again).tags].sort(), ['food', 'reads', 'weekend']);
  assert.equal((again.match(/Merged from the page/g) || []).length, 1, 'no second merged section for tags alone');
});

test('pictures reused by their bytes: the same picture never doubled, a new one added', async () => {
  const { host, notes, files } = realHost();
  const url = 'https://example.com/garden';
  const htmlFor = (img) => `<html><head><title>Garden</title></head><body><article><p>Water deeply.</p><img src="${img}" alt="plot"></article></body></html>`;
  await M.fileClip(
    host,
    { kind: 'article', url, title: 'Garden', html: htmlFor('https://example.com/plot.png'), images: [{ url: 'https://example.com/plot.png', data: PIXEL, type: 'image/png' }] },
    new Date(2026, 10, 2, 9, 0),
  );
  const fileCount = files.size;
  assert.equal(fileCount, 1);
  // Same picture, new words: words merge, the picture reused.
  const b = await M.fileClip(
    host,
    {
      kind: 'article',
      url,
      title: 'Garden',
      html: `<html><head><title>Garden</title></head><body><article><p>Water deeply.</p><p>Feed in spring.</p><img src="https://example.com/plot.png" alt="plot"></article></body></html>`,
      images: [{ url: 'https://example.com/plot.png', data: PIXEL, type: 'image/png' }],
    },
    new Date(2026, 10, 3, 9, 0),
  );
  assert.match(b.words, /updated with what changed/);
  assert.equal(files.size, fileCount, 'the same bytes reused, never a numbered copy');
  assert.ok(![...files.keys()].some((k) => / 1\.png$/.test(k)), `no numbered double: ${[...files.keys()]}`);
  assert.match(notes.get(b.path), /Feed in spring\./);
  // A new picture with new words: added beside the reused one.
  await M.fileClip(
    host,
    {
      kind: 'article',
      url,
      title: 'Garden',
      html: `<html><head><title>Garden</title></head><body><article><p>Water deeply.</p><p>Feed in spring.</p><p>Mulch.</p><img src="https://example.com/plot.png" alt="plot"><img src="https://example.com/shed.png" alt="shed"></article></body></html>`,
      images: [
        { url: 'https://example.com/plot.png', data: PIXEL, type: 'image/png' },
        { url: 'https://example.com/shed.png', data: DOT_GIF, type: 'image/gif' },
      ],
    },
    new Date(2026, 10, 4, 9, 0),
  );
  assert.equal(files.size, fileCount + 1, 'the new picture added once');
  assert.match(notes.get(b.path), /shed\.gif/);
});

test('screenshots still always make a new note, never merged', async () => {
  const { host, notes } = realHost();
  const shot = { url: 'https://example.com/', title: '', site: 'example', screenshot: { url: '', data: PIXEL, type: 'image/png' } };
  const a = await M.fileClip(host, { kind: 'screenshot', ...shot }, new Date(2026, 10, 2, 9, 0));
  const b = await M.fileClip(host, { kind: 'screenshot', ...shot }, new Date(2026, 10, 2, 9, 1));
  assert.notEqual(b.path, a.path, 'each screenshot kept');
  assert.equal(notes.size, 2);
});
