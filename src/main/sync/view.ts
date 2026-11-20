// What Settings › Ironleaf Sync shows (types only, so the window can import them without Node).

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'paused' | 'offline' | 'error' | 'stopped' | 'read-only';

export interface SyncDeviceView {
  id: string;
  name: string;
  lastSeen: number;
  me: boolean;
}

export interface SyncView {
  /** Signed in to an Ironleaf account. */
  signedIn: boolean;
  /** The account has Sync. */
  entitled: boolean;
  /** Sign-in can be started from Settings. */
  canSignIn: boolean;
  /** Checkout for Sync can be opened from Settings (signed in, not entitled). */
  canUpgrade: boolean;
  /** No notes folder open. */
  noVault: boolean;
  on: boolean;
  /** These notes sync with a team vault (Settings › Teams), not the person's own. */
  team?: boolean;
  /** The account already has a sync vault (join it rather than make another). */
  existing: boolean;
  phase: SyncPhase;
  error: string;
  lastOk: number;
  /** Changes here not on the server yet, plus server changes not applied here yet. */
  waiting: number;
  conflicts: number;
  /** Files that couldn't be read (left out and counted). */
  skipped: number;
  excluded: string[];
  usage: { bytes: number; quota: number; devices: number; maxDevices: number } | null;
  devices: SyncDeviceView[];
}

export interface SyncJoin {
  passphrase?: string;
  recovery?: string;
  /** With the recovery key: the new passphrase it is sealed with from now on. */
  newPassphrase?: string;
}
