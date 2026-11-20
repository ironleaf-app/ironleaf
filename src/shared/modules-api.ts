// The window's way to Health and Fitness and Family (Wave 5, 24 Oct 2026; src/main/modules.ts). Built by the preload
// bridge with its own invoke and subscribe, so every channel is Ironleaf's.

import type { CalendarSection, Reward } from './family';
import type { HealthDb } from './health';
import type { FamilyState, LogNoteOffer } from '../main/modules';
import type { HealthStoreStatus } from '../main/health-store';

export type HealthTable = 'measures' | 'sessions' | 'plans' | 'exercises' | 'meals' | 'appointments' | 'notes';

export function modulesApi(invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>, subscribe: <T>(channel: string, cb: (v: T) => void) => () => void) {
  return {
    health: {
      status: () => invoke<HealthStoreStatus & { words: string }>('health:status'),
      read: () => invoke<HealthDb>('health:read'),
      put: (table: HealthTable, record: Record<string, unknown>) => invoke<HealthDb>('health:put', table, record),
      remove: (table: Exclude<HealthTable, 'measures'>, id: string) => invoke<HealthDb>('health:remove', table, id),
      /** One measure's value for a day (null takes it away). */
      entry: (measure: string, day: string, value: string | number | boolean | null, note?: string) => invoke<HealthDb>('health:entry', measure, day, value, note),
      settings: (patch: Partial<Pick<HealthDb, 'profile' | 'targets' | 'checkin'>>) => invoke<HealthDb>('health:settings', patch),
      logNotes: () => invoke<LogNoteOffer[]>('health:log-notes'),
      takeIn: (paths: string[], moved: boolean) => invoke<{ words: string; notes: number; entries: number }>('health:take-in', paths, moved),
      putBack: (importId: string) => invoke<{ path: string; words: string }>('health:put-back', importId),
      exportFile: () => invoke<string | null>('health:export'),
      exportCsv: () => invoke<string | null>('health:export-csv'),
      importFile: () => invoke<string | null>('health:import'),
    },
    family: {
      state: () => invoke<FamilyState>('family:state'),
      addMember: (input: { name: string; relation?: string; born?: string; school?: string; colour?: string }) => invoke<string>('family:member-add', input),
      add: (section: CalendarSection, values: Record<string, string>) => invoke<string>('family:calendar-add', section, values),
      set: (section: CalendarSection, row: number, values: Record<string, string>) => invoke<string>('family:calendar-set', section, row, values),
      remove: (section: CalendarSection, row: number) => invoke<string>('family:calendar-remove', section, row),
      addReward: (input: { who: string; habit: string; rewards: { at: number; reward: string }[] }) => invoke<string>('family:reward-add', input),
      mark: (path: string, day: string, yes: boolean | null) => invoke<Reward>('family:reward-mark', path, day, yes),
      claim: (path: string, at: number) => invoke<void>('family:reward-claim', path, at),
      addAlbum: (name: string) => invoke<string>('family:album-add', name),
      migrateAlbums: () => invoke<string>('family:albums-migrate'),
      addPhotos: (album: string) => invoke<number>('family:photos-add', album),
    },
    /** A module tool run for the person themself (the same words the assistants get). */
    call: (name: string, args: Record<string, unknown>) => invoke<{ text: string }>('modules:call', name, args),
    /** Something a module holds changed (here, or an assistant's call). */
    onChanged: (cb: (module: string) => void) => subscribe<string>('modules:changed', cb),
    /** Open a module's page (a reminder's Windows notice was clicked). */
    onOpen: (cb: (module: string) => void) => subscribe<string>('modules:open', cb),
  };
}

export type ModulesApi = ReturnType<typeof modulesApi>;
