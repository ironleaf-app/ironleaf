// SPDX-License-Identifier: AGPL-3.0-or-later
// What Settings › Teams shows (types only, so the window can import them without Node).

export type TeamsStatus = 'signed-out' | 'no-teams' | 'no-team' | 'ready';
export type Role = 'owner' | 'admin' | 'member';

export interface TeamsMemberView {
  accountId: string;
  name: string;
  email: string;
  role: Role;
  me: boolean;
}

export interface TeamsVaultView {
  id: string;
  /** Its name, once this PC holds the key (sealed on the server). */
  name: string | null;
  epoch: number;
  /** A member left: an admin's Ironleaf makes a new key (it does so itself when it can). */
  rotationNeeded: boolean;
  /** This PC holds the current key. */
  hasKey: boolean;
  /** The open notes sync with this vault. */
  here: boolean;
}

export interface TeamsView {
  status: TeamsStatus;
  /** Plain sentences: a problem, what happened in the background (a key shared, a key rotated). */
  notes: string[];
  error?: string;
  teams: { id: string; name: string }[];
  team?: {
    id: string;
    name: string;
    role: Role;
    seats: number;
    seatsUsed: number;
    /** Sign-in goes through the team's own identity provider (a Zitadel organisation is connected). */
    sso: boolean;
    canAdmin: boolean;
    isOwner: boolean;
  };
  members: TeamsMemberView[];
  invites: { id: string; email: string; role: 'admin' | 'member'; expires: number }[];
  vaults: TeamsVaultView[];
  /** The open notes: whether they could become (or join) a team vault here. */
  here: { notesOpen: boolean; syncOn: boolean; teamVault: string | null };
  /** The team's policy, as it is applied here. */
  policy: { applied: boolean; words: string[]; updatedAt: number | null };
  audit: { on: boolean; waiting: number; sent: number };
  /** The OS keeps this PC's team key (safeStorage). */
  keyProtected: boolean;
}

export const EMPTY_TEAMS_VIEW: TeamsView = {
  status: 'signed-out',
  notes: [],
  teams: [],
  members: [],
  invites: [],
  vaults: [],
  here: { notesOpen: false, syncOn: false, teamVault: null },
  policy: { applied: false, words: [], updatedAt: null },
  audit: { on: false, waiting: 0, sent: 0 },
  keyProtected: true,
};
