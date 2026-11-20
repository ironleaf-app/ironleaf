// node --test tests/brand-document.test.mjs — a branded PDF from any note (5 Nov 2026). shared/brand-document.ts is
// one pure function from a note's words and front matter, plus the kit, to one finished HTML document (printed in a
// hidden window; tests/brand-document-pages.test.mjs prints real PDFs and measures the pages). Page one has the 38mm
// accent band, the title, a subtitle from what the note knows, a key-figures band when it has them, who came and who
// didn't for a meeting, then the sections in order; later pages the slim band; every page its footer and a true page
// number. Nothing about any business is hard coded. On invented kits (a green reference twin, a red band with a white
// logo, a pale yellow accent, a near-black accent, one colour and no logo, a primary-only logo that disappears on its
// band, and no kit) and invented notes (a meeting with actions, figures and rows; reminder-form actions; wide tables;
// folded and open callouts; secrets, private links, front matter and editor marks; odd titles; right-to-left names):
// the document carries the kit, the words read, and what must stay out stays out. Each failing check fails without
// its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.join(import.meta.dirname, '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-brand-doc-'));
let B;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [`export * from ${JSON.stringify(path.join(root, 'src/shared/brand-document.ts'))};`, `export * from ${JSON.stringify(path.join(root, 'src/shared/assets.ts'))};`, `export * from ${JSON.stringify(path.join(root, 'src/shared/brand-kits.ts'))};`, `export * as md from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};`].join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'bd.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(work, 'bd.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const url = (rel) => (rel ? `https://files.example.com/${encodeURI(rel)}` : '');
const doc = (title, text, kit, extra = {}) => B.brandDocument({ title, text, path: 'Meetings/Riverside.md', kit, url, ...extra });

// The cafe meeting (invented): figures, rows, actions in both forms, decisions, a transcript, callouts.
const MEETING = `---
date: 2026-03-03
time: 9:00 am
duration: 40 minutes
project: Riverside cafe
attendees: [Ana Reyes, Sam Okafor]
absent: Lee Park
also: Marco
confidential: true
figures:
  - { value: 20 Mar, label: Fit-out finishes }
  - { value: 2 Apr, label: Doors open }
---

# Riverside Cafe Opening

## Summary

The fortnightly now runs from the shared tracker to cut status chasing.

## Action items

- [ ] Confirm with Marco and Dana that Jo can be on site next week — Jo · by 4 Mar 2026
- [ ] Live trial of one oven at the Quay — Jo ⏰ 2026-03-05 14:00
- [ ] Check the fire inspection — Sam · by 6 Mar 2026

## Decisions

- **Test first.** One live oven trial at the Quay on Thursday.

> [!note] About this record
> Prepared from the meeting recording. Please send any corrections to Jo.

> [!quote]- Transcript · 40 minutes
> **12:03** *Ana:* Nothing for the PDF.

![The oven](Photos/oven.png)

See [the warranty portal](https://example.com/portal) and [[Roster]] for the rest.

## Transcript

The recording and its folded words stay out.
`;

const GREEN_KIT = {
  name: 'Harbour Pine',
  logos: { onDark: 'Logos/harbour-white.svg', primary: 'Logos/harbour-dark.svg' },
  colours: [{ name: 'Pine', hex: '#0F6B5C', use: 'Headings' }],
  fonts: [],
  footer: 'Confidential, internal use',
};

test('page one carries the kit, the title, the subtitle, the figures and the meeting rows', () => {
  const html = doc('Riverside Cafe Opening', MEETING, GREEN_KIT);
  assert.ok(html.includes('--accent:#0f6b5c'), 'the heading colour is the accent');
  assert.ok(html.includes('harbour-white.svg'), 'the dark band takes the on-dark logo');
  assert.ok(!html.includes('harbour-dark.svg'), 'not the primary on a dark band');
  assert.ok(html.includes('Meeting minutes'), 'the small label names the kind');
  assert.ok(html.includes('<h1 class="blk" dir="auto">Riverside Cafe Opening</h1>'), 'the title once');
  assert.ok(html.includes('Riverside cafe'), 'the subtitle names the project');
  assert.ok(html.includes('Tuesday 3 March 2026, 9:00 am, 40 minutes'), 'then the day, time and length as written');
  assert.ok(html.includes('<b dir="auto">20 Mar</b><span dir="auto">Fit-out finishes</span>'), 'the figures band');
  assert.ok(html.includes('<dt>Present</dt><dd dir="auto"><bdi>Ana Reyes</bdi>, <bdi>Sam Okafor</bdi></dd>'), 'who came, each name isolated');
  assert.ok(html.includes('<dt>Not present</dt><dd dir="auto"><bdi>Lee Park</bdi></dd>'), 'who did not');
  assert.ok(html.includes('<dt>Also named</dt><dd dir="auto"><bdi>Marco</bdi></dd>'), 'who else was named');
  assert.ok(html.indexOf('Summary') < html.indexOf('Action items') && html.indexOf('Action items') < html.indexOf('Decisions'), 'the sections in order');
});

test('open tasks become the numbered Action, Owner, Due table, in both written forms', () => {
  // p4-brand-doc-faults: dues read one way now ("Wed 4 Mar", the year only past this year), not as written.
  const html = doc('Riverside Cafe Opening', MEETING, GREEN_KIT, { now: new Date(2026, 10, 5, 12, 0, 0) });
  assert.ok(html.includes('<table class="blk actions"><thead><tr><th>#</th><th>Action</th><th>Owner</th><th>Due</th></tr></thead>'), 'the table headed # Action Owner Due');
  assert.ok(html.includes('<td dir="auto">Confirm with Marco and Dana that Jo can be on site next week</td><td class="o" dir="auto">Jo</td><td class="d" dir="auto">Wed 4 Mar</td>'), 'the by-form read one way');
  assert.ok(html.includes('<td dir="auto">Live trial of one oven at the Quay</td><td class="o" dir="auto">Jo</td><td class="d" dir="auto">Thu 5 Mar, 2 pm</td>'), 'the reminder form as a day and time');
  assert.ok(!html.includes('⏰'), 'no reminder mark prints raw');
  assert.ok(!html.includes('- [ ]'), 'no task box prints raw');
});

test('the transcript, secrets, private notes, marks and front matter stay out; folds print expanded', () => {
  const text = `---
type: meeting
secret: hidden
---

# Private matters

Oven code: [locked](secret:AbC123xYz9).

![[Private notes/Diary]]

A %%comment for the editor%% and nothing else.

- [ ]

> [!quote]- Folded away
> Nothing hidden.
`;
  const html = doc('Private matters', `${text}\n## Transcript\n\nFolded words.\n`, GREEN_KIT);
  assert.ok(!html.includes('secret:'), 'no secret link');
  assert.ok(!html.includes('AbC123xYz9'), 'no secret id');
  assert.ok(!html.includes('Private notes/Diary'), 'no private path');
  assert.ok(!html.includes('comment for the editor'), 'no editor comment');
  assert.ok(!html.includes('- [ ]'), 'no empty template box');
  assert.ok(html.includes('Folded away') && html.includes('Nothing hidden.'), 'a folded callout prints expanded: print cannot be clicked open');
  assert.ok(!html.includes('Folded words.'), 'no transcript section');
  assert.ok(!html.includes('secret: hidden') && !html.includes('type: meeting'), 'no front matter');
});

test('a meeting’s folded Discussion prints in full, the transcript stays out', () => {
  const html = doc(
    'Harbour review',
    '---\ntype: meeting\ndate: 2026-11-06\n---\n# Harbour review\n\n## Discussion\n\n> [!quote]- Cart retry\n> The retry fails on Fridays.\n>\n> Priya will chase the failed payments.\n\n## Transcript\n\n> [!quote]- Transcript · 4 minutes\n> **0:00** *You:* Morning all.\n',
    GREEN_KIT,
  );
  assert.ok(html.includes('Discussion'), 'the section prints');
  assert.ok(html.includes('Cart retry') && html.includes('The retry fails on Fridays.') && html.includes('Priya will chase the failed payments.'), 'every folded topic word prints');
  assert.ok(!html.includes('Morning all.'), 'the transcript stays out');
});

test('open callouts read as the note box; pictures and links keep working', () => {
  const html = doc('Riverside Cafe Opening', MEETING, GREEN_KIT);
  assert.ok(html.includes('<aside class="blk note"'), 'the open callout reads as the note box');
  assert.ok(html.includes('Please send any corrections to Jo.'), 'its words read');
  assert.ok(html.includes('<figure class="blk"><img src="https://files.example.com/Photos/oven.png"'), 'the picture prints');
  assert.ok(html.includes('<a href="https://example.com/portal">the warranty portal</a>'), 'the web link keeps working');
  assert.ok(html.includes('Roster') && !html.includes('[['), 'the note link reads as words, no brackets print');
});

test('the footer and the later-pages band are set: the name, the line, and true page numbers to fill', () => {
  const html = doc('Riverside Cafe Opening', MEETING, GREEN_KIT);
  assert.ok(html.includes('"footL":"Riverside Cafe Opening"'), 'the footer names the document');
  assert.ok(html.includes('"footM":"Confidential, internal use"'), 'the kit footer says it, so it reads');
  assert.ok(html.includes('Riverside Cafe Opening, 3 March 2026'), 'the slim band names the document and its day');
  assert.ok(html.includes('Page \'+(i+1)+\' of \'+pages.length'), 'page numbers are filled last, so they are true');
  assert.ok(html.includes('<title>Riverside Cafe Opening</title>'), 'the PDF has a title');
  assert.ok(html.includes('<h1') && html.includes('<h2'), 'headings for the outline');
});

test('confidential reads only when the person said so or the kit footer says so', () => {
  const plain = { name: 'Plain Co', logos: {}, colours: [{ name: 'Blue', hex: '#1D4E89' }], fonts: [] };
  const open = doc('A note', '## Words\n\nHello.\n', plain, { path: 'Notes/A note.md' });
  assert.ok(!open.includes('Confidential'), 'an open note with a plain kit: nothing');
  const said = doc('A note', '---\nconfidential: true\n---\n\n## Words\n\nHello.\n', plain, { path: 'Notes/A note.md' });
  assert.ok(said.includes('"footM":"Confidential, internal use"'), 'the property says so: it reads');
  const levelled = doc('A note', '---\nlevel: Work-confidential\n---\n\n## Words\n\nHello.\n', plain, { path: 'Notes/A note.md' });
  assert.ok(levelled.includes('"footM":"Confidential, internal use"'), 'a level past Open says so: it reads');
  const kitSays = doc('A note', '## Words\n\nHello.\n', { ...plain, footer: 'Confidential, internal use' }, { path: 'Notes/A note.md' });
  assert.ok(kitSays.includes('"footM":"Confidential, internal use"'), 'the kit footer says it: it reads');
  const otherLine = doc('A note', '## Words\n\nHello.\n', { ...plain, footer: 'Willowmere Pty Ltd · ABN 51 000 111 222' }, { path: 'Notes/A note.md' });
  assert.ok(otherLine.includes('ABN 51 000 111 222'), 'another footer line reads as written');
  assert.ok(!otherLine.includes('Confidential, internal use'), 'and it never invents the confidential words');
});

test('the accent is the heading colour, else the first colour; words on it read at 4.5 to 1', () => {
  assert.equal(B.accentOf({ name: '', logos: {}, colours: [{ name: 'Body', hex: '#333333', use: 'Body text' }, { name: 'Pine', hex: '#0F6B5C', use: 'Headings' }], fonts: [] }), '#0f6b5c', 'the heading colour wins');
  assert.equal(B.accentOf({ name: '', logos: {}, colours: [{ name: 'Brand', hex: '#B3261E' }], fonts: [] }), '#b3261e', 'else the first colour');
  assert.equal(B.accentOf({ name: '', logos: {}, colours: [], fonts: [] }), null, 'no colours: none');
  assert.equal(B.accentOf(null), null, 'no kit: none');
  for (const band of ['#0f6b5c', '#b3261e', '#f2e14c', '#14171a', '#1d4e89', '#101820']) {
    const ink = B.inkFor(band);
    assert.ok(ink === '#ffffff' || ink === '#101820', `${band} takes white or near-black`);
    assert.ok(B.contrastOf(ink, band) >= 4.5, `${band} reads at 4.5 to 1 (${B.contrastOf(ink, band).toFixed(2)})`);
  }
  assert.equal(B.inkFor('#f2e14c'), '#101820', 'a pale yellow band takes near-black words');
  assert.equal(B.inkFor('#b3261e'), '#ffffff', 'a red band takes white words');
});

test('the logo: on-dark on dark, primary on light, a measured substitute, else the name in type', () => {
  const u = (rel) => `https://files.example.com/${rel}`;
  const dark = B.logoFor({ kit: GREEN_KIT, band: '#0f6b5c', url: u });
  assert.deepEqual(dark, { rel: 'Logos/harbour-white.svg', role: 'onDark' }, 'the dark band takes the on-dark logo');
  const light = B.logoFor({ kit: GREEN_KIT, band: '#f2e14c', url: u });
  assert.deepEqual(light, { rel: 'Logos/harbour-dark.svg', role: 'primary' }, 'the light band takes the primary logo');
  // The substitute: a dark band with only a light primary logo keeps the logo; a dark one loses it.
  const paleOnly = { name: 'Pale Co', logos: { primary: 'Logos/pale.svg' }, colours: [], fonts: [] };
  assert.deepEqual(B.logoFor({ kit: paleOnly, band: '#14171a', url: u, palette: { primary: ['#f5f5f5'] } }), { rel: 'Logos/pale.svg', role: 'primary' }, 'a light substitute stays visible, so it prints');
  assert.equal(B.logoFor({ kit: paleOnly, band: '#14171a', url: u, palette: { primary: ['#1a1a1a'] } }), null, 'a dark substitute disappears, so the name sets in type');
  assert.equal(B.logoFor({ kit: paleOnly, band: '#14171a', url: u }), null, 'no measurement: no substitute');
  const html = doc('A note', '## Words\n\nHello.\n', paleOnly, { path: 'Notes/A note.md', logoPalette: { primary: ['#1a1a1a'] } });
  assert.ok(!html.includes('Logos/pale.svg'), 'the disappeared logo never prints');
  assert.ok(html.includes('Pale Co'), 'the business name sets in type instead');
  assert.ok(html.slice(html.indexOf('"mast"')).includes('mast-name'), 'set in type on the band');
  const secret = { name: '', logos: { onDark: 'Private notes/logo.svg' }, colours: [{ name: 'Ink', hex: '#14171a' }], fonts: [] };
  assert.equal(B.logoFor({ kit: secret, band: '#14171a', url: u }), null, 'a private logo never prints');
});

test('no kit at all: a clean near-black band with no invented brand', () => {
  const html = doc('A note', '## Words\n\nHello.\n', null, { path: 'Notes/A note.md' });
  const meta = html.slice(html.indexOf('"mast"'));
  assert.ok(html.includes('--accent:#101820'), 'the band is near-black');
  assert.ok(!meta.includes('mast-logo') && !meta.includes('slim-logo'), 'no logo');
  assert.ok(!meta.includes('mast-name') && !meta.includes('slim-name'), 'no name in type');
  assert.ok(meta.includes('Note'), 'only the document label');
  assert.ok(!html.includes('Ironleaf'), 'never our name on a customer document');
});

test('the small label names what the note is: minutes, a brief, its type, else a note', () => {
  const kit = { name: '', logos: {}, colours: [], fonts: [] };
  // The band is laid out by the page's script from its meta: the label reads there.
  const labelOf = (html) => html.slice(html.indexOf('"mast"'));
  assert.ok(labelOf(doc('M', '## S\n\nx\n', kit)).includes('Meeting minutes'), 'a meeting reads Meeting minutes');
  assert.ok(labelOf(doc('P', '---\ntype: project\n---\n\n## S\n\nx\n', kit, { path: 'Projects/P.md' })).includes('Project brief'), 'a project reads Project brief');
  assert.ok(labelOf(doc('R', '---\ntype: Report\n---\n\n## S\n\nx\n', kit, { path: 'Notes/R.md' })).includes('Report'), 'its own type reads as written');
  assert.ok(labelOf(doc('N', '## S\n\nx\n', kit, { path: 'Notes/N.md' })).includes('Note'), 'a plain note reads Note');
});

test('key figures read from a section when the properties have none, and the section is spent', () => {
  const html = doc('Q3 review', '## Key dates\n\n- 20 Mar — Fit-out finishes\n- 2 Apr: Doors open\n\n## Summary\n\nShort.\n', { name: '', logos: {}, colours: [], fonts: [] }, { path: 'Notes/Q3 review.md' });
  assert.ok(html.includes('<b dir="auto">20 Mar</b><span dir="auto">Fit-out finishes</span>'), 'the dash form');
  assert.ok(html.includes('<b dir="auto">2 Apr</b><span dir="auto">Doors open</span>'), 'the colon form');
  assert.ok(!html.includes('Key dates</h2>'), 'the section does not read twice');
});

test('owners read as written, never reworded', () => {
  const html = doc('M', '## Actions\n\n- [ ] Trial the oven — Jo, Priya · by Thu 5 Mar, 2 pm\n- [ ] Revise the schedule — [[Jo Tran|Jo]] ⏰ 2026-03-06 09:00\n- [ ] Book the inspection — Sam · before opening\n- [ ] Revise again — Jo · after the trial\n', GREEN_KIT);
  assert.ok(html.includes('<td class="o" dir="auto">Jo, Priya</td>'), 'joint owners keep their comma');
  assert.ok(!html.includes('Jo and Priya'), 'never joined with and');
  assert.ok(html.includes('<td class="o" dir="auto">Jo</td>'), 'a linked owner reads as said');
  assert.ok(html.includes('<td class="d" dir="auto">Before opening</td>'), 'before reads whole');
  assert.ok(html.includes('<td class="d" dir="auto">After the trial</td>'), 'after reads whole, out of the what');
  assert.ok(!html.includes('after the trial</td><td class="o"'), 'the due leaves the what');
});

test('stray tasks with no Actions section read under one at the end, so none is lost', () => {
  const html = doc('Roster', '## Notes\n\nCover the late shift.\n\n- [ ] Ask Priya about Friday — Ana · by 6 Mar 2026\n', { name: '', logos: {}, colours: [], fonts: [] }, { path: 'Notes/Roster.md' });
  assert.ok(html.includes('<h2 class="blk">Actions</h2>'), 'an Actions section is added');
  assert.ok(html.includes('Ask Priya about Friday'), 'the stray task reads in the table');
  assert.ok(html.indexOf('Notes</h2>') < html.indexOf('Actions</h2>'), 'after the sections, never among them');
});

test('tables keep a dark header and zebra rows; wide ones fit the page', () => {
  const html = doc('R', '## Stock\n\n| A | B | C | D | E | F |\n| --- | --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 | 6 |\n', { name: '', logos: {}, colours: [], fonts: [] }, { path: 'Notes/R.md' });
  assert.ok(html.includes('<table class="blk wt-6">'), 'a wide table is marked to fit');
  assert.ok(html.includes('<thead><tr><th dir="auto">A</th>'), 'the dark header');
  assert.ok(html.includes('tbody tr:nth-child(even) td'), 'zebra rows in the styles');
  assert.ok(html.includes('table-layout:fixed'), 'wide tables hold the page width');
});

test('kit fonts read when installed, with a good sans behind; odd names never break the page', () => {
  const html = doc('N', '## S\n\nx\n', { name: '', logos: {}, colours: [], fonts: [{ name: 'Fraunces' }, { name: 'Inter' }, { name: 'Bad";x' }] }, { path: 'Notes/N.md' });
  assert.ok(html.includes('--sans:"Fraunces","Inter",Helvetica,Arial'), 'the kit fonts first, the sans behind');
  assert.ok(!html.includes('Bad'), 'the odd name stays out');
});

test('odd titles escape and right-to-left names read', () => {
  const html = doc('Q3 <Review> & "Quotes" — don’t', '## S\n\nMet with ليلى حسن and Zoë Müller.\n', { name: '', logos: {}, colours: [], fonts: [] }, { path: 'Notes/Q.md' });
  assert.ok(html.includes('Q3 &lt;Review&gt; &amp; &quot;Quotes&quot; — don’t'), 'the title escapes');
  assert.ok(!html.includes('<Review>'), 'no tag breaks out');
  assert.ok(html.includes('ليلى حسن') && html.includes('Zoë Müller'), 'the names read as written');
  assert.ok(html.includes('dir="auto"'), 'blocks set their own direction');
  const rtl = doc('Fete', '---\nattendees: [ليلى حسن, Zoë Müller]\n---\n\n## Actions\n\n- [ ] Book the lawn — ليلى حسن · by 18 Jun 2026\n', GREEN_KIT);
  assert.ok(rtl.includes('<bdi>ليلى حسن</bdi>, <bdi>Zoë Müller</bdi>'), 'the row keeps its order');
  assert.ok(rtl.includes('<td class="o" dir="auto">ليلى حسن</td>'), 'the owner reads');
  assert.ok(!rtl.includes('— ليلى حسن</td>'), 'the owner leaves the what');
});

test('the kit page is told plainly, in one line, what would make the kit better', () => {
  assert.equal(B.brandKitHint(null), 'Add your business name, a primary logo, a logo for dark backgrounds, a brand colour and a brand font to make your documents look their best.', 'everything missing, one line');
  assert.equal(B.brandKitHint({ name: 'Pine', logos: { primary: 'a' }, colours: [{ name: 'c', hex: '#111111' }], fonts: [] }), 'Add a logo for dark backgrounds and a brand font to make your documents look their best.', 'two missing joined with and');
  assert.equal(B.brandKitHint({ name: 'Pine', logos: { primary: 'a', onDark: 'b' }, colours: [{ name: 'c', hex: '#111111' }], fonts: [{ name: 'F' }] }), null, 'a complete kit: nothing to say');
});

test('the preview is page one of a small invented meeting, static for the kit page', () => {
  const html = B.brandPreviewHtml(GREEN_KIT, url);
  assert.ok(html.includes('Riverside Cafe Opening'), 'the invented meeting');
  assert.ok(html.includes('--accent:#0f6b5c'), 'in this kit');
  assert.ok(html.includes('Page 1 of 1'), 'one static page');
  assert.ok(!html.includes('nv-meta'), 'no layout script: static');
});

test('one paragraph makes a good one-page document', () => {
  const html = doc('A thought', 'Rain on the windows, and the roster done by lunch.\n', { name: '', logos: {}, colours: [], fonts: [] }, { path: 'Notes/A thought.md' });
  assert.ok(html.includes('<h1 class="blk" dir="auto">A thought</h1>'), 'the title');
  assert.ok(html.includes('Rain on the windows'), 'the paragraph');
});

// ── The right brand on the right document ─────────────────────────────────────────────────────────────────────────────
// Invented kits: the work area's red kit, the business area's teal one, the family area with no brand, and a project
// overriding its area. Each note's document carries its own kit, read through the one function.

const DOC_AREAS = [
  { id: 'work', name: 'Work', folder: 'Work', icon: 'briefcase', color: 'slate', about: 'Your job' },
  { id: 'business', name: 'Business', folder: 'Business', icon: 'chart', color: 'clay', about: 'A business of your own' },
  { id: 'family', name: 'Family', folder: 'Family', icon: 'people', color: 'rose', about: 'Partner and kids' },
];
const DOC_PROJECTS = [{ path: 'Work/Projects/Harbour fit-out/Harbour fit-out.md', name: 'Harbour fit-out' }];
const DOC_INDEX = () =>
  B.parseIndex(
    JSON.stringify({
      version: 1,
      brands: [
        { id: 'redline-co', name: 'Redline Co', logos: {}, colours: [{ name: 'Signal red', hex: '#b3261e', use: 'Headings' }], fonts: [] },
        { id: 'tealwork-studio', name: 'Tealwork Studio', logos: {}, colours: [{ name: 'Pine', hex: '#0f6b5c', use: 'Headings' }], fonts: [] },
      ],
      brandDefault: 'redline-co',
      brandAreas: { work: 'redline-co', business: 'tealwork-studio', family: null },
      brandProjects: { 'Work/Projects/Harbour fit-out/Harbour fit-out.md': 'tealwork-studio' },
      collections: [],
      assets: {},
    }),
  );
const docCtx = { areas: DOC_AREAS, projects: DOC_PROJECTS };
const docFor = (path, text, title = 'A note') => {
  const kit = B.kitForNote(DOC_INDEX(), { path, props: {} }, docCtx);
  return B.brandDocument({ title, text, path, kit, url });
};

test('each area’s document carries its own kit: work red, business teal, family clean', () => {
  const work = docFor('Work/Notes/Standup.md', '## Words\n\nHello.\n');
  assert.ok(work.includes('--accent:#b3261e') && work.includes('Redline Co'), 'the work note in its red kit');
  const business = docFor('Business/Notes/Pricing.md', '## Words\n\nHello.\n');
  assert.ok(business.includes('--accent:#0f6b5c') && business.includes('Tealwork Studio'), 'the business note in its teal kit');
  const family = docFor('Family/Notes/Fete.md', '## Words\n\nHello.\n');
  assert.ok(family.includes('--accent:#101820'), 'the family note clean and neutral');
  assert.ok(!family.includes('Redline Co') && !family.includes('Tealwork Studio'), 'no employer’s logo on a family note');
  const project = docFor('Work/Projects/Harbour fit-out/Harbour fit-out.md', '## Words\n\nHello.\n');
  assert.ok(project.includes('--accent:#0f6b5c') && project.includes('Tealwork Studio'), 'the project overrides its area');
});

test('a one-kit vault migrates to byte-for-byte the same document', () => {
  const kit = { name: 'Harbour Pine', logos: { onDark: 'Logos/harbour-white.svg', primary: 'Logos/harbour-dark.svg' }, colours: [{ name: 'Pine', hex: '#0F6B5C', use: 'Headings' }], fonts: [], footer: 'Confidential, internal use' };
  const idx = B.parseIndex(JSON.stringify({ version: 1, brand: kit, collections: [], assets: {} }));
  assert.equal(idx.brands.length, 1, 'the single kit migrates without any loss');
  for (const path of ['Work/Notes/Standup.md', 'Family/Notes/Fete.md', 'Notes/Loose.md']) {
    const resolved = B.kitForNote(idx, { path, props: {} }, docCtx);
    const a = B.brandDocument({ title: 'Riverside Cafe Opening', text: MEETING, path, kit, url });
    const b = B.brandDocument({ title: 'Riverside Cafe Opening', text: MEETING, path, kit: resolved, url });
    assert.equal(b, a, `${path}: nothing changes for someone with one kit`);
  }
});

// p4-brand-doc-faults, 5 Nov 2026: the faults from the real app, each on an invented note.
test('a leading date in the file name is filing, not the title: stripped where the document names itself, kept in the subtitle', () => {
  const html = doc('2026-11-05 Weekly sync', '## Summary\n\nMet and agreed the roster.\n', GREEN_KIT, { path: 'Meetings/2026-11-05 Weekly sync.md' });
  assert.ok(html.includes('<h1 class="blk" dir="auto">Weekly sync</h1>'), 'the title without the date');
  assert.ok(!html.includes('<h1 class="blk" dir="auto">2026-11-05'), 'no date in the title');
  assert.ok(html.includes('"footL":"Weekly sync"'), 'the footer without the date');
  assert.ok(html.includes('Weekly sync, 5 November 2026'), 'the later-page band without the date, with the day');
  assert.ok(!html.includes('2026-11-05 Weekly sync, '), 'no date prefix in the band');
  assert.ok(html.includes('Thursday 5 November 2026'), 'the day kept in the subtitle');
  assert.ok(html.includes('<title>Weekly sync</title>'), 'the PDF title without the date');
  const plain = doc('Weekly sync', '## Summary\n\nMet.\n', GREEN_KIT, { path: 'Meetings/Weekly sync.md' });
  assert.ok(plain.includes('<h1 class="blk" dir="auto">Weekly sync</h1>'), 'a title with no date reads as written');
});

test('one person once: a first name matching a fuller name is the same person, in any order', () => {
  const html = doc('Weekly sync', '---\nattendees: [Ottilie Vu, TC, Richard Chow]\n---\n\nWith TC and Ottilie\n\n## Summary\n\nMet.\n', GREEN_KIT);
  assert.ok(html.includes('<dt>Present</dt><dd dir="auto"><bdi>Ottilie Vu</bdi>, <bdi>TC</bdi>, <bdi>Richard Chow</bdi></dd>'), 'Ottilie reads once, as Ottilie Vu');
  const rev = doc('Weekly sync', '---\nattendees: [Ottilie]\n---\n\nWith Ottilie Vu and TC\n\n## Summary\n\nMet.\n', GREEN_KIT);
  assert.ok(rev.includes('<bdi>Ottilie Vu</bdi>') && !rev.includes('<bdi>Ottilie</bdi>,'), 'the fuller name wins whichever comes first');
  assert.ok(!rev.includes('<bdi>Ottilie</bdi></dd>'), 'no bare first name left');
});

test('a meeting prints Summary, Actions, Decisions, Still open, then anything else, whatever order the note holds', () => {
  const text = 'The roster is agreed.\n\n## Decisions\n\n- **Roster.** Priya takes Friday.\n\n## Still open\n\nWho takes Sunday.\n\n## Summary\n\nMet and agreed the roster.\n\n## Actions\n\n- [ ] Confirm Sunday cover — Ana · by 6 Nov 2026\n\n## Discussion\n\nTalked through the weekend.\n';
  const html = doc('Weekly sync', text, GREEN_KIT);
  const at = (h) => html.indexOf(`>${h}</h2>`);
  assert.ok(html.indexOf('The roster is agreed.') < at('Summary'), 'the person’s own lines stay at the top');
  assert.ok(at('Summary') < at('Actions') && at('Actions') < at('Decisions') && at('Decisions') < at('Still open') && at('Still open') < at('Discussion'), 'Summary, Actions, Decisions, Still open, then the rest');
  const plain = doc('A note', '## Zebra\n\nZ.\n\n## Apple\n\nA.\n', GREEN_KIT, { path: 'Notes/A note.md' });
  assert.ok(plain.indexOf('Zebra') < plain.indexOf('Apple'), 'a plain note keeps its own order');
});

test('due dates read one way: the weekday and day, the time when there is one, the year only past this year', () => {
  const now = new Date(2026, 10, 5, 12, 0, 0);
  const html = doc('Weekly sync', '## Actions\n\n- [ ] Confirm the roster — Jo · by 6 Nov 2026\n- [ ] Plan next year — Sam · by 6 Nov 2027\n- [ ] Run the trial — Ana ⏰ 2026-11-06 13:00\n- [ ] Check the locks — Sam · before opening\n', GREEN_KIT, { now });
  assert.ok(html.includes('<td class="d" dir="auto">Fri 6 Nov</td>'), 'this year: no year');
  assert.ok(html.includes('<td class="d" dir="auto">Sat 6 Nov 2027</td>'), 'another year: with the year');
  assert.ok(html.includes('<td class="d" dir="auto">Fri 6 Nov, 1 pm</td>'), 'the time when there is one');
  assert.ok(html.includes('<td class="d" dir="auto">Before opening</td>'), 'words that are not a date read as written');
});

test('a line that is only a link to the note’s own printed document or its recording is left out', () => {
  const html = doc('Weekly sync', '## Summary\n\nMet and agreed the roster.\n\nMinutes: [[Weekly sync.pdf]]\n\nSee [[Roster]] for the rest.\n', GREEN_KIT, { path: 'Meetings/Weekly sync.md' });
  assert.ok(!html.includes('Weekly sync.pdf'), 'no link to the PDF inside the PDF');
  assert.ok(!html.includes('Minutes:'), 'no label left behind');
  assert.ok(html.includes('Roster'), 'an ordinary link still reads');
  const kept = doc('Weekly sync', '## Summary\n\nMet.\n\n[[Meetings/Files/Weekly sync.pdf|Weekly sync.pdf]]\n', GREEN_KIT, { path: 'Meetings/Weekly sync.md' });
  assert.ok(!kept.includes('Weekly sync.pdf'), 'the kept-with link from the last print stays out too');
  const rec = doc('Weekly sync', '## Summary\n\nMet.\n\nRecording: [[Recording – Weekly sync 2026-11-05 05.02.m4a]]\n', GREEN_KIT, { path: 'Meetings/Weekly sync.md' });
  assert.ok(!rec.includes('.m4a'), 'its recording stays out too');
});

test('the document never names who made it', () => {
  for (const [title, text, path] of [['Weekly sync', '## Summary\n\nMet.\n', 'Meetings/Weekly sync.md'], ['A thought', 'Rain.\n', 'Notes/A thought.md']]) {
    const html = doc(title, text, GREEN_KIT, { path });
    assert.ok(!html.includes('Ironleaf'), `${title}: no Ironleaf`);
  }
  const bare = doc('A note', '## Words\n\nHello.\n', null, { path: 'Notes/A note.md' });
  assert.ok(!bare.includes('Ironleaf'), 'no kit either');
});

// m4-minutes-clean fault 7 (6 Nov 2026, "Fitzroy cafe opening: weekly" lost its colon): the file name cannot
// hold a colon, but the printed title still must. A `title:` kept in the properties prints with its colon.
test('m4: the printed title keeps a colon its file name cannot hold', () => {
  const text = '---\ntype: meeting\ndate: 2026-11-06\ntitle: "2026-11-06 Fitzroy cafe opening: weekly"\n---\n\n## Summary\n\nMet and agreed the roster.\n';
  const html = doc('2026-11-06 Fitzroy cafe opening weekly', text, GREEN_KIT, { path: 'Meetings/2026-11-06 Fitzroy cafe opening weekly.md' });
  assert.ok(html.includes('<h1 class="blk" dir="auto">Fitzroy cafe opening: weekly</h1>'), 'the title with its colon');
  assert.ok(html.includes('<title>Fitzroy cafe opening: weekly</title>'), 'the PDF title with its colon');
  const plain = doc('2026-11-06 Weekly sync', '## Summary\n\nMet.\n', GREEN_KIT, { path: 'Meetings/2026-11-06 Weekly sync.md' });
  assert.ok(plain.includes('<h1 class="blk" dir="auto">Weekly sync</h1>'), 'no title prop: the file name as before');
});

// m7-minutes-last faults 3+4 (6 Nov 2026, the second Fitzroy meeting's PDF read "Fitzroy cafe opening
// weekly 2"): the printed title keeps the colon and never the file's copy number.
test('m7: the printed title keeps the colon and never the copy number', () => {
  const text = '---\ntype: meeting\ndate: 2026-11-06\ntitle: "2026-11-06 Fitzroy cafe opening: weekly"\n---\n\n## Summary\n\nMet and agreed the roster.\n';
  const html = doc('2026-11-06 Fitzroy cafe opening weekly 2', text, GREEN_KIT, { path: 'Meetings/2026-11-06 Fitzroy cafe opening weekly 2.md' });
  assert.ok(html.includes('<h1 class="blk" dir="auto">Fitzroy cafe opening: weekly</h1>'), 'the title with its colon');
  assert.ok(html.includes('<title>Fitzroy cafe opening: weekly</title>'), 'the PDF title with its colon');
  assert.ok(!html.includes('weekly 2'), 'the copy number nowhere in the titles');
});

// n4-minutes-pdf fault 1 (6 Nov 2026, the Fitzroy run's PDF printed "[[David Kim]]" raw in its Also row):
// no section of a branded document ever shows wiki link marks. Aliases, paths and #heading forms all read
// as the words a person reads, through the one shared cleaner. Invented meeting, safe to keep.
test('n4: no wiki link marks in any section of the document', () => {
  assert.equal(B.md.linkWords('[[David Kim]]'), 'David Kim', 'a plain link');
  assert.equal(B.md.linkWords('[[People/David Kim|Kim]]'), 'Kim', 'an alias wins');
  assert.equal(B.md.linkWords('[[People/David Kim]]'), 'David Kim', 'a path reads as its name');
  assert.equal(B.md.linkWords('[[Minutes#Next steps]]'), 'Minutes', 'a note with a heading reads as the note');
  assert.equal(B.md.linkWords('[[#Next steps]]'), 'Next steps', 'a heading alone reads as its words');
  assert.equal(B.md.linkWords('[the plan](Minutes.md)'), 'the plan', 'a Markdown label reads as its words');
  assert.equal(B.md.linkWords('plain words'), 'plain words', 'bare words pass through');
  const note = `---
type: meeting
date: 2026-03-03
attendees:
  - "[[People/Ana Reyes]]"
  - "[[Sam Okafor]]"
project: "[[Riverside cafe]]"
absent: "[[People/Lee Park|Lee]]"
also:
  - "[[David Kim]]"
  - "[[Minutes#Marco|Marco]]"
figures:
  - { value: "[[20 Mar]]", label: "[[Fit-out finishes]]" }
---

## Summary

Met with [[Ana Reyes]], [[Sam Okafor|Sam]] and [[Minutes#Next steps|the plan]]; see [[#Decisions]] below.

### [[Oven trial]] recap

The [[Quay stall]] trial held.

## Actions

- [ ] Confirm the trial — [[Jo Lindqvist]] · by 4 Mar 2026
- [ ] Chase the [[Oven receipt|receipt]] — [[People/Sam Okafor]] · by [[6 Mar 2026]]

## Decisions

- One live trial at the [[Quay stall]] on Thursday.
`;
  const html = doc('Riverside Cafe Opening', note, GREEN_KIT, { now: new Date(2026, 10, 5, 12, 0, 0) });
  assert.ok(!html.includes('[[') && !html.includes(']]'), 'no link marks anywhere in the bytes');
  assert.ok(html.includes('<bdi>Ana Reyes</bdi>') && html.includes('<bdi>Sam Okafor</bdi>'), 'Present reads plain');
  assert.ok(html.includes('<bdi>Lee</bdi>'), 'Not present reads its alias');
  assert.ok(html.includes('<bdi>David Kim</bdi>') && html.includes('<bdi>Marco</bdi>'), 'Also named reads plain');
  assert.ok(html.includes('<b dir="auto">20 Mar</b><span dir="auto">Fit-out finishes</span>'), 'the figures band reads plain');
  assert.ok(html.includes('<td class="o" dir="auto">Jo Lindqvist</td>'), 'an action owner reads plain');
  assert.ok(html.includes('<td dir="auto">Chase the receipt</td><td class="o" dir="auto">Sam Okafor</td><td class="d" dir="auto">Fri 6 Mar</td>'), 'an action with links reads plain, its due read');
  assert.ok(html.includes('Met with Ana Reyes, Sam and the plan; see Decisions below.'), 'prose reads plain');
  assert.ok(html.includes('<h3 class="blk" dir="auto">Oven trial recap</h3>'), 'a heading reads plain');
  assert.ok(html.includes('One live trial at the Quay stall on Thursday.'), 'a decision reads plain');
});

// n4-minutes-pdf fault 6 (6 Nov 2026, the Fitzroy run's PDF printed "by Friday", said on a Friday, as
// "Fri 13 Nov"): loose due words print as the words said against the meeting's day; exact days print as dates.
test('n4: loose dues print as words, exact dues as dates', () => {
  const note = `---
type: meeting
date: 2026-11-06
attendees:
  - Mia Chen
---

## Actions

- [ ] Check the totals — Mia · by Friday
- [ ] Chase the stone top for Thursday morning — by Thursday morning
- [ ] Check the first day totals, by opening morning
- [ ] Get the quote over — Sam · by next week
- [ ] Confirm the council booking — Noah · by Monday the 9th
- [ ] Send the full order — Mia · by 13 Nov 2026
- [ ] Book the crane — Sam · by Thursday the 19th
- [ ] Book the hoist — Sam · by Monday the 19th
`;
  const html = doc('Mill call', note, GREEN_KIT, { now: new Date(2026, 10, 6, 12, 0, 0) });
  assert.ok(html.includes('<td dir="auto">Check the totals</td><td class="o" dir="auto">Mia</td><td class="d" dir="auto">Friday</td>'), 'Friday stays Friday');
  assert.ok(html.includes('<td dir="auto">Chase the stone top for Thursday morning</td><td class="o" dir="auto"></td><td class="d" dir="auto">Thursday morning</td>'), 'Thursday morning stays Thursday morning (e2, never Thu 12 Nov)');
  assert.ok(html.includes('<td dir="auto">Check the first day totals</td><td class="o" dir="auto"></td><td class="d" dir="auto">Opening morning</td>'), 'a comma tail prints as the dash tail did (e2)');
  assert.ok(html.includes('<td dir="auto">Get the quote over</td><td class="o" dir="auto">Sam</td><td class="d" dir="auto">Next week</td>'), 'next week stays next week');
  assert.ok(html.includes('<td dir="auto">Confirm the council booking</td><td class="o" dir="auto">Noah</td><td class="d" dir="auto">Mon 9 Nov</td>'), 'an exact day prints as a date');
  assert.ok(html.includes('<td dir="auto">Send the full order</td><td class="o" dir="auto">Mia</td><td class="d" dir="auto">Fri 13 Nov</td>'), 'a written date prints as a date');
  // HOLD 5 (6 Nov 2026): a weekday with its numbered day prints that date; one that does not fall
  // on that date prints as the words said, never an invented Thursday.
  assert.ok(html.includes('<td dir="auto">Book the crane</td><td class="o" dir="auto">Sam</td><td class="d" dir="auto">Thu 19 Nov</td>'), 'Thursday the 19th prints Thu 19 Nov');
  assert.ok(html.includes('<td dir="auto">Book the hoist</td><td class="o" dir="auto">Sam</td><td class="d" dir="auto">Monday the 19th</td>'), 'a doubtful weekday prints as words');
});

// m4-minutes-clean fault 6 (6 Nov 2026, the Fitzroy run's PDF wrapped its action numbers 10 to 13 over two
// lines, "1/0"): the number column never wraps, for any count. The style keeps each number on one line with
// tabular figures and room for three digits; the table itself numbers every row.
test('m4: the actions number column never wraps, for 9, 13 and 120 rows', () => {
  const style = doc('Weekly sync', '## Actions\n\n- [ ] Do one thing — Jo\n', GREEN_KIT);
  assert.match(style, /table\.actions td\.n\{[^}]*white-space:nowrap/, 'each number on one line');
  assert.match(style, /table\.actions td\.n\{[^}]*tabular-nums/, 'figures that line up');
  assert.match(style, /table\.actions td\.n\{[^}]*width:1\dmm/, 'room for three digits');
  for (const n of [9, 13, 120]) {
    const lines = Array.from({ length: n }, (_, i) => `- [ ] Job ${i + 1} for the opening — Jo · by 6 Nov 2026`).join('\n');
    const html = doc('Weekly sync', `## Actions\n\n${lines}\n`, GREEN_KIT);
    assert.ok(html.includes(`<td class="n" dir="auto">${n}</td>`), `${n} rows: the last number prints whole`);
    assert.equal((html.match(/<td class="n" dir="auto">/g) ?? []).length, n, `${n} rows: every row numbered`);
  }
});
