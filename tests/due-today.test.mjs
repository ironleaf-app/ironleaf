// node --test tests/due-today.test.mjs — the day's dated tasks reach the former host app's bell once, on their day, as
// one line (src/main/due-today.ts; 8.0 TR8 4a): never a notice each, never a reminder line (it says itself), never a
// Private note, never before the morning, never twice (a restart included).
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-due-today-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/due-today.ts'))};`);
  await build({ input: entry, platform: 'node', external: [/^node:/], output: { file: path.join(work, 'due.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'due.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const task = (words, o = {}) => ({ key: words, path: 'Notes/Jobs.md', title: 'Jobs', line: 1, project: null, projectName: null, people: [], allTags: [], mtime: 0, done: false, mark: ' ', text: words, words, due: '2026-10-30', time: null, reminder: false, repeats: false, tags: [], links: [], ...o });

test('one line on the day, listing the day’s tasks, said once', async () => {
  const said = [];
  let clock = new Date(2026, 9, 30, 6, 30).getTime();
  const view = { today: '2026-10-30', tasks: [task('Pay the plumber', { projectName: 'Kitchen' }), task('Call Mia'), task('Ring the bank', { due: '2026-10-31' }), task('Done one', { done: true }), task('Rego', { reminder: true }), task('Diary thing', { path: 'Private notes/Diary.md' })] };
  const d = new M.DueToday({ tasks: () => view, add: (n) => said.push(n), file: path.join(work, 'due.json'), now: () => clock });
  assert.equal(await d.check(), false, 'not before the morning');
  clock = new Date(2026, 9, 30, 8, 0).getTime();
  assert.equal(await d.check(), true);
  assert.equal(said.length, 1, 'one notice, not one each');
  assert.equal(said[0].title, 'Due today: 2 tasks');
  assert.equal(said[0].body, 'Pay the plumber (Kitchen) · Call Mia', 'only today’s open dated tasks: no reminder line, no Private note, no other day');
  assert.equal(said[0].kind, 'reminder');
  assert.equal(await d.check(), false, 'once a day');
  const again = new M.DueToday({ tasks: () => view, add: (n) => said.push(n), file: path.join(work, 'due.json'), now: () => clock });
  assert.equal(await again.check(), false, 'a restart says nothing twice');
  assert.equal(M.dueTodayWords(Array.from({ length: 6 }, (_, i) => task('T' + i))).body, 'T0 · T1 · T2 · T3 · and 2 more');
});

test('a day with nothing due says nothing; outside the host app there is no bell', async () => {
  const said = [];
  const d = new M.DueToday({ tasks: () => ({ today: '2026-10-30', tasks: [] }), add: (n) => said.push(n), file: path.join(work, 'none.json'), now: () => new Date(2026, 9, 30, 9).getTime() });
  assert.equal(await d.check(), false);
  assert.equal(said.length, 0);
  assert.equal(await new M.DueToday({ tasks: () => ({ today: '2026-10-30', tasks: [task('x')] }), file: path.join(work, 'x.json'), now: () => new Date(2026, 9, 30, 9).getTime() }).check(), false);
});

test('a day-file that cannot be read is backed up and said, never lost silently (9.5 fourth pass)', async () => {
  const dir = mkdtempSync(path.join(work, 'due-corrupt-'));
  const file = path.join(dir, 'due.json');
  writeFileSync(file, 'not json{');
  const logged = [];
  const said = [];
  const view = { today: '2026-10-30', tasks: [task('Pay the plumber')] };
  const d = new M.DueToday({ tasks: () => view, add: (n) => said.push(n), file, now: () => new Date(2026, 9, 30, 8, 0).getTime(), log: (m) => logged.push(m) });
  assert.equal(await d.check(), true);
  assert.equal(said.length, 1);
  assert.equal(logged.length, 1, 'the corrupt file is said');
  assert.ok(readdirSync(dir).some((n) => n.startsWith('due.json.corrupt-')), 'kept beside it as evidence');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { day: '2026-10-30' }, 'a fresh day-file written');
});

test('when the bell cannot take the line, it is tried again, never lost (9.5 fourth pass)', async () => {
  const file = path.join(work, 'due-retry.json');
  let fail = true;
  const said = [];
  const view = { today: '2026-10-30', tasks: [task('Pay the plumber')] };
  const d = new M.DueToday({
    tasks: () => view,
    add: (n) => { if (fail) throw new Error('bell closed'); said.push(n); },
    file,
    now: () => new Date(2026, 9, 30, 8, 0).getTime(),
    log: () => {},
  });
  assert.equal(await d.check(), false, 'not said: tried again next check');
  assert.equal(said.length, 0);
  fail = false;
  assert.equal(await d.check(), true);
  assert.equal(said.length, 1);
});
