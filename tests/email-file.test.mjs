// node --test tests/email-file.test.mjs — A saved email as its parts (t243 vault front door, 12 Nov 2026). .eml
// (new Outlook, Gmail, Apple Mail) and .msg (classic Outlook) read as who it is from and to, when, the subject,
// the words and its attachments with their bytes (src/shared/email-file.ts, adapted from the former host app's
// own readers), so the Vault keeps an email with its fields, its sender matched to a person, its attachments as
// files on it. Damaged files read as null, never throw past the door. Made-up mail only; the one .msg is Apache
// POI's public test email (tests/fixtures/SOURCE.txt, Apache-2.0, never shipped).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-email-file-'));
let E;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/email-file.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'e.mjs'), format: 'esm' }, logLevel: 'silent' });
  E = await import(pathToFileURL(path.join(work, 'e.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const bytes = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));
const QUOTE_PDF = Buffer.from('%PDF-1.4 fake quote bytes for the awning', 'latin1').toString('base64');
const EML = [
  'From: June Park <june.park@example.invalid>',
  'To: Alex Chen <alex.chen@example.invalid>, sam@example.invalid',
  'Cc: Priya Nair <priya@example.invalid>',
  'Date: Tue, 10 Nov 2026 09:14:00 +1100',
  'Subject: Awning quote lapses Friday',
  'Content-Type: multipart/mixed; boundary="abc"',
  '',
  '--abc',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'ShadeCo quoted twelve hundred fitted. Ring them before Friday.',
  '',
  '--abc',
  'Content-Type: application/pdf; name="ShadeCo-quote.pdf"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="ShadeCo-quote.pdf"',
  '',
  QUOTE_PDF,
  '--abc--',
  '',
].join('\r\n');

test('a .eml reads as from, to, cc, date, subject, words and its attachment’s bytes', () => {
  const e = E.readEmailFile('quote.eml', bytes(EML));
  assert.ok(e, 'it reads');
  assert.equal(e.from, 'June Park <june.park@example.invalid>');
  assert.equal(e.to, 'Alex Chen <alex.chen@example.invalid>, sam@example.invalid');
  assert.equal(e.cc, 'Priya Nair <priya@example.invalid>');
  assert.equal(e.date, 'Tue, 10 Nov 2026 09:14:00 +1100');
  assert.equal(e.subject, 'Awning quote lapses Friday');
  assert.match(e.words, /twelve hundred fitted/);
  assert.equal(e.files.length, 1);
  assert.equal(e.files[0].name, 'ShadeCo-quote.pdf');
  assert.equal(e.files[0].kind, 'PDF');
  assert.equal(Buffer.from(e.files[0].data).toString('latin1'), '%PDF-1.4 fake quote bytes for the awning');
  assert.equal(e.files[0].inline, false);
});

test('encoded words, HTML-only and quoted-printable bodies read as words', () => {
  const coded = E.readEmailFile('a.eml', bytes('From: a@example.invalid\r\nSubject: =?utf-8?B?VGhlIGF3bmluZyBxdW90ZQ==?=\r\nContent-Type: text/plain\r\n\r\nHi.\r\n'));
  assert.equal(coded.subject, 'The awning quote');
  const html = E.readEmailFile('b.eml', bytes('From: a@example.invalid\r\nSubject: x\r\nContent-Type: multipart/alternative; boundary="q"\r\n\r\n--q\r\nContent-Type: text/html\r\n\r\n<p>Ring <b>ShadeCo</b> today</p>\r\n--q--\r\n'));
  assert.equal(html.words, 'Ring ShadeCo today');
  const qp = E.readEmailFile('c.eml', bytes('From: a@example.invalid\r\nSubject: x\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nTwelve=C2=A0hun=\r\ndred fitted.\r\n'));
  assert.match(qp.words, /Twelve.*hundred fitted/s);
});

test('a forwarded email inside keeps its headers and words', () => {
  const fwd = E.readEmailFile('f.eml', bytes('From: me@example.invalid\r\nSubject: Fwd: quote\r\nContent-Type: multipart/mixed; boundary="z"\r\n\r\n--z\r\nContent-Type: text/plain\r\n\r\nSee below.\r\n\r\n--z\r\nContent-Type: message/rfc822\r\n\r\nFrom: ShadeCo <sales@shadeco.example>\r\nSubject: Your awning quote\r\n\r\nTwelve hundred fitted.\r\n--z--\r\n'));
  assert.match(fwd.words, /Forwarded email/);
  assert.match(fwd.words, /From: ShadeCo/);
  assert.match(fwd.words, /Twelve hundred fitted/);
});

test('a .msg reads as its parts (Apache POI’s public test email)', () => {
  const raw = new Uint8Array(readFileSync(path.join(root, 'tests', 'fixtures', 'example_received_unicode.msg')));
  const e = E.readEmailFile('Test.msg', raw);
  assert.ok(e, 'it reads');
  assert.equal(e.from, 'Mike Farman <mike.farman@alfresco.com>');
  assert.equal(e.to, 'Ashutosh Dandavate <ashutosh.dandavate@alfresco.com>; Paul Holmes-Higgin <paul.hh@alfresco.com>; Mike Farman <mikef@alfresco.com>');
  assert.match(e.cc, /^nickb@alfresco.com/);
  assert.match(e.date, /Jan 2010/);
  assert.equal(e.subject, 'This is a test message please ignore');
  assert.match(e.words, /The quick brown fox jumps over the lazy dog/);
  assert.equal(e.files.length, 1, 'its picture');
  assert.equal(e.files[0].name, 'alfresco.gif');
  assert.equal(e.files[0].kind, 'picture');
  assert.equal(e.files[0].inline, false, 'as the host app reads it: attached, not inline');
});

test('the message id rides along for the landing-once check (t244)', () => {
  const withId = E.readEmailFile('a.eml', bytes('From: a@example.invalid\r\nMessage-ID: <abc-123@example.invalid>\r\nSubject: x\r\nContent-Type: text/plain\r\n\r\nHi.\r\n'));
  assert.equal(withId.messageId, '<abc-123@example.invalid>');
  const without = E.readEmailFile('b.eml', bytes('From: a@example.invalid\r\nSubject: x\r\nContent-Type: text/plain\r\n\r\nHi.\r\n'));
  assert.equal(without.messageId, '', 'mail without one lands as it always did');
  const raw = new Uint8Array(readFileSync(path.join(root, 'tests', 'fixtures', 'example_received_unicode.msg')));
  assert.ok(E.readEmailFile('Test.msg', raw).messageId, 'a .msg carries its internet id too');
});

test('damaged files read as null through the door, never throw', () => {
  assert.equal(E.readEmailFile('x.eml', bytes('not an email at all\r\njust words\r\n')), null);
  assert.equal(E.readEmailFile('x.msg', bytes('not a compound file, far too short')), null);
  assert.equal(E.readEmailFile('x.msg', new Uint8Array(600)), null);
  assert.equal(E.readEmailFile('x.txt', bytes(EML))?.subject, 'Awning quote lapses Friday', 'an unknown suffix still reads as mail');
  assert.equal(E.isEmailFileName('quote.EML'), true);
  assert.equal(E.isEmailFileName('quote.msg'), true);
  assert.equal(E.isEmailFileName('quote.pdf'), false);
  assert.equal(E.isPdfFileName('quote.PDF'), true);
  assert.equal(E.isOleFile(new Uint8Array(100)), false);
});

test('addresses split into who each is', () => {
  assert.deepEqual(E.splitAddresses('June Park <june.park@example.invalid>, sam@example.invalid'), [{ name: 'June Park', address: 'june.park@example.invalid' }, { name: '', address: 'sam@example.invalid' }]);
  assert.deepEqual(E.splitAddresses('"Park, June" <june@example.invalid>'), [{ name: 'Park, June', address: 'june@example.invalid' }]);
  assert.equal(E.senderName('June Park <june@example.invalid>'), 'June Park');
  assert.equal(E.senderName('june@example.invalid'), 'june@example.invalid');
  assert.equal(E.senderAddress('June Park <June@Example.Invalid>'), 'june@example.invalid');
  assert.equal(E.senderAddress('no address here'), '');
});

test('attachment kinds and sizes read plain', () => {
  assert.equal(E.attachmentKind('application/pdf', 'q.pdf'), 'PDF');
  assert.equal(E.attachmentKind('', 'deck.pptx'), 'PowerPoint deck');
  assert.equal(E.attachmentKind('', 'note.msg'), 'email');
  assert.equal(E.sizeWords(89), '89 bytes');
  assert.equal(E.sizeWords(2048), '2 KB');
  assert.equal(E.attachmentName('../../evil.pdf', 0), '__.._evil.pdf');
});

test('compressed RTF bodies read as text', () => {
  // "MELA": stored as is.
  const stored = new Uint8Array(16 + 12);
  new DataView(stored.buffer).setUint32(4, 12, true);
  new DataView(stored.buffer).setUint32(8, 0x414c454d, true);
  stored.set(bytes('{\\rtf hello}'), 16);
  assert.equal(E.rtfText(E.decompressRtf(stored)), 'hello');
  assert.equal(E.decompressRtf(new Uint8Array(4)), null);
  assert.equal(E.rtfText('not rtf'), null);
});
