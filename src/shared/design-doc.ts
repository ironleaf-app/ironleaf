// SPDX-License-Identifier: AGPL-3.0-or-later
// The Design studio's document (22 Nov 2026, phase 1): a note designed by the person's own AI into a finished PDF in
// their brand. The AI lays the pages out; Ironleaf owns everything around it. Pure: words in, words (HTML) out.
//
//   designTheme     the brand kit as a whole theme of tokens: the accent and its tints, words that read on it, ink,
//                   greys, a type scale and a spacing scale (after Astryx's themes, MIT: a theme is a set of custom
//                   properties, and the designer uses only those). No kit: a quiet neutral theme, never Ironleaf's own.
//   designSystem    what the AI is told: the page system, the tokens, the frames to start from, how to design well.
//   designAsk       the job: what to make, what the person asked, the note's cleaned words in numbered blocks.
//   designFeedback  how it printed, measured (and the pages as pictures, for a model that sees): fix what is wrong.
//   readDesign      the AI's answer as the document's HTML (its one style and its sections), scrubbed.
//   designPage      the page the hidden print window opens: the theme, the base styles, the AI's layout and the
//                   note's blocks as data, and the page's own script that cleans the layout again (an allow list),
//                   places the blocks and logo, measures every page and says what is wrong.
//
// The note's words come from the branded document's own reading (brandContent in src/shared/brand-document.ts):
// secrets, private paths, front matter and the transcript never reach the AI or the page. The AI places the person's
// words by number and never retypes them; in a shortened kind it may also write short words of its own from them.
// The print window is sealed (src/main/brand-print.ts: nothing remote is ever fetched) and this page adds its own
// fence: a Content-Security-Policy that runs only its own script, and a layout that may hold no picture, link, script,
// font or url() of the AI's own.

import { BAND_DARK, contrastOf, esc, inkFor, accentOf, type BrandContent } from './brand-document';
import { cleanHex, fromHex, toHex, type BrandKit } from './assets';
import { DESIGN_EXEMPLARS } from './design-exemplars';

// ── Kinds ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DesignKind = 'report' | 'one-pager' | 'proposal' | 'handout' | 'poster' | 'slides';

export interface DesignKindInfo {
  id: DesignKind;
  name: string;
  /** One line on what it is, for the person and for the AI. */
  line: string;
  /** The page in millimetres. */
  page: { w: number; h: number };
  /** keep: every block placed, the person's words only. shorten: the AI may write short words of its own from them. */
  words: 'keep' | 'shorten';
  /** Exactly this many pages (one-pager, poster), else as many as the content needs. */
  pages?: number;
  /** A long document's shape: a designed cover (and at most one summary page), then every block in one flow. */
  flow?: boolean;
  /** Which reference design it is shown: a page, a deck or a document. */
  shape: 'page' | 'deck' | 'document';
  /** The proven page plan for this kind, page by page: the AI fills it rather than inventing a structure. */
  plan: string;
  /** What the AI is told about this kind, beyond the line. */
  brief: string;
}

const A4 = { w: 210, h: 297 };
/** A 16:9 slide on an A4-wide page. */
const SLIDE = { w: 297, h: 167 };

export const DESIGN_KINDS: DesignKindInfo[] = [
  { id: 'report', name: 'Report', line: 'A designed cover, then every word of the note set to read well.', page: A4, words: 'keep', flow: true, brief: 'A report: a designed cover page (the logo, the title, what it is, the key figures when there are any), then the whole note set beautifully in the brand.', shape: 'document', plan: "Page 1, the cover: the logo top left, a small label top right, the title huge (class display) low on the page with a one-line summary under it, the key figures in a full-width band at the foot. Page 2, at a glance (when the note has figures): one hero number with what it means, the why in three short lines, a bar chart of the main numbers, what to watch. Then the flow: every block in order, each section opened by a short brand rule, a small section number and its heading; tables set clean; the decision or ask in one strong panel where the note makes it." },
  { id: 'one-pager', name: 'One-pager', line: 'The note on a single page: the headline, the key points, the figures.', page: A4, words: 'shorten', pages: 1, brief: 'A one-pager: exactly one page that a busy reader takes in at a glance. A strong headline, a short summary, the key points and figures from the note, the next steps when there are any. Shorten: choose what matters, never cram.', shape: 'page', plan: "Top: the logo and a small label on one line. A headline (fs-7, two lines at most) and a two-line summary. The key figures in a band (3 or 4). The body in a 12-column grid: span-7 for the why and the plan (numbered steps), span-5 for the money as bars or a short table and the risks. The foot: the decision or ask in one strong panel beside the next steps (who, what, when). The footer." },
  { id: 'proposal', name: 'Proposal', line: 'A cover and sections laid out to persuade: the ask, the why, the how.', page: A4, words: 'keep', flow: true, brief: 'A proposal: a confident cover, a summary page that makes the ask and its reasons stand out (the key figures, the decision wanted, the why in a few lines, all from the note), then the whole note set beautifully in the brand.', shape: 'document', plan: "Page 1, the cover: confident and simple, the logo, the title huge, who it is for. Page 2, the ask: the decision wanted in one sentence set large, the key figures, the why in three lines, the cost as bars, the timeline. Then the flow: every block in order, sections opened by a short brand rule and their heading, the ask repeated in a strong panel at the end." },
  { id: 'handout', name: 'Handout', line: 'Two pages, visual and easy to skim, for a meeting or a customer.', page: A4, words: 'shorten', pages: 2, brief: 'A two-page handout: visual, easy to skim, with panels, figures and short sections. Shorten: the reader has two minutes.', shape: 'page', plan: "Page 1: the logo and label, a headline, a short summary, the key figures in a band, then two columns (span-7 and span-5) with the story and a chart. Page 2: the details people keep (a table, the steps, the people or dates), a pull quote or callout, and what happens next. Visual and skimmable: short paragraphs, many small headings." },
  { id: 'poster', name: 'Poster', line: 'One bold page: a big message, a few words, the brand.', page: A4, words: 'shorten', pages: 1, brief: 'A poster: one page, a big message in display type, a few supporting lines, the brand strong. Very few words.', shape: 'page', plan: "One page: the brand strong (a full-bleed colour band or a page of the brand colour), the logo, one message in display type (fs-9 or fs-10, three lines at most), one hero number with its label, three short supporting lines at most, and the when or call to action at the foot." },
  { id: 'slides', name: 'Slides', line: 'A slide deck (16:9): one idea per slide.', page: SLIDE, words: 'shorten', brief: 'A slide deck of 16:9 slides, one section class="page" per slide: a title slide, then one idea per slide (a headline and at most five short lines, or one figure, or one chart), and a closing slide. Shorten: slides carry headlines, not paragraphs.', shape: 'deck', plan: "Slide 1: the title slide in the brand colour (logo, a small label, the title in display type, one line under it). Then one idea per slide, each with a small label and a headline that states the point: a hero-number slide, a timeline slide for the plan, a chart slide for the money, a risks slide, a decision slide in the brand colour, and a closing next-steps slide. Never more than five short lines of text on a slide." },
];

export const kindInfo = (id: unknown): DesignKindInfo => DESIGN_KINDS.find((k) => k.id === id) ?? DESIGN_KINDS[0];

// ── Between the window and the main side ─────────────────────────────────────────────────────────────────────────

/** A design asked for by the window: the note's cleaned content (brandContent's), its kit and its logos' addresses. */
export interface DesignStartIn {
  /** The note's vault path (its level is checked against what the AI may read). */
  path: string;
  kind: DesignKind;
  brief: string;
  title: string;
  content: BrandContent;
  kit: BrandKit | null;
  logos: { primary?: string; onDark?: string };
  brandName: string;
}

/** A design as the window shows it. */
export interface DesignViewOut {
  id: string;
  kind: DesignKind;
  pages: number;
  /** The pages as pictures (data: addresses). */
  shots: string[];
  /** What is still wrong after the AI's rounds, in words. */
  problems: string[];
  /** How many times the AI looked at its printed pages and changed them. */
  rounds: number;
  /** The AI's last judgement of its printed pages (Astryx's five axes, 0 to 100), when its model sees pictures. */
  score?: { layout: number; hierarchy: number; spacing: number; parts: number; colour: number; mean: number };
  /** The files this design saves as, PDF first (phase 2): slides as PowerPoint, a page document as Word, a note with
   *  tables or key figures as Excel. */
  formats: DesignFormat[];
}

/** The files a design saves as. */
export type DesignFormat = 'pdf' | 'pptx' | 'docx' | 'xlsx';

export const DESIGN_FORMATS: Record<DesignFormat, { name: string; ext: string; filter: string }> = {
  pdf: { name: 'PDF', ext: 'pdf', filter: 'PDF' },
  pptx: { name: 'PowerPoint', ext: 'pptx', filter: 'PowerPoint presentation' },
  docx: { name: 'Word', ext: 'docx', filter: 'Word document' },
  xlsx: { name: 'Excel', ext: 'xlsx', filter: 'Excel workbook' },
};

export const isDesignFormat = (v: unknown): v is DesignFormat => v === 'pdf' || v === 'pptx' || v === 'docx' || v === 'xlsx';

// ── The theme ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DesignTheme {
  /** Custom properties (name without --, value). */
  tokens: [string, string][];
  /** The theme's fonts by role, as CSS font-family lists. */
  head: string;
  body: string;
  /** Whether a brand kit set it (else the quiet neutral theme). */
  branded: boolean;
  /** The kit's other colours by token, for the AI's list. */
  extra: { token: string; name: string }[];
}

const mix = (a: string, b: string, t: number): string => {
  const x = fromHex(a);
  const y = fromHex(b);
  return toHex(Math.round(x[0] + (y[0] - x[0]) * t), Math.round(x[1] + (y[1] - x[1]) * t), Math.round(x[2] + (y[2] - x[2]) * t));
};

const fontOk = (name: string) => /^[\p{L}\p{N} ._-]{1,80}$/u.test(name);
const SANS_FALLBACK = '"Inter","Helvetica Neue",Helvetica,Arial,"Liberation Sans",sans-serif';
const SERIF_FALLBACK = '"Source Serif 4",Georgia,"Times New Roman",serif';

/** The type scale in points: base 10pt, ratio 1.25 (the documents' size; a screen theme's 14px is too big on paper). */
export const TYPE_SCALE = [8, 10, 12.5, 15.6, 19.5, 24.4, 30.5, 38.1, 47.7, 59.6, 74.5];
/** The spacing scale in millimetres: a 2mm rhythm. */
export const SPACE_SCALE = [2, 3, 4, 6, 8, 12, 16, 24];

export function designTheme(kit: BrandKit | null | undefined): DesignTheme {
  const accent = accentOf(kit) ?? BAND_DARK;
  const onAccent = inkFor(accent);
  const ink = '#101820';
  // A pale accent (a yellow, a pastel) can't carry words or rules on white: its strong step is darkened until it
  // reads, and headings use that.
  let strong = accent;
  for (let t = 0.15; contrastOf(strong, '#ffffff') < 4.5 && t <= 0.9; t += 0.15) strong = mix(accent, '#000000', t);
  const tokens: [string, string][] = [
    ['accent', accent],
    ['on-accent', onAccent],
    ['accent-strong', strong],
    ['accent-1', mix(accent, '#ffffff', 0.94)],
    ['accent-2', mix(accent, '#ffffff', 0.86)],
    ['accent-3', mix(accent, '#ffffff', 0.7)],
    ['accent-4', mix(accent, '#ffffff', 0.4)],
    ['accent-5', mix(accent, '#000000', 0.3)],
    ['ink', ink],
    ['muted', '#5A6067'],
    ['line', '#D6D9DC'],
    ['soft', '#F4F5F6'],
    ['paper', '#ffffff'],
    ['dark', '#101820'],
    ['on-dark', '#ffffff'],
  ];
  const extra: { token: string; name: string }[] = [];
  const seen = new Set([accent]);
  for (const c of kit?.colours ?? []) {
    const hex = cleanHex(c.hex);
    if (!hex || seen.has(hex) || extra.length >= 3) continue;
    seen.add(hex);
    const token = `brand-${extra.length + 2}`;
    tokens.push([token, hex], [`on-${token}`, inkFor(hex)]);
    extra.push({ token, name: [c.name, c.use].filter(Boolean).join(', ') || hex });
  }
  TYPE_SCALE.forEach((pt, i) => tokens.push([`fs-${i}`, `${pt}pt`]));
  SPACE_SCALE.forEach((mm, i) => tokens.push([`sp-${i + 1}`, `${mm}mm`]));
  tokens.push(['r-1', '1.5mm'], ['r-2', '3mm'], ['r-3', '6mm']);
  const fonts = (kit?.fonts ?? []).filter((f) => fontOk(f.name));
  const headFont = fonts.find((f) => /head|display|title/i.test(f.use ?? '')) ?? fonts[0];
  const bodyFont = fonts.find((f) => /body|text|copy|para/i.test(f.use ?? '')) ?? fonts[1] ?? fonts[0];
  const head = headFont ? `"${headFont.name}",${SANS_FALLBACK}` : SANS_FALLBACK;
  const body = bodyFont ? `"${bodyFont.name}",${SANS_FALLBACK}` : SANS_FALLBACK;
  tokens.push(['font-head', head], ['font-body', body], ['font-serif', SERIF_FALLBACK]);
  return { tokens, head, body, branded: !!accentOf(kit), extra };
}

/** Typefaces every copy of PowerPoint, Word and Excel has (Windows and Mac), with metric twins elsewhere. */
const OFFICE_FONTS = /^(arial|calibri|cambria|candara|consolas|constantia|corbel|georgia|helvetica|segoe ui|tahoma|times new roman|trebuchet ms|verdana|aptos|garamond|palatino linotype|book antiqua|century gothic|franklin gothic medium|gill sans mt|lucida sans|rockwell)$/i;

/** The theme set in typefaces an Office file can count on (phase 2): a kit font Office has is kept; any other (a web
 *  font, the app's own type) becomes Arial, or Georgia for a serif. A deck is laid out in these before it is read
 *  back for PowerPoint, so its words wrap there as they did here. */
export function officeTheme(theme: DesignTheme): DesignTheme {
  const pick = (stack: string, fallback: string) => {
    const first = stack.split(',')[0].replace(/["']/g, '').trim();
    return OFFICE_FONTS.test(first) ? `"${first}",${fallback}` : fallback;
  };
  const head = pick(theme.head, 'Arial,sans-serif');
  const body = pick(theme.body, 'Arial,sans-serif');
  const tokens = theme.tokens.map(([k, v]): [string, string] => (k === 'font-head' ? [k, head] : k === 'font-body' ? [k, body] : k === 'font-serif' ? [k, 'Georgia,serif'] : [k, v]));
  return { ...theme, tokens, head, body };
}

const rootCss = (t: DesignTheme) => `:root{${t.tokens.map(([k, v]) => `--${k}:${v}`).join(';')}}`;

// ── What the AI is told ──────────────────────────────────────────────────────────────────────────────────────────────

/** The parts the AI builds with (after Astryx: start from the system's parts, not from scratch): each a class on the
 *  page already, drawn in the brand's tokens, so a design is good before the AI writes a line of CSS of its own. */
export const DESIGN_PARTS = `- class="kicker": a small spaced capital label above a title (brand colour).
- class="display": a very large title (put it on the cover or a title slide). class="lead": a larger intro paragraph.
- class="figures" on a div holding 2-4 <div><b>$184k</b><span>Total budget</span></div>: big numbers with small labels. Add "on-accent", "on-dark" or "quiet" for a band in the brand colour, near-black or a pale tint.
- class="panel": a pale brand-tinted box with rounded corners; "panel strong" for the brand colour with its words; "panel dark".
- class="callout": a decision or key message, large, under a short brand rule.
- class="pull": a pull quote or the one line that matters, big in the heading type and the brand colour.
- class="stat" on a div holding <b>22 months</b><span>Payback</span>: one hero number, set enormous (the page's dominant element).
- class="grid" (12 columns, the standard gap) with children of class="span-3" … "span-12" (span-8 + span-4, span-7 + span-5: asymmetric beats equal).
- class="bleed" on a direct child of a page: runs to the page's left and right edges (a band of brand colour or a picture), its words kept on the page's margins.
- class="caption": a small muted line under a chart, figure or table.
- class="cols-2", "cols-3", "cols-2-1", "cols-1-2": columns with the standard gap. class="stack": items one under another with the standard gap.
- class="steps" on a single <ol> holding all its <li> steps: numbered steps with brand-coloured numbers in circles.
- class="bars" on a div holding <div class="bar" style="--v:0.5"><span>Ovens</span><b>$54k</b></div> rows: a bar chart, --v from 0 to 1 (the largest is 1).
- class="chips" on a div of <span>s: small rounded labels.
- class="rule": a short thick brand-coloured line under a heading. class="muted": quieter words.
- class="nv-foot": the small footer (8pt, a hairline above); put <nv-page-number></nv-page-number> in it.
- class="fill": takes the remaining height in a page laid out as a column (the page is display:flex;flex-direction:column by default).`;

/** The frames to start from, by kind: built from the parts and the tokens, never a finished design. */
function framesFor(kind: DesignKindInfo): string {
  if (kind.id === 'slides')
    return `Title slide:
<section class="page" style="background:var(--accent);color:var(--on-accent);padding:var(--sp-7)">
  <nv-logo role="onDark" style="height:12mm"></nv-logo>
  <div class="fill" style="display:flex;flex-direction:column;justify-content:center">
    <p class="kicker" style="color:var(--on-accent);opacity:.85">Board briefing</p>
    <h1 class="display" style="color:var(--on-accent)">The title, said in a few words</h1>
    <p class="lead" style="color:var(--on-accent)">One line on what it is</p>
  </div>
</section>
A slide with one idea and its proof:
<section class="page" style="padding:var(--sp-6) var(--sp-7)">
  <p class="kicker">The plan</p>
  <h2 style="font-size:var(--fs-6);margin:0 0 var(--sp-5)">One idea, said as a headline</h2>
  <div class="cols-2 fill" style="align-items:center"><ol class="steps">…three to five short lines…</ol><div class="figures quiet">…</div></div>
  <footer class="nv-foot"><span>Name</span><nv-page-number></nv-page-number></footer>
</section>
A big-number slide:
<section class="page" style="padding:var(--sp-7);justify-content:center">
  <p class="kicker">Payback</p><p class="display" style="color:var(--accent-strong)">22 months</p><p class="lead">What it means, in one line</p>
</section>`;
  return `Cover page:
<section class="page">
  <header style="background:var(--accent);padding:var(--sp-6) var(--sp-7);display:flex;justify-content:space-between;align-items:center">
    <nv-logo role="onDark" style="height:14mm"></nv-logo><span class="kicker" style="color:var(--on-accent);margin:0">Label</span>
  </header>
  <div class="fill" style="padding:var(--sp-8) var(--sp-7);display:flex;flex-direction:column;justify-content:flex-end">
    <h1 class="display">Title</h1>
    <p class="lead">Subtitle or the one-line summary</p>
  </div>
  <div class="figures on-dark" style="padding:var(--sp-5) var(--sp-7)">…the key figures…</div>
</section>
A designed page (a one-pager, or a page of a report):
<section class="page" style="padding:var(--sp-7)">
  <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-5)"><nv-logo style="height:10mm"></nv-logo><span class="kicker" style="margin:0">Label</span></header>
  <h1 style="font-size:var(--fs-7)">Headline</h1><p class="lead">The summary in two lines.</p>
  <div class="figures quiet" style="margin:var(--sp-5) 0">…</div>
  <div class="cols-2-1 fill"><div class="stack">…the main words…</div><aside class="stack"><div class="panel">…</div><div class="callout">…</div></aside></div>
  <footer class="nv-foot"><span>Name</span><nv-page-number></nv-page-number></footer>
</section>
Long running text (continues over as many pages as it needs; margins, footer and page numbers are drawn for you):
<section class="flow"><nv-block ref="b4"></nv-block><nv-block ref="b5"></nv-block>…</section>`;
}

export function designSystem(kind: DesignKindInfo, theme: DesignTheme, o: { logo: boolean; brandName: string }): string {
  const { w, h } = kind.page;
  const keep = kind.words === 'keep';
  const colours = [
    'var(--accent) the brand colour; var(--on-accent) words on it; var(--accent-strong) the brand colour for headings and rules on white (it always reads on white)',
    'var(--accent-1) … var(--accent-4) tints of it, palest first (panels, bands, table stripes); var(--accent-5) a deep shade',
    'var(--ink) body text; var(--muted) quieter text; var(--line) hairlines; var(--soft) a quiet grey panel; var(--paper) the page (white); var(--dark) and var(--on-dark) a near-black band and its words',
    ...theme.extra.map((e) => `var(--${e.token}) the brand's ${e.name}, with var(--on-${e.token}) for words on it`),
  ];
  return `You are the document designer built into Ironleaf, a notes app. You design one finished document, as HTML and CSS, that prints to PDF in the person's own brand. You design like a senior graphic designer: a clear hierarchy, generous but purposeful space, strong type, the brand used with intent. Never generic, never cluttered.

The page system (already on the page: never write @page, html or body styles):
- Each page is <section class="page">…</section>: exactly one printed page of ${w} × ${h} mm with no margin of its own (give it padding). Nothing scrolls: anything past its edge is cut off and lost.
- <section class="flow">…</section> is running text that continues over as many pages as it needs, with margins, a footer and page numbers drawn for you. Use it only for long running text, after a designed page.
- ${kind.pages ? `This document is exactly ${kind.pages} ${kind.pages === 1 ? 'page' : 'pages'}: ${kind.pages} section class="page", no flow section.` : kind.flow ? 'Its shape is fixed: (1) a designed cover, one section class="page"; (2) if it helps, one designed summary page (no more), a section class="page" (your words from the blocks: the key figures, the ask or decision, the why in a few lines); (3) then one section class="flow" (only one) holding every block in order, b1 to the last, each once as an empty <nv-block ref>. Between blocks inside the flow you may add a part (a callout, a figures band, a panel). No designed pages after the flow. Give the flow its look with CSS of your own scoped to section.flow (its h2, h3, tables, lists, quotes), so the whole reads as one designed document.' : 'Use as many pages as the content needs.'}
- Lay pages out with CSS grid and flexbox. Measure in mm and pt (never px, vw or vh). Put your CSS in one <style> element and in style attributes.
- A page is a column (display:flex;flex-direction:column) unless you set otherwise; class="fill" on a child takes the height left, so a page ends where it should. A footer of class="nv-foot" sits at the foot of the page by itself.${kind.id === 'slides' ? ' On a slide the content is centred top to bottom by itself: never leave it stuck at the top with the space below empty.' : ''}
- <nv-page-number></nv-page-number> prints "n of N" where you put it.

The parts (already styled in the brand: build with these first, and write CSS of your own only for what they don't cover; never restyle a part's insides — its numbers, figures, bars and labels — only place and size it):
${DESIGN_PARTS}

The brand (custom properties on :root: use only these, never a hex, rgb or colour name, never a font name):
- Colours: ${colours.join('. ')}.
- Type: var(--font-head) for headings, var(--font-body) for text. Sizes var(--fs-0) 8pt, var(--fs-1) 10pt (body text), var(--fs-2) 12.5pt, var(--fs-3) 15.6pt, var(--fs-4) 19.5pt, var(--fs-5) 24.4pt, var(--fs-6) 30.5pt, var(--fs-7) 38.1pt, var(--fs-8) 47.7pt, var(--fs-9) 59.6pt, var(--fs-10) 74.5pt.
- Spacing: var(--sp-1) 2mm, var(--sp-2) 3mm, var(--sp-3) 4mm, var(--sp-4) 6mm, var(--sp-5) 8mm, var(--sp-6) 12mm, var(--sp-7) 16mm (page sides), var(--sp-8) 24mm. Corners var(--r-1), var(--r-2), var(--r-3).
- ${o.logo ? '<nv-logo role="primary"></nv-logo> places the logo for white or pale backgrounds; <nv-logo role="onDark"></nv-logo> the one for the brand colour or a dark band. Size it with a height in mm in its style. The logo goes on the first page.' : `There is no logo${o.brandName ? `: set the business name, "${o.brandName}", in type where a logo would go` : ': leave the brand to the colours and type'}.`}

The person's content:
- Their words come in numbered blocks, given below as <nv-block ref="b3">…its words…</nv-block>. In your design, an empty <nv-block ref="b3"></nv-block> places block b3 there, whole, as finished HTML (its headings, paragraphs, lists, tables and pictures are styled for you; style the box around it).
- ${keep ? 'Place every single block exactly once, as an empty <nv-block ref>, in an order that reads well (a section heading block goes with what follows it). Never retype, reword or summarise their words in place of a block. Long text goes in a flow section after your designed pages.' : 'You may write short words of your own from the blocks (a headline, a summary, key points, pull quotes, captions, labels) and place only the blocks that matter. Use only what the blocks say: never invent a fact, figure, name, date, quote or outcome (a decision still needed is not a decision made; a plan is not a result).'}
- Titles, labels, the key figures and the people given with the job are yours to set in type.
- Charts and diagrams: inline <svg> with a viewBox, drawn in the brand's tokens (style="fill:var(--accent)", style="stroke:var(--line)"), only with numbers from the content.
- Never <img>, links, scripts, forms, iframes, web fonts, @import or url(…): they are removed.

Design direction (Astryx's design conventions, Meta's open design system, set for paper):
- Space before boxes: closely related things sit tight, separate things sit apart, and the gap grows with each level of grouping (line < item < group < section). Group with space and alignment before reaching for another panel; never a panel inside a panel.
- The spacing system, used everywhere (this is where most designs lose marks): page sides var(--sp-7); between sections var(--sp-6); a heading to its own content var(--sp-2), with at least twice that above it; between items of a group var(--sp-3); inside a panel or band var(--sp-5) all round; grid and column gaps var(--sp-5) or var(--sp-6). Space comes from gap on a flex or grid container: set margin:0 on what sits inside one, so margins and gaps never add up to uneven steps. Nothing touches the edge of a band or panel, and nothing is stranded far from what it belongs to.
- Type contrast: each step of the hierarchy is clearly different (at least 1.25 times the size, or a real change of weight). Two text sizes on a body page plus one display size. Body text leads at 1.45 to 1.5, lines of 60 to 75 characters (about 110 to 130 mm at 10pt: use columns, never full-width body text), no justified or all-capital body text, letter-spacing only on small labels.
- Colour with emphasis: one thing per page carries the brand colour's full strength; the rest is paper, ink and tints. Words on colour use the matching on- token; never grey words on a coloured panel.
- Shapes: corners from the radius tokens; a box inside a rounded box has a smaller radius (outer radius minus the gap between them). Square is fine too: choose one and keep it.
- Alignment: every edge lines up with another edge; text blocks share a left edge; numbers in a column align right.
- The tells of AI-made design, never: a coloured stripe down one side of a rounded card; cards nested in cards; a glowing or coloured shadow; gradient text; every item emphasised; a border and a soft shadow together; centred paragraphs of body text; equal three-column grids of identical cards for everything.

Make it remarkable (the person should be proud to send it):
- Before you write, decide for yourself the document's one idea in a sentence and the single thing a reader must see. Build every page around that.
- Moves that work on paper: a confident cover with a huge title and generous, deliberate space; one hero number set enormous; an asymmetric grid (8 + 4, 7 + 5); a full-bleed band of the brand colour; a pull quote; a chart that tells the story at a glance, with its caption; a closing page that says what happens next.
- Contrast is the tool: very big against small, brand colour against paper, dense detail against open space. Restraint keeps it premium: one accent doing most of the work, one panel style per page.

Design well:
- ${kind.brief}
- Start from a frame below and make it yours for this content, built from the parts. Keep the side margins (var(--sp-7)) and the spacing rhythm.
- One dominant element per page, then headings, then text. Body text var(--fs-1) with line-height 1.45; nothing smaller than var(--fs-0).
- The brand colour with intent: a band, a panel, a rule, a big number. Mostly paper and ink; never a page of solid colour behind long text.
- Fill each page well: nothing past an edge, and no large empty area anywhere on it (a gap in the middle or an empty lower fifth looks unfinished, the last page excepted). A designed page holds about 350 words at body size: past that, cut, or move the rest to a flow section.
- Fill a page with scale, never with spreading: when there is room, make the title, the hero number or the chart bigger, or add a figure band. Never push sections apart with justify-content:space-between (or space-around, or flex-grow on spacers) down a page: it strands them with holes between. Sections keep the system's gaps, and any room left over sits in one deliberate place (a band of the brand colour at the foot, or the hero made larger).
- Words on the brand colour use var(--on-accent); on var(--dark) use var(--on-dark).

The plan for this kind (proven: fill it with this content rather than inventing a structure):
${kind.plan}

Frames (starting points, not finished designs):
${framesFor(kind)}

A reference design at the standard expected, made for different content (an invented bakery). Match its quality, structure, restraint and finish; never copy its words, numbers or names:
${DESIGN_EXEMPLARS[kind.shape]}

Before you reply, check your design silently against this list and fix anything that fails, so the first version is the finished one:
- The logo (or the business name) is on the first page; every page but a cover or title slide has the small footer.
- Each page has one dominant element, then a clear path for the eye; nothing competes with it.
- Words fit: a designed page holds about 350 words at body size (a slide about 40); nothing runs past an edge or under the footer; no page is left mostly empty.
- Spacing follows the system: sections var(--sp-6) apart, headings close to their own content, gap (not stacked margins) inside flex and grid; no space-between spreading sections down a page; edges line up; body text no wider than about 130 mm.
- Only tokens and parts: no hex colour, no px, no font name, no side-stripe card, no panel inside a panel.
- Every number, date, name and claim is from the note; nothing is decided or promised that the note doesn't say.
${keep ? '- Every block is placed once, as an empty <nv-block ref>.\n' : ''}
Reply with the document only: one <style> element, then the <section> elements. No explanation and no code fence.`;
}

/** An image's address never reaches the AI: a picture in a block reads as "(picture)". */
const forTheAi = (html: string) => html.replace(/\s(src|href|srcset)="[^"]*"/gi, (_m, a: string) => ` ${a}="(${a === 'href' ? 'link' : 'picture'})"`);

/** The cap on the note's blocks sent to the AI (characters of HTML). */
export const MAX_BLOCK_CHARS = 60_000;

/** How many of the note's blocks fit in what the AI is sent (the rest are added at the end as they are). */
export function blocksShown(content: BrandContent): number {
  let used = 0;
  let shown = 0;
  for (const [i, b] of content.blocks.entries()) {
    const n = `<nv-block ref="b${i + 1}"></nv-block>`.length + forTheAi(b).length;
    if (used + n > MAX_BLOCK_CHARS) break;
    used += n;
    shown++;
  }
  return shown;
}

/** Words a designed page holds at body size beside its title, figures and headings. */
const WORDS_A_PAGE = 350;

export function designAsk(kind: DesignKindInfo, content: BrandContent, brief: string): string {
  const lines = [`Design a ${kind.name.toLowerCase()}: ${kind.line} Page ${kind.page.w} × ${kind.page.h} mm.`];
  const asked = brief.trim();
  lines.push(asked ? `What the person asked for: ${asked.slice(0, 2000)}` : 'The person asked for nothing more: use your judgement.');
  lines.push('', `The document:`, `Title: ${content.title}`, `Label: ${content.label}`);
  for (const s of content.sub) lines.push(`Subtitle line: ${s}`);
  if (content.figures.length) lines.push(`Key figures: ${content.figures.map((f) => `${f.value} (${f.label})`).join('; ')}`);
  for (const p of content.people) lines.push(`${p.label}: ${p.names.join(', ')}`);
  if (content.foot) lines.push(`Footer words: ${content.foot}`);
  if (content.confidential) lines.push('It is confidential: say so small on the cover and in the footer.');
  lines.push('', 'The blocks:');
  const shown = blocksShown(content);
  for (const [i, b] of content.blocks.slice(0, shown).entries()) lines.push(`<nv-block ref="b${i + 1}">${forTheAi(b)}</nv-block>`);
  if (shown < content.blocks.length) lines.push(`(The note is long: blocks b${shown + 1} to b${content.blocks.length} are left out of this list; they are added at the end as they are.)`);
  if (kind.words === 'keep' && shown) lines.push('', `Place all ${shown} blocks, each once, as empty <nv-block ref="bN"></nv-block> elements: b1 to b${shown}.`);
  // The room, said up front: most first drafts that broke ran past the page because the words were never counted.
  const words = content.blocks.slice(0, shown).reduce((n, b) => n + b.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length, 0);
  if (kind.pages && words) {
    const room = kind.pages * WORDS_A_PAGE;
    lines.push('', `Room: the blocks hold about ${words} words; ${kind.pages === 1 ? 'one designed page holds' : `${kind.pages} designed pages hold`} about ${room} at body size beside the title, figures and headings.${words > room ? (kind.words === 'keep' ? ' That is more than fits: set the long blocks in two columns at var(--fs-1), keep the cover band and display parts compact, and give the words the room before any decoration.' : ` That is more than fits: choose what matters and leave the rest out (about ${room} words in all), rather than squeezing it in.`) : words < room * 0.55 ? ' That leaves room: use it for scale (a bigger title, a hero number, a chart) rather than leaving space empty.' : ''}`);
  }
  return lines.join('\n');
}

// ── What the page measured, said back to the AI ─────────────────────────────────────────────────────────────────────

export interface DesignProblem {
  page: number;
  /** over: runs past an edge. empty: a large empty area. small: text below 7.5pt. block: a block never placed or placed
   *  twice. contrast: words that didn't read on their background (set to ink or white by the page). logo: a kit with a
   *  logo, and none on the first page. */
  kind: 'over' | 'empty' | 'small' | 'block' | 'count' | 'contrast' | 'logo' | 'narrow' | 'overlap';
  words: string;
  /** over, past the bottom edge: how much smaller the page would have to be set to fit (per cent). */
  shrink?: number;
}

export interface DesignReport {
  pages: number;
  moved: number;
  split: number;
  cut: string[];
  problems: DesignProblem[];
  /** Blocks the layout never placed (added at the end so no word is lost). */
  unused: string[];
  /** Each page's box on the screen (CSS pixels), for its picture. */
  boxes: { x: number; y: number; w: number; h: number }[];
}

export function designFeedback(report: DesignReport, o: { pictures: boolean; final: boolean; kind: DesignKindInfo }): string {
  const lines = [`It printed as ${report.pages} ${report.pages === 1 ? 'page' : 'pages'}.${o.pictures ? ' The pages are attached as pictures, in order.' : ''}`];
  if (o.kind.pages && report.pages !== o.kind.pages) lines.push(`It must be exactly ${o.kind.pages} ${o.kind.pages === 1 ? 'page' : 'pages'}.`);
  if (report.problems.length) {
    lines.push('Measured on the printed pages:');
    for (const p of report.problems.slice(0, 20)) lines.push(`- ${p.page ? `page ${p.page}: ` : ''}${p.words}`);
  }
  const broken = report.problems.some((p) => p.kind !== 'small' && p.kind !== 'contrast') || (!!o.kind.pages && report.pages !== o.kind.pages);
  if (o.pictures) {
    lines.push(
      '',
      'Now judge the printed pages the way Astryx’s design judge does, 0 to 100 on each axis, strictly (a competent but ordinary page is 70; 90 is a page a design studio would be proud of):',
      '- layout: an intentional page: clear regions, a grid, every edge lining up',
      '- hierarchy: the squint test: one dominant element, then a clear path for the eye',
      '- spacing: gaps that grow with grouping, on the rhythm, nothing cramped or stranded',
      '- parts: the right part for each thing, none of the tells of AI-made design',
      '- colour: the brand used with intent, one strong emphasis, every word readable',
      'Start your reply with one line exactly like: Scores: layout 82, hierarchy 75, spacing 80, parts 85, colour 88',
      broken ? 'Then fix what was measured and what your scores say is weakest, keeping what works, and reply with the whole document.' : 'If every score is 88 or more, reply with that line and the word finished. Otherwise, after that line, reply with the whole improved document: raise the weakest axis first.',
    );
  } else if (broken) lines.push('Fix these, keeping what works.');
  lines.push('The document goes in the same form as before: one <style> element, then the <section> elements.');
  return lines.join('\n');
}

const JUDGE_AXES = [
  '- layout: an intentional page: clear regions, a grid, every edge lining up',
  '- hierarchy: the squint test: one dominant element, then a clear path for the eye',
  '- spacing: gaps that grow with grouping, on the rhythm, nothing cramped or stranded',
  '- parts: the right part for each thing, none of the tells of AI-made design',
  '- colour: the brand used with intent, one strong emphasis, every word readable',
];

/** The judge alone: score the printed pages, a line back, no document (cheap: the first draft is usually finished). */
export function designJudgeOnly(report: DesignReport, kind: DesignKindInfo): string {
  return [
    `It printed as ${report.pages} ${report.pages === 1 ? 'page' : 'pages'}; the pages are attached as pictures, in order${report.pages > MAX_JUDGED_PAGES ? ` (the first ${MAX_JUDGED_PAGES})` : ''}. Nothing measured wrong.`,
    `Judge them the way Astryx's design judge does, 0 to 100 on each axis, strictly and honestly (a competent but ordinary ${kind.name.toLowerCase()} is 70; 90 is one a design studio would be proud to hand a client):`,
    ...JUDGE_AXES,
    'Reply with one line only, exactly like: Scores: layout 82, hierarchy 75, spacing 80, parts 85, colour 88',
  ].join('\n');
}

/** A rewrite: what was measured, the scores when there are any, and the axis to raise first. */
export function designRewrite(report: DesignReport, o: { kind: DesignKindInfo; pictures: boolean; scores?: { layout: number; hierarchy: number; spacing: number; parts: number; colour: number } | null }): string {
  const lines = [`It printed as ${report.pages} ${report.pages === 1 ? 'page' : 'pages'}.${o.pictures ? ' The pages are attached as pictures, in order.' : ''}`];
  if (o.kind.pages && report.pages !== o.kind.pages) lines.push(`It must be exactly ${o.kind.pages} ${o.kind.pages === 1 ? 'page' : 'pages'}.`);
  const measured = report.problems.filter((p) => p.kind !== 'small' && p.kind !== 'contrast');
  if (measured.length) {
    lines.push('Measured on the printed pages:');
    for (const p of measured.slice(0, 20)) lines.push(`- ${p.page ? `page ${p.page}: ` : ''}${p.words}`);
  }
  if (o.scores) {
    const axes = (['layout', 'hierarchy', 'spacing', 'parts', 'colour'] as const).map((k) => [k, o.scores![k]] as const).sort((a, b) => a[1] - b[1]);
    lines.push(`Judged on Astryx's axes: ${axes.map(([k, v]) => `${k} ${v}`).join(', ')} (the bar is ${JUDGE_BAR} on each). Raise ${axes[0][0]} first, then ${axes[1][0]}:`);
    lines.push(...JUDGE_AXES.filter((a) => a.startsWith(`- ${axes[0][0]}`) || a.startsWith(`- ${axes[1][0]}`)));
  }
  lines.push('Fix it in one go, keeping what works. Reply with the whole document: one <style> element, then the <section> elements.');
  return lines.join('\n');
}

/** How many pages the judge is shown. */
export const MAX_JUDGED_PAGES = 4;

/** Words the person typed to change the design ("bolder", "landscape", "put the figures first"). */
export const designChange = (words: string) => `The person looked at it and asks for this change: ${words.trim().slice(0, 2000)}\nMake the change, keep the rest, and reply with the whole document again in the same form.`;

/** Whether the AI said it was finished rather than answering with a document. */
export const saysFinished = (text: string) => !/<section\b/i.test(text) && /\bfinished\b/i.test(text);

/** The judge's scores from an answer's first line (Scores: layout 82, hierarchy 75, …), or null. */
export function readScores(text: string): { layout: number; hierarchy: number; spacing: number; parts: number; colour: number; mean: number } | null {
  const line = /scores?\s*:([^\n]*)/i.exec(String(text ?? '').slice(0, 2000))?.[1];
  if (!line) return null;
  const get = (k: string) => {
    const m = new RegExp(`${k}\\w*\\s*[:=]?\\s*(\\d{1,3})`, 'i').exec(line);
    return m ? Math.min(100, Number(m[1])) : NaN;
  };
  const v = { layout: get('layout'), hierarchy: get('hierarch'), spacing: get('spacing'), parts: get('parts'), colour: get('colou?r') };
  if (Object.values(v).some((n) => !Number.isFinite(n))) return null;
  return { ...v, mean: Math.round((v.layout + v.hierarchy + v.spacing + v.parts + v.colour) / 5) };
}

/** A design the judge calls finished: every axis at this score or more. */
export const JUDGE_BAR = 88;

// ── The AI's answer, scrubbed ────────────────────────────────────────────────────────────────────────────────────────

/** The cap on a layout's size (characters). */
export const MAX_LAYOUT_CHARS = 400_000;

/** A style sheet with nothing that reaches out: no url() but a reference to its own #id, no @import, @font-face,
 *  @page or @namespace, no old script hooks, no fixed boxes (a fixed box repeats on every printed page). */
export function scrubCss(css: string): string {
  return css
    .replace(/<\/?style[^>]*>/gi, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(import|font-face|page|namespace|charset)\b[^;{]*(;|\{[^{}]*(\{[^{}]*\}[^{}]*)*\})/gi, '')
    .replace(/url\s*\(\s*(?!['"]?#[\w-]+['"]?\s*\))[^)]*\)/gi, 'none')
    .replace(/(image-set|-webkit-image-set|src|expression|element)\s*\(/gi, 'none(')
    .replace(/(behavior|-moz-binding)\s*:[^;}]*/gi, '')
    .replace(/position\s*:\s*fixed/gi, 'position:absolute');
}

/**
 * The AI's answer as the layout's HTML: a code fence or a sentence around it dropped, then a first pass that removes
 * what must never run or reach out (the page's own script cleans it again against its allow list, in a document that
 * cannot run anything): scripts and other active elements, event handlers, addresses of any kind, and url() in styles.
 * Null when there is no layout in it.
 */
export function readDesign(text: string): string | null {
  let t = String(text ?? '');
  const fence = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1];
  const start = t.search(/<(style|section)\b/i);
  if (start < 0) return null;
  const end = t.toLowerCase().lastIndexOf('</section>');
  t = end > start ? t.slice(start, end + '</section>'.length) : t.slice(start);
  if (t.length > MAX_LAYOUT_CHARS) return null;
  t = t
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|iframe|object|embed|noscript|template|textarea|title|xmp|noembed|noframes)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|iframe|object|embed|link|meta|base|form|input|button|select|option|textarea|frame|frameset|applet|portal|img|image|picture|source|video|audio|track|canvas|foreignObject|use|a|animate|set|animateMotion|animateTransform|feImage)\b[^>]*>/gi, '')
    .replace(/\s(on[a-z]+|href|xlink:href|src|srcset|action|formaction|background|poster|data|ping|lowsrc|dynsrc)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
  // Styles scrubbed where they are: the style elements and every style attribute.
  t = t.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_m, a: string, css: string, b: string) => `${a}${scrubCss(css)}${b}`);
  t = t.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (_m, _q: string, d?: string, s?: string) => ` style="${scrubCss(d ?? s ?? '').replace(/"/g, '&quot;')}"`);
  return /<section\b/i.test(t) ? t : null;
}

// ── The page the print window opens ──────────────────────────────────────────────────────────────────────────────────

export interface DesignPageInput {
  kind: DesignKindInfo;
  theme: DesignTheme;
  title: string;
  /** The AI's layout (readDesign's). */
  layout: string;
  /** The note's blocks of finished HTML (brandContent's), with vault pictures as file addresses. */
  blocks: string[];
  /** The logos' file addresses by role. */
  logos: { primary?: string; onDark?: string };
  brandName: string;
  /** The footer's words for flow pages. */
  foot: string;
  /** The app's own type, by file address (Inter and Source Serif), so the fallbacks are there on every PC. */
  fonts?: { sans?: string; sansItalic?: string; serif?: string };
  /** Blocks the layout leaves out are added at the end (keep), or are fine to leave out (shorten). */
  keepAll: boolean;
  /** How many blocks the AI was sent (blocksShown): one it never saw is added at the end without a word to it. */
  asked?: number;
  /** The last look and the print: a page with too much on it is fitted (its type made smaller, to 72% at most). */
  fit?: boolean;
  /** A fresh random word for the page's one script. */
  nonce: string;
}

const fontFace = (family: string, url: string | undefined, style = 'normal') => (url ? `@font-face{font-family:"${family}";src:url("${url.replace(/["\\]/g, '')}") format("woff2");font-weight:100 900;font-style:${style}}` : '');

function baseCss(d: DesignPageInput): string {
  const { w, h } = d.kind.page;
  return `${fontFace('Inter', d.fonts?.sans)}${fontFace('Inter', d.fonts?.sansItalic, 'italic')}${fontFace('Source Serif 4', d.fonts?.serif)}
${rootCss(d.theme)}
@page{size:${w}mm ${h}mm;margin:0}
@page flow{size:${w}mm ${h}mm;margin:16mm 0 18mm;@bottom-left{content:"${esc(d.title).replace(/["\\]/g, '')}";font:8pt ${d.theme.body};color:#5A6067;padding-left:16mm}@bottom-right{content:counter(page) " of " counter(pages);font:8pt ${d.theme.body};color:#5A6067;padding-right:16mm}}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#e9ebee;color:var(--ink);font-family:var(--font-body);font-size:var(--fs-1);line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-rendering:optimizeLegibility;font-kerning:normal}
@media print{body{background:#fff}}
#doc{width:${w}mm;margin:0}
section.page{width:${w}mm;height:${h}mm;position:relative;overflow:hidden;background:var(--paper);break-after:page;page-break-after:always;break-inside:avoid;display:flex;flex-direction:column}
section.page>*{flex:none}
section.page>.fill,.fill{flex:1 1 auto;min-height:0}
section.page>.nv-foot{margin-top:auto}
${d.kind.id === 'slides' ? 'section.page{justify-content:center}section.page>.nv-foot{position:absolute;left:16mm;right:16mm;bottom:5mm;margin:0}' : ''}
section.flow{page:flow;width:${w}mm;background:var(--paper);padding:16mm 16mm 18mm;break-after:page}
section.flow .panel,section.flow .callout,section.flow .figures,section.flow figure,section.flow .bars,section.flow ol.steps>li{break-inside:avoid}
/* Every printed page is the page's full width: a flow page's side margins are its own padding, never the page's
   margins, or Chromium shrinks the whole document to the narrower width (178 of 210 mm: every page at 85%). */
@media print{section.flow{width:auto;padding:0 16mm}}
section:last-child{break-after:auto;page-break-after:auto}
@media screen{section.page,section.flow{margin:0 0 6mm}}
h1,h2,h3,h4,h5,h6{font-family:var(--font-head);line-height:1.15;overflow-wrap:break-word;break-after:avoid}
h1{font-size:var(--fs-7);margin:0 0 var(--sp-3)}
h2{font-size:var(--fs-4);margin:var(--sp-5) 0 var(--sp-2);color:var(--accent-strong)}
h3{font-size:var(--fs-2);margin:var(--sp-4) 0 var(--sp-1)}
h4,h5,h6{font-size:var(--fs-1);margin:var(--sp-3) 0 var(--sp-1)}
p{margin:0 0 var(--sp-2);overflow-wrap:break-word;orphans:2;widows:2}
ul,ol{margin:0 0 var(--sp-2);padding-left:5mm}
li{margin:0 0 1.2mm;overflow-wrap:break-word}
table{width:100%;border-collapse:collapse;font-size:9pt;margin:0 0 var(--sp-3)}
th{background:var(--accent-strong);color:#fff;text-align:left;font-weight:700;padding:1.8mm 2.4mm;overflow-wrap:break-word;hyphens:manual}
td{padding:1.8mm 2.4mm;vertical-align:top;border-bottom:.6pt solid var(--line);overflow-wrap:break-word;hyphens:manual;font-variant-numeric:tabular-nums}
tbody tr:nth-child(even) td{background:var(--accent-1)}
tr{break-inside:avoid}
blockquote{margin:0 0 var(--sp-3);padding:var(--sp-2) var(--sp-4);border-left:2pt solid var(--accent);color:var(--ink)}
.note{background:var(--accent-1);border-radius:var(--r-1);padding:3mm 4mm;font-size:9pt;margin:0 0 var(--sp-2)}
.note p:last-child{margin:0}
figure{margin:0 0 var(--sp-3)}
.nv-b img{display:block;max-width:100%;height:auto;max-height:160mm;object-fit:contain}
pre{background:var(--soft);padding:2.4mm 3mm;font-size:8.4pt;line-height:1.35;margin:0 0 var(--sp-2);white-space:pre-wrap;overflow-wrap:anywhere}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
p code{background:var(--soft);padding:0 .8mm;font-size:.92em}
mark{background:var(--accent-2);color:inherit;padding:0 .6mm}
a{color:inherit}
hr{border:0;border-top:.6pt solid var(--line);margin:var(--sp-3) 0}
.mrow{display:grid;grid-template-columns:24mm 1fr;gap:.8mm 3mm;font-size:9.4pt}
.mrow dt{color:var(--muted)}.mrow dd{margin:0}
.band{display:grid;grid-template-columns:repeat(var(--n,4),1fr);background:var(--dark);color:var(--on-dark)}
.band div{padding:2.8mm 4mm}.band b{display:block;font-size:var(--fs-3)}.band span{font-size:8pt;opacity:.8}
.kicker{font-family:var(--font-head);font-size:var(--fs-0);font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-strong);margin:0 0 var(--sp-2)}
.display{font-family:var(--font-head);font-size:var(--fs-9);line-height:1;letter-spacing:-.02em;font-weight:800;margin:0 0 var(--sp-4)}
.lead{font-size:var(--fs-2);line-height:1.45;color:var(--ink);margin:0 0 var(--sp-3);max-width:150mm}
.muted{color:var(--muted)}
.rule{width:14mm;height:1.6mm;background:var(--accent);border:0;margin:0 0 var(--sp-4)}
.figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(30mm,1fr));gap:var(--sp-4);align-items:end}
.figures>div{min-width:0}
.figures b{display:block;white-space:nowrap;font-family:var(--font-head);font-size:var(--fs-6);line-height:1.02;font-weight:800;letter-spacing:-.01em;color:var(--accent-strong);font-variant-numeric:tabular-nums;overflow-wrap:break-word}
.figures span{display:block;margin-top:var(--sp-1);font-size:var(--fs-0);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.figures.on-accent,.figures.on-dark,.figures.quiet{padding:var(--sp-5) var(--sp-5)}
.figures.on-accent{background:var(--accent)}.figures.on-accent b,.figures.on-accent span{color:var(--on-accent)}.figures.on-accent span{opacity:.85}
.figures.on-dark{background:var(--dark)}.figures.on-dark b{color:var(--on-dark)}.figures.on-dark span{color:var(--on-dark);opacity:.75}
.figures.quiet{background:var(--accent-1);border-radius:var(--r-2)}
.panel{background:var(--accent-1);border-radius:var(--r-2);padding:var(--sp-4) var(--sp-4)}
.panel.strong{background:var(--accent);color:var(--on-accent)}.panel.strong h2,.panel.strong h3,.panel.strong .kicker{color:var(--on-accent)}
.panel.dark{background:var(--dark);color:var(--on-dark)}.panel.dark h2,.panel.dark h3,.panel.dark .kicker{color:var(--on-dark)}
.panel>:last-child{margin-bottom:0}
.callout{position:relative;padding:var(--sp-4) 0 0;font-family:var(--font-head);font-size:var(--fs-3);line-height:1.3;font-weight:600;color:var(--ink);margin:0 0 var(--sp-4)}
.callout::before{content:"";position:absolute;left:0;top:0;width:12mm;height:1.2mm;background:var(--accent)}
.pull{font-family:var(--font-head);font-size:var(--fs-5);line-height:1.2;font-weight:600;letter-spacing:-.01em;color:var(--accent-strong);margin:0 0 var(--sp-4);max-width:150mm}
.pull::before{content:"“";display:block;font-size:var(--fs-8);line-height:.6;height:7mm;color:var(--accent)}
.stat b{display:block;font-family:var(--font-head);font-size:var(--fs-10);line-height:.95;font-weight:800;letter-spacing:-.03em;color:var(--accent-strong);white-space:nowrap;font-variant-numeric:tabular-nums}
.stat span{display:block;margin-top:var(--sp-2);font-size:var(--fs-1);color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:var(--sp-5);row-gap:var(--sp-5)}
.span-3{grid-column:span 3}.span-4{grid-column:span 4}.span-5{grid-column:span 5}.span-6{grid-column:span 6}.span-7{grid-column:span 7}.span-8{grid-column:span 8}.span-9{grid-column:span 9}.span-12{grid-column:span 12}
.grid>*{min-width:0}
.bleed{margin-left:calc(-1 * var(--sp-7));margin-right:calc(-1 * var(--sp-7));padding-left:var(--sp-7);padding-right:var(--sp-7)}
.caption{font-size:var(--fs-0);color:var(--muted);margin:var(--sp-1) 0 0;line-height:1.4}
.callout>:last-child{margin-bottom:0}
.cols-2,.cols-3,.cols-2-1,.cols-1-2{display:grid;gap:var(--sp-5)}
.cols-2{grid-template-columns:1fr 1fr}.cols-3{grid-template-columns:1fr 1fr 1fr}.cols-2-1{grid-template-columns:2fr 1fr}.cols-1-2{grid-template-columns:1fr 2fr}
.cols-2>*,.cols-3>*,.cols-2-1>*,.cols-1-2>*{min-width:0}
.stack{display:flex;flex-direction:column;gap:var(--sp-4)}.stack>*{margin-bottom:0}
ol.steps{list-style:none;counter-reset:st;padding:0;margin:0 0 var(--sp-3)}
ol.steps>li{counter-increment:st;position:relative;padding:0 0 0 10mm;margin:0 0 var(--sp-3);min-height:7mm}
ol.steps>li::before{content:counter(st);position:absolute;left:0;top:-.4mm;width:7mm;height:7mm;border-radius:50%;background:var(--accent);color:var(--on-accent);font:700 var(--fs-0)/7mm var(--font-head);text-align:center}
.bars{display:flex;flex-direction:column;gap:var(--sp-2)}
.bar{display:grid;grid-template-columns:34mm 1fr auto;align-items:center;gap:var(--sp-2);font-size:var(--fs-0)}
.bar::after{content:"";grid-column:2;grid-row:1;height:4mm;border-radius:1mm;background:linear-gradient(90deg,var(--accent) calc(var(--v,0)*100%),var(--accent-1) 0)}
.bar>span{grid-column:1;grid-row:1;color:var(--ink)}.bar>b{grid-column:3;grid-row:1;font-variant-numeric:tabular-nums}
.chips{display:flex;flex-wrap:wrap;gap:var(--sp-1)}.chips>span{background:var(--accent-1);color:var(--accent-strong);border-radius:99mm;padding:.8mm 3mm;font-size:var(--fs-0);font-weight:600}
.nv-b>:first-child{margin-top:0}.nv-b>:last-child{margin-bottom:0}
.nv-foot{display:flex;justify-content:space-between;gap:var(--sp-3);font-size:var(--fs-0);color:var(--muted);border-top:.6pt solid var(--line);padding-top:var(--sp-1);align-self:end}
nv-logo,.nv-logo{display:inline-block}
.nv-logo{height:14mm;width:auto;max-width:90mm;object-fit:contain}
.nv-logo-name{font-family:var(--font-head);font-weight:700;font-size:var(--fs-3)}
.nv-rest h2:first-child{margin-top:0}
svg{max-width:100%;overflow:visible}
`;
}

/**
 * The page's own script: plain browser JavaScript, the one script the page may run (its nonce). It reads the layout as
 * data into a document that cannot run anything (DOMParser), keeps only what its allow list names, places the note's
 * blocks and the logo, waits for the type and pictures, then measures each page and says what is wrong in
 * window.__report (src/main/brand-print.ts waits for it, then prints or takes the pages' pictures).
 */
const DESIGN_JS = String.raw`(function(){
var D=JSON.parse(document.getElementById('nv-data').textContent);
var MM=96/25.4;
var TAGS={section:1,div:1,span:1,p:1,h1:1,h2:1,h3:1,h4:1,h5:1,h6:1,ul:1,ol:1,li:1,table:1,thead:1,tbody:1,tfoot:1,tr:1,th:1,td:1,colgroup:1,col:1,caption:1,strong:1,b:1,em:1,i:1,u:1,s:1,small:1,sup:1,sub:1,br:1,hr:1,blockquote:1,figure:1,figcaption:1,header:1,footer:1,aside:1,article:1,main:1,dl:1,dt:1,dd:1,mark:1,q:1,cite:1,abbr:1,time:1,'nv-block':1,'nv-logo':1,'nv-page-number':1};
var SVG={svg:1,g:1,path:1,rect:1,circle:1,ellipse:1,line:1,polyline:1,polygon:1,text:1,tspan:1,defs:1,lineargradient:1,radialgradient:1,stop:1,clippath:1,title:1,desc:1};
var ATTR={'class':1,style:1,colspan:1,rowspan:1,ref:1,role:1,lang:1,dir:1,id:1,
viewbox:1,width:1,height:1,x:1,y:1,x1:1,y1:1,x2:1,y2:1,cx:1,cy:1,r:1,rx:1,ry:1,d:1,points:1,fill:1,stroke:1,'stroke-width':1,'stroke-linecap':1,'stroke-linejoin':1,'stroke-dasharray':1,opacity:1,'fill-opacity':1,'stroke-opacity':1,transform:1,'text-anchor':1,'dominant-baseline':1,'font-size':1,'font-weight':1,'font-family':1,'letter-spacing':1,offset:1,'stop-color':1,'stop-opacity':1,gradienttransform:1,gradientunits:1,preserveaspectratio:1,'clip-path':1,dx:1,dy:1,'fill-rule':1,'clip-rule':1,xmlns:1};
function cleanCss(s){return String(s||'').replace(/url\s*\(\s*(?!['"]?#[\w-]+['"]?\s*\))[^)]*\)/gi,'none').replace(/@(import|font-face|page|namespace)\b[^;{]*(;|\{[^{}]*(\{[^{}]*\}[^{}]*)*\})/gi,'').replace(/(image-set|src|expression|element)\s*\(/gi,'none(').replace(/position\s*:\s*fixed/gi,'position:absolute');}
function clean(node){
  var kids=Array.prototype.slice.call(node.childNodes);
  for(var i=0;i<kids.length;i++){var k=kids[i];
    if(k.nodeType===3)continue;
    if(k.nodeType!==1){k.remove();continue;}
    var svg=k.namespaceURI==='http://www.w3.org/2000/svg';
    var name=String(k.localName).toLowerCase();
    if(svg?!SVG[name]:!TAGS[name]){if(svg||/^(script|style|iframe|object|embed|template|noscript|title|textarea|select|img|picture|video|audio|canvas|svg|math)$/.test(name))k.remove();else{clean(k);while(k.firstChild)k.parentNode.insertBefore(k.firstChild,k);k.remove();}continue;}
    var at=Array.prototype.slice.call(k.attributes);
    for(var j=0;j<at.length;j++){var a=at[j].name.toLowerCase();var v=at[j].value;
      if(!ATTR[a]||/^on/.test(a)||/javascript:/i.test(v)||(/url\s*\(/i.test(v)&&!/^\s*url\(#[\w-]+\)\s*$/.test(v)&&a!=='style')){k.removeAttribute(at[j].name);continue;}
      if(a==='style')k.setAttribute('style',cleanCss(v));
      if(a==='id')k.setAttribute('id','d-'+v.replace(/[^\w-]/g,''));
    }
    clean(k);
  }
}
var doc=new DOMParser().parseFromString(D.layout,'text/html');
var css='';
var styles=doc.querySelectorAll('style');
for(var s=0;s<styles.length;s++){css+=cleanCss(styles[s].textContent)+'\n';styles[s].remove();}
// A reference to an #id inside the layout's SVG follows its new name.
css=css.replace(/#([A-Za-z][\w-]*)\b(?=[^{}]*\{)/g,function(m,id){return doc.getElementById(id)?'#d-'+id:m;});
var idRefs=doc.querySelectorAll('[fill^="url(#"],[stroke^="url(#"],[clip-path^="url(#"]');
for(var r=0;r<idRefs.length;r++)['fill','stroke','clip-path'].forEach(function(a){var v=idRefs[r].getAttribute(a);if(v&&/^url\(#/.test(v))idRefs[r].setAttribute(a,v.replace('url(#','url(#d-'));});
Array.prototype.slice.call(doc.querySelectorAll('nv-block[id]:not([ref])')).forEach(function(e){e.setAttribute('ref',e.getAttribute('id'));});
clean(doc.body);
var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
var root=document.getElementById('doc');
var tops=Array.prototype.slice.call(doc.body.childNodes);
var loose=null;
tops.forEach(function(n){
  if(n.nodeType===1&&n.localName==='section'){if(!n.classList.contains('page')&&!n.classList.contains('flow'))n.classList.add('flow');loose=null;root.appendChild(document.importNode(n,true));}
  else if(n.nodeType===1||(n.nodeType===3&&n.textContent.trim())){if(!loose){loose=document.createElement('section');loose.className='flow';root.appendChild(loose);}loose.appendChild(document.importNode(n,true));}
});
var used={},twice=[];
Array.prototype.slice.call(root.querySelectorAll('nv-block')).forEach(function(el){
  var ref=String(el.getAttribute('ref')||'').trim().toLowerCase();var n=/^b(\d+)$/.exec(ref);var i=n?Number(n[1])-1:-1;
  if(i<0||i>=D.blocks.length){el.remove();return;}
  if(used[i]){twice.push(ref);el.remove();return;}
  used[i]=1;var box=document.createElement('div');box.className='nv-b';
  var st=el.getAttribute('style');if(st)box.setAttribute('style',st);var cl=el.getAttribute('class');if(cl)box.className+=' '+cl;
  box.innerHTML=D.blocks[i];el.replaceWith(box);
});
var unused=[];for(var b=0;b<D.blocks.length;b++)if(!used[b])unused.push('b'+(b+1));
if(D.keepAll&&unused.length){var rest=document.createElement('section');rest.className='flow nv-rest';unused.forEach(function(ref){var box=document.createElement('div');box.className='nv-b';box.innerHTML=D.blocks[Number(ref.slice(1))-1];rest.appendChild(box);});root.appendChild(rest);}
Array.prototype.slice.call(root.querySelectorAll('nv-logo')).forEach(function(el){
  var role=el.getAttribute('role')==='onDark'?'onDark':'primary';var src=D.logos[role]||D.logos.primary||D.logos.onDark;
  var out;if(src){out=document.createElement('img');out.className='nv-logo';out.src=src;out.alt=D.brand||'Logo';}else if(D.brand){out=document.createElement('span');out.className='nv-logo-name';out.textContent=D.brand;}else{el.remove();return;}
  var st=el.getAttribute('style');if(st)out.setAttribute('style',st);el.replaceWith(out);
});
function settle(){var imgs=Array.prototype.slice.call(document.images);return Promise.all([document.fonts?document.fonts.ready:null].concat(imgs.map(function(i){return i.complete?null:new Promise(function(r){i.onload=i.onerror=r;});})));}
function words(el){return (el.textContent||'').replace(/\s+/g,' ').trim().slice(0,50);}
/** Whether an element holds words of its own (a text node of its own, not only in its children). */
function ownText(el){for(var c=el.firstChild;c;c=c.nextSibling)if(c.nodeType===3&&c.textContent.trim())return true;return false;}
/** A big number never wraps: one too wide for its box is set smaller until it fits (to 10pt at the least). */
function fitFigures(){Array.prototype.slice.call(root.querySelectorAll('.figures b, .stat b')).forEach(function(b){var size=parseFloat(getComputedStyle(b).fontSize);var room=b.parentElement?b.parentElement.clientWidth:0;for(var i=0;i<30&&room>0&&b.scrollWidth>room+1&&size>13.3;i++){size*=0.92;b.style.fontSize=size+'px';}});}
function rgba(c){var m=/rgba?\(([^)]+)\)/.exec(c||'');if(!m)return null;var p=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
function lum(c){var f=function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);}
function ratio(a,b){var x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
/** The colour behind an element: the nearest box painted with a solid colour, else the paper (null over a picture or gradient). */
function behind(el){for(var e=el;e&&e.nodeType===1;e=e.parentElement){var cs=getComputedStyle(e);if(cs.backgroundImage&&cs.backgroundImage!=='none')return null;var c=rgba(cs.backgroundColor);if(c&&c.a>0.5)return c;}return {r:255,g:255,b:255,a:1};}
var INK={r:16,g:24,b:32,a:1},WHITE={r:255,g:255,b:255,a:1};
/** Each logo is the one made for what is behind it (the AI asked for one; the colour decides). */
function pickLogos(){var waits=[];Array.prototype.slice.call(root.querySelectorAll('img.nv-logo')).forEach(function(img){var bg=behind(img.parentElement);if(!bg)return;var dark=lum(bg)<0.35;var want=dark?(D.logos.onDark||''):(D.logos.primary||'');if(want&&img.getAttribute('src')!==want){img.src=want;if(img.decode)waits.push(img.decode().catch(function(){}));}});return Promise.all(waits);}
/** Words that don't read on their background are set in ink or white, whichever reads, and named. */
function fixContrast(problems,pageOf){var fixed={};Array.prototype.slice.call(root.querySelectorAll('*')).forEach(function(e){if(e.closest('svg')||!words(e))return;var own=false;for(var c=e.firstChild;c;c=c.nextSibling)if(c.nodeType===3&&c.textContent.trim()){own=true;break;}if(!own)return;var cs=getComputedStyle(e);var fg=rgba(cs.color);var bg=behind(e);if(!fg||!bg)return;var size=parseFloat(cs.fontSize);var big=size>=24||(size>=18.6&&Number(cs.fontWeight)>=600);var need=big?3:4.5;if(ratio(fg,bg)>=need)return;var to=ratio(INK,bg)>=ratio(WHITE,bg)?'#101820':'#ffffff';e.style.setProperty('color',to,'important');var p=pageOf(e);var k=p+':'+words(e).slice(0,20);if(!fixed[k]){fixed[k]=1;problems.push({page:p,kind:'contrast',words:'words that did not read on their background ("'+words(e)+'"): set in '+(to==='#ffffff'?'white':'ink')+' for now'});}});}
function measure(pass){
  pass=pass||0;
  var problems=[],boxes=[],pages=0,zoomed=false;var pageH=D.page.h*MM;
  var secs=Array.prototype.slice.call(root.children);
  var nums=[];
  secs.forEach(function(sec,si){
    var r=sec.getBoundingClientRect();
    if(sec.classList.contains('page')){pages++;var n=pages;nums.push([sec,n]);boxes.push({x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height});
      var maxB=0,maxR=0,worst=null,spans=[],spillSaid=0;
      var all=sec.querySelectorAll('*');
      for(var i=0;i<all.length;i++){var e=all[i];var q=e.getBoundingClientRect();if(!q.width&&!q.height)continue;var cs=getComputedStyle(e);if(cs.visibility==='hidden'||cs.display==='none')continue;
        var inner=e.closest('svg')&&e.tagName.toLowerCase()!=='svg';if(inner)continue;
        var b=q.bottom-r.bottom,rt=q.right-r.right;
        if((b>MM||rt>MM)&&(e.children.length===0||e.localName==='img'||ownText(e))&&words(e)){if(b>maxB){maxB=b;worst=e;}if(rt>maxR){maxR=rt;worst=worst||e;}}
        var painted=cs.backgroundColor&&cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.backgroundColor!=='transparent';
        if(painted||((e.children.length===0||ownText(e))&&(words(e)||e.localName==='img'))||e.tagName.toLowerCase()==='svg'||cs.borderLeftWidth!=='0px'&&parseFloat(cs.borderLeftWidth)>2)spans.push([Math.max(q.top,r.top)-r.top,Math.min(q.bottom,r.bottom)-r.top]);
        // Words squeezed into a column too narrow for them (a few letters a line).
        // Counted in characters a line (about half the type size each), so a short item in a squeezed column counts too.
        if(ownText(e)&&q.width>0&&(e.textContent||'').trim().length>40){const per=q.width/(parseFloat(cs.fontSize)*0.5);if((q.width<24*MM||per<22)&&q.height>parseFloat(cs.fontSize)*4)problems.push({page:n,kind:'narrow',words:'words squeezed into a column '+Math.round(q.width/MM)+' mm wide, about '+Math.round(per)+' characters a line ("'+words(e)+'"): give it room (35 or more a line)'});}
        // Words that spill out of their column (a figure set nowrap in a squeezed grid), or a number or single word
        // broken across lines ("41,00" then "0"): both read as broken, on paper and in PowerPoint.
        if(ownText(e)&&words(e)&&spillSaid<3){var rg=document.createRange();rg.selectNodeContents(e);var lr=Array.prototype.slice.call(rg.getClientRects()).filter(function(x){return x.width>0&&x.height>0;});
          if(lr.length){var pr=Math.max.apply(null,lr.map(function(x){return x.right;}));if(pr>q.right+2*MM&&q.width<40*MM){problems.push({page:n,kind:'narrow',words:'words spill out of a column '+Math.round(q.width/MM)+' mm wide ("'+words(e)+'"): give the column room, or fewer columns'});spillSaid++;}
            else{var tx=(e.textContent||'').trim();var tops={};lr.forEach(function(x){tops[Math.round(x.top)]=1;});if(tx.length>1&&!/\s/.test(tx)&&Object.keys(tops).length>1){problems.push({page:n,kind:'narrow',words:'"'+tx.slice(0,24)+'" is broken across lines: give it room or set it smaller'});spillSaid++;}}}}
        if(e.children.length===0&&words(e)&&parseFloat(cs.fontSize)<7.4*96/72)problems.push({page:n,kind:'small',words:'text smaller than 7.5pt ("'+words(e)+'")'});
      }
      // Words over another box: a title running into a band above it, a panel laid over text (each pair once).
      var boxesP=[],texts=[];
      for(var o=0;o<all.length;o++){var oe=all[o];if(oe.closest('svg'))continue;var ocs=getComputedStyle(oe);var oq=oe.getBoundingClientRect();if(!oq.width||!oq.height)continue;var pc=ocs.backgroundColor&&ocs.backgroundColor!=='rgba(0, 0, 0, 0)'&&ocs.backgroundColor!=='transparent';if(pc||oe.localName==='img')boxesP.push([oe,oq]);if(ownText(oe)&&words(oe))texts.push([oe,oq]);}
      var overlapSaid=0;
      for(var ti=0;ti<texts.length&&overlapSaid<3;ti++){var te=texts[ti][0],tq=texts[ti][1];
        for(var bi=0;bi<boxesP.length;bi++){var be=boxesP[bi][0],bq=boxesP[bi][1];if(be===te||be.contains(te)||te.contains(be))continue;
          var ix=Math.min(tq.right,bq.right)-Math.max(tq.left,bq.left),iy=Math.min(tq.bottom,bq.bottom)-Math.max(tq.top,bq.top);
          if(ix>2*MM&&iy>2*MM&&ix*iy>0.15*tq.width*tq.height){problems.push({page:n,kind:'overlap',words:'words run into another box ("'+words(te)+'" over '+(be.localName==='img'?'a picture':'a coloured '+be.tagName.toLowerCase())+'): move one so they don\'t touch'});overlapSaid++;break;}
        }
      }
      // Words under the footer: a footer drawn over the page's content (a slide's footer sits at its foot by itself).
      var foot=sec.querySelector('.nv-foot');
      var under=null,low=0,fr=null;
      if(foot){fr=foot.getBoundingClientRect();for(var u=0;u<all.length;u++){var ue=all[u];if(foot.contains(ue)||ue.contains(foot)||ue.children.length||!words(ue))continue;var uq=ue.getBoundingClientRect();if(uq.right>fr.left&&uq.left<fr.right&&uq.top<fr.bottom-1)low=Math.max(low,uq.bottom);if(!under&&uq.bottom>fr.top+1&&uq.top<fr.bottom-1&&uq.right>fr.left&&uq.left<fr.right)under=ue;}
        if(under)problems.push({page:n,kind:'over',words:'content runs under the footer ("'+words(under)+'"): leave the footer its own room at the foot of the page',shrink:Math.round((1-(fr.top-2*MM-r.top)/(low-r.top))*100)});}
      // Too much for the page: on the last look it is fitted (the type made smaller, no more than to 72%), else said. The
      // room is down to the footer's top when there is one, so the fitted page never lands its last lines on the footer.
      if((maxB>MM||under)&&D.fit&&pass===0){var bottom=Math.max(r.bottom+maxB,low),limit=fr?fr.top-2*MM:r.bottom-MM;var f=(limit-r.top)/(bottom-r.top);if(f<1&&f>=0.72){sec.style.zoom=String(f);sec.style.width=(D.page.w/f)+'mm';sec.style.height=(D.page.h/f)+'mm';zoomed=true;}}
      if(maxB>MM){var whole=(r.height+maxB)/r.height;problems.push({page:n,kind:'over',words:'content runs '+Math.round(maxB/MM)+' mm past the bottom edge and is cut off (from "'+words(worst)+'"): it is '+Math.round(whole*100)+'% of the page, so cut or shrink it by about '+Math.round((1-1/whole)*100+5)+'%',shrink:Math.round((1-1/whole)*100)});}
      if(maxR>MM)problems.push({page:n,kind:'over',words:'content runs '+Math.round(maxR/MM)+' mm past the right edge and is cut off'});
      // Empty room: the lower part of the page, or a gap between things (a cover's or a title page's space is its design).
      spans.sort(function(a,b){return a[0]-b[0];});var reach=0,gap=0,gapAt=0;spans.forEach(function(sp){if(sp[0]-reach>gap&&reach>0){gap=sp[0]-reach;gapAt=reach;}reach=Math.max(reach,sp[1]);});
      var titled=!!sec.querySelector('.display')||si===0;
      var last=sec===secs[secs.length-1];
      var empty=(r.height-reach)/r.height;
      if(empty>0.2&&!last&&!titled)problems.push({page:n,kind:'empty',words:'the lower '+Math.round(empty*100)+'% of the page is empty'});
      if(gap/r.height>0.22&&!titled)problems.push({page:n,kind:'empty',words:'an empty gap of '+Math.round(gap/MM)+' mm ('+Math.round(gap/r.height*100)+'% of the page) from '+Math.round(gapAt/MM)+' mm down: bring things together or fill it'});
    } else {
      var printable=pageH-34*MM;var est=Math.max(1,Math.ceil((r.height-34*MM)/printable));var first=pages+1;pages+=est;
      for(var p=0;p<est;p++)boxes.push({x:r.left+scrollX,y:r.top+scrollY+p*pageH,w:r.width,h:Math.min(pageH,r.height-p*pageH)});
      var missed=unused.filter(function(ref){return Number(ref.slice(1))<=D.asked;});
      if(sec.classList.contains('nv-rest')&&missed.length)problems.push({page:first,kind:'block',words:'blocks '+missed.join(', ')+' were never placed: they are added at the end, unstyled. Place each as an empty <nv-block ref="bN"></nv-block>'});
    }
  });
  if(zoomed){requestAnimationFrame(function(){requestAnimationFrame(function(){measure(1);});});return;}
  var pageOf=function(e){var sec=e.closest('#doc>section');var i=nums.findIndex(function(x){return x[0]===sec;});return i>=0?nums[i][1]:0;};
  fixContrast(problems,pageOf);
  if((D.logos.primary||D.logos.onDark)&&secs.length&&!secs[0].querySelector('img.nv-logo'))problems.push({page:1,kind:'logo',words:'the brand has a logo and it is not on the first page: place <nv-logo> there'});
  nums.forEach(function(x){Array.prototype.slice.call(x[0].querySelectorAll('nv-page-number')).forEach(function(el){el.textContent=x[1]+' of '+pages;});});
  if(twice.length)problems.push({page:0,kind:'block',words:'blocks placed more than once (only the first kept): '+twice.join(', ')});
  var seen={},out=[];problems.forEach(function(p){var k=p.page+p.kind+p.words;if(!seen[k]){seen[k]=1;out.push(p);}});
  window.__report={pages:pages,moved:0,split:0,cut:[],problems:out.slice(0,30),unused:D.keepAll?unused.filter(function(ref){return Number(ref.slice(1))<=D.asked;}):[],boxes:boxes};
}
settle().then(pickLogos).then(fitFigures).then(function(){requestAnimationFrame(function(){requestAnimationFrame(function(){measure(0);});});});
})();`;

export function designPage(d: DesignPageInput): string {
  const data = { layout: d.layout, blocks: d.blocks, logos: d.logos, brand: d.brandName, keepAll: d.keepAll, page: d.kind.page, asked: d.asked ?? d.blocks.length, fit: d.fit === true };
  const nonce = d.nonce.replace(/[^\w-]/g, '');
  const csp = `default-src 'none'; img-src file: data:; font-src file: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${esc(d.title)}</title><style>${baseCss(d)}</style></head><body><div id="doc"></div><script type="application/json" id="nv-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script><script nonce="${nonce}">${DESIGN_JS}</script></body></html>`;
}
