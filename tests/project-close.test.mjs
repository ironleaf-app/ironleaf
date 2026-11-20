// node --test tests/project-close.test.mjs — closing a project with open tasks (p12-close-and-noise A,
// src/shared/project-close.ts): the open tasks listed, the quiet "N loose ends" line, what a dropped task keeps
// (under Decisions with the date, nothing lost), and the plain words the assistant's tool answers with instead of
// closing silently. Made-up projects only. The last test drives the real dialog in the live harness (the real
// renderer bundle against a real vault, tests/vault-controls-harness.mjs): asked on the page, every choice lands in
// the file.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-project-close-'));
let C, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  for (const [name, file] of [['c', 'project-close'], ['p', 'project-file']]) await build({ input: path.join(root, `src/shared/${file}.ts`), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
  C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const WEXLEY = `---
type: project
status: active
owner: Sam Taylor
---
# Wexley St

## What’s next

- [ ] Reply to Thaddeus — Sam · by 12 Oct
- [x] Sign the lease — Sam
- [ ] Book the removalists — Priya
- [ ] Confirm the alarm code
`;

test('the open tasks: every unticked step, with its place, owner and day', () => {
  const p = P.parseProject(WEXLEY, 'Projects/Wexley St/Wexley St.md');
  assert.deepEqual(C.openProjectTasks(p), [
    { index: 0, what: 'Reply to Thaddeus', who: 'Sam', when: '12 Oct' },
    { index: 2, what: 'Book the removalists', who: 'Priya' },
    { index: 3, what: 'Confirm the alarm code' },
  ]);
  assert.deepEqual(C.openProjectTasks(P.parseProject('---\ntype: project\nstatus: done\n---\n# Empty\n', 'x.md')), []);
});

test('the quiet line: "1 loose end", "5 loose ends"', () => {
  assert.equal(C.looseEndsWords(1), '1 loose end');
  assert.equal(C.looseEndsWords(5), '5 loose ends');
});

test('a dropped task keeps its line under Decisions with the date', () => {
  const item = C.dropDecisionItem('Reply to Thaddeus', '4 Nov 2026');
  assert.equal(item.date, '4 Nov 2026');
  assert.ok(item.what.includes('Reply to Thaddeus'), 'the line is kept');
  assert.ok(/drop/i.test(item.why ?? ''), 'it says it was dropped');
  // As written: the decision keeps the line and the date.
  const p = P.parseProject(WEXLEY, 'Projects/Wexley St/Wexley St.md');
  P.applyProjectEdit(p, { kind: 'remove', list: 'next', index: 0 }, '4 Nov 2026');
  P.applyProjectEdit(p, { kind: 'add', list: 'decisions', item }, '4 Nov 2026');
  const text = P.serializeProject(p, WEXLEY);
  assert.ok(!text.includes('- [ ] Reply to Thaddeus'), 'off the next steps');
  assert.ok(text.includes('Reply to Thaddeus') && text.includes('4 Nov 2026'), 'kept under Decisions with the date');
});

test('the assistant does not close silently: the open tasks in plain words', () => {
  const p = P.parseProject(WEXLEY, 'Projects/Wexley St/Wexley St.md');
  const words = C.closeBlockedWords('Wexley St', C.openProjectTasks(p));
  assert.ok(words.includes('Wexley St'));
  assert.ok(words.includes('Reply to Thaddeus') && words.includes('Book the removalists') && words.includes('Confirm the alarm code'));
  assert.ok(!/DSH|DeepSeek|pi-ai/i.test(words), 'no engine names');
});

test('the dialog says one short line (round 2: the rows list the tasks, never the lead)', () => {
  const p = P.parseProject(WEXLEY, 'Projects/Wexley St/Wexley St.md');
  const open = C.openProjectTasks(p);
  assert.equal(C.closeAskLead(open), '3 tasks are still open. What happened to each?');
  assert.equal(C.closeAskLead(open.slice(0, 1)), '1 task is still open. What happened to it?');
  assert.ok(!C.closeAskLead(open).includes('Reply to Thaddeus'), 'no task listed twice');
});

test('the one rule for what asks: a done status, or the lifecycle moved to done', () => {
  assert.equal(C.wantsDone({ kind: 'set', field: 'status', value: 'done' }), true);
  assert.equal(C.wantsDone([{ kind: 'set', field: 'health', value: 'on track' }, { kind: 'set', field: 'status', value: 'Complete' }]), true);
  assert.equal(C.wantsDone({ kind: 'stage', stage: 'done' }), true);
  assert.equal(C.wantsDone({ kind: 'set', field: 'status', value: 'archived' }), false, 'putting away stays silent');
  assert.equal(C.wantsDone({ kind: 'set', field: 'status', value: 'active' }), false);
  assert.equal(C.wantsDone({ kind: 'stage', stage: 'closing' }), false);
});

// ── The real dialog, live: asked on the page, every choice lands in the file ──

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness();
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
  if (H) await H.close().catch(() => undefined);
  H = null;
});

async function waitFor(h, js, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    if (await h.browser.ev(js)) return;
    if (Date.now() - t0 > ms) throw new Error(`waited: ${js.slice(0, 120)}`);
    await sleep(300);
  }
}

/** Click the visible control whose words include `words`, within `scope` when given. */
async function clickWords(h, words, scope = '') {
  const r = await h.browser.ev(`(async () => {
    const root = ${JSON.stringify(scope)} ? document.querySelector(${JSON.stringify(scope)}) ?? document : document;
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"], [role="menuitem"]')].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`);
  assert.equal(r, 'CLICKED', `clicked ${words}${scope ? ` in ${scope}` : ''}`);
}

async function waitFile(file, want, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (want(readFileSync(file, 'utf8'))) return readFileSync(file, 'utf8');
    } catch {}
    if (Date.now() - t0 > ms) throw new Error(`waited on file: ${file}`);
    await sleep(400);
  }
}

test('the real dialog: asked on the page, Done, Drop and Move each land in the file', async () => {
  const h = await harness();
  const ev = h.browser.ev;
  const cart = path.join(h.vaultDir, 'Projects', 'Harbourline Cart Fix', 'Harbourline Cart Fix.md');
  const museum = path.join(h.vaultDir, 'Projects', 'Museum Late Shift', 'Museum Late Shift.md');
  await clickWords(h, 'Projects');
  await waitFor(h, `!!document.querySelector('.pj-page, main')`);
  await clickWords(h, 'Harbourline Cart Fix');
  await waitFor(h, `!!document.querySelector('.pj-page')`);
  await sleep(1200);
  // The page's own Status control, set to Finished: the shared dialog asks instead of closing silently.
  await ev(`(() => { const b = [...document.querySelectorAll('button[title="Change the status"]')].find((x) => x.getBoundingClientRect().width > 2); b.scrollIntoView({ block: 'nearest' }); b.click(); })()`);
  await waitFor(h, `!!document.querySelector('.menu [role="menuitem"]')`);
  await clickWords(h, 'Finished', '.menu');
  await waitFor(h, `!!document.querySelector('.close-dialog')`);
  const lead = await ev(`document.querySelector('.close-dialog .hint')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
  assert.equal(lead, '3 tasks are still open. What happened to each?', `the dialog asks its one short line (saw ${JSON.stringify(lead)})`);
  assert.equal(await ev(`document.querySelectorAll('.close-dialog .close-task').length`), 3, 'every open task a row');
  // Done on the first row ticks it in the file; the dialog shows what is left.
  await ev(`(() => { const row = document.querySelectorAll('.close-dialog .close-task')[0]; [...row.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Done').click(); })()`);
  await waitFor(h, `document.querySelectorAll('.close-dialog .close-task').length === 2`);
  await waitFile(cart, (t) => t.includes('- [x] Chase the 2 carts that failed on Friday'));
  // Drop on the next row takes it off the steps and keeps it under Decisions with the date.
  await ev(`(() => { const row = document.querySelectorAll('.close-dialog .close-task')[0]; [...row.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Drop').click(); })()`);
  await waitFor(h, `document.querySelectorAll('.close-dialog .close-task').length === 1`);
  await waitFile(cart, (t) => !t.includes('- [ ] Retry the failed payment twice before showing an error'));
  const afterDrop = readFileSync(cart, 'utf8');
  assert.ok(afterDrop.includes('Retry the failed payment twice before showing an error') && afterDrop.includes('## Decisions'), 'the dropped line is kept under Decisions');
  assert.ok(/Dropped when the project was marked done/.test(afterDrop), 'saying why it is there');
  // Move on the last row sends it to the other project; nothing left, so the project is marked done.
  await ev(`(() => { const row = document.querySelectorAll('.close-dialog .close-task')[0]; [...row.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Move').click(); })()`);
  await waitFor(h, `!!document.querySelector('.menu [role="menuitem"]')`);
  await clickWords(h, 'Museum Late Shift', '.menu');
  await waitFor(h, `!document.querySelector('.close-dialog')`);
  const done = await waitFile(cart, (t) => /^status: done$/m.test(t));
  assert.ok(!/- \[ \] Send the receipt v2 for review/.test(done), 'the moved line is off the steps');
  await waitFile(museum, (t) => t.includes('Send the receipt v2 for review'));
}, { timeout: 240000 });
