// node --test tests/editor-markdown.test.mjs — callouts and coloured highlights (5.0.0): how a callout's first line is
// read (kind, aliases, fold sign, title), every callout found in a note with its lines (none inside code), highlights in
// six colours put on, changed and taken off as portable Markdown (==yellow==, <mark class="nv-green">), and the page
// renderer drawing both: callouts as titled boxes (folded when written [!kind]-), our colour tags as highlights, and any
// other HTML still shown as text. Page columns (8.8) drawn side by side, unfinished blocks left as words.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-editor-md-'));
let C;
let H;
let R;
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const bundle = async (name, source, plugins = []) => {
    const entry = path.join(work, `${name}.ts`);
    writeFileSync(entry, source);
    await build({ input: entry, platform: 'node', plugins, output: { file: path.join(work, `${name}.mjs`), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, `${name}.mjs`)).href);
  };
  C = await bundle('callouts', `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/callouts.ts'))};\n`);
  H = await bundle('highlights', `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/highlights.ts'))};\n`);
  // The editor's parser with Ironleaf's extensions (what Live Preview draws from).
  P = await bundle('parser', `import { parser } from ${JSON.stringify(path.join(root, 'node_modules/@lezer/markdown/dist/index.js'))};\nimport { ironleafMarkdown } from ${JSON.stringify(path.join(root, 'src/renderer/src/editor/markdown-ext.ts'))};\nexport const md = parser.configure(ironleafMarkdown);\n`);
  // The page renderer, with the window's link lookups stood in for (no notes here: every link is unresolved).
  const stub = path.join(work, 'resolve-stub.ts');
  writeFileSync(stub, 'export const fileUrl = (p: string) => p;\nexport const isAudio = () => false;\nexport const isImage = () => false;\nexport const isPdf = () => false;\nexport const isVideo = () => false;\nexport const resolveAny = () => null;\nexport const resolveFile = () => null;\n');
  const stubResolve = { name: 'stub-resolve', resolveId: (id, importer) => (id === './resolve' && importer?.endsWith('markdownRender.ts') ? stub : null) };
  R = await bundle('render', `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/markdownRender.ts'))};\n`, [stubResolve]);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a callout head: kind, alias, fold sign and title', () => {
  const tip = C.parseCalloutHead('> [!tip] Bake the day before');
  assert.equal(tip.type, 'tip');
  assert.equal(tip.title, 'Bake the day before');
  assert.equal(tip.fold, '');
  assert.equal('> [!tip] Bake the day before'.slice(tip.titleAt), 'Bake the day before');
  const folded = C.parseCalloutHead('>[!WARNING]- ');
  assert.equal(folded.type, 'warning');
  assert.equal(folded.fold, '-');
  assert.equal(folded.title, 'Warning', 'no title: the kind’s own name');
  assert.equal(C.parseCalloutHead('> [!tldr]+ Short').type, 'abstract', 'an alias is its kind');
  assert.equal(C.parseCalloutHead('> [!error]').type, 'danger');
  const own = C.parseCalloutHead('> [!recipe] Scones');
  assert.equal(own.type, 'note', 'an unknown kind draws as a note');
  assert.equal(own.label, 'Recipe', 'but keeps its own name');
  assert.equal(C.parseCalloutHead('> Just a quote'), null);
  assert.equal(C.parseCalloutHead('[!note] not in a quote'), null);
  assert.equal(C.parseCalloutHead('    > [!note] indented code'), null);
});

test('every callout in a note, with its lines; none inside code', () => {
  const text = ['# Plan', '', '> [!note] First', '> line two', '> line three', '', '```', '> [!tip] an example', '```', '', '> [!danger]-', '> careful', 'after'].join('\n');
  const blocks = C.calloutBlocks(text);
  assert.deepEqual(blocks.map((b) => [b.type, b.first, b.last, b.fold]), [
    ['note', 2, 4, ''],
    ['danger', 10, 11, '-'],
  ]);
});

test('a callout written out, with its words quoted', () => {
  assert.equal(C.calloutMarkdown('tip'), '> [!tip]');
  assert.equal(C.calloutMarkdown('info', 'Opening hours', 'Mon to Fri\n\nClosed on Sunday'), '> [!info] Opening hours\n> Mon to Fri\n>\n> Closed on Sunday');
  for (const kind of C.CALLOUT_PICKS) assert.ok(C.CALLOUT_TYPES[kind] && C.CALLOUT_HINTS[kind], `${kind} has a name and a hint`);
});

/** Applies an edit to the text (changes are in the text's own places, as CodeMirror takes them). */
const apply = (text, edit) => {
  let out = text;
  for (const c of [...edit.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return { text: out, selected: out.slice(edit.selection.from, edit.selection.to) };
};
const sel = (text, words) => [text.indexOf(words), text.indexOf(words) + words.length];

test('highlight colours: yellow as ==, the others as <mark class>, words stay selected', () => {
  const text = 'Order flour by Friday';
  let r = apply(text, H.applyHighlight(text, ...sel(text, 'flour'), 'yellow'));
  assert.equal(r.text, 'Order ==flour== by Friday');
  assert.equal(r.selected, 'flour');
  r = apply(text, H.applyHighlight(text, ...sel(text, 'by Friday'), 'green'));
  assert.equal(r.text, 'Order flour <mark class="nv-green">by Friday</mark>');
  assert.equal(r.selected, 'by Friday');
  // Spaces at the edges stay outside (==words== must touch its words).
  r = apply(text, H.applyHighlight(text, 5, 12, 'blue'));
  assert.equal(r.text, 'Order <mark class="nv-blue">flour</mark> by Friday');
});

test('the same colour takes it off, another colour changes it, none takes it off', () => {
  const yellow = 'Order ==flour== now';
  let r = apply(yellow, H.applyHighlight(yellow, ...sel(yellow, 'flour'), 'yellow'));
  assert.equal(r.text, 'Order flour now');
  r = apply(yellow, H.applyHighlight(yellow, ...sel(yellow, 'flour'), 'pink'));
  assert.equal(r.text, 'Order <mark class="nv-pink">flour</mark> now');
  assert.equal(r.selected, 'flour');
  const pink = r.text;
  r = apply(pink, H.applyHighlight(pink, ...sel(pink, 'flo'), null));
  assert.equal(r.text, 'Order flour now', 'part of it selected: the whole highlight goes');
  const at = pink.indexOf('lou');
  r = apply(pink, H.applyHighlight(pink, at, at, 'orange'));
  assert.equal(r.text, 'Order <mark class="nv-orange">flour</mark> now', 'the cursor in it is enough');
  assert.equal(H.applyHighlight('plain words', 3, 3, 'green'), null, 'nothing selected and no highlight: the caller picks the word');
  assert.equal(H.applyHighlight('plain words', 0, 5, null), null);
});

test('several lines: each line on its own, leads kept outside', () => {
  const text = '- Flour\n- Butter\n\n## Salt';
  const r = apply(text, H.applyHighlight(text, 0, text.length, 'purple'));
  assert.equal(r.text, '- <mark class="nv-purple">Flour</mark>\n- <mark class="nv-purple">Butter</mark>\n\n## <mark class="nv-purple">Salt</mark>');
  assert.ok(r.selected.startsWith('Flour</mark>') && r.selected.endsWith('Salt'));
  const off = apply(r.text, H.applyHighlight(r.text, 0, r.text.length, null));
  assert.equal(off.text, text);
});

test('highlights in a line: both kinds, none inside code', () => {
  const found = H.highlightsInLine('==a== and <mark class="nv-blue">b</mark> but `==c==` and == d ==');
  assert.deepEqual(found.map((h) => h.colour), ['yellow', 'blue']);
  assert.equal(H.isHighlightColour('green'), true);
  assert.equal(H.isHighlightColour('red'), false);
});

test('the page: callouts as titled boxes, folded when written [!kind]-', () => {
  const html = R.renderMarkdown('> [!tip] Bake the day before\n> The crumb sets overnight.');
  assert.match(html, /<div class="callout callout-tip"/);
  assert.match(html, /callout-title-text">Bake the day before</);
  assert.match(html, /<div class="callout-content"><p[^>]*>The crumb sets overnight.<\/p>/);
  const folded = R.renderMarkdown('> [!warning]- Careful\n> Hot oven.');
  assert.match(folded, /class="callout callout-warning is-collapsed is-foldable"/);
  assert.match(folded, /callout-fold/);
  const plain = R.renderMarkdown('> Just a quote');
  assert.match(plain, /<blockquote/);
});

test('the page: columns drawn side by side, unfinished blocks left as words', () => {
  const html = R.renderMarkdown('<!-- columns:2 -->\n## Saturday\n\nBake at dawn.\n\n<!-- column -->\n\n## Sunday\n\nSell at the market.\n<!-- end columns -->\n');
  assert.match(html, /class="nv-columns"/);
  assert.match(html, /--nv-cols:2/);
  assert.match(html, /<div class="nv-column">/);
  assert.ok(html.indexOf('Saturday') < html.indexOf('Sunday'), 'in reading order');
  assert.ok(!html.includes('<!-- columns'), 'markers drawn, not shown');
  const unfinished = R.renderMarkdown('<!-- columns:2 -->\nBake at dawn.\n');
  assert.ok(unfinished.includes('columns:2'), 'no end: left as words');
});

test('the page: our colour tags highlight, other HTML stays text', () => {
  const html = R.renderMarkdown('Buy <mark class="nv-green">**fresh** yeast</mark> and ==flour==.');
  assert.match(html, /<mark class="nv-green"><strong>fresh<\/strong> yeast<\/mark>/);
  assert.match(html, /<mark>flour<\/mark>/);
  const unsafe = R.renderMarkdown('<mark class="nv-red">x</mark> <mark onclick="x()">y</mark> <script>alert(1)</script>');
  assert.doesNotMatch(unsafe, /<mark|<script/);
  assert.match(unsafe, /&lt;script&gt;/);
});

/** The node names the editor's parser finds in a line, in order. */
const nodes = (text) => {
  const out = [];
  P.md.parse(text).iterate({ enter: (n) => void out.push(`${n.name}:${text.slice(n.from, n.to)}`) });
  return out;
};

test('the editor reads our colour tags as a highlight with marks, words inside still formatted', () => {
  const found = nodes('Buy <mark class="nv-green">**fresh** yeast</mark> now');
  assert.ok(found.includes('ColourHighlight:<mark class="nv-green">**fresh** yeast</mark>'));
  assert.ok(found.includes('ColourHighlightMark:<mark class="nv-green">'));
  assert.ok(found.includes('ColourHighlightMark:</mark>'));
  assert.ok(found.includes('StrongEmphasis:**fresh**'), 'bold inside still bold');
  const other = nodes('A <mark class="nv-red">red</mark> one');
  assert.ok(!other.some((n) => n.startsWith('ColourHighlight')), 'not one of our colours: left as HTML');
  assert.ok(nodes('==plain==').some((n) => n === 'Highlight:==plain=='));
});
