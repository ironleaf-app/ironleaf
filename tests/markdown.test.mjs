// node --test tests/markdown.test.mjs — shared Markdown line shapes (src/shared/markdown.ts; 9.5 fourth pass): the one
// fenced-code rule every note scan follows, and the one tick-box pattern every task reader shares. Made-up lines.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-markdown-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const run = (lines) => {
  let fence = null;
  return lines.map((l) => {
    const st = M.trackFence(l, fence);
    fence = st.fence;
    return st.skip;
  });
};

test('a fence closes on its own run: ``` never closes ````', () => {
  assert.deepEqual(run(['````', '- [ ] inside', '```', '- [ ] still inside', '````', '- [ ] out']), [true, true, true, true, true, false]);
  assert.deepEqual(run(['```js', 'code', '```', 'out']), [true, true, true, false]);
  assert.deepEqual(run(['~~~', '```', '~~~']), [true, true, true], 'the other run never closes');
  assert.deepEqual(run(['  ```', 'code', '  ```', 'out']), [true, true, true, false], 'indented fences count');
});

test('the one tick-box pattern: every list, its mark and its words', () => {
  const m = (line) => M.TASK_LINE.exec(line)?.slice(1) ?? null;
  assert.deepEqual(m('- [ ] Call Sam'), ['- [', ' ', '] ', 'Call Sam']);
  assert.deepEqual(m('  12. [x] Numbered'), ['  12. [', 'x', '] ', 'Numbered']);
  assert.deepEqual(m('* [/] Halfway'), ['* [', '/', '] ', 'Halfway']);
  assert.equal(m('- [ ]'), null, 'no words: not a task');
  assert.equal(m('- just words'), null);
});

// m4-minutes-clean fault 7: the file name cannot hold a colon, but the note's displayed title still must.
// A `title:` in the properties is the display title when it is this file's own (its safe file name matches),
// else stale (renamed) and the file name wins.
test('m4: the displayed title keeps a colon its file name cannot hold', () => {
  const file = 'Meetings/2026-11-06 Fitzroy cafe opening weekly.md';
  assert.equal(M.displayTitle(file, { title: '2026-11-06 Fitzroy cafe opening: weekly' }), '2026-11-06 Fitzroy cafe opening: weekly', 'the colon kept');
  assert.equal(M.displayTitle(file, {}), '2026-11-06 Fitzroy cafe opening weekly', 'no title: the file name');
  assert.equal(M.displayTitle(file, { title: '2026-11-07 Other meeting' }), '2026-11-06 Fitzroy cafe opening weekly', 'stale (renamed): the file name wins');
});

// m7-minutes-last faults 3+4 (6 Nov 2026, the second Fitzroy meeting showed "Fitzroy cafe opening weekly 2" —
// its colon lost, its file's copy number shown as its name): `title:` wins when its safe file name is the file's
// name without that number. The number belongs to the file only.
test('m7: a copy number stays on the file; the displayed title keeps the colon', () => {
  const file = 'Meetings/2026-11-06 Fitzroy cafe opening weekly 2.md';
  assert.equal(M.displayTitle(file, { title: '2026-11-06 Fitzroy cafe opening: weekly' }), '2026-11-06 Fitzroy cafe opening: weekly', 'colon kept, no number');
  const plain = 'Meetings/2026-11-06 Cart retry standup 2.md';
  assert.equal(M.displayTitle(plain, { title: '2026-11-06 Cart retry standup' }), '2026-11-06 Cart retry standup', 'typed words, no number');
  assert.equal(M.displayTitle(plain, {}), '2026-11-06 Cart retry standup 2', 'no title: the file name');
  assert.equal(M.displayTitle(plain, { title: '2026-11-07 Other meeting' }), '2026-11-06 Cart retry standup 2', 'stale (renamed): the file name wins');
});

// n4-minutes-pdf fault 3 (6 Nov 2026, the floating recording chip showed the file name without its colon):
// the person's title is what's shown everywhere — the recording chip, the recording cards, the recording and
// share toasts, and the assistant's PDF card all name the note by its display name, never the file's name.
test('n4: every meeting-title door shows the person’s title, never the file’s name', () => {
  const read = (f) => readFileSync(path.join(root, f), 'utf8');
  const actions = read('src/renderer/src/state/actions.ts');
  assert.ok(actions.includes('export const displayName') && actions.includes('byPath.get(path)?.title ?? titleOf(path)'), 'the one display name: the indexed title, else the file name');
  const pill = read('src/renderer/src/components/RecordingPill.tsx');
  assert.ok(pill.includes('A.displayName(live.note') && pill.includes('A.displayName(job.note)'), 'the floating chip names the live note and unfinished jobs by it');
  assert.ok(!pill.includes('A.titleOf('), 'the chip never the file name');
  assert.ok(read('src/renderer/src/views/MeetingRecorder.tsx').includes('A.displayName(v.note'), 'the note’s recording card names it by it');
  assert.ok(read('src/renderer/src/views/modules/work/MeetingsPage.tsx').includes('A.displayName(v.live.note'), 'the meetings page names it by it');
  assert.ok(read('src/renderer/src/state/recorder.ts').includes('A.displayName(live.note'), 'the recording toast names it by it');
  assert.ok(read('src/renderer/src/state/share.ts').includes('A.displayName(notePath)'), 'Kept with this note names it by it');
  const agent = read('src/main/agent-access.ts');
  assert.ok(agent.includes('from the note ${quote(title)}'), 'the assistant’s PDF card names the note by its indexed title');
  assert.ok(!agent.includes('from the note ${quote(titleOf(rel))}'), 'never the file name there');
});
