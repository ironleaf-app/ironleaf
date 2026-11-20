// The window's way to Publications (Wave 6 part a, 24 Oct 2026; src/main/publications.ts). Built by the preload bridge
// with its own invoke, so every channel is Ironleaf's.

import type { LaidOut } from './edition-doc';
import type { EditionDetail, PubState } from '../main/publications';
import type { PrinterInfo } from '../main/edition-print';
import type { ImportPlan, ItemInput, PublicationInput, SearchHit, Section } from './publications';
import type { Puzzle } from './puzzles';

export function publicationsApi(invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>) {
  return {
    state: (pub?: string) => invoke<PubState>('pub:state', pub ?? ''),
    edition: (rel: string) => invoke<EditionDetail>('pub:edition', rel),
    preview: (rel: string, picked?: string) => invoke<{ url: string }>('pub:preview', rel, picked ?? ''),
    build: (rel: string) => invoke<{ pdf: string; laidOut: LaidOut; words: string }>('pub:build', rel),
    exportPdf: (rel: string) => invoke<string | null>('pub:export', rel),
    deliver: (rel: string, how?: string[]) => invoke<string>('pub:deliver', rel, how ?? []),
    printers: () => invoke<PrinterInfo[]>('pub:printers'),
    create: (input: PublicationInput) => invoke<string>('pub:create', input),
    set: (rel: string, patch: Record<string, unknown>) => invoke<void>('pub:set', rel, patch),
    sections: (rel: string, sections: Section[]) => invoke<void>('pub:sections', rel, sections),
    pickFile: (rel: string, kind: 'picture' | 'font') => invoke<string | null>('pub:pick-file', rel, kind),
    newEdition: (rel: string, o: { date?: string; number?: number; copyFrom?: string } = {}) => invoke<string>('pub:edition-new', rel, o),
    setEdition: (rel: string, patch: { sections?: { name: string; items: string[] }[]; template?: string; date?: string; number?: number; status?: string }) => invoke<void>('pub:edition-set', rel, patch),
    addItem: (rel: string, input: Partial<ItemInput>) => invoke<string>('pub:item-add', rel, input),
    pickPicture: (rel: string) => invoke<string | null>('pub:pick-picture', rel),
    makePuzzle: (input: Record<string, unknown>) => invoke<{ puzzle: Puzzle; problems: string[]; words: string }>('pub:puzzle-make', input),
    savePuzzle: (rel: string, o: { puzzle: Puzzle; title?: string; section?: string }) => invoke<string>('pub:puzzle-save', rel, o),
    solve: (rel: string, o: { who: string; time: string; day?: string; note?: string }) => invoke<string>('pub:solve', rel, o),
    search: (query: string, pub?: string) => invoke<SearchHit[]>('pub:search', query, pub ?? ''),
    importPlan: (rel: string) => invoke<ImportPlan>('pub:import-plan', rel),
    importApply: (rel: string, choice: { editions?: number[]; sections?: Section[] }) => invoke<string>('pub:import-apply', rel, choice),
  };
}

export type PublicationsApi = ReturnType<typeof publicationsApi>;
