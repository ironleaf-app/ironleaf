// node --test tests/vault-purposeful-people.test.mjs — health never reaches a work person (t21, 8 Nov 2026, 4 Nov,
// with a picture of a work project's People panel showing a weight and BMI). A health role or health note showing on
// a work colleague's page is that fault. Builds on vault-purposeful.test.mjs C2 (which pins the peek row's words but
// not the cards): the registerLife people handlers serve every card door (People page, person page, Peek's summary,
// the project panel, Today brief lines, the former host app's embed), so protected notes, actions, meetings and
// roles are filtered out of unprotected cards there, using the index's properties plus areas and the same protected
// rule the People page already uses. The follow-up holds the same rule on Peek's connected groups and Related,
// building on that filter. A role on a work page comes from work sources only; a health role shows only inside
// Health. Made-up people and notes only. Fails first: the card serves the health note, its actions and the
// first-seen health role.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vault-purposeful-people-'));
let L; // main/life.ts (registerLife, purposefulCard) with shared records/people/areas/frontmatter/sensitivity/agent-gate
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { registerLife, purposefulCard, purposefulPeek, purposefulHidden, purposefulRelatedSkip } from ${JSON.stringify(path.join(root, 'src/main/life.ts'))};`,
      `export { buildRecordModel, answerPerson, connectedTo, personOpenItems, isOpen, peekOf } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`,
      `export { relatedTo } from ${JSON.stringify(path.join(root, 'src/shared/related.ts'))};`,
      `export { personCard, personCards, personTimeline, quietBriefPeople, checkInDraft, personQuiet } from ${JSON.stringify(path.join(root, 'src/shared/people.ts'))};`,
      `export { readProps } from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};`,
      `export { parseSensitivity, levelOf, accessOf, allows, decide } from ${JSON.stringify(path.join(root, 'src/shared/sensitivity.ts'))};`,
      `export { makeGate, gateIndex } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};`,
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
// The health project first, like C2: the first role the model sees is the health one, so without the fix the work
// card reads "Patient". Sam has a page (notes only join a person by linking it); it carries no role, so the role
// still comes from the projects.
const ORDER = ['Health/Recovery.md', 'Work/Beacon.md', 'Work/People/Sam Lee.md', 'Work/People/Rae Morgan.md', 'Health/Cardio check-in.md', 'Health/Walk log.md', 'Work/Meetings/Kickoff.md', 'Health/Meetings/Physio review.md', 'Work/Meetings/Beacon review.md', 'Health/Meetings/Physio follow-up.md', 'Work/Notes/Beacon quote.md', 'Notes/School pickup.md', 'Health/People/Ana Grey.md', 'Work/Meetings/Old site walk.md'];
const FILES = {
  '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }, { id: 'health', name: 'Health', folder: 'Health' }] }),
  'Health/Recovery.md': '---\ntype: project\nstatus: active\n---\n# Recovery\n\n## People\n\n- **Sam Lee** — Patient\n- **Rae Morgan** — Patient\n\n## What\'s next\n\n- [ ] Sam to book the physio review\n- [ ] Ask Rae for the insurance letter\n',
  'Work/Beacon.md': '---\ntype: project\nstatus: active\nowner: Sam Lee\n---\n# Beacon\n\n## People\n\n- **Sam Lee** — Owner\n\n## What\'s next\n\n- [ ] Sam to approve the beacon plan\n- [ ] Send Sam the beacon quote\n',
  'Work/People/Sam Lee.md': '---\ntype: person\nemail: sam.lee@example.com\n---\n# Sam Lee\n',
  // Rae has a work card (a named-only colleague first named in Health reads as protected, like the People page's
  // lock): the health role from Recovery must still not show on it.
  'Work/People/Rae Morgan.md': '---\ntype: person\nemail: rae.morgan@example.com\n---\n# Rae Morgan\n',
  // An explicit level (sensitivity: Health), naming the work colleague, with its own action for them. The word
  // "weight" echoes the pictured fault; no figures, made up throughout.
  'Health/Cardio check-in.md': '---\nsensitivity: Health\n---\n# Cardio check-in\n\n[[Sam Lee]] joined the morning walk. Weight and resting heart rate noted.\n\n- [ ] Sam to log the morning walk\n',
  // No explicit property: protected by being inside the Health area.
  'Health/Walk log.md': '# Walk log\n\nWalks with [[Sam Lee]] and [[Ana Grey]] this month.\n',
  'Work/Meetings/Kickoff.md': '---\ntype: meeting\ndate: 2026-10-20\nattendees: Sam Lee\n---\n# Beacon kickoff\n\nWho came: Sam Lee\n\n## Notes\n\nAgreed the beacon plan.\n',
  'Health/Meetings/Physio review.md': '---\ntype: meeting\ndate: 2026-11-05\nattendees: Sam Lee\n---\n# Physio review\n\nWho came: Sam Lee\n',
  'Work/Meetings/Beacon review.md': '---\ntype: meeting\ndate: 2026-11-15\nattendees: Sam Lee\n---\n# Beacon review\n\nWho came: Sam Lee\n',
  'Health/Meetings/Physio follow-up.md': '---\ntype: meeting\ndate: 2026-11-12\nattendees: Sam Lee\n---\n# Physio follow-up\n\nWho came: Sam Lee\n',
  'Work/Notes/Beacon quote.md': '# Beacon quote\n\nDraft for [[Sam Lee]] to review.\n',
  // Family-private by its own property, outside any area: the property alone protects it.
  'Notes/School pickup.md': '---\nsensitivity: Family-private\n---\n# School pickup\n\n[[Sam Lee]] offered to cover Friday pickup.\n',
  'Health/People/Ana Grey.md': '---\ntype: person\nrole: Patient\n---\n# Ana Grey\n',
  'Work/Meetings/Old site walk.md': '---\ntype: meeting\ndate: 2026-08-01\nattendees: Rae Morgan\n---\n# Old site walk\n\nWho came: Rae Morgan\n',
};

/** The handlers on a real vault on disk, with the real connected model (built in ORDER) behind them. */
function rig(files = FILES, order = ORDER) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const abs = (rel) => path.join(dir, ...rel.split('/'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), String(text));
  }
  const metas = new Map();
  for (const rel of Object.keys(files)) {
    if (!rel.endsWith('.md')) continue;
    const text = readFileSync(abs(rel), 'utf8');
    const title = rel.split('/').pop().replace(/\.md$/i, '');
    metas.set(rel, { path: rel, title, label: title, props: L.readProps(text), tags: [], links: [], mtime: 0 });
  }
  const notes = order.filter((p) => metas.has(p)).map((p) => ({ path: p, title: metas.get(p).title, label: metas.get(p).title, content: readFileSync(abs(p), 'utf8'), props: metas.get(p).props, mtime: 0 }));
  const resolve = (t) => {
    const base = String(t ?? '').replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
    const hit = notes.find((n) => n.title === base || n.path === base || n.path.endsWith(`/${base}.md`));
    return hit ? hit.path : null;
  };
  const model = L.buildRecordModel({ notes, resolve, today: TODAY });
  const vault = {
    root: dir,
    exists: async (rel) => metas.has(rel),
    read: async (rel) => readFileSync(abs(rel), 'utf8'),
    write: async () => {
      throw new Error('not under test');
    },
    create: async () => {
      throw new Error('not under test');
    },
    any: async (rel) => metas.has(rel),
    listAll: async () => ({ files: [...metas.keys()].map((rel) => ({ rel, mtime: 0, size: 0, kind: 'note' })), folders: [] }),
  };
  const handlers = new Map();
  L.registerLife({
    handle: (ch, fn) => handlers.set(ch, fn),
    vault: () => vault,
    index: {
      allMeta: () => [...metas.values()],
      content: (rel) => (metas.has(rel) ? readFileSync(abs(rel), 'utf8') : null),
      get: (rel) => metas.get(rel),
      resolveAny: (t) => resolve(t),
      delete: (rel) => void metas.delete(rel),
    },
    prefs: () => ({ templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments' }),
    dailyFolder: () => 'Daily',
    records: () => model,
    movePath: async () => {
      throw new Error('not under test');
    },
    indexFile: async () => null,
    refreshFiles: async () => {},
    changed: () => {},
    filesChanged: () => {},
    requireCreate: async () => {},
    editProject: async () => ({}),
  });
  return { handlers, model, metas };
}

const titles = (refs) => refs.map((r) => r.title);
const HEALTH_WORDS = ['Cardio check-in', 'Walk log', 'School pickup', 'Physio review', 'Physio follow-up', 'physio', 'morning walk', 'insurance letter', 'Patient'];
const hasHealth = (words) => HEALTH_WORDS.filter((w) => words.join('\n').toLowerCase().includes(w.toLowerCase()));

// ── The People page door (people:cards) ────

test('People: a work card names no health or family note', async () => {
  const { handlers } = rig();
  const cards = await handlers.get('people:cards')();
  const sam = cards.find((c) => c.id === 'person:sam lee');
  assert.ok(sam, 'Sam has a card');
  assert.deepEqual(titles(sam.notes), ['Beacon quote'], `only the work note names Sam (got ${JSON.stringify(titles(sam.notes))})`);
});

test('People: owed and owing halves hold no health action, and say so in their counts', async () => {
  const { handlers } = rig();
  const sam = (await handlers.get('people:cards')()).find((c) => c.id === 'person:sam lee');
  const halves = [...titles(sam.youOweItems), ...titles(sam.owesYouItems)];
  assert.deepEqual(hasHealth(halves), [], `no health action either way (got ${JSON.stringify(halves)})`);
  assert.ok(halves.includes('Send Sam the beacon quote') && halves.includes('Approve the beacon plan'), 'the work actions stay');
  assert.equal(sam.youOwe, sam.youOweItems.length, 'you owe says what it holds');
  assert.equal(sam.owesYou, sam.owesYouItems.length, 'owes you says what it holds');
});

test('People: the open items and count hold no health action', async () => {
  const { handlers, model } = rig();
  const sam = (await handlers.get('people:cards')()).find((c) => c.id === 'person:sam lee');
  assert.deepEqual(hasHealth(titles(sam.openItems)), [], `no health action among the open (got ${JSON.stringify(titles(sam.openItems))})`);
  const open = [...sam.youOweItems, ...sam.owesYouItems].filter((a) => {
    const r = model.records.get(a.id);
    return r ? L.isOpen(r) : true;
  }).length;
  assert.equal(sam.open, open, 'the open count counts what the card holds');
});

test('People: meetings hold no health meeting; the next meeting and last contact read from work', async () => {
  const { handlers } = rig();
  const sam = (await handlers.get('people:cards')()).find((c) => c.id === 'person:sam lee');
  assert.deepEqual(hasHealth(titles(sam.meetings)), [], `no health meeting (got ${JSON.stringify(titles(sam.meetings))})`);
  assert.equal(sam.nextMeeting?.title, 'Beacon review', `the next meeting is the work one (got ${sam.nextMeeting?.title})`);
  assert.equal(sam.lastContact?.what, 'Kickoff', `last contact is the work meeting (got ${sam.lastContact?.what})`);
});

test('People: a work card reads its role from work, never the first-seen health role', async () => {
  const { handlers, model } = rig();
  // The model still keeps the first role it saw (C2): the leak is what the CARD shows.
  assert.equal(model.records.get('person:sam lee').facts.find((f) => f.key === 'role')?.value, 'Patient');
  const sam = (await handlers.get('people:cards')()).find((c) => c.id === 'person:sam lee');
  assert.equal(sam.role, 'Owner', `the work role (got ${JSON.stringify(sam.role)})`);
});

test('People: with no work role anywhere, no role shows, never the health one', async () => {
  const { handlers } = rig();
  const rae = (await handlers.get('people:cards')()).find((c) => c.id === 'person:rae morgan');
  assert.ok(rae, 'Rae has a card');
  assert.equal(rae.role, undefined, `no role rather than the health one (got ${JSON.stringify(rae.role)})`);
});

test('People: membership stays whole (a health project still names them; the filter is notes, actions, meetings, roles)', async () => {
  const { handlers } = rig();
  const sam = (await handlers.get('people:cards')()).find((c) => c.id === 'person:sam lee');
  assert.ok(titles(sam.projects).includes('Recovery') && titles(sam.projects).includes('Beacon'), `both projects name Sam (got ${JSON.stringify(titles(sam.projects))})`);
});

// ── The person page door (people:card) ────

test('person page: the one card is the same filtered card', async () => {
  const { handlers } = rig();
  const sam = await handlers.get('people:card')('person:sam lee');
  assert.ok(sam, 'Sam');
  assert.deepEqual(titles(sam.notes), ['Beacon quote'], 'no health note');
  assert.deepEqual(hasHealth([...titles(sam.youOweItems), ...titles(sam.owesYouItems), ...titles(sam.meetings)]), [], 'no health action or meeting');
  assert.equal(sam.role, 'Owner', 'the work role');
  assert.equal(sam.nextMeeting?.title, 'Beacon review', 'the work next meeting');
});

// ── Inside Health: protected cards keep everything ────

test('inside Health: a protected card keeps its health notes, actions and role', async () => {
  const { handlers } = rig();
  const ana = (await handlers.get('people:cards')()).find((c) => c.id === 'person:ana grey');
  assert.ok(ana, 'Ana has a card');
  assert.equal(ana.role, 'Patient', 'her health role shows inside Health');
  assert.ok(titles(ana.notes).includes('Walk log'), `her health note stays (got ${JSON.stringify(titles(ana.notes))})`);
});

test("a person's own page role stands, even beside a health role", async () => {
  const withRole = { ...FILES, 'Work/People/Sam Lee.md': '---\ntype: person\nrole: Joinery lead\nemail: sam.lee@example.com\n---\n# Sam Lee\n' };
  const { handlers } = rig(withRole, ORDER);
  const sam = (await handlers.get('people:cards')()).find((c) => c.id === 'person:sam lee');
  assert.equal(sam.role, 'Joinery lead', `their own role (got ${JSON.stringify(sam.role)})`);
  assert.deepEqual(titles(sam.notes), ['Beacon quote'], 'their notes still filtered');
});

// ── Peek: the person's summary reads through people:card ────

test('Peek: the person summary reads the same filtered card', async () => {
  const summary = read('src/renderer/src/components/PersonSummary.tsx');
  assert.ok(summary.includes('window.nv.life.people.card(record.id)'), 'the summary reads people:card, never the raw model');
  const { handlers } = rig();
  const sam = await handlers.get('people:card')('person:sam lee');
  assert.deepEqual(hasHealth([...titles(sam.notes), ...titles(sam.youOweItems), ...titles(sam.owesYouItems)]), [], 'so Peek shows no health content for Sam');
});

// ── Today rows: the brief's people lines read filtered cards ────

test('Today: a check-in draft for a work person carries no health words', async () => {
  const { model } = rig();
  const rae = model.records.get('person:rae morgan');
  assert.ok(rae, 'Rae is known');
  const raw = L.personCard(model, rae.id);
  assert.ok(raw?.quiet, 'Rae went quiet, so the brief drafts a check-in');
  // The test bites: the raw card's draft carries the health action.
  assert.ok(hasHealth([L.checkInDraft(raw)]).length > 0, `the raw draft leaks (got ${JSON.stringify(L.checkInDraft(raw))})`);
  const propsOf = (p) => rig().metas.get(p)?.props;
  const areas = [{ id: 'work', name: 'Work', folder: 'Work' }, { id: 'health', name: 'Health', folder: 'Health' }];
  const kept = L.purposefulCard(raw, { model, propsOf, areas });
  assert.deepEqual(hasHealth([L.checkInDraft(kept)]), [], `the served draft is clean (got ${JSON.stringify(L.checkInDraft(kept))})`);
});

test("Today: the brief's people lines run through the same filter", () => {
  const app = read('src/main/app.ts');
  const line = app.split('\n').find((l) => l.includes('quietBriefPeople(personCards'));
  assert.ok(line?.includes('purposefulCard'), `the brief filters its cards (got ${JSON.stringify(line?.trim())})`);
});

// ── The assistant's people tools: the sensitivity gate, already ────

test("assistant: the side chat's gate keeps health out of person answers", () => {
  const { model } = rig();
  const store = L.parseSensitivity(JSON.stringify({ folders: { Health: 'health' } }));
  assert.ok(!L.accessOf(store, 'side-chat').includes('health'), 'by default the side chat is not allowed Health');
  const metaProps = rig().metas;
  const s = {
    stamp: () => 't',
    level: (rel) => L.levelOf(store, rel, metaProps.get(rel)?.props?.sensitivity, metaProps.get(rel)?.props?.type, metaProps.get(rel)?.props?.area).level,
    allows: (who, level) => L.allows(store, who, level),
    decide: (who, rel, name) => L.decide(store, who, rel, s.level(rel), name),
    useGrant: () => false,
    audit: () => {},
  };
  const g = L.makeGate(s, 'side-chat', 'The side chat');
  assert.equal(g.sees('Health/Cardio check-in.md'), false, 'a Health note is not seen');
  assert.equal(g.sees('Health/Walk log.md'), false, 'a note in Health/ is not seen');
  assert.equal(g.sees('Work/Beacon.md'), true, 'a work note is seen');
  // The gated records, as gateIndex wires them: only what the agent may read.
  const notes = [...metaProps.values()].map((m) => ({ path: m.path, title: m.title, label: m.title, content: '', props: m.props, mtime: 0 }));
  const gated = L.gateIndex({ records: (opts = {}) => L.buildRecordModel({ notes: notes.filter((n) => !opts.allow || opts.allow(n.path)).map((n) => ({ ...n, content: FILES[n.path] ?? '' })), resolve: () => null, today: TODAY }) }, g);
  const answer = L.answerPerson(gated.records({ templatesFolder: 'Templates' }), { person: 'Sam Lee' });
  assert.deepEqual(hasHealth([answer]), [], `no health in the answer (got ${JSON.stringify(answer.slice(0, 300))})`);
  assert.ok(answer.includes('Beacon'), 'the work answer still flows');
});

// ── Peek's connected groups: the same rule, building on the served card ────

const viewDeps = (metas, model) => ({ model, propsOf: (p) => metas.get(p)?.props, areas: [{ id: 'work', name: 'Work', folder: 'Work' }, { id: 'health', name: 'Health', folder: 'Health' }] });

test("Peek groups: no protected join beside an unprotected person (projects still name them)", async () => {
  const { model, metas } = rig();
  const raw = L.peekOf(model, { id: 'person:sam lee' });
  assert.ok(raw, 'Sam peeks');
  const joined = (peek) => peek.groups.flatMap((g) => g.items.map((it) => it.record.title));
  // The test bites: the raw peek joins the health items.
  assert.ok(hasHealth(joined(raw)).length > 0, `the raw peek joins health (got ${JSON.stringify(joined(raw))})`);
  const kept = L.purposefulPeek(raw, viewDeps(metas, model));
  assert.deepEqual(hasHealth(joined(kept)), [], `no protected join (got ${JSON.stringify(joined(kept))})`);
  assert.ok(joined(kept).includes('Beacon quote') && joined(kept).includes('Kickoff'), 'the work joins stay');
  assert.ok(joined(kept).includes('Recovery') && joined(kept).includes('Beacon'), 'membership still names them');
  assert.ok(kept.groups.every((g) => g.items.length), 'no emptied group stays');
});

test('Peek: the role fact reads the served card, and the model is never rewritten', async () => {
  const { model, metas } = rig();
  const deps = viewDeps(metas, model);
  assert.equal(L.peekOf(model, { id: 'person:sam lee' }).record.facts.find((f) => f.key === 'role')?.value, 'Patient', 'the raw peek carries the health role');
  const sam = L.purposefulPeek(L.peekOf(model, { id: 'person:sam lee' }), deps);
  assert.equal(sam.record.facts.find((f) => f.key === 'role')?.value, 'Owner', 'the served peek reads the work role');
  const rae = L.purposefulPeek(L.peekOf(model, { id: 'person:rae morgan' }), deps);
  assert.equal(rae.record.facts.find((f) => f.key === 'role'), undefined, 'no role fact rather than the health one');
  assert.equal(model.records.get('person:sam lee').facts.find((f) => f.key === 'role')?.value, 'Patient', 'serving a peek never rewrites the model');
});

test('Peek: a protected peek and a non-person peek pass through untouched', async () => {
  const { model, metas } = rig();
  const deps = viewDeps(metas, model);
  const ana = L.peekOf(model, { id: 'person:ana grey' });
  assert.equal(L.purposefulPeek(ana, deps), ana, 'inside Health the peek is untouched');
  const beacon = L.peekOf(model, { id: 'project:Work/Beacon.md' });
  assert.equal(L.purposefulPeek(beacon, deps), beacon, 'a project peek is untouched');
  assert.equal(L.purposefulPeek(null, deps), null, 'no peek stays no peek');
});

test('Peek: records:peek serves the filtered peek', () => {
  const app = read('src/main/app.ts');
  const at = app.indexOf("handle('records:peek'");
  const block = app.slice(at, at + 700);
  assert.ok(block.includes('purposefulPeek'), `records:peek filters its peek (got ${JSON.stringify(block.slice(0, 200))})`);
});

// ── Related: never a protected note beside an unprotected person's page ────

test("Related: beside an unprotected person's page, protected notes are skipped", async () => {
  const { metas, model } = rig();
  const skip = L.purposefulRelatedSkip('Work/People/Sam Lee.md', viewDeps(metas, model));
  assert.ok(skip, 'a skip applies beside Sam');
  assert.equal(skip('Health/Cardio check-in.md'), true, 'an explicit Health note');
  assert.equal(skip('Health/Walk log.md'), true, 'a note in Health/');
  assert.equal(skip('Notes/School pickup.md'), true, 'a Family-private note');
  assert.equal(skip('Work/Notes/Beacon quote.md'), false, 'a work note');
});

test('Related: inside Health and off person pages, nothing extra is skipped', async () => {
  const { metas, model } = rig();
  const deps = viewDeps(metas, model);
  assert.equal(L.purposefulRelatedSkip('Health/People/Ana Grey.md', deps), null, 'inside Health nothing is skipped');
  assert.equal(L.purposefulRelatedSkip('Work/Beacon.md', deps), null, 'a project page is untouched');
  assert.equal(L.purposefulRelatedSkip('Health/Cardio check-in.md', deps), null, 'a note page is untouched');
});

test('Related: the real engine suggests the health note, and the skip removes it', async () => {
  const { metas, model } = rig();
  const deps = viewDeps(metas, model);
  // Vault-shaped docs: the health note and the work note both link to Sam's page.
  const docs = [
    { path: 'Work/People/Sam Lee.md', title: 'Sam Lee', tags: [], links: [] },
    { path: 'Health/Cardio check-in.md', title: 'Cardio check-in', tags: [], links: ['Work/People/Sam Lee.md'] },
    { path: 'Work/Notes/Beacon quote.md', title: 'Beacon quote', tags: [], links: ['Work/People/Sam Lee.md'] },
  ];
  const words = (p) => {
    const text = p.includes('Cardio') ? 'cardio check-in sam lee morning walk weight' : p.includes('Beacon quote') ? 'beacon quote sam lee review' : 'sam lee sam lee';
    const m = new Map();
    for (const w of text.split(' ')) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const open = L.relatedTo('Work/People/Sam Lee.md', docs, { words, rarity: () => 1 });
  assert.ok(open.some((r) => r.path === 'Health/Cardio check-in.md'), 'the engine suggests the health note');
  const skip = L.purposefulRelatedSkip('Work/People/Sam Lee.md', deps);
  const shut = L.relatedTo('Work/People/Sam Lee.md', docs, { words, rarity: () => 1, ...(skip ? { skip } : {}) });
  assert.ok(!shut.some((r) => r.path === 'Health/Cardio check-in.md'), 'the skip removes it');
  assert.ok(shut.some((r) => r.path === 'Work/Notes/Beacon quote.md'), 'the work note stays');
});

test('Related: both related channels consult the person skip', () => {
  const app = read('src/main/app.ts');
  const helperAt = app.indexOf('const relatedSkipFor = ');
  assert.ok(helperAt > 0 && app.slice(helperAt, helperAt + 400).includes('purposefulRelatedSkip'), 'one helper reads the person skip');
  const notesAt = app.indexOf("handle('index:related-notes'");
  assert.ok(app.slice(notesAt, notesAt + 700).includes('relatedSkipFor('), 'related-notes consults it');
  const relAt = app.indexOf("handle('index:related',");
  assert.ok(relAt > 0 && app.slice(relAt, relAt + 500).includes('relatedSkipFor('), 'related consults it');
});

// ── the former host app's embed: the same handlers, rebuilt in ───
