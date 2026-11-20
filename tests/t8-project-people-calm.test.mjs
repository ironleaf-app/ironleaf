// node --test tests/t8-project-people-calm.test.mjs — Project and People pages, calm and connected (t8, 8 Nov 2026).
// Each person shows their role and organisation, the projects they're on, the open tasks they own, and the last
// meeting plus what's waiting; a work person never shows health or personal facts; links work both ways. Every fact on
// the project page writes back where it sits. Lists keep fixed columns at 3456 wide with a sensible reading width.
// Fails first: the rows below name no projects, an empty role or organisation shows no way to add one, and the person
// page mixes projects into the timeline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const peoplePage = () => read('src/renderer/src/views/PeoplePage.tsx');
const personPage = () => read('src/renderer/src/views/PersonPage.tsx');
const projectPage = () => read('src/renderer/src/views/ProjectPage.tsx');

// ── Both ways: a person on a project shows on the person's page too ────

test('a People row names the projects they are on, not just the first open thing', () => {
  const src = peoplePage();
  const meta = src.slice(src.indexOf('function rowMeta'), src.indexOf('function rowMeta') + 900);
  assert.ok(meta.includes('c.projects'), 'the row reads the projects they are on');
  assert.ok(/projects\.slice\(0,\s*2\)|projects\.length/.test(meta), 'bounded: two names, then a count, never a long trail');
});

test('a person page lists their projects as projects, each opening', () => {
  const src = personPage();
  assert.ok(src.includes('>Projects<') || src.includes('"Projects"') || src.includes("'Projects'"), 'a Projects head, not just timeline rows');
  assert.ok(/card\.projects\.map/.test(src), 'every project they are on is listed');
  assert.ok(/A\.openPath\(p\.path/.test(src) || /openPath\(p\.path/.test(src), 'each project opens where it is');
});

test('a person on a project reaches that project and back (records, both ways)', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const work = mkdtempSync(path.join(tmpdir(), 'nv-t8-both-'));
  try {
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    await build({ input: path.join(root, 'src/shared/records.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
    const R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
    const WORK = 'Projects/Work/Work.md';
    const notes = [
      { path: WORK, title: 'Work', label: 'Work', mtime: 1, props: { type: 'project' }, content: '---\ntype: project\nstatus: active\n---\n# Work\n## People\n- **Sam Okafor** — Joinery lead\n' },
      { path: 'People/Sam.md', title: 'Sam Okafor', label: 'Sam', mtime: 1, props: { type: 'person', role: 'Joinery lead' }, content: '---\ntype: person\nrole: Joinery lead\n---\n# Sam Okafor\n' },
    ];
    const resolve = (t) => {
      const base = String(t).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
      const hit = notes.find((n) => n.title === base || n.path.endsWith(`${base}.md`));
      return hit ? hit.path : null;
    };
    const m = R.buildRecordModel({ notes, resolve, today: '2026-11-08' });
    const sam = m.records.get('person:sam okafor');
    assert.ok(sam, 'Sam is known');
    const toProject = R.connectedTo(m, sam.id).find((x) => x.record.type === 'project');
    assert.ok(toProject, 'the person reaches the project naming them');
    const back = R.connectedTo(m, toProject.record.id).find((x) => x.record.id === sam.id);
    assert.ok(back, 'the project reaches the person back');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ── Editable where it sits, writing back ────

test('an empty role or organisation on People still offers its change (nothing dead)', () => {
  const src = peoplePage();
  // The tile's role used to need !!c.role: with no role there was nothing to click. It must offer Add now.
  assert.ok(!/const roleEditable = !!c\.role &&/.test(src), 'an empty role is still offered where it shows');
  assert.ok(src.includes('placeholder="+ Role"') || src.includes('placeholder="+ Role"'), 'the empty role names what it adds');
  assert.ok(!/const orgEditable = c\.type === 'person' && !!c\.orgName &&/.test(src), 'an empty organisation is still offered');
});

test('an empty role, organisation, email or phone on a person still offers its change', () => {
  const src = personPage();
  assert.ok(!/const roleEditable = !!card && !!card\.role &&/.test(src), 'an empty role is still offered on the person');
  assert.ok(!/const orgEditable = !!card && card\.type === 'person' && !!card\.orgName &&/.test(src), 'an empty organisation is still offered');
  assert.ok(src.includes('Add an email') || src.includes('+ Email') || src.includes('Changed the email'), 'an email can be added where it shows');
  assert.ok(src.includes('Add a phone') || src.includes('+ Phone') || src.includes('Changed the phone'), 'a phone number can be added where it shows');
});

test("a named-only person's role writes back to the project note (not nowhere)", async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const work = mkdtempSync(path.join(tmpdir(), 'nv-t8-edit-'));
  try {
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    const entry = path.join(work, 'entry.ts');
    writeFileSync(entry, `export { parseProject, applyProjectEdit, serializeProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\nexport { recordFactEdit, recordFactText } from ${JSON.stringify(path.join(root, 'src/shared/record-edits.ts'))};\n`);
    await build({ input: entry, platform: 'node', output: { file: path.join(work, 'e.mjs'), format: 'esm' }, logLevel: 'silent' });
    const E = await import(pathToFileURL(path.join(work, 'e.mjs')).href);
    const file = 'Projects/Work/Work.md';
    const before = '---\ntype: project\nstatus: active\n---\n# Work\n\n## People\n\n- Sam Okafor\n';
    const p = E.parseProject(before, file);
    const record = { type: 'person', title: 'Sam Okafor', path: file, page: false };
    assert.notEqual(E.recordFactText(p, record, 'role', file), null, 'the empty role has somewhere to write');
    const edit = E.recordFactEdit(p, record, 'role', 'Joinery lead', file);
    assert.ok(edit, 'the change is a project edit');
    E.applyProjectEdit(p, edit, '8 Nov 2026');
    const after = E.serializeProject(p, before);
    assert.ok(after.includes('Joinery lead'), 'the note keeps the new role');
    assert.ok(after.includes('Sam Okafor'), 'the person is still named once');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ── Each person: role, projects, open tasks, last meeting, waiting; never health on work ────

test('each person carries role, open tasks, last meeting and waiting (People and person)', () => {
  const list = peoplePage();
  assert.ok(list.includes('rowMeta(c)'), 'the list rows read one meta line');
  assert.ok(/c\.role|c\.orgName/.test(list), 'that line starts with who they are');
  assert.ok(list.includes('Owes you') && list.includes('You owe'), 'waiting reads both ways on the row');
  const one = personPage();
  assert.ok(one.includes('You owe') && one.includes('Owes you'), 'the person keeps both halves');
  assert.ok(one.includes('Last met') && one.includes('nextMeeting'), 'the last meeting and the next one show');
});

test('a work person never shows health or personal facts', () => {
  const src = personPage();
  // The person page renders role, organisation, email, phone, halves, projects and timeline only. It never reads
  // a health, medical, wellbeing or sensitivity fact onto the page (the lock notice on protected cards lives on the
  // list, not here, and names the protection, never a fact).
  assert.ok(!/c\.health|card\.health|props\.health|facts\.health|wellbeing|medical/i.test(src), 'no health fact read on the person page');
  assert.ok(!/sensitivity/.test(src), 'no sensitivity fact read on the person page');
  const list = peoplePage();
  const tile = list.slice(list.indexOf('export function PersonTile'), list.indexOf('export function PersonTile') + 4200);
  assert.ok(!/c\.health|card\.health|wellbeing|medical/.test(tile), 'no health fact on a list tile either');
});

// ── Fixed columns at the width ────────────

test('task rows keep who and when in fixed columns; lists keep the reading width', () => {
  const plan = read('src/renderer/src/styles/plan.css');
  assert.ok(plan.includes('--who-w: 148px') && plan.includes('--when-w: 170px'), 'who and when are fixed columns');
  assert.ok(plan.includes('grid-template-columns: 20px minmax(0, 1fr) var(--who-w) var(--when-w)'), 'tick, title, who, when share one x');
  const frame = read('src/renderer/src/styles/page-frame.css');
  assert.ok(frame.includes('.nv-page.full.w2b-list') && frame.includes('max-width: var(--page-max)'), 'People keeps the column, never 2,500 px rows');
  const shell = read('src/renderer/src/styles/polish-shell.css');
  // t254 (13 Nov 2026) widened the column to 2400 at 3456 wide; 20 Nov 2026 (on a ~2000 px monitor:
  // "big wide open space ... it's everywhere") rows never stretch any more: the column stays --w-content and a
  // wide window adds the detail beside the list (.nv-split, --w-wide), so the width is used without 2,000 px
  // rows.
  assert.ok(!/--page-max:\s*2400px/.test(shell), 'no row runs 2,400 px wide');
  assert.ok(frame.includes('--w-wide: 1900px') && frame.includes('.nv-page.has-split.has-split'), 'a wide window gives a list its detail beside it');
  const folio = read('src/renderer/src/styles/w2a.css');
  // t242 (12 Nov, "no white oceans", the same direction as the approved Today 2000): the widest folio reads
  // 2080 with side columns instead of joining the 1440 rooms; the narrower steps stand as before. t255 (13
  // Nov, the pictures: the fixed 1.35 pairing left an empty half beside Key dates): the pairing is equal
  // columns, densely so no hole stands mid-page.
  assert.ok(/\.vpage\.wide\.pj-folio \{ max-width: 2080px; display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(folio), 'the widest folio reads 2080 with side columns');
  assert.ok(/grid-auto-flow: dense/.test(folio), 'paired densely, no hole mid-page');
});

// ── Status: the shared reading only (t2 owns the words; this job writes none) ────

test('the project page reads status through the shared function, never its own words', () => {
  const src = projectPage();
  assert.ok(src.includes('propStatus(p)'), 'the one shared reading');
  // Since t2 (8 Nov 2026, one fact one value) the pill reads the one standing's words; the menu still names the
  // stored statuses through the shared word list.
  assert.ok(src.includes('projectStanding('), 'the one shared standing');
  assert.ok(src.includes('PROP_STATUS_WORDS[v]'), 'the one shared words in the menu');
  // No own status logic on the page: no fresh status-word maps beside the shared one.
  const own = (src.match(/'At risk'|"At risk"|Off track/g) ?? []).length;
  assert.equal(own, 0, `no status words of its own on the page (saw ${own})`);
  // t242's one view removed the project board and its column rule from the page (commit 4638960c5); t249
  // removed the shared rule itself (REPORT-t249 item 3: the board is gone "from Tasks and from the shared
  // rules"). No board left to sit by, so no pin left for it; the shared status readings above stand.
});
