// node --test tests/starter-templates-88.test.mjs — starter templates in one click (8.8,
// src/shared/starter-templates.ts): the ten starters, each making real notes, records and saved views in a folder the
// person names, using only the app's own formats. Every note's properties read, every view opens over its notes, the
// CRM has people, companies and a deals board, the client project is a valid project file, and Home, Projects, Notes
// and the palette all offer them. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-starters-'));
let S; // src/shared/starter-templates.ts
let V; // src/shared/views.ts
let P; // src/shared/project-file.ts
let F; // src/shared/frontmatter.ts
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, ['shared/starter-templates', 'shared/views', 'shared/project-file', 'shared/frontmatter'].map((m, i) => `export * as m${i} from ${JSON.stringify(path.join(root, 'src', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 't.mjs')).href);
  [S, V, P, F] = [all.m0, all.m1, all.m2, all.m3];
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-10-31';
const BAD = /[\\:*?"<>|#^\[\]]/;

test('the ten starters, each opening its main file', () => {
  assert.deepEqual(S.STARTER_IDS, ['crm', 'habits', 'reading', 'content', 'trip', 'client', 'meetings', 'weekly', 'budget', 'recipes']);
  const names = Object.fromEntries(S.STARTER_TEMPLATES.map((t) => [t.id, t.name]));
  assert.equal(names.crm, 'CRM');
  assert.equal(names.habits, 'Habit tracker');
  assert.equal(names.reading, 'Reading list');
  assert.equal(names.content, 'Content calendar');
  assert.equal(names.trip, 'Trip planner');
  assert.equal(names.client, 'Client project');
  assert.equal(names.meetings, 'Meeting series');
  assert.equal(names.weekly, 'Weekly review');
  assert.equal(names.budget, 'Simple budget');
  assert.equal(names.recipes, 'Recipe book');
  for (const t of S.STARTER_TEMPLATES) {
    assert.ok(t.words && !t.words.includes('\n') && !t.words.includes('—'), `${t.id} has its one line`);
    assert.ok(t.folder && !BAD.test(t.folder), `${t.id} has a usable folder name`);
    const files = S.starterFiles(t.id, t.folder, TODAY);
    assert.ok(files.some((f) => f.path === `${t.folder}/${t.open}`), `${t.id} opens a file it makes (${t.open})`);
  }
  assert.throws(() => S.starterFiles('nope', 'X', TODAY), 'an unknown starter says so');
});

test('every starter makes valid notes, records and views that open', () => {
  for (const t of S.STARTER_TEMPLATES) {
    const folder = 'Made';
    const files = S.starterFiles(t.id, folder, TODAY);
    const paths = files.map((f) => f.path);
    assert.equal(new Set(paths).size, paths.length, `${t.id}: each file is its own`);
    for (const f of files) {
      assert.ok(f.path.startsWith(`${folder}/`), `${t.id}: ${f.path} is in the named folder`);
      assert.ok(!BAD.test(f.path), `${t.id}: ${f.path} opens anywhere`);
      assert.ok(f.text.trim(), `${t.id}: ${f.path} is not empty`);
    }
    const notes = files.filter((f) => f.path.endsWith('.md'));
    const views = files.filter((f) => f.path.endsWith('.view.json'));
    assert.ok(notes.length >= 3, `${t.id} makes notes`);
    assert.ok(views.length >= 1, `${t.id} makes saved views`);
    // Every note's properties read, with words after them (the records the views show).
    const propsByPath = new Map();
    for (const n of notes) {
      if (n.text.includes('type: project')) continue; // the project file, proven below
      assert.ok(!n.text.includes('—'), `${t.id}: ${n.path} has no em dashes`);
      const props = F.readProps(n.text);
      assert.ok(props && typeof props === 'object', `${t.id}: ${n.path} properties read`);
      propsByPath.set(n.path, props);
    }
    // Every view opens, over this starter's notes, with its properties on real records.
    for (const v of views) {
      const { def, problem } = V.readView(v.text);
      assert.equal(problem, null, `${t.id}: ${v.path} opens`);
      assert.ok(def.source.kind === 'folder' && def.source.value.startsWith(folder), `${t.id}: ${v.path} shows its own folder`);
      const inView = [...propsByPath].filter(([p]) => p === def.source.value || p.startsWith(`${def.source.value}/`));
      assert.ok(inView.length > 0, `${t.id}: ${v.path} has records under it`);
      const needs = [...def.columns, ...def.cardProps, ...(def.groupBy ? [def.groupBy] : []), ...(def.dateProp ? [def.dateProp] : [])];
      for (const prop of needs) {
        assert.ok(inView.some(([, props]) => props[prop] !== undefined && props[prop] !== null && props[prop] !== ''), `${t.id}: ${v.path} reads ${prop} from a record`);
      }
      if (def.layout === 'board') assert.ok(def.groupBy, `${t.id}: ${v.path} boards group by something`);
      if (def.layout === 'calendar') {
        assert.ok(def.dateProp, `${t.id}: ${v.path} calendars sit on a day`);
        assert.ok(inView.some(([, props]) => /^\d{4}-\d{2}-\d{2}/.test(String(props[def.dateProp] ?? ''))), `${t.id}: ${v.path} days read as days`);
      }
    }
  }
});

test('starters plant no stray open tick-boxes: steps and actions only, never demo in the task lists', () => {
  for (const t of S.STARTER_TEMPLATES) {
    for (const f of S.starterFiles(t.id, 'Made', TODAY)) {
      if (!f.path.endsWith('.md')) continue;
      let heading = '';
      for (const line of f.text.split('\n')) {
        const h = /^##\s+(.+?)\s*$/.exec(line);
        if (h) heading = h[1].trim().toLowerCase();
        const structural = /^(what['’]s next|next steps?|next|to ?do|todo|actions?)$/.test(heading);
        assert.ok(!/^- \[ \]/.test(line) || structural, `${t.id}: ${f.path} has a stray open tick-box: ${line}`);
      }
    }
  }
});

test('starters stamp every note and leave a manifest; habits start at streak 0', () => {
  for (const t of S.STARTER_TEMPLATES) {
    const files = S.starterFiles(t.id, 'Made', TODAY);
    for (const f of files) {
      if (!f.path.endsWith('.md')) continue;
      assert.ok(f.text.startsWith(`---\nstarter: ${t.id}\n`), `${t.id}: ${f.path} is stamped as an example`);
    }
    const manifest = files.find((f) => f.path === 'Made/Starter manifest.md');
    assert.ok(manifest && manifest.text.includes('Made/'), `${t.id} leaves a manifest listing its files`);
  }
  const habits = S.starterFiles('habits', 'Habits', TODAY).filter((f) => f.path.endsWith('.md') && !f.path.endsWith('Start here.md') && !f.path.endsWith('Starter manifest.md'));
  assert.ok(habits.length > 0);
  for (const h of habits) {
    assert.ok(h.text.includes('streak: 0'), `${h.path} starts at 0, never a fake run`);
    assert.ok(!h.text.split('\n').some((line) => /^- \[[ x]\]/.test(line)), `${h.path} has no pre-ticked days`);
  }
});

test('the CRM: people, companies and a deals board', () => {
  const files = S.starterFiles('crm', 'CRM', TODAY);
  assert.ok(files.some((f) => f.path === 'CRM/People/Ava Reed.md'), 'people');
  assert.ok(files.some((f) => f.path === 'CRM/Companies/Acme Bakeries.md'), 'companies');
  const deal = files.find((f) => f.path === 'CRM/Deals/Acme van signs.md');
  assert.ok(deal && deal.text.includes('[[Acme Bakeries]]') && deal.text.includes('[[Ava Reed]]'), 'deals link their company and contact');
  const board = files.find((f) => f.path === 'CRM/Views/Deals board.view.json');
  const { def, problem } = V.readView(board.text);
  assert.equal(problem, null);
  assert.equal(def.layout, 'board');
  assert.equal(def.groupBy, 'stage');
  assert.deepEqual(def.groupOrder, ['Prospect', 'Negotiation', 'Won', 'Lost']);
  assert.equal(S.starterOpenPath('crm', 'CRM'), 'CRM/Views/Deals board.view.json', 'the board opens');
});

test('the client project is a valid project file beside meeting and working notes', () => {
  const files = S.starterFiles('client', 'Client project', TODAY);
  const project = files.find((f) => f.path === 'Client project/Website refresh.md');
  const parsed = P.parseProject(project.text, 'Website refresh.md');
  assert.equal(parsed.name, 'Website refresh');
  assert.equal(parsed.status, 'active');
  assert.equal(parsed.next.length, 3);
  assert.equal(parsed.dates.length, 1);
  assert.equal(parsed.risks.length, 1);
  assert.ok(files.some((f) => f.path === 'Client project/Meetings/Kickoff.md'), 'its kickoff meeting');
  assert.ok(files.some((f) => f.path === 'Client project/Notes/Goals.md'), 'its working notes');
  assert.equal(S.starterOpenPath('client', 'Client project'), 'Client project/Website refresh.md', 'the project page opens');
});

test('budgets add up, meetings sit on days, the folder name is the person’s', () => {
  const spending = S.starterFiles('budget', 'Budget', TODAY).find((f) => f.path === 'Budget/Views/Spending.view.json');
  assert.deepEqual(V.readView(spending.text).def.summaries, { amount: 'sum' }, 'spending adds its amounts');
  const shops = S.starterFiles('budget', 'Budget', TODAY).filter((f) => f.path.includes('Weekly shop'));
  assert.equal(shops.length, 2);
  assert.notEqual(shops[0].path, shops[1].path, 'same name twice still makes two files');
  const cal = S.starterFiles('meetings', 'Team meeting', TODAY).find((f) => f.path.endsWith('Meetings calendar.view.json'));
  assert.equal(V.readView(cal.text).def.dateProp, 'date');
  assert.equal(S.cleanStarterFolder('  My Books  ', 'Reading'), 'My Books', 'a name tidied');
  assert.equal(S.cleanStarterFolder('', 'Reading'), 'Reading', 'blank keeps the offered name');
  const split = S.splitStarterPath('CRM/Views/Deals board.view.json');
  assert.deepEqual(split, { folder: 'CRM/Views', base: 'Deals board', ext: '.view.json' }, 'files split for creating');
});

test('Home, Projects, Notes and the palette all offer starters', () => {
  const run = read('src/renderer/src/state/starterTemplates.ts');
  assert.ok(run.includes('window.nv.files.create') && run.includes('A.openPath'), 'files are created, then the main one opens');
  const app = read('src/renderer/src/App.tsx');
  // 5 Nov 2026 feel-motion: the windows render through ModalLayer (one shared exit); the held modal is `m`.
  assert.ok(app.includes("m.kind === 'starter-picker'") && app.includes('<StarterPicker'), 'the picker opens as a window');
  const picker = read('src/renderer/src/components/StarterPicker.tsx');
  assert.ok(picker.includes('STARTER_TEMPLATES') && picker.includes('startStarter('), 'the picker lists the ten and starts one');
  const home = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(home.includes('>Start from a template</button>'), 'Home has its entry (10.0: a page action on the one page)');
  const projects = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(projects.includes("label: 'Start from a template…'"), 'Projects has its entry');
  const notes = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(notes.includes("label: 'Start from a template…'"), 'Notes has its entry');
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes("{ id: 'starter-template', name: 'Start from a template…'"), 'the palette has its entry');
});
