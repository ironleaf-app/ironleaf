// node --test tests/weekly-tidy-whole.test.mjs — the weekly tidy finished whole (2 Nov 2026, 10.0 plan item
// 21; src/shared/weekly-tidy.ts, src/main/weekly-tidy.ts, the tab, the weekly review row, Settings). Each of the six fix
// actions has its own button in the same words from every door; the review row and Settings name what waits, by kind
// (8 Nov 2026, calm list: the tidy left Today for the review, on purpose);
// every fix stays a proposal with Undo; drops and empties reach Recently deleted, never a hard delete; and a restart
// mid-tidy keeps the proposal, its journals and its skips. Fails without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-weekly-whole-'));
let S, M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (f) => JSON.stringify(path.join(root, f));
  writeFileSync(entry, [`export * as S from ${src('src/shared/weekly-tidy.ts')};`, `export * as M from ${src('src/main/weekly-tidy.ts')};`].join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'whole.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ S, M } = await import(pathToFileURL(path.join(work, 'whole.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const read = (p) => readFileSync(path.join(root, p), 'utf8');

// Monday 2 Nov 2026, 9:00 am local.
const NOW = new Date(2026, 10, 2, 9, 0).getTime();
const DAY = 86_400_000;
const OLD = NOW - 60 * DAY;

test('each fix kind has its one button, in plain words', () => {
  assert.equal(S.tidyApplyWords({ op: 'merge', keep: 'a', drop: 'b' }), 'Merge');
  assert.equal(S.tidyApplyWords({ op: 'relink', path: 'n', from: 'Old', to: 'Stays/Harbour Hotel.md' }), 'Point at Harbour Hotel');
  assert.equal(S.tidyApplyWords({ op: 'unlink', path: 'n', target: 'Old' }), 'Remove link');
  assert.equal(S.tidyApplyWords({ op: 'bin', path: 'n' }), 'Move to the Bin');
  assert.equal(S.tidyApplyWords({ op: 'move', from: 'a', to: 'b' }), 'Move');
  assert.equal(S.tidyApplyWords({ op: 'tick', path: 'n', line: 0, text: 't', due: 1 }), 'Mark done');
});

test('waiting lines are said by kind, most useful first, singular and plural', () => {
  assert.equal(S.tidyKindCountWords({ duplicate: 2, 'broken-link': 1 }), '2 duplicates, 1 broken link');
  assert.equal(S.tidyKindCountWords({ 'stale-reminder': 1, empty: 1, duplicate: 1 }), '1 duplicate, 1 empty note, 1 stale reminder');
  assert.equal(S.tidyKindCountWords({ 'wrong-place': 2, 'broken-link': 0 }), '2 misplaced notes');
  assert.equal(S.tidyKindCountWords({ thin: 2 }), '2 thin notes');
  assert.equal(S.tidyKindCountWords({ empty: 1, thin: 1 }), '1 empty note, 1 thin note');
  assert.equal(S.tidyKindCountWords({}), '');
  const tab = read('src/renderer/src/views/WeeklyTidyView.tsx');
  assert.ok(tab.includes("thin: 'Thin notes'"), 'the tab heads thin notes');
  assert.ok(tab.includes('thin notes'), 'the tab’s all-tidy line counts them too');
});

test('the new words carry no em dashes, no engine names and no dollars', () => {
  const words = [
    S.tidyApplyWords({ op: 'merge', keep: 'a', drop: 'b' }),
    S.tidyApplyWords({ op: 'relink', path: 'n', from: 'Old', to: 'Stays/Harbour Hotel.md' }),
    S.tidyApplyWords({ op: 'unlink', path: 'n', target: 'Old' }),
    S.tidyApplyWords({ op: 'bin', path: 'n' }),
    S.tidyApplyWords({ op: 'move', from: 'a', to: 'b' }),
    S.tidyApplyWords({ op: 'tick', path: 'n', line: 0, text: 't', due: 1 }),
    S.tidyKindCountWords({ duplicate: 2, 'broken-link': 1, empty: 1, 'wrong-place': 1, 'stale-reminder': 1 }),
    S.tidyKindCountWords({ thin: 1 }),
  ].join('\n');
  assert.ok(!words.includes('—'), 'no em dashes in the shared words');
  assert.ok(!/deepseek|\bDSH\b|pi-ai/i.test(words), 'no engine names');
  assert.ok(!words.includes('$'), 'no dollars');
  // The added UI lines say the same promise the same way.
  const settings = read('src/renderer/src/components/Settings.tsx');
  const rows = settings.slice(settings.indexOf('function WeeklyTidyRows('), settings.indexOf('\n}\n', settings.indexOf('function WeeklyTidyRows(')));
  const review = read('src/renderer/src/views/WeeklyReview.tsx');
  const row = review.slice(review.indexOf('const tidyWaitingWords'), review.indexOf('</button>', review.indexOf('const tidyWaitingWords')) + 9);
  for (const [name, body] of [['Settings home', rows], ['Review row', row]]) {
    assert.ok(!body.includes('—'), `${name}: no em dashes`);
    assert.ok(!/deepseek|\bDSH\b|pi-ai/i.test(body), `${name}: no engine names`);
    assert.ok(!/\$\d/.test(body) && !/dollar/i.test(body), `${name}: no dollars`);
  }
});

test('the tab, the review row and Settings read the shared words (one button, one line, one home)', () => {
  const tab = read('src/renderer/src/views/WeeklyTidyView.tsx');
  assert.ok(tab.includes("tidyApplyWords(l.action)"), 'each line’s button comes from the shared helper');
  assert.ok(!tab.includes(": 'Apply'"), 'no generic per-line Apply left (Apply all stays)');
  // The tidy left Today for the weekly review on purpose (8 Nov 2026, calm list: not for today).
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(!today.includes('The weekly tidy is ready'), 'Today no longer nags about the tidy');
  assert.ok(!today.includes('tidyKindCountWords(weeklyTidy'), 'Today says nothing of what waits');
  const review = read('src/renderer/src/views/WeeklyReview.tsx');
  assert.ok(review.includes('The weekly tidy is ready'), 'the review row names the tidy');
  assert.ok(review.includes('tidyKindCountWords(weeklyTidy.byKind)'), 'the row says what waits, by kind');
  assert.ok(review.includes('ready to tidy'), 'the review keeps the projects line too');
  assert.ok(review.includes('A.openTidy()'), 'the review opens the full list');
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes("'weekly-tidy'") && commands.includes('Open the weekly tidy'), 'Ctrl+K opens the tidy');
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes('<WeeklyTidyRows />'), 'General, Notes and files holds the home');
  assert.ok(settings.includes('title="Weekly tidy"'), 'the home is a findable row');
  assert.ok(settings.includes('A.openTidy()'), 'the home opens the full list');
  assert.ok(settings.includes('tidyKindCountWords(status.byKind)'), 'the home says what waits, by kind');
  assert.ok(read('src/renderer/src/lib/settingsSearch.ts').includes("title: 'Weekly tidy'"), 'settings search finds the home');
});

// ── The service: per-kind standing, the Bin-or-merge rule, a restart mid-tidy ──

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
  return m;
}

function serviceHost(files, dataDir) {
  const bin = [];
  const posted = [];
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
    isExcluded: () => false,
    meanings: () => ({ vectors: () => null }),
  };
  return {
    dataDir,
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
    changed: () => {},
    now: () => NOW,
    log: () => {},
    bin,
    posted,
    files,
  };
}

test('the standing names what waits, per kind, and adds up', async () => {
  const host = serviceHost(messyFiles(), path.join(work, `data-${Math.random().toString(36).slice(2)}`));
  const tidy = new M.WeeklyTidy(host);
  const p = await tidy.get();
  const s = tidy.status();
  assert.deepEqual(Object.keys(s.byKind).sort(), ['broken-link', 'duplicate', 'empty', 'stale-reminder', 'thin', 'wrong-place'], 'thin notes stand beside the other kinds (b6 break job: the tidy answers the vault check quiet list)');
  for (const kind of Object.keys(s.byKind)) assert.equal(s.byKind[kind], p.lines.filter((l) => l.kind === kind && l.status === 'waiting').length, `${kind} counts its waiting lines`);
  assert.equal(Object.values(s.byKind).reduce((a, b) => a + b, 0), s.waiting, 'the kinds add up to waiting');
  assert.ok(s.byKind.duplicate >= 1 && s.byKind['broken-link'] >= 1 && s.byKind.empty === 1 && s.byKind['wrong-place'] === 1 && s.byKind['stale-reminder'] === 1 && s.byKind.thin >= 1, 'every kind stands in the messy vault');
  tidy.stop();
});

test('drops and empties reach the Bin, and the service has no hard delete', async () => {
  const host = serviceHost(messyFiles(), path.join(work, `data-${Math.random().toString(36).slice(2)}`));
  const tidy = new M.WeeklyTidy(host);
  const p = await tidy.get();
  const dup = p.lines.find((l) => l.kind === 'duplicate');
  const merged = await tidy.apply(dup.id);
  assert.ok(host.bin.includes(dup.action.drop), 'the merged-away note is in Recently deleted');
  assert.match(merged.words, /in the Bin/, 'said so');
  const bin = p.lines.find((l) => l.kind === 'empty');
  const binned = await tidy.apply(bin.id);
  assert.ok(host.bin.includes(bin.action.path), 'the emptied note is in Recently deleted');
  assert.match(binned.words, /in the Bin/, 'said so');
  // Every fix undoes from its journal.
  await tidy.undo(dup.id);
  await tidy.undo(bin.id);
  assert.ok(await host.exists(dup.action.drop) && (await host.exists(bin.action.path)), 'both back after Undo');
  const service = read('src/main/weekly-tidy.ts');
  assert.ok(service.includes('trash(a.drop)') && service.includes('trash(a.path)'), 'merges and empties go through trash()');
  for (const call of ['unlink(', 'unlinkSync', 'rmSync', 'rmdir', '.rm(']) assert.ok(!service.includes(call), `no hard delete: ${call}`);
  tidy.stop();
});

test('a restart mid-tidy keeps the proposal, its journals and its skips', async () => {
  const files = messyFiles();
  const dataDir = path.join(work, `data-${Math.random().toString(36).slice(2)}`);
  const first = serviceHost(files, dataDir);
  const before = new M.WeeklyTidy(first);
  const p = await before.get();
  const dup = p.lines.find((l) => l.kind === 'duplicate');
  const bin = p.lines.find((l) => l.kind === 'empty');
  const tick = p.lines.find((l) => l.kind === 'stale-reminder');
  const keepBefore = first.read(dup.action.keep);
  await before.apply(dup.id);
  await before.skip(bin.id);
  before.stop();

  // The app shuts and opens again: a new service over the same kept data and the same notes.
  const second = serviceHost(files, dataDir);
  const afterRestart = new M.WeeklyTidy(second);
  const q = await afterRestart.get();
  assert.equal(q.preparedAt, p.preparedAt, 'the week has not turned: the same proposal, not a fresh pass');
  assert.deepEqual(q.lines.map((l) => l.id), p.lines.map((l) => l.id), 'the same lines in the same order');
  assert.equal(q.lines.find((l) => l.id === dup.id).status, 'applied', 'the applied line stayed applied');
  assert.equal(q.lines.find((l) => l.id === bin.id).status, 'skipped', 'the skipped line stayed skipped');
  assert.equal(q.lines.find((l) => l.id === tick.id).status, 'waiting', 'the waiting line still waits');
  assert.equal(second.posted.length, 0, 'the bell is not told twice');
  // Journals made it across: Undo still brings the applied line back, word for word.
  await afterRestart.undo(dup.id);
  assert.equal(second.read(dup.action.keep), keepBefore, 'the kept note is back as it was');
  assert.ok(await second.exists(dup.action.drop), 'and the dropped note is back from the journal');
  // And the waiting lines still apply.
  await afterRestart.apply(tick.id);
  assert.ok(second.read(tick.action.path).includes('- [x] Pay the plumber'), 'a waiting line still applies after the restart');
  const s = afterRestart.status();
  assert.equal(s.waiting, q.lines.filter((l) => l.status === 'waiting').length, 'the standing still adds up');
  afterRestart.stop();
});
