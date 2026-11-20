// node --test tests/project-date-shape.test.mjs — a new date takes the shape the file already uses
// (p24-date-shape): a catch-up wrote "by 2026-11-06" and "by 9 Nov 2026" into one file whose other lines
// all say "by 29 Oct 2026". The model chose the shape; the shape should not depend on it. A new or changed
// date on a list line takes the shape the file already uses for dates on that list. A file with only ISO
// dates stays ISO. A file with none keeps the app's normal shape. Untouched lines keep their bytes;
// words that are not a real date stay as they are. Key dates and decisions go through the same path.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-project-date-shape-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/project-file.ts'), platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Made-up lighthouse project: every dated line says "29 Oct 2026".
const DMY_FILE = `---
type: project
status: active
---
# Lighthouse Roster

## What's next

- [ ] Oil the lamp housing — Harbor Team · by 29 Oct 2026
- [ ] Sweep the gallery deck — Harbor Team · by 29 Oct 2026

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| 29 Oct 2026 | Lamp serviced |  |

## Decisions

- **29 Oct 2026** — Keep the spare lens on site.
`;

test('a new ISO date in a dmy file takes the file shape; the dmy one stays', () => {
  const p = P.parseProject(DMY_FILE, 'Projects/Lighthouse/Lighthouse.md');
  P.applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: 'Calibrate the lamp timer', who: 'Harbor Team', when: '2026-11-06' } });
  P.applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: 'Confirm the ferry timetable', who: 'Harbor Team', when: '9 Nov 2026' } });
  const after = P.serializeProject(p, DMY_FILE);
  assert.ok(after.includes('Calibrate the lamp timer — Harbor Team · by 6 Nov 2026'), `ISO becomes dmy:\n${after}`);
  assert.ok(after.includes('Confirm the ferry timetable — Harbor Team · by 9 Nov 2026'), `dmy stays dmy:\n${after}`);
  assert.ok(!after.split('\n').some((l) => l.startsWith('- [ ]') && l.includes('2026-11-')), 'no ISO leaks into the steps');
  assert.ok(after.includes('- [ ] Oil the lamp housing — Harbor Team · by 29 Oct 2026'), 'untouched lines keep their bytes');
});

test('a changed date takes the file shape too', () => {
  const p = P.parseProject(DMY_FILE, 'Projects/Lighthouse/Lighthouse.md');
  P.applyProjectEdit(p, { kind: 'change', list: 'next', index: 0, item: { when: '2026-11-06' } });
  const after = P.serializeProject(p, DMY_FILE);
  assert.ok(after.includes('Oil the lamp housing — Harbor Team · by 6 Nov 2026'), `changed ISO becomes dmy:\n${after}`);
});

test('a file with only ISO dates stays ISO', () => {
  const iso = `---
type: project
status: active
---
# Lighthouse Roster

## What's next

- [ ] Oil the lamp housing — Harbor Team · by 2026-10-29
`;
  const p = P.parseProject(iso, 'Projects/Lighthouse/Lighthouse.md');
  P.applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: 'Calibrate the lamp timer', who: 'Harbor Team', when: '9 Nov 2026' } });
  const after = P.serializeProject(p, iso);
  assert.ok(after.includes('Calibrate the lamp timer — Harbor Team · by 2026-11-09'), `dmy becomes ISO:\n${after}`);
  assert.ok(after.includes('- [ ] Oil the lamp housing — Harbor Team · by 2026-10-29'), 'the ISO line keeps its bytes');
});

test('key dates and decisions take the same shape through the same path', () => {
  const p = P.parseProject(DMY_FILE, 'Projects/Lighthouse/Lighthouse.md');
  P.applyProjectEdit(p, { kind: 'add', list: 'dates', item: { when: '2026-11-06', what: 'Ferry trial' } });
  P.applyProjectEdit(p, { kind: 'add', list: 'decisions', item: { date: '2026-11-06', what: 'Order more lamp oil' } });
  const after = P.serializeProject(p, DMY_FILE);
  assert.ok(after.includes('| 6 Nov 2026 | Ferry trial |'), `key date becomes dmy:\n${after}`);
  assert.ok(after.includes('- **6 Nov 2026** — Order more lamp oil.'), `decision becomes dmy:\n${after}`);
});

test('words that are not a real date stay as they are', () => {
  const p = P.parseProject(DMY_FILE, 'Projects/Lighthouse/Lighthouse.md');
  P.applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: 'Repaint the door', who: 'Harbor Team', when: 'before the fog season' } });
  const after = P.serializeProject(p, DMY_FILE);
  assert.ok(after.includes('Repaint the door — Harbor Team · by before the fog season'), `condition stays:\n${after}`);
});

test('a file with none keeps the new date as the app wrote it', () => {
  const none = `---
type: project
status: active
---
# Lighthouse Roster

## What's next

- [ ] Oil the lamp housing — Harbor Team
`;
  const p = P.parseProject(none, 'Projects/Lighthouse/Lighthouse.md');
  P.applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: 'Calibrate the lamp timer', who: 'Harbor Team', when: '6 Nov 2026' } });
  const after = P.serializeProject(p, none);
  assert.ok(after.includes('Calibrate the lamp timer — Harbor Team · by 6 Nov 2026'), `no precedent keeps what was given:\n${after}`);
});

test('each list keeps its own shape (steps dmy, key dates ISO)', () => {
  const mixed = `---
type: project
status: active
---
# Lighthouse Roster

## What's next

- [ ] Oil the lamp housing — Harbor Team · by 29 Oct 2026

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| 2026-10-29 | Lamp serviced |  |
`;
  const p = P.parseProject(mixed, 'Projects/Lighthouse/Lighthouse.md');
  P.applyProjectEdit(p, { kind: 'add', list: 'next', item: { what: 'Calibrate the lamp timer', who: 'Harbor Team', when: '2026-11-06' } });
  P.applyProjectEdit(p, { kind: 'add', list: 'dates', item: { when: '9 Nov 2026', what: 'Ferry trial' } });
  const after = P.serializeProject(p, mixed);
  assert.ok(after.includes('Calibrate the lamp timer — Harbor Team · by 6 Nov 2026'), `steps stay dmy:\n${after}`);
  assert.ok(after.includes('| 2026-11-09 | Ferry trial |'), `key dates stay ISO:\n${after}`);
});
