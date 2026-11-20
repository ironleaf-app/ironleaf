// node --test tests/project-fitout.test.mjs — a Vault project page reads as one complete page (t141, 9 Nov
// 2026). A made-up project shaped like their gallery fit-out (tests/fitout-project.mjs: 40 notes, 16 open
// steps and 6 done, 13 risks, 8 people, 5 meetings, 3 key dates, 6 files, 2 chats, a budget table) walked
// as the person running it would: its meetings in order with their actions, risks ranked, waiting heads
// counted, people shown once, the budget table read as a table — and every change made on the page read
// back from the files. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';
import { HALL_PATH, hallChats, hallProjectFiles, writeFitoutProject } from './fitout-project.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const tabs = () => read('src/renderer/src/views/project/ProjectTabs87.tsx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The real today, as the page reads it: late counts below are computed from it, so the walk holds whatever
// day it runs (the fixture's fixed 9 Nov 2026 clock only steadies the vault's own stamps).
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const late = (...isos) => isos.filter((d) => d < todayIso()).length;

// ── The ranking, by itself ───────────────────────────────────────────────────

const work = mkdtempSync(path.join(tmpdir(), 'nv-avp-'));
let H;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as H from ${JSON.stringify(path.join(root, 'src/shared/project-hub.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'h.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ H } = await import(pathToFileURL(path.join(work, 'h.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('risks rank highest first, whatever words the file holds', () => {
  assert.deepEqual(['Low', 'High', 'Medium', '', 'Critical', 'moderate', 'severe', 'minor'].map((l) => H.riskLevelRank(l)), [2, 0, 1, 3, 0, 1, 0, 2]);
  assert.equal(H.riskLevelRank(null), 3);
});

// ── The page's shape ─────────────────────────────────────────────────────────

test('meetings read in their own group, in order with their actions — never mixed through the notes', () => {
  const t = tabs();
  assert.ok(t.includes('export function folioMeetingRows'), 'one rule builds the meeting rows');
  assert.ok(t.includes('isMeetingNote(n.path, meta?.props ?? {})'), 'a meeting is the app’s own reading, not a name guess');
  assert.ok(t.includes('meetingDate(n.path, meta?.props ?? {}'), 'ordered by the meeting’s own day, never the file’s age');
  assert.ok(t.includes('b.day - a.day'), 'newest first');
  const rows = t.slice(t.indexOf('export function folioNoteRows'), t.indexOf('export interface FolioMeeting'));
  assert.ok(rows.includes('isMeetingNote(n.path, meta?.props ?? {})'), 'meetings leave the plain note rows');
  const sec = t.slice(t.indexOf('export function NotesSection'), t.indexOf('// ── People'));
  assert.ok(sec.includes('<MeetingRow key={m.path} ctx={ctx} meeting={m} />'), 'the Notes section holds the group');
  assert.ok(t.includes('connectedActionsOf([], ctx.connected.filter((c) => c.path === m.path)'), 'each meeting holds the actions written in it (t248: unfolded, the meeting’s own)');
  assert.ok(t.includes('data-meeting={m.path}'), 'each meeting names its path for the walk');
  assert.ok(t.includes('a.done ? (words ? (\'quiet\' as const) : null) : a.due !== undefined ? whenTone'), 'a ticked action never reads late');
  assert.ok(t.includes('m.title.replace(/^\\d{4}-\\d{2}-\\d{2}\\s+/, \'\')'), 'a date leading the title is not said twice');
});

test('Decisions keeps the filed ones shown nowhere else in the plan', () => {
  const t = tabs();
  const rule = t.slice(t.indexOf('export function decisionsFlowed'), t.indexOf('export function decisionsFlowed') + 700);
  assert.ok(rule.includes('hub.plan.late') && rule.includes('g.items'), 'an open filed one already shows under What’s next or Waiting');
  assert.ok(rule.includes('a.ref.kind === \'record\'') && rule.includes('!shown.has(a.id)'), 'Decisions keeps the rest');
  assert.ok(t.includes('Actions filed from its notes and meetings'), 'the heading stays');
});

test('a waiting head counts, never repeating the first row’s words', () => {
  const t = tabs();
  const head = t.slice(t.indexOf('function WaitingPerson'), t.indexOf('function WaitingPerson') + 1800);
  assert.ok(head.includes('{g.person} · {g.items.length} open'), 'who, how many open');
  assert.ok(head.includes('` · ${late} late`'), 'and how many late');
  assert.ok(!head.includes('· {plain(g.items[0]?.what'), 'the first row’s words are gone from the head');
  assert.ok(head.includes('ctx.go(g.items[0].ref'), 'the head still opens the top item');
});

test('risks sort by their rank, and see-also never names people or projects', () => {
  const t = tabs();
  // t242 sorts by the tail-aware rank (a bullet's tail level ranks it too), and the rank still sorts.
  assert.ok(t.includes('.sort((a, b) => riskLevelRank(a.level ?? splitRiskTail(a.what).level) - riskLevelRank(b.level ?? splitRiskTail(b.what).level))'), 'the rank sorts the rows');
  const also = t.slice(t.indexOf('export function folioSeeAlso'), t.indexOf('export function folioSeeAlso') + 1200);
  assert.ok(also.includes('/^(project|hub|person|people)$/i'), 'the same rule the member rows read');
  const sec = t.slice(t.indexOf('export function NotesSection'), t.indexOf('// ── People'));
  assert.ok(sec.includes('{seeShown.map(seeRow)}'), 'see-also folds with the rest');
});

test('shown notes render whole Markdown, so a budget table reads as a table', () => {
  const t = tabs();
  assert.ok(t.includes('renderMarkdown(p.notes, { from: ctx.path })'), 'Your notes read whole');
  assert.ok(t.includes('renderMarkdown(x.body, { from: ctx.path })'), 'other notes read whole');
  assert.ok(!t.includes('renderInline(p.notes') && !t.includes('renderInline(x.body'), 'no inline render left on them');
  assert.ok(read('src/renderer/src/styles/w2a.css').includes('.pj-folio .markdown input[type="checkbox"]'), 'a drawn box never flips without saving');
});

// ── The live walk ────────────────────────────────────────────────────────────

test('the gallery fit-out live: one page, every change read back from the files', async () => {
  const h = await startHarness({ projectFiles: hallProjectFiles(), projectWork: hallChats() });
  try {
    writeFitoutProject(h.vaultDir);
    await h.services.rescanAll();
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(1500);
    const readVault = (rel) => readFileSync(path.join(h.vaultDir, ...rel.split('/')), 'utf8');
    const clickWords = (words, scope = '') => h.browser.ev(`(async () => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
      const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
      if (!root) return 'NOROOT';
      const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter(vis);
      const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
      if (!el) return 'NOTFOUND';
      el.scrollIntoView({ block: 'nearest' }); el.click();
      await new Promise((r) => setTimeout(r, 600));
      return 'CLICKED';
    })()`);
    // Real input for the edits (the edit-where-shown precedent): the real mouse and keys over CDP.
    const ptOf = (js) => h.browser.ev(`(() => {
      const el = ${js};
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return { x: Math.min(r.x + r.width / 2, window.innerWidth - 2), y: Math.min(r.y + r.height / 2, window.innerHeight - 2) };
    })()`);
    const tapJs = async (js, count = 1) => {
      const p = await ptOf(js);
      assert.ok(p, `visible: ${js.slice(0, 100)}`);
      const x = Math.round(p.x), y = Math.round(p.y);
      await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await sleep(90);
      for (const n of Array.from({ length: count }, (_, i) => i + 1)) {
        await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: n });
        await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: n });
      }
      await sleep(450);
    };
    const tapSel = (sel, count = 1) => tapJs(`document.querySelector(${JSON.stringify(sel)})`, count);
    const typeInto = async (text) => {
      await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await sleep(180);
      await h.browser.send('Input.insertText', { text });
      await sleep(300);
      await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await h.browser.send('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
      await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await sleep(1500);
      // A suggestion may have eaten the Enter (it fills the same words): one more saves.
      if (await h.browser.ev(`!!document.querySelector('.pj-ed-input')`)) {
        await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await h.browser.send('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
        await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await sleep(1500);
      }
    };
    const waitLine = async (rel, has, ms = 20000) => {
      const t0 = Date.now();
      for (;;) {
        const lines = readVault(rel).split('\n');
        const hit = lines.find((l) => has.every((s) => l.includes(s)));
        if (hit) return hit;
        if (Date.now() - t0 > ms) throw new Error(`${rel} never held a line with ${JSON.stringify(has)}`);
        await sleep(400);
      }
    };
    assert.equal(await clickWords('Projects'), 'CLICKED', 'Projects opens');
    await sleep(800);
    assert.equal(await clickWords('Southern Cross Hall Refurbishment'), 'CLICKED', 'the project opens');
    await sleep(2500);

    // With tabs (t255) each section reads on its tab (t265): the walk opens the tab first, as a person
    // would, and scrolls within it past the fold (t102's content-visibility speed work).
    const openTab = async (id) => {
      await h.browser.ev(`document.querySelector('[data-tab="${id}"]')?.click()`);
      await sleep(1000);
      assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), id, `${id} opens`);
    };
    const show = async (sel) => {
      await h.browser.ev(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'start' })`);
      await sleep(500);
    };

    // Its meetings in order, with their actions — by meeting day (the kickoff was touched yesterday, and
    // still reads last), each action with its owner.
    await openTab('notes');
    const meetings = await h.browser.ev(`[...document.querySelectorAll('[data-section="notes"] [data-meeting]')].map((el) => el.getAttribute('data-meeting')).join(',')`);
    assert.equal(meetings, 'Meetings/2026-11-08 Northside install standup.md,Meetings/2026-11-05 Eastside landlord catchup.md,Meetings/2026-11-03 Southside planning.md,Meetings/2026-10-27 Northside design review.md,Meetings/2026-10-20 gallery fit-out kickoff.md', 'newest first by meeting day');
    const kickoff = await h.browser.ev(`document.querySelector('[data-meeting="Meetings/2026-10-20 gallery fit-out kickoff.md"]')?.innerText ?? ''`);
    for (const words of ['Send the Tessaly statement of work for signing', 'Book the Northside wiring survey', 'Share the kickoff notes with the steering group']) {
      assert.ok(kickoff.includes(words), `the kickoff holds ${words}`);
    }
    // …and nowhere else as note rows.
    const noteRows = await h.browser.ev(`[...document.querySelectorAll('[data-section="notes"]')].map((el) => el.innerText).join('\\n')`);
    assert.equal(noteRows.split('Northside install standup').length - 1, 1, 'each meeting named once');
    // Risks ranked: the file holds a Low first, the page a High.
    await openTab('risks');
    const risks = await h.browser.ev(`[...document.querySelectorAll('[data-section="risks"] [data-item^="risks:"] .t')].map((el) => el.innerText.trim()).slice(0, 5).join('|')`);
    assert.ok(risks.startsWith('Northside power shutdown slips past 14 Nov'), `a High first (saw ${risks.split('|')[0]})`);
    // Waiting heads count, never repeating the row beneath.
    await openTab('waiting');
    // Every dated open one of hers: the two in the project file and the HDMI cables from the 27 Oct review (late since 13 Nov).
    const lisaLate = late('2026-11-06', '2026-11-11', '2026-11-13');
    const lisa = await h.browser.ev(`[...document.querySelectorAll('[data-section="waiting"] .card .trow:first-child .t')].map((el) => el.innerText.trim()).find((s) => s.startsWith('Lisa Wang')) ?? ''`);
    assert.equal(lisa, `Lisa Wang · 4 open${lisaLate ? ` · ${lisaLate} late` : ''}`, 'Lisa’s head counts');
    const heads = await h.browser.ev(`[...document.querySelectorAll('[data-section="waiting"] .card')].map((c) => { const rows = [...c.querySelectorAll('.tkrow .tkrow-title')].map((r) => r.innerText.trim()); return { head: c.querySelector('.trow:first-child .t').innerText.trim(), first: rows[0] ?? '' }; })`);
    for (const x of heads) assert.ok(!x.head.includes(x.first), `${x.head} never repeats its first row`);
    // People show once: their pages left See also.
    await openTab('notes');
    const seeAlso = await h.browser.ev(`[...document.querySelector('[data-section="notes"]')?.innerText.matchAll(/^(Sarah Mitchell|James O’Connor|Priya Sharma|Tom Baker|Lisa Wang|David Nguyen|Emma Thompson|Michael Roberts)$/gm) ?? []].length`);
    assert.equal(seeAlso, 0, 'no people in the notes');
    // The budget table reads as a table.
    await h.browser.ev(`document.querySelector('.pj-other-notes')?.setAttribute('open', '')`);
    await show('.pj-other-notes');
    const cells = await h.browser.ev(`[...document.querySelectorAll('.pj-other-notes table td')].map((el) => el.innerText.trim()).join('|')`);
    assert.ok(cells.includes('Materials, Northside, eight rooms') && cells.includes('$168,000'), 'the budget figures sit in cells');
    // Its chats, continuing in one click.
    await openTab('overview');
    assert.equal(await h.browser.ev(`document.querySelectorAll('.pj-spark-row').length`), 2, 'both chats on the page');
    await tapJs(`[...document.querySelectorAll('.pj-spark-row')][0]`);
    await sleep(800);
    assert.ok(h.services.opened.some((o) => o.what === 'conversation' && o.id === 'hall_sound_desk'), 'the chat continues');
    // A step ticked, assigned and dated in place — each read back from the project file.
    await openTab('whats-next');
    await tapSel('[data-item="next:0"] .check');
    await waitLine(HALL_PATH, ['- [x] Confirm the Northside power shutdown with David Nguyen']);
    await tapSel('[data-item="next:13"] .tkrow-when .pj-ed', 2);
    await sleep(600);
    await h.browser.ev(`(() => { const i = document.querySelector('.pj-date-input'); const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(i, '2026-12-11'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); })()`);
    await waitLine(HALL_PATH, ['Hold the Southside lessons learned session', '2026-12-11']);
    // t249: your own name hides on your own rows, and Your next holds only your own steps here —
    // the who-cell assign proves on a Waiting row showing someone else instead (next:13's Sarah
    // Mitchell is the viewer, so its cell keeps nothing to click). Focus plus E starts the edit
    // without opening the row.
    await openTab('waiting');
    await h.browser.ev(`document.querySelector('[data-section="waiting"] [aria-label="Chase the Southside acoustic panels, order K-2210"] .tkrow-who .pj-ed')?.focus()`);
    await sleep(400);
    await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69 });
    await sleep(600);
    await typeInto('Tom Baker');
    await waitLine(HALL_PATH, ['Chase the Southside acoustic panels', 'Tom Baker']);
    // A file opens in one click: in the full viewer as a tab (t239, brief-directed: one list, nothing
    // opens outside the app).
    await openTab('notes');
    await tapJs(`[...document.querySelectorAll('[data-section="notes"] .chip')].find((b) => (b.innerText || '').includes('Files'))`);
    await sleep(500);
    await tapJs(`[...document.querySelectorAll('[data-section="notes"] .trow button')].find((b) => (b.innerText || '').includes('lighting budget v3.xlsx'))`);
    await sleep(800);
    assert.ok(await h.browser.ev(`!!document.querySelector('.folder-file-view')`), 'the file opens in the viewer tab');
    assert.ok((await h.browser.ev(`document.querySelector('.folder-file-view')?.innerText ?? ''`)).includes('lighting budget v3.xlsx'), 'the tab shows the file');
    assert.ok(!h.services.opened.some((o) => o.what === 'file'), 'nothing opens outside the app');
    // Back returns to the project where it was, and the walk goes on there.
    await tapSel('button[aria-label="Back"]');
    await sleep(800);
    assert.ok(await h.browser.ev(`!!document.querySelector('[data-section="notes"]')`), 'back on the project');
    assert.equal(await h.browser.ev(`document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab')`), 'notes', 'Back returns to the tab');
    // A risk added, read back from the project file.
    await openTab('risks');
    await tapJs(`document.querySelector('[data-section="risks"] .pj-addrow')`);
    await sleep(600);
    await h.browser.send('Input.insertText', { text: 'Spare stage light stock runs out in December' });
    await sleep(300);
    await tapJs(`[...document.querySelectorAll('[data-section="risks"] .pj-addform .pj-addinput')][1]`);
    await h.browser.send('Input.insertText', { text: 'High' });
    await sleep(300);
    await tapJs(`document.querySelector('[data-section="risks"] .pj-add-go')`);
    await waitLine(HALL_PATH, ['Spare stage light stock runs out in December', 'High']);
    // A meeting action ticks where it shows, written in its meeting.
    await openTab('notes');
    await tapJs(`[...document.querySelector('[data-meeting="Meetings/2026-10-20 gallery fit-out kickoff.md"]').querySelectorAll('[data-action]')].find((el) => (el.getAttribute('aria-label') || '').includes('Share the kickoff notes')).querySelector('.check')`);
    await waitLine('Meetings/2026-10-20 gallery fit-out kickoff.md', ['- [x] Share the kickoff notes with the steering group']);
  } finally {
    await h.close().catch(() => {});
  }
}, { timeout: 600000 });
