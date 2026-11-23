// node --test tests/t278-break.test.mjs — break-it on tonight's Vault (t278, 13 Nov 2026, 10.2.8).
// What a real person would trip over in t271/t272/t273/t275/t276, on a 3456x1408 window with a
// rich vault, each fixed at its mechanism:
// - Notes: with a packs folder open, switching Show everything off stranded the page — the rail
//   lost the folder while the filter stayed, so chips/head/rows read 0 with "Nothing matches" and
//   no drawn filter to clear (keeping a folder out of view, or its last note moving away, strands
//   the same way). The page falls back to All notes, keeping the kind.
// - Notes: a 2,000-letter single-line preview drew all 2,000 letters (a ~400px wall of one row at
//   1219 — markdown paragraphs are often one long line). Previews wrap whole to three lines at most,
//   never dots, the full words on hover.
// - Boards: the shared column fold button never said folded or not (no aria-expanded).
// The rest of the break list was walked and holds: 300-note folders count and window; 3-deep folders
// read through their second level; a 200-card column expands whole with nothing cut and the page
// scrolling; 20 columns keep 260px and scroll with the fade; fold keeps counts; the Find narrows the
// board and clears; keyboard Enter opens a card; 0/1/2/5/many word checks align at all three sizes,
// pairing at 3456; long heard lines arrive as short contexts; Fix rotates the queue; Skip shows again;
// a meeting with no recording aligns its "No recording" rows; 8 voices hug their "Same person as…";
// no console errors anywhere. Made-up data only. T278_TAG=before reverts the lens for before shots.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { clickWords, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';
import { cssPxFor } from './css-px.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => cssPxFor(p, readFileSync(path.join(root, p), 'utf8'));
const shotsDir = path.join(root, '..', 'shots');
mkdirSync(shotsDir, { recursive: true });
const TAG = process.env.T278_TAG || 'after';

const AREAS = ['Work', 'Me', 'Business', 'Home'];
const AREAS_JSON = JSON.stringify({ version: 1, home: 'work', areas: AREAS.map((n) => ({ id: n.toLowerCase(), name: n, folder: n, icon: 'layers', color: 'teal', about: '' })) });
const BILL = (name, amount) => `---\ntype: bill\nkind: Bill\namount: ${amount}\ncycle: Monthly\ndue: 2026-11-20\ncategory: Phone and internet\naccount:\nproject:\nautopay: No\nstatus: Active\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n| | ${amount} | Added by an assistant |\n`;
const LONG2000 = ('Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ').repeat(18).slice(0, 2000);
const NOSPACE = 'x'.repeat(2000);

// ── Static: the three mechanisms ──────────────────────────────────────────

test('a folder with no rows in this reading falls back to All notes', () => {
  const src = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(/if \(folder && rows\.length > 0 && inFolder\.length === 0\) setFolder\(''\)/.test(src), 'a stranded folder filter falls back, keeping the kind; an empty vault never resets a link');
});

test('a preview wraps whole to three lines at most, never dots', () => {
  const css = read('src/renderer/src/styles/w2b.css');
  const at = css.indexOf('.w2b-row-line2 .clip {');
  assert.ok(at >= 0, 'the preview rule exists');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.ok(rule.includes('white-space: normal'), 'the preview wraps instead of cutting mid-word');
  assert.ok(/max-height:\s*54px/.test(rule), 'three 18px lines at most, cut at the boundary');
  assert.ok(!/line-clamp|webkit-box/.test(rule), 'never a clamp form (dots, or nothing, here)');
  assert.ok(!rule.includes('ellipsis'), 'never dots where it stops');
  assert.ok(/\.clip" title=\{snip\}|title=\{snip\}/.test(read('src/renderer/src/views/NotesPage.tsx')), 'the full words stay on hover');
});

test('a board column fold says folded or not', () => {
  const tsx = read('src/renderer/src/views/workspace/RecordLayouts.tsx');
  assert.ok(tsx.includes('className="ws-col-fold" aria-expanded={!folded}'), 'the shared fold carries its state, as group folds do');
  assert.ok(!/:has\(/.test(read('src/renderer/src/styles/w2b.css')), 'no :has() in the touched styles');
});

// ── Live: one harness, three vaults in turn ───────────────────────────────

let H = null;
const ev = (js) => H.browser.ev(js);
async function boot() {
  await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
  assert.ok(await waitFor(H, `!!document.querySelector('.app')`, 60000), 'the app boots');
  await sleep(2200);
}
async function setSize(w, h) {
  await H.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
}
async function shot(file, clip) {
  // Premium pictures (PNG, deviceScaleFactor 2); the CSS pixels never change, only the capture.
  const m = await H.browser.ev(`({ w: window.innerWidth, h: window.innerHeight })`);
  await H.browser.send('Emulation.setDeviceMetricsOverride', { width: m.w, height: m.h, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  const d = await H.browser.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  await H.browser.send('Emulation.setDeviceMetricsOverride', { width: m.w, height: m.h, deviceScaleFactor: 1, mobile: false });
  const data = d.result?.data ?? d.data;
  assert.ok(data, `pixels for ${file}`);
  writeFileSync(path.join(shotsDir, file), Buffer.from(data, 'base64'));
}
const clearVault = () => {
  for (const e of readdirSync(H.vaultDir)) rmSync(path.join(H.vaultDir, e), { recursive: true, force: true });
};
const writeVault = (files) => {
  for (const [rel, text] of files) {
    const p = path.join(H.vaultDir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
};
const errors = () => ev(`window.__nvErrors.length`);
const lastErrors = () => ev(`JSON.stringify(window.__nvErrors.slice(-2))`);

before(async () => {
  H = await startHarness({});
  await H.services.invoke('settings:update', [{ prefs: { modules: { finance: { on: true }, systems: { on: true }, meetings: { on: true } } } }]);
}, { timeout: 600000 });
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

// ── Notes ─────────────────────────────────────────────────────────────────

function seedNotes() {
  clearVault();
  const files = [['.neuralvault/areas.json', `${AREAS_JSON}\n`]];
  for (let i = 0; i < 300; i++) files.push([`Work/Big/Note ${String(i).padStart(3, '0')}.md`, `# Note ${i}\n\nOrdinary words for note ${i}, kept short.\n`]);
  files.push(
    ['Work/Solo/Only.md', '# Only\n\nThe one note.\n'],
    ['Work/Deep/L2/L3/Buried.md', '# Buried\n\nThree deep.\n'],
    ['Work/Deep/Top.md', '# Top\n\nAt the top.\n'],
    ['Work/Quiet/Alpha.md', '# Alpha\n\nFirst.\n'],
    ['Work/Quiet/Beta.md', '# Beta\n\nSecond.\n'],
    ['Home/Systems and Home Lab/Machines/Media box.md', '---\ntype: machine\nkind: Server\nrole: Media\nos: Linux\nstatus: ok\n---\n# Media box\n\nServes films.\n'],
    ['Me/Longform.md', `---\ntype: note\n---\n# Longform\n\n${LONG2000}\n`],
    ['Me/Nospace.md', `---\ntype: note\n---\n# Nospace\n\n${NOSPACE}\n`],
    ['Me/Finance/Budget.md', '---\ntype: note\n---\n# Budget\n\nShort words.\n'],
    ['Me/Finance/Bills/Harbour Internet.md', BILL('Harbour Internet', '89.00')],
    ['Docs/Server.md', '---\ntype: doc\n---\n# Server\n\nHow the server runs.\n'],
    ['Daily/2026-11-13.md', '# 2026-11-13\n\nToday\u2019s words.\n'],
  );
  writeVault(files);
}

const railRows = () => ev(`[...document.querySelectorAll('.w2b-folders [data-fgroup] button.frow')].map((e) => ({ t: e.getAttribute('title'), n: e.querySelector('.n') ? Number(e.querySelector('.n').innerText) : 0 }))`);
const chips = () => ev(`[...document.querySelectorAll('main .chips .chip')].map((e) => ({ label: (e.innerText||'').replace(/\\s+/g,' ').trim(), n: e.querySelector('.n') ? Number(e.querySelector('.n').innerText) : 0 }))`);
const noteRows = () => ev(`document.querySelectorAll('main .w2b-row').length`);
const noteHead = () => ev(`document.querySelector('main .nv-page-count')?.innerText ?? 'NONE'`);
const showAllOn = () => ev(`[...document.querySelectorAll('.w2b-folders .frow')].find((e) => (e.innerText||'').includes('Show everything'))?.getAttribute('aria-pressed') === 'true'`);
async function setShowAll(on) {
  if ((await showAllOn()) === on) return;
  assert.equal(await clickWords(H, 'Show everything', '.w2b-folders'), 'CLICKED', 'Show everything answers');
  await sleep(1200);
  assert.equal(await showAllOn(), on, `Show everything is ${on ? 'on' : 'off'}`);
}
async function pickFolder(prefix) {
  const at = await ev(`(() => { const el = [...document.querySelectorAll('.w2b-folders button.frow')].find((e) => (e.getAttribute('title') || '') === ${JSON.stringify(prefix)}); if (!el) return 'NOTFOUND'; el.scrollIntoView({ block: 'nearest' }); el.click(); return 'CLICKED'; })()`);
  assert.equal(at, 'CLICKED', `${prefix || 'All notes'} is a drawn row to click`);
  await sleep(900);
}

/** The folder's number, the All chip, the head and the drawn rows agree (t271's invariant). */
async function assertAgrees(where) {
  const all = (await chips()).find((c) => c.label.startsWith('All'));
  const n = await noteRows();
  const h = await noteHead();
  assert.equal(all.n, Number(h), `${where}: the head ${h} tracks All at ${all.n}`);
  // The drawn window shows 80 at a time; the agreement is with the rows on show.
  const total = await ev(`(() => { const m = /\\((\\d+) left\\)/.exec(document.querySelector('main .w2b-more .btn')?.innerText || ''); const drawn = document.querySelectorAll('main .w2b-row').length; return m ? drawn + Number(m[1]) : drawn; })()`);
  assert.equal(total, all.n, `${where}: ${total} rows on show under All ${all.n}`);
}

test('Notes: switching Show everything off with a hidden folder open falls back to All notes', { timeout: 300000 }, async () => {
  seedNotes();
  await H.services.rescanAll();
  await boot();
  await setSize(1920, 1117);
  await openRoom(H, 'Notes');
  assert.ok(await waitFor(H, `!!document.querySelector('.w2b-folders')`, 15000), 'the Notes rail draws');
  await sleep(800);
  await setShowAll(true);
  await pickFolder('Me/Finance');
  assert.equal((await chips()).find((c) => c.label.startsWith('All')).n, 2, 'Finance counts its note and its bill');
  await setShowAll(false);
  // The fallback: All notes on show, every number agreeing — never a stranded "Nothing matches".
  const rail = await railRows();
  assert.ok(!rail.some((r) => r.t === 'Me/Finance'), 'off, Finance stands out of view');
  assert.ok(await waitFor(H, `[...document.querySelectorAll('.w2b-folders button.frow')].some((e) => !e.getAttribute('title') && (e.innerText||'').includes('All notes') && e.classList.contains('on'))`, 8000), 'the rail falls back to All notes');
  await sleep(500);
  await assertAgrees('after the fallback');
  assert.ok(!(await ev(`(document.querySelector('main .w2b-list')?.innerText || '').includes('Nothing matches')`)), 'no stranded empty state');
  // On again: the packs folder returns with its records, and the numbers agree there too.
  await setShowAll(true);
  await pickFolder('Me/Finance');
  await assertAgrees('Finance, back on');
  assert.equal(await errors(), 0, `no console errors (stood ${await lastErrors()})`);
});

test('Notes: a 300-note folder, a deep folder and a Find to nothing keep their folder', { timeout: 300000 }, async () => {
  await setShowAll(true);
  await pickFolder('Work/Big');
  const big = (await railRows()).find((r) => r.t === 'Work/Big');
  assert.equal(big?.n, 300, `Big counts 300 (stood ${big?.n})`);
  await assertAgrees('Big');
  // A Find narrowing to nothing keeps the folder: clearing brings the rows back.
  await ev(`document.querySelector('main input[placeholder="Find in this list"]')?.focus()`);
  for (const ch of 'zzz-no-such-note') {
    await H.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch });
    await H.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch });
  }
  await sleep(900);
  assert.equal(await noteRows(), 0, 'nothing matches the words');
  await ev(`(() => { const i = document.querySelector('main input[placeholder="Find in this list"]'); i.select(); document.execCommand('delete'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'x'; })()`);
  await sleep(900);
  assert.ok((await noteRows()) > 0, 'clearing the Find brings Big back, the folder kept');
  const still = await ev(`[...document.querySelectorAll('.w2b-folders button.frow')].find((e) => (e.getAttribute('title') || '') === 'Work/Big')?.classList.contains('on')`);
  assert.equal(still, true, 'Big stays the folder on show');
  // Three deep reads through its second level, numbers agreeing: Top plus the note buried
  // at Work/Deep/L2/L3, the rail's two levels covering what a person clicks.
  await pickFolder('Work/Deep');
  const deep = (await railRows()).find((r) => r.t === 'Work/Deep');
  assert.equal(deep?.n, 2, `Deep counts Top and its buried note (stood ${deep?.n})`);
  await assertAgrees('Deep');
  const titles = await ev(`[...document.querySelectorAll('main .w2b-row .t')].map((e) => e.innerText.trim()).join(',')`);
  assert.ok(titles.includes('Buried'), `the buried note lists under Deep (${titles})`);
  assert.equal(await errors(), 0, `no console errors (stood ${await lastErrors()})`);
});

test('Notes: a 2,000-letter preview stops at three whole lines, the words on hover', { timeout: 300000 }, async () => {
  await setShowAll(true);
  await pickFolder('Me');
  for (const [w, h] of [[1219, 709], [3456, 1408]]) {
    await setSize(w, h);
    const info = await ev(`(() => {
      const out = [];
      for (const r of document.querySelectorAll('main .w2b-rowwrap')) {
        const t = r.querySelector('.w2b-row .t')?.innerText.trim();
        if (t !== 'Longform' && t !== 'Nospace') continue;
        const clip = r.querySelector('.w2b-row-line2 .clip');
        const cr = clip.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(clip).lineHeight) || 18;
        out.push({ t, lines: cr.height / lh, title: (clip.getAttribute('title') || '').length, x: clip.scrollWidth > clip.clientWidth + 1 });
      }
      const sc = document.querySelector('.nv-page-scroll');
      return { rows: out, pageX: sc.scrollWidth > sc.clientWidth + 2 };
    })()`);
    assert.equal(info.rows.length, 2, `both long rows draw at ${w}`);
    for (const r of info.rows) {
      assert.ok(r.lines <= 3.2, `${r.t} stops at three lines at ${w} (stood ${r.lines.toFixed(1)})`);
      assert.ok(Math.abs(r.lines - Math.round(r.lines)) <= 0.05, `${r.t} stops at a line boundary, never mid-glyph (${r.lines.toFixed(2)})`);
      assert.ok(r.title >= 1900, `${r.t} keeps its full words on hover (${r.title})`);
      assert.equal(r.x, false, `${r.t} never scrolls sideways at ${w}`);
    }
    assert.equal(info.pageX, false, `the page never scrolls sideways at ${w}`);
    await shot(`t278-${TAG}-notes-long-${w}.png`);
  }
  // An ordinary preview still wraps whole, mid-word cuts nowhere.
  const cut = await ev(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('main .w2b-row .w2b-row-line2 .clip')) {
      if (getComputedStyle(el).whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth + 1) out.push(el.innerText.slice(-30));
    }
    return out;
  })()`);
  assert.deepEqual(cut, [], `no preview cuts mid-word (${cut.join(' / ')})`);
  assert.equal(await errors(), 0, `no console errors (stood ${await lastErrors()})`);
});

test('Notes: keeping the open folder out of view reads quiet, then falls back with the switch off', { timeout: 300000 }, async () => {
  await setSize(1920, 1117);
  await setShowAll(true);
  await pickFolder('Work/Quiet');
  assert.equal((await chips()).find((c) => c.label.startsWith('All')).n, 2, 'Quiet counts its two notes');
  // The folder's own menu, as a person keeps it out of view.
  const menu = await ev(`(() => {
    const wrap = [...document.querySelectorAll('.w2b-folders .frow-wrap')].find((e) => (e.querySelector('button.frow')?.getAttribute('title') || '') === 'Work/Quiet');
    const more = wrap?.querySelector('.frow-more');
    if (!more) return 'NOMORE';
    more.click();
    return 'CLICKED';
  })()`);
  assert.equal(menu, 'CLICKED', 'Quiet offers its menu');
  await sleep(700);
  const kept = await ev(`(() => {
    const items = [...document.querySelectorAll('.menu [role="menuitem"], [role="menu"] button, .menu button')];
    const it = items.find((e) => /keep out of view/i.test(e.innerText || ''));
    if (!it) return 'NOITEM:' + items.map((e) => (e.innerText || '').trim()).join('|');
    it.click();
    return 'CLICKED';
  })()`);
  assert.equal(kept, 'CLICKED', `Keep out of view answers (${kept})`);
  await sleep(1500);
  // Shown under Show everything, reading quiet — the folder stays open with its rows.
  assert.equal(await noteRows(), 2, 'Quiet stays open with its two notes while everything shows');
  const quietMark = await ev(`(() => { const el = [...document.querySelectorAll('.w2b-folders button.frow')].find((e) => (e.getAttribute('title') || '').startsWith('Work/Quiet')); return el ? { quiet: el.classList.contains('is-quiet'), title: el.getAttribute('title') } : null; })()`);
  assert.equal(quietMark?.quiet, true, 'the rail reads Quiet quietly');
  assert.ok((quietMark?.title ?? '').includes('kept out of view'), `the rail says Quiet is kept out of view (${quietMark?.title})`);
  // Switch off: Quiet leaves the reading, and the page falls back instead of stranding.
  await setShowAll(false);
  assert.ok(await waitFor(H, `[...document.querySelectorAll('.w2b-folders button.frow')].some((e) => !e.getAttribute('title') && (e.innerText||'').includes('All notes') && e.classList.contains('on'))`, 8000), 'the rail falls back to All notes');
  await sleep(500);
  await assertAgrees('after keeping Quiet out of view');
  assert.equal(await errors(), 0, `no console errors (stood ${await lastErrors()})`);
});

// ── Boards ────────────────────────────────────────────────────────────────

const OWNERS = ['Alex Chen', 'Priya Nair', 'Sam Ortega', 'Jess Wu'];
function seedBoards() {
  clearVault();
  const names = ['Harbourline Cart Fix', 'Museum Late Shift'];
  const files = [];
  names.forEach((name, pi) => {
    files.push([`Projects/${name}/${name}.md`, `---\ntype: project\nstatus: active\nhealth: on track\nowner: ${OWNERS[pi]}\ndue: 2026-12-20\n---\n# ${name}\n\n## Summary\n\nMade-up project for the break walk.\n`]);
    const lines = [];
    for (let i = 0; i < 200; i++) {
      lines.push(`- [ ] Job ${String(i).padStart(3, '0')} for the ${name.split(' ')[0].toLowerCase()} crew ref ${pi}-${i} — ${OWNERS[(pi + i) % 4]} — due 2026-12-${10 + (i % 18)}`);
    }
    files.push([`Meetings/2026-11-0${3 + pi} ${name} standup.md`, `---\ntype: meeting\ndate: 2026-11-0${3 + pi}\nattendees: [${OWNERS[pi]}, ${OWNERS[(pi + 1) % 4]}]\nproject: Projects/${name}/${name}.md\n---\n# 2026-11-0${3 + pi} ${name} standup\n\n## Agenda\n\n- The week ahead\n\n## Actions\n\n${lines.join('\n')}\n`]);
  });
  writeVault(files);
}
async function openBoard() {
  await H.services.rescanAll();
  await boot();
  assert.equal(await clickWords(H, 'Meetings', 'aside'), 'CLICKED', 'Meetings opens');
  await sleep(1000);
  assert.equal(await clickWords(H, 'Every action', 'main'), 'CLICKED', 'Every action opens');
  assert.ok(await waitFor(H, `!!document.querySelector('.ws-board')`, 10000), 'the board draws');
  await sleep(600);
}
const boardCols = () => ev(`[...document.querySelectorAll('.ws-board > section.ws-col')].map((c) => ({ label: c.getAttribute('title') || c.getAttribute('aria-label'), w: Math.round(c.getBoundingClientRect().width), cards: c.querySelectorAll('.ws-card').length, more: (c.querySelector('.ws-more')?.innerText ?? '').replace(/\\s+/g,' ').trim(), folded: c.classList.contains('is-folded'), expanded: c.querySelector('.ws-col-fold')?.getAttribute('aria-expanded'), count: c.querySelector('.ws-group-count')?.innerText }))`);

// ── Minutes ───────────────────────────────────────────────────────────────

const isoDay = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const stamp2 = (at) => `${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}`;
const PAIRS = [
  ['Allistair', 'Alistair'], ['Bennelong', 'Benalong'], ['Callide', 'Callyde'], ['Daintree', 'Daintrey'],
  ['Eumundi', 'Eumundy'], ['Farraday', 'Faraday'], ['Gundagai', 'Gundagye'], ['Hinchinbrook', 'Hinchinbrooke'],
  ['Illawarra', 'Illawara'], ['Jindabyne', 'Jindubyne'], ['Kestoon', 'Keston'], ['Lismore', 'Lissmore'],
];
const TAILS = ['will send the revised roster before Friday lunch.', 'already sent the survey sheet to the crew.', 'quoted the fitting work for the foyer site.', 'keeps the old quote open until term ends.', 'served the late shift during cover.', 'helped the early crew with the count.'];
const STOPW = ['Morning', 'Thanks', 'Right', 'Sure', 'Well', 'Okay'];
function silentWav() {
  const n = 2 * 8000;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + n * 2, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(8000, 24);
  head.writeUInt32LE(16000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36);
  head.writeUInt32LE(n * 2, 40);
  return Buffer.concat([head, Buffer.alloc(n * 2)]);
}
function minutesSeed() {
  clearVault();
  const pairLines = (pairs, speakers) => pairs.flatMap(([a, b], i) => [
    `${STOPW[(2 * i) % 6]} all, ${a} ${TAILS[(2 * i) % 6]}`,
    `${STOPW[(2 * i + 1) % 6]}, ${b} ${TAILS[(2 * i + 1) % 6]}`,
  ]).map((text, i) => `> **${stamp2(5 + i * 9)}** *Speaker ${(i % speakers) + 1}:* ${text}`);
  const note = (date, lines, recording) => [
    '---', 'type: meeting', `date: ${date}`, 'time: 10:00 AM', 'where: Harbour Stores', '---',
    '## Agenda', '', '- [x] Harbour stall and the oven install', '',
    '## Summary', '', 'Mia Tran and Jordan Lee met for a one-to-one covering the harbour stall. They agreed the foyer fitting work stays open until the end of term.',
    '', '## Decisions', '', '- Keep the foyer fitting quote open.', '',
    '## Actions', '', '- [x] Send the revised roster', '- [ ] Chase the foyer quote', '',
    '## Discussion', '', '> [!quote]- Oven install', '> The foyer fitting work stays open.', '',
    '## Transcript', '',
    ...(recording ? [`Recording: [[${recording}]] · 20 minutes`, ''] : []),
    '> [!quote]- Transcript · 20 minutes',
    ...lines.flatMap((l) => [l, '>']).slice(0, -1),
    '',
  ].join('\n');
  const files = [
    [`Meetings/${isoDay(1)} Many checks review.md`, note(isoDay(1), pairLines(PAIRS, 5), 'Files/t278-many/recording.wav')],
    [`Meetings/${isoDay(2)} No recording review.md`, note(isoDay(2), pairLines(PAIRS.slice(0, 2), 2), null)],
  ];
  writeVault(files);
  const p = path.join(H.vaultDir, 'Files', 't278-many', 'recording.wav');
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, silentWav());
}
async function openMeeting(title) {
  // Back only when a meeting is open (Back from the room leaves the room).
  if (await ev(`!!document.querySelector('.w2b-meeting')`)) {
    await ev(`[...document.querySelectorAll('button')].find((e) => e.getAttribute('aria-label') === 'Back')?.click()`);
    await sleep(800);
  }
  assert.ok(await waitFor(H, `!!document.querySelector('.w2b-meetings')`, 15000), 'the Meetings room draws');
  assert.equal(await clickWords(H, 'Past'), 'CLICKED', 'Past answers');
  await sleep(600);
  assert.equal(await clickWords(H, title), 'CLICKED', `${title} answers`);
  assert.ok(await waitFor(H, `!!document.querySelector('.w2b-meeting')`, 15000), 'the meeting draws');
  await sleep(1200);
}
const MEASURE = `(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
  return {
    line: (document.querySelector('.w2b-meeting .mm-check .mm-words')?.innerText || 'NONE').replace(/\\s+/g, ' ').trim().slice(0, 60),
    rows: [...document.querySelectorAll('.w2b-meeting .mm-row')].map((row) => {
      const q = row.querySelector('.mm-quote');
      const play = row.querySelector('.mm-context button');
      const norec = row.querySelector('.mm-context .mm-faint');
      const input = row.querySelector('.mm-fix input');
      const fix = row.querySelector('.mm-fix button');
      return {
        quote: q ? rect(q) : null, play: play ? rect(play) : null, norec: norec ? norec.innerText.trim() : null,
        input: input ? rect(input) : null, fix: fix ? rect(fix) : null,
        hClip: row.scrollWidth > row.clientWidth + 1,
      };
    }),
    spks: [...document.querySelectorAll('.w2b-meeting .spk-row')].map((row) => {
      const name = row.querySelector('.spk-name');
      const join = row.querySelector('.spk-join');
      return { name: name ? rect(name) : null, join: join ? { ...rect(join), words: join.innerText.trim() } : null };
    }),
    spkTitle: (document.querySelector('.w2b-meeting .spk-title')?.innerText || 'NOSPK').replace(/\\s+/g, ' ').trim(),
    docX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
})()`;

test('Minutes: many checks align, pair at 3456, and a meeting with no recording', { timeout: 400000 }, async () => {
  minutesSeed();
  await H.services.rescanAll();
  await boot();
  assert.equal(await clickWords(H, 'Meetings', 'aside'), 'CLICKED', 'Meetings opens');
  await sleep(1000);
  await openMeeting('Many checks review');
  assert.ok(await waitFor(H, `document.querySelectorAll('.w2b-meeting .mm-row').length === 5`, 30000), 'five checks show of the twelve raised');
  for (const [w, h] of [[1920, 1117], [3456, 1408], [1219, 709]]) {
    await setSize(w, h);
    const m = await ev(MEASURE);
    assert.equal(m.rows.length, 5, `five checks at ${w}`);
    assert.ok(m.line.startsWith('5 words to check'), `the count reads five at ${w} (${m.line})`);
    for (const [i, r] of m.rows.entries()) {
      assert.ok(r.play, `row ${i} keeps its Play at ${w}`);
      assert.ok(r.play.l - r.quote.r <= 32, `Play sits beside its heard line at ${w} (gap ${r.play.l - r.quote.r})`);
      assert.ok(r.input.w <= 360, `the box stays word-sized at ${w} (${r.input.w})`);
      assert.equal(r.hClip, false, `row ${i} never clips sideways at ${w}`);
    }
    const eq1 = (xs, what) => assert.ok(Math.max(...xs) - Math.min(...xs) <= 1, `${what} at ${w} (lefts ${xs.join(', ')})`);
    if (w === 3456) {
      eq1([m.rows[0].input.l, m.rows[2].input.l, m.rows[4].input.l], 'the left half lines its boxes up');
      eq1([m.rows[1].input.l, m.rows[3].input.l], 'the right half lines its boxes up');
    } else {
      eq1(m.rows.map((r) => r.input.l), 'every box starts together');
      eq1(m.rows.map((r) => r.fix.l), 'every Fix starts together');
    }
    assert.ok(m.spks.length >= 5, `five voices show at ${w} (${m.spkTitle})`);
    for (const [i, s] of m.spks.entries()) {
      assert.equal(s.join?.words, 'Same person as…', `voice ${i} names its choice plainly at ${w}`);
      assert.ok(s.join.l - s.name.r <= 24, `the choice hugs its name at ${w} (gap ${s.join.l - s.name.r})`);
    }
    assert.equal(m.docX, false, `the page never scrolls sideways at ${w}`);
    if (w === 3456) await shot(`t278-${TAG}-minutes-many-3456.png`);
  }
  // Fixing rotates the queue; Skip for now shows again.
  const beforeWords = await ev(`[...document.querySelectorAll('.w2b-meeting .mm-row .mm-word strong')].map((e) => e.innerText).join(',')`);
  await ev(`(() => { const row = document.querySelector('.w2b-meeting .mm-row'); const input = row.querySelector('.mm-fix input'); input.focus(); input.select(); document.execCommand('insertText', false, 'Zillmere'); return 'x'; })()`);
  await sleep(400);
  await ev(`document.querySelector('.w2b-meeting .mm-row .mm-fix button')?.click()`);
  await sleep(1500);
  const afterWords = await ev(`[...document.querySelectorAll('.w2b-meeting .mm-row .mm-word strong')].map((e) => e.innerText).join(',')`);
  assert.notEqual(afterWords, beforeWords, `the queue rotates after a fix (${beforeWords} to ${afterWords})`);
  assert.equal((await ev(MEASURE)).rows.length, 5, 'five checks still show');
  await ev(`[...document.querySelectorAll('.w2b-meeting .mm-check button')].find((e) => (e.innerText||'').includes('Skip for now'))?.click()`);
  await sleep(800);
  assert.ok((await ev(`(document.querySelector('.w2b-meeting .mm-done')?.innerText || '')`)).includes('Words skipped'), 'Skip for now skips every check');
  await ev(`[...document.querySelectorAll('.w2b-meeting button')].find((e) => (e.innerText||'').includes('Show again'))?.click()`);
  await sleep(800);
  assert.equal((await ev(MEASURE)).rows.length, 5, 'Show again brings the checks back');
  // A meeting with no recording: "No recording" where Play would sit, aligned.
  await openMeeting('No recording review');
  assert.ok(await waitFor(H, `document.querySelectorAll('.w2b-meeting .mm-row').length === 2`, 30000), 'two checks show');
  await setSize(1920, 1117);
  const m = await ev(MEASURE);
  for (const [i, r] of m.rows.entries()) {
    assert.equal(r.play, null, `row ${i} offers no Play with no recording`);
    assert.equal(r.norec, 'No recording', `row ${i} says so where Play would sit`);
  }
  assert.equal(m.rows[0].input.l, m.rows[1].input.l, 'both boxes start together');
  assert.equal(await errors(), 0, `no console errors (stood ${await lastErrors()})`);
});

// Boards runs last: the Meetings room remembers its chip, and the Every action chip hides Past.
test('Boards: a 200-card column opens whole, folds saying so, the Find narrows it', { timeout: 300000 }, async () => {
  seedBoards();
  await openBoard();
  await setSize(1920, 1117);
  let cols = await boardCols();
  assert.equal(cols.length, 2, 'two project columns draw');
  assert.equal(cols[0].count, '200', `the head counts 200 (stood ${cols[0].count})`);
  assert.equal(cols[0].cards, 40, 'forty cards draw first');
  assert.equal(cols[0].more, '160 more', 'the rest wait behind one button');
  for (let i = 0; i < 5; i++) {
    const r = await ev(`(() => { const b = document.querySelectorAll('.ws-board > section.ws-col')[0].querySelector('.ws-more'); if (!b) return 'NONE'; b.scrollIntoView({ block: 'center' }); b.click(); return 'MORE'; })()`);
    await sleep(700);
    if (r === 'NONE') break;
  }
  cols = await boardCols();
  assert.equal(cols[0].cards, 200, 'all 200 cards draw');
  const clip = await ev(`(() => {
    const c = document.querySelectorAll('.ws-board > section.ws-col')[0];
    const tray = c.querySelector('.ws-col-cards').getBoundingClientRect();
    let n = 0;
    for (const k of c.querySelectorAll('.ws-card')) { const r = k.getBoundingClientRect(); if (r.top < tray.top - 1 || r.bottom > tray.bottom + 1) n++; }
    const trayEl = c.querySelector('.ws-col-cards');
    return { clipped: n, trayScroll: trayEl.scrollHeight > trayEl.clientHeight + 2 };
  })()`);
  assert.equal(clip.clipped, 0, 'no card is ever cut');
  assert.equal(clip.trayScroll, false, 'the board grows; no column scrolls inside');
  // Fold says folded, keeps its count, and unfolds whole.
  await ev(`document.querySelectorAll('.ws-board > section.ws-col')[0].querySelector('.ws-col-fold').click()`);
  await sleep(800);
  cols = await boardCols();
  assert.equal(cols[0].folded, true, 'the column folds');
  assert.equal(cols[0].expanded, 'false', 'the fold says folded');
  assert.ok(cols[0].w <= 160, `the fold reads slim (stood ${cols[0].w})`);
  assert.equal(cols[0].count, '200', 'the count stays on the fold');
  await ev(`document.querySelector('.ws-board')?.scrollIntoView({ block: 'start' })`);
  await sleep(400);
  await shot(`t278-${TAG}-board-fold-1920.png`);
  await ev(`document.querySelectorAll('.ws-board > section.ws-col')[0].querySelector('.ws-col-fold').click()`);
  await sleep(800);
  cols = await boardCols();
  assert.equal(cols[0].folded, false, 'the column unfolds');
  assert.equal(cols[0].expanded, 'true', 'the fold says open');
  assert.equal(cols[0].cards, 200, 'every card stands after the unfold');
  // The Find narrows the board; clearing brings it back.
  await ev(`document.querySelector('main input[placeholder="Find in this list"]')?.focus()`);
  for (const ch of 'job 042') {
    await H.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch });
    await H.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch });
    await sleep(20);
  }
  await sleep(1000);
  cols = await boardCols();
  assert.deepEqual(cols.map((c) => c.cards), [1, 1], `the Find narrows to the one card a column (stood ${cols.map((c) => c.cards)})`);
  await ev(`(() => { const i = document.querySelector('main input[placeholder="Find in this list"]'); i.select(); document.execCommand('delete'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'x'; })()`);
  await sleep(900);
  cols = await boardCols();
  // The Find opens card windows to show its matches, as it opens folds — clearing leaves them open.
  assert.deepEqual(cols.map((c) => c.cards), [200, 200], 'clearing the Find brings every card back');
  // Keyboard: a card takes focus and Enter opens its meeting.
  assert.equal(await ev(`document.querySelector('.ws-board .ws-card')?.getAttribute('tabindex')`), '0', 'a card takes the keyboard');
  await ev(`document.querySelector('.ws-board .ws-card')?.focus()`);
  assert.ok(await waitFor(H, `document.activeElement?.classList?.contains('ws-card')`, 5000), 'the card holds focus');
  await H.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await H.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(1200);
  assert.ok(await waitFor(H, `(document.querySelector('main')?.innerText || '').includes('standup') || (document.querySelector('main')?.innerText || '').includes('Harbourline') || !!document.querySelector('.w2b-meeting')`, 8000), 'Enter opens the card');
  assert.equal(await errors(), 0, `no console errors (stood ${await lastErrors()})`);
});
