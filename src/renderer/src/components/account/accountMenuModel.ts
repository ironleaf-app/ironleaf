// SPDX-License-Identifier: AGPL-3.0-or-later The account chip at the foot of the side bar and its menu, as data (20 Nov
// 2026). One row says who is signed in and on which plan (or that signing in is optional); its menu holds the account,
// Settings and About and updates, which used to be three separate doors in the foot. No React and no window here, so
// every state is checked (tests/account-menu.test.mjs); AccountMenu.tsx draws it from the shared account view and the
// update state.
import type { UpdateState } from '../../../../main/update-check';
import { accountScreen, entitlementsOf, type AccountView } from '../../../../shared/account';
import { updateNudge } from '../../lib/aboutStatus';

export type ChipKind = 'in' | 'out' | 'busy' | 'local';

export interface AccountChip {
  kind: ChipKind;
  /** Two letters for the avatar when signed in; '' draws the neutral avatar. */
  initials: string;
  /** Line one: the person's name (else their email), or "Sign in". */
  name: string;
  /** Line two: the plan ("Community", "Supporter", "Sync", "Teams · Acme"), or why to sign in. */
  sub: string;
  email?: string;
  supporter: boolean;
  /** An update is waiting (ready to install, or newly available and not put off): the avatar carries the dot. */
  dot: boolean;
  /** What a screen reader hears on the row. */
  label: string;
}

export type AccountMenuId = 'sign-in' | 'cancel' | 'account' | 'billing' | 'settings' | 'about' | 'sign-out';

export type AccountMenuEntry =
  | { id: AccountMenuId; label: string; icon?: 'person' | 'wallet' | 'settings' | 'info' | 'close'; hint?: string; dot?: boolean; external?: boolean; hotkey?: string }
  | { separator: true };

export const SIGNED_OUT_SUB = 'Optional: for Sync and Teams';

export const initialsOf = (words: string): string =>
  words
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** The plan in one short line: Teams names its team, Sync, a plan the cloud names, else Supporter or Community. */
export function planLine(view: AccountView | null | undefined): string {
  if (!view) return 'Community';
  const ents = entitlementsOf(view);
  if (ents.includes('teams')) {
    const team = view.me?.teams?.find((t) => t.name)?.name;
    return team ? `Teams · ${team}` : 'Teams';
  }
  if (ents.includes('sync')) return 'Sync';
  const plan = accountScreen(view).plan;
  if (plan && plan !== 'Community' && plan !== 'Supporter') return plan;
  return ents.includes('supporter') ? 'Supporter' : 'Community';
}

/** What the foot's row shows. */
export function accountChip(view: AccountView | null | undefined, update: UpdateState | null = null): AccountChip {
  const dot = updateNudge(update).dot;
  const screen = accountScreen(view);
  const supporter = entitlementsOf(view).includes('supporter');
  const status = view?.status ?? 'signed-out';
  if (status === 'signed-in') {
    const name = screen.name || screen.email || 'Your account';
    const sub = planLine(view);
    return { kind: 'in', initials: initialsOf(screen.name || screen.email || ''), name, sub, ...(screen.email ? { email: screen.email } : {}), supporter, dot, label: `${name}, ${sub}. Account menu` };
  }
  if (status === 'signing-in') return { kind: 'busy', initials: '', name: 'Signing in…', sub: 'Finish in your browser', supporter, dot, label: 'Signing in, finish in your browser. Account menu' };
  if (status === 'off' || status === 'unconfigured') {
    const sub = status === 'off' ? 'Turned off on this PC' : 'Not set up in this build';
    return { kind: 'local', initials: '', name: 'Account', sub, supporter, dot, label: `Account, ${sub.toLowerCase()}. Account menu` };
  }
  return { kind: 'out', initials: '', name: 'Sign in', sub: SIGNED_OUT_SUB, supporter, dot, label: `Sign in, ${SIGNED_OUT_SUB.toLowerCase()}. Account menu` };
}

/** The About row's quiet word on the right when there is an update. */
export function updateHint(update: UpdateState | null): string | undefined {
  const a = update?.available;
  if (!update || !a) return undefined;
  if (update.stage === 'ready') return 'Restart to update';
  if (update.stage === 'downloading' || update.stage === 'verifying') return 'Downloading';
  return a.dismissed ? undefined : 'Update available';
}

/** The menu's rows, top to bottom (the header with the name, email and plan is drawn above them when signed in). */
export function accountMenuEntries(view: AccountView | null | undefined, update: UpdateState | null, version: string): AccountMenuEntry[] {
  const status = view?.status ?? 'signed-out';
  const v = version || update?.current || '';
  const hint = updateHint(update);
  const about: AccountMenuEntry = { id: 'about', label: v ? `About and updates · ${v}` : 'About and updates', icon: 'info', ...(hint ? { hint } : {}), ...(updateNudge(update).dot ? { dot: true } : {}) };
  const settings: AccountMenuEntry = { id: 'settings', label: 'Settings', icon: 'settings', hotkey: 'Mod+,' };
  if (status === 'signed-in') {
    const screen = accountScreen(view);
    return [
      { id: 'account', label: 'Account and plan', icon: 'person' },
      ...(screen.billing ? [{ id: 'billing', label: 'Manage billing', icon: 'wallet', external: true } as const] : []),
      settings,
      about,
      { separator: true },
      { id: 'sign-out', label: 'Sign out' },
    ];
  }
  if (status === 'signing-in') return [{ id: 'cancel', label: 'Cancel signing in', icon: 'close' }, { id: 'account', label: 'Account and plan', icon: 'person' }, { separator: true }, settings, about];
  if (status === 'off' || status === 'unconfigured') return [{ id: 'account', label: 'Account and plan', icon: 'person' }, settings, about];
  return [{ id: 'sign-in', label: 'Sign in…', icon: 'person' }, { separator: true }, settings, about];
}
