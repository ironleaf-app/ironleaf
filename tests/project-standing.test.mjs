// node --test tests/project-standing.test.mjs — one fact, one value (the plan item 1, 8 Nov 2026).
// A project's status reads the same everywhere: the Projects page, the Graph's card map, the project page
// and Today all read one function (src/shared/project-standing.ts). Finished, closed or on-hold projects
// are counted and labelled the same way everywhere: never "On track" when finished, and left out of open
// counts. One project fixture read by every page gives identical words.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-project-standing-'));
let S, G, L, P87, T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const one = async (inFile, outFile) => {
    await build({ input: path.join(root, inFile), platform: 'node', output: { file: path.join(work, outFile), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, outFile)).href);
  };
  S = await one('src/shared/project-standing.ts', 's.mjs');
  G = await one('src/shared/graph-layout.ts', 'g.mjs');
  L = await one('src/renderer/src/lib/projectLook.ts', 'l.mjs');
  P87 = await one('src/shared/projects-87.ts', 'p87.mjs');
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  T = await import(pathToFileURL(path.join(work, 't.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// The brief's own cases: off track on Projects read At risk on the Graph, and a finished project read On track.
// Today is the real day: the Projects page's pill reads the clock, so a fixed day would turn FUTURE into the past.
const TODAY = Math.floor(Date.now() / 86400000);
const dayIso = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
const PAST = dayIso(TODAY - 39);
const FUTURE = dayIso(TODAY + 5);

test('the one function: status and health in, words and tone and open out', () => {
  const s = (p) => S.projectStanding(p);
  assert.deepEqual(s({ status: 'active', health: 'off track' }), { words: 'Off track', tone: 'bad', open: true });
  assert.deepEqual(s({ status: 'active', health: 'at risk' }), { words: 'At risk', tone: 'warn', open: true });
  assert.deepEqual(s({ status: 'active', health: 'on track' }), { words: 'On track', tone: 'ok', open: true });
  assert.deepEqual(s({ status: 'active' }), { words: 'Active', tone: 'none', open: true });
  // Each page reads its own due day and passes past-it-or-not; the rule weighs it the same for every page.
  assert.deepEqual(s({ status: 'active', health: 'on track', overdue: true }), { words: 'Overdue', tone: 'bad', open: true });
  assert.deepEqual(s({ status: 'active', health: 'off track', overdue: true }), { words: 'Off track', tone: 'bad', open: true });
  // Finished, closed or on hold: the same words everywhere, never On track, never open.
  for (const status of ['done', 'Done', 'closed', 'Closed', 'archived', 'cancelled', 'finished']) {
    assert.deepEqual(s({ status, health: 'on track' }), { words: 'Finished', tone: 'none', open: false }, `${status} is Finished, whatever the health says`);
    assert.deepEqual(s({ status, health: 'on track', overdue: true }), { words: 'Finished', tone: 'none', open: false }, `${status} stays Finished past its due day too`);
  }
  assert.deepEqual(s({ status: 'on hold', health: 'at risk' }), { words: 'On hold', tone: 'none', open: false });
  assert.deepEqual(s({ status: 'on hold', health: 'on track', overdue: true }), { words: 'On hold', tone: 'none', open: false });
  assert.deepEqual(s({ status: 'idea' }), { words: 'Idea', tone: 'none', open: false });
  // Whole words only, as the Projects page reads them: "offer" is not off track, "delivered" is not red.
  assert.deepEqual(s({ status: 'active', health: 'Offer extended' }), { words: 'Active', tone: 'none', open: true });
  assert.deepEqual(s({ status: 'active', health: 'Coffee catch-up' }), { words: 'Active', tone: 'none', open: true });
});

test('one fixture read by every page gives identical words', () => {
  const fixtures = [
    { status: 'active', health: 'off track', due: FUTURE },
    { status: 'active', health: 'at risk', due: FUTURE },
    { status: 'active', health: 'on track', due: FUTURE },
    { status: 'active', health: 'on track', due: PAST },
    { status: 'active', health: undefined, due: FUTURE },
    { status: 'active', health: undefined, due: PAST },
    { status: 'done', health: 'on track', due: PAST },
    { status: 'closed', health: 'off track', due: FUTURE },
    { status: 'on hold', health: 'at risk', due: FUTURE },
    { status: 'idea', health: undefined, due: undefined },
  ];
  for (const f of fixtures) {
    const want = S.projectStanding({ status: f.status, health: f.health, overdue: f.due === PAST }).words;
    // The Projects page (its pill, no own late steps here) and the area cards read the same helper.
    assert.equal(L.healthPill({ health: f.health, lateMine: 0, due: f.due, status: f.status }).words, want, `Projects: ${JSON.stringify(f)}`);
    // The Graph's card map.
    assert.equal(G.healthWord(f.health, f.due, TODAY, f.status), want, `Graph: ${JSON.stringify(f)}`);
    // The project page's pill reads the one function (want, above); its menu value maps the same way,
    // except past the due day, where the pill says Overdue and the menu keeps the stored health (it writes it).
    if (want === 'Overdue') {
      assert.equal(P87.PROP_STATUS_WORDS[P87.propStatus({ status: f.status, health: f.health })], f.health ? 'On track' : 'Active', `project page menu: ${JSON.stringify(f)}`);
    } else {
      assert.equal(P87.PROP_STATUS_WORDS[P87.propStatus({ status: f.status, health: f.health })], want, `project page menu: ${JSON.stringify(f)}`);
    }
    // Today: the same tone for the same health, so the same lists (finished and shelved projects never
    // reach its lists — they read dormant — so its health-only tone compares against the health-only standing).
    assert.equal(T.toneOf(f.health), S.projectStanding({ health: f.health }).tone, `Today tone: ${JSON.stringify(f)}`);
  }
});

test('open counts leave finished, closed and on-hold projects out, on every page', () => {
  const nodes = [
    { id: 'Work/A.md', title: 'A', kind: 'note', tags: [], project: true, status: 'active', health: 'off track' },
    { id: 'Work/B.md', title: 'B', kind: 'note', tags: [], project: true, status: 'active', health: 'on track' },
    { id: 'Work/C.md', title: 'C', kind: 'note', tags: [], project: true, status: 'done', health: 'on track' },
    { id: 'Work/D.md', title: 'D', kind: 'note', tags: [], project: true, status: 'closed', health: 'off track' },
    { id: 'Work/E.md', title: 'E', kind: 'note', tags: [], project: true, status: 'on hold', health: 'at risk' },
    { id: 'Work/F.md', title: 'F', kind: 'note', tags: [], project: true, status: 'idea' },
  ];
  const [col] = G.buildMap(nodes, [], TODAY);
  assert.equal(col.counts.projects, 2, 'the Map counts the two open projects, like the Projects page');
  assert.deepEqual(col.projects.map((p) => p.title).sort(), ['A', 'B'], 'finished, closed and on-hold projects hold no cards');
  assert.equal(col.projects.find((p) => p.title === 'A').healthWord, 'Off track', 'off track reads Off track, not At risk');
  assert.equal(col.projects.find((p) => p.title === 'B').healthWord, 'On track');
  assert.equal(col.closed, 4, 'the rest are counted apart, in the open');
  // The same count the Projects page reads: open means the one function says open.
  const cards = nodes.map((n) => ({ status: n.status, health: n.health }));
  assert.equal(cards.filter((c) => S.isOpenProject(c.status)).length, 2);
  // A finished project centred from elsewhere still reads Finished, never On track, with no due pressure.
  assert.equal(G.cardDetail({ id: 'Work/C.md', title: 'C', kind: 'note', project: true, status: 'done', health: 'on track', due: PAST }, TODAY), 'Finished');
});
