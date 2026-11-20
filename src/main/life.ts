// The vault as a life OS, the main side (Wave 4, 24 Oct 2026): areas of life (src/shared/areas.ts), the move into areas
// with its safety copy (src/shared/area-migration.ts), People and Organisations (src/shared/people.ts), the Inbox and
// its triage (src/shared/inbox.ts) and the tag manager (src/shared/tags.ts). Everything goes through the app's own ways
// in (src/main/app.ts hands them over): notes written and indexed as every change is, things moved with the app's own
// move so every link is brought up to date, projects changed through the project page's own edit.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AREAS_FILE, areaOf, defaultConfig, homeIn, isPeopleNote, kindOf, readAreas, writeAreas, type Area, type AreaPlaces, type AreasConfig } from '../shared/areas';
import { followPathsIn, movedPaths, movesOf, planMigration, planWords, withChoices, type MigrationPlan } from '../shared/area-migration';
import { appendUnder } from '../shared/capture';
import { newLogText, projectLogPath } from '../shared/capture-flows';
import { changeProps, readProps } from '../shared/frontmatter';
import { folderNoteTitle, folderNoteWords, inboxLines, INBOX_FOLDER, INBOX_NOTE, isFillerNoteTitle, itemLines, itemNoteText, itemStep, itemTitle, sharedTitleWords, suggestFiling, withoutItem, type FilingTarget, type InboxItem, type InboxSuggestion } from '../shared/inbox';
import { encodeLinkPath, escapeRegExp, maskCode, normalizeTarget, replaceMarkdownLinks, replaceWikilinks, titleFromPath, trackFence } from '../shared/markdown';
import { isEmptyNote, readTypes, resolveTypes } from '../shared/note-types';
import { cardSuggestions, cardText, isProtected, lastContactOf, mergedHeading, personCard, personCards, personQuiet, pickNewCards, samePairKey, samePeople, type CardSuggestion, type MergePreview, type PersonCard, type SamePerson } from '../shared/people';
import { isProjectProps, parseProject, safeName, type ProjectEdit } from '../shared/project-file';
import { connectedTo, isOpen, type PersonItems, type RecordModel, type RecordPeek, type VaultRecord } from '../shared/records';
import { relinkPropsInText } from '../shared/relation-links';
import { removeTag, renameTag, tagUses, type TagUse } from '../shared/tags';
import { DOCS_FOLDER, isDocNote, newDocText } from '../shared/doc-file';
import { docFactsToMore, NO_FACTS, sameDocument } from '../shared/doc-versions';
import { attachmentName, readEmailFile, senderAddress, type EmailDoc } from '../shared/email-file';
import { meetingDay } from '../shared/hub';
import { isMeetingNote } from '../shared/meetings';
import { emailAttachmentsFor, emailFileStem, emailNoteText, fieldsOf, findEmailById, isEmailProps, matchPersonByAddress, strangerName, strangerOrg, type EmailFields } from '../shared/email-note';
import { dueWords, isoOf } from '../shared/finance';
import { buildFileUser, cleanFilingTitle, filedLineWords, INBOX_FILE_SYSTEM, isFinishedTarget, isPrivateTarget, isUntitledNoteTitle, parseFileProposals, reminderLineFor, splitSureUnsure, trimFileVault, type FileProposal, type FileVault } from '../shared/inbox-file';
import { appendReminderLine, REMINDER_HOME } from '../shared/reminders';
import { isPrivatePath } from '../shared/private';
import { isFinished } from '../shared/finished';
import type { NoteMeta } from '../shared/types';
import type { VaultIndex } from './indexer';
import { foldState, planAreaFold, runAreaFold, undoAreaFold, type FoldWork } from './area-fold';
import { readTypesFile } from './note-types';
import { filesFolderFor, titleFromName } from '../shared/file-records';
import type { Vault } from './vault';
import { vaultFiles } from './vault-home';
import { followMoves } from './workspaces';
import { writeZip } from './zip';

export interface LifeDeps {
  handle(channel: string, fn: (...args: any[]) => unknown): void;
  vault(): Vault;
  index: VaultIndex;
  prefs(): { templatesFolder: string; assetsFolder: string; attachmentsFolder: string };
  dailyFolder(): string;
  records(): RecordModel;
  movePath(from: string, to: string, updateLinks: boolean): Promise<{ path: string; linksUpdated: number; notesUpdated: number }>;
  indexFile(v: Vault, rel: string): Promise<string | null>;
  refreshFiles(v: Vault): Promise<void>;
  changed(paths: string[]): void;
  filesChanged(): void;
  requireCreate(): Promise<void>;
  editProject(rel: string, edit: ProjectEdit, version: string): Promise<unknown>;
  /** An item that reads as one of a module's records (an emailed bill: Finance, src/main/record-modules.ts), or null. */
  moduleSuggestion?(item: InboxItem): Promise<{ name: string; amount: number; due: string | null; existing?: string } | null>;
  /** An item filed into its module (the bill updated or made; a file kept with it). */
  fileToModule?(item: InboxItem): Promise<{ words: string; paths: string[] }>;
  /** An item that reads as a receipt (a photo or PDF's words: Finance, with the open bill it looks like), or null. */
  receiptSuggestion?(item: InboxItem): Promise<{ merchant: string; total: number; date: string; category: string; duplicate: boolean; bill?: { path: string; name: string; why: string } } | null>;
  /** An item filed as a receipt (its row in Money, its file kept beside the month, with Undo). */
  fileReceipt?(item: InboxItem): Promise<{ words: string; paths: string[]; undo: string; bill?: { path: string; name: string; why: string } }>;
  /** Where an item would go in the modules made of records that are on (one of their records named in it: Home, Vehicles,
   *  Career, Travel; Wave 7 part a), each saying what filing it does. */
  moduleRecordSuggestions?(item: InboxItem): Promise<InboxSuggestion[]>;
  /** An item filed into one of those records (a line added to it; a file kept with `keepWith`), or null when the module
   *  isn't one of them. */
  fileToModuleRecord?(item: InboxItem, target: FilingTarget): Promise<{ words: string; paths: string[]; keepWith?: string } | null>;
  /** The connected model, asked for JSON (null when none is set up); and whether the assistant may read a note. */
  askJson?(system: string, user: string): Promise<{ reply: unknown; error?: string }>;
  assistantMay?(rel: string): boolean;
  /** Where full backups go (the app's own data folder; a vault-local fallback when missing, like the tidy-ups). */
  dataDir?: string;
  device?: { id: string; name: string };
  appVersion?: string;
  /** A note's links synced back after a direct write (the relations seam): its path with its words before and after. */
  syncAfterWrite?(rel: string, before: string, after: string): Promise<void> | void;
  /** Inside the former host app: the person's mailboxes (Gmail, Outlook) through the connection they already have
   *  — recent mail listed, one mail read whole with its attachments' bytes. Absent standalone. */
  mail?: {
    mailboxes(): Promise<{ id: string; label: string; address: string }[]>;
    list(mailbox: string, limit: number): Promise<{ uid: number; from: string; date: string; subject: string; words: string; unread: boolean }[]>;
    /** One mail whole, as its MIME bytes (parsed here, as a saved .eml is). */
    read(mailbox: string, uid: number): Promise<{ raw: Uint8Array }>;
  };
}

export interface PurposefulDeps {
  model: RecordModel;
  propsOf(path: string): Record<string, unknown> | undefined;
  areas: readonly Area[];
  places?: AreaPlaces;
}

/** A property's words as the connected model reads them (src/shared/records.ts). */
const propText = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : Array.isArray(v) ? v.map(String).join(', ') : '');

/** A served people card with health kept off work people (t21, 8 Nov 2026, 4 Nov): every door (People page, person
 *  page, Peek's summary, the project panel, the brief's people lines, the former host app's embed) reads through
 *  here, so protected notes, actions, meetings and roles are filtered out of unprotected cards here, using the
 *  index's properties plus areas and the same protected rule the People page uses. A role comes from work sources
 *  only; a health role shows only inside Health (a protected card keeps everything). Membership is untouched:
 *  their projects still name them. */
export function purposefulCard(card: PersonCard, deps: PurposefulDeps): PersonCard {
  const { model, propsOf, areas, places } = deps;
  const hidden = (p: string | undefined): boolean => {
    if (!p) return false;
    return isProtected(propsOf(p), areaOf({ path: p, props: propsOf(p) }, areas, places)?.id);
  };
  const own = card.path ?? card.namedIn;
  if (own && hidden(own)) return card;
  const pathOf = (id: string, fallback?: string): string | undefined => model.records.get(id)?.path ?? fallback;
  const notes = card.notes.filter((n) => !hidden(pathOf(n.id, n.path)));
  const youOweItems = card.youOweItems.filter((a) => !hidden(pathOf(a.id, a.path)));
  const owesYouItems = card.owesYouItems.filter((a) => !hidden(pathOf(a.id, a.path)));
  const doneItems = card.doneItems.filter((a) => !hidden(pathOf(a.id, a.path)));
  const keptIds = new Set([...youOweItems, ...owesYouItems].map((a) => a.id));
  const openItems = card.openItems.filter((o) => keptIds.has(o.id));
  const droppedOpen = [...card.youOweItems, ...card.owesYouItems]
    .filter((a) => !keptIds.has(a.id))
    .filter((a) => {
      const r = model.records.get(a.id);
      return r ? isOpen(r) : true;
    }).length;
  const meetings = card.meetings.filter((m) => !hidden(pathOf(m.id, m.path)));
  const nextMeeting = meetings.filter((m) => m.date && m.date >= model.today).sort((a, z) => (a.date ?? '').localeCompare(z.date ?? ''))[0];
  const keptMeetings = new Set(meetings.map((m) => m.id));
  const ownProps = card.path ? propsOf(card.path) : undefined;
  const lastContact = card.lastContact?.id && !keptMeetings.has(card.lastContact.id) ? lastContactOf(meetings, ownProps, model.today) : card.lastContact;
  // Their own page's role first (the model reads pages before projects, so it is already the card's when
  // present), else the first role an unprotected project gives them, in the order the model saw the notes. A
  // contact link carries the role or a generic "In …" fallback; meetings never set roles.
  let role: string | undefined;
  if (propText(ownProps?.role ?? ownProps?.title ?? ownProps?.position)) role = card.role;
  else
    for (const l of model.links) {
      if (l.kind !== 'contact' || (l.a !== card.id && l.b !== card.id)) continue;
      const rec = model.records.get(l.a === card.id ? l.b : l.a);
      if (!rec || rec.type !== 'project' || hidden(rec.path)) continue;
      if (l.why && !l.why.startsWith('In ')) {
        role = l.why;
        break;
      }
    }
  const out: PersonCard = { ...card, notes, youOweItems, owesYouItems, doneItems, youOwe: youOweItems.length, owesYou: owesYouItems.length, openItems, open: card.open - droppedOpen, meetings };
  if (role === undefined) delete out.role;
  else out.role = role;
  if (nextMeeting) out.nextMeeting = nextMeeting;
  else delete out.nextMeeting;
  if (lastContact) out.lastContact = lastContact;
  else delete out.lastContact;
  if (out.quiet) {
    const q = personQuiet({ meetings, ...(lastContact ? { lastContact } : {}), ...(nextMeeting ? { nextMeeting } : {}) }, model.today);
    if (q) out.quiet = q;
    else delete out.quiet;
  }
  return out;
}

/** Whether a path stays out of an unprotected person's views: the same protected rule the served cards
 *  filter by (t21 follow-up, 8 Nov 2026). */
export function purposefulHidden(rel: string, deps: Pick<PurposefulDeps, 'propsOf' | 'areas' | 'places'>): boolean {
  return isProtected(deps.propsOf(rel), areaOf({ path: rel, props: deps.propsOf(rel) }, deps.areas, deps.places)?.id);
}

/** A peek with health kept off work people (t21 follow-up): for an unprotected person's peek, protected joins go
 *  (every kind but projects and people, which are membership, as on the cards) and the role fact reads the served
 *  card. Protected peeks and non-person peeks pass through untouched. Builds on purposefulCard; the model is never
 *  mutated. */
export function purposefulPeek(peek: RecordPeek | null, deps: PurposefulDeps): RecordPeek | null {
  if (!peek || (peek.record.type !== 'person' && peek.record.type !== 'org')) return peek;
  if (purposefulHidden(peek.record.path, deps)) return peek;
  const { model, propsOf } = deps;
  const card = personCard(model, peek.record.id, peek.record.page ? propsOf(peek.record.path) : undefined);
  const role = card ? purposefulCard(card, deps).role : undefined;
  const groups = peek.groups
    .map((g) => ({ ...g, items: g.items.filter((it) => it.record.type === 'project' || it.record.type === 'person' || it.record.type === 'org' || !purposefulHidden(it.record.path, deps)) }))
    .filter((g) => g.items.length);
  const facts = role
    ? peek.record.facts.some((f) => f.key === 'role')
      ? peek.record.facts.map((f) => (f.key === 'role' ? { ...f, value: role } : f))
      : [...peek.record.facts, { key: 'role', label: 'Role', value: role }]
    : peek.record.facts.filter((f) => f.key !== 'role');
  return { ...peek, record: { ...peek.record, facts }, groups };
}

/** A person's open items with health kept off work people (t28 follow-up, 8 Nov 2026): the same rule as
 *  every other people door (the served cards, the peek, Related). The `records:person` answer serves raw open
 *  items with no filter, so any future caller would read protected actions, meetings, workstreams and risks
 *  off a work person's Timeline. Protected lists go from an unprotected person's answer; their projects stay
 *  (membership, as on the cards and the peek); a protected person's own answer passes through untouched. The
 *  model is never mutated. */
export function purposefulPersonItems(items: PersonItems | null, deps: PurposefulDeps): PersonItems | null {
  if (!items) return items;
  if (purposefulHidden(items.person.path, deps)) return items;
  const keep = (r: VaultRecord) => !purposefulHidden(r.path, deps);
  return { ...items, theirs: items.theirs.filter(keep), about: items.about.filter(keep), doneTheirs: items.doneTheirs.filter(keep), doneAbout: items.doneAbout.filter(keep), workstreams: items.workstreams.filter(keep), risks: items.risks.filter(keep), meetings: items.meetings.filter(keep) };
}

/** Related beside an unprotected person's page never suggests a protected note: the skip for it, or null
 *  everywhere else (and inside Health). The same rule the served cards filter by. */
export function purposefulRelatedSkip(rel: string, deps: Pick<PurposefulDeps, 'propsOf' | 'areas' | 'places'>): ((p: string) => boolean) | null {
  if (!isPeopleNote(rel, deps.propsOf(rel))) return null;
  if (purposefulHidden(rel, deps)) return null;
  return (p: string) => purposefulHidden(p, deps);
}

const SAFETY_DIR = '.neuralvault/safety';
const JOURNAL_DIR = '.neuralvault/migrations';
const PEOPLE_FILE = '.neuralvault/people.json';
const MERGED_DIR = '.neuralvault/merged';
/** The last people merge, as it was before (one slot: merging again replaces it). */
const MERGE_JOURNAL = '.neuralvault/journal/merge-last.json';
const MAX = 512 * 1024;

const pad = (n: number) => String(n).padStart(2, '0');
const stampOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
const dayWords = (d = new Date()) => `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`;
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.split('/').pop() ?? p;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-AU')} ${n === 1 ? one : many}`;

/** Whether `phrase` reads whole in `text` (not inside a word or a hyphenated name), any case. */
function hasPhrase(text: string, phrase: string): boolean {
  if (!phrase.trim()) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}_-])`, 'iu').test(text);
}

/** Every whole-phrase match of `phrase` in `text` (any case): their starts and ends. */
function phraseRanges(text: string, phrase: string): [number, number][] {
  if (!phrase.trim()) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}_-])`, 'giu');
  const out: [number, number][] = [];
  for (const m of text.matchAll(re)) out.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return out;
}

const sameSpelling = (a: string, b: string): boolean => {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return !!clean(a) && clean(a) === clean(b);
};

const ALIAS_KEY = /^\s*(aliases|alias|known\s+as|known_as|known-as|knownas|also\s+known\s+as|aka|nicknames?)\s*:/i;
const FRONT_KEY = /^\s*[A-Za-z0-9 _-]+\s*:/;

/** A merge's renames in one file's words (9 Nov 2026, one person one page): every other name to the kept
 *  spelling, outside code and links (links keep their alias, code keeps its words), never inside the kept
 *  name itself, and never a bare first name where another full person of that name is also named. */
function rewriteMentions(text: string, renames: { from: string; to: string }[], keepTitle: string, skipFrom: ReadonlySet<string>): string {
  if (!renames.length) return text;
  const lines = text.split('\n');
  let frontEnd = -1;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
        frontEnd = i;
        break;
      }
    }
  }
  let fence: { ch: string; len: number } | null = null;
  let inAliases = false;
  const ordered = [...renames].sort((a, b) => b.from.length - a.from.length);
  for (let i = 0; i < lines.length; i++) {
    const tracked = trackFence(lines[i], fence);
    fence = tracked.fence;
    if (tracked.skip) continue;
    if (i <= frontEnd) {
      if (ALIAS_KEY.test(lines[i])) {
        inAliases = true;
        continue;
      }
      if (/^\s*-\s+/.test(lines[i]) && inAliases) continue;
      if (FRONT_KEY.test(lines[i])) inAliases = false;
    } else inAliases = false;
    let line = lines[i];
    for (const { from, to } of ordered) {
      if (skipFrom.has(from) || !from.trim() || from === to) continue;
      const masked = maskCode(line).replace(/!?\[\[[^[\]\n]*\]\]/g, (s) => ' '.repeat(s.length));
      const keepRanges = sameSpelling(from, keepTitle) ? [] : phraseRanges(masked, keepTitle);
      const hits = phraseRanges(masked, from).filter(([s, e]) => !keepRanges.some(([ks, ke]) => s < ke && e > ks));
      if (!hits.length) continue;
      for (let h = hits.length - 1; h >= 0; h--) line = line.slice(0, hits[h][0]) + to + line.slice(hits[h][1]);
    }
    lines[i] = line;
  }
  return lines.join('\n');
}

async function readSmall(abs: string): Promise<string | null> {
  try {
    const st = await fsp.stat(abs);
    if (st.size > MAX * 8) return null;
    return await fsp.readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

async function writeWhole(abs: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const temp = `${abs}.${process.pid}.tmp`;
  await fsp.writeFile(temp, text, 'utf8');
  await fsp.rename(temp, abs);
}

export function registerLife(d: LifeDeps): void {
  const { handle, index } = d;
  const root = () => d.vault().root;
  const abs = (rel: string) => path.join(root(), ...rel.split('/'));
  // One Inbox change at a time (Nov 2026 break: filing one capture twice at once, or the
  // self-filing racing a hand filing, wrote its words twice). Every Inbox mutation below
  // registers through inboxHandle, so each sees the last one's finished work.
  let inboxTail: Promise<void> = Promise.resolve();
  const withInbox = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = inboxTail.then(fn, fn);
    inboxTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const inboxHandle = (channel: string, fn: (...args: any[]) => unknown): void => handle(channel, (...args: any[]) => withInbox(() => Promise.resolve(fn(...args))));

  // ── Areas ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  async function areasConfig(): Promise<AreasConfig | null> {
    return readAreas(await readSmall(abs(AREAS_FILE))).config;
  }
  handle('areas:load', async () => (await readSmall(abs(AREAS_FILE))) ?? '');
  handle('areas:save', async (text: unknown) => {
    if (typeof text !== 'string' || text.length > MAX) throw new Error('Those areas can’t be saved.');
    const { config, problem } = readAreas(text);
    if (problem || !config) throw new Error('Those areas can’t be saved.');
    await writeWhole(abs(AREAS_FILE), writeAreas(config));
  });
  /** An area's folder renamed with it (everything inside keeps its links: the app's own move). */
  handle('areas:rename-folder', async (from: unknown, to: unknown) => {
    await d.requireCreate();
    if (typeof from !== 'string' || typeof to !== 'string' || !from || !to || from.includes('/') || to.includes('/')) throw new Error('That folder can’t be renamed.');
    if (!(await d.vault().any(from))) return { path: to, linksUpdated: 0 };
    return d.movePath(from, to, true);
  });

  // ── Folding one area into another ─────────────────────────────────────────────────────────────────────────────────
  // Health into Me: its folder moves with the app's own move, its area leaves the list, one Undo per fold.

  const foldWork = (): FoldWork => ({
    root: root(),
    index,
    movePath: (from, to, updateLinks) => d.movePath(from, to, updateLinks),
    indexFile: (rel) => d.indexFile(d.vault(), rel).then(() => undefined),
    refreshFiles: () => d.refreshFiles(d.vault()),
    changed: (paths) => d.changed(paths),
    filesChanged: () => d.filesChanged(),
    ...(d.syncAfterWrite ? { syncAfterWrite: d.syncAfterWrite } : {}),
    ...(d.dataDir ? { dataDir: d.dataDir } : {}),
    ...(d.device ? { device: d.device } : {}),
    ...(d.appVersion ? { appVersion: d.appVersion } : {}),
  });

  handle('areas:fold-preview', async (from: unknown, toArea: unknown) => {
    if (typeof from !== 'string' || typeof toArea !== 'string') throw new Error('Pick the area it moves into.');
    return planAreaFold(foldWork(), from, toArea);
  });
  handle('areas:fold-run', async (from: unknown, toArea: unknown) => {
    await d.requireCreate();
    if (typeof from !== 'string' || typeof toArea !== 'string') throw new Error('Pick the area it moves into.');
    return runAreaFold(foldWork(), from, toArea);
  });
  handle('areas:fold-undo', async () => {
    await d.requireCreate();
    return undoAreaFold(foldWork());
  });
  handle('areas:fold-state', async () => foldState(foldWork()));

  const places = () => ({ ...d.prefs(), dailyFolder: d.dailyFolder() });

  // ── The move into areas ───────────────────────────────────────────────────────────────────────────────────────────

  function migrationInput(config: AreasConfig) {
    const metas = index.allMeta().filter((m) => !/^private notes\//i.test(m.path));
    const notes = metas.map((m) => ({ path: m.path, props: m.props ?? {}, tags: m.tags, links: [...new Set(m.links.map((l) => index.resolveAny(l.target, m.path)).filter((p): p is string => !!p))] }));
    const model = d.records();
    const joins = new Map<string, string[]>();
    const join = (a: string, b: string) => {
      if (!a || !b || a === b) return;
      joins.set(a, [...new Set([...(joins.get(a) ?? []), b])]);
    };
    for (const r of model.records.values()) {
      if (!r.page) continue;
      if (r.project && r.project !== r.path) join(r.path, r.project);
      if (r.type === 'person' || r.type === 'org') {
        for (const x of connectedTo(model, r.id)) {
          const p = x.record.type === 'project' ? x.record.path : x.record.project;
          if (p) join(r.path, p);
          if (x.record.type === 'meeting') join(r.path, x.record.path);
        }
      }
    }
    return { notes, joins, areas: config.areas };
  }

  async function makePlan(config: AreasConfig): Promise<MigrationPlan> {
    const v = d.vault();
    const { files } = await v.listAll();
    const { notes, joins, areas } = migrationInput(config);
    const input = { notes, files: files.filter((f) => f.kind !== 'note').map((f) => f.rel), areas, places: places(), joins };
    const first = planMigration(input);
    const readings = await readUnsure(first, areas).catch(() => null);
    return readings?.size ? planMigration({ ...input, readings }) : first;
  }

  /** What the things the vault itself can't place are about (26 Oct 2026): the connected model reads each one's name and
   *  opening lines (only notes the assistant may read; the rest by name) beside every area's own words, and says the area
   *  it belongs in and why, or none. Nothing is moved by this: the preview shows the reason, and the person moves it. */
  async function readUnsure(plan: MigrationPlan, areas: Area[]): Promise<Map<string, { area: string; why: string }> | null> {
    if (!d.askJson) return null;
    const unsure = plan.units.filter((u) => u.sure !== 'sure').slice(0, 80);
    if (!unsure.length) return null;
    const v = d.vault();
    const items: { path: string; kind: string; name: string; text?: string }[] = [];
    for (const u of unsure) {
      const file = u.folder ? (index.allMeta().find((m) => m.path.startsWith(`${u.path}/`) && isProjectProps(m.props))?.path ?? '') : u.path;
      let text = '';
      if (file && /\.md$/i.test(file) && (d.assistantMay?.(file) ?? false)) {
        try {
          text = (await v.read(file)).replace(/^---[\s\S]*?\n---\s*/, '').replace(/\s+/g, ' ').slice(0, 420);
        } catch {}
      }
      items.push({ path: u.path, kind: u.kind, name: u.title, ...(text ? { text } : {}) });
    }
    const live = areas.filter((a) => !a.quiet);
    const system = [
      'You place the things in a person’s notes into their areas of life. Each area has its name and what it holds, in the person’s own words.',
      'For each item choose the ONE area it is about, judged by what it is (a home server or game server is the home and its devices; a job’s projects, sites and colleagues are work; their own company is business), or null when it is unclear.',
      'Reply with JSON only: {"items":[{"path":"…","area":"<area id or null>","why":"<at most 8 plain words>"}]}.',
    ].join(' ');
    const user = JSON.stringify({ areas: live.map((a) => ({ id: a.id, name: a.name, holds: a.about })), items });
    const r = await d.askJson(system, user);
    if (r.error || !r.reply || typeof r.reply !== 'object') return null;
    const list = (r.reply as { items?: unknown }).items;
    if (!Array.isArray(list)) return null;
    const out = new Map<string, { area: string; why: string }>();
    for (const x of list as { path?: unknown; area?: unknown; why?: unknown }[]) {
      const path = String(x?.path ?? ''), area = String(x?.area ?? '');
      if (!unsure.some((u) => u.path === path) || !live.some((a) => a.id === area)) continue;
      out.set(path, { area, why: `Read as ${String(x?.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || `about ${live.find((a) => a.id === area)!.name}`}` });
    }
    return out;
  }

  handle('areas:migration-plan', async (areasText: unknown) => {
    const config = (typeof areasText === 'string' && readAreas(areasText).config) || (await areasConfig()) || defaultConfig();
    const plan = await makePlan(config);
    return { plan, areas: config.areas, words: planWords(plan, config.areas) };
  });

  handle('areas:migration-last', async () => {
    const list = await fsp.readdir(abs(JOURNAL_DIR)).catch(() => [] as string[]);
    const last = list.filter((f) => f.endsWith('.json')).sort().pop();
    if (!last) return null;
    try {
      const j = JSON.parse((await readSmall(abs(`${JOURNAL_DIR}/${last}`))) ?? 'null');
      return j && typeof j === 'object' ? { file: last, at: j.at, words: j.words, undone: !!j.undone, safety: j.safety, moves: Array.isArray(j.moves) ? j.moves.length : 0 } : null;
    } catch {
      return null;
    }
  });

  /** Every link in every note, and what it reaches now. */
  function linkMap(): Map<string, { target: string; reached: string | null }[]> {
    const out = new Map<string, { target: string; reached: string | null }[]>();
    for (const m of index.allMeta()) out.set(m.path, m.links.map((l) => ({ target: l.target, reached: index.resolveAny(l.target, m.path) })));
    return out;
  }

  handle('areas:migration-apply', async (choices: unknown, areasText: unknown) => {
    await d.requireCreate();
    const v = d.vault();
    const config = (typeof areasText === 'string' && readAreas(areasText).config) || (await areasConfig()) || defaultConfig();
    const picked: Record<string, string> = {};
    if (choices && typeof choices === 'object') for (const [k, x] of Object.entries(choices as Record<string, unknown>)) if (typeof x === 'string') picked[k] = x;
    const plan = withChoices(await makePlan(config), picked, config.areas, d.prefs().attachmentsFolder);
    const moves = movesOf(plan);
    const at = new Date();

    // 1. The safety copy: the whole vault in one zip inside Ironleaf's own folder, before anything moves.
    const safetyRel = `${SAFETY_DIR}/Before areas ${stampOf(at)}.zip`;
    const { files: tree } = await vaultFiles(v.root);
    const sources = tree.filter((f) => !f.rel.startsWith(`${SAFETY_DIR}/`) && !/^\.git(\/|$)/.test(f.rel)).map((f) => ({ name: f.rel, abs: f.abs, mtime: f.mtime }));
    await fsp.mkdir(abs(SAFETY_DIR), { recursive: true });
    const zipped = await writeZip(abs(safetyRel), sources);

    // 2. What every link reaches before, and every path there is.
    const before = linkMap();
    const allBefore = [...index.allMeta().map((m) => m.path), ...(await v.listAll()).files.filter((f) => f.kind !== 'note').map((f) => f.rel)];

    // 3. The moves, each with the app's own move (every link that reached it rewritten).
    const done: [string, string][] = [];
    const problems: string[] = [];
    let linksUpdated = 0;
    for (const [from, to] of moves) {
      try {
        if (!(await v.any(from))) continue;
        if (await v.any(to)) {
          problems.push(`${to} was there already, so ${from} stayed where it was.`);
          continue;
        }
        const r = await d.movePath(from, to, true);
        linksUpdated += r.linksUpdated;
        done.push([from, r.path]);
      } catch (err) {
        problems.push(`${from}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const moved = movedPaths(done, allBefore);
    const folderMoves = done.filter(([from]) => !/\.[a-z0-9]{1,8}$/i.test(baseOf(from)));

    // 4. Projects' workspaces go with them.
    await followMoves(v.root, [...moved].filter(([a]) => /\.md$/i.test(a)));

    // 5. Paths written in Ironleaf's own files (views, layouts, the asset index, levels) and in notes' properties.
    let followed = 0;
    const jsonFiles = tree.filter((f) => /^\.neuralvault\/.+\.json$/i.test(f.rel) && !f.rel.startsWith(`${SAFETY_DIR}/`) && !f.rel.startsWith(`${JOURNAL_DIR}/`) && !f.rel.startsWith('.neuralvault/audit/')).map((f) => f.rel);
    const assetIndex = `${d.prefs().assetsFolder}/assets.json`;
    for (const rel of [...jsonFiles, assetIndex]) {
      const text = await readSmall(abs(rel));
      if (!text) continue;
      try {
        const { value, changed } = followPathsIn(JSON.parse(text), moved, folderMoves);
        if (!changed) continue;
        await writeWhole(abs(rel), `${JSON.stringify(value, null, text.includes('\t') ? '\t' : 2)}\n`);
        followed += changed;
      } catch {
        // A file that can't be read stays as it was; it says so where it is used.
      }
    }
    for (const m of index.allMeta()) {
      const props = m.props ?? {};
      const { value, changed } = followPathsIn(props, moved, folderMoves);
      if (!changed) continue;
      const next = value as Record<string, unknown>;
      try {
        const text = await v.read(m.path);
        const out = changeProps(text, (doc) => {
          for (const k of Object.keys(props)) if (JSON.stringify(props[k]) !== JSON.stringify(next[k])) doc.set(k, next[k]);
        });
        if (out !== text) {
          await v.write(m.path, out);
          await d.indexFile(v, m.path);
          await d.syncAfterWrite?.(m.path, text, out);
          followed += changed;
        }
      } catch {
        problems.push(`${m.path}: its properties couldn’t be brought up to date (they can’t be read).`);
      }
    }

    // 6. Every link checked: one that now reaches something else (two notes of one name, a shorter path) is written as
    //    the path of what it reached before.
    let pinned = 0;
    for (const [oldPath, links] of before) {
      const now = moved.get(oldPath) ?? oldPath;
      const want = new Map<string, string>();
      for (const l of links) {
        if (!l.reached) continue;
        const expected = moved.get(l.reached) ?? l.reached;
        if (index.resolveAny(l.target, now) !== expected) want.set(normalizeTarget(l.target), expected);
      }
      if (!want.size) continue;
      let text: string;
      try {
        text = await v.read(now);
      } catch {
        continue;
      }
      let count = 0;
      let out = replaceWikilinks(text, (link, raw, embed) => {
        const to = want.get(normalizeTarget(link.target));
        if (!to) return raw;
        count++;
        return `${embed ? '!' : ''}[[${/\.md$/i.test(to) ? to.replace(/\.md$/i, '') : to}${link.heading ? `#${link.heading}` : ''}|${link.alias ?? link.target}]]`;
      });
      out = replaceMarkdownLinks(out, (target, fragment, raw, embed, label) => {
        const to = want.get(normalizeTarget(target));
        if (!to) return raw;
        count++;
        return `${embed ? '!' : ''}[${label}](${to.replace(/ /g, '%20')}${fragment})`;
      });
      if (count && out !== text) {
        await v.write(now, out);
        await d.indexFile(v, now);
        await d.syncAfterWrite?.(now, text, out);
        pinned += count;
      }
    }

    // 7. Folders the move left empty (never the attachments, templates, assets or daily notes folders).
    const keep = new Set([d.prefs().attachmentsFolder, d.prefs().templatesFolder, d.prefs().assetsFolder, d.dailyFolder(), INBOX_FOLDER].map((f) => (f ?? '').toLowerCase()));
    const emptied: string[] = [];
    const parents = [...new Set(done.flatMap(([from]) => {
      const out: string[] = [];
      for (let f = folderOf(from); f; f = folderOf(f)) out.push(f);
      return out;
    }))].sort((a, b) => b.length - a.length);
    for (const f of parents) {
      if (keep.has(f.toLowerCase()) || config.areas.some((a) => a.folder.toLowerCase() === f.toLowerCase())) continue;
      try {
        const left = (await fsp.readdir(abs(f))).filter((n) => !/^(desktop\.ini|thumbs\.db|\.ds_store)$/i.test(n));
        if (left.length) continue;
        await fsp.rm(abs(f), { recursive: true });
        emptied.push(f);
      } catch {
        // Not there or not empty: left.
      }
    }

    // 8. The areas, the journal (for Undo), and the window told.
    await writeWhole(abs(AREAS_FILE), writeAreas(config));
    const words = `Moved ${plural(done.length, 'thing')} into areas: ${planWords(withChoices(plan, {}, config.areas), config.areas)}`;
    const journal = { at: at.toISOString(), safety: safetyRel, safetyFiles: zipped.files, moves: done, pinned, linksUpdated, followed, emptied, problems, words, by: os.hostname() };
    await writeWhole(abs(`${JOURNAL_DIR}/${stampOf(at).replace(' ', '-')}.json`), `${JSON.stringify(journal, null, 2)}\n`);
    await d.refreshFiles(v);
    d.changed([...moved.values()]);
    d.filesChanged();
    return {
      moved: done.length,
      files: moved.size,
      linksUpdated,
      linksPinned: pinned,
      followed,
      emptied,
      problems,
      safety: safetyRel,
      words: `${plural(done.length, 'thing')} (${plural(moved.size, 'file')}) moved into areas, ${plural(linksUpdated + pinned, 'link')} brought up to date. A safety copy of the whole vault is in ${safetyRel}.`,
    };
  });

  handle('areas:migration-undo', async () => {
    await d.requireCreate();
    const v = d.vault();
    const list = (await fsp.readdir(abs(JOURNAL_DIR)).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort();
    const last = list.pop();
    if (!last) throw new Error('There is no move into areas to undo.');
    const j = JSON.parse((await readSmall(abs(`${JOURNAL_DIR}/${last}`))) ?? '{}') as { moves?: [string, string][]; undone?: boolean };
    if (j.undone) throw new Error('That move was undone already.');
    let back = 0;
    const problems: string[] = [];
    for (const [from, to] of [...(j.moves ?? [])].reverse()) {
      try {
        if (!(await v.any(to)) || (await v.any(from))) continue;
        await d.movePath(to, from, true);
        back++;
      } catch (err) {
        problems.push(`${to}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await writeWhole(abs(`${JOURNAL_DIR}/${last}`), `${JSON.stringify({ ...j, undone: new Date().toISOString() }, null, 2)}\n`);
    await d.refreshFiles(v);
    d.filesChanged();
    return { back, problems, words: `${plural(back, 'thing')} moved back where ${back === 1 ? 'it was' : 'they were'}.` };
  });

  // ── People and Organisations ──────────────────────────────────────────────────────────────────────────────────────

  async function notSame(): Promise<Set<string>> {
    try {
      const j = JSON.parse((await readSmall(abs(PEOPLE_FILE))) ?? '{}') as { notSame?: unknown };
      return new Set(Array.isArray(j.notSame) ? j.notSame.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  }
  const propsOf = (p: string) => index.get(p)?.props;
  /** What the served cards read: the index's properties plus the areas (read fresh, like areas:load). */
  async function purposefulDeps(model: RecordModel): Promise<PurposefulDeps> {
    const config = await areasConfig();
    const prefs = d.prefs();
    return { model, propsOf, areas: config?.areas ?? [], places: { templatesFolder: prefs.templatesFolder, assetsFolder: prefs.assetsFolder } };
  }
  handle('people:cards', async (): Promise<PersonCard[]> => {
    const model = d.records();
    const deps = await purposefulDeps(model);
    return personCards(model, propsOf).map((c) => purposefulCard(c, deps));
  });
  handle('people:card', async (id: unknown): Promise<PersonCard | null> => {
    if (typeof id !== 'string') return null;
    const model = d.records();
    const r = model.records.get(id);
    const c = personCard(model, id, r?.page ? propsOf(r.path) : undefined);
    return c ? purposefulCard(c, await purposefulDeps(model)) : null;
  });
  handle('people:suggestions', (): CardSuggestion[] => cardSuggestions(d.records()));
  /** What a merge would move (9 Nov 2026, one person one page): notes, meetings, mentions, links, tasks owned. */
  function mergePreviewFor(model: RecordModel, otherId: string): MergePreview {
    const r = model.records.get(otherId);
    const c = r ? personCard(model, otherId, r.page ? propsOf(r.path) : undefined) : null;
    let links = 0;
    if (r?.page) {
      for (const m of index.allMeta()) {
        if (m.path === r.path) continue;
        if (m.links.some((l) => index.resolveAny(l.target, m.path) === r.path) || (m.propLinks ?? []).some((l) => index.resolveAny(l.target, m.path) === r.path)) links++;
      }
    }
    return { notes: c?.notes.length ?? 0, meetings: c?.meetings.length ?? 0, mentions: c?.mentions ?? 0, links, tasksOwned: c?.owesYou ?? 0 };
  }
  handle('people:same', async (): Promise<SamePerson[]> => {
    const model = d.records();
    return samePeople(model, await notSame()).map((p) => ({ ...p, preview: mergePreviewFor(model, p.other) }));
  });
  handle('people:merge-preview', async (_keep: unknown, otherId: unknown): Promise<MergePreview> => {
    if (typeof otherId !== 'string') throw new Error('One of those isn’t there any more.');
    return mergePreviewFor(d.records(), otherId);
  });
  handle('people:not-same', async (a: unknown, b: unknown) => {
    if (typeof a !== 'string' || typeof b !== 'string') return;
    const set = await notSame();
    set.add(samePairKey(a, b));
    await writeWhole(abs(PEOPLE_FILE), `${JSON.stringify({ notSame: [...set].slice(-500) }, null, 2)}\n`);
  });

  async function freeNote(folder: string, name: string): Promise<string> {
    const v = d.vault();
    const base = safeName(name);
    for (let n = 1; n < 500; n++) {
      const rel = `${folder ? `${folder}/` : ''}${base}${n > 1 ? ` ${n}` : ''}.md`;
      if (!(await v.any(rel))) return rel;
    }
    throw new Error('There is no free name for that card.');
  }

  async function personFolder(areaId: string | undefined): Promise<{ folder: string; area?: string; family: boolean }> {
    const config = await areasConfig();
    const area = config?.areas.find((a) => a.id === areaId);
    if (area) return { folder: homeIn(area, 'people'), area: area.name, family: area.id === 'family' };
    const types = resolveTypes(readTypes(await readTypesFile(root())).config, { topFolders: (await d.vault().listAll()).folders.filter((f) => !f.includes('/')), templatesFolder: d.prefs().templatesFolder, docsFolder: DOCS_FOLDER });
    return { folder: types.find((t) => t.id === 'person')?.folder || 'People', family: false };
  }

  handle('people:make', async (list: unknown) => {
    await d.requireCreate();
    const v = d.vault();
    const model = d.records();
    const rows: { o: Record<string, unknown>; r: ReturnType<typeof model.records.get>; name: string }[] = [];
    for (const raw of Array.isArray(list) ? list.slice(0, 200) : []) {
      const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const r = typeof o.id === 'string' ? model.records.get(o.id) : undefined;
      const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : r?.title;
      if (!name) continue;
      rows.push({ o, r, name });
    }
    const cardTitles = [...model.records.values()].filter((x) => (x.type === 'person' || x.type === 'org') && x.page).map((x) => x.title);
    const fresh = pickNewCards(rows.map((x) => x.name), cardTitles);
    const made: string[] = [];
    const skipped = rows.filter((_, i) => !fresh[i]).map((x) => x.name);
    for (const [i, row] of rows.entries()) {
      if (!fresh[i]) continue;
      const { o, r, name } = row;
      const type = r?.type === 'org' || o.type === 'org' ? 'org' : 'person';
      const where = await personFolder(typeof o.area === 'string' ? o.area : undefined);
      const role = typeof o.role === 'string' ? o.role : r?.facts.find((f) => f.key === 'role')?.value;
      const projects = Array.isArray(o.projects) ? o.projects.filter((p): p is string => typeof p === 'string').slice(0, 6) : [];
      const rel = await freeNote(where.folder, name);
      await v.create(rel, cardText({ name, type, ...(role ? { role } : {}), ...(where.family ? { sensitivity: 'Family-private' } : {}), projects }));
      await d.indexFile(v, rel);
      made.push(rel);
    }
    d.changed(made);
    d.filesChanged();
    return { made, skipped };
  });

  /** Two cards made one: the kept one gets the other's names, properties it lacked and words (under a heading), every
   *  link to the other reaches the kept one, and the other's file is kept in Ironleaf's own folder (never deleted).
   *  Every link and mention follows (9 Nov 2026, one person one page): links rewritten, other names rewritten to the
   *  kept spelling outside code and links, never inside the kept name, never a bare first name where another full
   *  person of that name is also named. One Undo restores the vault byte for byte. */
  handle('people:merge', async (keepId: unknown, otherId: unknown) => {
    await d.requireCreate();
    const v = d.vault();
    const model = d.records();
    let keep = typeof keepId === 'string' ? model.records.get(keepId) : undefined;
    let other = typeof otherId === 'string' ? model.records.get(otherId) : undefined;
    if (!keep || !other) throw new Error('One of those isn’t there any more.');
    if (!keep.page && other.page) [keep, other] = [other, keep];
    const otherNames = [...new Set([other.title, ...(other.names ?? [])])];
    const renames = otherNames.filter((n) => n !== keep!.title).map((from) => ({ from, to: keep!.title }));
    const cleanFirst = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)[0] ?? '';
    const cleanLen = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    const singles = renames.filter((r) => cleanLen(r.from) === 1).map((r) => r.from);
    const conflictsBySingle = new Map<string, string[]>();
    for (const s of singles) {
      const first = cleanFirst(s);
      conflictsBySingle.set(
        s,
        [...model.records.values()].filter((r) => r.type === 'person' && r.id !== keep!.id && r.id !== other!.id && cleanLen(r.title) >= 2 && cleanFirst(r.title) === first).map((r) => r.title),
      );
    }
    const skipFor = (text: string): Set<string> => {
      const skip = new Set<string>();
      for (const [single, conflicts] of conflictsBySingle) if (conflicts.some((c) => hasPhrase(text, c))) skip.add(single);
      return skip;
    };
    const addAliases = (text: string, names: string[]) =>
      changeProps(text, (doc) => {
        const had = readProps(text).aliases;
        const list = [...new Set([...(Array.isArray(had) ? had.map(String) : typeof had === 'string' && had ? [had] : []), ...names])].filter((n) => n && n !== keep!.title);
        doc.set('aliases', list);
      });
    if (!keep.page) {
      // Neither has a card yet: one is made for the kept name, knowing the other, and other names rewritten.
      const where = await personFolder(undefined);
      const rel = await freeNote(where.folder, keep.title);
      await v.create(rel, addAliases(cardText({ name: keep.title, type: keep.type === 'org' ? 'org' : 'person' }), otherNames));
      await d.indexFile(v, rel);
      const touched: string[] = [rel];
      const befores: [string, string][] = [];
      for (const m of index.allMeta()) {
        if (m.path === rel || !/\.md$/i.test(m.path)) continue;
        const text = await v.read(m.path).catch(() => null);
        if (text === null || !renames.some((r) => hasPhrase(text, r.from))) continue;
        const out = rewriteMentions(text, renames, keep.title, skipFor(text));
        if (out === text) continue;
        await v.write(m.path, out);
        await d.indexFile(v, m.path);
        await d.syncAfterWrite?.(m.path, text, out);
        touched.push(m.path);
        befores.push([m.path, text]);
      }
      d.changed(touched);
      d.filesChanged();
      await writeWhole(abs(MERGE_JOURNAL), `${JSON.stringify({ at: new Date().toISOString(), undone: false, keepTitle: keep.title, otherTitle: other.title, created: rel, files: befores }, null, 2)}\n`);
      return { path: rel, words: `Made ${keep.title}’s card; ${other.title} is another name for them.` };
    }
    const keepTextOrig = await v.read(keep.path);
    if (!other.page) {
      const rewritten = rewriteMentions(keepTextOrig, renames, keep.title, skipFor(keepTextOrig));
      const next = addAliases(rewritten, otherNames);
      await v.write(keep.path, next);
      await d.indexFile(v, keep.path);
      const touched: string[] = [keep.path];
      const befores: [string, string][] = [[keep.path, keepTextOrig]];
      for (const m of index.allMeta()) {
        if (m.path === keep.path || !/\.md$/i.test(m.path)) continue;
        const text = await v.read(m.path).catch(() => null);
        if (text === null || !renames.some((r) => hasPhrase(text, r.from))) continue;
        const out = rewriteMentions(text, renames, keep.title, skipFor(text));
        if (out === text) continue;
        await v.write(m.path, out);
        await d.indexFile(v, m.path);
        await d.syncAfterWrite?.(m.path, text, out);
        touched.push(m.path);
        befores.push([m.path, text]);
      }
      d.changed(touched);
      d.filesChanged();
      await writeWhole(abs(MERGE_JOURNAL), `${JSON.stringify({ at: new Date().toISOString(), undone: false, keepTitle: keep.title, otherTitle: other.title, files: befores }, null, 2)}\n`);
      return { path: keep.path, words: `${other.title} is now another name for ${keep.title}.` };
    }
    // Both have cards.
    const otherText = await v.read(other.path);
    const keepRewritten = rewriteMentions(keepTextOrig, renames, keep.title, skipFor(keepTextOrig));
    const otherProps = readProps(otherText);
    const keepProps = readProps(keepRewritten);
    const differing: string[] = [];
    let merged = changeProps(addAliases(keepRewritten, otherNames), (doc) => {
      for (const [k, val] of Object.entries(otherProps)) {
        if (['type', 'aliases', 'alias'].includes(k.toLowerCase())) continue;
        if (k.toLowerCase() === 'tags') {
          const all = [...new Set([...(Array.isArray(keepProps.tags) ? keepProps.tags : keepProps.tags ? [keepProps.tags] : []), ...(Array.isArray(val) ? val : val ? [val] : [])].map(String))];
          doc.set('tags', all);
          continue;
        }
        if (keepProps[k] === undefined || keepProps[k] === null || keepProps[k] === '') doc.set(k, val);
        else if (JSON.stringify(keepProps[k]) !== JSON.stringify(val)) differing.push(`- ${k}: ${typeof val === 'string' ? val : JSON.stringify(val)}`);
      }
    });
    const body = otherText.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '').trim();
    merged = `${merged.replace(/\s+$/, '')}\n\n${mergedHeading(other.title, dayWords())}\n\n${differing.length ? `${differing.join('\n')}\n\n` : ''}${body}\n`;
    await v.write(keep.path, merged);
    await d.indexFile(v, keep.path);
    await d.syncAfterWrite?.(keep.path, keepTextOrig, merged);
    // Every link to the other card reaches the kept one, shown as it was written (body links keep their alias; property
    // links are data, rewritten plain), and every other name reads as the kept one (owners, people, attendees, tasks).
    const keepTitle = titleFromPath(keep.path);
    const touched: string[] = [keep.path];
    const befores: [string, string][] = [[keep.path, keepTextOrig]];
    for (const m of index.allMeta()) {
      if (m.path === other.path || m.path === keep.path || !/\.md$/i.test(m.path)) continue;
      const text = await v.read(m.path).catch(() => null);
      if (text === null) continue;
      const hasLink = m.links.some((l) => index.resolveAny(l.target, m.path) === other!.path) || (m.propLinks ?? []).some((l) => index.resolveAny(l.target, m.path) === other!.path);
      if (!hasLink && !renames.some((r) => hasPhrase(text, r.from))) continue;
      let out = text;
      if (hasLink) {
        out = relinkPropsInText(
          replaceMarkdownLinks(
            replaceWikilinks(out, (link, raw, embed) => (index.resolveAny(link.target, m.path) === other!.path ? `${embed ? '!' : ''}[[${keepTitle}${link.heading ? `#${link.heading}` : ''}|${link.alias ?? link.target.split('/').pop()}]]` : raw)),
            (target, fragment, raw, embed, label) => (index.resolveAny(target, m.path) === other!.path ? `${embed ? '!' : ''}[${label}](${encodeLinkPath(keep.path)}${fragment})` : raw),
          ),
          (target) => (index.resolveAny(target, m.path) === other!.path ? keepTitle : null),
        );
      }
      out = rewriteMentions(out, renames, keep.title, skipFor(text));
      if (out !== text) {
        await v.write(m.path, out);
        await d.indexFile(v, m.path);
        await d.syncAfterWrite?.(m.path, text, out);
        touched.push(m.path);
        befores.push([m.path, text]);
      }
    }
    const keptAt = `${MERGED_DIR}/${stampOf()} ${baseOf(other.path)}`;
    await fsp.mkdir(path.dirname(abs(keptAt)), { recursive: true });
    await fsp.rename(abs(other.path), abs(keptAt));
    index.delete(other.path);
    await d.refreshFiles(v);
    d.changed([...touched, other.path]);
    d.filesChanged();
    await writeWhole(abs(MERGE_JOURNAL), `${JSON.stringify({ at: new Date().toISOString(), undone: false, keepTitle: keep.title, otherTitle: other.title, otherPath: other.path, movedTo: keptAt, files: befores }, null, 2)}\n`);
    return { path: keep.path, words: `${other.title} merged into ${keep.title}: names, details and notes kept, ${plural(touched.length - 1, 'place')} brought over.` };
  });

  handle('people:merge-undo', async () => {
    await d.requireCreate();
    const v = d.vault();
    const j = JSON.parse((await readSmall(abs(MERGE_JOURNAL))) ?? 'null') as { undone?: boolean; keepTitle?: string; otherTitle?: string; created?: string; otherPath?: string; movedTo?: string; files?: [string, string][] } | null;
    if (!j || j.undone) throw new Error('There is no merge to undo.');
    const back: string[] = [];
    for (const [rel, before] of [...(j.files ?? [])].reverse()) {
      const current = await v.read(rel).catch(() => null);
      if (current === null) continue;
      await v.write(rel, before);
      await d.indexFile(v, rel);
      await d.syncAfterWrite?.(rel, current, before);
      back.push(rel);
    }
    // A card made by the merge goes away; a card moved aside comes back.
    if (j.created) {
      await fsp.unlink(abs(j.created)).catch(() => undefined);
      index.delete(j.created);
      back.push(j.created);
    }
    if (j.movedTo && j.otherPath) {
      await fsp.mkdir(path.dirname(abs(j.otherPath)), { recursive: true });
      await fsp.rename(abs(j.movedTo), abs(j.otherPath));
      await d.indexFile(v, j.otherPath);
      back.push(j.otherPath);
    }
    await d.refreshFiles(v);
    d.changed(back);
    d.filesChanged();
    await writeWhole(abs(MERGE_JOURNAL), `${JSON.stringify({ ...j, undone: new Date().toISOString() }, null, 2)}\n`);
    return { words: `${j.otherTitle ?? 'The other card'} is its own card again; ${j.keepTitle ?? 'the kept card'} reads as it did.` };
  });

  // ── The Inbox ─────────────────────────────────────────────────────────────────────────────────────────────────────

  async function inboxItems(): Promise<InboxItem[]> {
    const v = d.vault();
    const out: InboxItem[] = [];
    if (await v.exists(INBOX_NOTE)) out.push(...inboxLines(await v.read(INBOX_NOTE)));
    const { files } = await v.listAll();
    for (const f of files) {
      // An email's attachments sit under Inbox/Attachments (t243): beside their email, never items of their own.
      if (!f.rel.toLowerCase().startsWith(`${INBOX_FOLDER.toLowerCase()}/`) || /^inbox\/done\//i.test(f.rel) || /^inbox\/attachments\//i.test(f.rel)) continue;
      const note = f.kind === 'note';
      const content = note ? (index.content(f.rel) ?? '') : '';
      const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '').trim();
      // Its real title, never its file name (t243, 12 Nov 2026, critic 1 #6: the Inbox showed the raw slug
      // "the-long-email-from-the-bank-about-the-card-reader-failure" — the note's own heading was never read).
      const title = note ? folderNoteTitle(index.get(f.rel)?.title || titleFromPath(f.rel), body) : titleFromName(baseOf(f.rel));
      out.push({ id: f.rel, kind: note ? 'note' : 'file', path: f.rel, text: body.slice(0, 2000), words: note ? folderNoteWords(title, body) : title, task: false, embeds: note ? [] : [f.rel], links: [] });
    }
    return out;
  }

  async function filingContext() {
    const config = await areasConfig();
    const areas = config?.areas ?? [];
    const pl = places();
    const metas = index.allMeta();
    const projects = metas
      .filter((m) => isProjectProps(m.props))
      .map((m) => {
        const p = parseProject(index.content(m.path) ?? '', m.path);
        const folder = String(m.props?.folder ?? '').replace(/\\/g, '/').split('/').filter(Boolean).pop();
        // A line on each project for the model (Nov 2026 filing): the summary's first line, else nothing.
        const about = p.summary.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)[0]?.slice(0, 140) ?? '';
        return { path: m.path, name: m.label || p.name || m.title, ...(folder ? { folderName: folder } : {}), people: [p.owner, ...p.people.map((x) => x.name)].filter((x): x is string => !!x), tags: m.tags, status: p.status, modified: m.mtime, about, area: areaOf(m, areas, pl)?.id };
      });
    const model = d.records();
    const people = [...model.records.values()].filter((r) => (r.type === 'person' || r.type === 'org') && r.page).map((r) => ({ name: r.title, path: r.path, names: r.names ?? [], area: areaOf({ path: r.path, props: index.get(r.path)?.props }, areas, pl)?.id }));
    const known = new Set([...projects.map((p) => p.path), ...people.map((p) => p.path)]);
    // No words in it (a note the model can't place into): only when the text is there to tell; an
    // unreadable note is left for the person, never assumed empty.
    const noWords = (rel: string): boolean => {
      const text = index.content(rel);
      return text !== undefined && text !== null && isEmptyNote(text);
    };
    // Never a home, from every door (Nov 2026 filing): a note still named Untitled, one with no words,
    // or a day's own note (the daily folder was already left out; the other two fell through to the model).
    const notes = metas
      .filter((m) => !known.has(m.path) && !/^inbox(\/|\.md$)/i.test(m.path) && !/^private notes\//i.test(m.path) && !(pl.templatesFolder && m.path.toLowerCase().startsWith(`${pl.templatesFolder.toLowerCase()}/`)) && !(pl.dailyFolder && m.path.toLowerCase().startsWith(`${pl.dailyFolder.toLowerCase()}/`)) && !isUntitledNoteTitle(m.title) && !noWords(m.path))
      .map((m) => ({ title: m.title, path: m.path, area: areaOf(m, areas, pl)?.id, mtime: m.mtime, doc: isDocNote(m.path, m.props) }));
    return { config, areas, projects, people, notes, resolve: (t: string) => index.resolveAny(t, INBOX_NOTE) };
  }

  handle('inbox:list', async () => {
    const items = await inboxItems();
    const ctx = await filingContext();
    const suggestions: Record<string, InboxSuggestion[]> = {};
    for (const it of items) suggestions[it.id] = suggestFiling(it, { projects: ctx.projects, people: ctx.people, notes: ctx.notes, areas: ctx.areas.map((a) => ({ id: a.id, name: a.name })), resolve: ctx.resolve });
    // An item that reads as a bill (Finance switched on): "Add as a bill" comes first.
    if (d.moduleSuggestion)
      for (const it of items) {
        const bill = await d.moduleSuggestion(it).catch(() => null);
        // The bill's own note isn't offered again as a plain note to add the words to.
        if (bill) suggestions[it.id] = [{ target: { kind: 'module' as const, module: 'finance', type: 'bill', ...(bill.existing ? { path: bill.existing } : {}), name: bill.name }, why: `${bill.existing ? 'Updates the bill' : 'A new bill'}: $${bill.amount.toFixed(2)}${bill.due ? `, due ${dueWords(bill.due, isoOf(new Date()))}` : ''}` }, ...(suggestions[it.id] ?? []).filter((s) => !bill.existing || s.target.path !== bill.existing)].slice(0, 3);
      }
    // An item that reads as a receipt (a photo or PDF dropped in, Finance switched on): "File as a receipt" comes
    // first when it reads as no bill (a bill is a future payment, never a paid receipt). Already filed: not offered.
    if (d.receiptSuggestion)
      for (const it of items) {
        if ((suggestions[it.id] ?? []).some((s) => s.target.kind === 'module' && s.target.module === 'finance')) continue;
        const r = await d.receiptSuggestion(it).catch(() => null);
        if (r && !r.duplicate) suggestions[it.id] = [{ target: { kind: 'module' as const, module: 'finance', type: 'receipt', name: r.merchant }, why: `Receipt: ${r.merchant}, $${r.total.toFixed(2)} (${r.category})${r.bill ? `. Looks like the ${r.bill.name} bill` : ''}` }, ...(suggestions[it.id] ?? [])].slice(0, 3);
      }
    // An item that names one of a module's records (a car's fill-up, a trip's boarding pass, an appliance's manual): filing it
    // there comes first, in the module's own words, and the same record isn't offered again as a plain note.
    if (d.moduleRecordSuggestions)
      for (const it of items) {
        const mine = await d.moduleRecordSuggestions(it).catch(() => []);
        if (mine.length) suggestions[it.id] = [...mine, ...(suggestions[it.id] ?? []).filter((s) => !mine.some((x) => x.target.path === s.target.path))].slice(0, 3);
      }
    // What it is about, from this PC's meaning index (9 Nov 2026, t119 one-tap filing: a capture that names
    // nothing still lands near its subject — the hashed meaning kept beside the file index, no model call).
    // Fills the empty slots only, so links and names outrank it and a module keeps the lead. A guess needs
    // real evidence (t249): never a person with no link to it, never a past meeting or a filler note unless
    // linked, never a meeting sharing no word with the capture — similarity alone filed a bank task into an
    // awning meeting, a bank email to a stranger's card, and filler notes as alternatives.
    {
      let meanings: { search(query: string, opts?: { limit?: number }): { path: string; score: number }[] } | null = null;
      try {
        meanings = d.index.meanings?.() ?? null;
      } catch {
        meanings = null;
      }
      const now = new Date();
      const todayIso = isoOf(now);
      if (meanings)
        for (const it of items) {
          if ((suggestions[it.id] ?? []).length >= 3) continue;
          let hits: { path: string; score: number }[] = [];
          try {
            hits = meanings.search(it.words || it.text, { limit: 8 }) ?? [];
          } catch {
            continue;
          }
          const linked = new Set(it.links.map((l) => ctx.resolve(l)).filter((x): x is string => !!x));
          for (const h of hits) {
            const have = suggestions[it.id] ?? [];
            if (have.length >= 3) break;
            if (have.some((s) => s.target.path === h.path)) continue;
            const p = ctx.projects.find((x) => x.path === h.path);
            const person = !p ? ctx.people.find((x) => x.path === h.path) : undefined;
            const note = !p && !person ? ctx.notes.find((x) => x.path === h.path) : undefined;
            if (!p && !person && !note) continue;
            // A person needs a link (a said name already suggests through words, never through here).
            if (person && !linked.has(person.path)) continue;
            if (note && !linked.has(note.path)) {
              // A filler note or a past meeting needs a link; any other meeting needs a shared word.
              if (isFillerNoteTitle(note.title)) continue;
              const props = index.get(note.path)?.props ?? {};
              if (isMeetingNote(note.path, props)) {
                const day = meetingDay({ path: note.path, props }, now);
                if ((day && day < todayIso) || sharedTitleWords(it.words || it.text, note.title).length === 0) continue;
              }
            }
            const name = p ? p.name : person ? person.name : note!.title;
            have.push({
              target: p ? { kind: 'project', path: p.path, name } : person ? { kind: 'person', path: person.path, name } : { kind: 'note', path: note!.path, name },
              why: `About ${name}`,
            });
            suggestions[it.id] = have;
          }
        }
    }
    // Never into a private note or a finished project, however it was suggested (5 Nov 2026, one rule).
    const vault = { projects: ctx.projects.map((p) => ({ path: p.path, name: p.name, status: p.status, modified: p.modified })) };
    for (const it of items) suggestions[it.id] = (suggestions[it.id] ?? []).filter((s) => !isPrivateTarget({ path: s.target.path ?? '' }) && !isFinishedTarget(s.target, vault)).slice(0, 3);
    return { items, suggestions };
  });

  /** The vault as the filing model sees it: projects with a line on each, people, docs and areas
   *  (private, Untitled, empty and daily notes left out; long lists trimmed to docs first, then newest). */
  function fileVaultOf(ctx: Awaited<ReturnType<typeof filingContext>>): FileVault {
    return trimFileVault({
      projects: ctx.projects.map((p) => ({ path: p.path, name: p.name, status: p.status, modified: p.modified, ...(p.about ? { about: p.about } : {}) })),
      people: ctx.people.map((p) => ({ name: p.name, path: p.path })),
      notes: ctx.notes.map((n) => ({ title: n.title, path: n.path, ...(n.doc ? { doc: true as const } : {}), modified: n.mtime })),
      areas: ctx.areas.map((a) => ({ id: a.id, name: a.name })),
    });
  }

  /** What the filer has already seen (5 Nov 2026, update walk; Nov 2026 break: the same guard, one
   *  list now): only captures that arrive after the filer's first run file themselves; what was already
   *  waiting stays for the person, with model homes on their buttons but filed nowhere. The first run
   *  marks, never files. Kept beside the auto journals, where 10.1.2 never looks. */
  const AUTO_DIR = '.neuralvault/journal';
  const SEEN_FILE = `${AUTO_DIR}/inbox-auto-seen.json`;
  async function loadAutoSeen(): Promise<{ seen: Set<string>; firstRun: boolean }> {
    try {
      const parsed = JSON.parse(await fsp.readFile(abs(SEEN_FILE), 'utf8')) as { ids?: unknown };
      if (Array.isArray(parsed?.ids)) return { seen: new Set(parsed.ids.filter((x): x is string => typeof x === 'string')), firstRun: false };
    } catch { /* missing or unreadable: the first run */
    }
    return { seen: new Set<string>(), firstRun: true };
  }
  async function markAutoSeen(items: InboxItem[], seen: Set<string>): Promise<void> {
    const next = [...seen, ...items.map((i) => i.id).filter((id) => !seen.has(id))].slice(-1000);
    await fsp.mkdir(path.dirname(abs(SEEN_FILE)), { recursive: true }).catch(() => undefined);
    await fsp.writeFile(abs(SEEN_FILE), `${JSON.stringify({ ids: next })}\n`).catch(() => undefined);
  }

  /** The model's proposed homes for what's waiting, asked once for the whole batch (never per keystroke),
   *  on the helper route (d.askJson). Null with no model, or when the assistant may not read the Inbox
   *  (Nov 2026 break: every other model read honours the level; filing is no exception): the page works
   *  from simple matching instead. `order` leads the batch with what matters first (the filer leads with
   *  what it has not seen). `asked` names what was sent, so only proposed captures count as seen. `ms`
   *  says how long the ask took, so a slow batch shows itself. */
  async function proposeHomes(order?: (a: InboxItem, b: InboxItem) => number): Promise<{ items: InboxItem[]; proposals: Record<string, FileProposal[]>; model: boolean; asked: string[]; ms: number }> {
    const items = (await inboxItems()).filter((i) => i.kind === 'line');
    const empty: Record<string, FileProposal[]> = {};
    for (const i of items) empty[i.id] = [];
    if (!d.askJson) return { items, proposals: empty, model: false, asked: [], ms: 0 };
    if (d.assistantMay && !d.assistantMay(INBOX_NOTE)) return { items, proposals: empty, model: false, asked: [], ms: 0 };
    if (!items.length) {
      const { seen } = await loadAutoSeen();
      await markAutoSeen([], seen);
      return { items, proposals: empty, model: false, asked: [], ms: 0 };
    }
    const ctx = await filingContext();
    const vault = fileVaultOf(ctx);
    const batch = (order ? [...items].sort(order) : items).slice(0, 20);
    const t0 = Date.now();
    const r = await d.askJson(INBOX_FILE_SYSTEM, buildFileUser(batch, vault)).catch(() => null);
    const ms = Date.now() - t0;
    if (!r || r.error || !r.reply) return { items, proposals: empty, model: false, asked: [], ms };
    return { items, proposals: parseFileProposals(r.reply, items, vault), model: true, asked: batch.map((i) => i.id), ms };
  }

  /** Whether a line's exact words are still waiting in the Inbox note (Nov 2026 break: a capture
   *  edited while it files itself is left alone, never filed on stale words; by its words, not its
   *  id, because two captures with the same words change ids when one files). */
  async function lineStillThere(item: Pick<InboxItem, 'text'>): Promise<boolean> {
    try {
      const v = d.vault();
      if (!(await v.exists(INBOX_NOTE))) return false;
      return inboxLines(await v.read(INBOX_NOTE)).some((x) => x.text === item.text);
    } catch {
      return false;
    }
  }

  interface AutoJournalEntry { id: string; text: string; words: string; dest: string | null; before: string | null; created: string | null; step: string | null; project: string | null; name: string; reminder: string | null; madeText?: string | null; movedFrom?: string | null; movedTo?: string | null; linkLines?: string[] | null; alsoMoved?: { from: string; to: string }[] | null; docLine?: { project: string; line: string; more: string[] } | null; noteLink?: { note: string; line: string } | null }

  /** Sure captures filed straight there (lines only; notes and files stay for the person). One journal entry
   *  per capture, one Undo for the batch. Nothing deleted, nothing into private or finished. */
  inboxHandle('inbox:auto-file', async () => {
    await d.requireCreate();
    await pruneAutoJournals();
    const v = d.vault();
    const autoSeen = await loadAutoSeen();
    const { items, proposals, model, asked, ms } = await proposeHomes((a, b) => Number(autoSeen.seen.has(a.id)) - Number(autoSeen.seen.has(b.id)));
    if (!model) return { filed: [], proposals, model, words: '', undo: null as string | null, ms };
    const ctx = await filingContext();
    const { sure } = splitSureUnsure(items, proposals);
    const fresh = autoSeen.firstRun ? [] : sure.filter(({ id }) => !autoSeen.seen.has(id));
    const filed: { id: string; name: string }[] = [];
    const journal: AutoJournalEntry[] = [];
    const changed: string[] = [];
    for (const { id, target } of fresh.slice(0, 20)) {
      const item = items.find((x) => x.id === id);
      if (!item || item.kind !== 'line') continue;
      if (isPrivateTarget({ path: target.path ?? '' }) || isFinishedTarget(target, fileVaultOf(ctx))) continue;
      if (!(await lineStillThere(item))) continue;
      try {
        if (target.kind === 'project') {
          const p = ctx.projects.find((x) => x.path === target.path);
          if (!p || isFinished(p.status)) continue;
          // A plain line the model read as work files as a next step too (Nov 2026 filing: step true).
          if (item.task || target.step === true) {
            const what = itemStep(item);
            const before = await v.read(p.path);
            await d.editProject(p.path, { kind: 'add', list: 'next', item: { what, done: false } }, '');
            await removeLine(item);
            journal.push({ id, text: item.text, words: item.words, dest: p.path, before, created: null, step: what, project: p.path, name: p.name, reminder: null });
            changed.push(p.path);
            filed.push({ id, name: p.name });
          } else {
            const log = projectLogPath(p.path, p.name);
            const before = (await v.exists(log)) ? await v.read(log) : null;
            const text = before ?? newLogText(p.name);
            await v.write(log, appendUnder(text, itemLines(item), 'Log'));
            await d.indexFile(v, log);
            await removeLine(item);
            journal.push({ id, text: item.text, words: item.words, dest: log, before, created: before ? null : log, step: null, project: null, name: p.name, reminder: null });
            changed.push(log);
            filed.push({ id, name: p.name });
          }
        } else if (target.kind === 'person' || target.kind === 'note') {
          const dest = target.path!;
          if (isPrivatePath(dest)) continue;
          if (!(await v.exists(dest))) continue;
          const before = await v.read(dest);
          await v.write(dest, appendUnder(before, itemLines(item), 'Notes'));
          await d.indexFile(v, dest);
          await removeLine(item);
          journal.push({ id, text: item.text, words: item.words, dest, before, created: null, step: null, project: null, name: target.name, reminder: null });
          changed.push(dest);
          filed.push({ id, name: target.name });
        } else if (target.kind === 'area') {
          // A sure new note or doc files itself the way the page's File… files it (Nov 2026 filing):
          // the model's title names it (else the capture's first words), a doc through the Docs folder
          // in the new-doc shape, a free name always so nothing is overwritten.
          const docHome = target.type === 'doc';
          const area = ctx.areas.find((x) => x.id === target.area);
          if (!docHome && !area) continue;
          const areaType = docHome ? 'doc' : await safeAreaType(target.type ?? (item.task ? 'task' : 'note'));
          const title = cleanFilingTitle(target.title) || itemTitle(item);
          const folder = docHome ? DOCS_FOLDER : `${area!.folder}/${await typeFolder(areaType)}`;
          const rel = await freePlace(folder, `${title}.md`);
          const text = docHome ? newDocText({ name: title, summary: item.words, today: dayWords() }) : itemNoteText(item, areaType);
          await v.create(rel, text);
          await d.indexFile(v, rel);
          await removeLine(item);
          journal.push({ id, text: item.text, words: item.words, dest: rel, before: null, created: rel, step: null, project: null, name: title, reminder: null, madeText: text });
          changed.push(rel);
          filed.push({ id, name: title });
        } else if (target.kind === 'reminder') {
          // A sure reminder files straight to the one home (Nov 2026 review: the prompt's "reminder" came to
          // nothing); a moment that can't be told stays in the Inbox, and the rest still file.
          const r = reminderLineFor(item.words, target.when, new Date());
          if (!r) continue;
          const before = (await v.exists(REMINDER_HOME)) ? await v.read(REMINDER_HOME) : null;
          await v.write(REMINDER_HOME, appendReminderLine(before, r.line));
          await d.indexFile(v, REMINDER_HOME);
          await removeLine(item);
          journal.push({ id, text: item.text, words: item.words, dest: REMINDER_HOME, before, created: before ? null : REMINDER_HOME, step: null, project: null, name: 'Reminders', reminder: r.line });
          changed.push(REMINDER_HOME);
          filed.push({ id, name: 'Reminders' });
        }
      } catch {
        // One capture that won't file stays in the Inbox; the rest still file.
      }
    }
    let undo: string | null = null;
    if (journal.length) {
      undo = `inbox-auto-${Date.now().toString(36)}`;
      await writeWhole(abs(`${AUTO_DIR}/${undo}.json`), JSON.stringify({ at: new Date().toISOString(), journal }, null, 2));
    }
    if (changed.length) {
      d.changed([INBOX_NOTE, ...changed]);
      d.filesChanged();
    }
    const remaining = (await inboxItems()).filter((i) => i.kind === 'line');
    const unsure: Record<string, FileProposal[]> = {};
    for (const i of remaining) unsure[i.id] = proposals[i.id] ?? [];
    // The first run's everything waiting is old, so it all counts as seen; later runs count only what
    // was proposed, so the 21st new capture still files in its turn (Nov 2026 break).
    await markAutoSeen(autoSeen.firstRun ? items : items.filter((i) => asked.includes(i.id)), autoSeen.seen);
    return { filed, proposals: unsure, model, words: filed.length ? filedLineWords(filed) : '', undo, ms };
  });

  /** One Undo for what filed itself: the lines back in the Inbox, the destinations as they were —
   *  except what the person changed since, which stays and is named (Nov 2026 break: a made log was
   *  rewritten whole, wiping later words, and a changed destination came back doubled with no word). */
  inboxHandle('inbox:undo-auto', async (id: unknown) => {
    await d.requireCreate();
    if (typeof id !== 'string' || !/^inbox-auto-[a-z0-9]+$/.test(id)) throw new Error('That batch can’t be undone any more.');
    const v = d.vault();
    const raw = await readSmall(abs(`${AUTO_DIR}/${id}.json`));
    if (!raw) throw new Error('That batch can’t be undone any more.');
    let stored: { journal?: unknown; undone?: unknown };
    try {
      stored = JSON.parse(raw) as { journal?: unknown; undone?: unknown };
    } catch {
      throw new Error('That batch can’t be undone any more.');
    }
    if (stored.undone) throw new Error('That batch was already undone.');
    const journal = Array.isArray(stored.journal) ? (stored.journal as AutoJournalEntry[]) : [];
    if (!journal.length) throw new Error('That batch can’t be undone any more.');
    const changed: string[] = [];
    const kept: string[] = [];
    const stayed: string[] = [];
    let back = 0;
    for (const j of journal) {
      try {
        // A filed note or file back where it was (9 Nov 2026, t119 one-tap filing: one tap's Undo for
        // moves too). Its link lines come back out of the card or note they were added to (a project
        // or area move appended none: the folder listing is the link).
        if (j.movedTo && j.movedFrom) {
          try {
            await d.movePath(j.movedTo, j.movedFrom, true);
            changed.push(j.movedFrom, j.movedTo);
          } catch {
            kept.push(j.name);
          }
          // An arrival's extras come back too (t243): its attachments, its Documents line (with the sub-lines
          // added under it), the project link added to its note, and the next step the answer made of it.
          for (const m of Array.isArray(j.alsoMoved) ? j.alsoMoved : []) {
            try {
              if (typeof m?.from === 'string' && typeof m?.to === 'string') {
                await d.movePath(m.to, m.from, true);
                changed.push(m.from, m.to);
              }
            } catch {
              kept.push(j.name);
            }
          }
          if (j.docLine && typeof j.docLine.project === 'string' && typeof j.docLine.line === 'string') {
            try {
              const now = await v.read(j.docLine.project);
              const out = now.split(/\r?\n/);
              const cut = out.indexOf(j.docLine.line);
              if (cut >= 0) {
                out.splice(cut, 1);
                for (const sub of Array.isArray(j.docLine.more) ? j.docLine.more : []) {
                  const at = out.indexOf(sub, cut);
                  if (at === cut) out.splice(cut, 1);
                  else break;
                }
                await v.write(j.docLine.project, out.join(now.includes('\r\n') ? '\r\n' : '\n'));
                await d.indexFile(v, j.docLine.project);
              } else kept.push(j.name);
              changed.push(j.docLine.project);
            } catch {
              kept.push(j.name);
            }
          }
          if (j.noteLink && typeof j.noteLink.note === 'string' && typeof j.noteLink.line === 'string') {
            try {
              const now = await v.read(j.movedFrom);
              const out = now.split(/\r?\n/);
              const cut = out.indexOf(j.noteLink.line);
              if (cut >= 0) {
                out.splice(cut, 1);
                await v.write(j.movedFrom, out.join(now.includes('\r\n') ? '\r\n' : '\n'));
                await d.indexFile(v, j.movedFrom);
              } else kept.push(j.name);
              changed.push(j.movedFrom);
            } catch {
              kept.push(j.name);
            }
          }
          if (j.step && j.project) {
            try {
              const text = await v.read(j.project);
              const p = parseProject(text, j.project);
              const at = p.next.findIndex((n) => !n.done && n.what === j.step);
              if (at >= 0) await d.editProject(j.project, { kind: 'remove', list: 'next', index: at }, '');
              else kept.push(j.name);
              changed.push(j.project);
            } catch {
              kept.push(j.name);
            }
          }
          const linkLines = Array.isArray(j.linkLines) ? j.linkLines.filter((l): l is string => typeof l === 'string') : [];
          if (j.dest && linkLines.length) {
            try {
              const now = await v.read(j.dest);
              const out = now.split(/\r?\n/);
              let cut = -1;
              for (let i = out.length - linkLines.length; i >= 0; i--) {
                if (linkLines.every((l, k) => out[i + k] === l)) {
                  cut = i;
                  break;
                }
              }
              if (cut >= 0) {
                out.splice(cut, linkLines.length);
                await v.write(j.dest, out.join(now.includes('\r\n') ? '\r\n' : '\n'));
                await d.indexFile(v, j.dest);
              } else kept.push(j.name);
              changed.push(j.dest);
            } catch {
              kept.push(j.name);
            }
          }
          back++;
          continue;
        }
        if (j.reminder && j.dest) {
          // A filed reminder's own line comes out (only it: anything else since is kept).
          const now = await v.read(j.dest);
          const out = now.split(/\r?\n/);
          const cut = out.lastIndexOf(j.reminder);
          if (cut >= 0) {
            out.splice(cut, 1);
            await v.write(j.dest, out.join(now.includes('\r\n') ? '\r\n' : '\n'));
            await d.indexFile(v, j.dest);
          } else kept.push(j.name);
          changed.push(j.dest);
        } else if (j.step && j.project) {
          const text = await v.read(j.project);
          const p = parseProject(text, j.project);
          const at = p.next.findIndex((n) => !n.done && n.what === j.step);
          if (at >= 0) await d.editProject(j.project, { kind: 'remove', list: 'next', index: at }, '');
          else kept.push(j.name);
          changed.push(j.project);
        } else if (j.dest && (j.before !== null || j.created)) {
          // Only the filed lines come out — never the whole note, even one the filing made.
          const now = await v.read(j.dest);
          const lines = itemLines({ text: j.text });
          const out = now.split(/\r?\n/);
          let cut = -1;
          for (let i = out.length - lines.length; i >= 0; i--) {
            if (lines.every((l, k) => out[i + k] === l)) {
              cut = i;
              break;
            }
          }
          if (cut >= 0) {
            out.splice(cut, lines.length);
            await v.write(j.dest, out.join(now.includes('\r\n') ? '\r\n' : '\n'));
            await d.indexFile(v, j.dest);
          } else if (j.before === null && j.madeText !== undefined && j.madeText !== null) {
            // A note or doc the filing made stays a note: its words came back to the Inbox, and it is
            // named so the person knows it is there (nothing filed is ever deleted).
            stayed.push(j.name);
          } else kept.push(j.name);
          changed.push(j.dest);
        }
        const inbox = (await v.exists(INBOX_NOTE)) ? await v.read(INBOX_NOTE) : '';
        await v.write(INBOX_NOTE, appendUnder(inbox, itemLines({ text: j.text }), 'Captured'));
        await d.indexFile(v, INBOX_NOTE);
        back++;
      } catch {
        // One that won't come back stays where it is; the rest still come back.
      }
    }
    await writeWhole(abs(`${AUTO_DIR}/${id}.json`), JSON.stringify({ at: new Date().toISOString(), journal, undone: true }, null, 2));
    d.changed([INBOX_NOTE, ...changed]);
    d.filesChanged();
    const names = [...new Set(kept)];
    const keptWords = !names.length ? '' : names.length === 1 ? ` ${names[0]} kept what changed since.` : names.length === 2 ? ` ${names[0]} and ${names[1]} kept what changed since.` : ` ${names[0]}, ${names[1]} and ${names.length - 2} others kept what changed since.`;
    const alone = [...new Set(stayed)];
    const stayedWords = !alone.length ? '' : alone.length === 1 ? ` ${alone[0]} stays as its own note.` : alone.length === 2 ? ` ${alone[0]} and ${alone[1]} stay as their own notes.` : ` ${alone[0]}, ${alone[1]} and ${alone.length - 2} others stay as their own notes.`;
    return { words: back ? `Put ${back === 1 ? 'it' : `${back} captures`} back in the Inbox.${keptWords}${stayedWords}` : `Nothing could be put back.${keptWords}${stayedWords}` };
  });

  /** Old self-filing journals pruned (Nov 2026 break: one file per batch, kept for good). Older than
   *  30 days is gone, like Recently deleted; undoing it then says it can't be undone any more. The
   *  filer's seen list is not a journal and stays, however old (its name matches the journal shape). */
  async function pruneAutoJournals(): Promise<void> {
    let list: string[] = [];
    try {
      list = await fsp.readdir(abs(AUTO_DIR));
    } catch {
      return;
    }
    const now = Date.now();
    for (const f of list.filter((x) => `${AUTO_DIR}/${x}` !== SEEN_FILE && /^inbox-auto-[a-z0-9]+\.json$/.test(x))) {
      try {
        const st = await fsp.stat(abs(`${AUTO_DIR}/${f}`));
        if (now - st.mtimeMs > 30 * 86400000) await fsp.unlink(abs(`${AUTO_DIR}/${f}`));
      } catch {
        // Unreadable: kept.
      }
    }
  }

  async function typeFolder(type: string | undefined): Promise<string> {
    if (!type || type === 'note') return 'Notes';
    const types = resolveTypes(readTypes(await readTypesFile(root())).config, { topFolders: [], templatesFolder: d.prefs().templatesFolder, docsFolder: DOCS_FOLDER });
    const t = types.find((x) => x.id === type);
    return t?.folder || 'Notes';
  }

  /** A note type that filing into an area may use (Nov 2026 break: the type rode straight into the
   *  new note's front matter, so `note` plus a line break smuggled properties in). A real type, a
   *  task kept as a task, else a plain note. */
  async function safeAreaType(type: unknown): Promise<string> {
    if (type === 'task' || type === 'note' || !type) return (type as string) || 'note';
    if (typeof type !== 'string') return 'note';
    try {
      const types = resolveTypes(readTypes(await readTypesFile(root())).config, { topFolders: [], templatesFolder: d.prefs().templatesFolder, docsFolder: DOCS_FOLDER });
      return types.some((x) => x.id === type) ? type : 'note';
    } catch {
      return 'note';
    }
  }

  async function removeLine(item: InboxItem, also?: { heading: string; lines: string[] }): Promise<void> {
    const v = d.vault();
    const text = await v.read(INBOX_NOTE);
    let out = withoutItem(text, item);
    if (out === null) throw new Error('That item isn’t in the Inbox any more.');
    if (also) out = appendUnder(out, also.lines, also.heading);
    await v.write(INBOX_NOTE, out);
    await d.indexFile(v, INBOX_NOTE);
  }

  async function freePlace(folder: string, name: string): Promise<string> {
    const v = d.vault();
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 1; n < 500; n++) {
      const rel = `${folder}/${stem}${n > 1 ? ` ${n}` : ''}${ext}`;
      if (!(await v.any(rel))) return rel;
    }
    throw new Error('There is no free name for it there.');
  }

  /** One Undo for one tap's filing (9 Nov 2026, t119 one-tap filing): the same journal the self-filing wrote,
   *  one entry, undone by the same inbox:undo-auto — one undo path for every filing. The id carries two random
   *  characters, so two quick taps never share a journal. Old journals are pruned here now the page files by hand. */
  async function journalHand(entry: AutoJournalEntry): Promise<string> {
    await pruneAutoJournals();
    const undo = `inbox-auto-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
    await writeWhole(abs(`${AUTO_DIR}/${undo}.json`), JSON.stringify({ at: new Date().toISOString(), journal: [entry] }, null, 2));
    return undo;
  }

  inboxHandle('inbox:file', async (id: unknown, target: unknown) => {
    await d.requireCreate();
    const v = d.vault();
    const item = (await inboxItems()).find((x) => x.id === id);
    if (!item) throw new Error('That item isn’t in the Inbox any more.');
    if (item.kind === 'line' && !(await lineStillThere(item))) throw new Error('That item changed just now; it’s still in the Inbox.');
    const t = (target && typeof target === 'object' ? target : {}) as FilingTarget;
    const ctx = await filingContext();
    // Never into a private note or a finished project (5 Nov 2026, one rule).
    if (t.path && isPrivatePath(t.path)) throw new Error('Private notes stay private: nothing files into them from the Inbox.');
    if (t.kind === 'project' && isFinishedTarget(t, { projects: ctx.projects.map((p) => ({ path: p.path, name: p.name, status: p.status, modified: p.modified })) })) throw new Error('That project is finished, so nothing files into it.');
    const changed: string[] = [];
    let words = '';
    let entry: AutoJournalEntry | null = null;
    if (t.kind === 'project') {
      const p = ctx.projects.find((x) => x.path === t.path);
      if (!p) throw new Error('That project isn’t there any more.');
      if (isFinished(p.status)) throw new Error('That project is finished, so nothing files into it.');
      if (item.kind === 'line') {
        // A plain line files as a next step when asked (Nov 2026 filing: the model's step true, the
        // page's "Make it a task" and "Move to a project" file the same way).
        if (item.task || t.step === true) {
          const what = itemStep(item);
          const before = await v.read(p.path);
          await d.editProject(p.path, { kind: 'add', list: 'next', item: { what, done: false } }, '');
          entry = { id: item.id, text: item.text, words: item.words, dest: p.path, before, created: null, step: what, project: p.path, name: p.name, reminder: null };
          words = `Added “${what}” to ${p.name}’s next steps.`;
        } else {
          const log = projectLogPath(p.path, p.name);
          const before = (await v.exists(log)) ? await v.read(log) : null;
          const text = before ?? newLogText(p.name);
          await v.write(log, appendUnder(text, itemLines(item), 'Log'));
          await d.indexFile(v, log);
          changed.push(log);
          entry = { id: item.id, text: item.text, words: item.words, dest: log, before, created: before ? null : log, step: null, project: null, name: p.name, reminder: null };
          words = `Filed in ${p.name}’s log.`;
        }
        await removeLine(item);
      } else {
        // An email or PDF files contained (t243): linked both ways, attachments along, repeats versioned.
        const arrival = (item.kind === 'note' && isEmailProps(index.get(item.path)?.props)) || (item.kind === 'file' && /\.pdf$/i.test(item.path));
        if (arrival) {
          const filed = await fileArrivalToProject(item, p);
          changed.push(...filed.changed);
          entry = { id: item.id, text: item.text, words: item.words, dest: null, before: null, created: null, step: null, project: null, name: p.name, reminder: null, movedFrom: item.path, movedTo: filed.movedTo, ...(filed.alsoMoved.length ? { alsoMoved: filed.alsoMoved } : {}), ...(filed.docLine ? { docLine: filed.docLine } : {}), ...(filed.noteLink ? { noteLink: filed.noteLink } : {}) };
          words = filed.words;
        } else {
          const dest = await freePlace(`${folderOf(p.path)}/${item.kind === 'note' ? 'Notes' : 'Files'}`, baseOf(item.path));
          await d.movePath(item.path, dest, true);
          changed.push(dest);
          entry = { id: item.id, text: item.text, words: item.words, dest: null, before: null, created: null, step: null, project: null, name: p.name, reminder: null, movedFrom: item.path, movedTo: dest };
          words = `Moved ${baseOf(item.path)} into ${p.name}.`;
        }
      }
    } else if (t.kind === 'person' || t.kind === 'note') {
      const person = t.kind === 'person' ? ctx.people.find((x) => x.path === t.path) : ctx.notes.find((x) => x.path === t.path) && { name: titleFromPath(t.path!), path: t.path!, area: ctx.notes.find((x) => x.path === t.path)!.area };
      if (!person) throw new Error(t.kind === 'person' ? 'That card isn’t there any more.' : 'That note isn’t there any more.');
      let lines = itemLines(item);
      let movedTo: string | null = null;
      if (item.kind !== 'line') {
        const area = ctx.areas.find((a) => a.id === person.area);
        const dest = await freePlace(area ? homeIn(area, item.kind === 'note' ? 'notes' : kindOf({ path: item.path })) : folderOf(person.path), baseOf(item.path));
        await d.movePath(item.path, dest, true);
        movedTo = dest;
        lines = [`- ${item.kind === 'note' ? `[[${titleFromPath(dest)}]]` : `![[${baseOf(dest)}]]`}`];
        changed.push(dest);
      }
      const text = await v.read(person.path);
      await v.write(person.path, appendUnder(text, lines, 'Notes'));
      await d.indexFile(v, person.path);
      changed.push(person.path);
      entry = { id: item.id, text: item.text, words: item.words, dest: person.path, before: text, created: null, step: null, project: null, name: person.name, reminder: null, ...(movedTo ? { movedFrom: item.path, movedTo, linkLines: lines } : {}) };
      if (item.kind === 'line') await removeLine(item);
      words = t.kind === 'person' ? `Added to ${person.name}’s card.` : `Added to ${person.name}.`;
    } else if (t.kind === 'reminder') {
      // The prompt's "reminder" made real (Nov 2026 review): the capture's words at the model's moment, in the
      // one home for reminders. A moment that can't be told stays in the Inbox, in plain words, never filed blind.
      if (item.kind !== 'line') throw new Error('Only a capture line can become a reminder.');
      const r = reminderLineFor(item.words, t.when, new Date());
      if (!r) throw new Error('Couldn’t tell when that is for. Add the day (and a time, if you want one) to the line, then file it again.');
      const before = (await v.exists(REMINDER_HOME)) ? await v.read(REMINDER_HOME) : null;
      await v.write(REMINDER_HOME, appendReminderLine(before, r.line));
      await d.indexFile(v, REMINDER_HOME);
      changed.push(REMINDER_HOME);
      entry = { id: item.id, text: item.text, words: item.words, dest: REMINDER_HOME, before, created: before ? null : REMINDER_HOME, step: null, project: null, name: 'Reminders', reminder: r.line };
      await removeLine(item);
      words = `Set a reminder for ${r.moment}.${r.timeGiven ? '' : ' No time was said, so 9:00 am.'}`;
    } else if (t.kind === 'area') {
      const areaType = await safeAreaType(t.type);
      // A new doc lives in the Docs folder, not an area (Nov 2026 filing: the model's new-doc).
      const docHome = areaType === 'doc';
      const area = ctx.areas.find((a) => a.id === t.area);
      if (!docHome && !area) throw new Error('That area isn’t there any more.');
      if (item.kind === 'line') {
        // The model's title names it when there is one, else the capture's first words; a free name
        // always, so the same title twice never overwrites.
        const title = cleanFilingTitle(t.title) || itemTitle(item);
        const folder = docHome ? DOCS_FOLDER : `${area!.folder}/${await typeFolder(areaType)}`;
        const rel = await freePlace(folder, `${title}.md`);
        const made = docHome ? newDocText({ name: title, summary: item.words, today: dayWords() }) : itemNoteText(item, areaType);
        await v.create(rel, made);
        await d.indexFile(v, rel);
        changed.push(rel);
        entry = { id: item.id, text: item.text, words: item.words, dest: rel, before: null, created: rel, step: null, project: null, name: title, reminder: null, madeText: made };
        await removeLine(item);
        words = docHome ? `Made “${titleFromPath(rel)}” in Docs.` : `Made “${titleFromPath(rel)}” in ${area!.name}${areaType === 'task' ? ' (kept as a task)' : ''}.`;
      } else {
        const sub = item.kind === 'note' ? await typeFolder(areaType) : kindOf({ path: item.path }) === 'assets' ? 'Assets' : 'Files';
        const dest = await freePlace(docHome ? DOCS_FOLDER : `${area!.folder}/${sub}`, baseOf(item.path));
        await d.movePath(item.path, dest, true);
        changed.push(dest);
        entry = { id: item.id, text: item.text, words: item.words, dest: null, before: null, created: null, step: null, project: null, name: docHome ? 'Docs' : area!.name, reminder: null, movedFrom: item.path, movedTo: dest };
        words = docHome ? `Moved ${baseOf(item.path)} into Docs.` : `Moved ${baseOf(item.path)} into ${area!.name}.`;
      }
    } else if (t.kind === 'module' && t.module && t.module !== 'finance' && d.fileToModuleRecord) {
      const r = await d.fileToModuleRecord(item, t);
      if (!r) throw new Error('That module is switched off (Settings › Packs).');
      changed.push(...r.paths);
      if (item.kind === 'line') await removeLine(item);
      else if (r.keepWith) {
        const dest = await freePlace(filesFolderFor(r.keepWith), baseOf(item.path));
        await d.movePath(item.path, dest, true);
        changed.push(dest);
      }
      words = r.words;
    } else if (t.kind === 'module' && t.module === 'finance' && t.type === 'receipt' && d.fileReceipt) {
      const r = await d.fileReceipt(item);
      changed.push(...r.paths);
      if (item.kind === 'line') await removeLine(item);
      words = r.words;
      d.changed([INBOX_NOTE, ...changed]);
      d.filesChanged();
      return { words, paths: changed, undo: r.undo };
    } else if (t.kind === 'module' && d.fileToModule) {
      const r = await d.fileToModule(item);
      changed.push(...r.paths);
      if (item.kind === 'line') await removeLine(item);
      words = r.words;
    } else throw new Error('Choose where it goes.');
    d.changed([INBOX_NOTE, ...changed]);
    d.filesChanged();
    // One tap's Undo (a journal that won't write still leaves the filing done, as before, only un-undoable).
    if (entry) {
      try {
        return { words, paths: changed, undo: await journalHand(entry) };
      } catch {
        return { words, paths: changed };
      }
    }
    return { words, paths: changed };
  });

  inboxHandle('inbox:done', async (id: unknown) => {
    await d.requireCreate();
    const item = (await inboxItems()).find((x) => x.id === id);
    if (!item) throw new Error('That item isn’t in the Inbox any more.');
    if (item.kind === 'line') await removeLine(item, { heading: 'Done', lines: itemLines(item) });
    else {
      // Read before the move (the move reindexes the old path away).
      const doneEmail = item.kind === 'note' && isEmailProps(index.get(item.path)?.props);
      const doneDest = await freePlace(`${INBOX_FOLDER}/Done`, baseOf(item.path));
      await d.movePath(item.path, doneDest, true);
      // A done email keeps its attachments with it (t243), not orphaned in the Inbox.
      if (doneEmail) {
        const fromDir = emailAttachmentsFor(item.path);
        const toDir = emailAttachmentsFor(doneDest);
        if (fromDir && toDir) {
          for (const f of (await d.vault().listAll()).files) {
            if (f.rel !== fromDir && !f.rel.startsWith(`${fromDir}/`)) continue;
            await d.movePath(f.rel, await freePlace(toDir, baseOf(f.rel)), true);
          }
        }
      }
    }
    d.changed([INBOX_NOTE]);
    d.filesChanged();
    return { words: 'Marked done; it’s kept under Done in the Inbox.' };
  });

  // A capture deleted in one step (8.7 wave 2a): a line goes under Deleted in the Inbox note (kept, recoverable);
  // a note or file in the Inbox folder goes to Recently deleted from the page (files.trash, with Undo there).
  inboxHandle('inbox:delete', async (id: unknown) => {
    await d.requireCreate();
    const item = (await inboxItems()).find((x) => x.id === id);
    if (!item) throw new Error('That item isn’t in the Inbox any more.');
    if (item.kind !== 'line') throw new Error('That one goes to Recently deleted instead.');
    await removeLine(item, { heading: 'Deleted', lines: itemLines(item) });
    d.changed([INBOX_NOTE]);
    d.filesChanged();
    return { words: 'Deleted; it’s kept under Deleted in the Inbox note.' };
  });

  // ── The front door: email and PDF in ──────────────────────────────────────────────────────────────────────────────
  // (t243, 12 Nov 2026). A saved email (.eml, .msg), one mailed in from Gmail or Outlook, pasted email text, or a PDF
  // lands in the Inbox with its real subject or title. An email keeps its fields, its sender matched to a person by
  // address (or a card made for a stranger, organisation from the domain), its attachments beside it. Answering the
  // one question ("Which project, and what is the next step?") files it under the project — note or file moved into
  // the project's folder, linked both ways with typed links — and makes the next step a Task. A repeat PDF links what
  // it replaces, so it becomes the next version, never a second document. Nothing is written outside the project it is
  // filed under (the sender's card is made when the email lands, never later).
  /** An email's attachments sit under their email's stem, beside it, never items of their own (skipped above):
   *  the shared rule (emailAttachmentsFor), so the front door, Done, filing and the Bin can never disagree. */

  /** Person and organisation cards with their addresses, for matching a sender. */
  function peopleWithAddresses(): { title: string; path: string; email?: string }[] {
    const out: { title: string; path: string; email?: string }[] = [];
    for (const r of d.records().records.values()) {
      if ((r.type !== 'person' && r.type !== 'org') || !r.page || !r.path) continue;
      const email = (r.facts ?? []).find((f) => f.key === 'email')?.value;
      out.push({ title: r.title, path: r.path, ...(email ? { email } : {}) });
    }
    return out;
  }

  /** The sender's card: matched by address, or made for a stranger (null when there is no address to match). */
  async function senderCard(from: string): Promise<{ name: string; path: string; made: boolean } | null> {
    const address = senderAddress(from);
    if (!address) return null;
    const hit = matchPersonByAddress(peopleWithAddresses(), from);
    if (hit) return { name: hit.title, path: hit.path, made: false };
    const name = strangerName(from);
    // A card of that name already there is linked instead (never "June Park 2" for the same person).
    const same = peopleWithAddresses().find((p) => p.title === name);
    if (same) return { name: same.title, path: same.path, made: false };
    const v = d.vault();
    const where = await personFolder(undefined);
    const rel = await freeNote(where.folder, name);
    const org = strangerOrg(from);
    await v.create(rel, cardText({ name, type: 'person', ...(org ? { org } : {}), email: address }));
    await d.indexFile(v, rel);
    return { name, path: rel, made: true };
  }

  /** Where an arrival probably goes, for the one question: the vault's own structure (links, names), the sender
   *  and the attachment names with it — projects first, since the question asks which project. */
  async function arrivalSuggestions(item: InboxItem, senderPath: string | null, extraWords: string, body = ''): Promise<InboxSuggestion[]> {
    const ctx = await filingContext();
    // The body is evidence that a word is a name ("Your Harbourline shop"), never more words to match: a long
    // newsletter must not file on two stray words in its body (12 Nov 2026).
    const words = `${item.words}\n${extraWords}`.trim();
    const forSuggest: InboxItem & { nameWords: string } = { ...item, words, nameWords: `${words}\n${body.slice(0, 4000)}`, links: [...item.links, ...(senderPath ? [senderPath] : [])] };
    const all = suggestFiling(forSuggest, { projects: ctx.projects, people: ctx.people, notes: ctx.notes, areas: ctx.areas.map((a) => ({ id: a.id, name: a.name })), resolve: ctx.resolve })
      .filter((s) => !isPrivateTarget({ path: s.target.path ?? '' }) && !isFinishedTarget(s.target, { projects: ctx.projects.map((p) => ({ path: p.path, name: p.name, status: p.status, modified: p.modified })) }));
    const projects = all.filter((s) => s.target.kind === 'project');
    return [...projects, ...all.filter((s) => s.target.kind !== 'project')].slice(0, 3);
  }

  async function landEmail(email: EmailFields, files: { name: string; data: Uint8Array }[]): Promise<{ id: string; path: string; title: string; person: { name: string; path: string } | null; madeCard: string | null; suggestions: InboxSuggestion[] }> {
    await d.requireCreate();
    // The same email dropped twice lands once (t244): its message id is already kept, however it arrived,
    // so the kept note answers instead of a second one (a stranger's second mail still links their card).
    if (email.id) {
      const kept = findEmailById(index.allMeta(), email.id);
      if (kept) {
        const sender = await senderCard(email.from);
        const person = sender ? { name: sender.name, path: sender.path } : null;
        const found = (await inboxItems()).find((x) => x.id === kept);
        const item: InboxItem = found ?? { id: kept, kind: 'note', path: kept, text: '', words: `${email.subject}\n${email.words}`.slice(0, 2000), task: false, embeds: [], links: [] };
        return { id: kept, path: kept, title: email.subject.trim() || emailFileStem(email.subject, email.from), person, madeCard: null, suggestions: await arrivalSuggestions(item, person?.path ?? null, files.map((f) => f.name).join('\n'), email.words) };
      }
    }
    const v = d.vault();
    const sender = await senderCard(email.from);
    const person = sender ? { name: sender.name, path: sender.path } : null;
    const madeCard = sender?.made ? sender.path : null;
    const stem = emailFileStem(email.subject, email.from);
    const rel = await freePlace(INBOX_FOLDER, `${stem}.md`);
    await v.create(rel, emailNoteText(email, { ...(person ? { sender: person.name } : {}) }));
    const kept: string[] = [];
    // The landed note's own stem (t244: a free-named second landing kept its attachments under the first note's
    // stem, so the two notes shared one folder and the Bin could not tell them apart).
    const attDir = emailAttachmentsFor(rel) ?? `${INBOX_FOLDER}/Attachments/${stem}`;
    for (const [i, f] of files.slice(0, 50).entries()) {
      const dest = await freePlace(attDir, attachmentName(f.name, i));
      await v.writeBinary(dest, f.data);
      kept.push(dest);
    }
    await d.indexFile(v, rel);
    await d.refreshFiles(v);
    d.changed([rel, ...(madeCard ? [madeCard] : []), ...kept]);
    d.filesChanged();
    const item = (await inboxItems()).find((x) => x.id === rel);
    if (!item) throw new Error('That email didn’t land. Try again.');
    const suggestions = await arrivalSuggestions(item, person?.path ?? null, files.map((f) => f.name).join('\n'), email.words);
    return { id: rel, path: rel, title: email.subject.trim() || stem, person, madeCard, suggestions };
  }

  const bytesOf = (bytes: unknown): Uint8Array | null => {
    if (bytes instanceof Uint8Array) return bytes;
    if (Array.isArray(bytes) && bytes.every((b) => typeof b === 'number')) return Uint8Array.from(bytes);
    return null;
  };

  inboxHandle('intake:email', async (name: unknown, bytes: unknown) => {
    const data = bytesOf(bytes);
    if (typeof name !== 'string' || !data) throw new Error('That email couldn’t be read.');
    const parsed: EmailDoc | null = readEmailFile(name, data);
    if (!parsed) throw new Error('That file isn’t an email Ironleaf can read.');
    return landEmail(fieldsOf(parsed), parsed.files.map((f) => ({ name: f.name, data: f.data })));
  });

  inboxHandle('intake:paste', async (text: unknown) => {
    const words = String(text ?? '').trim();
    if (!words) throw new Error('Paste the email’s text first.');
    const parsed = readEmailFile('pasted.eml', new TextEncoder().encode(words));
    if (parsed) return landEmail(fieldsOf(parsed), parsed.files.map((f) => ({ name: f.name, data: f.data })));
    // Pasted words that aren’t shaped like an email: kept as an email all the same, subject from its first line.
    const first = words.split('\n')[0].slice(0, 80);
    return landEmail({ from: '', to: '', cc: '', date: '', id: '', subject: first, words, files: [] }, []);
  });

  async function landPdf(base: string, data: Uint8Array): Promise<{ id: string; path: string; title: string; person: null; madeCard: null; suggestions: InboxSuggestion[] }> {
    const v = d.vault();
    const rel = await freePlace(INBOX_FOLDER, base);
    await v.writeBinary(rel, data);
    await d.refreshFiles(v);
    d.changed([rel]);
    d.filesChanged();
    const item = (await inboxItems()).find((x) => x.id === rel);
    if (!item) throw new Error('That PDF didn’t land. Try again.');
    const guessed = await arrivalSuggestions(item, null, '');
    // A newer copy of a document already filed (12 Nov 2026: "Harbourline awnings quote v2" came back
    // with no project): the project holding its earlier copy comes first, the strongest clue the vault has.
    const earlier = await projectHoldingCopy(rel);
    const suggestions = earlier ? [{ target: { kind: 'project' as const, path: earlier.path, name: earlier.name }, why: `An earlier copy is filed in ${earlier.name}` }, ...guessed.filter((s) => s.target.path !== earlier.path)].slice(0, 3) : guessed;
    return { id: rel, path: rel, title: titleFromName(base), person: null, madeCard: null, suggestions };
  }

  /** The open project whose folder already holds an earlier copy of this file (the same document by name). */
  async function projectHoldingCopy(rel: string): Promise<{ path: string; name: string } | null> {
    const ctx = await filingContext();
    const copies = (await d.vault().listAll()).files.filter((f) => f.rel !== rel && !f.rel.startsWith(`${INBOX_FOLDER}/`) && sameDocument(baseOf(rel), baseOf(f.rel)));
    for (const p of ctx.projects) {
      if (isFinishedTarget({ kind: 'project', path: p.path }, { projects: ctx.projects.map((x) => ({ path: x.path, name: x.name, status: x.status, modified: x.modified })) })) continue;
      const folder = p.path.split('/').slice(0, -1).join('/');
      if (folder && copies.some((f) => f.rel.startsWith(`${folder}/`))) return { path: p.path, name: p.name };
    }
    return null;
  }

  inboxHandle('intake:pdf', async (name: unknown, bytes: unknown) => {
    await d.requireCreate();
    const data = bytesOf(bytes);
    const base = typeof name === 'string' ? baseOf(name).trim() : '';
    if (!data || !base) throw new Error('That file couldn’t be read.');
    if (String.fromCharCode(...data.subarray(0, 5)) !== '%PDF-') throw new Error('That file isn’t a PDF.');
    return landPdf(base, data);
  });

  /** A PDF kept from a file on this PC (chosen from a project's linked folder): read, checked, landed. */
  inboxHandle('intake:pdf-from', async (absPath: unknown) => {
    await d.requireCreate();
    const p = typeof absPath === 'string' ? absPath.trim() : '';
    if (!p || !path.isAbsolute(p)) throw new Error('Choose a PDF from a project’s folder.');
    let stat: { isFile(): boolean; size: number };
    try {
      stat = await fsp.stat(p);
    } catch {
      throw new Error('That file isn’t there any more.');
    }
    if (!stat.isFile() || !/\.pdf$/i.test(p)) throw new Error('That file isn’t a PDF.');
    if (stat.size > 50 * 1024 * 1024) throw new Error('That PDF is too big to keep (over 50 MB).');
    const data = new Uint8Array(await fsp.readFile(p));
    if (String.fromCharCode(...data.subarray(0, 5)) !== '%PDF-') throw new Error('That file isn’t a PDF.');
    return landPdf(p.replace(/\\/g, '/').split('/').pop() ?? 'Kept.pdf', data);
  });

  /** The lines one edit added to a file: the first is the entry's line, the rest its sub-lines (for Undo). */
  function addedLines(before: string, after: string): string[] {
    const missing = new Map<string, number>();
    for (const l of before.split(/\r?\n/)) missing.set(l, (missing.get(l) ?? 0) + 1);
    const added: string[] = [];
    for (const l of after.split(/\r?\n/)) {
      const n = missing.get(l) ?? 0;
      if (n > 0) missing.set(l, n - 1);
      else added.push(l);
    }
    return added;
  }

  /** An arrival filed under its project: moved into the project's folder, linked both ways with typed links (the
   *  note carries the project link, the project lists it in Documents), an email's attachments riding along, a
   *  repeat PDF linked as the next version of what it replaces. */
  async function fileArrivalToProject(item: InboxItem, p: { path: string; name: string }): Promise<{ changed: string[]; words: string; movedTo: string; alsoMoved: { from: string; to: string }[]; docLine: { project: string; line: string; more: string[] } | null; noteLink: { note: string; line: string } | null }> {
    const v = d.vault();
    const changed: string[] = [];
    const folder = folderOf(p.path);
    const isEmail = item.kind === 'note' && isEmailProps(index.get(item.path)?.props);
    const dest = await freePlace(`${folder}/${item.kind === 'note' ? 'Notes' : 'Files'}`, baseOf(item.path));
    await d.movePath(item.path, dest, true);
    changed.push(dest);
    const alsoMoved: { from: string; to: string }[] = [];
    let noteLink: { note: string; line: string } | null = null;
    if (isEmail) {
      const fromDir = emailAttachmentsFor(item.path);
      // The filed note's own stem (t244: a free-named copy filed its attachments under the old stem, so the
      // folder no longer matched its note and the Bin could not find it).
      const toDir = emailAttachmentsFor(dest) ?? `${folder}/Files/${baseOf(item.path).replace(/\.md$/i, '')}`;
      if (fromDir) {
        for (const f of (await v.listAll()).files) {
          if (f.rel !== fromDir && !f.rel.startsWith(`${fromDir}/`)) continue;
          const to = await freePlace(toDir, baseOf(f.rel));
          await d.movePath(f.rel, to, true);
          alsoMoved.push({ from: f.rel, to });
          changed.push(to);
        }
      }
      // The project's typed link on the note (written plainly, so Undo knows the exact line).
      const link = `project: "[[${p.name.replace(/"/g, '')}]]"`;
      const text = await v.read(dest);
      const lines = text.split(/\r?\n/);
      const end = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l));
      const kept = (end > 0 ? lines : [...lines]).filter((l, n) => !(end > 0 && n > 0 && n < end && /^\s*project\s*:/.test(l)));
      const at = end > 0 ? kept.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l)) : -1;
      const out = at > 0 ? [...kept.slice(0, at), link, ...kept.slice(at)] : ['---', link, '---', ...kept];
      await v.write(dest, out.join(text.includes('\r\n') ? '\r\n' : '\n'));
      await d.indexFile(v, dest);
      changed.push(dest);
      noteLink = { note: item.path, line: link };
    }
    // Listed in Documents: an email under its title, a PDF under its own title (the name it arrived with, not
    // the free name it took), so it reads the same before and after.
    const title = isEmail ? index.get(dest)?.title || baseOf(dest).replace(/\.md$/i, '') : titleFromName(baseOf(item.path));
    // An email lists under its title (edits keep path and what only: the list resolves the note by its title and
    // reads the subject there, opening the note itself).
    const entryItem: Record<string, unknown> = isEmail ? { path: title } : { path: dest, what: title };
    // A repeat PDF: linked as replacing the one it copies (Documents entries first, then bare files, which are
    // adopted with an entry of their own so the chain has both).
    if (!isEmail && /\.pdf$/i.test(item.path)) {
      const text = await v.read(p.path);
      const docs = parseProject(text, p.path).documents;
      const hit = docs.find((x) => sameDocument(baseOf(item.path), baseOf(x.path)) || (x.what ? sameDocument(baseOf(item.path), x.what) : false));
      if (hit) entryItem.more = docFactsToMore({ ...NO_FACTS, replaces: `[[${hit.path}]]` }, undefined);
      else {
        const bare = (await v.listAll()).files.find((f) => f.rel !== item.path && f.rel.startsWith(`${folder}/`) && sameDocument(baseOf(item.path), baseOf(f.rel)));
        if (bare) {
          await d.editProject(p.path, { kind: 'add', list: 'documents', item: { path: bare.rel, what: titleFromName(baseOf(bare.rel)) } }, '');
          entryItem.more = docFactsToMore({ ...NO_FACTS, replaces: `[[${bare.rel}]]` }, undefined);
        }
      }
    }
    const beforeEdit = await v.read(p.path);
    await d.editProject(p.path, { kind: 'add', list: 'documents', item: entryItem }, '');
    const afterEdit = await v.read(p.path);
    await d.indexFile(v, p.path);
    changed.push(p.path);
    const [line, ...more] = addedLines(beforeEdit, afterEdit);
    return { changed, words: isEmail ? `Filed “${title}” under ${p.name}.` : `Filed “${title}” under ${p.name}.`, movedTo: dest, alsoMoved, docLine: line ? { project: p.path, line, more } : null, noteLink };
  }

  /** The one question answered: filed under the project, and the next step made a Task of it (or none). */
  inboxHandle('intake:answer', async (id: unknown, project: unknown, step: unknown) => {
    await d.requireCreate();
    const v = d.vault();
    const item = (await inboxItems()).find((x) => x.id === id);
    if (!item) throw new Error('That item isn’t in the Inbox any more.');
    const isEmail = item.kind === 'note' && isEmailProps(index.get(item.path)?.props);
    const isPdf = item.kind === 'file' && /\.pdf$/i.test(item.path);
    if (!isEmail && !isPdf) throw new Error('That question is only asked for emails and PDFs.');
    if (typeof project !== 'string' || !project) throw new Error('Choose which project it goes under.');
    const ctx = await filingContext();
    const p = ctx.projects.find((x) => x.path === project);
    if (!p) throw new Error('That project isn’t there any more.');
    if (isFinished(p.status)) throw new Error('That project is finished, so nothing files into it.');
    const changed: string[] = [];
    let stepWhat: string | null = null;
    const said = typeof step === 'string' ? step.trim().slice(0, 300) : '';
    if (said) {
      await d.editProject(p.path, { kind: 'add', list: 'next', item: { what: said, done: false } }, '');
      await d.indexFile(v, p.path);
      changed.push(p.path);
      stepWhat = said;
    }
    const filed = await fileArrivalToProject(item, p);
    changed.push(...filed.changed);
    d.changed([INBOX_NOTE, ...changed]);
    d.filesChanged();
    const entry: AutoJournalEntry = { id: item.id, text: item.text, words: item.words, dest: null, before: null, created: null, step: stepWhat, project: stepWhat ? p.path : null, name: p.name, reminder: null, movedFrom: item.path, movedTo: filed.movedTo, ...(filed.alsoMoved.length ? { alsoMoved: filed.alsoMoved } : {}), ...(filed.docLine ? { docLine: filed.docLine } : {}), ...(filed.noteLink ? { noteLink: filed.noteLink } : {}) };
    const words = stepWhat ? `${filed.words} Next step: “${stepWhat}”.` : `${filed.words} No next step.`;
    try {
      return { words, paths: changed, undo: await journalHand(entry) };
    } catch {
      return { words, paths: changed };
    }
  });

  /** Recent mail through the connection the former host app already has (Gmail, Outlook): listed, then one saved whole. */
  inboxHandle('intake:mailboxes', async () => {
    if (!d.mail) return [];
    return (await d.mail.mailboxes()).map((b) => ({ id: b.id, label: b.label, address: b.address }));
  });
  inboxHandle('intake:mail-list', async (mailbox: unknown, limit: unknown) => {
    if (!d.mail) throw new Error('No mailbox is connected to Ironleaf. Save the email as a file and drop it in, or paste it.');
    if (typeof mailbox !== 'string' || !mailbox) throw new Error('Choose which mailbox to look in.');
    const rows = await d.mail.list(mailbox, Math.max(1, Math.min(40, typeof limit === 'number' ? limit : 15)));
    return rows.map((r) => ({ uid: r.uid, from: r.from, date: r.date, subject: r.subject, words: r.words.slice(0, 200), unread: r.unread }));
  });
  inboxHandle('intake:mail-save', async (mailbox: unknown, uid: unknown) => {
    if (!d.mail) throw new Error('No mailbox is connected to Ironleaf. Save the email as a file and drop it in, or paste it.');
    if (typeof mailbox !== 'string' || !mailbox || typeof uid !== 'number') throw new Error('Choose an email to save.');
    const m = await d.mail.read(mailbox, uid);
    const raw = bytesOf(m?.raw);
    const parsed = raw ? readEmailFile('saved.eml', raw) : null;
    if (!parsed) throw new Error('That email couldn’t be read.');
    return landEmail(fieldsOf(parsed), parsed.files.map((f) => ({ name: f.name, data: f.data })));
  });

  // ── Tags ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  const templatesOf = () => (d.prefs().templatesFolder || '').toLowerCase();
  const isTemplate = (p: string) => !!templatesOf() && p.toLowerCase().startsWith(`${templatesOf()}/`);
  handle('tags:list', (): TagUse[] => tagUses(index.allMeta(), isTemplate));

  async function changeTag(match: (m: NoteMeta) => boolean, change: (text: string) => string): Promise<{ notes: number; paths: string[] }> {
    await d.requireCreate();
    const v = d.vault();
    const paths: string[] = [];
    for (const m of index.allMeta()) {
      if (!match(m)) continue;
      try {
        const text = await v.read(m.path);
        const out = change(text);
        if (out === text) continue;
        await v.write(m.path, out);
        await d.indexFile(v, m.path);
        paths.push(m.path);
      } catch {
        // A note whose properties can't be read is left as it was.
      }
    }
    d.changed(paths);
    return { notes: paths.length, paths };
  }
  const has = (m: NoteMeta, tag: string) => m.tags.some((t) => t.toLowerCase() === tag.toLowerCase() || t.toLowerCase().startsWith(`${tag.toLowerCase()}/`));
  handle('tags:rename', async (from: unknown, to: unknown) => {
    if (typeof from !== 'string' || typeof to !== 'string') throw new Error('Give the tag a new name.');
    const r = await changeTag((m) => has(m, from.replace(/^#/, '')), (t) => renameTag(t, from, to));
    return { ...r, words: `#${from.replace(/^#/, '')} is #${to.replace(/^#/, '')} in ${plural(r.notes, 'note')}.` };
  });
  handle('tags:remove', async (tag: unknown) => {
    if (typeof tag !== 'string') throw new Error('Choose a tag.');
    const r = await changeTag((m) => has(m, tag.replace(/^#/, '')), (t) => removeTag(t, tag));
    return { ...r, words: `#${tag.replace(/^#/, '')} taken off ${plural(r.notes, 'note')}.` };
  });
}
