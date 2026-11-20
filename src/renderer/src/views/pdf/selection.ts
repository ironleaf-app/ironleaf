// Words selected in the PDF reader, page by page: what they say and the boxes over them in the PDF's own units (19 Oct
// 2026, 5.0.0 PDF reader). Each run of text PDF.js laid out is measured on its own, so the boxes cover the letters and
// nothing else (a range's own boxes also include whole elements and the layer's padding). A selection across two pages
// gives one part per page, so each page's highlight sits on that page.

import type { PdfRect } from '../../../../shared/pdf-highlights';
import { boxToPdf, mergeLineBoxes, type Box } from './geometry';
import type { PageHandle } from './PdfPage';

export interface SelectedPart {
  index: number;
  text: string;
  rects: PdfRect[];
  /** The last box on the screen (the bar sits beside it). */
  screen: DOMRect | null;
  /** The top of the first line on the screen. */
  top: number | null;
}

const round = (n: number) => Math.round(n * 10) / 10;

export function selectedParts(range: Range, pages: Map<number, PageHandle>): SelectedPart[] {
  const out: SelectedPart[] = [];
  const indexes = [...pages.keys()].sort((a, b) => a - b);
  for (const index of indexes) {
    const page = pages.get(index)!;
    if (!range.intersectsNode(page.text)) continue;
    const origin = page.el.getBoundingClientRect();
    const boxes: Box[] = [];
    let text = '';
    let last: DOMRect | null = null;
    let top: number | null = null;
    for (const span of Array.from(page.text.querySelectorAll<HTMLElement>('span:not(.markedContent)'))) {
      const node = span.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE || !range.intersectsNode(node)) continue;
      const part = document.createRange();
      part.selectNodeContents(node);
      if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
      const words = part.toString();
      if (!words) continue;
      text += words;
      // A run ending its line (PDF.js puts a line break after it) is followed by a space in the words.
      if (span.nextSibling?.nodeName === 'BR' && !/\s$/.test(words)) text += ' ';
      for (const r of Array.from(part.getClientRects())) {
        boxes.push({ left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top });
        last = r;
        top = top === null ? r.top : Math.min(top, r.top);
      }
    }
    const merged = mergeLineBoxes(boxes);
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!merged.length || !clean) continue;
    out.push({ index, text: clean, rects: merged.map((b) => boxToPdf(page.matrix, b).map(round) as PdfRect), screen: last, top });
  }
  return out;
}
