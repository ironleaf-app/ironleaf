// node --test tests/reminder-one-home.test.mjs — one home for new reminders (src/shared/reminders.ts, 10.0
// papercuts): every new reminder goes to Reminders.md whatever door makes it (a named note still wins), while the
// same-or-near checks still span the Inbox's old ones, so nothing reminds twice.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-rem-home-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/reminders.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a new reminder goes to the one home, a named note still winning', () => {
  assert.equal(R.REMINDER_HOME, 'Reminders.md');
  assert.equal(R.resolveReminderHome(), 'Reminders.md');
  assert.equal(R.resolveReminderHome('  '), 'Reminders.md');
  assert.equal(R.resolveReminderHome(null), 'Reminders.md');
  assert.equal(R.resolveReminderHome('Projects/Harbour.md'), 'Projects/Harbour.md');
  assert.deepEqual(R.REMINDER_HOMES, ['Reminders.md', 'Inbox.md']);
});

test('the same reminder in the Inbox is still already set, not written twice', () => {
  const due = new Date(2026, 10, 5, 9, 0);
  const line = R.reminderLine('Order the flour', due);
  const notes = [
    { path: 'Reminders.md', content: '# Reminders\n' },
    { path: 'Inbox.md', content: `# Inbox\n\n${line}\n` },
  ];
  assert.equal(R.findSameReminder(notes, 'Order the flour', due), 'Inbox.md');
  const near = R.nearReminder(notes, 'Order more flour', new Date(2026, 10, 5, 9, 3));
  assert.ok(near && near.path === 'Inbox.md', JSON.stringify(near));
  assert.equal(R.findSameReminder(notes, 'Something else entirely', due), null);
});
