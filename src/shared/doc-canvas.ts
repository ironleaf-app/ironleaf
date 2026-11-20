// A doc as a canvas (src/shared/doc-file.ts): the doc's card, and under it a card per `##` section (Changes aside), each
// showing the section's heading and first lines and opening the doc at that heading. An ordinary JSON Canvas board beside
// the doc (`canvas:` in the doc says where), in the same shape the former host app draws (its native-runtime
// doc-file.mjs):
//
//   board     neuralvault: { kind: 'doc', doc: 'Docs/<Name>.md' }
//   doc card  { type: 'file', file: <doc>, neuralvault: { part: 'doc', doc } }                       id boundId(doc, 'doc')
//   section   { type: 'file', file: <doc>, subpath: '#<Heading>', neuralvault: { part: 'section', doc, heading } }
//                                                                                   id boundId(doc, 'section', key)
//   line      { fromNode: <doc card>, toNode: <section>, neuralvault: { auto: 'section', key } } id boundId(doc, 'edge', key)
//
// "Update canvas from doc" brings the board in step IN PLACE: a new section gets a card in the first free place of the
// grid, a section taken out takes its card and line with it, and a section renamed keeps its card where the person put
// it (Ironleaf keeps a fingerprint of each section's words on its card, `nvSig`, to tell). The person's own cards,
// lines, colours and positions stay; a card they took off stays off; there is never a second canvas. Pure.

import { boundId, type CanvasBoard, type CanvasEdge, type CanvasNode } from './project-canvas';
import { parseDoc } from './doc-file';

export const DOC_CENTRE = { w: 420, h: 240 };
export const SECTION_CARD = { w: 320, h: 220 };
const GAP = 60;
const COLS = 3;

/** A section's heading as a key (the same in both apps). */
export const sectionKey = (h: string) =>
  String(h ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect, margin = 0) => a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;
const partOf = (n: CanvasNode) => (n.neuralvault as { part?: string } | undefined)?.part;
/** Whether a card is one the doc's canvas keeps in step (the doc's own card or a section's). */
export const isDocCard = (n: CanvasNode) => partOf(n) === 'doc' || partOf(n) === 'section';
const headingOf = (n: CanvasNode) => String((n.neuralvault as { heading?: string } | undefined)?.heading ?? String(n.subpath ?? '').replace(/^#/, ''));
const sigOf = (body: string) => boundId('sig', body.replace(/\s+/g, ' ').trim().slice(0, 600));
const isAuto = (e: CanvasEdge) => (e.neuralvault as { auto?: string } | undefined)?.auto === 'section';

/** The doc's card on a new board. */
const centreRect = (): Rect => ({ x: -DOC_CENTRE.w / 2, y: -DOC_CENTRE.h / 2, width: DOC_CENTRE.w, height: DOC_CENTRE.h });

/** The place of the `slot`th section card: a grid of three under the doc's card, in reading order. */
export function sectionSlot(centre: Rect, slot: number): Rect {
  const col = slot % COLS;
  const row = Math.floor(slot / COLS);
  const x = centre.x + centre.width / 2 - (COLS * SECTION_CARD.w + (COLS - 1) * GAP) / 2 + col * (SECTION_CARD.w + GAP);
  const y = centre.y + centre.height + GAP * 1.5 + row * (SECTION_CARD.h + GAP);
  return { x: Math.round(x), y: Math.round(y), width: SECTION_CARD.w, height: SECTION_CARD.h };
}

export interface DocSync {
  board: CanvasBoard;
  added: string[];
  removed: string[];
  renamed: [string, string][];
  changed: boolean;
}

/**
 * The board in step with the doc, in place: its card (pointing at the doc wherever it now is), a card and a line for each
 * section, a renamed section's card renamed where it is, removed sections' cards gone, new ones placed in free space.
 * Everything else on the board — the person's cards, lines, groups, colours and positions — is kept.
 */
export function syncDocCanvas(input: CanvasBoard, docPath: string, docText: string): DocSync {
  const doc = parseDoc(docText, docPath);
  const sections = doc.sections.filter((s) => sectionKey(s.heading));
  const nodes: CanvasNode[] = (input.nodes ?? []).map((n) => ({ ...n }));
  let edges: CanvasEdge[] = (input.edges ?? []).map((e) => ({ ...e }));
  const meta = input.neuralvault?.kind === 'doc' ? input.neuralvault : undefined;
  const hidden = new Set(meta?.hidden ?? []);
  const added: string[] = [];
  const removed: string[] = [];
  const renamed: [string, string][] = [];

  // The doc's own card.
  let centre = nodes.find((n) => partOf(n) === 'doc');
  if (!centre) {
    const want = centreRect();
    const spot = nodes.some((n) => overlaps(want, n, 20)) ? { x: Math.max(0, ...nodes.map((n) => n.x + n.width)) + 160, y: want.y } : want;
    centre = { id: boundId(docPath, 'doc'), type: 'file', file: docPath, x: spot.x, y: spot.y, width: DOC_CENTRE.w, height: DOC_CENTRE.h, neuralvault: { part: 'doc', doc: docPath } };
    nodes.unshift(centre);
  } else {
    Object.assign(centre, { type: 'file', file: docPath, neuralvault: { part: 'doc', doc: docPath } });
    delete centre.subpath;
  }

  // Section cards it keeps: the first card for each section (another of the same is the person's own copy).
  const kept = new Map<string, CanvasNode>();
  const orphans: CanvasNode[] = [];
  for (const n of nodes) {
    if (partOf(n) !== 'section') continue;
    const key = sectionKey(headingOf(n));
    if (kept.has(key)) continue;
    if (sections.some((s) => sectionKey(s.heading) === key)) kept.set(key, n);
    else orphans.push(n);
  }
  const fresh = sections.map((s, index) => ({ s, index })).filter(({ s }) => !kept.has(sectionKey(s.heading)) && !hidden.has(`section:${sectionKey(s.heading)}`));
  const rename = (card: CanvasNode, s: (typeof sections)[number]) => {
    renamed.push([headingOf(card), s.heading]);
    orphans.splice(orphans.indexOf(card), 1);
    kept.set(sectionKey(s.heading), card);
    for (const e of edges) if (e.toNode === card.id && isAuto(e)) e.neuralvault = { auto: 'section', key: sectionKey(s.heading) };
  };
  // A rename: the same words under a new heading; else a card left over at the place in the doc a new section now takes.
  const still: typeof fresh = [];
  for (const f of fresh) {
    const same = orphans.find((o) => o.nvSig === sigOf(f.s.body)) ?? orphans.find((o) => o.nvIndex === f.index);
    if (same) rename(same, f.s);
    else still.push(f);
  }
  // Cards of sections no longer in the doc go, with their lines.
  for (const o of orphans) {
    removed.push(headingOf(o) || 'a section');
    nodes.splice(nodes.indexOf(o), 1);
    edges = edges.filter((e) => e.fromNode !== o.id && e.toNode !== o.id);
  }
  // Kept cards point at the doc, at their section as it is written now.
  sections.forEach((s, index) => {
    const card = kept.get(sectionKey(s.heading));
    if (card) Object.assign(card, { type: 'file', file: docPath, subpath: `#${s.heading}`, neuralvault: { part: 'section', doc: docPath, heading: s.heading }, nvSig: sigOf(s.body), nvIndex: index });
  });
  // New sections: a card each in the first free place of the grid from where it falls in the doc.
  for (const { s, index } of still) {
    let spot = sectionSlot(centre, index);
    for (let slot = index; slot < index + 400; slot++) {
      spot = sectionSlot(centre, slot);
      if (!nodes.some((n) => overlaps(spot, n, 20))) break;
    }
    const key = sectionKey(s.heading);
    const card: CanvasNode = { id: boundId(docPath, 'section', key), type: 'file', file: docPath, subpath: `#${s.heading}`, ...spot, neuralvault: { part: 'section', doc: docPath, heading: s.heading }, nvSig: sigOf(s.body), nvIndex: index };
    if (nodes.some((n) => n.id === card.id)) card.id = boundId(docPath, 'section', key, String(nodes.length));
    nodes.push(card);
    kept.set(key, card);
    added.push(s.heading);
  }
  // A line from the doc's card to each section's, as the former host app writes it (unless the person took it off).
  // Ironleaf doesn't draw these on a doc's canvas (the cards sit grouped under the doc); other readers may.
  for (const s of sections) {
    const key = sectionKey(s.heading);
    const card = kept.get(key);
    if (!card || hidden.has(`edge:section:${key}`)) continue;
    if (edges.some((e) => e.toNode === card.id && isAuto(e))) continue;
    let id = boundId(docPath, 'edge', key);
    if (edges.some((e) => e.id === id)) id = boundId(docPath, 'edge', key, card.id);
    edges.push({ id, fromNode: centre.id, fromSide: 'bottom', toNode: card.id, toSide: 'top', toEnd: 'arrow', neuralvault: { auto: 'section', key } });
  }
  const board: CanvasBoard = { ...input, nodes, edges, neuralvault: { ...(meta ?? {}), kind: 'doc', doc: docPath } };
  return { board, added, removed, renamed, changed: JSON.stringify(board) !== JSON.stringify(input) };
}

/** A doc's canvas made for the first time: its card, its sections under it in reading order. */
export function buildDocCanvas(docPath: string, docText: string): CanvasBoard {
  return syncDocCanvas({ nodes: [], edges: [] }, docPath, docText).board;
}

/** What an update did, in words for the person ("2 sections added, 1 renamed"). */
export function syncWords(s: DocSync): string {
  const parts: string[] = [];
  const n = (k: number, one: string) => `${k} ${k === 1 ? one : `${one}s`}`;
  if (s.added.length) parts.push(`${n(s.added.length, 'section')} added`);
  if (s.renamed.length) parts.push(`${s.renamed.length} renamed`);
  if (s.removed.length) parts.push(`${s.removed.length} taken off`);
  return parts.length ? `Canvas updated: ${parts.join(', ')}.` : 'The canvas already matches the doc.';
}

/**
 * A project's canvas re-pointed at the doc it became (as the former host app does it): the cards drawn from the project
 * go (they drew its lists, which are the doc's sections now), the person's own cards stay, a card of one of its pages
 * opens the doc at that page's section, and the doc's card and section cards are added.
 */
export function repointProjectCanvas(input: CanvasBoard, opts: { project: string; docPath: string; docText: string; pages: Map<string, string> }): CanvasBoard {
  const drawn = new Set(['project', 'group', 'item', 'notes', 'portfolio-project', 'column']);
  const dropped = new Set((input.nodes ?? []).filter((n) => drawn.has(partOf(n) ?? '')).map((n) => n.id));
  const nodes = (input.nodes ?? [])
    .filter((n) => !dropped.has(n.id))
    .map((n) => {
      const heading = n.type === 'file' && n.file ? opts.pages.get(n.file) : undefined;
      if (heading) return { ...n, file: opts.docPath, subpath: `#${heading}` };
      if (n.type === 'file' && n.file === opts.project) return { ...n, file: opts.docPath };
      return n;
    });
  const edges = (input.edges ?? []).filter((e) => !dropped.has(e.fromNode) && !dropped.has(e.toNode));
  const { neuralvault: _meta, ...rest } = input;
  void _meta;
  return syncDocCanvas({ ...rest, nodes, edges }, opts.docPath, opts.docText).board;
}
