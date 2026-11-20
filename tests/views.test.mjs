// node --test tests/views.test.mjs — views over notes (src/shared/views.ts; release 5.0.0): a view file read however it
// was left, the notes a folder or tag gives, filters (is, is not, contains, is empty), sorting with empty values last,
// board columns in the order work moves (and a moved card's new value), the month grid Monday first, days read and moved
// the way they were written, and a property written into a note without disturbing anything else. Made-up bakery notes;
// thousands of notes stay quick.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-views-'));
let V, F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as V from ${JSON.stringify(path.join(root, 'src/shared/views.ts'))};\nexport * as F from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'views.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ V, F } = await import(pathToFileURL(path.join(work, 'views.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const T = Date.parse('2026-10-19T09:00:00');
const note = (p, props = {}, tags = [], ago = 1) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), mtime: T - ago * 86400000, tags, props });

function bakery() {
  return [
    note('Bakery/Sourdough starter.md', { status: 'Done', due: '2026-10-02', owner: 'Mia', cost: 12 }, ['bakery']),
    note('Bakery/Loyalty cards.md', { status: 'In progress', due: '2026-10-24', owner: 'Tama', cost: 140 }, ['bakery', 'marketing']),
    note('Bakery/Order form.md', { Status: 'in progress', due: '24 Oct 2026', owner: 'Mia', cost: 9.5 }, ['bakery']),
    note('Bakery/Shop sign.md', { status: 'Planned', owner: ['Tama', 'Mia'] }, ['bakery/shop']),
    note('Bakery/Ideas/Pie week.md', {}, []),
    note('Meetings/Supplier call.md', { status: 'Done', date: '2026-10-15T09:30' }, ['meeting']),
    note('Templates/Recipe.md', { status: 'Planned' }, ['bakery']),
  ];
}
const titles = (rows) => rows.map((r) => r.title);

test('a view file is read however it was left, and written back with only what was chosen', () => {
  const { def, problem } = V.readView(JSON.stringify({ source: { kind: 'folder', value: '/Bakery/' }, layout: 'board', groupBy: 'status', cardProps: ['owner', 'due', 'cost'], filters: [{ prop: 'owner', op: 'is', value: 'Mia' }, { prop: 'x', op: 'nonsense' }], hiddenGroups: ['Done'] }));
  assert.equal(problem, null);
  assert.deepEqual(def.source, { kind: 'folder', value: 'Bakery' });
  assert.equal(def.layout, 'board');
  assert.deepEqual(def.cardProps, ['owner', 'due'], 'at most two on a card');
  assert.equal(def.filters.length, 1, 'a filter that makes no sense is left out');
  assert.deepEqual(def.hiddenGroups, ['done']);
  const back = V.readView(V.writeView(def)).def;
  assert.deepEqual(back, def);
  assert.ok(!('columns' in JSON.parse(V.writeView(V.defaultView()))), 'nothing chosen, nothing written');

  const broken = V.readView('{ not json');
  assert.equal(broken.def.layout, 'table');
  assert.match(broken.problem, /couldn’t be read/);
  assert.equal(V.readView('').def.source.kind, 'all');
  assert.equal(V.readView(JSON.stringify({ layout: 'gallery', source: { kind: 'tag' } })).def.layout, 'gallery', 'gallery carried in (10.0 v10records: one engine)');
  assert.equal(V.readView(JSON.stringify({ layout: 'mural', source: { kind: 'tag' } })).def.layout, 'table', 'what is still unknown falls back to a table');
  assert.deepEqual(V.readView(JSON.stringify({ source: { kind: 'tag' } })).def.source, { kind: 'all' }, 'a tag view with no tag shows every note');
  assert.equal(V.viewName('Views/Reading list.view.json'), 'Reading list');
  assert.ok(V.isViewPath('Views/Board.VIEW.JSON'));
  assert.ok(!V.isViewPath('notes.json'));
});

test('a folder, a tag (and the tags under it) or every note; templates left out', () => {
  const notes = bakery();
  const folder = V.runView(V.defaultView({ kind: 'folder', value: 'Bakery' }), notes);
  assert.deepEqual(titles(folder), ['Loyalty cards', 'Order form', 'Pie week', 'Shop sign', 'Sourdough starter']);
  const tag = V.runView(V.defaultView({ kind: 'tag', value: 'Bakery' }), notes, { exclude: ['Templates'] });
  assert.deepEqual(titles(tag), ['Loyalty cards', 'Order form', 'Shop sign', 'Sourdough starter'], 'bakery/shop counts; the template does not');
  assert.equal(V.runView(V.defaultView(), notes, { exclude: ['Templates'] }).length, 6);
  assert.equal(V.sourceWords({ kind: 'tag', value: 'client' }), 'Notes tagged #client');
  assert.equal(V.sourceWords({ kind: 'folder', value: 'Meetings' }), 'Notes in Meetings');
});

test('filters: is (any case, any item of a list), is not, contains, is empty, is not empty', () => {
  const notes = bakery().slice(0, 6);
  const run = (...filters) => titles(V.runView({ ...V.defaultView(), filters }, notes));
  assert.deepEqual(run({ prop: 'status', op: 'is', value: 'in progress' }), ['Loyalty cards', 'Order form'], 'Status and status are one property');
  assert.deepEqual(run({ prop: 'owner', op: 'is', value: 'mia' }), ['Order form', 'Shop sign', 'Sourdough starter']);
  assert.deepEqual(run({ prop: 'owner', op: 'is-not', value: 'Mia' }), ['Loyalty cards', 'Pie week', 'Supplier call']);
  assert.deepEqual(run({ prop: 'file.title', op: 'contains', value: 'card' }), ['Loyalty cards']);
  assert.deepEqual(run({ prop: 'due', op: 'empty' }), ['Pie week', 'Shop sign', 'Supplier call']);
  assert.deepEqual(run({ prop: 'status', op: 'not-empty' }, { prop: 'owner', op: 'is', value: 'Tama' }), ['Loyalty cards', 'Shop sign'], 'every filter must match');
  assert.deepEqual(run({ prop: 'status', op: 'is', value: '' }).length, 6, 'a filter not filled in yet hides nothing');
  const ticks = [note('a.md', { paid: true }), note('b.md', { paid: false }), note('c.md')];
  assert.deepEqual(titles(V.runView({ ...V.defaultView(), filters: [{ prop: 'paid', op: 'is', value: 'Yes' }] }, ticks)), ['a']);
});

test('sorting: numbers as numbers, either way, empty values always last', () => {
  const notes = bakery().slice(0, 5);
  const by = (prop, dir) => titles(V.runView({ ...V.defaultView(), sort: { prop, dir } }, notes));
  assert.deepEqual(by('cost', 'asc'), ['Order form', 'Sourdough starter', 'Loyalty cards', 'Pie week', 'Shop sign']);
  assert.deepEqual(by('cost', 'desc'), ['Loyalty cards', 'Sourdough starter', 'Order form', 'Pie week', 'Shop sign']);
  assert.deepEqual(by('file.title', 'desc'), ['Sourdough starter', 'Shop sign', 'Pie week', 'Order form', 'Loyalty cards']);
  assert.equal(V.compareValues('Step 2', 'Step 10') < 0, true);
  assert.equal(V.compareValues(true, false) < 0, true);
  assert.equal(V.compareValues('', 'a') > 0, true);
});

test('the properties notes have, and good first choices for a new view', () => {
  const rows = V.runView(V.defaultView(), bakery().slice(0, 6));
  const props = V.knownProps(rows);
  const status = props.find((p) => p.key.toLowerCase() === 'status');
  assert.equal(status.count, 5, 'Status and status counted as one');
  assert.equal(props.find((p) => p.key === 'owner').list, true);
  assert.equal(props.find((p) => p.key === 'cost').kind, 'number');
  const s = V.suggestDisplay(rows);
  assert.equal(s.groupBy.toLowerCase(), 'status');
  assert.equal(s.dateProp, 'due');
  assert.ok(s.columns.length > 0 && s.columns.length <= 5);
  assert.equal(V.propWords('due_date'), 'Due date');
  assert.equal(V.propWords('file.modified'), 'Changed');
});

test('board columns: one per value in any case, in the order work moves, No value last; hidden and folded kept', () => {
  const rows = V.runView(V.defaultView({ kind: 'folder', value: 'Bakery' }), bakery());
  const def = { ...V.defaultView(), groupBy: 'status', hiddenGroups: ['done'], collapsedGroups: ['planned'] };
  const groups = V.groupBoard(rows, def);
  assert.deepEqual(groups.map((g) => g.label), ['Planned', 'In progress', 'Done', 'No value']);
  const progress = groups.find((g) => g.key === 'in progress');
  assert.deepEqual(titles(progress.rows), ['Loyalty cards', 'Order form'], '"In progress" and "in progress" share a column');
  assert.equal(progress.value, 'In progress', 'a dropped card gets the spelling most notes use');
  assert.equal(groups.find((g) => g.key === 'done').hidden, true);
  assert.equal(groups.find((g) => g.key === 'planned').collapsed, true);
  assert.equal(groups.at(-1).value, null);

  const own = V.groupBoard(rows, { ...def, groupOrder: ['Done', 'Review'] }).map((g) => g.label);
  assert.deepEqual(own, ['Done', 'Review', 'Planned', 'In progress', 'No value'], 'the person’s order first; an empty column they named stays');
  const byOwner = V.groupBoard(rows, { ...def, groupBy: 'owner' });
  assert.deepEqual(titles(byOwner.find((g) => g.key === 'tama').rows), ['Loyalty cards', 'Shop sign'], 'a list goes by its first item');
});

test('a card moved to another column: the new value; in a list only the item that placed it changes', () => {
  assert.equal(V.movedValue('Planned', 'planned', 'Done'), 'Done');
  assert.equal(V.movedValue('Planned', 'planned', null), null);
  assert.deepEqual(V.movedValue(['Tama', 'Mia'], 'tama', 'Aroha'), ['Aroha', 'Mia']);
  assert.deepEqual(V.movedValue(['Tama', 'Mia'], 'tama', 'Mia'), ['Mia'], 'never the same name twice');
  assert.deepEqual(V.movedValue(['Tama'], 'tama', null), null);
  assert.deepEqual(V.movedValue([], '', 'Mia'), ['Mia']);
});

test('the month grid starts on Monday, whole weeks, today marked', () => {
  const weeks = V.monthGrid(2026, 9, '2026-10-19');
  assert.equal(weeks[0][0].iso, '2026-09-28', 'October 2026 starts on a Thursday: the Monday before');
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(weeks.length, 5);
  assert.equal(weeks.flat().find((d) => d.today).iso, '2026-10-19');
  assert.equal(weeks.flat().filter((d) => d.inMonth).length, 31);
  assert.equal(weeks[0][5].weekend, true);
  assert.equal(V.monthGrid(2026, 1, '').length, 4 + 1, 'February 2026 runs Sunday 1st to Saturday 28th: five rows');
  assert.equal(V.monthWords(2026, 9), 'October 2026');
  assert.equal(V.shiftIso('2026-10-31', 1), '2026-11-01');
});

test('days read as written and moved the same way, the time kept', () => {
  const ref = new Date(2026, 9, 19);
  assert.deepEqual(V.readDate('2026-10-24', ref), { iso: '2026-10-24', time: '', style: 'iso' });
  assert.deepEqual(V.readDate('2026-10-15T09:30', ref), { iso: '2026-10-15', time: 'T09:30', style: 'iso' });
  assert.equal(V.readDate('24 Oct 2026', ref).iso, '2026-10-24');
  assert.equal(V.readDate('Friday', ref), null, 'a bare weekday moves with the week: not a day to place');
  assert.equal(V.readDate('2026-02-31', ref), null);
  assert.equal(V.readDate(42, ref), null);
  assert.equal(V.movedDate('2026-10-15T09:30', '2026-10-17', ref), '2026-10-17T09:30');
  assert.equal(V.movedDate('24 Oct', '2026-10-27', ref), '27 Oct');
  assert.equal(V.movedDate(undefined, '2026-10-27', ref), '2026-10-27');

  const rows = V.runView(V.defaultView(), bakery().slice(0, 6));
  const { byDay, undated } = V.placeOnDays(rows, 'due', ref);
  assert.deepEqual(titles(byDay.get('2026-10-24')), ['Loyalty cards', 'Order form']);
  assert.deepEqual(titles(undated), ['Pie week', 'Shop sign', 'Supplier call']);
});

test('a typed cell becomes the right kind of value', () => {
  assert.equal(V.cellValue('1,250', 'number'), 1250);
  assert.equal(V.cellValue('yes', 'checkbox'), true);
  assert.equal(V.cellValue('no', 'checkbox'), false);
  assert.deepEqual(V.cellValue('#bakery, shop ', 'tags'), ['bakery', 'shop']);
  assert.deepEqual(V.cellValue('Mia, Tama', 'list'), ['Mia', 'Tama']);
  assert.equal(V.cellValue('  ', 'text'), null);
  assert.equal(V.cellValue('2026-10-24', 'date'), '2026-10-24');
});

test('a property written into a note: the rest as the person wrote it', () => {
  const text = '---\n# kept\nStatus: Planned   # my comment\nowner: [Tama, Mia]\ndue: 2026-10-24\n---\n# Shop sign\n\nBody stays.\n';
  const moved = V.setNoteProp(text, 'status', 'Done');
  assert.match(moved, /^---\n# kept\nStatus: Done/, 'its own spelling and the comment above it kept');
  assert.match(moved, /# Shop sign\n\nBody stays\.\n$/);
  assert.deepEqual(F.readProps(moved), { Status: 'Done', owner: ['Tama', 'Mia'], due: '2026-10-24' });
  assert.match(V.setNoteProp(text, 'owner', ['Aroha', 'Mia']), /owner: \[Aroha, Mia\]/, 'a list written [a, b] stays that way');
  const cleared = V.setNoteProp(text, 'due', null);
  assert.ok(!/due:/.test(cleared));
  assert.equal(V.setNoteProp('---\nstatus: Done\n---\nWords\n', 'status', null), 'Words\n', 'the last property gone, the block goes too');
  assert.equal(V.setNoteProp('Just words\n', 'status', 'Planned'), '---\nstatus: Planned\n---\n\nJust words\n', 'a blank line between the new properties and the words');
  const crlf = V.setNoteProp('---\r\nstatus: Planned\r\n---\r\nWords\r\n', 'due', '2026-11-01');
  assert.equal(crlf, '---\r\nstatus: Planned\r\ndue: 2026-11-01\r\n---\r\nWords\r\n', 'Windows line ends kept');
  assert.throws(() => V.setNoteProp('---\nstatus: [broken\n---\n', 'status', 'Done'), /can’t be read/);
  assert.equal(V.newNoteText({ ...V.defaultView({ kind: 'tag', value: 'client' }) }, { status: 'Planned' }), '---\ntags:\n  - client\nstatus: Planned\n---\n\n');
});

test('thousands of notes stay quick', () => {
  const notes = [];
  const statuses = ['Planned', 'In progress', 'Done', 'Blocked'];
  for (let i = 0; i < 8000; i++) notes.push(note(`Work/Folder ${i % 40}/Note ${i}.md`, { status: statuses[i % 4], due: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, cost: i % 97 }, i % 3 ? ['work'] : []));
  const started = performance.now();
  const def = { ...V.defaultView({ kind: 'folder', value: 'Work' }), filters: [{ prop: 'status', op: 'is-not', value: 'Done' }], sort: { prop: 'cost', dir: 'desc' }, groupBy: 'status' };
  const rows = V.runView(def, notes);
  V.groupBoard(rows, def);
  V.placeOnDays(rows, 'due');
  V.knownProps(rows);
  const ms = performance.now() - started;
  assert.equal(rows.length, 6000);
  assert.ok(ms < 400, `took ${ms.toFixed(0)} ms`);
});

test('a renamed or moved folder: views over it (or a folder inside it) follow; others are left alone', () => {
  const view = (value) => V.defaultView({ kind: 'folder', value });
  assert.deepEqual(V.followFolder(view('Bakery'), 'Bakery', 'Clients/Bakery').source, { kind: 'folder', value: 'Clients/Bakery' });
  assert.deepEqual(V.followFolder(view('Bakery/Ideas'), 'Bakery', 'Shop').source, { kind: 'folder', value: 'Shop/Ideas' });
  assert.equal(V.followFolder(view('Bakery Two'), 'Bakery', 'Shop'), null, 'a folder with a longer name is not inside it');
  assert.equal(V.followFolder(V.defaultView({ kind: 'tag', value: 'bakery' }), 'Bakery', 'Shop'), null);
});

test('cards and list: read and written like the rest, a cover suggested from a picture property, groups when asked (21 Oct 2026)', () => {
  const { def } = V.readView(JSON.stringify({ layout: 'cards', columns: ['owner'], cover: 'cover', sectionBy: { prop: 'status', dir: 'desc' } }));
  assert.equal(def.layout, 'cards');
  assert.equal(def.cover, 'cover');
  assert.deepEqual(def.sectionBy, { prop: 'status', dir: 'desc' });
  assert.deepEqual(V.readView(V.writeView(def)).def, def);
  assert.equal(V.readView(JSON.stringify({ layout: 'list' })).def.layout, 'list');
  assert.ok(V.usesColumns('cards') && V.usesColumns('list') && V.usesColumns('table') && !V.usesColumns('board'));
  assert.equal(V.LAYOUT_PHRASE.cards, 'cards');

  const pics = [note('Trips/Hobart.md', { cover: 'Pictures/Hobart.jpg', nights: 3 }), note('Trips/Broome.md', { cover: 'sea', nights: 5 })];
  const s = V.suggestDisplay(V.runView(V.defaultView(), pics));
  assert.equal(s.cover, 'cover');
  assert.ok(!s.columns.includes('cover'), 'the cover is the picture, not a column too');

  const rows = V.runView(V.defaultView({ kind: 'folder', value: 'Bakery' }), bakery());
  assert.equal(V.sectionRows(rows, V.defaultView()), null, 'not split unless asked');
  const groups = V.sectionRows(rows, { ...V.defaultView(), sectionBy: { prop: 'status', dir: 'asc' } });
  assert.deepEqual(groups.map((g) => g.label), ['Planned', 'In progress', 'Done', 'No value']);
  const back = V.sectionRows(rows, { ...V.defaultView(), sectionBy: { prop: 'status', dir: 'desc' } });
  assert.deepEqual(back.map((g) => g.label), ['Done', 'In progress', 'Planned', 'No value'], 'turned round, No value still last');
});

test('summaries under a column: counts for any column, sums for numbers, first and last for days (21 Oct 2026)', () => {
  const rows = V.runView(V.defaultView({ kind: 'folder', value: 'Bakery' }), bakery());
  const sum = (key, how) => V.summarize(rows, key, how);
  assert.deepEqual(sum('cost', 'count'), { label: 'Count', value: 5, day: false });
  assert.equal(sum('cost', 'filled').value, 3);
  assert.equal(sum('cost', 'empty').value, 2);
  assert.equal(sum('cost', 'sum').value, 161.5);
  assert.equal(sum('cost', 'average').value, 53.83, 'rounded to cents');
  assert.equal(sum('cost', 'min').value, 9.5);
  assert.equal(sum('cost', 'max').value, 140);
  assert.equal(sum('owner', 'unique').value, 2, 'a list’s items each count; Mia and Tama');
  assert.equal(sum('status', 'unique').value, 3, '“In progress” and “in progress” are one value');
  assert.deepEqual(sum('due', 'earliest'), { label: 'Earliest', value: '2026-10-02', day: true });
  assert.equal(sum('due', 'latest').value, '2026-10-24', 'a day written as words counts too');
  assert.equal(sum('status', 'sum').value, null, 'words have nothing to add up');
  assert.match(sum('file.modified', 'latest').value, /^2026-10-18T\d{2}:\d{2}$/);
  assert.equal(V.summaryText({ label: 'Sum', value: 1250.5, day: false }), '1,250.5');
  assert.equal(V.summaryText({ label: 'Sum', value: null, day: false }), '');

  assert.deepEqual(V.summaryChoices('text'), ['count', 'filled', 'empty', 'unique']);
  assert.ok(V.summaryChoices('number').includes('average'));
  assert.ok(V.summaryChoices('date').includes('earliest') && !V.summaryChoices('date').includes('sum'));
  assert.equal(V.columnKind(rows, 'cost'), 'number');
  assert.equal(V.columnKind(rows, 'due'), 'date');
  assert.equal(V.columnKind(rows, 'file.modified'), 'datetime');

  const withFormula = V.runView({ ...V.defaultView({ kind: 'folder', value: 'Bakery' }), formulas: { Double: 'cost * 2', Due: 'dateAdd(due, 1)' } }, bakery());
  assert.equal(V.summarize(withFormula, 'formula.Double', 'sum').value, 323);
  assert.equal(V.columnKind(withFormula, 'formula.Double'), 'number');
  assert.equal(V.columnKind(withFormula, 'formula.Due'), 'date', 'a formula’s kind is what it works out to');

  const { def } = V.readView(JSON.stringify({ summaries: { cost: 'average', due: 'nonsense' } }));
  assert.deepEqual(def.summaries, { cost: 'average' }, 'a summary Ironleaf doesn’t know is left out');
});

test('a property matching a view’s own key keeps its own column beside the built-in (O3)', () => {
  assert.equal(V.isReservedViewKey('file.tags'), true);
  assert.equal(V.isReservedViewKey('formula.Total'), true);
  assert.equal(V.isReservedViewKey('rollup.Count'), true);
  assert.equal(V.isReservedViewKey('Status'), false);
  assert.equal(V.isReservedViewKey('File.Title'), false, 'case-sensitive: only the exact key is reserved');
  assert.equal(V.safeViewPropKey('file.tags'), 'file.tags (property)');
  assert.equal(V.safeViewPropKey('Status'), 'Status');
  const row = { path: 'DB/Row.md', title: 'Row', folder: 'DB', mtime: 0, tags: ['real'], props: { 'file.tags (property)': 'imported words' } };
  assert.deepEqual(V.valueOf(row, 'file.tags'), ['real'], 'the built-in still reads');
  assert.equal(V.valueOf(row, 'file.tags (property)'), 'imported words', 'the property keeps its own column');
});
