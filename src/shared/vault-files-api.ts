// The window's way to files done properly (Wave 4 part c, 24 Oct 2026; src/main/vault-files.ts): the Files views, a
// file's details in the peek (what it is, where it came from, its versions), adding files to a record (copied, a newer
// version, or linked where they are on the PC), big imports that carry on after a break, and the move of the flat
// attachments folder into place. Built by the preload bridge with its own invoke, so every channel is Ironleaf's.

import type { CatalogueItem, CompareResult, FileInfo, ImportState, MigrationResult } from '../main/vault-files';
import type { FileMovePlan } from './file-records';

export type { CatalogueItem, CompareResult, FileInfo, ImportState, MigrationResult };

type Invoke = <T>(channel: string, ...args: unknown[]) => Promise<T>;
type Subscribe = <T>(channel: string, callback: (payload: T) => void) => () => void;

export interface AddResult {
  placed: string[];
  importing: ImportState[];
  problems: string[];
}

export function vaultFilesApi(invoke: Invoke, subscribe: Subscribe) {
  return {
    /** Every file in the vault (or in one folder) with its record. */
    catalogue: (under?: string) => invoke<CatalogueItem[]>('vfiles:catalogue', under ?? ''),
    info: (path: string) => invoke<FileInfo>('vfiles:info', path),
    /** Where files added to this note go now. */
    folderFor: (note: string) => invoke<string>('vfiles:folder-for', note),
    set: (path: string, patch: { purpose?: string | null; title?: string | null; summary?: string | null; record?: string | null }) => invoke<FileInfo>('vfiles:set', path, patch),
    summarise: (path: string) => invoke<FileInfo>('vfiles:summarise', path),
    compare: (path: string, a: number, b: number) => invoke<CompareResult>('vfiles:compare', path, a, b),
    restore: (path: string, n: number) => invoke<FileInfo>('vfiles:restore', path, n),
    openVersion: (path: string, n: number) => invoke<void>('vfiles:open-version', path, n),
    /** A newer version chosen on this PC (null when cancelled); a big one is imported in pieces. */
    addVersion: (path: string, from?: string) => invoke<{ info: FileInfo } | { importing: ImportState } | null>('vfiles:add-version', path, from ?? null),
    /** Files added to a record: chosen in Windows' own window (no paths), or dropped (their paths). */
    add: (record: string, paths: string[] | null, same?: 'version' | 'both', how?: 'dropped' | 'added') => invoke<AddResult>('vfiles:add', record, paths, same ?? null, how ?? 'added'),
    addBytes: (record: string, name: string, bytes: Uint8Array, same?: 'version' | 'both') => invoke<{ rel: string; version: number; renamed: boolean }>('vfiles:add-bytes', record, name, bytes, same ?? null),
    /** Which of these names the record's Files folder has already. */
    taken: (record: string, names: string[]) => invoke<string[]>('vfiles:taken', record, names),
    reference: (record: string, from?: string) => invoke<{ name: string; folder: string } | null>('vfiles:reference', record, from ?? null),
    openRef: (folder: string, name: string) => invoke<void>('vfiles:open-ref', folder, name),
    showRef: (folder: string, name: string) => invoke<void>('vfiles:show-ref', folder, name),
    forgetRef: (folder: string, name: string) => invoke<void>('vfiles:forget-ref', folder, name),
    imports: () => invoke<ImportState[]>('vfiles:imports'),
    importResume: (id: string) => invoke<ImportState>('vfiles:import-resume', id),
    importStop: (id: string, cancel: boolean) => invoke<void>('vfiles:import-stop', id, cancel),
    importBegin: (o: { record?: string; name: string; size: number; same?: 'version' | 'both' }) => invoke<ImportState>('vfiles:import-begin', o),
    importPiece: (id: string, offset: number, bytes: Uint8Array) => invoke<ImportState>('vfiles:import-piece', id, offset, bytes),
    migrationPlan: () => invoke<{ plan: FileMovePlan[]; words: string; folder: string }>('vfiles:migration-plan'),
    migrationApply: (choices: Record<string, string>) => invoke<MigrationResult>('vfiles:migration-apply', choices),
    migrationUndo: () => invoke<{ words: string; back: number; problems: string[] }>('vfiles:migration-undo'),
    /** A big import's progress. */
    onProgress: (cb: (s: ImportState) => void) => subscribe<ImportState>('vfiles:progress', cb),
  };
}
