// The update card on Settings › About and updates (20 Nov 2026), as data: for each place the update can be at
// (src/main/update-check.ts's UpdateState, plus the page's own "a check is running" and "that check got no answer"),
// the words, the one primary button and what it does, the quieter second button, and the progress bar. No React and
// no window here, so every stage is checked (tests/about-status.test.mjs); components/about/AboutPage.tsx draws it.
import type { UpdateState } from '../../../main/update-check';

export type CardAction = 'check' | 'download' | 'install' | 'website' | 'none';
export type CardTone = 'idle' | 'ok' | 'news' | 'busy' | 'ready' | 'error';

export interface UpdateCard {
  /** A short name for the stage (the screenshots and the checks read it as data-stage). */
  stage: 'unavailable' | 'never' | 'checking' | 'current' | 'check-failed' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'download-failed' | 'install-failed' | 'updated';
  tone: CardTone;
  title: string;
  detail: string;
  /** The release notes to show under the words (the new version's, or the one just installed), or ''. */
  notes: string;
  notesVersion: string;
  primary: { label: string; action: CardAction; disabled?: boolean } | null;
  secondary: { label: string; action: CardAction } | null;
  /** 0 to 100 while downloading or checking the download, else null. */
  progress: number | null;
}

export interface CardContext {
  /** A check the person started is running. */
  checking: boolean;
  /** The check the person started last got no answer from the website. */
  checkFailed: boolean;
  now: number;
}

const mb = (n: number) => (n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1);

/** "just now", "2 min ago", "3 h ago", "yesterday", "on 14 Nov". */
export function ago(iso: string | null, now: number): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return 'yesterday';
  return 'on ' + new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

/** "20 November 2026" from YYYY-MM-DD (read as that day, wherever the PC is). */
export function longDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const website = { label: 'Download from the website', action: 'website' as const };

export function updateCard(state: UpdateState | null, ctx: CardContext): UpdateCard {
  const base = { notes: '', notesVersion: '', secondary: null, progress: null };
  if (!state) {
    return { ...base, stage: 'unavailable', tone: 'idle', title: 'Updates come from the website', detail: 'This copy of Ironleaf does not check for updates itself.', primary: { label: 'Open the download page', action: 'website' } };
  }
  const a = state.available;
  const checked = ago(state.checkedAt, ctx.now);
  const check = { label: 'Check for updates', action: 'check' as const };

  // The download or the install is under way: that is the news, whatever else is true.
  if (a && state.stage === 'downloading') {
    const p = state.progress;
    const pct = p && p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
    return { ...base, stage: 'downloading', tone: 'busy', title: `Downloading Ironleaf ${a.version}`, detail: p && p.total ? `${mb(p.received)} of ${mb(p.total)} MB${p.differential ? ' (only what changed)' : ''}` : 'Starting the download…', notes: a.notes, notesVersion: a.version, primary: { label: 'Downloading…', action: 'none', disabled: true }, progress: pct };
  }
  if (a && state.stage === 'verifying') {
    return { ...base, stage: 'verifying', tone: 'busy', title: `Checking the download of ${a.version}`, detail: 'Making sure the file is exactly the one Ironleaf published.', notes: a.notes, notesVersion: a.version, primary: { label: 'Checking…', action: 'none', disabled: true }, progress: 100 };
  }
  if (a && state.stage === 'ready') {
    return { ...base, stage: 'ready', tone: 'ready', title: `Ironleaf ${a.version} is ready to install`, detail: state.installsOnQuit ? 'Restart now, or it installs the next time you quit. Your notes are saved first.' : 'Ironleaf starts again in the new version. Your notes are saved first.', notes: a.notes, notesVersion: a.version, primary: { label: 'Restart to update', action: 'install' } };
  }
  if (a && state.stage === 'installing') {
    return { ...base, stage: 'installing', tone: 'busy', title: `Restarting to update to ${a.version}…`, detail: 'Saving your notes, then Ironleaf closes and opens again.', notes: '', notesVersion: '', primary: { label: 'Restarting…', action: 'none', disabled: true } };
  }
  if (ctx.checking) {
    return { ...base, stage: 'checking', tone: 'busy', title: 'Checking for updates…', detail: 'Asking ironleaf.kaitiaki-it.com for the newest version.', primary: { label: 'Checking…', action: 'none', disabled: true } };
  }
  // The last install did not land: this version still works.
  if (state.failed && state.stage === 'idle') {
    return { ...base, stage: 'install-failed', tone: 'error', title: `Ironleaf ${state.failed.version} could not be installed`, detail: `${state.failed.words} You are still on ${state.current}, which works as before.`, primary: a?.canInstall ? { label: 'Try again', action: 'download' } : check, secondary: website };
  }
  if (a && state.error && state.missing) {
    return { ...base, stage: 'download-failed', tone: 'idle', title: `Ironleaf ${a.version} is not ready to download yet`, detail: state.error, notes: a.notes, notesVersion: a.version, primary: check };
  }
  if (a && state.error) {
    return { ...base, stage: 'download-failed', tone: 'error', title: `Ironleaf ${a.version} could not be downloaded`, detail: state.error, notes: a.notes, notesVersion: a.version, primary: { label: 'Try again', action: a.canInstall ? 'download' : 'website' }, secondary: website };
  }
  if (a) {
    const size = a.size ? ` · ${mb(a.size)} MB` : '';
    const when = a.date ? `released ${longDate(a.date)}` : 'a newer version';
    return { ...base, stage: 'available', tone: 'news', title: `Ironleaf ${a.version} is available`, detail: `You have ${state.current}. ${when.charAt(0).toUpperCase() + when.slice(1)}${size}.`, notes: a.notes, notesVersion: a.version, primary: a.canInstall ? { label: 'Update now', action: 'download' } : { label: 'Download', action: 'website' } };
  }
  if (ctx.checkFailed) {
    return { ...base, stage: 'check-failed', tone: 'error', title: 'Ironleaf could not check for updates', detail: `The update site did not answer. Check that this PC is online, then try again.${checked ? ` Last checked ${checked}.` : ''}`, primary: { label: 'Try again', action: 'check' }, secondary: website };
  }
  if (state.updated) {
    return { ...base, stage: 'updated', tone: 'ok', title: `Updated to ${state.updated.version}`, detail: `${state.updated.from ? `From ${state.updated.from}. ` : ''}Everything is where you left it.`, notes: state.updated.notes, notesVersion: state.updated.version, primary: check };
  }
  if (state.checkedAt) {
    return { ...base, stage: 'current', tone: 'ok', title: 'You’re up to date', detail: `Ironleaf ${state.current} is the newest version · checked ${checked}`, primary: check };
  }
  return { ...base, stage: 'never', tone: 'idle', title: 'Check for updates', detail: state.enabled ? 'Ironleaf looks once a day. Nothing about you or your notes is sent.' : 'Automatic checks are off. Check whenever you like.', primary: check };
}

/** The one line the sidebar and the palette say about updates, or '' when there is nothing to say. */
export function updateNudge(state: UpdateState | null): { words: string; dot: boolean } {
  const a = state?.available;
  if (!state || !a) return { words: '', dot: false };
  if (state.stage === 'ready') return { words: `Ironleaf ${a.version} is ready: restart to update`, dot: true };
  if (state.stage === 'downloading' || state.stage === 'verifying') return { words: `Downloading Ironleaf ${a.version}`, dot: false };
  return { words: `Ironleaf ${a.version} is available`, dot: !a.dismissed };
}
