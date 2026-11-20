// Full control (src/shared/agent-full.ts lists the tools): what an agent at the fourth level may do beyond Jobs, carried
// out through the same steps as the person's own: notes through the normal write (File recovery keeps the versions),
// moves through the move that keeps links, projects through the project page's edit (its history names the agent),
// templates, canvases, assets, meetings and the weekly review through the code their pages use. Each change
// says what it did for "What agents did", with Undo where it can be taken back. Private notes are refused here as on
// every other level; nothing reaches Settings, the licence or keys.

import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changeProps } from '../shared/frontmatter';
import { freeSpot, type CanvasBoard, type CanvasEdge, type CanvasNode } from '../shared/project-canvas';
import { BILL_PROPS_SOLO, guardBillFreeText, planBillPropEdit } from '../shared/record-module-tools';
import type { Project, ProjectEdit, ProjectList } from '../shared/project-file';
import { closeBlockedWords, openProjectTasks } from '../shared/project-close';
import type { ProjectCard } from '../shared/types';
import type { AssetDetails, AssetPatch, BrandKit } from '../shared/assets';
import { appendUnder } from '../shared/capture';
import { isPrivatePath } from '../shared/private';
import { alreadyAppended, tagEdit } from './agent';

/** A change taken back from What agents did (as agent-access.ts keeps it). */
export type FullUndo =
  | { kind: 'project'; file: string; before: string; after: string }
  | { kind: 'note-made'; path: string; text: string }
  | { kind: 'note-edited'; path: string; before: string; after: string }
  | { kind: 'note-deleted'; path: string; text: string }
  | { kind: 'file-made'; path: string; text: string }
  | { kind: 'file-edited'; path: string; before: string; after: string }
  | { kind: 'moved'; from: string; to: string }
  | { kind: 'asset-added'; path: string }
  | { kind: 'asset'; path: string; before: AssetPatch }
  | { kind: 'brand'; before: BrandKit }
  | { kind: 'review'; id: string };

export interface FullDone {
  words: string;
  project?: { path: string; name: string };
  note?: string;
  undo?: FullUndo;
  outcome?: 'done';
}

/** What Full control needs from Ironleaf beyond the other levels (src/main/app.ts gives it). */
export interface FullHost {
  /** Any text file in the library (a canvas), and written back (made when new; notes go through writeNote). */
  readText(rel: string): Promise<string>;
  writeText(rel: string, text: string): Promise<void>;
  isFolder(rel: string): Promise<boolean>;
  /** A move or rename with links brought up to date. */
  move(from: string, to: string): Promise<{ path: string; linksUpdated: number }>;
  makeFolder(rel: string): Promise<void>;
  /** A note, file or folder to Recently deleted (File recovery keeps copies of notes). */
  trashPath(rel: string): Promise<void>;
  templateNote(template: string, name: string, folder: string, project?: string): Promise<string>;
  templateCreate(group: 'notes' | 'projects' | 'reports', name: string, content?: string): Promise<string>;
  templateFromNote(note: string, name: string, description?: string): Promise<string>;
  assets: {
    add(paths: string[], options: { duplicates?: 'existing' | 'keep'; kind?: string; collection?: string }): Promise<{ added: string[]; reused: string[] }>;
    update(rel: string, patch: AssetPatch): Promise<AssetDetails>;
    details(rel: string): Promise<AssetDetails>;
    brand(): Promise<BrandKit>;
    setBrand(brand: BrandKit): Promise<BrandKit>;
  };
  reviewDraft(): Promise<unknown>;
  reviewApply(draft: unknown): Promise<{ note: string; changes: number; words: string; id: string }>;
  reviewUndo(id: string): Promise<string>;
  /** A file from a web address saved where it can be copied from (a temporary folder); its path. */
  download?(url: string, name?: string): Promise<string>;
}

/** What the tools use from the agent layer (agent-access.ts gives it, with the agent's name on each change). */
export interface FullKit {
  host: FullHost;
  content(rel: string): string | undefined;
  readNote(rel: string): Promise<string>;
  noteExists(rel: string): Promise<boolean>;
  writeNote(rel: string, text: string): Promise<void>;
  dailyNote(): Promise<string>;
  findProject(raw: unknown): ProjectCard;
  /** A project with exactly this name is there. */
  projectNamed(name: string): boolean;
  /** Refusing a new note for a same-title one the agent hasn't read (null: no such note, or read already). */
  titleBlocked?(rel: string): string | null;
  projectView(rel: string): { path: string; project: { name: string; folder?: string; status?: string } & Record<string, unknown> };
  existingNote(raw: unknown): string;
  cleanNote(raw: unknown): string;
  /** A path inside the library (any file or folder), never Private notes. */
  cleanPath(raw: unknown): string;
  writableNote(rel: string): void;
  editProject(card: ProjectCard, edits: ProjectEdit[], words?: string): Promise<{ text: string; done: FullDone }>;
  /** A read tool of the chat assistant (src/main/agent.ts), its answer. */
  reader(name: string, args: Record<string, unknown>): Promise<string>;
  /** A bill marked paid the way finance_bill_mark_paid does (note_set_properties' door for it, 2 Nov 2026): its due
   *  day moved and the payment recorded. Absent where Money isn't running: setting paid is refused then. */
  markBillPaid?(rel: string, day: string): Promise<string>;
  /** Folders on the PC no file is ever copied from (Ironleaf's own data, where keys are kept), and the
   *  library's own folder (its Private notes are refused). */
  guarded(): { never: string[]; library: string | null };
}

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (x === '' || x === null ? undefined : x));
const titleOf = (rel: string) => (rel.split('/').pop() ?? rel).replace(/\.(md|canvas)$/i, '');
// Whole words: tool results and errors wrap where they show (t207 pass 2).
const quote = (s: string, _max = 70) => `“${s}”`;
const LISTS: ProjectList[] = ['next', 'dates', 'risks', 'decisions', 'people', 'documents', 'updates'];

// ── Canvases (JSON Canvas, jsoncanvas.org) ───────────────────────────────────────────────────────────────────────────

const COLOUR = /^(?:[1-6]|#[0-9a-f]{6})$/i;
const SIZE: Record<string, [number, number]> = { text: [320, 160], file: [400, 300], link: [400, 240], group: [640, 420] };
const newId = () => randomBytes(8).toString('hex');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(-1e6, Math.min(1e6, v))) : undefined);

/** A board as written, made safe to change (nodes and edges always lists). */
export function readBoard(text: string): CanvasBoard {
  let v: unknown;
  try {
    v = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error('That canvas can’t be read (it isn’t JSON Canvas), so it was left as it is.');
  }
  const b = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as CanvasBoard;
  return { ...b, nodes: Array.isArray(b.nodes) ? b.nodes.filter((n) => n && typeof n.id === 'string') : [], edges: Array.isArray(b.edges) ? b.edges.filter((e) => e && typeof e.id === 'string') : [] };
}

export const writeBoard = (b: CanvasBoard) => `${JSON.stringify(b, null, '\t')}\n`;

/** A card an agent describes, as a JSON Canvas node (placed in free space when it gives no place). */
export function cardNode(raw: unknown, board: CanvasBoard, cleanFile: (p: string) => string): CanvasNode {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = c.type === 'note' || c.type === 'file' ? 'file' : c.type === 'link' ? 'link' : c.type === 'group' ? 'group' : c.type === 'text' ? 'text' : null;
  if (!kind) throw new Error('A card’s type is text, note, link or group.');
  const [w0, h0] = SIZE[kind];
  const width = Math.max(40, num(c.width) ?? w0), height = Math.max(40, num(c.height) ?? h0);
  const node: CanvasNode = { id: newId(), type: kind, x: 0, y: 0, width, height };
  if (kind === 'text') node.text = str(c.text, 50_000);
  if (kind === 'file') {
    const file = cleanFile(str(c.file, 600));
    if (!file) throw new Error('A note card needs file: the note’s or file’s path in the library.');
    node.file = file;
  }
  if (kind === 'link') {
    const url = str(c.url, 2000).trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('A link card needs url: a web address starting https://.');
    node.url = url;
  }
  if (kind === 'group' && str(c.label, 200).trim()) node.label = str(c.label, 200).trim();
  if (typeof c.color === 'string' && COLOUR.test(c.color)) node.color = c.color;
  const x = num(c.x), y = num(c.y);
  if (x !== undefined && y !== undefined) {
    node.x = x;
    node.y = y;
  } else {
    // Below everything there, at the left: easy to find, never on top of a card.
    const bottom = board.nodes.length ? Math.max(...board.nodes.map((n) => n.y + n.height)) + 60 : 0;
    const left = board.nodes.length ? Math.min(...board.nodes.map((n) => n.x)) : 0;
    const at = freeSpot(board.nodes, { x: x ?? left, y: y ?? bottom, width, height });
    node.x = at.x;
    node.y = at.y;
  }
  return node;
}

/** Cards and lines added to a board: each new card's id, by the ref the agent gave it. */
export function addToBoard(board: CanvasBoard, cards: unknown, links: unknown, cleanFile: (p: string) => string): { ids: Record<string, string>; cards: number; links: number } {
  const ids: Record<string, string> = {};
  const list = Array.isArray(cards) ? cards.slice(0, 200) : [];
  for (const raw of list) {
    const node = cardNode(raw, board, cleanFile);
    board.nodes.push(node);
    const ref = str((raw as Record<string, unknown>)?.ref, 80).trim();
    ids[ref || `card ${Object.keys(ids).length + 1}`] = node.id;
  }
  let added = 0;
  for (const raw of Array.isArray(links) ? links.slice(0, 400) : []) {
    const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const pick = (v: unknown) => {
      const s = str(v, 80).trim();
      const id = ids[s] ?? s;
      if (!board.nodes.some((n) => n.id === id)) throw new Error(`There is no card ${quote(s)} on this canvas: use an id from canvas_get or a ref given in this call.`);
      return id;
    };
    const edge: CanvasEdge = { id: newId(), fromNode: pick(l.from), toNode: pick(l.to), toEnd: 'arrow' };
    if (str(l.label, 200).trim()) edge.label = str(l.label, 200).trim();
    if (typeof l.color === 'string' && COLOUR.test(l.color)) edge.color = l.color;
    board.edges.push(edge);
    added++;
  }
  return { ids, cards: list.length, links: added };
}

/** Changes to cards by id: words, place, size, colour… (a card drawn from a project keeps its words). */
export function changeBoard(board: CanvasBoard, changes: unknown, cleanFile: (p: string) => string): number {
  let n = 0;
  for (const raw of Array.isArray(changes) ? changes.slice(0, 400) : []) {
    const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const node = board.nodes.find((x) => x.id === c.id);
    if (!node) throw new Error(`There is no card ${quote(str(c.id, 60))} on this canvas. Read it with canvas_get for the ids.`);
    const bound = !!node.neuralvault && (node.neuralvault as { part?: string }).part !== 'file';
    if (bound && (c.text !== undefined || c.file !== undefined || c.url !== undefined || c.label !== undefined)) throw new Error('That card is drawn from the project: change its words with the project tools (project_change_item…). It can be moved and resized here.');
    for (const k of ['x', 'y'] as const) if (num(c[k]) !== undefined) node[k] = num(c[k])!;
    for (const k of ['width', 'height'] as const) if (num(c[k]) !== undefined) node[k] = Math.max(40, num(c[k])!);
    if (typeof c.text === 'string' && node.type === 'text') node.text = c.text.slice(0, 50_000);
    if (typeof c.label === 'string') node.label = c.label.slice(0, 200);
    if (typeof c.url === 'string' && node.type === 'link') {
      if (!/^https?:\/\//i.test(c.url)) throw new Error('A link card’s url starts https://.');
      node.url = c.url.slice(0, 2000);
    }
    if (typeof c.file === 'string' && node.type === 'file') node.file = cleanFile(c.file);
    if (typeof c.color === 'string') {
      if (c.color === '') delete node.color;
      else if (COLOUR.test(c.color)) node.color = c.color;
    }
    n++;
  }
  return n;
}

/** Cards (with their lines) or lines taken off a board. */
export function removeFromBoard(board: CanvasBoard, ids: unknown): { cards: number; links: number } {
  const want = new Set((Array.isArray(ids) ? ids : []).map((x) => str(x, 80)).filter(Boolean));
  if (!want.size) throw new Error('Give the ids of the cards or lines to remove (from canvas_get).');
  const cards = board.nodes.filter((n) => want.has(n.id)).length;
  board.nodes = board.nodes.filter((n) => !want.has(n.id));
  const before = board.edges.length;
  board.edges = board.edges.filter((e) => !want.has(e.id) && board.nodes.some((n) => n.id === e.fromNode) && board.nodes.some((n) => n.id === e.toNode));
  if (!cards && before === board.edges.length) throw new Error('None of those ids are on this canvas.');
  return { cards, links: before - board.edges.length };
}

/** A board as an agent reads it: short, every card's id first. */
export function boardText(rel: string, board: CanvasBoard): string {
  const nodes = board.nodes.slice(0, 400).map((n) => ({
    id: n.id,
    type: n.type === 'file' ? 'note' : n.type,
    text: n.type === 'text' ? (String(n.text ?? '').length > 600 ? `${String(n.text).slice(0, 599)}…` : n.text) : undefined,
    file: n.file,
    url: n.url,
    label: n.label,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    color: n.color,
    fromProject: n.neuralvault && (n.neuralvault as { part?: string }).part !== 'file' ? true : undefined,
  }));
  const edges = board.edges.slice(0, 600).map((e) => ({ id: e.id, from: e.fromNode, to: e.toNode, label: e.label }));
  return json({ canvas: rel, cards: nodes, lines: edges, ...(board.nodes.length > 400 ? { moreCards: board.nodes.length - 400 } : {}) });
}

// ── The tools ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Carries out a Full control tool (or a read tool added for every level): null when `name` isn't one of them. */
export async function runFullTool(k: FullKit, name: string, a: Record<string, unknown>): Promise<{ text: string; done?: FullDone } | null> {
  const h = k.host;
  const cleanFile = (p: string) => {
    const rel = k.cleanPath(p);
    return rel;
  };
  const canvasPath = (raw: unknown) => {
    const rel = k.cleanPath(raw);
    if (!/\.canvas$/i.test(rel)) throw new Error('A canvas’s path ends in .canvas.');
    return rel;
  };
  const loadBoard = async (rel: string) => {
    let text: string;
    try {
      text = await h.readText(rel);
    } catch {
      throw new Error(`There is no canvas ${rel}. Make one with canvas_create.`);
    }
    return { text, board: readBoard(text) };
  };
  switch (name) {
    // ── Read tools for every level ──
    case 'canvas_get': {
      const rel = canvasPath(a.canvas);
      const { board } = await loadBoard(rel);
      return { text: boardText(rel, board) };
    }
    case 'project_files_list': {
      const card = k.findProject(a.project);
      return { text: await k.reader('list_project_folder', { project: card.name, ...(str(a.folder, 600).trim() ? { path: str(a.folder, 600).trim() } : {}), depth: 2 }) };
    }
    // ── Notes and folders ──
    case 'note_write': {
      const rel = k.cleanNote(a.path);
      if (!/\.md$/i.test(rel)) throw new Error('A note’s path ends in .md.');
      const content = str(a.content, 400_000);
      const exists = await k.noteExists(rel);
      if (exists) k.writableNote(rel);
      // A new path under a title already kept, unread: the one same-title guard, shared.
      if (!exists) {
        const blocked = k.titleBlocked?.(rel);
        if (blocked) throw new Error(blocked);
      }
      const before = exists ? (k.content(rel) ?? (await k.readNote(rel))) : null;
      // A bill's paid and due are kept by Mark paid (2 Nov 2026, the no-way-around pass): a rewrite that changes
      // them keeps the old values, and the answer names the tool that does that change instead.
      const guarded = guardBillFreeText(before ?? '', content);
      const text = guarded ? guarded.text : content;
      await k.writeNote(rel, text);
      const note = guarded?.note ? ` ${guarded.note}` : '';
      return before === null
        ? { text: `Made ${rel}.${note}`, done: { words: `Made the note ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'note-made', path: rel, text } } }
        : { text: `Rewrote ${rel}.${note}`, done: { words: `Rewrote the note ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'note-edited', path: rel, before, after: text } } };
    }
    case 'note_move': {
      const from = k.cleanPath(a.from);
      let to = k.cleanPath(a.to);
      if (!from || !to) throw new Error('Give from and to as paths inside the library.');
      if (/\.md$/i.test(from) && !/\.[a-z0-9]{1,8}$/i.test(to.split('/').pop() ?? '')) to += '.md';
      if (from === to) throw new Error('That is where it is already.');
      const folder = await h.isFolder(from);
      if (!folder && !(await k.noteExists(from))) throw new Error(`${from} isn’t in the library.`);
      if (await k.noteExists(to)) throw new Error(`${to} is already there. Choose another name.`);
      const moved = await h.move(from, to);
      const renamed = from.split('/').slice(0, -1).join('/') === moved.path.split('/').slice(0, -1).join('/');
      const what = folder ? 'folder' : /\.md$/i.test(from) ? 'note' : 'file';
      return {
        text: `${renamed ? 'Renamed' : 'Moved'} ${from} to ${moved.path}${moved.linksUpdated ? ` (${moved.linksUpdated} ${moved.linksUpdated === 1 ? 'link' : 'links'} brought up to date)` : ''}.`,
        done: { words: `${renamed ? 'Renamed' : 'Moved'} the ${what} ${quote(titleOf(from))} ${renamed ? 'to' : 'to'} ${quote(renamed ? titleOf(moved.path) : moved.path)}.`, ...(what === 'note' ? { note: moved.path } : {}), undo: { kind: 'moved', from, to: moved.path } },
      };
    }
    case 'folder_create': {
      const rel = k.cleanPath(a.path).replace(/\/+$/, '');
      if (!rel) throw new Error('Give the folder’s path.');
      if (await h.isFolder(rel)) return { text: `${rel} is there already.` };
      await h.makeFolder(rel);
      return { text: `Made the folder ${rel}.`, done: { words: `Made the folder ${quote(rel)}.` } };
    }
    case 'folder_delete': {
      const rel = k.cleanPath(a.path).replace(/\/+$/, '');
      if (!rel) throw new Error('The top of the library can’t be deleted.');
      if (!(await h.isFolder(rel))) throw new Error(`There is no folder ${rel}. Delete a note with note_delete.`);
      await h.trashPath(rel);
      return { text: `Deleted the folder ${rel} (to Recently deleted; File recovery keeps copies of its notes).`, done: { words: `Deleted the folder ${quote(rel)} (to Recently deleted).` } };
    }
    case 'note_set_properties': {
      const rel = k.existingNote(a.path);
      k.writableNote(rel);
      const props = a.properties && typeof a.properties === 'object' && !Array.isArray(a.properties) ? (a.properties as Record<string, unknown>) : {};
      const removing = Array.isArray(a.remove_tags) || typeof a.remove_tags === 'string';
      if (!Object.keys(props).length && !removing) throw new Error('Give the properties as an object, such as {"tags": ["clients"]}.');
      if (Object.keys(props).some((key) => key.toLowerCase() === 'type' && props[key] === 'project')) throw new Error('Start projects with project_create.');
      const before = k.content(rel) ?? (await k.readNote(rel));
      const keys = Object.keys(props).filter((key) => /^[\p{L}\p{N} _-]{1,60}$/u.test(key)).slice(0, 40);
      // A bill's paid and due are kept by Mark paid (2 Nov 2026, the credit-card run): setting paid records the payment
      // that way instead of writing it bare; anything else touching them is refused before anything is written.
      const billPlan = planBillPropEdit(before, props);
      if (billPlan.route === 'refuse') throw new Error(billPlan.words);
      if (billPlan.route === 'markPaid') {
        if (keys.length !== 1 || removing) throw new Error(BILL_PROPS_SOLO);
        if (!k.markBillPaid) throw new Error('Paid on a bill is recorded with finance_bill_mark_paid, which isn’t available here: nothing was changed.');
        const said = await k.markBillPaid(rel, billPlan.day);
        const afterBill = k.content(rel) ?? (await k.readNote(rel));
        return { text: `${said} [${rel}]`, done: { words: said, note: rel, undo: { kind: 'note-edited', path: rel, before, after: afterBill } } };
      }
      // Tags are added or taken off, never the note's other tags dropped (one rule, shared with the side chat).
      const after = changeProps(before, (doc) => {
        const edit = tagEdit(doc.toJS(), props, a.remove_tags, a.replace_tags === true);
        const applyTags = () => {
          if (!edit) return;
          if (edit.next.length) doc.set(edit.key, edit.next);
          else doc.delete(edit.key);
        };
        let tagsDone = false;
        for (const key of keys) {
          if (key.toLowerCase() === 'tags') {
            tagsDone = true;
            applyTags();
            continue;
          }
          const v = props[key];
          if (v === null) doc.delete(key);
          else doc.set(key, v);
        }
        if (!tagsDone) applyTags();
      });
      if (removing && !keys.includes('tags')) keys.push('tags');
      if (after === before) return { text: 'Nothing changed: those properties were set already.' };
      await k.writeNote(rel, after);
      return { text: `Set ${keys.join(', ')} on ${rel}.`, done: { words: `Set ${keys.join(', ')} on the note ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'note-edited', path: rel, before, after } } };
    }
    case 'daily_note': {
      const rel = await k.dailyNote();
      const add = str(a.text, 50_000).replace(/\r\n/g, '\n').trim();
      const before = k.content(rel) ?? (await k.readNote(rel));
      if (!add) return { text: `${rel}\n\n${before || '(empty so far)'}` };
      const heading = str(a.heading, 120).replace(/^#+\s*/, '').trim();
      if (!heading && alreadyAppended(before, add)) return { text: `That text is already the last thing in today’s note, so nothing was added.` };
      const after = heading ? appendUnder(before, add.split('\n'), heading.replace(/[.*+?^${}()|[\]\\]/g, '')) : `${before.replace(/\s*$/, '')}${before.trim() ? '\n\n' : ''}${add}\n`;
      await k.writeNote(rel, after);
      return { text: `Added to today’s note (${rel}).`, done: { words: `Added to today’s note: ${quote(add.split('\n')[0])}.`, note: rel, undo: { kind: 'note-edited', path: rel, before, after } } };
    }
    // ── Projects ──
    case 'project_set_details': {
      const card = k.findProject(a.project);
      const field = ['name', 'repository', 'notes', 'tags'].find((f) => f === a.field);
      if (!field) throw new Error('field is name, repository, notes or tags.');
      if (field === 'tags') {
        const raw = Array.isArray(a.value) ? a.value : typeof a.value === 'string' ? a.value.split(/[,\n]+/) : [];
        const tags = raw.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean).slice(0, 40);
        return k.editProject(card, [{ kind: 'tags', tags }], tags.length ? `Set the tags: ${tags.join(', ')}.` : 'Took the tags off.');
      }
      const value = a.value === null || a.value === undefined ? null : str(a.value, field === 'notes' ? 100_000 : 300);
      if (field === 'name') {
        const next = String(value ?? '').replace(/\s+/g, ' ').trim();
        if (!next) throw new Error('A project needs a name.');
        if (next.toLowerCase() !== card.name.toLowerCase() && k.projectNamed(next)) throw new Error(`There’s already a project called ${next}.`);
        const out = await k.editProject(card, [{ kind: 'set', field: 'name', value: next }], `Renamed the project to ${quote(next)}.`);
        // A rename moves the project's file: taken back by renaming it again, not by Undo here.
        delete out.done.undo;
        return out;
      }
      return k.editProject(card, [{ kind: 'set', field: field as 'repository' | 'notes', value }]);
    }
    case 'project_move_item': {
      const card = k.findProject(a.project);
      const list = LISTS.find((l) => l === a.list);
      if (!list) throw new Error(`list is one of ${LISTS.join(', ')}.`);
      const p = k.projectView(card.path).project as unknown as Record<string, unknown[]>;
      const items = p[list] ?? [];
      const from = Math.round(Number(a.from)), to = Math.round(Number(a.to));
      if (!(from >= 1 && from <= items.length) || !(to >= 1 && to <= items.length)) throw new Error(`Give from and to between 1 and ${items.length} (the numbers in project_get).`);
      if (from === to) return { text: 'That line is in that place already.' };
      return k.editProject(card, [{ kind: 'move', list, from: from - 1, to: to - 1 }], `Moved line ${from} of ${list === 'next' ? 'the next steps' : `the ${list}`} to ${to}.`);
    }
    case 'project_archive': {
      const card = k.findProject(a.project);
      const done = a.done !== false;
      // Putting away with open tasks is never silent (p12-close-and-noise A): the open tasks come back in plain
      // words for the person to answer, and the project stays as it is.
      if (done) {
        // (the kit's narrow shape is the full project view at runtime: agent-access.ts passes it straight through)
        const open = openProjectTasks(k.projectView(card.path).project as unknown as Project);
        if (open.length) return { text: `${closeBlockedWords(card.name, open)} Nothing was changed.` };
      }
      const why = str(a.why, 400).trim();
      const edits: ProjectEdit[] = [{ kind: 'set', field: 'status', value: done ? 'done' : 'active' }];
      if (why) edits.push({ kind: 'add', list: 'updates', item: { what: why } });
      return k.editProject(card, edits, done ? `Put the project away (status done)${why ? `: ${quote(why)}` : ''}.` : 'Brought the project back (status active).');
    }
    case 'project_pin_file': {
      const card = k.findProject(a.project);
      const file = str(a.path, 1000).trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (!file || file.split('/').includes('..')) throw new Error('Give the file’s path inside the project’s folder.');
      const what = str(a.what, 300).trim();
      const pinned = a.pinned !== false;
      return k.editProject(card, [{ kind: 'pin', path: file, pinned, ...(what ? { what } : {}) }], pinned ? `Pinned ${quote(file)} to the documents.` : `Unpinned ${quote(file)}.`);
    }
    // ── Templates ──
    case 'template_apply': {
      const template = k.cleanNote(a.template);
      const nameGiven = str(a.name, 120).trim();
      if (!nameGiven) throw new Error('Give the new note’s name.');
      const folder = str(a.folder, 400).trim() ? k.cleanPath(a.folder) : '';
      const project = str(a.project, 300).trim() ? k.findProject(a.project).path : undefined;
      const rel = await h.templateNote(template, nameGiven, folder, project);
      const text = k.content(rel) ?? (await k.readNote(rel));
      return { text: `Made ${rel} from ${titleOf(template)}.`, done: { words: `Made the note ${quote(titleOf(rel))} from the template ${quote(titleOf(template))}.`, note: rel, undo: { kind: 'note-made', path: rel, text } } };
    }
    case 'template_create': {
      const group = a.group === 'projects' || a.group === 'reports' ? a.group : a.group === 'notes' ? 'notes' : null;
      if (!group) throw new Error('group is notes, projects or reports.');
      const nameGiven = str(a.name, 120).trim();
      if (!nameGiven) throw new Error('Give the template a name.');
      const content = typeof a.content === 'string' && a.content.trim() ? a.content.slice(0, 200_000) : undefined;
      const rel = await h.templateCreate(group, nameGiven, content);
      const text = k.content(rel) ?? (await k.readNote(rel));
      return { text: `Made the template ${rel}.`, done: { words: `Made the ${group === 'notes' ? 'note' : group === 'projects' ? 'project' : 'report'} template ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'note-made', path: rel, text } } };
    }
    case 'template_from_note': {
      const note = k.existingNote(a.note);
      const nameGiven = str(a.name, 120).trim();
      if (!nameGiven) throw new Error('Give the template a name.');
      const rel = await h.templateFromNote(note, nameGiven, str(a.description, 400).trim() || undefined);
      const text = k.content(rel) ?? (await k.readNote(rel));
      return { text: `Saved ${note} as the template ${rel}.`, done: { words: `Saved ${quote(titleOf(note))} as the template ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'note-made', path: rel, text } } };
    }
    // ── Canvases ──
    case 'canvas_create': {
      const rel = canvasPath(a.path);
      if (await k.noteExists(rel)) throw new Error(`${rel} is already there: add to it with canvas_add.`);
      const board: CanvasBoard = { nodes: [], edges: [] };
      const added = addToBoard(board, a.cards, a.links, cleanFile);
      const text = writeBoard(board);
      await h.writeText(rel, text);
      return { text: json({ made: rel, cards: added.ids }), done: { words: `Made the canvas ${quote(titleOf(rel))}${added.cards ? ` with ${added.cards} ${added.cards === 1 ? 'card' : 'cards'}` : ''}.`, note: rel, undo: { kind: 'file-made', path: rel, text } } };
    }
    case 'canvas_add': {
      const rel = canvasPath(a.canvas);
      const { text: before, board } = await loadBoard(rel);
      const added = addToBoard(board, a.cards, a.links, cleanFile);
      if (!added.cards && !added.links) throw new Error('Give cards or links to add.');
      const after = writeBoard(board);
      await h.writeText(rel, after);
      const parts = [added.cards ? `${added.cards} ${added.cards === 1 ? 'card' : 'cards'}` : '', added.links ? `${added.links} ${added.links === 1 ? 'line' : 'lines'}` : ''].filter(Boolean).join(' and ');
      return { text: json({ canvas: rel, cards: added.ids, lines: added.links }), done: { words: `Added ${parts} to the canvas ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'file-edited', path: rel, before, after } } };
    }
    case 'canvas_change': {
      const rel = canvasPath(a.canvas);
      const { text: before, board } = await loadBoard(rel);
      const n = changeBoard(board, a.changes, cleanFile);
      if (!n) throw new Error('Give the changes: [{id, …}].');
      const after = writeBoard(board);
      await h.writeText(rel, after);
      return { text: `Changed ${n} ${n === 1 ? 'card' : 'cards'} on ${rel}.`, done: { words: `Changed ${n} ${n === 1 ? 'card' : 'cards'} on the canvas ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'file-edited', path: rel, before, after } } };
    }
    case 'canvas_remove': {
      const rel = canvasPath(a.canvas);
      const { text: before, board } = await loadBoard(rel);
      const r = removeFromBoard(board, a.ids);
      const after = writeBoard(board);
      await h.writeText(rel, after);
      const parts = [r.cards ? `${r.cards} ${r.cards === 1 ? 'card' : 'cards'}` : '', r.links ? `${r.links} ${r.links === 1 ? 'line' : 'lines'}` : ''].filter(Boolean).join(' and ');
      return { text: `Removed ${parts} from ${rel}.`, done: { words: `Removed ${parts} from the canvas ${quote(titleOf(rel))}.`, note: rel, undo: { kind: 'file-edited', path: rel, before, after } } };
    }
    // ── Assets and the brand kit ──
    case 'asset_add': {
      const from = str(a.from, 4000).trim();
      if (!from) throw new Error('Give from: a full path on this PC or an https:// address.');
      let source: string;
      let temp: string | null = null;
      if (/^https?:\/\//i.test(from)) {
        if (!h.download) throw new Error('Files from the web can’t be fetched here.');
        temp = source = await h.download(from, str(a.name, 200).trim() || undefined);
      } else {
        if (!path.isAbsolute(from)) throw new Error('from is a full path on this PC (C:\\…) or an https:// address.');
        const real = await fsp.realpath(from).catch(() => path.resolve(from));
        const g = k.guarded();
        const within = (dir: string) => {
          const rel = path.relative(path.resolve(dir), real);
          return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        };
        if (g.never.some(within)) throw new Error('Files from Ironleaf’s own settings folders are never copied (keys are kept there).');
        if (g.library && within(g.library) && isPrivatePath(path.relative(g.library, real).split(path.sep).join('/'))) throw new Error('Private notes are never open to agents.');
        source = from;
        const name = str(a.name, 200).trim();
        if (name && path.basename(from) !== name) {
          // Copied under the name asked for (the original stays where it is).
          const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nv-asset-'));
          temp = path.join(dir, name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 160));
          await fsp.copyFile(from, temp);
          source = temp;
        }
      }
      try {
        // An asset is a picture, a document or media: never a note or a canvas (those are made with their own tools).
        if (/\.(md|markdown|canvas)$/i.test(source)) throw new Error('Notes and canvases aren’t assets: make them with note_write or canvas_create.');
        const st = await fsp.stat(source).catch(() => null);
        if (!st?.isFile()) throw new Error(`There is no file at ${from}.`);
        const kind = str(a.kind, 20);
        const collection = str(a.collection, 60).trim();
        const r = await h.assets.add([source], { duplicates: 'existing', ...(kind ? { kind } : {}), ...(collection ? { collection } : {}) });
        const rel = r.added[0] ?? r.reused[0];
        if (!rel) throw new Error('That file couldn’t be added (it may be too big: 500 MB at most).');
        const tags = Array.isArray(a.tags) ? a.tags.map((t) => str(t, 60)).filter(Boolean) : [];
        const description = str(a.description, 1000).trim();
        if (tags.length || description) await h.assets.update(rel, { ...(tags.length ? { tags } : {}), ...(description ? { description } : {}) });
        if (!r.added.length) return { text: `That file is already in the assets: ${rel}.` };
        return { text: `Added ${rel} to the assets.`, done: { words: `Added ${quote(titleOf(rel))} to the assets.`, undo: { kind: 'asset-added', path: rel } } };
      } finally {
        if (temp) await fsp.rm(path.dirname(temp), { recursive: true, force: true }).catch(() => {});
      }
    }
    case 'asset_update': {
      const rel = k.cleanPath(a.asset);
      const old = await h.assets.details(rel);
      const patch: AssetPatch = {};
      if (typeof a.kind === 'string') patch.kind = a.kind as AssetPatch['kind'];
      if (Array.isArray(a.tags)) patch.tags = a.tags.map((t) => str(t, 60)).filter(Boolean);
      if (Array.isArray(a.collections)) patch.collections = a.collections.map((t) => str(t, 60)).filter(Boolean);
      if (typeof a.description === 'string') patch.description = a.description.slice(0, 1000);
      if (typeof a.alt === 'string') patch.alt = a.alt.slice(0, 500);
      if ('role' in a) patch.role = a.role === 'primary' || a.role === 'onDark' || a.role === 'icon' ? a.role : null;
      if (!Object.keys(patch).length) throw new Error('Give what to change: kind, tags, collections, description, alt or role.');
      await h.assets.update(rel, patch);
      const before: AssetPatch = {};
      if ('kind' in patch) before.kind = old.kind === old.inferred ? null : old.kind;
      if (patch.tags) before.tags = old.tags;
      if (patch.collections) before.collections = old.collections;
      if ('description' in patch) before.description = old.description ?? null;
      if ('alt' in patch) before.alt = old.alt ?? null;
      if ('role' in patch) before.role = old.role ?? null;
      return { text: `Changed what the assets say about ${rel}.`, done: { words: `Described the asset ${quote(titleOf(rel))} (${Object.keys(patch).join(', ')}).`, undo: { kind: 'asset', path: rel, before } } };
    }
    case 'brand_kit_set': {
      const before = await h.assets.brand();
      const next: BrandKit = { ...before, logos: { ...before.logos }, colours: [...before.colours], fonts: [...before.fonts] };
      const changed: string[] = [];
      if (typeof a.name === 'string') {
        next.name = a.name.slice(0, 120);
        changed.push('name');
      }
      if (Array.isArray(a.colours)) {
        next.colours = a.colours as BrandKit['colours'];
        changed.push('colours');
      }
      if (Array.isArray(a.fonts)) {
        next.fonts = a.fonts as BrandKit['fonts'];
        changed.push('fonts');
      }
      if (a.logos && typeof a.logos === 'object') {
        for (const [role, p] of Object.entries(a.logos as Record<string, unknown>)) if (role === 'primary' || role === 'onDark' || role === 'icon') next.logos[role] = k.cleanPath(p);
        changed.push('logos');
      }
      if (!changed.length) throw new Error('Give what to change: name, colours, fonts or logos.');
      const saved = await h.assets.setBrand(next);
      return { text: `The brand kit now: ${json(saved)}`, done: { words: `Changed the brand kit’s ${changed.join(', ')}.`, undo: { kind: 'brand', before } } };
    }
    // ── Meetings and the weekly review ──
    case 'review_draft':
      return { text: json(await h.reviewDraft()) };
    case 'review_apply': {
      if (!a.draft || typeof a.draft !== 'object') throw new Error('Give the draft from review_draft.');
      const r = await h.reviewApply(a.draft);
      return { text: `${r.words} (${r.note})`, done: { words: `Saved the weekly review ${quote(titleOf(r.note))}${r.changes ? ` with ${r.changes} ${r.changes === 1 ? 'change' : 'changes'} to projects` : ''}.`, note: r.note, undo: { kind: 'review', id: r.id } } };
    }
    default:
      return null;
  }
}

/** Takes back a Full control change (the kinds the other levels don't make); a sentence when it can't. */
export async function undoFull(u: FullUndo, k: Pick<FullKit, 'host' | 'noteExists'>, who: string): Promise<string | null> {
  const h = k.host;
  const since = `${who}’s change was left as it is, because it was changed since.`;
  switch (u.kind) {
    case 'file-made': {
      const now = await h.readText(u.path).catch(() => null);
      if (now !== null && now !== u.text) return since;
      if (now !== null) await h.trashPath(u.path);
      return null;
    }
    case 'file-edited': {
      const now = await h.readText(u.path).catch(() => null);
      if (now !== u.after) return since;
      await h.writeText(u.path, u.before);
      return null;
    }
    case 'moved': {
      if (!(await k.noteExists(u.to)) && !(await h.isFolder(u.to))) return 'It isn’t where it was moved to any more, so it was left as it is.';
      if ((await k.noteExists(u.from)) || (await h.isFolder(u.from))) return `Something is at ${u.from} now, so it wasn’t moved back.`;
      await h.move(u.to, u.from);
      return null;
    }
    case 'asset-added': {
      if (await k.noteExists(u.path)) await h.trashPath(u.path);
      return null;
    }
    case 'asset':
      await h.assets.update(u.path, u.before);
      return null;
    case 'brand':
      await h.assets.setBrand(u.before);
      return null;
    case 'review': {
      await h.reviewUndo(u.id);
      return null;
    }
    default:
      return 'That can’t be undone.';
  }
}
