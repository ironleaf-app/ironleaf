// Systems and Home Lab on the main side (Wave 7 part b; src/shared/systems.ts). Machines, services and runbooks live
// as rows in the three lists (src/shared/system-tables.ts) and open as normal pages from their rows; a record typed
// into (words in the notes area, an edited step, or a recorded run) becomes a note file of its own, its row keeping
// a pointer to it. Plain fixes (a corrected address, a status) stay in the row. A value changed is one property or
// one cell, a health note or a run one row of its table, a step one line of its list. Logins are only ever linked:
// the window keeps the value in Secrets first and this side writes the locked link. A password written in a note by
// hand is counted by the secret scanner (src/shared/secret-scan.ts) so the page can offer to move it. The bell is
// told when something is down and when a runbook comes due, each once.

import { partOn } from '../../shared/life-modules';
import { MACHINE_KINDS, MACHINE_STATUSES, RUN_RESULTS, RUNBOOK_EVERY, SERVICE_KINDS, SERVICE_STATUSES } from '../../shared/life-records';
import { dayWords, knownWord, propValue, readDay, str, tableWithRow, type PropSpec } from '../../shared/personal-records';
import { fingerprint, nameFor, scanText } from '../../shared/secret-scan';
import {
  actionPlan,
  alertsOf,
  answerSystemTool,
  findRunbook,
  findSystem,
  HEALTH_LOG,
  newRunbookText,
  PROBE,
  probeWords,
  readProbe,
  runbooksFromCheck,
  RUNS,
  shouldKeepCheck,
  systemsModel,
  withCredential,
  withoutCredential,
  withSteps,
  type SystemsModel,
} from '../../shared/systems';
import { loginsCellOf, loginsOfCell, PATTERN_WORDS, patternForName, readSystemsTable, renderSystemsTable, rowPathIn, splitRowPath, type SystemsTableKind } from '../../shared/system-tables';
import { setNoteProp } from '../../shared/views';
import type { VaultIndex } from '../indexer';
import type { WorkModules, WorkNotice, WorkPart } from '../work-modules';
import { itemWords, namedIn, remindDaysOption, type PersonalPart } from '../personal/common';
import { runProbe } from './system-probe';
import { agentChange, kindOfNote, notesOf, O, refusedCount, removeRow, S, setProp, titleOf, type LifeNote } from './common';
import { addTableRow, dropTableRows, promoteToNote, readTable, resolveRowTarget, resolveTableConflict, rowByPath, rowNoteText, rowsAsNotes, searchTableRows, tableRelFor, writeTable, type TableRead } from './system-tables';
import { deferMove, moveState, planMove, previewWords, resumeMove, runMove, undoMove } from './system-move';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

export interface FoundService { name: string; kind: string; port: string }
export interface FoundRunbook { name: string; template: string; for: string; members?: string[] }
export interface FoundGroup { machinePath: string; machineName: string; services: FoundService[]; runbooks: FoundRunbook[] }
export interface SystemsConflict { kind: SystemsTableKind; name: string; path: string; kept: Record<string, string>; keptNote: string | null; others: { name: string; cells: Record<string, string>; note: string | null }[] }
export type SystemsView = SystemsModel & { folder: string; found: FoundGroup[]; tablesClash: string[]; conflicts: SystemsConflict[]; move: Awaited<ReturnType<typeof moveState>> };

const TYPES = ['machine', 'service', 'runbook'];

const PROPS: Record<string, Record<string, PropSpec>> = {
  machine: {
    machine_kind: { field: 'machine_kind', key: 'kind', kind: 'choice', label: 'Kind', options: MACHINE_KINDS },
    role: { field: 'role', key: 'role', kind: 'text', label: 'Role' },
    os: { field: 'os', key: 'os', kind: 'text', label: 'System' },
    address: { field: 'address', key: 'address', kind: 'text', label: 'Address' },
    location: { field: 'location', key: 'location', kind: 'text', label: 'Where it is' },
    status: { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: MACHINE_STATUSES },
    checked: { field: 'checked', key: 'checked', kind: 'date', label: 'Last checked' },
  },
  service: {
    service_kind: { field: 'service_kind', key: 'kind', kind: 'choice', label: 'Kind', options: SERVICE_KINDS },
    runs_on: { field: 'runs_on', key: 'runs_on', kind: 'link', label: 'Runs on' },
    url: { field: 'url', key: 'url', kind: 'url', label: 'Address' },
    port: { field: 'port', key: 'port', kind: 'text', label: 'Port' },
    status: { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: SERVICE_STATUSES },
    depends_on: { field: 'depends_on', key: 'depends_on', kind: 'links', label: 'Depends on' },
    runbook: { field: 'runbook', key: 'runbook', kind: 'link', label: 'Runbook' },
    checked: { field: 'checked', key: 'checked', kind: 'date', label: 'Last checked' },
  },
  runbook: {
    for_what: { field: 'for_what', key: 'for', kind: 'links', label: 'For' },
    every: { field: 'every', key: 'every', kind: 'choice', label: 'How often', options: RUNBOOK_EVERY },
    last_run: { field: 'last_run', key: 'last_run', kind: 'date', label: 'Last run' },
  },
};
/** A property's cell in its list (most read the same; links and dates read shorter). */
const CELL_OF: Record<string, string> = { runs_on: 'runsOn', depends_on: 'dependsOn', last_run: 'lastRun' };
const cellKey = (key: string): string => CELL_OF[key] ?? key;

const FOUND_FILE = '.neuralvault/systems-found.json';
type FoundStore = Record<string, { services: FoundService[]; runbooks: FoundRunbook[]; dismissed: string[] }>;
const cleanFound = (v: unknown): FoundStore => {
  const out: FoundStore = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, e] of Object.entries((v as Record<string, unknown>).machines && typeof (v as Record<string, unknown>).machines === 'object' ? ((v as Record<string, unknown>).machines as Record<string, unknown>) : {}).slice(0, 200)) {
    if (!k || !e || typeof e !== 'object' || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    const svcs = Array.isArray(r.services) ? r.services.slice(0, 40).map((s) => s && typeof s === 'object' ? { name: String((s as Record<string, unknown>).name ?? '').slice(0, 100), kind: String((s as Record<string, unknown>).kind ?? '').slice(0, 40), port: String((s as Record<string, unknown>).port ?? '').slice(0, 20) } : null).filter((s): s is FoundService => !!s && !!s.name) : [];
    const rbs = Array.isArray(r.runbooks) ? r.runbooks.slice(0, 12).map((x) => x && typeof x === 'object' ? { name: String((x as Record<string, unknown>).name ?? '').slice(0, 100), template: String((x as Record<string, unknown>).template ?? '').slice(0, 40), for: String((x as Record<string, unknown>).for ?? '').slice(0, 100), ...((x as Record<string, unknown>).members !== undefined ? { members: (Array.isArray((x as Record<string, unknown>).members) ? (x as Record<string, unknown>).members as unknown[] : []).filter((m): m is string => typeof m === 'string').slice(0, 40) } : {}) } : null).filter((x): x is FoundRunbook => !!x && !!x.name) : [];
    const dismissed = Array.isArray(r.dismissed) ? [...new Set(r.dismissed.filter((d): d is string => typeof d === 'string').map((d) => d.toLowerCase().slice(0, 100)))].slice(0, 80) : [];
    if (svcs.length || rbs.length || dismissed.length) out[k.slice(0, 500)] = { services: svcs, runbooks: rbs, dismissed };
  }
  return out;
};

export function makeSystems(w: WorkModules): PersonalPart {
  // The probe, or the tests' own (systems-quiet.test.mjs): the same output, no SSH.
  const probeOf = async (address: string, login: { username: string; value: string }): Promise<string> => ((w.d as unknown as { probe?: (address: string, login: { username: string; value: string }, script: string, dataDir: string) => Promise<string> }).probe ? (w.d as unknown as { probe: (address: string, login: { username: string; value: string }, script: string, dataDir: string) => Promise<string> }).probe(address, login, PROBE, w.d.dataDir ?? '') : runProbe(address, login, PROBE, w.d.dataDir ?? ''));
  // What the beat found but never made (5 Nov 2026): new services and runbooks held quietly per machine, and the ones
  // put away with Not now so the next beat does not nag. In the vault, so every PC shows the same; a missing or
  // unreadable file is no list, never an error.
  const readFound = async (): Promise<FoundStore> => {
    try {
      return cleanFound(JSON.parse(await fsp.readFile(path.join(w.d.vault().root, ...FOUND_FILE.split('/')), 'utf8')));
    } catch {
      return {};
    }
  };
  const writeFound = async (store: FoundStore): Promise<void> => {
    await w.d.requireCreate();
    const file = path.join(w.d.vault().root, ...FOUND_FILE.split('/'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, `${JSON.stringify({ version: 1, machines: store })}\n`, 'utf8');
  };
  /** Passwords and keys written by hand in a machine's or service's note (counted only). */
  const plainOf = (notes: LifeNote[]) => Object.fromEntries(notes.filter((n) => n.type !== 'runbook').map((n) => [n.path, scanText(n.content).length]));
  /** The tables now (a person's note sitting on a list's name reads as no list here; the page says why). */
  const tablesOf = async (): Promise<{ docs: Record<SystemsTableKind, TableRead['doc']>; rels: Record<SystemsTableKind, string>; clash: string[] }> => {
    const docs = {} as Record<SystemsTableKind, TableRead['doc']>;
    const rels = {} as Record<SystemsTableKind, string>;
    const clash: string[] = [];
    for (const kind of TYPES as SystemsTableKind[]) {
      try {
        const read = await readTable(w, kind);
        docs[kind] = read.doc;
        rels[kind] = read.rel;
      } catch {
        docs[kind] = readSystemsTable(renderSystemsTable(kind, { rows: [] }));
        rels[kind] = await tableRelFor(w, kind);
        clash.push(rels[kind]);
      }
    }
    return { docs, rels, clash };
  };
  const model = async (index: VaultIndex = w.d.index, gate: { allowsLevel(level: string): boolean } | null = null): Promise<SystemsModel> => {
    const notes = await notesOf(w, index, TYPES);
    const { docs, rels } = await tablesOf();
    // Rows read with the notes down the one path (an agent gated below the Systems level reads none).
    const extra = !gate || gate.allowsLevel('personal') ? rowsAsNotes(docs, rels, notes, (rel) => index.get(rel) !== undefined).notes : [];
    const m = systemsModel([...notes, ...extra], w.today(), { remindDays: await w.remindDays('systems'), plain: plainOf(notes) });
    // A note its row points at keeps the row's path, so a page opened from the row finds it.
    const byNote = new Map<string, string>();
    for (const kind of TYPES as SystemsTableKind[]) for (const row of docs[kind].rows) if (row.note) byNote.set(row.note, rowPathIn(docs[kind].rows, rels[kind], row.name));
    for (const x of [...m.machines, ...m.services, ...m.runbooks]) {
      const rp = byNote.get(x.path);
      if (rp) x.rowPath = rp;
    }
    return m;
  };

  const kinds = { machine: 'machine', service: 'service', runbook: 'runbook' };
  const kindErr = 'That isn’t a machine, service or runbook.';
  /** A record's kind from its note or its row path (a row path carries its kind with it). */
  const kindOf = (rel: string): string => splitRowPath(rel)?.kind ?? kindOfNote(w, rel, kinds, kindErr);

  const addRecord = async (kind: 'machine' | 'service' | 'runbook', input: unknown): Promise<string> => {
    const o = O(input);
    const name = S(o.name, 100);
    if (!name) throw new Error(`A ${kind} needs a name.`);
    const m = await model();
    const taken = [...m.machines, ...m.services, ...m.runbooks].find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new Error(`There’s already something called ${name} in Systems.`);
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => S(x, 100)).filter(Boolean) : S(v, 400).split(/\s*[,;]\s*/).filter(Boolean));
    // Facts go in the lists; only typed steps make a runbook a note straight away (they are writing).
    if (kind === 'runbook') {
      const steps = list(o.steps).length ? (Array.isArray(o.steps) ? (o.steps as unknown[]).map((x) => S(x, 500)) : S(o.steps, 4000).split(/\r?\n/)).filter(Boolean) : [];
      if (steps.length) return w.newNote(await w.folderOf(kind), name, newRunbookText({ for: list(o.for), every: S(o.every, 20), steps }));
      return addTableRow(w, kind, { name, cells: { for: list(o.for).map((x) => `[[${x}]]`).join(', '), every: knownWord(RUNBOOK_EVERY, o.every) || 'On demand', lastRun: '', pattern: '' }, note: null });
    }
    if (kind === 'machine') return addTableRow(w, kind, { name, cells: { kind: knownWord(MACHINE_KINDS, o.kind) || 'Server', role: S(o.role, 120), os: S(o.os, 80), address: S(o.address, 120), location: S(o.location, 80), status: knownWord(MACHINE_STATUSES, o.status) || '', checked: '', logins: '' }, note: null });
    return addTableRow(w, kind, { name, cells: { kind: knownWord(SERVICE_KINDS, o.kind) || 'Web app', runsOn: S(o.runs_on, 100) ? `[[${S(o.runs_on, 100).replace(/^\[\[|\]\]$/g, '')}]]` : '', url: S(o.url, 300), port: S(o.port, 20), status: knownWord(SERVICE_STATUSES, o.status) || 'Up', dependsOn: list(o.depends_on).map((x) => `[[${x}]]`).join(', '), runbook: '', checked: '', logins: '' }, note: null });
  };

  /** One cell changed in a row (checked the same way as the note's property). */
  const setCell = async (kind: SystemsTableKind, name: string, key: string, value: string): Promise<void> => {
    const { doc } = await readTable(w, kind);
    const row = doc.rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!row) throw new Error('That record isn’t in the list any more.');
    const rows = doc.rows.map((r) => (r === row ? { ...r, cells: { ...r.cells, [key]: value } } : r));
    await writeTable(w, kind, { ...doc, rows });
  };

  const setField = async (input: unknown): Promise<string | null> => {
    const o = O(input);
    const rel = S(o.path, 1000);
    const row = splitRowPath(rel);
    const kind = S(o.kind, 20) || kindOf(rel);
    if (row && kind !== row.kind) throw new Error(kindErr);
    const p = PROPS[kind]?.[S(o.field, 40)];
    if (!p) throw new Error('That can’t be changed here.');
    if (row) {
      const hit = await rowByPath(w, rel);
      if (!hit) throw new Error('That record isn’t in the list any more.');
      const v = propValue(p, o.value === null ? '' : o.value);
      await setCell(row.kind, hit.row.name, cellKey(p.key), v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v));
    } else {
      kindOfNote(w, rel, kinds, kindErr);
      await setProp(w, rel, p, o.value === null ? '' : o.value);
    }
    if (p.key === 'status' && /^(down|degraded)$/i.test(S(o.value))) return `${titleOf(rel)} is marked ${S(o.value).toLowerCase()}. Add a health note to say what happened.`;
    return null;
  };

  const healthNoteToNote = async (r: string, date: string, status: string, note: string): Promise<void> => {
    await w.change(r, (text) => {
      let t = tableWithRow(text, HEALTH_LOG, { date, status, note });
      if (status) t = setNoteProp(t, 'status', status);
      return setNoteProp(t, 'checked', date);
    });
  };

  const healthNote = async (rel: unknown, input: unknown): Promise<string> => {
    const r = S(rel, 1000);
    const row = splitRowPath(r);
    const kind = kindOf(r);
    if (kind === 'runbook') throw new Error('A runbook keeps runs, not health notes.');
    const o = O(input);
    const note = S(o.note, 500);
    const status = S(o.status, 20) ? knownWord(kind === 'machine' ? MACHINE_STATUSES : SERVICE_STATUSES, o.status) : '';
    if (!note && !status) throw new Error('Say what you saw, or choose a status.');
    const date = readDay(S(o.date, 20)) ?? w.todayIso();
    if (row) {
      const hit = await rowByPath(w, r);
      if (!hit) throw new Error('That record isn’t in the list any more.');
      // Words make it a note of its own; a bare status stays in the row.
      if (note) {
        const made = await promoteToNote(w, row.kind, hit.row.name);
        await healthNoteToNote(made, date, status, note);
        return `Noted ${titleOf(made)}’s health${status ? `: ${status.toLowerCase()}` : ''}. It is a note of its own now.`;
      }
      const { doc } = await readTable(w, row.kind);
      const key = hit.row.name.toLowerCase();
      const logs = { ...doc.logs, [key]: [...(doc.logs[key] ?? []), { date, status, note }] };
      const rows = doc.rows.map((x) => (x.name.toLowerCase() === key ? { ...x, cells: { ...x.cells, ...(status ? { status } : {}), checked: date } } : x));
      await writeTable(w, row.kind, { ...doc, rows, logs });
      return `Noted ${hit.row.name}’s health${status ? `: ${status.toLowerCase()}` : ''}.`;
    }
    await healthNoteToNote(r, date, status, note);
    return `Noted ${titleOf(r)}’s health${status ? `: ${status.toLowerCase()}` : ''}.`;
  };

  const markRunToNote = async (r: string, date: string, result: string, note: string): Promise<void> => {
    await w.change(r, (text) => setNoteProp(tableWithRow(text, RUNS, { date, result, note: S(note, 500) }), 'last_run', date));
  };

  const markRun = async (rel: unknown, input: unknown): Promise<string> => {
    const r = S(rel, 1000);
    if (kindOf(r) !== 'runbook') throw new Error('Only a runbook is run.');
    const o = O(input);
    const date = readDay(S(o.date, 20)) ?? w.todayIso();
    if (date > w.todayIso()) throw new Error('A run can’t be on a day still to come.');
    const result = knownWord(RUN_RESULTS, o.result) || 'Done';
    const row = splitRowPath(r);
    if (row) {
      // A recorded run is writing: the runbook becomes a note of its own first.
      const hit = await rowByPath(w, r);
      if (!hit) throw new Error('That record isn’t in the list any more.');
      const made = await promoteToNote(w, row.kind, hit.row.name);
      await markRunToNote(made, date, result, S(o.note, 500));
      return `${titleOf(made)}: ${result.toLowerCase()} ${date === w.todayIso() ? 'today' : `on ${dayWords(date, w.todayIso())}`}. It is a note of its own now.`;
    }
    await markRunToNote(r, date, result, S(o.note, 500));
    return `${titleOf(r)}: ${result.toLowerCase()} ${date === w.todayIso() ? 'today' : `on ${dayWords(date, w.todayIso())}`}.`;
  };

  /** The passwords and keys a note has written in it, for the move into Secrets (masked; never the value). */
  const findings = async (rel: unknown) => {
    const r = S(rel, 1000);
    if (splitRowPath(r)) return [];
    const text = w.noteText(r);
    const out: { fp: string; label: string; kind: string; masked: string; name: string }[] = [];
    for (const f of scanText(text)) out.push({ fp: await fingerprint(r, f), label: f.label, kind: f.kind, masked: f.masked, name: nameFor(f, titleOf(r)) });
    return out;
  };

  /** The runbooks a machine needs, as rows sharing the one set of steps each (30 Oct 2026); ones already there are
   *  left alone. Off with the Runbooks part (5 Nov 2026): nothing written anywhere while it is off. */
  const ensureRunbooks = async (machineName: string, os: string, services: { name: string; kind: string }[]): Promise<{ made: number; created: string[] }> => {
    if (!w.part('systems', 'runbooks')) return { made: 0, created: [] };
    const m = await model();
    const created: string[] = [];
    const restarts = services.slice(0, 20);
    for (const rb of runbooksFromCheck(machineName, os, services)) {
      if (m.runbooks.some((r) => r.name.toLowerCase() === rb.name.toLowerCase())) continue;
      const id = patternForName(rb.name);
      const members = id === 'rest' ? restarts.slice(8).map((s) => s.name) : [];
      created.push(await addTableRow(w, 'runbook', { name: rb.name, cells: { for: [rb.for, ...members].map((x) => `[[${x}]]`).join(', '), every: 'On demand', lastRun: '', pattern: id ? PATTERN_WORDS[id] : '' }, note: null }));
    }
    return { made: created.length, created };
  };

  /** A machine's facts and checks written, to its note or its row. */
  const writeMachineCheck = async (entry: { path: string }, patch: { status?: string; os?: string; checked: string; health?: { date: string; status: string; note: string } | null }): Promise<void> => {
    const row = splitRowPath(entry.path);
    if (row) {
      const hit = await rowByPath(w, entry.path);
      if (!hit) throw new Error('That record isn’t in the list any more.');
      const { doc } = await readTable(w, row.kind);
      const key = hit.row.name.toLowerCase();
      const logs = patch.health ? { ...doc.logs, [key]: [...(doc.logs[key] ?? []), { date: patch.health.date, status: patch.health.status, note: patch.health.note }] } : doc.logs;
      const rows = doc.rows.map((x) => (x.name.toLowerCase() === key ? { ...x, cells: { ...x.cells, ...(patch.status ? { status: patch.status } : {}), ...(patch.os ? { os: patch.os } : {}), checked: patch.checked } } : x));
      await writeTable(w, row.kind, { ...doc, rows, logs });
      return;
    }
    await w.change(entry.path, (text) => {
      let t = patch.health ? tableWithRow(text, HEALTH_LOG, { date: patch.health.date, status: patch.health.status, note: patch.health.note }) : text;
      if (patch.status) t = setNoteProp(t, 'status', patch.status);
      if (patch.os) t = setNoteProp(t, 'os', patch.os);
      return setNoteProp(t, 'checked', patch.checked);
    });
  };

  /** Check now: the machine read over SSH with its own linked login; its system, status and last checked set, a health line
   *  written, and what runs on it added as rows (each linked to it; one already there is left as it is). Quiet (5 Nov
   *  2026): the beat and the link-login read never create anything — new services and runbooks are held for the
   *  Systems page instead. Explicit (Check now, the assistant): a person asked, so it still creates, saying how many
   *  first when more than a few. */
  const checkMachine = async (rel: unknown, opts: { quiet?: boolean } = {}): Promise<{ message: string; created: string[] }> => {
    const r = S(rel, 1000);
    const m0 = await model();
    const entry = m0.machines.find((x) => x.path === r);
    if (!entry) throw new Error(kindErr);
    const address = entry.address;
    if (!address) throw new Error(`Add ${entry.name}’s address first.`);
    const cred = entry.credentials[0];
    if (!cred) throw new Error(`Link ${entry.name}’s login first (Logins › Link): Ironleaf signs in with it to read the machine.`);
    if (!w.d.login) throw new Error('Checking machines isn’t available here.');
    const login = await w.d.login(cred.id, address);
    const today = w.todayIso();
    let out: string;
    try {
      out = await probeOf(address, login);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      const down = /reached|refused the connection|too long|can’t be found/.test(why);
      const before = (await model()).machines.find((x) => x.path === r);
      // Change-only log (30 Oct 2026): the same failure said again today keeps no second line.
      const keep = before && shouldKeepCheck(before.health, today, down ? 'Down' : '', `Check now: ${why}`);
      await writeMachineCheck(entry, { ...(down ? { status: 'Down' } : {}), checked: today, health: keep ? { date: today, status: down ? 'Down' : '', note: `Check now: ${why}` } : null });
      throw new Error(`${entry.name}: ${why}`);
    }
    const found = readProbe(out);
    const before = (await model()).machines.find((x) => x.path === r);
    const words = probeWords(found).slice(0, 500);
    const keep = before && shouldKeepCheck(before.health, today, 'Up', words);
    await writeMachineCheck(entry, { status: 'Up', ...(found.os ? { os: found.os } : {}), checked: today, health: keep ? { date: today, status: 'Up', note: words } : null });
    const m = await model();
    const machine = entry.name;
    const details = probeWords(found).replace(/^Checked: /, '').replace(/\.$/, '');
    const known = new Set([...m.machines, ...m.services].map((x) => x.name.toLowerCase()));
    if (opts.quiet) {
      const store = await readFound();
      const key = foundKey(entry);
      const dismissed = foundEntry(store, entry)?.dismissed ?? [];
      const held = found.services.filter((s) => !known.has(s.name.toLowerCase()) && !dismissed.includes(s.name.toLowerCase())).map((s) => ({ name: s.name.slice(0, 100), kind: s.kind.slice(0, 40), port: s.port.slice(0, 20) }));
      // The runbooks it needs, held the same way (no more copies per machine).
      const forRunbooks = [...found.services, ...m.services.filter((s) => s.machinePath === r).map((s) => ({ name: s.name, kind: s.kind }))].filter((s, i, a) => a.findIndex((y) => y.name.toLowerCase() === s.name.toLowerCase()) === i);
      const heldBooks: FoundRunbook[] = !w.part('systems', 'runbooks') ? [] : runbooksFromCheck(machine, found.os, forRunbooks).filter((rb) => !m.runbooks.some((x) => x.name.toLowerCase() === rb.name.toLowerCase()) && !dismissed.includes(rb.name.toLowerCase())).map((rb) => {
        const id = patternForName(rb.name);
        return { name: rb.name.slice(0, 100), template: id ? PATTERN_WORDS[id] : '', for: rb.for.slice(0, 100), ...(id === 'rest' ? { members: forRunbooks.slice(0, 20).slice(8).map((s) => s.name).slice(0, 40) } : {}) };
      }).slice(0, 12);
      const next: FoundStore = { ...store };
      if (key !== r) delete next[r];
      if (held.length || heldBooks.length) next[key] = { services: held.slice(0, 40), runbooks: heldBooks, dismissed };
      else if (next[key]) next[key] = { services: [], runbooks: [], dismissed };
      if (held.length || heldBooks.length || store[r] || store[key]) await writeFound(next).catch(() => undefined);
      const bits = [`${machine} checked: ${details}.`];
      if (held.length || heldBooks.length) bits.push(`Found ${[held.length ? `${held.length} new service${held.length === 1 ? '' : 's'}` : '', heldBooks.length ? `${heldBooks.length} runbook${heldBooks.length === 1 ? '' : 's'} it needs` : ''].filter(Boolean).join(' and ')} on ${machine}. Add them from Systems.`);
      return { message: bits.join(' '), created: [] };
    }
    const created: string[] = [];
    for (const s of found.services) {
      if ([...m.machines, ...m.services].some((x) => x.name.toLowerCase() === s.name.toLowerCase())) continue;
      created.push(await addTableRow(w, 'service', { name: s.name, cells: { kind: s.kind, runsOn: `[[${machine}]]`, url: '', port: s.port, status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null }));
    }
    const store = await readFound();
    const held = foundEntry(store, entry);
    if (held) {
      // What the press just made leaves the held list (whatever is in the model now is made).
      const m2 = await model();
      const have = new Set([...m2.machines, ...m2.services, ...m2.runbooks].map((x) => x.name.toLowerCase()));
      const left = (held.services ?? []).filter((s) => !have.has(s.name.toLowerCase()));
      const leftBooks = (held.runbooks ?? []).filter((b) => !have.has(b.name.toLowerCase()));
      const dismissed = (held.dismissed ?? []).filter((d) => !have.has(d));
      const next: FoundStore = { ...store };
      const key = foundKey(entry);
      if (key !== r) delete next[r];
      if (left.length || leftBooks.length || dismissed.length) next[key] = { services: left, runbooks: leftBooks, dismissed };
      else {
        delete next[key];
        delete next[r];
      }
      await writeFound(next).catch(() => undefined);
    }
    const allServices = [...found.services, ...((await model()).services.filter((s) => s.machinePath === r).map((s) => ({ name: s.name, kind: s.kind })))].filter((s, i, a) => a.findIndex((y) => y.name.toLowerCase() === s.name.toLowerCase()) === i);
    const books = await ensureRunbooks(machine, found.os, allServices).catch(() => ({ made: 0, created: [] as string[] }));
    const allCreated = [...created, ...books.created];
    if (created.length + books.made > 3) return { message: `This adds ${created.length ? `${created.length} service${created.length === 1 ? '' : 's'}${books.made ? ` and ${books.made} runbook${books.made === 1 ? '' : 's'}` : ''} on ${machine}` : `${books.made} runbook${books.made === 1 ? '' : 's'} for ${machine}`}. ${machine} checked: ${details}.`, created: allCreated };
    return { message: `${machine} checked: ${details}.${created.length ? ` Added ${created.length} service${created.length === 1 ? '' : 's'} it runs.` : ''}${books.made ? ` Wrote ${books.made} runbook${books.made === 1 ? '' : 's'} it needs.` : ''}`, created: allCreated };
  };

  /** One fix on a machine, run only from the person's click in the window (30 Oct 2026): its result goes in the health log. */
  const runAction = async (rel: unknown, input: unknown): Promise<string> => {
    const r = S(rel, 1000);
    const m = await model();
    const entry = m.machines.find((x) => x.path === r);
    if (!entry) throw new Error(kindErr);
    const o = O(input);
    const plan = actionPlan(S(o.action, 40), entry.name, S(o.service, 100));
    if (!plan) throw new Error('That fix needs a service to restart, or isn’t a fix here.');
    const address = entry.address;
    if (!address) throw new Error(`Add ${entry.name}’s address first.`);
    const cred = entry.credentials[0];
    if (!cred || !w.d.login) throw new Error(`Link ${entry.name}’s login first: the fix signs in with it.`);
    const login = await w.d.login(cred.id, address);
    const today = w.todayIso();
    let words: string;
    try {
      const out = await runProbe(address, login, plan.command, w.d.dataDir ?? '');
      words = out.trim().replace(/\s+/g, ' ').slice(0, 400) || 'Done, with nothing printed.';
    } catch (e) {
      if (plan.action !== 'reboot') throw e;
      words = 'Reboot sent. Check it answers again in a few minutes.';
    }
    const line = `${plan.title}: ${words}`.slice(0, 500);
    const row = splitRowPath(r);
    if (row) {
      const hit = await rowByPath(w, r);
      if (!hit) throw new Error('That record isn’t in the list any more.');
      const { doc } = await readTable(w, row.kind);
      const key = hit.row.name.toLowerCase();
      await writeTable(w, row.kind, { ...doc, logs: { ...doc.logs, [key]: [...(doc.logs[key] ?? []), { date: today, status: '', note: line }] } });
    } else await w.change(r, (text) => tableWithRow(text, HEALTH_LOG, { date: today, status: '', note: line }));
    return `${plan.title} on ${entry.name}: ${words}`;
  };

  const checkAll = async (): Promise<string> => {
    const m = await model();
    let done = 0;
    let skipped = 0;
    for (const x of m.machines) {
      if (!x.address || !x.credentials.length || /^retired$/i.test(x.status)) { skipped++; continue; }
      try { await checkMachine(x.path, { quiet: true }); done++; } catch { skipped++; }
    }
    return done ? `Checked ${done} machine${done === 1 ? '' : 's'}${skipped ? `, ${skipped} not checked` : ''}.` : 'No machine could be checked yet. Each needs its address and a login linked from Secrets.';
  };
  let lastBeat = 0;
  // Held entries live under the machine's name (a note folded into a row keeps its held list); entries written
  // under its old note path still read.
  const foundKey = (x: { name: string }): string => x.name.toLowerCase();
  const foundEntry = (store: FoundStore, x: { path: string; name: string }): FoundStore[string] | undefined => store[x.name.toLowerCase()] ?? store[x.path];
  // The quiet list for the Systems page: what the beat held, minus anything since added or put away.
  const foundGroups = async (m: SystemsModel): Promise<FoundGroup[]> => {
    const store = await readFound();
    const out: FoundGroup[] = [];
    for (const x of m.machines) {
      const e = foundEntry(store, x);
      if (!e?.services.length && !e?.runbooks?.length) continue;
      const kept = (e.services ?? []).filter((s) => ![...m.machines, ...m.services].some((y) => y.name.toLowerCase() === s.name.toLowerCase()) && !(e.dismissed ?? []).includes(s.name.toLowerCase()));
      const keptBooks = (e.runbooks ?? []).filter((b) => !m.runbooks.some((y) => y.name.toLowerCase() === b.name.toLowerCase()) && !(e.dismissed ?? []).includes(b.name.toLowerCase()));
      if (kept.length || keptBooks.length) out.push({ machinePath: x.path, machineName: x.name, services: kept, runbooks: keptBooks });
    }
    return out;
  };

  /** Held services and runbooks for one machine added as rows, with one Undo for the press. */
  const foundAdd = async (machinePath: string): Promise<{ words: string; created: string[] }> => {
    const m = await model();
    const x = m.machines.find((y) => y.path === machinePath);
    if (!x) throw new Error('Only a machine gets its found services added.');
    const store = await readFound();
    const e = foundEntry(store, x);
    const held = (e?.services ?? []).filter((s) => ![...m.machines, ...m.services].some((y) => y.name.toLowerCase() === s.name.toLowerCase()));
    const heldBooks = (e?.runbooks ?? []).filter((b) => !m.runbooks.some((y) => y.name.toLowerCase() === b.name.toLowerCase()));
    if (!held.length && !heldBooks.length) return { words: `Nothing new on ${x.name} any more.`, created: [] as string[] };
    const created: string[] = [];
    for (const s of held.slice(0, 40)) created.push(await addTableRow(w, 'service', { name: s.name, cells: { kind: s.kind || 'Other', runsOn: `[[${x.name}]]`, url: '', port: s.port, status: 'Up', dependsOn: '', runbook: '', checked: '', logins: '' }, note: null }));
    for (const b of heldBooks.slice(0, 12)) created.push(await addTableRow(w, 'runbook', { name: b.name, cells: { for: [b.for, ...(b.members ?? [])].filter(Boolean).map((n) => `[[${n}]]`).join(', '), every: 'On demand', lastRun: '', pattern: b.template }, note: null }));
    const next: FoundStore = { ...store };
    const madeNames = new Set([...held, ...heldBooks].map((s) => s.name.toLowerCase()));
    const dismissed = (e?.dismissed ?? []).filter((d) => !madeNames.has(d));
    const key = foundKey(x);
    if (key !== machinePath) delete next[machinePath];
    if (dismissed.length) next[key] = { services: [], runbooks: [], dismissed };
    else delete next[key];
    await writeFound(next).catch(() => undefined);
    const n = held.length;
    const k = heldBooks.length;
    const what = k ? `${n} service${n === 1 ? '' : 's'} and ${k} runbook${k === 1 ? '' : 's'}` : `${n} service${n === 1 ? '' : 's'}`;
    return { words: n + k > 3 ? `This adds ${what} on ${x.name}.` : `Added ${what} on ${x.name}.`, created };
  };

  const ops: WorkPart['ops'] = {
    model: async (): Promise<SystemsView> => {
      const m = await model();
      const { docs, rels, clash } = await tablesOf();
      // Records changed on both PCs (both lines kept in the file, the first shown): each with its other
      // versions, for the record's page, where the person chooses.
      const conflicts: SystemsConflict[] = [];
      for (const kind of TYPES as SystemsTableKind[]) {
        for (const dupe of docs[kind].dupes) {
          const kept = docs[kind].rows.find((r) => r.name.toLowerCase() === dupe.toLowerCase());
          const others = docs[kind].conflicts[dupe.toLowerCase()] ?? [];
          if (!kept || !others.length) continue;
          conflicts.push({ kind, name: kept.name, path: rowPathIn(docs[kind].rows, rels[kind], kept.name), kept: kept.cells, keptNote: kept.note, others: others.map((o) => ({ name: o.name, cells: o.cells, note: o.note })) });
        }
      }
      return { ...m, folder: await w.moduleFolder('systems'), found: await foundGroups(m), tablesClash: clash, conflicts, move: await moveState(w) };
    },
    'add-machine': (input) => addRecord('machine', input),
    'add-service': (input) => addRecord('service', input),
    'add-runbook': (input) => addRecord('runbook', input),
    check: async (rel) => {
      const r = await checkMachine(rel);
      return { words: r.message, created: r.created };
    },
    'check-all': () => checkAll(),
    'run-action': (rel, input) => runAction(rel, input),
    'ensure-runbooks': async (rel) => {
      const r = S(rel, 1000);
      const m = await model();
      const x = m.machines.find((y) => y.path === r);
      if (!x) throw new Error('Only a machine gets runbooks written for it.');
      if (!w.part('systems', 'runbooks')) return { words: `Runbooks are switched off in Settings › Packs, so none were written for ${x.name}.`, created: [] as string[] };
      const { made, created } = await ensureRunbooks(x.name, x.os, m.services.filter((s) => s.machinePath === r));
      if (!made) return { words: `${x.name} already has the runbooks it needs.`, created: [] as string[] };
      return { words: made > 3 ? `This adds ${made} runbook${made === 1 ? '' : 's'} for ${x.name}.` : `Wrote ${made} runbook${made === 1 ? '' : 's'} for ${x.name}.`, created };
    },
    'found-add': (rel) => foundAdd(S(rel, 1000)),
    'found-add-all': async () => {
      const m = await model();
      const groups = await foundGroups(m);
      if (!groups.length) return { words: 'Nothing new anywhere any more.', created: [] as string[] };
      const created: string[] = [];
      let n = 0;
      let k = 0;
      for (const g of groups) {
        const one = await foundAdd(g.machinePath);
        created.push(...one.created);
        n += g.services.length;
        k += g.runbooks.length;
      }
      const what = k ? `${n} service${n === 1 ? '' : 's'} and ${k} runbook${k === 1 ? '' : 's'}` : `${n} service${n === 1 ? '' : 's'}`;
      return { words: `Added ${what} on every machine.`, created };
    },
    'found-dismiss': async (rel) => {
      const r = S(rel, 1000);
      const m = await model();
      const x = m.machines.find((y) => y.path === r);
      if (!x) throw new Error('Only a machine’s found services are put away.');
      const store = await readFound();
      const e = foundEntry(store, x);
      const held = [...(e?.services ?? []).map((s) => s.name.toLowerCase()), ...(e?.runbooks ?? []).map((b) => b.name.toLowerCase())];
      if (!held.length && !(e?.dismissed.length)) return 'Nothing new on it to put away.';
      const next: FoundStore = { ...store };
      const key = foundKey(x);
      if (key !== r) delete next[r];
      next[key] = { services: [], runbooks: [], dismissed: [...new Set([...(e?.dismissed ?? []), ...held])].slice(0, 80) };
      await writeFound(next);
      return `Left them for now. New services on ${x.name} won’t be shown again.`;
    },
    'undo-created': async (input) => {
      const o = O(input);
      const paths = (Array.isArray(o.paths) ? o.paths : Array.isArray(input) ? input : []).filter((p): p is string => typeof p === 'string' && !!p).slice(0, 60);
      if (!paths.length) throw new Error('Nothing to undo.');
      let movedNotes = 0;
      let droppedRows = 0;
      const byKind = new Map<SystemsTableKind, string[]>();
      for (const p of paths.slice(0, 60)) {
        const rel = S(p, 1000);
        const row = splitRowPath(rel);
        if (row) {
          const hit = await rowByPath(w, rel).catch(() => null);
          if (hit && !hit.row.note) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), hit.row.name]);
          continue;
        }
        try {
          kindOfNote(w, rel, kinds, kindErr);
        } catch {
          continue;
        }
        try {
          await (w.d.vault() as unknown as { trash: (rel: string) => Promise<void> }).trash(rel);
          movedNotes++;
        } catch {
          continue;
        }
      }
      for (const [kind, names] of byKind) droppedRows += await dropTableRows(w, kind, names).catch(() => 0);
      if (!movedNotes && !droppedRows) throw new Error('Those notes aren’t there any more.');
      const bits: string[] = [];
      if (movedNotes) bits.push(movedNotes === 1 ? 'Moved it to the Bin.' : `Moved ${movedNotes} notes to the Bin.`);
      if (droppedRows) bits.push(droppedRows === 1 ? 'Took it back out of the list.' : `Took ${droppedRows} back out of the lists.`);
      return { words: bits.join(' '), moved: movedNotes + droppedRows };
    },
    'set-field': (input) => setField(input),
    'health-note': (rel, input) => healthNote(rel, input),
    'remove-health': async (rel, row, shown) => {
      const r = S(rel, 1000);
      const split = splitRowPath(r);
      if (split) {
        const hit = await rowByPath(w, r);
        if (!hit) throw new Error('That record isn’t in the list any more.');
        const { doc } = await readTable(w, split.kind);
        const key = hit.row.name.toLowerCase();
        const lines = [...(doc.logs[key] ?? [])];
        const at = typeof row === 'number' ? row : -1;
        if (at < 0 || at >= lines.length || (typeof shown === 'string' && lines[at].date !== shown)) throw new Error('That health note isn’t there any more.');
        lines.splice(at, 1);
        await writeTable(w, split.kind, { ...doc, logs: { ...doc.logs, [key]: lines } });
        return 'Took the health note out. It is kept in the list’s history (File recovery).';
      }
      await removeRow(w, r, HEALTH_LOG, typeof row === 'number' ? row : -1, typeof shown === 'string' ? shown : null);
      return 'Took the health note out. It is kept in the note’s history (File recovery).';
    },
    'note-words': async (rel, words) => {
      const r = S(rel, 1000);
      const text = S(words, 2000);
      if (!text) throw new Error('Write something first.');
      const row = splitRowPath(r);
      if (row) {
        const hit = await rowByPath(w, r);
        if (!hit) throw new Error('That record isn’t in the list any more.');
        return promoteToNote(w, row.kind, hit.row.name, { notesWords: text });
      }
      const kind = kindOfNote(w, r, kinds, kindErr);
      if (kind === 'runbook') {
        await w.change(r, (t) => `${t.replace(/\n*$/, '')}\n\n## Notes\n\n${text}\n`);
        return r;
      }
      await w.change(r, (t) => {
        const at = /^## Notes\s*$/m.exec(t);
        if (!at) return `${t.replace(/\n*$/, '')}\n\n## Notes\n\n${text}\n`;
        return `${t.slice(0, at.index + at[0].length)}\n\n${text}\n${t.slice(at.index + at[0].length).replace(/^\n+/, '\n')}`;
      });
      return r;
    },
    'link-secret': async (rel, label, id) => {
      const r = S(rel, 1000);
      kindOf(r);
      const row = splitRowPath(r);
      const sid = S(id, 40);
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(sid)) throw new Error('That isn’t a secret from Secrets.');
      const name = S(label, 80) || 'Login';
      if (row) {
        const hit = await rowByPath(w, r);
        if (!hit) throw new Error('That record isn’t in the list any more.');
        const have = loginsOfCell(hit.row.cells.logins ?? '');
        if (!have.some((l) => l.id === sid)) await setCell(row.kind, hit.row.name, 'logins', loginsCellOf([...have, { label: name, id: sid }]));
      } else await w.change(r, (text) => withCredential(text, name, sid));
      const m = await model();
      const titled = [...m.machines, ...m.services].find((x) => x.path === r)?.name ?? titleOf(r);
      const linked = `Linked ${name} to ${titled}. Its value stays locked in Secrets.`;
      // A machine with its address gets read straight away (26 Oct 2026): quietly since 5 Nov 2026 — held for the
      // Systems page, never made.
      if (kindOf(r) === 'machine' && m.machines.find((x) => x.path === r)?.address) {
        const read = await checkMachine(r, { quiet: true }).then((x) => x.message).catch((e: unknown) => `It couldn’t be read yet: ${e instanceof Error ? e.message.replace(/^[^:]+: /, '') : String(e)}`);
        return `${linked} ${read}`;
      }
      return linked;
    },
    'unlink-secret': async (rel, id) => {
      const r = S(rel, 1000);
      const row = splitRowPath(r);
      const sid = S(id, 40);
      if (row) {
        const hit = await rowByPath(w, r);
        if (!hit) throw new Error('That record isn’t in the list any more.');
        const have = loginsOfCell(hit.row.cells.logins ?? '');
        if (!have.some((l) => l.id === sid)) throw new Error('That login isn’t linked here any more.');
        await setCell(row.kind, hit.row.name, 'logins', loginsCellOf(have.filter((l) => l.id !== sid)));
      } else await w.change(r, (text) => withoutCredential(text, sid));
      const m = await model();
      return `Took the link off ${[...m.machines, ...m.services].find((x) => x.path === r)?.name ?? titleOf(r)}. The login itself is still in Secrets.`;
    },
    step: async (rel, change) => {
      const r = S(rel, 1000);
      const c = O(change);
      const row = splitRowPath(r);
      if (row) {
        // Steps are writing: the runbook becomes a note of its own first, with the page's steps in it.
        const m = await model();
        const entry = m.runbooks.find((x) => x.path === r);
        if (!entry) throw new Error('That record isn’t in the list any more.');
        if (typeof c.add === 'string' && !S(c.add, 500)) throw new Error('A step needs its words.');
        const at = typeof c.remove === 'number' ? c.remove : typeof c.at === 'number' ? c.at : null;
        if (at !== null && !entry.steps[at]) throw new Error('That step isn’t there any more.');
        if (at !== null && c.words !== undefined && !S(c.words, 500)) throw new Error('A step needs its words.');
        const made = await promoteToNote(w, row.kind, entry.name);
        await w.change(made, (text) => withSteps(text, { ...(typeof c.at === 'number' ? { at: c.at } : {}), ...(typeof c.words === 'string' ? { words: c.words } : {}), ...(typeof c.add === 'string' ? { add: c.add } : {}), ...(typeof c.remove === 'number' ? { remove: c.remove } : {}) }));
        return `${typeof c.add === 'string' ? 'Added the step.' : typeof c.remove === 'number' ? 'Took the step out. It is kept in the note’s history (File recovery).' : 'Changed the step.'} It is a note of its own now.`;
      }
      await w.change(r, (text) => withSteps(text, { ...(typeof c.at === 'number' ? { at: c.at } : {}), ...(typeof c.words === 'string' ? { words: c.words } : {}), ...(typeof c.add === 'string' ? { add: c.add } : {}), ...(typeof c.remove === 'number' ? { remove: c.remove } : {}) }));
      return typeof c.add === 'string' ? 'Added the step.' : typeof c.remove === 'number' ? 'Took the step out. It is kept in the note’s history (File recovery).' : null;
    },
    'mark-run': (rel, input) => markRun(rel, input),
    'remove-record': async (rel) => {
      const r = S(rel, 1000);
      const row = splitRowPath(r);
      if (!row) {
        kindOfNote(w, r, kinds, kindErr);
        await (w.d.vault() as unknown as { trash: (rel: string) => Promise<void> }).trash(r);
        return `Moved ${titleOf(r)} to the Bin.`;
      }
      const hit = await rowByPath(w, r);
      if (!hit) throw new Error('That record isn’t in the list any more.');
      if (hit.row.note) throw new Error(`${hit.row.name} is a note of its own now. Take it out from its note.`);
      await dropTableRows(w, row.kind, [hit.row.name]);
      return `Took ${hit.row.name} out of the list. The list keeps its history (File recovery).`;
    },
    findings: (rel) => findings(rel),
    'resolve-row': (target) => resolveRowTarget(w, S(target, 200)),
    'search-rows': (query) => searchTableRows(w, S(query, 200)),
    'resolve-conflict': async (input) => {
      const o = O(input);
      const kind = S(o.kind, 20);
      if (kind !== 'machine' && kind !== 'service' && kind !== 'runbook') throw new Error(kindErr);
      const name = S(o.name, 200);
      if (!name) throw new Error('Choose one of the versions shown.');
      const keep = typeof o.keep === 'number' && Number.isInteger(o.keep) ? o.keep : -1;
      const at = await resolveTableConflict(w, kind as SystemsTableKind, name, keep);
      return { words: `Kept your choice for ${name}. The list holds one version now.`, path: at };
    },
    'row-text': async (rel) => {
      const row = splitRowPath(S(rel, 1000));
      if (!row) throw new Error('That isn’t a list row.');
      const hit = await rowByPath(w, S(rel, 1000));
      if (!hit) throw new Error('That record isn’t in the list any more.');
      return rowNoteText(w, row.kind, hit.row.name);
    },
    'move-state': () => moveState(w),
    'move-preview': async () => {
      const plan = await planMove(w);
      return { words: previewWords(plan), fold: plan.fold, stay: plan.stay, tables: plan.tables, pcsBlock: plan.pcsBlock, stalePcs: plan.stalePcs, unreadable: plan.unreadable, clash: plan.clash };
    },
    'move-run': () => runMove(w),
    'move-resume': () => resumeMove(w),
    'move-undo': () => undoMove(w),
    'move-defer': () => deferMove(w),
    options: async (patch) => {
      const o = O(patch);
      const remindDays = await remindDaysOption(w, 'systems', patch);
      if (typeof o.checkMinutes === 'number') await w.setOptions('systems', { settings: { checkMinutes: Math.max(5, Math.min(1440, Math.round(o.checkMinutes))) } });
      return { remindDays, checkMinutes: await w.setting('systems', 'checkMinutes', 15) };
    },
  };

  return {
    id: 'systems',
    ops,
    async inbox(item) {
      const m = await model();
      const words = itemWords(item);
      const x = namedIn(words, [...m.machines, ...m.services], (r) => [r.name, 'address' in r ? r.address : '']);
      if (x) return { target: { kind: 'module', module: 'systems', type: 'address' in x ? 'machine' : 'service', path: x.path, name: x.name, label: item.kind === 'line' ? `Note on ${x.name}’s health` : `Keep with ${x.name}` }, why: `Names ${x.name}` };
      const r = item.kind === 'line' ? namedIn(words, m.runbooks, (b) => [b.name]) : undefined;
      if (r) return { target: { kind: 'module', module: 'systems', type: 'runbook', path: r.path, name: r.name, label: `Add a step to ${r.name}` }, why: `Names the runbook ${r.name}` };
      return null;
    },
    async fileInbox(item, target) {
      const rel = target.path ?? '';
      const kind = kindOf(rel);
      if (item.kind !== 'line') return { words: `Kept ${item.path.split('/').pop()} with ${titleOf(rel)}.`, paths: [rel], keepWith: rel };
      if (kind === 'runbook') {
        await ops.step(rel, { add: item.words });
        return { words: `Added a step to ${titleOf(rel)}.`, paths: [rel] };
      }
      await healthNote(rel, { note: item.words });
      return { words: `Noted on ${titleOf(rel)}’s health log.`, paths: [rel] };
    },
    async check(): Promise<WorkNotice[]> {
      const sw = w.d.prefs().modules;
      // The steady beat (30 Oct 2026): every machine with an address and a linked login is read on its own, no button.
      // Quiet since 5 Nov 2026: it never creates anything — new services and runbooks are held for the Systems page.
      // WorkModules calls this every 10 minutes; the beat itself is the person's setting (15 minutes unless changed).
      if (partOn(sw, 'systems', 'monitoring') && w.d.login) {
        const minutes = Math.max(5, Math.min(1440, await w.setting('systems', 'checkMinutes', 15)));
        if (Date.now() - lastBeat >= minutes * 60_000) { lastBeat = Date.now(); await checkAll().catch(() => undefined); }
      }
      const m = await model();
      const out: WorkNotice[] = [];
      if (partOn(sw, 'systems', 'monitoring')) {
        for (const t of m.trouble.filter((x) => /^(down|degraded)$/i.test(x.status))) out.push({ key: `sys-down:${t.path}:${t.status}:${t.checked ?? ''}`, kind: 'systems', title: `${t.name} is ${t.status.toLowerCase()}`, body: [t.kind === 'machine' ? 'Machine' : 'Service', t.note].filter(Boolean).join(' · '), path: t.path });
        for (const a of alertsOf(m).filter((x) => !x.key.startsWith('down:'))) out.push({ key: `sys-alert:${a.key}`, kind: 'systems', title: a.title, body: `Next step: ${a.nextStep}`, path: a.path });
      }
      if (partOn(sw, 'systems', 'runbooks')) for (const r of m.runbooksDue.filter((x) => x.days !== null && x.days <= 0)) out.push({ key: `sys-runbook:${r.path}:${r.nextDue}`, kind: 'systems', title: `Time to run ${r.name}`, body: [r.every, r.lastRun ? `last run ${dayWords(r.lastRun, m.today)}` : 'never run yet'].join(' · '), path: r.path });
      return out;
    },
    async tool(name, args, ctx) {
      const tableOrPath = async (p: string): Promise<string> => splitRowPath(p)?.table ?? p;
      const mine = await model(ctx.gated, ctx.gate ?? null);
      let refused = await refusedCount(w, ctx, TYPES);
      // Rows an agent below the Systems level cannot read count as refused too, so its answer says
      // "not allowed" rather than "none".
      if (ctx.gate && !ctx.gate.allowsLevel('personal')) {
        try {
          const { docs, rels } = await tablesOf();
          const notes = await notesOf(w, w.d.index, TYPES);
          refused += rowsAsNotes(docs, rels, notes, (rel) => w.d.index.get(rel) !== undefined).notes.length;
        } catch {
          // No lists: nothing refused beyond the notes.
        }
      }
      const on = w.isOn('systems');
      const read = answerSystemTool({ model: mine, on, refused, agent: ctx.agent }, name, args);
      if (read !== null) return read;
      if (name === 'system_machine_add' || name === 'system_service_add') {
        const kind = name === 'system_machine_add' ? 'machine' : 'service';
        ctx.check?.(await tableRelFor(w, kind));
        const rel = await addRecord(kind, args);
        return `Added ${str(args.name).slice(0, 100)} to Systems. [${rel}]`;
      }
      if (name === 'system_check_now') {
        const hit = findSystem(mine, args.machine);
        if (!hit || hit.kind !== 'machine') throw new Error(`There is no machine called “${str(args.machine)}” in Systems.`);
        ctx.check?.(await tableOrPath(hit.x.path));
        const r = await checkMachine(hit.x.path);
        return `${r.message} [${hit.x.path}]`;
      }
      if (name === 'system_health_note') {
        const hit = findSystem(mine, args.name);
        if (!hit) throw new Error(`There is no machine or service called “${str(args.name)}” in Systems.`);
        const note = str(args.note).slice(0, 500);
        if (!note) throw new Error('Say what the health note is.');
        ctx.check?.(await tableOrPath(hit.x.path));
        const status = str(args.status) ? knownWord(hit.kind === 'machine' ? MACHINE_STATUSES : SERVICE_STATUSES, args.status) : '';
        await healthNote(hit.x.path, { status: args.status, note });
        const now = await model(ctx.gated, ctx.gate ?? null);
        const at = findSystem(now, args.name)?.x.path ?? hit.x.path;
        return `Noted ${hit.x.name}’s health${status ? ` (${status})` : ''}. [${at}]`;
      }
      if (name === 'system_runbooks_write') {
        const hit = findSystem(mine, args.machine);
        if (!hit || hit.kind !== 'machine') throw new Error(`There is no machine called “${str(args.machine)}” in Systems.`);
        ctx.check?.(await tableOrPath(hit.x.path));
        if (!w.part('systems', 'runbooks')) return `Runbooks are switched off in Settings › Packs, so none were written for ${hit.x.name}. [${hit.x.path}]`;
        const { made } = await ensureRunbooks(hit.x.name, hit.x.os, mine.services.filter((s) => s.machinePath === hit.x.path));
        return made ? made > 3 ? `This adds ${made} runbooks for ${hit.x.name} from what its check found. [${hit.x.path}]` : `Wrote ${made} runbook${made === 1 ? '' : 's'} for ${hit.x.name} from what its check found. [${hit.x.path}]` : `${hit.x.name} already has the runbooks it needs. [${hit.x.path}]`;
      }
      if (name === 'system_action_result') {
        const hit = findSystem(mine, args.machine);
        if (!hit || hit.kind !== 'machine') throw new Error(`There is no machine called “${str(args.machine)}” in Systems.`);
        const note = str(args.note).slice(0, 500);
        if (!note) throw new Error('Say what the fix did.');
        ctx.check?.(await tableOrPath(hit.x.path));
        // A fix's result is the machine's words, not typing: it stays in the row.
        const line = `${str(args.action).slice(0, 80) ? `${str(args.action).slice(0, 80)}: ` : ''}${note}`;
        const row = splitRowPath(hit.x.path);
        if (row) {
          const entry = await rowByPath(w, hit.x.path);
          if (!entry) throw new Error('That record isn’t in the list any more.');
          const { doc } = await readTable(w, row.kind);
          const key = entry.row.name.toLowerCase();
          const rows = doc.rows.map((x) => (x.name.toLowerCase() === key ? { ...x, cells: { ...x.cells, checked: mine.today } } : x));
          await writeTable(w, row.kind, { ...doc, rows, logs: { ...doc.logs, [key]: [...(doc.logs[key] ?? []), { date: mine.today, status: '', note: line }] } });
        } else await agentChange(w, ctx, hit.x.path, (text) => setNoteProp(tableWithRow(text, HEALTH_LOG, { date: mine.today, status: '', note: line }), 'checked', mine.today));
        return `Recorded what the fix did on ${hit.x.name}. [${hit.x.path}]`;
      }
      if (name === 'system_runbook_mark_run') {
        const r = findRunbook(mine, args.runbook);
        if (!r) throw new Error(`There is no runbook called “${str(args.runbook)}”.${mine.runbooks.length ? ` Runbooks: ${mine.runbooks.map((x) => x.name).join(', ')}.` : ''}`);
        if (str(args.day) && !readDay(args.day)) throw new Error('Give the day as YYYY-MM-DD.');
        ctx.check?.(await tableOrPath(r.path));
        const date = readDay(args.day) ?? mine.today;
        const result = knownWord(RUN_RESULTS, args.result) || 'Done';
        await markRun(r.path, { result: args.result, note: args.note, date: args.day });
        const now = await model(ctx.gated, ctx.gate ?? null);
        const at = findRunbook(now, args.runbook)?.path ?? r.path;
        return `Marked ${r.name} run on ${dayWords(date, mine.today)}: ${result}. [${at}]`;
      }
      return `There is no tool called ${name}.`;
    },
    rules: () => 'Systems: answer "is everything up?" with system_status; use system_map, system_find and system_runbook_get for the person’s machines, services and runbooks; add a machine with system_machine_add or a service with system_service_add, check a machine now with system_check_now (its login stays in Secrets), write its runbooks with system_runbooks_write, and for a fix get system_action_plan, run it only with the person’s OK through the remote computer tools (which ask first), then record it with system_action_result. Add a health note with system_health_note and record a run with system_runbook_mark_run, only with what the person said or a check showed. Logins are kept in Secrets and never readable: say so, and never ask for a password.',
  };
}
