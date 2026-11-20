// node --test tests/life-setup.test.mjs — 8.0 R1–R6, the life modules: Set up your life grouped by the person's
// own areas, a tour remembered once seen, one chart kit in the assistant's words, a project's folder and The
// former host app's key kept in step both ways, Bills' one monthly sum, and empty module views leading with how
// they fill themselves. Made-up notes and folders only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-life-setup-'));
let L, P, F, T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'kit.ts');
  writeFileSync(
    entry,
    [
      `export * as L from ${JSON.stringify(path.join(root, 'src/shared/life-modules.ts'))};`,
      `export * as P from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
      `export * as F from ${JSON.stringify(path.join(root, 'src/shared/finance.ts'))};`,
      `export * as T from ${JSON.stringify(path.join(root, 'src/renderer/src/state/moduleFills.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'kit.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ L, P, F, T } = await import(pathToFileURL(path.join(work, 'kit.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

test('R1+R2: Set up your life groups every module under the person’s own area names, in their order', () => {
  const renamed = [
    { id: 'me', name: 'My life', folder: 'Me' },
    { id: 'home', name: 'Household', folder: 'Home' },
  ];
  const groups = L.modulesByArea(L.LIFE_MODULES, renamed, []);
  // Every module is in exactly one group, under the renamed area where it belongs.
  assert.deepEqual(groups.flatMap((g) => g.mods.map((m) => m.id)).sort(), L.LIFE_MODULES.map((m) => m.id).sort());
  assert.equal(groups.find((g) => g.id === 'me')?.name, 'My life');
  assert.ok(groups.find((g) => g.id === 'me')?.mods.some((m) => m.id === 'finance'));
  assert.equal(groups[0].id, 'me', 'the person’s area order comes first');
  // Without a setting, the defaults name the groups; a module’s own area still shows.
  const plain = L.modulesByArea(L.LIFE_MODULES, null, [{ id: 'me', name: 'Me', folder: 'Me' }]);
  assert.equal(plain.find((g) => g.id === 'me')?.name, 'Me');
  assert.ok(plain.find((g) => g.id === 'health'));
});

test('R1: a tour is unseen, then seen for good, then shown again only when asked', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  try {
    assert.equal(T.tourSeen('vehicles'), false);
    T.setTourSeen('vehicles', true);
    assert.equal(T.tourSeen('vehicles'), true, 'once done it is never shown again');
    assert.equal(T.tourSeen('finance'), false, 'each module has its own tour');
    T.setTourSeen('vehicles', false);
    assert.equal(T.tourSeen('vehicles'), false, 'Show its tour brings it back');
  } finally {
    delete globalThis.localStorage;
  }
  assert.equal(T.tourSeen('vehicles'), true, 'with no store to remember it, it stays away rather than nagging');
});

test('R3: the assistant is told one chart kit, never a second way to chart', () => {
  const agent = readFileSync(path.join(root, 'src/main/agent.ts'), 'utf8');
  assert.match(agent, /write a \\`\\`\\`chart block/);
  assert.doesNotMatch(agent, /A chart in a note is a .*mermaid block/);
});

test('R4: a project’s folder and the host app’s key stay in step, both ways', () => {
  // The former host app’s workspace folder written into the project file: the key follows it.
  const made = P.parseProject('---\ntype: project\nfolder: C:\\Work\\Harbour\n---\n# Harbour\n\n## Summary\n\nA fit-out.\n');
  assert.equal(made.folder, 'C:\\Work\\Harbour');
  assert.equal(made.key, 'local:c:/work/harbour');
  // A stale key is corrected from the folder field, never the other way round.
  const stale = P.parseProject('---\ntype: project\nfolder: /home/pat/site\nneuralspark-project: local:/old/place\n---\n# Site\n');
  assert.equal(stale.key, 'local:/home/pat/site');
  // Written back, the file carries the folder’s own key.
  const out = P.serializeProject({ ...P.emptyProject('Harbour'), folder: '/home/pat/site', summary: 'A fit-out.' });
  assert.match(out, /folder: \/home\/pat\/site/);
  assert.match(out, /neuralspark-project: local:\/home\/pat\/site/);
  // A remote workspace’s key is kept, and a folderless project keeps its key.
  const remote = 'remote:123e4567-e89b-42d3-a456-426614174000:/home/deploy/site';
  assert.equal(P.linkedKey(undefined, remote), remote);
  assert.equal(P.linkedKey('/home/pat/site', remote), remote);
  assert.equal(P.parseProject(`---\ntype: project\nneuralspark-project: local:/srv/mc\n---\n# MC\n`).key, 'local:/srv/mc');
});

test('R5: Bills’ monthly sum is the one sum, by cycle, with paused and amount-less bills left out', () => {
  const note = (title, props) => ({ path: `Me/Finance/Bills/${title}.md`, title, type: 'bill', props, content: '' });
  const m = F.financeModel(
    [
      note('Internet', { amount: '89', cycle: 'Monthly', due: '2026-11-03', status: 'Active' }),
      note('Insurance', { amount: '960', cycle: 'Yearly', due: '2027-02-01', status: 'Active' }),
      note('Gym', { amount: '10', cycle: 'Weekly', due: '2026-11-02', status: 'Active' }),
      note('Old', { amount: '30', cycle: 'Monthly', due: '2026-01-05', status: 'Cancelled' }),
      note('Mystery', { cycle: 'Monthly', due: '2026-11-05', status: 'Active' }),
    ],
    new Date(2026, 9, 29),
  );
  // 89 a month + 960 a year (80) + 10 a week (43.33) = 212.33; the cancelled and amount-less bills add nothing.
  assert.equal(m.committed, 212.33);
  assert.equal(F.billsMonthlyTotal(m.bills), m.committed, 'the Bills page and the overview use the same sum');
  assert.equal(F.billsMonthlyTotal([{ monthly: 10 }, { monthly: null }, { monthly: 2.5 }]), 12.5);
});

test('R6: empty views inside a module lead with how it fills itself', () => {
  const view = readFileSync(path.join(root, 'src/renderer/src/views/workspace/RecordView.tsx'), 'utf8');
  assert.match(view, /ModuleFills/, 'the record views read the module they are inside');
  assert.match(view, /Fills itself\.<\/b> \{fills\}/);
  const start = readFileSync(path.join(root, 'src/renderer/src/views/modules/publications/StartPublication.tsx'), 'utf8');
  assert.match(start, /first && fills/, 'a first publication leads with how editions fill themselves');
  const empty = readFileSync(path.join(root, 'src/renderer/src/components/EmptyState.tsx'), 'utf8');
  assert.match(empty, /Fills itself\.<\/b> \{fills\}/, 'a module page’s empty place leads the same way');
});
