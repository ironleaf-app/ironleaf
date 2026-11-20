// node --test tests/uplift-92-labels.test.mjs — the 9.2 uplift's labels batch (F24, F28, F103, F106,
// F107, F118, F119, F120, F122, F127, F131, F132, F135, F140, F142, F144, F148, F150, F152): words and
// names the person reads, each fixed at its root. Settings search ranks partial matches below instead of
// finding nothing; link chips follow the one shared type reading; a notice opens the one thing its caption
// names; areas show how much they hold; outlines indent without H-badges; bookings past their day read Past,
// never Done; a fifth delivered file gets its overflow row; broken locked links, empty picture vaults and
// failed diagrams speak in plain words; starter counts come from the list Start writes; mention links,
// retypes, export unlock, sensitivity fallbacks, unpublishes and email excerpts each go through one honest
// mechanism. Pure logic is checked as it is; the screens are guarded by the mechanism they call, so each
// check fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u92-labels-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  writeFileSync(path.join(work, 'entry.ts'), `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/settingsSearch.ts'))};\n`);
  await build({ input: path.join(work, 'entry.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('settings search ranks partial matches below, never nothing (F24)', () => {
  const labels = { models: 'Models' };
  const entries = [
    { section: 'models', title: 'Theme', hint: 'Dark mode and light.', words: 'appearance' },
    { section: 'models', title: 'Model', hint: 'Which model the chat uses.', words: 'ai model' },
  ];
  const titles = (q) => S.searchSettings(q, entries, labels, 5).map((h) => h.entry.title);
  assert.ok(titles('theme zebra').includes('Theme'), 'one extra word still finds it');
  assert.deepEqual(titles('zebra xyzzy'), [], 'no word anywhere still finds nothing');
  assert.equal(titles('dark mode')[0], 'Theme', 'matching every word outranks a prefix on one');
  assert.equal(titles('theme')[0], 'Theme', 'single words read as before');
  assert.ok(S.searchSettings('theme zebra', entries, labels, 5).find((h) => h.entry.title === 'Theme').score > 0, 'ranked by score');
});

test('link chips follow the one shared type reading (F28)', () => {
  const types = read('src/renderer/src/state/noteTypes.ts');
  assert.ok(types.includes('export function mentionKindFor'), 'one chip-kind helper');
  assert.ok(types.includes("if (id === 'person') return 'person'"), 'person by type id');
  assert.ok(types.includes("if (id === 'meeting' || id === 'meeting-series') return 'meeting'"), 'meetings by type id');
  const setup = read('src/renderer/src/editor/setup.ts');
  assert.ok(setup.includes('return mentionKindFor(resolved);'), 'the editor chips through it');
  assert.doesNotMatch(setup, /people\|contacts\)\$\//, 'no folder-name gates');
  assert.doesNotMatch(setup, /type\.startsWith\('meeting'\)/, 'no raw type-prefix gates');
});

test('a notice opens the one thing its caption names (F103)', () => {
  const bell = read('src/renderer/src/panels/NoticeBell.tsx');
  assert.ok(bell.includes('if (item.sessionId) void window.nv.notices.open(item.id).finally(refresh);'), 'the conversation when one is named');
  assert.ok(bell.includes('if (item.note) A.openAtLine(item.note, item.line ?? 0);'), 'else the note');
  assert.ok(bell.includes('{item.note && item.sessionId && ('), 'both named offers the note second');
  assert.doesNotMatch(bell, /if \(item\.note\) A\.openAtLine\(item\.note, item\.line \?\? 0\);\n    if \(item\.sessionId\)/, 'never both from one click');
});

test('areas show how much they hold (F106)', () => {
  const areas = read('src/renderer/src/panels/AreasPlaces.tsx');
  assert.ok(areas.includes('{c && c.total > 0 && ('), 'each area with its total');
  assert.ok(areas.includes('{!!c?.[k] && ('), 'each kind with its count');
  assert.ok(areas.includes('aria-label={`${c.total} in ${a.name}`}'), 'said plainly');
});

test('outlines indent without H-badges (F107)', () => {
  const panels = read('src/renderer/src/panels/NotePanels.tsx');
  assert.doesNotMatch(panels, /outline-level/, 'no level badges');
  assert.doesNotMatch(panels, />H\{h\.level\}</, 'no H-words');
  // t102 (9 Nov 2026) draws each heading through a memoised OutlineRow; the indent stays the level's only mark.
  assert.ok(panels.includes('paddingLeft: 10 + (level - min) * 14'), 'level by indent alone');
  assert.ok(panels.includes('level={h.level} min={min}'), 'the row indents by its heading level');
});

test('a booking past its day reads Past, never Done (F118)', () => {
  const trips = read('src/renderer/src/views/modules/w3b/Travel87.tsx');
  assert.ok(trips.includes('const booked = (b: Booking) => b.paid || !!b.booking;'), 'booked is paid or holding a reference');
  assert.ok(trips.includes('const pastDue = (b: Booking, today: string)'), 'past separated from booked');
  // Packs uplift item 7: holding a reference but unpaid reads To pay, between Past and To book; Past still wins
  // over both, and Done only when paid.
  assert.ok(trips.includes("tag={done ? 'Done' : past ? 'Past' : pay ? 'To pay' : 'To book'}"), 'checklist rows read Past');
  assert.ok(trips.includes("? 'Past' : 'Planned'"), 'day rows read Past');
  assert.doesNotMatch(trips, /b\.date !== null && b\.date < today\)/, 'no day-passed booking in booked()');
});

test('a broken locked link says so (F120)', () => {
  const link = read('src/renderer/src/components/SecretLink.tsx');
  assert.ok(link.includes("choose('This locked link looks broken', [],"), 'plain words through the shared chooser');
  assert.doesNotMatch(link, /if \(!ID\.test\(id\)\) return;/, 'never silent');
});

test('starter counts come from the list Start writes (F122)', () => {
  const picker = read('src/renderer/src/components/StarterPicker.tsx');
  assert.ok(picker.includes('starterFiles(id, folder || current.folder, todayIso()).length'), 'same function, same inputs');
  assert.ok(picker.includes("from '../state/starterTemplates'"), 'the one today');
  assert.doesNotMatch(picker, /2026-10-31/, 'no sample date');
  assert.doesNotMatch(picker, /\.files\('Here'/, 'no separate sample call');
  assert.ok(read('src/renderer/src/state/starterTemplates.ts').includes('export const todayIso'), 'today shared');
});

test('mention links go through the one write that speaks (F127)', () => {
  // t27-unused-panels: the side panel is gone, so its share of this pin moved to the note foot, the one writer left.
  const lib = read('src/renderer/src/lib/mentionLink.ts');
  assert.ok(lib.includes('export async function linkMentionLine'), 'one shared write');
  assert.ok(lib.includes('That line has changed since, so nothing was linked. Have another look.'), 'stale lines speak');
  const foot = read('src/renderer/src/components/NoteFoot.tsx');
  assert.ok(foot.includes('await linkMentionLine(source, line, path);'), 'the note foot shares it');
  assert.doesNotMatch(foot, /window\.nv\.index\.linkMention/, 'no second write');
});

test('retypes leave failures empty and say so (F131)', () => {
  const props = read('src/renderer/src/components/Properties.tsx');
  assert.ok(props.includes('export function retypeValue'), 'one shared retype');
  assert.ok(props.includes('had no ${kind === \'number\' ? \'number\' : \'date\'} in it, so it was left empty.'), 'said plainly');
  assert.ok(props.includes('run: () => apply((doc) => retypeValue(doc, key, value, k)),'), 'the panel retypes through it');
  assert.ok(read('src/renderer/src/components/NoteFields.tsx').includes('retypeValue(doc, key, value, k)'), 'inline fields retype through it');
  assert.doesNotMatch(props, /isoOf\(new Date\(\)\)/, 'no invented today');
  assert.doesNotMatch(props, /toISOString\(\)\.slice\(0, 16\)/, 'no invented now');
  assert.doesNotMatch(props, /Number\.isFinite\(n\) \? n : 0/, 'no invented zero');
});

test('no pictures means words, never an empty picker (F132)', () => {
  const top = read('src/renderer/src/components/NotePageTop.tsx');
  assert.ok(top.includes('No pictures in the vault yet. Once one is among your files, pick it here.'), 'said with the way in');
  assert.ok(top.includes("await pickFile('Which picture?', pictures, titleOf);"), 'the picker opens only with pictures');
  assert.doesNotMatch(top, /pictures\.length \? 'Which picture\?' :/, 'no empty-list placeholder');
});

test('export unlock rides a machine flag, never the sentence (F135)', () => {
  const preload = read('src/preload/index.ts');
  assert.ok(preload.includes('flagUnlockNeeded(invoke<PortableResult | null>'), 'the bridge flags it');
  assert.ok(preload.includes('e.message === PRIVATE_NEEDED'), 'by the shared constant, exactly');
  const port = read('src/renderer/src/components/PortableExport.tsx');
  assert.ok(port.includes('.needUnlock === true'), 'the window reads the flag');
  assert.ok(port.includes('{e.unlock && ('), 'the button follows the flag');
  assert.doesNotMatch(port, /unlock your private notes\/i/, 'no prose regex');
});

test('sensitivity fallbacks read the same level the chip shows (F140)', () => {
  const picker = read('src/renderer/src/components/LevelPicker.tsx');
  assert.ok(picker.includes('levelOf(privacyStore(), path, undefined, type, area)'), 'the fallback is the same reading');
  assert.ok(picker.includes('levelBelow(path, meta?.type, meta?.area)'), 'type and area count');
  assert.ok(picker.includes('As its type says'), 'type sources named');
  assert.ok(picker.includes('No level of its own'), 'no source, no folder claim');
  assert.ok(picker.includes("label: 'No level of its own', icon: 'folder'"), 'the menu promises honestly too');
  assert.doesNotMatch(picker, /As its folder says \(\$\{levelLabel\(below\.level\)\}\)/, 'no blanket folder promise');
});

test('no site comes down unasked (F142)', () => {
  const lib = read('src/renderer/src/lib/siteUnpublish.ts');
  assert.ok(lib.includes('export async function confirmFolderUnpublish'), 'one unpublish ask');
  assert.ok(lib.includes('Unpublish “${name}”?'), 'naming the site');
  assert.ok(lib.includes('its files moved to the bin. Your notes stay as they are.'), 'naming what happens');
  assert.ok(read('src/renderer/src/components/PublishedMark.tsx').includes('await confirmFolderUnpublish(id, name)'), 'the page head asks');
  assert.ok(read('src/renderer/src/components/PublishSettings.tsx').includes('await confirmFolderUnpublish('), 'settings asks');
});

test('email excerpts read as the page reads (F144)', () => {
  const share = read('src/renderer/src/state/share.ts');
  assert.ok(share.includes('firstRenderedPara('), 'from rendered blocks');
  assert.ok(share.includes('renderMarkdown(body, { from: path })'), 'through the real renderer');
  assert.ok(share.includes("querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, pre')"), 'the first block that reads');
  assert.doesNotMatch(share, /replace\(\/!\\\[\(/, 'no strip-markdown chain');
});

test('changelogs read off dated lines, never heading words (F148)', () => {
  const live = read('src/renderer/src/editor/live-preview.ts');
  assert.ok(live.includes('changesHead'), 'the section found structurally');
  assert.ok(live.includes('readChange(t)'), 'dated lines decide');
  assert.ok(live.includes('if (i === changesHead) {'), 'only that section styled');
  assert.doesNotMatch(live, /if \(DOC_CHANGES\.test\(text\)\) \{\n        part = 'changes'/, 'never words alone');
});

test('failed diagrams read plainly, detail to the console (F150)', () => {
  const wet = read('src/renderer/src/lib/hydrate.ts');
  assert.ok(wet.includes('export function drawErrorHtml'), 'one error words helper');
  assert.ok(wet.includes('wouldn’t draw. Check its lines and try again.'), 'plain words');
  assert.ok(wet.includes('console.warn(`Ironleaf could not draw'), 'detail to the console');
  assert.ok(read('src/renderer/src/editor/widgets.ts').includes("drawErrorHtml('diagram', error)"), 'live preview shares it');
  assert.ok(read('src/renderer/src/lib/charts.ts').includes("drawErrorHtml('chart', error)"), 'charts share it');
  assert.ok(wet.includes("drawErrorHtml('diagram', error)"), 'the reading view shares it');
});

test('the / menu previews what it inserts (F152)', () => {
  const slash = read('src/renderer/src/editor/slash.ts');
  assert.ok(slash.includes('export const MEETING_NOTES_TEXT'), 'one shape');
  assert.ok(slash.includes('preview: `${MEETING_NOTES_TEXT}First action`'), 'the preview from it');
  assert.ok(slash.includes('insertBlock(v, MEETING_NOTES_TEXT, MEETING_NOTES_TEXT.length);'), 'the insert from it');
  assert.ok(slash.includes('**Who came:**'), 'bold in both');
});
