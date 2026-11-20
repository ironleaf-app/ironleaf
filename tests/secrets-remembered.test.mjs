// node --test tests/secrets-remembered.test.mjs — Secrets you unlock once (8.2, 29 Oct 2026; 8.5, 30 Oct 2026): a
// remembered unlock sealed with Windows protection on this PC survives a restart inside the chosen period and not
// after it; by default the choice is until Windows sign-out, Windows lock and sleep do not lock (they do, at once,
// when the person turns that on), signing out always locks, using a login never steps up while showing or copying
// bank/card/private-key/API-key secrets does (for 5 minutes), a copied secret leaves the clipboard on lock and
// after its time, and nothing is in the clear on disk. Hello, the Windows protection and the power events are
// stand-ins here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-secrets82-'));
let PN, SS, LE, PF;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entries = { private: 'src/main/private-notes.ts', secrets: 'src/main/secrets.ts', lock: 'src/main/lock-events.ts', prefs: 'src/shared/prefs.ts' };
  for (const [name, src] of Object.entries(entries)) await build({ input: path.join(root, src), platform: 'node', output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
  PN = await import(pathToFileURL(path.join(work, 'private.mjs')).href);
  SS = await import(pathToFileURL(path.join(work, 'secrets.mjs')).href);
  LE = await import(pathToFileURL(path.join(work, 'lock.mjs')).href);
  PF = await import(pathToFileURL(path.join(work, 'prefs.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const hello = (pcKey) => ({ available: async () => true, secret: async (name, challenge) => createHash('sha256').update(pcKey).update(name).update(challenge).digest() });
/** Windows protection as a stand-in: sealed bytes are never the plain bytes. */
const seal = {
  available: () => true,
  protect: (plain) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from([...plain].map((b) => b ^ 0xa5))]),
  unprotect: (sealed) => Buffer.from([...sealed.subarray(7)].map((b) => b ^ 0xa5)),
};
const tick = () => new Promise((r) => setTimeout(r, 10));

function rig(vaultName, { mode = '8h', start = 1_000_000_000_000 } = {}) {
  const vault = path.join(work, vaultName);
  const storeFile = path.join(work, `${vaultName}-remembered.json`); // on this PC, outside the vault
  let now = start;
  const clipboard = { text: '', write(t) { this.text = t; }, read() { return this.text; }, clear() { this.text = ''; } };
  const make = () => {
    const store = new PN.PrivateNotes({
      root: () => vault, hello: hello('this pc'), device: { id: 'pc-1', name: 'pc-1' }, lockAfter: () => 10,
      keepUnlocked: () => mode, now: () => now, rememberedSeal: seal,
      rememberedStore: { read: async () => (existsSync(storeFile) ? readFileSync(storeFile, 'utf8') : null), write: async (t) => writeFileSync(storeFile, t), clear: async () => rmSync(storeFile, { force: true }) },
      onLocked: () => {}, trash: async (abs) => rmSync(abs),
    });
    const secrets = new SS.SecretsStore({ store, trash: async (abs) => rmSync(abs), clipboard, clearAfter: 30 });
    return { store, secrets };
  };
  return { vault, storeFile, clipboard, make, advance: (ms) => { now += ms; }, setMode: (m) => { mode = m; } };
}

test('remembered unlock survives a restart within the period, and not after it; nothing in the clear on disk', async () => {
  const r = rig('vault-a', { mode: '1h' });
  const first = r.make();
  await first.store.setUp('correct horse battery', true);
  await first.store.write('Diary', 'a very private thought');
  const bank = await first.secrets.add({ name: 'Bank login', kind: 'bank', value: '12345678' });
  await first.secrets.add({ name: 'Email', kind: 'password', value: 'hunter2-secret' });
  await tick(); // the sealed remembered unlock is written
  assert.ok(existsSync(r.storeFile), 'the remembered unlock is kept on this PC, outside the vault');
  const onDisk = [readFileSync(r.storeFile, 'utf8'), ...readdirSync(path.join(r.vault, 'Private notes')).map((n) => readFileSync(path.join(r.vault, 'Private notes', n), 'utf8'))].join('\n');
  for (const word of ['correct horse', 'hunter2-secret', '12345678', 'a very private thought', 'Diary']) assert.ok(!onDisk.includes(word), `“${word}” is not in the clear on disk`);
  assert.ok(!readFileSync(r.storeFile, 'utf8').includes(r.vault.replace(/\\/g, '\\\\')), 'the vault path is not in the clear either');

  // A restart (a new cafe over the same vault and PC file) 30 minutes later: open without asking.
  r.advance(30 * 60_000);
  const second = r.make();
  assert.equal(await second.store.tryRememberedUnlock(), true);
  assert.equal(second.store.read('Diary'), 'a very private thought');
  assert.deepEqual((await second.secrets.list()).map((s) => s.name), ['Bank login', 'Email']);
  void bank;

  // After the chosen hour: no silent reopen, and the sealed copy is gone.
  r.advance(31 * 60_000);
  const third = r.make();
  assert.equal(await third.store.tryRememberedUnlock(), false);
  assert.equal(third.store.unlocked, false);
  assert.equal(existsSync(r.storeFile), false, 'an expired remembered unlock is removed');

  // The strict old way remembers nothing across a restart.
  const strict = rig('vault-strict', { mode: 'strict' });
  const s1 = strict.make();
  await s1.store.setUp('correct horse battery', false);
  await tick();
  assert.equal(existsSync(strict.storeFile), false, 'strict mode writes no remembered unlock');
  assert.equal(await strict.make().store.tryRememberedUnlock(), false);
});

test('Windows lock and sleep do not lock by default (8.5); turned on they lock at once and end the remembered unlock; signing out always locks; closing Ironleaf does not lock', async () => {
  const r = rig('vault-b', { mode: 'until-sign-out' });
  const first = r.make();
  await first.store.setUp('correct horse battery', true);
  const pw = await first.secrets.add({ name: 'Email', kind: 'password', value: 'hunter2-secret' });
  await first.secrets.copy(pw.id);
  assert.equal(r.clipboard.text, 'hunter2-secret');
  await tick();
  assert.ok(existsSync(r.storeFile), 'the remembered unlock is kept on this PC');

  // The default (8.5): locking Windows and sleep leave Secrets unlocked, and the remembered unlock stays.
  let leaveLocks = false;
  const power = new EventEmitter();
  const stop = LE.watchLockEvents(power, () => first.store.lock(), () => leaveLocks);
  power.emit('lock-screen');
  power.emit('suspend');
  await tick();
  assert.equal(first.store.unlocked, true, 'Windows lock and sleep do not lock by default');
  assert.ok(existsSync(r.storeFile), 'the remembered unlock survives Windows lock and sleep');
  assert.equal(await first.secrets.reveal(pw.id).then((x) => x.value), 'hunter2-secret', 'the login is still there to use');

  // Turned on in Settings, the same events lock at once and end the remembered unlock.
  leaveLocks = true;
  power.emit('lock-screen');
  await tick();
  assert.equal(first.store.unlocked, false, 'with the setting on, Windows lock locks');
  assert.equal(r.clipboard.text, '', 'a copied secret leaves the clipboard when it locks');
  assert.equal(existsSync(r.storeFile), false, 'locking on Windows lock ends the remembered unlock');
  assert.equal(await r.make().store.tryRememberedUnlock(), false);
  stop();
  power.emit('lock-screen');

  // Sleep locks the same way when turned on.
  const again = r.make();
  await again.store.unlockWithPassword('correct horse battery');
  await tick();
  const stop2 = LE.watchLockEvents(power, () => again.store.lock(), () => leaveLocks);
  power.emit('suspend');
  assert.equal(again.store.unlocked, false, 'with the setting on, sleep locks');
  stop2();

  // Signing out of Windows always locks and ends the remembered unlock, whichever way the setting sits.
  const third = r.make();
  await third.store.unlockWithPassword('correct horse battery');
  await tick();
  const stopOut = LE.watchSignOutEvents(power, () => third.store.lock());
  power.emit('shutdown');
  await tick();
  assert.equal(third.store.unlocked, false, 'signing out locks');
  assert.equal(existsSync(r.storeFile), false, 'signing out ends the remembered unlock');
  stopOut();

  // Closing (not locking) keeps the period: a restart reopens. A fresh store closing as its vault opens (the
  // app's openVault) must not take the sealed unlock away either.
  const fourth = r.make();
  await fourth.store.unlockWithPassword('correct horse battery');
  await tick();
  fourth.store.close();
  assert.equal(fourth.store.unlocked, false, 'the words leave memory when Ironleaf closes');
  const fifth = r.make();
  fifth.store.close();
  assert.equal(await fifth.store.tryRememberedUnlock(), true, 'a restart inside the period reopens');
  fifth.store.lock();
  assert.equal(await r.make().store.tryRememberedUnlock(), false, 'Lock now ends the remembered unlock');
});

test('using a login is not revealing it: no step-up to use or copy a plain login, Hello still guards showing the sensitive kinds', async () => {
  const r = rig('vault-use', { mode: 'until-sign-out' });
  const first = r.make();
  await first.store.setUp('correct horse battery', true);
  const login = await first.secrets.add({ name: 'NAS login', kind: 'password', value: 'hunter2-secret', username: 'root' });
  const key = await first.secrets.add({ name: 'Server key', kind: 'api-key', value: 'api-key-value-123456' });
  await tick();

  // After a remembered reopen (no fresh check): using any login works, copying a plain login works, showing a
  // sensitive kind still asks.
  const second = r.make();
  assert.equal(await second.store.tryRememberedUnlock(), true);
  assert.deepEqual(await second.secrets.useValue(login.id), { username: 'root', value: 'hunter2-secret' }, 'a machine login is used without a step-up');
  assert.deepEqual(await second.secrets.useValue(key.id), { username: '', value: 'api-key-value-123456' }, 'even a key used to connect is used, not revealed: no step-up');
  const copied = await second.secrets.copy(login.id);
  assert.equal(r.clipboard.text, 'hunter2-secret', 'copying a plain login needs no prompt');
  assert.equal(typeof copied.seconds, 'number');
  await assert.rejects(() => second.secrets.reveal(key.id), /Step-up needed/, 'showing a sensitive kind still steps up');
  await assert.rejects(() => second.secrets.copy(key.id), /Step-up needed/, 'copying a sensitive kind still steps up');

  // Locked, using is refused like everything else.
  second.store.lock();
  await assert.rejects(() => second.secrets.useValue(login.id), /locked/, 'using a login still needs Secrets unlocked');
});

test('changing the choice while open works the period out again from when it began', async () => {
  const r = rig('vault-refresh', { mode: '8h' });
  const first = r.make();
  await first.store.setUp('correct horse battery', true);
  await tick();
  r.advance(2 * 3600_000);
  r.setMode('1h');
  first.store.refreshRemembered();
  assert.equal(first.store.unlocked, false, 'a shorter choice that has already passed locks now');
  assert.equal(existsSync(r.storeFile), false, 'and the remembered unlock goes');

  const second = r.make();
  await second.store.unlockWithPassword('correct horse battery');
  await tick();
  r.setMode('until-sign-out');
  second.store.refreshRemembered();
  assert.equal(second.store.unlocked, true, 'until sign-out keeps it open');
  const third = r.make();
  third.store.close();
  assert.equal(await third.store.tryRememberedUnlock(), true, 'and a restart reopens with no time limit');

  r.setMode('strict');
  third.store.refreshRemembered();
  await tick();
  assert.equal(existsSync(r.storeFile), false, 'choosing the strict minutes takes the remembered unlock away');
  assert.equal(await r.make().store.tryRememberedUnlock(), false);
});

test('step-up asks for the sensitive kinds only, lasts 5 minutes, and guards the password and Hello set-up', async () => {
  const r = rig('vault-c', { mode: '8h' });
  const first = r.make();
  await first.store.setUp('correct horse battery', true);
  const kinds = { password: 'pw-value-1', passcode: '4821', licence: 'ABCD-1234-EFGH', bank: '12345678', card: '4111111111111111', 'api-key': 'api-key-value-123456', 'private-key': '-----BEGIN PRIVATE KEY----- abc' };
  const ids = {};
  for (const [kind, value] of Object.entries(kinds)) ids[kind] = (await first.secrets.add({ name: kind, kind, value })).id;
  await tick();

  // After a remembered reopen there has been no fresh check: the ordinary kinds open, the sensitive kinds ask.
  const second = r.make();
  assert.equal(await second.store.tryRememberedUnlock(), true);
  for (const kind of ['password', 'passcode', 'licence']) assert.equal((await second.secrets.reveal(ids[kind])).value, kinds[kind], `${kind} needs no step-up`);
  for (const kind of ['bank', 'card', 'api-key', 'private-key']) {
    await assert.rejects(() => second.secrets.reveal(ids[kind]), /Step-up needed/, `${kind} reveal steps up`);
    await assert.rejects(() => second.secrets.copy(ids[kind]), /Step-up needed/, `${kind} copy steps up`);
  }
  await assert.rejects(() => second.store.changePassword('a brand new passphrase'), /Step-up needed/, 'changing the recovery password steps up');
  await assert.rejects(() => second.store.addThisPc(), /Step-up needed/, 'changing the Windows Hello set-up steps up');

  // A wrong password does not step up; the right one does, for 5 minutes.
  await assert.rejects(() => second.store.stepUpWithPassword('wrong password!'), /isn’t the recovery password/);
  await assert.rejects(() => second.secrets.reveal(ids.bank), /Step-up needed/);
  await second.store.stepUpWithPassword('correct horse battery');
  assert.equal((await second.secrets.reveal(ids.bank)).value, kinds.bank);
  r.advance(4 * 60_000);
  assert.equal((await second.secrets.reveal(ids.card)).value, kinds.card, 'still inside the 5 minutes');
  r.advance(2 * 60_000);
  await assert.rejects(() => second.secrets.reveal(ids.bank), /Step-up needed/, 'after 5 minutes it asks again');

  // Windows Hello steps up too.
  await second.store.stepUpWithHello();
  assert.equal((await second.secrets.reveal(ids['api-key'])).value, kinds['api-key']);
});

test('a copied secret and a locked link leave the clipboard after their time, and not if something else was copied', async () => {
  const r = rig('vault-d', { mode: '8h' });
  const { store, secrets } = r.make();
  await store.setUp('correct horse battery', true);
  const pw = await secrets.add({ name: 'Email', kind: 'password', value: 'hunter2-secret' });
  await secrets.copy(pw.id);
  assert.equal(r.clipboard.text, 'hunter2-secret');
  await new Promise((res) => setTimeout(res, 60));
  assert.equal(r.clipboard.text, '', 'cleared after its time');

  await secrets.copy(pw.id);
  r.clipboard.text = 'something the person copied since';
  await new Promise((res) => setTimeout(res, 60));
  assert.equal(r.clipboard.text, 'something the person copied since', 'never clears what is no longer ours');

  const { seconds } = await secrets.copyLockedLink(pw.id);
  assert.equal(r.clipboard.text, `[locked](secret:${pw.id})`);
  assert.equal(typeof seconds, 'number');
  await new Promise((res) => setTimeout(res, 60));
  assert.equal(r.clipboard.text, '', 'a locked link clears after its time too');

  // Quitting takes a copied secret back at once (the app calls this on close).
  await secrets.copy(pw.id);
  secrets.clearClipboardNow();
  await tick();
  assert.equal(r.clipboard.text, '');
});

test('a shorter choice made later shortens a saved unlock; a longer one does not stretch it', async () => {
  const r = rig('vault-e', { mode: '8h' });
  const first = r.make();
  await first.store.setUp('correct horse battery', true);
  await tick();
  r.advance(2 * 3600_000);
  r.setMode('1h');
  assert.equal(await r.make().store.tryRememberedUnlock(), false, 'the 1-hour choice ends a saved 8-hour unlock after 2 hours');
  assert.equal(existsSync(r.storeFile), false);
});

test('the settings choices: default until sign-out (8.5), only the named choices kept, the full minutes range allowed', () => {
  assert.equal(PF.DEFAULT_PREFS.secretsKeepUnlocked, 'until-sign-out', 'the default is now until Windows sign-out');
  assert.equal(PF.DEFAULT_PREFS.secretsLockOnWindowsLock, false, 'locking on Windows lock or sleep is off by default');
  assert.deepEqual(PF.SECRETS_KEEP_UNLOCKED.map((o) => o.id), ['1h', '4h', '8h', 'until-sign-out', 'strict']);
  assert.equal(PF.mergePrefs(PF.DEFAULT_PREFS, { secretsKeepUnlocked: '4h' }).secretsKeepUnlocked, '4h');
  assert.equal(PF.mergePrefs(PF.DEFAULT_PREFS, { secretsKeepUnlocked: '4h', secretsKeepUnlockedChosen: true }).secretsKeepUnlockedChosen, true, 'picking a time in Settings is recorded as a choice (the Settings row sends the flag, as the other chosen flags work)');
  assert.equal(PF.mergePrefs(PF.DEFAULT_PREFS, { secretsKeepUnlocked: '24h' }).secretsKeepUnlocked, 'until-sign-out', 'a choice that is not offered is not kept');
  assert.equal(PF.mergePrefs(PF.DEFAULT_PREFS, { secretsKeepUnlocked: 'forever' }).secretsKeepUnlocked, 'until-sign-out');
  assert.equal(PF.mergePrefs(PF.DEFAULT_PREFS, { privateLockMinutes: 240 }).privateLockMinutes, 240, 'the stored range allows up to 240 minutes');
  assert.equal(PF.mergePrefs(PF.DEFAULT_PREFS, { privateLockMinutes: 999 }).privateLockMinutes, 240);
  assert.equal(PF.loadPrefs({}).secretsKeepUnlocked, 'until-sign-out', 'older settings get the new default');
  assert.equal(PF.loadPrefs({ secretsKeepUnlocked: '8h' }).secretsKeepUnlocked, 'until-sign-out', 'a stored 8 hours that was only the old default moves to the new default');
  assert.equal(PF.loadPrefs({ secretsKeepUnlocked: '8h', secretsKeepUnlockedChosen: true }).secretsKeepUnlocked, '8h', 'a time the person picked stays theirs');
  assert.equal(PF.loadPrefs({ secretsKeepUnlocked: '1h', secretsKeepUnlockedChosen: true }).secretsKeepUnlocked, '1h');
  assert.equal(PF.mergePrefs(PF.DEFAULT_PREFS, { secretsLockOnWindowsLock: true }).secretsLockOnWindowsLock, true, 'locking on Windows lock or sleep can be turned on');
  assert.equal(PF.unlockedPhrase('until-sign-out', 10), 'until you sign out of Windows');
  assert.equal(PF.unlockedPhrase('8h', 10), 'for 8 hours from when you unlocked');
  assert.equal(PF.unlockedPhrase('strict', 10), 'until 10 minutes with no use have passed');
  assert.equal(PF.unlockedPhrase('strict', 0), 'until Ironleaf closes');
  assert.ok(SS.isStepUpKind('bank') && SS.isStepUpKind('card') && SS.isStepUpKind('private-key') && SS.isStepUpKind('api-key'));
  assert.ok(!SS.isStepUpKind('password') && !SS.isStepUpKind('passcode') && !SS.isStepUpKind('licence') && !SS.isStepUpKind('other'));
});

test('the app wiring (8.5): opening a vault does not wipe the remembered unlock, leave-locking reads the setting, sign-out locks, a machine login is used not revealed', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  const openVault = app.slice(app.indexOf('async function openVault'), app.indexOf('void privateNotes.tryRememberedUnlock()', app.indexOf('async function openVault')));
  assert.ok(openVault.includes('privateNotes.close()') && !openVault.includes('privateNotes.lock()'), 'openVault closes (memory only) before the remembered unlock is checked, never locks');
  assert.ok(app.includes("watchLockEvents(powerMonitor, () => privateNotes.lock(), () => settings.raw.prefs.secretsLockOnWindowsLock)"), 'Windows lock and sleep lock only when the person turned it on');
  assert.ok(app.includes("watchSignOutEvents(powerMonitor, () => privateNotes.lock())"), 'signing out of Windows locks');
  assert.ok(app.includes("next.on('session-end', () => privateNotes.lock())"), 'the window’s session-end (sign-out, shutdown) locks too');
  assert.ok(app.includes('login: async (id) => secrets.useValue(id)'), 'a machine’s login is used, not revealed');
  assert.ok(app.includes("path.join(host.dataDir, 'remembered-unlock.json')"), 'the sealed remembered unlock is kept in the host’s data, outside the vault');
});
