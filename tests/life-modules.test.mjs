// node --test tests/life-modules.test.mjs — Health and Fitness and Family (Wave 5 part b, 24 Oct 2026; src/shared/
// life-modules.ts, src/shared/health.ts, src/shared/family.ts, src/shared/life-tools.ts, src/main/health-store.ts,
// src/main/modules.ts). On made-up records (a household with neutral names, a made-up training log):
//   the health store sealed and opened again, nothing readable on disk, a key only this "Windows account" opens, a damaged
//   file put aside; nothing made while the module is off, nothing written by reading, switched off and on with nothing
//   lost; an assistant gets only the rows it asked for (one measure, the days named) and only with the Health level, every
//   read and refusal in the audit trail; log notes taken in word for word and put back exactly; streaks, the check-in and
//   reward trackers; the family calendar written as plain Markdown and who's where read from it; every family tool through
//   the agent's gate at Family-private.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-modules-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * as L from ${src('src/shared/life-modules.ts')};`,
      `export * as HL from ${src('src/shared/health.ts')};`,
      `export * as F from ${src('src/shared/family.ts')};`,
      `export * as T from ${src('src/shared/life-tools.ts')};`,
      `export { MODULE_TOOLS } from ${src('src/shared/module-tools.ts')};`,
      `export { HealthStore } from ${src('src/main/health-store.ts')};`,
      `export { Modules } from ${src('src/main/modules.ts')};`,
      `export { Sensitivity } from ${src('src/main/sensitivity.ts')};`,
      `export { makeGate } from ${src('src/main/agent-gate.ts')};`,
      `export { readProps } from ${src('src/shared/frontmatter.ts')};`,
      `export * as S from ${src('src/shared/sensitivity.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'modules.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'modules.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** A stand-in for Windows' protected store: sealed with this "account's" secret; another account can't open it. */
const protector = (account = 'account-one') => {
  const pad = createHash('sha256').update(account).digest();
  const xor = (b) => Buffer.from(b.map((x, i) => x ^ pad[i % pad.length]));
  return {
    available: () => true,
    protect: (plain) => Buffer.concat([Buffer.from('PROT'), createHash('sha256').update(account).digest().subarray(0, 4), xor(plain)]),
    unprotect: (sealed) => {
      if (!sealed.subarray(0, 4).equals(Buffer.from('PROT')) || !sealed.subarray(4, 8).equals(createHash('sha256').update(account).digest().subarray(0, 4))) throw new Error('not this account');
      return xor(sealed.subarray(8));
    },
  };
};

const allFiles = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String) : []);

// ── The store ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the health store: sealed on disk, opened again, only by the account that made it, a damaged file put aside', async () => {
  const dir = path.join(work, 'store-a');
  const s1 = new M.HealthStore({ dir: () => dir, protector: protector() });
  // Reading makes nothing.
  const empty = await s1.read();
  assert.equal(empty.entries.length, 0);
  assert.equal(allFiles(dir).length, 0, 'reading an empty store writes no file');
  await s1.change((db) => M.HL.setEntry(db, 'weight', '2026-10-20', { n: 81.7 }));
  await s1.change((db) => ({ ...M.HL.setEntry(db, 'sleep', '2026-10-20', { n: 6.5 }), appointments: [{ id: 'a1', day: '2026-11-02', who: 'Dr Lane', why: 'Knee check', status: 'booked', results: [], at: 1 }] }));
  assert.deepEqual(allFiles(dir).sort(), ['health.nvdb', 'health.nvkey']);
  const onDisk = readFileSync(path.join(dir, 'health.nvdb'), 'utf8') + readFileSync(path.join(dir, 'health.nvkey'), 'utf8');
  for (const plain of ['81.7', 'Dr Lane', 'Knee check', 'weight', 'Sleep', '2026-10-20']) assert.ok(!onDisk.includes(plain), `“${plain}” is not readable on disk`);
  // Opened again (a new start of Ironleaf): the same records.
  const s2 = new M.HealthStore({ dir: () => dir, protector: protector() });
  const again = await s2.read();
  assert.equal(M.HL.entryOn(again, 'weight', '2026-10-20').n, 81.7);
  assert.equal(again.appointments[0].who, 'Dr Lane');
  assert.ok(M.HL.entryOn(again, 'weight', '2026-10-20').at > 1.7e12, 'when each was written is kept as it was (a full time, not cut short)');
  // Another Windows account (or PC) can't open the key.
  const s3 = new M.HealthStore({ dir: () => dir, protector: protector('someone-else') });
  await assert.rejects(() => s3.read(), /This Windows account can’t open the health store’s key/);
  // Closed (switched off): forgotten from memory, the files kept.
  s2.close();
  assert.equal((await s2.status()).open, false);
  assert.equal((await s2.status()).exists, true);
  // A damaged file is put aside, never written over, and said.
  writeFileSync(path.join(dir, 'health.nvdb'), '{"version":1,"nonce":"AAAA","data":"broken"}');
  const s4 = new M.HealthStore({ dir: () => dir, protector: protector() });
  const fresh = await s4.read();
  assert.equal(fresh.entries.length, 0);
  assert.ok(allFiles(dir).some((f) => f.startsWith('health damaged ')), 'the damaged file is kept beside it');
  assert.match((await s4.status()).problem, /put aside and a new store was started\. Nothing was deleted\./);
});

test('nothing can be saved without the protected store, and the person is told why', async () => {
  const dir = path.join(work, 'store-b');
  const s = new M.HealthStore({ dir: () => dir, protector: { available: () => false, protect: () => Buffer.alloc(0), unprotect: () => Buffer.alloc(0) } });
  await assert.rejects(() => s.change((db) => M.HL.setEntry(db, 'weight', '2026-10-20', { n: 80 })), /can’t protect the health store’s key/);
  assert.equal(allFiles(dir).length, 0);
});

// ── A household: the vault, the gate, the modules ────────────────────────────────────────────────────────────────────

function household(name, switches) {
  const vault = path.join(work, name, 'vault');
  const data = path.join(work, name, 'data');
  mkdirSync(vault, { recursive: true });
  const notes = new Map();
  const write = (rel, text) => {
    mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    writeFileSync(path.join(vault, rel), text);
    notes.set(rel, text);
  };
  const trashed = [];
  const titleOf = (rel) => rel.split('/').pop().replace(/\.md$/, '');
  const index = {
    allMeta: () => [...notes.keys()].map((p) => ({ path: p, title: titleOf(p), props: M.readProps(notes.get(p)) })),
    get: (p) => (notes.has(p) ? { path: p, title: titleOf(p), props: M.readProps(notes.get(p)) } : undefined),
    content: (p) => notes.get(p),
    outgoing: () => [],
  };
  const sensitivity = new M.Sensitivity({ root: () => vault, props: (rel) => (notes.has(rel) ? M.readProps(notes.get(rel)) : undefined), pc: 'TEST-PC' });
  const sw = { value: switches };
  const changed = [];
  const notified = [];
  const modules = new M.Modules({
    handle: () => {},
    dataDir: data,
    root: () => vault,
    vaultKey: async () => 'vault-one',
    index,
    modules: () => sw.value,
    protector: protector(),
    sensitivity,
    requireCreate: async () => {},
    writeNote: async (rel, text) => write(rel, text),
    readNote: async (rel) => notes.get(rel) ?? null,
    exists: async (rel) => notes.has(rel),
    makeFolder: async (rel) => mkdirSync(path.join(vault, rel), { recursive: true }),
    trash: async (rel) => {
      trashed.push(rel);
      notes.delete(rel);
      rmSync(path.join(vault, rel), { force: true });
    },
    files: async () => allFiles(vault).map((f) => f.split(path.sep).join('/')),
    copyIn: async () => [],
    pickFiles: async () => [],
    pickSave: async (o) => path.join(work, name, o.name),
    notify: (n) => notified.push(n),
    openHealth: () => {},
    changed: (m) => changed.push(m),
  });
  return { vault, data, notes, write, trashed, sensitivity, modules, sw, changed, notified, healthDir: path.join(data, 'health', 'vault-one') };
}

test('switched off, a module adds nothing: no data files, no tools, no reminders; on and off again loses nothing', async () => {
  const h = household('toggle', {});
  assert.equal(h.modules.tools().length, 0, 'no tools while every module is off');
  await assert.rejects(() => h.modules.healthDb(), /Health is switched off \(Settings › Packs\)/); // 5 Nov 2026 first-ten-minutes F18: the section is Packs (modules only an old link id); the words say where it is
  await assert.rejects(() => h.modules.familyState(), /Family is switched off/);
  assert.equal(await h.modules.remind(new Date(2026, 9, 24, 9)), 0);
  assert.equal(existsSync(h.data), false, 'not even its folder is made');
  // On: reading still makes nothing; the first change does.
  h.sw.value = M.L.withSwitch({}, 'health', true);
  h.modules.switched();
  await h.modules.healthDb();
  assert.equal(allFiles(h.healthDir).length, 0, 'opening the page writes nothing');
  await h.modules.healthChange((db) => M.HL.setEntry(db, 'weight', '2026-10-22', { n: 82 }));
  assert.deepEqual(allFiles(h.healthDir).sort(), ['health.nvdb', 'health.nvkey']);
  assert.ok(h.modules.tools().some((t) => t.name === 'health_trend') && !h.modules.tools().some((t) => t.module === 'family'), 'Health’s tools only');
  // A part switched off takes its tools with it.
  h.sw.value = M.L.withSwitch(h.sw.value, 'health', false, 'appointments');
  assert.ok(!h.modules.tools().some((t) => t.name === 'health_appointment_add'));
  assert.ok(M.L.partOn(h.sw.value, 'health', 'training') && !M.L.partOn(h.sw.value, 'health', 'appointments'));
  // Off: closed, its key forgotten, its files kept; on again: everything there.
  h.sw.value = M.L.withSwitch(h.sw.value, 'health', false);
  h.modules.switched();
  assert.equal(h.modules.health.close === undefined, false);
  assert.equal((await h.modules.health.status()).open, false);
  assert.deepEqual(allFiles(h.healthDir).sort(), ['health.nvdb', 'health.nvkey'], 'the records are kept');
  h.sw.value = M.L.withSwitch(h.sw.value, 'health', true);
  h.modules.switched();
  assert.equal(M.HL.entryOn(await h.modules.healthDb(), 'weight', '2026-10-22').n, 82);
  h.modules.stop();
  // The switches as kept: lenient.
  assert.deepEqual(M.L.cleanModules({ health: { on: true, off: ['food', 'BAD PART', 3] }, 'bad id!': { on: true }, family: 'yes' }), { health: { on: true, off: ['food'] } });
  assert.equal(M.L.moduleOn({ nope: { on: true } }, 'nope'), false, 'only modules in the catalogue');
});

test('an assistant gets only the rows it asked for, only with the Health level; every read and refusal is in the trail', async () => {
  const h = household('rows', M.L.withSwitch({}, 'health', true));
  await h.modules.healthChange((db) => {
    let x = db;
    for (let i = 0; i < 40; i++) {
      const day = M.HL.addDays('2026-10-24', -i);
      x = M.HL.setEntry(x, 'weight', day, { n: 85 - i * 0.05 });
      x = M.HL.setEntry(x, 'sleep', day, { n: 7 });
      x = M.HL.setEntry(x, 'mood', day, { n: 6 });
    }
    return x;
  });
  const chat = M.makeGate(h.sensitivity, 'side-chat', 'The side chat');
  // Not allowed Health (the default): refused in words, nothing given.
  await assert.rejects(() => h.modules.call({ gate: chat }, 'health_trend', { measure: 'Weight', days: 7 }), /marked Health and The side chat isn’t allowed Health items/);
  // Allowed Health: one measure, the days asked for, nothing else.
  await h.sensitivity.update((s) => {
    s.access['side-chat'] = ['open', 'work', 'personal', 'health'];
  });
  const r = await h.modules.call({ gate: chat }, 'health_trend', { measure: 'weight', from: '2026-10-18', to: '2026-10-24' });
  const rows = r.text.split('\n').filter((l) => /^\d{4}-\d{2}-\d{2}: /.test(l));
  assert.equal(rows.length, 7, 'seven days asked, seven rows');
  assert.ok(rows.every((l) => l >= '2026-10-18' && l <= '2026-10-24:~'), 'only the days named');
  assert.ok(!/Sleep|Mood|7 h|6\/10/.test(r.text), 'no other measure');
  assert.match(r.text, /^Weight: 7 entries from Sun 18 Oct to Sat 24 Oct; latest 85 kg/);
  // A year at most, whatever is asked.
  const long = await h.modules.call({ gate: chat }, 'health_trend', { measure: 'Sleep', days: 5000 });
  assert.ok(long.text.split('\n').filter((l) => /^\d{4}-/.test(l)).length <= 366);
  // The measures' names, never their figures.
  const names = await h.modules.call({ gate: chat }, 'health_measures', {});
  assert.ok(/Weight \(number \(kg\)\)/.test(names.text) && !/85/.test(names.text));
  // The trail: the refusal, then each read naming the measure and days.
  await h.sensitivity.settled();
  const trail = await h.sensitivity.trail();
  assert.ok(trail.some((e) => e.action === 'refused' && e.level === 'health' && e.who === 'side-chat'));
  assert.ok(trail.some((e) => e.action === 'read' && /^Health store: Weight, Sun 18 Oct to Sat 24 Oct$/.test(e.item) && e.detail === '7 entries'));
  // A chat bot (not allowed Health) can't log either.
  const bot = M.makeGate(h.sensitivity, 'bot:coach', 'Chat bot (coach)');
  await assert.rejects(() => h.modules.call({ gate: bot }, 'health_checkin_log', { values: { Weight: 80 } }), /isn’t allowed Health/);
  // A bot given its own Health row logs a check-in, by its name; an unknown measure is said, not made.
  await h.sensitivity.update((s) => {
    s.access['bot:coach'] = ['open', 'health'];
  });
  const logged = await h.modules.call({ gate: bot }, 'health_checkin_log', { values: { Weight: '84.1 kg', Sleep: 7.5, Energy: 8, 'Blood pressure': 120 }, day: '2026-10-24' });
  assert.match(logged.text, /^Logged for Sat 24 Oct: Weight 84\.1 kg, Sleep 7\.5 h, Energy 8\/10\. Not kept \(no such measure\): Blood pressure\./);
  const db = await h.modules.healthDb();
  assert.equal(M.HL.entryOn(db, 'weight', '2026-10-24').by, 'Chat bot (coach)');
  // Nothing of it in the vault: the store lives in Ironleaf's own data on this PC.
  assert.deepEqual(allFiles(h.vault).filter((f) => /health|nvdb|nvkey/i.test(f)), []);
  h.modules.stop();
});

test('log notes come in word for word: every field and line kept, a moved note put back exactly as it was', async () => {
  const h = household('logs', M.L.withSwitch({}, 'health', true));
  const log = [
    '---',
    'type: log',
    'project: "Couch to 5K"',
    'fields: [Weight, Run]',
    'units: {Weight: kg, Run: km}',
    '---',
    '# Couch to 5K log',
    '',
    'Format: `- Weight:` `- Run:` `- Stretched:`',
    '',
    '## Mon 19 Oct 2026, Day 1',
    '',
    '- Weight: 88.4 kg (after breakfast)',
    '- Run: 2.1',
    '- Stretched: Y',
    '- Knees a bit sore',
    '',
    '## Wed 21 Oct 2026',
    '',
    '- Weight: 88.0',
    '- Run: 2.6 km',
    '- Stretched: N (ran late)',
    '- Felt: good',
    '',
  ].join('\n');
  h.write('Health/Couch to 5K log.md', log);
  const offers = await h.modules.logNotes();
  assert.equal(offers.length, 1);
  const plan = offers[0].plan;
  assert.deepEqual(plan.fields.map((f) => [f.field, !!f.make]), [['Weight', false], ['Run', true], ['Stretched', true], ['Felt', true]], 'Weight goes to the measure kept; the others are made');
  assert.equal(plan.entries, 7);
  assert.equal(plan.days, 2);
  const r = await h.modules.takeIn(['Health/Couch to 5K log.md'], true);
  assert.match(r.words, /^Moved 1 log note \(7 entries\) into your health store\. The notes are in Recently deleted/);
  assert.deepEqual(h.trashed, ['Health/Couch to 5K log.md']);
  const db = await h.modules.healthDb();
  const m = (name) => M.HL.measureOf(db, name);
  assert.equal(M.HL.entryOn(db, 'weight', '2026-10-19').n, 88.4);
  assert.equal(M.HL.entryOn(db, 'weight', '2026-10-19').text, '88.4 kg (after breakfast)', 'the words as written are kept with the figure');
  assert.equal(m('Run').kind, 'number');
  assert.equal(m('Run').unit, 'km');
  assert.equal(m('Weight (kg)')?.id, m('Weight')?.id, 'a measure with its unit is the same measure');
  assert.equal(m('Weight (lb)'), undefined, 'a clashing unit is another measure, never merged');
  assert.equal(M.HL.entryOn(db, m('Run').id, '2026-10-21').n, 2.6);
  assert.equal(m('Stretched').kind, 'yesno');
  assert.equal(M.HL.entryOn(db, m('Stretched').id, '2026-10-21').yes, false);
  assert.equal(M.HL.entryOn(db, m('Stretched').id, '2026-10-21').text, 'N (ran late)');
  assert.equal(M.HL.entryOn(db, m('Felt').id, '2026-10-21').text, 'good');
  assert.deepEqual(db.notes.filter((x) => x.day === '2026-10-19').map((x) => x.text), ['Day 1', 'Knees a bit sore'], 'the day’s label and its free lines');
  // The streak of the yes/no that came in.
  assert.equal(M.HL.measureStreak(db, m('Stretched').id, '2026-10-21').best, 1);
  // Put back: the same bytes, where it was.
  const rec = db.imports[0];
  assert.equal(rec.text, log);
  const back = await h.modules.putBack(rec.id);
  assert.equal(back.path, 'Health/Couch to 5K log.md');
  assert.equal(readFileSync(path.join(h.vault, back.path), 'utf8'), log, 'exactly as it was');
  assert.ok((await h.modules.healthDb()).imports[0].restored);
  // A copy keeps the note; taking it in again doesn't duplicate days (one entry per measure per day).
  await h.modules.takeIn(['Health/Couch to 5K log.md'], false);
  assert.ok(h.notes.has('Health/Couch to 5K log.md'));
  assert.equal((await h.modules.healthDb()).entries.filter((e) => e.measure === 'weight').length, 2);
  // An export brought back loses nothing.
  const db2 = await h.modules.healthDb();
  const round = M.HL.readExport(M.HL.exportJson(db2));
  assert.deepEqual(round, M.HL.cleanDb(JSON.parse(JSON.stringify(db2))));
  assert.equal(M.HL.readExport('{"kind":"something else"}'), null);
  h.modules.stop();
});

// ── Streaks, the check-in, estimates, training ───────────────────────────────────────────────────────────────────────

test('streaks: today not answered yet doesn’t break a run, a no does, the best run and the next milestone', () => {
  const a = new Map([
    ['2026-10-18', true],
    ['2026-10-19', true],
    ['2026-10-20', false],
    ['2026-10-21', true],
    ['2026-10-22', true],
    ['2026-10-23', true],
  ]);
  const s = M.HL.streakOf(a, '2026-10-24', [3, 7, 14]);
  assert.equal(s.current, 3, 'today unanswered: the run up to yesterday');
  assert.equal(s.best, 3);
  assert.deepEqual(s.next, { at: 7, left: 4 });
  assert.deepEqual(s.reached, [3]);
  assert.equal(s.days.length, 14);
  assert.equal(s.days.at(-1).yes, null);
  a.set('2026-10-24', true);
  assert.equal(M.HL.streakOf(a, '2026-10-24').current, 4);
  a.set('2026-10-24', false);
  assert.equal(M.HL.streakOf(a, '2026-10-24').current, 0, 'a no today ends it');
  a.delete('2026-10-23');
  a.delete('2026-10-24');
  assert.equal(M.HL.streakOf(a, '2026-10-24').current, 0, 'a day missed (yesterday) breaks it');
});

test('the check-in: due after its time until every question is answered; estimates say their method and inputs', () => {
  let db = M.HL.emptyDb(0);
  const at = (h) => new Date(2026, 9, 24, h, 0);
  assert.equal(M.HL.checkinState(db, at(6)).due, false, 'not before its time');
  assert.equal(M.HL.checkinState(db, at(8)).due, true);
  for (const id of db.checkin.measures) db = M.HL.setEntry(db, id, '2026-10-24', { n: 7 });
  const st = M.HL.checkinState(db, at(8));
  assert.equal(st.done, true);
  assert.equal(st.due, false);
  assert.equal(st.streak.current, 1);
  // Estimates: only from figures given, each labelled with its method and inputs.
  db = { ...db, profile: { height: 178, sex: 'male' } };
  db = M.HL.setEntry(db, 'weight', '2026-10-24', { n: 84 });
  db = M.HL.setEntry(db, 'waist', '2026-10-24', { n: 92 });
  db = M.HL.setEntry(db, 'neck', '2026-10-24', { n: 39 });
  const { estimates } = M.HL.bodyEstimates(db);
  const by = Object.fromEntries(estimates.map((e) => [e.id, e]));
  assert.equal(by.bmi.value, 26.5);
  assert.equal(by['waist-height'].value, 0.52);
  assert.ok(by['body-fat-navy'].value > 15 && by['body-fat-navy'].value < 25, `a plausible tape estimate (${by['body-fat-navy'].value})`);
  assert.match(by['body-fat-navy'].method, /US Navy tape method/);
  assert.ok(by['lean-mass'] && by.ffmi);
  assert.deepEqual(M.HL.bodyEstimates(M.HL.emptyDb(0)).estimates, []);
  // Readings as people write them.
  const w = db.measures.find((m) => m.id === 'weight');
  assert.deepEqual(M.HL.readValue(w, '82.4 kg'), { n: 82.4 });
  assert.deepEqual(M.HL.readValue(w, 'about 82 after lunch'), { n: 82, text: 'about 82 after lunch' });
  assert.equal(M.HL.readValue(w, 'heavy'), null);
  const mood = db.measures.find((m) => m.id === 'mood');
  assert.deepEqual(M.HL.readValue(mood, 14), { n: 10 }, 'a score is kept within its range');
});

test('training: a plan’s day by weekday or in turn, personal bests with Epley’s estimate, last time, the week', () => {
  let db = M.HL.emptyDb(0);
  const plan = { id: 'p1', name: 'Three days', days: [{ id: 'A', label: 'Day A', title: 'Legs', exercises: [] }, { id: 'B', label: 'Day B', title: 'Push', exercises: [] }, { id: 'C', label: 'Day C', title: 'Pull', exercises: [] }], created: 0, start: '2026-10-05', weeks: 8 };
  db = { ...db, plans: [plan] };
  assert.equal(M.HL.planDayFor(db, plan, '2026-10-24').id, 'A', 'the first day before any session');
  db = { ...db, sessions: [{ id: 's1', day: '2026-10-22', title: 'Day A', kind: 'strength', plan: 'p1', planDay: 'A', exercises: [{ name: 'Back squat', sets: [{ weight: 60, reps: 5, kind: 'warm-up' }, { weight: 100, reps: 5 }, { weight: 90, reps: 8 }] }], at: 1 }] };
  assert.equal(M.HL.planDayFor(db, plan, '2026-10-24').id, 'B', 'then the next in turn');
  assert.deepEqual(M.HL.planWeek(plan, '2026-10-24'), { week: 3, of: 8 });
  const pb = M.HL.personalBests(db)[0];
  assert.equal(pb.exercise, 'Back squat');
  assert.equal(pb.estimate, 116.7, 'Epley: 100 × (1 + 5/30)');
  assert.deepEqual(M.HL.lastTime(db, 'back squat', '2026-10-24').sets.length, 3);
  assert.equal(M.HL.sessionsInWeek(db, '2026-10-24').length, 1);
  assert.deepEqual(M.HL.volumeByMuscle(db, '2026-10-24').find((v) => v.muscle === 'quads'), { muscle: 'quads', sets: 2 }, 'warm-ups don’t count');
  const byWeekday = { ...plan, days: [{ ...plan.days[0], weekday: 6 }, { ...plan.days[1], weekday: 1 }] };
  assert.equal(M.HL.planDayFor(db, byWeekday, '2026-10-24').id, 'A', 'Saturday’s day');
  assert.equal(M.HL.planDayFor(db, byWeekday, '2026-10-25'), undefined, 'nothing on Sunday');
});

test('appointments: reminders come due as each asks, are said once, and passed ones are asked about', async () => {
  const h = household('appts', M.L.withSwitch({}, 'health', true));
  await h.modules.healthChange((db) => ({ ...db, appointments: [{ id: 'g1', day: '2026-10-25', time: '09:30', who: 'GP', why: 'Check-up', status: 'booked', remind: 1, results: [], at: 1 }, { id: 'd1', day: '2026-11-20', who: 'Dentist', status: 'booked', results: [], at: 1 }, { id: 'o1', day: '2026-10-20', who: 'Physio', status: 'booked', results: [], at: 1 }] }));
  const now = new Date(2026, 9, 24, 9, 0);
  assert.equal(await h.modules.remind(new Date(2026, 9, 24, 6, 0)), 0, 'not before 7 in the morning');
  assert.equal(await h.modules.remind(now), 1);
  assert.deepEqual(h.notified.map((n) => [n.title, n.body]), [['Appointment coming up', 'GP · Check-up, tomorrow at 9:30 am']]);
  assert.equal(await h.modules.remind(now), 0, 'said once');
  const db = await h.modules.healthDb();
  assert.deepEqual(M.HL.pastBooked(db, '2026-10-24').map((a) => a.who), ['Physio']);
  assert.deepEqual(M.HL.upcoming(db, '2026-10-24').map((a) => a.who), ['GP', 'Dentist']);
  h.modules.stop();
});

// ── Family ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the family calendar is plain Markdown: rows added in the table’s own columns, changed, taken out; who’s where read from it', () => {
  let t = M.F.calendarText();
  t = M.F.addCalendarRow(t, 'Activities', { Who: 'Mia', What: 'Swimming', Day: 'Tue, Thu', Time: '4:30pm', Where: 'Aquatic centre', Until: '2026-12-10' });
  t = M.F.addCalendarRow(t, 'Activities', { Who: 'Leo', What: 'School pickup', Day: 'weekdays', Time: '3:10 pm' });
  t = M.F.addCalendarRow(t, 'Events', { Date: '2026-10-27', Time: '18:00', Who: 'Mia, Leo', What: 'School concert', Where: 'Hall' });
  t = M.F.addCalendarRow(t, 'Milestones', { Date: '2026-10-11', Who: 'Leo', Milestone: 'Rode without training wheels' });
  assert.match(t, /\| Mia \| Swimming \| Tue, Thu \| 4:30pm \| Aquatic centre \| 2026-12-10 \|/);
  assert.match(t, /## Events\n\n\| Date \| Time \| Who \| What \| Where \|\n\| --- \| --- \| --- \| --- \| --- \|\n\| 2026-10-27 \| 18:00 \| Mia, Leo \| School concert \| Hall \|/);
  const cal = M.F.readCalendar(t, '2026-10-24');
  assert.deepEqual(cal.activities[0].days, [2, 4]);
  assert.equal(cal.activities[0].time, '16:30');
  assert.deepEqual(cal.activities[1].days, [1, 2, 3, 4, 5]);
  const members = [{ path: 'Family/People/Mia.md', name: 'Mia', born: '2017-10-27', colour: 'rose' }, { path: 'Family/People/Leo.md', name: 'Leo', colour: 'sky' }];
  const tue = M.F.dayOf(cal, members, '2026-10-27');
  assert.deepEqual(tue.map((h) => h.what), ['School pickup', 'Swimming', 'School concert', 'Mia’s birthday (9)']);
  assert.deepEqual(M.F.forPerson(tue, 'Leo').map((h) => h.what), ['School pickup', 'School concert']);
  const wide = [{ who: ['everybody'], what: 'BBQ' }, { who: ['kids'], what: 'Zoo' }, { who: ['Leo'], what: 'Dentist' }];
  assert.deepEqual(M.F.forPerson(wide, 'Mia').map((h) => h.what), ['BBQ', 'Zoo'], 'everybody and kids are family-wide');
  assert.deepEqual(M.F.forPerson(wide, 'Leo').map((h) => h.what), ['BBQ', 'Zoo', 'Dentist']);
  assert.equal(M.F.dayOf(cal, members, '2026-12-15').some((h) => h.what === 'Swimming'), false, 'an activity stops after its last day');
  t = M.F.setCalendarRow(t, 'Events', 0, { Time: '18:30' });
  assert.equal(M.F.readCalendar(t).events[0].time, '18:30');
  t = M.F.removeCalendarRow(t, 'Activities', 1);
  assert.equal(M.F.readCalendar(t).activities.length, 1);
  assert.match(t, /^---\ntype: family-calendar\nsensitivity: family\n---/);
  assert.deepEqual(M.F.readDays('Mon–Wed'), [1, 2, 3]);
  assert.equal(M.F.readDate('27 Oct', '2026-10-24'), '2026-10-27');
  assert.equal(M.F.readDate('next Friday', '2026-10-24'), '2026-10-30', 'a relative day reads instead of dropping the row');
  assert.equal(M.F.readDate('tomorrow', '2026-10-24'), '2026-10-25');
  assert.equal(M.F.readDate('someday', '2026-10-24'), undefined, 'not a day stays unread');
  assert.equal(M.F.ageOn('2017-10-27', '2026-10-24'), 8);
  assert.deepEqual(M.F.nextBirthday('2017-10-27', '2026-10-24'), { day: '2026-10-27', age: 9, in: 3 });
  assert.equal(M.F.nextBirthday('2000-02-29', '1899-06-01').day, '1900-02-28', '1900 is not a leap year: no Feb 29');
  assert.equal(M.F.nextBirthday('2000-02-29', '1999-06-01').day, '2000-02-29', '2000 is a leap year: Feb 29 kept');
});

test('a ## line inside a fenced block is not a section (9.5 fourth pass)', () => {
  const text = '# Cal\n\n```\n## Events\n| x |\n```\n\n## Events\n\n| Date |\n';
  assert.equal(M.F.findSection(text, 'Events').head, 7);
});

test('albums hold drawings and scans too: svg and tif are photos (9.5 fourth pass)', () => {
  const albums = M.F.albumsOf(['Family/Assets/beach.jpg', 'Family/Assets/logo.svg', 'Family/Assets/scan.tif', 'Family/Assets/song.mp3'], 'Family');
  assert.deepEqual(albums.find((a) => a.name === 'Photos').photos, ['Family/Assets/beach.jpg', 'Family/Assets/logo.svg', 'Family/Assets/scan.tif']);
});

test('reward trackers: a day marked in the log’s own format, the streak, the reward earned, given once', () => {
  let t = M.F.rewardText({ who: 'Mia', habit: 'Reading', rewards: [{ at: 3, reward: 'Pick the film' }, { at: 7, reward: 'Trip to the pool' }] });
  const props = () => M.readProps(t);
  for (const d of ['2026-10-21', '2026-10-22', '2026-10-23']) t = M.F.markReward(t, 'Reading', d, true);
  assert.match(t, /## Wed 21 Oct 2026\n\n- Reading: Y/);
  let r = M.F.readReward('Family/Rewards/Mia – Reading.md', 'Mia – Reading', props(), t, '2026-10-24');
  assert.equal(r.who, 'Mia');
  assert.equal(r.streak.current, 3);
  assert.deepEqual(r.earned, { at: 3, reward: 'Pick the film' });
  assert.deepEqual(r.streak.next, { at: 7, left: 4 });
  t = M.F.claimReward(t, 3);
  assert.match(t, /^claimed: \[3\]$/m);
  r = M.F.readReward('x', 'x', props(), t, '2026-10-24');
  assert.equal(r.earned, undefined, 'given: no longer waiting');
  assert.ok(r.rewards.find((x) => x.at === 3).claimed);
  t = M.F.markReward(t, 'Reading', '2026-10-24', false);
  assert.equal(M.F.readReward('x', 'x', props(), t, '2026-10-24').streak.current, 0);
  t = M.F.markReward(t, 'Reading', '2026-10-24', null);
  assert.equal(M.F.readReward('x', 'x', props(), t, '2026-10-24').streak.current, 3, 'cleared: the run up to yesterday again');
});

test('a reward is only given when its milestone is real, earned and not yet given (9.5 fourth pass)', async () => {
  const h = household('claim', M.L.withSwitch({}, 'family', true));
  await h.modules.addReward({ who: 'Mia', habit: 'Reading', rewards: [{ at: 3, reward: 'Pick the film' }] });
  const rel = 'Family/Rewards/Mia – Reading.md';
  await assert.rejects(() => h.modules.claim(rel, 7), /Day 7 has no reward/, 'no milestone at 7');
  await assert.rejects(() => h.modules.claim(rel, 3), /isn’t earned yet/, 'three days not done yet');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (const back of [2, 1, 0]) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    await h.modules.markReward(rel, iso(d), true);
  }
  await h.modules.claim(rel, 3);
  await assert.rejects(() => h.modules.claim(rel, 3), /already given/, 'given once');
});

test('family tools go through the agent’s gate at Family-private; the person’s own calls write plain notes', async () => {
  const h = household('family', M.L.withSwitch({}, 'family', true));
  await h.sensitivity.update((s) => {
    s.folders.Family = 'family';
  });
  const p = await h.modules.addMember({ name: 'Mia', relation: 'Daughter', born: '2017-10-27', colour: 'rose' });
  assert.equal(p, 'Family/People/Mia.md');
  assert.match(h.notes.get(p), /^---\ntype: person\nfamily: Daughter\nborn: 2017-10-27\ncolour: rose\nsensitivity: family\n---\n# Mia/);
  await h.modules.call({ person: true }, 'family_event_add', { date: '2026-10-27', what: 'School concert', time: '18:00', who: 'Mia' });
  await h.modules.call({ person: true }, 'family_activity_add', { who: 'Mia', what: 'Swimming', day: 'Tue' });
  await h.modules.addReward({ who: 'Mia', habit: 'Reading', rewards: [{ at: 3, reward: 'Pick the film' }] });
  assert.ok(h.notes.has('Family/Family calendar.md') && h.notes.has('Family/Rewards/Mia – Reading.md'));
  await assert.rejects(() => h.modules.call({ person: true }, 'family_reward_log', { tracker: 'Mia – Reading', day: 'someday' }), /YYYY-MM-DD/, 'a day that is not a day is refused, never silently today');
  await assert.rejects(() => h.modules.call({ person: true }, 'family_milestone_add', { what: 'First tooth', date: 'someday' }), /YYYY-MM-DD/);
  await assert.rejects(() => h.modules.call({ person: true }, 'family_events', { from: 'someday' }), /YYYY-MM-DD/);
  await assert.rejects(() => h.modules.markReward('Family/Rewards/Mia – Reading.md', 'someday', true), /YYYY-MM-DD/);
  const st = await h.modules.familyState();
  assert.equal(st.members[0].name, 'Mia');
  assert.equal(st.calendar.events[0].what, 'School concert');
  // The side chat isn't allowed Family-private by default: refused, and the trail says so.
  const chat = M.makeGate(h.sensitivity, 'side-chat', 'The side chat');
  await assert.rejects(() => h.modules.call({ gate: chat }, 'family_events', { from: '2026-10-26', days: 3 }), /marked Family-private and The side chat isn’t allowed Family-private/);
  await assert.rejects(() => h.modules.call({ gate: chat }, 'family_members', {}), /isn’t allowed Family-private/);
  await assert.rejects(() => h.modules.call({ gate: chat }, 'family_event_add', { date: '2026-10-30', what: 'Party' }), /isn’t allowed Family-private/);
  assert.ok(!h.notes.get('Family/Family calendar.md').includes('Party'), 'nothing written');
  // Allowed: who's where, and a reward marked by name.
  await h.sensitivity.update((s) => {
    s.access['side-chat'] = ['open', 'work', 'personal', 'family'];
  });
  const where = await h.modules.call({ gate: chat }, 'family_events', { from: '2026-10-26', days: 3 });
  assert.match(where.text, /Tue 27 Oct:\n- 6:00 pm School concert \(Mia\)\n- Mia’s birthday \(9\)\n- Swimming \(Mia\)/);
  // Log for today itself (the day the code works out from the clock), so the streak is 1 on any day it runs.
  const marked = await h.modules.call({ gate: chat }, 'family_reward_log', { tracker: 'Mia', day: M.F.todayIso() });
  assert.match(marked.text, /^Mia’s Reading: yes for today\. Streak 1 day \(best 1\)\. 2 days to the day-3 reward\./);
  await h.sensitivity.settled();
  const trail = await h.sensitivity.trail();
  assert.ok(trail.some((e) => e.action === 'refused' && e.level === 'family'));
  assert.ok(trail.some((e) => e.action === 'read' && e.item === 'Family/Family calendar.md' && e.who === 'side-chat'));
  // Off: no family tools, and the notes stay.
  h.sw.value = M.L.withSwitch(h.sw.value, 'family', false);
  assert.equal(h.modules.tools().length, 0);
  await assert.rejects(() => h.modules.call({ person: true }, 'family_events', {}), /switched off/);
  assert.ok(h.notes.has('Family/Family calendar.md'));
});

test('every module tool is described, levelled and offered only for its module', () => {
  const mine = M.MODULE_TOOLS.filter((t) => t.module === 'health' || t.module === 'family');
  assert.equal(mine.length, 15); // 8.5: health_week and family_week_ahead
  for (const t of mine) {
    assert.ok(t.description.length > 40 && t.step && t.title, `${t.name} says what it does`);
    assert.ok(t.level === 'read' ? t.readOnly : !t.readOnly, `${t.name}: read tools change nothing, edit tools are not read-only`);
    assert.ok(t.name.startsWith(`${t.module}_`), `${t.name} is named for its module`);
  }
});
