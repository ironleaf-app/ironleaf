// node --test tests/uplift-92-pages.test.mjs — the 9.2 uplift's page-truth batch (F3, F8, F9, F19, F20, F21):
// a paid bill stays visible with Paid plus its next day; dictation speaks by kind, never word matching;
// both print paths lay out through one helper with an image timeout; one scoped ask box with a labelled
// Send; every-detail words for the kept older page; one remove verb per destination. Pure logic is checked
// as it is; the screens are guarded by the helper they call, so each check fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u92-pages-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  writeFileSync(
    path.join(work, 'entry.ts'),
    `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/views/modules/billRow.ts'))};\nexport * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/removeWords.ts'))};\n`,
  );
  await build({ input: path.join(work, 'entry.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a paid bill stays visible with Paid plus its next day (F3)', () => {
  const paid = { paid: '2026-10-28', days: 30, next: '2026-11-28', overdue: false, status: '' };
  assert.equal(P.justPaid(paid, '2026-11-01'), true, 'paid this week, due weeks out: just paid');
  assert.equal(P.justPaid({ ...paid, paid: '2026-10-01' }, '2026-11-01'), false, 'paid long ago: not just paid');
  assert.equal(P.justPaid({ ...paid, days: 3 }, '2026-11-01'), false, 'due again already: the due tag wins');
  const tag = P.billRowTag(paid, '2026-11-01');
  assert.equal(tag.tone, 'green');
  assert.ok(tag.words.startsWith('Paid · next '), `Paid plus its next day, got ${tag.words}`);
  assert.equal(P.billRowTag({ ...paid, overdue: true, days: -2 }, '2026-11-01').words, '2 days late', 'late still reads late');
  for (const [f, extra] of [['src/renderer/src/views/HomeView.tsx', 'home'], ['src/renderer/src/views/modules/RecordModulesToday.tsx', 'today']]) {
    const src = read(f);
    assert.ok(src.includes('justPaid(b, f.today)'), `${extra} keeps just-paid rows`);
    assert.ok(src.includes('billRowTag(b, f.today).words'), `${extra} reads the one tag`);
    assert.ok(!src.includes('Overdue since'), `${extra} never shapes its own overdue-since (5 Nov 2026 polish list item 7)`);
    assert.ok(src.includes('!justPaid(b, f.today)'), `${extra} never pays twice`);
  }
  // 9.5 fvault F1: one shared rule decides the tick on every surface; it still hides it once paid.
  assert.ok(read('src/renderer/src/views/modules/RecordModulePage.tsx').includes('payableByHand(b, today)') && /export function payableByHand[\s\S]{0,200}!justPaid\(b, today\)/.test(read('src/renderer/src/views/modules/billRow.ts')), 'money hides the tick once paid');
});

test('dictation speaks by kind, never by matching words (F8)', () => {
  const lib = read('src/renderer/src/lib/dictation.ts');
  assert.ok(lib.includes('export interface DictateEvent'), 'events carry a kind');
  assert.ok(lib.includes('onEvent?: (e: DictateEvent) => void'), 'callers can hear the kind');
  assert.ok(lib.includes("say('phase', 'Listening…')"), 'phases tagged phase');
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes("e.kind !== 'phase'"), 'the toast gate is the kind');
  assert.doesNotMatch(commands, /Listening\|Hearing/, 'no status-word regex on user words');
});

test('every note PDF prints the one branded document, pictures never hanging it (F9)', () => {
  // 5 Nov 2026, brand documents: notes print as one branded HTML document (src/shared/brand-document.ts) in a window
  // nobody sees (src/main/brand-print.ts) — Export to PDF, Save as PDF and Email it all build it through
  // brandHtmlAndKit, the one builder with the kit it printed in (several kits; brandHtmlFor keeps its call shape
  // beside it) — so the visible-window layout is out of the notes' path. The document's own script still waits at
  // most 8 seconds a picture, so one unreachable picture can never hang a print.
  const doc = read('src/shared/brand-document.ts');
  assert.ok(doc.includes('setTimeout(r,8000)'), 'each picture waits at most 8 seconds');
  const commands = read('src/renderer/src/state/commands.ts');
  const share = read('src/renderer/src/state/share.ts');
  assert.ok(share.includes('export async function brandHtmlAndKit'), 'one document builder for every note PDF');
  assert.ok(share.includes('export async function brandHtmlFor'), 'its plain-HTML call shape kept beside it');
  assert.ok(commands.includes('brandHtmlAndKit('), 'export to PDF builds the one document');
  assert.ok(commands.includes('window.nv.exports.brandPdf('), 'export prints through the hidden window');
  assert.ok(share.includes('window.nv.exports.brandPdf('), 'save prints through the hidden window');
  assert.ok(share.includes('window.nv.exports.shareEmail('), 'email sends the same document');
  assert.ok(read('src/main/brand-print.ts').includes('window.__report'), 'the hidden window waits for the layout');
  assert.doesNotMatch(commands, /layOutForPrint/, 'no visible-window layout on export any more');
  assert.doesNotMatch(share, /layOutForPrint/, 'no visible-window layout on share any more');
  assert.doesNotMatch(commands, /querySelectorAll\('img'\)/, 'no second image wait');
});

test('one scoped ask box with a labelled Send (F19)', () => {
  const box = read('src/renderer/src/components/ScopedAsk.tsx');
  assert.ok(box.includes('SCOPED_ASK_HINT'), 'one plain hint');
  assert.ok(box.includes('>Send<') || box.includes('>\n        Send\n'), 'a labelled Send');
  assert.ok(!box.includes('data-no-askbar'), 'no bar to keep away: the panel is the one ask place');
  for (const f of ['src/renderer/src/views/modules/pack87.tsx', 'src/renderer/src/views/modules/w3b/W3b.tsx']) {
    const src = read(f);
    assert.ok(src.includes('<ScopedAsk'), `${f} renders the one box`);
    assert.doesNotMatch(src, /⌁/, `${f} keeps no glyph chrome`);
  }
  assert.doesNotMatch(read('src/renderer/src/views/modules/pack87.tsx'), />\s*↑\s*</, 'no arrow send');
});

test('the kept older page reads as every detail, never version jargon (F20)', () => {
  const w3b = read('src/renderer/src/views/modules/w3b/W3b.tsx');
  assert.ok(w3b.includes("FULL_DETAILS_LABEL = 'Show every detail'"), 'one name for opening it');
  assert.ok(w3b.includes("EDIT_DETAILS_LABEL = 'Edit every detail'"), 'one name for editing in it');
  assert.doesNotMatch(w3b, /previous layout',/, 'no version-jargon labels');
});

test('one remove verb per destination (F21)', () => {
  assert.equal(P.deleteToBin('the trip'), 'Delete the trip to the Bin');
  assert.equal(P.takeOffAria('the filling'), 'Take the filling off');
  assert.equal(P.takeOffSaid('the filling'), 'Took the filling off.');
  assert.equal(P.takeOutAria('Marketing', 'this week'), 'Take Marketing out of this week');
  const meetings = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(meetings.includes("deleteToBin('the meeting')"), 'meetings delete through the helper');
  assert.doesNotMatch(meetings, /Recycle Bin/, 'one Bin name in its menus');
  assert.ok(read('src/renderer/src/views/modules/w3b/Travel87.tsx').includes('{TAKE_OFF_BUTTON}'), 'itinerary rows come off');
  assert.ok(read('src/renderer/src/views/modules/work/VendorsPage.tsx').includes('takeOffSaid(it.item)'), 'quote items come off, said so');
});
