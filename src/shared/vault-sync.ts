// This PC's sync state for the open vault (24 Oct 2026, WS1 step 0: "a sync line in Settings and on Today shows this PC's
// state ('Up to date with Office-PC', 'OneDrive paused', '3 files only in the cloud') and offers to fix it"). The facts are
// gathered on the main side without admin rights (src/main/vault-sync.ts): whether OneDrive is running, whether this PC's
// own small files in the vault went up, which files are only in the cloud (Windows' offline attribute), the conflict
// copies OneDrive or Dropbox made beside a file, and when each of the person's other PCs last had the vault open (each PC
// writes .neuralvault/pcs/<its id>.json now and then; they arrive through the same sync as the notes). This file turns
// the facts into the words, and finds the conflict copies by their names.

export type SyncTone = 'ok' | 'info' | 'warn' | 'bad';
export type SyncFixId = 'start-onedrive' | 'show-onedrive' | 'keep-here' | 'conflicts';

export interface ConflictCopy {
  /** The copy (path in the vault). */
  copy: string;
  /** The file it is a copy of. */
  original: string;
  /** The PC whose version it is, as the name says (OneDrive puts the computer's name in it). */
  pc: string | null;
  service: 'onedrive' | 'dropbox' | 'sync';
  /** A note (Markdown): its lines can be merged into the original. */
  note: boolean;
}

export interface OtherPc {
  name: string;
  /** When it last said it had this vault open (its file in .neuralvault/pcs, as it arrived here). */
  at: number;
  /** The former host app's computer list says it is on now (null: not known). */
  online: boolean | null;
  /** The former host app's computer list says which vault it has open: this one (true), another (false), not known (null). */
  sameVault: boolean | null;
}

export interface SyncFacts {
  place: { kind: string; name: string };
  /** Windows' facts (OneDrive running, files only in the cloud) could be looked at. */
  windows: boolean;
  /** OneDrive (only for a vault in OneDrive, on Windows): running, minutes this PC's own file has waited to go up, a
   *  problem it shows. */
  oneDrive: { running: boolean | null; pendingMinutes: number | null; error: boolean } | null;
  /** downloading: the person chose Keep on this PC lately, so they are on their way. */
  cloudOnly: { count: number; notes: number; sample: string[]; downloading?: boolean } | null;
  conflicts: ConflictCopy[];
  others: OtherPc[];
  now: number;
}

export interface SyncFix {
  id: SyncFixId;
  label: string;
}

export interface SyncItem {
  id: 'place' | 'onedrive-off' | 'onedrive-error' | 'paused' | 'waiting' | 'conflicts' | 'cloud' | 'up-to-date';
  tone: SyncTone;
  title: string;
  words: string;
  fix: SyncFix | null;
}

export interface SyncView {
  /** The line: the most pressing item (or "Up to date with …"). */
  main: SyncItem;
  /** Everything else worth saying, most pressing first. */
  more: SyncItem[];
  conflicts: ConflictCopy[];
  cloudOnly: SyncFacts['cloudOnly'];
  place: SyncFacts['place'];
  checkedAt: number;
}

/** A conflict-copy merge or keep, done. */
export interface SyncFixDone {
  words: string;
}

const MIN = 60_000;
/** This PC's own file waiting this long to go up means OneDrive isn't syncing (paused, or stuck). */
export const PAUSED_AFTER_MIN = 5;
/** Another PC's file this old while the former host app says that PC has the vault open: its changes aren't
arriving. */
export const WAITING_AFTER_MIN = 30;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-AU')} ${n === 1 ? one : many}`;

export function agoWords(ms: number): string {
  if (ms < 2 * MIN) return 'just now';
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const listWords = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

const RANK: Record<SyncTone, number> = { bad: 0, warn: 1, info: 2, ok: 3 };

/** The words for this PC's sync state. */
export function syncView(f: SyncFacts): SyncView {
  const items: SyncItem[] = [];
  const kind = f.place.kind;
  const synced = kind !== 'local' && kind !== 'network';
  if (kind === 'local') items.push({ id: 'place', tone: 'warn', title: 'Only on this PC', words: 'This vault isn’t in a folder OneDrive, Google Drive or Dropbox syncs, so your other PCs can’t open it.', fix: null });
  if (kind === 'network') items.push({ id: 'place', tone: 'info', title: 'On a network drive', words: 'Every PC that reaches the drive opens this same vault.', fix: null });
  const od = f.oneDrive;
  if (od?.running === false) items.push({ id: 'onedrive-off', tone: 'bad', title: 'OneDrive isn’t running', words: 'Changes on this PC aren’t going to your other PCs, and theirs aren’t arriving here.', fix: { id: 'start-onedrive', label: 'Start OneDrive' } });
  else if (od?.error) items.push({ id: 'onedrive-error', tone: 'bad', title: 'OneDrive can’t sync this vault', words: 'OneDrive shows a problem with this vault’s files. Open it to see what it needs.', fix: { id: 'show-onedrive', label: 'Open OneDrive' } });
  else if (od?.pendingMinutes !== null && od?.pendingMinutes !== undefined && od.pendingMinutes >= PAUSED_AFTER_MIN)
    items.push({ id: 'paused', tone: 'warn', title: 'OneDrive paused', words: `What this PC saved ${agoWords(od.pendingMinutes * MIN)} hasn’t gone up yet. Resume syncing from the OneDrive cloud by the clock.`, fix: { id: 'show-onedrive', label: 'Open OneDrive' } });
  const late = f.others.filter((o) => o.online === true && o.sameVault !== false && f.now - o.at > WAITING_AFTER_MIN * MIN);
  if (synced && late.length && !items.some((i) => i.tone === 'bad'))
    items.push({ id: 'waiting', tone: 'warn', title: `Waiting for ${late[0].name}’s changes`, words: `${late[0].name} has this vault open, but nothing it saved since ${agoWords(f.now - late[0].at)} has arrived here. Check ${f.place.name} on ${late[0].name}.`, fix: null });
  if (f.conflicts.length) {
    const notes = f.conflicts.filter((c) => c.note).length;
    const what = notes === f.conflicts.length ? (notes === 1 ? 'a note' : `${notes} notes`) : f.conflicts.length === 1 ? 'a file' : `${f.conflicts.length} files`;
    items.push({ id: 'conflicts', tone: 'warn', title: plural(f.conflicts.length, 'conflict copy', 'conflict copies'), words: `${f.conflicts[0].service === 'dropbox' ? 'Dropbox' : f.conflicts[0].service === 'sync' ? 'Syncing with the other PC' : 'OneDrive'} kept two versions of ${what} changed on two PCs at once. Merge them into one, keeping every line, or keep both.`, fix: { id: 'conflicts', label: 'Review…' } });
  }
  if (f.cloudOnly && f.cloudOnly.count > 0 && f.cloudOnly.downloading)
    items.push({ id: 'cloud', tone: 'info', title: `Downloading ${plural(f.cloudOnly.count, 'file')}`, words: `${f.place.name === 'OneDrive' ? 'OneDrive' : f.place.name} is bringing the rest of the vault to this PC, and keeps it here from now on.`, fix: null });
  else if (f.cloudOnly && f.cloudOnly.count > 0)
    items.push({ id: 'cloud', tone: 'info', title: `${plural(f.cloudOnly.count, 'file')} only in the cloud`, words: `${f.cloudOnly.notes ? `${plural(f.cloudOnly.notes, 'note')} among them. ` : ''}They open more slowly, and not at all while this PC is offline. Keep the whole vault on this PC to have them all here.`, fix: { id: 'keep-here', label: 'Keep on this PC' } });
  if (synced) {
    const seen = [...f.others].sort((a, b) => b.at - a.at);
    if (seen.length) {
      const now = seen.filter((o) => f.now - o.at < WAITING_AFTER_MIN * MIN && o.online !== false);
      const first = seen[0];
      items.push({
        id: 'up-to-date',
        tone: 'ok',
        title: `Up to date with ${listWords(seen.slice(0, 2).map((o) => o.name))}${seen.length > 2 ? ` and ${plural(seen.length - 2, 'other PC')}` : ''}`,
        words: now.length ? `${listWords(now.slice(0, 2).map((o) => o.name))} ${now.length === 1 ? 'has' : 'have'} this vault open now, through ${f.place.name}.` : `${first.name} last had this vault open ${agoWords(f.now - first.at)}. Everything it saved came through ${f.place.name}.`,
        fix: null,
      });
    } else items.push({ id: 'up-to-date', tone: 'ok', title: `Synced with ${f.place.name}`, words: 'No other PC has opened this vault yet. When one does, it shows here.', fix: null });
  }
  items.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
  // The line is the most pressing problem, else "Up to date"; a note worth knowing (files only in the cloud) goes under it.
  const problem = items.find((i) => i.tone === 'bad' || i.tone === 'warn');
  const main = problem ?? items.find((i) => i.tone === 'ok') ?? items[0] ?? { id: 'up-to-date', tone: 'ok', title: 'Up to date', words: '', fix: null };
  // "Up to date" isn't said beside a problem that means it isn't.
  const more = items.filter((i) => i !== main && !(problem && i.id === 'up-to-date' && (problem.tone === 'bad' || problem.id === 'paused' || problem.id === 'waiting' || problem.id === 'conflicts')));
  return { main, more, conflicts: f.conflicts, cloudOnly: f.cloudOnly, place: f.place, checkedAt: f.now };
}

// ── Conflict copies, by their names ──────────────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Windows' own names for a new PC (DESKTOP-4KQ2J7M, LAPTOP-8H3D9F2A): taken as a PC's name even when it isn't known. */
const WINDOWS_NAME = /-((?:DESKTOP|LAPTOP)-[A-Z0-9]{4,10})(?:-\d{1,3})?$/i;

/** The conflict copies among a vault's files: OneDrive's "<name>-<PC name>.<ext>" (and "-<PC name>-2"), for the person's
 *  PCs' names (or Windows' own names for a new PC); Dropbox's "<name> (<who>'s conflicted copy <day>).<ext>"; the PC
 *  sync's own "<name> (conflict, <when>, from <who>).<ext>" (src/main/sync-folder.ts conflictName). Only a copy whose
 *  original is beside it counts. Ironleaf's own folder (its settings merge by themselves) and a Git backup's are
 *  left out. */
export function findConflictCopies(paths: string[], pcNames: string[]): ConflictCopy[] {
  const all = new Map(paths.map((p) => [p.toLowerCase(), p]));
  const names = [...new Set(pcNames.map((n) => n.trim()).filter((n) => n.length >= 2 && n.length <= 63))].sort((a, b) => b.length - a.length);
  const pcRes = names.map((n) => ({ name: n, re: new RegExp(`-(${esc(n)})(?:-\\d{1,3})?$`, 'i') }));
  const out: ConflictCopy[] = [];
  for (const p of paths) {
    if (/^\.(neuralvault|git)(\/|$)/i.test(p) || /(^|\/)\.git\//.test(p)) continue;
    const slash = p.lastIndexOf('/');
    const dir = slash >= 0 ? p.slice(0, slash + 1) : '';
    const base = p.slice(slash + 1);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    const found = (origStem: string, pc: string | null, service: ConflictCopy['service']) => {
      const original = all.get(`${dir}${origStem}${ext}`.toLowerCase());
      if (!original || original === p) return false;
      out.push({ copy: p, original, pc, service, note: /\.(md|markdown)$/i.test(ext) });
      return true;
    };
    const drop = /^(.*) \((?:(.+?)['’]s )?conflicted copy(?: \d{4}-\d{2}-\d{2})?(?: \(\d+\))?\)$/i.exec(stem);
    if (drop && found(drop[1], drop[2] ?? null, 'dropbox')) continue;
    const own = /^(.*) \(conflict, \d{1,2} [A-Za-z]{3} \d{4} \d{1,2}\.\d{2} [ap]m, from (.+)\)$/.exec(stem);
    if (own && found(own[1], own[2].trim() || null, 'sync')) continue;
    let done = false;
    for (const { name, re } of pcRes) {
      const m = re.exec(stem);
      if (m && found(stem.slice(0, m.index), name, 'onedrive')) {
        done = true;
        break;
      }
    }
    if (done) continue;
    const w = WINDOWS_NAME.exec(stem);
    if (w) found(stem.slice(0, w.index), w[1].toUpperCase(), 'onedrive');
  }
  return out.sort((a, b) => a.copy.localeCompare(b.copy));
}

/** "Keep both": the copy's new name, which says whose it is and is no longer taken for a conflict copy. */
export function keptName(c: ConflictCopy, taken: (rel: string) => boolean): string {
  const slash = c.original.lastIndexOf('/');
  const dir = slash >= 0 ? c.original.slice(0, slash + 1) : '';
  const base = c.original.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  const who = (c.pc ?? 'other PC').replace(/[<>:"/\\|?*]/g, ' ').trim() || 'other PC';
  for (let n = 1; n < 100; n++) {
    const rel = `${dir}${stem} (${who}’s copy${n > 1 ? ` ${n}` : ''})${ext}`;
    if (!taken(rel)) return rel;
  }
  return `${dir}${stem} (${who}’s copy ${Date.now()})${ext}`;
}
