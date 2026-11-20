// node --test tests/reminders-service.test.mjs — reminders on the main side (src/main/reminders.ts; 19 Oct 2026, approved
// them): read from the index (never the disk), said once with a notification and a notice for the bell, said as missed
// after the PC slept, never twice after a restart, repeating ones moved on in the note, ticked and snoozed from Today or
// the bell (a repeating one snoozed gets a one-off line below it). Made-up notes in memory; a fixed clock.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-reminders-svc-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/reminders.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\nexport { mergeNotices } from ${JSON.stringify(path.join(root, 'src/shared/notices.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'svc.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'svc.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const at = (d, h = 9, m = 0) => new Date(2026, 9, d, h, m).getTime();

function setup(notes, dataDir = mkdtempSync(path.join(work, 'data-'))) {
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(notes));
  for (const [rel, text] of files) index.set(rel, text, 0, text.length);
  const clock = { now: at(19, 10, 30) };
  const shown = [];
  const mirrored = [];
  const logs = [];
  let changed = 0;
  const host = {
    dataDir,
    index,
    library: () => '/notes',
    read: (rel) => files.get(rel),
    write: async (rel, text) => {
      files.set(rel, text);
      index.set(rel, text, 0, text.length);
    },
    templatesFolder: () => 'Templates',
    show: (n) => shown.push(n),
    changed: () => changed++,
    mirror: (n) => mirrored.push(n),
    now: () => clock.now,
    log: (m) => logs.push(String(m)),
  };
  return { svc: new M.Reminders(host), host, files, clock, shown, mirrored, logs, dataDir, changes: () => changed };
}

test('said once when due: a notification that opens the line, a notice with Done and Snooze, mirrored for the host app', async () => {
  const s = setup({ 'Shop.md': '# Shop\n\n- [ ] Order 20 bags of flour from Laucke ⏰ 2026-10-19 10:31\n- [ ] Later ⏰ 2026-10-23\n', 'Templates/Weekly.md': '- [ ] Template ⏰ 2026-10-19 10:31\n' });
  await s.svc.check(); // the first check ever: nothing said
  assert.equal(s.shown.length, 0);
  s.clock.now = at(19, 10, 31) + 5000;
  await s.svc.check();
  assert.deepEqual(s.shown, [{ title: 'Reminder: Order 20 bags of flour from Laucke', body: '10:31 am · Shop', path: 'Shop.md', line: 2 }]);
  const [n] = s.svc.notices();
  assert.equal(n.kind, 'reminder');
  assert.equal(n.title, 'Order 20 bags of flour from Laucke');
  assert.equal(n.note, 'Shop.md');
  assert.equal(n.line, 2);
  assert.equal(s.mirrored.length, 1);
  assert.equal(s.mirrored[0].missed, false);
  await s.svc.check();
  assert.equal(s.shown.length, 1, 'never twice');
  // Today's card.
  const v = s.svc.view();
  assert.deepEqual(v.overdue.map((i) => i.text), ['Order 20 bags of flour from Laucke']);
  assert.deepEqual(v.upcoming.map((i) => i.text), ['Later']);
  // The bell: Ironleaf's own with the former host app's, its copies of reminders left out.
  const merged = M.mergeNotices(s.svc.notices(), { items: [{ id: 'ns1', at: 1, kind: 'done', title: 'Answer ready', body: 'x', sessionId: 'a', read: false }, { id: 'ns2', at: 2, kind: 'reminder', title: 'copy', body: '', sessionId: '', read: false }], unread: 2 });
  assert.deepEqual(merged.items.map((i) => i.id), [n.id, 'ns1']);
  assert.equal(merged.items[0].reminder, n.reminder);
});

test('a restart never says one again; after the PC slept, those due meanwhile come once, as missed', async () => {
  const notes = { 'R.md': '- [ ] Ring the bank ⏰ 2026-10-19 11:00\n- [ ] Pay rent ⏰ 2026-10-19 12:00\n' };
  const a = setup(notes);
  await a.svc.check();
  a.clock.now = at(19, 11, 0) + 1000;
  await a.svc.check();
  assert.equal(a.shown.length, 1);
  // Ironleaf restarted (the same data), and the PC slept from 11:01 to 3 pm.
  const b = setup(notes, a.dataDir);
  b.clock.now = at(19, 15);
  await b.svc.check();
  assert.deepEqual(b.shown.map((x) => [x.title, x.body]), [['Reminder: Pay rent', 'Missed: it was due Monday 19 October at 12:00 pm.']]);
});

test('a repeating reminder moves on when said; ticked, it moves on too', async () => {
  const s = setup({ 'Home.md': '- [ ] Bins out ⏰ 2026-10-19 18:00 every Monday\n- [x] Water plants ⏰ 2026-10-19 08:00 every day\n' });
  await s.svc.check(); // ticked repeating: moved on at once
  assert.equal(s.files.get('Home.md'), '- [ ] Bins out ⏰ 2026-10-19 18:00 every Monday\n- [ ] Water plants ⏰ 2026-10-20 08:00 every day\n');
  s.clock.now = at(19, 18) + 1000;
  await s.svc.check();
  assert.equal(s.shown.length, 1);
  assert.equal(s.files.get('Home.md').split('\n')[0], '- [ ] Bins out ⏰ 2026-10-26 18:00 every Monday');
  // Done from its notice afterwards: already moved on, nothing more to change.
  const [n] = s.svc.notices();
  assert.equal(await s.svc.done(n.reminder), 'Done. Next: Monday 26 October at 6:00 pm.');
  assert.equal(s.files.get('Home.md').split('\n')[0], '- [ ] Bins out ⏰ 2026-10-26 18:00 every Monday');
  assert.equal(s.svc.notices()[0].read, true);
});

test('done and snooze from Today or the bell, written in the note', async () => {
  const s = setup({ 'Shop.md': '# Shop\r\n- [ ] Flour ⏰ 2026-10-19 09:00\r\n- [ ] Bins ⏰ 2026-10-19 09:30 every Monday\r\n' });
  const [flour, bins] = s.svc.items();
  assert.equal(await s.svc.snooze(flour.key, at(19, 10, 40)), 'Snoozed until Monday 19 October at 10:40 am.');
  assert.equal(s.files.get('Shop.md'), '# Shop\r\n- [ ] Flour ⏰ 2026-10-19 10:40\r\n- [ ] Bins ⏰ 2026-10-19 09:30 every Monday\r\n', 'line endings kept');
  // A repeating one snoozed keeps its own times: a one-off line below it.
  await s.svc.snooze(bins.key, at(20, 9));
  assert.equal(s.files.get('Shop.md').split('\r\n')[3], '- [ ] Bins ⏰ 2026-10-20 09:00');
  const moved = s.svc.items().find((i) => i.text === 'Flour');
  assert.equal(await s.svc.done(moved.key), 'Done.');
  assert.equal(s.files.get('Shop.md').split('\r\n')[1], '- [x] Flour ⏰ 2026-10-19 10:40');
  await assert.rejects(s.svc.snooze(bins.key, at(19, 9)), /still to come/);
  await assert.rejects(s.svc.done('Gone.md\nNothing\n1'), /isn’t in your notes/);
});

test('done and snooze find the reminder however it was retyped (9.5 O2)', async () => {
  const s = setup({ 'Shop.md': '- [ ] Call Mum ⏰ 2026-10-19 09:00\n' });
  const [mum] = s.svc.items();
  // Retyped with other capitals and punctuation only: still found, not "gone".
  await s.host.write('Shop.md', '- [ ] call—mum! ⏰ 2026-10-19 09:00\n');
  assert.equal(await s.svc.snooze(mum.key, at(19, 10, 40)), 'Snoozed until Monday 19 October at 10:40 am.');
  assert.equal(s.files.get('Shop.md'), '- [ ] call—mum! ⏰ 2026-10-19 10:40\n', 'her own words kept');
  const [snoozed] = s.svc.items();
  assert.equal(await s.svc.done(snoozed.key), 'Done.');
});

test('done and snooze say plainly when the reminder is gone, never success (9.5 O2)', async () => {
  const g = setup({ 'Shop.md': '- [ ] Flour ⏰ 2026-10-19 09:00\n' });
  const [flour] = g.svc.items();
  g.files.set('Shop.md', '# Shop\n'); // the file changed; the index still holds the old line
  await assert.rejects(g.svc.done(flour.key), /isn’t in your notes/);
  await assert.rejects(g.svc.snooze(flour.key, at(19, 10, 40)), /isn’t in your notes/);
  assert.equal(g.files.get('Shop.md'), '# Shop\n', 'nothing written');
});

test('a repeating reminder whose move fails is logged and moved on at the next check, said once (9.5 O2)', async () => {
  const s = setup({ 'Home.md': '- [ ] Bins out ⏰ 2026-10-19 18:00 every Monday\n' });
  await s.svc.check(); // the first check ever: nothing said
  s.clock.now = at(19, 18) + 1000;
  const realWrite = s.host.write;
  let failed = false;
  s.host.write = async (rel, text) => {
    if (rel === 'Home.md' && !failed) {
      failed = true;
      throw new Error('locked by another program');
    }
    return realWrite(rel, text);
  };
  await s.svc.check(); // fires, but the move fails
  assert.equal(s.shown.length, 1, 'said once');
  assert.equal(s.files.get('Home.md'), '- [ ] Bins out ⏰ 2026-10-19 18:00 every Monday\n', 'not moved on yet');
  assert.ok(s.logs.some((m) => /try again/.test(m)), 'the failure is logged, with that it will be tried again');
  s.clock.now += 30_000;
  await s.svc.check(); // tried again: moved on, never said twice
  assert.equal(s.shown.length, 1, 'never said twice');
  assert.equal(s.files.get('Home.md'), '- [ ] Bins out ⏰ 2026-10-26 18:00 every Monday\n', 'moved on at the next check');
});

test('a one-off done by mistake is unticked (Today’s Undo); a repeating one has moved on', async () => {
  const s = setup({ 'Shop.md': '- [ ] Flour ⏰ 2026-10-19 09:00\n- [ ] Bins ⏰ 2026-10-19 09:30 every Monday\n' });
  const [flour, bins] = s.svc.items();
  assert.equal(await s.svc.done(flour.key), 'Done.');
  assert.equal(s.files.get('Shop.md').split('\n')[0], '- [x] Flour ⏰ 2026-10-19 09:00');
  assert.equal(await s.svc.untick(flour.key), 'Not done.');
  assert.equal(s.files.get('Shop.md').split('\n')[0], '- [ ] Flour ⏰ 2026-10-19 09:00', 'open again, at the same time');
  // A repeating one ticked has already moved on: nothing to put back.
  await s.svc.done(bins.key);
  await assert.rejects(s.svc.untick(bins.key), /moved on/);
  await assert.rejects(s.svc.untick('Gone.md\nNothing\n1'), /isn’t in your notes/);
});

test('ticking or snoozing what left its note says so, never Done (9.5 fourth pass)', async () => {
  const s = setup({ 'Shop.md': '# Shop\n\n- [ ] Order flour ⏰ 2026-10-23 09:00\n' });
  const key = s.svc.items()[0].key;
  s.files.set('Shop.md', '# Shop\n\nNothing here now.\n');
  await assert.rejects(s.svc.done(key), /isn’t in your notes/);
  await assert.rejects(s.svc.snooze(key, at(24, 9)), /isn’t in your notes/);
});

test('the bell keeps unread notices first when more than forty arrive (9.5 fourth pass)', () => {
  const s = setup({});
  s.svc.post([{ key: 'old', kind: 'bills', title: 'Old bill', body: 'Pay it', path: 'B.md' }]);
  s.svc.post(Array.from({ length: 39 }, (_, i) => ({ key: `k${i}`, kind: 'bills', title: `N${i}`, body: 'x', path: 'B.md' })));
  for (const n of s.svc.notices()) if (n.title !== 'Old bill') s.svc.read(n.id);
  s.svc.post(Array.from({ length: 5 }, (_, i) => ({ key: `j${i}`, kind: 'bills', title: `M${i}`, body: 'x', path: 'B.md' })));
  const titles = s.svc.notices().map((n) => n.title);
  assert.ok(titles.includes('Old bill'), 'an old unread notice survives the cap');
  assert.equal(titles.length, 40);
});

test('a roll that cannot be written is said once, then when it recovers (9.5 fourth pass)', async () => {
  const index = new M.VaultIndex();
  const text = '- [x] Bins ⏰ 2026-10-19 09:00 every Monday\n';
  const files = new Map([['Shop.md', text]]);
  index.set('Shop.md', text, 0, text.length);
  const logged = [];
  let fail = true;
  const svc = new M.Reminders({
    dataDir: mkdtempSync(path.join(work, 'data-')),
    index,
    library: () => '/notes',
    read: (rel) => files.get(rel),
    write: async (rel, t) => {
      if (fail) throw new Error('locked');
      files.set(rel, t);
      index.set(rel, t, 0, t.length);
    },
    templatesFolder: () => 'Templates',
    show: () => {},
    changed: () => {},
    now: () => at(19, 10, 30),
    log: (m) => logged.push(m),
  });
  await svc.check();
  assert.equal(logged.length, 1);
  assert.match(logged[0], /Shop\.md/);
  await svc.check();
  assert.equal(logged.length, 1, 'a failure that keeps failing is not said again');
  fail = false;
  await svc.check();
  assert.equal(logged.length, 2, 'recovery is said too');
});

test('a roll finds its line by its words when the note shifted (9.5 fourth pass)', async () => {
  const s = setup({ 'Shop.md': '- [x] Bins ⏰ 2026-10-19 09:00 every Monday\n' });
  s.files.set('Shop.md', 'New first line\n- [x] Bins ⏰ 2026-10-19 09:00 every Monday\n');
  await s.svc.check();
  assert.ok(s.files.get('Shop.md').includes('⏰ 2026-10-26 09:00'), 'the repeat moved on at its new line');
});

test('snoozing a repeat twice moves the one snooze, never two lines (9.5 fourth pass)', async () => {
  const s = setup({ 'Shop.md': '- [ ] Bins ⏰ 2026-10-23 09:00 every Monday\n' });
  const key = s.svc.items().find((i) => i.repeat).key;
  await s.svc.snooze(key, at(24, 9));
  await s.svc.snooze(key, at(25, 9));
  const lines = s.files.get('Shop.md').split('\n').filter((l) => l.includes('Bins'));
  assert.equal(lines.length, 2, 'the repeat and its one snooze');
  assert.ok(lines[1].includes('⏰ 2026-10-25 09:00'), 'the snooze moved to the later time');
});

test('a Templates folder written with a slash still leaves templates out (9.5 fourth pass)', async () => {
  const index = new M.VaultIndex();
  const text = '- [ ] Template ⏰ 2026-10-19 10:31\n';
  index.set('Templates/Weekly.md', text, 0, text.length);
  const shown = [];
  const clock = { now: at(19, 10, 30) };
  const svc = new M.Reminders({
    dataDir: mkdtempSync(path.join(work, 'data-')),
    index,
    library: () => '/notes',
    read: () => text,
    write: async () => {},
    templatesFolder: () => 'Templates/',
    show: (n) => shown.push(n),
    changed: () => {},
    now: () => clock.now,
  });
  await svc.check();
  clock.now = at(19, 10, 32);
  await svc.check();
  assert.deepEqual(shown, [], 'templates never said, slash or not');
});
