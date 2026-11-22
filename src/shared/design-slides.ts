// SPDX-License-Identifier: AGPL-3.0-or-later
// Designed slides read back for PowerPoint (22 Nov 2026, Design studio phase 2). A deck the Design studio laid out is
// already finished in the print window: every band, panel, chart and number sits where it should. So a PowerPoint
// deck is made from that, in two layers per slide: everything that isn't words (bands, panels, rules, charts, the
// numbered circles drawn by CSS) printed as one sharp picture behind, and every run of words laid on top as a real,
// editable PowerPoint text box where the design put it, in its own size, weight and colour.
//
// SLIDE_READ_JS runs in the laid-out page (it is evaluated there by the print window, after the page's own script has
// placed, fitted and measured everything). It returns each page's text boxes and then hides the words, so the next
// picture of each page is the background alone. Pseudo-elements (list markers, CSS counters) keep their colour: they
// stay in the picture, since PowerPoint has no way to hold them.

export interface SlideRun {
  t: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  /** Hex colour without #. */
  c: string;
  /** Size in CSS pixels. */
  s: number;
  f: string;
  /** A line break before this run. */
  br?: boolean;
  /** Set in capitals by the design's CSS: the words stay as written, and PowerPoint shows them in capitals. */
  up?: boolean;
}

export interface SlideText {
  /** The words' box in CSS pixels, relative to the page's top left. */
  x: number;
  y: number;
  w: number;
  h: number;
  align: 'left' | 'center' | 'right' | 'justify';
  /** Line height in CSS pixels. */
  lh: number;
  /** Letter spacing in CSS pixels. */
  ls: number;
  /** A list item whose marker the page drew (a marker can't keep its colour when the item's words are hidden, so it
   *  becomes PowerPoint's own bullet or number): its kind, its number, and the room the marker takes (CSS pixels). */
  list?: { kind: 'bullet' | 'number'; n: number; indent: number };
  runs: SlideRun[];
}

export interface SlidePage {
  /** The page's box in the window (CSS pixels), for its picture. */
  x: number;
  y: number;
  w: number;
  h: number;
  texts: SlideText[];
}

export const SLIDE_READ_JS = `(() => {
  const pages = [...document.querySelectorAll('#doc > section.page')];
  const hex = (c) => { const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(c || ''); if (!m) return '000000'; return [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join(''); };
  const fam = (f) => (f || '').split(',')[0].replace(/["']/g, '').trim() || 'Arial';
  const inline = (el) => { const d = getComputedStyle(el).display; return d === 'inline' || d === 'contents'; };
  const hidden = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true; } return false; };
  const out = [];
  const marked = [];
  for (const sec of pages) {
    const pr = sec.getBoundingClientRect();
    const boxes = new Set();
    const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      let el = n.parentElement;
      if (!el || el.closest('svg') || hidden(el)) continue;
      while (el !== sec && inline(el) && el.parentElement) el = el.parentElement;
      boxes.add(el);
    }
    const texts = [];
    for (const box of boxes) {
      const runs = [];
      let pendingBreak = false;
      const visit = (node) => {
        for (const kid of node.childNodes) {
          if (kid.nodeType === 3) {
            const raw = kid.nodeValue.replace(/\\s+/g, ' ');
            if (!raw.trim() && !runs.length) continue;
            const st = getComputedStyle(kid.parentElement);
            const run = { t: raw, c: hex(st.color), s: parseFloat(st.fontSize) || 16, f: fam(st.fontFamily) };
            if (st.textTransform === 'uppercase') run.up = true;
            if ((parseInt(st.fontWeight, 10) || 400) >= 600) run.b = true;
            if (st.fontStyle === 'italic') run.i = true;
            if ((st.textDecorationLine || '').includes('underline')) run.u = true;
            if (pendingBreak) { run.br = true; pendingBreak = false; }
            runs.push(run);
          } else if (kid.nodeType === 1) {
            const e = kid;
            if (e.localName === 'br') { pendingBreak = true; continue; }
            if (e.localName === 'svg' || boxes.has(e) || hidden(e)) continue;
            if (!inline(e)) { if (runs.length) pendingBreak = true; visit(e); if (runs.length) pendingBreak = true; continue; }
            visit(e);
          }
        }
      };
      visit(box);
      if (!runs.length) continue;
      runs[0].t = runs[0].t.replace(/^\\s+/, '');
      runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\\s+$/, '');
      const kept = runs.filter((r) => r.t.length || r.br);
      if (!kept.some((r) => r.t.trim())) continue;
      // The words' own bounds (not the box's padding): every line the box's text draws.
      const range = document.createRange();
      range.selectNodeContents(box);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const cs = getComputedStyle(box);
      const br = box.getBoundingClientRect();
      // The box's content width, or wider where the words paint past it (a figure set nowrap in a squeezed column):
      // PowerPoint wraps at its box's edge, so the box has to hold what the page drew.
      const left = Math.min(br.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), ...rects.map((r) => r.left));
      const right = Math.max(br.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth), ...rects.map((r) => r.right));
      const lhRaw = parseFloat(cs.lineHeight);
      const lh = Number.isFinite(lhRaw) ? lhRaw : (parseFloat(cs.fontSize) || 16) * 1.2;
      const align = /center/.test(cs.textAlign) ? 'center' : /right|end/.test(cs.textAlign) ? 'right' : cs.textAlign === 'justify' ? 'justify' : 'left';
      const item = { x: left - pr.left, y: top - pr.top, w: Math.max(4, right - left), h: Math.max(4, bottom - top), align, lh, ls: parseFloat(cs.letterSpacing) || 0, runs: kept };
      if (cs.display === 'list-item' && cs.listStyleType && cs.listStyleType !== 'none') {
        const numbered = /decimal|alpha|roman|greek|latin/.test(cs.listStyleType);
        const n = numbered ? [...box.parentElement.children].filter((c) => getComputedStyle(c).display === 'list-item').indexOf(box) + (Number(box.parentElement.getAttribute('start')) || 1) : 0;
        item.list = { kind: numbered ? 'number' : 'bullet', n, indent: (parseFloat(cs.fontSize) || 16) * 1.3 };
      }
      texts.push(item);
      box.classList.add('nv-x-words');
      marked.push(box);
    }
    out.push({ x: pr.left + scrollX, y: pr.top + scrollY, w: pr.width, h: pr.height, texts });
  }
  const st = document.createElement('style');
  st.textContent = '.nv-x-words{-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent}.nv-x-words *{-webkit-text-fill-color:transparent!important;text-shadow:none!important}.nv-x-words svg,.nv-x-words svg *{-webkit-text-fill-color:initial!important}.nv-x-words::before,.nv-x-words::after,.nv-x-words *::before,.nv-x-words *::after,.nv-x-words::marker,.nv-x-words *::marker{-webkit-text-fill-color:currentColor!important}';
  document.head.appendChild(st);
  return out;
})()`;
