// node --test tests/share.test.mjs — Share a page (8.8, 31 Oct 2026): The former host app is local-first, so a page
// shares as a clean copy, never a live link. A Share menu on every page's top bar (src/shared/share.ts, the renderer
// in src/renderer/src/state/share.ts, the main side in src/main/app.ts): Save as PDF, Copy as formatted text, Save as
// Markdown (a zip with its attachments when it has any) and Email it (the person's mail program with the PDF attached,
// never sent by itself). Private notes and Secrets never appear in a shared copy: a linked secret shows as "(a secret,
// not shared)". On a made-up household fixture (a lemon cake: headings, a table, a picture, a link, a secret link, a
// private embed and a private link): each output keeps the first five and excludes the last three.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-share-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/share.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'share.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'share.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// The fixture note: headings, a table, a picture, a link and a secret link, plus a private embed and a private link.
const NOTE = `---
type: recipe
sensitivity: open
---

# Lemon cake

A plain cake for Sunday afternoons.

## Ingredients

| What | How much |
| --- | --- |
| Flour | 300 g |
| Sugar | 200 g |

![The cake](Photos/cake.png)

See [[Icing]] for the topping and [the mill's flour guide](https://example.com/flour).

- [ ] Buy lemons
- [x] Heat the oven

Oven code: [locked](secret:AbC123xYz9) and the alarm: [alarm](secret:DeF456uVw7).

![[Private notes/Diary]]

The diary is in [[Private notes/Diary]] and [the diary file](Private%20notes/Diary.md).
`;

test('a linked secret shows as "(a secret, not shared)", never its value or id', () => {
  const out = S.withoutSecrets(NOTE);
  assert.ok(!out.includes('secret:'), 'no secret link left');
  assert.ok(!out.includes('AbC123xYz9') && !out.includes('DeF456uVw7'), 'no secret id left');
  assert.equal(out.split(S.SECRET_STANDIN).length - 1, 2, 'each secret link becomes the stand-in');
  assert.ok(out.includes('Oven code: (a secret, not shared)'), 'in place, in the sentence');
  assert.ok(out.includes('See [[Icing]]'), 'ordinary links untouched');
});

test('private notes never appear: embeds dropped, links become the private stand-in', () => {
  const out = S.withoutPrivate(NOTE, (t) => t);
  assert.ok(!out.includes('Private notes') && !out.includes('Diary'), 'no private path or name left');
  assert.ok(!out.includes('![['), 'the private embed is gone');
  assert.ok(!out.includes('[[Private'), 'the private wikilink is gone');
  assert.ok(out.includes(`The diary is in ${S.PRIVATE_STANDIN}`), 'a private link keeps neither words nor name');
  assert.ok(out.includes(S.PRIVATE_STANDIN) && !out.includes('Private%20notes'), 'a private file link too');
  assert.ok(out.includes('See [[Icing]]'), 'a link to an ordinary note is kept');
  assert.ok(!/\n{3,}/.test(out), 'no holes left where embeds were');
});

test('the shared body reads as the page: no properties, secrets and private notes out', () => {
  const body = S.shareBody(NOTE, { resolve: (t) => t });
  assert.ok(!body.includes('sensitivity:'), 'the properties are not shared');
  assert.ok(body.includes('# Lemon cake'), 'headings kept');
  assert.ok(body.includes('| Flour | 300 g |'), 'the table kept');
  assert.ok(body.includes('![The cake](Photos/cake.png)'), 'the picture kept');
  assert.ok(body.includes('[the mill\u2019s flour guide](https://example.com/flour)') || body.includes("flour guide"), 'the link kept');
  assert.ok(body.includes(S.SECRET_STANDIN), 'the secret as the stand-in');
  assert.ok(!body.includes('secret:') && !body.includes('Private notes'), 'nothing private left');
});

test('Save as Markdown is the file as is, with secrets and private notes taken out', () => {
  const file = S.shareMarkdownFile(NOTE, { resolve: (t) => t });
  assert.ok(file.includes('type: recipe'), 'the file as is, properties kept');
  assert.ok(file.includes(S.SECRET_STANDIN) && !file.includes('secret:'), 'secrets as the stand-in');
  assert.ok(!file.includes('Private notes'), 'private notes out');
});

test('attachments are the files the note carries: pictures and documents, never notes or secrets', () => {
  const rels = S.attachmentsOf(`${NOTE}\n[Quote](Files/quote.pdf) and [[Icing]] and ![[Photos/cake.png]]`, { resolve: (t) => t });
  assert.ok(rels.includes('Photos/cake.png'), 'the picture');
  assert.ok(rels.includes('Files/quote.pdf'), 'the document');
  assert.ok(!rels.some((r) => r.endsWith('.md') || /secret:/i.test(r) || r.startsWith('http')), 'no notes, secrets or web links');
  assert.ok(!rels.some((r) => r.includes('Private notes')), 'nothing private');
  assert.deepEqual([...new Set(rels)], rels, 'each file once');
});

test('Copy as formatted text keeps headings, lists and tables; pictures, links and the stand-in', () => {
  const html = S.shareHtml('Lemon cake', NOTE, { resolve: (t) => t, url: (r) => `file:///${r}` });
  for (const want of ['<h1', '<h2', '<table', '<ul', '<li', 'Buy lemons', 'Flour', '300 g']) assert.ok(html.includes(want), `kept: ${want}`);
  assert.ok(html.includes('<img') && html.includes('cake.png'), 'the picture kept');
  assert.ok(html.includes('https://example.com/flour'), 'the web link kept');
  assert.ok(html.includes('Icing') && !html.includes('[['), 'the note link as words');
  assert.ok(html.includes(S.SECRET_STANDIN) && !html.includes('secret:'), 'the secret as the stand-in');
  assert.ok(!html.includes('Private notes') && !html.includes('Diary'), 'nothing private');
  assert.ok(!html.includes('<script') && !html.includes('javascript:'), 'safe to paste');
});

// n4-minutes-pdf fault 1 (6 Nov 2026, the branded PDF printed "[[David Kim]]" raw): the formatted copy reads
// aliases and #heading forms as words too, through the same shared cleaner.
test('n4: the formatted copy reads aliases and headings as words, never raw marks', () => {
  const html = S.shareHtml('Lemon cake', 'See [[Icing|the icing]], [[Icing#Method]] and [[#Method]] below.\n', { resolve: (t) => t, url: (r) => `file:///${r}` });
  assert.ok(html.includes('See the icing, Icing and Method below.'), `as words: ${html}`);
  assert.ok(!html.includes('[[') && !html.includes(']]'), 'no link marks');
});

test('the brand kit heads the copy when the person has one, else nothing', () => {
  const headed = S.brandHead({ name: 'Harbour Bakery', logos: {}, colours: [{ name: 'Crust', hex: '#8a3f22' }], fonts: [] }, () => '');
  assert.ok(headed.includes('Harbour Bakery') && headed.includes('#8a3f22'), 'name and colour head the copy');
  assert.equal(S.brandHead({ logos: {}, colours: [], fonts: [] }, () => ''), '', 'no kit, no header');
  const logo = S.brandHead({ name: 'Harbour Bakery', logos: { primary: 'Assets/Logos/bakery.png' }, colours: [], fonts: [] }, (r) => `file:///${r}`);
  assert.ok(logo.includes('bakery.png'), 'the primary logo shown');
});

test('Email it is a draft, never a send: subject, words and the PDF attached', () => {
  const pdf = Buffer.from('%PDF-1.4 made-up bytes');
  const eml = S.emlDraft({ subject: 'Lemon cake', body: 'Here is the recipe.', pdfName: 'Lemon cake.pdf', pdfBase64: pdf.toString('base64'), date: 'Sat, 31 Oct 2026 09:00:00 +1100' });
  assert.ok(eml.includes('Subject: Lemon cake'), 'the subject');
  assert.ok(eml.includes('Here is the recipe.'), 'the words');
  assert.ok(eml.includes('Content-Type: application/pdf'), 'the PDF attached');
  assert.ok(eml.includes(pdf.toString('base64')), 'the PDF bytes in it');
  assert.ok(!/send|deliver/i.test(eml.split('\n\n')[0]), 'a draft: no send anywhere');
  const mailto = S.mailtoFallback({ subject: 'Lemon cake', body: 'Here is the recipe.' });
  assert.ok(mailto.startsWith('mailto:?subject=Lemon%20cake'), 'the mail program opens with the subject');
});

test('a private note itself is never shareable', () => {
  assert.equal(S.isShareablePath('Private notes/Diary.md'), false);
  assert.equal(S.isShareablePath('private notes/Diary.md'), false);
  assert.equal(S.isShareablePath('Notes/Lemon cake.md'), true);
  assert.equal(S.isShareablePath('Projects/Harbour/Harbour.md'), true);
});

test('Share sits on every page\u2019s top bar: notes, the project page and the pack shells', () => {
  assert.ok(read('src/renderer/src/views/NoteView.tsx').includes('ShareButton'), 'a note\u2019s top bar (notes, meetings, any typed note)');
  assert.ok(read('src/renderer/src/views/ProjectPage.tsx').includes('shareMenuItems'), 'the project page\u2019s Share');
  assert.ok(read('src/renderer/src/views/modules/pack87.tsx').includes('sharePath'), 'a pack page\u2019s Share (PackShell)');
  assert.ok(read('src/renderer/src/views/modules/w3b/W3b.tsx').includes('sharePath'), 'a life pack page\u2019s Share (PackHead)');
  assert.ok(read('src/renderer/src/views/modules/work/WorkShell.tsx').includes('sharePath'), 'a work pack page\u2019s Share (WorkShell)');
});

test('the menu has the four ways, in plain words, and the main side saves and drafts them', () => {
  const menu = read('src/renderer/src/state/share.ts');
  for (const words of ['Save as PDF', 'Copy as formatted text', 'Save as Markdown', 'Email it']) assert.ok(menu.includes(words), `the menu says "${words}"`);
  const main = read('src/main/app.ts');
  assert.ok(main.includes("'export:share-md'") && main.includes("'export:share-email'"), 'the main side saves the copy and drafts the email');
  const bridge = read('src/preload/index.ts');
  assert.ok(bridge.includes('shareMd') && bridge.includes('shareEmail'), 'the window reaches them');
  assert.ok(!/DeepSeek|deepseek/i.test(read('src/shared/share.ts')), 'never a DeepSeek model anywhere');
});

test('every PDF door prints the note’s own kit and names it in plain words in its saved message', () => {
  // The right brand on the right document: a work note prints in the work kit, a family note with no brand. The
  // resolution reads through the one function (kitForNote, behind noteKit and brandHtmlAndKit), the words through the
  // one words (kitWords), so every door says the same thing; the Brand kit page is the one way to change which is used.
  const share = read('src/renderer/src/state/share.ts');
  const commands = read('src/renderer/src/state/commands.ts');
  const weekly = read('src/renderer/src/views/modules/work/WeeklyPage.tsx');
  assert.ok(share.includes('kitForNote('), 'Save as PDF and Email it resolve through the one function');
  assert.ok(commands.includes('brandHtmlAndKit('), 'Export to PDF prints through the shared page and kit');
  assert.ok(weekly.includes('noteKit('), 'the weekly update resolves through the shared kit');
  for (const [file, name] of [[share, 'Save as PDF and Email it'], [commands, 'Export to PDF'], [weekly, 'the weekly update']]) assert.ok(file.includes('kitWords('), `${name} names the kit in the shared words`);
  assert.ok(share.includes('export async function brandHtmlFor(path: string, title: string, text: string): Promise<string>'), 'brandHtmlFor keeps its call shape (its HTML, from path, title and text)');
});

test('after a PDF from a meeting or project note, Keep with this note files it and links it, as a new version', () => {
  // 5 Nov 2026, brand documents: making a PDF never changes the note's own words; only this tap files the PDF in the
  // note's Files with its record (a new export of the same note a new version) and links it in the note, once.
  const share = read('src/renderer/src/state/share.ts');
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(share.includes('export function isKeepNote') && share.includes('isMeetingNote(path, props) || isProjectProps(props)'), 'a meeting or project note, by its properties');
  assert.ok(share.includes("window.nv.vfiles.add(notePath, [pdfFile], 'version'"), 'placed with its record through vault-files, a new version');
  assert.ok(share.includes('[[${link}]]'), 'linked in the note');
  assert.ok(share.includes("text.includes(rel) && !text.includes(link)"), 'linked once');
  for (const [file, name] of [[share, 'save'], [share, 'email'], [commands, 'export']]) assert.ok(file.includes("label: 'Keep with this note'"), `${name} offers it after its PDF`);
});
