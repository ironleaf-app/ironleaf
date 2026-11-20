// node --test tests/today-deep.test.mjs — Today shows five, but a deep backlog stays one click away (b6 break job,
// Nov 2026: with forty tasks overdue the most urgent must lead the five — at-risk work first, then the longest
// waiting — and every one of the forty must open in one click, as must a task due today past the five and the day's
// meetings). The rank is the one rank (rankAllFor: steps and note lines together); the fold and All tasks carry the
// rest; the agenda lists the meetings with its own Show all. Invented work throughout.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-today-deep-'));
let B;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as brief from ${JSON.stringify(path.join(root, 'src/shared/brief-tasks.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'b.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = (await import(pathToFileURL(path.join(work, 'b.mjs')).href)).brief;
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 4, 10, 0);
// Tone as buildToday reads it from a project's health: 'warn'/'bad' is work in a project at risk.
const step = (what, offset, tone = 'ok') => ({ what, who: 'Mia Tran', when: `${4 + offset} Nov 2026`, offset, project: 'Projects/Bakery Launch/Bakery Launch.md', projectName: 'Bakery Launch', stale: false, atRisk: tone !== 'ok', tone, kind: 'step' });

test('forty overdue: the most urgent leads the five, and the other thirty-five wait in the one rank', () => {
  const steps = [];
  for (let i = 0; i < 40; i++) steps.push(step(`Overdue job ${i + 1}`, -(i + 1), i === 7 ? 'warn' : 'ok'));
  const five = B.topFiveFor(steps, [], NOW);
  assert.equal(five.length, 5, 'at most five');
  const whats = five.map((w) => (w.kind === 'step' ? w.step.what : ''));
  assert.deepEqual(whats, ['Overdue job 8', 'Overdue job 30', 'Overdue job 29', 'Overdue job 28', 'Overdue job 27'], 'due work in a project at risk first, then the longest waiting; stale never leads');
  const all = B.rankAllFor(steps, [], NOW).map((w) => (w.kind === 'step' ? w.step.what : ''));
  assert.equal(all.length, 40, 'the one rank holds every one: nothing falls out between the five and the fold');
  assert.deepEqual(all.slice(-3), ['Overdue job 38', 'Overdue job 39', 'Overdue job 40'], 'stale ranks last, least-stale first');
});

test('the rest opens in one click: the fold, All tasks, and the meetings’ own Show all', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('data-section="also"') && src.includes('All tasks'), 'Also’s head carries All tasks beside it: every overdue task in one click');
  assert.ok(src.includes('Show all ${items.length}') || src.includes('Show all ${items.length}'), 'each folded group opens whole in one click');
  const parts = read('src/renderer/src/views/today/DayParts.tsx');
  assert.ok(parts.includes('Show all ${day.meetings.length}'), 'the day’s meetings list whole in one click too');
});
