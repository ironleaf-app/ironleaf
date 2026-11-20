// node --test tests/plain-status-words.test.mjs — Vault status in plain words (5 Nov 2026,
// the plan "Vault: status in plain words"): filled chips and pills that carry status become
// plain words in text colour across all of Vault — "2 days late" in the attention colour, "Today"
// and "On track" in muted — one date reader for every task surface (late, today, tomorrow, weekday
// with date), one word for late ("late", never "overdue"), no raw ISO anywhere. Status colours stay
// equal to the former host app's (--ns-* tokens, tests/status-colour.test.mjs). Each check fails
// without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

// The one date reader lives in shared/due-words.ts and every task surface reads through it.
test('one date reader exists and every task surface reads through it', () => {
  const due = read('src/shared/due-words.ts');
  assert.ok(due.includes('export function formatDue'), 'shared/due-words.ts exports formatDue');
  assert.ok(due.includes('Yesterday'), 'late by one reads as Yesterday, a day not arithmetic');
  const code = due.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/overdue/i.test(code), 'the one reader never says overdue');
  for (const [file, mark] of [
    ['src/shared/projects-87.ts', 'due-words'],
    ['src/renderer/src/components/plan/plan.ts', 'due-words'],
    ['src/renderer/src/lib/projectLook.ts', 'due-words'],
    ['src/shared/hub.ts', 'due-words'],
  ]) {
    assert.ok(read(file).includes(mark), `${file} reads through the one reader`);
  }
});

// Late is "late" everywhere, never "overdue"; yesterday is Yesterday; today and tomorrow plain.
test('one word for late, yesterday as a day, no weekday alone', () => {
  const look = read('src/renderer/src/lib/projectLook.ts');
  assert.ok(!/overdue/i.test(look.split('export function dueWords')[1].split('export ')[0]), 'dueWords never says overdue');
  const tag = read('src/shared/projects-87.ts');
  // taskDueTag no longer returns a bare weekday ("Fri" alone is ambiguous across weeks).
  assert.ok(!/TAG_WEEKDAYS\[d\.getDay\(\)\]/.test(tag) || tag.includes('due-words'), 'this-week tags carry the date with the weekday');
  const plan = read('src/renderer/src/components/plan/plan.ts');
  assert.ok(plan.includes('Yesterday') || plan.includes('due-words'), 'the plan readers say Yesterday for late by one');
});

// Status and date pills render as plain words: no fill, no dot, attention for late only.
test('StatusPill and DatePill are plain words, attention for late, muted otherwise', () => {
  const status = read('src/renderer/src/components/plan/StatusPill.tsx');
  assert.ok(!status.includes('plan-pill'), 'StatusPill wears no pill class');
  assert.ok(!status.includes('<span className="dot"'), 'StatusPill carries no dot');
  assert.ok(/plain|status-words|is-attention|is-muted/.test(status), 'StatusPill renders plain words with a tone');
  const date = read('src/renderer/src/components/plan/DatePill.tsx');
  assert.ok(!date.includes('plan-pill'), 'DatePill wears no pill class');
  assert.ok(!date.includes('<span className="dot"'), 'DatePill carries no dot');
  const css = read('src/renderer/src/styles/plan.css');
  // The plain words rule exists and late reads attention while today and on-track read muted.
  assert.ok(css.includes('.plan-status-words') || css.includes('.plan-words'), 'plan.css carries the plain-words rule');
  assert.ok(/\.plan-status-words[^{]*\{[^}]*--ns-attention-words/s.test(css) || /\.is-attention[^{]*\{[^}]*--ns-attention-words/s.test(css), 'late words read the attention colour');
});

// Owner chips are plain too: no filled box, the name in text colour.
test('OwnerChip is plain, never a filled box', () => {
  const chip = read('src/renderer/src/components/plan/OwnerChip.tsx');
  assert.ok(!chip.includes('plan-chip'), 'OwnerChip wears no chip class');
  const css = read('src/renderer/src/styles/plan.css');
  assert.ok(css.includes('.plan-owner-words') || css.includes('.plan-owner'), 'plan.css carries the plain owner rule');
});

// Task rows: when is plain words already; today reads quiet, never coral.
test('task rows read today quiet, late alone in the attention colour', () => {
  const plan = read('src/renderer/src/components/plan/plan.ts');
  // whenTone: only late (offset < 0) is coral; today and future are quiet.
  const tone = plan.split('export function whenTone')[1].split('}')[0];
  assert.ok(/offset\s*<\s*0/.test(tone) && !/offset\s*<=\s*0/.test(tone), 'whenTone corals late only, not today');
});

// No raw ISO on any task surface: board cards and meeting heads spell their days.
test('no raw ISO on task surfaces', () => {
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(tasks.includes('dailyTitleWords') || tasks.includes('noteTitleWords') || tasks.includes('due-words'), 'board and list rows spell daily-note days, never 2026-11-06');
  const note = read('src/renderer/src/views/NoteView.tsx');
  assert.ok(note.includes('bareTitle') || note.includes('noteDisplayTitle') || note.includes('MeetingTop'), 'meeting heads never show 2026-11-05 Supplier call raw');
});
