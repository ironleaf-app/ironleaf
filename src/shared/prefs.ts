// Ironleaf's preferences (Settings): what they are, their defaults, and how a change is checked before it is kept.
// Shared by the main side (which stores them) and the renderer (which shows and applies them).

import { nearestSize } from './interface-size';
import { cleanFlows, DEFAULT_FLOWS, type CaptureFlow } from './capture-flows';
import { INBOX_FOLDER } from './inbox';
import { cleanModules, type ModuleSwitches } from './life-modules';
import { plural } from './words';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ViewMode = 'live' | 'source' | 'reading' | 'page';
export type LinkUpdate = 'always' | 'ask' | 'never';
export type NewNotePlace = 'root' | 'current' | 'folder';
export type LinkFormat = 'shortest' | 'relative' | 'absolute';
export type PropertiesShow = 'shown' | 'hidden' | 'source';
export type Density = 'comfortable' | 'compact';
export type Palette = 'honey' | 'bright' | 'sky' | 'mint' | 'lavender' | 'blush' | 'sunny' | 'paper' | 'ocean' | 'lagoon' | 'forest' | 'rose' | 'cocoa' | 'dusk';
/** How long Secrets and Private notes stay open after one unlock (8.2, 29 Oct 2026). 'strict' keeps the old idle minutes in
 *  privateLockMinutes. */
export type SecretsKeepUnlocked = '1h' | '4h' | '8h' | 'until-sign-out' | 'strict';
export const SECRETS_KEEP_UNLOCKED: { id: SecretsKeepUnlocked; label: string; hint: string; hours: number }[] = [
  { id: '1h', label: '1 hour', hint: 'Locked stays open for 1 hour after you unlock it, then locks.', hours: 1 },
  { id: '4h', label: '4 hours', hint: 'Locked stays open for 4 hours after you unlock it, then locks.', hours: 4 },
  { id: '8h', label: '8 hours', hint: 'Locked stays open for 8 hours after you unlock it, then locks. Good for a working day.', hours: 8 },
  { id: 'until-sign-out', label: 'Until I sign out of Windows', hint: 'It stays open until you sign out of Windows or lock it yourself. Locking Windows or sleep does not lock it unless you turn that on below. Best on a PC only you use.', hours: 0 },
  { id: 'strict', label: 'Ask again after a short time unused', hint: 'The older, stricter way: it locks after the minutes below with no use.', hours: 0 },
];
/** How long Secrets stay open, in the words the Secrets page and the Logins card use (8.5, 30 Oct 2026). */
export function unlockedPhrase(mode: SecretsKeepUnlocked, lockMinutes: number): string {
  if (mode === 'until-sign-out') return 'until you sign out of Windows';
  if (mode === 'strict') return lockMinutes > 0 ? `until ${plural(lockMinutes, 'minute')} with no use ${lockMinutes === 1 ? 'has' : 'have'} passed` : 'until Ironleaf closes';
  return `for ${SECRETS_KEEP_UNLOCKED.find((o) => o.id === mode)?.label ?? ''} from when you unlocked`.replace('  ', ' ');
}
/** The idle minutes the stored range allows (0 to 240), offered in full when 'strict' is chosen. */
export const PRIVATE_LOCK_MINUTES = [0, 5, 10, 15, 30, 45, 60, 90, 120, 180, 240];

export interface Prefs {
  /** Light by default (a user works in light). */
  theme: ThemeChoice;
  /** The colours of the light look (5.2.0): White, Bright (the default), Sky, Mint, Lavender, Blush, Sunny, Paper, Ocean,
   *  Lagoon, Forest, Rose, Cocoa, Dusk (4 Nov 2026: every look ever offered is back as itself, nothing remapped, and six
   *  more joined). The former host app keeps the same choice (src/appearance.cjs there) and offers exactly the same list,
   *  so both apps change together. */
  palette: Palette;
  accent: string;
  /** The default accent moved from coral to Ironleaf's leaf green (20 Nov 2026, the rename): true once that move has
   *  been made for these settings, so a coral picked after it stays coral. */
  accentLeaf: boolean;
  /** The whole window's size: one of src/shared/interface-size.ts's six (80% to 150%). */
  zoom: number;
  /** How close together rows sit in the side bar, the file list, tabs and lists (5.0.0): Compact fits about a fifth more. */
  density: Density;
  /** The notes' text size in pixels. */
  fontSize: number;
  defaultMode: ViewMode;
  readableWidth: boolean;
  lineNumbers: boolean;
  spellcheck: boolean;
  inlineTitle: boolean;
  autoPair: boolean;
  foldHeadings: boolean;
  newNotePlace: NewNotePlace;
  newNoteFolder: string;
  /** Where pasted and dropped files go: a folder in the notes ('' is the top), or './…' next to the note. */
  attachmentsFolder: string;
  /** Files added to a note go beside it, in its Files folder (src/shared/file-records.ts; 24 Oct 2026); off: the one folder above. */
  filesWithRecord: boolean;
  /** The asset store's folder in the notes (logos, pictures, icons, documents): never '' (src/shared/assets.ts). */
  assetsFolder: string;
  linkUpdate: LinkUpdate;
  confirmDelete: boolean;
  /** New links as [[wikilinks]] (else Markdown links). */
  wikilinks: boolean;
  /** Pictures, PDFs and other files in the file list, not only notes. */
  showAllFiles: boolean;
  templatesFolder: string;
  dateFormat: string;
  timeFormat: string;
  /** File recovery: a copy of a changed note at most this often (0 is off), kept this many days. */
  recoveryMinutes: number;
  recoveryDays: number;
  /** Keys changed from their defaults: command id → keys ('' for none). */
  hotkeys: Record<string, string>;
  /** What a new link names: the shortest name that finds it, the path from the note, or the path from the top. */
  linkFormat: LinkFormat;
  /** A note's properties: in a panel above it, not shown in the note, or as the text they are. */
  propertiesShow: PropertiesShow;
  /** Off: one Enter starts a new line in Reading too (as in the editor). On: lines join until a blank line. */
  strictBreaks: boolean;
  /** Tab indents with a tab (else spaces), this wide. */
  indentWithTabs: boolean;
  tabSize: number;
  /** Fonts by name ('' is Ironleaf's own): the window's words, the notes' text, code. */
  uiFont: string;
  textFont: string;
  codeFont: string;
  /** Folders and files left out of search, the graph, Open a note and suggestions (still in the file list). */
  excluded: string[];
  /** Folders kept out of view (the folder menu): left out of Notes, Today, the graph, Related and the chat's
   *  all-notes scope; still found by search, still opening from links. */
  quietFolders: string[];
  /** Style files (.neuralvault/styles/*.css in the notes) switched on. */
  snippets: string[];
  /** Private notes lock after this many minutes unused (0: only when Ironleaf closes). */
  privateLockMinutes: number;
  /** How long Secrets and Private notes stay open after one unlock (8.2); 'strict' uses privateLockMinutes. */
  secretsKeepUnlocked: SecretsKeepUnlocked;
  /** The person chose how long Secrets stay open themselves (8.5): until then the choice follows the default, so a
   *  new default reaches everyone who never picked one (the stored copy of the old 8-hour default is not a choice). */
  secretsKeepUnlockedChosen: boolean;
  /** Lock Secrets when Windows locks or the PC sleeps (8.5): off by default, so unlocking once means once. */
  secretsLockOnWindowsLock: boolean;
  /** The microphone in the chat and the note's header. */
  dictation: boolean;
  /** Dictation heard by the former host app takes out um, ah and you know; off keeps every word as said. */
  dictationClean: boolean;
  /** A meeting's recording once its notes are made (21 Oct 2026, gap G18): kept in the note as its attachment (the
   *  default since 22 Oct 2026: the meeting's player and its transcript play from it) or sent to the Bin. */
  meetingAudio: 'delete' | 'keep';
  /** The person chose Delete or Keep themselves (a choice made before Keep became the default stays theirs). */
  meetingAudioChosen: boolean;
  /** The microphone a meeting is recorded with, and dictation heard with (its device id; '' the PC's default). */
  meetingMic: string;
  /** A meeting recorded on Windows takes the PC's sound too (the other people on a call), not only the microphone. */
  meetingSystemAudio: boolean;
  /** An empty tab shows Home (the start page, views/HomeView.tsx); off, a quiet page. */
  home: boolean;
  /** Before Home folded into Today (20 Oct 2026), false meant the plainer Home: Today keeps that person's Home choices
   *  (src/shared/hub.ts todayHidden). Settings writes true once Today's choices are changed. */
  today: boolean;
  /** Hovering a link shows the note it leads to in a small card. */
  hoverPreview: boolean;
  /** Suggested questions in an empty chat. */
  chatSuggestions: boolean;
  /** The assistant's edits to a note wait in the note for the person to keep or discard (19 Oct 2026, 5.0.0); off, it changes
   *  notes straight away (and its answer's Undo puts them back). Off by default from 5 Nov 2026; on by default again from
   *  20 Nov 2026 (2.0): a new install asks first, and a choice made in Settings stays as made. */
  askBeforeChanges: boolean;
  /** The person chose to ask first or not themselves (5 Nov 2026): until then the choice follows the default, so the
   *  stored true that was the old default — indistinguishable from a deliberate turn-on — moves to off once. */
  askBeforeChangesChosen: boolean;
  /** Pages open in tabs along the top (29 Oct 2026, SPEC section A: off by default). Off: one page at a time,
   *  a page opened from the left side replaces the page on show, and Ctrl+click opens a note beside the page. */
  showTabs: boolean;
  /** The person chose tabs themselves (Settings or the command): until then they are off (8.0, 29 Oct 2026: tabs that
   *  were on by default had gathered stale pages). */
  tabsChosen: boolean;
  /** The status line along the bottom (word count, links, saved): off by default for a calmer window (Ironleaf Calm,
   *  20 Oct 2026); a failed save and Ctrl+S still say so in the corner. */
  statusLine: boolean;
  /** Buttons and items switched off in Settings › Appearance › Interface (see HIDEABLE). */
  hidden: Hideable[];
  /** The weekly review's gentle notice in the app (never a Windows notification): on, which day (0 Sunday … 6
   *  Saturday) and from what time ("15:00"). */
  weeklyReview: boolean;
  weeklyReviewDay: number;
  weeklyReviewTime: string;
  // Quick capture (src/main/capture.ts, Settings › Capture).
  /** The Windows-wide keys that open the capture box, as Electron writes them ('' is off). */
  captureKey: string;
  /** Where a capture with no project goes: the Inbox (the default since 24 Oct 2026: filed from one place, the Inbox page)
   *  or today's note. */
  captureNoProject: 'daily' | 'inbox';
  /** The person chose where captures with no project go themselves (a choice of today's note stays theirs). */
  captureNoProjectChosen: boolean;
  /** "Save to assets" in the box, as it was left. */
  captureToAssets: boolean;
  /** The projects captures went to lately, newest first (suggested when the words say nothing). */
  captureRecent: string[];
  /** "Capture to…" flows (src/shared/capture-flows.ts; 21 Oct 2026, gap G27): where a line goes with the time. */
  captureFlows: CaptureFlow[];
  /** The web clipper's endpoint on this PC (src/main/clipper.ts): the browser extension clips while it is on. */
  clipperEnabled: boolean;
  /** Search inside the documents in projects' folders (Settings › Search; the index is kept in Ironleaf's own data). */
  fileSearch: boolean;
  /** Projects (their files' paths) whose folders aren't searched inside. */
  fileSearchOff: string[];
  /** Read the words in pictures and scanned PDFs among the notes (Settings › General; on unless switched off). */
  ocrRead: boolean;
  /** The language the words are read in, as Windows names it ('en-AU'; '' is automatic). */
  ocrLang: string;
  /** Life modules switched on (Settings › Packs; src/shared/life-modules.ts): every one is off until the person turns it on. */
  modules: ModuleSwitches;
  /** The Vault's calendar kept in step with the person's calendars (8.9, Settings › Calendar): off until turned on. */
  calendarSync: boolean;
  /** The calendar meetings go to (its id from the former host app; '' when none chosen yet). */
  calendarChosen: string;
  /** The vault tidy (t238, Settings › Backups and sync): the new task shape, tried on a copy first. Off until turned on. */
  vaultTidy: boolean;
  /** Skills switched off in Settings › AI › Skills, by name (src/shared/skills.ts): every skill is on until switched off. */
  skillsOff: string[];
}

/** Every button and item a person can switch off (16 Oct 2026), with its words in Settings. */
export const HIDEABLE_ITEMS = [
  { id: 'ribbon:today', group: 'ribbon', label: 'Today' },
  { id: 'ribbon:tasks', group: 'ribbon', label: 'Tasks' },
  // (No Search switch since 5 Nov 2026: the rail's Search row is gone — the centred bar is the one door —
  // so there is nothing left to switch. Saved choices wash out on load, as the ask-box switches did.)
  { id: 'ribbon:projects', group: 'ribbon', label: 'Projects' },
  // Back with their rows (9 Nov 2026): Timeline, Automations, Daily note, New canvas and Earlier
  // versions sit in More's quiet second group again, each on its own switch.
  { id: 'ribbon:timeline', group: 'ribbon', label: 'Timeline' },
  { id: 'ribbon:graph', group: 'ribbon', label: 'Graph' },
  { id: 'ribbon:template', group: 'ribbon', label: 'Templates' },
  { id: 'ribbon:assets', group: 'ribbon', label: 'Assets' },
  { id: 'ribbon:private', group: 'ribbon', label: 'Locked' },
  { id: 'ribbon:daily', group: 'ribbon', label: 'Daily note' },
  { id: 'ribbon:canvas', group: 'ribbon', label: 'New canvas' },
  { id: 'ribbon:commands', group: 'ribbon', label: 'Commands' },
  { id: 'ribbon:recovery', group: 'ribbon', label: 'Earlier versions' },
  { id: 'status:backlinks', group: 'status', label: 'Notes that link here' },
  { id: 'status:tags', group: 'status', label: 'Tags' },
  { id: 'status:words', group: 'status', label: 'Words and characters' },
  { id: 'status:saved', group: 'status', label: 'Saved' },
  { id: 'home:actions', group: 'home', label: 'Quick actions' },
  { id: 'home:projects', group: 'home', label: 'Projects that need you' },
  { id: 'home:recent', group: 'home', label: 'Changed lately' },
  // Today as the hub (20 Oct 2026): Home folded into Today; Home's choices above are kept for those who had them
  // (src/shared/hub.ts todayHidden reads them).
  { id: 'today:brief', group: 'today', label: 'The morning brief' },
  { id: 'today:week', group: 'today', label: 'Week and month' },
  { id: 'today:note', group: 'today', label: 'The day’s note' },
  { id: 'today:day', group: 'today', label: 'Meetings' },
  { id: 'today:tasks', group: 'today', label: 'Tasks and reminders' },
  // (No ask-box switch since 4 Nov 2026: asking moved to the header bar's panel, so there is no box
  // left to switch. Saved choices wash out on load, and the old mapping below dropped its pair.)
  { id: 'today:due', group: 'today', label: 'Project steps due' },
  { id: 'today:waiting', group: 'today', label: 'Waiting on others' },
  { id: 'today:risk', group: 'today', label: 'At risk' },
  { id: 'today:glance', group: 'today', label: 'Projects at a glance' },
  { id: 'today:changed', group: 'today', label: 'Changed since yesterday' },
  { id: 'today:activity', group: 'today', label: 'Made, changed and linked that day' },
  { id: 'today:actions', group: 'today', label: 'Quick actions' },
  { id: 'project:canvas', group: 'project', label: 'Canvas' },
  { id: 'project:timeline', group: 'project', label: 'Timeline tab' },
] as const;
export type Hideable = (typeof HIDEABLE_ITEMS)[number]['id'];
const HIDEABLE: readonly string[] = HIDEABLE_ITEMS.map((i) => i.id);
/** Whether a button or item is shown (Settings › Appearance › Interface). */
export const shows = (prefs: Pick<Prefs, 'hidden'>, id: Hideable): boolean => !prefs.hidden.includes(id);

export const DEFAULT_PREFS: Prefs = {
  theme: 'light',
  // Bright and the coral gem by default (8.1, 29 Oct 2026; 4 Nov 2026: the same default as the former host app, id
  // and all, so both apps open the same look).
  palette: 'bright',
  // Ironleaf's leaf green (20 Nov 2026, the rename; approved the Ironleaf palette): leaf-600 on light; dark draws it
  // as leaf-300 (App.tsx sets --accent-dark). Coral stays in the list for anyone who wants it.
  accent: '#357553',
  accentLeaf: true,
  zoom: 1,
  density: 'comfortable',
  fontSize: 16,
  defaultMode: 'live',
  readableWidth: true,
  lineNumbers: false,
  spellcheck: true,
  inlineTitle: true,
  autoPair: true,
  foldHeadings: true,
  newNotePlace: 'root',
  newNoteFolder: '',
  attachmentsFolder: 'Attachments',
  filesWithRecord: true,
  assetsFolder: 'Assets',
  linkUpdate: 'always',
  confirmDelete: true,
  wikilinks: true,
  showAllFiles: true,
  templatesFolder: 'Templates',
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'HH:mm',
  recoveryMinutes: 5,
  recoveryDays: 7,
  privateLockMinutes: 10,
  // Unlock once means once (8.5, 30 Oct 2026): the default is now until Windows sign-out, not 8 hours.
  secretsKeepUnlocked: 'until-sign-out',
  secretsKeepUnlockedChosen: false,
  secretsLockOnWindowsLock: false,
  dictation: true,
  dictationClean: true,
  meetingAudio: 'keep',
  meetingAudioChosen: false,
  meetingMic: '',
  meetingSystemAudio: true,
  home: true,
  today: true,
  hoverPreview: true,
  chatSuggestions: true,
  askBeforeChanges: true,
  askBeforeChangesChosen: false,
  showTabs: false,
  tabsChosen: false,
  statusLine: false,
  hidden: [],
  weeklyReview: true,
  weeklyReviewDay: 5,
  weeklyReviewTime: '15:00',
  fileSearch: true,
  fileSearchOff: [],
  ocrRead: true,
  ocrLang: '',
  hotkeys: {},
  linkFormat: 'shortest',
  propertiesShow: 'shown',
  strictBreaks: false,
  indentWithTabs: true,
  tabSize: 4,
  uiFont: '',
  textFont: '',
  codeFont: '',
  excluded: [],
  quietFolders: [],
  snippets: [],
  captureKey: 'Control+Alt+N',
  captureNoProject: 'inbox',
  captureNoProjectChosen: false,
  captureToAssets: false,
  captureRecent: [],
  captureFlows: DEFAULT_FLOWS,
  clipperEnabled: true,
  modules: {},
  calendarSync: false,
  calendarChosen: '',
  vaultTidy: false,
  skillsOff: [],
};

/** The light looks, in the order Settings shows them (`page`, `side` draw each swatch). The former host app offers
 *  exactly the same list, in the same order (native-runtime/plugins/desktop/client.js PALETTES there): the names
 *  are the former host app's (DECISIONS 3: the default look is called Bright; 'honey' shows as White, as there).
 *  The ids stay so saved choices keep working; only names changed. */
export const PALETTES: { id: Palette; name: string; page: string; side: string }[] = [
  { id: 'honey', name: 'White', page: '#ffffff', side: '#f2f4f7' },
  { id: 'bright', name: 'Bright', page: '#ffffff', side: '#f5f7fa' },
  { id: 'sky', name: 'Sky', page: '#fbfdff', side: '#eaf3fd' },
  { id: 'mint', name: 'Mint', page: '#fbfefc', side: '#e8f6ee' },
  { id: 'lavender', name: 'Lavender', page: '#fcfbff', side: '#efebfd' },
  { id: 'blush', name: 'Blush', page: '#fffbfb', side: '#fcecef' },
  { id: 'sunny', name: 'Sunny', page: '#fffefa', side: '#fdf5dc' },
  { id: 'paper', name: 'Paper', page: '#faf9f5', side: '#f3f1ea' },
  { id: 'ocean', name: 'Ocean', page: '#f6fafd', side: '#dfeaf7' },
  { id: 'lagoon', name: 'Lagoon', page: '#f5fbf9', side: '#d8ece6' },
  { id: 'forest', name: 'Forest', page: '#f5faf6', side: '#d9e9dc' },
  { id: 'rose', name: 'Rose', page: '#fef8f9', side: '#f5dade' },
  { id: 'cocoa', name: 'Cocoa', page: '#fbf8f4', side: '#eadfcf' },
  { id: 'dusk', name: 'Dusk', page: '#f7f8fb', side: '#e1e5ef' },
];
export const PALETTE_IDS = PALETTES.map((p) => p.id);

/** The default accent, Ironleaf's leaf green, and the coral that was the default before the rename. */
export const LEAF_ACCENT = '#357553';
export const LEAF_ACCENT_DARK = '#7cc197';
export const OLD_DEFAULT_ACCENT = '#f2785a';

export const ACCENTS: { name: string; value: string }[] = [
  { name: 'Leaf', value: LEAF_ACCENT },
  { name: 'Coral', value: '#f2785a' },
  { name: 'Tangerine', value: '#f08a1c' },
  { name: 'Sunflower', value: '#d9a400' },
  { name: 'Green', value: '#22a35a' },
  { name: 'Teal', value: '#0f9e94' },
  { name: 'Blue', value: '#2f6fed' },
  { name: 'Indigo', value: '#5551e0' },
  { name: 'Violet', value: '#8b4ee6' },
  { name: 'Pink', value: '#e0457f' },
  { name: 'Clay', value: '#b85a37' },
  { name: 'Slate', value: '#4f5b66' },
  { name: 'Ruby', value: '#b02a37' },
  { name: 'Rust', value: '#a34a24' },
  { name: 'Gold', value: '#a97e12' },
  { name: 'Moss', value: '#5f7f3d' },
  { name: 'Aqua', value: '#1295b8' },
  { name: 'Navy', value: '#2c4f8f' },
  { name: 'Plum', value: '#7d3f6e' },
  { name: 'Charcoal', value: '#3a4149' },
];

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);
const num = (value: unknown, min: number, max: number, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/** A folder inside the notes, written with forward slashes and no leading or trailing slash ('' is the top). */
export function cleanFolder(value: unknown, fallback: string, allowRelative = false): string {
  if (typeof value !== 'string' || value.length > 300) return fallback;
  let v = value.trim().replace(/\\/g, '/');
  let relative = false;
  if (v === '.' || v.startsWith('./')) {
    relative = allowRelative;
    v = v.slice(v === '.' ? 1 : 2);
  }
  v = v.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (/[<>:"|?*\u0000-\u001f]/.test(v) || v.split('/').some((part) => part === '..' || part === '.')) return fallback;
  return relative ? (v ? `./${v}` : './') : v;
}

/** A font's name as a person types it ('' is Ironleaf's own); never anything CSS could read as more than a name. */
export function cleanFont(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().replace(/\s+/g, ' ');
  if (!v) return '';
  return v.length <= 80 && /^[\p{L}\p{N} ._-]+$/u.test(v) ? v : fallback;
}

function cleanList(value: unknown, fallback: string[], each: (v: string) => string | null, max: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const out: string[] = [];
  for (const item of value.slice(0, max)) {
    const v = typeof item === 'string' ? each(item) : null;
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function cleanHotkeys(value: unknown, fallback: Record<string, string>): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const out: Record<string, string> = {};
  for (const [id, combo] of Object.entries(value as Record<string, unknown>).slice(0, 400)) {
    if (!/^[a-z0-9:-]{1,80}$/.test(id) || typeof combo !== 'string' || combo.length > 60) continue;
    out[id] = combo;
  }
  return out;
}

/** Applies a change to the preferences, keeping only values that make sense. */
export function mergePrefs(current: Prefs, patch: unknown): Prefs {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Record<keyof Prefs, unknown>>;
  const has = (k: keyof Prefs) => Object.prototype.hasOwnProperty.call(p, k);
  const next: Prefs = { ...current };
  if (has('theme')) next.theme = pick(p.theme, ['light', 'dark', 'system'] as const, current.theme);
  if (has('palette')) next.palette = pick(p.palette, PALETTE_IDS, current.palette);
  if (has('accent')) next.accent = typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : current.accent;
  if (has('accentLeaf')) next.accentLeaf = p.accentLeaf === true;
  if (has('zoom')) next.zoom = nearestSize(num(p.zoom, 0.8, 1.6, current.zoom));
  if (has('density')) next.density = pick(p.density, ['comfortable', 'compact'] as const, current.density);
  if (has('fontSize')) next.fontSize = Math.round(num(p.fontSize, 12, 26, current.fontSize));
  if (has('defaultMode')) next.defaultMode = pick(p.defaultMode, ['live', 'source', 'reading'] as const, current.defaultMode);
  for (const key of ['readableWidth', 'lineNumbers', 'spellcheck', 'inlineTitle', 'autoPair', 'foldHeadings', 'confirmDelete', 'wikilinks', 'showAllFiles'] as const) {
    if (has(key)) next[key] = bool(p[key], current[key]);
  }
  if (has('newNotePlace')) next.newNotePlace = pick(p.newNotePlace, ['root', 'current', 'folder'] as const, current.newNotePlace);
  if (has('newNoteFolder')) next.newNoteFolder = cleanFolder(p.newNoteFolder, current.newNoteFolder);
  if (has('attachmentsFolder')) next.attachmentsFolder = cleanFolder(p.attachmentsFolder, current.attachmentsFolder, true);
  if (has('filesWithRecord')) next.filesWithRecord = bool(p.filesWithRecord, current.filesWithRecord);
  if (has('assetsFolder')) next.assetsFolder = cleanFolder(p.assetsFolder, current.assetsFolder) || current.assetsFolder;
  if (has('linkUpdate')) next.linkUpdate = pick(p.linkUpdate, ['always', 'ask', 'never'] as const, current.linkUpdate);
  if (has('templatesFolder')) next.templatesFolder = cleanFolder(p.templatesFolder, current.templatesFolder);
  if (has('dateFormat')) next.dateFormat = typeof p.dateFormat === 'string' && p.dateFormat.trim() && p.dateFormat.length <= 60 ? p.dateFormat.trim() : current.dateFormat;
  if (has('timeFormat')) next.timeFormat = typeof p.timeFormat === 'string' && p.timeFormat.trim() && p.timeFormat.length <= 60 ? p.timeFormat.trim() : current.timeFormat;
  if (has('recoveryMinutes')) next.recoveryMinutes = Math.round(num(p.recoveryMinutes, 0, 1440, current.recoveryMinutes));
  if (has('recoveryDays')) next.recoveryDays = Math.round(num(p.recoveryDays, 1, 365, current.recoveryDays));
  if (has('privateLockMinutes')) next.privateLockMinutes = Math.round(num(p.privateLockMinutes, 0, 240, current.privateLockMinutes));
  if (has('secretsKeepUnlocked')) next.secretsKeepUnlocked = pick(p.secretsKeepUnlocked, SECRETS_KEEP_UNLOCKED.map((o) => o.id), current.secretsKeepUnlocked);
  if (has('secretsKeepUnlockedChosen')) next.secretsKeepUnlockedChosen = p.secretsKeepUnlockedChosen === true;
  if (has('secretsLockOnWindowsLock')) next.secretsLockOnWindowsLock = p.secretsLockOnWindowsLock === true;
  if (has('dictation')) next.dictation = p.dictation === true;
  if (has('dictationClean')) next.dictationClean = p.dictationClean !== false;
  if (has('meetingAudio')) next.meetingAudio = pick(p.meetingAudio, ['delete', 'keep'] as const, current.meetingAudio);
  if (has('meetingAudioChosen')) next.meetingAudioChosen = p.meetingAudioChosen === true;
  if (has('meetingMic')) next.meetingMic = typeof p.meetingMic === 'string' && p.meetingMic.length <= 300 ? p.meetingMic : current.meetingMic;
  if (has('meetingSystemAudio')) next.meetingSystemAudio = bool(p.meetingSystemAudio, current.meetingSystemAudio);
  for (const key of ['home', 'today', 'hoverPreview', 'chatSuggestions', 'askBeforeChanges', 'showTabs', 'statusLine'] as const) if (has(key)) next[key] = bool(p[key], current[key]);
  if (has('askBeforeChangesChosen')) next.askBeforeChangesChosen = p.askBeforeChangesChosen === true;
  if (has('tabsChosen')) next.tabsChosen = p.tabsChosen === true;
  if (!next.tabsChosen) next.showTabs = false;
  if (has('hidden')) next.hidden = cleanList(p.hidden, current.hidden, (v) => (HIDEABLE.includes(v) ? v : null), 60) as Hideable[];
  if (has('weeklyReview')) next.weeklyReview = bool(p.weeklyReview, current.weeklyReview);
  if (has('weeklyReviewDay')) next.weeklyReviewDay = Math.round(num(p.weeklyReviewDay, 0, 6, current.weeklyReviewDay));
  if (has('weeklyReviewTime')) next.weeklyReviewTime = typeof p.weeklyReviewTime === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(p.weeklyReviewTime) ? p.weeklyReviewTime.padStart(5, '0') : current.weeklyReviewTime;
  if (has('fileSearch')) next.fileSearch = bool(p.fileSearch, current.fileSearch);
  if (has('fileSearchOff')) next.fileSearchOff = cleanList(p.fileSearchOff, current.fileSearchOff, (v) => (v.length <= 400 && /\.md$/i.test(v) && !v.split('/').includes('..') ? v : null), 500);
  if (has('ocrRead')) next.ocrRead = bool(p.ocrRead, current.ocrRead);
  if (has('ocrLang')) next.ocrLang = typeof p.ocrLang === 'string' && /^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(p.ocrLang.trim()) ? p.ocrLang.trim().slice(0, 12) : p.ocrLang === '' ? '' : current.ocrLang;
  if (has('hotkeys')) next.hotkeys = cleanHotkeys(p.hotkeys, current.hotkeys);
  if (has('linkFormat')) next.linkFormat = pick(p.linkFormat, ['shortest', 'relative', 'absolute'] as const, current.linkFormat);
  if (has('propertiesShow')) next.propertiesShow = pick(p.propertiesShow, ['shown', 'hidden', 'source'] as const, current.propertiesShow);
  for (const key of ['strictBreaks', 'indentWithTabs'] as const) if (has(key)) next[key] = bool(p[key], current[key]);
  if (has('tabSize')) next.tabSize = Math.round(num(p.tabSize, 2, 8, current.tabSize));
  for (const key of ['uiFont', 'textFont', 'codeFont'] as const) if (has(key)) next[key] = cleanFont(p[key], current[key]);
  if (has('excluded')) next.excluded = cleanList(p.excluded, current.excluded, (v) => cleanFolder(v, '') || null, 50);
  // The Inbox stays in view (8 Nov 2026, item 1): never kept, whatever is stored.
  if (has('quietFolders')) next.quietFolders = cleanList(p.quietFolders, current.quietFolders, (v) => {
    const c = cleanFolder(v, '') || null;
    return c && c.toLowerCase() !== INBOX_FOLDER.toLowerCase() ? c : null;
  }, 50);
  if (has('snippets')) next.snippets = cleanList(p.snippets, current.snippets, (v) => (/^[\w .()-]{1,80}\.css$/i.test(v) && !v.startsWith('.') ? v : null), 50);
  // Quick capture.
  if (has('captureKey')) next.captureKey = p.captureKey === '' ? '' : typeof p.captureKey === 'string' && p.captureKey.length <= 60 && /^[A-Za-z0-9+]+$/.test(p.captureKey) ? p.captureKey : current.captureKey;
  if (has('captureNoProject')) next.captureNoProject = pick(p.captureNoProject, ['daily', 'inbox'] as const, current.captureNoProject);
  if (has('captureNoProjectChosen')) next.captureNoProjectChosen = p.captureNoProjectChosen === true;
  if (has('captureToAssets')) next.captureToAssets = bool(p.captureToAssets, current.captureToAssets);
  if (has('captureRecent')) next.captureRecent = cleanList(p.captureRecent, current.captureRecent, (v) => (v.length <= 400 && /\.md$/i.test(v) && !v.includes('..') ? v : null), 6);
  if (has('captureFlows')) next.captureFlows = cleanFlows(p.captureFlows, current.captureFlows);
  if (has('clipperEnabled')) next.clipperEnabled = bool(p.clipperEnabled, current.clipperEnabled);
  if (has('modules')) next.modules = cleanModules(p.modules, current.modules);
  if (has('calendarSync')) next.calendarSync = p.calendarSync === true;
  if (has('calendarChosen')) next.calendarChosen = typeof p.calendarChosen === 'string' ? p.calendarChosen.trim().slice(0, 200) : current.calendarChosen;
  if (has('vaultTidy')) next.vaultTidy = p.vaultTidy === true;
  if (has('skillsOff')) next.skillsOff = cleanList(p.skillsOff, current.skillsOff, (v) => (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) && v.length <= 64 ? v : null), 200);
  return next;
}

/** Preferences as stored (an older file may miss some, or hold ones no longer valid). */
export function loadPrefs(stored: unknown): Prefs {
  const prefs = mergePrefs(DEFAULT_PREFS, stored);
  // Settings kept before palettes (5.2.0) move to the bright look: the old default clay becomes coral; a colour someone
  // chose stays theirs.
  const before = !stored || typeof stored !== 'object' || !('palette' in stored);
  if (before && prefs.accent.toLowerCase() === '#b85a37') prefs.accent = DEFAULT_PREFS.accent;
  // 20 Nov 2026 (the rename to Ironleaf): settings kept with the old default coral move to the leaf green once; a coral
  // chosen after that (accentLeaf already true) stays, and so does any other colour someone picked.
  const leafMoved = !!stored && typeof stored === 'object' && (stored as { accentLeaf?: unknown }).accentLeaf === true;
  if (!leafMoved && prefs.accent.toLowerCase() === OLD_DEFAULT_ACCENT) prefs.accent = LEAF_ACCENT;
  prefs.accentLeaf = true;
  // 4 Nov 2026: every look ever offered is offered, so a stored Sunny, Paper or Blush draws as itself
  // (pick() above already falls back for unknown ids); a stored accent stays as it was, even the older Coral.
  // 22 Oct 2026: recordings are kept by default (the meeting's player plays from them); the Delete that was the default
  // for a day moves to Keep unless the person chose it in Settings.
  if (!prefs.meetingAudioChosen) prefs.meetingAudio = DEFAULT_PREFS.meetingAudio;
  // 24 Oct 2026 (Wave 5): captures with no project go to the Inbox, where they are filed from one place; today's note
  // stays only for someone who chose it in Settings › Quick capture.
  if (!prefs.captureNoProjectChosen) prefs.captureNoProject = DEFAULT_PREFS.captureNoProject;
  // 8.5 (30 Oct 2026): Secrets stay open until Windows sign-out by default. A PC whose stored 8 hours was only the
  // old default (nobody picked it: no choice was ever recorded) moves to the new default; a picked time stays.
  if (!prefs.secretsKeepUnlockedChosen) prefs.secretsKeepUnlocked = DEFAULT_PREFS.secretsKeepUnlocked;
  // Asking first follows the default (on again from 20 Nov 2026, 2.0) until the person chooses in Settings: a stored
  // value nobody chose was only a saved default, so it follows the default too; a choice made (the marker) stays.
  if (!prefs.askBeforeChangesChosen) prefs.askBeforeChanges = DEFAULT_PREFS.askBeforeChanges;
  return prefs;
}
