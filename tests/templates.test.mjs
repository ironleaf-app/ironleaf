// node --test tests/templates.test.mjs — templates (src/main/templates.ts, src/shared/templates.ts; 17 Oct 2026):
// variables filled, Ironleaf's ready-made templates written once and never over (or beside) the person's own, a deleted
// one stays deleted, notes and project files made from them, and every project template giving a valid project file
// (src/shared/project-file.ts).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-templates-'));
let M; // src/main/templates.ts
let S; // src/shared/templates.ts
let D; // src/shared/dates.ts
let P; // src/shared/project-file.ts
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, ['main/templates', 'shared/templates', 'shared/dates', 'shared/project-file'].map((m, i) => `export * as m${i} from ${JSON.stringify(path.join(root, 'src', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 't.mjs')).href);
  [M, S, D, P] = [all.m0, all.m1, all.m2, all.m3];
});
after(() => rmSync(work, { recursive: true, force: true }));

/** A library in memory: its notes by path. */
function store(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    any: async (rel) => files.has(rel) || [...files.keys()].some((k) => k.startsWith(`${rel}/`)),
    create: async (rel, text) => {
      if (files.has(rel)) throw new Error(`EEXIST ${rel}`);
      files.set(rel, text);
    },
    notes: () => [...files.keys()],
  };
}

const NOW = new Date(2026, 9, 17, 9, 5); // Saturday 17 October 2026, 9:05 am
const vars = { title: 'Board meeting', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', now: NOW };

test('variables: title, project, date and time, formats, dates from today; anything else left as written', () => {
  const out = D.fillTemplate('{{title}} · {{ project }} · {{date}} {{time}} · {{date:dddd D MMMM}} · {{date+2w:D MMM}} · {{date-1d}} · {{date+1m:D MMM YYYY}} · {{cursor}}', { ...vars, project: 'Northgate office opening' });
  assert.equal(out, 'Board meeting · Northgate office opening · 2026-10-17 09:05 · Saturday 17 October · 31 Oct · 2026-10-16 · 17 Nov 2026 · {{cursor}}');
  assert.equal(D.fillTemplate('[{{project}}]', vars), '[]', 'no project: nothing');
  // A month on from 31 January is the last day of February; a year on from 29 February is 28 February.
  assert.equal(D.formatDate('YYYY-MM-DD', D.shiftDate(new Date(2027, 0, 31), '+1m')), '2027-02-28');
  assert.equal(D.formatDate('YYYY-MM-DD', D.shiftDate(new Date(2028, 1, 29), '+1y')), '2029-02-28');
  assert.equal(D.formatDate('YYYY-MM-DD', D.shiftDate(NOW, '+3d')), '2026-10-20');
});

test('ready-made templates: written into Templates/Notes, Projects and Reports, once; never written over', async () => {
  const s = store({ 'Templates/Reports/Progress report.md': 'MY OWN progress report' });
  const first = await M.ensureBuiltIns(s, 'Templates', { written: [] });
  assert.ok(first.made.includes('Templates/Notes/Meeting notes.md'));
  assert.ok(first.made.includes('Templates/Projects/IT rollout.md'));
  assert.ok(first.made.includes('Templates/Reports/Portfolio update.md'));
  assert.ok(!first.made.includes('Templates/Reports/Progress report.md'), 'the person’s own is never written over');
  assert.equal(s.files.get('Templates/Reports/Progress report.md'), 'MY OWN progress report');
  assert.equal(first.record.written.length, M.BUILT_INS.length, 'every one remembered, theirs too');
  for (const b of M.BUILT_INS) assert.ok(s.files.has(M.builtInPath('Templates', b)), b.name);
  const second = await M.ensureBuiltIns(s, 'Templates', first.record);
  assert.deepEqual(second.made, []);
});

test('never beside the person’s own of the same name or kind (Templates/Meeting.md means no Meeting notes)', async () => {
  const s = store({ 'Templates/Meeting.md': '## Who', 'Templates/Daily.md': '## Today', 'Templates/Weekly report.md': 'mine' });
  const { made, record } = await M.ensureBuiltIns(s, 'Templates', { written: [] });
  assert.ok(!made.some((p) => /Meeting notes|Daily note|Weekly status/.test(p)), made.join('\n'));
  assert.ok(record.written.includes('meeting-notes') && record.written.includes('daily-note'));
  // A daily template set in Settings counts as theirs.
  const t = store();
  const r = await M.ensureBuiltIns(t, 'Templates', { written: [] }, { theirs: (b) => b.id === 'daily-note' });
  assert.ok(!r.made.includes('Templates/Notes/Daily note.md'));
});

test('a template the person deletes stays deleted; “Bring them back” writes it again', async () => {
  const s = store();
  const { record } = await M.ensureBuiltIns(s, 'Templates', { written: [] });
  s.files.delete('Templates/Notes/Risk log.md');
  s.files.delete('Templates/Projects/Event.md');
  const again = await M.ensureBuiltIns(s, 'Templates', record);
  assert.deepEqual(again.made, [], 'deleted stays deleted');
  assert.deepEqual((await M.missingBuiltIns(s, 'Templates', again.record)).map((b) => b.name).sort(), ['Event', 'Risk log']);
  const back = await M.ensureBuiltIns(s, 'Templates', again.record, { restore: true });
  assert.deepEqual(back.made.sort(), ['Templates/Notes/Risk log.md', 'Templates/Projects/Event.md']);
});

test('a note from a template: filled in, the template’s own properties left out, an empty project link dropped', () => {
  const meeting = M.BUILT_INS.find((b) => b.id === 'meeting-notes').text;
  const plain = S.noteFromTemplate(meeting, vars);
  assert.ok(!/description:/.test(plain), 'description is the template’s, not the note’s');
  assert.ok(!/^project:/m.test(plain), 'no project: no empty link');
  assert.ok(/^date: 2026-10-17$/m.test(plain) && /^type: meeting$/m.test(plain));
  assert.ok(plain.includes('**When:** Saturday 17 October 2026, 09:05'));
  assert.ok(!plain.includes('{{'), 'nothing left unfilled');
  const inProject = S.noteFromTemplate(meeting, { ...vars, project: 'Northgate office opening' });
  assert.ok(/^project: "\[\[Northgate office opening\]\]"$/m.test(inProject));
  // Every note template fills completely.
  for (const b of M.BUILT_INS.filter((x) => S.templateKind(x.text) === 'note')) {
    const out = S.noteFromTemplate(b.text, { ...vars, project: 'P' });
    assert.ok(!out.includes('{{'), `${b.name} leaves no {{…}}`);
    assert.ok(S.templateDescription(b.text).length > 10, `${b.name} says what it is for`);
  }
  // Inserted into a note that has words: the words only.
  assert.ok(!S.bodyOfTemplate(meeting, vars).startsWith('---'));
  // How-to-use lives in the description, never as note text.
  const monthly = M.BUILT_INS.find((b) => b.id === 'monthly-update').text;
  assert.ok(!S.noteFromTemplate(monthly, vars).includes('export it as a PDF'), 'a finished monthly update keeps no how-to');
  assert.ok(S.templateDescription(monthly).includes('export it as a PDF'), 'the how-to is in the description instead');
});

test('every project template makes a valid project file: next steps, key dates and risks, dates from today', () => {
  const all = M.BUILT_INS.filter((b) => S.templateKind(b.text) === 'project');
  assert.deepEqual(all.map((b) => b.name), ['IT rollout', 'Site opening', 'Site close-down', 'Event', 'Monthly reporting', 'Blank', 'Programme', 'Site or event', 'Register', 'Tracker', 'Habit', 'Venture']);
  // (the layout presets, 21 Oct 2026, are checked in tests/layouts.test.mjs)
  const shapes = all.filter((b) => !b.id.startsWith('project-layout-'));
  for (const b of shapes) {
    const { text } = S.projectFromTemplate(b.text, { ...vars, name: 'Melbourne office', today: '2026-10-17', folder: 'C:\\Projects\\Melbourne office' });
    assert.ok(P.isProjectText(text), `${b.name}: a project file`);
    assert.ok(!text.includes('{{') && !/description:|project-template/.test(text), `${b.name}: filled, no template properties`);
    const p = P.parseProject(text, 'Projects/Melbourne office/Melbourne office.md');
    assert.equal(p.name, 'Melbourne office');
    assert.equal(p.started, '2026-10-17');
    assert.equal(p.updated, '2026-10-17');
    assert.equal(p.folder, 'C:\\Projects\\Melbourne office');
    assert.equal(p.key, P.projectKey('C:\\Projects\\Melbourne office'));
    assert.ok(p.next.length >= 1 && p.next.every((n) => !n.done), `${b.name}: next steps, none done`);
    if (b.id !== 'project-blank') {
      assert.ok(p.next.length >= 5, `${b.name}: ${p.next.length} next steps`);
      assert.ok(p.dates.length >= 3, `${b.name}: key dates`);
      assert.ok(p.risks.length >= 2 && p.risks.every((r) => r.level), `${b.name}: risks with how much each matters`);
      assert.ok(p.summary.length > 20, `${b.name}: a summary to write over`);
    }
    // It reads and writes back the same (the one format).
    assert.equal(P.serializeProject(P.parseProject(text), text), text, `${b.name}: stable`);
  }
  const it = S.projectFromTemplate(M.BUILT_INS.find((b) => b.id === 'project-it-rollout').text, { ...vars, name: 'Windows 11', today: '2026-10-17' }).project;
  assert.equal(it.due, '2026-12-26', 'ten weeks on');
  assert.equal(it.next[0].when, '24 Oct 2026');
  assert.equal(it.dates[0].when, '17 Oct 2026');
  // No template: just the name (what "New project" made before).
  const blank = S.projectFromTemplate('', { ...vars, name: 'Plain', today: '2026-10-17' }).project;
  assert.deepEqual([blank.name, blank.next.length, blank.status], ['Plain', 0, 'planning']);
});

test('save as template: a project becomes a project shape (its own facts left out); a note keeps its words', () => {
  const project = P.serializeProject({ ...P.emptyProject('Northgate office'), status: 'active', health: 'at risk', progress: 60, folder: 'C:\\x', started: '2026-09-01', next: [{ done: true, what: 'Sign the lease', who: 'Jesse' }, { done: false, what: 'Order the internet' }], dates: [{ when: '1 Nov 2026', what: 'Opening', status: 'late' }], risks: [{ level: 'high', what: 'Internet late' }], updates: [{ date: '1 Oct', what: 'Lease signed' }], decisions: [{ what: 'Go with the bigger office' }] });
  const shape = S.templateFromNote(project, { isProject: true, description: 'Opening an office overseas' });
  assert.equal(S.templateKind(shape), 'project');
  assert.equal(S.templateDescription(shape), 'Opening an office overseas');
  const made = S.projectFromTemplate(shape, { ...vars, name: 'Singapore office', today: '2026-10-17' }).project;
  assert.equal(made.name, 'Singapore office');
  assert.deepEqual(made.next.map((n) => [n.what, n.done]), [['Sign the lease', false], ['Order the internet', false]]);
  assert.deepEqual([made.risks.length, made.updates.length, made.decisions.length, made.progress, made.folder], [1, 0, 0, undefined, undefined]);
  const note = S.templateFromNote('---\ntags: [x]\n---\n## Agenda\n- one\n', { isProject: false, description: 'Our agenda' });
  assert.ok(note.startsWith('---\ndescription: "Our agenda"\ntags: [x]\n---\n## Agenda'));
  assert.equal(S.templateKind(note), 'note');
});

test('the Templates page: grouped Notes · Projects · Reports, each saying what it is for and where it is used', async () => {
  const s = store();
  await M.ensureBuiltIns(s, 'Templates', { written: [] });
  s.files.set('Templates/Projects/Our brief.md', '---\ndescription: Our own brief\n---\n## Why');
  const notes = [...s.files].map(([p, text], i) => ({ path: p, text, mtime: i }));
  const list = M.listTemplates(notes, 'Templates', 'Templates/Notes/Daily note.md');
  const by = (name) => list.find((t) => t.name === name);
  assert.deepEqual([by('Meeting notes').group, by('IT rollout').group, by('Progress report').group, by('Monthly update').group], ['notes', 'projects', 'reports', 'reports']);
  assert.equal(by('Progress report').kind, 'report');
  assert.equal(by('Progress report').usedFor, 'Used when you make a progress report from a project’s page');
  assert.match(by('Portfolio update').usedFor, /update across all projects/);
  assert.equal(by('Daily note').usedFor, 'Used for today’s note (Ctrl+Shift+D)');
  assert.equal(by('IT rollout').usedFor, 'Offered when you make a new project');
  assert.deepEqual(by('IT rollout').counts, { next: 6, dates: 5, risks: 4 });
  assert.equal(by('Meeting notes').builtIn, 'meeting-notes');
  assert.equal(by('Our brief').builtIn, undefined, 'the person’s own');
  assert.equal(by('Our brief').group, 'notes', 'a plain note in Templates/Projects is a note’s template');
  assert.equal(list[0].name, 'Meeting notes', 'Ironleaf’s in the order people need them, the person’s own after');
});

test('another folder of notes: the ready-made templates are added once when it first opens, beside only its two report layouts', async () => {
  // A folder the person opened (not Ironleaf's own library) with just the two report layouts in it.
  const s = store({ 'Templates/Reports/Progress report.md': 'theirs', 'Templates/Reports/Portfolio update.md': 'theirs' });
  // Before it has ever been opened with this version nothing counts as deleted: there is no "Bring them back".
  assert.deepEqual(await M.missingBuiltIns(s, 'Templates', { written: [] }), []);
  const first = await M.ensureBuiltIns(s, 'Templates', { written: [] });
  assert.equal(first.made.length, M.BUILT_INS.length - 2, 'every other ready-made template is added');
  assert.equal(s.files.get('Templates/Reports/Progress report.md'), 'theirs', 'theirs never written over');
  // Opened again: nothing added, nothing duplicated; three deleted are then the only ones "Bring them back" offers.
  for (const n of ['Notes/Risk log', 'Notes/Site visit', 'Projects/Event']) s.files.delete(`Templates/${n}.md`);
  const again = await M.ensureBuiltIns(s, 'Templates', first.record);
  assert.deepEqual(again.made, []);
  assert.deepEqual((await M.missingBuiltIns(s, 'Templates', again.record)).map((b) => b.name).sort(), ['Event', 'Risk log', 'Site visit']);
});
