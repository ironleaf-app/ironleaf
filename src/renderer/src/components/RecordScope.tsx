// A record on a page (t239, 12 Nov 2026): the rows and cards that are a person, action, file, meeting, milestone,
// decision or risk say which record they are, so a click opens its document instead of an edit field. Editing stays
// where it was, made deliberate: the pencil over a value, a double-click, or E (F2) with the value focused
// (views/project/Inline.tsx reads the record from here). Space or Enter on a focused value opens the document.

import { createContext, useContext, type ReactNode } from 'react';
import type { RecordRef } from '../../../shared/records';
import { peek } from '../state/peek';

const RecordContext = createContext<RecordRef | null>(null);

/** The record the values inside belong to. */
export function RecordScope({ at, children }: { at: RecordRef | null | undefined; children: ReactNode }) {
  return <RecordContext.Provider value={at ?? null}>{children}</RecordContext.Provider>;
}

export const useRecord = () => useContext(RecordContext);

/** Whether a click lands on something with a job of its own (a tick box, a menu, a link, a field, a grip). */
export function ownJob(e: React.MouseEvent | MouseEvent): boolean {
  const t = e.target as Element | null;
  if (!t?.closest) return true;
  if (t.closest('button, a, input, select, textarea, label, [role="menuitem"], [role="slider"], [role="checkbox"], [contenteditable="true"], .pj-ed-input, .pj-ed-empty, .no-peek, .rec-pencil')) return true;
  return !!window.getSelection()?.toString();
}

/** A row or card that is a record: a click on it (not on one of its controls) opens its document. */
export function peekRow(at: RecordRef | null | undefined): { onClick?: (e: React.MouseEvent) => void; 'data-rec'?: string } {
  if (!at) return {};
  return {
    'data-rec': at.id ?? at.type ?? 'record',
    onClick: (e: React.MouseEvent) => {
      if (e.defaultPrevented || ownJob(e)) return;
      peek(at);
    },
  };
}
