// Secrets, sensitivity levels, the scanner, the audit trail and the move out of Private notes, for the window (Wave 4,
// 24 Oct 2026). The rules are src/shared/sensitivity.ts and src/shared/secret-scan.ts; the store is src/main/secrets.ts;
// agents get in only through src/main/agent-gate.ts. This file carries out what the window asks (Settings › Privacy and
// secrets, the Secrets page, the level picker on a note, a file or a folder).
//
// The scanner never hands the window a value: findings go out masked with a fingerprint, and a move reads the note again,
// finds the same findings by their fingerprints, puts each value in Secrets and writes the note with locked links in
// their place, as one step the person can Undo (the note back as it was, the secrets it made taken back).

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Document } from 'yaml';
import { changeProps } from '../shared/frontmatter';
import { isPrivatePath, PRIVATE_DIR } from '../shared/private';
import { fingerprint, lockFindings, nameFor, scanText, type Finding } from '../shared/secret-scan';
import {
  accessOf,
  AGENT_GROUPS,
  agentKey,
  hasOwnRow,
  LEVEL_IDS,
  levelLabel,
  parentOf,
  readLevel,
  secretIdsIn,
  type AgentId,
  type Level,
} from '../shared/sensitivity';
import type {
  AgentRow,
  FolderRow,
  LevelOfView,
  MigrationChoice,
  MigrationNote,
  MigrationResult,
  MoveResult,
  PrivacyState,
  ScanFileView,
  ScanNoteView,
  ScanReport,
  SecretInput,
  SecretsStatus,
  TypeRow,
} from '../shared/secrets';
import type { VaultIndex } from './indexer';
import type { PrivateNotes } from './private-notes';
import type { SecretsStore } from './secrets';
import type { Sensitivity } from './sensitivity';

export interface SensitiveHost {
  dataDir: string;
  index: VaultIndex;
  sensitivity: Sensitivity;
  secrets: SecretsStore;
  privateNotes: PrivateNotes;
  root(): string | null;
  /** The person can change things now (a licence and an open vault), else throws in words. */
  canEdit(): Promise<void>;
  writeNote(rel: string, text: string): Promise<void>;
  exists(rel: string): Promise<boolean>;
  /** Every file in the vault that isn't a note, for the scanner's file names and the counts. */
  files(): Promise<string[]>;
  noteTypes(): Promise<{ id: string; name: string }[]>;
  /** The window should read Privacy and secrets again. */
  changed(what: 'privacy' | 'secrets' | 'audit'): void;
  log?(message: string): void;
}

const titleOf = (rel: string) => (rel.split('/').pop() ?? rel).replace(/\.md$/i, '');

/** Areas of life and the level each usually has (Settings offers these, never sets them by itself). */
const AREA_LEVELS: [RegExp, Level][] = [
  [/^health\b/i, 'health'],
  [/^family\b/i, 'family'],
  [/^(me|personal|life)\b/i, 'personal'],
  [/^home\b/i, 'personal'],
  [/^finance(s)?\b|^money\b/i, 'personal'],
  [/^work\b/i, 'work'],
  [/^business\b/i, 'work'],
];
export const suggestedFor = (folder: string): Level | undefined => AREA_LEVELS.find(([re]) => re.test(folder))?.[1];

/** Words that say what a Private note is about, for the level it is offered (the person chooses). */
const ABOUT: [RegExp, Level][] = [
  [/\b(gp|doctor|dr\.?|blood|test results?|prescription|medication|medicine|symptom|diagnos|physio|dentist|hospital|health|fitness|gout|weight|calories|sleep|therapy|mental)\b/i, 'health'],
  [/\b(kids?|children|school|daughter|son|wife|husband|partner|family|birthday|mum|dad|grandparent|babysit|custody)\b/i, 'family'],
  [/\b(client|vendor|quote|contract|invoice|purchase order|po\b|staff|salary review|tender|confidential|nda)\b/i, 'work'],
];

/** A file whose name says it holds passwords or codes. */
const SECRET_FILE = /(pass\s?words?|passcodes?|logins?|credentials?|secrets?|pins?\b|licen[cs]e\s?keys?)/i;

export class SensitiveWork {
  private undo = new Map<string, { notes: { path: string; before: string; after: string }[]; secrets: string[]; at: number }>();

  constructor(private host: SensitiveHost) {}

  private get s() {
    return this.host.sensitivity;
  }

  // ── Levels ──

  levelOf(rel: unknown): LevelOfView {
    const p = typeof rel === 'string' ? rel : '';
    const l = this.s.levelOf(p);
    const store = this.s.store();
    const readers = this.rows()
      .filter((r) => r.group && accessOf(store, r.id).includes(l.level))
      .map((r) => r.label);
    return { ...l, readers };
  }

  /** A note's level is its own property (written into the note); a file's or asset's goes in the sensitivity file. */
  async setLevel(rel: unknown, level: unknown): Promise<LevelOfView> {
    await this.host.canEdit();
    const p = typeof rel === 'string' ? rel.replace(/\\/g, '/').replace(/^\/+/, '') : '';
    if (!p || isPrivatePath(p) || p.split('/').some((x) => x === '..' || x.startsWith('.'))) throw new Error('That isn’t a note or file in this vault.');
    const next = level === null ? null : readLevel(level);
    if (level !== null && !next) throw new Error('That isn’t one of the five levels.');
    const before = this.s.level(p);
    if (/\.md$/i.test(p)) {
      const text = this.host.index.content(p);
      if (text === undefined) throw new Error('That note isn’t there any more.');
      const after = changeProps(text, (doc: Document) => (next ? doc.set('sensitivity', next) : doc.delete('sensitivity')));
      if (after !== text) await this.host.writeNote(p, after);
    } else {
      await this.s.update((st) => {
        if (next) st.items[p] = next;
        else delete st.items[p];
      });
    }
    const now = this.s.level(p);
    this.s.audit({ who: 'you', whoName: 'You', action: 'level-set', item: p, level: now, detail: `${levelLabel(before)} → ${levelLabel(now)}` });
    this.host.changed('privacy');
    return this.levelOf(p);
  }

  /** A level the person set in an open note's own words (the editor writes it): into the audit trail. */
  noted(rel: unknown, level: unknown): void {
    const p = typeof rel === 'string' ? rel.slice(0, 600) : '';
    if (!p || isPrivatePath(p)) return;
    const next = readLevel(level);
    this.s.audit({ who: 'you', whoName: 'You', action: 'level-set', item: p, ...(next ? { level: next } : {}), detail: next ? `marked ${levelLabel(next)}` : 'back to what its folder says' });
  }

  async setFolder(folder: unknown, level: unknown): Promise<PrivacyState> {
    await this.host.canEdit();
    const f = typeof folder === 'string' ? folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
    if (!f || isPrivatePath(f) || f.split('/').some((x) => x === '..' || x.startsWith('.'))) throw new Error('That isn’t a folder in this vault.');
    const next = level === null ? null : readLevel(level);
    await this.s.update((st) => {
      if (next) st.folders[f] = next;
      else delete st.folders[f];
    });
    this.s.audit({ who: 'you', whoName: 'You', action: 'level-set', item: `${f}/`, ...(next ? { level: next } : {}), detail: next ? `Everything in ${f} without its own level is ${levelLabel(next)}` : `${f} no longer has a default` });
    this.host.changed('privacy');
    return this.state();
  }

  async setType(type: unknown, level: unknown): Promise<PrivacyState> {
    await this.host.canEdit();
    const t = typeof type === 'string' ? type.trim().toLowerCase() : '';
    if (!t) throw new Error('That isn’t a note type.');
    const next = level === null ? null : readLevel(level);
    await this.s.update((st) => {
      if (next) st.types[t] = next;
      else delete st.types[t];
    });
    this.s.audit({ who: 'you', whoName: 'You', action: 'level-set', item: `Type: ${t}`, ...(next ? { level: next } : {}) });
    this.host.changed('privacy');
    return this.state();
  }

  /** An agent's levels (null: it follows its group again). Open is always among them. */
  async setAccess(who: unknown, levels: unknown): Promise<PrivacyState> {
    await this.host.canEdit();
    const id = typeof who === 'string' ? who.trim() : '';
    if (!id || !this.rows().some((r) => r.id === id)) throw new Error('That agent isn’t one Ironleaf knows.');
    const list = levels === null ? null : Array.isArray(levels) ? LEVEL_IDS.filter((l) => l === 'open' || levels.includes(l)) : null;
    const before = accessOf(this.s.store(), id);
    await this.s.update((st) => {
      if (list) st.access[id] = list;
      else delete st.access[id];
    });
    const after = accessOf(this.s.store(), id);
    const name = this.rows().find((r) => r.id === id)?.label ?? id;
    const added = after.filter((l) => !before.includes(l)).map(levelLabel);
    const removed = before.filter((l) => !after.includes(l)).map(levelLabel);
    this.s.audit({ who: 'you', whoName: 'You', action: 'access-set', item: name, detail: [added.length ? `allowed ${added.join(', ')}` : '', removed.length ? `took away ${removed.join(', ')}` : '', list ? '' : 'follows its group again'].filter(Boolean).join('; ') || 'no change' });
    this.host.changed('privacy');
    return this.state();
  }

  async setPhotos(rule: unknown): Promise<PrivacyState> {
    await this.host.canEdit();
    await this.s.update((st) => {
      st.photos = rule === 'never' ? 'never' : 'ask';
    });
    this.host.changed('privacy');
    return this.state();
  }

  /** The former host app's bots, as the former host app lists them for Ironleaf (agents-known.json in Ironleaf's
data). */
  private bots(): { id: string; name: string }[] {
    try {
      const v = JSON.parse(readFileSync(path.join(this.host.dataDir, 'agents-known.json'), 'utf8')) as { bots?: { id?: unknown; name?: unknown; main?: unknown }[] };
      return (Array.isArray(v.bots) ? v.bots : []).filter((b) => typeof b.id === 'string' && typeof b.name === 'string' && b.main !== true).map((b) => ({ id: String(b.id), name: String(b.name).slice(0, 60) })).slice(0, 40);
    } catch {
      return [];
    }
  }

  /** Every agent's row: the four groups, each bot under a chat bot and each outside agent under Outside agents. */
  rows(): AgentRow[] {
    const store = this.s.store();
    const row = (id: AgentId, label: string, words: string, group: boolean): AgentRow => {
      const parent = parentOf(id) ?? undefined;
      return { id, label, words, levels: accessOf(store, id), own: hasOwnRow(store, id), ...(parent ? { parent, follows: parent } : {}), group };
    };
    const out: AgentRow[] = [];
    for (const g of AGENT_GROUPS) {
      out.push(row(g.id, g.label, g.words, true));
      if (g.id === 'neuralbot') for (const b of this.bots()) out.push(row(agentKey.bot(b.id), b.name, 'One of your bots.', false));
    }
    return out;
  }

  async state(): Promise<PrivacyState> {
    const store = this.s.store();
    const counts = Object.fromEntries(LEVEL_IDS.map((l) => [l, 0])) as Record<Level, number>;
    for (const m of this.host.index.allMeta()) if (!isPrivatePath(m.path)) counts[this.s.level(m.path)]++;
    for (const f of await this.host.files().catch(() => [] as string[])) if (!/\.md$/i.test(f) && !isPrivatePath(f)) counts[this.s.level(f)]++;
    const tops = new Map<string, number>();
    for (const m of this.host.index.allMeta()) {
      const parts = m.path.split('/');
      if (parts.length > 1 && !isPrivatePath(m.path)) tops.set(parts[0], (tops.get(parts[0]) ?? 0) + 1);
    }
    for (const f of Object.keys(store.folders)) if (!tops.has(f)) tops.set(f, 0);
    const folders: FolderRow[] = [...tops].map(([folder, notes]) => ({ folder, notes, level: store.folders[folder] ?? null, ...(suggestedFor(folder) ? { suggested: suggestedFor(folder) } : {}) })).sort((a, b) => a.folder.localeCompare(b.folder));
    const types: TypeRow[] = (await this.host.noteTypes().catch(() => [])).map((t) => ({ id: t.id, name: t.name, level: store.types[t.id.toLowerCase()] ?? null }));
    const ps = await this.host.privateNotes.status();
    return { rows: this.rows(), folders, types, photos: store.photos, counts, privateNotes: { exists: ps.exists, unlocked: ps.unlocked, count: ps.count, ...(store.migrated ? { migrated: store.migrated } : {}) } };
  }

  // ── Secrets ──

  async secretsStatus(): Promise<SecretsStatus> {
    const ps = await this.host.privateNotes.status();
    return { exists: ps.exists, unlocked: ps.unlocked, hello: ps.hello, thisPc: ps.thisPc, count: ps.unlocked ? await this.host.secrets.count() : 0 };
  }

  async listSecrets() {
    return (await this.secretsStatus()).unlocked ? this.host.secrets.list() : [];
  }

  async addSecret(input: SecretInput) {
    await this.host.canEdit();
    const v = await this.host.secrets.add(input ?? {});
    this.s.audit({ who: 'you', whoName: 'You', action: 'secret-added', item: `Secret: ${v.name}` });
    this.host.changed('secrets');
    return v;
  }

  async updateSecret(id: unknown, patch: SecretInput) {
    await this.host.canEdit();
    const v = await this.host.secrets.update(id, patch ?? {});
    this.s.audit({ who: 'you', whoName: 'You', action: 'secret-changed', item: `Secret: ${v.name}`, ...(patch?.value !== undefined ? { detail: 'its value changed' } : {}) });
    this.host.changed('secrets');
    return v;
  }

  async removeSecret(id: unknown) {
    await this.host.canEdit();
    const v = await this.host.secrets.remove(id);
    if (v) this.s.audit({ who: 'you', whoName: 'You', action: 'secret-removed', item: `Secret: ${v.name}`, detail: 'to the Bin, still sealed' });
    this.host.changed('secrets');
  }

  async revealSecret(id: unknown): Promise<string> {
    const r = await this.host.secrets.reveal(id);
    this.s.audit({ who: 'you', whoName: 'You', action: 'revealed', item: `Secret: ${r.name}` });
    return r.value;
  }

  async copySecret(id: unknown): Promise<{ seconds: number }> {
    const r = await this.host.secrets.copy(id);
    this.s.audit({ who: 'you', whoName: 'You', action: 'copied', item: `Secret: ${r.name}`, detail: `cleared from the clipboard after ${r.seconds} seconds` });
    return { seconds: r.seconds };
  }

  async copyLockedLink(id: unknown): Promise<{ seconds: number }> {
    return this.host.secrets.copyLockedLink(id);
  }

  /** The notes that link to a secret. */
  usedIn(id: unknown): { path: string; title: string }[] {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(id)) return [];
    const out: { path: string; title: string }[] = [];
    for (const m of this.host.index.allMeta()) {
      const c = this.host.index.content(m.path);
      if (c && c.includes(`secret:${id})`) && secretIdsIn(c).includes(id)) out.push({ path: m.path, title: m.label || m.title });
    }
    return out;
  }

  // ── The scanner ──

  private async findingsOf(rel: string, text: string): Promise<{ f: Finding; fp: string }[]> {
    const out: { f: Finding; fp: string }[] = [];
    for (const f of scanText(text)) out.push({ f, fp: await fingerprint(rel, f) });
    return out;
  }

  /** Every note looked through (never Private notes, never Ironleaf's own folder); values never leave. */
  async scan(): Promise<ScanReport> {
    const ignored = new Set(this.s.store().ignored);
    const notes: ScanNoteView[] = [];
    let scanned = 0;
    let skipped = 0;
    for (const m of this.host.index.allMeta()) {
      if (isPrivatePath(m.path) || !/\.md$/i.test(m.path)) continue;
      const text = this.host.index.content(m.path);
      if (!text) continue;
      scanned++;
      const found = await this.findingsOf(m.path, text);
      const shown = found.filter((x) => !ignored.has(x.fp));
      skipped += found.length - shown.length;
      if (!shown.length) continue;
      notes.push({
        path: m.path,
        title: m.label || m.title,
        level: this.s.level(m.path),
        findings: shown.map(({ f, fp }) => ({ fp, kind: f.kind, label: f.label, name: nameFor(f, m.title), line: f.line, context: f.context, masked: f.masked, confidence: f.confidence })),
      });
    }
    const files: ScanFileView[] = (await this.host.files().catch(() => [] as string[]))
      .filter((f) => !/\.md$/i.test(f) && !isPrivatePath(f) && SECRET_FILE.test(f.split('/').pop() ?? ''))
      .map((f) => ({ path: f, name: f.split('/').pop() ?? f, level: this.s.level(f), why: 'Its name says it holds passwords or codes. A file can’t be changed here: give it a level, or keep its contents in Secrets and delete it.' }));
    notes.sort((a, b) => b.findings.length - a.findings.length || a.path.localeCompare(b.path));
    return { at: Date.now(), scanned, notes, files, ignored: skipped };
  }

  /** The findings asked for, moved into Secrets with locked links left in their place (one Undo for all of them). */
  async move(items: unknown): Promise<MoveResult> {
    await this.host.canEdit();
    const list = (Array.isArray(items) ? items : []).filter((x): x is { path: string; fp: string; name?: string } => !!x && typeof x.path === 'string' && typeof x.fp === 'string').slice(0, 2000);
    if (!list.length) return { moved: 0, notes: 0, skipped: [], undoId: null };
    if (!(await this.secretsStatus()).unlocked) throw new Error('Open Locked first: the values go into the locked store.');
    const byNote = new Map<string, { fp: string; name?: string }[]>();
    for (const it of list) byNote.set(it.path, [...(byNote.get(it.path) ?? []), { fp: it.fp, ...(typeof it.name === 'string' && it.name.trim() ? { name: it.name.trim().slice(0, 120) } : {}) }]);
    const step = { notes: [] as { path: string; before: string; after: string }[], secrets: [] as string[], at: Date.now() };
    const skipped: string[] = [];
    let moved = 0;
    for (const [rel, wanted] of byNote) {
      const before = this.host.index.content(rel);
      if (before === undefined) {
        skipped.push(`${titleOf(rel)} isn’t there any more.`);
        continue;
      }
      const found = await this.findingsOf(rel, before);
      const swaps: { start: number; end: number; id: string }[] = [];
      for (const w of wanted) {
        const hit = found.find((x) => x.fp === w.fp);
        if (!hit) {
          skipped.push(`${titleOf(rel)} changed since the scan, so one finding there was left as it is.`);
          continue;
        }
        const value = before.slice(hit.f.start, hit.f.end);
        const v = await this.host.secrets.add({ name: w.name ?? nameFor(hit.f, titleOf(rel)), kind: hit.f.kind, value, from: rel });
        step.secrets.push(v.id);
        swaps.push({ start: hit.f.start, end: hit.f.end, id: v.id });
        this.s.audit({ who: 'you', whoName: 'You', action: 'moved-to-secrets', item: `Secret: ${v.name}`, level: this.s.level(rel), detail: `from ${rel}` });
        moved++;
      }
      if (!swaps.length) continue;
      const after = lockFindings(before, swaps);
      await this.host.writeNote(rel, after);
      step.notes.push({ path: rel, before, after });
    }
    const undoId = step.notes.length ? randomBytes(8).toString('hex') : null;
    if (undoId) this.undo.set(undoId, step);
    this.host.changed('secrets');
    return { moved, notes: step.notes.length, skipped: [...new Set(skipped)], undoId };
  }

  /** A move taken back: each note as it was (when it hasn’t changed since), and the secrets it made taken back. */
  async undoMove(id: unknown): Promise<string> {
    await this.host.canEdit();
    const step = typeof id === 'string' ? this.undo.get(id) : undefined;
    if (!step) return 'There is nothing to undo for that now.';
    this.undo.delete(id as string);
    let back = 0;
    const left: string[] = [];
    for (const n of step.notes) {
      if (this.host.index.content(n.path) !== n.after) {
        left.push(titleOf(n.path));
        continue;
      }
      await this.host.writeNote(n.path, n.before);
      back++;
    }
    // A secret a note still links to (one left because it changed) stays.
    const stillUsed = new Set(step.notes.filter((n) => left.includes(titleOf(n.path))).flatMap((n) => secretIdsIn(n.after)));
    for (const sid of step.secrets) if (!stillUsed.has(sid)) await this.host.secrets.discard(sid);
    this.host.changed('secrets');
    return left.length ? `Put back ${back} ${back === 1 ? 'note' : 'notes'}. ${left.join(', ')} changed since, so ${left.length === 1 ? 'it was' : 'they were'} left with the locked links.` : `Put back as it was: ${back} ${back === 1 ? 'note' : 'notes'}.`;
  }

  async ignore(fp: unknown, on = true): Promise<void> {
    if (typeof fp !== 'string' || !/^[a-f0-9]{8,64}$/.test(fp)) return;
    await this.s.update((st) => {
      st.ignored = on ? [...new Set([...st.ignored, fp])] : st.ignored.filter((x) => x !== fp);
    });
  }

  // ── Private notes into levels ──

  private suggest(text: string): Level {
    for (const [re, level] of ABOUT) if (re.test(text)) return level;
    return 'personal';
  }

  private destinationFor(rel: string, level: Level): string {
    const inside = rel.replace(new RegExp(`^${PRIVATE_DIR}/`, 'i'), '');
    const parts = inside.split('/');
    const tops = new Set(this.host.index.allMeta().map((m) => m.path.split('/')[0].toLowerCase()));
    if (parts.length > 1 && tops.has(parts[0].toLowerCase())) return inside;
    const area = level === 'health' ? 'Health' : level === 'family' ? 'Family' : level === 'work' ? 'Work' : level === 'open' ? 'Notes' : 'Me';
    const existing = [...new Set(this.host.index.allMeta().map((m) => m.path.split('/')[0]))].find((t) => t.toLowerCase() === area.toLowerCase() || suggestedFor(t) === level);
    return `${existing ?? area}/${inside}`;
  }

  async migrationPlan(): Promise<MigrationNote[]> {
    const ps = await this.host.privateNotes.status();
    if (!ps.exists) return [];
    if (!ps.unlocked) throw new Error('Open Locked first: it can only be read while open.');
    return this.host.privateNotes.list().map((e) => {
      const text = this.host.privateNotes.read(e.path);
      const suggested = this.suggest(`${e.path}\n${text}`);
      return { path: e.path, title: titleOf(e.path), size: e.size, suggested, destination: this.destinationFor(e.path, suggested), secrets: scanText(text).length };
    });
  }

  /**
   * Each Private note the person chose to move: its secrets into Secrets first (locked links left in their place), then
   * written into the vault with its level, read back to check every word arrived, and only then the encrypted note to the
   * Bin (still sealed). A note kept stays a Private note. Nothing is lost: a note that can't be written or read
   * back as written stays where it was.
   */
  async migrate(choices: unknown): Promise<MigrationResult> {
    await this.host.canEdit();
    const list = (Array.isArray(choices) ? choices : []).filter((c): c is MigrationChoice => !!c && typeof c.path === 'string');
    const result: MigrationResult = { moved: 0, kept: 0, secrets: 0, problems: [], placed: [] };
    if (!(await this.host.privateNotes.status()).unlocked) throw new Error('Open Locked first.');
    for (const c of list) {
      if (c.keep) {
        result.kept++;
        continue;
      }
      const level = readLevel(c.level) ?? 'personal';
      let text: string;
      try {
        text = this.host.privateNotes.read(c.path);
      } catch {
        result.problems.push(`${titleOf(c.path)} couldn’t be read, so it stays a Private note.`);
        continue;
      }
      try {
        // Its secrets first.
        const found = scanText(text);
        const swaps: { start: number; end: number; id: string }[] = [];
        for (const f of found) {
          const v = await this.host.secrets.add({ name: nameFor(f, titleOf(c.path)), kind: f.kind, value: text.slice(f.start, f.end), from: c.path });
          swaps.push({ start: f.start, end: f.end, id: v.id });
          result.secrets++;
        }
        const locked = lockFindings(text, swaps);
        const body = changeProps(locked, (doc: Document) => doc.set('sensitivity', level));
        let dest = (typeof c.destination === 'string' && c.destination.trim() ? c.destination.trim() : this.destinationFor(c.path, level)).replace(/\\/g, '/').replace(/^\/+/, '');
        if (!/\.md$/i.test(dest)) dest += '.md';
        if (isPrivatePath(dest) || dest.split('/').some((x) => !x.trim() || x === '..' || x.startsWith('.'))) throw new Error('That place isn’t in the vault.');
        for (let i = 2; await this.host.exists(dest); i++) dest = dest.replace(/(?: \(from Private notes(?: \d+)?\))?\.md$/i, ` (from Private notes${i > 2 ? ` ${i - 1}` : ''}).md`);
        await this.host.writeNote(dest, body);
        const back = this.host.index.content(dest);
        if (back !== body) throw new Error('it didn’t read back exactly as written');
        // Only now the sealed original goes to the Bin; if it can't, the note is in both places and says so.
        await this.host.privateNotes.remove(c.path).catch((err) => result.problems.push(`${titleOf(c.path)} is now in ${dest}, but its sealed copy is still in Private notes (it couldn’t go to the Bin: ${err instanceof Error ? err.message : String(err)}). Delete it there when you’re ready.`));
        this.s.audit({ who: 'you', whoName: 'You', action: 'level-set', item: dest, level, detail: `moved out of Private notes (${c.path})${swaps.length ? `; ${swaps.length} secret${swaps.length === 1 ? '' : 's'} into Secrets` : ''}` });
        result.moved++;
        result.placed.push({ from: c.path, to: dest, level });
      } catch (err) {
        result.problems.push(`${titleOf(c.path)} stays a Private note: ${err instanceof Error ? err.message : String(err)}.`);
      }
    }
    if (result.moved) await this.s.update((st) => (st.migrated = { at: new Date().toISOString(), notes: (st.migrated?.notes ?? 0) + result.moved }));
    this.host.changed('privacy');
    this.host.changed('secrets');
    return result;
  }
}

/** The window's requests (each answers Ironleaf's own window only: src/main/app.ts handle). */
export function registerSensitive(handle: (channel: string, fn: (...args: any[]) => unknown) => void, w: SensitiveWork, s: Sensitivity): void {
  handle('privacy:state', () => w.state());
  handle('privacy:level-of', (rel: unknown) => w.levelOf(rel));
  handle('privacy:set-level', (rel: unknown, level: unknown) => w.setLevel(rel, level));
  handle('privacy:noted', (rel: unknown, level: unknown) => w.noted(rel, level));
  handle('privacy:set-folder', (folder: unknown, level: unknown) => w.setFolder(folder, level));
  handle('privacy:set-type', (type: unknown, level: unknown) => w.setType(type, level));
  handle('privacy:set-access', (who: unknown, levels: unknown) => w.setAccess(who, levels));
  handle('privacy:set-photos', (rule: unknown) => w.setPhotos(rule));
  handle('privacy:store', () => s.store());
  handle('secrets:status', () => w.secretsStatus());
  handle('secrets:list', () => w.listSecrets());
  handle('secrets:add', (input: SecretInput) => w.addSecret(input));
  handle('secrets:update', (id: unknown, patch: SecretInput) => w.updateSecret(id, patch));
  handle('secrets:remove', (id: unknown) => w.removeSecret(id));
  handle('secrets:reveal', (id: unknown) => w.revealSecret(id));
  handle('secrets:copy', (id: unknown) => w.copySecret(id));
  handle('secrets:copy-link', (id: unknown) => w.copyLockedLink(id));
  handle('secrets:used-in', (id: unknown) => w.usedIn(id));
  handle('scan:run', () => w.scan());
  handle('scan:move', (items: unknown) => w.move(items));
  handle('scan:undo', (id: unknown) => w.undoMove(id));
  handle('scan:ignore', (fp: unknown, on: unknown) => w.ignore(fp, on !== false));
  handle('audit:list', async (months: unknown) => s.trail({ months: typeof months === 'number' ? months : 12 }));
  handle('audit:exported', (where: unknown) => s.audit({ who: 'you', whoName: 'You', action: 'exported', item: typeof where === 'string' ? where.slice(0, 300) : 'the audit trail' }));
  handle('migrate:plan', () => w.migrationPlan());
  handle('migrate:run', (choices: unknown) => w.migrate(choices));
}
