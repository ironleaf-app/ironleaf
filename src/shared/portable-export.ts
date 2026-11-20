// Export everything (31 Oct 2026, the gap analysis: "Portable export (Markdown + CSV + attachments) to prove no
// lock-in"): one zip the person saves where they choose. Every note as Markdown exactly as on disk (folders kept),
// every attachment and asset beside its note, one CSV per record type (columns from the records' real fields, dates as
// ISO), and a plain README saying what each part is and how to open it in any other app. Secrets, Private notes and the
// Health store stay out unless the person ticks "Include my private notes" (then decrypted, only after unlocking, with
// a clear warning). Pure: the main side (src/main/portable-export.ts) lists files and writes the zip.

import { csvCell, toCsv } from './csv';
import { isMachineProp } from './frontmatter';

export interface PortableNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  mtime: number;
}

export interface PortableProject {
  path: string;
  name: string;
  status?: string;
  health?: string;
  progress?: number;
  owner?: string;
  due?: string;
  updated?: string;
  folder?: string;
  tags: string[];
}

export interface PortableTask {
  words: string;
  done: boolean;
  due: string | null;
  time: string | null;
  projectName: string | null;
  path: string;
  title: string;
  line: number;
  tags: string[];
  priority?: string;
  reminder: boolean;
  repeats: boolean;
}

export interface PortableSecret {
  name: string;
  kind: string;
  username?: string;
  where?: string;
  notes?: string;
  value: string;
  created: number;
  modified: number;
  from?: string;
}

export interface PortableTable {
  /** In the zip, e.g. "tables/projects.csv". */
  file: string;
  /** Said in the README, e.g. "Projects". */
  title: string;
  /** One line in the README. */
  line: string;
  headers: string[];
  rows: string[][];
}

export interface PortableProgress {
  phase: 'listing' | 'packing';
  done: number;
  total: number;
}

export interface PortableResult {
  file: string;
  files: number;
  bytes: number;
  words: string;
}

export const INCLUDE_PRIVATE_LABEL = 'Include my private notes';
export const PRIVATE_WARNING =
  'This puts your private notes, secrets and health records in the file as plain words anyone can read. Keep it somewhere safe and delete it when you are done.';
export const PRIVATE_NEEDED = 'Unlock your private notes first, then try again. Nothing was saved.';

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A value that is a date as ISO: a Date or a milliseconds time becomes full ISO, an ISO day stays, else as written. */
export function isoCell(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === 'number' && Number.isFinite(v) && v > 946684800000 && v < 4102444800000) return new Date(v).toISOString();
  return String(v ?? '').trim();
}

/** A value as plain words in a table: ticks as Yes and No, lists joined, dates as ISO, links by their shown words. */
export function plainCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v instanceof Date) return isoCell(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (Array.isArray(v)) return v.map((x) => plainCell(x)).filter(Boolean).join(', ');
  const s = String(v).trim();
  if (!s) return '';
  return s.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t: string, a?: string) => (a ?? t).split('/').pop()!.replace(/\.md$/i, ''));
}

const cap = (k: string) => (k ? k.slice(0, 1).toUpperCase() + k.slice(1) : k);
const labelOf = (k: string) => cap(k.replace(/_/g, ' '));

/** Preferred columns first, then the rest as found, each once. */
export function unionFields(records: Record<string, unknown>[], preferred: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of preferred) {
    const key = k.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(k);
    }
  }
  // The app's own keeping (frontmatter.ts's one list) is never a column (6 Nov 2026, o3-meeting-page item 1);
  // the notes' Markdown in the export keeps it, exactly as on disk, so nothing a person has is lost.
  for (const r of records) for (const k of Object.keys(r)) if (!isMachineProp(k) && !seen.has(k.toLowerCase())) (seen.add(k.toLowerCase()), out.push(k));
  return out;
}

const NOTE = /\.md$/i;
export const isNoteRel = (rel: string) => NOTE.test(rel);

const typeOf = (p: Record<string, unknown>) => String((p as { type?: unknown }).type ?? '').trim().toLowerCase();
const titleOf = (n: PortableNote) => n.title || n.path.split('/').pop()!.replace(/\.md$/i, '');

function notesTable(title: string, file: string, line: string, notes: PortableNote[], preferred: string[]): PortableTable | null {
  if (!notes.length) return null;
  const fields = unionFields(notes.map((n) => n.props), preferred);
  const headers = ['Note', ...fields.map(labelOf), 'File', 'Changed'];
  const rows = notes
    .slice()
    .sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
    .map((n) => [titleOf(n), ...fields.map((f) => (f.toLowerCase() === 'date' || f.toLowerCase() === 'due' || f.toLowerCase() === 'day' ? isoCell((n.props as Record<string, unknown>)[Object.keys(n.props).find((k) => k.toLowerCase() === f.toLowerCase()) ?? f] ?? '') || plainCell((n.props as Record<string, unknown>)[Object.keys(n.props).find((k) => k.toLowerCase() === f.toLowerCase()) ?? f]) : plainCell((n.props as Record<string, unknown>)[Object.keys(n.props).find((k) => k.toLowerCase() === f.toLowerCase()) ?? f]))), n.path, isoCell(n.mtime)]);
  return { file, title, line, headers, rows };
}

export function projectsTable(projects: PortableProject[]): PortableTable | null {
  if (!projects.length) return null;
  const headers = ['Name', 'Status', 'Health', 'Progress', 'Owner', 'Due', 'Updated', 'Folder', 'Tags', 'File'];
  const rows = projects
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => [p.name, p.status ?? '', p.health ?? '', p.progress === undefined ? '' : String(p.progress), p.owner ?? '', p.due ?? '', p.updated ?? '', p.folder ?? '', p.tags.join(', '), p.path]);
  return { file: 'tables/projects.csv', title: 'Projects', line: 'Every project: its status, owner, due day and file.', headers, rows };
}

export function tasksTable(tasks: PortableTask[]): PortableTable | null {
  if (!tasks.length) return null;
  const headers = ['Task', 'Done', 'Due', 'Time', 'Project', 'Note', 'File', 'Line', 'Tags', 'Priority', 'Reminder', 'Repeats'];
  const rows = tasks
    .slice()
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title))
    .map((t) => [t.words, t.done ? 'Yes' : 'No', t.due ?? '', t.time ?? '', t.projectName ?? '', t.title, t.path, String(t.line + 1), t.tags.join(', '), t.priority ?? '', t.reminder ? 'Yes' : 'No', t.repeats ? 'Yes' : 'No']);
  return { file: 'tables/tasks.csv', title: 'Tasks', line: 'Every tick box in your notes: what, whether done, due day and where it is.', headers, rows };
}

export function meetingsTable(notes: PortableNote[]): PortableTable | null {
  const list = notes.filter((n) => typeOf(n.props) === 'meeting');
  return notesTable('Meetings', 'tables/meetings.csv', 'Every meeting note: its day, time, who was there and file.', list, ['date', 'time', 'attendees', 'project']);
}

export function peopleTable(notes: PortableNote[]): PortableTable | null {
  const list = notes.filter((n) => ['person', 'org', 'organisation', 'organization', 'company', 'supplier', 'vendor'].includes(typeOf(n.props)));
  return notesTable('People', 'tables/people.csv', 'Every person and organisation: their role, contact and file.', list, ['role', 'org', 'email', 'phone']);
}

/** A file name for a record type's table ("Accounts" becomes "tables/accounts.csv"), safe for any PC. */
export function tableFile(plural: string, used: Set<string>): string {
  const base = (plural || 'records').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'records';
  let name = `tables/${base}.csv`;
  for (let i = 2; used.has(name); i++) name = `tables/${base}-${i}.csv`;
  used.add(name);
  return name;
}

export interface ModuleTypeInput {
  id: string;
  name: string;
  plural: string;
  fields: { key: string }[];
}

/** One table per pack record type that has notes (type matches, or its folder holds them): columns are the type's own
 *  fields first, then any other fields found on the notes. */
export function packTables(notes: PortableNote[], types: ModuleTypeInput[], folders?: (typeId: string) => string): PortableTable[] {
  const used = new Set(['tables/projects.csv', 'tables/tasks.csv', 'tables/meetings.csv', 'tables/people.csv']);
  const out: PortableTable[] = [];
  for (const t of types) {
    const id = t.id.toLowerCase();
    const folder = folders ? folders(t.id) : '';
    const list = notes.filter((n) => {
      if (typeOf(n.props) === id) return true;
      return !!folder && (n.path === folder || n.path.startsWith(`${folder}/`)) && isNoteRel(n.path);
    });
    if (!list.length) continue;
    const preferred = [...t.fields.map((f) => f.key)];
    const fields = unionFields(list.map((n) => n.props).map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k.toLowerCase() !== 'type'))), preferred);
    const file = tableFile(t.plural, used);
    const headers = ['Note', ...fields.map(labelOf), 'File', 'Changed'];
    const rows = list
      .slice()
      .sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
      .map((n) => {
        const props = n.props as Record<string, unknown>;
        const byLower = new Map(Object.keys(props).map((k) => [k.toLowerCase(), props[k]]));
        return [titleOf(n), ...fields.map((f) => plainCell(byLower.get(f.toLowerCase()))), n.path, isoCell(n.mtime)];
      });
    out.push({ file, title: t.plural, line: `Every ${t.plural.toLowerCase()}: ${preferred.slice(0, 4).map(labelOf).join(', ').toLowerCase() || 'its fields'} and file.`, headers, rows });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export function secretsTable(secrets: PortableSecret[]): PortableTable | null {
  if (!secrets.length) return null;
  const headers = ['Name', 'Kind', 'Username', 'Where', 'Notes', 'Secret', 'Made', 'Changed', 'From'];
  const rows = secrets
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => [s.name, s.kind, s.username ?? '', s.where ?? '', s.notes ?? '', s.value, isoCell(s.created), isoCell(s.modified), s.from ?? '']);
  return { file: 'tables/secrets.csv', title: 'Secrets', line: 'Your secrets as plain words. Keep this file safe and delete it when done.', headers, rows };
}

export interface HealthTableInput {
  measures: Record<string, unknown>[];
  entries: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  plans: Record<string, unknown>[];
  exercises: Record<string, unknown>[];
  meals: Record<string, unknown>[];
  appointments: Record<string, unknown>[];
}

const HEALTH_TABLES: { key: keyof HealthTableInput; title: string; plural: string; line: string; preferred: string[] }[] = [
  { key: 'measures', title: 'Health measures', plural: 'Health measures', line: 'What you track: weight, sleep, steps and the rest.', preferred: ['name', 'unit', 'kind'] },
  { key: 'entries', title: 'Health entries', plural: 'Health entries', line: 'Each reading: its measure, day and value.', preferred: ['measure', 'day', 'value', 'note'] },
  { key: 'sessions', title: 'Training sessions', plural: 'Training sessions', line: 'Each workout: its day, kind and exercises.', preferred: ['day', 'kind', 'name'] },
  { key: 'meals', title: 'Meals', plural: 'Meals', line: 'Each meal: its day, kind and what was eaten.', preferred: ['day', 'kind', 'name'] },
  { key: 'appointments', title: 'Health appointments', plural: 'Health appointments', line: 'Each appointment: its day, who with and where.', preferred: ['day', 'who', 'where', 'kind'] },
  { key: 'notes', title: 'Health notes', plural: 'Health notes', line: 'Notes by day about your health.', preferred: ['day', 'text'] },
];

export function healthTables(db: HealthTableInput): PortableTable[] {
  const used = new Set<string>();
  const out: PortableTable[] = [];
  for (const t of HEALTH_TABLES) {
    const rows = db[t.key];
    if (!rows.length) continue;
    const fields = unionFields(rows, t.preferred);
    out.push({ file: tableFile(t.plural, used), title: t.title, line: t.line, headers: fields.map(labelOf), rows: rows.map((r) => fields.map((f) => plainCell((r as Record<string, unknown>)[Object.keys(r).find((k) => k.toLowerCase() === f.toLowerCase()) ?? f]))) });
  }
  return out;
}

export function tableCsv(t: PortableTable): string {
  return toCsv([t.headers.map((h) => h), ...t.rows]);
}

export const csvCellOf = csvCell;

/** A zip-safe export file name ("Harbour Cafe export 2026-10-31.zip"). */
export function exportFileName(vaultName: string, day: string, project?: string): string {
  const clean = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Vault';
  const who = clean(project ? `${vaultName} ${project}` : vaultName);
  return `${who} export ${day}.zip`;
}

/** The README in the zip: what each part is and how to open it in any other app. Plain words, no em dashes. */
export function portableReadme(o: { vault: string; day: string; project?: string; notes: number; files: number; tables: PortableTable[]; includePrivate: boolean }): string {
  const n = (k: number, one: string, many?: string) => `${k.toLocaleString('en-AU')} ${k === 1 ? one : (many ?? `${one}s`)}`;
  const lines = [
    `# ${o.project ? `Export of ${o.project} from ${o.vault}` : `Export of ${o.vault}`}`,
    '',
    `Saved on ${o.day}. This holds ${n(o.notes, 'note')} and ${n(o.files, 'file')} in all, as plain files any app can open. Nothing here needs Ironleaf.`,
    '',
    '## Notes',
    '',
    'Every note is a Markdown file (.md), in the same folders as in Ironleaf. Markdown is plain text with simple marks for headings, lists and links, so any text app opens it.',
    '',
    'To read them in another notes app: most Markdown notes apps open a folder of .md files as it is (choose the unzipped folder), or import the .md files; links between notes and pictures beside them keep working.',
    '',
    '## Pictures, PDFs and other files',
    '',
    'These sit beside the notes that use them, in the same folders. Open them as normal. A note links to one by its file name, so the link still reads after the move.',
    '',
    '## Tables',
    '',
  ];
  if (!o.tables.length) lines.push('No tables: there were no projects, tasks, meetings, people or pack records to list.', '');
  else {
    lines.push('Each table is a CSV file in the tables folder. CSV opens in Excel, Numbers, Google Sheets and any text app. Dates are written YYYY-MM-DD so they sort and import correctly.', '');
    for (const t of o.tables) lines.push(`- ${t.file}: ${t.line}`, '');
  }
  if (o.includePrivate) {
    lines.push('## Private notes, secrets and health', '', 'This export holds your private notes as plain Markdown, your secrets with their values, and your health records. They are readable by anyone with this file. Keep it somewhere safe and delete it when you are done.', '');
  } else {
    lines.push('## Private notes, secrets and health', '', 'Not in here. Private notes, secrets and health records stay out unless you tick Include my private notes when you export, after unlocking. Export again with that ticked to take them too.', '');
  }
  lines.push('## About this file', '', 'Made by Ironleaf, Export everything. The notes are exactly as saved, the tables are lists made from them on the day above.');
  return `${lines.join('\n')}\n`;
}
