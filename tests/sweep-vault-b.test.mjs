// node --test tests/sweep-vault-b.test.mjs — the Vault part-B sweep (3 Nov 2026):
// Search results that clip instead of overlapping, a panel input on one row,
// More labels that wrap with tooltips, pack one-liners that fit, Notes filters
// on the chips row, zeros off every filter/tab count, no blue chip or pink
// wash or pink callout edge, the chase in coral, and the cool redrawn icon.
// Each test fails without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const css = (f) => read(`src/renderer/src/styles/${f}`);

/** RGBA pixels of a non-interlaced 8-bit PNG (the window icon's shape). */
function rgba(file) {
  const d = readFileSync(path.join(root, file));
  assert.equal(d.subarray(1, 4).toString(), 'PNG');
  const w = d.readUInt32BE(16), h = d.readUInt32BE(20);
  assert.equal(d[24], 8, '8-bit');
  assert.equal(d[25], 6, 'RGBA');
  const idat = [];
  let at = 8;
  while (at < d.length) {
    const len = d.readUInt32BE(at), type = d.subarray(at + 4, at + 8).toString();
    if (type === 'IDAT') idat.push(d.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0, b = prev[i], c = i >= 4 ? prev[i - 4] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
  }
  return { w, h, px: (x, y) => [...out.subarray(y * stride + x * 4, y * stride + x * 4 + 4)] };
}

test('F-B1 search titles clip instead of running over the folder and count', () => {
  const s = css('search-ask-87.css');
  assert.match(s, /\.sas-rowhead \{\s*display: flex;/, 'the rowhead is a flex row');
  assert.ok(s.includes('.sas-rowhead:not(:has(> .t)) > .clip:first-child { flex: 1 1 auto; }'), 'the title takes the room and clips');
  assert.ok(s.includes('.sas-rowhead:has(> .t) { flex-direction: column;'), 'file hits keep name-over-path');
});

test('F-B2 the search panel input is one row', () => {
  assert.ok(css('search-ask-87.css').includes('.sas-host-panel .sin { display: flex; align-items: center;'), 'panel input: icon, box and clear on one row');
});

test('F-B4 More labels wrap whole words to three lines at most, never dots, and carry the full label', () => {
  const s = read('src/renderer/src/styles.css');
  const label = s.match(/\.menu-label \{([^}]*)\}/s)?.[1] ?? '';
  assert.ok(!label.includes('-webkit-line-clamp') && !label.includes('text-overflow: ellipsis'), 'never cut with … (t207 pass 2: the two-line clamp drew dots)');
  assert.ok(label.includes('overflow-wrap: break-word'), 'whole words');
  assert.ok(/max-height: calc\(3 \* 1lh\)/.test(label), 'three lines at most');
  assert.ok(!label.includes('white-space: nowrap'), 'no one-line cut-off');
  assert.ok(read('src/renderer/src/components/Menu.tsx').includes('title={item.label}'), 'rows tooltip the full label');
});

test('F-B6 every pack one-liner fits its row', () => {
  const src = read('src/shared/life-modules.ts');
  const words = [...src.matchAll(/^    words: '([^']*)',$/gm)].map((m) => m[1]);
  assert.equal(words.length, 17, 'seventeen packs (Memories merged into Family, packs uplift item 5)');
  for (const w of words) assert.ok(w.length <= 72, `${w.length} chars: ${w}`);
  assert.ok(read('src/renderer/src/components/ModulesSettings.tsx').includes('title={m.words}'), 'rows tooltip their line');
});

test('F-B7 the Notes filters sit on the chips row', () => {
  const s = css('w2b.css');
  assert.ok(s.includes('.w2b-project {') && s.match(/\.w2b-project \{[^}]*width: auto;/)?.[0], 'project filter is auto width');
  assert.ok(s.match(/\.w2b-sort \{[^}]*width: auto;/)?.[0], 'sort is auto width');
});

test('F-B8 zeros stay off every filter and tab count', () => {
  const notes = read('src/renderer/src/views/NotesPage.tsx');
  for (const bit of ['showCount(rows.length)', 'showCount(dailyCount)', 'showCount(docsCount)', 'showCount(f.count)', 'showCount(s.count)', 'showCount(kindCount(f.id))'])
    assert.ok(notes.includes(bit), `Notes ${bit}`);
  assert.ok(read('src/renderer/src/views/TemplatesPage.tsx').includes('showCount(f === \'all\' ? templates.length : counts[f])'), 'templates counts');
  assert.ok(read('src/renderer/src/views/AssetsPage.tsx').includes('showCount(count)'), 'assets strip counts');
  const people = read('src/renderer/src/views/PeoplePage.tsx');
  assert.ok(people.includes('showCount(people)') && people.includes('showCount(orgs)'), 'people grid counts');
});

test('F-B9 the Yours marker is slate, never blue', () => {
  const s = css('page-states-87.css');
  const rule = s.match(/\.w4b-tp-own \{([^}]*)\}/s)?.[1] ?? '';
  assert.ok(rule.includes('--slate-bg') && rule.includes('--slate-tx'), 'slate tag');
  assert.ok(!rule.includes('blue'), 'no blue');
});

test('F-B10 UI callout boxes are flat, markdown kind boxes keep their edge', () => {
  assert.ok(read('src/renderer/src/styles/kit.css').includes('.callout.slate, .callout.amber, .callout.blue, .callout.green, .callout.red { border: 0; }'), 'UI variants lose the accent edge');
  assert.ok(read('src/renderer/src/styles.css').includes('--callout, var(--accent)'), 'markdown kind edge stays');
});

test('F-B11 the People banners are neutral, not the accent wash', () => {
  const s = css('life.css');
  const rule = s.match(/\.pc-banner \{([^}]*)\}/s)?.[1] ?? '';
  assert.ok(rule.includes('--slate-bg') && rule.includes('border: 0'), 'slate banner');
  assert.ok(!rule.includes('--accent'), 'no accent wash');
});

test('F-B12 the chase is coral, your own debt quiet', () => {
  const people = read('src/renderer/src/views/PeoplePage.tsx');
  assert.ok(people.includes('tag slate w2b-tag"><span className="dot" aria-hidden="true" />Owes you'), 'owes-you takes the coral dot on a quiet chip (4 Nov reviewer)');
  assert.ok(!people.includes('tag amber') && !people.includes('tag blue'), 'no amber or blue status chip left');
});

test('F-B13 Look does not repeat its title as a heading', () => {
  assert.ok(!read('src/renderer/src/components/Settings.tsx').includes('<h3>Look</h3>'), 'no stutter');
});

test('F-B14 nothing points at a Settings › Templates section', () => {
  assert.ok(read('src/renderer/src/views/TemplatesPage.tsx').includes('Settings › General'), 'templates empty state');
  assert.ok(read('src/main/app.ts').includes('Settings › General'), 'templates folder errors');
  const hits = ['src/renderer/src/views/TemplatesPage.tsx', 'src/main/app.ts', 'src/main/hub.ts', 'src/main/reminders.ts', 'src/main/tasks.ts']
    .filter((f) => read(f).includes('Settings › Templates'));
  assert.deepEqual(hits, [], 'no stale section pointer');
});

test('F-B15 primary page buttons are icon + label, never a text +', () => {
  assert.ok(read('src/renderer/src/views/TemplatesPage.tsx').includes('<Icon name="plus" size={14} /> New template'), 'templates');
  assert.ok(read('src/renderer/src/views/AssetsPage.tsx').includes('<Icon name="plus" size={14} /> Add files'), 'assets');
});

test('F-B16 clipped names carry their full words on title=', () => {
  const picker = read('src/renderer/src/components/Picker.tsx');
  assert.ok(picker.includes('title={typeof item.label === \'string\' ? item.label : undefined}'), 'picker rows');
  const search = read('src/renderer/src/components/SearchView.tsx');
  assert.ok(search.includes('title={on ? `${title}: ${label}` : title}'), 'search filters name their value');
  assert.ok(search.includes('title={`${plainLine(s.text, s.ranges).text} (line ${s.line + 1})`}'), 'snippets tooltip their line');
  assert.match(read('src/renderer/src/views/PersonPage.tsx'), /className="trow w2b-row"\s+title=\{e\.title\}/, 'person timeline');
});

test('F-B17 the window icon is the Ironleaf leaf on the iron tile (20 Nov 2026, the rename)', () => {
  const { w, h, px } = rgba('resources/icon.png');
  assert.deepEqual([w, h], [512, 512]);
  // The leaf is the brand's paper; the tile is iron; the folded corner is leaf-300 (ironleaf-brand (the brand kit, kept outside this repository)/palette.md).
  assert.deepEqual(px(300, 230), [245, 242, 234, 255], 'the leaf');
  assert.deepEqual(px(256, 256).slice(0, 3), [37, 42, 49], 'the iron tile behind the stem');
  assert.deepEqual(px(320, 170).slice(0, 3), [124, 193, 151], 'the leaf-green fold');
  // The tile corners are transparent.
  assert.equal(px(4, 4)[3], 0, 'rounded transparent corners');
  // The ICO holds every size the old one did.
  const ico = readFileSync(path.join(root, 'resources/icon.ico'));
  assert.equal(ico.readUInt16LE(2), 1, 'an ICO file');
  const sizes = [...Array(ico.readUInt16LE(4))].map((_, i) => ico[6 + i * 16] || 256);
  for (const s of [16, 20, 24, 28, 30, 32, 36, 40, 48, 56, 60, 64, 72, 80, 96, 128, 256]) assert.ok(sizes.includes(s), `ICO holds ${s}`);
  // The flat drawing kept in source matches the cool mark.
  const flat = read('src/renderer/src/assets/sub-vault-flat.svg');
  assert.ok(flat.includes('fill="#FFFFFF"') && flat.includes('fill="#E3EAF3"') && flat.includes('fill="#9AA3B2"'), 'cool book');
  assert.ok(!flat.includes('#FFF4DA') && !flat.includes('#E9DCBC') && !flat.includes('#C8B78E'), 'no cream left');
});

test('F-B18 the tour comment names Packs and Show me around', () => {
  assert.ok(read('src/renderer/src/views/modules/ModuleTour.tsx').includes('Settings › Packs › Show me around'), 'current words');
});
