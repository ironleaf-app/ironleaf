// node --test tests/email-note.test.mjs — An email as a note (t243 vault front door, 12 Nov 2026).
// A landed email keeps from, to, cc, date, subject and attachments as fields (src/shared/email-note.ts), its
// sender matched to a person by address or made a stranger card (organisation from the domain), its words and
// attachments in the body. A repeat PDF is the same document again (src/shared/doc-versions.ts sameDocument),
// so it becomes the next version, never a second document. Made-up mail only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-email-note-'));
let N;
let D;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/email-note.ts'))};\n` + `export * as docs from ${JSON.stringify(path.join(root, 'src/shared/doc-versions.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 'n.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  const all = await import(pathToFileURL(path.join(work, 'n.mjs')).href);
  N = all;
  D = all.docs;
});
after(() => rmSync(work, { recursive: true, force: true }));

const EMAIL = { from: 'June Park <june.park@example.invalid>', to: 'Alex Chen <alex.chen@example.invalid>', cc: '', date: 'Tue, 10 Nov 2026 09:14:00 +1100', subject: 'Awning quote lapses Friday', words: 'ShadeCo quoted twelve hundred fitted.', files: [{ name: 'ShadeCo-quote.pdf', kind: 'PDF', size: 2048 }] };

test('the note keeps every field, links its sender, and embeds its attachments', () => {
  const text = N.emailNoteText(EMAIL, { sender: 'June Park' });
  assert.match(text, /^type: email$/m);
  assert.match(text, /^subject: Awning quote lapses Friday$/m);
  assert.match(text, /^email_from: "June Park <june\.park@example\.invalid>"$/m);
  assert.match(text, /^email_to: "Alex Chen <alex\.chen@example\.invalid>"$/m);
  assert.ok(!/^email_cc:/m.test(text), 'no cc, no field');
  assert.match(text, /^email_date: "Tue, 10 Nov 2026 09:14:00 \+1100"$/m);
  assert.match(text, /^sender: "\[\[June Park\]\]"$/m, 'the sender as a typed link');
  assert.match(text, /^# Awning quote lapses Friday$/m, 'the subject as its title');
  assert.match(text, /^From June Park$/m, 'who it is from, plainly (the date stays in the fields)');
  assert.match(text, /ShadeCo quoted twelve hundred fitted\./);
  assert.match(text, /^- !\[\[ShadeCo-quote\.pdf\]\] \(PDF, 2 KB\)$/m);
  const filed = N.emailNoteText(EMAIL, { sender: 'June Park', project: 'Harbourline Cart Fix' });
  assert.match(filed, /^project: "\[\[Harbourline Cart Fix\]\]"$/m, 'filed: the project as a typed link');
});

test('facts read back; only email notes are email notes', () => {
  const facts = N.readEmailFacts({ type: 'email', subject: 'Hi', email_from: 'a@b', project: '[[X]]' });
  assert.equal(facts.subject, 'Hi');
  assert.equal(facts.from, 'a@b');
  assert.equal(facts.project, '[[X]]');
  assert.equal(N.isEmailProps({ type: 'email' }), true);
  assert.equal(N.isEmailProps({ type: 'note' }), false);
  assert.equal(N.isEmailProps(undefined), false);
});

test('the sender matches a card by address, case-insensitively', () => {
  const people = [
    { title: 'June Park', path: 'People/June Park.md', email: 'june.park@example.invalid' },
    { title: 'Sam Ortega', path: 'People/Sam Ortega.md', email: 'Sam@example.invalid' },
  ];
  assert.equal(N.matchPersonByAddress(people, 'June Park <JUNE.PARK@example.invalid>')?.title, 'June Park');
  assert.equal(N.matchPersonByAddress(people, 'sam@example.invalid')?.title, 'Sam Ortega');
  assert.equal(N.matchPersonByAddress(people, 'stranger@example.invalid'), null);
  assert.equal(N.matchPersonByAddress(people, 'no address'), null);
  assert.equal(N.matchPersonByAddress([], 'sam@example.invalid'), null);
});

test('a stranger is named plainly, their organisation from the domain', () => {
  assert.equal(N.strangerName('June Park <june@example.invalid>'), 'June Park');
  assert.equal(N.strangerName('june.park@shadeco.example'), 'June Park');
  assert.equal(N.strangerName('ops@shadeco.example'), 'ops@shadeco.example', 'an opaque local part stays the address');
  assert.equal(N.strangerOrg('Ava Nguyen <ava@shadeco.example>'), 'Shadeco');
  assert.equal(N.strangerOrg('someone@outlook.com'), undefined, 'free mail names no organisation');
  assert.equal(N.strangerOrg('no address'), undefined);
});

test('the file stem is the subject, else who it is from, always file-safe', () => {
  assert.equal(N.emailFileStem('Awning quote lapses Friday', 'a@b'), 'Awning quote lapses Friday');
  assert.equal(N.emailFileStem('', 'June Park <june@example.invalid>'), 'Email from June Park');
  assert.equal(N.emailFileStem('A/B: "quoted" <name>?', 'a@b').includes('/'), false);
  assert.ok(N.emailFileStem('', '').length > 0);
});

test('a repeat PDF is the same document; another document is not', () => {
  assert.equal(D.sameDocument('ShadeCo quote v2.pdf', 'ShadeCo quote.pdf'), true);
  assert.equal(D.sameDocument('ShadeCo-quote (2).pdf', 'ShadeCo quote.pdf'), true);
  assert.equal(D.sameDocument('ShadeCo quote - final.pdf', 'ShadeCo quote.pdf'), true);
  assert.equal(D.sameDocument('ShadeCo quote 2026-11-10.pdf', 'ShadeCo quote.pdf'), true);
  assert.equal(D.sameDocument('ShadeCo invoice.pdf', 'ShadeCo quote.pdf'), false);
  assert.equal(D.sameDocument('v2.pdf', 'v2.pdf'), true, 'the same name twice is the same document');
  assert.equal(D.sameDocument('.pdf', '.pdf'), false, 'no identity, no match');
  assert.equal(D.documentIdentity('Projects/X/Files/ShadeCo_quote.pdf'), 'shadeco quote');
});
