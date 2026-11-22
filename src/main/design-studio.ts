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
import { blocksShown, designAsk, readScores, designChange, designFeedback, designPage, designSystem, designTheme, kindInfo, readDesign, saysFinished, type DesignKind, type DesignKindInfo, type DesignReport, type DesignTheme, type DesignViewOut } from '../shared/design-doc';
import type { BrandPrinter } from './brand-print';
import type { ChatImage, ChatMessageIn, StreamResult } from './providers/types';

export interface DesignStudioDeps {
  /** One turn on the chat's model, no tools. */
  ask(system: string, messages: ChatMessageIn[], o: { signal: AbortSignal; maxTokens: number }): Promise<StreamResult>;
  /** Whether the chat's model sees pictures (then it is shown the printed pages). */
  seesPictures(): boolean;
  printer: Pick<BrandPrinter, 'pdf' | 'look'>;
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

  private async turn(d: Design, messages: ChatMessageIn[], signal: AbortSignal): Promise<string> {
    const result = await this.deps.ask(d.system, messages, { signal: AbortSignal.any([signal, AbortSignal.timeout(TURN_MS)]), maxTokens: MAX_TOKENS });
    if (signal.aborted) throw new Error('Stopped.');
    if (result.error) throw new Error(result.error);
    if (result.stopReason === 'length' && !result.text.includes('</section>')) throw new Error('The AI’s design was cut off before it finished. Try a shorter kind (a one-pager), or a model that writes longer answers.');
    return result.text;
  }

  private async page(d: Design, layout: string, fit = false): Promise<string> {
    return designPage({ fit, kind: d.kind, theme: d.theme, title: d.input.content.title, layout, blocks: d.input.content.blocks, logos: d.input.logos, brandName: d.input.brandName, foot: d.input.content.foot, fonts: await this.deps.fonts(), keepAll: d.kind.words === 'keep', asked: blocksShown(d.input.content), nonce: randomBytes(12).toString('base64url') });
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
    // Words set in ink or white by the page already read, so they alone never cost a round.
    return r.problems.some((p) => p.kind !== 'small' && p.kind !== 'contrast') || (!!d.kind.pages && r.pages !== d.kind.pages);
  }

  /** Looks at the printed pages and has the AI fix them, `fixes` times at most. A model that sees pictures is shown the
   *  printed pages and judges them on Astryx's five axes each round, improving the weakest until every axis reaches
   *  the bar (JUDGE_BAR); its last judgement is kept for the person to see. */
  private async settle(d: Design, fixes: number, step: DesignStep, signal: AbortSignal): Promise<void> {
    const pictures = this.deps.seesPictures();
    const images = (): ChatImage[] => d.shots.slice(0, MAX_AI_SHOTS).map((b, i) => ({ mediaType: 'image/jpeg', data: b.toString('base64'), name: `page-${i + 1}.jpg` }));
    // The last look shows what will print: a page still too full is fitted.
    const fitLast = async () => {
      if (d.report?.problems.some((p) => p.kind === 'over')) await this.look(d, true);
    };
    let judged = false;
    for (let round = 0; ; round++) {
      step(round ? 'Checking the pages again' : 'Printing and checking the pages');
      await this.look(d);
      this.deps.log?.(`design ${d.kind.id}: look ${round + 1}, ${d.report?.pages ?? 0} pages, ${d.report?.problems.length ?? 0} problems${d.report?.problems.length ? ` (${d.report.problems.slice(0, 4).map((p) => `${p.page}:${p.kind}`).join(', ')})` : ''}`);
      const broken = this.needsFixing(d);
      judged = false;
      if (round >= fixes || signal.aborted) break;
      if (!broken && !pictures) break;
      const n = d.report?.problems.filter((p) => p.kind !== 'small' && p.kind !== 'contrast').length ?? 0;
      step(broken ? `Fixing ${n || 'what is wrong'}${n ? (n === 1 ? ' thing' : ' things') : ''}` : 'Judging it as a designer and raising the weakest part');
      const shown = pictures ? images() : [];
      const feedback = designFeedback(d.report!, { pictures: shown.length > 0, final: round + 1 >= fixes, kind: d.kind });
      // A fix that fails (cut off, the service busy) keeps the design as it stands: it printed, and it is shown.
      let reply: string;
      try {
        reply = await this.turn(d, [{ role: 'user', text: d.ask }, { role: 'assistant', text: d.layout }, { role: 'user', text: feedback, ...(shown.length ? { images: shown } : {}) }], signal);
      } catch (err) {
        if (signal.aborted) throw err;
        this.deps.log?.(`design ${d.kind.id}: a fix round failed, keeping the design as it stands (${err instanceof Error ? err.message : String(err)})`);
        break;
      }
      const scores = readScores(reply);
      if (scores) {
        d.score = scores;
        judged = true;
        this.deps.log?.(`design ${d.kind.id}: judged ${JSON.stringify(scores)}`);
      }
      if (saysFinished(reply)) break;
      const next = readDesign(reply);
      if (!next) break;
      d.layout = next;
      d.rounds++;
    }
    await fitLast();
    // The pages changed since the AI last judged them: one more look, judged only, so the score shown is this design's.
    if (pictures && !judged && d.rounds > 0 && !signal.aborted) {
      step('Scoring the finished pages');
      try {
        const reply = await this.turn(d, [{ role: 'user', text: d.ask }, { role: 'assistant', text: d.layout }, { role: 'user', text: `${designFeedback(d.report!, { pictures: true, final: true, kind: d.kind }).split('\nStart your reply')[0]}\nReply with the scores line only.`, images: images() }], signal);
        const scores = readScores(reply);
        if (scores) d.score = scores;
      } catch {
        // The design stands without a score.
      }
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
    };
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
    await this.settle(d, this.deps.seesPictures() ? 3 : 2, step, signal);
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
    await this.settle(d, this.deps.seesPictures() ? 2 : 1, step, signal);
    this.remember(d);
    return this.view(d);
  }

  /** The design printed to a PDF: its bytes and pages, with the name it was made for. */
  async pdf(id: unknown): Promise<{ pdf: Buffer; pages: number; title: string; kind: DesignKindInfo }> {
    const d = this.get(id);
    const { pdf, laidOut } = await this.deps.printer.pdf(await this.page(d, d.layout, true));
    return { pdf, pages: laidOut.pages, title: d.input.content.title, kind: d.kind };
  }
}
