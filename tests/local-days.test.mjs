// node --test tests/local-days.test.mjs — a day Ironleaf names is the PC's own day (25 Oct 2026). Publications' "Start
// the next edition" sent the next edition's time in world time cut to its date, so an edition out at 8 am Saturday in
// Melbourne was dated Friday; the vault export's name, a project's "updated" day, the assistant's file dates and Health's
// "moved in" did the same before 11 am. A Date turned into YYYY-MM-DD with toISOString is world time: only a date that is
// already midnight in world time (a YAML date, a day number, calendar arithmetic in UTC) may be cut that way.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = readdirSync(src, { recursive: true }).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts'));
const CUT = /toISOString\(\)\.(?:slice|substring)\(0, ?10\)|toISOString\(\)\.split\('T'\)\[0\]|\.at\.slice\(0, ?10\)/;
// Each allowed cut, by file and the words on its line: the date is already world-time midnight.
const ALLOWED = [
  ['renderer/src/views/workspace/RecordTime.tsx', 'new Date(day * DAY)'], // a day number
  ['renderer/src/views/project/LayoutCharts.tsx', 'new Date(x0)'], // the chart's day axis, in day numbers
  ['renderer/src/views/project/LayoutCharts.tsx', 'new Date(x1 + 43200000)'],
  ['shared/family.ts', 'v instanceof Date'], // YAML dates
  ['shared/note-page.ts', 'v instanceof Date'],
  ['shared/note-rail.ts', 'v instanceof Date'],
  ['main/indexer.ts', 'v instanceof Date'], // YAML dates on the graph's cards (29 Oct 2026) // YAML dates (the note's context rail, 29 Oct 2026)
  ['shared/today.ts', 'v instanceof Date'],
  ['shared/views.ts', 'first instanceof Date'],
  ['shared/flashcards.ts', 'return t.toISOString()'], // calendar arithmetic in UTC (addDaysIso)
  ['renderer/src/components/Peek.tsx', 'getTimezoneOffset()'], // shifted to local first
  ['main/indexer.ts', 'getTimezoneOffset()'],
];

test('no Date is cut to its world-time date unless it already is one', () => {
  const found = [];
  for (const f of files) {
    const rel = f.split(path.sep).join('/');
    readFileSync(path.join(src, f), 'utf8').split('\n').forEach((line, i) => {
      if (CUT.test(line) && !ALLOWED.some(([file, words]) => file === rel && line.includes(words))) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(found, [], 'use isoOf(new Date(...)) from src/shared/finance.ts for the PC\'s own day');
});

test('the next edition is dated by the PC\'s own day', () => {
  const archive = readFileSync(path.join(src, 'renderer/src/views/modules/publications/Archive.tsx'), 'utf8');
  assert.match(archive, /newEdition\(cur\.pub\.path, \{ date: next \? isoOf\(new Date\(next\.at\)\) : undefined \}\)/);
});
