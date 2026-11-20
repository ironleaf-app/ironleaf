// The window's way to the vault-as-a-life-OS side (Wave 4, 24 Oct 2026; src/main/life.ts): areas, the move into areas,
// People and Organisations, the Inbox and the tag manager. Built by the preload bridge with its own invoke, so every
// channel is Ironleaf's (nv:…).

import type { Area } from './areas';
import type { FoldPlan, FoldState } from './area-fold';
import type { MigrationPlan } from './area-migration';
import type { FilingTarget, InboxItem, InboxSuggestion } from './inbox';
import type { CardSuggestion, MergePreview, PersonCard, SamePerson } from './people';
import type { TagUse } from './tags';

export interface MigrationApplied {
  moved: number;
  files: number;
  linksUpdated: number;
  linksPinned: number;
  followed: number;
  emptied: string[];
  problems: string[];
  safety: string;
  words: string;
}

export interface MigrationLast {
  file: string;
  at: string;
  words: string;
  undone: boolean;
  safety: string;
  moves: number;
}

export interface MakeCard {
  id?: string;
  name: string;
  type?: 'person' | 'org';
  role?: string;
  area?: string;
  projects?: string[];
}

/** What a make-cards run did: the cards it made, and the names it skipped because a card already exists. */
export interface MakeCardsResult {
  made: string[];
  skipped: string[];
}

export function lifeApi(invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>) {
  return {
    areas: {
      /** The vault's areas file ('' when it isn't organised by area yet). */
      load: () => invoke<string>('areas:load'),
      save: (text: string) => invoke<void>('areas:save', text),
      renameFolder: (from: string, to: string) => invoke<{ path: string; linksUpdated: number }>('areas:rename-folder', from, to),
      /** Folding one area into another (9 Nov 2026): its preview, run, one Undo per fold, and state. */
      foldPreview: (from: string, toArea: string) => invoke<FoldPlan>('areas:fold-preview', from, toArea),
      foldRun: (from: string, toArea: string) => invoke<string>('areas:fold-run', from, toArea),
      foldUndo: () => invoke<string>('areas:fold-undo'),
      foldState: () => invoke<FoldState>('areas:fold-state'),
    },
    migration: {
      plan: (areasText?: string) => invoke<{ plan: MigrationPlan; areas: Area[]; words: string }>('areas:migration-plan', areasText ?? ''),
      apply: (choices: Record<string, string>, areasText: string) => invoke<MigrationApplied>('areas:migration-apply', choices, areasText),
      undo: () => invoke<{ back: number; problems: string[]; words: string }>('areas:migration-undo'),
      last: () => invoke<MigrationLast | null>('areas:migration-last'),
    },
    people: {
      cards: () => invoke<PersonCard[]>('people:cards'),
      card: (id: string) => invoke<PersonCard | null>('people:card', id),
      suggestions: () => invoke<CardSuggestion[]>('people:suggestions'),
      make: (list: MakeCard[]) => invoke<MakeCardsResult>('people:make', list),
      same: () => invoke<SamePerson[]>('people:same'),
      notSame: (a: string, b: string) => invoke<void>('people:not-same', a, b),
      /** What a merge would move: notes, meetings, mentions, links and tasks owned. */
      mergePreview: (keep: string, other: string) => invoke<MergePreview>('people:merge-preview', keep, other),
      merge: (keep: string, other: string) => invoke<{ path: string; words: string }>('people:merge', keep, other),
      /** The last merge undone (one slot: merging again replaces it). */
      mergeUndo: () => invoke<{ words: string }>('people:merge-undo'),
    },
    inbox: {
      list: () => invoke<{ items: InboxItem[]; suggestions: Record<string, InboxSuggestion[]> }>('inbox:list'),
      file: (id: string, target: FilingTarget) => invoke<{ words: string; paths: string[]; undo?: string }>('inbox:file', id, target),
      done: (id: string) => invoke<{ words: string }>('inbox:done', id),
      /** A line deleted in one step (kept under Deleted in the Inbox note). */
      remove: (id: string) => invoke<{ words: string }>('inbox:delete', id),
      /** Sure captures filed straight there, with one Undo for the batch (lines only). */
      autoFile: () => invoke<{ filed: { id: string; name: string }[]; proposals: Record<string, { target: FilingTarget; why: string; sure: boolean }[]>; model: boolean; words: string; undo: string | null; ms: number }>('inbox:auto-file'),
      /** One Undo for what filed itself. */
      undoAuto: (id: string) => invoke<{ words: string }>('inbox:undo-auto', id),
    },
    tags: {
      list: () => invoke<TagUse[]>('tags:list'),
      rename: (from: string, to: string) => invoke<{ notes: number; words: string }>('tags:rename', from, to),
      remove: (tag: string) => invoke<{ notes: number; words: string }>('tags:remove', tag),
    },
    /** The front door for email and PDF (t243): land one, answer the one question, save from mail. */
    intake: {
      email: (name: string, bytes: Uint8Array) => invoke<LandedArrival>('intake:email', name, bytes),
      paste: (text: string) => invoke<LandedArrival>('intake:paste', text),
      pdf: (name: string, bytes: Uint8Array) => invoke<LandedArrival>('intake:pdf', name, bytes),
      /** A PDF kept from a file on this PC (chosen from a project's linked folder). */
      pdfFrom: (absolutePath: string) => invoke<LandedArrival>('intake:pdf-from', absolutePath),
      /** The one question answered: filed under the project, the next step made a Task (or none). */
      answer: (id: string, project: string, step: string) => invoke<{ words: string; paths: string[]; undo?: string }>('intake:answer', id, project, step),
      /** The person's mailboxes through the former host app's connection ([] standalone). */
      mailboxes: () => invoke<MailBox[]>('intake:mailboxes'),
      mailList: (mailbox: string, limit?: number) => invoke<MailRow[]>('intake:mail-list', mailbox, limit ?? 15),
      mailSave: (mailbox: string, uid: number) => invoke<LandedArrival>('intake:mail-save', mailbox, uid),
    },
  };
}

/** An email or PDF landed in the Inbox, with its sender and where it probably goes. */
export interface LandedArrival {
  id: string;
  path: string;
  title: string;
  person: { name: string; path: string } | null;
  /** The sender's card, when one was made for a stranger. */
  madeCard: string | null;
  suggestions: InboxSuggestion[];
}

export interface MailBox {
  id: string;
  label: string;
  address: string;
}

export interface MailRow {
  uid: number;
  from: string;
  date: string;
  subject: string;
  words: string;
  unread: boolean;
}

export type LifeApi = ReturnType<typeof lifeApi>;
