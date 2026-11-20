// node --test tests/pairing.test.mjs — paired sources (V9) and Markdown-folder completeness (V12), 28 Oct 2026: each
// app's export (made-up fixtures under tests/fixtures/pairing, written by hand from the open formats) read into notes
// that keep where they came from; bringing one in again never overwrites what the person changed (a note only the
// source changed is brought up to date, one only the person changed is kept, one both changed is kept with the
// source's words beside it); block references and inline fields read from a Markdown folder.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'tests', 'fixtures', 'pairing');
const work = mkdtempSync(path.join(tmpdir(), 'nv-pairing-'));
let E, B, F, Z, FM;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export * as E from ${JSON.stringify(path.join(root, 'src/main/pairing/engine.ts'))};`,
      `export * as B from ${JSON.stringify(path.join(root, 'src/shared/blocks.ts'))};`,
      `export * as F from ${JSON.stringify(path.join(root, 'src/shared/inline-fields.ts'))};`,
      `export * as Z from ${JSON.stringify(path.join(root, 'src/main/zip.ts'))};`,
      `export * as FM from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: [/^node:/], output: { file: path.join(work, 'pairing.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ E, B, F, Z, FM } = await import(pathToFileURL(path.join(work, 'pairing.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

let n = 0;
const freshVault = () => {
  const v = path.join(work, `vault-${++n}`);
  mkdirSync(v, { recursive: true });
  return v;
};
const temp = () => {
  const t = path.join(work, 'temp');
  mkdirSync(t, { recursive: true });
  return t;
};
const read = (v, rel) => readFileSync(path.join(v, ...rel.split('/')), 'utf8');
const has = (v, rel) => existsSync(path.join(v, ...rel.split('/')));
const bring = (v, source, o = {}) => E.importPath(v, source, { tempDir: temp(), now: new Date(2026, 9, 28, 10, 0), ...o });
/** Every .md under a folder, relative. */
const notesIn = (v, dir) => {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(v, ...rel.split('/')), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (r.endsWith('.md')) out.push(r);
    }
  };
  if (has(v, dir)) walk(dir);
  return out.sort();
};

// ── Evernote ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('an Evernote notebook comes in with its ticks, tags, picture and where it came from', async () => {
  const v = freshVault();
  const preview = await bring(v, path.join(fixtures, 'evernote', 'Recipes.enex'), { previewOnly: true });
  assert.equal(preview.summary, null);
  assert.equal(preview.plan.kind, 'evernote');
  assert.equal(preview.plan.into, 'From Evernote/Recipes');
  assert.equal(preview.plan.notes, 2);
  assert.equal(preview.plan.files, 1);
  assert.match(preview.plan.words, /2 notes, 1 file from Evernote “Recipes”, into “From Evernote\/Recipes”/);
  assert.ok(!has(v, 'From Evernote'), 'a preview writes nothing');

  const wrote = [];
  const { summary } = await bring(v, path.join(fixtures, 'evernote', 'Recipes.enex'), { beforeWrite: (abs) => wrote.push(path.relative(v, abs).split(path.sep).join('/')) });
  assert.equal(summary.added, 2);
  assert.deepEqual(wrote.sort(), ['.neuralvault/pairs/evernote-from-evernote-recipes.json', 'From Evernote/Recipes/Banana pancakes.md', 'From Evernote/Recipes/Files/Banana pancakes/stack.png', 'From Evernote/Recipes/Lemon slice.md'], 'every write is told first (Rewind)');
  assert.equal(summary.files, 1);
  const note = read(v, 'From Evernote/Recipes/Banana pancakes.md');
  const props = FM.readProps(note);
  assert.equal(props.source, 'Evernote');
  assert.equal(props['source-file'], 'Recipes.enex');
  assert.ok(String(props['source-id']).includes('Banana pancakes'));
  assert.equal(props.imported, '2026-10-28');
  assert.deepEqual(props.tags, ['breakfast', 'family-favourites']);
  assert.equal(props.url, 'https://example.com/pancakes');
  assert.equal(props.author, 'Aroha');
  assert.match(note, /\*\*Makes 8\.\*\* Mash two bananas & whisk with eggs\./);
  assert.match(note, /^- \[x\] Buy bananas$/m);
  assert.match(note, /^- \[ \] Buy maple syrup$/m);
  assert.match(note, /!\[\[From Evernote\/Recipes\/Files\/Banana pancakes\/stack\.png\]\]/);
  assert.ok(has(v, 'From Evernote/Recipes/Files/Banana pancakes/stack.png'));
  const lemon = read(v, 'From Evernote/Recipes/Lemon slice.md');
  assert.match(lemon, /## Base/);
  assert.match(lemon, /encrypted text, not brought in/);
  assert.doesNotMatch(lemon, /c2VjcmV0/, 'encrypted words never come in');
  assert.equal(E.listPairs ? (await E.listPairs(v)).length : 0, 1);
});

test('bringing it in again: up to date where only Evernote changed, yours kept, both changed kept side by side', async () => {
  const v = freshVault();
  const enex = path.join(work, 'Recipes.enex');
  cpSync(path.join(fixtures, 'evernote', 'Recipes.enex'), enex);
  await bring(v, enex);
  // Same export again: nothing changes.
  let { summary } = await bring(v, enex);
  assert.equal(summary.same, 2);
  assert.equal(summary.added + summary.updated + summary.conflicts.length, 0);
  // The person edits the pancakes; Evernote changes the lemon slice.
  const pancakes = 'From Evernote/Recipes/Banana pancakes.md';
  writeFileSync(path.join(v, ...pancakes.split('/')), read(v, pancakes) + '\nMy own tip: add cinnamon.\n');
  const before = [];
  writeFileSync(enex, readFileSync(enex, 'utf8').replace('Crushed biscuits', 'Crushed gingernuts'));
  ({ summary } = await bring(v, enex, { beforeChange: (rel, text) => before.push([rel, text]) }));
  assert.equal(summary.updated, 1);
  assert.equal(summary.keptYours, 1);
  assert.match(read(v, 'From Evernote/Recipes/Lemon slice.md'), /Crushed gingernuts/);
  assert.equal(FM.readProps(read(v, 'From Evernote/Recipes/Lemon slice.md')).synced, '2026-10-28');
  assert.equal(before.length, 1, 'the words before an update are handed to File recovery');
  assert.match(before[0][1], /Crushed biscuits/);
  assert.match(read(v, pancakes), /My own tip: add cinnamon/);
  // Now both change the pancakes: the person's note stays, Evernote's words go beside it.
  writeFileSync(enex, readFileSync(enex, 'utf8').replace('Makes 8.', 'Makes 10.'));
  ({ summary } = await bring(v, enex));
  assert.equal(summary.conflicts.length, 1);
  const { rel, copy } = summary.conflicts[0];
  assert.equal(rel, pancakes);
  assert.equal(copy, 'From Evernote/Recipes/Banana pancakes (from Evernote, 28 Oct 2026).md');
  assert.match(read(v, pancakes), /My own tip: add cinnamon/);
  assert.match(read(v, pancakes), /Makes 8\./);
  assert.match(read(v, copy), /Makes 10\./);
  assert.equal(FM.readProps(read(v, copy))['conflict-of'], '[[From Evernote/Recipes/Banana pancakes]]');
  const both = await E.readConflict(v, rel, copy);
  assert.match(both.mine, /cinnamon/);
  assert.match(both.theirs, /Makes 10/);
  assert.match(summary.words, /changed both here and in Evernote: yours is kept/);
  // Again with the same export: no second copy.
  ({ summary } = await bring(v, enex));
  assert.equal(summary.conflicts.length, 0);
  assert.equal(summary.keptYours, 1);
  // A note the person removed never comes back; one they moved is found where it is.
  rmSync(path.join(v, 'From Evernote', 'Recipes', 'Lemon slice.md'));
  mkdirSync(path.join(v, 'Kitchen'), { recursive: true });
  cpSync(path.join(v, ...pancakes.split('/')), path.join(v, 'Kitchen', 'Pancakes.md'));
  rmSync(path.join(v, ...pancakes.split('/')));
  writeFileSync(enex, readFileSync(enex, 'utf8').replace('Crushed gingernuts', 'Crushed shortbread'));
  ({ summary } = await bring(v, enex));
  assert.equal(summary.removedHere, 1);
  assert.ok(!has(v, 'From Evernote/Recipes/Lemon slice.md'));
  assert.ok(!has(v, pancakes), 'a moved note is not written again at its old place');
  assert.equal(summary.keptYours, 1);
});

test('a file the person changed is kept and the source’s copy goes beside it', async () => {
  const v = freshVault();
  const enex = path.join(work, 'Pics.enex');
  cpSync(path.join(fixtures, 'evernote', 'Recipes.enex'), enex);
  await bring(v, enex);
  const pic = 'From Evernote/Pics/Files/Banana pancakes/stack.png';
  assert.ok(has(v, pic));
  writeFileSync(path.join(v, ...pic.split('/')), 'my own picture');
  // Same bytes from the source: the person's stays and no copy is made.
  const { summary } = await bring(v, enex);
  assert.equal(read(v, pic), 'my own picture');
  assert.equal(summary.files, 0);
});

// ── Notion ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a Notion export zip: ids out of names and links, a database as notes with properties, links and a board', async () => {
  const v = freshVault();
  const zip = path.join(work, 'Export-5f1c2a.zip');
  const src = path.join(fixtures, 'notion');
  const entries = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(src, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else entries.push({ name: r, data: readFileSync(path.join(src, r)) });
    }
  };
  walk('');
  await Z.writeZip(zip, entries);
  const { plan, summary } = await bring(v, zip, { kind: 'notion' });
  assert.equal(plan.into, 'From Notion');
  assert.equal(plan.views, 2);
  assert.equal(summary.added, 5);
  const notes = notesIn(v, 'From Notion');
  assert.deepEqual(notes, ['From Notion/Home.md', 'From Notion/Home/Ideas.md', 'From Notion/Home/People/Ana.md', 'From Notion/Home/Tasks/Ship it.md', 'From Notion/Home/Tasks/Write report.md']);
  const home = read(v, 'From Notion/Home.md');
  assert.match(home, /\[\[From Notion\/Home\/Ideas\]\]/);
  assert.match(home, /!\[\[From Notion\/Files\/Home\/diagram\.png\]\]|!\[\[From Notion\/Home\/Files\/diagram\.png\]\]/);
  assert.doesNotMatch(home.split('\n---\n')[1], /[0-9a-f]{32}/, 'Notion’s ids are out of the words');
  assert.equal(FM.readProps(home)['source-id'], '0123456789abcdef0123456789abcdef');
  const report = read(v, 'From Notion/Home/Tasks/Write report.md');
  const rp = FM.readProps(report);
  assert.equal(rp.Status, 'In progress');
  assert.equal(rp.Due, '2026-11-02');
  assert.equal(rp.Done, false);
  assert.deepEqual(rp.Owner, ['[[From Notion/Home/People/Ana]]']);
  assert.doesNotMatch(report.split('\n---\n')[1], /^Status: In progress$/m, 'the row’s property lines are taken out of its words');
  assert.match(report, /Ask \[\[From Notion\/Home\/People\/Ana\|Ana\]\]|Ask \[\[From Notion\/Home\/People\/Ana\]\]/);
  const board = JSON.parse(read(v, 'From Notion/Home/Tasks.view.json'));
  assert.equal(board.layout, 'board');
  assert.equal(board.groupBy, 'Status');
  assert.deepEqual(board.source, { kind: 'folder', value: 'From Notion/Home/Tasks' });
  const people = JSON.parse(read(v, 'From Notion/Home/People.view.json'));
  assert.equal(people.layout, 'table');
  assert.ok(!readdirSync(temp()).length, 'the unpacked zip is removed');
  // Said as the wrong app: a plain refusal that says how to get the right file.
  await assert.rejects(bring(v, zip, { kind: 'evernote' }), /doesn’t look like an Evernote export\. In Evernote, right-click a notebook/);
});

// ── Google Keep ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('Google Keep from Takeout: lists as ticks, labels as tags, pictures, the bin left out', async () => {
  const v = freshVault();
  const { plan, summary } = await bring(v, path.join(fixtures, 'keep'));
  assert.equal(plan.kind, 'keep');
  assert.equal(plan.notes, 2);
  assert.deepEqual(plan.skipped, [{ what: '1 note', why: 'in Keep’s bin' }]);
  assert.equal(summary.added, 2);
  const shop = read(v, 'From Google Keep/Shopping.md');
  assert.match(shop, /^- \[ \] Milk$/m);
  assert.match(shop, /^- \[x\] Bread$/m);
  assert.match(shop, /!\[\[From Google Keep\/Files\/Shopping\/1698000000000\.png\]\]/, 'the .jpeg Keep named is found as the .png beside it');
  const sp = FM.readProps(shop);
  assert.deepEqual(sp.tags, ['Home-stuff']);
  assert.equal(sp.pinned, true);
  assert.equal(sp.color, 'yellow');
  const gate = read(v, 'From Google Keep/Gate code.md');
  assert.equal(FM.readProps(gate).archived, true);
  assert.match(gate, /\[Council bin days\]\(https:\/\/example\.com\/council-bins\)/);
  assert.ok(!has(v, 'From Google Keep/Old idea.md'));
});

// ── Readwise ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('Readwise highlights: a note per book, highlights in reading order with their notes and tags', async () => {
  const v = freshVault();
  const { summary } = await bring(v, path.join(fixtures, 'readwise', 'readwise-export.csv'), { kind: 'readwise' });
  assert.equal(summary.added, 2);
  const book = read(v, 'From Readwise/The Kind Garden.md');
  const p = FM.readProps(book);
  assert.equal(p.author, 'Mere Tane');
  assert.deepEqual(p.tags, ['gardening']);
  assert.equal(p.highlights, 2);
  const water = book.indexOf('Water deeply');
  const habits = book.indexOf('Small habits');
  assert.ok(water > 0 && water < habits, 'location 45 before location 120');
  assert.match(book, /Small habits make big differences over time\. \(location 120\) #habits \^rw-[0-9a-f]{8}/);
  assert.match(book, /^ {2}- Note: Use this for the newsletter$/m);
  assert.ok(B.blockIds(book).length === 2, 'each highlight carries a block id');
});

// ── Logseq ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a Logseq graph: properties up top, tasks as ticks, block references and embeds, namespaces, journals as daily notes', async () => {
  const v = freshVault();
  mkdirSync(path.join(v, 'Journal'), { recursive: true });
  writeFileSync(path.join(v, 'Journal', '27 10 2026.md'), 'My own words for the day.\n');
  const { plan, summary } = await bring(v, path.join(fixtures, 'logseq', 'graph'), { daily: { folder: 'Journal', format: 'DD MM YYYY' } });
  assert.equal(plan.kind, 'logseq');
  assert.equal(plan.into, 'From Logseq/graph');
  assert.equal(plan.daily, 1);
  assert.equal(summary.added, 2);
  assert.equal(summary.updated, 1, 'the day already written in is combined, never replaced');
  const garden = read(v, 'From Logseq/graph/Garden.md');
  const gp = FM.readProps(garden);
  assert.deepEqual(gp.tags, ['home', 'outdoors']);
  assert.deepEqual(gp.aliases, ['Veggie patch']);
  assert.match(garden, /^\s+- \[ \] Tomatoes in bed 2$/m);
  assert.match(garden, /^\s+- \[x\] Compost turned \^6530a1b2-0000-4000-8000-000000000001$/m);
  assert.match(garden, /!\[\[From Logseq\/graph\/Files\/Garden\/plot_1698\.png\]\]/);
  assert.match(garden, /\[\[From Logseq\/graph\/Projects\/Shed\]\]/);
  const shed = read(v, 'From Logseq/graph/Projects/Shed.md');
  assert.match(shed, /Ask about iron sheets \[\[From Logseq\/graph\/Garden#\^6530a1b2-0000-4000-8000-000000000001\|Compost turned\]\]/);
  assert.match(shed, /!\[\[From Logseq\/graph\/Garden#\^6530a1b2-0000-4000-8000-000000000001\]\]/);
  assert.match(shed, /#weekend-jobs/);
  assert.doesNotMatch(shed, /collapsed::/);
  // The reference resolves to the block.
  assert.equal(B.blockOf(garden, '^6530a1b2-0000-4000-8000-000000000001').text.trim(), '- [x] Compost turned');
  const day = read(v, 'Journal/27 10 2026.md');
  assert.match(day, /^My own words for the day\./);
  assert.match(day, /Merged from Logseq/);
  assert.match(day, /\[\[From Logseq\/graph\/Garden\|Veggie patch\]\]/);
  assert.match(day, /- \[ \] call the hardware shop/);
  // Again: the merged day is left alone when the journal didn't change.
  const again = await bring(v, path.join(fixtures, 'logseq', 'graph'), { daily: { folder: 'Journal', format: 'DD MM YYYY' } });
  assert.equal(again.summary.same, 3);
});

// ── Roam ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a Roam graph: attributes as properties, TODO buttons as ticks, references, embeds, daily pages', async () => {
  const v = freshVault();
  const { plan, summary } = await bring(v, path.join(fixtures, 'roam', 'My graph.json'));
  assert.equal(plan.kind, 'roam');
  assert.equal(plan.into, 'From Roam Research/My graph');
  assert.equal(summary.added, 3);
  const list = read(v, 'From Roam Research/My graph/Reading list.md');
  assert.equal(FM.readProps(list).Type, 'Book list');
  assert.match(list, /^- \[ \] Finish \[\[From Roam Research\/My graph\/The Kind Garden\]\]$/m);
  assert.match(list, /^### Quotes$/m);
  assert.match(list, /^- Water deeply, not often\. \^q1-water$/m);
  assert.match(list, /\*Italic\* and ==bright== words/);
  const book = read(v, 'From Roam Research/My graph/The Kind Garden.md');
  assert.match(book, /Best line: \[\[From Roam Research\/My graph\/Reading list#\^q1-water\|Water deeply, not often\.\]\]/);
  assert.match(book, /!\[\[From Roam Research\/My graph\/Reading list#\^q1-water\]\]/);
  const day = read(v, 'Daily/2026-10-27.md');
  assert.match(day, /- \[x\] Library run, see \[\[From Roam Research\/My graph\/Reading list\]\] #reading/);
});

test('a file that is none of these apps’ exports is refused in plain words', async () => {
  const v = freshVault();
  const odd = path.join(work, 'odd.csv');
  writeFileSync(odd, 'a,b\n1,2\n');
  await assert.rejects(bring(v, odd), /can’t tell which app that came from/);
  await assert.rejects(bring(v, v), /this vault, or is inside it/);
});

// ── Markdown folders (V12) ───────────────────────────────────────────────────────────────────────────────────────────

test('block references: an id at a paragraph’s end, on a list item, alone under a table; never inside code', () => {
  const text = readFileSync(path.join(fixtures, 'markdown', 'Garden plan.md'), 'utf8');
  assert.deepEqual(B.blockIds(text), ['sunny-bed', 'water', 'beds']);
  assert.equal(B.blockOf(text, 'sunny-bed').text, 'The tomatoes go in bed two, against the fence\nwhere the sun stays longest.');
  assert.equal(B.blockOf(text, '^water').text, '  - mornings only');
  assert.equal(B.blockOf(text, 'beds').text, '| Bed | Crop |\n| --- | --- |\n| 1 | Beans |\n| 2 | Tomatoes |');
  assert.equal(B.blockOf(text, 'BEDS').line, B.blockOf(text, 'beds').line, 'case is ignored');
  assert.equal(B.blockOf(text, 'not-a-block'), null);
  assert.equal(B.withoutBlockId('Feed the worms ^w1'), 'Feed the worms');
  assert.equal(B.withoutBlockId('^alone'), '');
  assert.equal(B.lineBlockId('price is 2^10'), null, 'a caret inside words is not an id');
  const id = B.newBlockId(text, () => 0.5);
  assert.match(id, /^[a-z0-9]{6}$/);
});

test('inline fields: a line of its own, after a tick, in brackets; front matter wins; code is skipped; nothing rewritten', () => {
  const text = readFileSync(path.join(fixtures, 'markdown', 'Garden plan.md'), 'utf8');
  const fields = F.fieldProps(text);
  assert.deepEqual(fields, { Status: 'growing', Beds: 3, due: '2026-11-01' });
  assert.deepEqual(F.withFields({ type: 'plan', status: 'done' }, text), { type: 'plan', status: 'done', Beds: 3, due: '2026-11-01' });
  assert.deepEqual(F.fieldProps('See https://example.com::8080 and Note: plain'), {});
  assert.deepEqual(F.fieldProps('- tag:: a\n- tag:: b'), { tag: ['a', 'b'] });
});

test('an inline field written once changes where it is written: its line and brackets stay, only its words change', () => {
  // A line of its own, after a tick, and in a sentence's brackets; nothing else on the page moves.
  assert.equal(F.setInlineField('# Bed plan\n\nStatus:: growing\n', 'Status', 'sown'), '# Bed plan\n\nStatus:: sown\n');
  assert.equal(F.setInlineField('- [ ] Water [Bed:: two] at dawn\n', 'Bed', 'three'), '- [ ] Water [Bed:: three] at dawn\n');
  assert.equal(F.setInlineField('- Beds:: 3\n- Water:: mornings\n', 'Water', 'evenings'), '- Beds:: 3\n- Water:: evenings\n');
  // A value that repeats the key's own words still lands in the value's place, not the key's.
  assert.equal(F.setInlineField('See (note:: a note here).\n', 'note', 'another'), 'See (note:: another).\n');
  // Missing, or written twice: left alone, so the page keeps it read-only.
  assert.equal(F.setInlineField('Status:: growing\n', 'Beds', '3'), null);
  assert.equal(F.setInlineField('- tag:: a\n- tag:: b\n', 'tag', 'c'), null);
  // In code, or a link's port: not a field, left alone.
  assert.equal(F.setInlineField('```\nStatus:: growing\n```\n', 'Status', 'sown'), null);
  assert.equal(F.setInlineField('See https://example.com::8080\n', 'example.com', 'x'), null);
  // Front matter is skipped when finding it, and line endings stay as they were.
  assert.equal(F.setInlineField('---\nStatus:: draft\n---\n\nStatus:: growing\n', 'Status', 'sown'), '---\nStatus:: draft\n---\n\nStatus:: sown\n');
  assert.equal(F.setInlineField('Status:: growing\r\nWater:: mornings\r\n', 'Water', 'evenings'), 'Status:: growing\r\nWater:: evenings\r\n');
});

test('the fixtures are made up and name no other app’s files or settings folder', () => {
  const all = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else all.push(p);
    }
  };
  walk(fixtures);
  assert.ok(all.length >= 20);
  for (const p of all) assert.doesNotMatch(p, /\.obsidian/i);
});

// ── A source kept in step live (V10, V11): the same rules, plus sending changes back ─────────────────────────────────

test('a live source: what the person changed is found to send back, and the answer is agreed, never a change on both sides', async () => {
  const v = freshVault();
  const item = (status, body = 'Draft the report.\n') => ({ id: 'page-1', title: 'Write report', folder: 'Tasks', props: { Status: status }, body, files: [] });
  const src = (status, body) => ({ kind: 'notion', name: 'Team', items: [item(status, body)], views: [], skipped: [] });
  const into = 'From Notion/Team';
  const at = { now: new Date(2026, 9, 28, 10, 0) };
  const first = await E.importSource(v, await E.liveSource(v, src('Doing'), { sourceFile: 'Notion', into }), at);
  assert.equal(first.added, 1);
  const id = E.pairIdFor('notion', into);
  assert.deepEqual(await E.changedHere(v, id), []);
  const rel = 'From Notion/Team/Tasks/Write report.md';
  // The person moves it to Done here.
  writeFileSync(path.join(v, ...rel.split('/')), read(v, rel).replace('Status: Doing', 'Status: Done'));
  const changed = await E.changedHere(v, id);
  assert.equal(changed.length, 1);
  assert.equal(FM.readProps(changed[0].text).Status, 'Done');
  // The former host app sent it; Notion now says Done: agreed, no copy, nothing changed here.
  const back = await E.importSource(v, await E.liveSource(v, src('Done'), { sourceFile: 'Notion', into }), { ...at, pushed: new Set(['page-1']) });
  assert.equal(back.conflicts.length, 0);
  assert.equal(back.updated, 0);
  assert.deepEqual(await E.changedHere(v, id), [], 'agreed: nothing left to send');
  // Later Notion changes the words: brought here, as only Notion changed.
  const later = await E.importSource(v, await E.liveSource(v, src('Done', 'Draft the report. Add charts.\n'), { sourceFile: 'Notion', into }), at);
  assert.equal(later.updated, 1);
  // Both change to the same words: agreed, no copy.
  writeFileSync(path.join(v, ...rel.split('/')), read(v, rel).replace('Add charts.', 'Add charts and a table.'));
  const same = await E.importSource(v, await E.liveSource(v, src('Done', 'Draft the report. Add charts and a table.\n'), { sourceFile: 'Notion', into }), at);
  assert.equal(same.conflicts.length, 0);
  assert.deepEqual(await E.changedHere(v, id), []);
  assert.equal((await E.listPairs(v))[0].live, true);
});

// ── Import uplift (9.5, nv-import F13–F18, F23–F24): nothing lost silently ──────────────────────────────────────────

test('F13: an Evernote picture shown but not in the export is marked in the note and said', async () => {
  const v = freshVault();
  const enex = path.join(work, 'Missing.enex');
  writeFileSync(enex, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd"><en-export><note><title>Soup</title><created>20260102T030405Z</created><content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><p>Before.</p><en-media type="image/png" hash="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/><p>After.</p></en-note>]]></content></note></en-export>`);
  const { summary } = await bring(v, enex);
  assert.equal(summary.added, 1);
  assert.match(read(v, 'From Evernote/Missing/Soup.md'), /a picture not in the export/);
  assert.deepEqual(summary.skipped, [{ what: 'Soup', why: 'a picture it showed wasn’t in the export' }]);
});

test('F14: Evernote attachments keep a usable ending, and a mystery kind is said', async () => {
  const v = freshVault();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');
  const enex = path.join(work, 'Kinds.enex');
  writeFileSync(enex, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd"><en-export><note><title>Docs</title><created>20260102T030405Z</created><content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><p>See attached.</p></en-note>]]></content><resource><mime>application/vnd.openxmlformats-officedocument.wordprocessingml.document</mime><data encoding="base64">${png}</data></resource><resource><mime>application/x-madeupkind</mime><data encoding="base64">${png}</data></resource></note></en-export>`);
  const { summary } = await bring(v, enex);
  assert.equal(summary.added, 1);
  const note = read(v, 'From Evernote/Kinds/Docs.md');
  assert.match(note, /Docs 1\.docx/, 'a Word attachment keeps .docx, not .bin');
  assert.match(note, /Docs 2\.bin/, 'the mystery kind is still kept');
  assert.ok(summary.skipped.some((s) => /application\/x-madeupkind/.test(s.why)), `said: ${JSON.stringify(summary.skipped)}`);
});

test('F15: renaming the export file does not duplicate or conflict — the same words are agreed', async () => {
  const v = freshVault();
  const first = path.join(work, 'Stable.enex');
  cpSync(path.join(fixtures, 'evernote', 'Recipes.enex'), first);
  await bring(v, first);
  const second = path.join(work, 'Stable renamed.enex');
  cpSync(first, second);
  const { summary } = await bring(v, second);
  assert.equal(summary.conflicts.length, 0, 'no copies beside');
  assert.equal(summary.added, 0, 'nothing new');
  assert.equal(summary.same, 2, 'both agreed by their words, not the file name');
  assert.ok(!existsSync(path.join(v, 'From Evernote', 'Stable renamed')), 'no second folder of copies');
});

test('F16: a damaged inner zip is said, and a file that merely isn’t a zip is tolerated', async () => {
  const v = freshVault();
  const hex = '0123456789abcdef0123456789abcdef';
  const innerOk = path.join(work, 'inner-ok.zip');
  await Z.writeZip(innerOk, [{ name: `Inner ${hex}.md`, data: Buffer.from('# Inner\n\nWords.\n') }]);
  const bytes = readFileSync(innerOk);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  const outer = path.join(work, 'outer-16.zip');
  await Z.writeZip(outer, [
    { name: `Home ${hex}.md`, data: Buffer.from('# Home\n\nStart.\n') },
    { name: 'inner.zip', data: bytes },
    { name: 'notes.zip', data: Buffer.from('just words, not a zip') },
  ]);
  const { summary } = await bring(v, outer, { kind: 'notion' });
  assert.ok(summary.skipped.some((s) => s.what === 'inner.zip' && /couldn’t be unpacked/.test(s.why)), `damaged said: ${JSON.stringify(summary.skipped)}`);
  assert.ok(!summary.skipped.some((s) => s.what === 'notes.zip'), 'a non-zip .zip is dropped quietly');
  assert.ok(summary.added >= 1);
});

test('F17: a Notion file in a database folder goes with its rows, and a true orphan is kept in Unplaced files (10.0 item 16)', async () => {
  const v = freshVault();
  const hex = (c) => c.repeat(32);
  const dir = path.join(work, 'notion-17');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, `Tasks ${hex('a')}`), { recursive: true });
  writeFileSync(path.join(dir, `Tasks ${hex('a')}.csv`), 'Name,Status\nWrite report,Doing\n');
  writeFileSync(path.join(dir, `Tasks ${hex('a')}`, `Write report ${hex('b')}.md`), `# Write report\n\nStatus: Doing\n\nDraft it.\n`);
  writeFileSync(path.join(dir, `Tasks ${hex('a')}`, 'loose.png'), Buffer.from([1, 2, 3]));
  writeFileSync(path.join(dir, 'stray.png'), Buffer.from([4, 5, 6]));
  const { summary } = await bring(v, dir, { kind: 'notion' });
  const row = read(v, 'From Notion/Tasks/Write report.md');
  assert.match(row, /loose\.png/, 'the database file is listed with its row');
  assert.ok(has(v, 'From Notion/Unplaced files.md'), 'the orphan note kept');
  assert.match(read(v, 'From Notion/Unplaced files.md'), /stray\.png/, 'the orphan listed with where it came from');
  assert.ok(has(v, 'From Notion/Files/Unplaced files/stray.png'), 'the orphan file beside the note');
  assert.ok(!summary.skipped.some((s) => /stray\.png/.test(s.what)), `kept, never left out: ${JSON.stringify(summary.skipped)}`);
});

test('F18: Notion HTML pages are said with the folder door, not silently ignored', async () => {
  const v = freshVault();
  const hex = '0123456789abcdef0123456789abcdef';
  const dir = path.join(work, 'notion-18');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `Home ${hex}.md`), '# Home\n\nStart.\n');
  writeFileSync(path.join(dir, `Old ${hex.slice(0, 16)}${hex.slice(0, 16)}.html`), '<html><body><p>Old page.</p></body></html>');
  const { summary } = await bring(v, dir, { kind: 'notion' });
  assert.ok(summary.skipped.some((s) => /HTML/.test(s.what) && /A folder of notes/.test(s.why)), `HTML said: ${JSON.stringify(summary.skipped)}`);
});

test('F23: a Roam file link with no web address becomes words and is said', async () => {
  const v = freshVault();
  const json = path.join(work, 'roam-23.json');
  writeFileSync(json, JSON.stringify([{ title: 'Plans', children: [{ string: 'See [Spec](spec.pdf) and ![Shot](shot.png) plus ![](bare.png).', uid: 'u1' }] }]));
  const { summary } = await bring(v, json);
  const note = read(v, 'From Roam Research/roam-23/Plans.md');
  assert.doesNotMatch(note, /\[Spec\]\(spec\.pdf\)/, 'no broken link left');
  assert.match(note, /Spec/, 'the words stay');
  assert.match(note, /a picture not in the export/, 'an unlabelled picture is marked');
  assert.ok(summary.skipped.some((s) => s.what === 'Plans' && /isn’t in the export/.test(s.why)), `said: ${JSON.stringify(summary.skipped)}`);
});

test('F24: a Logseq link outside assets resolves against the graph, or is said', async () => {
  const v = freshVault();
  const graph = path.join(work, 'logseq-24');
  rmSync(graph, { recursive: true, force: true });
  mkdirSync(path.join(graph, 'pages'), { recursive: true });
  mkdirSync(path.join(graph, 'journals'), { recursive: true });
  mkdirSync(path.join(graph, 'diagrams'), { recursive: true });
  writeFileSync(path.join(graph, 'pages', 'Shed.md'), '- See [flow](../diagrams/flow.png) and [gone](../diagrams/gone.png).\n');
  writeFileSync(path.join(graph, 'diagrams', 'flow.png'), Buffer.from([1, 2, 3]));
  const { summary } = await bring(v, graph);
  const note = read(v, 'From Logseq/logseq-24/Shed.md');
  assert.match(note, /flow\.png/, 'the found file comes with the page');
  assert.ok(summary.skipped.some((s) => s.what === 'Shed' && /gone\.png/.test(s.why)), `the missing one said: ${JSON.stringify(summary.skipped)}`);
});

test('F1: a large import reports its share, stops on the word stop with no half note, and continues', async () => {
  const v = freshVault();
  const hex = (c) => c.repeat(32);
  const dir = path.join(work, 'notion-f1');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [t, c] of [['Alpha', 'a'], ['Beta', 'b'], ['Gamma', 'c'], ['Delta', 'd']]) writeFileSync(path.join(dir, `${t} ${hex(c)}.md`), `# ${t}\n\nWords for ${t}.\n`);
  const phases = [];
  const signal = { stopped: false };
  const src = await E.readSource(dir, v, { kind: 'notion', tempDir: path.join(work, 'tmp-f1') });
  try {
    const partial = await E.importSource(v, src, {
      signal,
      onProgress: (p) => {
        phases.push(p);
        if (p.phase === 'notes' && p.done >= 1) signal.stopped = true;
      },
    });
    assert.equal(partial.stopped, true);
    assert.match(partial.words, /Stopped halfway/);
    assert.equal(partial.added, 2, 'two notes finished before the stop');
    for (const rel of partial.written) {
      const text = read(v, rel);
      assert.match(text, /^---\n[\s\S]*?\n---\n/, 'each note kept whole, with its front matter');
      assert.ok(text.endsWith('\n'), 'no half note');
    }
  } finally { await src.done(); }
  assert.ok(phases.some((p) => p.phase === 'notes' && p.total === 4), `notes share: ${JSON.stringify(phases)}`);
  // Bringing it in again continues: the two already here agreed, the rest added, nothing doubled.
  const { summary } = await bring(v, dir, { kind: 'notion' });
  assert.equal(summary.stopped, undefined);
  assert.equal(summary.same, 2);
  assert.equal(summary.added, 2);
  assert.equal(summary.conflicts.length, 0);
});
