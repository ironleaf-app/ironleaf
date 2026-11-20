// Memories and Media (Wave 7 part b, 24 Oct 2026; module 11 of the catalogue: "Photo albums, family creative projects
// (posters, cards), videos · Albums by person and event; protected faces · Family-private"). Each record is a plain note
// in Family › Memories and Media, its photos and videos kept beside it in its Files folder:
//
//   Family/Memories and Media/Albums/Beach weekend.md    type: album — kind (Event, Person, Trip, Year…), date, end,
//                                                        place, people, cover; "## Photos" | File | Who | Caption | Date |
//   …/Albums/Files/Beach weekend/IMG_0412.jpg            the photos and videos themselves
//   Family/Memories and Media/Creative projects/Sports day poster.md
//                                                        type: creative-project — kind, occasion, people, status, due,
//                                                        album; "## Brief" (Purpose, Audience, Tone, Must-haves)
//   …/Creative projects/Files/Sports day poster/…        each version of it
//
// Protected faces: every photo and video here is Family-private, as its album or project is (src/shared/sensitivity.ts
// fileLevelOf), so an assistant allowed Family-private still needs the person's OK each time it uses one, and one that
// isn't allowed never sees it; who is in a photo is written by the person, never worked out from faces. Pure: no files,
// no Node, no DOM.

import { ALBUM_KINDS, CREATIVE_KINDS, CREATIVE_STATUSES } from './life-records';
import { defaultRecordView, type RecordViewDef } from './record-views';
import type { WsRecord } from './workspace-records';
import type { WorkToolDef } from './work-module-tools';
import { fileVersion } from './file-records';
import { dayWords, daysFrom, findByName, join, knownWord, linkName, namesOf, plural, readDay, readTable, refusedWords, sectionAt, str, todayOf, whenWords, type TableSpec } from './personal-records';

export const PHOTOS: TableSpec = {
  id: 'photos',
  name: 'Photos',
  heading: /^(photos?|pictures?|videos?|media)$/i,
  fields: [
    { key: 'file', label: 'File', col: /^(file|photo|picture|name|image)$/i, kind: 'text' },
    { key: 'who', label: 'Who', col: /^(who|people|faces|in it|with)$/i, kind: 'text' },
    { key: 'caption', label: 'Caption', col: /^(caption|what|about|note|title)$/i, kind: 'text' },
    { key: 'date', label: 'Date', col: /^(date|when|taken)$/i, kind: 'date' },
  ],
  title: 'file',
  one: 'photo',
};

export const BRIEF_HEADING = /^(brief|the brief|creative brief)$/i;
export const BRIEF_KEYS = [
  { key: 'purpose', label: 'Purpose', re: /^purpose$/i },
  { key: 'audience', label: 'Audience', re: /^(audience|for|who it.s for)$/i },
  { key: 'tone', label: 'Tone', re: /^(tone|style|feel)$/i },
  { key: 'must', label: 'Must-haves', re: /^(must[- ]haves?|must have|needs)$/i },
] as const;
export type BriefKey = (typeof BRIEF_KEYS)[number]['key'];

const PICTURE = /\.(png|jpe?g|gif|webp|avif|heic|heif|bmp)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
export const isMedia = (rel: string) => PICTURE.test(rel) || VIDEO.test(rel);
const baseName = (rel: string) => rel.split('/').pop() ?? rel;

export interface MemoryNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
  /** Files kept beside it, newest first. */
  files?: string[];
}

export interface Photo {
  /** The file in the vault. */
  rel: string;
  name: string;
  /** Its row in the album's Photos table (-1: not written there yet). */
  row: number;
  who: string[];
  caption: string;
  date: string | null;
  video: boolean;
  album: string;
  albumName: string;
}

export interface Album {
  path: string;
  name: string;
  kind: string;
  date: string | null;
  end: string | null;
  place: string;
  people: string[];
  /** The cover's file, else the first photo. */
  cover: string | null;
  photos: Photo[];
  videos: number;
  /** Rows of the Photos table whose file isn't beside the album (moved or not copied yet). */
  missing: string[];
}

export interface CreativeVersion {
  rel: string;
  name: string;
  /** "v2" from its name, else its place in time ("Version 3"). */
  label: string;
  picture: boolean;
}

export interface Creative {
  path: string;
  name: string;
  kind: string;
  occasion: string;
  people: string[];
  status: string;
  due: string | null;
  dueDays: number | null;
  album: string;
  albumPath: string | null;
  brief: Record<BriefKey, string>;
  versions: CreativeVersion[];
  /** Other files kept with it (not pictures or videos). */
  files: string[];
}

export interface PersonPhotos {
  name: string;
  photos: Photo[];
  /** Albums they are named in (as one of its people, or in one of its photos). */
  albums: string[];
}

export interface MemoriesModel {
  albums: Album[];
  people: PersonPhotos[];
  creative: Creative[];
  /** Albums from this day (or this week) in earlier years. */
  onThisDay: { album: Album; years: number }[];
  /** Creative projects due within the module's days and not done. */
  dueSoon: Creative[];
  today: string;
  remindDays: number;
}

export function readAlbum(n: MemoryNote): Album {
  const files = (n.files ?? []).filter(isMedia);
  const table = readTable(n.content, PHOTOS);
  const rowOf = new Map(table.rows.map((r) => [r.values.file.replace(/^!?\[\[|\]\]$/g, '').toLowerCase(), r]));
  const photos: Photo[] = files.map((rel) => {
    const r = rowOf.get(baseName(rel).toLowerCase());
    return { rel, name: baseName(rel), row: r ? r.row : -1, who: r ? namesOf(r.values.who) : [], caption: r?.values.caption ?? '', date: r ? readDay(r.values.date) : null, video: VIDEO.test(rel), album: n.path, albumName: n.title };
  });
  // A hand-written Photos table is read, never ignored (packs uplift item 5): rows whose file is not beside the
  // note still count as photos (shown with a tile until the file is added), so the count agrees with the table.
  const have = new Set(files.map((f) => baseName(f).toLowerCase()));
  const seen = new Set(have);
  for (const r of table.rows) {
    const file = r.values.file.replace(/^!?\[\[|\]\]$/g, '');
    if (!file || seen.has(file.toLowerCase()) || seen.has(baseName(file).toLowerCase()) || !isMedia(file)) continue;
    seen.add(baseName(file).toLowerCase());
    photos.push({ rel: file, name: baseName(file), row: r.row, who: namesOf(r.values.who), caption: r.values.caption ?? '', date: readDay(r.values.date), video: VIDEO.test(file), album: n.path, albumName: n.title });
  }
  photos.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const coverName = linkName(n.props.cover).toLowerCase();
  const cover = photos.find((p) => !p.video && coverName && p.name.toLowerCase() === coverName)?.rel ?? photos.find((p) => !p.video)?.rel ?? null;
  return {
    path: n.path,
    name: n.title,
    kind: knownWord(ALBUM_KINDS, n.props.kind) || 'Event',
    date: readDay(n.props.date),
    end: readDay(n.props.end),
    place: str(n.props.place),
    people: namesOf(n.props.people),
    cover,
    photos,
    videos: photos.filter((p) => p.video).length,
    missing: table.rows.map((r) => r.values.file).filter((f) => f && !have.has(f.replace(/^!?\[\[|\]\]$/g, '').toLowerCase())),
  };
}

/** The Brief's lines ("- Purpose: a poster for sports day") by their key. */
export function briefOf(text: string): Record<BriefKey, string> {
  const out = { purpose: '', audience: '', tone: '', must: '' } as Record<BriefKey, string>;
  const src = String(text ?? '');
  const at = sectionAt(src, BRIEF_HEADING);
  if (!at) return out;
  for (const line of src.slice(at.start, at.end).split(/\r?\n/)) {
    const m = /^\s*(?:[-*+]\s+)?\**([^:*]+?)\**\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = BRIEF_KEYS.find((b) => b.re.test(m[1].trim()));
    if (k && !out[k.key]) out[k.key] = m[2].trim();
  }
  return out;
}

export function readCreative(n: MemoryNote, today: string, albums: readonly Album[]): Creative {
  const files = n.files ?? [];
  const pics = files.filter(isMedia);
  const due = readDay(n.props.due);
  const album = linkName(n.props.album);
  return {
    path: n.path,
    name: n.title,
    kind: knownWord(CREATIVE_KINDS, n.props.kind) || 'Other',
    occasion: str(n.props.occasion),
    people: namesOf(n.props.people),
    status: knownWord(CREATIVE_STATUSES, n.props.status) || 'Idea',
    due,
    dueDays: due ? daysFrom(today, due) : null,
    album,
    albumPath: album ? (albums.find((a) => a.name.toLowerCase() === album.toLowerCase())?.path ?? null) : null,
    brief: briefOf(n.content),
    versions: pics.map((rel, i) => ({ rel, name: baseName(rel), label: fileVersion(baseName(rel)) ?? `Version ${pics.length - i}`, picture: PICTURE.test(rel) })),
    files: files.filter((f) => !isMedia(f)),
  };
}

export function memoriesModel(notes: readonly MemoryNote[], today: Date | string = new Date(), remindDays = 7): MemoriesModel {
  const t = todayOf(today);
  const albums = notes
    .filter((n) => n.type === 'album')
    .map(readAlbum)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.name.localeCompare(b.name));
  const creative = notes
    .filter((n) => n.type === 'creative-project')
    .map((n) => readCreative(n, t, albums))
    .sort((a, b) => CREATIVE_STATUSES.indexOf(a.status as never) - CREATIVE_STATUSES.indexOf(b.status as never) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const byPerson = new Map<string, PersonPhotos>();
  const personOf = (name: string) => {
    const k = name.toLowerCase();
    if (!byPerson.has(k)) byPerson.set(k, { name, photos: [], albums: [] });
    return byPerson.get(k)!;
  };
  for (const a of albums) {
    for (const p of a.people) if (!personOf(p).albums.includes(a.path)) personOf(p).albums.push(a.path);
    for (const ph of a.photos)
      for (const w of ph.who) {
        const pp = personOf(w);
        pp.photos.push(ph);
        if (!pp.albums.includes(a.path)) pp.albums.push(a.path);
      }
  }
  const people = [...byPerson.values()].sort((a, b) => b.photos.length - a.photos.length || a.name.localeCompare(b.name));
  // On this day: an album whose days take in today's day and month in an earlier year (within three days).
  const md = (iso: string) => iso.slice(5);
  const near = (iso: string) => {
    const a = new Date(2000, Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
    const b = new Date(2000, Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)));
    return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000)) <= 3;
  };
  const onThisDay = albums
    .filter((a) => a.date && a.date.slice(0, 4) < t.slice(0, 4) && (near(a.date) || (a.end && md(a.date) <= md(t) && md(t) <= md(a.end))))
    .map((a) => ({ album: a, years: Number(t.slice(0, 4)) - Number(a.date!.slice(0, 4)) }));
  const dueSoon = creative.filter((c) => !/^(done|shared)$/i.test(c.status) && c.dueDays !== null && c.dueDays <= remindDays);
  return { albums, people, creative, onThisDay, dueSoon, today: t, remindDays };
}

// ── Changes to a note's words ────────────────────────────────────────────────────────────────────────────────────────

/** A Brief line set ("- Tone: playful"), the line or the Brief made when missing; every other line kept. */
export function withBriefLine(text: string, key: BriefKey, words: string): string {
  const src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const k = BRIEF_KEYS.find((b) => b.key === key)!;
  const clean = words.replace(/\r?\n/g, ' ').trim().slice(0, 600);
  const at = sectionAt(src, BRIEF_HEADING);
  if (!at) {
    const firstHead = src.search(/^## /m);
    const block = `## Brief${eol}${eol}- ${k.label}: ${clean}${eol}${eol}`;
    return firstHead >= 0 ? src.slice(0, firstHead) + block + src.slice(firstHead) : `${src.replace(/\s*$/, '')}${eol}${eol}${block}`;
  }
  const lines = src.slice(at.start, at.end).split(/\r?\n/);
  const i = lines.findIndex((l) => {
    const m = /^\s*(?:[-*+]\s+)?\**([^:*]+?)\**\s*:/.exec(l);
    return !!m && k.re.test(m[1].trim());
  });
  if (i >= 0) lines[i] = lines[i].replace(/^(\s*(?:[-*+]\s+)?\**[^:*]+?\**\s*:).*$/, (_m, head: string) => (clean ? `${head} ${clean}` : head));
  else {
    let last = -1;
    lines.forEach((l, j) => void (/^\s*[-*+]\s+/.test(l) && (last = j)));
    lines.splice(last >= 0 ? last + 1 : lines[0] === '' ? 1 : 0, 0, `- ${k.label}: ${clean}`);
  }
  return src.slice(0, at.start) + lines.join(eol) + src.slice(at.end);
}

// ── New notes ────────────────────────────────────────────────────────────────────────────────────────────────────────

const yq = (s: string) => JSON.stringify(s);
const linksProp = (k: string, names: string[]) => `${k}: [${names.map((n) => linkName(n)).filter(Boolean).map((n) => yq(`[[${n}]]`)).join(', ')}]`;

export function newAlbumText(i: { kind?: string; date?: string | null; end?: string | null; place?: string; people?: string[] }): string {
  return `---\ntype: album\nkind: ${knownWord(ALBUM_KINDS, i.kind) || 'Event'}\ndate:${i.date ? ` ${i.date}` : ''}\nend:${i.end ? ` ${i.end}` : ''}\nplace:${str(i.place) ? ` ${yq(str(i.place))}` : ''}\n${linksProp('people', i.people ?? [])}\ncover:\n---\n## Photos\n\n| File | Who | Caption | Date |\n| --- | --- | --- | --- |\n\n## Notes\n\n`;
}

/** A Family album (a folder of photos, Family › Assets) as a Memories album note: every photo kept as a row of its
 *  Photos table, so nothing the person made is lost when Family's Albums move into Memories (8.2, 29 Oct 2026). */
export function newFamilyAlbumText(_name: string, files: string[]): string {
  const base = newAlbumText({ kind: 'Collection' });
  const rows = files.map((f) => `| ${f.split('/').pop()!.replace(/\|/g, '\\|')} |  |  |  |`).join('\n');
  return rows ? base.replace('| --- | --- | --- | --- |\n', `| --- | --- | --- | --- |\n${rows}\n`) : base;
}

export function newCreativeText(i: { kind?: string; occasion?: string; people?: string[]; status?: string; due?: string | null; album?: string; brief?: Partial<Record<BriefKey, string>> }): string {
  const b = i.brief ?? {};
  return `---\ntype: creative-project\nkind: ${yq(knownWord(CREATIVE_KINDS, i.kind) || 'Poster')}\noccasion:${str(i.occasion) ? ` ${yq(str(i.occasion))}` : ''}\n${linksProp('people', i.people ?? [])}\nstatus: ${knownWord(CREATIVE_STATUSES, i.status) || 'Idea'}\ndue:${i.due ? ` ${i.due}` : ''}\nalbum:${linkName(i.album) ? ` ${yq(`[[${linkName(i.album)}]]`)}` : ''}\n---\n## Brief\n\n${BRIEF_KEYS.map((k) => `- ${k.label}: ${str(b[k.key])}`.trimEnd()).join('\n')}\n\n## Notes\n\n`;
}

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

export function memoryRecords(m: MemoriesModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const a of m.albums) out.push({ id: `${a.path}::album`, kind: 'album', title: a.name, path: a.path, fields: { album_kind: a.kind, date: a.date, end: a.end, place: a.place || null, people: a.people.join(', ') || null, photos: a.photos.length - a.videos, videos: a.videos || null }, links: [], ref: { at: 'note', path: a.path } });
  for (const c of m.creative) out.push({ id: `${c.path}::creative`, kind: 'creative', title: c.name, path: c.path, fields: { creative_kind: c.kind, occasion: c.occasion || null, status: c.status, due: c.due, people: c.people.join(', ') || null, versions: c.versions.length || null }, links: c.albumPath ? [`${c.albumPath}::album`] : [], ref: { at: 'note', path: c.path } });
  return out;
}

export const MEMORY_EDITABLE: Record<string, string[]> = {
  album: ['album_kind', 'date', 'end', 'place'],
  creative: ['creative_kind', 'occasion', 'status', 'due'],
};

export function memorySectionViews(section: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', showDone: true, ...patch });
  if (section === 'creative') return [v(['creative'], 'board', 'From idea to shared', { groupBy: 'status', groupOrder: [...CREATIVE_STATUSES], fields: ['creative_kind', 'due', 'people'] })];
  if (section === 'albums') return [v(['album'], 'timeline', 'Albums through the years', { dateField: 'date', endField: 'end', fields: ['place'] })];
  return [];
}

// ── The agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────

const PROTECTED = 'Every photo and video here is Family-private: using one needs the person’s OK each time (ask for it by its path and Ironleaf asks them). Never describe a face you haven’t been allowed to see.';

export const MEMORY_TOOLS: WorkToolDef[] = [
  {
    name: 'memory_album_list',
    module: 'memories',
    write: false,
    title: 'Photo albums',
    step: 'Looked through the photo albums',
    description: 'The family’s photo albums in Memories (Ironleaf): each with its kind (event, trip, person, year), days, place, the people in it and how many photos and videos, and albums from this day in earlier years. Never the photos themselves.',
    parameters: { type: 'object', properties: { person: { type: 'string', description: 'Only albums with this person in them.' } }, additionalProperties: false },
  },
  {
    name: 'memory_album_get',
    module: 'memories',
    write: false,
    title: 'An album',
    step: 'Read an album',
    description: 'One album’s details and each photo’s file name, who the person wrote is in it, caption and date. The photos are Family-private: using one asks the person each time.',
    parameters: { type: 'object', properties: { album: { type: 'string' } }, required: ['album'], additionalProperties: false },
  },
  {
    name: 'memory_album_add',
    module: 'memories',
    write: true,
    title: 'Make an album',
    step: 'Made a photo album',
    description: 'Make a photo album with what the person said: its name, kind (Event, Person, Trip, Year, Everyday, Collection), days, place and the people in it. Photos are added by the person in Ironleaf.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: [...ALBUM_KINDS] }, date: { type: 'string', description: 'YYYY-MM-DD' }, end: { type: 'string', description: 'YYYY-MM-DD' }, place: { type: 'string' }, people: { type: 'array', items: { type: 'string' } } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'memory_search',
    module: 'memories',
    write: false,
    title: 'Search the albums’ words',
    step: 'Searched the words written about the photos',
    description: 'Find photos and albums by the words a person wrote: captions, who is in a photo, an album’s place or people, and file names, across every album. File names and words only, never the photos themselves. Use it for "find the beach photos with Grandma".',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for (every word must appear).' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'creative_project_list',
    module: 'memories',
    write: false,
    title: 'Creative projects',
    step: 'Looked through the family’s creative projects',
    description: 'The family’s creative projects (posters, cards, invitations, photo books, videos) with their status, who they are for, the day they are needed, their brief (purpose, audience, tone, must-haves) and how many versions are kept.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'creative_project_add',
    module: 'memories',
    write: true,
    title: 'Start a creative project',
    step: 'Started a creative project',
    description: 'Start a family creative project with its brief: name, kind, occasion, who it is for, the day it is needed, and its purpose, audience, tone and must-haves, from what the person said.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: [...CREATIVE_KINDS] }, occasion: { type: 'string' }, people: { type: 'array', items: { type: 'string' } }, due: { type: 'string', description: 'YYYY-MM-DD' }, purpose: { type: 'string' }, audience: { type: 'string' }, tone: { type: 'string' }, must: { type: 'string', description: 'Must-haves.' } }, required: ['name'], additionalProperties: false },
  },
];

const OFF = 'The Family pack is off in Ironleaf (Settings › Packs). Say so; don’t guess at the family’s albums.';

export interface MemoryToolInput {
  model: MemoriesModel;
  on: boolean;
  refused?: number;
  agent?: string;
}

const albumLine = (a: Album, today: string) => `- ${a.name} (${a.kind}${a.date ? `, ${dayWords(a.date, today)}${a.end ? ` to ${dayWords(a.end, today)}` : ''}` : ''}${a.place ? `, ${a.place}` : ''}): ${plural(a.photos.length - a.videos, 'photo')}${a.videos ? `, ${plural(a.videos, 'video')}` : ''}${a.people.length ? `; with ${a.people.join(', ')}` : ''} [${a.path}]`;

export const findAlbum = (m: MemoriesModel, words: unknown) => findByName(m.albums, words, (a) => [a.name]);

export function answerMemoryTool(input: MemoryToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const tool = MEMORY_TOOLS.find((t) => t.name === name);
  if (!tool || tool.write) return null;
  if (!input.on) return OFF;
  const m = input.model;
  const refused = refusedWords(input.refused, 'album or project note', input.agent);
  if (name === 'memory_album_list') {
    const who = str(args.person).toLowerCase();
    const list = m.albums.filter((a) => !who || a.people.some((p) => p.toLowerCase() === who) || a.photos.some((p) => p.who.some((w) => w.toLowerCase() === who)));
    if (!list.length) return join([m.albums.length ? 'No album matches that.' : 'No photo albums yet.', refused]);
    return join([`${plural(list.length, 'album')}:`, ...list.map((a) => albumLine(a, m.today)), m.onThisDay.length ? `On this day: ${m.onThisDay.map((x) => `${x.album.name} (${plural(x.years, 'year')} ago)`).join(', ')}.` : '', PROTECTED, refused]);
  }
  if (name === 'memory_album_get') {
    const a = findAlbum(m, args.album);
    if (!a) return join([`There is no album called “${str(args.album)}”.${m.albums.length ? ` Albums: ${m.albums.map((x) => x.name).join(', ')}.` : ''}`, refused]);
    return join([albumLine(a, m.today), ...a.photos.slice(0, 200).map((p) => `  - ${p.name}${p.video ? ' (video)' : ''}${p.who.length ? `: ${p.who.join(', ')}` : ''}${p.caption ? ` — ${p.caption}` : ''}${p.date ? ` (${dayWords(p.date, m.today)})` : ''} [${p.rel}]`), a.photos.length > 200 ? `  - … and ${a.photos.length - 200} more` : '', PROTECTED, refused]);
  }
  if (name === 'memory_search') {
    const words = str(args.query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return join(['Say the words to look for (a caption, a person, a place).', refused]);
    const has = (text: string) => words.every((w) => text.toLowerCase().includes(w));
    const hits: string[] = [];
    for (const a of m.albums) for (const p of a.photos) if (has(`${p.name} ${p.caption} ${p.who.join(' ')} ${a.name} ${a.place} ${a.people.join(' ')}`)) hits.push(`- ${p.name}${p.video ? ' (video)' : ''} in ${a.name}${p.who.length ? `: ${p.who.join(', ')}` : ''}${p.caption ? ` — ${p.caption}` : ''}${p.date ? ` (${dayWords(p.date, m.today)})` : ''} [${p.rel}]`);
    if (!hits.length) return join([`No photo or album matches “${str(args.query)}”. Captions and who-is-in-them are written by a person, so a photo with nothing written will not be found this way.`, refused]);
    return join([`${plural(hits.length, 'photo')} matching “${str(args.query)}”:`, ...hits.slice(0, 60), hits.length > 60 ? `- … and ${hits.length - 60} more` : '', PROTECTED, refused]);
  }
  if (name === 'creative_project_list') {
    if (!m.creative.length) return join(['No creative projects yet.', refused]);
    return join([
      `${plural(m.creative.length, 'creative project')}:`,
      ...m.creative.map((c) => `- ${c.name} (${c.kind}${c.occasion ? `, ${c.occasion}` : ''}): ${c.status}${c.due ? `, needed ${dayWords(c.due, m.today)} (${whenWords(c.dueDays ?? 0)})` : ''}${c.people.length ? `; for ${c.people.join(', ')}` : ''}${c.brief.purpose ? `; purpose: ${c.brief.purpose}` : ''}${c.brief.audience ? `; audience: ${c.brief.audience}` : ''}${c.brief.tone ? `; tone: ${c.brief.tone}` : ''}${c.brief.must ? `; must-haves: ${c.brief.must}` : ''}; ${plural(c.versions.length, 'version')} kept [${c.path}]`),
      refused,
    ]);
  }
  return null;
}

export { ALBUM_KINDS, CREATIVE_KINDS, CREATIVE_STATUSES };
