// node --test tests/notice-bell.test.mjs — the bell both apps share (3 Nov 2026 notifications fix): one list and one
// count (Ironleaf's reminders, finance, documents and tidy mirrored to the former host app's bell, its copies left
// out here), the modules' notices mirrored, the day's due-tasks line kept in both bells, old notices expired, and
// the panel opening under the bell (it opened above it, off the window, from when the bell sat at the foot). Made-up
// notes in memory; a fixed clock. The former host app's half (wording, counts, click targets) is proved in its own
// tests.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-notice-bell-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/reminders.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\nexport { mergeNotices, cleanNotices, MIRRORED_KINDS } from ${JSON.stringify(path.join(root, 'src/shared/notices.ts'))};\nexport { bellPanelPlace } from ${JSON.stringify(path.join(root, 'src/shared/bell-place.ts'))};\nexport { DueToday, dueTodayTasks } from ${JSON.stringify(path.join(root, 'src/main/due-today.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'svc.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'svc.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const at = (d, h = 9, m = 0) => new Date(2026, 10, d, h, m).getTime();
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

function setup(notes, dataDir = mkdtempSync(path.join(work, 'data-'))) {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(notes));
  for (const [rel, text] of files) index.set(rel, text, 0, text.length);
  const clock = { now: at(3, 9, 0) };
  const shown = [];
  const mirrored = [];
  let changed = 0;
  const host = {
    dataDir, index, library: () => '/notes', read: (rel) => files.get(rel),
    write: async (rel, text) => { files.set(rel, text); index.set(rel, text, 0, text.length); },
    templatesFolder: () => 'Templates', show: (n) => shown.push(n), changed: () => changed++,
    mirror: (n) => mirrored.push(n), now: () => clock.now,
  };
  return { svc: new M.Reminders(host), host, files, clock, shown, mirrored, dataDir };
}

test('the two bells count as one: every mirrored kind leaves its host copy out, newest first', () => {
  assert.deepEqual([...M.MIRRORED_KINDS].sort(), ['documents', 'finance', 'reminder', 'tidy']);
  const own = [
    { id: 'own1', at: 3000, kind: 'reminder', title: 'Order flour', body: '9:00 am', sessionId: '', read: false, note: 'Shop.md', line: 1, reminder: 'Shop.md\nOrder flour\n1', due: 1 },
    { id: 'own2', at: 1000, kind: 'finance', title: 'Power bill due Friday', body: '$120', sessionId: '', read: true, note: 'Money.md', line: 0 },
  ];
  const host = {
    items: [
      { id: 'host1', at: 4000, kind: 'done', title: 'Task finished', body: 'Fix it', sessionId: 'a', read: false },
      { id: 'copy1', at: 3500, kind: 'reminder', title: 'Order flour', body: '9:00 am', sessionId: '', read: false, note: 'Shop.md', line: 1 },
      { id: 'copy2', at: 2500, kind: 'finance', title: 'Power bill due Friday', body: '$120', sessionId: '', read: false, note: 'Money.md', line: 0 },
      { id: 'copy3', at: 2000, kind: 'tidy', title: 'The weekly tidy is ready', body: '3 small fixes', sessionId: '', read: false },
      { id: 'copy4', at: 1500, kind: 'documents', title: 'Licence expires soon', body: 'Car', sessionId: '', read: false },
    ],
    unread: 5,
  };
  const merged = M.mergeNotices(own, host);
  assert.deepEqual(merged.items.map((i) => i.id), ['host1', 'own1', 'own2'], 'host copies of mirrored kinds stay out; the rest newest first');
  assert.equal(merged.unread, 2, 'one unread here, one there');
  const alone = M.mergeNotices(own, null);
  assert.deepEqual(alone.items.map((i) => i.id), ['own1', 'own2'], 'on its own the bell still shows its own');
});

test('the modules notices are mirrored, said once, and old ones expire', async () => {
  const s = setup({ 'Money.md': '# Money\n' });
  const said = s.svc.post([
    { key: 'bill:Money.md:2026-11-06', kind: 'finance', title: 'Power bill due Friday', body: '$120 · autopay', path: 'Money.md' },
    { key: 'tidy:2026-W45', kind: 'tidy', title: 'The weekly tidy is ready', body: '3 small fixes wait for a look.', path: 'Tasks.md' },
  ]);
  assert.equal(said, 2);
  assert.deepEqual(s.mirrored.map((m) => m.kind), ['finance', 'tidy'], 'each mirrored for the host app’s bell');
  assert.equal(s.shown.length, 2, 'and told on screen');
  assert.deepEqual(s.svc.notices().map((n) => n.kind), ['tidy', 'finance'], 'newest first in this bell');
  assert.equal(s.svc.post([{ key: 'bill:Money.md:2026-11-06', kind: 'finance', title: 'Power bill due Friday', body: '$120 · autopay', path: 'Money.md' }]), 0, 'said once: the same key never says again');
  s.clock.now += 8 * 86400000;
  assert.deepEqual(s.svc.notices(), [], 'a week old is expired');
});

test('the day’s due-tasks line is kept in both bells, said once', async () => {
  const tasks = [
    { words: 'File the BAS', projectName: 'Shop', title: 'Tasks', done: false, reminder: false, due: '2026-11-03', path: 'Tasks.md', line: 2 },
    { words: 'Ring the bank', projectName: '', title: 'Tasks', done: false, reminder: false, due: '2026-11-03', path: 'Tasks.md', line: 3 },
  ];
  const added = [];
  const kept = [];
  const file = path.join(mkdtempSync(path.join(work, 'due-')), 'due-today.json');
  const day = new M.DueToday({ tasks: () => ({ today: '2026-11-03', tasks }), add: (n) => void added.push(n), keep: (n) => void kept.push(n), file, now: () => at(3, 9, 30) });
  assert.equal(await day.check(), true, 'it said it');
  assert.equal(added.length, 1, 'to the host app’s bell');
  assert.equal(kept.length, 1, 'and kept in this bell');
  assert.equal(kept[0].title, added[0].title, 'the same line both sides');
  assert.equal(await day.check(), false, 'never twice in a day');
  assert.deepEqual(M.dueTodayTasks({ today: '2026-11-03', tasks: [...tasks, { ...tasks[0], done: true }] }).map((t) => t.words), ['File the BAS', 'Ring the bank'], 'done ones stay out');
});

test('kept notices stay quiet: no notification, no mirror', () => {
  const s = setup({ 'Tasks.md': '# Tasks\n' });
  const kept = s.svc.keep({ kind: 'reminder', title: 'Due today: 2 tasks', body: 'File the BAS · Ring the bank', note: 'Tasks.md', line: 2 });
  assert.equal(s.svc.notices()[0].id, kept.id, 'in this bell');
  assert.deepEqual(s.shown, [], 'no Windows notification');
  assert.deepEqual(s.mirrored, [], 'no mirror (the host’s copy is the mirror)');
  assert.equal(s.svc.notices()[0].read, false, 'unread, counting');
});

test('the panel opens under the bell, inside the window, at both sizes', () => {
  for (const viewport of [{ width: 1219, height: 709 }, { width: 1600, height: 1000 }]) {
    // The header bell (top right, beside search): under it, inside the window.
    const bell = { left: viewport.width - 260, top: 12, bottom: 42 };
    const at = M.bellPanelPlace(bell, viewport);
    assert.equal(at.top, 50, `${viewport.width}x${viewport.height}: under the bell`);
    assert.ok(at.left >= 8 && at.left + 360 <= viewport.width - 8, 'inside left to right');
    assert.ok(at.top + 200 <= viewport.height - 8, 'with room to read');
    // At the right edge it draws back inside rather than running off.
    const edge = M.bellPanelPlace({ left: viewport.width - 40, top: 12, bottom: 42 }, viewport);
    assert.equal(edge.left, viewport.width - 368, 'clamped off the edge');
  }
  // A bell at the foot still opens above it, as it always did.
  const foot = M.bellPanelPlace({ left: 40, top: 640, bottom: 670 }, { width: 1219, height: 709 });
  assert.deepEqual(foot, { left: 40, bottom: 709 - 640 + 8 }, 'above a foot bell');
});

test('the badge is navy as the host app, rows quiet slate: never the picked accent', () => {
  const css = read('src/renderer/src/styles.css');
  const bell = css.match(/\.places-bell-count \{([^}]*)\}/s)?.[1] ?? assert.fail('no .places-bell-count');
  assert.ok(bell.includes('background: var(--primary)'), 'the count sits on navy, as the host app (shell parity, 4 Nov 2026)');
  assert.ok(!bell.includes('var(--accent)') && !bell.includes('var(--accent);'), 'never the picked accent');
  const dot = css.match(/\.notice-dot \{([^}]*)\}/s)?.[1] ?? assert.fail('no .notice-dot');
  assert.ok(dot.includes('background: var(--coral)'), 'the unread dot is coral too');
  const icon = css.match(/\.notice-icon \{([^}]*)\}/s)?.[1] ?? assert.fail('no .notice-icon');
  assert.ok(icon.includes('var(--slate-bg)') && icon.includes('var(--slate-tx)'), 'row icons are quiet slate');
  const rem = read('src/renderer/src/styles/reminders.css');
  const ricon = rem.match(/\.notice\.is-reminder \.notice-icon \{([^}]*)\}/s)?.[1] ?? assert.fail('no reminder icon rule');
  assert.ok(!/var\(--accent/.test(ricon), 'a reminder’s icon never wears the picked accent either');
});

test('the host wiring: no notification while reading, both bells read together', () => {
  const app = read('src/main/app.ts');
  assert.ok(/if \(win && !win\.isDestroyed\(\) && win\.isFocused\(\)\) return;/.test(app), 'a reminder due while the window is in front stays in the bell');
  assert.ok(/keep: \(n\) => reminders\.keep\(n\)/.test(app), 'the due-tasks line is kept in this bell too');
  assert.ok(/const own = one \? reminders\.get\(one\) : undefined;/.test(app) && /if \(own\) readHostCopies\(own\);/.test(app), 'reading one here reads its copies there');
  assert.ok(/for \(const n of reminders\.notices\(\)\) if \(n\.reminder === key\) readHostCopies\(n\);/.test(app), 'ticking or snoozing does too');
  assert.ok(/host\.notices\?\.onChange\(\(\) => \{ try \{ readOwnCopies\(\); send\('notices:changed', noticesView\(\)\); \} catch/.test(app), 'reading there reads ours here');
});

test('the panel lists every notice the same way, newest first, with Mark all read and an empty state', () => {
  const bell = read('src/renderer/src/panels/NoticeBell.tsx');
  assert.ok(bell.includes('role="dialog" aria-label="Notices"'), 'a labelled dialog');
  assert.ok(bell.includes('>Mark all read<'), 'Mark all read');
  assert.ok(bell.includes("title=\"Nothing waiting\""), 'an empty state');
  assert.ok(bell.includes('bellPanelPlace(r, { width: window.innerWidth, height: window.innerHeight })'), 'placed under the bell by the one helper');
});
