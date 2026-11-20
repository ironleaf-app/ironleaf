// Health and Fitness and Family on the main side (Wave 5, 24 Oct 2026): the window's handlers, the assistants' and
// agents' tools (src/shared/life-tools.ts) through each one's gate, appointment reminders, and the log notes taken into
// the health store. src/main/app.ts hands over its own ways in (notes written and indexed as every write is, the Recycle
// Bin, the sensitivity rules), so a family note written here is a note like any other and a health record never touches
// the vault.
//
// Off is off: with Health and Fitness off, its handlers refuse, the store stays closed (its key forgotten), no reminder
// timer runs and no file is made; with Family off its handlers refuse and nothing is written. Turning either back on finds
// everything where it was.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { readAreas, AREAS_FILE } from '../shared/areas';
import { cleanFileName } from '../shared/paths';
import {
  addCalendarRow,
  albumsOf,
  ageOn,
  calendarText,
  CALENDAR_NOTE,
  claimReward,
  daysFrom,
  FAMILY_RULES,
  FILES_FOLDER,
  forPerson,
  happeningWords,
  isMemberProps,
  markReward,
  memberText,
  MEMBERS_FOLDER,
  readCalendar,
  readDate,
  readMember,
  readReward,
  readTime,
  removeCalendarRow,
  rewardText,
  REWARDS_FOLDER,
  setCalendarRow,
  type Album,
  type Calendar,
  type CalendarSection,
  type Member,
  type Reward,
} from '../shared/family';
import {
  addDays,
  appointmentLine,
  dayWords,
  dbWords,
  exportCsv,
  exportJson,
  HEALTH_RULES,
  importLog,
  importedText,
  measureOf,
  mergeDb,
  newId,
  planLogImport,
  readExport,
  readValue,
  remindersDue,
  rowsFor,
  rowsWords,
  setEntry,
  todayIso,
  upcoming,
  valueWords,
  weekSessionSummary,
  type HealthDb,
  BIN_TABLES,
  type LogImportPlan,
  type MealKind,
  type SessionKind,
} from '../shared/health';
import { isLogProps } from '../shared/layouts';
import { filesFolderFor } from '../shared/file-records';
import { PHOTOS, isMedia, newAlbumText, newFamilyAlbumText } from '../shared/memories';
import { readTable } from '../shared/personal-records';
import { typeFolder } from '../shared/module-records';
import { moduleInfo, moduleOn, partOn, type ModuleSwitches } from '../shared/life-modules';
import { MODULE_TOOLS, moduleToolDef, type ModuleToolDef } from '../shared/module-tools';
import '../shared/life-tools';
import { levelLabel, refusal, type AgentId, type Level } from '../shared/sensitivity';
import type { Gate } from './agent-gate';
import { HealthStore, type HealthStoreStatus, type KeyProtector } from './health-store';
import type { VaultIndex } from './indexer';
import type { Sensitivity } from './sensitivity';

/** Who is asking: the person in the window, or an agent through its gate. */
export type Asker = { person: true } | { gate: Gate };

export interface ModulesDeps {
  handle(channel: string, fn: (...args: any[]) => unknown): void;
  /** Ironleaf's own data folder on this PC (the health store lives under it, never in the vault). */
  dataDir: string;
  root(): string | null;
  /** A stable id for the vault open now (its identity, else its place), for the health store's folder. */
  vaultKey(root: string): Promise<string>;
  index: VaultIndex;
  modules(): ModuleSwitches;
  protector: KeyProtector;
  sensitivity: Sensitivity;
  requireCreate(): Promise<void>;
  writeNote(rel: string, text: string, by?: string): Promise<void>;
  readNote(rel: string): Promise<string | null>;
  exists(rel: string): Promise<boolean>;
  makeFolder(rel: string): Promise<void>;
  trash(rel: string): Promise<void>;
  /** Inside the former host app: its Recently deleted (8.0 U13), where a deleted entry is listed by a pointer only. */
  bin?(item: { kind: string; title: string; detail?: string; ref?: unknown }): Promise<unknown>;
  files(): Promise<string[]>;
  /** The vault's folders (an album not filled yet). */
  folders?(): Promise<string[]>;
  /** Copies files from this PC into a folder of the vault (an album), each under a free name. */
  copyIn(abs: string[], folder: string): Promise<string[]>;
  pickFiles(o: { title: string; filters: { name: string; extensions: string[] }[]; multi: boolean }): Promise<string[]>;
  pickSave(o: { title: string; name: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>;
  notify(note: { title: string; body: string; onClick?: () => void }): void;
  openHealth(): void;
  /** Tells the window something a module holds changed. */
  changed(module: string): void;
  log?(m: string): void;
}

/** How a deleted Health entry is named in Recently deleted (8.0 U13): its kind, never its words. */
const BIN_WORDS: Record<string, string> = { sessions: 'A workout', plans: 'A training plan', exercises: 'An exercise', meals: 'A meal', appointments: 'An appointment', notes: 'A day’s note' };

const S = (v: unknown, max = 400): string => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const num = (v: unknown, min: number, max: number): number | undefined => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : undefined;
};
const DAYRE = /^\d{4}-\d{2}-\d{2}$/;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface FamilyState {
  on: boolean;
  folder: string;
  calendarPath: string;
  calendar: Calendar;
  members: Member[];
  rewards: Reward[];
  /** Family's albums (Memories merged into Family, packs uplift item 5): those under the Family area or naming
   *  a family member. `folder` is the album note's path. */
  albums: Album[];
  /** Albums still only in the Family area's old Assets folders, waiting to be moved into Family's albums. */
  legacy: Album[];
  /** Each member's documents: files in their folder and the links on their card. A Documents and ID record also
   *  carries its expiry (30 Oct 2026, 8.3 wave 1), so a passport running out shows on the person's card too. */
  documents: Record<string, { path: string; name: string; expires?: string }[]>;
  photos: 'ask' | 'never';
}

export interface LogNoteOffer {
  path: string;
  title: string;
  project?: string;
  level: Level;
  plan: LogImportPlan;
  /** Already taken in (copied or moved). */
  taken?: { at: number; moved: boolean };
}

/** Another module family's tools (Finance, Documents and ID: src/main/record-modules.ts), carried out by its own code:
 *  null when the tool isn't one of its own. The person asking is ctx.gate undefined. */
export interface ModuleDelegate {
  call(name: string, args: Record<string, unknown>, ctx: { gate?: Gate }): Promise<{ text: string; done?: { words: string } } | null>;
  rules?(): string;
}

export class Modules {
  readonly health: HealthStore;
  private delegate: ModuleDelegate | null = null;
  private dir: { root: string; dir: string } | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private d: ModulesDeps) {
    this.health = new HealthStore({ dir: () => (this.dir && this.dir.root === d.root() ? this.dir.dir : null), protector: d.protector, log: d.log });
  }

  /** Finance's and Documents and ID's tools go through the same path (one list, one gate, one switch each). */
  setDelegate(d: ModuleDelegate | null): void {
    this.delegate = d;
  }

  // ── Switches ────────────────────────────────────────────────────────────────────────────────────────────────────

  on(id: string): boolean {
    return moduleOn(this.d.modules(), id);
  }

  private need(id: string): void {
    if (!this.on(id)) throw new Error(`${moduleInfo(id)?.name ?? 'That module'} is switched off (Settings › Packs).`);
  }

  /** The switches changed: a module off closes and stops; Health on starts its reminders. */
  switched(): void {
    if (!this.on('health')) {
      this.health.close();
      this.stopTimer();
    } else this.startTimer();
  }

  private async healthDir(): Promise<void> {
    const root = this.d.root();
    if (!root) throw new Error('Open your vault first.');
    if (this.dir?.root === root) return;
    const key = (await this.d.vaultKey(root)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'vault';
    this.dir = { root, dir: path.join(this.d.dataDir, 'health', key) };
  }

  async healthDb(): Promise<HealthDb> {
    this.need('health');
    await this.healthDir();
    return this.health.read();
  }

  async healthChange(fn: (db: HealthDb) => HealthDb): Promise<HealthDb> {
    this.need('health');
    await this.healthDir();
    const db = await this.health.change(fn);
    this.d.changed('health');
    return db;
  }

  async healthStatus(): Promise<HealthStoreStatus & { words: string }> {
    if (!this.on('health')) return { exists: false, open: false, protectable: this.d.protector.available(), words: '' };
    await this.healthDir();
    const s = await this.health.status();
    return { ...s, words: s.open ? dbWords(await this.health.read()) : '' };
  }

  // ── Reminders (only while Health and Fitness is on) ─────────────────────────────────────────────────────────────

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.remind().catch(() => {}), 60_000);
    this.timer.unref?.();
    setTimeout(() => void this.remind().catch(() => {}), 8000).unref?.();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stop(): void {
    this.stopTimer();
    this.health.close();
  }

  /** Appointment reminders that came due, said once each (from 7 in the morning; never before the store was made). */
  async remind(now = new Date()): Promise<number> {
    if (!this.on('health') || !partOn(this.d.modules(), 'health', 'appointments') || now.getHours() < 7 || !this.d.root()) return 0;
    await this.healthDir();
    if (!(await this.health.status()).exists) return 0;
    const db = await this.health.read();
    const due = remindersDue(db, todayIso(now)).filter((a) => !a.reminded);
    if (!due.length) return 0;
    for (const a of due) this.d.notify({ title: `Appointment ${a.day === todayIso(now) ? 'today' : 'coming up'}`, body: appointmentLine(a, todayIso(now)), onClick: () => this.d.openHealth() });
    const ids = new Set(due.map((a) => a.id));
    await this.health.change((x) => ({ ...x, appointments: x.appointments.map((a) => (ids.has(a.id) ? { ...a, reminded: now.getTime() } : a)) }));
    this.d.changed('health');
    return due.length;
  }

  // ── Log notes into the health store ─────────────────────────────────────────────────────────────────────────────

  async logNotes(): Promise<LogNoteOffer[]> {
    const db = await this.healthDb();
    const out: LogNoteOffer[] = [];
    for (const m of this.d.index.allMeta()) {
      if (!isLogProps(m.props) || /^private notes\//i.test(m.path) || m.props?.reward_for) continue;
      const text = this.d.index.content(m.path) ?? (await this.d.readNote(m.path));
      if (!text) continue;
      const plan = planLogImport(db, text, m.title);
      if (!plan.entries) continue;
      const taken = [...db.imports].reverse().find((r) => r.path === m.path && !r.restored);
      out.push({ path: m.path, title: m.title, ...(m.props?.project ? { project: String(m.props.project).replace(/^\[\[|\]\]$/g, '') } : {}), level: this.d.sensitivity.level(m.path), plan, ...(taken ? { taken: { at: taken.at, moved: taken.moved } } : {}) });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Log notes taken in: copied (the note stays) or moved (the note goes to Recently deleted; its words are kept in the store
   *  word for word and can be put back). */
  async takeIn(paths: string[], moved: boolean): Promise<{ words: string; notes: number; entries: number }> {
    await this.d.requireCreate();
    let notes = 0;
    let entries = 0;
    for (const rel of paths.slice(0, 200)) {
      const meta = this.d.index.get(rel);
      if (!meta || !isLogProps(meta.props)) continue;
      const text = this.d.index.content(rel) ?? (await this.d.readNote(rel));
      if (text === null || text === undefined) continue;
      let count = 0;
      await this.healthChange((db) => {
        const r = importLog(db, { path: rel, title: meta.title, text, moved });
        count = r.plan.entries;
        return r.db;
      });
      if (moved) await this.d.trash(rel);
      notes++;
      entries += count;
    }
    const words = notes ? `${moved ? 'Moved' : 'Copied'} ${plural(notes, 'log note')} (${plural(entries, 'entry', 'entries')}) into your health store.${moved ? ' The notes are in Recently deleted, and each can be put back from Health › Settings.' : ' The notes stay where they are.'}` : 'Nothing was taken in.';
    return { words, notes, entries };
  }

  /** A log note moved in, written back where it was, word for word. */
  async putBack(importId: string): Promise<{ path: string; words: string }> {
    await this.d.requireCreate();
    const db = await this.healthDb();
    const rec = db.imports.find((r) => r.id === importId);
    const text = importedText(db, importId);
    if (!rec || text === null) throw new Error('That note isn’t kept in the health store any more.');
    let rel = rec.path;
    if (await this.d.exists(rel)) {
      const base = rel.replace(/\.md$/i, '');
      for (let i = 2; i < 100 && (await this.d.exists(rel)); i++) rel = `${base} (${i}).md`;
    }
    await this.d.writeNote(rel, text, 'you');
    await this.healthChange((x) => ({ ...x, imports: x.imports.map((r) => (r.id === importId ? { ...r, restored: Date.now() } : r)) }));
    return { path: rel, words: `Put “${rec.title}” back as a note, exactly as it was.` };
  }

  // ── Family ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async familyFolder(): Promise<string> {
    const root = this.d.root();
    if (!root) throw new Error('Open your vault first.');
    let text: string | null = null;
    try {
      text = await fsp.readFile(path.join(root, ...AREAS_FILE.split('/')), 'utf8');
    } catch {
      text = null;
    }
    const area = readAreas(text).config?.areas.find((a) => a.id === 'family');
    return area?.folder ?? 'Family';
  }

  async familyState(): Promise<FamilyState> {
    this.need('family');
    const folder = await this.familyFolder();
    const calendarPath = `${folder}/${CALENDAR_NOTE}`;
    const calText = this.d.index.content(calendarPath) ?? (await this.d.readNote(calendarPath)) ?? '';
    const metas = this.d.index.allMeta();
    const members = metas
      .filter((m) => isMemberProps(m.props) && !/^private notes\//i.test(m.path))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((m, i) => readMember(m.path, m.title, m.props ?? {}, i));
    const rewards: Reward[] = [];
    for (const m of metas) {
      if (!isLogProps(m.props) || !m.props?.reward_for) continue;
      const text = this.d.index.content(m.path) ?? (await this.d.readNote(m.path)) ?? '';
      rewards.push(readReward(m.path, m.title, m.props ?? {}, text));
    }
    const files = await this.d.files();
    const documents: FamilyState['documents'] = {};
    for (const mem of members) {
      const own = files.filter((f) => f.startsWith(`${folder}/${FILES_FOLDER}/${mem.name}/`)).map((f) => ({ path: f, name: f.split('/').pop()! }));
      const linked = this.d.index
        .outgoing(mem.path)
        .filter((o) => o.resolved && o.resolved !== mem.path)
        .map((o) => ({ path: o.resolved!, name: o.resolved!.split('/').pop()!.replace(/\.md$/i, '') }));
      // Documents and ID records (Wave 5 part a) that name this person: their note type is id-document, with the
      // expiry carried through so it shows beside the person's name (30 Oct 2026, 8.3 wave 1).
      const named = metas.filter((m) => String(m.props?.type ?? '') === 'id-document' && [m.props?.person, m.props?.holder, m.props?.owner, m.props?.for].some((v) => String(v ?? '').replace(/^\[\[|\]\]$/g, '').trim().toLowerCase() === mem.name.toLowerCase())).map((m) => ({ path: m.path, name: m.title, ...(typeof m.props?.expires === 'string' && /^\d{4}-\d{2}-\d{2}/.test(m.props.expires) ? { expires: m.props.expires.slice(0, 10) } : {}) }));
      const seen = new Set<string>();
      documents[mem.path] = [...named, ...linked, ...own].filter((x) => !seen.has(x.path) && (seen.add(x.path), true)).slice(0, 60);
    }
    // Albums live in Family (Memories merged in, packs uplift item 5): its people's albums (under the Family
    // area, or naming a member); the old Assets folders are listed apart until they are moved, never deleted.
    const legacy = albumsOf(files, folder, (await this.d.folders?.().catch(() => [])) ?? []);
    const memberNames = new Set(members.map((m) => m.name.toLowerCase()));
    const albums: Album[] = [];
    for (const m of metas) {
      if (String(m.props?.type ?? '').toLowerCase() !== 'album') continue;
      const people = (Array.isArray(m.props?.people) ? m.props!.people : [m.props?.people]).flatMap((x) => String(x ?? '').split(',')).map((x) => x.replace(/^\[\[|\]\]$/g, '').split('|')[0].trim().toLowerCase()).filter(Boolean);
      if (!m.path.startsWith(`${folder}/`) && !people.some((p) => memberNames.has(p))) continue;
      const dir = filesFolderFor(m.path);
      const photos = files.filter((f) => f.startsWith(`${dir}/`));
      // A hand-written Photos table counts too (packs uplift item 5): rows whose file is not beside the note.
      const seen = new Set(photos.map((p) => p.split('/').pop()!.toLowerCase()));
      const text = this.d.index.content(m.path) ?? (await this.d.readNote(m.path)) ?? '';
      for (const r of readTable(text, PHOTOS).rows) {
        const file = String(r.values.file ?? '').replace(/^!?\[\[|\]\]$/g, '');
        const base = file.split('/').pop()!.toLowerCase();
        if (!file || seen.has(base) || !isMedia(file)) continue;
        seen.add(base);
        photos.push(file);
      }
      albums.push({ folder: m.path, name: m.title, photos, ...(photos.length ? { cover: photos[0] } : {}) });
    }
    albums.sort((a, b) => a.name.localeCompare(b.name));
    return { on: true, folder, calendarPath, calendar: readCalendar(calText), members, rewards: rewards.sort((a, b) => a.who.localeCompare(b.who) || a.title.localeCompare(b.title)), albums, legacy: legacy.filter((l) => !albums.some((a) => a.name.toLowerCase() === l.name.toLowerCase())), documents, photos: this.d.sensitivity.store().photos };
  }

  private async calendarChange(change: (text: string) => string, by?: string): Promise<string> {
    await this.d.requireCreate();
    const folder = await this.familyFolder();
    const rel = `${folder}/${CALENDAR_NOTE}`;
    const had = this.d.index.content(rel) ?? (await this.d.readNote(rel));
    const before = had ?? calendarText();
    const after = change(before);
    if (after !== had) await this.d.writeNote(rel, after, by);
    this.d.changed('family');
    return rel;
  }

  async addMember(input: { name?: unknown; relation?: unknown; born?: unknown; school?: unknown; colour?: unknown }, by?: string): Promise<string> {
    this.need('family');
    await this.d.requireCreate();
    const name = cleanFileName(S(input.name, 80), '', 80);
    if (!name) throw new Error('Give their name.');
    const folder = await this.familyFolder();
    const rel = `${folder}/${MEMBERS_FOLDER}/${name}.md`;
    if (await this.d.exists(rel)) throw new Error(`${name} already has a card in ${folder}/${MEMBERS_FOLDER}.`);
    const born = S(input.born, 20);
    await this.d.writeNote(rel, memberText({ name, relation: S(input.relation, 40), born: DAYRE.test(born) ? born : undefined, school: S(input.school, 120), colour: S(input.colour, 20) }), by);
    this.d.changed('family');
    return rel;
  }

  async calendarAdd(section: CalendarSection, values: Record<string, unknown>, by?: string): Promise<string> {
    this.need('family');
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(values ?? {})) clean[k] = S(v, 300);
    return this.calendarChange((t) => addCalendarRow(t, section, clean), by);
  }

  async calendarSet(section: CalendarSection, row: number, values: Record<string, unknown>): Promise<string> {
    this.need('family');
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(values ?? {})) clean[k] = S(v, 300);
    return this.calendarChange((t) => setCalendarRow(t, section, row, clean));
  }

  async calendarRemove(section: CalendarSection, row: number): Promise<string> {
    this.need('family');
    return this.calendarChange((t) => removeCalendarRow(t, section, row));
  }

  async addReward(input: { who?: unknown; habit?: unknown; rewards?: unknown }, by?: string): Promise<string> {
    this.need('family');
    await this.d.requireCreate();
    const who = S(input.who, 80);
    const habit = S(input.habit, 60);
    if (!who || !habit) throw new Error('Say who it is for and what they do each day.');
    const rewards = (Array.isArray(input.rewards) ? input.rewards : [])
      .map((r) => ({ at: Math.round(num((r as { at?: unknown })?.at, 1, 3650) ?? 0), reward: S((r as { reward?: unknown })?.reward, 120) }))
      .filter((r) => r.at > 0);
    const folder = await this.familyFolder();
    const base = cleanFileName(`${who} – ${habit}`, '', 80);
    let rel = `${folder}/${REWARDS_FOLDER}/${base}.md`;
    for (let i = 2; i < 100 && (await this.d.exists(rel)); i++) rel = `${folder}/${REWARDS_FOLDER}/${base} (${i}).md`;
    await this.d.writeNote(rel, rewardText({ who, habit, rewards: rewards.length ? rewards : [{ at: 7, reward: '' }, { at: 14, reward: '' }, { at: 30, reward: '' }] }), by);
    this.d.changed('family');
    return rel;
  }

  async markReward(rel: string, day: string, yes: boolean | null, by?: string): Promise<Reward> {
    this.need('family');
    await this.d.requireCreate();
    const meta = this.d.index.get(rel);
    if (!meta || !meta.props?.reward_for) throw new Error('That reward tracker isn’t there any more.');
    const text = this.d.index.content(rel) ?? (await this.d.readNote(rel)) ?? '';
    const now = readReward(rel, meta.title, meta.props, text);
    if (day && !DAYRE.test(day)) throw new Error('Give the day as YYYY-MM-DD.');
    const next = markReward(text, now.habit, DAYRE.test(day) ? day : todayIso(), yes);
    if (next !== text) await this.d.writeNote(rel, next, by);
    this.d.changed('family');
    return readReward(rel, meta.title, meta.props, next);
  }

  async claim(rel: string, at: number): Promise<void> {
    this.need('family');
    await this.d.requireCreate();
    if (!Number.isInteger(at) || at <= 0) throw new Error('Give the reward’s day count (3 for the day-3 reward).');
    const text = this.d.index.content(rel) ?? (await this.d.readNote(rel));
    if (!text) throw new Error('That reward tracker isn’t there any more.');
    const meta = this.d.index.get(rel);
    const now = readReward(rel, meta?.title ?? rel, meta?.props ?? {}, text);
    const milestone = now.rewards.find((r) => r.at === at);
    if (!milestone) throw new Error(`Day ${at} has no reward on this tracker.`);
    if (milestone.claimed) throw new Error(`${milestone.reward} was already given.`);
    if (at > now.streak.current) throw new Error(`${milestone.reward} isn’t earned yet (${at - now.streak.current} ${at - now.streak.current === 1 ? 'day' : 'days'} to go).`);
    await this.d.writeNote(rel, claimReward(text, at));
    this.d.changed('family');
  }

  /** Where Family's album notes go in this vault. */
  private async albumFolder(): Promise<string> {
    let text: string | null = null;
    try {
      text = await fsp.readFile(path.join(this.d.root() ?? '', ...AREAS_FILE.split('/')), 'utf8');
    } catch {
      text = null;
    }
    return typeFolder('album', readAreas(text).config?.areas ?? null);
  }

  /** A new album is a Family album: Family's New album makes one in the album folder. */
  async addAlbum(name: string): Promise<string> {
    this.need('family');
    await this.d.requireCreate();
    const clean = cleanFileName(S(name, 80), '', 80);
    if (!clean) throw new Error('Give the album a name.');
    const folder = await this.albumFolder();
    let rel = `${folder}/${clean}.md`;
    for (let i = 2; i < 100 && (await this.d.exists(rel)); i++) rel = `${folder}/${clean} ${i}.md`;
    await this.d.writeNote(rel, newAlbumText({ kind: 'Collection' }));
    this.d.changed('family');
    return rel;
  }

  /** Move every old Family album folder into Family's albums: an album note for each, its photos copied beside it.
   *  The folders stay where they are: a move here never deletes anything a person made. */
  async migrateFamilyAlbums(): Promise<string> {
    this.need('family');
    await this.d.requireCreate();
    const state = await this.familyState();
    if (!state.legacy.length) return 'Every family album is in Family’s albums already.';
    const folder = await this.albumFolder();
    const root = this.d.root() ?? '';
    let moved = 0;
    for (const legacy of state.legacy) {
      let rel = `${folder}/${legacy.name}.md`;
      for (let i = 2; i < 100 && (await this.d.exists(rel)); i++) rel = `${folder}/${legacy.name} ${i}.md`;
      await this.d.writeNote(rel, newFamilyAlbumText(legacy.name, legacy.photos));
      const dir = filesFolderFor(rel);
      for (const photo of legacy.photos) {
        const from = path.join(root, ...photo.split('/'));
        const to = path.join(root, ...dir.split('/'), path.posix.basename(photo));
        await fsp.mkdir(path.dirname(to), { recursive: true }).catch(() => undefined);
        await fsp.copyFile(from, to).catch(() => undefined);
      }
      moved++;
    }
    this.d.changed('family');
    return `Moved ${moved} ${moved === 1 ? 'album' : 'albums'} into Family’s albums. The old folders stay where they were, so nothing is lost.`;
  }

  async addPhotos(album: string): Promise<number> {
    this.need('family');
    await this.d.requireCreate();
    const folder = await this.familyFolder();
    // An album note (Memories) keeps its photos beside it; an old Assets folder keeps them in the folder.
    const isNote = /\.md$/i.test(album) && (await this.d.exists(album));
    if (!isNote && !album.startsWith(`${folder}/Assets`)) throw new Error('That isn’t one of the family albums.');
    const picked = await this.d.pickFiles({ title: 'Add photos to the album', filters: [{ name: 'Photos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'avif'] }], multi: true });
    if (!picked.length) return 0;
    const added = await this.d.copyIn(picked, isNote ? filesFolderFor(album) : album);
    this.d.changed('family');
    return added.length;
  }

  // ── Export and bring back (Health) ──────────────────────────────────────────────────────────────────────────────

  async exportHealth(): Promise<string | null> {
    const db = await this.healthDb();
    const file = await this.d.pickSave({ title: 'Export your health records', name: `Health records ${todayIso()}.json`, filters: [{ name: 'Health records', extensions: ['json'] }] });
    if (!file) return null;
    await fsp.writeFile(file, exportJson(db), 'utf8');
    return file;
  }

  /** The person's data as a CSV table (packs uplift item 13): for reading anywhere, not for bringing back. */
  async exportHealthCsv(): Promise<string | null> {
    const db = await this.healthDb();
    const file = await this.d.pickSave({ title: 'Export your health records', name: `Health records ${todayIso()}.csv`, filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv'] }] });
    if (!file) return null;
    await fsp.writeFile(file, exportCsv(db), 'utf8');
    return file;
  }

  async importHealth(): Promise<string | null> {
    this.need('health');
    const [file] = await this.d.pickFiles({ title: 'Bring back health records', filters: [{ name: 'Health records', extensions: ['json'] }], multi: false });
    if (!file) return null;
    const theirs = readExport(await fsp.readFile(file, 'utf8'));
    if (!theirs) throw new Error('That file isn’t an export of Ironleaf’s health records.');
    await this.healthChange((db) => mergeDb(db, theirs));
    return `Brought back ${dbWords(theirs).toLowerCase()} from ${path.basename(file)}.`;
  }

  // ── Tools for assistants and agents ─────────────────────────────────────────────────────────────────────────────

  /** The module tools offered now: only for modules (and parts) that are on. */
  tools(): ModuleToolDef[] {
    const sw = this.d.modules();
    return MODULE_TOOLS.filter((t) => moduleOn(sw, t.module) && ((t.module !== 'health' && t.module !== 'family') ? !!this.delegate : this.partFor(t.name, sw)));
  }

  private partFor(name: string, sw: ModuleSwitches): boolean {
    const parts: Record<string, string> = { health_session_log: 'training', health_meal_log: 'food', health_appointments: 'appointments', health_appointment_add: 'appointments', family_milestone_add: 'milestones', family_reward_log: 'rewards', family_events: 'calendar', family_event_add: 'calendar', family_activity_add: 'calendar' };
    const p = parts[name];
    return !p || partOn(sw, name.split('_')[0], p);
  }

  has(name: string): boolean {
    return this.tools().some((t) => t.name === name);
  }

  /** The rules an assistant is told while a module is on. */
  rules(): string {
    return [this.on('health') ? HEALTH_RULES : '', this.on('family') ? FAMILY_RULES : '', this.delegate?.rules?.() ?? ''].filter(Boolean).join('\n');
  }

  /** May this asker have a module's records at its level? Refused in words (and in the audit trail) when not. */
  private allow(asker: Asker, level: Level, item: string, action: 'read' | 'changed'): string {
    if ('person' in asker) return 'you';
    const g = asker.gate;
    if (!this.d.sensitivity.allows(g.who, level)) {
      this.d.sensitivity.audit({ who: g.who, whoName: g.name, action: 'refused', item, level, detail: action === 'changed' ? 'to change it' : 'to read it' });
      throw new Error(refusal(level, g.name));
    }
    return g.name;
  }

  private audit(asker: Asker, action: 'read' | 'changed', item: string, level: Level, detail?: string): void {
    if ('person' in asker) return;
    this.d.sensitivity.audit({ who: asker.gate.who, whoName: asker.gate.name, action, item, level, ...(detail ? { detail } : {}) });
  }

  /** One module tool's call, for an asker: its answer in words (and a line for "What agents did"). */
  async call(asker: Asker, name: string, a: Record<string, unknown>): Promise<{ text: string; done?: { words: string } }> {
    const def = moduleToolDef(name);
    if (!def || !this.has(name)) throw new Error(def ? `${moduleInfo(def.module)?.name ?? 'That module'} is switched off in Ironleaf (Settings › Packs).` : `There is no tool called ${name}.`);
    if (def.module === 'health') return this.healthTool(asker, name, a);
    if (def.module === 'family') return this.familyTool(asker, name, a);
    const out = await this.delegate?.call(name, a, 'person' in asker ? {} : { gate: asker.gate });
    if (!out) throw new Error(`There is no tool called ${name}.`);
    return out;
  }

  private async healthTool(asker: Asker, name: string, a: Record<string, unknown>): Promise<{ text: string; done?: { words: string } }> {
    const today = todayIso();
    const day = (v: unknown) => {
      const t = S(v, 20);
      if (!t) return today;
      if (/^yesterday$/i.test(t)) return addDays(today, -1);
      const d = readDate(t, today);
      if (!d) throw new Error(`“${t}” isn’t a day (write YYYY-MM-DD).`);
      return d;
    };
    switch (name) {
      case 'health_measures': {
        this.allow(asker, 'health', 'Health store: the measures kept', 'read');
        const db = await this.healthDb();
        this.audit(asker, 'read', 'Health store: the measures kept', 'health');
        const live = db.measures.filter((m) => !m.archived);
        const kind = (m: (typeof live)[number]) => (m.kind === 'yesno' ? 'yes/no' : m.kind === 'scale' ? `score ${m.min ?? 1}-${m.max ?? 10}` : m.kind === 'text' ? 'words' : m.unit ? `number (${m.unit})` : 'number');
        return { text: `Measures kept: ${live.map((m) => `${m.name} (${kind(m)})`).join('; ') || 'none yet'}.\nThe daily check-in asks: ${db.checkin.measures.map((id) => db.measures.find((m) => m.id === id)?.name).filter(Boolean).join(', ') || 'nothing yet'}.` };
      }
      case 'health_trend': {
        const db0 = await this.healthDb();
        const m = measureOf(db0, S(a.measure, 60));
        if (!m) throw new Error(`The health store doesn’t keep “${S(a.measure, 60)}”. It keeps: ${db0.measures.filter((x) => !x.archived).map((x) => x.name).join(', ')}.`);
        const to = S(a.to, 20) ? day(a.to) : today;
        const span = Math.round(num(a.days, 1, 366) ?? 30);
        let from = S(a.from, 20) ? day(a.from) : addDays(to, -(span - 1));
        if (from > to) from = to;
        if (from < addDays(to, -366)) from = addDays(to, -366);
        const item = `Health store: ${m.name}, ${dayWords(from)} to ${dayWords(to)}`;
        this.allow(asker, 'health', item, 'read');
        const rows = rowsFor(db0, m, from, to);
        this.audit(asker, 'read', item, 'health', `${rows.rows.length} entries`);
        return { text: rowsWords(rows) };
      }
      case 'health_checkin_log': {
        const by = this.allow(asker, 'health', 'Health store: a check-in', 'changed');
        const values = a.values && typeof a.values === 'object' && !Array.isArray(a.values) ? (a.values as Record<string, unknown>) : {};
        const d = day(a.day);
        const db0 = await this.healthDb();
        const unknown: string[] = [];
        const bad: string[] = [];
        const set: { id: string; name: string; value: NonNullable<ReturnType<typeof readValue>> }[] = [];
        for (const [k, v] of Object.entries(values).slice(0, 40)) {
          const m = measureOf(db0, k);
          if (!m || m.archived) {
            unknown.push(k);
            continue;
          }
          const value = readValue(m, v);
          if (!value) bad.push(`${m.name} (${m.kind === 'yesno' ? 'yes or no' : m.kind === 'text' ? 'words' : 'a number'})`);
          else set.push({ id: m.id, name: m.name, value });
        }
        if (!set.length) throw new Error([unknown.length ? `The health store doesn’t keep ${unknown.map((x) => `“${x}”`).join(', ')} (it keeps ${db0.measures.filter((x) => !x.archived).map((x) => x.name).join(', ')}; the person can add measures on the Health page).` : '', bad.length ? `These need ${bad.join(', ')}.` : '', !Object.keys(values).length ? 'Give the values to log.' : ''].filter(Boolean).join(' '));
        const note = S(a.note, 600);
        await this.healthChange((db) => {
          let next = db;
          for (const s2 of set) next = setEntry(next, s2.id, d, s2.value, { by });
          if (note) next = { ...next, notes: [...next.notes, { id: newId(), day: d, text: note, at: Date.now() }] };
          return next;
        });
        const after = await this.healthDb();
        const said = set.map((s2) => `${s2.name} ${valueWords(after.measures.find((m) => m.id === s2.id), s2.value)}`).join(', ');
        this.audit(asker, 'changed', `Health store: check-in for ${dayWords(d)}`, 'health', set.map((s2) => s2.name).join(', '));
        return { text: `Logged for ${dayWords(d)}: ${said}.${unknown.length ? ` Not kept (no such measure): ${unknown.join(', ')}.` : ''}${bad.length ? ` Not logged: ${bad.join(', ')}.` : ''}`, done: { words: `Logged a health check-in for ${dayWords(d)}.` } };
      }
      case 'health_session_log': {
        const by = this.allow(asker, 'health', 'Health store: a training session', 'changed');
        const title = S(a.title, 120);
        if (!title) throw new Error('Give the session a title.');
        const d = day(a.day);
        const kinds: SessionKind[] = ['strength', 'cardio', 'mobility', 'sport', 'other'];
        const exercises = (Array.isArray(a.exercises) ? a.exercises : []).slice(0, 40).map((e) => {
          const o = (e ?? {}) as Record<string, unknown>;
          return {
            name: S(o.name, 100) || 'Exercise',
            sets: (Array.isArray(o.sets) ? o.sets : []).slice(0, 50).map((st) => {
              const x = (st ?? {}) as Record<string, unknown>;
              return { reps: num(x.reps, 0, 10000), weight: num(x.weight, 0, 10000), seconds: num(x.seconds, 0, 86400), distance: num(x.distance, 0, 10000), done: true };
            }),
          };
        });
        await this.healthChange((db) => ({ ...db, sessions: [...db.sessions, { id: newId(), day: d, title, kind: kinds.includes(a.kind as SessionKind) ? (a.kind as SessionKind) : exercises.some((e) => e.sets.some((st) => st.weight)) ? 'strength' : 'other', minutes: num(a.minutes, 0, 1440), effort: num(a.effort, 1, 10), exercises, notes: S(a.notes, 4000) || undefined, at: Date.now(), by }] }));
        this.audit(asker, 'changed', `Health store: training session ${dayWords(d)}`, 'health', title);
        return { text: `Logged “${title}” for ${dayWords(d)}${exercises.length ? ` with ${plural(exercises.length, 'exercise')}` : ''}.`, done: { words: `Logged the training session “${title}”.` } };
      }
      case 'health_meal_log': {
        const by = this.allow(asker, 'health', 'Health store: a meal', 'changed');
        const what = S(a.what, 300);
        if (!what) throw new Error('Say what the meal was.');
        const d = day(a.day);
        const meal: MealKind = (['breakfast', 'lunch', 'dinner', 'snack'] as MealKind[]).includes(a.meal as MealKind) ? (a.meal as MealKind) : 'snack';
        await this.healthChange((db) => ({ ...db, meals: [...db.meals, { id: newId(), day: d, meal, what, kcal: num(a.kcal, 0, 20000), protein: num(a.protein, 0, 2000), at: Date.now(), by }] }));
        this.audit(asker, 'changed', `Health store: a meal ${dayWords(d)}`, 'health');
        return { text: `Logged ${meal} for ${dayWords(d)}: ${what}.`, done: { words: `Logged a meal (${meal}).` } };
      }
      case 'health_week': {
        this.allow(asker, 'health', 'Health store: this week in numbers', 'read');
        const db = await this.healthDb();
        const w = weekSessionSummary(db, today);
        this.audit(asker, 'read', 'Health store: this week in numbers', 'health');
        return { text: `This week (from ${dayWords(w.start)}): ${w.done} training ${w.done === 1 ? 'session' : 'sessions'} done${w.target ? ` of the ${w.target} aimed for` : ''}; the daily check-in was answered on ${w.checkinDays} ${w.checkinDays === 1 ? 'day' : 'days'}.` };
      }
      case 'health_appointments': {
        const days = Math.round(num(a.days, 1, 366) ?? 30);
        const item = `Health store: appointments in the next ${days} days`;
        this.allow(asker, 'health', item, 'read');
        const db = await this.healthDb();
        const list = upcoming(db, today, days);
        this.audit(asker, 'read', item, 'health', `${list.length} found`);
        return { text: list.length ? list.map((x) => `- ${appointmentLine(x, today)}`).join('\n') : `No appointments booked in the next ${days} days.` };
      }
      case 'health_appointment_add': {
        const by = this.allow(asker, 'health', 'Health store: an appointment', 'changed');
        const who = S(a.who, 120);
        if (!who) throw new Error('Say who the appointment is with.');
        const d = day(a.day);
        if (d < today) throw new Error('That day has passed: give the day it is booked for.');
        const time = readTime(S(a.time, 20));
        await this.healthChange((db) => ({ ...db, appointments: [...db.appointments, { id: newId(), day: d, ...(time ? { time } : {}), who, where: S(a.where, 200) || undefined, why: S(a.why, 300) || undefined, status: 'booked', remind: num(a.remind, 0, 60) ?? 1, results: [], at: Date.now(), by }] }));
        this.audit(asker, 'changed', `Health store: appointment ${dayWords(d)}`, 'health', who);
        return { text: `Booked in: ${who}, ${dayWords(d)}${time ? ` at ${time}` : ''}. Ironleaf will remind them ${num(a.remind, 0, 60) === 0 ? 'on the day' : 'the day before'}.`, done: { words: `Added an appointment (${who}, ${dayWords(d)}).` } };
      }
    }
    throw new Error(`There is no tool called ${name}.`);
  }

  private async familyTool(asker: Asker, name: string, a: Record<string, unknown>): Promise<{ text: string; done?: { words: string } }> {
    const today = todayIso();
    const st = await this.familyState();
    // The family's notes are notes: an agent's gate decides by each note's own level (Family-private unless changed).
    const check = (rel: string, action: 'read' | 'changed') => {
      if ('person' in asker) return;
      asker.gate.check(rel, action);
      asker.gate.note(rel, action);
    };
    const by = 'person' in asker ? undefined : `agent:${asker.gate.name}`;
    switch (name) {
      case 'family_members': {
        if (!('person' in asker)) {
          const seen = st.members.filter((m) => asker.gate.sees(m.path));
          if (st.members.length && !seen.length) check(st.members[0].path, 'read');
          asker.gate.listed(seen.map((m) => m.path), 'the family’s cards');
          return { text: seen.length ? seen.map((m) => `- ${m.name}${m.relation ? ` (${m.relation})` : ''}${ageOn(m.born, today) !== null ? `, ${ageOn(m.born, today)}` : ''}${m.school ? `, ${m.school}` : ''}`).join('\n') : 'No family members have cards yet.' };
        }
        return { text: st.members.map((m) => `- ${m.name}`).join('\n') || 'No family members have cards yet.' };
      }
      case 'family_events': {
        check(st.calendarPath, 'read');
        if (S(a.from, 20) && !readDate(S(a.from, 20), today)) throw new Error('Give the day as YYYY-MM-DD.');
        const from = readDate(S(a.from, 20), today) ?? today;
        const days = Math.round(num(a.days, 1, 31) ?? 7);
        const who = S(a.who, 80);
        const list = daysFrom(st.calendar, st.members, from, days).map((x) => ({ ...x, items: who ? forPerson(x.items, who) : x.items }));
        const lines = list.filter((x) => x.items.length).map((x) => `${dayWords(x.day, today)}:\n${x.items.map((h) => `- ${happeningWords(h)}`).join('\n')}`);
        return { text: lines.length ? lines.join('\n') : `Nothing on${who ? ` for ${who}` : ''} from ${dayWords(from, today)} for ${plural(days, 'day')}.` };
      }
      case 'family_week_ahead': {
        check(st.calendarPath, 'read');
        if (S(a.from, 20) && !readDate(S(a.from, 20), today)) throw new Error('Give the day as YYYY-MM-DD.');
        const from = readDate(S(a.from, 20), today) ?? today;
        const days = Math.round(num(a.days, 1, 31) ?? 7);
        const who = S(a.who, 80);
        const list = daysFrom(st.calendar, st.members, from, days).map((x) => ({ ...x, items: who ? forPerson(x.items, who) : x.items }));
        const lines = list.filter((x) => x.items.length).map((x) => `${dayWords(x.day, today)}: ${x.items.map((h) => happeningWords(h)).join('; ')}`);
        return { text: lines.length ? `The week ahead${who ? ` for ${who}` : ''}:\n${lines.join('\n')}` : `Nothing on${who ? ` for ${who}` : ''} in the next ${plural(days, 'day')}.` };
      }
      case 'family_event_add': {
        if (await this.d.exists(st.calendarPath)) check(st.calendarPath, 'changed');
        else this.allow(asker, 'family', st.calendarPath, 'changed');
        const date = readDate(S(a.date, 30), today);
        const what = S(a.what, 200);
        if (!date || !what) throw new Error('Give the event’s day (YYYY-MM-DD) and what it is.');
        await this.calendarAdd('Events', { Date: date, Time: S(a.time, 20), Who: S(a.who, 200), What: what, Where: S(a.where, 200) }, by);
        return { text: `Added to the family calendar: ${what}, ${dayWords(date, today)}${S(a.time, 20) ? ` at ${S(a.time, 20)}` : ''}.`, done: { words: `Added “${what}” to the family calendar.` } };
      }
      case 'family_activity_add': {
        if (await this.d.exists(st.calendarPath)) check(st.calendarPath, 'changed');
        else this.allow(asker, 'family', st.calendarPath, 'changed');
        const what = S(a.what, 200);
        const dayw = S(a.day, 60);
        if (!what || !dayw) throw new Error('Say what it is and which days.');
        await this.calendarAdd('Activities', { Who: S(a.who, 200), What: what, Day: dayw, Time: S(a.time, 20), Where: S(a.where, 200), Until: S(a.until, 20) }, by);
        return { text: `Added each ${dayw}: ${what}.`, done: { words: `Added the weekly activity “${what}”.` } };
      }
      case 'family_milestone_add': {
        if (await this.d.exists(st.calendarPath)) check(st.calendarPath, 'changed');
        else this.allow(asker, 'family', st.calendarPath, 'changed');
        const what = S(a.what, 300);
        if (!what) throw new Error('Say what the milestone is.');
        if (S(a.date, 30) && !readDate(S(a.date, 30), today)) throw new Error('Give the day as YYYY-MM-DD.');
        const date = readDate(S(a.date, 30), today) ?? today;
        await this.calendarAdd('Milestones', { Date: date, Who: S(a.who, 200), Milestone: what }, by);
        return { text: `Kept: ${what} (${dayWords(date, today)}).`, done: { words: `Kept the milestone “${what}”.` } };
      }
      case 'family_reward_log': {
        const want = S(a.tracker, 120).toLowerCase();
        const r = st.rewards.find((x) => x.who.toLowerCase() === want) ?? st.rewards.find((x) => x.title.toLowerCase() === want) ?? st.rewards.find((x) => x.title.toLowerCase().includes(want) || (want && want.includes(x.who.toLowerCase())));
        if (!r) throw new Error(st.rewards.length ? `No reward tracker matches “${S(a.tracker, 120)}”. There are: ${st.rewards.map((x) => x.title).join(', ')}.` : 'There are no reward trackers yet.');
        check(r.path, 'changed');
        if (S(a.day, 30) && !readDate(S(a.day, 30), today)) throw new Error('Give the day as YYYY-MM-DD.');
        const d = readDate(S(a.day, 30), today) ?? today;
        const after = await this.markReward(r.path, d, a.yes === false ? false : true, by);
        const s2 = after.streak;
        return { text: `${after.who}’s ${after.habit}: ${a.yes === false ? 'no' : 'yes'} for ${d === today ? 'today' : dayWords(d, today)}. Streak ${plural(s2.current, 'day')} (best ${s2.best}).${after.earned ? ` Earned: ${after.earned.reward} (day ${after.earned.at}) — not yet given.` : s2.next ? ` ${plural(s2.next.left, 'day')} to the day-${s2.next.at} reward.` : ''}`, done: { words: `Marked ${after.who}’s ${after.habit} for ${dayWords(d, today)}.` } };
      }
    }
    throw new Error(`There is no tool called ${name}.`);
  }

  /** The former host app's Recently deleted asks (8.0 U13): put a deleted Health entry back where it was, or let it go for
good. */
  async binAction(action: 'restore' | 'forget', kind: unknown, ref: unknown): Promise<{ done: boolean; words: string }> {
    const r = (ref ?? {}) as { table?: unknown; id?: unknown };
    if (kind !== 'health' || typeof r.id !== 'string' || !BIN_TABLES.includes(r.table as (typeof BIN_TABLES)[number])) throw new Error('Ironleaf doesn’t keep that.');
    let found = false;
    await this.healthChange((db) => {
      const kept = (db.binned ?? []).find((b) => b.id === r.id && b.table === r.table);
      found = !!kept;
      const binned = (db.binned ?? []).filter((b) => b !== kept);
      if (!kept || action === 'forget') return { ...db, binned };
      const list = db[kept.table] as unknown as { id: string }[];
      return { ...db, binned, [kept.table]: list.some((x) => x.id === kept.id) ? list : [...list, kept.record] } as HealthDb;
    });
    if (action === 'restore' && !found) throw new Error('That Health entry isn’t kept any more.');
    return { done: found, words: action === 'restore' ? 'Put back in Health.' : 'Removed for good.' };
  }

  // ── The window's handlers ───────────────────────────────────────────────────────────────────────────────────────

  register(): void {
    const h = this.d.handle;
    const me: Asker = { person: true };
    h('health:status', () => this.healthStatus());
    h('health:read', () => this.healthDb());
    h('health:put', async (table: unknown, record: unknown) => {
      await this.d.requireCreate();
      const tables = ['measures', 'sessions', 'plans', 'exercises', 'meals', 'appointments', 'notes'] as const;
      if (!tables.includes(table as (typeof tables)[number]) || !record || typeof record !== 'object') throw new Error('That can’t be saved.');
      const t = table as (typeof tables)[number];
      const r = { ...(record as Record<string, unknown>) };
      if (typeof r.id !== 'string' || !r.id) r.id = newId();
      if (t !== 'measures' && t !== 'plans' && t !== 'exercises') r.at = Date.now();
      if ((t === 'measures' || t === 'plans') && typeof r.created !== 'number') r.created = Date.now();
      return this.healthChange((db) => {
        const list = db[t] as unknown as { id: string }[];
        const i = list.findIndex((x) => x.id === r.id);
        const next = i >= 0 ? list.map((x, k) => (k === i ? { ...x, ...r } : x)) : [...list, r];
        return { ...db, [t]: next } as HealthDb;
      });
    });
    h('health:remove', async (table: unknown, id: unknown) => {
      await this.d.requireCreate();
      const tables = ['sessions', 'plans', 'exercises', 'meals', 'appointments', 'notes'] as const;
      if (!tables.includes(table as (typeof tables)[number]) || typeof id !== 'string') throw new Error('That can’t be removed.');
      const t = table as (typeof tables)[number];
      // To Recently deleted for 30 days (8.0 U13): the entry stays sealed in this store, and the former host app's
      // list shows only what kind of entry it was and its day, never what it said.
      const was = ((await this.healthDb())[t] as unknown as Record<string, unknown>[]).find((x) => x.id === id);
      const db = await this.healthChange((d) => ({ ...d, [t]: (d[t] as unknown as { id: string }[]).filter((x) => x.id !== id), ...(was ? { binned: [...(d.binned ?? []), { id, table: t, record: was, at: Date.now() }] } : {}) }) as HealthDb);
      if (was && this.d.bin) {
        const day = typeof was.day === 'string' ? was.day : '';
        await this.d.bin({ kind: 'health', title: `${BIN_WORDS[t]}${day ? `, ${new Date(`${day}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}`, detail: 'Ironleaf · Health', ref: { table: t, id } }).catch(() => {});
      }
      return db;
    });
    h('health:entry', async (measure: unknown, day: unknown, value: unknown, note?: unknown) => {
      await this.d.requireCreate();
      if (typeof measure !== 'string' || typeof day !== 'string' || !DAYRE.test(day)) throw new Error('That can’t be saved.');
      return this.healthChange((db) => {
        const m = db.measures.find((x) => x.id === measure);
        if (!m) throw new Error('That measure isn’t kept any more.');
        const v = value === null ? null : readValue(m, value);
        if (value !== null && !v) throw new Error(`${m.name} takes ${m.kind === 'yesno' ? 'yes or no' : m.kind === 'text' ? 'words' : 'a number'}.`);
        return setEntry(db, m.id, day, v, { by: 'you', ...(typeof note === 'string' ? { note: note.slice(0, 600) } : {}) });
      });
    });
    h('health:settings', async (patch: unknown) => {
      await this.d.requireCreate();
      const p = (patch ?? {}) as Partial<Pick<HealthDb, 'profile' | 'targets' | 'checkin'>>;
      return this.healthChange((db) => ({ ...db, ...(p.profile ? { profile: { ...db.profile, ...p.profile } } : {}), ...(p.targets ? { targets: { ...db.targets, ...p.targets } } : {}), ...(p.checkin ? { checkin: { ...db.checkin, ...p.checkin } } : {}) }));
    });
    h('health:log-notes', () => this.logNotes());
    h('health:take-in', (paths: unknown, moved: unknown) => this.takeIn(Array.isArray(paths) ? paths.filter((x): x is string => typeof x === 'string') : [], moved === true));
    h('health:put-back', (id: unknown) => this.putBack(String(id ?? '')));
    h('health:export', () => this.exportHealth());
    h('health:export-csv', () => this.exportHealthCsv());
    h('health:import', () => this.importHealth());

    h('family:state', () => this.familyState());
    h('family:member-add', (input: unknown) => this.addMember((input ?? {}) as Record<string, unknown>));
    const section = (v: unknown): CalendarSection => {
      if (v === 'Activities' || v === 'Events' || v === 'Milestones') return v;
      throw new Error('That isn’t part of the family calendar.');
    };
    h('family:calendar-add', (s: unknown, values: unknown) => this.calendarAdd(section(s), (values ?? {}) as Record<string, unknown>));
    h('family:calendar-set', (s: unknown, row: unknown, values: unknown) => this.calendarSet(section(s), Number(row), (values ?? {}) as Record<string, unknown>));
    h('family:calendar-remove', (s: unknown, row: unknown) => this.calendarRemove(section(s), Number(row)));
    h('family:reward-add', (input: unknown) => this.addReward((input ?? {}) as Record<string, unknown>));
    h('family:reward-mark', (rel: unknown, day: unknown, yes: unknown) => this.markReward(String(rel ?? ''), String(day ?? ''), yes === null ? null : yes === true));
    h('family:reward-claim', (rel: unknown, at: unknown) => this.claim(String(rel ?? ''), Number(at)));
    h('family:album-add', (name: unknown) => this.addAlbum(String(name ?? '')));
    h('family:albums-migrate', () => this.migrateFamilyAlbums());
    h('family:photos-add', (album: unknown) => this.addPhotos(String(album ?? '')));
    // The person's own tool calls (the window's quick-add uses the same words as the assistants).
    h('modules:call', (name: unknown, args: unknown) => this.call(me, String(name ?? ''), (args ?? {}) as Record<string, unknown>));
  }
}

/** The level a module's records carry (for words in the window). */
export const moduleLevelWords = (id: string) => levelLabel(moduleInfo(id)?.level ?? 'open');

/** An agent id for the former host app's own asks (the former host app itself, or one of a chat bot's
bots). */
export const askerName = (who: AgentId) => (who === 'neuralspark' ? 'Another app' : who === 'neuralbot' ? 'Chat bot' : who.startsWith('bot:') ? `Chat bot (${who.slice(4)})` : who);
