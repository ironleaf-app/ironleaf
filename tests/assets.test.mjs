// node --test tests/assets.test.mjs — the asset store (src/shared/assets.ts, src/main/assets.ts; 17 Oct 2026). Kinds from
// names, the index file read and written (and following renames), duplicates found by content, SVGs made safe, a
// picture's colours, where an asset is used, files copied in on a made-up library on disk, and the assistant's tools.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-assets-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * from ${JSON.stringify(path.join(root, 'src/shared/assets.ts'))};`,
      `export * from ${JSON.stringify(path.join(root, 'src/shared/brand-kits.ts'))};`,
      `export { AssetStore, hashFile } from ${JSON.stringify(path.join(root, 'src/main/assets.ts'))};`,
      `export { AgentTools } from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};`,
      `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'assets.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'assets.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('kinds come from names: logos by their name, SVGs as icons, documents, video and audio', () => {
  const k = (n) => M.inferKind(n);
  assert.equal(k('Saltwater logo.svg'), 'logo');
  assert.equal(k('Assets/Brand/saltwater-logo-dark.png'), 'logo');
  assert.equal(k('wordmark_white.PNG'), 'logo');
  assert.equal(k('catalogue.png'), 'image', '"logo" inside another word is not a logo');
  assert.equal(k('cart.svg'), 'icon');
  assert.equal(k('favicon.ico'), 'icon');
  assert.equal(k('Wexley St shopfront.JPG'), 'image');
  assert.equal(k('menu.webp'), 'image');
  assert.equal(k('Price list.pdf'), 'document');
  assert.equal(k('Roster.xlsx'), 'document');
  assert.equal(k('Pitch.pptx'), 'document');
  assert.equal(k('Letter.docx'), 'document');
  assert.equal(k('logo.pdf'), 'document', 'a PDF is a document, whatever its name');
  assert.equal(k('Opening.mp4'), 'media');
  assert.equal(k('jingle.mp3'), 'media');
  assert.equal(k('take.opus'), 'media');
  assert.equal(k('book.m4b'), 'media');
  assert.equal(M.docType('take.opus').family, 'audio');
  assert.ok(M.AUDIO_EXT.test('opus') && M.AUDIO_EXT.test('m4b'), 'the one audio list names opus and m4b');
  assert.equal(k('font.woff2'), 'other');
  assert.equal(k('README'), 'other');
  assert.deepEqual(M.docType('a.pdf'), { word: 'PDF', family: 'pdf' });
  assert.equal(M.docType('a.xlsx').family, 'excel');
  assert.equal(M.docType('a.csv').word, 'CSV');
});

test('the index file: read and written back the same, junk left out, brand kit kept, renames and deletes followed', () => {
  const idx = M.emptyIndex();
  let next = M.applyPatch(idx, 'Assets/Logos/Saltwater logo.svg', { description: '  The main logo  ', alt: 'Saltwater Bakehouse | wave', tags: ['#brand', 'Brand', 'logo'], collections: ['Brand'] }, 'logo');
  next = M.applyPatch(next, 'Assets/Logos/Saltwater logo.svg', { role: 'primary' }, 'logo');
  next = M.applyPatch(next, 'Assets/Icons/wave.svg', { kind: 'logo', role: 'icon' }, 'icon');
  next = { ...next, brand: { ...next.brand, name: 'Saltwater Bakehouse', colours: [{ name: 'Harbour blue', hex: '1D4E89', use: 'Headings' }, { name: 'bad', hex: 'blue' }], fonts: [{ name: 'Inter', use: 'Body' }] } };
  const text = M.serializeIndex(next);
  const back = M.parseIndex(text);
  assert.equal(back.assets['Assets/Logos/Saltwater logo.svg'].description, 'The main logo');
  assert.equal(back.assets['Assets/Logos/Saltwater logo.svg'].alt, 'Saltwater Bakehouse wave', 'no | in alt text (it would break an embed)');
  assert.deepEqual(back.assets['Assets/Logos/Saltwater logo.svg'].tags, ['brand', 'logo'], 'tags: no #, no repeats by case');
  assert.equal(back.assets['Assets/Icons/wave.svg'].kind, 'logo');
  assert.deepEqual(back.collections, ['Brand']);
  assert.deepEqual(back.brand.logos, { primary: 'Assets/Logos/Saltwater logo.svg', icon: 'Assets/Icons/wave.svg' });
  assert.deepEqual(back.brand.colours, [{ name: 'Harbour blue', hex: '#1d4e89', use: 'Headings' }], 'a colour that isn’t one is left out');
  assert.equal(back.brand.name, 'Saltwater Bakehouse');
  assert.equal(M.serializeIndex(back), text, 'written back exactly the same');
  assert.match(text, /"about": "Ironleaf/);
  // A kind equal to the inferred one isn't kept; clearing every field drops the entry.
  const cleared = M.applyPatch(back, 'Assets/Icons/wave.svg', { kind: 'icon' }, 'icon');
  assert.equal(cleared.assets['Assets/Icons/wave.svg'], undefined);
  // Junk and paths that climb out are left out, never fatal.
  assert.deepEqual(M.parseIndex('not json').assets, {});
  assert.deepEqual(M.parseIndex('[1,2]').assets, {});
  const odd = M.parseIndex(JSON.stringify({ assets: { '../secret.png': { description: 'x' }, 'Assets/a.png': { kind: 'weird', tags: 'nope', description: 5 }, 'Assets/b.png': { alt: 'ok' } }, brand: { logos: { primary: '../../x.svg', onDark: 7 } } }));
  assert.deepEqual(Object.keys(odd.assets), ['Assets/b.png']);
  assert.deepEqual(odd.brand.logos, {});
  // Renames (a folder too) and deletes.
  const moved = M.renameInIndex(back, [['Assets/Logos/Saltwater logo.svg', 'Assets/Brand/Saltwater logo.svg']]);
  assert.ok(moved.assets['Assets/Brand/Saltwater logo.svg'] && !moved.assets['Assets/Logos/Saltwater logo.svg']);
  assert.equal(moved.brand.logos.primary, 'Assets/Brand/Saltwater logo.svg');
  assert.equal(M.roleOf(moved, 'Assets/Brand/Saltwater logo.svg'), 'primary');
  const gone = M.removeFromIndex(moved, ['Assets/Icons/wave.svg']);
  assert.equal(gone.assets['Assets/Icons/wave.svg'], undefined);
  assert.equal(gone.brand.logos.icon, undefined);
  // A role moves from one asset to another.
  const swapped = M.setRole(back, 'Assets/Icons/wave.svg', 'primary');
  assert.deepEqual(swapped.brand.logos, { primary: 'Assets/Icons/wave.svg' });
});

test('SVGs made safe: no scripts, handlers, outside links or fetches; the drawing stays', () => {
  const evil = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><?xml-stylesheet href="http://evil/x.css"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="40" viewBox="0 0 120 40" onload="alert(1)">
  <style>@import url(http://evil/x.css); .a{fill:url(#g)} .b{background:url('https://evil/t.png')}</style>
  <defs><linearGradient id="g"><stop offset="0" stop-color="#1d4e89"/></linearGradient></defs>
  <script>alert(2)</script><SCRIPT type="text/javascript">alert(3)</SCRIPT><svg:script>alert(4)</svg:script>
  <foreignObject width="100" height="20"><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="http://evil"></iframe></body></foreignObject>
  <a href="javascript:alert(5)"><rect class="a" width="120" height="40" rx="8" onclick='alert(6)' ONMouseOver=alert(7) /></a>
  <a xlink:href=" jav&#x09;ascript:alert(8)">x</a>
  <use href="#g"/><use xlink:href="http://evil/sprite.svg#i"/>
  <image href="data:image/png;base64,iVBORw0KGgo=" width="4" height="4"/><image href="https://evil/pixel.png"/>
  <image href="data:image/svg+xml;base64,PHN2Zz4="/>
  <set attributeName="href" to="javascript:alert(9)"/><animate attributeName="onclick" values="alert(10)"/>
  <iframe src="x"/><embed src="x"/><object data="x"></object>
</svg>`;
  const s = M.sanitiseSvg(evil);
  assert.doesNotMatch(s, /<script|<svg:script|alert\(2\)|alert\(3\)|alert\(4\)/i);
  assert.doesNotMatch(s, /\son\w+\s*=/i, 'no event handlers');
  assert.doesNotMatch(s, /javascript|jav&#x09;ascript/i);
  assert.doesNotMatch(s, /foreignObject|<iframe|<embed|<object/i);
  assert.doesNotMatch(s, /evil/, 'nothing fetched from elsewhere');
  assert.doesNotMatch(s, /<!DOCTYPE|<!ENTITY|xml-stylesheet/i);
  assert.doesNotMatch(s, /<set |<animate /i);
  assert.doesNotMatch(s, /data:image\/svg\+xml/, 'an SVG inside an SVG is not let in');
  assert.match(s, /<rect class="a" width="120" height="40" rx="8"/, 'the drawing stays');
  assert.match(s, /<use href="#g"\/>/, 'links inside the SVG stay');
  assert.match(s, /fill:url\(#g\)/);
  assert.match(s, /data:image\/png;base64/, 'a picture carried inside stays');
  assert.deepEqual(M.svgSize(s), { width: 120, height: 40 });
  assert.deepEqual(M.svgSize('<svg viewBox="0 0 64 32"><path d="M0 0"/></svg>'), { width: 64, height: 32 });
  assert.equal(M.svgSize('<html></html>'), null);
});

test('a picture’s colours: the main ones first, near shades merged, see-through and tiny ones left out', () => {
  const px = [];
  const push = (n, r, g, b, a = 255) => { for (let i = 0; i < n; i++) px.push(r, g, b, a); };
  push(600, 29, 78, 137); // harbour blue
  push(100, 31, 80, 139); // the same blue, a shade off
  push(250, 232, 168, 56); // sand
  push(40, 250, 250, 250); // a little white (4%)
  push(10, 255, 0, 0); // a speck of red (1%): left out
  push(500, 0, 0, 0, 0); // see-through: left out
  const colours = M.palette(px);
  assert.equal(colours.length, 3);
  assert.equal(colours[0].slice(0, 4), '#1d4');
  assert.equal(colours[1], '#e8a838');
  assert.ok(!colours.some((c) => c.startsWith('#ff0')));
  assert.deepEqual(M.palette([0, 0, 0, 0]), []);
  assert.equal(M.inkOn('#1d4e89'), 'light');
  assert.equal(M.inkOn('#f7f5ef'), 'dark');
  assert.equal(M.cleanHex('abc'), '#aabbcc');
  assert.equal(M.cleanHex('#zzz'), undefined);
});

test('where an asset is used: notes that link or embed it, canvases with it, and the projects they belong to', () => {
  const assets = new Set(['Assets/Logos/Saltwater logo.svg', 'Attachments/oven.jpg', 'Assets/Documents/Price list.pdf']);
  const notes = [
    { path: 'Projects/Winter Menu/Winter Menu.md', title: 'Winter Menu', props: { type: 'project' }, links: [{ target: 'Saltwater logo.svg' }] },
    { path: 'Projects/Winter Menu/Photo shoot.md', title: 'Photo shoot', links: [{ target: 'oven.jpg' }, { target: 'Saltwater logo.svg' }] },
    { path: 'Daily/2026-10-17.md', title: '2026-10-17', links: [{ target: 'Price list.pdf' }, { target: 'Nowhere.png' }] },
  ];
  const canvases = [{ path: 'Boards/Launch.canvas', files: ['Assets/Logos/Saltwater logo.svg', 'Assets/Other/missing.png'] }];
  const byName = new Map([...assets].map((a) => [a.split('/').pop(), a]));
  const uses = M.usesOf(assets, notes, canvases, (t) => byName.get(t) ?? null);
  const logo = uses.get('Assets/Logos/Saltwater logo.svg');
  assert.deepEqual(logo.map((u) => `${u.kind}:${u.title}`).sort(), ['canvas:Launch', 'note:Photo shoot', 'project:Winter Menu']);
  assert.deepEqual(uses.get('Attachments/oven.jpg').map((u) => u.kind).sort(), ['note', 'project']);
  assert.deepEqual(uses.get('Assets/Documents/Price list.pdf').map((u) => u.title), ['2026-10-17']);
  assert.deepEqual(M.canvasFiles('{"nodes":[{"type":"file","file":"a.png"},{"type":"text","text":"x"}]}'), ['a.png']);
  assert.deepEqual(M.canvasFiles('nope'), []);
});

test('what is in the store: the Assets folder and where pasted files go, however that is set', () => {
  const a = (rel, att) => M.storeArea(rel, 'Assets', att);
  assert.equal(a('Assets/Logos/x.svg', 'Attachments'), 'store');
  assert.equal(a('Assets/assets.json', 'Attachments'), null, 'the index itself is not an asset');
  assert.equal(a('Assets/Notes about logos.md', 'Attachments'), null, 'notes are not assets');
  assert.equal(a('Attachments/Picture 1.png', 'Attachments'), 'attachment');
  assert.equal(a('Projects/plan.pdf', 'Attachments'), null);
  assert.equal(a('Projects/Pictures/a.png', './Pictures'), 'attachment');
  assert.equal(a('Pictures/a.png', './Pictures'), 'attachment');
  assert.equal(a('Projects/a.png', './Pictures'), null);
  assert.equal(a('Projects/a.png', './'), 'attachment');
  assert.equal(a('a.png', ''), 'attachment');
  assert.equal(a('Projects/a.png', ''), null);
  const list = [
    { path: 'Assets/Logos/Saltwater logo.svg', name: 'Saltwater logo.svg', size: 10, mtime: 3, kind: 'logo', inferred: 'logo', attachment: false, tags: ['brand'], collections: ['Brand'], description: 'Main logo', uses: 2 },
    { path: 'Assets/Images/WexleyStShopfront.jpg', name: 'WexleyStShopfront.jpg', size: 900, mtime: 2, kind: 'image', inferred: 'image', attachment: false, tags: [], collections: ['Wexley St photos'], uses: 0 },
    { path: 'Attachments/Picture 1.png', name: 'Picture 1.png', size: 50, mtime: 1, kind: 'image', inferred: 'image', attachment: true, tags: [], collections: [], alt: 'The oven at dawn', uses: 1 },
  ];
  const names = (f, s) => M.filterAssets(list, f, s).map((x) => x.name);
  assert.deepEqual(names({ query: 'wexley shopfront' }), ['WexleyStShopfront.jpg'], 'words split at capitals');
  assert.deepEqual(names({ query: '#brand' }), ['Saltwater logo.svg']);
  assert.deepEqual(names({ query: 'oven' }), ['Picture 1.png'], 'alt text is searched');
  assert.deepEqual(names({ query: 'main' }), ['Saltwater logo.svg'], 'descriptions are searched');
  assert.deepEqual(names({ kind: 'image' }, 'name'), ['Picture 1.png', 'WexleyStShopfront.jpg']);
  assert.deepEqual(names({ collection: 'brand' }), ['Saltwater logo.svg']);
  assert.deepEqual(names({ where: 'attachments' }), ['Picture 1.png']);
  assert.deepEqual(names({}, 'size'), ['WexleyStShopfront.jpg', 'Picture 1.png', 'Saltwater logo.svg']);
  assert.equal(M.sizeWords(2_500_000), '2.4 MB');
});

/** A made-up library on disk, as the app lists and resolves it. */
function library(name) {
  const dir = path.join(work, name);
  const lib = path.join(dir, 'library');
  const cache = path.join(dir, 'cache');
  const pc = path.join(dir, 'pc');
  mkdirSync(lib, { recursive: true });
  mkdirSync(pc, { recursive: true });
  const put = (rel, data) => {
    const abs = path.join(lib, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  };
  const notes = [];
  const listAll = async () => {
    const out = [];
    const walk = (d) => {
      for (const e of require_('fs').readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name.endsWith('.nvtmp')) continue;
        const abs = path.join(d, e.name);
        if (e.isDirectory()) walk(abs);
        else {
          const st = require_('fs').statSync(abs);
          out.push({ rel: path.relative(lib, abs).split(path.sep).join('/'), mtime: st.mtimeMs, size: st.size });
        }
      }
    };
    walk(lib);
    return { files: out };
  };
  let files = [];
  const host = {
    root: () => lib,
    listAll: async () => {
      const r = await listAll();
      files = r.files.map((f) => f.rel);
      return r;
    },
    absolute: (rel) => {
      const abs = path.resolve(lib, rel);
      if (path.relative(lib, abs).startsWith('..')) throw new Error('outside');
      return abs;
    },
    notes: () => notes,
    resolve: (t) => files.find((f) => f === t || f.split('/').pop() === t) ?? null,
    folders: () => ({ assets: 'Assets', attachments: 'Attachments' }),
    cacheDir: cache,
    added: async () => {},
    today: () => '2026-10-17',
  };
  return { lib, pc, cache, put, notes, host, store: new M.AssetStore(host) };
}
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);

test('files copied in: into a folder by kind, never over one there; the same content found and used instead, or kept as a second copy', async () => {
  const L = library('copy');
  const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#1d4e89"/></svg>';
  L.put('Assets/Logos/Saltwater logo.svg', logo);
  L.put('Attachments/Picture 1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  writeFileSync(path.join(L.pc, 'saltwater-logo-copy.svg'), logo); // the same content, another name
  writeFileSync(path.join(L.pc, 'Price list.pdf'), '%PDF-1.4 made up');
  writeFileSync(path.join(L.pc, 'shopfront.jpg'), Buffer.alloc(2048, 7));
  const paths = ['saltwater-logo-copy.svg', 'Price list.pdf', 'shopfront.jpg', 'missing.png'].map((n) => path.join(L.pc, n));
  const checked = await L.store.check([...paths, 'relative/not/allowed.png', 42]);
  assert.equal(checked.length, 3, 'only files that are there, by their full path');
  assert.equal(checked.find((c) => c.name === 'saltwater-logo-copy.svg').duplicateOf, 'Assets/Logos/Saltwater logo.svg');
  assert.equal(checked.find((c) => c.name === 'saltwater-logo-copy.svg').kind, 'logo');
  assert.equal(checked.find((c) => c.name === 'Price list.pdf').duplicateOf, undefined);
  const first = await L.store.add(paths, { duplicates: 'existing', collection: 'Wexley St' });
  assert.deepEqual(first.reused, ['Assets/Logos/Saltwater logo.svg']);
  assert.deepEqual(first.added.sort(), ['Assets/Documents/Price list.pdf', 'Assets/Images/shopfront.jpg']);
  assert.equal(readFileSync(path.join(L.pc, 'shopfront.jpg')).length, 2048, 'the original stays where it was');
  const index = JSON.parse(readFileSync(path.join(L.lib, 'Assets/assets.json'), 'utf8'));
  assert.deepEqual(index.assets['Assets/Images/shopfront.jpg'], { collections: ['Wexley St'], added: '2026-10-17' });
  assert.deepEqual(index.assets['Assets/Logos/Saltwater logo.svg'].collections, ['Wexley St'], 'the one used instead joins the collection');
  // Again: everything is a duplicate now; "keep both" makes second copies with free names.
  const again = await L.store.check(paths);
  assert.equal(again.filter((c) => c.duplicateOf).length, 3);
  const second = await L.store.add([path.join(L.pc, 'shopfront.jpg')], { duplicates: 'keep', kind: 'logo' });
  assert.deepEqual(second.added, ['Assets/Logos/shopfront.jpg'], 'a kind chosen on the page chooses the folder');
  const third = await L.store.add([path.join(L.pc, 'Price list.pdf')], { duplicates: 'keep' });
  assert.deepEqual(third.added, ['Assets/Documents/Price list 1.pdf']);
  await L.store.flushCache();
  assert.ok(existsSync(path.join(L.cache)), 'content hashes kept in Ironleaf’s own data');
  assert.ok(!existsSync(path.join(L.lib, '.thumbs')), 'nothing of ours in the library but the index');
});

test('the listing, an edit, a thumbnail kept outside the library, and renames and deletes followed', async () => {
  const L = library('list');
  L.put('Assets/Logos/Saltwater logo.svg', '<svg viewBox="0 0 10 10"><script>x()</script><rect width="10" height="10"/></svg>');
  L.put('Assets/Documents/Price list.pdf', '%PDF');
  L.put('Attachments/oven.png', 'png');
  L.put('Projects/Winter Menu/Winter Menu.md', '# Winter Menu\n![[Saltwater logo.svg]]');
  L.put('Boards/Launch.canvas', JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: 'Assets/Logos/Saltwater logo.svg', x: 0, y: 0, width: 10, height: 10 }], edges: [] }));
  L.notes.push({ path: 'Projects/Winter Menu/Winter Menu.md', title: 'Winter Menu', props: { type: 'project' }, links: [{ target: 'Saltwater logo.svg' }] });
  let listing = await L.store.list();
  assert.deepEqual(listing.assets.map((a) => a.path).sort(), ['Assets/Documents/Price list.pdf', 'Assets/Logos/Saltwater logo.svg', 'Attachments/oven.png']);
  const logo = listing.assets.find((a) => a.kind === 'logo');
  assert.equal(logo.uses, 2, 'a project and a canvas');
  assert.equal(listing.assets.find((a) => a.path === 'Attachments/oven.png').attachment, true);
  const d = await L.store.update('Assets/Logos/Saltwater logo.svg', { description: 'Main logo', alt: 'Saltwater Bakehouse', tags: ['brand'], role: 'primary' });
  assert.equal(d.role, 'primary');
  assert.deepEqual(d.usedIn.map((u) => u.kind).sort(), ['canvas', 'project']);
  await assert.rejects(L.store.update('Projects/Winter Menu/Winter Menu.md', { description: 'x' }), /isn’t in your assets/);
  await assert.rejects(L.store.update('../outside.png', { description: 'x' }), /isn’t in your assets/);
  // The SVG goes to the window made safe; its thumbnail and colours are kept in Ironleaf's data.
  const src = await L.store.source('Assets/Logos/Saltwater logo.svg');
  assert.ok(!src.svg.includes('<script'));
  assert.equal(await L.store.source('Assets/Documents/Price list.pdf'), null);
  const webp = new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), 1, 2, 3]);
  const thumb = await L.store.saveThumb('Assets/Logos/Saltwater logo.svg', webp, { width: 10, height: 10, palette: ['#1d4e89', 'nope'] });
  assert.ok(thumb.startsWith(L.cache), 'the thumbnail is in Ironleaf’s data, not the library');
  await assert.rejects(L.store.saveThumb('Assets/Logos/Saltwater logo.svg', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), {}), /isn’t a picture/);
  listing = await L.store.list();
  const again = listing.assets.find((a) => a.path === 'Assets/Logos/Saltwater logo.svg');
  assert.equal(again.thumb, thumb);
  assert.deepEqual(again.palette, ['#1d4e89']);
  assert.equal(again.width, 10);
  // Renamed elsewhere in Ironleaf: the index, the brand role and the thumbnail follow.
  require_('fs').mkdirSync(path.join(L.lib, 'Assets/Brand'), { recursive: true });
  require_('fs').renameSync(path.join(L.lib, 'Assets/Logos/Saltwater logo.svg'), path.join(L.lib, 'Assets/Brand/Saltwater logo.svg'));
  await L.store.renamed([['Assets/Logos/Saltwater logo.svg', 'Assets/Brand/Saltwater logo.svg']]);
  listing = await L.store.list();
  const moved = listing.assets.find((a) => a.path === 'Assets/Brand/Saltwater logo.svg');
  assert.equal(moved.description, 'Main logo');
  assert.equal(moved.role, 'primary');
  assert.equal(listing.brand.logos.primary, 'Assets/Brand/Saltwater logo.svg');
  assert.ok(moved.thumb && existsSync(moved.thumb.split('?')[0]));
  // To Recently deleted: its entry and role go.
  require_('fs').rmSync(path.join(L.lib, 'Assets/Brand/Saltwater logo.svg'));
  await L.store.removed(['Assets/Brand/Saltwater logo.svg']);
  listing = await L.store.list();
  assert.equal(listing.brand.logos.primary, undefined);
  assert.ok(!readFileSync(path.join(L.lib, 'Assets/assets.json'), 'utf8').includes('Saltwater logo.svg'));
  // Collections: added, renamed on every asset, removed (the files stay).
  await L.store.update('Assets/Documents/Price list.pdf', { collections: ['Shop'] });
  assert.deepEqual(await L.store.collections({ kind: 'add', name: 'Website' }), ['Shop', 'Website']);
  assert.deepEqual(await L.store.collections({ kind: 'rename', name: 'shop', to: 'Wexley St shop' }), ['Wexley St shop', 'Website']);
  assert.deepEqual((await L.store.details('Assets/Documents/Price list.pdf')).collections, ['Wexley St shop']);
  assert.deepEqual(await L.store.collections({ kind: 'remove', name: 'Wexley St shop' }), ['Website']);
  assert.ok(existsSync(path.join(L.lib, 'Assets/Documents/Price list.pdf')));
  // The brand kit: only logos that are assets are kept.
  const brand = await L.store.setBrand({ name: 'Saltwater Bakehouse', logos: { primary: 'Projects/Winter Menu/Winter Menu.md', icon: 'Attachments/oven.png' }, colours: [{ name: 'Harbour blue', hex: '#1d4e89' }], fonts: [{ name: 'Inter' }] });
  assert.deepEqual(brand.logos, { icon: 'Attachments/oven.png' });
  await L.store.flushCache();
});

test('the assistant finds assets and reads the brand kit (read only)', async () => {
  const L = library('agent');
  L.put('Assets/Logos/Saltwater logo.svg', '<svg viewBox="0 0 10 10"/>');
  L.put('Assets/Images/Wexley St shopfront.jpg', 'jpg');
  await L.store.update('Assets/Logos/Saltwater logo.svg', { alt: 'Saltwater Bakehouse', role: 'primary', tags: ['brand'] });
  await L.store.setBrand({ ...(await L.store.list()).brand, colours: [{ name: 'Harbour blue', hex: '#1d4e89', use: 'Headings' }], fonts: [{ name: 'Inter', use: 'Body' }] });
  const steps = [];
  const tools = new M.AgentTools({ index: new M.VaultIndex(), clean: (p) => p, assets: { list: () => L.store.list(), details: (rel) => L.store.details(rel) } }, [], (s) => steps.push(s));
  const run = async (name, args) => (await tools.run({ id: 'x', name, arguments: JSON.stringify(args) })).text;
  const found = await run('list_assets', { query: 'logo' });
  assert.match(found, /Assets\/Logos\/Saltwater logo\.svg \(Logo · .*Primary logo/);
  assert.doesNotMatch(found, /shopfront/);
  assert.match(await run('list_assets', { kind: 'image' }), /Wexley St shopfront\.jpg/);
  assert.match(await run('list_assets', { query: 'unicorn' }), /No asset matches\. The store holds 2 files/);
  const details = await run('asset_details', { path: 'Assets/Logos/Saltwater logo.svg' });
  assert.match(details, /Embed it in a note as: !\[\[Assets\/Logos\/Saltwater logo\.svg\|Saltwater Bakehouse\]\]/);
  const kit = await run('brand_kit', {});
  assert.match(kit, /Primary logo: Assets\/Logos\/Saltwater logo\.svg/);
  assert.match(kit, /Harbour blue: #1d4e89 \(Headings\)/);
  assert.match(kit, /Inter \(Body\)/);
  assert.ok(steps.some((s) => /Looked in your assets/.test(s.words)));
  const none = new M.AgentTools({ index: new M.VaultIndex(), clean: (p) => p }, [], () => {});
  assert.equal((await none.run({ id: 'y', name: 'brand_kit', arguments: '{}' })).isError, true);
});

// ── Several brand kits: one per area and project, with a clear default ──────────────────────────────────────────────
// Invented kits (a work area with a red kit, a business area with a teal one, a family area with no brand, a project
// overriding its area). A note uses its project's kit, otherwise its area's, otherwise the default.

const KIT_AREAS = [
  { id: 'work', name: 'Work', folder: 'Work', icon: 'briefcase', color: 'slate', about: 'Your job' },
  { id: 'business', name: 'Business', folder: 'Business', icon: 'chart', color: 'clay', about: 'A business of your own' },
  { id: 'family', name: 'Family', folder: 'Family', icon: 'people', color: 'rose', about: 'Partner and kids' },
  { id: 'library', name: 'Library', folder: 'Library', icon: 'bookmark', color: 'stone', about: 'Templates', quiet: true },
];
const KIT_PROJECTS = [{ path: 'Work/Projects/Harbour fit-out/Harbour fit-out.md', name: 'Harbour fit-out' }];
const kitCtx = { areas: KIT_AREAS, projects: KIT_PROJECTS };

const MULTI_JSON = {
  version: 1,
  brands: [
    { id: 'redline-co', name: 'Redline Co', logos: { primary: 'Assets/Logos/Redline logo.svg' }, colours: [{ name: 'Signal red', hex: '#b3261e', use: 'Headings' }], fonts: [{ name: 'Inter', use: 'Body' }] },
    { id: 'tealwork-studio', name: 'Tealwork Studio', logos: { primary: 'Assets/Logos/Teal logo.svg' }, colours: [{ name: 'Pine', hex: '#0f6b5c', use: 'Headings' }], fonts: [] },
  ],
  brandDefault: 'redline-co',
  brandAreas: { work: 'redline-co', business: 'tealwork-studio', family: null },
  brandProjects: { 'Work/Projects/Harbour fit-out/Harbour fit-out.md': 'tealwork-studio' },
  collections: [],
  assets: {},
};

test('several brand kits: the note takes its project’s kit, else its area’s, else the default; an area may have no brand', () => {
  const idx = M.parseIndex(JSON.stringify(MULTI_JSON));
  assert.equal(idx.brands.length, 2);
  assert.equal(idx.brandDefault, 'redline-co');
  assert.equal(idx.brand.name, 'Redline Co', 'the default kit’s content stays where older readers look');
  const name = (note) => M.kitForNote(idx, note, kitCtx)?.name ?? null;
  assert.equal(name({ path: 'Work/Notes/Standup.md' }), 'Redline Co', 'the work area’s red kit');
  assert.equal(name({ path: 'Business/Notes/Pricing.md' }), 'Tealwork Studio', 'the business area’s teal kit');
  assert.equal(name({ path: 'Family/Notes/Fete.md' }), null, 'the family area has no brand');
  assert.equal(name({ path: 'Home/Notes/Leak.md' }), 'Redline Co', 'an area with no choice takes the default');
  assert.equal(name({ path: 'Notes/Loose.md' }), 'Redline Co', 'a note in no area takes the default');
  assert.equal(name({ path: 'Work/Projects/Harbour fit-out/Harbour fit-out.md', props: { type: 'project' } }), 'Tealwork Studio', 'the project’s file takes its own kit, not its area’s');
  assert.equal(name({ path: 'Work/Projects/Harbour fit-out/Photo shoot.md' }), 'Tealwork Studio', 'a note in the project’s folder takes the project’s kit');
  assert.equal(name({ path: 'Work/Meetings/Kickoff.md', props: { project: '[[Harbour fit-out]]' } }), 'Tealwork Studio', 'a meeting about the project takes the project’s kit');
  assert.equal(name({ path: 'Notes/Loose.md', props: { area: 'Family' } }), null, 'an area: property wins over the folder');
  assert.deepEqual(M.usesOfKit(idx, 'redline-co'), { areas: ['work'], projects: [] });
  assert.deepEqual(M.usesOfKit(idx, 'tealwork-studio'), { areas: ['business'], projects: ['Work/Projects/Harbour fit-out/Harbour fit-out.md'] });
  // A choice naming a kit that is gone is passed over, never fatal: the area’s, then the default.
  const stale = M.parseIndex(JSON.stringify({ ...MULTI_JSON, brandProjects: { 'Work/Projects/Harbour fit-out/Harbour fit-out.md': 'gone-kit' }, brandAreas: { work: 'gone-kit', family: null } }));
  assert.equal(M.kitForNote(stale, { path: 'Work/Projects/Harbour fit-out/Harbour fit-out.md', props: { type: 'project' } }, kitCtx)?.name, 'Redline Co');
  assert.equal(M.kitForNote(M.emptyIndex(), { path: 'Notes/x.md' }, kitCtx), null, 'no kits at all: no brand');
});

test('an old single-kit file loads as one kit and stays the default; written back without the new keys', () => {
  const old = {
    about: 'Ironleaf’s asset index.',
    version: 1,
    brand: { name: 'Saltwater Bakehouse', logos: { primary: 'Assets/Logos/Saltwater logo.svg' }, colours: [{ name: 'Harbour blue', hex: '#1d4e89', use: 'Headings' }], fonts: [{ name: 'Inter', use: 'Body' }] },
    collections: ['Brand'],
    assets: { 'Assets/Logos/Saltwater logo.svg': { description: 'Main logo' } },
  };
  const idx = M.parseIndex(JSON.stringify(old));
  assert.equal(idx.brands.length, 1, 'the single kit migrates without any loss');
  assert.equal(idx.brandDefault, idx.brands[0].id);
  assert.equal(idx.brands[0].name, 'Saltwater Bakehouse');
  assert.equal(M.kitForNote(idx, { path: 'Family/Notes/Fete.md' }, kitCtx)?.name, 'Saltwater Bakehouse', 'and stays the default for what it already covers');
  const out = M.serializeIndex(idx);
  assert.ok(!out.includes('"brands"') && !out.includes('brandDefault'), 'nothing new written for someone with one kit');
  assert.deepEqual(JSON.parse(out).brand, old.brand, 'the kit byte for byte as it was');
  assert.equal(M.serializeIndex(M.parseIndex(out)), out, 'written back exactly the same');
  const multi = M.serializeIndex(M.parseIndex(JSON.stringify(MULTI_JSON)));
  assert.ok(multi.includes('"brands"') && multi.includes('"brandDefault"'), 'several kits are written plainly');
  assert.ok(!multi.includes('"brand":'), 'with no second copy of the default beside them');
  assert.equal(M.serializeIndex(M.parseIndex(multi)), multi, 'and read back the same');
});

test('the store grows kits on disk: add, save, default, areas, projects, remove', async () => {
  const L = library('kits');
  L.put('Assets/Logos/Redline logo.svg', '<svg viewBox="0 0 10 10"/>');
  L.put('Assets/Logos/Teal logo.svg', '<svg viewBox="0 0 10 10"/>');
  await L.store.setBrand({ name: 'Redline Co', logos: { primary: 'Assets/Logos/Redline logo.svg' }, colours: [{ name: 'Signal red', hex: '#b3261e' }], fonts: [] });
  let listing = await L.store.list();
  assert.equal(listing.kits.length, 1, 'one kit, as today');
  const added = await L.store.brands({ kind: 'add', name: 'Tealwork Studio' });
  assert.equal(added.kit.id, 'tealwork-studio');
  await assert.rejects(L.store.brands({ kind: 'add', name: 'tealwork studio' }), /already a kit called/, 'names are one of a kind');
  await assert.rejects(L.store.brands({ kind: 'add', name: '  ' }), /a name/, 'a kit needs a name');
  await L.store.brands({ kind: 'save', id: 'tealwork-studio', kit: { name: 'Tealwork Studio', logos: { primary: 'Work/doc.md' }, colours: [{ name: 'Pine', hex: '#0f6b5c' }], fonts: [] } });
  listing = await L.store.list();
  assert.deepEqual(listing.kits.find((k) => k.id === 'tealwork-studio').logos, {}, 'only logos that are assets are kept');
  await assert.rejects(L.store.brands({ kind: 'save', id: 'gone', kit: { name: 'x', logos: {}, colours: [], fonts: [] } }), /gone/);
  await L.store.brands({ kind: 'default', id: 'tealwork-studio' });
  assert.equal((await L.store.list()).brand.name, 'Tealwork Studio', 'the default is what older readers see');
  await assert.rejects(L.store.brands({ kind: 'default', id: 'gone' }), /gone/);
  await L.store.brands({ kind: 'area', area: 'work', kit: 'redline-co' });
  await L.store.brands({ kind: 'area', area: 'family', kit: null });
  await assert.rejects(L.store.brands({ kind: 'area', area: 'work', kit: 'gone' }), /gone/);
  listing = await L.store.list();
  assert.deepEqual(listing.brandAreas, { work: 'redline-co', family: null });
  await L.store.brands({ kind: 'area-clear', area: 'work' });
  assert.deepEqual((await L.store.list()).brandAreas, { family: null });
  await L.store.brands({ kind: 'project', project: 'Work/Projects/Harbour fit-out/Harbour fit-out.md', kit: 'tealwork-studio' });
  assert.deepEqual((await L.store.list()).brandProjects, { 'Work/Projects/Harbour fit-out/Harbour fit-out.md': 'tealwork-studio' });
  await L.store.brands({ kind: 'project-clear', project: 'Work/Projects/Harbour fit-out/Harbour fit-out.md' });
  assert.deepEqual((await L.store.list()).brandProjects, {});
  await L.store.brands({ kind: 'project', project: 'Work/Projects/Harbour fit-out/Harbour fit-out.md', kit: 'tealwork-studio' });
  const file = JSON.parse(readFileSync(path.join(L.lib, 'Assets/assets.json'), 'utf8'));
  assert.ok(Array.isArray(file.brands) && file.brands.length === 2 && file.brandDefault === 'tealwork-studio', 'plain and readable on disk');
  await L.store.brands({ kind: 'remove', id: 'tealwork-studio' });
  listing = await L.store.list();
  assert.equal(listing.kits.length, 1, 'one kit left');
  assert.equal(listing.brandDefault, 'redline-co', 'the default falls to the kit left');
  assert.deepEqual(listing.brandProjects, {}, 'its projects fall back to their areas');
  assert.deepEqual(listing.brandAreas, { family: null }, 'the family’s no brand stands');
  await L.store.brands({ kind: 'area-clear', area: 'family' });
  assert.ok(!readFileSync(path.join(L.lib, 'Assets/assets.json'), 'utf8').includes('"brands"'), 'and the file reads as one kit again');
  await assert.rejects(L.store.brands({ kind: 'remove', id: 'tealwork-studio' }), /gone/);
  await L.store.flushCache();
});

test('renames and deletes follow every kit’s logos and every project’s choice', () => {
  const idx = M.parseIndex(JSON.stringify(MULTI_JSON));
  const moved = M.renameInIndex(idx, [
    ['Assets/Logos/Redline logo.svg', 'Assets/Brand/Redline logo.svg'],
    ['Work/Projects/Harbour fit-out/Harbour fit-out.md', 'Work/Projects/Harbour/Harbour.md'],
  ]);
  assert.equal(moved.brands.find((k) => k.id === 'redline-co').logos.primary, 'Assets/Brand/Redline logo.svg');
  assert.equal(moved.brands.find((k) => k.id === 'tealwork-studio').logos.primary, 'Assets/Logos/Teal logo.svg', 'the other kit untouched');
  assert.deepEqual(Object.keys(moved.brandProjects), ['Work/Projects/Harbour/Harbour.md'], 'the project’s choice follows it');
  const gone = M.removeFromIndex(moved, ['Assets/Logos/Teal logo.svg', 'Work/Projects/Harbour/Harbour.md']);
  assert.equal(gone.brands.find((k) => k.id === 'tealwork-studio').logos.primary, undefined, 'a logo gone from one kit only');
  assert.equal(gone.brands.find((k) => k.id === 'redline-co').logos.primary, 'Assets/Brand/Redline logo.svg');
  assert.deepEqual(gone.brandProjects, {}, 'a project gone takes its choice with it');
});

test('the assistant lists every kit with where each is used; one kit reads as today', async () => {
  const L = library('agent-kits');
  L.put('Assets/Logos/Redline logo.svg', '<svg viewBox="0 0 10 10"/>');
  await L.store.setBrand({ name: 'Redline Co', logos: { primary: 'Assets/Logos/Redline logo.svg' }, colours: [{ name: 'Signal red', hex: '#b3261e', use: 'Headings' }], fonts: [{ name: 'Inter', use: 'Body' }] });
  await L.store.brands({ kind: 'add', name: 'Tealwork Studio' });
  await L.store.brands({ kind: 'area', area: 'work', kit: 'redline-co' });
  await L.store.brands({ kind: 'area', area: 'family', kit: null });
  const tools = new M.AgentTools({ index: new M.VaultIndex(), clean: (p) => p, assets: { list: () => L.store.list(), details: (rel) => L.store.details(rel) } }, [], () => {});
  const run = async (name, args) => (await tools.run({ id: 'x', name, arguments: JSON.stringify(args) })).text;
  const words = await run('brand_kit', {});
  assert.ok(words.includes('Redline Co') && words.includes('Tealwork Studio'), 'every kit named');
  assert.ok(/default/i.test(words), 'the default marked');
  assert.ok(words.includes('work'), 'where each is used');
  await L.store.flushCache();
});

test('exports name the kit in the same plain words from every door', () => {
  assert.equal(M.kitWords({ name: 'Redline Co' }), 'in the Redline Co kit');
  assert.equal(M.kitWords({}), 'in the brand kit');
  assert.equal(M.kitWords(null), 'with no brand');
});
