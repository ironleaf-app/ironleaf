// Sites and Equipment on the main side (Wave 6 part b; src/shared/work-sites.ts). Its notes read from the index (the whole
// index for the window, an agent's gated one for its tools), each change written as one property or one table cell of
// the note it belongs to (every other character kept), files kept beside a record, the bell told of warranties ending,
// ends of life and patching due (each said once), and its tools through each agent's gate.

import path from 'node:path';
import { setTableCells, removeTableRow } from '../../shared/layouts';
import { partOn } from '../../shared/life-modules';
import { setNoteProp } from '../../shared/views';
import { DEVICE_KINDS, DEVICE_STATUSES, PATCH_STATUSES, SITE_KINDS, SITE_STATUSES, projectNameKeys } from '../../shared/work-modules';
import {
  answerSiteTool,
  applyPatchLive,
  colsOf,
  dayWords,
  DATE_PROPS,
  deviceName,
  knownWord,
  linkName,
  LINK_PROPS,
  newDeviceText,
  newSiteText,
  PATCH_COLS,
  PATCH_HEAD,
  PATCH_HEADING,
  patchCsv,
  planDeviceAdd,
  planDeviceRetire,
  planPatchLive,
  planSiteAdd,
  readDay,
  ROOM_COLS,
  ROOM_HEAD,
  ROOMS_HEADING,
  sectionAt,
  sectionTable,
  SITE_EDITABLE,
  SITE_PROPERTY,
  sitesModel,
  withColumn,
  withRow,
  type DeviceInput,
  type SiteInput,
  type SiteNote,
  type SitesModel,
} from '../../shared/work-sites';
import type { VaultIndex } from '../indexer';
import type { WorkModules, WorkNotice, WorkPart } from '../work-modules';

export type SitesView = SitesModel & { folder: string; people: string[]; projects: { path: string; name: string }[] };

const TYPES = ['site', 'device'];
const S = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');

export function makeSites(w: WorkModules): WorkPart {
  const notes = async (index: VaultIndex, withFiles = true): Promise<SiteNote[]> => {
    const list = await w.notesOf(index, TYPES);
    const out: SiteNote[] = [];
    for (const n of list) out.push({ path: n.path, title: n.title, props: n.props, content: n.content, type: n.type, ...(withFiles ? { files: await w.filesOf(n.path) } : {}) });
    return out;
  };
  const model = async (index: VaultIndex = w.d.index): Promise<SitesModel> => sitesModel(await notes(index), w.today(), await w.remindDays('sites'));

  const view = async (): Promise<SitesView> => {
    const m = await model();
    const people = (await w.notesOf(w.d.index, ['person'])).map((n) => n.title).sort((a, b) => a.localeCompare(b));
    return { ...m, folder: await w.moduleFolder('sites'), people, projects: w.d.projects() };
  };

  /** A section's words changed by `change` (the whole note written once). */
  const inSection = (text: string, heading: RegExp, change: (body: string) => string): string => {
    const at = sectionAt(text, heading);
    if (!at) throw new Error('That table isn’t in the note any more.');
    const body = text.slice(at.start, at.end);
    const next = change(body);
    return next === body ? text : text.slice(0, at.start) + next + text.slice(at.end);
  };

  const which = (kind: unknown) => (kind === 'rooms' || kind === 'room' ? { heading: ROOMS_HEADING, want: ROOM_COLS, head: ROOM_HEAD, name: 'Rooms' } : kind === 'patch' ? { heading: PATCH_HEADING, want: PATCH_COLS, head: PATCH_HEAD, name: 'Patch points' } : null);

  /** One cell of a row of a site's table, its column found by name (added when the table has none). The row must still
   *  be the one shown (its name unchanged), else nothing is written and the page is asked to look again. */
  const setCell = async (rel: string, kind: 'room' | 'patch', row: number, shownTitle: string | null, field: string, words: string): Promise<void> => {
    const t = which(kind)!;
    await w.change(rel, (text) =>
      inSection(text, t.heading, (body) => {
        let table = sectionTable(body);
        if (!table || row < 0 || row >= table.rows.length) throw new Error('That row isn’t in the table any more.');
        let cols = colsOf(table.head, t.want);
        if (shownTitle !== null && cols.title >= 0 && (table.rows[row][cols.title] ?? '').trim() !== shownTitle.trim()) throw new Error('That row changed just now. The page shows it as it is now: make the change again.');
        let b = body;
        if (cols[field] === undefined || cols[field] < 0) {
          const name = t.head[Object.keys(t.want).indexOf(field)];
          if (!name) throw new Error('That can’t be changed here.');
          b = withColumn(b, name);
          table = sectionTable(b)!;
          cols = colsOf(table.head, t.want);
        }
        return setTableCells(b, row, { [cols[field]]: words });
      }),
    );
  };

  const cleanCell = (field: string, value: unknown): string => {
    const v = S(value, 200).replace(/\r?\n/g, ' ');
    if (field === 'date') {
      if (!v) return '';
      const d = readDay(v);
      if (!d) throw new Error('Give a day, like 2026-11-03.');
      return d;
    }
    if (field === 'status') return v ? knownWord(PATCH_STATUSES, v) : '';
    return v;
  };

  const setField = async (input: unknown): Promise<string | null> => {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const kind = S(o.kind, 20);
    const field = S(o.field, 40);
    const rel = S(o.path, 1000);
    if (!SITE_EDITABLE[kind]?.includes(field) && !(kind === 'site' && field === 'project')) throw new Error('That can’t be changed here.');
    if (!rel) throw new Error('That record isn’t there any more.');
    if (kind === 'room' || kind === 'patch') {
      const ref = (o.ref && typeof o.ref === 'object' ? o.ref : {}) as Record<string, unknown>;
      const row = typeof ref.row === 'number' ? ref.row : typeof o.row === 'number' ? o.row : -1;
      const shown = typeof o.title === 'string' ? o.title : null;
      const words = cleanCell(field, o.value);
      if (field === 'title' && !words) throw new Error(kind === 'room' ? 'A room needs a name.' : 'A patch point needs its label.');
      await setCell(rel, kind, row, shown, field, words);
      return null;
    }
    const key = SITE_PROPERTY[kind]?.[field];
    if (!key) throw new Error('That can’t be changed here.');
    const raw = typeof o.value === 'boolean' ? '' : S(o.value, 200);
    let value: string | null;
    if (DATE_PROPS.has(key)) {
      value = raw ? readDay(raw) : null;
      if (raw && !value) throw new Error('Give a day, like 2027-03-31.');
    } else if (LINK_PROPS.has(key)) value = linkName(raw) ? `[[${linkName(raw)}]]` : null;
    else if (key === 'kind') value = knownWord(kind === 'site' ? SITE_KINDS : DEVICE_KINDS, raw) || null;
    else if (key === 'status') value = knownWord(kind === 'site' ? SITE_STATUSES : DEVICE_STATUSES, raw) || null;
    else value = raw || null;
    await w.change(rel, (text) => setNoteProp(text, key, value));
    if (kind === 'device' && key === 'status' && value === 'Retired') return 'Marked retired: it no longer counts at its site or comes up for warranty.';
    return null;
  };

  const addSite = async (input: unknown): Promise<string> => {
    const i = (input ?? {}) as SiteInput;
    const name = S(i.name, 100);
    if (!name) throw new Error('A site needs a name.');
    const m = await model();
    if (m.sites.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a site called ${name}.`);
    return w.newNote(await w.folderOf('site'), name, newSiteText({ name, kind: S(i.kind, 40), code: S(i.code, 40), address: S(i.address, 200), contact: S(i.contact, 100), status: S(i.status, 40), project: S(i.project, 120) }));
  };

  const addDevice = async (input: unknown): Promise<string> => {
    const i = (input ?? {}) as DeviceInput & { name?: string };
    for (const k of ['purchased', 'warranty', 'eol'] as const) if (S(i[k]) && !readDay(i[k])) throw new Error(`Give the ${k === 'eol' ? 'end-of-life' : k} day as a day, like 2027-03-31.`);
    const serial = S(i.serial, 80);
    const m = await model();
    if (serial && m.devices.some((d) => d.serial.toLowerCase() === serial.toLowerCase())) throw new Error(`A device with serial ${serial} is already here.`);
    const clean: DeviceInput = { kind: S(i.kind, 40) || 'Other', site: S(i.site, 100), room: S(i.room, 80), make: S(i.make, 80), model: S(i.model, 80), serial, asset_tag: S(i.asset_tag, 80), status: S(i.status, 40) || 'In use', assigned: S(i.assigned, 100), purchased: readDay(i.purchased), warranty: readDay(i.warranty), eol: readDay(i.eol) };
    const name = S(i.name, 100) || deviceName(clean);
    return w.newNote(await w.folderOf('device'), name, newDeviceText(clean));
  };

  const addRow = async (rel: unknown, kind: unknown, values: unknown): Promise<string> => {
    const t = which(kind);
    if (!t) throw new Error('That can’t be added here.');
    const r = S(rel, 1000);
    const v = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of Object.keys(t.want)) if (v[k] !== undefined) out[k] = cleanCell(k, v[k]);
    if (!out.title) throw new Error(t.name === 'Rooms' ? 'A room needs a name.' : 'A patch point needs its label (A-01, Desk 4…).');
    await w.change(r, (text) => withRow(text, t.heading, t.name, t.head, t.want, out));
    return t.name === 'Rooms' ? `Added the room ${out.title}.` : `Added patch point ${out.title}.`;
  };

  const removeRow = async (rel: unknown, kind: unknown, row: unknown, shown: unknown): Promise<string> => {
    const t = which(kind);
    if (!t || typeof row !== 'number') throw new Error('That row isn’t there any more.');
    let gone = '';
    await w.change(S(rel, 1000), (text) =>
      inSection(text, t.heading, (body) => {
        const table = sectionTable(body);
        const cols = colsOf(table?.head ?? [], t.want);
        const r = table?.rows[row];
        if (!r) throw new Error('That row isn’t in the table any more.');
        gone = (r[cols.title] ?? '').trim();
        if (typeof shown === 'string' && cols.title >= 0 && gone !== shown.trim()) throw new Error('That row changed just now. Look again, then take it out.');
        return removeTableRow(body, row);
      }),
    );
    return `Took ${gone || 'the row'} out of ${t.name.toLowerCase()}. It is kept in the note’s history (File recovery).`;
  };

  const moveDevice = async (rel: unknown, to: unknown): Promise<string> => {
    const r = S(rel, 1000);
    const o = (to && typeof to === 'object' ? to : {}) as Record<string, unknown>;
    const name = path.posix.basename(r, '.md');
    await w.change(r, (text) => {
      let t = text;
      if (o.site !== undefined) t = setNoteProp(t, 'site', S(o.site) ? `[[${linkName(o.site)}]]` : null);
      if (o.room !== undefined) t = setNoteProp(t, 'room', S(o.room) || null);
      if (o.status !== undefined) t = setNoteProp(t, 'status', knownWord(DEVICE_STATUSES, o.status) || null);
      if (o.assigned !== undefined) t = setNoteProp(t, 'assigned', S(o.assigned) ? `[[${linkName(o.assigned)}]]` : null);
      return t;
    });
    if (o.status === 'Spare') return `${name} is in the spare pool${S(o.site) ? ` at ${linkName(o.site)}` : ''}.`;
    return `Moved ${name}${S(o.site) ? ` to ${linkName(o.site)}` : ''}${S(o.room) ? ` (${S(o.room)})` : ''}.`;
  };

  const exportCsv = async (rel: unknown): Promise<string | null> => {
    const m = await model();
    const s = m.sites.find((x) => x.path === S(rel, 1000));
    if (!s) throw new Error('That site isn’t there any more.');
    if (!s.patch.length) throw new Error(`${s.name} has no patch points to export yet.`);
    return w.d.saveFile({ title: 'Export the patch schedule', name: `${s.name} patch schedule`, ext: 'csv', filter: 'CSV (spreadsheet)', data: patchCsv(s) });
  };

  /** What a project's page shows from this module: its sites (and their devices) and what needs attention there. */
  const project = async (projectPath: unknown) => {
    const p = w.d.projects().find((x) => x.path === S(projectPath, 1000));
    if (!p) return { tile: null, attention: [] };
    const m = await model();
    const keys = projectNameKeys(p);
    const mine = m.sites.filter((s) => s.project && keys.includes(s.project.toLowerCase()));
    if (!mine.length) return { tile: null, attention: [] };
    const paths = new Set(mine.map((s) => s.path));
    const attention: { words: string; path: string; tone: 'bad' | 'warn' }[] = [];
    for (const x of m.toPatch.filter((x) => paths.has(x.site) && x.days !== null && x.days <= 7)) attention.push({ words: `Patch ${x.point} at ${x.siteName} ${x.days! < 0 ? `was due ${dayWords(x.date!, m.today)}` : x.days === 0 ? 'today' : `by ${dayWords(x.date!, m.today)}`}`, path: x.site, tone: x.days! < 0 ? 'bad' : 'warn' });
    for (const l of m.lifecycle.filter((l) => l.device.sitePath && paths.has(l.device.sitePath))) attention.push({ words: `${l.device.name} at ${l.device.site}: ${l.words.charAt(0).toLowerCase()}${l.words.slice(1)}`, path: l.device.path, tone: l.days < 0 ? 'bad' : 'warn' });
    return {
      tile: { title: mine.length === 1 ? 'Site' : 'Sites', rows: mine.map((s) => ({ words: s.name, sub: [s.kind, s.code, `${s.devices} ${s.devices === 1 ? 'device' : 'devices'}`, s.toPatch ? `${s.toPatch} to patch` : ''].filter(Boolean).join(' · '), path: s.path, detail: { kind: 'site', key: s.path } })) },
      attention,
    };
  };

  const ops: WorkPart['ops'] = {
    model: () => view(),
    'set-field': (input) => setField(input),
    'add-site': (input) => addSite(input),
    'add-device': (input) => addDevice(input),
    'add-room': (rel, values) => addRow(rel, 'rooms', values),
    'add-patch': (rel, values) => addRow(rel, 'patch', values),
    'remove-row': (rel, kind, row, shown) => removeRow(rel, kind, row, shown),
    'pick-photos': (title) => w.pickFiles(S(title, 120) || 'Choose photos to keep with it', [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'avif', 'bmp'] }, { name: 'Any file', extensions: ['*'] }]),
    'keep-photos': async (rel, files) => {
      const kept = await w.keepFiles(S(rel, 1000), Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : []);
      return kept.length ? `Kept ${kept.length === 1 ? 'a photo' : `${kept.length} photos`} with ${path.posix.basename(S(rel, 1000), '.md')}.` : 'Nothing was kept (the files couldn’t be read).';
    },
    'move-device': (rel, to) => moveDevice(rel, to),
    'export-patch-csv': (rel) => exportCsv(rel),
    project: (p) => project(p),
    options: async (patch) => {
      if (patch && typeof patch === 'object' && typeof (patch as { remindDays?: unknown }).remindDays === 'number') await w.setOptions('sites', { remindDays: (patch as { remindDays: number }).remindDays });
      return { remindDays: await w.remindDays('sites') };
    },
  };

  return {
    id: 'sites',
    ops,
    async check(): Promise<WorkNotice[]> {
      const sw = w.d.prefs().modules;
      const m = await model();
      const out: WorkNotice[] = [];
      if (partOn(sw, 'sites', 'lifecycle'))
        for (const l of m.lifecycle) {
          if (l.days < 0 && l.what === 'warranty') continue; // a warranty already ended is shown on the page, not said again
          out.push({ key: `site-life:${l.device.path}:${l.what}:${l.date}${l.days < 0 ? ':passed' : ''}`, kind: 'sites', title: l.what === 'warranty' ? `${l.device.name}’s warranty ends ${l.days === 0 ? 'today' : `in ${l.days} days`}` : l.days < 0 ? `${l.device.name} has reached end of life` : `${l.device.name} reaches end of life ${l.days === 0 ? 'today' : `in ${l.days} days`}`, body: [l.device.site, l.device.serial && `serial ${l.device.serial}`, dayWords(l.date, m.today)].filter(Boolean).join(' · '), path: l.device.path });
        }
      if (partOn(sw, 'sites', 'patch'))
        for (const x of m.toPatch.filter((x) => x.due)) out.push({ key: `site-patch:${x.site}:${x.point}:${x.date}`, kind: 'sites', title: `Patch ${x.point} at ${x.siteName} ${x.days === 0 ? 'today' : 'is overdue'}`, body: [x.room, x.switch && x.port ? `${x.switch} port ${x.port}` : x.port, x.device, dayWords(x.date!, m.today)].filter(Boolean).join(' · '), path: x.site });
      return out;
    },
    async tool(name, args, ctx) {
      const full = ctx.gated === w.d.index ? null : (await w.notesOf(w.d.index, TYPES)).length;
      const mine = await model(ctx.gated);
      const refused = full === null ? 0 : Math.max(0, full - (mine.sites.length + mine.devices.length));
      if (name === 'site_patch_mark_live') {
        if (!w.isOn('sites')) throw new Error('The Sites module is off in Ironleaf (Settings › Packs).');
        const live = planPatchLive(args, { model: mine });
        ctx.check?.(live.path);
        await w.change(live.path, (text) => inSection(text, PATCH_HEADING, (body) => applyPatchLive(body, live.row, live.point, live.date)));
        return `${live.words} [${live.path}]`;
      }
      if (name === 'device_retire') {
        const plan = planDeviceRetire(args, { on: w.isOn('sites'), model: mine });
        ctx.check?.(plan.path);
        await w.change(plan.path, (text) => setNoteProp(text, 'status', 'Retired'));
        return `${plan.words} [${plan.path}]`;
      }
      if (name !== 'device_add' && name !== 'site_add') return answerSiteTool({ model: mine, on: w.isOn('sites'), refused, agent: ctx.agent }, name, args) ?? `There is no tool called ${name}.`;
      const plan = name === 'site_add' ? planSiteAdd(args, { on: w.isOn('sites'), model: mine }) : planDeviceAdd(args, { on: w.isOn('sites'), model: mine });
      const rel = await w.freeNote(await w.folderOf(name === 'site_add' ? 'site' : 'device'), plan.name);
      ctx.check?.(rel);
      await w.d.requireCreate();
      await w.d.writeNote(rel, plan.text);
      return `${plan.words} [${rel}]`;
    },
    rules: () => 'Sites: use site_list, site_register (one site’s rooms, patch points and devices), device_find (by serial, asset tag, kind, status or site; "Spare" is the spare pool), site_patch_due for the patch list and equipment_expiring for warranties and end of life; add a site with site_add, a device with device_add, mark a patch point live with site_patch_mark_live and retire kit with device_retire, only with the details the person gave (never guess a serial, a day or a site).',
  };
}
