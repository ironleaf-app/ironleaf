// Where each of Ironleaf's settings lives (24 Oct 2026, WS1 step 0; 23 Oct). Every setting, and every part of what
// Ironleaf remembers about a vault, has one home:
//  - the VAULT: how the vault is built and laid out (its folders, links, Today's sections, the side bar's order, bookmarks,
//    the graph's and the timeline's views, templates written, put-away suggestions). Kept inside the vault, in
//    .neuralvault/settings.json and .neuralvault/state/<name>.json, so every PC that opens it reads the same;
//  - PERSONAL: how the person likes to work (the look, the text size, the editor, the keys). Kept on the PC in
//    personal.json, which the former host app carries to the person's other PCs through a chat bot's sealed sync when it
//    is set up
//    (native-runtime/plugins/work/vault-prefs-sync.mjs there);
//  - this PC: what only makes sense on one PC (the window's size, open tabs, project folders, the model chosen, where
//    file recovery keeps its copies, the microphone).
// Each kept file is a keyed document: every value with when it was changed and on which PC, so two PCs changing the vault's
// settings at once (or OneDrive's conflict copies of the file) merge key by key, the newer change winning, never a whole
// file over another. This file is pure: the main side reads and writes (src/main/vault-settings.ts, settings.ts,
// library-state.ts).

import { INBOX_FOLDER } from './inbox';
import type { Prefs } from './prefs';

export type SettingHome = 'vault' | 'personal' | 'pc';

/** Every preference's home. A Record over every key, so a new preference can't be added without choosing one. 'hidden'
 *  is split by what each item is (hiddenHome). */
export const PREF_HOME: Record<keyof Prefs, SettingHome | 'split'> = {
  // How it looks and feels: the person's.
  theme: 'personal',
  palette: 'personal',
  accent: 'personal',
  accentLeaf: 'personal',
  density: 'personal',
  fontSize: 'personal',
  uiFont: 'personal',
  textFont: 'personal',
  codeFont: 'personal',
  // The editor.
  defaultMode: 'personal',
  readableWidth: 'personal',
  lineNumbers: 'personal',
  spellcheck: 'personal',
  inlineTitle: 'personal',
  autoPair: 'personal',
  foldHeadings: 'personal',
  propertiesShow: 'personal',
  strictBreaks: 'personal',
  indentWithTabs: 'personal',
  tabSize: 'personal',
  confirmDelete: 'personal',
  dateFormat: 'personal',
  timeFormat: 'personal',
  // The keys, and the window's own manners.
  hotkeys: 'personal',
  captureKey: 'personal',
  captureToAssets: 'personal',
  home: 'personal',
  hoverPreview: 'personal',
  chatSuggestions: 'personal',
  askBeforeChanges: 'personal',
  askBeforeChangesChosen: 'personal',
  showTabs: 'personal',
  tabsChosen: 'personal',
  statusLine: 'personal',
  dictation: 'personal',
  dictationClean: 'personal',
  privateLockMinutes: 'personal',
  secretsKeepUnlocked: 'pc',
  secretsKeepUnlockedChosen: 'pc',
  secretsLockOnWindowsLock: 'pc',
  meetingAudio: 'personal',
  meetingAudioChosen: 'personal',
  meetingSystemAudio: 'personal',
  weeklyReview: 'personal',
  weeklyReviewDay: 'personal',
  weeklyReviewTime: 'personal',
  // Life modules switched on (Wave 5): the person's, so they follow them to their other PCs.
  modules: 'personal',
  // The calendar sync switch and the calendar chosen (8.9): the person's, so every PC keeps the same calendar.
  calendarSync: 'personal',
  calendarChosen: 'personal',
  // The vault tidy switch (t238): the person's, off until turned on.
  vaultTidy: 'personal',
  // How the vault is built: its folders, its links, what search leaves out, its style files, where captures go.
  newNotePlace: 'vault',
  newNoteFolder: 'vault',
  attachmentsFolder: 'vault',
  filesWithRecord: 'vault',
  assetsFolder: 'vault',
  templatesFolder: 'vault',
  linkUpdate: 'vault',
  linkFormat: 'vault',
  wikilinks: 'vault',
  showAllFiles: 'vault',
  excluded: 'vault',
  quietFolders: 'vault',
  snippets: 'vault',
  captureNoProject: 'vault',
  captureNoProjectChosen: 'vault',
  captureFlows: 'vault',
  captureRecent: 'vault',
  fileSearchOff: 'vault',
  today: 'vault',
  hidden: 'split',
  // This PC: the window's size suits its screen; file recovery's copies, the document index and the microphone are its own.
  zoom: 'pc',
  recoveryMinutes: 'pc',
  recoveryDays: 'pc',
  meetingMic: 'pc',
  fileSearch: 'pc',
  // Reading words in pictures: this PC's recogniser and its own kept words, like the document index.
  ocrRead: 'pc',
  ocrLang: 'pc',
  // The web clipper listens on this PC: on or off here.
  clipperEnabled: 'pc',
};

/** Settings beside the preferences (settings.json's own keys). */
export const SETTING_HOME: Record<string, SettingHome> = {
  dailyFolder: 'vault',
  dailyFormat: 'vault',
  dailyTemplate: 'vault',
  model: 'pc',
  library: 'pc',
  lastVault: 'pc',
  recentVaults: 'pc',
  placeSeen: 'pc',
  current: 'pc',
  homeOld: 'pc',
  homeSeen: 'pc',
  projectFolders: 'pc',
};
export const VAULT_SETTING_KEYS = Object.keys(SETTING_HOME).filter((k) => SETTING_HOME[k] === 'vault') as ('dailyFolder' | 'dailyFormat' | 'dailyTemplate')[];

/** Buttons and items switched off: Today's sections, Home's and a project page's are the vault's; the side bar's buttons
 *  (ribbon) and the status line's are the person's. */
export const hiddenHome = (id: string): 'vault' | 'personal' => (/^(today|home|project):/.test(id) ? 'vault' : 'personal');

/** What Ironleaf remembers about a vault (src/main/library-state.ts), and where each part lives. A part named in `vault`
 *  is the vault's; every other part (one added later too) stays on this PC, so nothing is ever shared by accident.
 *  nested: the value is one memory per project (by its path), each split the same way. */
export interface StatePlan {
  home: SettingHome;
  /** For a split memory: its parts that are the vault's. */
  vault?: readonly string[];
  nested?: boolean;
}
export const STATE_PLAN: Record<string, StatePlan> = {
  // Open tabs, splits, the sides' widths, files opened lately: this PC.
  workspace: { home: 'pc' },
  // Bookmarks: the vault's.
  bookmarks: { home: 'vault' },
  // The graph's filters, colour groups, looks and forces.
  graph: { home: 'vault' },
  // The side bar: how it is shown, its sort, its sections and the orders dragged into place are the vault's; which folders
  // and rows are open is this PC's.
  explorer: { home: 'pc', vault: ['mode', 'sort', 'sections', 'order', 'showAttachments'] },
  // The last search: this PC.
  search: { home: 'pc' },
  // A project's page: list or grid, the sort and the timeline's zoom are the vault's; open folders, the tab it was on and
  // the groups folded away are this PC's.
  projects: { home: 'pc', vault: ['view', 'sort', 'planZoom'], nested: true },
  // The Timeline's zoom, grouping, sort and filters.
  timeline: { home: 'vault' },
  // Which ready-made templates were written (one deleted on any PC stays deleted).
  templates: { home: 'vault' },
  // The weekly review: when it was last done or put off (its copies of the projects are this PC's).
  reviews: { home: 'pc', vault: ['last', 'putOff'] },
  // The morning brief's "Not useful" and hidden lines.
  brief: { home: 'vault' },
  // Backup and sync: a remote, a folder on this PC and its sign-in, run from one PC.
  backup: { home: 'pc' },
  // Suggestions put away (a project's layout suggestion).
  dismissed: { home: 'vault' },
};

// ── Keyed documents ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface KeyedEntry {
  value: unknown;
  /** When it was changed (ms). */
  at: number;
  /** Which PC changed it (Ironleaf's id for that PC). */
  by: string;
  /** Brought in from a PC's own settings the first time (newer deliberate changes always win over these). */
  moved?: true;
}

export interface KeyedDoc {
  neuralvault: string;
  format: 1;
  keys: Record<string, KeyedEntry>;
}

export const MAX_DOC_BYTES = 2 * 1024 * 1024;

export const emptyDoc = (kind: string): KeyedDoc => ({ neuralvault: kind, format: 1, keys: {} });

/** The same value, whatever the order of an object's fields. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, (v as Record<string, unknown>)[key]])) : v)) ?? 'null';
}
export const sameValue = (a: unknown, b: unknown) => stable(a) === stable(b);

/** A keyed document from its words: null when it can't be read (half written, not ours); a bad entry is left out. */
export function readDoc(text: string | null | undefined, kind: string): KeyedDoc | null {
  if (typeof text !== 'string' || text.length > MAX_DOC_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.format !== 1 || !r.keys || typeof r.keys !== 'object' || Array.isArray(r.keys)) return null;
  const doc = emptyDoc(typeof r.neuralvault === 'string' ? r.neuralvault : kind);
  for (const [key, e] of Object.entries(r.keys as Record<string, unknown>)) {
    if (!key || key.length > 400 || /[\u0000-\u001f]/.test(key) || !e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    if (!('value' in x) || typeof x.at !== 'number' || !Number.isFinite(x.at) || typeof x.by !== 'string') continue;
    doc.keys[key] = { value: x.value, at: x.at, by: x.by.slice(0, 80), ...(x.moved === true ? { moved: true as const } : {}) };
  }
  return doc;
}

/** The words of a keyed document (its keys in order, so the same document always reads the same). */
export function docText(doc: KeyedDoc): string {
  const keys = Object.fromEntries(Object.keys(doc.keys).sort().map((k) => [k, doc.keys[k]]));
  return `${JSON.stringify({ neuralvault: doc.neuralvault, format: 1, keys }, null, 1)}\n`;
}

/** Whether entry `a` wins over `b`: a deliberate change over one brought in the first time, else the newer, else (the same
 *  moment on two PCs) the larger PC id, so every PC picks the same one. */
export function wins(a: KeyedEntry, b: KeyedEntry): boolean {
  if (!!a.moved !== !!b.moved) return !a.moved;
  if (a.at !== b.at) return a.at > b.at;
  return a.by > b.by;
}

// ── Kept-out folders merge item by item (8 Nov 2026, item 3) ───────────────────────────────────────────────
// Two PCs editing the list merge a union of additions, with removals honoured by the latest change per folder —
// not whole-list last-writer-wins. Other list preferences stay whole-list. Stored as one dict under the same key
// (folder by lower-cased name, each with its own stamp and kept flag, removals as tombstones), so old arrays read
// as kept at their stamp and new dicts merge per folder. The Inbox never stores (item 1).

interface QuietEntry {
  folder: string;
  at: number;
  by: string;
  kept: boolean;
  moved?: true;
}
type QuietDict = Record<string, QuietEntry>;

const quietClean = (v: string): string => String(v ?? '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
const quietLower = (s: string): string => s.toLowerCase();
const isQuietDict = (v: unknown): v is QuietDict => !!v && typeof v === 'object' && !Array.isArray(v);

function quietDictFromValue(value: unknown, outer: KeyedEntry | undefined): QuietDict {
  const inbox = quietLower(INBOX_FOLDER);
  const out: QuietDict = {};
  if (isQuietDict(value)) {
    for (const e of Object.values(value)) {
      if (!e || typeof e !== 'object') continue;
      const x = e as unknown as Record<string, unknown>;
      if (typeof x.folder !== 'string' || typeof x.at !== 'number' || !Number.isFinite(x.at) || typeof x.by !== 'string' || typeof x.kept !== 'boolean') continue;
      const c = quietClean(x.folder);
      const lower = quietLower(c);
      if (!lower || lower === inbox || out[lower]) continue;
      out[lower] = { folder: c, at: x.at, by: String(x.by).slice(0, 80), kept: x.kept, ...(x.moved === true ? { moved: true as const } : {}) };
    }
    return out;
  }
  if (!Array.isArray(value)) return out;
  const at = outer?.at ?? 0;
  const by = outer?.by ?? '';
  const moved = outer?.moved === true;
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const c = quietClean(item);
    const lower = quietLower(c);
    if (!c || lower === inbox || out[lower]) continue;
    out[lower] = { folder: c, at, by, kept: true, ...(moved ? { moved: true as const } : {}) };
  }
  return out;
}

function quietListFromDict(dict: QuietDict): string[] {
  const inbox = quietLower(INBOX_FOLDER);
  return Object.values(dict)
    .filter((e) => e.kept && quietLower(e.folder) !== inbox)
    .map((e) => e.folder)
    .sort((a, b) => (quietLower(a) < quietLower(b) ? -1 : quietLower(a) > quietLower(b) ? 1 : a < b ? -1 : a > b ? 1 : 0));
}

function quietEntryWins(a: QuietEntry, b: QuietEntry): boolean {
  if (!!a.moved !== !!b.moved) return !a.moved;
  if (a.at !== b.at) return a.at > b.at;
  return a.by > b.by;
}

function quietMergeDicts(a: QuietDict, b: QuietDict): QuietDict {
  const out: QuietDict = {};
  for (const lower of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[lower];
    const y = b[lower];
    out[lower] = !x ? y : !y ? x : quietEntryWins(y, x) ? y : x;
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

/** Two copies of a document made one, key by key (the order doesn't matter: merging A into B is merging B into A). */
export function mergeDocs(a: KeyedDoc | null, b: KeyedDoc | null, kind = a?.neuralvault ?? b?.neuralvault ?? 'settings'): KeyedDoc {
  const out = emptyDoc(kind);
  for (const doc of [a, b]) {
    if (!doc) continue;
    for (const [key, e] of Object.entries(doc.keys)) {
      if (key === 'quietFolders') {
        const have = out.keys[key];
        const merged = quietMergeDicts(have ? quietDictFromValue(have.value, have) : {}, quietDictFromValue(e.value, e));
        const winners = Object.values(merged);
        const outer = !winners.length ? (have && wins(have, e) ? have : e) : null;
        const at = outer ? outer.at : Math.max(...winners.map((w) => w.at));
        const by = outer ? outer.by : winners.filter((w) => w.at === at).map((w) => w.by).sort().pop() ?? '';
        const moved = outer ? outer.moved === true : winners.every((w) => w.moved === true);
        out.keys[key] = { value: merged, at, by, ...(moved ? { moved: true as const } : {}) };
        continue;
      }
      const have = out.keys[key];
      if (!have || wins(e, have)) out.keys[key] = e;
    }
  }
  return out;
}

export const sameDoc = (a: KeyedDoc | null, b: KeyedDoc | null) => !!a && !!b && docText(a) === docText(b);

/** Values written into a document: only those that differ from what it holds get the time and this PC. */
export function setValues(doc: KeyedDoc, values: Record<string, unknown>, at: number, by: string): { doc: KeyedDoc; changed: string[] } {
  const next: KeyedDoc = { ...doc, keys: { ...doc.keys } };
  const changed: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (key === 'quietFolders' && Array.isArray(value)) {
      const have = next.keys[key];
      const oldDict = quietDictFromValue(have?.value, have);
      const inbox = quietLower(INBOX_FOLDER);
      const cleaned: string[] = [];
      const seen = new Set<string>();
      for (const item of value) {
        if (typeof item !== 'string') continue;
        const c = quietClean(item);
        const lower = quietLower(c);
        if (!c || lower === inbox || seen.has(lower)) continue;
        seen.add(lower);
        cleaned.push(c);
      }
      const nextDict: QuietDict = { ...oldDict };
      let touched = false;
      for (const c of cleaned) {
        const lower = quietLower(c);
        const old = oldDict[lower];
        if (!old || !old.kept || old.folder !== c) {
          nextDict[lower] = { folder: c, at, by, kept: true };
          touched = true;
        }
      }
      for (const [lower, old] of Object.entries(oldDict)) {
        if (old.kept && !seen.has(lower)) {
          nextDict[lower] = { folder: old.folder, at, by, kept: false };
          touched = true;
        }
      }
      if (!touched) continue;
      next.keys[key] = { value: Object.fromEntries(Object.keys(nextDict).sort().map((k) => [k, nextDict[k]])), at, by };
      changed.push(key);
      continue;
    }
    const have = next.keys[key];
    if (have && sameValue(have.value, value)) continue;
    next.keys[key] = { value, at, by };
    changed.push(key);
  }
  return { doc: next, changed };
}

export function docValues(doc: KeyedDoc | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, e] of Object.entries(doc?.keys ?? {})) {
    if (k === 'quietFolders') {
      const inbox = quietLower(INBOX_FOLDER);
      if (isQuietDict(e.value)) out[k] = quietListFromDict(e.value);
      else if (Array.isArray(e.value)) out[k] = (e.value as unknown[]).filter((x): x is string => typeof x === 'string').map(quietClean).filter((c) => c && quietLower(c) !== inbox);
      else out[k] = e.value;
      continue;
    }
    out[k] = e.value;
  }
  return out;
}

/** A PC's own settings brought into a document the first time: each value the PC had changed from its default, marked as
 *  brought in at `at` (when the PC's file was last written). A key the document already holds keeps the deliberate change,
 *  or the more recent of two brought in; a value the PC never changed never replaces another PC's choice. */
export function moveIn(doc: KeyedDoc | null, kind: string, values: Record<string, unknown>, defaults: Record<string, unknown>, at: number, by: string): { doc: KeyedDoc; taken: string[] } {
  const incoming = emptyDoc(kind);
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (key in defaults && sameValue(value, defaults[key])) continue;
    incoming.keys[key] = { value, at, by, moved: true };
  }
  const merged = mergeDocs(doc, incoming, kind);
  const taken = Object.keys(incoming.keys).filter((k) => merged.keys[k] === incoming.keys[k]);
  return { doc: merged, taken };
}

// ── Preferences split by home, and put together again ────────────────────────────────────────────────────────────────

export interface PrefParts {
  vault: Record<string, unknown>;
  personal: Record<string, unknown>;
  pc: Record<string, unknown>;
}

/** The preferences (all or some) by home; 'hidden' goes in two parts. */
export function splitPrefs(prefs: Partial<Prefs>): PrefParts {
  const out: PrefParts = { vault: {}, personal: {}, pc: {} };
  for (const [key, value] of Object.entries(prefs)) {
    if (value === undefined) continue;
    const home = PREF_HOME[key as keyof Prefs];
    if (!home) continue;
    if (home === 'split') {
      const list = Array.isArray(value) ? (value as string[]) : [];
      out.vault[key] = list.filter((id) => hiddenHome(id) === 'vault');
      out.personal[key] = list.filter((id) => hiddenHome(id) === 'personal');
    } else out[home][key] = value;
  }
  return out;
}

/** The preferences put together: this PC's own, then the person's, then the vault's ('hidden' from both). Only keys that
 *  belong to each part are taken from it. */
export function joinPrefs(pcPrefs: Partial<Prefs>, personal: Record<string, unknown>, vault: Record<string, unknown>): Partial<Prefs> {
  const out: Record<string, unknown> = { ...pcPrefs };
  const take = (from: Record<string, unknown>, home: 'vault' | 'personal') => {
    for (const [key, value] of Object.entries(from)) {
      const h = PREF_HOME[key as keyof Prefs];
      if (h === home) out[key] = value;
    }
  };
  take(personal, 'personal');
  take(vault, 'vault');
  const hidden = (pcPrefs.hidden ?? []) as string[];
  const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : null);
  const pHidden = list(personal.hidden) ?? hidden.filter((id) => hiddenHome(id) === 'personal');
  const vHidden = list(vault.hidden) ?? hidden.filter((id) => hiddenHome(id) === 'vault');
  out.hidden = [...pHidden.filter((id) => hiddenHome(id) === 'personal'), ...vHidden.filter((id) => hiddenHome(id) === 'vault')];
  return out as Partial<Prefs>;
}

// ── What Ironleaf remembers about a vault, split by home ──────────────────────────────────────────────────────────

/** A memory's vault part as keyed values, and the memory as it stays on this PC (whole: it is this PC's copy of everything,
 *  the vault's part read from the vault over it). Null vault part: nothing of it is the vault's. */
export function splitState(name: string, value: unknown): { vault: Record<string, unknown> | null } {
  const plan = STATE_PLAN[name];
  if (!plan) return { vault: null };
  if (plan.home === 'vault' && !plan.vault) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return { vault: { ...(value as Record<string, unknown>) } };
    return { vault: value === undefined || value === null ? {} : { _: value } };
  }
  if (!plan.vault?.length || !value || typeof value !== 'object' || Array.isArray(value)) return { vault: null };
  const pick = (o: Record<string, unknown>) => Object.fromEntries(plan.vault!.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  if (plan.nested) {
    const out: Record<string, unknown> = {};
    for (const [key, each] of Object.entries(value as Record<string, unknown>)) {
      if (!each || typeof each !== 'object' || Array.isArray(each)) continue;
      const part = pick(each as Record<string, unknown>);
      if (Object.keys(part).length) out[key] = part;
    }
    return { vault: out };
  }
  return { vault: pick(value as Record<string, unknown>) };
}

/** A memory put together: this PC's copy, with the vault's part over it (a project the vault knows and this PC doesn't is
 *  added). */
export function joinState(name: string, local: unknown, vault: Record<string, unknown> | null): unknown {
  const plan = STATE_PLAN[name];
  if (!plan || !vault) return local;
  if (plan.home === 'vault' && !plan.vault) {
    if ('_' in vault && Object.keys(vault).length === 1) return vault._;
    if (!Object.keys(vault).length) return local;
    return { ...(local && typeof local === 'object' && !Array.isArray(local) ? (local as Record<string, unknown>) : {}), ...vault };
  }
  const base = local && typeof local === 'object' && !Array.isArray(local) ? { ...(local as Record<string, unknown>) } : {};
  if (plan.nested) {
    for (const [key, part] of Object.entries(vault)) {
      if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
      const mine = base[key] && typeof base[key] === 'object' ? (base[key] as Record<string, unknown>) : {};
      base[key] = { ...mine, ...(part as Record<string, unknown>) };
    }
    return base;
  }
  return { ...base, ...vault };
}

// ── For people: what lives where ────────────────────────────────────────────────────────────────────────────────────

/** Settings › Files and links' plain words for where things are kept. */
export const HOME_WORDS: Record<SettingHome, { title: string; words: string }> = {
  vault: { title: 'In the vault', words: 'Its folders and links, Today’s sections, the side bar’s order, bookmarks, views, the graph and the timeline, templates and suggestions put away. Every PC that opens it shows the same.' },
  personal: { title: 'Yours', words: 'The look, text size, the editor and your keys.' },
  pc: { title: 'This PC only', words: 'The window’s size, open tabs, project folders, the model chosen, file recovery and the microphone.' },
};

/** Conflict copies of a keyed document that OneDrive or Dropbox made beside it ("settings-OFFICE-PC.json", "settings
 *  (Mia's conflicted copy 2026-10-23).json"): their names, from a folder's names. */
export function docConflictCopies(file: string, names: string[]): string[] {
  const stem = file.replace(/\.json$/i, '');
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const onedrive = new RegExp(`^${esc}-[A-Za-z0-9][A-Za-z0-9_-]{0,40}\\.json$`, 'i');
  const dropbox = new RegExp(`^${esc} \\([^)]*conflicted copy[^)]*\\)\\.json$`, 'i');
  return names.filter((n) => n !== file && (onedrive.test(n) || dropbox.test(n)));
}
