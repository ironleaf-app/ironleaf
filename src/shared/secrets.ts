// What the window and the main side say to each other about Secrets, the scanner, levels and the audit trail (Wave 4,
// 24 Oct 2026). A secret's value never travels in these shapes except Reveal's own answer; the scanner's findings travel
// masked, with a fingerprint the main side matches again before it moves anything.

import type { SecretKind } from './secret-scan';
import type { AgentId, Level, LevelFrom } from './sensitivity';

export type SecretType = SecretKind | 'other';

export interface SecretView {
  id: string;
  name: string;
  kind: SecretType;
  username?: string;
  where?: string;
  notes?: string;
  created: number;
  modified: number;
  /** The note it was moved out of by the scanner. */
  from?: string;
  masked: string;
  length: number;
}

export interface SecretInput {
  name?: string;
  kind?: SecretType;
  value?: string;
  username?: string;
  where?: string;
  notes?: string;
}

export interface SecretsStatus {
  /** The locked store is set up in this vault (shared with Private notes: one lock). */
  exists: boolean;
  unlocked: boolean;
  hello: boolean;
  thisPc: boolean;
  count: number;
}

/** The one Locked place's state (10.0 v2locked): one lock, both counts together. */
export interface LockedStatus {
  exists: boolean;
  unlocked: boolean;
  /** Windows Hello is set up for this Windows account (an option, never required). */
  hello: boolean;
  /** This PC opens the Locked place with Windows Hello (it was added). */
  thisPc: boolean;
  /** Private notes (0 while locked) and secrets (0 while locked). */
  notes: number;
  secrets: number;
  /** When the remembered unlock ends, in milliseconds (null: until sign-out; absent: not remembered). */
  rememberedUntil?: number | null;
}

export interface ScanFindingView {
  /** Matched again by the main side before a move (never made from the value). */
  fp: string;
  kind: SecretKind;
  label: string;
  /** The name it would get in Secrets. */
  name: string;
  line: number;
  context: string;
  masked: string;
  confidence: 'high' | 'medium';
}

export interface ScanNoteView {
  path: string;
  title: string;
  level: Level;
  findings: ScanFindingView[];
}

/** A file whose name says it holds passwords (a PDF or spreadsheet can't be changed in place: set its level instead). */
export interface ScanFileView {
  path: string;
  name: string;
  level: Level;
  why: string;
}

export interface ScanReport {
  at: number;
  scanned: number;
  notes: ScanNoteView[];
  files: ScanFileView[];
  /** Findings the person said aren't secrets, left out. */
  ignored: number;
}

export interface MoveResult {
  moved: number;
  notes: number;
  /** What couldn't be moved, in words (the note changed since the scan). */
  skipped: string[];
  undoId: string | null;
}

/** One agent's row in Settings › Privacy and secrets. */
export interface AgentRow {
  id: AgentId;
  label: string;
  words: string;
  /** The levels it may read now. */
  levels: Level[];
  /** It has its own row (else it follows `follows`). */
  own: boolean;
  follows?: AgentId;
  /** A group (the side chat, a chat bot, outside agents) or one agent inside a group. */
  group: boolean;
  /** A bot: its parent group's id. */
  parent?: AgentId;
}

export interface FolderRow {
  folder: string;
  level: Level | null;
  notes: number;
  /** The level this area of life would usually have (Health → Health), offered as a suggestion. */
  suggested?: Level;
}

export interface TypeRow {
  id: string;
  name: string;
  level: Level | null;
}

export interface PrivacyState {
  rows: AgentRow[];
  folders: FolderRow[];
  types: TypeRow[];
  photos: 'ask' | 'never';
  /** How many notes, files and assets carry each level (from the index and the file). */
  counts: Record<Level, number>;
  privateNotes: { exists: boolean; unlocked: boolean; count: number; migrated?: { at: string; notes: number } };
}

export interface LevelOfView {
  level: Level;
  from: LevelFrom;
  folder?: string;
  /** Who may read it now ("The side chat", "the former host app"…), for the picker's line. */
  readers: string[];
}

export interface MigrationNote {
  path: string;
  title: string;
  size: number;
  /** The level suggested from what it says. */
  suggested: Level;
  /** Where it would go in the vault. */
  destination: string;
  /** Secrets found in it (moved into Secrets first). */
  secrets: number;
}

export interface MigrationChoice {
  path: string;
  /** Keep it as a Private note (locked, never to agents), or move it into the vault at a level. */
  keep?: boolean;
  level?: Level;
  destination?: string;
}

export interface MigrationResult {
  moved: number;
  kept: number;
  secrets: number;
  problems: string[];
  /** Where each one went. */
  placed: { from: string; to: string; level: Level }[];
}
