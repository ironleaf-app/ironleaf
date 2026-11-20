// node --test tests/unified-tasks.test.mjs — One Task (t238 vault rebuild step 1, 12 Nov 2026). Next step,
// action, to-do, follow-up, reminder-as-task, run-sheet box and Waiting are one kind: Task. Where it was written
// is its source, shown as small words under the row, never a second copy. "Waiting on someone" is a state (owned
// by someone else, or marked waiting), not a list. Made-up notes; a fixed now.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-unified-tasks-'));
let U;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/unified-tasks.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'u.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  U = await import(pathToFileURL(path.join(work, 'u.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date('2026-11-12T09:00:00');
const ME = 'Priya Nair';
const KNOWN = ['Priya Nair', 'Alex Chen', 'Sam Ortega', 'June Park'];
const PROJ = 'Projects/Harbourline Cart Fix.md';

const step = (what, who, extra = {}) => U.stepRow({ what, ...(who ? { who } : {}) }, 0, PROJ, 'Harbourline Cart Fix', 'Harbourline Cart Fix');
const line = (words, owner, p, kind, title, extra = {}) => ({
  words,
  text: words,
  owner,
  due: null,
  done: false,
  project: p,
  projectName: p ? 'Harbourline Cart Fix' : null,
  home: { path: p === PROJ && kind === 'project' ? PROJ : `${kind}-note.md`, line: 3 },
  source: U.sourceOf(kind, `${kind}-note.md`, title),
  ...extra,
});

test('a step and its meeting line merge into one task with two sources', () => {
  const rows = mergeQuiet([
    step('Send the receipt v2 for review', 'Alex Chen'),
    line('Send the receipt v2 for review — Alex Chen', 'Alex Chen', PROJ, 'meeting', '2026-11-10 Tuesday standup'),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sources.length, 2);
  assert.deepEqual(rows[0].sources.map((s) => s.label), ['in Harbourline Cart Fix', 'from 2026-11-10 Tuesday standup']);
  assert.deepEqual(rows[0].homes.length, 2);
  assert.ok('index' in rows[0].primary, 'the project step is the home a tick writes first');
});

test('a differing owner stays two rows: no guessing', () => {
  const rows = mergeQuiet([
    step('Send the receipt v2 for review', 'Alex Chen'),
    line('Send the receipt v2 for review — Sam Ortega', 'Sam Ortega', PROJ, 'meeting', '2026-11-10 Tuesday standup'),
  ]);
  assert.equal(rows.length, 2);
});

test('near-repeats stay two rows', () => {
  const rows = mergeQuiet([
    step('Send the receipt v2 for review', 'Alex Chen'),
    line('Send the receipt v3 for review — Alex Chen', 'Alex Chen', PROJ, 'note', 'Scratch'),
  ]);
  assert.equal(rows.length, 2);
});

test('another project never merges', () => {
  const rows = mergeQuiet([
    step('Ring ShadeCo before Friday', ''),
    { ...line('Ring ShadeCo before Friday', '', 'Projects/Other.md', 'note', 'Scratch'), projectName: 'Other' },
  ]);
  assert.equal(rows.length, 2);
});

test('a homeless line folds against a live project row', () => {
  const rows = mergeQuiet([
    step('Ring ShadeCo before Friday', ''),
    line('Ring ShadeCo before Friday', '', null, 'note', '2026-11-12'),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sources.length, 2);
});

test('two homeless lines never merge', () => {
  const rows = mergeQuiet([
    line('Ring ShadeCo before Friday', '', null, 'note', '2026-11-11'),
    line('Ring ShadeCo before Friday', '', null, 'note', '2026-11-12'),
  ]);
  assert.equal(rows.length, 2);
});

test('done homes row as themselves: a disagreement stays visible', () => {
  const rows = mergeQuiet([
    step('Send the receipt v2 for review', 'Alex Chen'),
    line('Send the receipt v2 for review — Alex Chen', 'Alex Chen', PROJ, 'meeting', '2026-11-10 Tuesday standup', { done: true }),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.done).sort(), [false, true]);
});

test('a reminder rows as itself, never merged', () => {
  const rows = mergeQuiet([
    step('Ring ShadeCo before Friday', ''),
    line('Ring ShadeCo before Friday', '', PROJ, 'note', 'Scratch', { reminder: true }),
  ]);
  assert.equal(rows.length, 2);
});

test('the earliest day wins, never hiding lateness', () => {
  const rows = mergeQuiet([
    { ...step('Send the receipt v2 for review', 'Alex Chen'), due: '2026-11-14' },
    line('Send the receipt v2 for review — Alex Chen', 'Alex Chen', PROJ, 'meeting', '2026-11-10 Tuesday standup', { due: '2026-11-04' }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].due, '2026-11-04');
});

test('waiting is a state: someone else owns it', () => {
  const rows = mergeQuiet([step('Send the receipt v2 for review', 'Alex Chen')]);
  assert.equal(rows[0].waiting, true);
});

test('my own task never waits', () => {
  const rows = mergeQuiet([step('Send the receipt v2 for review', 'Priya Nair')]);
  assert.equal(rows[0].waiting, false);
});

test('a stranger never waits: a mention, never debt', () => {
  const rows = mergeQuiet([step('Send the receipt v2 for review', 'Lucy Hammond')]);
  assert.equal(rows[0].waiting, false);
});

test('marked waiting waits, whoever owns it', () => {
  const rows = mergeQuiet([line('Send the receipt v2 ⏳', 'Priya Nair', PROJ, 'note', 'Scratch')]);
  assert.equal(rows[0].waiting, true);
  const dated = mergeQuiet([line('Send the receipt v2 ⏳ 2026-11-20', 'Priya Nair', PROJ, 'note', 'Scratch')]);
  assert.equal(dated[0].waiting, false, 'a dated ⏳ is another app’s scheduled mark, never waiting');
});

test('sources read plain: inbox, note, project', () => {
  assert.equal(U.sourceLabel('inbox', 'Inbox'), 'in Inbox');
  assert.equal(U.sourceLabel('note', '2026-11-12 Thursday notes'), 'in Thursday notes');
  assert.equal(U.sourceLabel('project', 'Harbourline Cart Fix'), 'in Harbourline Cart Fix');
  assert.equal(U.sourceKindOf('Inbox.md', null), 'inbox');
  assert.equal(U.sourceKindOf('Inbox/a-note.md', null), 'inbox');
  assert.equal(U.sourceKindOf('Meetings/standup.md', PROJ, 'meeting'), 'meeting');
  assert.equal(U.sourceKindOf(PROJ, PROJ, 'project'), 'project');
  assert.equal(U.sourceKindOf('Notes/scratch.md', PROJ), 'note');
});

function mergeQuiet(rows) {
  return U.mergeTasks(rows, ME, KNOWN, NOW);
}
