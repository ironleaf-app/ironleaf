// node --test tests/notes-yours.test.mjs — your notes are yours; records stop looking like notes (5
// Nov 2026, the plan: the vault, 264 notes of which 122 are machine-made Systems records).
// Notes shows what the person wrote, with one quiet Show everything; Related keeps a record only when
// really linked; Today's changed lists leave unopened records out; Search ranks the person's notes
// above records for the same words; a new machine or service has no empty headings; a row's preview is
// never table headers; On this page and tags appear once. Made-up vault, same shape.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-notes-yours-'));
const read = (f) => readFileSync(path.join(root, f), 'utf8');
let S;
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(
    entry,
    [
      `export * as notesList from ${JSON.stringify(path.join(root, 'src/shared/notes-list.ts'))};`,
      `export * as moduleRecords from ${JSON.stringify(path.join(root, 'src/shared/module-records.ts'))};`,
      `export * as related from ${JSON.stringify(path.join(root, 'src/shared/related.ts'))};`,
      `export * as ranking from ${JSON.stringify(path.join(root, 'src/shared/ranking.ts'))};`,
      `export * as hub from ${JSON.stringify(path.join(root, 'src/shared/hub.ts'))};`,
      `export * as systems from ${JSON.stringify(path.join(root, 'src/shared/systems.ts'))};`,
      `export * as lifeRecords from ${JSON.stringify(path.join(root, 'src/shared/life-records.ts'))};`,
      `export * as personalRecords from ${JSON.stringify(path.join(root, 'src/shared/personal-records.ts'))};`,
      '',
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  const mEntry = path.join(work, 'mentry.ts');
  writeFileSync(mEntry, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`);
  await build({ input: mEntry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── A person's records are known by their type ────────────────────────────────────────────────────

test('a pack record is known by its type: service, runbook, machine, bill and the rest', () => {
  for (const t of ['service', 'runbook', 'machine', 'bill', 'bank-account', 'goal', 'habit', 'album', 'release', 'list']) {
    assert.equal(S.moduleRecords.isRecordTypeId(t), true, t);
    assert.equal(S.moduleRecords.isRecordProps({ type: t }), true, `type: ${t}`);
  }
  assert.equal(S.moduleRecords.isRecordTypeId('servers'), true, 'a type alias counts too');
  for (const t of ['note', 'doc', 'daily', 'project', 'person', 'meeting', 'resource', 'idea', 'decision', '', undefined]) {
    assert.equal(S.moduleRecords.isRecordTypeId(t), false, String(t));
  }
  assert.equal(S.moduleRecords.isRecordProps({ type: 'note' }), false);
  assert.equal(S.moduleRecords.isRecordProps({}), false);
});

// ── 1. Notes shows what the person wrote ──────────────────────────────────────────────────────────

const row = (p, extra = {}) => ({ ...S.notesList.noteRow({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), mtime: 10 }), ...extra });

test('All notes leaves pack records out, with their folders counting the same way', () => {
  const rows = [
    row('Notes/Weekend.md'),
    row('Home/Systems and Home Lab/Services/kaitiaki-arcade.md', { record: true }),
    row('Home/Systems and Home Lab/Services/kaitiaki-connector.md', { record: true }),
    row('Home/Tech.md'),
    row('Me/Finance/Bills/Internet.md', { record: true }),
  ];
  assert.deepEqual(
    S.notesList.filterNoteRows(rows).map((r) => r.path),
    ['Notes/Weekend.md', 'Home/Tech.md'],
    'records out by default',
  );
  assert.equal(S.notesList.filterNoteRows(rows, { includeRecords: true }).length, 5, 'Show everything brings them back');
  assert.deepEqual(
    S.notesList.filterNoteRows(rows, { folder: 'Home', query: 'tech' }).map((r) => r.path),
    ['Home/Tech.md'],
    'the folder and word filters work on the same rows',
  );
  const folders = S.notesList.folderChoices(S.notesList.filterNoteRows(rows));
  assert.deepEqual(
    folders.map((f) => [f.prefix, f.count]),
    [
      ['Home', 1],
      ['Notes', 1],
    ],
    'folder rows count what All notes shows, or the numbers disagree',
  );
  assert.ok(!folders.some((f) => f.prefix === 'Me'), 'a folder of only records is no row while hidden');
});

test('Notes keeps one quiet Show everything with its count, remembered', () => {
  const page = read('src/renderer/src/views/NotesPage.tsx');
  assert.match(page, /Show everything/, 'the one quiet control');
  assert.match(page, /aria-pressed/, 'a toggle, not a second page');
  assert.match(page, /nv-notes-show-all/, 'remembered on this PC');
  assert.match(page, /\.module\b/, 'a record is its type saying so, never a word list');
  assert.match(page, /includeRecords/, 'the shared filter does the hiding');
  assert.match(page, /recordCount|recordsHidden|hiddenRecords/, 'its count beside it');
});

// ── 5. A row's preview is never table headers ─────────────────────────────────────────────────────

test('a preview is never table headers; a note with only a table or nothing to say shows none', () => {
  assert.equal(S.notesList.plainSnippet('| Date | Status | Note |\n| --- | --- | --- |\n'), '', 'a bare table says nothing');
  assert.equal(
    S.notesList.plainSnippet('---\ntype: service\n---\n## Credentials\n\n\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n\n## Notes\n\n'),
    '',
    'a new service record: headings and an empty table, no preview',
  );
  assert.equal(S.notesList.plainSnippet('## Only headings\n\n## Nothing else\n'), '', 'headings are structure, not speech');
  assert.equal(S.notesList.plainSnippet(''), '');
  assert.equal(
    S.notesList.plainSnippet('| Date | Status | Note |\n| --- | --- | --- |\n\nThe fan rattles since Tuesday.\n'),
    'The fan rattles since Tuesday.',
    'words past the table still show',
  );
  assert.equal(S.notesList.plainSnippet('1. Check Juniper is up and note its disk space.\n'), 'Check Juniper is up and note its disk space.', 'a runbook step still previews');
  assert.equal(S.notesList.plainSnippet('Next: **Telstra invoice due Mon** and [[Harbour fit-out]]\n'), 'Next: Telstra invoice due Mon and Harbour fit-out', 'plain prose unchanged');
});

// ── 2. Related keeps a record only when really linked ─────────────────────────────────────────────

const counts = (text) => {
  const m = new Map();
  for (const w of S.ranking.rankWords(text)) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
};

test('related: a record is related to a note only when it is really linked', () => {
  const docs = [
    { path: 'Notes.md', title: 'Notes', tags: [], links: [], text: 'kaitiaki arcade credentials health log' },
    { path: 'kaitiaki-arcade.md', title: 'kaitiaki-arcade', tags: [], links: [], text: 'kaitiaki arcade credentials health log notes' },
    { path: 'kaitiaki-linked.md', title: 'kaitiaki-linked', tags: [], links: ['Notes.md'], text: 'kaitiaki arcade credentials health log notes' },
    { path: 'Other.md', title: 'Other', tags: [], links: [], text: 'kaitiaki arcade credentials health log notes' },
  ];
  const byPath = new Map(docs.map((d) => [d.path, counts(`${d.title} ${d.text}`)]));
  const df = (w) => docs.filter((d) => byPath.get(d.path).has(w)).length;
  const base = { words: (p) => byPath.get(p), rarity: (w) => Math.log(1 + (docs.length - df(w) + 0.5) / (df(w) + 0.5)) };
  const isRecord = (p) => p.startsWith('kaitiaki-');
  const plain = S.related.relatedTo('Notes.md', docs, base).map((r) => r.path);
  assert.ok(plain.includes('kaitiaki-arcade.md'), 'lookalikes list without the rule');
  const list = S.related.relatedTo('Notes.md', docs, { ...base, isRecord }).map((r) => r.path);
  assert.ok(!list.includes('kaitiaki-arcade.md'), 'shared words alone keep no record');
  assert.ok(list.includes('kaitiaki-linked.md'), 'a link keeps it');
  assert.ok(list.includes('Other.md'), 'notes still meet on words');
  const fromRecord = S.related.relatedTo('kaitiaki-arcade.md', docs, { ...base, isRecord }).map((r) => r.path);
  assert.ok(!fromRecord.includes('Notes.md'), 'either side a record, the link is still required');
  assert.ok(!fromRecord.includes('kaitiaki-linked.md'), 'two records meet only through a link');
});

test('related in the index: the twelve lookalikes drop out, the linked runbook stays', () => {
  const index = new M.VaultIndex();
  const now = Date.now();
  const service = (name) => `---\ntype: service\nkind: Other\nport: 8000\nstatus: Up\n---\n## Credentials\n\n\n## Health log\n\n| Date | Status | Note |\n| --- | --- | --- |\n\n## Notes\n\nRuns the ${name} kiosk.\n`;
  index.set('Home/Systems and Home Lab/Services/kaitiaki-arcade.md', service('kaitiaki-arcade'), now, 10);
  for (const n of ['connector', 'contact', 'org-server', 'portal', 'signage', 'till']) {
    index.set(`Home/Systems and Home Lab/Services/kaitiaki-${n}.md`, service(`kaitiaki-${n}`), now, 10);
  }
  index.set('Home/Systems and Home Lab/Runbooks/Restart kaitiaki-arcade.md', '---\ntype: runbook\nfor: ["[[kaitiaki-arcade]]"]\nevery: On demand\n---\n## Steps\n\n1. Restart the kiosk.\n', now, 10);
  const paths = index.relatedNotes('Home/Systems and Home Lab/Services/kaitiaki-arcade.md').map((r) => r.path);
  assert.ok(!paths.some((p) => p.includes('kaitiaki-connector')), 'no more Similar meaning and Shares words rows');
  assert.ok(!paths.some((p) => p.includes('kaitiaki-contact')), 'no more Similar meaning and Shares words rows');
  assert.ok(paths.includes('Home/Systems and Home Lab/Runbooks/Restart kaitiaki-arcade.md'), 'the runbook that names it stays');
});

// ── 2b. Today's changed lists leave unopened records out ──────────────────────────────────────────

test("Today's changed lists leave records out unless the person opened one", () => {
  const day = new Date(2026, 9, 20, 12, 0);
  const at = (h) => new Date(2026, 9, 20, h, 0).getTime();
  const old = new Date(2026, 8, 1, 12, 0).getTime();
  const notes = [
    { path: 'Daily/2026-10-20.md', title: '2026-10-20', mtime: at(8), born: at(8), props: {} },
    { path: 'Notes/Weekend.md', title: 'Weekend', mtime: at(9), born: old, props: {} },
    { path: 'Home/Systems and Home Lab/Services/kaitiaki-arcade.md', title: 'kaitiaki-arcade', mtime: at(10), born: old, props: { type: 'service' } },
    { path: 'Home/Systems and Home Lab/Runbooks/Restart it.md', title: 'Restart it', mtime: at(11), born: old, props: { type: 'runbook' } },
    { path: 'Home/Systems and Home Lab/Services/brand-new.md', title: 'brand-new', mtime: at(11), born: at(11), props: { type: 'service' } },
  ];
  const base = { iso: '2026-10-20', notes, dates: () => [], daily: { path: 'Daily/2026-10-20.md', exists: true }, linkedToDaily: [], skip: () => false, now: day };
  const quiet = S.hub.buildDay(base);
  assert.deepEqual(quiet.changed.map((n) => n.title), ['Weekend'], 'machine-touched records stay out of Changed');
  assert.deepEqual(quiet.made.map((n) => n.title), [], 'machine-made records stay out of Made');
  assert.equal(quiet.counts.changed, 1);
  const opened = S.hub.buildDay({ ...base, opened: ['Home/Systems and Home Lab/Runbooks/Restart it.md'] });
  assert.deepEqual(opened.changed.map((n) => n.title), ['Restart it', 'Weekend'], 'a record the person opened reads as theirs');
  assert.equal(opened.counts.changed, 2);
});

// ── 3. Search ranks the person's notes above records ──────────────────────────────────────────────

test('search: the person’s notes rank above records for the same words; records still found', () => {
  const index = new M.VaultIndex();
  const now = Date.now();
  index.set('Notes/Oven seal.md', '# Oven seal\n\nThe oven seal is worn and the oven door hangs a little. Book the repair before winter.\n', now, 10);
  index.set('Home/Systems and Home Lab/Services/Oven timer.md', '---\ntype: service\nkind: Other\nstatus: Up\n---\n# Oven timer\n\nThe oven light is out. The oven fan rattles. Check the oven weekly.\n', now, 10);
  index.set('Notes/Unrelated.md', '# Unrelated\n\nNothing about cooking here.\n', now, 10);
  const hits = index.search('oven');
  const paths = hits.map((h) => h.path);
  assert.ok(paths.includes('Home/Systems and Home Lab/Services/Oven timer.md'), 'the record is still found');
  assert.ok(paths.indexOf('Notes/Oven seal.md') < paths.indexOf('Home/Systems and Home Lab/Services/Oven timer.md'), 'the person’s note first for the same words');
  const exact = index.search('Oven timer');
  assert.equal(exact[0]?.path, 'Home/Systems and Home Lab/Services/Oven timer.md', 'typing a record’s exact name still lands on it');
});

// ── 4. A new record has no empty headings ─────────────────────────────────────────────────────────

test('a new machine or service writes only what it holds; headings appear with their content', () => {
  for (const t of S.lifeRecords.SYSTEMS.types) {
    if (t.id !== 'machine' && t.id !== 'service') continue;
    assert.ok(!/^## /m.test(t.template), `${t.id}: no empty headings in its template`);
  }
  const machine = S.systems.newMachineText({ kind: 'NAS', role: 'Backups', os: 'Debian', address: '192.168.1.50', location: 'Study', status: '' });
  assert.ok(!/^## /m.test(machine), 'a new machine: properties, no empty sections');
  assert.match(machine, /kind: "NAS"/, 'what it holds is still written');
  assert.doesNotMatch(machine, /status: Up/, 'still not up before any check');
  const svc = S.systems.newServiceText({ kind: 'Web app', runs_on: 'Office NAS', port: '8000', status: 'Up' });
  assert.ok(!/^## /m.test(svc), 'a new service: properties, no empty sections');
  assert.match(svc, /\[\[Office NAS\]\]/, 'its machine still linked');
  const withLogin = S.systems.withCredential(machine, 'Admin login', 'Ab12Cd34Ef');
  assert.match(withLogin, /## Credentials\n\n- Admin login: \[locked\]\(secret:Ab12Cd34Ef\)/, 'Credentials appears with the first login');
  const withHealth = S.personalRecords.tableWithRow(svc, S.systems.HEALTH_LOG, { date: '2026-11-05', status: 'Up', note: 'First check.' });
  assert.match(withHealth, /## Health log\n\n\| Date \| Status \| Note \|/, 'the health log appears with the first note');
  assert.match(withHealth, /\| 2026-11-05 \| Up \| First check\. \|/, 'with its row');
});

// ── 6. On this page appears once ──────────────────────────────────────────────────────────────────

test('On this page and tags appear once: the rail when open, else the row; hidden under three headings', () => {
  const head = read('src/renderer/src/views/DocHead.tsx');
  assert.match(head, /railOpen/, 'the doc head knows the rail');
  assert.match(head, /contents\.length >= 3/, 'hidden on a note with under three headings');
  assert.match(head, /!railOpen &&/, 'never both places at once');
  const rail = read('src/renderer/src/views/note/ContextRail.tsx');
  assert.match(rail, /isDoc/, 'the strip stands aside for a doc’s own row');
  assert.match(rail, /onOpenChange/, 'the rail tells the page when it opens');
  assert.match(rail, /stripHeads\.length >= 3/, 'the same three-heading rule beside any note');
  const view = read('src/renderer/src/views/NoteView.tsx');
  assert.match(view, /railOpen/, 'the note wires the two together');
  assert.match(view, /isDoc=\{isDoc\}/, 'the rail knows a doc');
});
