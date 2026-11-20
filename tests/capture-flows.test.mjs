// node --test tests/capture-flows.test.mjs — "Capture to…" (src/shared/capture-flows.ts, src/main/capture-flows.ts; 21 Oct
// 2026, gap G27): flows kept only as they make sense, a project's log beside its file, the line written with the date and
// time (or the time, or as a task), added at the end of its heading's section with everything else kept, and a capture
// through the main side to the Inbox, today's note, a note and a project's log (made the first time, linked to the
// project). A fixed now (Wednesday 21 October 2026, 2:05 pm).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-capture-flows-'));
let C;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/capture-flows.ts'))};\nexport { captureToFlow, INBOX } from ${JSON.stringify(path.join(root, 'src/main/capture-flows.ts'))};\nexport { mergePrefs, DEFAULT_PREFS } from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'c.mjs'), format: 'esm' }, logLevel: 'silent' });
  C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 9, 21, 14, 5);

test('flows are kept only as they make sense; Settings starts with a project log and the Inbox', () => {
  assert.deepEqual(C.DEFAULT_PREFS.captureFlows.map((f) => f.target), ['project-log', 'inbox']);
  const flows = C.cleanFlows([
    { id: 'log', name: ' Harbour log ', target: 'project-log', project: 'Projects/Harbour/Harbour.md', heading: '## Site log', stamp: 'time', kind: 'task' },
    { id: 'log', target: 'inbox' },
    { target: 'note' },
    { target: 'note', note: '../outside.md' },
    { target: 'note', note: 'Areas/Ideas.md', heading: 'Ideas [x] <b>' },
    { target: 'nowhere' },
    'junk',
  ]);
  assert.deepEqual(flows, [
    { id: 'log', name: 'Harbour log', target: 'project-log', project: 'Projects/Harbour/Harbour.md', heading: 'Site log', stamp: 'time', kind: 'task' },
    { id: 'log-2', name: 'The Inbox note', target: 'inbox', heading: 'Captured', stamp: 'date-time', kind: 'line' },
    { id: 'flow-3', name: 'A note', target: 'note', note: 'Areas/Ideas.md', heading: 'Ideas x b', stamp: 'date-time', kind: 'line' },
  ]);
  assert.equal(C.cleanFlows(Array.from({ length: 9 }, () => ({ target: 'inbox' }))).length, C.MAX_FLOWS);
  assert.equal(C.cleanFlows('nope'), C.DEFAULT_FLOWS);
  // Through Settings' own check.
  assert.deepEqual(C.mergePrefs(C.DEFAULT_PREFS, { captureFlows: [{ target: 'daily' }] }).captureFlows, [{ id: 'flow-1', name: 'Today’s note', target: 'daily', heading: 'Captured', stamp: 'date-time', kind: 'line' }]);
  assert.equal(C.mergePrefs(C.DEFAULT_PREFS, { captureFlows: 7 }).captureFlows, C.DEFAULT_PREFS.captureFlows);
});

test('a project’s log is Log.md beside the project’s file, linked to the project', () => {
  assert.equal(C.projectLogPath('Projects/Harbour/Harbour.md', 'Harbour'), 'Projects/Harbour/Log.md');
  assert.equal(C.projectLogPath('Harbour.md', 'Harbour: "Stage 2"'), 'Harbour Stage 2 log.md');
  assert.equal(C.newLogText('Harbour'), '---\nproject: "[[Harbour]]"\n---\n# Harbour log\n');
});

test('the lines: with the date and time, the time, or as a task; more lines indented under the first', () => {
  assert.deepEqual(C.flowLines('Crane booked for Monday', { stamp: 'date-time', kind: 'line' }, NOW), ['- 21 Oct 2026 14:05 — Crane booked for Monday']);
  assert.deepEqual(C.flowLines('Crane booked', { stamp: 'time', kind: 'line' }, NOW), ['- 14:05 — Crane booked']);
  assert.deepEqual(C.flowLines('Ring the mill', { stamp: 'time', kind: 'task' }, NOW), ['- [ ] Ring the mill — 14:05']);
  assert.deepEqual(C.flowLines('[ ] Ring the mill', { stamp: 'date-time', kind: 'line' }, NOW), ['- [ ] Ring the mill — 21 Oct 2026 14:05'], 'starting with [ ] makes it a task');
  assert.deepEqual(C.flowLines('First\r\nsecond\n\nthird', { stamp: 'time', kind: 'line' }, NOW), ['- 14:05 — First', '  second', '  ', '  third']);
});

test('added at the end of its heading’s section, newest last; everything else kept as written', () => {
  const note = '# Harbour log\n\n## Log\n\n- 20 Oct 2026 09:00 — Site visit\n\n## Decisions\n\nKeep the old sign.\n';
  assert.equal(C.appendCapture(note, 'Crane booked', { heading: 'Log', stamp: 'date-time', kind: 'line' }, NOW), '# Harbour log\n\n## Log\n\n- 20 Oct 2026 09:00 — Site visit\n- 21 Oct 2026 14:05 — Crane booked\n\n## Decisions\n\nKeep the old sign.\n');
  // No such heading yet: made at the end.
  assert.equal(C.appendCapture('# Inbox\n', 'Idea', { heading: 'Captured', stamp: 'time', kind: 'line' }, NOW), '# Inbox\n\n## Captured\n\n- 14:05 — Idea\n');
  // Windows line ends stay.
  assert.equal(C.appendCapture('# A\r\n', 'B', { heading: 'Log', stamp: 'time', kind: 'line' }, NOW), '# A\r\n\r\n## Log\r\n\r\n- 14:05 — B\r\n');
});

test('captured through the main side: the Inbox, today’s note, a note, a project’s log made the first time', async () => {
  const files = new Map([['Inbox.md', '# Inbox\n'], ['Areas/Ideas.md', '# Ideas\n\nSome words.\n'], ['Daily/2026-10-21.md', '# Wednesday\n']]);
  let allowed = true;
  const host = {
    flows: () => [
      { id: 'inbox', name: 'Inbox', target: 'inbox', heading: 'Captured', stamp: 'date-time', kind: 'line' },
      { id: 'day', name: 'Today', target: 'daily', heading: 'Captured', stamp: 'time', kind: 'line' },
      { id: 'ideas', name: 'Ideas', target: 'note', note: 'Areas/Ideas.md', heading: 'Ideas', stamp: 'time', kind: 'line' },
      { id: 'log', name: 'Project log', target: 'project-log', project: '', heading: 'Log', stamp: 'date-time', kind: 'line' },
      { id: 'harbour', name: 'Harbour log', target: 'project-log', project: 'Projects/Harbour/Harbour.md', heading: 'Log', stamp: 'time', kind: 'task' },
    ],
    readNote: async (rel) => files.get(rel) ?? null,
    writeNote: async (rel, text) => void files.set(rel, text),
    dailyNote: async () => 'Daily/2026-10-21.md',
    projectName: (p) => (p === 'Projects/Harbour/Harbour.md' ? 'Harbour' : null),
    requireCreate: async () => {
      if (!allowed) throw new Error('Needs the licence.');
    },
    now: () => NOW,
  };
  assert.deepEqual(await C.captureToFlow(host, 'inbox', 'Call the council'), { path: 'Inbox.md', words: 'Added to the Inbox.' });
  assert.equal(files.get('Inbox.md'), '# Inbox\n\n## Captured\n\n- 21 Oct 2026 14:05 — Call the council\n');
  assert.equal((await C.captureToFlow(host, 'day', 'Lunch with Sam')).words, 'Added to today’s note.');
  assert.ok(files.get('Daily/2026-10-21.md').endsWith('## Captured\n\n- 14:05 — Lunch with Sam\n'));
  await C.captureToFlow(host, 'ideas', 'A loyalty card');
  assert.equal(files.get('Areas/Ideas.md'), '# Ideas\n\nSome words.\n\n## Ideas\n\n- 14:05 — A loyalty card\n');
  // A log that asks which project: given one; made the first time, linked to the project.
  assert.deepEqual(await C.captureToFlow(host, 'log', 'Crane booked', 'Projects/Harbour/Harbour.md'), { path: 'Projects/Harbour/Log.md', words: 'Added to Harbour’s log.' });
  assert.equal(files.get('Projects/Harbour/Log.md'), '---\nproject: "[[Harbour]]"\n---\n# Harbour log\n\n## Log\n\n- 21 Oct 2026 14:05 — Crane booked\n');
  await C.captureToFlow(host, 'harbour', 'Order signage');
  assert.ok(files.get('Projects/Harbour/Log.md').endsWith('- 21 Oct 2026 14:05 — Crane booked\n- [ ] Order signage — 14:05\n'));
  await assert.rejects(C.captureToFlow(host, 'log', 'No project said'), /Which project/);
  await assert.rejects(C.captureToFlow(host, 'log', 'Gone', 'Projects/Old/Old.md'), /isn’t in your notes/);
  await assert.rejects(C.captureToFlow(host, 'inbox', '   '), /Write something/);
  await assert.rejects(C.captureToFlow(host, 'missing', 'x'), /isn’t in Settings/);
  allowed = false;
  await assert.rejects(C.captureToFlow(host, 'inbox', 'x'), /licence/);
});
