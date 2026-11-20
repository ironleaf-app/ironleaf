// node --test tests/chat-attach.test.mjs — files attached to the assistant's chat (src/shared/chat-attach.ts; 19 Oct
// 2026). A made-up conversation about a Minecraft server: a screenshot of an error and the server's settings file are
// attached; what the model gets for each message, pictures newest first within one request, a model that can't see
// pictures told so, and what the chat window sends kept to its kinds and limits.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-chat-attach-'));
let A;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/chat-attach.ts'))};`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'a.mjs'), format: 'esm' }, logLevel: 'silent' });
  A = await import(pathToFileURL(path.join(work, 'a.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const shot = (name = 'error.png', data = png) => ({ id: 'p' + name, name, kind: 'image', size: 70, mediaType: 'image/png', data });
const settings = { id: 'd1', name: 'server.properties', kind: 'text', size: 900, text: 'server-port=19132\ndifficulty=easy', cut: false };

test('a message with a picture and a document: the document’s words, then the words; the picture as a picture', () => {
  const [t] = A.modelTurns([{ role: 'user', content: 'Why can’t my kids join?', attachments: [shot(), settings] }]);
  assert.match(t.text, /^<attached_file name="server\.properties">\nserver-port=19132\ndifficulty=easy\n<\/attached_file>\n\nWhy can’t my kids join\?$/);
  assert.deepEqual(t.images, [{ mediaType: 'image/png', data: png, name: 'error.png' }]);
  const cut = A.userText('Summarise', [{ ...settings, name: 'a "b" <c>.txt', cut: true }]);
  assert.match(cut, /<attached_file name="a &quot;b&quot; &lt;c>\.txt" cut="true">/, 'the name is kept safe inside the tag, a cut file marked');
  assert.equal(A.modelTurns([{ role: 'user', content: 'plain' }])[0].text, 'plain', 'a message with nothing attached is as it was');
  assert.equal(A.modelTurns([{ role: 'user', content: '', attachments: [settings] }])[0].text.endsWith('</attached_file>\n\n'), true, 'a file sent with no words');
});

test('pictures newest first while they fit one request; older ones named, never silently dropped', () => {
  const big = 'A'.repeat(4_000_000);
  const turns = A.modelTurns([
    { role: 'user', content: 'first', attachments: [shot('old.png', big)] },
    { role: 'assistant', content: 'It shows a timeout.' },
    { role: 'user', content: 'and now?', attachments: [shot('new.png', big)] },
  ]);
  assert.equal(turns[2].images?.length, 1, 'the newest picture goes');
  assert.equal(turns[0].images, undefined, 'the older one doesn’t fit with it');
  assert.match(turns[0].text, /Earlier in this conversation the person attached the picture “old\.png”; it is not sent again here\./);
  assert.equal(turns[1].text, 'It shows a timeout.');
});

test('documents newest first while they fit one request; older ones named', () => {
  const doc = (name) => ({ ...settings, id: name, name, text: 'w'.repeat(250_000) });
  const turns = A.modelTurns([{ role: 'user', content: 'read this', attachments: [doc('old.docx')] }, { role: 'assistant', content: 'Read.' }, { role: 'user', content: 'and this', attachments: [doc('new.docx')] }]);
  assert.match(turns[2].text, /<attached_file name="new\.docx">/);
  assert.ok(!turns[0].text.includes('<attached_file') && /attached “old\.docx”; its words are not sent again here/.test(turns[0].text), turns[0].text.slice(0, 200));
});

test('a model that can’t see pictures: none sent, and it is told the person attached one', () => {
  const [t] = A.modelTurns([{ role: 'user', content: 'what is this', attachments: [shot('a.png'), shot('b.png')] }], false);
  assert.equal(t.images, undefined);
  assert.match(t.text, /attached pictures, “a\.png”, “b\.png”, but the model answering can’t see pictures\. Say so plainly/);
});

test('a scan’s pages go as pictures, said as its pages', () => {
  const scan = { id: 's1', name: 'Signed lease.pdf', kind: 'pages', size: 900000, pages: [{ mediaType: 'image/jpeg', data: png }, { mediaType: 'image/jpeg', data: png }], pageCount: 9, cut: true };
  const [t] = A.modelTurns([{ role: 'user', content: 'When does the lease end?', attachments: [scan] }]);
  assert.deepEqual(t.images.map((i) => i.name), ['Signed lease.pdf — page 1', 'Signed lease.pdf — page 2']);
  assert.match(t.text, /“Signed lease\.pdf” is a PDF with no words of its own, a scan: its 2 pages come as pictures \(the first 2 of its 9 pages\)/);
  const [blind] = A.modelTurns([{ role: 'user', content: 'q', attachments: [scan] }], false);
  assert.ok(!blind.images && /can’t see pictures/.test(blind.text), 'a model that can’t see pictures is told, as for a picture');
  const kept = A.cleanAttachments([{ ...scan, pages: [...Array(9)].map(() => ({ mediaType: 'image/jpeg', data: png })).concat([{ mediaType: 'text/html', data: 'x' }]) }]);
  assert.equal(kept[0].pages.length, A.ATTACH_LIMITS.scanPages, 'at most so many pages');
  assert.equal(kept[0].pageCount, 9);
  const many = A.modelTurns([{ role: 'user', content: 'q', attachments: [1, 2, 3, 4].map((i) => ({ ...scan, id: 'm' + i, name: `Scan ${i}.pdf`, pages: [...Array(6)].map(() => ({ mediaType: 'image/jpeg', data: png })) })) }])[0];
  assert.equal(many.images.length, A.ATTACH_LIMITS.messagePictures, 'at most so many pictures with one message');
  assert.match(many.text, /^\(Only the first 20 pictures of this message are sent; not sent: “Scan 4\.pdf — page 3”, “Scan 4\.pdf — page 4”/, 'the rest named');
});

test('what the chat window sends is kept to its kinds and limits', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ ...settings, id: 'x' + i }));
  assert.equal(A.cleanAttachments(many).length, A.ATTACH_LIMITS.perMessage, 'ten files a message at most');
  assert.deepEqual(A.cleanAttachments('nope'), []);
  const kept = A.cleanAttachments([shot(), { ...shot(), mediaType: 'image/svg+xml' }, { ...shot(), data: '<script>' }, { kind: 'exe', name: 'x' }, { ...settings, text: 'w'.repeat(200_000) }]);
  assert.deepEqual(kept.map((a) => a.kind), ['image', 'text'], 'only PNG/JPEG/GIF/WebP pictures in base64 and documents’ words');
  assert.equal(kept[1].text.length, A.ATTACH_LIMITS.docChars);
  assert.equal(kept[1].cut, true, 'a document cut to fit is marked');
  const total = A.cleanAttachments([1, 2, 3].map((i) => ({ ...settings, id: 't' + i, text: 'w'.repeat(120_000) })));
  assert.equal(total.reduce((n, a) => n + a.text.length, 0), A.ATTACH_LIMITS.messageChars, 'every document’s words together, at most so many');
});

test('pictures the chat draws: what the app can open', () => {
  assert.ok(A.isPicture('Screenshot 2026-10-19.png') && A.isPicture('photo.JPG') && A.isPicture('x', 'image/webp'));
  assert.ok(!A.isPicture('scan.heic') && !A.isPicture('quote.pdf') && !A.isPicture('logo.svg'));
});
