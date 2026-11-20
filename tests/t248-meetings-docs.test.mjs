// node --test tests/t248-meetings-docs.test.mjs — one meeting page and documents that open (t248,
// 12 Nov 2026: the acceptance critics' meetings and documents half). The note is the meeting: its rows
// are Tasks and ticking marks them done, with Decisions and Questions beside them; the Meetings room
// keeps the record around it (recording, transcript, prep) and opens the note for the rest. Documents
// open from their rows through the vault's own viewer, name their file and signer, choose status from
// its choices, and stay one document in search. Made-up vault only.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { clickWords, esc, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const shotsDir = path.join(root, '..', 'shots');

// ── Static: one meeting page, joined as it is (item 1) ──────────────────────

test('the note is the meeting: Tasks that tick done, Decisions and Questions beside them', () => {
  const panel = read('src/renderer/src/views/MeetingActions.tsx');
  assert.ok(panel.includes('aria-label="Tasks in this note"'), 'the rows are Tasks');
  assert.ok(panel.includes("'meetings', 'tick'"), 'ticking marks done through the meetings tick');
  assert.ok(!panel.includes('actions to keep') && !panel.includes('tick to keep'), 'no keep wording');
  assert.ok(!panel.includes('Link a project above'), 'no stale link prompt');
  assert.ok(panel.includes('Pick a project'), 'one plain line offers to pick one');
  assert.ok(!panel.includes('fileToTasks') && !panel.includes('Remind me'), 'no filing or remind beside the rows');
  const note = read('src/renderer/src/views/NoteView.tsx');
  assert.ok(note.includes('<MeetingDecisions') && note.includes('<MeetingQuestions'), 'Decisions and Questions beside Tasks');
  assert.ok(read('src/renderer/src/views/MeetingQuestions.tsx').includes('aria-label="Ask a question"'), 'ask where it happens');
  assert.ok(read('src/renderer/src/views/meeting/MeetingTop.tsx').includes('<strong>Tasks</strong>'), 'one name at the top too');
});

test('the room opens the meeting: counts and one way in, no second rows', () => {
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(page.includes('Open the meeting note'), 'the detail opens the note');
  assert.ok(!page.includes('Actions found') && !page.includes('tick to keep'), 'no second wording');
  assert.ok(!page.includes('function ActionsCard') && !page.includes('function QuestionsCard'), 'no second rows');
  assert.ok(page.includes("A.openPath(r.path, { where: 'current'"), 'a task, decision or question opens the note');
  assert.ok(!page.includes('Add a decision'), 'one wording for logging a decision');
  assert.ok(read('src/renderer/src/views/project/ProjectTabs87.tsx').includes('Log decision'), 'Log decision on the project');
  assert.ok(read('src/renderer/src/views/MeetingDecisions.tsx').includes('Log decision'), 'and in the note');
});

// ── Static: rows read whole, dates keep meaning, questions read plainly ─────

test('meeting rows and titles wrap whole words (item 2)', () => {
  const css = read('src/renderer/src/styles/w2b.css');
  assert.ok(css.includes('.w2b-row-words') && css.includes('.w2b-title-words'), 'wrapping words, never clipped');
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(page.includes('w2b-row-words') && page.includes('w2b-title-words'), 'rows and titles use them');
  assert.ok(!page.includes('Actions found'), 'no starved rows left to cut');
});

test('Every question reads Open or Answered and wraps whole (item 5)', () => {
  const parts = read('src/renderer/src/views/workspace/recordParts.tsx');
  assert.ok(parts.includes('>Open</span>') && parts.includes('>Answered</span>'), 'Open or Answered, never a bare No');
  const css = read('src/renderer/src/styles/project-workspace.css');
  assert.ok(!/\.ws-row-meta > \.ws-cell \{[^}]*anywhere/.test(css), 'list cells wrap whole words');
  assert.ok(!/\.ws-proj-ref \{[^}]*white-space: nowrap/.test(css), 'project names wrap whole');
});

test('asking lives on the meeting and on Every question (item 4)', () => {
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(page.includes('AskAnywhere'), 'Every question has its ask box');
  assert.ok(page.includes("'add-item', into.path, 'question'"), 'asked into the picked meeting');
});

// ── Static: the card agrees, errors go back, search stays one document ──────

test('the project meeting card reads its own actions whole (item 6)', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(tabs.includes('connectedActionsOf([], ctx.connected.filter'), 'unfolded: nothing drops');
  assert.ok(read('src/shared/project-hub.ts').includes('today: number, fold = true'), 'the hub still folds everywhere else');
  assert.ok(read('src/shared/records.ts').includes('filedElsewhere'), 'filed matches ride along for the card');
  assert.ok(read('src/renderer/src/views/ProjectPage.tsx').includes('filedElsewhere ?? []'), 'the card reads both lists');
});

test('vault files resolve and rows name file and signer (item 8)', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(tabs.includes('vaultRels'), 'Documents entries resolve against the vault file list');
  assert.ok(tabs.includes('kept in the vault'), 'a vault-kept file says so');
  assert.ok(tabs.includes('Signed by ${chain.facts.signer}'), 'the signer reads on the row');
  const err = read('src/renderer/src/components/PageStates.tsx');
  assert.ok(err.includes("label: 'Back'"), 'every error page has Back');
});

test('versions stay one document in search (item 8)', () => {
  const view = read('src/renderer/src/components/SearchView.tsx');
  assert.ok(view.includes('foldVersionHits'), 'note and file hits fold to their latest');
});

test('opening an item on its own page reveals and flashes its row (item 9)', () => {
  const open = read('src/renderer/src/views/project/hubOpen.ts');
  assert.ok(open.includes('W.activeTab(getWorkspace()).path === ctx.path'), 'same page detected');
  assert.ok(open.includes('await ctx.show(ref)'), 'revealed and flashed instead of reopened');
});

// ── Live ─────────────────────────────────────────────────────────────────────

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    const pdf = (title, line) => {
      const objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      ];
      const content = `BT /F1 24 Tf 72 770 Td (${title}) Tj ET BT /F1 12 Tf 72 736 Td (${line}) Tj ET`;
      objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      let out = '%PDF-1.4\n';
      const offsets = [0];
      objs.forEach((o, i) => {
        offsets.push(Buffer.byteLength(out));
        out += `${i + 1} 0 obj\n${o}\nendobj\n`;
      });
      const xref = Buffer.byteLength(out);
      out += `xref\n0 6\n0000000000 65535 f \n` + offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
      return Buffer.from(out, 'latin1');
    };
    w('People/June Park.md', `---\ntype: person\nrole: Bookkeeper\n---\n# June Park\n\nBookkeeper for the shop. Signs the contracts.\n`);
    w('People/Alex Chen.md', `---\ntype: person\nrole: Shop developer\n---\n# Alex Chen\n\nRuns the cart fix.\n`);
    w('Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', `---\ntype: project\nstatus: active\nhealth: at risk\nowner: Alex Chen\ndue: 2026-11-20\n---\n# Harbourline Cart Fix\n\n## Summary\n\nThe shop's cart drops about one order in forty at payment.\n\n## What's next\n\n- [ ] Retry the failed payment twice before showing an error — Priya Nair — due 2026-11-06\n- [ ] Ring ShadeCo about the awning quote before it lapses — Alex Chen — due 2026-11-07\n\n## Key dates\n\n- 2026-11-20: Cart fix done (milestone)\n\n## People\n\n- Alex Chen (owner)\n- June Park\n\n## Documents\n\n- \`Docs/Shopfit Contract v2.pdf\` — Shopfit contract\n  doc_status: signed\n  signed_by: June Park\n  signed_on: 2026-11-03\n  replaces: [[Docs/Shopfit Contract v1.pdf]]\n- \`Docs/Shopfit Contract v1.pdf\` — First version\n\n## Notes\n\nKept for the fix.\n`);
    w('Meetings/2026-11-10 Tuesday standup.md', `---\ntype: meeting\ndate: 2026-11-10\nattendees: [Alex Chen, June Park]\nproject: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md\n---\n# 2026-11-10 Tuesday standup\n\n## Agenda\n\n- The retry fix and the Friday release\n\n## Actions\n\n- [ ] Run the Saturday soak test with twenty real orders in a row — Sam Ortega — due 2026-11-09\n- [ ] Retry the failed payment twice — Priya Nair — due 2026-11-06\n- [ ] Ring ShadeCo about the awning quote before it lapses — Alex Chen — due 2026-11-07\n\n## Decisions\n\n- Retry twice, then fail loud\n\n## Questions\n\n- Who signs off the till logs? (asked by June Park)\n`);
    w('Meetings/2026-11-11 Call with no project.md', `---\ntype: meeting\ndate: 2026-11-11\nattendees: [Alex Chen]\n---\n# 2026-11-11 Call with no project\n\n## Actions\n\n- [ ] Ring the bank about the card reader — Alex Chen\n`);
    w('Docs/Shopfit Contract v2.pdf', pdf('Shopfit Contract v2', 'Signed by June Park on 3 Nov 2026.'));
    w('Docs/Shopfit Contract v1.pdf', pdf('Shopfit Contract v1', 'First version, sent for review.'));
    w('Docs/Shopfit Contract v1.md', `---\ntype: contract\nproject: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md\ndoc_status: sent\n---\n# Shopfit Contract v1\n\nFirst version of the shopfit contract, sent to June.\n`);
    w('Docs/Shopfit Contract v2.md', `---\ntype: contract\nproject: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md\ndoc_status: signed\nsigned_by: June Park\nsigned_on: 2026-11-03\nreplaces: "[[Docs/Shopfit Contract v1]]"\n---\n# Shopfit Contract v2\n\nSigned version of the shopfit contract.\n`);
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2500);
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

async function tap(h, js) {
  const p = await h.browser.ev(`(() => {
    const el = (${js});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  assert.ok(p, `visible: ${js.slice(0, 140)}`);
  const x = Math.round(p.x), y = Math.round(p.y);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(150);
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 });
  await sleep(600);
}

async function openNote(h, name) {
  await esc(h);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the switcher opens');
  await h.browser.send('Input.insertText', { text: name });
  await sleep(900);
  const done = await h.browser.ev(`(() => {
    const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes(${JSON.stringify(name)}));
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(done, 'CLICKED', `the switcher opens ${name}`);
  await sleep(1200);
}

const readVault = (h, rel) => readFileSync(path.join(h.vaultDir, ...rel.split('/')), 'utf8');

test('the meeting reads as Tasks and ticking marks them done (items 1, 7)', { timeout: 300000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 2, mobile: false });
  await sleep(500);
  await openNote(h, 'Tuesday standup');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Tasks in this note"]')`, 8000), 'Tasks show');
  const head = await h.browser.ev(`document.querySelector('section[aria-label="Tasks in this note"] .mt-head')?.innerText ?? ''`);
  assert.ok(head.includes('Tasks'), `the rows are Tasks (saw ${head})`);
  const body = await h.browser.ev(`document.querySelector('section[aria-label="Tasks in this note"]')?.innerText ?? ''`);
  assert.ok(!body.includes('to keep') && !body.includes('Link a project'), 'no keep panel, no link prompt');
  // Whole words on every row: nothing cut mid-word.
  const cut = await h.browser.ev(`[...document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row .mt-words')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`);
  assert.ok(cut.some((t) => t.includes('Run the Saturday soak test with twenty real orders in a row')), `rows read whole (${cut.join(' / ').slice(0, 120)})`);
  // Ticking marks done, in the note and the project's step together.
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 120)); } })()`);
  await sleep(400);
  await tap(h, `[...document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row')].find((r) => (r.innerText || '').includes('Ring ShadeCo about the awning quote')).querySelector('button.check')`);
  await sleep(1200);
  assert.ok(readVault(h, 'Meetings/2026-11-10 Tuesday standup.md').includes('- [x] Ring ShadeCo about the awning quote'), 'ticked in the note');
  // The same job on the project ticks with it (one task; the near-words merge is pinned in t249-one-row). Retry
  // stays open for item 9's waiting row.
  assert.ok(readVault(h, 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md').includes('- [x] Ring ShadeCo about the awning quote'), 'ticked on the project too');
});

test('a meeting with no project gets one plain line (item 1)', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Call with no project');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Tasks in this note"]')`, 8000), 'Tasks show');
  const body = await h.browser.ev(`document.querySelector('section[aria-label="Tasks in this note"]')?.innerText ?? ''`);
  assert.ok(body.includes('Pick a project'), 'one plain line offers to pick one');
  assert.ok(!body.includes('Link a project above'), 'and nothing else prompts');
});

test('ask, answer and log where they happen (items 4, 7)', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Tuesday standup');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Questions in this note"]')`, 8000), 'Questions sit beside Tasks');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Decisions in this note"]')`, 8000), 'Decisions sit beside Tasks');
  // Ask on the meeting itself.
  await tap(h, `document.querySelector('section[aria-label="Questions in this note"] input[aria-label="Ask a question"]')`);
  await h.browser.send('Input.insertText', { text: 'Who approves the refund?' });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(1500);
  assert.ok(readVault(h, 'Meetings/2026-11-10 Tuesday standup.md').includes('Who approves the refund?'), 'asked in the note');
  // The harness delivers no change events, so the open note re-reads this way (the app's watcher does it live).
  await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
  assert.ok(await waitFor(h, `!!document.querySelector('.app')`, 30000), 'rebooted');
  await sleep(2000);
  await openNote(h, 'Tuesday standup');
  assert.ok(await waitFor(h, `!!document.querySelector('section[aria-label="Questions in this note"]')`, 8000), 'Questions show again');
  // Rows past the fold skip rendering until scrolled to (t102): read each as a person would, scrolled in.
  await h.browser.ev(`(async () => { for (const e of document.querySelectorAll('section[aria-label="Questions in this note"] .mt-row')) { e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 120)); } })()`);
  await sleep(400);
  // Answer it where it lives.
  await tap(h, `[...document.querySelectorAll('section[aria-label="Questions in this note"] .mt-row')].find((r) => (r.innerText || '').includes('Who approves the refund?')).querySelector('button')`);
  assert.ok(await waitFor(h, `!!document.querySelector('.dialog input')`, 5000), 'the answer opens');
  await h.browser.send('Input.insertText', { text: 'June does.' });
  await sleep(300);
  await tap(h, `document.querySelector('.dialog-actions .button.primary')`);
  await sleep(1200);
  assert.ok(readVault(h, 'Meetings/2026-11-10 Tuesday standup.md').includes('June does.'), 'answered in the note');
  // Log a decision in the one wording.
  const placeholder = await h.browser.ev(`document.querySelector('section[aria-label="Decisions in this note"] input')?.getAttribute('placeholder') ?? ''`);
  assert.equal(placeholder, 'Log decision', 'one wording for logging a decision');
});

test('the room counts and opens the note (item 1)', { timeout: 300000 }, async () => {
  const h = await harness();
  await openRoom(h, 'Meetings');
  await sleep(800);
  assert.equal(await clickWords(h, 'Past', 'main'), 'CLICKED', 'Past opens');
  await sleep(600);
  assert.equal(await clickWords(h, 'Tuesday standup', 'main'), 'CLICKED', 'the meeting opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.w2b-meeting')`, 8000), 'the record opens');
  assert.ok(await waitFor(h, `!![...document.querySelectorAll('.w2b-meeting button')].find((b) => (b.innerText || '') === 'Open the meeting note')`, 8000), 'it opens the meeting');
  assert.ok(!(await h.browser.ev(`(document.querySelector('.w2b-meeting')?.innerText ?? '').includes('Actions found')`)), 'no second rows');
  await tap(h, `[...document.querySelectorAll('.w2b-meeting button')].find((b) => (b.innerText || '') === 'Open the meeting note')`);
  await sleep(1200);
  assert.ok(await h.browser.ev(`!!document.querySelector('section[aria-label="Tasks in this note"]')`), 'the note is the meeting');
});

test('the project meeting card agrees with the meeting (item 6)', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(2000);
  await h.browser.ev(`document.querySelector('[data-meeting]')?.scrollIntoView({ block: 'center' })`);
  await sleep(600);
  const card = await h.browser.ev(`document.querySelector('[data-meeting="Meetings/2026-11-10 Tuesday standup.md"]')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.ok(card.includes('Run the Saturday soak test'), `the card lists the open task (${card.slice(0, 140)})`);
  assert.ok(card.includes('Ring ShadeCo about the awning quote'), 'an exact match of a step still reads on its meeting');
  assert.ok(!card.includes('nothing open'), 'never nothing open while the meeting lists it open');
});

test('a vault-kept PDF opens from its row; the row names file and signer (item 8)', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(2000);
  // t255: the section bar became real tabs — the Notes tab opens first.
  await h.browser.ev(`document.querySelector('[data-tab="notes"]')?.click()`);
  await sleep(1200);
  await h.browser.ev(`document.querySelector('[data-section="notes"]')?.scrollIntoView()`);
  await sleep(600);
  const rows = await h.browser.ev(`[...document.querySelectorAll('[data-section="notes"] .trow')].map((r) => r.innerText.replace(/\\s+/g, ' ').slice(0, 160))`);
  const pdf = rows.find((t) => t.includes('Shopfit contract'));
  assert.ok(pdf && pdf.includes('Shopfit Contract v2.pdf'), `the row names its file (${pdf ?? rows.slice(0, 3).join(' / ')})`);
  assert.ok(pdf && pdf.includes('Signed by June Park, 3 Nov'), `the row names its signer (${pdf})`);
  await tap(h, `[...document.querySelectorAll('[data-section="notes"] .trow button.t')].find((b) => (b.textContent || '').includes('Shopfit contract'))`);
  assert.ok(await waitFor(h, `!!document.querySelector('.pdfv-page')`, 15000), 'the vault viewer draws its page');
  await sleep(800);
  const failed = await h.browser.ev(`(document.querySelector('main')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 160)`);
  assert.ok(!failed.includes("couldn't be opened") && !failed.includes("can't be shown"), 'no dead file error');
});

test('Every question reads plainly and asks (items 4, 5)', { timeout: 300000 }, async () => {
  const h = await harness();
  await openRoom(h, 'Meetings');
  await sleep(800);
  assert.equal(await clickWords(h, 'Every question', 'main'), 'CLICKED', 'Every question opens');
  await sleep(1000);
  assert.ok(await waitFor(h, `!!document.querySelector('input[aria-label="Ask a question"]')`, 8000), 'ask on Every question');
  const bare = await h.browser.ev(`[...document.querySelectorAll('.ws-faint')].some((e) => e.innerText.trim() === 'No')`);
  assert.ok(!bare, 'no bare No');
  const pills = await h.browser.ev(`[...document.querySelectorAll('.ws-pill')].map((e) => e.innerText.trim()).join('|')`);
  assert.ok(pills.includes('Open') || pills.includes('Answered'), `Open or Answered (${pills.slice(0, 120)})`);
  // Ask from Every question: into the latest meeting.
  await tap(h, `document.querySelector('input[aria-label="Ask a question"]')`);
  await h.browser.send('Input.insertText', { text: 'Who brings the spare keys?' });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(1500);
  assert.ok(readVault(h, 'Meetings/2026-11-11 Call with no project.md').includes('Who brings the spare keys?'), 'asked into the latest meeting');
});

test('versions stay one document in search (item 8)', { timeout: 300000 }, async () => {
  const h = await harness();
  await esc(h);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the switcher opens');
  await h.browser.send('Input.insertText', { text: 'Search inside notes' });
  await sleep(900);
  await h.browser.ev(`[...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes('Search inside notes'))?.click()`);
  assert.ok(await waitFor(h, `!!document.querySelector('input[aria-label="Search notes, tasks, projects, people, meetings and files"]')`, 8000), 'search opens');
  await h.browser.send('Input.insertText', { text: 'Shopfit Contract' });
  await sleep(3000);
  const titles = await h.browser.ev(`[...document.querySelectorAll('.srow2 .sas-rowhead .t')].map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim()).join('|')`);
  assert.ok(titles.includes('Shopfit Contract v2'), `the latest lists (${titles.slice(0, 200)})`);
  assert.ok(!titles.includes('Shopfit Contract v1'), `v1 never lists beside v2 as its own document (${titles.slice(0, 200)})`);
  await esc(h);
});

test('opening an item on its own page reveals and flashes its row (item 9)', { timeout: 300000 }, async () => {
  const h = await harness();
  await openNote(h, 'Harbourline Cart Fix');
  await sleep(2000);
  // t255: the section bar became real tabs — the Waiting tab opens first.
  await h.browser.ev(`document.querySelector('[data-tab="waiting"]')?.click()`);
  await sleep(1200);
  // The row in view first, so only the reveal itself may move the scroll.
  await h.browser.ev(`document.querySelector('[data-section="waiting"] [data-action]')?.scrollIntoView({ block: 'center' })`);
  await sleep(500);
  const focused = await h.browser.ev(`(() => { const el = document.querySelector('[data-section="waiting"] [data-action]'); if (!el) return false; el.focus(); return true; })()`);
  assert.ok(focused, 'a waiting row shows');
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(800);
  const lit = await h.browser.ev(`!!document.querySelector('.tl-revealed')`);
  assert.ok(lit, 'revealed and flashed');
  // The box ticks it done like every other box (its old job duplicated the row's and answered nothing).
  await tap(h, `document.querySelector('[data-section="waiting"] [data-action] button.check[role="checkbox"]')`);
  await sleep(1200);
  assert.ok(readVault(h, 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md').includes('- [x] Retry the failed payment twice before showing an error'), 'ticked the step');
});

test('every error page has Back (item 8)', () => {
  const states = read('src/renderer/src/components/PageStates.tsx');
  assert.ok(states.includes("label: 'Back'") && states.includes('W.navigate(w, tab.id, -1)'), 'Back on every error page');
});
