// node --test tests/clipper-extract.test.mjs — the web clipper's reading (src/shared/clipper.ts; 8.8): a saved news
// article, blog post, recipe and docs page each read as a clean article (title, author, date, site, main words,
// pictures), with scripts, menus, sidebars, adverts and footers left out, and the Vault note each clip becomes.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-clipx-'));
let C;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/clipper.ts'))};\nexport { readProps } from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', /^node:/], output: { file: path.join(work, 'c.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const page = (name) => readFileSync(path.join(root, 'tests/fixtures/clipper', name), 'utf8');
const NOW = new Date(2026, 9, 31, 14, 5);

test('a news article: title, author, date, site, main words and pictures', () => {
  const a = C.extractArticle(page('news.html'), 'https://www.harbourgazette.example/news/harbour-tunnel-decision');
  assert.equal(a.title, 'Harbour tunnel decision due before Christmas');
  assert.equal(a.author, 'Priya Nair');
  assert.equal(a.published, '2026-10-30T06:15:00+11:00');
  assert.equal(a.site, 'Harbour Gazette');
  assert.match(a.markdown, /final decision on the second harbour tunnel \*\*before Christmas\*\*/);
  assert.match(a.markdown, /> This is the most studied piece of road/);
  assert.match(a.markdown, /- Cabinet considers the business case in late November/);
  assert.match(a.markdown, /\[Read our funding explainer\]\(https:\/\/www\.harbourgazette\.example\/news\/funding-explainer\)/);
  assert.deepEqual(a.images, ['https://images.harbourgazette.example/tunnel-1200.jpg', 'https://www.harbourgazette.example/images/drilling-rig.jpg']);
  for (const gone of ['Subscribe', 'Most read', 'Ferry fares frozen', 'Cheap flights', '© 2026 Harbour Gazette', 'Privacy', '__trackingId', 'tracker.js']) {
    assert.ok(!a.markdown.includes(gone), `left out: ${gone}`);
  }
});

test('a blog post: lists, tables, code and protocol-relative pictures', () => {
  const a = C.extractArticle(page('blog.html'), 'https://crumbcraft.example/sourdough-home-oven');
  assert.equal(a.title, 'Baking better sourdough in a home oven - Crumb & Craft');
  assert.equal(a.author, 'Jonah Bell');
  assert.equal(a.site, 'Crumb and Craft');
  assert.match(a.markdown, /## 1\. Steam matters more than heat/);
  assert.match(a.markdown, /- Heat the pot, lid on, for 60 minutes/);
  assert.match(a.markdown, /\| Time \| Step \|/);
  assert.match(a.markdown, /```\n250C covered 20 min/);
  assert.match(a.markdown, /`Dutch oven`/);
  assert.deepEqual(a.images, ['https://cdn.crumbcraft.example/scoring.jpg']);
  assert.equal(C.absoluteUrl('//cdn.crumbcraft.example/loaf-hero.jpg', 'https://crumbcraft.example/x'), 'https://cdn.crumbcraft.example/loaf-hero.jpg');
  assert.equal(C.absoluteUrl('javascript:alert(1)', 'https://crumbcraft.example/x'), '');
  for (const gone of ['Newsletter', 'Sign up', '14 comments', '© Crumb', 'comments widget']) assert.ok(!a.markdown.includes(gone), `left out: ${gone}`);
});

test('a recipe: ingredients, nested method steps and JSON-LD facts', () => {
  const a = C.extractArticle(page('recipe.html'), 'https://sundaytable.example/slow-roast-lamb-shoulder');
  assert.equal(a.title, 'Slow-roast lamb shoulder with lemon and oregano');
  assert.equal(a.author, 'Maria Kouts');
  assert.equal(a.published, '2026-04-18');
  assert.equal(a.site, 'Sunday Table');
  assert.match(a.markdown, /## Ingredients/);
  assert.match(a.markdown, /- 2 kg lamb shoulder, bone in/);
  assert.match(a.markdown, /- Roast for 5 hours/);
  assert.match(a.markdown, / {2}- No deep tray\? A roasting pan with a wire rack works\./);
  assert.match(a.markdown, /\[warm flatbreads\]\(https:\/\/sundaytable\.example\/recipes\/flatbreads\)/);
  assert.deepEqual(a.images, ['https://sundaytable.example/img/lamb-shoulder.jpg']);
  for (const gone of ['adSlot', '© Sunday Table', 'paywall']) assert.ok(!a.markdown.includes(gone), `left out: ${gone}`);
});

test('a docs page: the main column only, nested lists and tables', () => {
  const a = C.extractArticle(page('docs.html'), 'https://help.acme.example/shortcuts');
  assert.equal(a.title, 'Keyboard shortcuts - Acme Notes Help');
  assert.equal(a.site, 'Acme Help');
  assert.match(a.markdown, /\| Action \| Windows \| Mac \|/);
  assert.match(a.markdown, /\| Bold selection \| `Ctrl\+B` \| `Cmd\+B` \|/);
  assert.match(a.markdown, / {2}- Use `tag:` to narrow by tag/);
  assert.match(a.markdown, /> Shortcuts can be changed in Settings > Keys\./);
  assert.match(a.markdown, /\[Importing notes\]\(https:\/\/help\.acme\.example\/help\/import\)/);
  for (const gone of ['Log in', 'Start here', 'Billing', 'On this page', '© 2026 Acme', 'helpSearch', 'Search help']) assert.ok(!a.markdown.includes(gone), `left out: ${gone}`);
});

test('a marked selection keeps its shape; plain words when its HTML is missing', () => {
  const sel = C.extractSelection('<p>Keep <strong>this</strong> and <a href="/x">that</a>.</p><ul><li>one</li><li>two</li></ul>', '', 'https://example.com/p');
  assert.match(sel.markdown, /Keep \*\*this\*\* and \[that\]\(https:\/\/example\.com\/x\)\./);
  assert.match(sel.markdown, /- one\n- two/);
  const plain = C.extractSelection('  ', 'Just the words\nsecond line', 'https://example.com/p');
  assert.equal(plain.markdown, 'Just the words\nsecond line');
  assert.deepEqual(plain.images, []);
});

test('an address for comparing: trackers and fragments off, the host lower-cased', () => {
  assert.equal(C.canonicalClipUrl('https://example.com/a?utm_source=x&b=1#frag'), 'https://example.com/a?b=1');
  assert.equal(C.canonicalClipUrl('https://EXAMPLE.com/a/'), 'https://example.com/a');
  assert.equal(C.canonicalClipUrl('https://example.com/a?fbclid=1&gclid=2'), 'https://example.com/a');
  assert.equal(C.canonicalClipUrl('not an address'), 'not an address');
});

test('a clip request checked: kinds, addresses, pictures, tags and words', () => {
  const base = { kind: 'article', url: 'https://example.com/a', title: 'A page', html: '<p>Words</p>' };
  assert.equal(C.cleanClip(base).kind, 'article');
  assert.throws(() => C.cleanClip({ ...base, kind: 'video' }), /no kind the Vault knows/);
  assert.throws(() => C.cleanClip({ ...base, url: 'file:///etc/passwd' }), /not a web address/);
  assert.throws(() => C.cleanClip({ ...base, html: '   ', text: '  ' }), /came through empty/);
  assert.throws(() => C.cleanClip({ kind: 'screenshot', url: base.url, title: 'S' }), /screenshot did not come through/);
  assert.throws(() => C.cleanClip({ ...base, images: [{ url: 'https://example.com/a.exe', data: 'eA==', type: 'application/exe' }] }), /not a picture/);
  assert.throws(() => C.cleanClip({ ...base, place: { kind: 'shelf', path: 'x' } }), /not one the Vault has/);
  const tags = C.cleanClip({ ...base, tags: ['Weekend Reads', '#cooking/italian', 'not a tag!!', 'Weekend Reads'] });
  assert.deepEqual(tags.tags, ['Weekend-Reads', 'cooking/italian', 'not-a-tag']);
  const data = C.cleanClip({ kind: 'screenshot', url: base.url, title: 'S', screenshot: { url: '', data: 'data:image/png;base64,eA==', type: 'image/png' } });
  assert.equal(data.screenshot.data, 'eA==');
});

test('the pairing code: typed loosely, kept strictly, shown grouped', () => {
  assert.equal(C.cleanCode('k7m2-q9xd'), 'K7M2Q9XD');
  assert.equal(C.cleanCode('  k7m2 q9xd '), 'K7M2Q9XD');
  assert.equal(C.codeValid('K7M2Q9XD'), true);
  assert.equal(C.codeValid('K7M2Q9X'), false);
  assert.equal(C.codeValid('K7M2Q9XI'), false, 'I is not in the alphabet');
  assert.equal(C.codeValid('K7M2Q9X0'), false, '0 is not in the alphabet');
  assert.equal(C.codeWords('K7M2Q9XD'), 'K7M2 Q9XD');
});

test('a published date in the vault’s words, the time kept when the page gave one', () => {
  assert.equal(C.clipPublished('2026-10-30T06:15:00+11:00'), '30 Oct 2026 06:15');
  assert.equal(C.clipPublished('2026-10-30T06:15:00Z'), '30 Oct 2026 06:15');
  assert.equal(C.clipPublished('2026-10-30T06:15'), '30 Oct 2026 06:15');
  assert.equal(C.clipPublished('2026-10-30 06:15:00'), '30 Oct 2026 06:15');
  assert.equal(C.clipPublished('2026-04-18'), '18 Apr 2026');
  assert.equal(C.clipPublished('Fri, 30 Oct 2026 06:15:00 +1100'), '30 Oct 2026 06:15');
  assert.equal(C.clipPublished('October 30, 2026'), '30 Oct 2026');
  assert.equal(C.clipPublished('30 October 2026'), '30 Oct 2026');
  assert.equal(C.clipPublished('October 30, 2026 6:15am'), '30 Oct 2026 06:15');
  assert.equal(C.clipPublished('30 October 2026, 18:05'), '30 Oct 2026 18:05');
  assert.equal(C.clipPublished(''), '');
  assert.equal(C.clipPublished('  '), '');
  assert.equal(C.clipPublished('sometime last week'), 'sometime last week', 'not read as a date: kept as written');
  assert.equal(C.clipPublished('2026-13-45'), '2026-13-45', 'not a real day: kept as written');
});

test('a picture’s address as a file’s name: spaces kept, odd marks made safe', () => {
  assert.equal(C.clipImageStem('https://images.example/tunnel-1200.jpg', 'Picture'), 'tunnel-1200');
  assert.equal(C.clipImageStem('https://images.example/my%20photo%202026.PNG?w=1200', 'Picture'), 'my photo 2026');
  assert.equal(C.clipImageStem('https://example.com/a[1]#2|x%.png', 'Picture'), 'a 1 2 x%');
  assert.equal(C.clipImageStem('https://example.com/100% legit.jpg', 'Picture'), '100% legit', 'a bare % never breaks the clip');
  assert.equal(C.clipImageStem('https://example.com/海の写真.jpg', 'Picture'), '海の写真', 'another language kept');
  assert.equal(C.clipImageStem('', 'Picture'), 'Picture');
  assert.equal(C.clipImageStem('data:image/png;base64,eA==', 'Picture'), 'Picture');
  assert.equal(C.clipImageStem('https://example.com/###.png', 'Picture'), 'Picture', 'nothing left: the fallback');
  assert.ok(C.clipImageStem(`https://example.com/${'a'.repeat(200)}.png`, 'Picture').length <= 60, 'capped');
});

test('the note: its source link in front matter, the words, its pictures local', () => {
  assert.equal(C.clipTitle('Baking <b>sourdough</b>: a/a\\b:c?d*e#f', 'https://example.com/', NOW), 'Baking sourdough a a b c d e f');
  assert.equal(C.clipTitle('', 'https://www.example.com/thing', NOW), 'Clipped from example.com');
  assert.equal(C.clipTitle('', 'not a url', NOW), 'Web clip 31 Oct 2026');
  assert.equal(C.clipDay(NOW), '31 Oct 2026');
  const front = C.clipFrontMatter({ source: 'https://example.com/a?x=1&y=2', site: 'Example', author: 'Jo', published: '2026-10-30', clipped: C.clipStamp(NOW), tags: ['reads', 'cooking/italian'] });
  const props = C.readProps(`${front}\n\nWords\n`);
  assert.equal(props.source, 'https://example.com/a?x=1&y=2');
  assert.equal(props.site, 'Example');
  assert.equal(props.author, 'Jo');
  assert.deepEqual(props.tags, ['reads', 'cooking/italian']);
  assert.equal(props.clipped, '31 Oct 2026 14:05');
  const saved = new Map([['https://example.com/i.jpg', '![[Clippings/Files/loaf.jpg]]']]);
  const md = C.localiseImages('Look:\n\n![A loaf](https://example.com/i.jpg)\n\n![Gone](https://example.com/no.jpg)\n', saved);
  assert.match(md, /!\[\[Clippings\/Files\/loaf\.jpg\]\]/);
  assert.match(md, /\*Gone \(picture not fetched\)\*/, 'an unfetched picture says so, never bare words');
  assert.ok(!md.includes('example.com/no.jpg'), 'an unfetched picture leaves no remote address');
  const body = C.clipBody({ kind: 'article', note: 'Try this on Sunday.', markdown: md, description: '', embeds: [], url: 'https://example.com/a', title: 'A', site: 'Example', day: '31 Oct 2026' });
  assert.ok(body.startsWith('Try this on Sunday.'), 'the person’s note first');
  assert.match(body, /Clipped from \[Example\]\(https:\/\/example\.com\/a\) on 31 Oct 2026\./);
  const mark = C.clipBody({ kind: 'bookmark', note: '', markdown: '', description: 'Nice shop.', embeds: ['![[Clippings/Files/shop.jpg]]'], url: 'https://shop.example/', title: 'Shop', site: 'Shop', day: '31 Oct 2026' });
  assert.match(mark, /Nice shop\.\n\n!\[\[Clippings\/Files\/shop\.jpg\]\]\n\n\[Open the page\]\(https:\/\/shop\.example\/\)/);
  assert.equal(C.clipNoteText(front, body), `${front}\n\n${body}`);
});
