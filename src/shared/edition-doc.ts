// An edition's pages (Publications, Wave 6 part a, 24 Oct 2026; the plan: "Layout studio: choose a template, drag
// sections, see pages fill and overflow before printing, and set page counts per section"). One HTML document, made here
// from the edition's items, is everything an edition looks like:
//   - the layout studio shows it in a frame and reads back how each section filled (its pages, what ran over its budget);
//   - the PDF is the same document printed by Chromium (src/main/edition-print.ts), and so is a copy sent to a printer.
// Its own small script lays the pieces onto A4 pages once its type and pictures are in: each section starts a page, the
// pieces flow down the columns in order, a piece that would run off a page goes whole to the next, a page past the
// section's budget is marked over (in the studio only), and "Inside" on the front gets its page numbers. Because the
// studio and the printer run the very same pages, what the studio says fits is what prints.
//
// Pure: it makes words (HTML); nothing here touches files. The caller says where each vault file is (`url`).

import { answersText, DIFFICULTY_WORDS, solveTimeWords, type Crossword, type DailyWord, type Puzzle, type Sudoku, type WordSearch } from './puzzles';
import { BULLET_RE, imageExtOf, kindInfo, longDate, TABLE_ROW_RE, type AnswerBlock, type Item, type Publication, type Template } from './publications';

export interface DocSection {
  name: string;
  pages: number;
  items: Item[];
}

export interface DocInput {
  pub: Pick<Publication, 'title' | 'masthead' | 'motto' | 'style'>;
  number: number | null;
  date: string | null;
  preview?: boolean;
  template: Template;
  sections: DocSection[];
  answers: { from: string; blocks: AnswerBlock[] } | null;
  /** A vault file's address for the page (file:///…), or '' when it can't be shown. */
  url(rel: string): string;
  /** The app's own type, when found (its serif and sans files' addresses). */
  appFonts?: { serif?: string; sans?: string; sansItalic?: string };
  /** 'studio': pages on a grey desk, over-budget pages marked, pieces clickable; 'print': plain pages for the PDF. */
  mode: 'studio' | 'print';
  /** The piece to show picked in the studio. */
  picked?: string;
}

// ── Words made safe for the page ─────────────────────────────────────────────────────────────────────────────────────

export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** One line's own marks: bold, italics, code, links shown as their words, wiki links by their names. */
function inline(s: string, url: (rel: string) => string): string {
  let t = esc(s);
  // An embedded file that is no picture is linked, never a broken picture (9.5).
  t = t.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (_, p: string, label?: string) => {
    const ref = p.trim();
    const u = url(ref);
    if (!u) return '';
    if (imageExtOf(ref)) return `<img class="inl" src="${esc(u)}" alt="">`;
    return `<a href="${esc(u)}">${esc(label?.trim() || ref.split('/').pop()!)}</a>`;
  });
  t = t.replace(/\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (_, p: string, label?: string) => esc(label || p.split('/').pop()!.replace(/\.md$/i, '')).replace(/&amp;/g, '&'));
  t = t.replace(/\[([^\]]+)\]\((?:[^)\s]+)\)/g, '$1');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>');
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<i>$2</i>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t;
}

/** Markdown as the page shows it: paragraphs, lists, small headings and tables. */
export function mdHtml(md: string, url: (rel: string) => string, o: { firstClass?: string } = {}): string {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let first = true;
  const flush = () => {
    if (!para.length) return;
    out.push(`<p${first && o.firstClass ? ` class="${o.firstClass}"` : ''}>${inline(para.join(' '), url)}</p>`);
    first = false;
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim()) {
      flush();
      continue;
    }
    if (TABLE_ROW_RE.test(l)) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && TABLE_ROW_RE.test(lines[i]!); i++)
        rows.push(
          lines[i]!.trim()
            .replace(/^\||\|$/g, '')
            .split(/(?<!\\)\|/)
            .map((c) => c.replace(/\\\|/g, '|').trim()),
        );
      i--;
      const ruled = rows.length > 1 && rows[1]!.every((c) => /^:?-{2,}:?$/.test(c));
      const head = ruled ? rows[0]! : null;
      const body = rows.slice(ruled ? 2 : 0).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      const num = (c: string) => /^[-+]?[\d.,:%°/–-]+\s*\w{0,3}$/.test(c);
      out.push(`<table>${head ? `<thead><tr>${head.map((c, k) => `<th${k && body.every((r) => num(r[k] ?? '')) ? ' class="n"' : ''}>${inline(c, url)}</th>`).join('')}</tr></thead>` : ''}<tbody>${body.map((r) => `<tr>${r.map((c, k) => `<td${k && num(c) ? ' class="n"' : ''}>${inline(c, url)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      flush();
      out.push(`<h4>${inline(h[2]!, url)}</h4>`);
      continue;
    }
    if (BULLET_RE.test(l)) {
      flush();
      const ordered = /^\s*\d+[.)]/.test(l);
      const items: string[] = [];
      for (; i < lines.length && BULLET_RE.test(lines[i]!); i++) items.push(lines[i]!.replace(BULLET_RE, ''));
      i--;
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x, url)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      flush();
      out.push(`<blockquote>${inline(l.replace(/^>\s?/, ''), url)}</blockquote>`);
      continue;
    }
    para.push(l.trim());
  }
  flush();
  return out.join('');
}

// ── The pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────

function sourceLine(it: Item): string {
  const parts = [it.source ? `Source: ${it.source}` : '', it.credit].filter(Boolean);
  return parts.length ? `<div class="src">${esc(parts.join(' · '))}</div>` : '';
}

function picture(it: Item, d: DocInput, cls = ''): string {
  const u = it.image ? d.url(it.image) : '';
  if (!u) return '';
  if (!imageExtOf(it.image!)) return `<p class="file"><a href="${esc(u)}">${esc(it.image!.split('/').pop()!)}</a></p>`;
  return `<figure class="fig ${cls}"><img src="${esc(u)}" alt=""></figure>`;
}

function crosswordHtml(p: Crossword, o: { mini?: boolean; filled?: boolean } = {}): string {
  const nums = new Map<string, number>();
  for (const e of [...p.across, ...p.down]) nums.set(`${e.row},${e.col}`, e.n);
  const cells: string[] = [];
  for (let r = 0; r < p.height; r++)
    for (let c = 0; c < p.width; c++) {
      const ch = p.grid[r]![c]!;
      if (ch === '#') cells.push('<i class="b"></i>');
      else {
        const n = nums.get(`${r},${c}`);
        cells.push(`<i>${n && !o.mini ? `<em>${n}</em>` : ''}${o.filled ? `<s>${ch}</s>` : ''}</i>`);
      }
    }
  return `<div class="xw${o.mini ? ' mini' : ''}" style="--w:${p.width};--h:${p.height}">${cells.join('')}</div>`;
}

function sudokuHtml(p: Sudoku, o: { mini?: boolean; filled?: boolean } = {}): string {
  const src = o.filled ? p.solution : p.grid;
  return `<div class="sd${o.mini ? ' mini' : ''}">${[...src].map((ch, i) => `<i class="${(i % 9) % 3 === 2 && i % 9 !== 8 ? 'rr ' : ''}${Math.floor(i / 9) % 3 === 2 && Math.floor(i / 9) !== 8 ? 'rb' : ''}">${ch === '.' ? '' : o.filled && p.grid[i] === '.' ? `<s>${ch}</s>` : ch}</i>`).join('')}</div>`;
}

function wordSearchHtml(p: WordSearch): string {
  return `<div class="ws" style="--n:${p.size}">${p.rows.map((r) => [...r].map((ch) => `<i>${ch}</i>`).join('')).join('')}</div>`;
}

function dailyHtml(p: DailyWord): string {
  const row = (word: string, marks: string[] | null) => `<div class="dw-row">${[...word.padEnd(p.length, ' ')].map((ch, i) => `<i class="${marks ? marks[i] : 'blank'}">${ch.trim()}</i>`).join('')}</div>`;
  return `<div class="dw" style="--n:${p.length}">${p.guesses.map((g) => row(g.word, g.marks)).join('')}${row('', null)}</div>`;
}

function puzzleBox(it: Item, p: Puzzle): string {
  const title = esc(it.headline || kindInfo(it.kind)?.name || 'Puzzle');
  if (p.kind === 'crossword') {
    const clues = (list: Crossword['across']) => list.map((e) => `<li><b>${e.n}</b> ${esc(e.clue || '…')} <span class="en">(${esc(e.enumeration)})</span></li>`).join('');
    return `<div class="pz-head"><span class="pz-kind">Crossword</span><span class="pz-title">${title}</span></div><div class="pz-xw">${crosswordHtml(p)}<div class="clues"><h5>Across</h5><ol>${clues(p.across)}</ol><h5>Down</h5><ol>${clues(p.down)}</ol></div></div>`;
  }
  if (p.kind === 'sudoku') return `<div class="pz-head"><span class="pz-kind">Sudoku</span><span class="pz-title">${esc(DIFFICULTY_WORDS[p.difficulty])}</span></div>${sudokuHtml(p)}<p class="pz-how">Fill the grid so every row, column and 3×3 box holds 1 to 9.</p>`;
  if (p.kind === 'wordsearch') return `<div class="pz-head"><span class="pz-kind">Word search</span><span class="pz-title">${title}</span></div><div class="pz-ws">${wordSearchHtml(p)}<ul class="ws-list">${p.words.map((w) => `<li>${esc(w.words)}</li>`).join('')}</ul></div><p class="pz-how">${p.ways === 'hard' ? 'Words run every way, backwards too.' : 'Words run across, down and diagonally.'}</p>`;
  return `<div class="pz-head"><span class="pz-kind">Daily word</span><span class="pz-title">${p.length} letters</span></div>${dailyHtml(p)}<p class="pz-how"><b class="k right"></b> right letter, right place · <b class="k present"></b> in the word, wrong place · <b class="k absent"></b> not in it.${p.fits === 1 ? ' Only one word fits.' : ''}</p>`;
}

function itemHtml(it: Item, d: DocInput): string {
  const id = esc(it.path);
  const head = esc(it.headline);
  const url = d.url;
  const base = (cls: string, inner: string) => `<div class="it it-${it.kind} ${cls}" data-id="${id}" data-title="${head}">${inner}</div>`;
  switch (it.kind) {
    case 'story': {
      if (it.lead) {
        const pic = picture(it, d, 'lead-fig');
        return base('lead span', `<div class="kick">${esc(it.section || 'Lead')}</div><h1 class="hd">${head}</h1>${it.deck ? `<p class="deck">${esc(it.deck)}</p>` : ''}${pic}${it.image && it.credit ? `<div class="cap">${esc(it.credit)}</div>` : ''}<div class="tx cols-in">${mdHtml(it.body, url, { firstClass: 'drop' })}${it.source ? `<div class="src">Source: ${esc(it.source)}</div>` : ''}</div>`);
      }
      return base('', `<h2 class="hd">${head}</h2>${it.deck ? `<p class="deck">${esc(it.deck)}</p>` : ''}${picture(it, d)}<div class="tx">${mdHtml(it.body, url)}</div>${sourceLine(it)}`);
    }
    case 'brief':
      return base('keep', `<div class="tx"><p><b class="run">${head}.</b> ${inline(it.body.replace(/\s+/g, ' '), url)}</p></div>${sourceLine(it)}`);
    case 'weather':
    case 'sports': {
      // The weather runs across the page (places down, days across, as a paper's weather bar); a wide table does too.
      const cols = Math.max(0, ...it.body.split(/\r?\n/).filter((l) => TABLE_ROW_RE.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').length));
      const wide = it.kind === 'weather' || cols >= 6;
      return base(wide ? 'span keep' : 'keep', `<div class="kick">${it.kind === 'weather' ? 'Weather' : esc(it.section || 'Sport')}</div><h3 class="hd-s">${head}</h3><div class="tx tab">${mdHtml(it.body, url)}</div>${sourceLine(it)}`);
    }
    case 'image': {
      const u = it.image ? url(it.image) : '';
      return base('keep', `${u ? `<figure class="fig"><img src="${esc(u)}" alt=""></figure>` : '<div class="nopic">Picture not found</div>'}<div class="cap"><b>${head}.</b> ${inline(it.body.replace(/\s+/g, ' '), url)}</div>${it.credit ? `<div class="credit">${esc(it.credit)}</div>` : ''}`);
    }
    case 'cartoon': {
      const u = it.image ? url(it.image) : '';
      const caps = it.body
        .split(/\r?\n/)
        .filter((l) => BULLET_RE.test(l))
        .map((l) => l.replace(BULLET_RE, ''));
      const lead = caps.length ? '' : it.body.trim();
      return base('span keep', `<div class="kick">Cartoon</div><h3 class="hd-c">${head}</h3>${u ? `<figure class="strip"><img src="${esc(u)}" alt=""></figure>` : '<div class="nopic">Strip not found</div>'}${caps.length ? `<ol class="panels" style="--n:${caps.length}">${caps.map((c) => `<li>${inline(c, url)}</li>`).join('')}</ol>` : lead ? `<p class="cap">${inline(lead, url)}</p>` : ''}${it.credit ? `<div class="credit">${esc(it.credit)}</div>` : ''}`);
    }
    case 'quote':
      return base('keep', `<blockquote class="q">${inline(it.body.replace(/\s+/g, ' ') || it.headline, url)}</blockquote>${it.who ? `<div class="who">— ${esc(it.who)}</div>` : ''}`);
    case 'onthisday':
      return base('keep', `<div class="kick">On this day</div><h3 class="hd-s">${head}</h3><div class="tx otd">${mdHtml(it.body, url)}</div>`);
    case 'crossword':
    case 'wordsearch':
      return it.puzzle ? base('span keep pz', puzzleBox(it, it.puzzle)) : base('keep', `<h3 class="hd-s">${head}</h3><p class="nopic">This puzzle has no grid yet.</p>`);
    case 'sudoku':
    case 'dailyword':
      return it.puzzle ? base('keep pz', puzzleBox(it, it.puzzle)) : base('keep', `<h3 class="hd-s">${head}</h3><p class="nopic">This puzzle has no grid yet.</p>`);
  }
  return base('', `<h2 class="hd">${head}</h2><div class="tx">${mdHtml(it.body, url)}</div>${sourceLine(it)}`);
}

function answersHtml(a: { from: string; blocks: AnswerBlock[] }): string {
  const parts = a.blocks.map((b) => {
    const p = b.puzzle;
    const name = kindInfo(b.kind)?.name ?? 'Puzzle';
    if (p.kind === 'crossword') return `<div class="ans-one"><h5>${esc(name)}</h5>${crosswordHtml(p, { mini: true, filled: true })}</div>`;
    if (p.kind === 'sudoku') return `<div class="ans-one"><h5>${esc(name)}</h5>${sudokuHtml(p, { mini: true, filled: true })}</div>`;
    if (p.kind === 'wordsearch') return `<div class="ans-one wide"><h5>${esc(name)}</h5><p>${esc(answersText(p))}</p></div>`;
    return `<div class="ans-one"><h5>${esc(name)}</h5><p class="dw-ans">${esc((p as DailyWord).answer)}</p></div>`;
  });
  // A column wide, so it sits beside the puzzles rather than below all of them.
  return `<div class="it it-answers keep" data-id="answers" data-title="Answers"><div class="pz-head"><span class="pz-kind">Answers</span><span class="pz-title">to ${esc(a.from)}</span></div><div class="ans">${parts.join('')}</div></div>`;
}

// ── The page's look ──────────────────────────────────────────────────────────────────────────────────────────────────

function fontFaces(d: DocInput): string {
  const s = d.pub.style;
  const out: string[] = [];
  const face = (family: string, src: string, weight = '400', style = 'normal') => (src ? `@font-face{font-family:'${family}';src:url("${esc(src)}");font-weight:${weight};font-style:${style};font-display:block}` : '');
  if (d.appFonts?.serif) out.push(face('NV Serif', d.appFonts.serif, '200 900'));
  if (d.appFonts?.sans) out.push(face('NV Sans', d.appFonts.sans, '100 900'));
  if (d.appFonts?.sansItalic) out.push(face('NV Sans', d.appFonts.sansItalic, '100 900', 'italic'));
  if (s.mastheadFont) out.push(face('Pub Masthead', d.url(s.mastheadFont), '400 900'));
  if (s.headFont) out.push(face('Pub Head', d.url(s.headFont), '400 900'));
  if (s.bodyFont) {
    out.push(face('Pub Body', d.url(s.bodyFont), '400'));
    for (const f of s.bodyFaces) {
      const n = f.toLowerCase();
      const bold = /bold|black|heavy|semibold/.test(n);
      const it = /italic|oblique/.test(n);
      out.push(face('Pub Body', d.url(f), bold ? '700' : '400', it ? 'italic' : 'normal'));
    }
  }
  return out.join('\n');
}

const CSS = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#fff;color:var(--ink);font-family:var(--body);-webkit-print-color-adjust:exact;print-color-adjust:exact;text-rendering:optimizeLegibility;font-kerning:normal;font-variant-ligatures:common-ligatures}
.studio,.studio body{overflow:hidden}
.studio body{background:#d9d5cd;padding:28px 28px 60px}
#flow{position:absolute;left:-10000px;top:0;width:210mm;visibility:hidden}
#pages{display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start}
.page{width:210mm;height:297mm;background:#fff;position:relative;overflow:hidden;padding:var(--margin);display:flex;flex-direction:column;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.studio .page{box-shadow:0 1px 2px rgba(40,30,20,.16),0 10px 28px rgba(40,30,20,.12)}
.rh{flex:none;display:flex;align-items:baseline;justify-content:space-between;gap:4mm;font:600 6.4pt/1.1 var(--sans);letter-spacing:.12em;text-transform:uppercase;padding-bottom:1.4mm;border-bottom:2.4pt double var(--ink);margin-bottom:3mm}
.rh .rh-mast{font:400 11pt/1 var(--mast);letter-spacing:0;text-transform:none}
.rh .rh-sec{font-weight:800}
.pf{flex:none;margin-top:2mm;padding-top:1.2mm;border-top:.4pt solid #8d877c;display:flex;justify-content:space-between;font:500 6pt/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:#4a463f}
.cols{flex:none;column-gap:var(--gutter);column-rule:.35pt solid #bdb7ab;column-fill:auto;overflow:hidden;orphans:2;widows:2}
.mast{flex:none;margin-bottom:3.2mm}
.mast-top{display:flex;align-items:center;justify-content:center;gap:5mm;padding:0 0 1.6mm}
.mast-crest{height:26mm;width:auto;flex:none;object-fit:contain}
.mast-title{font-family:var(--mast);font-weight:var(--mast-weight);font-size:62pt;line-height:.95;letter-spacing:var(--mast-track);white-space:nowrap;text-align:center;flex:0 1 auto;min-width:0}
.ear{flex:none;width:30mm;font:500 6.6pt/1.3 var(--sans);text-transform:uppercase;letter-spacing:.08em;border:.5pt solid var(--ink);padding:1.6mm 2mm;text-align:center}
.ear b{display:block;font:700 13pt/1.05 var(--body);letter-spacing:0;text-transform:none;margin-top:.6mm}
.mast-motto{text-align:center;font:italic 400 9pt/1.2 var(--body);margin:-.4mm 0 1.6mm;color:#2c2924}
.mast-line{display:flex;justify-content:space-between;align-items:center;font:700 6.8pt/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;padding:1.5mm 0;border-top:.8pt solid var(--ink);border-bottom:2.6pt double var(--ink)}
.mast-inside{display:flex;flex-wrap:wrap;justify-content:center;gap:1mm 5mm;font:500 6.6pt/1.2 var(--sans);letter-spacing:.06em;text-transform:uppercase;padding:1.4mm 0 0}
.mast-inside b{font-weight:800}
.mast-inside em{font-style:normal;color:#57524a}
.sec-head{column-span:all;display:flex;align-items:baseline;justify-content:space-between;border-bottom:1.6pt solid var(--ink);padding-bottom:1mm;margin-bottom:3mm}
.sec-head h2{margin:0;font:800 17pt/1 var(--head);letter-spacing:.01em;text-transform:uppercase}
.sec-head span{font:600 6.4pt/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:#4a463f}
.it{font-size:var(--size);line-height:var(--lead);padding-bottom:2.6mm;margin-bottom:2.8mm;border-bottom:.35pt solid #c3bdb1}
.it.keep{break-inside:avoid}
.it.span{column-span:all}
.it:last-child{border-bottom:0}
.kick{font:700 6.2pt/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;margin-bottom:1.2mm;color:#3b3731}
.hd{font-family:var(--head);font-weight:700;font-size:calc(var(--size)*1.72);line-height:1.08;margin:0 0 1.4mm;letter-spacing:-.005em;break-after:avoid;hyphens:manual}
.lead .hd{font-size:var(--leadsize);line-height:1.0;letter-spacing:-.012em;margin-bottom:2.2mm;text-align:left}
.hd-s,.hd-c{font:700 calc(var(--size)*1.22)/1.15 var(--head);margin:0 0 1.4mm;break-after:avoid}
.hd-c{font-size:calc(var(--size)*1.5)}
.deck{font:italic 400 calc(var(--size)*1.18)/1.28 var(--body);margin:0 0 1.8mm;color:#2c2924}
.lead .deck{font-size:calc(var(--size)*1.5);margin-bottom:2.6mm}
.tx p{margin:0;text-align:var(--align);hyphens:auto;-webkit-hyphens:auto;text-indent:1.1em;text-wrap:pretty}
.tx p:first-child,.tx h4+p,.tx table+p{text-indent:0}
.tx h4{font:700 calc(var(--size)*1.02)/1.2 var(--head);margin:1.6mm 0 .6mm;break-after:avoid}
.tx ul,.tx ol{margin:.6mm 0;padding-left:1.1em}
.tx li{margin:.2mm 0}
.tx blockquote{margin:1mm 0;padding-left:2mm;border-left:.8pt solid var(--ink);font-style:italic}
.cols-in{column-count:var(--cols);column-gap:var(--gutter);column-rule:.35pt solid #bdb7ab}
.drop::first-letter{float:left;font-family:var(--head);font-weight:700;font-size:calc(var(--size)*4.15);line-height:.82;padding:.7mm 1.4mm 0 0}
.src{margin-top:1.2mm;font:italic 400 calc(var(--size)*.86)/1.2 var(--body);color:#4a463f}
.src::before{content:'';display:inline-block;width:4mm;border-top:.5pt solid #4a463f;vertical-align:middle;margin-right:1.4mm}
.run{font-family:var(--head)}
.fig{margin:0 0 1.6mm}
.fig img,.strip img{display:block;width:100%;height:auto}
.lead-fig img{max-height:96mm;object-fit:cover}
.gray img{filter:grayscale(1) contrast(1.05)}
.cap{font:400 calc(var(--size)*.9)/1.25 var(--body);color:#2c2924;margin-bottom:.6mm}
.cap b{font-family:var(--head)}
.credit{font:600 5.6pt/1.2 var(--sans);letter-spacing:.1em;text-transform:uppercase;text-align:right;color:#5d584f}
.nopic{border:.5pt dashed #8d877c;padding:6mm 2mm;text-align:center;font:italic 8pt var(--body);color:#5d584f;margin-bottom:1.6mm}
.strip{margin:0 0 1.4mm}
.strip img{max-height:92mm;object-fit:contain;border:.6pt solid var(--ink)}
.panels{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:3mm;list-style:none;padding:0;margin:0 0 1mm;counter-reset:p}
.panels li{font:italic 400 calc(var(--size)*.95)/1.25 var(--body);counter-increment:p}
.panels li::before{content:counter(p);font:800 6pt var(--sans);margin-right:1.2mm;font-style:normal}
table{width:100%;border-collapse:collapse;font:500 calc(var(--size)*.86)/1.2 var(--sans);font-variant-numeric:tabular-nums;margin:.6mm 0 1.2mm}
th{text-align:left;font-weight:800;font-size:.92em;letter-spacing:.04em;text-transform:uppercase;border-bottom:.8pt solid var(--ink);padding:.7mm .8mm}
td{padding:.65mm .8mm;border-bottom:.3pt solid #cfc9bd;vertical-align:top}
tr:last-child td{border-bottom:.8pt solid var(--ink)}
th.n,td.n{text-align:right}
.tab h4{font:800 6.6pt/1.2 var(--sans);letter-spacing:.1em;text-transform:uppercase;margin:1.4mm 0 .4mm}
.q{margin:1mm 0 1.2mm;font:italic 400 calc(var(--size)*1.45)/1.25 var(--body);text-align:center;position:relative;padding:0 3mm}
.q::before{content:'\\201C';display:block;font:700 26pt/0.6 var(--head);margin-bottom:1.6mm}
.who{text-align:center;font:600 6.4pt/1.2 var(--sans);letter-spacing:.12em;text-transform:uppercase}
.otd ul{list-style:none;padding:0}
.otd li{padding:.5mm 0;border-bottom:.3pt dotted #b3ada1}
.otd li b:first-child,.otd li strong:first-child{font-family:var(--head)}
.pz{border:0;padding:0}
.pz-head{display:flex;align-items:baseline;gap:2mm;border-top:2.2pt solid var(--ink);border-bottom:.5pt solid var(--ink);padding:1mm 0 .9mm;margin-bottom:2mm}
.pz-kind{font:800 9pt/1 var(--head);text-transform:uppercase;letter-spacing:.04em}
.pz-title{font:italic 400 8pt/1 var(--body);color:#3b3731}
.pz-how{font:italic 400 calc(var(--size)*.86)/1.25 var(--body);margin:1.2mm 0 0;color:#3b3731}
.pz-xw,.pz-ws{display:grid;grid-template-columns:auto 1fr;gap:4mm;align-items:start}
.xw{display:grid;grid-template-columns:repeat(var(--w),var(--cell));grid-auto-rows:var(--cell);width:max-content;--cell:min(5.6mm,calc(98mm / var(--w)))}
.xw i{position:relative;font-style:normal;background:#fff;outline:.75pt solid var(--ink);outline-offset:-.375pt}
.xw i.b{background:none;outline:none}
.xw i em{position:absolute;top:.25mm;left:.35mm;font:600 4.4pt/1 var(--sans);font-style:normal}
.xw i s,.sd i s{text-decoration:none}
.xw i s{position:absolute;inset:0;display:grid;place-items:center;font:700 calc(var(--cell)*.62)/1 var(--sans)}
.xw.mini{--cell:min(2.7mm,calc(42mm / var(--w)))}
.clues{columns:2;column-gap:4mm;font-size:calc(var(--size)*.92);line-height:1.22}
.clues h5{margin:0 0 .6mm;font:800 6.6pt/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;break-after:avoid}
.clues ol{list-style:none;padding:0;margin:0 0 2mm}
.clues li{margin:0 0 .5mm;padding-left:4.2mm;text-indent:-4.2mm;break-inside:avoid}
.clues li b{font-family:var(--sans);font-weight:800;display:inline-block;width:4.2mm;text-indent:0}
.en{white-space:nowrap;color:#4a463f}
.sd{display:grid;grid-template-columns:repeat(9,1fr);border:1.4pt solid var(--ink);aspect-ratio:1;width:100%;max-width:62mm;margin:0 auto}
.sd i{display:grid;place-items:center;font:600 9.4pt/1 var(--sans);font-style:normal;border-right:.35pt solid #6b665d;border-bottom:.35pt solid #6b665d}
.sd i:nth-child(9n){border-right:0}
.sd i:nth-last-child(-n+9){border-bottom:0}
.sd i.rr{border-right:1.2pt solid var(--ink)}
.sd i.rb{border-bottom:1.2pt solid var(--ink)}
.sd i s{font-weight:400;color:#3b3731}
.sd.mini{max-width:34mm;border-width:1pt}
.sd.mini i{font-size:5.4pt}
.ws{display:grid;grid-template-columns:repeat(var(--n),var(--c));grid-auto-rows:var(--c);--c:min(5.4mm,calc(96mm / var(--n)));border:1pt solid var(--ink);padding:1mm;width:max-content}
.ws i{display:grid;place-items:center;font:600 calc(var(--c)*.6)/1 var(--sans);font-style:normal;letter-spacing:0}
.ws-list{columns:2;column-gap:4mm;list-style:none;padding:0;margin:0;font:600 calc(var(--size)*.9)/1.4 var(--sans);text-transform:uppercase;letter-spacing:.06em}
.dw{display:grid;gap:1.2mm;justify-content:center;margin:1mm 0}
.dw-row{display:grid;grid-template-columns:repeat(var(--n),var(--t));gap:1.2mm;--t:min(7.4mm,calc((100% - 6mm) / var(--n)))}
.dw i{height:7.4mm;display:grid;place-items:center;font:800 10pt/1 var(--sans);font-style:normal;border:.8pt solid var(--ink)}
.dw i.right{background:var(--ink);color:#fff}
.dw i.present{background:#a9a397;color:#111}
.dw i.absent{background:#fff}
.dw i.blank{border-style:dashed;border-color:#6b665d}
.k{display:inline-block;width:2.4mm;height:2.4mm;border:.6pt solid var(--ink);vertical-align:-.3mm}
.k.right{background:var(--ink)}.k.present{background:#a9a397}.k.absent{background:#fff}
.ans{display:flex;flex-direction:column;gap:3mm;align-items:flex-start}
.ans-one h5{margin:0 0 1mm;font:800 6pt/1 var(--sans);letter-spacing:.12em;text-transform:uppercase}
.ans-one p{margin:0;font-size:calc(var(--size)*.86);line-height:1.25;max-width:80mm}
.ans-one.wide{align-self:stretch}
.dw-ans{font:800 12pt/1 var(--sans)!important;letter-spacing:.2em}
img.inl{max-width:100%;height:auto;display:block;margin:1mm 0}
code{font-family:var(--sans);font-size:.9em}
.cut{outline:none}
.studio .it{cursor:pointer}
.studio .it:hover{outline:1px solid rgba(232,93,63,.55);outline-offset:1px}
.studio .it.picked{outline:2px solid #e85d3f;outline-offset:1px;background:rgba(232,93,63,.06)}
.studio .page.over::after{content:attr(data-over);position:absolute;left:0;right:0;top:0;padding:2.2mm var(--margin);background:#b3261e;color:#fff;font:700 8pt/1.2 'NV Sans',sans-serif;letter-spacing:.02em}
.studio .page.over{box-shadow:0 0 0 3px #b3261e,0 10px 28px rgba(40,30,20,.12)}
.studio .page.over .cols,.studio .page.over .mast{opacity:.55}
.studio .page.has-cut::before{content:attr(data-cut);position:absolute;left:0;right:0;bottom:0;padding:2mm var(--margin);background:repeating-linear-gradient(135deg,#b3261e 0 8px,#9a1f18 8px 16px);color:#fff;font:700 8pt/1.2 'NV Sans',sans-serif;z-index:2}
.studio .pageno{position:absolute;top:-22px;left:0;font:600 12px/1 'NV Sans',sans-serif;color:#5d584f}
.studio .page{overflow:visible}
`;

// The page's own script: lays the pieces onto pages once the type and pictures are in, and says how each section filled.
// Plain browser JavaScript (it runs inside the frame and the print window, never in the app's code).
const LAYOUT_JS = `
(function(){
var M=JSON.parse(document.getElementById('nv-meta').textContent);
var flow=document.getElementById('flow'),pagesEl=document.getElementById('pages');
var studio=document.documentElement.classList.contains('studio');
var MM=96/25.4;
function el(tag,cls,html){var e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;}
function ready(){
  var imgs=Array.prototype.slice.call(document.images).map(function(im){return im.complete?null:new Promise(function(r){im.onload=im.onerror=function(){r();};setTimeout(r,8000);});});
  return Promise.all([document.fonts?document.fonts.ready:null].concat(imgs));
}
function over(c){return c.scrollWidth>c.clientWidth+1||c.scrollHeight>c.clientHeight+1;}
function fitTitle(t){var size=parseFloat(getComputedStyle(t).fontSize);var guard=0;while(t.scrollWidth>t.clientWidth+1&&size>18&&guard++<200){size-=1;t.style.fontSize=size+'px';}}
var pageNo=0,report={pages:0,sections:[],items:{},cut:[]};
function newPage(sec,opts){
  pageNo++;
  var pg=el('div','page');pg.dataset.page=pageNo;
  if(!opts.front){var rh=el('div','rh');rh.appendChild(el('span','rh-mast',M.mastheadHtml));rh.appendChild(el('span','rh-sec',sec.dataset.name+(opts.cont?' · continued':'')));rh.appendChild(el('span','rh-date',M.dateline));pg.appendChild(rh);}
  if(opts.front){var mast=document.getElementById('mast-src').cloneNode(true);mast.removeAttribute('id');mast.className='mast';pg.appendChild(mast);}
  var cols=el('div','cols');cols.style.columnCount=opts.front?M.frontColumns:M.columns;pg.appendChild(cols);
  var pf=el('div','pf');pf.appendChild(el('span','',M.footLeft));pf.appendChild(el('span','','Page '+pageNo));pf.appendChild(el('span','',M.footRight));pg.appendChild(pf);
  if(studio){pg.appendChild(el('span','pageno','Page '+pageNo));}
  pagesEl.appendChild(pg);
  if(opts.front){var t=pg.querySelector('.mast-title');if(t)fitTitle(t);}
  var inner=pg.clientHeight;var cs=getComputedStyle(pg);var top=cols.getBoundingClientRect().top-pg.getBoundingClientRect().top;
  var h=inner-parseFloat(cs.paddingBottom)-top-pf.getBoundingClientRect().height-parseFloat(getComputedStyle(pf).marginTop);
  cols.dataset.h=Math.floor(h);cols.style.height=Math.floor(h-1.2*MM)+'px';
  return {pg:pg,cols:cols};
}
function settle(cols){cols.style.height=cols.dataset.h+'px';}
function lastFill(cols,n){
  var kids=cols.children;if(!kids.length)return 0;var last=kids[kids.length-1];var rs=last.getClientRects();if(!rs.length)return 0;var r=rs[rs.length-1];var b=cols.getBoundingClientRect();
  var gap=parseFloat(getComputedStyle(cols).columnGap)||0;var w=(b.width-gap*(n-1))/n;var ci=Math.max(0,Math.min(n-1,Math.floor((r.left-b.left+1)/(w+gap))));
  if(last.classList.contains('span'))return Math.min(1,(r.bottom-b.top)/b.height);
  return Math.min(1,(ci+Math.min(1,(r.bottom-b.top)/b.height))/n);
}
ready().then(function(){
  var secs=Array.prototype.slice.call(flow.querySelectorAll('section.sec'));
  secs.forEach(function(sec,si){
    var front=si===0;var budget=parseFloat(sec.dataset.pages)||1;var first=pageNo+1;
    var p=newPage(sec,{front:front});var pagesHere=[p];
    if(!front){var sh=el('div','sec-head','<h2>'+sec.dataset.name+'</h2>');p.cols.appendChild(sh);}
    var items=Array.prototype.slice.call(sec.children);
    items.forEach(function(it){
      p.cols.appendChild(it);
      if(over(p.cols)){
        var alone=p.cols.children.length===1||(p.cols.children.length===2&&p.cols.firstChild.classList.contains('sec-head'));
        if(!alone){p.cols.removeChild(it);settle(p.cols);p=newPage(sec,{cont:true});pagesHere.push(p);p.cols.appendChild(it);}
        if(over(p.cols)){it.classList.add('cut');p.pg.classList.add('has-cut');p.pg.dataset.cut='“'+(it.dataset.title||'A piece')+'” is too long for one page: shorten it or split it.';report.cut.push(it.dataset.id);}
      }
      report.items[it.dataset.id]=pageNo;
    });
    pagesHere.forEach(function(x){settle(x.cols);});
    var lastP=pagesHere[pagesHere.length-1];var n=parseInt(lastP.cols.style.columnCount,10)||M.columns;
    var used=Math.round((pagesHere.length-1+lastFill(lastP.cols,n))*10)/10;if(used<0.1&&items.length)used=0.1;
    var overflow=[];
    pagesHere.forEach(function(x,k){
      var past=k>=Math.ceil(budget-0.001)||(k===pagesHere.length-1&&used>budget+0.05&&k>=Math.floor(budget));
      if(past){x.pg.classList.add('over');x.pg.dataset.over='Over '+sec.dataset.name+'’s '+budget+'-page budget: these pieces don’t fit.';Array.prototype.forEach.call(x.cols.querySelectorAll('.it'),function(i){overflow.push(i.dataset.id);});}
    });
    report.sections.push({name:sec.dataset.name,budget:budget,used:used,pages:pagesHere.length,first:first,over:used>budget+0.05,overflow:overflow});
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-inside]'),function(e){var s=report.sections.filter(function(x){return x.name===e.dataset.inside;})[0];if(s)e.textContent=s.first;});
  report.pages=pageNo;
  if(studio){
    document.addEventListener('click',function(ev){var it=ev.target.closest&&ev.target.closest('.it');if(it&&parent!==window)parent.postMessage({nvEditionPick:it.dataset.id},'*');});
    window.addEventListener('message',function(ev){var d=ev.data||{};if(d.nvEditionShow!==undefined){Array.prototype.forEach.call(document.querySelectorAll('.it.picked'),function(x){x.classList.remove('picked');});var t=null;Array.prototype.forEach.call(document.querySelectorAll('.it'),function(x){if(x.dataset.id===d.nvEditionShow)t=x;});if(t){t.classList.add('picked');var r=t.getBoundingClientRect();if(parent!==window)parent.postMessage({nvEditionAt:r.top+window.scrollY},'*');}}});
    if(M.picked)Array.prototype.forEach.call(document.querySelectorAll('.it'),function(x){if(x.dataset.id===M.picked)x.classList.add('picked');});
  }
  window.__report=report;document.title='laid out';
  if(parent!==window)parent.postMessage({nvEdition:report,height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth},'*');
});
})();
`;

/** The edition's whole document (pages laid out by its own script when it opens). */
export function editionDocument(d: DocInput): string {
  const t = d.template;
  const s = d.pub.style;
  const masthead = d.pub.masthead || d.pub.title;
  const dateline = d.date ? longDate(d.date) : 'Not dated yet';
  const label = d.number ? `No. ${d.number}${d.preview ? ' · Preview' : ''}` : 'Draft';
  const hasMast = !!s.mastheadFont;
  const vars = [
    `--ink:${s.ink || '#1a1a1a'}`,
    `--body:${s.bodyFont ? "'Pub Body'," : ''}'NV Serif',Georgia,'Times New Roman',serif`,
    `--head:${s.headFont ? "'Pub Head'," : s.bodyFont ? "'Pub Body'," : ''}'NV Serif',Georgia,serif`,
    `--mast:${hasMast ? "'Pub Masthead'," : ''}'NV Serif',Georgia,serif`,
    `--mast-weight:${hasMast ? '400' : '800'}`,
    `--mast-track:${hasMast ? '0' : '-.02em'}`,
    `--sans:'NV Sans','Helvetica Neue',Arial,sans-serif`,
    `--size:${t.size}pt`,
    `--lead:${t.leading}`,
    `--leadsize:${t.lead}pt`,
    `--cols:${t.columns}`,
    `--gutter:${t.gutter}mm`,
    `--margin:${t.margin}mm`,
    `--align:${s.justify ? 'justify' : 'left'}`,
  ].join(';');
  // The masthead: the crest beside the title, the ears (the edition, and the weather's first line when there is one).
  const crest = s.crest ? d.url(s.crest) : '';
  const weather = d.sections.flatMap((x) => x.items).find((i) => i.kind === 'weather');
  const wRow = weather ? /^\s*\|(?!\s*-)([^|\n]+)\|([^|\n]+)\|?/m.exec(weather.body.split(/\r?\n/).filter((l) => TABLE_ROW_RE.test(l))[2] ?? '') : null;
  const earR = wRow ? `<div class="ear">${esc(wRow[1]!.trim())}<b>${esc(wRow[2]!.trim())}</b></div>` : `<div class="ear">${esc(d.date ? longDate(d.date).split(' ')[0] : 'Edition')}<b>${esc(d.number ? `No. ${d.number}` : '—')}</b></div>`;
  // A day that cannot be read shows a dash, never throws (9.5: the dateline split assumed four parts).
  const dayBits = d.date ? longDate(d.date).split(' ') : [];
  const earL = `<div class="ear">${esc(label.replace(/ · Preview$/, ''))}<b>${esc(dayBits.length === 4 ? `${dayBits[1]} ${dayBits[2]!.slice(0, 3)}` : '—')}</b></div>`;
  const inside = d.sections.length > 1 ? `<div class="mast-inside"><b>Inside</b>${d.sections.slice(1).map((x) => `<span>${esc(x.name)} <em data-inside="${esc(x.name)}">·</em></span>`).join('')}</div>` : '';
  const mastHtml = `<header id="mast-src"><div class="mast-top">${earL}${crest ? `<img class="mast-crest" src="${esc(crest)}" alt="">` : ''}<div class="mast-title">${esc(masthead)}</div>${earR}</div>${d.pub.motto ? `<div class="mast-motto">${esc(d.pub.motto)}</div>` : ''}<div class="mast-line"><span>${esc(label)}</span><span>${esc(dateline)}</span><span>${esc(d.pub.title === masthead ? 'Family edition' : d.pub.title)}</span></div>${inside}</header>`;
  // The sections and their pieces, in order (the last edition's answers at the end of the last section with puzzles).
  const lastPuzzles = d.sections.map((x, i) => (x.items.some((it) => kindInfo(it.kind)?.puzzle) ? i : -1)).filter((i) => i >= 0).pop() ?? d.sections.length - 1;
  const secs = d.sections
    .map((x, i) => `<section class="sec" data-name="${esc(x.name)}" data-pages="${x.pages}">${x.items.map((it) => itemHtml(it, d)).join('')}${d.answers?.blocks.length && i === lastPuzzles ? answersHtml(d.answers) : ''}</section>`)
    .join('');
  const meta = { columns: t.columns, frontColumns: t.frontColumns, dateline: esc(dateline), mastheadHtml: esc(masthead), footLeft: esc(`${masthead} · ${label}`), footRight: esc(dateline), picked: d.picked ?? '' };
  return `<!doctype html><html lang="en" class="${d.mode}"><head><meta charset="utf-8"><title>${esc(`${masthead} ${label}`)}</title><style>${fontFaces(d)}\n:root{${vars}}${CSS}${s.greyscale ? '.fig img,.strip img,.mast-crest{filter:grayscale(1) contrast(1.04)}' : ''}</style></head><body><div id="pages"></div><div id="flow">${mastHtml}${secs}</div><script type="application/json" id="nv-meta">${JSON.stringify(meta).replace(/</g, '\\u003c')}</script><script>${LAYOUT_JS}</script></body></html>`;
}

/** Where a publication keeps a layout of its own (made from an example the person gave, or written by hand). */
export const LAYOUT_FILE = 'Layout/edition.html';
/** A spot in a layout: <!--nv:section:News-->. */
const MARK = /<!--\s*nv:([a-z]+)(?::([^>]*?))?\s*-->/gi;

/**
 * An edition poured into the publication's own layout (26 Oct 2026): an HTML page with its CSS, made once from the
 * person's example, whose marked spots take this edition's words, marked as HTML comments: <!--nv:masthead-->
 * <!--nv:title--> <!--nv:motto--> <!--nv:number--> ("No. 3") <!--nv:edition--> <!--nv:date--> ("Monday 26 October 2026"),
 * <!--nv:lead--> (the lead story), <!--nv:kind:weather--> (every piece of a kind), <!--nv:section:News--> (the section's
 * other pieces in order) and <!--nv:answers--> (the last edition's answers). (Not {{…}}: The former host app's
 * instructions read double braces as their own variables.) Its own files (fonts, crest) sit beside it: `base` is its
 * folder's address. Each piece is drawn as on the built-in pages (div.it.it-story with h2.hd, p.deck, div.tx, div.src;
 * div.it-brief; div.it-weather with a table; the puzzles' grids), for the layout's CSS to style.
 */
export function layoutDocument(layout: string, d: DocInput, base: string): string {
  const masthead = d.pub.masthead || d.pub.title;
  const label = d.number ? `No. ${d.number}${d.preview ? ' · Preview' : ''}` : 'Draft';
  const all = d.sections.flatMap((x) => x.items);
  const used = new Set<string>();
  const draw = (list: Item[]) => list.filter((it) => !used.has(it.path)).map((it) => (used.add(it.path), itemHtml(it, d))).join('');
  const words: Record<string, string> = { masthead: esc(masthead), title: esc(d.pub.title), motto: esc(d.pub.motto ?? ''), number: esc(label.replace(/ · Preview$/, '')), edition: esc(label), date: esc(d.date ? longDate(d.date) : '') };
  // The pieces placed by kind and the lead first, so a section never repeats them.
  const marks = [...layout.matchAll(MARK)].map((m) => ({ key: m[1]!.toLowerCase(), arg: (m[2] ?? '').trim() }));
  const filled = new Map<string, string>();
  if (marks.some((x) => x.key === 'lead')) filled.set('lead:', draw(all.filter((it) => it.lead).slice(0, 1)));
  for (const m of marks.filter((x) => x.key === 'kind')) filled.set(`kind:${m.arg.toLowerCase()}`, draw(all.filter((it) => it.kind === m.arg.toLowerCase())));
  for (const m of marks.filter((x) => x.key === 'section')) {
    const sec = d.sections.find((x) => x.name.toLowerCase() === m.arg.toLowerCase());
    filled.set(`section:${m.arg.toLowerCase()}`, sec ? draw(sec.items) : '');
  }
  const answers = d.answers?.blocks.length ? answersHtml(d.answers) : '';
  let html = layout.replace(MARK, (_, k: string, a = '') => {
    const key = k.toLowerCase(), arg = String(a).trim();
    if (key === 'answers') return answers;
    if (key in words) return words[key]!;
    return filled.get(`${key}:${arg.toLowerCase()}`) ?? '';
  });
  const head = `<base href="${esc(base)}">`;
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => h + head) : head + html;
  // Printed as soon as its type and pictures are in. Its pages are its .page blocks (data-section names the section each
  // belongs to): how full each is, and which run over, as the built-in pages say it (Chief's fit loop: "Sport runs 0.3 of
  // a page over its 2", so the run cuts a brief or adds one back). With no .page blocks, its height in A4 pages.
  const report = `<script>(function(){function done(){var ps=[].slice.call(document.querySelectorAll('.page'));if(!ps.length){window.__report={pages:Math.max(1,Math.round(document.documentElement.scrollHeight/1122.5)),sections:[],items:{},cut:[]};return}var secs={},order=[];ps.forEach(function(p,i){var name=p.getAttribute('data-section')||('Page '+(i+1));if(!secs[name]){secs[name]={name:name,budget:0,used:0,pages:0,first:i+1,over:false,overflow:[]};order.push(name)}var s=secs[name],top=p.getBoundingClientRect().top,h=p.clientHeight||1,low=0;s.budget++;s.pages++;[].forEach.call(p.querySelectorAll('h1,h2,h3,h4,p,li,td,img,figure,table'),function(e){var r=e.getBoundingClientRect();if(r.height)low=Math.max(low,r.bottom-top)});var over=p.scrollHeight>h+2;s.used+=over?p.scrollHeight/h:Math.min(1,low/h);if(over)s.over=true});window.__report={pages:ps.length,sections:order.map(function(n){var s=secs[n];s.used=Math.round(s.used*10)/10;return s}),items:{},cut:[]}}var imgs=[].slice.call(document.images).map(function(i){return i.complete?0:new Promise(function(r){i.onload=i.onerror=r})});Promise.all([document.fonts?document.fonts.ready:0].concat(imgs)).then(done,done)})();</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${report}</body>`) : html + report;
}

/** How a section filled, as the page's script says (and the studio shows). */
export interface LaidOut {
  pages: number;
  sections: { name: string; budget: number; used: number; pages: number; first: number; over: boolean; overflow: string[] }[];
  items: Record<string, number>;
  cut: string[];
}

/** A layout in words ("9 pages. News fills 1.8 of its 2; Sport runs 0.4 of a page over its 1: “Storm win” doesn’t fit."). */
export function laidOutWords(r: LaidOut, titleOf: (id: string) => string = (x) => x): string {
  const parts = r.sections.map((s) => (s.over ? `${s.name} runs ${Math.round((s.used - s.budget) * 10) / 10} of a page over its ${s.budget}${s.overflow.length ? ` (${s.overflow.slice(0, 3).map((x) => `“${titleOf(x)}”`).join(', ')}${s.overflow.length > 3 ? ` and ${s.overflow.length - 3} more` : ''} past it)` : ''}` : `${s.name} fills ${s.used} of its ${s.budget}`));
  const cut = r.cut.length ? ` Too long for one page: ${r.cut.map((x) => `“${titleOf(x)}”`).join(', ')}.` : '';
  return `${r.pages} ${r.pages === 1 ? 'page' : 'pages'}. ${parts.join('; ')}.${cut}`;
}

export { solveTimeWords };
