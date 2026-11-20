// Sites and Equipment (Wave 6 part b, 24 Oct 2026; module 5 of the catalogue: "Stores, offices, rooms, devices with
// serials, patch points, photos · Per-site register, inventory, warranty and end-of-life, patch schedule · Work"). Each
// record is a plain note the person owns, in the module's folder inside the Work area:
//
//   Work/Sites and Equipment/Sites/Harbour Central.md     type: site — kind, code, address, contact, status, project;
//                                                         "## Rooms" | Room | Floor | Purpose | Notes |
//                                                         "## Patch points" | Point | Room | Switch | Port | VLAN |
//                                                         Device | Status | Date | Notes |
//   Work/Sites and Equipment/Equipment/Till 2.md          type: device — kind, site "[[Harbour Central]]", room, make,
//                                                         model, serial, asset_tag, status, assigned, purchased,
//                                                         warranty, eol
//   …/Files/<record>/photo.jpg                            photos and other files kept beside the record
//
// A table written by hand is read by its column names (any order, missing columns empty, extra columns kept), so a
// change in a view is one cell of one row and every other character stays as written. Pure: no files, no Node, no DOM.

import { defaultRecordView, type RecordViewDef } from './record-views';
import { setTableCells } from './layouts';
import type { WsRecord } from './workspace-records';
import type { WorkToolDef } from './work-module-tools';
import { DEVICE_KINDS, DEVICE_STATUSES, PATCH_STATUSES, SITE_KINDS, SITE_STATUSES } from './work-modules';
import { dateOf, daysFrom, isoOf } from './finance';
import { linkName, str, yamlWords } from './work-text';
import { plural } from './words';

export { daysFrom, isoOf, linkName };
/** A day as people write it in a property or a cell ("2027-03-01", "1/3/2027", "1 Mar 2027") → YYYY-MM-DD, else null. */
export function readDay(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const valid = (y: number, m: number, d: number) => {
    const t = new Date(y, m - 1, d);
    return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? isoOf(t) : null;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) return valid(Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(?:[a-z]{3,9},?\s+)?(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})$/i.exec(s);
  if (m) {
    const mo = MONTHS.findIndex((x) => m![2].toLowerCase().startsWith(x.toLowerCase()));
    if (mo >= 0) return valid(Number(m[3]), mo + 1, Number(m[1]));
  }
  return null;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Mon 26 Oct", with the year when it isn't today's. */
export function dayWords(iso: string, today: string): string {
  const d = dateOf(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : ''}`;
}
/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function whenWords(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
// One plural rule everywhere (3 Nov 2026, fourth-round G5-G7): imported from ./words above.
/** One of a list's words whatever its case ("in use" → "In use"), else the words as given (tidied). */
export function knownWord(list: readonly string[], v: unknown): string {
  const s = str(v).replace(/\s+/g, ' ');
  return list.find((x) => x.toLowerCase() === s.toLowerCase()) ?? s;
}
const isImage = (p: string) => /\.(png|jpe?g|gif|webp|avif|heic|bmp)$/i.test(p);

// ── Sections and tables of a note ────────────────────────────────────────────────────────────────────────────────────

export interface SectionAt {
  /** Where its words start (the line after its heading) and end (the next ## heading, or the end). */
  start: number;
  end: number;
  heading: string;
}

/** A ## section of a note by its heading's words ("Rooms", "Patch points" — any case, "Patch schedule" too). */
export function sectionAt(text: string, re: RegExp): SectionAt | null {
  const src = String(text ?? '');
  const heads = [...src.matchAll(/^##[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/gm)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    if (!re.test(h[1].trim())) continue;
    const lineEnd = src.indexOf('\n', h.index!);
    const start = lineEnd < 0 ? src.length : lineEnd + 1;
    const end = i + 1 < heads.length ? heads[i + 1].index! : src.length;
    return { start, end, heading: h[1].trim() };
  }
  return null;
}

export const ROOMS_HEADING = /^(rooms?(\s+and\s+spaces)?|spaces|meeting rooms?)$/i;
export const PATCH_HEADING = /^patch(ing)?(\s+(points?|schedule|panel|list))?$/i;
export const ROOM_HEAD = ['Room', 'Floor', 'Purpose', 'Notes'];
export const PATCH_HEAD = ['Point', 'Room', 'Switch', 'Port', 'VLAN', 'Device', 'Status', 'Due', 'Notes'];

/** The column each field is in, by the header's words (-1 when the table has no such column). */
export const ROOM_COLS: Record<string, RegExp> = { title: /^(room|name|space|area)$/i, floor: /^(floor|level|storey)$/i, purpose: /^(purpose|use|what|type)$/i, notes: /^notes?$/i };
export const PATCH_COLS: Record<string, RegExp> = { title: /^(point|patch(\s*point)?|outlet|label|id|data point|socket)$/i, room: /^(room|location|where)$/i, switch: /^(switch|stack)$/i, port: /^(port|switch port)$/i, vlan: /^vlan$/i, device: /^(device|connected|connected to|what)$/i, status: /^status$/i, date: /^(date|due|when|scheduled|patch date)$/i, notes: /^notes?$/i };

const splitRow = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
const isRule = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
/** A table's line: it starts with a pipe and holds another (its closing pipe may be missing, as hand-written tables
 *  often leave it off; a lone "| words" line is prose, not a row). Kept the same as layouts.ts, so a row read is one
 *  a write can land on. */
const TABLE_LINE = /^\s*\|[^|\r\n]*\|/;

/** A section's first table: its header and its rows (blank rows left out, as layouts.ts counts them). */
export function sectionTable(body: string): { head: string[]; rows: string[][] } | null {
  const lines = String(body ?? '').split(/\r?\n/);
  let i = lines.findIndex((l) => TABLE_LINE.test(l));
  if (i < 0) return null;
  const block: string[][] = [];
  for (; i < lines.length && TABLE_LINE.test(lines[i]); i++) block.push(splitRow(lines[i]));
  if (block.length >= 2 && isRule(block[1])) return { head: block[0], rows: block.slice(2).filter((r) => !isRule(r) && r.some((c) => c)) };
  return { head: [], rows: block.filter((r) => !isRule(r) && r.some((c) => c)) };
}

export function colsOf(head: string[], want: Record<string, RegExp>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, re] of Object.entries(want)) out[k] = head.findIndex((h) => re.test(h.trim()));
  // A table with no recognisable name column: its first column is the name.
  if (out.title < 0 && head.length) out.title = Object.values(out).includes(0) ? -1 : 0;
  return out;
}
const cell = (row: string[], i: number | undefined) => (i !== undefined && i >= 0 ? (row[i] ?? '').trim() : '');

// ── The model ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SiteNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
  /** The files kept beside it (newest first), when the caller knows. */
  files?: string[];
}

export interface Room {
  row: number;
  name: string;
  floor: string;
  purpose: string;
  notes: string;
  /** Devices at the site in this room. */
  devices: number;
}

export interface PatchPoint {
  row: number;
  point: string;
  room: string;
  switch: string;
  port: string;
  vlan: string;
  device: string;
  status: string;
  date: string | null;
  /** The date as written when it couldn't be read as a day. */
  dateWords: string;
  notes: string;
  site: string;
  siteName: string;
  /** Days to its date (negative: passed). */
  days: number | null;
  /** Still to do (To patch, Planned or Faulty). */
  open: boolean;
  /** To do, with its day today or passed. */
  due: boolean;
}

export type Lifecycle = 'End of life' | 'End of life soon' | 'Out of warranty' | 'Warranty ends soon' | 'Under warranty' | null;

export interface Device {
  path: string;
  name: string;
  kind: string;
  site: string;
  /** The site's note, when the name is one of the sites. */
  sitePath: string | null;
  room: string;
  make: string;
  model: string;
  serial: string;
  assetTag: string;
  status: string;
  assigned: string;
  purchased: string | null;
  warranty: string | null;
  eol: string | null;
  warrantyDays: number | null;
  eolDays: number | null;
  lifecycle: Lifecycle;
  photos: string[];
  files: string[];
}

export interface Site {
  path: string;
  name: string;
  kind: string;
  code: string;
  address: string;
  contact: string;
  status: string;
  project: string;
  rooms: Room[];
  patch: PatchPoint[];
  /** The tables' columns (field → index), so an edit lands in the right cell. */
  roomCols: Record<string, number>;
  patchCols: Record<string, number>;
  /** The section's heading as written ("Rooms", "Patch schedule"), when it has one. */
  roomsHeading: string | null;
  patchHeading: string | null;
  devices: number;
  inUse: number;
  spare: number;
  toPatch: number;
  photos: string[];
  files: string[];
}

export interface LifeItem {
  device: Device;
  what: 'warranty' | 'eol';
  date: string;
  days: number;
  /** "Warranty ends in 40 days (Wed 2 Dec)", "Reached end of life 3 days ago". */
  words: string;
}

export interface SitesModel {
  sites: Site[];
  devices: Device[];
  /** Devices kept spare, by site. */
  spare: Device[];
  /** Patch points still to do, soonest first (those without a day last). */
  toPatch: PatchPoint[];
  /** Warranties and ends of life coming up (and just passed), soonest first. */
  lifecycle: LifeItem[];
  today: string;
  remindDays: number;
}

const RETIRED = /^retired$/i;

export function readDevice(n: SiteNote, today: string, remind: number, sites: { name: string; path: string; code: string }[] = []): Device {
  const p = n.props;
  const site = linkName(p.site);
  const s = site ? sites.find((x) => x.name.toLowerCase() === site.toLowerCase() || (!!x.code && x.code.toLowerCase() === site.toLowerCase())) : undefined;
  const warranty = readDay(p.warranty);
  const eol = readDay(p.eol ?? p.end_of_life);
  const warrantyDays = warranty ? daysFrom(today, warranty) : null;
  const eolDays = eol ? daysFrom(today, eol) : null;
  const status = knownWord(DEVICE_STATUSES, p.status) || 'In use';
  let lifecycle: Lifecycle = null;
  if (eolDays !== null && eolDays < 0) lifecycle = 'End of life';
  else if (eolDays !== null && eolDays <= remind) lifecycle = 'End of life soon';
  else if (warrantyDays !== null && warrantyDays < 0) lifecycle = 'Out of warranty';
  else if (warrantyDays !== null && warrantyDays <= remind) lifecycle = 'Warranty ends soon';
  else if (warrantyDays !== null) lifecycle = 'Under warranty';
  const files = n.files ?? [];
  return {
    path: n.path,
    name: n.title,
    kind: knownWord(DEVICE_KINDS, p.kind) || 'Other',
    site: s?.name ?? site,
    sitePath: s?.path ?? null,
    room: str(p.room),
    make: str(p.make),
    model: str(p.model),
    serial: str(p.serial),
    assetTag: str(p.asset_tag ?? p.asset),
    status,
    assigned: linkName(p.assigned),
    purchased: readDay(p.purchased),
    warranty,
    eol,
    warrantyDays,
    eolDays,
    lifecycle,
    photos: files.filter(isImage),
    files,
  };
}

export function readSite(n: SiteNote, today: string): Site {
  const p = n.props;
  const text = String(n.content ?? '');
  const roomsAt = sectionAt(text, ROOMS_HEADING);
  const patchAt = sectionAt(text, PATCH_HEADING);
  const roomsT = roomsAt ? sectionTable(text.slice(roomsAt.start, roomsAt.end)) : null;
  const patchT = patchAt ? sectionTable(text.slice(patchAt.start, patchAt.end)) : null;
  const roomCols = colsOf(roomsT?.head ?? ROOM_HEAD, ROOM_COLS);
  const patchCols = colsOf(patchT?.head ?? PATCH_HEAD, PATCH_COLS);
  const rooms: Room[] = (roomsT?.rows ?? []).map((r, row) => ({ row, name: cell(r, roomCols.title), floor: cell(r, roomCols.floor), purpose: cell(r, roomCols.purpose), notes: cell(r, roomCols.notes), devices: 0 }));
  const patch: PatchPoint[] = (patchT?.rows ?? []).map((r, row) => {
    const dateWords = cell(r, patchCols.date);
    const date = readDay(dateWords);
    const status = knownWord(PATCH_STATUSES, cell(r, patchCols.status));
    const open = /^(to patch|planned|faulty)$/i.test(status);
    const days = date ? daysFrom(today, date) : null;
    return { row, point: cell(r, patchCols.title), room: cell(r, patchCols.room), switch: cell(r, patchCols.switch), port: cell(r, patchCols.port), vlan: cell(r, patchCols.vlan), device: cell(r, patchCols.device), status, date, dateWords: date ? '' : dateWords, notes: cell(r, patchCols.notes), site: n.path, siteName: n.title, days, open, due: open && days !== null && days <= 0 };
  });
  const files = n.files ?? [];
  return {
    path: n.path,
    name: n.title,
    kind: knownWord(SITE_KINDS, p.kind) || 'Other',
    code: str(p.code),
    address: str(p.address),
    contact: linkName(p.contact),
    status: knownWord(SITE_STATUSES, p.status) || 'Active',
    project: linkName(p.project),
    rooms,
    patch,
    roomCols,
    patchCols,
    roomsHeading: roomsAt?.heading ?? null,
    patchHeading: patchAt?.heading ?? null,
    devices: 0,
    inUse: 0,
    spare: 0,
    toPatch: patch.filter((x) => x.open).length,
    photos: files.filter(isImage),
    files,
  };
}

export function lifeWords(what: 'warranty' | 'eol', date: string, days: number, today: string): string {
  if (what === 'warranty') return days < 0 ? `Warranty ended ${whenWords(days)}` : `Warranty ends ${whenWords(days)} (${dayWords(date, today)})`;
  return days < 0 ? `Reached end of life ${whenWords(days)}` : `End of life ${whenWords(days)} (${dayWords(date, today)})`;
}

/** Sites and devices from their notes (type site or device), as of `today`, warranties said `remindDays` ahead. */
export function sitesModel(notes: readonly SiteNote[], today: Date | string = new Date(), remindDays = 90): SitesModel {
  const t = typeof today === 'string' ? today : isoOf(today);
  const sites = notes.filter((n) => n.type === 'site').map((n) => readSite(n, t));
  const places = sites.map((s) => ({ name: s.name, path: s.path, code: s.code }));
  const devices = notes
    .filter((n) => n.type === 'device')
    .map((n) => readDevice(n, t, remindDays, places))
    .sort((a, b) => a.site.localeCompare(b.site) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  for (const s of sites) {
    const here = devices.filter((d) => d.sitePath === s.path && !RETIRED.test(d.status));
    s.devices = here.length;
    s.inUse = here.filter((d) => d.status === 'In use').length;
    s.spare = here.filter((d) => d.status === 'Spare').length;
    for (const r of s.rooms) r.devices = here.filter((d) => r.name && d.room.toLowerCase() === r.name.toLowerCase()).length;
  }
  sites.sort((a, b) => Number(a.status === 'Closed') - Number(b.status === 'Closed') || a.name.localeCompare(b.name));
  const toPatch = sites
    .flatMap((s) => s.patch.filter((x) => x.open))
    .sort((a, b) => (a.date === null ? 1 : 0) - (b.date === null ? 1 : 0) || (a.date ?? '').localeCompare(b.date ?? '') || a.siteName.localeCompare(b.siteName) || a.row - b.row);
  const lifecycle: LifeItem[] = [];
  for (const d of devices) {
    if (RETIRED.test(d.status)) continue;
    if (d.warranty && d.warrantyDays !== null && d.warrantyDays <= remindDays && d.warrantyDays >= -30) lifecycle.push({ device: d, what: 'warranty', date: d.warranty, days: d.warrantyDays, words: lifeWords('warranty', d.warranty, d.warrantyDays, t) });
    if (d.eol && d.eolDays !== null && d.eolDays <= remindDays) lifecycle.push({ device: d, what: 'eol', date: d.eol, days: d.eolDays, words: lifeWords('eol', d.eol, d.eolDays, t) });
  }
  lifecycle.sort((a, b) => a.date.localeCompare(b.date));
  return { sites, devices, spare: devices.filter((d) => d.status === 'Spare'), toPatch, lifecycle, today: t, remindDays };
}

/** A device's name from what it is ("Dell Latitude 5440", "Laptop ABC123"). */
export function deviceName(d: { kind?: string; make?: string; model?: string; serial?: string; asset_tag?: string }): string {
  const mm = [d.make, d.model].map((x) => str(x)).filter(Boolean).join(' ');
  const id = str(d.asset_tag) || str(d.serial);
  if (mm) return id ? `${mm} (${id})` : mm;
  return [str(d.kind) || 'Device', id].filter(Boolean).join(' ');
}

// ── New notes ────────────────────────────────────────────────────────────────────────────────────────────────────────

const linkProp = (v: unknown) => (linkName(v) ? JSON.stringify(`[[${linkName(v)}]]`) : '');
const cellText = (s: string) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

export interface SiteInput {
  name: string;
  kind?: string;
  code?: string;
  address?: string;
  contact?: string;
  status?: string;
  project?: string;
}
export function newSiteText(s: SiteInput): string {
  const front = [
    'type: site',
    `kind: ${yamlWords(knownWord(SITE_KINDS, s.kind) || 'Office')}`,
    `code: ${yamlWords(str(s.code))}`,
    `address: ${yamlWords(str(s.address))}`,
    `contact: ${linkProp(s.contact)}`,
    `status: ${yamlWords(knownWord(SITE_STATUSES, s.status) || 'Active')}`,
    `project: ${linkProp(s.project)}`,
  ].map((l) => l.replace(/: ""$/, ':').trimEnd());
  return `---\n${front.join('\n')}\n---\n## Rooms\n\n| ${ROOM_HEAD.join(' | ')} |\n| ${ROOM_HEAD.map(() => '---').join(' | ')} |\n\n## Patch points\n\n| ${PATCH_HEAD.join(' | ')} |\n| ${PATCH_HEAD.map(() => '---').join(' | ')} |\n\n## Notes\n\n`;
}

export interface DeviceInput {
  kind?: string;
  site?: string;
  room?: string;
  make?: string;
  model?: string;
  serial?: string;
  asset_tag?: string;
  status?: string;
  assigned?: string;
  purchased?: string | null;
  warranty?: string | null;
  eol?: string | null;
  note?: string;
}
export function newDeviceText(d: DeviceInput): string {
  const day = (v: unknown) => readDay(v) ?? '';
  const front = [
    'type: device',
    `kind: ${yamlWords(knownWord(DEVICE_KINDS, d.kind) || 'Other')}`,
    `site: ${linkProp(d.site)}`,
    `room: ${yamlWords(str(d.room))}`,
    `make: ${yamlWords(str(d.make))}`,
    `model: ${yamlWords(str(d.model))}`,
    `serial: ${yamlWords(str(d.serial))}`,
    `asset_tag: ${yamlWords(str(d.asset_tag))}`,
    `status: ${yamlWords(knownWord(DEVICE_STATUSES, d.status) || 'In use')}`,
    `assigned: ${linkProp(d.assigned)}`,
    `purchased: ${day(d.purchased)}`,
    `warranty: ${day(d.warranty)}`,
    `eol: ${day(d.eol)}`,
  ].map((l) => l.replace(/: ""$/, ':').trimEnd());
  return `---\n${front.join('\n')}\n---\n## Notes\n\n${d.note ? `${d.note}\n` : ''}`;
}

/** A table line for a row, its cells in the table's own column order (`head`), from field values. */
export function rowLine(head: string[], cols: Record<string, number>, values: Record<string, string>): string {
  const cells = head.map(() => '');
  for (const [k, v] of Object.entries(values)) if (cols[k] !== undefined && cols[k] >= 0) cells[cols[k]] = cellText(v);
  return `| ${cells.map((c) => c || ' ').join(' | ')} |`.replace(/\|\s{2,}(?=\|)/g, '|  ');
}

/**
 * The note with a row added to a section's table (the section, and its table, made when missing), its cells matched to
 * the table's own columns; a field the table has no column for gets one (added at its end, every row given an empty cell).
 */
export function withRow(text: string, heading: RegExp, newHeading: string, head: string[], want: Record<string, RegExp>, values: Record<string, string>): string {
  let src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  let at = sectionAt(src, heading);
  if (!at) {
    const notes = sectionAt(src, /^notes$/i);
    const block = `## ${newHeading}${eol}${eol}| ${head.join(' | ')} |${eol}| ${head.map(() => '---').join(' | ')} |${eol}${eol}`;
    if (notes) {
      const headStart = src.lastIndexOf('##', notes.start - 1);
      src = src.slice(0, headStart) + block + src.slice(headStart);
    } else src = `${src.replace(/\s*$/, '')}${eol}${eol}${block}`;
    at = sectionAt(src, heading)!;
  }
  let body = src.slice(at.start, at.end);
  let table = sectionTable(body);
  if (!table || !table.head.length) {
    const t = `| ${head.join(' | ')} |${eol}| ${head.map(() => '---').join(' | ')} |${eol}`;
    body = `${eol}${t}${body.replace(/^\s*/, '')}`;
    table = sectionTable(body)!;
  }
  for (const k of Object.keys(values)) {
    const cols = colsOf(table.head, want);
    if (values[k] && (cols[k] === undefined || cols[k] < 0) && want[k]) {
      body = withColumn(body, head[Object.keys(want).indexOf(k)] ?? k);
      table = sectionTable(body)!;
    }
  }
  const cols = colsOf(table.head, want);
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => TABLE_LINE.test(l));
  let end = start;
  while (end + 1 < lines.length && TABLE_LINE.test(lines[end + 1])) end++;
  lines.splice(end + 1, 0, rowLine(table.head, cols, values));
  body = lines.join(eol);
  return src.slice(0, at.start) + body + src.slice(at.end);
}

/** A section's words with a column added to its first table (header, rule, and an empty cell in each row). */
export function withColumn(body: string, name: string): string {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  let i = lines.findIndex((l) => TABLE_LINE.test(l));
  if (i < 0) return body;
  let first = true;
  for (; i < lines.length && TABLE_LINE.test(lines[i]); i++) {
    const l = lines[i].replace(/\s+$/, '');
    const cells = splitRow(l);
    const shut = l.endsWith('|') ? l : `${l} |`;
    lines[i] = first ? `${shut} ${name} |` : isRule(cells) ? `${shut} --- |` : `${shut}  |`;
    first = false;
  }
  return lines.join(eol);
}

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

export function siteRecords(m: SitesModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const s of m.sites) {
    out.push({
      id: `${s.path}::site`,
      kind: 'site',
      title: s.name,
      path: s.path,
      ...(s.project ? { projectName: s.project } : {}),
      fields: { site_kind: s.kind, code: s.code || null, address: s.address || null, contact: s.contact || null, status: s.status, rooms: s.rooms.length, devices: s.devices, patch_points: s.patch.length, to_patch: s.toPatch, photos: s.photos.length || null },
      links: [],
      ref: { at: 'note', path: s.path },
    });
    for (const r of s.rooms)
      out.push({ id: `${s.path}::room:${r.row}`, kind: 'room', title: r.name || `Room ${r.row + 1}`, path: s.path, fields: { site: s.name, floor: r.floor || null, purpose: r.purpose || null, devices: r.devices }, links: [`${s.path}::site`], ref: { at: 'table', heading: s.roomsHeading ?? 'Rooms', row: r.row, cols: s.roomCols } });
    for (const x of s.patch)
      out.push({
        id: `${s.path}::patch:${x.row}`,
        kind: 'patch',
        title: x.point || `Point ${x.row + 1}`,
        path: s.path,
        fields: { site: s.name, room: x.room || null, switch: x.switch || null, port: x.port || null, vlan: x.vlan || null, device: x.device || null, status: x.status || null, date: x.date ?? (x.dateWords || null) },
        links: [`${s.path}::site`],
        ref: { at: 'table', heading: s.patchHeading ?? 'Patch points', row: x.row, cols: s.patchCols },
      });
  }
  for (const d of m.devices)
    out.push({
      id: `${d.path}::device`,
      kind: 'device',
      title: d.name,
      path: d.path,
      fields: { device_kind: d.kind, site: d.site || null, room: d.room || null, make: d.make || null, model: d.model || null, serial: d.serial || null, asset_tag: d.assetTag || null, status: d.status, assigned: d.assigned || null, purchased: d.purchased, warranty: d.warranty, eol: d.eol, warranty_status: d.lifecycle, photos: d.photos.length || null },
      links: d.sitePath ? [`${d.sitePath}::site`] : [],
      ref: { at: 'note', path: d.path },
    });
  return out;
}

/** The fields of each kind that can be changed where they show. */
export const SITE_EDITABLE: Record<string, string[]> = {
  site: ['site_kind', 'code', 'address', 'contact', 'status'],
  room: ['title', 'floor', 'purpose'],
  device: ['device_kind', 'site', 'room', 'make', 'model', 'serial', 'asset_tag', 'status', 'assigned', 'purchased', 'warranty', 'eol'],
  patch: ['title', 'room', 'switch', 'port', 'vlan', 'device', 'status', 'date'],
};

/** A note record's field → the property it is written as. */
export const SITE_PROPERTY: Record<string, Record<string, string>> = {
  site: { site_kind: 'kind', code: 'code', address: 'address', contact: 'contact', status: 'status', project: 'project' },
  device: { device_kind: 'kind', site: 'site', room: 'room', make: 'make', model: 'model', serial: 'serial', asset_tag: 'asset_tag', status: 'status', assigned: 'assigned', purchased: 'purchased', warranty: 'warranty', eol: 'eol' },
};
export const LINK_PROPS = new Set(['contact', 'assigned', 'site', 'project']);
export const DATE_PROPS = new Set(['purchased', 'warranty', 'eol']);

/** Each page's views as first made. */
export function siteSectionViews(section: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', showDone: true, ...patch });
  switch (section) {
    case 'sites':
      return [v(['site'], 'table', 'Every site', { fields: ['site_kind', 'code', 'address', 'contact', 'status', 'rooms', 'devices', 'to_patch'], sort: { field: 'title', dir: 'asc' } })];
    case 'inventory':
      return [v(['device'], 'table', 'Devices', { fields: ['device_kind', 'room', 'serial', 'asset_tag', 'status', 'assigned', 'warranty'], groupBy: 'site', sort: { field: 'device_kind', dir: 'asc' } })];
    case 'patch':
      return [
        v(['patch'], 'table', 'Patch points', { fields: ['room', 'switch', 'port', 'vlan', 'device', 'status', 'date'], groupBy: 'site', sort: { field: 'title', dir: 'asc' } }),
        v(['patch'], 'calendar', 'Patching on the calendar', { dateField: 'date', fields: ['site'], filters: [{ field: 'status', op: 'is-not', value: 'Live' }] }),
      ];
    case 'lifecycle':
      return [
        v(['device'], 'timeline', 'When each warranty ends', { dateField: 'warranty', fields: ['site'], filters: [{ field: 'warranty', op: 'not-empty' }, { field: 'status', op: 'is-not', value: 'Retired' }] }),
        v(['device'], 'table', 'Warranty and end of life', { fields: ['site', 'serial', 'warranty', 'eol', 'warranty_status'], filters: [{ field: 'status', op: 'is-not', value: 'Retired' }], sort: { field: 'warranty', dir: 'asc' } }),
      ];
  }
  return [];
}

// ── The agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────

export const SITE_TOOLS: WorkToolDef[] = [
  {
    name: 'site_list',
    module: 'sites',
    write: false,
    title: 'Sites',
    step: 'Looked through your sites',
    description: 'Every site (Ironleaf): offices, stores, warehouses and venues, with kind, code, address, contact, status, its project, how many rooms, devices (in use and spare) and patch points still to do. Use it for "what sites do we have?", "which stores have patching to do?".',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words in the site’s name, code or address.' } }, additionalProperties: false },
  },
  {
    name: 'site_register',
    module: 'sites',
    write: false,
    title: 'A site’s register',
    step: 'Read a site’s register',
    description: 'One site’s full register: its details, each room with the devices in it, every patch point (switch, port, VLAN, device, status, date) and every device there with serial, status and warranty. Use it for "what’s in the comms room at X?", "what’s the patch schedule for X?".',
    parameters: { type: 'object', properties: { site: { type: 'string', description: 'The site’s name or code.' } }, required: ['site'], additionalProperties: false },
  },
  {
    name: 'device_find',
    module: 'sites',
    write: false,
    title: 'Find equipment',
    step: 'Looked through your equipment',
    description: 'Find devices in Sites by words (name, serial, asset tag, make, model, who it is assigned to), kind, status (In use, Spare, On order, In repair, Retired) or site. Each comes with site, room, serial, asset tag, status, who has it, and warranty and end-of-life days. Use it for "where is serial ABC123?", "what spares do we have?".',
    parameters: { type: 'object', properties: { query: { type: 'string' }, kind: { type: 'string', enum: [...DEVICE_KINDS] }, status: { type: 'string', enum: [...DEVICE_STATUSES] }, site: { type: 'string', description: 'A site’s name or code.' } }, additionalProperties: false },
  },
  {
    name: 'device_add',
    module: 'sites',
    write: true,
    title: 'Add a device',
    step: 'Added a device to Sites',
    description: 'Add a device to Sites with what the person gave: its kind, make, model, serial, asset tag, site and room, status, who it is assigned to, and purchase, warranty and end-of-life days. Never guess a serial, a day or a site the person didn’t give: leave it out.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...DEVICE_KINDS] },
        make: { type: 'string' },
        model: { type: 'string' },
        serial: { type: 'string' },
        asset_tag: { type: 'string' },
        site: { type: 'string', description: 'A site’s name or code (one already in the module).' },
        room: { type: 'string' },
        status: { type: 'string', enum: [...DEVICE_STATUSES] },
        assigned: { type: 'string', description: 'Who has it.' },
        purchased: { type: 'string', description: 'YYYY-MM-DD' },
        warranty: { type: 'string', description: 'The day its warranty ends, YYYY-MM-DD.' },
        eol: { type: 'string', description: 'Its end-of-life day, YYYY-MM-DD.' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'site_add',
    module: 'sites',
    write: true,
    title: 'Add a site',
    step: 'Added a site',
    description: 'Add a site with what the person gave: its name, kind, code, address, contact, status and project. The window’s New site, for an assistant.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: [...SITE_KINDS] }, code: { type: 'string' }, address: { type: 'string' }, contact: { type: 'string' }, status: { type: 'string', enum: [...SITE_STATUSES] }, project: { type: 'string' } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'site_patch_mark_live',
    module: 'sites',
    write: true,
    title: 'Mark a patch point live',
    step: 'Marked a patch point live',
    description: 'Mark one patch point at a site as Live (patched and working), with the day it went live (today unless given): the site by name or code, and the patch point by its label (A-01, Desk 4). The window’s Mark live, for an assistant.',
    parameters: { type: 'object', properties: { site: { type: 'string', description: 'The site’s name or code.' }, point: { type: 'string', description: 'The patch point’s label.' }, date: { type: 'string', description: 'YYYY-MM-DD (today unless given).' } }, required: ['site', 'point'], additionalProperties: false },
  },
  {
    name: 'site_patch_due',
    module: 'sites',
    write: false,
    title: 'Patch work to do',
    step: 'Put together the patch work list',
    description: 'Patch points still to do (not Live), in walking order: site by site, room by room, overdue and due first. Use it for "what patching is due this week?", "give me the list for the North site". Give a site to keep to one place.',
    parameters: { type: 'object', properties: { site: { type: 'string', description: 'A site’s name or code (optional).' }, days: { type: 'number', description: 'Only work due within this many days (all still to do unless said).' } }, additionalProperties: false },
  },
  {
    name: 'device_retire',
    module: 'sites',
    write: true,
    title: 'Retire a device',
    step: 'Retired a device',
    description: 'Mark a device Retired (by its name, serial or asset tag): it leaves the active counts and its history stays. The window’s Retire, for an assistant.',
    parameters: { type: 'object', properties: { device: { type: 'string', description: 'The device’s name, serial or asset tag.' } }, required: ['device'], additionalProperties: false },
  },
  {
    name: 'equipment_expiring',
    module: 'sites',
    write: false,
    title: 'Warranties and end of life',
    step: 'Checked warranties and end of life',
    description: 'Devices whose warranty ends or which reach end of life soon (and those just passed), with site, serial and the day. Use it for "what warranties are running out?", "what needs replacing this year?".',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'How many days ahead (the module’s own, 90 unless set).' } }, additionalProperties: false },
  },
];

export interface SiteToolInput {
  model: SitesModel;
  on: boolean;
  /** Notes of the module the asker wasn't allowed (so the answer can say so rather than "none"). */
  refused?: number;
  agent?: string;
}

const OFF = 'The Sites module is off in Ironleaf (Settings › Packs). Say so; don’t guess at sites or devices.';
const refusedWords = (i: SiteToolInput) => (i.refused ? `${plural(i.refused, 'site or device note')} ${i.refused === 1 ? 'is' : 'are'} at a level ${i.agent ?? 'this agent'} isn’t allowed (the person sets this in Ironleaf › Settings › Privacy and secrets). Don’t guess at what ${i.refused === 1 ? 'it says' : 'they say'}.` : '');

export function findSite(m: SitesModel, words: unknown): Site | undefined {
  const w = str(words).toLowerCase();
  if (!w) return undefined;
  return m.sites.find((s) => s.name.toLowerCase() === w || s.code.toLowerCase() === w) ?? m.sites.find((s) => s.name.toLowerCase().includes(w) || (!!s.code && w.includes(s.code.toLowerCase())));
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const deviceLine = (d: Device, today: string) =>
  `- ${d.name}: ${d.kind}${d.site ? ` at ${d.site}${d.room ? ` (${d.room})` : ''}` : ', no site'}; ${d.status}${d.serial ? `; serial ${d.serial}` : ''}${d.assetTag ? `; asset ${d.assetTag}` : ''}${d.assigned ? `; with ${d.assigned}` : ''}${d.warranty && d.warrantyDays !== null ? `; ${lowerFirst(lifeWords('warranty', d.warranty, d.warrantyDays, today))}` : ''}${d.eol && d.eolDays !== null ? `; ${lowerFirst(lifeWords('eol', d.eol, d.eolDays, today))}` : ''} [${d.path}]`;
const patchLine = (x: PatchPoint, today: string) => `- ${x.point || `Row ${x.row + 1}`}${x.room ? ` (${x.room})` : ''}: ${[x.switch && `switch ${x.switch}`, x.port && `port ${x.port}`, x.vlan && `VLAN ${x.vlan}`, x.device && `to ${x.device}`].filter(Boolean).join(', ') || 'no switch written'}; ${x.status || 'no status'}${x.date ? ` ${x.open ? 'on' : 'from'} ${dayWords(x.date, today)}` : x.dateWords ? ` (${x.dateWords})` : ''}`;

/** The answer to one of the read tools (null: not one of them). */
export function answerSiteTool(input: SiteToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const tool = SITE_TOOLS.find((t) => t.name === name);
  if (!tool || tool.write) return null;
  if (!input.on) return OFF;
  const m = input.model;
  const refused = refusedWords(input);
  const join = (lines: (string | false | null | undefined)[]) => lines.filter(Boolean).join('\n');
  if (name === 'site_list') {
    const q = str(args.query).toLowerCase();
    const list = m.sites.filter((s) => !q || `${s.name} ${s.code} ${s.address}`.toLowerCase().includes(q));
    if (!list.length) return join([m.sites.length ? 'No site matches that.' : 'No sites yet.', refused]);
    return join([
      `${plural(list.length, 'site')}:`,
      ...list.map((s) => `- ${s.name}${s.code ? ` (${s.code})` : ''}: ${s.kind}, ${s.status}${s.address ? `, ${s.address}` : ''}${s.contact ? `; contact ${s.contact}` : ''}${s.project ? `; project ${s.project}` : ''}; ${plural(s.rooms.length, 'room')}, ${plural(s.devices, 'device')} (${s.inUse} in use, ${s.spare} spare), ${plural(s.patch.length, 'patch point')}${s.toPatch ? ` (${s.toPatch} to do)` : ''} [${s.path}]`),
      refused,
    ]);
  }
  if (name === 'site_register') {
    const s = findSite(m, args.site);
    if (!s) return join([`There is no site called “${str(args.site)}” in Sites.${m.sites.length ? ` Sites: ${m.sites.map((x) => x.name).join(', ')}.` : ''}`, refused]);
    const here = m.devices.filter((d) => d.sitePath === s.path);
    const roomless = here.filter((d) => !s.rooms.some((r) => r.name && r.name.toLowerCase() === d.room.toLowerCase()));
    return join([
      `${s.name}${s.code ? ` (${s.code})` : ''}: ${s.kind}, ${s.status}${s.address ? `, ${s.address}` : ''}${s.contact ? `; contact ${s.contact}` : ''}${s.project ? `; project ${s.project}` : ''}. [${s.path}]`,
      s.rooms.length ? 'Rooms:' : 'No rooms written yet.',
      ...s.rooms.map((r) => {
        const ds = here.filter((d) => d.room.toLowerCase() === r.name.toLowerCase());
        return `- ${r.name}${r.floor ? `, ${r.floor}` : ''}${r.purpose ? `, ${r.purpose}` : ''}: ${ds.length ? ds.map((d) => d.name).join(', ') : 'no devices'}`;
      }),
      roomless.length ? `Not in a room: ${roomless.map((d) => d.name).join(', ')}.` : '',
      s.patch.length ? `Patch points (${s.toPatch} to do):` : 'No patch points written yet.',
      ...s.patch.map((x) => patchLine(x, m.today)),
      here.length ? 'Devices:' : 'No devices at this site yet.',
      ...here.map((d) => deviceLine(d, m.today)),
      s.photos.length ? `${plural(s.photos.length, 'photo')} kept with it.` : '',
      refused,
    ]);
  }
  if (name === 'device_find') {
    const q = str(args.query).toLowerCase();
    const kind = str(args.kind).toLowerCase();
    const status = str(args.status).toLowerCase();
    const site = args.site ? findSite(m, args.site) : undefined;
    if (args.site && !site) return join([`There is no site called “${str(args.site)}”.`, refused]);
    const list = m.devices.filter((d) => (!q || `${d.name} ${d.serial} ${d.assetTag} ${d.make} ${d.model} ${d.assigned}`.toLowerCase().includes(q)) && (!kind || d.kind.toLowerCase() === kind) && (!status || d.status.toLowerCase() === status) && (!site || d.sitePath === site.path));
    if (!list.length) return join([m.devices.length ? 'No device matches that.' : 'No equipment yet.', refused]);
    return join([`${plural(list.length, 'device')}:`, ...list.slice(0, 80).map((d) => deviceLine(d, m.today)), list.length > 80 ? `- … and ${list.length - 80} more` : '', refused]);
  }
  if (name === 'site_patch_due') {
    const site = args.site ? findSite(m, args.site) : undefined;
    if (args.site && !site) return join([`There is no site called “${str(args.site)}” in Sites.`, refused]);
    const days = typeof args.days === 'number' && args.days > 0 ? Math.round(args.days) : null;
    const rows = m.sites.filter((s) => !site || s.path === site.path).flatMap((s) => s.patch.filter((x) => x.open && (days === null || (x.days !== null && x.days <= days))).map((x) => ({ s, x })));
    rows.sort((a, b) => a.s.name.localeCompare(b.s.name) || (a.x.days ?? 9999) - (b.x.days ?? 9999) || a.x.room.localeCompare(b.x.room) || a.x.point.localeCompare(b.x.point));
    if (!rows.length) return join(['No patch work still to do.', refused]);
    return join([`${plural(rows.length, 'patch point')} still to do, in walking order:`, ...rows.map(({ s, x }) => `- ${s.name} · ${patchLine(x, m.today)} [${s.path}]`), refused]);
  }
  if (name === 'equipment_expiring') {
    const days = typeof args.days === 'number' && args.days > 0 ? Math.min(3650, Math.round(args.days)) : m.remindDays;
    const items: { d: Device; words: string; date: string }[] = [];
    for (const d of m.devices) {
      if (RETIRED.test(d.status)) continue;
      if (d.warranty && d.warrantyDays !== null && d.warrantyDays <= days && d.warrantyDays >= -30) items.push({ d, date: d.warranty, words: lifeWords('warranty', d.warranty, d.warrantyDays, m.today) });
      if (d.eol && d.eolDays !== null && d.eolDays <= days) items.push({ d, date: d.eol, words: lifeWords('eol', d.eol, d.eolDays, m.today) });
    }
    items.sort((a, b) => a.date.localeCompare(b.date));
    if (!items.length) return join([`No warranty ends and nothing reaches end of life in the next ${days} days.`, refused]);
    return join([`${plural(items.length, 'warranty or end of life', 'warranties or ends of life')} in the next ${days} days:`, ...items.map((x) => `- ${x.d.name}${x.d.site ? ` at ${x.d.site}` : ''}${x.d.serial ? ` (serial ${x.d.serial})` : ''}: ${x.words} [${x.d.path}]`), refused]);
  }
  return null;
}

export interface PlannedDevice {
  name: string;
  text: string;
  words: string;
}

/** device_add's new note from its arguments (the folder is the caller's). Throws in plain words an agent can pass on. */
export function planDeviceAdd(args: Record<string, unknown>, ctx: { on: boolean; model: SitesModel }): PlannedDevice {
  if (!ctx.on) throw new Error(OFF);
  const kind = knownWord(DEVICE_KINDS, args.kind);
  if (!kind) throw new Error('A device needs its kind (Laptop, POS, Switch…).');
  let site = '';
  if (str(args.site)) {
    const s = findSite(ctx.model, args.site);
    if (!s) throw new Error(`There is no site called “${str(args.site)}” in Sites. Add the site first, or leave the site out.`);
    site = s.name;
  }
  for (const k of ['purchased', 'warranty', 'eol'] as const) if (str(args[k]) && !readDay(args[k])) throw new Error(`Give the ${k === 'eol' ? 'end-of-life' : k} day as YYYY-MM-DD.`);
  const serial = str(args.serial).slice(0, 80);
  if (serial && ctx.model.devices.some((d) => d.serial && d.serial.toLowerCase() === serial.toLowerCase())) throw new Error(`A device with serial ${serial} is already in Sites.`);
  const input: DeviceInput = { kind, site, room: str(args.room).slice(0, 80), make: str(args.make).slice(0, 80), model: str(args.model).slice(0, 80), serial, asset_tag: str(args.asset_tag).slice(0, 80), status: knownWord(DEVICE_STATUSES, args.status) || 'In use', assigned: str(args.assigned).slice(0, 80), purchased: readDay(args.purchased), warranty: readDay(args.warranty), eol: readDay(args.eol) };
  const name = deviceName(input);
  const wd = input.warranty ? `, warranty to ${dayWords(input.warranty, ctx.model.today)}` : '';
  return { name, text: newDeviceText(input), words: `Added ${name} to Sites${site ? ` at ${site}${input.room ? ` (${input.room})` : ''}` : ''}${wd}.` };
}

/** device_retire's change: the device it marks Retired (its history stays). Throws in plain words. */
export function planDeviceRetire(args: Record<string, unknown>, ctx: { on: boolean; model: SitesModel }): { path: string; name: string; status: 'Retired'; words: string } {
  if (!ctx.on) throw new Error(OFF);
  const want = str(args.device).toLowerCase();
  if (!want) throw new Error('Say which device (its name, serial or asset tag).');
  const d = ctx.model.devices.find((x) => x.name.toLowerCase() === want || (!!x.serial && x.serial.toLowerCase() === want) || (!!x.assetTag && x.assetTag.toLowerCase() === want)) ?? ctx.model.devices.find((x) => x.name.toLowerCase().includes(want));
  if (!d) throw new Error(`No device matches “${str(args.device)}” in Sites.`);
  if (/^retired$/i.test(d.status)) throw new Error(`${d.name} is already retired.`);
  return { path: d.path, name: d.name, status: 'Retired', words: `Retired ${d.name}${d.site ? ` at ${d.site}` : ''}. Its history stays.` };
}

/** site_add's new note, from its arguments. Throws in plain words an agent can pass on. */
export function planSiteAdd(args: Record<string, unknown>, ctx: { on: boolean; model: SitesModel }): { name: string; text: string; words: string } {
  if (!ctx.on) throw new Error(OFF);
  const name = str(args.name).slice(0, 100);
  if (!name) throw new Error('A site needs a name.');
  if (ctx.model.sites.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a site called ${name}.`);
  const code = str(args.code).trim().toLowerCase();
  const sameCode = code && ctx.model.sites.find((s) => s.code.trim().toLowerCase() === code);
  if (sameCode) throw new Error(`That code is on ${sameCode.name} already.`);
  const input: SiteInput = { name, kind: str(args.kind).slice(0, 40), code: str(args.code).slice(0, 40), address: str(args.address).slice(0, 200), contact: str(args.contact).slice(0, 100), status: str(args.status).slice(0, 40), project: str(args.project).slice(0, 120) };
  return { name, text: newSiteText(input), words: `Added the site ${name}.` };
}

/**
 * A patch section's words with one point marked Live with its day, both in one change (so a crash between never leaves
 * Live with no date). The row must still be the one shown (its label unchanged). Throws in plain words.
 */
export function applyPatchLive(body: string, row: number, point: string, date: string): string {
  const table = sectionTable(body);
  if (!table || row < 0 || row >= table.rows.length) throw new Error('That row isn’t in the table any more.');
  const cols = colsOf(table.head, PATCH_COLS);
  if (cols.title >= 0 && (table.rows[row][cols.title] ?? '').trim() !== point.trim()) throw new Error('That row changed just now. The page shows it as it is now: make the change again.');
  let b = body;
  for (const [field, name] of [['status', 'Status'], ['date', 'Date']] as const) {
    if (colsOf(sectionTable(b)?.head ?? [], PATCH_COLS)[field] < 0) b = withColumn(b, name);
  }
  const at = colsOf(sectionTable(b)?.head ?? [], PATCH_COLS);
  return setTableCells(b, row, { [at.status]: 'Live', [at.date]: date });
}

/** site_patch_mark_live's patch point: its site's note, its row and the day it went live. Throws in plain words. */
export function planPatchLive(args: Record<string, unknown>, ctx: { model: SitesModel }): { path: string; row: number; point: string; date: string; words: string } {
  const s = findSite(ctx.model, args.site);
  if (!s) throw new Error(`There is no site called “${str(args.site)}” in Sites.`);
  const want = str(args.point).toLowerCase();
  const p = s.patch.find((x) => x.point.toLowerCase() === want) ?? s.patch.filter((x) => x.point.toLowerCase().includes(want));
  const found = Array.isArray(p) ? (p.length === 1 ? p[0] : undefined) : p;
  if (!found) throw new Error(Array.isArray(p) && p.length > 1 ? `More than one patch point at ${s.name} matches “${str(args.point)}”: ${p.map((x) => x.point).join(', ')}.` : `There is no patch point called “${str(args.point)}” at ${s.name}.`);
  const date = str(args.date) ? readDay(args.date) : ctx.model.today;
  if (!date) throw new Error('Give the day it went live as YYYY-MM-DD.');
  return { path: s.path, row: found.row, point: found.point, date, words: `Marked ${found.point} at ${s.name} live.` };
}

/** A site's patch schedule as CSV (UTF-8, a header row first). */
export function patchCsv(s: Site): string {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [['Site', 'Point', 'Room', 'Switch', 'Port', 'VLAN', 'Device', 'Status', 'Date', 'Notes'], ...s.patch.map((x) => [s.name, x.point, x.room, x.switch, x.port, x.vlan, x.device, x.status, x.date ?? x.dateWords, x.notes])];
  return `﻿${rows.map((r) => r.map(q).join(',')).join('\r\n')}\r\n`;
}
