// Memories and Media on the main side (Wave 7 part b; src/shared/memories.ts). Albums and creative projects are notes in
// Family › Memories and Media; their photos, videos and versions are files kept beside each (its Files folder), so they
// are Family-private as their album is (src/shared/sensitivity.ts fileLevelOf). Who is in a photo and its caption are one
// row of the album's Photos table; a brief's line is one line. Files are only ever added here, never deleted. The bell is
// told when a creative project is nearly due, once.

import { partOn } from '../../shared/life-modules';
import { ALBUM_KINDS, CREATIVE_KINDS, CREATIVE_STATUSES } from '../../shared/life-records';
import { answerMemoryTool, BRIEF_KEYS, findAlbum, memoriesModel, newAlbumText, newCreativeText, PHOTOS, readAlbum, withBriefLine, type BriefKey, type MemoriesModel } from '../../shared/memories';
import { cleanCell, dayWords, namesOf, readDay, str, tableWithCell, tableWithRow, type PropSpec } from '../../shared/personal-records';
import { setNoteProp } from '../../shared/views';
import type { VaultIndex } from '../indexer';
import type { WorkModules, WorkNotice, WorkPart } from '../work-modules';
import { itemWords, namedIn, remindDaysOption, type PersonalPart } from '../personal/common';
import { isMedia } from '../../shared/memories';
import { agentNote, dayOf, keepFiles, kindOfNote, notesOf, O, PICTURES, peopleNames, refusedCount, S, setProp, titleOf } from './common';

export type MemoriesView = MemoriesModel & { folder: string; peopleNames: string[] };

const TYPES = ['album', 'creative-project'];

const PROPS: Record<string, Record<string, PropSpec>> = {
  album: {
    album_kind: { field: 'album_kind', key: 'kind', kind: 'choice', label: 'Kind', options: ALBUM_KINDS },
    date: { field: 'date', key: 'date', kind: 'date', label: 'Day' },
    end: { field: 'end', key: 'end', kind: 'date', label: 'Last day' },
    place: { field: 'place', key: 'place', kind: 'text', label: 'Place' },
    people: { field: 'people', key: 'people', kind: 'links', label: 'People' },
  },
  creative: {
    creative_kind: { field: 'creative_kind', key: 'kind', kind: 'choice', label: 'Kind', options: CREATIVE_KINDS },
    occasion: { field: 'occasion', key: 'occasion', kind: 'text', label: 'Occasion' },
    people: { field: 'people', key: 'people', kind: 'links', label: 'For' },
    status: { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: CREATIVE_STATUSES },
    due: { field: 'due', key: 'due', kind: 'date', label: 'Needed by' },
    album: { field: 'album', key: 'album', kind: 'link', label: 'Album' },
  },
};

export function makeMemories(w: WorkModules): PersonalPart {
  const model = async (index: VaultIndex = w.d.index): Promise<MemoriesModel> => memoriesModel(await notesOf(w, index, TYPES, true), w.today(), await w.remindDays('memories'));

  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => S(x, 80)).filter(Boolean) : namesOf(S(v, 600)));

  const addAlbum = async (input: unknown): Promise<string> => {
    const o = O(input);
    const name = S(o.name, 100);
    if (!name) throw new Error('An album needs a name.');
    const m = await model();
    if (m.albums.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already an album called ${name}.`);
    return w.newNote(await w.folderOf('album'), name, newAlbumText({ kind: S(o.kind, 20), date: dayOf(o.date, 'the day', '2026-12-25'), end: dayOf(o.end, 'the last day', '2026-12-25'), place: S(o.place, 120), people: names(o.people) }));
  };

  const addCreative = async (input: unknown): Promise<string> => {
    const o = O(input);
    const name = S(o.name, 100);
    if (!name) throw new Error('A creative project needs a name.');
    const m = await model();
    if (m.creative.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a project called ${name}.`);
    const brief = Object.fromEntries(BRIEF_KEYS.map((k) => [k.key, S(o[k.key], 600)])) as Record<BriefKey, string>;
    return w.newNote(await w.folderOf('creative-project'), name, newCreativeText({ kind: S(o.kind, 30), occasion: S(o.occasion, 120), people: names(o.people), status: S(o.status, 20), due: dayOf(o.due, 'the day it is needed', '2026-12-25'), album: S(o.album, 100), brief }));
  };

  const setField = async (input: unknown): Promise<string | null> => {
    const o = O(input);
    const rel = S(o.path, 1000);
    const kind = S(o.kind, 20) || kindOfNote(w, rel, { album: 'album', creative: 'creative-project' }, 'That isn’t an album or a creative project.');
    const p = PROPS[kind]?.[S(o.field, 40)];
    if (!p) throw new Error('That can’t be changed here.');
    await setProp(w, rel, p, o.value === null ? '' : o.value);
    if (kind === 'creative' && p.key === 'status' && /^(done|shared)$/i.test(S(o.value))) return `${titleOf(rel)}: ${S(o.value).toLowerCase()}.`;
    return null;
  };

  /** Who is in a photo, its caption and day: its row of the album's Photos table (made the first time). */
  const photo = async (albumRel: unknown, fileName: unknown, values: unknown): Promise<string | null> => {
    const rel = S(albumRel, 1000);
    const file = S(fileName, 260);
    if (!file || /[\\/]/.test(file)) throw new Error('That photo isn’t there any more.');
    const v = O(values);
    const out: Record<string, string> = {};
    if (v.who !== undefined) out.who = names(v.who).join(', ');
    if (v.caption !== undefined) out.caption = S(v.caption, 300).replace(/\r?\n/g, ' ');
    if (v.date !== undefined) out.date = cleanCell(PHOTOS.fields[3], v.date);
    if (!Object.keys(out).length) return null;
    await w.change(rel, (text) => {
      // The table's own rows count as photos too (packs uplift item 5), so the file's row is found by name,
      // never assumed first.
      const a = readAlbum({ path: rel, title: titleOf(rel), props: {}, content: text, type: 'album', files: [`x/${file}`] });
      const row = a.photos.find((p) => p.name.toLowerCase() === file.toLowerCase())?.row ?? -1;
      if (row < 0) return tableWithRow(text, PHOTOS, { file, ...out });
      return Object.entries(out).reduce((t, [k, val], i) => tableWithCell(t, PHOTOS, row, i === 0 ? file : null, k, val), text);
    });
    return null;
  };

  const ops: WorkPart['ops'] = {
    model: async (): Promise<MemoriesView> => ({ ...(await model()), folder: await w.moduleFolder('memories'), peopleNames: await peopleNames(w) }),
    'add-album': (input) => addAlbum(input),
    'add-creative': (input) => addCreative(input),
    'set-field': (input) => setField(input),
    photo: (album, file, values) => photo(album, file, values),
    cover: async (album, file) => {
      const rel = S(album, 1000);
      const f = S(file, 260);
      await w.change(rel, (text) => setNoteProp(text, 'cover', f || null));
      return f ? `${f} is the cover of ${titleOf(rel)} now.` : null;
    },
    brief: async (rel, key, words) => {
      const k = BRIEF_KEYS.find((b) => b.key === key);
      if (!k) throw new Error('That can’t be changed here.');
      await w.change(S(rel, 1000), (text) => withBriefLine(text, k.key, typeof words === 'string' ? words : ''));
      return null;
    },
    'pick-photos': (title) => w.pickFiles(S(title, 120) || 'Choose photos and videos to keep', PICTURES),
    'keep-photos': (rel, files) => keepFiles(w, rel, files, 'photo'),
    'pick-files': (title) => w.pickFiles(S(title, 120) || 'Choose files to keep with it'),
    'keep-files': (rel, files) => keepFiles(w, rel, files, 'file'),
    options: async (patch) => ({ remindDays: await remindDaysOption(w, 'memories', patch) }),
  };

  return {
    id: 'memories',
    ops,
    async inbox(item) {
      if (item.kind !== 'file' || !isMedia(item.path)) return null;
      const m = await model();
      const words = itemWords(item);
      // The album its words name, else the one whose days take in the day it was captured.
      const named = namedIn(words, m.albums, (a) => [a.name, a.place]);
      const day = readDay(String(item.stamp ?? '').replace(/\s+\d{1,2}:\d{2}.*$/, ''));
      const dated = day ? m.albums.find((a) => a.date && a.date <= day && day <= (a.end ?? a.date)) : undefined;
      const a = named ?? dated;
      if (!a) return null;
      return { target: { kind: 'module', module: 'memories', type: 'album', path: a.path, name: a.name, label: `Keep in ${a.name}` }, why: named ? `Names the album ${a.name}` : `Taken during ${a.name}` };
    },
    async fileInbox(item, target) {
      const rel = target.path ?? '';
      if (item.kind !== 'file') throw new Error('Only a photo or video goes into an album.');
      return { words: `Kept ${item.path.split('/').pop()} in ${titleOf(rel)}. It is Family-private, like the album.`, paths: [rel], keepWith: rel };
    },
    async check(): Promise<WorkNotice[]> {
      if (!partOn(w.d.prefs().modules, 'family', 'creative')) return [];
      const m = await model();
      return m.dueSoon.filter((c) => c.dueDays !== null && c.dueDays <= 2).map((c) => ({ key: `mem-due:${c.path}:${c.due}`, kind: 'memories', title: `${c.name} is needed ${c.dueDays! < 0 ? `since ${dayWords(c.due!, m.today)}` : c.dueDays === 0 ? 'today' : c.dueDays === 1 ? 'tomorrow' : `in ${c.dueDays} days`}`, body: [c.kind, c.occasion, c.status].filter(Boolean).join(' · '), path: c.path }));
    },
    async tool(name, args, ctx) {
      const mine = await model(ctx.gated);
      const refused = await refusedCount(w, ctx, TYPES);
      const on = w.isOn('memories');
      const read = answerMemoryTool({ model: mine, on, refused, agent: ctx.agent }, name, args);
      if (read !== null) return read;
      if (!on) throw new Error('The Family pack is off in Ironleaf (Settings › Packs).');
      if (name === 'memory_album_add') {
        const albumName = str(args.name).slice(0, 100);
        if (!albumName) throw new Error('An album needs a name.');
        if (findAlbum(mine, albumName)?.name.toLowerCase() === albumName.toLowerCase()) throw new Error(`There’s already an album called ${albumName}.`);
        for (const k of ['date', 'end'] as const) if (str(args[k]) && !readDay(args[k])) throw new Error('Give the days as YYYY-MM-DD.');
        const rel = await agentNote(w, ctx, await w.folderOf('album'), albumName, newAlbumText({ kind: str(args.kind), date: readDay(args.date), end: readDay(args.end), place: str(args.place).slice(0, 120), people: Array.isArray(args.people) ? (args.people as unknown[]).map((x) => str(x)).filter(Boolean) : [] }));
        return `Made the album ${albumName}. The person adds its photos in Ironleaf. [${rel}]`;
      }
      if (name === 'creative_project_add') {
        const projectName = str(args.name).slice(0, 100);
        if (!projectName) throw new Error('A creative project needs a name.');
        if (mine.creative.some((c) => c.name.toLowerCase() === projectName.toLowerCase())) throw new Error(`There’s already a project called ${projectName}.`);
        if (str(args.due) && !readDay(args.due)) throw new Error('Give the day as YYYY-MM-DD.');
        const brief = Object.fromEntries(BRIEF_KEYS.map((k) => [k.key, str(args[k.key]).slice(0, 600)])) as Record<BriefKey, string>;
        const rel = await agentNote(w, ctx, await w.folderOf('creative-project'), projectName, newCreativeText({ kind: str(args.kind), occasion: str(args.occasion).slice(0, 120), people: Array.isArray(args.people) ? (args.people as unknown[]).map((x) => str(x)).filter(Boolean) : [], due: readDay(args.due), brief }));
        return `Started ${projectName} with its brief. [${rel}]`;
      }
      return `There is no tool called ${name}.`;
    },
    rules: () => 'Memories: use memory_album_list, memory_album_get, memory_search (photos by the captions and people a person wrote) and creative_project_list for the family’s albums and creative projects; make an album with memory_album_add and start a project with creative_project_add from what the person said. Every family photo is Family-private: never use one without the person’s OK for that use, and never guess who is in a photo.',
  };
}
