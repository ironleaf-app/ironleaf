// node --test tests/rest-quieten.test.mjs — Vault rest-quieten (x1-vault-rest, 5 Nov 2026): the audit
// findings marked REMOVE, MERGE, QUIETEN or REDO that no landed or running build covers, done where they
// change nothing about where things live. Inbox keys said once, one canvas toolbar and one hint, one Linked
// list at the note foot, a peek that summarises, one task-name on Today and Tasks, no count over the
// whole-vault graph. Fails without each change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const view = (f) => read(`src/renderer/src/views/${f}`);
const comp = (f) => read(`src/renderer/src/components/${f}`);

test('inbox: the F/T/D keys are said once in the foot, not on every row', () => {
  const src = view('InboxPage.tsx');
  // The foot documents the keys for the whole page.
  assert.ok(src.includes('j/k move'), 'the foot says the keys once');
  // No per-row key chip: with 25 rows the same three chips shouted 25 times (audit I1).
  const card = src.slice(src.indexOf('function ItemCard'), src.indexOf('export function InboxPage'));
  assert.ok(!card.includes('<kbd'), 'no key chip on any row');
  assert.ok(!card.includes('w2a-key'), 'no key chip class on any row');
  // The buttons and their key handling stay.
  assert.ok(card.includes('Move to a project') && card.includes('Make it a task'), 'the task button keeps both words');
  assert.ok(src.includes("e.key === 'f'") && src.includes("e.key === 't'") && src.includes("e.key === 'd'"), 'the keys still work');
});

test('canvas: one add toolbar (the bottom one) and the count with the title', () => {
  const src = view('CanvasView.tsx');
  // The top keeps the title, the count and the saved words — no add buttons repeating the toolbar.
  const bar = src.slice(src.indexOf('w4b-cv-bar'), src.indexOf('canvas-surface'));
  assert.ok(!bar.includes('+ Card') && !bar.includes('Web link'), 'the top bar adds nothing');
  assert.ok(bar.includes('w4b-cv-status') && bar.includes('cards'), 'the count and saved words stay on top');
  // The bottom toolbar keeps every add, each once.
  for (const add of ['Text card (T)', 'Sticky note (S)', 'A note: new', 'A picture or file', 'A drawing', 'A web link', 'A group (G)']) {
    assert.ok(src.includes(add), `the toolbar keeps ${add}`);
  }
});

test('canvas: one hint at a time, and never under the toolbar', () => {
  const src = view('CanvasView.tsx');
  // The permanent hint waits until the dismissible move/zoom hint is gone (audit M5: one hint).
  assert.ok(/hint\s*===?\s*false|!hint/.test(src.slice(src.indexOf('w4b-cv-hint') - 200, src.indexOf('w4b-cv-hint'))), 'the permanent hint shows once the nav hint is dismissed');
  const css = read('src/renderer/src/styles/page-states-87.css');
  // Where the toolbar moves to the left edge it would sit on the hint: the hint steps aside first.
  assert.ok(css.includes('.w4b-cv-hint') && /max-width:\s*1040px[\s\S]*?\.w4b-cv-hint[\s\S]*?display:\s*none/.test(css), 'the hint hides where the toolbar goes left');
});

test('note foot: one Linked list, not three tabs and not three sections', () => {
  const src = comp('NoteFoot.tsx');
  assert.ok(!src.includes('foot-tabs') && !src.includes('role="tablist"'), 'no tab strip');
  assert.ok(!src.includes("TAB_KEY"), 'no remembered tab');
  // One Linked list (t7-note-window, 8 Nov 2026): links in, mentions and related merge through the one shared
  // merge, each row saying how it is linked; the connected vault's join keeps its own Connected section.
  assert.ok(!src.includes("'Linked here'") && !src.includes("'Mentioned'") && !src.includes("'Related'"), 'no three section heads');
  assert.ok(src.includes('mergeLinked'), 'the one shared merge, never three separate lists');
  assert.ok(src.includes('reasonWords'), 'each row says how it is linked');
  assert.ok(src.includes("'Connected'") && src.includes("'Linked'"), 'Connected for the join, Linked for the one list');
  assert.ok(src.includes('Filter these notes'), 'the filter stays');
  assert.ok(src.includes('Link it'), 'linking a mention stays');
  assert.ok(src.includes('showCount'), 'the zero rule stays on the counts');
  // One read feeds the whole foot: the shared answer (5 Nov 2026 merge: the foot-local batch moved into
  // lib/noteLinks.ts under v6, shared with the side panels and the rail) — the foot reads nothing on its own
  // but the connected vault's join, and a long list caps at six with Show-all.
  assert.ok(src.includes('useNoteLinks'), 'the foot reads through the one shared answer');
  assert.ok(!src.includes('window.nv.index.'), 'no own index read beside the shared one');
  const links = read('src/renderer/src/lib/noteLinks.ts');
  const batch = links.slice(links.indexOf('Promise.allSettled'), links.indexOf('Promise.allSettled') + 400);
  assert.ok(batch.includes('backlinks') && batch.includes('unlinked') && batch.includes('relatedNotes'), 'backlinks, mentions and related arrive in the one batch');
  assert.ok(src.includes('MAX_GROUPS') && src.includes('foot-showall'), 'a long list shows six, then Show-all');
});

test('peek: a project peek summarises — three rows a group, then Show all', () => {
  const src = comp('Peek.tsx');
  const host = src.slice(src.indexOf('export function PeekHost'));
  assert.ok(host.includes('shownAtFirst={3}'), 'the peek shows three rows per group');
  assert.ok(host.includes('Open full page'), 'Open full page stays the door to the whole page');
  assert.ok(src.includes('Show all'), 'Show all stays for the rest');
});

test('today and tasks: the same group heads on both (Late, This week)', () => {
  const today = view('TodayView.tsx');
  const tasks = view('TasksView.tsx');
  assert.ok(!today.includes('Overdue <span>'), 'no Overdue head on Today');
  assert.ok(!today.includes('Next 7 days <span>'), 'no Next 7 days head on Today');
  // t242 reformatted the Late head across lines (commit 4638960c5): the words are unchanged — JSX
  // collapses the newline — so the pin reads across whitespace.
  assert.ok(/Late\s+<span/.test(today) && today.includes('This week <span>'), 'Today heads read Late and This week');
  assert.ok(tasks.includes("'Late'") && tasks.includes("'This week'"), 'Tasks heads read the same');
});

test('graph: no count over the whole vault when the centre is unknown', () => {
  const src = view('GraphTab.tsx');
  assert.ok(src.includes('centreNode') && /count=\{centreNode\s*(\?|&&)/.test(src), 'the count needs a known centre');
  assert.ok(src.includes('Whole vault'), 'the whole vault stays one click away');
});
