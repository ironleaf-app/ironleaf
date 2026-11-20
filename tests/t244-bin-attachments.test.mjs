// node --test tests/t244-bin-attachments.test.mjs — an email note taken out takes its attachments with it
// (t244 break-it, 12 Nov 2026: deleting an unanswered email left its attachments orphaned in the Inbox — only the
// front door knew where they sit, so the Bin moved the note and left the folder behind). The front door's own
// rule (emailAttachmentsFor) now: the Bin moves it, brings it back, and says when it could not. Made-up mail.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t244-bin-'));
let B, E;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/main/bin.ts'))};\n` +
      `export * as emailNote from ${JSON.stringify(path.join(root, 'src/shared/email-note.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'b.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    (await import('node:fs')).symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  } catch {}
  const all = await import(pathToFileURL(path.join(work, 'b.mjs')).href);
  B = all;
  E = all.emailNote;
});
after(() => rmSync(work, { recursive: true, force: true }));

const EMAIL = (subject) => ['---', 'type: email', `subject: ${subject}`, 'email_from: June Park <june.park@example.invalid>', '---', `# ${subject}`, '', 'From June Park', '', 'ShadeCo quoted twelve hundred fitted.', ''].join('\n');
const PLAIN = '# A plain note\n\nJust words.\n';
function vault(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-t244-binvault-'));
  for (const [rel, text] of files) {
    const abs = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return dir;
}
const gone = (dir, rel) => !existsSync(path.join(dir, ...rel.split('/')));

test('the rule names an email’s folder wherever it landed', () => {
  assert.equal(E.emailAttachmentsFor('Inbox/Bank mail.md'), 'Inbox/Attachments/Bank mail');
  assert.equal(E.emailAttachmentsFor('Inbox/Done/Bank mail.md'), 'Inbox/Done/Bank mail');
  assert.equal(E.emailAttachmentsFor('Projects/Harbour/Harbour.md'.replace('Harbour.md', 'Notes/Bank mail.md')), 'Projects/Harbour/Files/Bank mail');
  assert.equal(E.emailAttachmentsFor('Notes/Loose.md'), null);
  assert.equal(E.emailAttachmentsFor('../Outside.md'), null);
  assert.ok(E.isEmailNoteText(EMAIL('Hi')), 'type: email reads');
  assert.ok(E.isEmailNoteText(EMAIL('Hi').replace('type: email', 'type: Email')), 'any case reads');
  assert.ok(!E.isEmailNoteText(PLAIN), 'a plain note is not an email');
  assert.ok(!E.isEmailNoteText('# No front matter\n\ntype: email\n'), 'body text is not front matter');
});

test('taking out an unanswered email takes its attachments with it, and brings them back', async () => {
  const dir = vault([
    ['Inbox/Bank mail.md', EMAIL('Bank mail')],
    ['Inbox/Attachments/Bank mail/quote.pdf', '%PDF-1.4 fake'],
    ['Inbox/Attachments/Bank mail/photo.png', 'fake'],
  ]);
  try {
    const bin = B.createVaultBin({ root: dir });
    const item = await bin.put('Inbox/Bank mail.md', { by: 'The side chat' });
    assert.equal(item.attachments, 'Inbox/Attachments/Bank mail');
    assert.ok(gone(dir, 'Inbox/Bank mail.md'), 'the note goes');
    assert.ok(gone(dir, 'Inbox/Attachments/Bank mail/quote.pdf'), 'its attachments go with it');
    assert.ok(gone(dir, 'Inbox/Attachments/Bank mail'), 'no empty folder left');
    const back = await bin.restore(item.id);
    assert.equal(back.restored, 'Inbox/Bank mail.md');
    assert.equal(readFileSync(path.join(dir, 'Inbox/Attachments/Bank mail/quote.pdf'), 'utf8'), '%PDF-1.4 fake', 'attachments home byte for byte');
    assert.match(B.restoredWords(back), /with its attachments in Inbox\/Attachments\/Bank mail/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a filed email’s attachments travel with it too', async () => {
  const dir = vault([
    ['Projects/Harbour/Notes/Bank mail.md', EMAIL('Bank mail')],
    ['Projects/Harbour/Files/Bank mail/quote.pdf', '%PDF-1.4 fake'],
  ]);
  try {
    const bin = B.createVaultBin({ root: dir });
    const item = await bin.put('Projects/Harbour/Notes/Bank mail.md', { by: 'The side chat' });
    assert.equal(item.attachments, 'Projects/Harbour/Files/Bank mail');
    assert.ok(gone(dir, 'Projects/Harbour/Files/Bank mail/quote.pdf'), 'filed attachments go with it');
    const back = await bin.restore(item.id);
    assert.equal(readFileSync(path.join(dir, 'Projects/Harbour/Files/Bank mail/quote.pdf'), 'utf8'), '%PDF-1.4 fake');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('any other note leaves a same-named attachments folder alone', async () => {
  const dir = vault([
    ['Inbox/Weekly update.md', PLAIN],
    ['Inbox/Attachments/Weekly update/old.pdf', '%PDF-1.4 fake'],
  ]);
  try {
    const bin = B.createVaultBin({ root: dir });
    const item = await bin.put('Inbox/Weekly update.md', { by: 'The side chat' });
    assert.equal(item.attachments, undefined, 'a plain note claims no attachments');
    assert.ok(!gone(dir, 'Inbox/Attachments/Weekly update/old.pdf'), 'the folder stands');
    await bin.restore(item.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('attachments that cannot move are said, not lost', async () => {
  const dir = vault([
    ['Inbox/Bank mail.md', EMAIL('Bank mail')],
    ['Inbox/Attachments/Bank mail/quote.pdf', '%PDF-1.4 fake'],
  ]);
  const { chmodSync } = await import('node:fs');
  try {
    // Their folder locked: the move fails, the note still goes, and the reply says they stayed.
    chmodSync(path.join(dir, 'Inbox/Attachments'), 0o555);
    const bin = B.createVaultBin({ root: dir });
    const item = await bin.put('Inbox/Bank mail.md', { by: 'The side chat' });
    assert.equal(item.attachments, undefined, 'nothing claimed that did not move');
    assert.equal(item.attachmentsLeftBehind, 'Inbox/Attachments/Bank mail');
    assert.match(B.binnedWords([item]), /attachments stayed in Inbox\/Attachments\/Bank mail/);
    chmodSync(path.join(dir, 'Inbox/Attachments'), 0o755);
    assert.match(B.restoredWords({ path: 'Inbox/Bank mail.md', title: 'Bank mail', restored: 'Inbox/Bank mail.md', renamed: false, attachmentsLeftBehind: 'Inbox/Attachments/Bank mail' }), /attachments .* could not come back/);
    const back = await bin.restore(item.id);
    assert.equal(back.restored, 'Inbox/Bank mail.md');
    assert.ok(!gone(dir, 'Inbox/Attachments/Bank mail/quote.pdf'), 'locked attachments stand where they were');
  } finally {
    try {
      chmodSync(path.join(dir, 'Inbox/Attachments'), 0o755);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test('restoring beside a newer note keeps the attachments beside the restored note', async () => {
  const dir = vault([
    ['Inbox/Bank mail.md', EMAIL('Bank mail')],
    ['Inbox/Attachments/Bank mail/quote.pdf', '%PDF-1.4 fake'],
  ]);
  try {
    const bin = B.createVaultBin({ root: dir });
    const item = await bin.put('Inbox/Bank mail.md', { by: 'The side chat' });
    mkdirSync(path.join(dir, 'Inbox'), { recursive: true });
    writeFileSync(path.join(dir, 'Inbox/Bank mail.md'), PLAIN, 'utf8');
    const back = await bin.restore(item.id);
    assert.ok(back.renamed, 'a newer note keeps its place');
    assert.ok(back.restored.startsWith('Inbox/Bank mail (restored'), `came back beside it: ${back.restored}`);
    assert.equal(back.attachments, `Inbox/Attachments/${back.restored.split('/').pop().replace(/\.md$/i, '')}`, 'attachments match the restored note’s name');
    assert.ok(!gone(dir, back.attachments + '/quote.pdf'), 'attachments beside the restored note');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
