// node --test tests/brand-pdf-leaks.test.mjs — what a branded PDF lets out (Nov 2026: a person sends these to
// colleagues and customers, so a leak here is the worst fault in the release). shared/brand-document.ts,
// main/brand-print.ts, main/agent-access.ts note_to_pdf, shared/brand-kits.ts, shared/share.ts, on invented notes and
// invented kits only. Each fault below failed before its fix; each check that held is kept so it keeps holding.
// Worst first: remote fetches, local paths in the bytes, hidden words printed, the wrong kit, then robustness.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-brand-leaks-'));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pdfinfoOk = (() => {
  try {
    return spawnSync('pdfinfo', ['-v'], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
})();
const LIVE = existsSync(SHELL) && pdfinfoOk;

let B;
let S;
let K;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(entry, [`export * as bd from ${src('src/shared/brand-document.ts')};`, `export * as sh from ${src('src/shared/share.ts')};`, `export * as bk from ${src('src/shared/brand-kits.ts')};`, `export * as asx from ${src('src/shared/assets.ts')};`].join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'leaks.mjs'), format: 'esm' }, logLevel: 'silent' });
  const M = await import(pathToFileURL(path.join(work, 'leaks.mjs')).href);
  B = M.bd;
  S = M.sh;
  K = M.bk;
});
after(() => rmSync(work, { recursive: true, force: true }));

// The vault addresses as the app makes them: file:// with the vault's whole path on this PC.
const fileUrl = (rel) => (rel ? `file:///vault/People/Harbour/${encodeURI(rel)}` : '');
const doc = (title, text, kit, extra = {}) => B.brandDocument({ title, text, path: 'Notes/Harbour.md', kit, url: fileUrl, ...extra });
const PLAIN_KIT = { name: 'Plain Co', logos: {}, colours: [{ name: 'Blue', hex: '#1D4E89' }], fonts: [] };

// ── 1. The window must not fetch from the internet: remote pictures stay out, their words stay ──

test('a remote picture never becomes a fetch: no remote address in the document, its words kept', () => {
  const html = doc('Mill visit', '![The mill from the quay](https://example.com/mill.png)\n\n![](https://example.com/pixel.gif)\n', PLAIN_KIT);
  assert.ok(!html.includes('https://example.com/mill.png'), 'no remote picture address to fetch');
  assert.ok(!html.includes('https://example.com/pixel.gif'), 'no tracking pixel address either');
  assert.ok(!html.includes('src="http'), 'no remote fetch anywhere in the document');
  assert.ok(html.includes('The mill from the quay'), 'its words stay, so nothing is lost silently');
});

test('a remote picture alone on its line keeps its words, never the fetch', () => {
  const html = doc('Mill visit', '## Photos\n\n![The mill from the quay](https://example.com/mill.png)\n\nDone.\n', PLAIN_KIT);
  assert.ok(!html.includes('https://example.com/'), 'no remote address');
  assert.ok(html.includes('The mill from the quay'), 'its words read where the picture would be');
  assert.ok(html.includes('Done.'), 'the rest reads');
});

test('the formatted copy keeps no remote picture either', () => {
  const html = S.shareHtml('Mill visit', '![The mill](https://example.com/mill.png)\n', { resolve: (t) => t, url: fileUrl });
  assert.ok(!html.includes('https://example.com/mill.png'), 'no remote picture address to fetch on paste');
  assert.ok(html.includes('The mill'), 'its words stay');
});

test('web links still work: only pictures are untrusted, never words with an address', () => {
  const html = doc('Mill visit', 'See [the mill guide](https://example.com/guide) for the rest.\n', PLAIN_KIT);
  assert.ok(html.includes('<a href="https://example.com/guide">the mill guide</a>'), 'the web link keeps working');
});

// ── 2. The bytes must not name this PC: file links read as words, never file:// ──

test('a file link reads as words: no file:// address in the document or the bytes', () => {
  const html = doc('Quote', 'See [[Files/quote.pdf]] and [the quote](Files/quote.pdf) and ![the scan](Files/scan.pdf).\n', PLAIN_KIT);
  assert.ok(!html.includes('file://'), 'no file address to leak the vault path');
  assert.ok(!html.includes('/vault/People/Harbour'), 'no local path anywhere');
  assert.ok(html.includes('quote'), 'the file still reads by name');
});

test('a note embed that is no picture reads as words, never a broken picture', () => {
  const html = doc('Roster', '![[Roster notes]]\n\nSee ![[Roster notes]] for the week.\n', PLAIN_KIT);
  assert.ok(!html.includes('<img'), 'no broken picture where a note was embedded');
  assert.ok(html.includes('Roster notes'), 'the note still reads by name');
});

test('a picture that is no picture file reads as words', () => {
  const html = doc('Roster', '![The roster](Files/roster.pdf)\n', PLAIN_KIT);
  assert.ok(!html.includes('<img'), 'no broken picture for a document');
  assert.ok(html.includes('The roster'), 'its words stay');
  const inline = doc('Roster', 'See ![the roster](Files/roster.pdf) for the week.\n', PLAIN_KIT);
  assert.ok(!inline.includes('<img'), 'no broken picture mid-paragraph either');
  assert.ok(!inline.includes('file://'), 'and no file address with it');
  assert.ok(inline.includes('the roster'), 'its words stay');
});

// ── 3. Nothing climbs out of the vault: .., absolute paths and drives never reach an address ──

test('a picture or link climbing out of the vault never reaches an address', () => {
  const html = doc(
    'Odd links',
    '![Out](../../outside.png)\n\n![Root](/etc/passwd)\n\n![Drive](C:/secret.png)\n\n[Out](../../secret.pdf)\n\n![[../../evil.png]]\n',
    PLAIN_KIT,
  );
  assert.ok(!html.includes('..'), 'no climbing path in any address');
  assert.ok(!html.includes('/etc/passwd'), 'no absolute path in any address');
  assert.ok(!html.includes('C:/secret.png'), 'no drive path in any address');
  assert.ok(!html.match(/src="file:/), 'nothing outside loads as a picture');
  assert.ok(!html.match(/href="file:/), 'nothing outside links as a file');
});

test('an encoded climb stays out too', () => {
  const html = doc('Odd links', '![Out](..%2f..%2foutside.png)\n', PLAIN_KIT);
  assert.ok(!html.includes('outside.png') || !html.includes('src='), 'no address for an encoded climb');
  assert.ok(!html.match(/src="file:[^"]*\.\./), 'no climbing address');
});

test('a logo climbing out of the vault never prints', () => {
  const kit = { name: 'Harbour Pine', logos: { onDark: '../../outside.svg' }, colours: [{ name: 'Ink', hex: '#14171a' }], fonts: [] };
  assert.equal(B.logoFor({ kit, band: '#14171a', url: fileUrl }), null, 'a climbing logo is no logo');
  const html = doc('A note', '## Words\n\nHello.\n', kit);
  assert.ok(!html.includes('outside.svg'), 'never in the document');
});

// ── 4. Hidden words stay hidden: comments, folded-away text ──

test('HTML comments stay out of the document', () => {
  const html = doc('Roster', 'Cover the late shift.\n\n<!-- sack Jo before Friday -->\n\nPriya takes Friday.\n', PLAIN_KIT);
  assert.ok(!html.includes('sack Jo before Friday'), 'no comment words in the document');
  assert.ok(html.includes('Priya takes Friday'), 'the rest reads');
});

test('a comment over several lines, and one never closed, stay out too', () => {
  const html = doc('Roster', 'Cover the late shift.\n\n<!-- do not send this:\nthe till floats are wrong -->\n\nPriya takes Friday.\n\n<!-- a draft never finished', PLAIN_KIT);
  assert.ok(!html.includes('till floats are wrong'), 'no multi-line comment words');
  assert.ok(!html.includes('a draft never finished'), 'no unclosed comment words');
  assert.ok(html.includes('Priya takes Friday'), 'the rest reads');
});

test('comments stay out of every rendered copy, while the Markdown file stays the file as is', () => {
  const body = S.shareBody('Hello.\n\n<!-- sack Jo before Friday -->\n\nBye.\n', {});
  assert.ok(!body.includes('sack Jo'), 'out of the shared body');
  const html = S.shareHtml('Roster', 'Hello.\n\n<!-- sack Jo -->\n', { resolve: (t) => t, url: fileUrl });
  assert.ok(!html.includes('sack Jo'), 'out of the formatted copy');
  const file = S.shareMarkdownFile('Hello.\n\n<!-- sack Jo -->\n', {});
  assert.ok(file.includes('sack Jo'), 'the Markdown file stays the file as is');
});

test('hidden text over several lines stays out; a stray marker is left alone', () => {
  const html = doc('Recipe', 'Bake at 180.\n\n%%\nthe secret ratio is two to one\n\nand the oven runs hot\n%%\n\nServe warm. 100%% sure.\n', PLAIN_KIT);
  assert.ok(!html.includes('secret ratio'), 'no multi-line hidden words');
  assert.ok(!html.includes('oven runs hot'), 'none past a blank line either');
  assert.ok(html.includes('Serve warm. 100%% sure.'), 'a stray marker reads as written');
});

// ── 5. Secrets and private notes: links, embeds, and the project line ──

test('a secret link in code stays the stand-in, never its value or id', () => {
  const html = doc('Oven', '```\ncode = "[locked](secret:AbC123xYz9)"\n```\n', PLAIN_KIT);
  assert.ok(!html.includes('secret:'), 'no secret link, even in code');
  assert.ok(!html.includes('AbC123xYz9'), 'no secret id, even in code');
  assert.ok(html.includes(S.SECRET_STANDIN), 'the stand-in reads');
});

test('a private embed and a private link stay out in every form', () => {
  const html = doc(
    'Roster',
    '![[Private notes/Diary]]\n\n![The diary](Private%20notes/Diary.md)\n\nSee [[Private notes/Diary]] and [the diary](Private%20notes/Diary.md).\n',
    PLAIN_KIT,
  );
  assert.ok(!html.includes('Private notes') && !html.includes('Private%20notes'), 'no private path');
  assert.ok(!html.includes('Diary'), 'no private name either');
  assert.ok(html.includes(S.PRIVATE_STANDIN), 'a private link reads as the stand-in');
});

test('the subtitle never names a private project', () => {
  const html = doc('Sync', '---\nproject: Private notes/Secret project\n---\n\n## Summary\n\nMet.\n', PLAIN_KIT);
  assert.ok(!html.includes('Secret project'), 'no private project name in the subtitle');
  assert.ok(html.includes('Met.'), 'the rest reads');
});

test('typed secrets read as written: only locked links are secrets (no keyword redaction)', () => {
  // The product rule bans gating on the person's words; the scanner and Secrets move typed secrets,
  // and only locked links are secrets at print. This locks that design, on a made-up value.
  const html = doc('Oven', 'The made-up oven code isize-4821-frog.\n', PLAIN_KIT);
  assert.ok(html.includes('made-up oven code isize-4821-frog'), 'typed words print as written');
});

// ── 6. The hidden window is sealed: nothing typed can run ──

test('script, style, iframe and svg typed in a note never become live tags', () => {
  const html = doc(
    'Odd words',
    '<script>alert(1)</script>\n\n<style>body{display:none}</style>\n\n<iframe src="https://example.com"></iframe>\n\n<svg onload="alert(1)"><script>alert(1)</script></svg>\n',
    PLAIN_KIT,
  );
  assert.equal(html.split('<script').length - 1, 2, 'only the document’s own two scripts');
  assert.equal(html.split('<style').length - 1, 1, 'only the document’s own styles');
  assert.ok(!html.includes('<iframe'), 'no live frame');
  assert.ok(!html.includes('<svg'), 'no live drawing');
  assert.ok(html.includes('&lt;script&gt;'), 'the typed words read as words');
});

test('event handlers typed in a note never become live attributes', () => {
  const html = doc('Odd words', '<img src=x onerror="alert(1)">\n\n<body onload="alert(1)">\n', PLAIN_KIT);
  assert.ok(!html.includes('<img src=x'), 'no live picture tag from typed words');
  assert.ok(html.includes('&lt;img'), 'the typed words read as words');
});

test('javascript: links keep their words, never their address', () => {
  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
    const html = doc('Odd words', `[click here](${href})\n`, PLAIN_KIT);
    assert.ok(!html.includes('alert(1)</a>') && !html.match(/href="javascript:/i), `${href}: no live address`);
    assert.ok(html.includes('click here'), 'its words stay');
  }
});

test('a data picture stays (it fetches nothing); a file picture from the vault stays', () => {
  const html = doc('Photos', '![Made-up pixels](data:image/png;base64,iVBORw0KGgo=)\n\n![The till](Photos/till.png)\n', PLAIN_KIT);
  assert.ok(html.includes('data:image/png;base64'), 'a data picture needs no fetch, so it prints');
  assert.ok(html.includes('Photos/till.png'), 'a vault picture prints');
});

// ── 7. The kit: colours, fonts, logos, and the heading across every door ──

test('a colour that is not a colour never breaks the band: neutral, never raw', () => {
  for (const hex of ['red', 'not a colour', '#12', '#gggggg']) {
    const html = doc('A note', '## Words\n\nHello.\n', { name: '', logos: {}, colours: [{ name: 'Bad', hex }], fonts: [] });
    assert.ok(html.includes('--accent:#101820'), `${hex}: the neutral band`);
  }
  const injected = doc('A note', '## Words\n\nHello.\n', { name: '', logos: {}, colours: [{ name: 'Bad', hex: 'red;}body{display:none' }], fonts: [] });
  assert.ok(injected.includes('--accent:#101820'), 'an injection attempt: the neutral band');
  assert.ok(!injected.includes('red;}body'), 'no injected style from the colour');
});

test('a font name that breaks out never reaches the page', () => {
  const html = doc(
    'A note',
    '## Words\n\nHello.\n',
    { name: '', logos: {}, colours: [], fonts: [{ name: 'Fraunces' }, { name: 'Arial";color:red' }, { name: '</style><script>alert(1)</script>' }, { name: '../../evil' }] },
  );
  assert.ok(html.includes('"Fraunces"'), 'the honest font reads');
  assert.ok(!html.includes('color:red'), 'no style break-out');
  assert.ok(!html.includes('evil'), 'no path break-out');
  assert.equal(html.split('<script').length - 1, 2, 'still only the document’s own scripts');
});

test('the formatted copy heads in the heading colour, as the document does', () => {
  const kit = { name: 'Harbour Pine', logos: {}, colours: [{ name: 'Body', hex: '#333333', use: 'Body text' }, { name: 'Pine', hex: '#0F6B5C', use: 'Headings' }], fonts: [] };
  const head = S.brandHead(kit, () => '');
  assert.ok(head.includes('#0f6b5c'), 'the heading colour heads the copy');
  assert.ok(!head.includes('#333333'), 'not the first colour when the headings say another');
});

test('a private logo never heads the formatted copy', () => {
  const head = S.brandHead({ name: '', logos: { primary: 'Private notes/logo.png' }, colours: [], fonts: [] }, fileUrl);
  assert.ok(!head.includes('logo.png'), 'no private logo address');
});

// ── 8. The right brand on the right document, even in two projects ──

const LEAK_AREAS = [{ id: 'work', name: 'Work', folder: 'Work', icon: 'briefcase', color: 'slate', about: 'Your job' }];
const RED = { id: 'redline-co', name: 'Redline Co', logos: {}, colours: [{ name: 'Signal red', hex: '#b3261e', use: 'Headings' }], fonts: [] };
const TEAL = { id: 'tealwork-studio', name: 'Tealwork Studio', logos: {}, colours: [{ name: 'Pine', hex: '#0f6b5c', use: 'Headings' }], fonts: [] };
const leakIndex = (brandProjects) => ({ brand: RED, brands: [RED, TEAL], brandDefault: 'redline-co', brandAreas: { work: 'redline-co' }, brandProjects });
const leakProjects = [
  { path: 'Work/Projects/Alpha/Alpha.md', name: 'Alpha' },
  { path: 'Work/Projects/Beta/Beta.md', name: 'Beta' },
];
const leakCtx = { areas: LEAK_AREAS, projects: leakProjects };

test('in two projects, the first with a kit wins; none named means the area’s', () => {
  const idx = leakIndex({ 'Work/Projects/Beta/Beta.md': 'tealwork-studio' });
  const first = K.kitForNote(idx, { path: 'Work/Notes/Sync.md', props: { project: ['Alpha', 'Beta'] } }, leakCtx);
  assert.equal(first?.id, 'tealwork-studio', 'Beta’s kit, though named second');
  const area = K.kitForNote(idx, { path: 'Work/Notes/Sync.md', props: {} }, leakCtx);
  assert.equal(area?.id, 'redline-co', 'no project named: the area’s kit');
});

test('a named project with a kit beats the area when the folder’s project has none', () => {
  const idx = leakIndex({ 'Work/Projects/Beta/Beta.md': 'tealwork-studio' });
  const kit = K.kitForNote(idx, { path: 'Work/Projects/Alpha/Notes/Sync.md', props: { project: 'Beta' } }, leakCtx);
  assert.equal(kit?.id, 'tealwork-studio', 'Beta’s kit, not the area’s red');
});

test('where the note lives still beats what it names when both have kits', () => {
  const idx = leakIndex({ 'Work/Projects/Alpha/Alpha.md': 'redline-co', 'Work/Projects/Beta/Beta.md': 'tealwork-studio' });
  const kit = K.kitForNote(idx, { path: 'Work/Projects/Alpha/Notes/Sync.md', props: { project: 'Beta' } }, leakCtx);
  assert.equal(kit?.id, 'redline-co', 'the folder’s project first, as before');
});

// ── 9. Confidential: never invented, never missing where the level says so ──

test('an open note never invents Confidential, even with a footer of its own', () => {
  const html = doc('A note', '## Words\n\nHello.\n', { ...PLAIN_KIT, footer: 'Willowmere Pty Ltd · ABN 51 000 111 222' }, { path: 'Notes/A note.md' });
  assert.ok(!html.includes('Confidential'), 'nothing invented');
  assert.ok(html.includes('ABN 51 000 111 222'), 'the footer reads as written');
});

test('the level the vault knows marks the document when the properties say nothing', () => {
  // A note in a Health folder is Health though its properties name no level; the doors pass the vault's
  // level in, and the document marks it. Without the level it reads only what the properties say.
  const marked = doc('Physio', '## Words\n\nHello.\n', PLAIN_KIT, { path: 'Health/Physio.md', level: 'health' });
  assert.ok(marked.includes('"footM":"Confidential, internal use"'), 'the vault’s Health marks it');
  const unmarked = doc('Physio', '## Words\n\nHello.\n', PLAIN_KIT, { path: 'Health/Physio.md' });
  assert.ok(!unmarked.includes('Confidential, internal use'), 'properties alone say nothing');
  const open = doc('A note', '## Words\n\nHello.\n', PLAIN_KIT, { path: 'Notes/A note.md', level: 'open' });
  assert.ok(!open.includes('Confidential'), 'Open marks nothing');
});

// ── 10. The transcript the recorder wrote stays out; the person’s own headings print ──

test('the recorder’s Transcript section stays out, parts and all', () => {
  const text = '## Summary\n\nMet and agreed the roster.\n\n## Transcript\n\n[[Recording – Weekly sync 2026-11-05 05.02.m4a]]\n\n> [!quote]- Transcript · 40 minutes\n> **12:03** *Ana:* Nothing for the customer.\n\n### Part 2\n\n> [!quote]- Transcript · 5 minutes\n> **40:01** *Sam:* Nothing either.\n';
  const html = doc('Weekly sync', text, PLAIN_KIT);
  assert.ok(!html.includes('Nothing for the customer.'), 'no transcript words');
  assert.ok(!html.includes('Nothing either.'), 'no second part either');
  assert.ok(!html.includes('.m4a'), 'no recording link');
  assert.ok(html.includes('Met and agreed the roster.'), 'the summary reads');
});

test('a heading the person wrote themselves prints: no keyword rule beyond the recorder’s own', () => {
  const html = doc('Weekly sync', '## Meeting transcript\n\nAna read the figures aloud.\n', PLAIN_KIT);
  assert.ok(html.includes('Ana read the figures aloud.'), 'the person’s own words print');
});

test('folded callouts print expanded, open ones read (there is no private kind)', () => {
  // t240 (brand-document.ts, 12 Nov): print cannot be clicked open, so a folded callout prints expanded —
  // the minutes' folded Discussion reads in full. Only the transcript section stays out (pinned above).
  const html = doc('Roster', '> [!private]- Hidden rota\n> Priya closes.\n\n> [!private] Open rota\n> Ana opens.\n', PLAIN_KIT);
  assert.ok(html.includes('Priya closes.'), 'folded prints expanded: no private kind exists to withhold');
  assert.ok(html.includes('Ana opens.'), 'open reads');
});

// ── 11. Front matter never prints raw; what the note knows still reads ──

test('front matter with sensitive fields never prints raw', () => {
  const html = doc(
    'Roster',
    '---\ntype: roster\npassword: madeup-roster-9931\napi_key: madeup-key-7741\n---\n\n## Words\n\nCover the late shift.\n',
    PLAIN_KIT,
    { path: 'Notes/Roster.md' },
  );
  assert.ok(!html.includes('madeup-roster-9931') && !html.includes('madeup-key-7741'), 'no property values print raw');
  assert.ok(!html.includes('api_key:'), 'no property keys print raw');
  assert.ok(html.includes('Cover the late shift.'), 'the words read');
});

// ── 12. Robustness: huge tables, huge notes, pictures, right-to-left and emoji ──

test('a table with 200 columns holds the page width, every cell escaped', () => {
  const head = `| ${Array.from({ length: 200 }, (_, i) => `C${i + 1}`).join(' | ')} |`;
  const rule = `| ${Array.from({ length: 200 }, () => '---').join(' | ')} |`;
  const row = `| ${Array.from({ length: 200 }, (_, i) => (i === 7 ? '<b>bold</b>' : `v${i + 1}`)).join(' | ')} |`;
  const html = doc('Wide', `## Stock\n\n${head}\n${rule}\n${row}\n`, PLAIN_KIT);
  assert.ok(html.includes('<table class="blk wt-12">'), 'capped at the narrowest fit');
  assert.ok(html.includes('table-layout:fixed'), 'the width holds');
  assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'), 'cells escape');
  assert.ok(html.includes('v200'), 'the last column reads');
});

test('a 500-page note builds in seconds, pure', () => {
  const para = 'The fortnightly now runs from the shared tracker to cut status chasing. Thursday’s till trial at the Quay decides the install schedule. ';
  const text = `## Notes\n\n${`${para.repeat(8)}\n\n`.repeat(500)}`;
  const started = Date.now();
  const html = doc('Long season', text, PLAIN_KIT);
  assert.ok(Date.now() - started < 15_000, 'built well inside the layout budget');
  assert.ok(html.includes('till trial'), 'its words read');
});

test('pictures cannot run past the page: figures scale and inline art is capped', () => {
  const html = doc('Photos', '![The till](Photos/till.png)\n', PLAIN_KIT);
  assert.ok(html.includes('max-width:100%'), 'pictures hold the width');
  assert.ok(html.includes('max-height'), 'and a tall picture is capped');
});

test('right-to-left and emoji read as written', () => {
  const html = doc('Fete', 'Met with ليلى حسن 🎪 and Zoë Müller 🎉.\n', PLAIN_KIT);
  assert.ok(html.includes('ليلى حسن 🎪') && html.includes('Zoë Müller 🎉'), 'names and emoji read');
  assert.ok(html.includes('dir="auto"'), 'blocks set their own direction');
});

// ── 13. The print window: its own sealed session (read from the source: Electron runs at review) ──

test('the hidden window runs in its own session with the network refused', () => {
  const src = read('src/main/brand-print.ts');
  assert.ok(src.includes('partition:'), 'its own session, so the block touches only printing');
  assert.ok(src.includes('onBeforeRequest'), 'requests pass one check');
  assert.ok(/https?\?:/.test(src) || src.includes("'cancel'") || src.includes('cancel: true'), 'remote addresses refused');
  assert.ok(src.includes('setPermissionRequestHandler'), 'no permission granted to the document');
  assert.ok(src.includes('sandbox: true'), 'still sandboxed, as before');
  assert.ok(src.includes('await sweepBrandDir(o.dir)'), 'still sweeping stale print files');
});

test('the note’s PDF tool prints at the vault’s level, so a levelled note marks Confidential', () => {
  const src = read('src/main/agent-access.ts');
  assert.ok(/\.level\(rel\)/.test(src), 'note_to_pdf reads the vault’s level for the note');
  const call = src.slice(src.indexOf('const html = brandDocument({'), src.indexOf('const html = brandDocument({') + 900);
  assert.ok(/^\s*level,/m.test(call), 'and passes it into the document');
});

// ── 14. Live: a real printed PDF, read back (needs the headless shell and pdfinfo) ──

const pdfInfo = (file) => {
  const r = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'pdfinfo reads the PDF');
  return r.stdout;
};
const pdfText = (file) => {
  const r = spawnSync('pdftotext', [file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, 'pdftotext reads the PDF');
  return r.stdout;
};
async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
async function startBrowser() {
  const port = await freePort();
  const child = spawn(SHELL, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const close = () => {
    try {
      child.kill('SIGKILL');
    } catch {}
  };
  try {
    let target;
    for (let i = 0; i < 100 && !target; i++) {
      await sleep(150);
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
      } catch {}
    }
    if (!target) throw new Error('the browser opened no page');
    const WebSocket = require('ws');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let id = 1;
    const pending = new Map();
    ws.onmessage = (m) => {
      const v = JSON.parse(String(m.data));
      if (v.id && pending.has(v.id)) {
        const { resolve, reject } = pending.get(v.id);
        pending.delete(v.id);
        if (v.error) reject(new Error(v.error.message));
        else resolve(v.result);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const my = id++;
        pending.set(my, { resolve, reject });
        ws.send(JSON.stringify({ id: my, method, params }));
      });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };
    return { send, ev, close };
  } catch (err) {
    close();
    throw err;
  }
}

test(
  'live: printing makes no remote fetch, and the bytes name nobody and no path',
  { skip: !LIVE },
  async () => {
    const dir = mkdtempSync(path.join(work, 'live-'));
    const vaultDir = path.join(dir, 'vault');
    mkdirSync(path.join(vaultDir, 'Photos'), { recursive: true });
    // A tiny invented picture (1x1 PNG).
    writeFileSync(path.join(vaultDir, 'Photos', 'till.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    let trackHits = 0;
    const server = createServer((req, res) => {
      const p = new URL(req.url ?? '/', 'http://x').pathname;
      if (p.startsWith('/track/')) {
        trackHits++;
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
        return;
      }
      if (p === '/doc.html') {
        // The tool's file:// vault addresses served over http, so the vault picture loads; only the scheme changes.
        const html = readFileSync(path.join(dir, 'doc.html'), 'utf8').replaceAll(`file://${dir}`, `${origin}/files`);
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(html);
        return;
      }
      if (p.startsWith('/files/')) {
        const file = path.join(dir, decodeURIComponent(p.slice('/files/'.length)));
        if (!file.startsWith(dir) || !existsSync(file)) {
          res.writeHead(404);
          res.end('no');
          return;
        }
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(readFileSync(file));
        return;
      }
      res.writeHead(404);
      res.end('no');
    });
    const port = await freePort();
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${port}`;
    const browser = await startBrowser();
    try {
      const html = B.brandDocument({
        title: 'Harbour site meeting',
        text: `## Summary\n\nThe till trial is on.\n\n![The till](Photos/till.png)\n\n![Tracker](http://127.0.0.1:${port}/track/pixel.png)\n\nSee [[Files/quote.pdf]] and [the guide](https://example.com/guide).\n`,
        path: 'Meetings/Harbour site meeting.md',
        kit: PLAIN_KIT,
        url: (rel) => (rel ? `file://${path.join(vaultDir, rel)}` : ''),
        resolve: (t) => t,
      });
      writeFileSync(path.join(dir, 'doc.html'), html);
      await browser.send('Page.navigate', { url: `${origin}/doc.html` });
      let report = null;
      for (let i = 0; i < 240 && !report; i++) {
        await sleep(250);
        report = await browser.ev('window.__report || null').catch(() => null);
      }
      assert.ok(report, 'the pages laid out');
      assert.equal(trackHits, 0, 'no fetch of the tracking pixel while laying out');
      const pdf = await browser.send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, generateDocumentOutline: true });
      assert.ok(pdf?.data, 'printed');
      assert.equal(trackHits, 0, 'no fetch while printing either');
      const file = path.join(dir, 'out.pdf');
      writeFileSync(file, Buffer.from(pdf.data, 'base64'));
      const info = pdfInfo(file);
      assert.ok(!info.includes('Ironleaf'), `the metadata names neither app:\n${info}`);
      assert.ok(!info.includes(dir) && !info.includes(vaultDir), `the metadata names no local path:\n${info}`);
      assert.ok(/Title:\s+Harbour site meeting/.test(info), `the title is the document's own name:\n${info}`);
      const bytes = readFileSync(file);
      const raw = bytes.toString('latin1');
      assert.ok(!raw.includes('file://'), 'no file address in the bytes');
      assert.ok(!raw.includes(vaultDir) && !raw.includes(`${port}/track`), 'no local path or tracker in the bytes');
      assert.ok(!raw.includes('Ironleaf'), 'neither app named in the bytes');
      const words = pdfText(file);
      assert.ok(words.includes('till trial'), 'its words read');
      assert.ok(words.includes('Tracker'), 'the remote picture’s words read');
      assert.ok(words.includes('quote'), 'the file reads by name');
    } finally {
      browser.close();
      server.close();
    }
  },
);
