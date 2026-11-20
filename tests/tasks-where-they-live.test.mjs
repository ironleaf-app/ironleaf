// node --test tests/tasks-where-they-live.test.mjs — v4-no-clutter item 4: a task is only written where it lives.
// Boxes are not written into daily notes (unprojected tasks default to the Inbox; a daily box naming a person routes
// onto their project), reports or summaries (the review and the weekly update carry none). Meeting actions stay boxes until filed — that is the filing flow's home, and counting is
// v1-one-list's.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-task-homes-'));
let C, P, R, T, W;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * as C from ${src('src/shared/capture.ts')};`,
      `export * as P from ${src('src/shared/prefs.ts')};`,
      `export * as R from ${src('src/shared/weekly-review.ts')};`,
      `export * as W from ${src('src/shared/weekly-updates.ts')};`,
      `export { routeNoteTask } from ${src('src/main/task-write.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 't.mjs')).href);
  ({ C, P, R, W } = all);
  T = { routeNoteTask: all.routeNoteTask };
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 9, 28, 10, 0, 0, 0);
const STORE = 'Projects/Studio Upgrade/Studio Upgrade.md';
const boxLine = /^(\s*(?:[*+-]|\d+[.)])\s+)\[[ xX]\] /m;

test('unprojected tasks default to the Inbox, never the daily note', () => {
  assert.equal(P.DEFAULT_PREFS.captureNoProject, 'inbox', 'the default sends tasks without a project to the Inbox');
  const plan = C.planCapture({ kind: 'task', text: 'Restock the flour', project: null, pictures: 0, files: 0, toAssets: false, noProject: 'inbox', dailyPath: 'Daily/2026-10-28.md', inboxPath: 'Inbox.md', attachmentsFor: () => 'Attachments', now: NOW });
  assert.equal(plan.append?.place, 'inbox', 'a task with no project goes to the Inbox');
  assert.equal(plan.append?.path, 'Inbox.md', 'into the Inbox note');
  const daily = C.planCapture({ kind: 'task', text: 'Restock the flour', project: null, pictures: 0, files: 0, toAssets: false, noProject: 'daily', dailyPath: 'Daily/2026-10-28.md', inboxPath: 'Daily/2026-10-28.md', attachmentsFor: () => 'Attachments', now: NOW });
  assert.equal(daily.append?.place, 'daily', 'the person’s own daily choice still works');
});

test('a daily box naming a person routes onto their project', () => {
  const deps = {
    index: { allMeta: () => [{ path: 'People/Sam Okafor.md', props: { type: 'person' } }] },
    dailyPath: 'Daily/2026-10-28.md',
    projects: () => [{ path: STORE, name: 'Studio Upgrade', owner: '', people: ['Sam Okafor'] }],
  };
  const routed = T.routeNoteTask(deps, 'Daily/2026-10-28.md', '- [ ] Send the signed quote — Sam Okafor');
  assert.equal(routed.kind, 'project', 'onto the project, not left as a box in the daily note');
  assert.equal(routed.project.path, STORE);
  const anon = T.routeNoteTask(deps, 'Daily/2026-10-28.md', '- [ ] Restock the flour');
  assert.equal(anon.kind, 'stay', 'with no person named, the person’s explicit daily ask stays');
});

test('the review and the weekly update carry no boxes', () => {
  const draft = {
    from: '2026-10-19',
    to: '2026-10-25',
    projects: [
      { path: STORE, name: 'Studio Upgrade', changed: [{ words: 'Menu page drafted' }], slipped: [], chase: [{ words: 'Chase the till receipts — Sam' }], proposals: [] },
    ],
  };
  const note = R.reviewNote(draft, [{ path: STORE, name: 'Studio Upgrade', applied: ['Health: on track → ahead'], left: ['Left the till receipts'] }], NOW);
  assert.ok(!boxLine.test(note), 'the review note carries no boxes');
  const update = W.newWeekly('2026-10-26', { path: 'Weekly/2026-10-19.md', week: '2026-10-19', audience: '', status: 'Draft', sent: '', sentBy: '', prepared: '', intro: '', sections: [{ name: 'Shop front', project: 'Studio Upgrade', flag: 'green', status: 'Menu page drafted.', progress: ['Till installed'], next: ['Train staff'], blockers: [], none: false, metrics: [], notes: '' }], attachments: [] });
  const text = W.writeWeekly(update);
  assert.ok(!boxLine.test(text), 'the weekly update carries no boxes');
});
