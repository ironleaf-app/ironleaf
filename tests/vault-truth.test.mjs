// node --test tests/vault-truth.test.mjs — v9-vault-truth (5 Nov 2026): what the project screens say must be
// true. A project page is about its own things — membership (its folder, a property, an explicit link in its
// file) — and other links show as see-also, never counted (P1); the project parser reads plain "date: what"
// leads everywhere instead of dropping them (P2). Made-up notes only. Fails first.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vault-truth-'));
let R;
let T;
let P;
let H;
let TL;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/records.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
  const mainEntry = path.join(work, 'main.ts');
  writeFileSync(
    mainEntry,
    `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\nexport { Projects } from ${JSON.stringify(path.join(root, 'src/main/projects.ts'))};\n`,
  );
  await build({ input: mainEntry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml')); } catch { /* already there */ }
  T = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
  const sharedEntry = path.join(work, 'shared.ts');
  writeFileSync(
    sharedEntry,
    `export * as P from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\nexport * as H from ${JSON.stringify(path.join(root, 'src/shared/project-hub.ts'))};\nexport * as TL from ${JSON.stringify(path.join(root, 'src/shared/timeline.ts'))};\n`,
  );
  await build({ input: sharedEntry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ P, H, TL } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const PROJECT = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
const OTHER = 'Projects/Website Refresh/Website Refresh.md';
const projectText = `---
type: project
status: active
health: on track
owner: Alex Chen
due: 2026-11-20
---

# Harbourline Cart Fix

The shop's cart drops about one order in forty at payment.

## What's next

- [ ] Chase the 2 carts that failed on Friday — Alex Chen — due 2026-11-05
- [ ] Retry the failed payment twice before showing an error — Priya Nair — due 2026-11-06
- [ ] Send the receipt v2 for review — Alex Chen — due 2026-11-04

## Key dates

- 2026-11-06: Retry fix live (milestone)
- 2026-11-20: Cart fix done (milestone)

## Decisions

- 2026-11-01: Retry twice, then fail loud (decided by Alex Chen)

## Risks

- Repeat failures on old Safari (owner: Priya Nair, level: medium)

## People

- Alex Chen (owner)
- Priya Nair

## Documents

- [[Receipts spec]] — what v2 shows
`;
const notes = [
  { path: PROJECT, title: 'Harbourline Cart Fix', label: 'Harbourline Cart Fix', mtime: 9, props: { type: 'project', status: 'active', health: 'on track', owner: 'Alex Chen', due: '2026-11-20' }, content: projectText },
  { path: OTHER, title: 'Website Refresh', label: 'Website Refresh', mtime: 1, props: { type: 'project', status: 'active' }, content: '---\ntype: project\nstatus: active\n---\n# Website Refresh\n' },
  { path: 'Projects/Harbourline Cart Fix/Notes/Till readings.md', title: 'Till readings', label: 'Till readings', mtime: 8, props: {}, content: '# Till readings\n\n- [ ] Book the room for the retro\n- [ ] Ask Priya about the Safari failures\n' },
  { path: 'Meetings/2026-11-03 Cart standup.md', title: '2026-11-03 Cart standup', label: '2026-11-03 Cart standup', mtime: 7, props: { type: 'meeting', date: '2026-11-03', project: '[[Harbourline Cart Fix]]' }, content: '---\ntype: meeting\ndate: 2026-11-03\nproject: "[[Harbourline Cart Fix]]"\n---\n# 2026-11-03 Cart standup\n\n## Actions\n\n- [ ] Check the retry logs — Priya Nair\n- [ ] Ring the payment provider — Alex Chen\n' },
  { path: 'Notes/Receipts spec.md', title: 'Receipts spec', label: 'Receipts spec', mtime: 6, props: {}, content: '# Receipts spec\n\nWhat v2 shows after payment.\n' },
  { path: 'Notes/Supplier chat.md', title: 'Supplier chat', label: 'Supplier chat', mtime: 5, props: {}, content: '# Supplier chat\n\nAbout the [[Harbourline Cart Fix]] terminals.\n\n- [ ] Ask about the dock cables\n- [ ] Get the spring catalogue\n- [ ] Book the forklift service\n' },
  { path: 'Notes/Roster gaps.md', title: 'Roster gaps', label: 'Roster gaps', mtime: 4, props: {}, content: '# Roster gaps\n\nThe [[Harbourline Cart Fix]] crew and the [[Website Refresh]] crew both want Friday nights.\n\n- [ ] Find two volunteers for Friday\n' },
];
const resolve = (t, from) => {
  const base = String(t).replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
  const hit = notes.find((n) => n.title === base || n.path === base || n.path.endsWith(`/${base}.md`));
  return hit ? hit.path : null;
};
const model = () => R.buildRecordModel({ notes, resolve, today: '2026-11-04', me: 'Alex Chen' });

// ── P1: membership, not mere links ─────────────────────────────────────────────

test('P1 records: a note that merely links to one project is not adopted by it', () => {
  const m = model();
  const rec = (p) => m.records.get(`note:${p}`);
  assert.equal(rec('Projects/Harbourline Cart Fix/Notes/Till readings.md').project, PROJECT, 'its folder: a member');
  assert.equal(m.records.get('meeting:Meetings/2026-11-03 Cart standup.md').project, PROJECT, 'its property: a member');
  assert.equal(rec('Notes/Receipts spec.md').project, PROJECT, 'named in the project file: a member');
  assert.equal(rec('Notes/Supplier chat.md').project, undefined, 'a mere link: see-also, never a member');
  assert.equal(rec('Notes/Roster gaps.md').project, undefined, 'links to two: still no guess');
  const titles = R.connectedActions(m, PROJECT).map((a) => a.what);
  assert.ok(titles.includes('Book the room for the retro'), 'a folder note’s task counts');
  assert.ok(titles.includes('Check the retry logs'), 'a property meeting’s action counts');
  assert.ok(!titles.includes('Ask about the dock cables'), 'a mere linker’s tasks never count');
  assert.ok(!titles.includes('Find two volunteers for Friday'), 'an ambiguous linker’s tasks never count');
});

test('P1 records: the hub counts the project’s own actions, not the vault’s', () => {
  const m = model();
  const hub = R.projectNeeds(m, PROJECT);
  // 3 steps in the file, 2 in the folder note, 2 in the property meeting: 7. The linker’s 3 and the
  // ambiguous note’s 1 stay out.
  assert.equal(hub.counts.open, 7, `7 open, not the linker’s too (got ${hub.counts.open})`);
  assert.ok(!hub.actions.some((a) => /dock cables|forklist service|volunteers/.test(a.what)), 'no linker lines in the hub');
});

test('P1 view: members are notes, mere links are see-also, nothing vanishes', () => {
  const index = new T.VaultIndex();
  for (const n of notes) index.set(n.path, n.content, n.mtime, n.content.length);
  const view = new T.Projects(index).view(PROJECT);
  const inNotes = view.notes.map((n) => n.path);
  const seeAlso = view.linkedFrom.map((n) => n.path);
  assert.ok(inNotes.includes('Projects/Harbourline Cart Fix/Notes/Till readings.md'), 'folder note counts');
  assert.ok(inNotes.includes('Meetings/2026-11-03 Cart standup.md'), 'property meeting counts');
  assert.ok(inNotes.includes('Notes/Receipts spec.md'), 'project-linked note counts');
  assert.ok(seeAlso.includes('Notes/Supplier chat.md'), 'mere link moves to see-also');
  assert.ok(seeAlso.includes('Notes/Roster gaps.md'), 'ambiguous link moves to see-also');
  const union = [...inNotes, ...seeAlso];
  for (const p of ['Projects/Harbourline Cart Fix/Notes/Till readings.md', 'Meetings/2026-11-03 Cart standup.md', 'Notes/Receipts spec.md', 'Notes/Supplier chat.md', 'Notes/Roster gaps.md']) {
    assert.ok(union.includes(p), `${p} still shows somewhere`);
  }
});

test('P1 page: the Notes section counts members, and see-also is never counted', () => {
  // 5 Nov 2026, the vault folio: the tabs became sections, so no tab count is left to pin; the Notes section's
  // kind chips count the member rows instead, and see-also shows below them, never counted and never filtered.
  // t12, 8 Nov 2026: the row building moved into folioNoteRows/folioSeeAlso beside the section, shared with the
  // visibility rule so the rule and the section never disagree; the counting is unchanged.
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.doesNotMatch(page, /view\.notes\.length \+ view\.linkedFrom\.length/, 'see-also is never counted');
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const at = tabs.indexOf('export function NotesSection');
  const sec = tabs.slice(at, tabs.indexOf('// ── Files'));
  assert.ok(sec.includes('folioNoteRows(ctx.view.notes, byPath)'), 'the member rows feed the chips');
  assert.ok(sec.includes('folioSeeAlso(ctx.view, byPath)'), 'see-also comes from the links that are not membership');
  // t239's one list (their decision 4, 12 Nov): notes, documents and files read as one All list, and the
  // chips count it; meetings read under their own head, see-also below, never counted (t249 item 1 counts
  // agree).
  assert.ok(/n: merged\.(length|filter)/.test(sec), 'the chips count the members');
  assert.ok(!/n: seeAlso/.test(sec), 'see-also is never counted');
  assert.ok(sec.includes('See also'), 'the Notes section shows see-also');
});

test('P1 hub: Latest files names the project’s own notes, not anything linking it', () => {
  const src = read('src/renderer/src/views/project/ProjectHub.tsx');
  const at = src.indexOf('export function hubFiles');
  const fn = src.slice(at, src.indexOf('export function ProjectHub'));
  assert.ok(fn.includes('view.notes'), 'its own notes stay');
  assert.ok(!fn.includes('linkedFrom'), 'mere links no longer read as its files');
});

// ── P2: plain "date: what" leads read everywhere ───────────────────────────────

test('P2 parser: Key dates and Decisions read a plain colon lead; bracket colons never split', () => {
  const p = P.parseProject(projectText, PROJECT);
  assert.deepEqual(
    p.dates.map((d) => [d.when, d.what]),
    [
      ['2026-11-06', 'Retry fix live (milestone)'],
      ['2026-11-20', 'Cart fix done (milestone)'],
    ],
  );
  assert.equal(p.decisions.length, 1);
  assert.equal(p.decisions[0].date, '2026-11-01');
  assert.equal(p.decisions[0].what, 'Retry twice, then fail loud (decided by Alex Chen)');
  assert.equal(p.risks.length, 1, 'the risk still reads');
  assert.equal(p.risks[0].what, 'Repeat failures on old Safari (owner: Priya Nair, level: medium)', 'a colon inside brackets is not a lead');
  assert.deepEqual(
    p.people.map((x) => [x.name, x.role ?? '']),
    [
      ['Alex Chen (owner)', ''],
      ['Priya Nair', ''],
    ],
  );
});

test('P2 save: colon lines keep their bytes when untouched; milestones read them', () => {
  const p = P.parseProject(projectText, PROJECT);
  const back = P.serializeProject(p, projectText);
  assert.ok(back.includes('- 2026-11-01: Retry twice, then fail loud (decided by Alex Chen)'), `an untouched decision keeps its line:\n${back}`);
  assert.ok(back.includes('- Repeat failures on old Safari (owner: Priya Nair, level: medium)'), `an untouched risk keeps its line:\n${back}`);
  const again = P.parseProject(back, PROJECT);
  assert.deepEqual(
    again.dates.map((d) => [d.when, d.what]),
    p.dates.map((d) => [d.when, d.what]),
    'key dates survive the save',
  );
  const hub = H.hubModel({ project: p, today: TL.readDay('2026-11-04'), me: 'Alex Chen', connected: [] });
  assert.ok(hub.milestones.some((m) => m.what === 'Retry fix live (milestone)'), 'the Timeline stops saying “No milestones yet”');
  assert.ok(hub.upcoming.some((m) => m.what === 'Retry fix live (milestone)'), 'Overview names the next one');
});

test('P2 decisions: no lone dot when the why or the date is missing', () => {
  // 5 Nov 2026, the vault folio: the tabs became sections (anchors only; the middot fix is unchanged).
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const at = tabs.indexOf('export function DecisionsSection');
  const tab = tabs.slice(at, tabs.indexOf('// ── Key dates'));
  assert.ok(tab.includes("d.why?.trim() && d.date?.trim() ? ' · '"), 'the dot shows only between two words');
});

// ── Beside P1/P2 in the same files: the tab’s words say what is true ──────────

test('D1: flowed actions are named once, as what they are', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(tabs.includes('Actions filed from its notes and meetings'), 'the heading names notes and meetings, not meetings alone');
  assert.ok(!tabs.includes('Actions that flowed here from meetings'), 'the old heading is gone');
  // Step 2: the explainer paragraph under the list is gone (brief-directed); each row's tick still says what
  // it does where it shows.
  assert.ok(tabs.includes('Tick “') && tabs.includes('Open “'), 'each row says what its tick does');
  assert.doesNotMatch(tabs, />filed <Icon/, 'no per-row filed tag');
});

test('F1: no folder on this PC hides Files, with choosing one click away', () => {
  // 5 Nov 2026, the vault folio: the page has sections now, never tabs, and Notes sits above Files. t12, 8 Nov
  // 2026, wanted nothing empty on show: a never-linked folder hides the section instead of an empty state, and
  // the Notes tab's folder door chooses it; a folder that moved still names where it was.
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(!tabs.includes('No folder on this PC yet'), 'no empty words on show');
  assert.ok(tabs.includes('title="No folder here"'), 'a moved folder still names where it was');
  assert.ok(tabs.includes('chooseProjectFolder'), 'choosing stays one click away');
  assert.ok(tabs.includes('projectWhere(p)'), 'missing still names where it was');
});

test('V1: the project Notes filter calls notes Notes', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(tabs.includes("{ id: 'site', label: 'Notes'"), 'the filter reads Notes');
  assert.ok(!tabs.includes('Site notes'), 'nowhere says Site notes on the project page');
});
