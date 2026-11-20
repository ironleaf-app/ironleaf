// node --test tests/people-merge-timeline.test.mjs — one timeline with a person (src/shared/people.ts, 10.0
// papercuts): meetings, finished promises either way, notes and projects as one list, dated first and newest first
// (what is next on top), then the notes and projects with no day, by name. Open promises stay out (t12, 8 Nov 2026
// — they already read under You owe / Owes you, so the Timeline repeating them read every promise twice).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-people-tl-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/people.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const card = {
  meetings: [
    { id: 'm1', title: 'Kickoff', path: 'Meetings/Kickoff.md', date: '2026-10-20' },
    { id: 'm2', title: 'Site walk', path: 'Meetings/Site walk.md', date: '2026-11-10' },
    { id: 'm3', title: 'Undated chat', path: 'Meetings/Chat.md' },
  ],
  doneItems: [
    { id: 'a1', title: 'Sent the quote', path: 'Projects/Harbour.md', line: 12, date: '2026-11-05', side: 'you owe' },
    { id: 'a2', title: 'Approved the plan', path: 'Projects/Harbour.md', line: 20, side: 'they owe' },
  ],
  notes: [{ id: 'n1', title: 'Zebra notes', path: 'Notes/Zebra.md' }],
  projects: [{ id: 'p1', title: 'Harbour fit-out', path: 'Projects/Harbour.md' }],
};

test('dated first and newest first, each keeping its kind, side and finished mark', () => {
  const tl = P.personTimeline(card);
  assert.deepEqual(tl.map((e) => e.title), ['Site walk', 'Sent the quote', 'Kickoff', 'Approved the plan', 'Harbour fit-out', 'Undated chat', 'Zebra notes']);
  assert.deepEqual(tl.map((e) => e.kind), ['meeting', 'action', 'meeting', 'action', 'project', 'meeting', 'note']);
  assert.equal(tl[1].side, 'you owe');
  assert.equal(tl[3].side, 'they owe');
  assert.equal(tl[1].line, 12);
  assert.ok(tl[1].done && tl[3].done, 'timeline promises read finished');
});

test('an empty card is an empty timeline', () => {
  assert.deepEqual(P.personTimeline({ meetings: [], doneItems: [], notes: [], projects: [] }), []);
});
