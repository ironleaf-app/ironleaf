// SPDX-License-Identifier: AGPL-3.0-or-later
// A designed deck as a PowerPoint file (22 Nov 2026, Design studio phase 2). Each slide is the designed page in two
// layers (src/shared/design-slides.ts): its picture without the words, then every run of words as a real text box on
// top, where the design put it. So the deck looks like the design, and every word is still the person's to edit in
// PowerPoint, Keynote or Google Slides.
//
// Sizes: the page is laid out in CSS pixels (96 to the inch); PowerPoint measures in inches and type in points.

import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import type { SlidePage, SlideText } from '../../shared/design-slides';

export interface DeckSlide {
  page: SlidePage;
  /** The page's picture without its words (PNG). */
  background: Buffer;
}

const IN = (px: number) => px / 96;
const PT = (px: number) => Math.round(px * 0.75 * 10) / 10;

/** A box a touch wider than the browser's: PowerPoint's type measures a little differently, and an unplanned wrap
 *  is worse than a little more room. Centred and right-aligned words grow on the side that keeps them in place. */
function widen(t: SlideText, pageW: number): { x: number; w: number } {
  const extra = Math.max(4, t.w * 0.06);
  const grow = (x: number, w: number) => ({ x: Math.max(0, x), w: Math.min(w, pageW - Math.max(0, x)) });
  if (t.align === 'center') return grow(t.x - extra / 2, t.w + extra);
  if (t.align === 'right') return grow(t.x - extra, t.w + extra);
  return grow(t.x, t.w + extra);
}

export async function designPptx(o: { slides: DeckSlide[]; title: string; author?: string }): Promise<Buffer> {
  if (!o.slides.length) throw new Error('There are no slides to save.');
  const first = o.slides[0].page;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'IRONLEAF', width: IN(first.w), height: IN(first.h) });
  pptx.layout = 'IRONLEAF';
  pptx.title = o.title;
  if (o.author) {
    pptx.author = o.author;
    pptx.company = o.author;
  }
  for (const s of o.slides) {
    const slide = pptx.addSlide();
    slide.addImage({ data: `data:image/png;base64,${s.background.toString('base64')}`, x: 0, y: 0, w: IN(s.page.w), h: IN(s.page.h) });
    for (const t of s.page.texts) {
      const box = widen(t, s.page.w);
      // A list item's box starts at its words; its bullet sits in the margin the page gave the marker.
      const x = t.list ? Math.max(0, box.x - t.list.indent) : box.x;
      const w = t.list ? box.w + (box.x - x) : box.w;
      const runs = t.runs.map((r, i) => ({
        text: r.t,
        options: {
          fontFace: r.f,
          fontSize: PT(r.s),
          color: r.c,
          bold: !!r.b,
          italic: !!r.i,
          ...(r.u ? { underline: { style: 'sng' as const } } : {}),
          ...(r.br && i > 0 ? { breakLine: false } : {}),
          ...(t.ls ? { charSpacing: PT(t.ls) } : {}),
          // Marked by its language tag, then given PowerPoint's own all-caps setting below (pptxgenjs has none).
          ...(r.up ? { lang: CAPS_LANG } : {}),
        },
      }));
      // A line break before a run: PowerPoint takes it as a break after the run before it.
      for (let i = 1; i < t.runs.length; i++) if (t.runs[i].br) (runs[i - 1].options as Record<string, unknown>).breakLine = true;
      if (t.list && runs.length) (runs[0].options as Record<string, unknown>).bullet = t.list.kind === 'number' ? { type: 'number', numberStartAt: Math.max(1, t.list.n), indent: PT(t.list.indent) } : { indent: PT(t.list.indent) };
      slide.addText(runs, {
        x: IN(x),
        y: IN(t.y),
        w: IN(w),
        h: IN(t.h + Math.max(2, t.lh * 0.15)),
        margin: 0,
        valign: 'top',
        align: t.align,
        lineSpacing: PT(t.lh),
        fit: 'none',
        wrap: true,
        paraSpaceBefore: 0,
        paraSpaceAfter: 0,
      });
    }
  }
  const out = Buffer.from((await pptx.write({ outputType: 'nodebuffer' })) as Buffer);
  return allCaps(out);
}

/** The private language tag a capitals run is written with, until allCaps turns it into PowerPoint's caps setting. */
const CAPS_LANG = 'en-x-caps';

/** Runs the design set in capitals get PowerPoint's All caps (cap="all"), their words as written. */
async function allCaps(file: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(file);
  let changed = false;
  for (const name of Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) {
    const xml = await zip.file(name)!.async('string');
    if (!xml.includes(CAPS_LANG)) continue;
    zip.file(name, xml.split(`lang="${CAPS_LANG}"`).join('lang="en-US" cap="all"'));
    changed = true;
  }
  if (!changed) return file;
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
