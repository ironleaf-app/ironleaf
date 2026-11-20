// node --test tests/p15-packs-work.test.mjs — Pack pages: Weekly, Sites, Suppliers, Memories (p15, Nov 2026):
// one left edge, styled rows and tiles, and empty states that say nothing becoming one quiet line. Each check pins
// the mechanism in the pack's own view (views/modules) or the appended scoped rules in packs-87.css / w3b-packs.css.
// NV_P15W_ROOT=dir reads another tree instead (fail-before runs against a HEAD extract).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = process.env.NV_P15W_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

// ── One left edge (the sub, facts and body start at the column edge, like every other page) ──

test('p87: Sites and Suppliers start at the column edge', () => {
  const css = read('src/renderer/src/styles/packs-87.css');
  for (const scope of ['.wm-sites', '.wm-vendors']) {
    for (const sel of [`${scope} .p87 .nv-page-lead`, `${scope} .p87 .page-props`, `${scope} .p87-body`]) {
      assert.ok(css.includes(sel), `${sel} is overridden`);
    }
  }
  const at = css.indexOf('.wm-sites .p87 .nv-page-lead');
  const block = css.slice(at, css.indexOf('}', at));
  assert.match(block, /margin-left:\s*0/, 'the sub starts at the edge, not 54px in');
});

test('w3b: Weekly and Memories start at the column edge', () => {
  const css = read('src/renderer/src/styles/w3b-packs.css');
  for (const scope of ['.wm-weekly', '.wm-memories']) {
    for (const sel of [`${scope} .w3b-page .nv-page-lead`, `${scope} .w3b-page .page-props`]) {
      assert.ok(css.includes(sel), `${sel} is overridden`);
    }
  }
});

// ── Quiet empty lines (a section card holding only its muted line drops its box) ──

test('p87: an empty section card reads as one quiet line', () => {
  const css = read('src/renderer/src/styles/packs-87.css');
  for (const scope of ['.wm-sites', '.wm-vendors']) {
    assert.ok(css.includes(`${scope} .p87-body .card:has(> .vsub:only-child)`), `${scope} flattens a vsub-only card`);
  }
  const at = css.indexOf('.wm-sites .p87-body .card:has');
  const block = css.slice(at, css.indexOf('}', at));
  assert.match(block, /background:\s*none/, 'no box fill');
  assert.match(block, /border:\s*0/, 'no box edge');
});

test('w3b: an empty section card reads as one quiet line, rows and the Start card keep the box', () => {
  const css = read('src/renderer/src/styles/w3b-packs.css');
  for (const scope of ['.wm-weekly', '.wm-memories']) {
    const sel = `${scope} .w3b-page .card:has(> .vsub):not(:has(> .trow)):not(:has(.btn.pri))`;
    assert.ok(css.includes(sel), `${scope} flattens only rowless, actionless cards`);
  }
  const at = css.indexOf('.wm-weekly .w3b-page .card:has');
  const block = css.slice(at, css.indexOf('}', at));
  assert.match(block, /background:\s*none/, 'no box fill');
  assert.match(block, /padding:\s*2px 0 !important/, 'the line starts at the edge past the inline card padding');
});

// ── The pages stand in their own scope ──

test('each pack page carries its module scope', () => {
  assert.ok(read('src/renderer/src/views/modules/work/SitesPage.tsx').includes('className="wm-sites"'), 'Sites stands in wm-sites (its cards, chips, edits and photos are styled under it)');
  assert.ok(read('src/renderer/src/views/modules/work/VendorsPage.tsx').includes('className="wm-vendors"'), 'Suppliers stands in wm-vendors');
  const weekly = read('src/renderer/src/views/modules/w3b/Weekly87.tsx');
  assert.ok(weekly.includes('className="wm-weekly"'), 'Weekly stands in wm-weekly');
  assert.equal((weekly.match(/className="wm-weekly"/g) || []).length, 4, 'overview, draft and both short states');
  const memories = read('src/renderer/src/views/modules/w3b/Memories87.tsx');
  // Packs uplift item 5: the overview merged into Family; the album page and both short states keep the scope.
  assert.equal((memories.match(/className="wm-memories"/g) || []).length, 3, 'album and both short states');
});

// ── Sites rows ──

test('sites: a patch job names its site, and All live needs patch points', () => {
  const page = read('src/renderer/src/views/modules/work/SitesPage.tsx');
  assert.match(page, /const meta = \[x\.siteName, x\.notes/, 'the row says which site the point is at');
  assert.match(page, /s\.patch\.length > 0 && \(s\.toPatch > 0 \?/, 'All live only when points exist');
  assert.match(page, /<p className="vsub">\s*<span className="pill green">Everything live<\/span>/, 'Everything live is a quiet line');
});

// ── Sites rows say things once ──

test('sites: a patch point says its state once (the tag says it, the meta adds only news)', () => {
  const page = read('src/renderer/src/views/modules/work/SitesPage.tsx');
  const at = page.indexOf('function SitePatchRow');
  const body = page.slice(at, page.indexOf('function SitePage', at));
  assert.doesNotMatch(body, /: 'live'/, 'no live fallback duplicating the Live tag');
  assert.doesNotMatch(body, /\|\| 'to patch'/, 'no to-patch fallback duplicating the state tag');
  assert.match(body, /mapped \$\{shortDay\(x\.date\)\}/, 'a mapped day still shows');
  assert.match(body, /\{meta \? <span className="meta">/, 'the meta shows only when it adds news');
});

test('sites: a room tags only patch work due (its counts already say the rest)', () => {
  const page = read('src/renderer/src/views/modules/work/SitesPage.tsx');
  const at = page.indexOf('function SiteRoomRow');
  const body = page.slice(at, page.indexOf('/** "30 Jun 27" for a warranty', at));
  assert.doesNotMatch(body, /: 'Empty'/, 'no Empty tag beside "0 devices · 0 points"');
  assert.match(body, /\{due \? <span className="tag amber">/, 'only due work earns the tag');
  assert.doesNotMatch(body, /\$\{ds\.length\} \$\{ds\.length === 1 \? 'device' : 'devices'\}` : '/, 'no device count repeated from the meta');
});

// ── Facts and subs never carry zeros ──

test('sites: the register and a site say what is kept, never zeros', () => {
  const page = read('src/renderer/src/views/modules/work/SitesPage.tsx');
  assert.match(page, /keptFacts|stockParts|non-zero/i, 'counts are built from what exists');
  assert.doesNotMatch(page, /`\$\{plural\(m\.sites\.length, 'site'\)\} · \$\{plural\(kept, 'device'\)\}/, 'no unconditional "0 devices"');
});

// ── A missing photo file shows a tile, never a broken image ──

test('sites: a missing photo falls back to its tile', () => {
  const page = read('src/renderer/src/views/modules/work/SitesPage.tsx');
  assert.match(page, /onError=\{\(\) => setGone\(true\)\}/, 'a failed file swaps to the fallback');
  assert.ok((page.match(/onError=\{\(\) => setGone\(true\)\}/g) || []).length >= 2, 'the register cover and the photo grid both fall back');
});

// ── Memories ──

test('memories: New album and the photo form open (the host is mounted), and no videos says nothing', () => {
  const view = read('src/renderer/src/views/modules/w3b/Memories87.tsx');
  assert.ok(view.includes("import { RecordFormHost } from '../RecordForm'"), 'the form host is imported');
  // Packs uplift item 5: the overview merged into Family (whose PackPage mounts the host); the album mounts its own.
  assert.equal((view.match(/<RecordFormHost \/>/g) || []).length, 1, 'the album mounts the host');
  assert.match(view, /videos > 0 \? `\$\{plural\(photoCount\(a\), 'photo'\)\} and /, 'videos only when there are some');
  assert.doesNotMatch(view, /and \$\{plural\(videos, 'video'\)\}\. Who is in them/, 'no unconditional "and 0 videos"');
});

test('family: the Week-ahead facts say what there is, never zeros, and go when there is nothing', () => {
  // Packs uplift item 5: the albums' Kept facts retired with the Memories overview; Family's facts carry the same
  // rule (zero parts drop out, and with nothing at all the facts go away).
  const view = read('src/renderer/src/views/modules/w3b/Family87.tsx');
  assert.match(view, /const parts: string\[\] = \[\]/, 'facts are built from what exists');
  assert.match(view, /const facts = parts\.length \? /, 'no facts when there is nothing');
});

test('memories: a missing cover or photo falls back to its tile', () => {
  const view = read('src/renderer/src/views/modules/w3b/Memories87.tsx');
  assert.ok((view.match(/onError=\{\(\) => setGone\(true\)\}/g) || []).length >= 2, 'covers and photo tiles swap to the fallback');
  assert.doesNotMatch(view, /\{a\.cover \? <img/, 'no bare cover image without its fallback');
});

// ── Weekly: the draft counts its sources in plain words ──

test('weekly: the draft says "1 project note", never "1 project notes"', () => {
  const view = read('src/renderer/src/views/modules/w3b/Weekly87.tsx');
  assert.match(view, /plural\(sources\.length \|\| view\.projects\.length, 'project note'\)/, 'the count pluralises');
  assert.doesNotMatch(view, /project notes\. Every line shows its source/, 'no unconditional plural');
});

// ── Suppliers: a lapsed quote counts (the model closes it, so openness must not gate it) ──

test('vendors: a lapsed quote counts apart and asks to Decide, open or not', () => {
  const page = read('src/renderer/src/views/modules/work/VendorsPage.tsx');
  assert.doesNotMatch(page, /q\.open && q\.state === 'Lapsed'/, 'lapsed never gated on open (the model closes a lapsed quote)');
  assert.match(page, /const hasLapsed = \(q: Quote\): boolean => q\.state === 'Lapsed'/, 'state alone says lapsed');
});

// ── Late reads through the module words (5 Nov 2026 polish list item 7: "Overdue since" beside "N days late") ──

test('vendors and weekly read late through the module words, never overdue since', () => {
  const vendors = read('src/renderer/src/views/modules/work/VendorsPage.tsx');
  assert.ok(vendors.includes('lateWords(o.delivery, m.today)'), 'a late delivery reads the module words');
  assert.doesNotMatch(vendors, /[Oo]verdue since/, 'no overdue-since shaping left');
  const weekly = read('src/renderer/src/views/modules/work/WeeklyPage.tsx');
  assert.ok(weekly.includes('whenWords(d.dueDay, view.today)'), 'a late update reads the module words');
  assert.doesNotMatch(weekly, /overdue since/, 'no overdue-since shaping left');
});
