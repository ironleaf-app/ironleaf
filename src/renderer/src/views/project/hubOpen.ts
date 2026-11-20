// Where a click on the project hub or its timeline goes (t239, 12 Nov 2026: a click opens the referenced document
// itself, never a side panel). One way in for every tile: an action, milestone, workstream, decision, risk, person or
// file opens as its document in the main view; an update, a part of the project ("All actions", "3 high risks") or a
// note linked by name opens where it lives — the project's Details at that very line or card (marked for a moment),
// or the note in its tab.
//
// The hub hands the opener what it knows of the item, in the record model's terms (src/shared/records.ts RecordRef),
// and never needs to know how it is drawn (src/renderer/src/state/peek.ts openReference).

import type { ItemRef } from '../../../../shared/project-hub';
import { itemKey } from '../../../../shared/project-hub';
import * as A from '../../state/actions';
import { getState, showError } from '../../state/store';
import { getWorkspace } from '../../state/layout';
import * as W from '../../state/workspace';
import { showItem } from '../timeline/reveal';
import { peek } from '../../state/peek';
import type { RecordRef } from '../../../../shared/records';
import type { ConnectedAction } from '../../../../shared/project-hub';
import { useEffect, useState } from 'react';
import { useApp } from '../../state/store';

/**
 * A project's actions written in its meetings and notes, and who "me" is, from the connected vault (records.attention):
 * the Overview, the Timeline and the workspace count them the same way. Read again after any change.
 */
export function useConnected(path: string): { me: string | null; elsewhere: ConnectedAction[] } | null {
  const revision = useApp((s) => s.revision);
  const [got, setGot] = useState<{ path: string; me: string | null; elsewhere: ConnectedAction[] } | null>(null);
  useEffect(() => {
    let live = true;
    window.nv.records.attention(path).then(
      (a) => live && setGot({ path, me: a?.me ?? null, elsewhere: a?.elsewhere ?? [] }),
      () => live && setGot({ path, me: null, elsewhere: [] }),
    );
    return () => void (live = false);
  }, [path, revision]);
  return got?.path === path ? got : null;
}

/** What the hub knows of an item, in the record model's terms (src/shared/records.ts RecordRef). */
export interface PeekRequest {
  type: 'action' | 'milestone' | 'workstream' | 'decision' | 'risk' | 'file' | 'person' | 'project' | 'note';
  /** The project's file (for a person: the project they're in). */
  path: string;
  title?: string;
  name?: string;
  folderFile?: string;
  /** Where it sits on the project's page ("next:3", "dates:1"). */
  item?: string;
}

/** Opens a request in the record peek (part B, src/renderer/src/state/peek.ts). */
function openInPeek(req: PeekRequest): void {
  const ref: RecordRef = req.type === 'person' ? { type: 'person', name: req.name } : req.type === 'note' ? { type: 'note', path: req.path } : { type: req.type, path: req.path, ...(req.title ? { title: req.title } : {}), ...(req.folderFile ? { folderFile: req.folderFile } : {}) };
  peek(ref, { ...(req.title ? { title: req.title } : {}), type: req.type });
}

const TYPE: Partial<Record<ItemRef['kind'], PeekRequest['type']>> = { next: 'action', run: 'action', date: 'milestone', risk: 'risk', decision: 'decision', person: 'person', file: 'file', workstream: 'workstream' };

/** The page's own card for a part of the project (Details). */
const CARD: Record<string, string> = { actions: 'next', waiting: 'next', unowned: 'next', risks: 'risks', dates: 'dates', people: 'people', decisions: 'decisions', updates: 'updates', files: 'files' };

export interface OpenContext {
  /** The project's file. */
  path: string;
  /** Shows the project's Details tab; resolves once it is drawn. */
  details(): Promise<HTMLElement | null>;
  /** Shows the tab holding an item (8.7 wave 2a: the page's seven tabs); resolves once it is drawn. */
  show?(ref: ItemRef): Promise<HTMLElement | null>;
  /** Where a file in the project's folder opens. */
  openFolderFile?(rel: string): void;
}

/** Opens an item the hub shows: in the peek (an update, a section or a linked note: where it lives). */
export async function openHubItem(ctx: OpenContext, ref: ItemRef, title?: string, e?: { ctrlKey?: boolean; metaKey?: boolean }): Promise<void> {
  // Written outside the project's file (a meeting's action): the connected vault knows it by its id.
  if (ref.kind === 'record') return peek({ id: ref.id, path: ref.path, ...(ref.line !== undefined ? { line: ref.line } : {}), type: 'action' }, { ...(title ? { title } : {}), type: 'action' });
  const type = TYPE[ref.kind];
  if (type && !(ref.kind === 'file' && ref.link)) {
    // Already on its page (t248, 12 Nov 2026, item 9): an action opening its own project's page is the same
    // page, so nothing visible happened and the control read dead. Opening an item on the page already
    // showing reveals and flashes its row instead. Beside (Ctrl) still opens beside. A person or file opens
    // its own document, never here, so they keep the peek below.
    if ((ref.kind === 'next' || ref.kind === 'run' || ref.kind === 'date' || ref.kind === 'risk' || ref.kind === 'decision' || ref.kind === 'workstream') && !e?.ctrlKey && !e?.metaKey && W.activeTab(getWorkspace()).path === ctx.path && ctx.show) {
      const page = await ctx.show(ref);
      if (page) return;
    }
    const req: PeekRequest = { type, path: ctx.path, ...(title ? { title } : {}), item: itemKey(ref) };
    if (ref.kind === 'person') req.name = ref.name;
    if (ref.kind === 'file' && !ref.note) req.folderFile = ref.path;
    if (ref.kind === 'file' && ref.note) {
      req.type = 'note';
      req.path = ref.path;
    }
    return openInPeek(req);
  }
  const where = e?.ctrlKey || e?.metaKey ? 'tab' : 'current';
  if (ref.kind === 'file') {
    if (ref.link) return void A.openLink(ref.link.replace(/^\[\[|\]\]$/g, '').split('|')[0], ctx.path, where).catch(showError);
    if (ref.note) return A.openPath(ref.path, { where });
    if (ctx.openFolderFile) return ctx.openFolderFile(ref.path);
  }
  if (ref.kind === 'person') {
    // Their own note, when they have one; else the People card.
    const want = ref.name.replace(/\(.*?\)/g, '').trim().toLowerCase();
    const note = getState().notes.find((n) => /(^|\/)People\//i.test(n.path) && n.title.trim().toLowerCase() === want);
    if (note) return A.openPath(note.path, { where });
  }
  const page = ctx.show ? await ctx.show(ref) : await ctx.details();
  if (!page) return;
  const key = itemKey(ref);
  if (ref.kind === 'section') {
    const card = page.querySelector<HTMLElement>(`[data-item-card="${CARD[ref.heading] ?? ref.heading}"]`);
    if (card) flash(card);
    return;
  }
  if (showItem(page, key)) return;
  // A tick box in a run sheet, a workstream's row: the block that shows that section.
  if (ref.kind === 'run' || ref.kind === 'workstream') {
    const block = [...page.querySelectorAll<HTMLElement>('.ly-block')].find((b) => b.querySelector('h3, .ly-block-title')?.textContent?.trim().toLowerCase() === ref.section.toLowerCase()) ?? page.querySelector<HTMLElement>('.ly-dash');
    if (block) return flash(block);
  }
  if (ref.kind === 'person') {
    const card = page.querySelector<HTMLElement>('[data-item-card="people"]');
    if (card) return flash(card);
  }
}

function flash(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('tl-revealed');
  void el.offsetWidth;
  el.classList.add('tl-revealed');
  window.setTimeout(() => el.classList.remove('tl-revealed'), 2200);
}
