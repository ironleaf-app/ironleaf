// node --test tests/records-person-purposeful.test.mjs — `records:person` reads through the same rule as every
// other people door (t28 follow-up, 8 Nov 2026, the call on the break-it job's question: it served raw
// `personOpenItems`, with no filter, so any future caller would read protected actions, meetings, workstreams and
// risks off a work person's Timeline). src/main/life.ts purposefulPersonItems filters them the way the served cards
// (purposefulCard) and the peek (purposefulPeek) do: protected lists go from an unprotected person's answer, their
// projects stay (membership), and a protected person's own answer passes through untouched. Made-up people and notes
// only. Fails first: the raw answer holds the physio action and meetings, and the handler serves it as is.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-records-person-'));
let L; // main/life.ts (purposefulPersonItems, purposefulHidden) with shared records/people/areas/frontmatter
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { purposefulPersonItems, purposefulHidden } from ${JSON.stringify(path.join(root, 'src/main/life.ts'))};`,
      `export { buildRecordModel, personOpenItems } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`,
      `export { readProps } from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};`,
    ].join('\n'),
  );
  const stub = path.join(work, 'electron-stub.mjs');
  writeFileSync(stub, 'export const shell = {};\nexport default {};\n');
  await build({ input: entry, platform: 'node', external: ['yaml', /^node:/], plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }], output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-11-08';
// The purposeful-people vault, with one finished promise each side (the [x] lines): the open ones live under You
// owe / Owes you, the finished ones ride along for the Timeline — both read through the filter.
const ORDER = ['Health/Recovery.md', 'Work/Beacon.md', 'Work/People/Sam Lee.md', 'Health/Cardio check-in.md', 'Work/Meetings/Kickoff.md', 'Health/Meetings/Physio review.md', 'Work/Meetings/Beacon review.md', 'Work/Notes/Beacon quote.md', 'Health/People/Ana Grey.md'];
const FILES = {
  '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }, { id: 'health', name: 'Health', folder: 'Health' }] }),
  'Health/Recovery.md': '---\ntype: project\nstatus: active\n---\n# Recovery\n\n## People\n\n- **Sam Lee** — Patient\n\n## What\'s next\n\n- [ ] Sam to book the physio review\n- [x] Sam booked last month\'s physio\n',
  'Work/Beacon.md': '---\ntype: project\nstatus: active\nowner: Sam Lee\n---\n# Beacon\n\n## People\n\n- **Sam Lee** — Owner\n\n## What\'s next\n\n- [ ] Sam to approve the beacon plan\n- [ ] Send Sam the beacon quote\n- [x] Sam approved the beacon budget\n',
  'Work/People/Sam Lee.md': '---\ntype: person\nemail: sam.lee@example.com\n---\n# Sam Lee\n',
  'Health/Cardio check-in.md': '---\nsensitivity: Health\n---\n# Cardio check-in\n\n[[Sam Lee]] joined the morning walk. Weight and resting heart rate noted.\n\n- [ ] Sam to log the morning walk\n',
  'Work/Meetings/Kickoff.md': '---\ntype: meeting\ndate: 2026-10-20\nattendees: Sam Lee\n---\n# Beacon kickoff\n\nWho came: Sam Lee\n\n## Notes\n\nAgreed the beacon plan.\n',
  'Health/Meetings/Physio review.md': '---\ntype: meeting\ndate: 2026-11-05\nattendees: Sam Lee\n---\n# Physio review\n\nWho came: Sam Lee\n',
  'Work/Meetings/Beacon review.md': '---\ntype: meeting\ndate: 2026-11-15\nattendees: Sam Lee\n---\n# Beacon review\n\nWho came: Sam Lee\n',
  'Work/Notes/Beacon quote.md': '# Beacon quote\n\nDraft for [[Sam Lee]] to review.\n',
  'Health/People/Ana Grey.md': '---\ntype: person\nrole: Patient\n---\n# Ana Grey\n',
};

/** The real connected model over the vault, with the deps the handler passes (the index's properties plus areas). */
function rig() {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const abs = (rel) => path.join(dir, ...rel.split('/'));
  for (const [rel, text] of Object.entries(FILES)) {
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), String(text));
  }
  const metas = new Map();
  for (const rel of Object.keys(FILES)) {
    if (!rel.endsWith('.md')) continue;
    const text = readFileSync(abs(rel), 'utf8');
    const title = rel.split('/').pop().replace(/\.md$/i, '');
    metas.set(rel, { path: rel, title, label: title, props: L.readProps(text), tags: [], links: [], mtime: 0 });
  }
  const notes = ORDER.filter((p) => metas.has(p)).map((p) => ({ path: p, title: metas.get(p).title, label: metas.get(p).title, content: readFileSync(abs(p), 'utf8'), props: metas.get(p).props, mtime: 0 }));
  const resolve = (t) => {
    const base = String(t ?? '').replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
    const hit = notes.find((n) => n.title === base || n.path === base || n.path.endsWith(`/${base}.md`));
    return hit ? hit.path : null;
  };
  const model = L.buildRecordModel({ notes, resolve, today: TODAY });
  const deps = { model, propsOf: (p) => metas.get(p)?.props, areas: [{ id: 'work', name: 'Work', folder: 'Work' }, { id: 'health', name: 'Health', folder: 'Health' }], places: { templatesFolder: 'Templates', assetsFolder: 'Assets' } };
  return { model, deps, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const titles = (refs) => refs.map((r) => r.title);
const hiddenTitles = (deps, refs) => titles(refs.filter((r) => L.purposefulHidden(r.path, deps)));

test('the raw answer holds protected items (why the door needs the filter)', () => {
  const { model, deps, cleanup } = rig();
  try {
    const raw = L.personOpenItems(model, 'Sam Lee');
    assert.ok(raw, 'Sam');
    assert.ok(titles(raw.theirs).includes('Book the physio review'), `the physio action is Sam's to do (got ${JSON.stringify(titles(raw.theirs))})`);
    assert.ok(titles(raw.meetings).includes('Physio review'), 'the physio meeting is on Sam');
    assert.ok(hiddenTitles(deps, [...raw.theirs, ...raw.about, ...raw.doneTheirs, ...raw.doneAbout, ...raw.meetings]).length > 0, 'protected items are in the raw answer');
  } finally {
    cleanup();
  }
});

test('a work person: protected actions, finished promises and meetings go; work stays', () => {
  const { model, deps, cleanup } = rig();
  try {
    const out = L.purposefulPersonItems(L.personOpenItems(model, 'Sam Lee'), deps);
    assert.ok(out, 'Sam');
    for (const list of ['theirs', 'about', 'doneTheirs', 'doneAbout', 'workstreams', 'risks', 'meetings']) {
      assert.deepEqual(hiddenTitles(deps, out[list]), [], `no protected item in ${list} (got ${JSON.stringify(titles(out[list]))})`);
    }
    assert.ok(titles(out.theirs).includes('Approve the beacon plan'), 'the work action stays');
    assert.ok(titles(out.about).includes('Send Sam the beacon quote'), 'the work follow-up stays');
    assert.ok(titles(out.doneAbout).includes('Sam approved the beacon budget'), 'the finished work promise stays');
    assert.ok(!titles(out.doneAbout).includes("Sam booked last month's physio"), 'the finished health promise goes');
    assert.deepEqual(titles(out.meetings).sort(), ['Beacon review', 'Kickoff'], 'the work meetings stay');
  } finally {
    cleanup();
  }
});

test('a work person: their projects stay (membership, as on the cards and the peek)', () => {
  const { model, deps, cleanup } = rig();
  try {
    const out = L.purposefulPersonItems(L.personOpenItems(model, 'Sam Lee'), deps);
    assert.deepEqual(titles(out.projects).sort(), ['Beacon', 'Recovery'], 'both projects still name Sam');
  } finally {
    cleanup();
  }
});

test('every list filters by the same hidden rule, and the model is never mutated', () => {
  const { model, deps, cleanup } = rig();
  try {
    const item = (title, rel) => ({ id: `risk:${rel}#${title}`, type: 'risk', title, path: rel });
    const made = {
      person: { id: 'person:sam lee', type: 'person', title: 'Sam Lee', path: 'Work/People/Sam Lee.md' },
      theirs: [],
      about: [],
      doneTheirs: [],
      doneAbout: [],
      workstreams: [item('Physio stream', 'Health/Recovery.md'), item('Beacon stream', 'Work/Beacon.md')],
      risks: [item('Physio risk', 'Health/Recovery.md'), item('Beacon risk', 'Work/Beacon.md')],
      meetings: [],
      projects: [item('Recovery', 'Health/Recovery.md')],
    };
    const out = L.purposefulPersonItems(made, deps);
    assert.deepEqual(titles(out.workstreams), ['Beacon stream'], 'the work workstream stays');
    assert.deepEqual(titles(out.risks), ['Beacon risk'], 'the work risk stays');
    assert.deepEqual(titles(out.projects), ['Recovery'], 'the project stays: membership');
    assert.equal(made.workstreams.length, 2, 'the answer given is untouched');
    assert.equal(L.personOpenItems(model, 'Sam Lee').theirs.length, L.personOpenItems(model, 'Sam Lee').theirs.length, 'the model reads the same after');
    assert.ok(titles(L.personOpenItems(model, 'Sam Lee').theirs).includes('Book the physio review'), 'the raw model still holds the physio action');
  } finally {
    cleanup();
  }
});

test('a protected person: their own answer passes through untouched', () => {
  const { model, deps, cleanup } = rig();
  try {
    const raw = L.personOpenItems(model, 'Ana Grey');
    assert.ok(raw, 'Ana');
    assert.equal(L.purposefulHidden(raw.person.path, deps), true, 'Ana reads as protected (her page is inside Health)');
    assert.deepEqual(L.purposefulPersonItems(raw, deps), raw, 'untouched');
  } finally {
    cleanup();
  }
});

test('no person, no answer', () => {
  const { model, deps, cleanup } = rig();
  try {
    assert.equal(L.personOpenItems(model, 'Nobody Here'), null, 'nobody');
    assert.equal(L.purposefulPersonItems(null, deps), null, 'null passes through');
  } finally {
    cleanup();
  }
});

test('the records:person door serves the filtered answer, never the raw one', () => {
  const app = read('src/main/app.ts');
  assert.ok(app.includes('purposefulPersonItems') && app.includes("from './life'"), 'the handler reads the filter from the people doors’ home');
  const at = app.indexOf("handle('records:person'");
  assert.ok(at > 0, 'the door exists');
  const door = app.slice(at, app.indexOf('handle(', at + 1) === -1 ? at + 1200 : app.indexOf('handle(', at + 1));
  assert.ok(door.includes('purposefulPersonItems(personOpenItems('), 'the raw answer goes through the filter');
  assert.ok(door.includes('areasNow()'), 'with the index’s properties plus areas, like the peek');
});
