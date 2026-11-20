// node --test tests/big-vault.test.mjs — speed on a big vault (p18-big-vault, 4 Nov 2026). Tonight's one-task
// work put a pass over every project's steps on each read of Tasks and Today, and a tick or project save re-derived
// the relations from every note mid-write: on 3,000 notes, 200 projects and 8,000 tasks, Today read six times slower
// and a tick took 170ms. The fix is at the mechanism: each step's match is worked out once per read (StepKey/LineKey),
// the one map is kept per index generation and shared by both doors, and a write's cascade reuses the relations read
// before its write. This test pins the mechanism with counts, not milliseconds, so it is stable however loaded the
// machine is; the timings at the end are hang guards only (they print for the human). Made-up notes; a fixed today
// (Wednesday 4 Nov 2026).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-big-vault-'));
let O;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  // Star exports for the one-task modules: the new helpers are asserted present, so the file loads and fails
  // precisely where the mechanism is missing.
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/one-task.ts'))};\n` +
      `export * from ${JSON.stringify(path.join(root, 'src/main/one-task.ts'))};\n` +
      `export { Hub } from ${JSON.stringify(path.join(root, 'src/main/hub.ts'))};\n` +
      `export { TasksService } from ${JSON.stringify(path.join(root, 'src/main/tasks.ts'))};\n` +
      `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n` +
      `export { parseProject, serializeProject, applyProjectEdit, textVersion } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'big-vault.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  O = await import(pathToFileURL(path.join(work, 'big-vault.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Wednesday 4 November 2026.
const NOW = new Date(2026, 10, 4, 10, 0).getTime();
const REF = new Date(NOW);
const N_PROJECTS = 8;

const projectFile = (name, owner, steps) => ['---', 'type: project', 'status: active', `owner: ${owner}`, '---', `# ${name}`, '', "## What's next", '', ...steps, ''].join('\n');

/** Eight projects with ten open steps each, two notes in each project's folder (one by `project:`, one by folder)
// with a twin of step 0 that folds and a differently-owned line of step 1 that stays, and eight loose notes. */
function fixtureVault() {
  const files = new Map();
  for (let i = 0; i < N_PROJECTS; i++) {
    const name = `P${i}`;
    const steps = [
      `- [ ] Ring the supplier about invoice ${100 + i}`,
      `- [ ] Confirm the delivery run ${100 + i} — Mia Chen`,
      `- [ ] Price the fit-out stage ${100 + i} — Sam Ortiz · by 6 Nov 2026`,
      `- [ ] Book the crane for site ${100 + i} — by 13 Nov 2026`,
      `- [ ] Chase the council permit ${100 + i} — Zoë Laurent`,
      `- [ ] File the safety checklist ${100 + i} — Tom Baker, due 9 Nov 2026`,
      `- [ ] Measure the cool room ${100 + i}`,
      `- [ ] Pay the deposit ${100 + i} — Mia Chen · by 31 Oct 2026`,
      `- [ ] Photograph the defects ${100 + i} — Sam Ortiz`,
      `- [ ] Sign the handover ${100 + i}`,
      `- [x] Open the job ${100 + i}`,
    ];
    files.set(`Projects/${name}/${name}.md`, projectFile(name, 'Mia Chen', steps));
    for (let k = 0; k < 2; k++) {
      const prop = k === 0 ? `project: ${name}\n` : '';
      files.set(
        `Projects/${name}/Notes/Note ${i}${k}.md`,
        ['---', `${prop}tags: [notes]`, '---', `# Note ${i}${k}`, '', '## Tasks', '', `- [ ] Ring the supplier about invoice ${100 + i}`, `- [ ] Confirm the delivery run ${100 + i} — Tom Baker`, `- [ ] Draft the roster note ${i}${k}`, `- [ ] Water the yard plants ${i}${k} 📅 2026-11-06`, `- [x] Sweep the office ${i}${k}`, ''].join('\n'),
      );
    }
  }
  for (let i = 0; i < N_PROJECTS; i++) {
    files.set(`Notes/Loose ${i}.md`, ['---', 'tags: [notes]', '---', `# Loose ${i}`, '', `- [ ] Renew the parking permit ${i}`, `- [ ] File the council letter ${i} 📅 2026-11-05`, `- [ ] Post the keys ${i} — Mia Chen`, `- [x] Sharpen the pencils ${i}`, ''].join('\n'));
  }
  return files;
}

/** A real index behind a counting proxy: project content reads, and the generation each relations() call ran at. */
function countingIndex(files) {
  const real = new O.VaultIndex();
  for (const [p, text] of files) real.set(p, text, NOW, text.length);
  const counts = { contentProject: 0, relationsAt: [] };
  const index = new Proxy(real, {
    get(t, prop) {
      if (prop === 'content') return (p) => (t.get(p)?.props?.type === 'project' ? counts.contentProject++ : 0, t.content(p));
      if (prop === 'relations') return () => (counts.relationsAt.push(t.generation()), t.relations());
      const v = t[prop];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const put = (p, text) => real.set(p, text, NOW, text.length);
  const tasksOf = () => new O.TasksService({ index, templatesFolder: () => 'Templates', write: async (p, t) => put(p, t), now: () => NOW });
  const hubOf = () => new O.Hub({ index, dailyPath: () => 'Daily/2026-11-04.md', templatesFolder: () => 'Templates', reminders: () => [], write: async (p, t) => put(p, t), now: () => NOW });
  return { index, real, counts, put, tasksOf, hubOf };
}

/** A task's line number and words-after-the-box in a note's text. */
function locate(text, words) {
  const lines = text.split('\n');
  const line = lines.findIndex((l) => l.includes(words));
  const m = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[^\]]\]\s+(.*)$/.exec(lines[line] ?? '');
  return { line, text: m?.[1] ?? words };
}

test('match keys are exactly the shared reading, worked out once', () => {
  assert.equal(typeof O.stepKeyOf, 'function', 'StepKey: a step matched from its worked-out key');
  assert.equal(typeof O.lineKeyOf, 'function', 'LineKey: a line matched from its worked-out identity');
  assert.equal(typeof O.isSameKey, 'function', 'isSameKey: the pair from their keys');
  const pairs = [
    [{ what: 'Ring the supplier', who: 'Mia Chen' }, 'Ring the supplier – Mia Chen · by 6 Nov 2026'],
    [{ what: 'Ring the supplier', who: 'Mia Chen' }, 'Ring the supplier – Mia · by 6 Nov 2026'],
    [{ what: 'Ring the supplier', who: 'Mia Chen' }, 'Ring the supplier – Sam Ortiz · by 6 Nov 2026'],
    [{ what: 'Ring the supplier' }, 'Ring the supplier – Mia Chen'],
    [{ what: 'Ring the supplier' }, 'Ring the supplier'],
    [{ what: 'Ring the supplier' }, 'Ring the deliverer'],
    [{ what: '  Ring the supplier  ', who: '  Mia Chen ' }, 'the ring the supplier – Mia Chen'],
    [{ what: 'Chase the permit', who: 'Zoë Laurent' }, 'Chase the permit — Zoë Laurent'],
    [{ what: 'File the list' }, 'File the list — Fri 23 Oct'],
    [{ what: 'File the list', who: 'Tom Baker' }, 'File the list — Tom Baker, due 9 Nov 2026'],
    [{ what: 'File the list' }, 'File the list — Tom Baker, due 9 Nov 2026'],
    [{ what: '' }, 'Ring the supplier'],
    [{ what: 'Ring the supplier' }, ''],
    [{ what: 'the' }, 'the'],
    [{ what: 'Alex Lee' }, 'Alex Morgan'],
  ];
  for (const [step, words] of pairs) {
    const line = O.lineKeyOf(words, REF);
    const want = O.isSameTask(step, words, REF);
    if (line === null) assert.equal(want, false, JSON.stringify(words));
    else assert.equal(O.isSameKey(O.stepKeyOf(step), line), want, `${JSON.stringify(step)} vs ${JSON.stringify(words)}`);
  }
  assert.equal(O.lineKeyOf('', REF), null);
  assert.equal(typeof O.stepKeysOf, 'function', 'stepKeysOf: a project’s steps as keys');
  assert.deepEqual(O.stepKeysOf([{ what: 'Ring the supplier', who: 'Mia Chen' }]), [O.stepKeyOf({ what: 'Ring the supplier', who: 'Mia Chen' })]);
});

test('a save knows when its cascade may reuse the relations read before its write', () => {
  assert.equal(typeof O.ownerNamesKept, 'function', 'ownerNamesKept: the owner rule’s names untouched by the batch');
  const toggle = { kind: 'change', list: 'next', index: 0, item: { done: true } };
  assert.equal(O.ownerNamesKept('P0', 'P0', [toggle]), true, 'ticking a step keeps every name');
  assert.equal(O.ownerNamesKept('P0', 'P0', []), true);
  assert.equal(O.ownerNamesKept('P0', 'P0', [{ kind: 'add', list: 'next', item: { what: 'New step' } }]), true);
  assert.equal(O.ownerNamesKept('P0', 'P0', [{ kind: 'set', field: 'owner', value: 'Sam Ortiz' }]), true, 'the owner is not a name notes resolve by');
  assert.equal(O.ownerNamesKept('P0', 'P0', [{ kind: 'set', field: 'name', value: 'P0' }]), true, 'a rename that changes nothing');
  assert.equal(O.ownerNamesKept('P0', 'P1', [{ kind: 'set', field: 'name', value: 'P1' }, toggle]), false, 'a batch that renames');
  assert.equal(O.ownerNamesKept('P0', 'P0', [{ kind: 'prop', key: 'aliases', value: 'P0 old' }, toggle]), false, 'a batch that moves an alias');
  assert.equal(O.ownerNamesKept('P0', 'P0', [{ kind: 'prop', key: 'job_code', value: 'WX-1' }, toggle]), true, 'any other property keeps the names');
});

test('the one map is kept per index generation', () => {
  assert.equal(typeof O.keptStepKeys, 'function', 'keptStepKeys: the one map, kept until the notes change');
  const h = countingIndex(fixtureVault());
  const a = O.keptStepKeys(h.index);
  const b = O.keptStepKeys(h.index);
  assert.equal(b, a, 'the same map twice in one generation');
  assert.equal(h.counts.contentProject, N_PROJECTS, 'each project read once');
  assert.equal(a.size, N_PROJECTS);
  assert.deepEqual([...a.get('Projects/P0/P0.md')].map((s) => s.want).slice(0, 2), O.openStepsByProject(h.real).get('Projects/P0/P0.md').slice(0, 2).map((s) => O.stepKeyOf(s).want), 'the kept keys are the steps’ keys');
  h.put('Notes/Loose 0.md', `${h.real.content('Notes/Loose 0.md')}\n`);
  const c = O.keptStepKeys(h.index);
  assert.notEqual(c, a, 'a new map after a note changes');
  assert.equal(h.counts.contentProject, N_PROJECTS * 2, 'each project read once more');
});

test('Today and Tasks share the one map on a generation', () => {
  const h = countingIndex(fixtureVault());
  h.index.relations();
  const before = h.counts.contentProject;
  const due = h.hubOf().due();
  const view = h.tasksOf().view();
  // Gathering reads every project once; the fold's map is built once for both doors — never once each.
  assert.ok(h.counts.contentProject - before <= N_PROJECTS * 2, `project reads: ${h.counts.contentProject - before}, at most ${N_PROJECTS * 2}`);
  // And the fold still folds: each twin is one row, the step; the differently-owned line stays its own row.
  const twins = view.tasks.filter((t) => t.words.startsWith('Ring the supplier about invoice'));
  assert.equal(twins.length, N_PROJECTS, 'each twin pair is one row');
  assert.ok(twins.every((t) => t.path === t.project), 'the step is the row');
  const stayed = view.tasks.filter((t) => t.words.startsWith('Confirm the delivery run') && t.path !== t.project);
  assert.equal(stayed.length, N_PROJECTS, 'one row per job (t249): the two same-owned lines are one row');
  const confirmSteps = view.tasks.filter((t) => t.words.startsWith('Confirm the delivery run') && t.path === t.project);
  assert.equal(confirmSteps.length, N_PROJECTS, 'a differing owner stays its own row');
  assert.equal(due.undatedCount + due.overdue.length + due.today.length + due.week.length + due.later.length >= N_PROJECTS, true);
});

test('a tick reads the relations before its write, and still closes both', async () => {
  for (const door of ['tasks', 'hub']) {
    const h = countingIndex(fixtureVault());
    h.index.relations();
    h.counts.relationsAt.length = 0;
    const gen = h.index.generation();
    const note = door === 'tasks' ? 'Projects/P1/Notes/Note 10.md' : 'Projects/P2/Notes/Note 20.md';
    const at = locate(h.real.content(note), door === 'tasks' ? 'Ring the supplier about invoice 101' : 'Ring the supplier about invoice 102');
    const service = door === 'tasks' ? h.tasksOf() : h.hubOf();
    const said = await service.tick(note, at.line, at.text, true);
    assert.ok(h.counts.relationsAt.length >= 1, 'the tick reads the relations');
    assert.ok(h.counts.relationsAt.every((g) => g === gen), `every relations read is pre-write (gen ${gen}): [${h.counts.relationsAt}]`);
    assert.match(typeof said === 'string' ? said : said.words, /Done/);
    const project = door === 'tasks' ? 'Projects/P1/P1.md' : 'Projects/P2/P2.md';
    assert.match(h.real.content(note), /\[x\] Ring the supplier about invoice/, 'the line closed');
    assert.match(h.real.content(project), /\[x\] Ring the supplier about invoice/, 'its step closed too');
  }
});

test('a save’s cascade reuses pre-read relations and never re-derives them', () => {
  const h = countingIndex(fixtureVault());
  const rels = h.index.relations();
  h.counts.relationsAt.length = 0;
  const files = O.cascadeForStep(h.index, () => false, 'Projects/P3/P3.md', { what: 'Ring the supplier about invoice 103' }, true, REF, rels);
  assert.equal(h.counts.relationsAt.length, 0, 'no relations call with pre-read relations');
  assert.equal(files.length, 2, 'both twins named');
  const h2 = countingIndex(fixtureVault());
  h2.index.relations();
  h2.counts.relationsAt.length = 0;
  O.cascadeForStep(h2.index, () => false, 'Projects/P3/P3.md', { what: 'Ring the supplier about invoice 103' }, true, REF);
  assert.ok(h2.counts.relationsAt.length >= 1, 'without them it reads the index as before');
  // The save's shape (src/main/app.ts editProject): relations read before the write, reused after it.
  const h3 = countingIndex(fixtureVault());
  const file = 'Projects/P4/P4.md';
  const beforeText = h3.real.content(file);
  const p = O.parseProject(beforeText, file);
  const shut = O.closedStepOf(p.next, { kind: 'change', list: 'next', index: 0, item: { done: true } });
  O.applyProjectEdit(p, { kind: 'change', list: 'next', index: 0, item: { done: true } }, '4 Nov 2026');
  const afterText = O.serializeProject(p, beforeText);
  const gen = h3.index.generation();
  const kept = O.ownerNamesKept(p.name, p.name, [{ kind: 'change', list: 'next', index: 0, item: { done: true } }]) ? h3.index.relations() : null;
  h3.put(file, afterText);
  const cascaded = shut ? O.cascadeForStep(h3.index, () => false, file, shut.step, shut.done, REF, kept) : [];
  for (const f of cascaded) h3.put(f.path, f.after);
  assert.ok(h3.counts.relationsAt.length >= 1 && h3.counts.relationsAt.every((g) => g === gen), `the save reads relations once, pre-write: [${h3.counts.relationsAt}]`);
  assert.match(h3.real.content(file), /\[x\] Ring the supplier about invoice/, 'the step closed');
});

test('timings on the fixture vault (hang guards; the counts above are the perf guards)', async () => {
  const h = countingIndex(fixtureVault());
  h.index.relations();
  const med = async (fn, n = 3) => {
    const ds = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await fn(i);
      ds.push(performance.now() - t0);
    }
    return ds.sort((a, b) => a - b)[Math.floor(n / 2)];
  };
  const hubMs = await med(() => h.hubOf().due());
  const tasksMs = await med(() => h.tasksOf().view());
  const tickMs = await med(async (i) => {
    const note = `Notes/Loose ${i}.md`;
    const at = locate(h.real.content(note), `Renew the parking permit ${i}`);
    await h.tasksOf().tick(note, at.line, at.text, true);
  });
  const saveMs = await med((i) => {
    const file = `Projects/P${i}/P${i}.md`;
    const beforeText = h.real.content(file);
    const p = O.parseProject(beforeText, file);
    O.applyProjectEdit(p, { kind: 'change', list: 'next', index: 0, item: { done: true } }, '4 Nov 2026');
    h.put(file, O.serializeProject(p, beforeText));
  });
  console.log(`big-vault fixture medians (ms): hub-due=${hubMs.toFixed(1)} tasks-view=${tasksMs.toFixed(1)} tick=${tickMs.toFixed(1)} save=${saveMs.toFixed(1)}`);
  for (const [name, ms] of [['hub-due', hubMs], ['tasks-view', tasksMs], ['tick', tickMs], ['save', saveMs]]) {
    assert.ok(ms < 30_000, `${name} finishes (${ms.toFixed(0)}ms)`);
  }
});
