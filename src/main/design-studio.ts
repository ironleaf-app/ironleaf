// SPDX-License-Identifier: AGPL-3.0-or-later
// The Design studio on the main side (22 Nov 2026, phase 1): a note designed into a finished PDF by the person's own AI.
// The AI lays the pages out (src/shared/design-doc.ts says how); this side prints them in the sealed window nobody sees
// (src/main/brand-print.ts), measures them, and — for a model that sees pictures — shows it the printed pages, so it
// fixes what overflows, what is empty and what looks wrong before the person sees anything. Then the person looks,
// asks for changes in words, and saves the PDF.
//
// Designs live here while Ironleaf is open (the last few), never on disk: a design is kept by saving its PDF.

import { randomBytes } from 'node:crypto';
import type { BrandKit } from '../shared/assets';
import type { BrandContent } from '../shared/brand-document';
import { blocksShown, designAsk, designJudgeOnly, designRewrite, readScores, designChange, designPage, designSystem, designTheme, officeTheme, kindInfo, readDesign, DESIGN_FORMATS, type DesignFormat, type DesignKind, type DesignKindInfo, type DesignReport, type DesignTheme, type DesignViewOut } from '../shared/design-doc';
import { designDocx } from './design-export/docx';
import { designPptx } from './design-export/pptx';
import { designXlsx, hasSheetContent } from './design-export/xlsx';
import type { BrandPrinter } from './brand-print';
import type { ChatMessageIn, StreamResult } from './providers/types';

export interface DesignStudioDeps {
  /** One turn on the chat's model, no tools. */
  ask(system: string, messages: ChatMessageIn[], o: { signal: AbortSignal; maxTokens: number }): Promise<StreamResult>;
  /** Whether the chat's model sees pictures (then it is shown the printed pages). */
  seesPictures(): boolean;
  /** Score the finished pages on Astryx's five axes (one more turn with the pages shown; trials and tests). */
  judge?: boolean;
  printer: Pick<BrandPrinter, 'pdf' | 'look' | 'slides'>;
  /** The app's own type (Inter, Source Serif) by file address. */
  fonts(): Promise<{ sans?: string; sansItalic?: string; serif?: string }>;
  log?(m: string): void;
}

export interface DesignStart {
  kind: DesignKind;
  brief: string;
  title: string;
  content: BrandContent;
  kit: BrandKit | null;
  logos: { primary?: string; onDark?: string };
  brandName: string;
}

export type DesignView = DesignViewOut;

interface Design {
  id: string;
  input: DesignStart;
  kind: DesignKindInfo;
  theme: DesignTheme;
  system: string;
  ask: string;
  layout: string;
  report: DesignReport | null;
  shots: Buffer[];
  rounds: number;
  score?: DesignViewOut['score'];
}

/** Steps said while it works, for the dialog. */
export type DesignStep = (words: string) => void;

const MAX_TOKENS = 16_000;
/** A page this much too full (per cent) is set smaller rather than redesigned. */
const FIT_FREE = 12;
const TURN_MS = 300_000;
/** Pages shown to the AI each look (pictures cost), and pages shown to the person. */
const MAX_AI_SHOTS = 4;
const MAX_VIEW_SHOTS = 12;
/** How many designs are kept while Ironleaf is open. */
const KEEP = 4;
const PX = 96 / 25.4;

export class DesignStudio {
  private designs = new Map<string, Design>();
  constructor(private deps: DesignStudioDeps) {}

  private remember(d: Design): void {
    this.designs.delete(d.id);
    this.designs.set(d.id, d);
    while (this.designs.size > KEEP) this.designs.delete(this.designs.keys().next().value as string);
  }

  private get(id: unknown): Design {
    const d = typeof id === 'string' ? this.designs.get(id) : undefined;
    if (!d) throw new Error('That design is no longer open. Design it again.');
    return d;
  }

  private async turn(d: Design, messages: ChatMessageIn[], signal: AbortSignal, maxTokens = MAX_TOKENS): Promise<string> {
    const result = await this.deps.ask(d.system, messages, { signal: AbortSignal.any([signal, AbortSignal.timeout(TURN_MS)]), maxTokens });
    if (signal.aborted) throw new Error('Stopped.');
    if (result.error) throw new Error(result.error);
    if (result.stopReason === 'length' && !result.text.includes('</section>')) throw new Error('The AI’s design was cut off before it finished. Try a shorter kind (a one-pager), or a model that writes longer answers.');
    return result.text;
  }

  private async page(d: Design, layout: string, fit = false, theme: DesignTheme = d.theme): Promise<string> {
    return designPage({ fit, kind: d.kind, theme, title: d.input.content.title, layout, blocks: d.input.content.blocks, logos: d.input.logos, brandName: d.input.brandName, foot: d.input.content.foot, fonts: await this.deps.fonts(), keepAll: d.kind.words === 'keep', asked: blocksShown(d.input.content), nonce: randomBytes(12).toString('base64url') });
  }

  private async look(d: Design, fit = false): Promise<void> {
    const { w, h } = d.kind.page;
    const { report, shots } = await this.deps.printer.look(await this.page(d, d.layout, fit), { width: w * PX + 40, height: h * PX + 4, max: MAX_VIEW_SHOTS });
    d.report = report as unknown as DesignReport;
    d.shots = shots;
  }

  private needsFixing(d: Design): boolean {
    const r = d.report;
    if (!r) return true;
    // Words set in ink or white by the page already read, so they alone never cost a round; nor does a page a little too
    // full, which the last look fits by setting it a touch smaller.
    return r.problems.some((p) => p.kind !== 'small' && p.kind !== 'contrast' && !(p.kind === 'over' && p.shrink !== undefined && p.shrink <= FIT_FREE)) || (!!d.kind.pages && r.pages !== d.kind.pages);
  }

  /** The judge alone: the printed pages shown, the five scores back (a line of words, not a document). */
  private async judge(d: Design, signal: AbortSignal): Promise<DesignViewOut['score'] | null> {
    const shots = d.shots.slice(0, MAX_AI_SHOTS).map((b, i) => ({ mediaType: 'image/jpeg', data: b.toString('base64'), name: `page-${i + 1}.jpg` }));
    if (!shots.length) return null;
    try {
      const reply = await this.turn(d, [{ role: 'user', text: d.ask }, { role: 'assistant', text: d.layout }, { role: 'user', text: designJudgeOnly(d.report!, d.kind), images: shots }], signal, 2000);
      const scores = readScores(reply);
      if (scores) this.deps.log?.(`design ${d.kind.id}: judged ${JSON.stringify(scores)}`);
      return scores;
    } catch (err) {
      if (signal.aborted) throw err;
      return null;
    }
  }

  /**
   * Right first time (22 Nov 2026: a premium version on the first pass every time, not three times the tokens). Measured on
   * Sonnet 5.5 over twelve designs: the first draft scored 66-80 on Astryx's five axes, and two more whole drafts written
   * against the judge's notes moved that by 0-4 points for three times the tokens. So taste is spent on the first draft
   * (a reference design, a page plan, a spacing system and a check list), and a further turn goes only on what the page
   * measured as broken (words cut off, boxes on top of each other, a squeezed column, a block left out): at most
   * `fixes` of them. Contrast and a page a little too full are put right without the AI.
   */
  private async settle(d: Design, fixes: number, step: DesignStep, signal: AbortSignal): Promise<void> {
    const pictures = this.deps.seesPictures();
    for (let round = 0; ; round++) {
      step(round ? 'Checking the pages again' : 'Printing and checking the pages');
      await this.look(d);
      this.deps.log?.(`design ${d.kind.id}: look ${round + 1}, ${d.report?.pages ?? 0} pages, ${d.report?.problems.length ?? 0} problems${d.report?.problems.length ? ` (${d.report.problems.slice(0, 4).map((p) => `${p.page}:${p.kind}`).join(', ')})` : ''}`);
      if (signal.aborted || !this.needsFixing(d) || round >= fixes) break;
      const n = d.report?.problems.filter((p) => p.kind !== 'small' && p.kind !== 'contrast').length ?? 0;
      step(`Fixing ${n || 'what is wrong'}${n ? (n === 1 ? ' thing' : ' things') : ''}`);
      const shown = pictures ? d.shots.slice(0, MAX_AI_SHOTS).map((b, i) => ({ mediaType: 'image/jpeg', data: b.toString('base64'), name: `page-${i + 1}.jpg` })) : [];
      // A fix that fails (cut off, the service busy) keeps the design as it stands: it printed, and it is shown.
      let reply: string;
      try {
        reply = await this.turn(d, [{ role: 'user', text: d.ask }, { role: 'assistant', text: d.layout }, { role: 'user', text: designRewrite(d.report!, { kind: d.kind, pictures: shown.length > 0, scores: null }), ...(shown.length ? { images: shown } : {}) }], signal);
      } catch (err) {
        if (signal.aborted) throw err;
        this.deps.log?.(`design ${d.kind.id}: a fix failed, keeping the design as it stands (${err instanceof Error ? err.message : String(err)})`);
        break;
      }
      const next = readDesign(reply);
      if (!next) break;
      d.layout = next;
      d.rounds++;
    }
    // The last look shows what will print: a page still too full is fitted.
    if (d.report?.problems.some((p) => p.kind === 'over')) await this.look(d, true);
    // A score, only when asked for (it costs a look-over turn and changes nothing).
    d.score = undefined;
    if (this.deps.judge && pictures && !signal.aborted) {
      step('Scoring the pages');
      d.score = (await this.judge(d, signal)) ?? undefined;
    }
  }

  private view(d: Design): DesignView {
    return {
      id: d.id,
      kind: d.kind.id,
      pages: d.report?.pages ?? 0,
      shots: d.shots.slice(0, MAX_VIEW_SHOTS).map((b) => `data:image/jpeg;base64,${b.toString('base64')}`),
      problems: (d.report?.problems ?? []).filter((p) => p.kind !== 'small' && p.kind !== 'contrast').map((p) => (p.page ? `Page ${p.page}: ${p.words}` : p.words)),
      rounds: d.rounds,
      ...(d.score ? { score: d.score } : {}),
      formats: this.formats(d),
    };
  }

  /** What this design saves as: PDF always; slides as PowerPoint, any other kind as Word; and Excel when the note has
   *  tables or key figures to work with. */
  private formats(d: Design): DesignFormat[] {
    const out: DesignFormat[] = ['pdf', d.kind.id === 'slides' ? 'pptx' : 'docx'];
    if (hasSheetContent(d.input.content)) out.push('xlsx');
    return out;
  }

  /** The kit's logo as a PNG for Word and Excel, drawn by the sealed print window (an SVG logo too), or null. */
  private async logoPng(d: Design): Promise<Buffer | null> {
    const url = d.input.logos.primary || d.input.logos.onDark;
    if (!url) return null;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}img{display:block;max-width:900px;max-height:300px}</style></head><body><img src="${url.replace(/"/g, '%22')}" onload="window.__report={pages:1,moved:0,split:0,cut:[],problems:[],unused:[],boxes:[{x:0,y:0,w:this.width,h:this.height}]}" onerror="window.__report={pages:0,moved:0,split:0,cut:[],problems:[],unused:[],boxes:[]}"></body></html>`;
    try {
      const { shots } = await this.deps.printer.look(html, { width: 940, height: 340, max: 1, png: true });
      return shots[0] ?? null;
    } catch {
      return null;
    }
  }

  /** The design as a file in one of its formats: its bytes and the kind's name (for the file's name). */
  async file(id: unknown, format: DesignFormat): Promise<{ data: Buffer; kind: DesignKindInfo }> {
    const d = this.get(id);
    if (!this.formats(d).includes(format)) throw new Error(`This design doesn't save as ${DESIGN_FORMATS[format].name}.`);
    if (format === 'pptx') return { data: (await this.pptx(id)).pptx, kind: d.kind };
    if (format === 'docx' || format === 'xlsx') {
      const input = { content: d.input.content, theme: d.theme, kindName: d.kind.name, brandName: d.input.brandName, logo: await this.logoPng(d) };
      if (format === 'docx') return { data: await designDocx(input), kind: d.kind };
      const xlsx = await designXlsx(input);
      if (!xlsx) throw new Error('This note has no tables or key figures to put in a spreadsheet.');
      return { data: xlsx, kind: d.kind };
    }
    return { data: (await this.pdf(id)).pdf, kind: d.kind };
  }

  /** A new design of a note. */
  async start(input: DesignStart, step: DesignStep, signal: AbortSignal): Promise<DesignView> {
    const kind = kindInfo(input.kind);
    if (!input.content.blocks.length && !input.content.title) throw new Error('There is nothing in this note to design.');
    const theme = designTheme(input.kit);
    const d: Design = {
      id: randomBytes(9).toString('base64url'),
      input: { ...input, kind: kind.id },
      kind,
      theme,
      system: designSystem(kind, theme, { logo: !!(input.logos.primary || input.logos.onDark), brandName: input.brandName }),
      ask: designAsk(kind, input.content, input.brief),
      layout: '',
      report: null,
      shots: [],
      rounds: 0,
    };
    step('Designing the pages');
    const text = await this.turn(d, [{ role: 'user', text: d.ask }], signal);
    const layout = readDesign(text);
    if (!layout) throw new Error('The AI didn’t answer with a design. Try again, or choose a stronger model in Settings › AI.');
    d.layout = layout;
    await this.settle(d, 1, step, signal);
    this.remember(d);
    return this.view(d);
  }

  /** The person's change, in words, to a design. */
  async change(id: unknown, words: unknown, step: DesignStep, signal: AbortSignal): Promise<DesignView> {
    const d = this.get(id);
    const said = typeof words === 'string' ? words.trim() : '';
    if (!said) return this.view(d);
    step('Making the change');
    const text = await this.turn(d, [{ role: 'user', text: d.ask }, { role: 'assistant', text: d.layout }, { role: 'user', text: designChange(said) }], signal);
    const layout = readDesign(text);
    if (!layout) throw new Error('The AI didn’t answer with a design. Try saying the change another way.');
    d.layout = layout;
    d.rounds = 0;
    d.score = undefined;
    await this.settle(d, 1, step, signal);
    this.remember(d);
    return this.view(d);
  }

  /** The design printed to a PDF: its bytes and pages, with the name it was made for. */
  async pdf(id: unknown): Promise<{ pdf: Buffer; pages: number; title: string; kind: DesignKindInfo }> {
    const d = this.get(id);
    const { pdf, laidOut } = await this.deps.printer.pdf(await this.page(d, d.layout, true));
    return { pdf, pages: laidOut.pages, title: d.input.content.title, kind: d.kind };
  }

  /** A designed deck as a PowerPoint file: each slide's picture without its words, the words on top as text boxes
   *  (src/main/design-export/pptx.ts). Slides only: a page document goes to Word instead. */
  async pptx(id: unknown): Promise<{ pptx: Buffer; slides: number; title: string }> {
    const d = this.get(id);
    if (d.kind.id !== 'slides') throw new Error('Only slides save as PowerPoint. Save this one as Word or PDF.');
    const [w, h] = [d.kind.page.w, d.kind.page.h];
    // Laid out in typefaces PowerPoint has, so the words wrap there as they do here.
    const read = await this.deps.printer.slides(await this.page(d, d.layout, true, officeTheme(d.theme)), { width: w * PX + 40, height: h * PX + 4 });
    if (!read.length) throw new Error('The slides could not be read back. Try again.');
    const pptx = await designPptx({ slides: read, title: d.input.content.title, author: d.input.brandName || undefined });
    return { pptx, slides: read.length, title: d.input.content.title };
  }
}
