// node --test tests/weekly-tidy.test.mjs — the weekly tidy (2 Nov 2026, 10.0 plan item 21;
// src/shared/weekly-tidy.ts, src/main/weekly-tidy.ts). A made-up messy vault holds every kind: notes that say the
// same thing twice over, links that point nowhere (one with a single note to take them, one with none, one with
// several), notes left empty, a note at the top with a home to go to, and reminders long overdue. Each kind is
// proposed, applied and undone; Locked notes, templates, left-out folders and project files are never proposed;
// skips stay quiet 30 days; the proposal comes once a week. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-weekly-tidy-'));
let S, M, A, V, keepsEveryLine, sameRecordName;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (f) => JSON.stringify(path.join(root, f));
  writeFileSync(
    entry,
    [
      `export * as S from ${src('src/shared/weekly-tidy.ts')};`,
      `export * as M from ${src('src/main/weekly-tidy.ts')};`,
      `export * as A from ${src('src/shared/agent-access.ts')};`,
      `export * as V from ${src('src/shared/vault-tools.ts')};`,
      `export { mergeNote, keepsEveryLine } from ${src('src/shared/vault-merge.ts')};`,
      `export { sameRecordName } from ${src('src/shared/record-match.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'tidy.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ S, M, A, V, keepsEveryLine, sameRecordName } = await import(pathToFileURL(path.join(work, 'tidy.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

// Monday 2 Nov 2026, 9:00 am local.
const NOW = new Date(2026, 10, 2, 9, 0).getTime();
const DAY = 86_400_000;
const OLD = NOW - 60 * DAY;
const FRESH = NOW - 1 * DAY;

const BODY = `The hall committee met on the first Tuesday of the month and agreed the new opening hours for the hall,
the roster for the front desk, and the cleaning contract for the rest of the year. Everyone stayed for tea.
Minutes were circulated the same evening and filed with the month's papers for the record.`;

const note = (p, title, content, mtime = OLD, props = {}) => ({ path: p, title, content, mtime, props });

// A 384-wide unit vector at an exact cosine to vec384(1, 0): vec384(0.92, …) reads 0.92, vec384(0.5, …) reads 0.5.
const vec384 = (a, b) => {
  const v = new Array(384).fill(0);
  const n = Math.hypot(a, b);
  v[0] = a / n;
  v[1] = b / n;
  return v;
};
const vec128 = (a, b) => {
  const v = new Array(128).fill(0);
  const n = Math.hypot(a, b);
  v[0] = a / n;
  v[1] = b / n;
  return v;
};
const LONG = 'The hall committee agreed the roster and the paint colours for spring. ';
const longBody = (title, extra = '') => `# ${title}\n\n${LONG.repeat(6)}${extra}`;

// The made-up messy vault, as the planner reads it.
function messy() {
  return [
    note('Notes/Shopping list.md', 'Shopping list', '# Shopping list\n\nMilk, flour, eggs.\n', NOW - 40 * DAY),
    note('Notes/Shopping  list.md', 'Shopping  list', '# Shopping list\n\nMilk, flour, eggs, butter.\n', NOW - 50 * DAY),
    note('Ideas.md', 'Ideas', `# Ideas\n\n${BODY}\n`, OLD),
    note('More ideas.md', 'More ideas', `# Ideas\n\n${BODY}\n`, NOW - 45 * DAY),
    note('Stays/Harbour Hotel.md', 'Harbour Hotel', '# Harbour Hotel\n\nBy the water.\n', OLD),
    note('Notes/Trip.md', 'Trip', '# Trip\n\nStaying at [[Harbour  Hotel]] for two nights.\n', OLD),
    note('Notes/Odd.md', 'Odd', '# Odd\n\nSee [[No Such Note Anywhere]] for details.\n', OLD),
    note('A/Store.md', 'Store', '# Store\n\nThe first.\n', OLD),
    note('B/Store.md', 'Store', '# Store\n\nThe second.\n', OLD),
    note('Notes/Odd2.md', 'Odd2', '# Odd2\n\nBack to the [old store](Store!.md) soon.\n', OLD),
    note('Notes/Emb.md', 'Emb', '# Emb\n\n![[Missing Pic Note]]\n', OLD),
    note('Notes/Files.md', 'Files', '# Files\n\nRead [the paper](Files/paper.pdf) first.\n', OLD),
    note('Old empty.md', 'Old empty', '---\ntype: note\n---\n# Old empty\n', OLD),
    note('New empty.md', 'New empty', '# New empty\n', FRESH),
    note('Daily/2026-11-02.md', '2026-11-02', '# 2026-11-02\n', OLD),
    note('Hall quote.md', 'Hall quote', '# Hall quote\n\nThe quote for the [[Hall Opening]] paint job.\n', OLD),
    note('Projects/Hall/Hall Opening.md', 'Hall Opening', '# Hall Opening\n\nThe project.\n', OLD, { type: 'project' }),
    note('Loose.md', 'Loose', '# Loose\n\nLoose words.\n', OLD),
    note('Projects/Hall/Loose.md', 'Settled', '# Settled\n\nAlready home.\n', OLD),
    note('Notes/Rem.md', 'Rem', '# Rem\n\n- [ ] Pay the plumber ⏰ 2026-09-01 09:00\n- [ ] Water the plants ⏰ 2026-10-28 09:00\n- [ ] Bins out ⏰ 2026-09-01 09:00 every Monday\n- [x] Old done ⏰ 2026-08-01 09:00\n', OLD),
    note('Private notes/Secret.md', 'Secret', '# Secret\n\n- [ ] Secret overdue ⏰ 2026-08-01 09:00\n', OLD),
    note('Private notes/Secret copy.md', 'Secret copy', '# Secret\n\n- [ ] Secret overdue ⏰ 2026-08-01 09:00\n', OLD),
    note('Templates/Empty.md', 'Empty', '# Empty\n', OLD),
    note('Archive/Old.md', 'Old', '# Old\n\nSee [[No Such Note Anywhere]] too.\n', OLD),
    note('Projects/Hall/Hall.md', 'Hall', '---\ntype: project\n---\n# Hall\n', OLD, { type: 'project' }),
  ];
}

// Like the app's index (VaultIndex.resolve): the target lower-cased, trimmed and without .md, matched against full
// paths then note names exactly (spacing and punctuation count); several matches resolve to the shortest, never null.
function resolveIn(notes) {
  const norm = (s) => s.replace(/\\/g, '/').replace(/\.md$/i, '').trim().toLowerCase();
  return (target) => {
    const t = norm(target.split('#')[0]);
    for (const n of notes) if (norm(n.path) === t) return n.path;
    const base = t.split('/').pop();
    const hits = notes.filter((n) => norm(n.title) === base || norm((n.path.split('/').pop() ?? n.path)) === base);
    if (!hits.length) return null;
    return [...hits].sort((a, b) => a.path.length - b.path.length)[0].path;
  };
}

function ctx(notes, more = {}) {
  return {
    notes,
    resolve: (t) => resolveIn(notes)(t),
    suggestHome: (p) => (p === 'Hall quote.md' ? { dir: 'Projects/Hall', name: 'the Hall Opening project', why: 'Links to Hall Opening' } : p === 'Loose.md' ? { dir: 'Projects/Hall', name: 'the Hall Opening project', why: 'Names Hall' } : null),
    templatesFolder: 'Templates',
    excluded: (p) => p.startsWith('Archive/'),
    dailyToday: 'Daily/2026-11-02.md',
    now: NOW,
    ...more,
  };
}

test('every kind is proposed, and only what should be', () => {
  const notes = messy();
  const items = S.planWeeklyTidy(ctx(notes));
  const by = (kind) => items.filter((i) => i.kind === kind);
  // Duplicates: the two shopping lists, the two identical idea notes and the two stores.
  assert.equal(by('duplicate').length, 3);
  const dup = by('duplicate').find((i) => i.paths.includes('Notes/Shopping  list.md'));
  assert.equal(dup.action.keep, 'Notes/Shopping list.md', 'the newest changed is kept');
  assert.equal(dup.action.drop, 'Notes/Shopping  list.md');
  // Broken links: one relink, two unlinks; the embed and the file link are not proposed.
  const broken = by('broken-link');
  assert.equal(broken.length, 3);
  const relink = broken.find((i) => i.paths[0] === 'Notes/Trip.md');
  assert.equal(relink.action.op, 'relink');
  assert.equal(relink.action.to, 'Stays/Harbour Hotel.md');
  for (const p of ['Notes/Odd.md', 'Notes/Odd2.md']) assert.equal(broken.find((i) => i.paths[0] === p).action.op, 'unlink', `${p} unlinks`);
  assert.ok(!broken.some((i) => i.paths[0] === 'Notes/Emb.md'), 'an embed with nowhere to go is left for the person');
  assert.ok(!broken.some((i) => i.paths[0] === 'Notes/Files.md'), 'file links stay with the vault check');
  // Empty: the settled one only.
  assert.deepEqual(by('empty').map((i) => i.paths[0]), ['Old empty.md']);
  // Wrong place: the top-level note with a free home; the colliding one is not proposed.
  assert.deepEqual(by('wrong-place').map((i) => i.action.to), ['Projects/Hall/Hall quote.md']);
  // Stale reminders: the one-off 62 days overdue only.
  const stale = by('stale-reminder');
  assert.equal(stale.length, 1);
  assert.match(stale[0].detail, /Pay the plumber/);
  assert.match(stale[0].detail, /1 Sep 2026/);
  // Never proposed: Locked notes, templates, left-out folders, project files, the daily being written.
  const paths = items.flatMap((i) => i.paths).join('\n');
  for (const p of ['Private notes/', 'Templates/', 'Archive/', 'Projects/Hall/Hall.md', 'Projects/Hall/Hall Opening.md', 'Daily/2026-11-02.md', 'New empty.md']) assert.ok(!paths.includes(p), `nothing proposes ${p}`);
  // Stable ids inside the proposal.
  assert.deepEqual(by('duplicate').map((i) => i.id), ['duplicate-1', 'duplicate-2', 'duplicate-3']);
  // Caps hold.
  const many = [...notes];
  for (let n = 0; n < 25; n++) many.push(note(`Empty ${n}.md`, `Empty ${n}`, `# Empty ${n}\n`, OLD));
  const capped = S.planWeeklyTidy(ctx(many));
  assert.ok(capped.filter((i) => i.kind === 'empty').length <= S.PER_KIND, 'at most 20 of a kind');
  assert.ok(capped.length <= S.TOTAL, 'at most 50 lines');
});

test('near-duplicates by meaning are proposed with why, the newest changed kept', () => {
  const notes = [
    note('Notes/Hall notes.md', 'Hall notes', longBody('Hall notes'), NOW - 40 * DAY),
    note('Notes/Hall jottings.md', 'Hall jottings', longBody('Hall jottings', 'Tea after.\n'), NOW - 30 * DAY),
    note('Notes/Cake.md', 'Cake', longBody('Cake', 'Flour, sugar, butter.\n'), OLD),
  ];
  const vecs = { 'Notes/Hall notes.md': vec384(1, 0), 'Notes/Hall jottings.md': vec384(0.92, Math.sqrt(1 - 0.92 ** 2)), 'Notes/Cake.md': vec384(0, 1) };
  const items = S.planWeeklyTidy(ctx(notes, { vectors: (p) => vecs[p] ?? null }));
  assert.equal(items.length, 1, 'the meaning pair only: names and bodies differ, so only meaning finds it');
  const [dup] = items;
  assert.equal(dup.kind, 'duplicate');
  assert.match(dup.detail, /They say nearly the same thing\./, 'each pair shown with why');
  assert.equal(dup.action.keep, 'Notes/Hall jottings.md', 'the newest changed is kept');
  assert.equal(dup.action.drop, 'Notes/Hall notes.md');
  assert.ok(!dup.detail.includes('—') && !/deepseek|pi-ai/i.test(dup.detail), 'plain words for the new line');
});

test('meaning pairs below the bar, hashed vectors and short bodies are never proposed', () => {
  // Below 0.8: paraphrase-level likeness is not a duplicate.
  const low = [note('Notes/A.md', 'A', longBody('A'), OLD), note('Notes/B.md', 'B', longBody('B', 'Other words.\n'), OLD)];
  const lowVecs = { 'Notes/A.md': vec384(1, 0), 'Notes/B.md': vec384(0.5, Math.sqrt(1 - 0.25)) };
  assert.equal(S.planWeeklyTidy(ctx(low, { vectors: (p) => lowVecs[p] ?? null })).filter((i) => i.kind === 'duplicate').length, 0, '0.5 is not nearly the same');
  // Hashed vectors (128-wide) sit the meaning pass out, even identical.
  const hashed = [note('Notes/A.md', 'A', longBody('A'), OLD), note('Notes/B.md', 'B', longBody('B', 'Other words.\n'), OLD)];
  const hashedVecs = { 'Notes/A.md': vec128(1, 0), 'Notes/B.md': vec128(1, 0) };
  assert.equal(S.planWeeklyTidy(ctx(hashed, { vectors: (p) => hashedVecs[p] ?? null })).filter((i) => i.kind === 'duplicate').length, 0, 'hashed vectors never propose a merge');
  // Mixed spaces never meet.
  const mixedVecs = { 'Notes/A.md': vec384(1, 0), 'Notes/B.md': vec128(1, 0) };
  assert.equal(S.planWeeklyTidy(ctx(hashed, { vectors: (p) => mixedVecs[p] ?? null })).filter((i) => i.kind === 'duplicate').length, 0, 'an embedding never meets a hashed vector');
  // Short bodies never merge by meaning, however alike.
  const short = [note('Notes/A.md', 'A', '# A\n\nTODO\n', OLD), note('Notes/B.md', 'B', '# B\n\nTODO\n', OLD)];
  const shortVecs = { 'Notes/A.md': vec384(1, 0), 'Notes/B.md': vec384(1, 0) };
  assert.equal(S.planWeeklyTidy(ctx(short, { vectors: (p) => shortVecs[p] ?? null })).filter((i) => i.kind === 'duplicate').length, 0, 'two bare TODOs never merge');
});

test('a pair found by name is not proposed twice by meaning', () => {
  const notes = [note('Notes/Shopping list.md', 'Shopping list', longBody('Shopping list'), NOW - 40 * DAY), note('Notes/Shopping  list.md', 'Shopping  list', longBody('Shopping  list', 'Butter.\n'), NOW - 50 * DAY)];
  const vecs = { 'Notes/Shopping list.md': vec384(1, 0), 'Notes/Shopping  list.md': vec384(1, 0) };
  const dup = S.planWeeklyTidy(ctx(notes, { vectors: (p) => vecs[p] ?? null })).filter((i) => i.kind === 'duplicate');
  assert.equal(dup.length, 1, 'one line for the pair');
  assert.ok(!dup[0].detail.includes('nearly the same thing'), 'the name line stands, as before');
});

test('a skipped line stays quiet 30 days, then can be proposed again', () => {
  const notes = messy();
  const first = S.planWeeklyTidy(ctx(notes));
  const dup = first.find((i) => i.kind === 'duplicate');
  const quiet = S.planWeeklyTidy(ctx(notes, { skipped: { [dup.key]: NOW - 29 * DAY } }));
  assert.ok(!quiet.some((i) => i.key === dup.key), 'skipped 29 days ago: quiet');
  const back = S.planWeeklyTidy(ctx(notes, { skipped: { [dup.key]: NOW - 31 * DAY } }));
  assert.ok(back.some((i) => i.key === dup.key), 'skipped 31 days ago: proposed again');
});

test('new words carry no em dashes and no engine names', () => {
  const words = S.planWeeklyTidy(ctx(messy())).map((i) => `${i.title}\n${i.detail}`).join('\n');
  assert.ok(!words.includes('—'), 'no em dashes in new product words');
  assert.ok(!/deepseek|\bDSH\b|pi-ai/i.test(words), 'no engine names');
  for (const n of S.tidyNeeds([{ id: 'duplicate-1', title: 't', detail: 'd', paths: ['a'] }])) assert.deepEqual(new Set(Object.keys(n)), new Set(['id', 'kind', 'title', 'detail', 'note']), 'the needs seam shape');
});

test('relink, unlink and tick rewrite a note’s text', () => {
  assert.ok(sameRecordName('Shopping list', 'shopping  list'), 'the matcher behind the duplicates');
  const body = 'Staying at [[Harbour Hotel]] and the [old store](Store) soon.\n\nSee [[Harbour Hotel|the hotel]] too.\n';
  const relinked = S.relinkNoteText(body, 'Harbour Hotel', 'Harbour Hotel');
  assert.ok(relinked.changed && relinked.text.includes('[[Harbour Hotel]]'), 'already right: unchanged text');
  const moved = S.relinkNoteText(body, 'Harbour Hotel', 'Stays/Harbour Hotel');
  assert.ok(moved.text.includes('[[Stays/Harbour Hotel]]') && moved.text.includes('[[Stays/Harbour Hotel|the hotel]]'), 'aliases kept');
  assert.ok(!moved.text.includes('[[Harbour Hotel'), 'every occurrence fixed');
  const md = S.relinkNoteText('[stay](Stays/Harbour%20Hotel.md)', 'Stays/Harbour Hotel.md', 'Stays/Harbour Hotel.md');
  assert.equal(md.text, '[stay](Stays/Harbour%20Hotel.md)', 'an identical Markdown link rewrites to itself');
  const un = S.unlinkNoteText('See [[No Such Note Anywhere]] and the [old store](Store).\n', 'No Such Note Anywhere');
  assert.ok(un.changed && un.text.includes('See No Such Note Anywhere and'), 'the words stay, the link goes');
  const aliased = S.unlinkNoteText('See [[Missing|the missing note]] here.\n', 'Missing');
  assert.ok(aliased.text.includes('See the missing note here.'), 'an alias keeps its words');
  const ticked = S.tickReminderText('# Rem\n\n- [ ] Pay the plumber ⏰ 2026-09-01 09:00\n', 5, 'Pay the plumber', new Date(2026, 8, 1, 9).getTime());
  assert.ok(ticked.changed && ticked.text.includes('- [x] Pay the plumber'), 'found by its words at its moment, not its line');
  const gone = S.tickReminderText('# Rem\n\nNothing here.\n', 0, 'Pay the plumber', 1);
  assert.ok(!gone.changed, 'a reminder that left is not ticked by mistake');
  assert.ok(keepsEveryLine('# A\n\n## Merged from B (1 Nov 2026)\n\nWords.\n', 'Words.\n'), 'the merge proof the service leans on');
});

test('the short name wins when it reaches, else the path', () => {
  const short = S.relinkTargetText('Stays/Harbour Hotel.md', 'Harbour Hotel', 'Notes/Trip.md', () => 'Stays/Harbour Hotel.md');
  assert.equal(short, 'Harbour Hotel');
  const full = S.relinkTargetText('Stays/Harbour Hotel.md', 'Harbour Hotel', 'Notes/Trip.md', () => 'Other/Harbour Hotel.md');
  assert.equal(full, 'Stays/Harbour Hotel');
});

// ── The service: one proposal a week, each line applied, skipped and undone ──

function serviceHost(files, o = {}) {
  const bin = [];
  const posted = [];
  let changed = 0;
  const metas = () =>
    [...files].map(([p, f]) => ({ path: p, title: (p.split('/').pop() ?? p).replace(/\.md$/i, ''), label: '', mtime: f.mtime, props: f.props ?? {}, links: (f.text.match(/\[\[([^\]]+)\]\]/g) ?? []).map((w) => ({ target: w.slice(2, -2).split('|')[0].split('#')[0] })) }));
  const index = {
    allMeta: metas,
    content: (p) => files.get(p)?.text,
    get: (p) => metas().find((m) => m.path === p),
    resolve: (t) => {
      const norm = (s) => s.replace(/\\/g, '/').replace(/\.md$/i, '').trim().toLowerCase();
      const target = norm(t.split('#')[0]);
      for (const m of metas()) if (norm(m.path) === target) return m.path;
      const base = target.split('/').pop();
      const hits = metas().filter((m) => norm(m.title) === base);
      if (!hits.length) return null;
      return [...hits].sort((a, b) => a.path.length - b.path.length)[0].path;
    },
    resolveFile: () => null,
    isExcluded: (p) => p.startsWith('Archive/'),
    meanings: () => ({ vectors: (p) => o.vectors?.[p] ?? null }),
  };
  const host = {
    dataDir: path.join(work, `data-${Math.random().toString(36).slice(2)}`),
    index,
    library: () => path.join(work, 'vault'),
    read: (p) => files.get(p)?.text,
    write: async (p, text) => void files.set(p, { ...(files.get(p) ?? { mtime: NOW, props: {} }), text }),
    move: async (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
      return { path: to };
    },
    trash: async (p) => void (bin.push(p), files.delete(p)),
    exists: async (p) => files.has(p),
    templatesFolder: () => 'Templates',
    dailyToday: () => 'Daily/2026-11-02.md',
    post: (items) => (posted.push(...items), items.length),
    changed: () => void changed++,
    now: () => o.now ?? NOW,
    log: () => {},
    bin,
    posted,
    files,
    changedCount: () => changed,
  };
  return host;
}

const file = (text, mtime = OLD, props = {}) => ({ text, mtime, props });

function messyFiles() {
  const m = new Map();
  m.set('Notes/Shopping list.md', file('# Shopping list\n\nMilk, flour, eggs.\n', NOW - 40 * DAY));
  m.set('Notes/Shopping  list.md', file('# Shopping list\n\nMilk, flour, eggs, butter.\n', NOW - 50 * DAY));
  m.set('Notes/Trip.md', file('# Trip\n\nStaying at [[Harbour  Hotel]] for two nights.\n'));
  m.set('Stays/Harbour Hotel.md', file('# Harbour Hotel\n\nBy the water.\n'));
  m.set('Notes/Odd.md', file('# Odd\n\nSee [[No Such Note Anywhere]] for details.\n'));
  m.set('Old empty.md', file('---\ntype: note\n---\n# Old empty\n'));
  m.set('Hall quote.md', file('# Hall quote\n\nThe quote for the [[Hall Opening]] paint job.\n'));
  m.set('Projects/Hall/Hall Opening.md', file('# Hall Opening\n\nThe project.\n', OLD, { type: 'project' }));
  m.set('Notes/Rem.md', file('# Rem\n\n- [ ] Pay the plumber ⏰ 2026-09-01 09:00\n'));
  m.set('Private notes/Secret.md', file('# Secret\n\n- [ ] Secret overdue ⏰ 2026-08-01 09:00\n'));
  return m;
}

test('one proposal a week, said once in the bell', async () => {
  const host = serviceHost(messyFiles());
  const tidy = new M.WeeklyTidy(host);
  const first = await tidy.get();
  assert.ok(first && first.lines.length >= 5, 'every kind proposed');
  assert.equal(host.posted.length, 1, 'one bell notice for the proposal');
  assert.equal(host.posted[0].key, `tidy:${S.tidyWeekId(NOW)}`);
  assert.equal(host.posted[0].kind, 'tidy');
  const again = await tidy.get();
  assert.equal(again.preparedAt, first.preparedAt, 'the week has not turned: the same proposal');
  assert.equal(host.posted.length, 1, 'said once');
  const status = tidy.status();
  assert.equal(status.waiting, first.lines.length);
  assert.ok(status.ready);
  const needs = await tidy.needs();
  assert.equal(needs.length, first.lines.length);
  assert.ok(needs.every((n) => n.kind === 'tidy' && n.id.startsWith('tidy:')), 'the needs seam shape');
  tidy.stop();
});

test('each line applies and undoes', async () => {
  const host = serviceHost(messyFiles());
  const tidy = new M.WeeklyTidy(host);
  const p = await tidy.get();
  const line = (kind) => p.lines.find((l) => l.kind === kind);
  // Merge: every line of both kept, the dropped note in the Bin, both back on Undo.
  const dup = line('duplicate');
  const keepBefore = host.read(dup.action.keep);
  await tidy.apply(dup.id);
  assert.ok(host.read(dup.action.keep).includes('Merged from'), 'the merge names its source');
  assert.equal(await host.exists(dup.action.drop), false, 'the dropped note left the notes');
  assert.ok(host.bin.includes(dup.action.drop), 'to Recently deleted, never deleted for good');
  await tidy.undo(dup.id);
  assert.equal(host.read(dup.action.keep), keepBefore, 'Undo writes the kept note back');
  assert.ok((await host.exists(dup.action.drop)) && host.read(dup.action.drop).includes('butter'), 'and the dropped note back');
  // Relink.
  const relink = p.lines.find((l) => l.kind === 'broken-link' && l.action.op === 'relink');
  await tidy.apply(relink.id);
  assert.ok(host.read(relink.action.path).includes('[[Harbour Hotel]]'), 'spelt as the note is now');
  assert.ok(!host.read(relink.action.path).includes('Harbour  Hotel'), 'the broken spelling is gone');
  await tidy.undo(relink.id);
  assert.ok(host.read(relink.action.path).includes('[[Harbour  Hotel]]'), 'undone word for word');
  // Unlink.
  const unlink = p.lines.find((l) => l.kind === 'broken-link' && l.action.op === 'unlink');
  await tidy.apply(unlink.id);
  assert.ok(!host.read(unlink.action.path).includes('[['), 'the link is gone');
  assert.ok(host.read(unlink.action.path).includes('No Such Note Anywhere'), 'the words stay');
  await tidy.undo(unlink.id);
  // Bin.
  const bin = line('empty');
  await tidy.apply(bin.id);
  assert.ok(host.bin.includes(bin.action.path));
  await tidy.undo(bin.id);
  assert.ok(await host.exists(bin.action.path), 'back from the journal');
  // Move.
  const move = line('wrong-place');
  await tidy.apply(move.id);
  assert.ok(await host.exists(move.action.to), 'moved to its home');
  await tidy.undo(move.id);
  assert.ok(await host.exists(move.action.from), 'moved back');
  // Tick.
  const tick = line('stale-reminder');
  await tidy.apply(tick.id);
  assert.ok(host.read(tick.action.path).includes('- [x] Pay the plumber'), 'marked done');
  await tidy.undo(tick.id);
  assert.ok(host.read(tick.action.path).includes('- [ ] Pay the plumber'), 'open again');
  tidy.stop();
});

test('undo refuses when a note changed since, and keeps the new words', async () => {
  const host = serviceHost(messyFiles());
  const tidy = new M.WeeklyTidy(host);
  const p = await tidy.get();
  const tick = p.lines.find((l) => l.kind === 'stale-reminder');
  await tidy.apply(tick.id);
  await host.write(tick.action.path, `${host.read(tick.action.path)}\nA new line the person wrote.\n`);
  await assert.rejects(tidy.undo(tick.id), /changed since/, 'a note changed since is left as it is');
  assert.ok(host.read(tick.action.path).includes('A new line the person wrote.'), 'the new words are kept');
  const move = p.lines.find((l) => l.kind === 'wrong-place');
  await tidy.apply(move.id);
  await host.write(move.action.from, '# Hall quote\n\nRemade by the person.\n');
  await assert.rejects(tidy.undo(move.id), /changed since|already back/, 'no clobber, no silent move');
  assert.ok(host.read(move.action.from).includes('Remade by the person.'), 'the remade note stands');
  tidy.stop();
});

test('skip is quiet, apply all runs the rest, failures stay on their lines', async () => {
  const host = serviceHost(messyFiles());
  const tidy = new M.WeeklyTidy(host);
  const p = await tidy.get();
  const skip = p.lines.find((l) => l.kind === 'empty');
  await tidy.skip(skip.id);
  assert.equal((await tidy.get()).lines.find((l) => l.id === skip.id).status, 'skipped');
  // The skipped line is not proposed again this week or next.
  const forced = await tidy.prepare(true);
  assert.ok(!forced.lines.some((l) => l.key === skip.key), 'a skip is quiet 30 days');
  // A line whose note left fails on its line; the rest still apply.
  host.files.delete('Notes/Odd.md');
  const r = await tidy.applyAll();
  assert.ok(r.applied >= 1, 'the rest applied');
  assert.ok(r.failed >= 1, 'the gone note failed');
  assert.match(r.words, /Applied/, 'said in words');
  const failed = (await tidy.get()).lines.find((l) => l.paths[0] === 'Notes/Odd.md');
  assert.equal(failed.status, 'failed');
  assert.match(failed.words, /not in your notes/, 'the failure is said on the line');
  tidy.stop();
});

test('Locked notes never enter a proposal', async () => {
  const files = new Map([['Private notes/Secret.md', file('# Secret\n\n- [ ] Secret overdue ⏰ 2026-08-01 09:00\n')], ['Private notes/Secret copy.md', file('# Secret\n\n- [ ] Secret overdue ⏰ 2026-08-01 09:00\n')]]);
  const host = serviceHost(files);
  const tidy = new M.WeeklyTidy(host);
  const p = await tidy.get();
  assert.equal(p.lines.length, 0, 'a vault of only Locked notes proposes nothing');
  assert.equal(host.posted.length, 0, 'and says nothing');
  tidy.stop();
});

test('the service proposes meaning duplicates from the index vectors, applied and undone as one merge', async () => {
  const files = new Map([
    ['Notes/Hall notes.md', file(longBody('Hall notes'), NOW - 40 * DAY)],
    ['Notes/Hall jottings.md', file(longBody('Hall jottings', 'Tea after.\n'), NOW - 30 * DAY)],
  ]);
  const host = serviceHost(files, { vectors: { 'Notes/Hall notes.md': vec384(1, 0), 'Notes/Hall jottings.md': vec384(0.92, Math.sqrt(1 - 0.92 ** 2)) } });
  const tidy = new M.WeeklyTidy(host);
  const p = await tidy.get();
  assert.equal(p.lines.length, 1, 'the meaning pair only');
  assert.match(p.lines[0].detail, /They say nearly the same thing\./);
  await tidy.apply(p.lines[0].id);
  assert.ok(host.read('Notes/Hall jottings.md').includes('Merged from'), 'merges like any duplicate line');
  assert.equal(await host.exists('Notes/Hall notes.md'), false);
  await tidy.undo(p.lines[0].id);
  assert.ok(await host.exists('Notes/Hall notes.md'), 'and undoes like one');
  tidy.stop();
});

test('thin notes are proposed for the Bin, applied and undone; notes holding more are not (b6 break job)', async () => {
  const notes = [
    note('Notes/Old stub.md', 'Old stub', '# Old stub\n\nCall the mill back.\n', OLD),
    note('Notes/Mill number.md', 'Mill number', '# Mill number\n\nCall them on 03 456 7890.\n', OLD),
    note('Notes/Only a task.md', 'Only a task', '# Only a task\n\n- [ ] Call the mill back\n', OLD),
    note('Notes/Lake photo.md', 'Lake photo', '# Lake photo\n\n![[lake.jpg]]\n\nWakatipu at dawn.\n', OLD),
    note('Notes/Fresh stub.md', 'Fresh stub', '# Fresh stub\n\nJust started.\n', FRESH),
  ];
  const items = S.planWeeklyTidy(ctx(notes));
  const thin = items.filter((i) => i.kind === 'thin');
  assert.deepEqual(thin.map((i) => i.paths[0]).sort(), ['Notes/Mill number.md', 'Notes/Old stub.md'], 'settled words-only stubs are proposed; a task, a file or freshness keeps a note out');
  assert.equal(thin[0].action.op, 'bin', 'the Bin, like an empty note');
  assert.match(thin[0].title, /almost empty/, 'said plainly');
  const files = new Map([
    ['Notes/Old stub.md', file('# Old stub\n\nCall the mill back.\n', OLD)],
    ['Notes/Only a task.md', file('# Only a task\n\n- [ ] Call the mill back\n', OLD)],
  ]);
  const host = serviceHost(files);
  const tidy = new M.WeeklyTidy(host);
  const p = await tidy.get();
  const line = p.lines.find((l) => l.kind === 'thin');
  assert.equal(line.paths[0], 'Notes/Old stub.md', 'the service proposes it');
  await tidy.apply(line.id);
  assert.equal(await host.exists('Notes/Old stub.md'), false, 'applied: to the Bin');
  assert.ok(host.bin.includes('Notes/Old stub.md'), 'never deleted for good');
  await tidy.undo(line.id);
  assert.equal(host.read('Notes/Old stub.md'), '# Old stub\n\nCall the mill back.\n', 'undone word for word');
  tidy.stop();
});

test('the seam the host app reads: tidy_list to look, tidy_apply to change', () => {
  const names = (c) => V.catalogueFor(c).map((t) => t.name);
  assert.ok(names('spark').includes('vault_tidy_list'), 'the host app looks with vault_tidy_list');
  assert.ok(names('spark').includes('neuralvault_tidy_apply'), 'the host app changes with neuralvault_tidy_apply');
  assert.ok(names('side').includes('tidy_list') && names('side').includes('tidy_apply'), 'the side chat keeps the catalogue names');
  assert.ok(names('mcp').includes('tidy_list') && names('mcp').includes('tidy_apply'), 'outside agents too');
  const spark = V.catalogueFor('spark');
  const list = spark.find((t) => t.tool === 'tidy_list');
  assert.equal(list.family, 'neuralvault_more');
  assert.match(list.description, /tidy_apply/, 'each consumer’s words name its own tools');
  assert.match(spark.find((t) => t.tool === 'tidy_apply').description, /to the Bin/, 'the promise travels with the tool');
  const def = A.AGENT_TOOLS.find((t) => t.name === 'tidy_apply');
  assert.equal(def.level, 'edit');
  assert.ok(!def.deletes, 'a Bin move is not a delete: the person’s approval rules for edits apply');
  assert.match(A.AGENT_TOOLS.find((t) => t.name === 'tidy_list').description, /thin notes/, 'the list names thin notes');
  assert.match(def.description, /thin note/, 'applying one is said too');
});
