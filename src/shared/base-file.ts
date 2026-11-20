// .base files as views (21 Oct 2026): the open, YAML-based .base format some other notes apps keep their views over
// notes in, opened as an Ironleaf view so a person's existing ones come across. What Ironleaf has in common with
// the format is read in — filters (and/or/not and comparisons), formulas, headings (display names), summaries, and each
// view's type (table, cards or list), columns, order, grouping and limit — and anything else is kept untouched in the
// file and named in a quiet note. Changing the view here writes back only what changed, into the same YAML document,
// so its comments, its other views and every key Ironleaf doesn't know stay as they were. New views are made as
// .view.json files unless the person asks for the open .base kind when making one.
//
// The format, as its public description gives it: top-level `filters` (for every view), `formulas` (name → formula),
// `properties` (per property, a `displayName`), `summaries` (formulas of its own, read as formulas and written back
// where they were), and `views`, a list of { type, name, limit, groupBy { property, direction }, filters,
// order [property…], sort [{ property, direction }], summaries { property: Average… } }. Filters are formulas as words,
// or { and | or | not: [filters…] }. Properties are written note.x or x, file.x (name, folder, mtime, tags…) and
// formula.x. Ironleaf's own choices that the format has no place for (a board's, calendar's or map's settings) are
// kept under a view's `neuralvault` key.

import { isMap, isSeq, parseDocument, type Document } from 'yaml';
import { simpleFilter } from './formula';
import { defaultView, FIELD_FOLDER, FIELD_MODIFIED, FIELD_TAGS, FIELD_TITLE, formulaKey, formulaName, isFormulaKey, readView, sortsOf, writeView, type SummaryKind, type ViewDef, type ViewFilter, type ViewLayout, type ViewSort } from './views';

export const BASE_EXT = '.base';
export const isBasePath = (path: string | undefined): boolean => !!path && /\.base$/i.test(path);

export interface BaseView {
  def: ViewDef;
  /** In plain words, when the file couldn't be read at all. */
  problem: string | null;
  /** The file's filters for all its views, as formulas every note must meet. */
  where: string[];
  /** The file's views by name, in order, and which one this is. */
  views: string[];
  index: number;
  /** What Ironleaf reads differently or leaves aside (kept in the file as it is), in plain words. */
  notes: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const words = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

const TYPE_TO_LAYOUT: Record<string, ViewLayout> = { table: 'table', cards: 'cards', list: 'list', board: 'board', kanban: 'board', calendar: 'calendar', map: 'map' };
const LAYOUT_TO_TYPE: Record<ViewLayout, string> = { table: 'table', cards: 'cards', list: 'list', board: 'board', calendar: 'calendar', gallery: 'gallery', timeline: 'timeline', chart: 'chart', map: 'map' };
const SUMMARY_NAMES: Record<string, SummaryKind> = { count: 'count', filled: 'filled', empty: 'empty', unique: 'unique', sum: 'sum', average: 'average', mean: 'average', min: 'min', max: 'max', earliest: 'earliest', latest: 'latest' };
const SUMMARY_OUT: Record<SummaryKind, string> = { count: 'Count', filled: 'Filled', empty: 'Empty', unique: 'Unique', sum: 'Sum', average: 'Average', min: 'Min', max: 'Max', earliest: 'Earliest', latest: 'Latest' };
const FILE_IN: Record<string, string> = { name: FIELD_TITLE, basename: FIELD_TITLE, title: FIELD_TITLE, folder: FIELD_FOLDER, mtime: FIELD_MODIFIED, modified: FIELD_MODIFIED, tags: FIELD_TAGS };
const FILE_OUT: Record<string, string> = { [FIELD_TITLE]: 'file.name', [FIELD_FOLDER]: 'file.folder', [FIELD_MODIFIED]: 'file.mtime', [FIELD_TAGS]: 'file.tags' };

/** A property as the file names it (note.status, status, file.mtime, formula.total) → Ironleaf's key, or null. */
export function keyOfRef(ref: string): string | null {
  const r = ref.trim();
  if (!r) return null;
  if (/^note\./i.test(r)) return r.slice(5) || null;
  if (/^formula\./i.test(r)) return r.slice(8) ? formulaKey(r.slice(8)) : null;
  if (/^file\./i.test(r)) return Object.hasOwn(FILE_IN, r.slice(5).toLowerCase()) ? FILE_IN[r.slice(5).toLowerCase()] : null;
  return r;
}

/** Ironleaf's key → the property as the file names it. */
export function refOfKey(key: string): string {
  if (Object.hasOwn(FILE_OUT, key)) return FILE_OUT[key];
  if (isFormulaKey(key)) return key;
  return `note.${key}`;
}

const ONE_WORD = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
/** A key as a formula names it: status, note["due date"], file.mtime, formula.total. */
function exprOfKey(key: string): string {
  if (Object.hasOwn(FILE_OUT, key)) return FILE_OUT[key];
  if (isFormulaKey(key)) return ONE_WORD.test(formulaName(key)) ? key : `formula[${JSON.stringify(formulaName(key))}]`;
  return ONE_WORD.test(key) && !['file', 'note', 'formula', 'this', 'true', 'false', 'null', 'and', 'or', 'not'].includes(key.toLowerCase()) ? key : `note[${JSON.stringify(key)}]`;
}

/** A value as a formula writes it: a number as a number, a tick as true or false, else words in quotes. */
function exprOfValue(v: string): string {
  const t = v.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return t;
  if (/^(?:true|false)$/i.test(t)) return t.toLowerCase();
  return JSON.stringify(t);
}

/** A filter tree (words, or { and | or | not: [...] }) as one formula of Ironleaf's; '' when it says nothing. */
function treeFormula(node: unknown, notes: string[]): string {
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return words(node);
  if (!isObj(node)) return '';
  const key = Object.keys(node).find((k) => ['and', 'or', 'not'].includes(k.toLowerCase()));
  if (!key) {
    notes.push('A filter written in a way Ironleaf doesn’t read is left out here (kept in the file).');
    return '';
  }
  const parts = (Array.isArray(node[key]) ? (node[key] as unknown[]) : [node[key]]).map((n) => treeFormula(n, notes)).filter(Boolean);
  if (!parts.length) return '';
  const op = key.toLowerCase();
  // "not" means none of them.
  if (op === 'not') return parts.map((p) => `!(${p})`).join(' && ');
  return parts.length === 1 ? parts[0] : parts.map((p) => `(${p})`).join(op === 'and' ? ' && ' : ' || ');
}

/** The items of a filter list ANDed together (the top of the tree), each as a formula. */
function andItems(node: unknown, notes: string[]): string[] {
  if (node === undefined || node === null) return [];
  if (isObj(node)) {
    const key = Object.keys(node).find((k) => k.toLowerCase() === 'and');
    if (key && Object.keys(node).length === 1) return (Array.isArray(node[key]) ? (node[key] as unknown[]) : [node[key]]).flatMap((n) => andItems(n, notes));
  }
  if (Array.isArray(node)) return node.flatMap((n) => andItems(n, notes));
  const f = treeFormula(node, notes);
  return f ? [f] : [];
}

/** A view's own filters as Ironleaf's: what it shows (a folder or a tag) and its filter chips; the rest as formulas. */
function readFilters(node: unknown, notes: string[]): { source: ViewDef['source']; filters: ViewFilter[] } {
  const items = andItems(node, notes);
  const shapes = items.map((f) => ({ f, s: simpleFilter(f) }));
  const folders = shapes.filter((x) => x.s?.kind === 'folder');
  const tags = shapes.filter((x) => x.s?.kind === 'tag');
  let source: ViewDef['source'] = { kind: 'all' };
  let used: string | null = null;
  if (folders.length === 1) {
    source = { kind: 'folder', value: (folders[0].s as { value: string }).value.replace(/^\/+|\/+$/g, '') };
    used = folders[0].f;
  } else if (!folders.length && tags.length === 1) {
    source = { kind: 'tag', value: (tags[0].s as { value: string }).value };
    used = tags[0].f;
  }
  const filters: ViewFilter[] = [];
  for (const { f, s } of shapes) {
    if (f === used) continue;
    const key = s && 'ref' in s ? keyOfRef(s.ref) : null;
    if (s && key) {
      if (s.kind === 'compare' && s.value !== null && ['==', '!=', '<', '>'].includes(s.op)) {
        filters.push({ prop: key, op: s.op === '==' ? 'is' : s.op === '!=' ? 'is-not' : s.op === '>' ? 'gt' : 'lt', value: String(s.value) });
        continue;
      }
      if (s.kind === 'contains') {
        filters.push({ prop: key, op: 'contains', value: s.value });
        continue;
      }
      if (s.kind === 'empty' || s.kind === 'not-empty') {
        filters.push({ prop: key, op: s.kind });
        continue;
      }
    }
    filters.push({ prop: '', op: 'matches', value: f });
  }
  return { source, filters };
}

/** Ironleaf's filters (and what the view shows) as the file's filter list. */
function writeFilters(def: ViewDef): string[] {
  const out: string[] = [];
  if (def.source.kind === 'folder' && def.source.value) out.push(`file.inFolder(${JSON.stringify(def.source.value)})`);
  if (def.source.kind === 'tag' && def.source.value) out.push(`file.hasTag(${JSON.stringify(def.source.value)})`);
  for (const f of def.filters) {
    const k = f.prop ? exprOfKey(f.prop) : '';
    const v = f.value ?? '';
    switch (f.op) {
      case 'matches':
        if (v.trim()) out.push(v.trim());
        break;
      case 'is':
      case 'is-not':
      case 'gt':
      case 'lt':
        if (v.trim()) out.push(`${k} ${f.op === 'is' ? '==' : f.op === 'is-not' ? '!=' : f.op === 'gt' ? '>' : '<'} ${exprOfValue(v)}`);
        break;
      case 'contains':
        if (v.trim()) out.push(`${k}.contains(${JSON.stringify(v.trim())})`);
        break;
      case 'empty':
        out.push(`${k}.isEmpty()`);
        break;
      case 'not-empty':
        out.push(`!${k}.isEmpty()`);
        break;
    }
  }
  return out;
}

function readSortList(v: unknown): ViewSort[] {
  const list = Array.isArray(v) ? v : isObj(v) ? [v] : [];
  return list
    .map((x) => (isObj(x) ? { key: keyOfRef(words(x.property)), dir: /^desc/i.test(words(x.direction)) ? ('desc' as const) : ('asc' as const) } : null))
    .filter((x): x is { key: string; dir: 'asc' | 'desc' } => !!x && !!x.key)
    .map((x) => ({ prop: x.key, dir: x.dir }));
}

function parseYaml(text: string): { doc: Document | null; data: Obj | null } {
  if (!text.trim()) return { doc: parseDocument(''), data: {} };
  try {
    const doc = parseDocument(text, { prettyErrors: false, logLevel: 'error', uniqueKeys: false });
    if (doc.errors.length) return { doc: null, data: null };
    const data = doc.toJS({ maxAliasCount: 50 }) as unknown;
    if (data !== null && data !== undefined && !isObj(data)) return { doc: null, data: null };
    return { doc, data: (data as Obj) ?? {} };
  } catch {
    return { doc: null, data: null };
  }
}

/** Which of the file's views: by its name (an embed's ![[x.base#Name]]) or its place; the first when not found. */
function viewIndex(views: unknown[], part?: string | number): number {
  if (typeof part === 'number') return part >= 0 && part < views.length ? part : 0;
  if (part) {
    const at = views.findIndex((v) => isObj(v) && words(v.name).toLowerCase() === part.trim().toLowerCase());
    if (at >= 0) return at;
  }
  return 0;
}

/** A .base file read as an Ironleaf view (one of its views: the first, or the one named or numbered). */
export function readBase(text: string, part?: string | number): BaseView {
  const { data } = parseYaml(text);
  if (!data) return { def: defaultView(), problem: 'This .base file couldn’t be read, so it shows every note as a table. Changing anything here writes the file afresh.', where: [], views: [], index: 0, notes: [] };
  const notes: string[] = [];
  const views = Array.isArray(data.views) ? data.views : [];
  const index = viewIndex(views, part);
  const view: Obj = isObj(views[index]) ? (views[index] as Obj) : {};
  const own: Obj = isObj(view.neuralvault) ? (view.neuralvault as Obj) : {};
  const def = defaultView();

  const type = words(view.type).toLowerCase();
  def.layout = Object.hasOwn(TYPE_TO_LAYOUT, type) ? TYPE_TO_LAYOUT[type] : 'table';
  if (type && !Object.hasOwn(TYPE_TO_LAYOUT, type)) notes.push(`A “${type}” view isn’t something Ironleaf draws, so this one shows as a table.`);

  // Formulas: kept word for word; one using a function Ironleaf doesn't know shows why in its cells.
  if (isObj(data.formulas)) for (const [name, f] of Object.entries(data.formulas)) if (name.trim() && words(f) && name !== '__proto__') def.formulas[name.trim()] = words(f);
  // The file's own summary formulas: read as formulas too (the `formulas` section wins a shared name, and says so).
  if (isObj(data.summaries)) {
    for (const [name, f] of Object.entries(data.summaries)) {
      const key = name.trim();
      if (!key || key === '__proto__' || !words(f)) continue;
      if (Object.hasOwn(def.formulas, key)) notes.push(`The file’s own “${key}” summary has the same name as a formula, so the formula is used.`);
      else def.formulas[key] = words(f);
    }
  } else if (data.summaries !== undefined) notes.push('The file’s own summaries are written in a way Ironleaf doesn’t read, so they stay in the file as they are.');

  // Headings: a property's display name.
  if (isObj(data.properties))
    for (const [ref, conf] of Object.entries(data.properties)) {
      const key = keyOfRef(ref);
      const name = isObj(conf) ? words(conf.displayName) : '';
      if (key && name && key !== '__proto__') def.labels[key] = name;
    }

  const order = Array.isArray(view.order) ? view.order.map((r) => words(r)).filter(Boolean) : [];
  const unknownCols = order.filter((r) => !keyOfRef(r));
  if (unknownCols.length) notes.push(`${unknownCols.length === 1 ? 'A column' : `${unknownCols.length} columns`} (${unknownCols.join(', ')}) Ironleaf can’t show ${unknownCols.length === 1 ? 'is' : 'are'} left out here.`);
  def.columns = [...new Set(order.map(keyOfRef).filter((k): k is string => !!k && k !== FIELD_TITLE))];

  const sorts = readSortList(view.sort);
  if (sorts.length) {
    def.sort = sorts[0];
    if (sorts.length > 1) def.sorts = sorts;
  }

  const group = isObj(view.groupBy) ? readSortList([view.groupBy])[0] : typeof view.groupBy === 'string' ? readSortList([{ property: view.groupBy }])[0] : undefined;
  if (group && def.layout === 'board') def.groupBy = group.prop;
  else if (group) def.sectionBy = group;

  if (typeof view.limit === 'number' && view.limit >= 1) def.limit = Math.floor(view.limit);

  if (isObj(view.summaries))
    for (const [ref, how] of Object.entries(view.summaries)) {
      const key = keyOfRef(ref);
      const kind = SUMMARY_NAMES[words(how).toLowerCase()];
      if (key && kind && Object.hasOwn(SUMMARY_NAMES, words(how).toLowerCase())) def.summaries[key] = kind;
      else if (words(how)) notes.push(`The “${words(how)}” summary isn’t one Ironleaf works out.`);
    }

  // Keys Ironleaf has no use for: named, and kept in the file as they are.
  const VIEW_KEYS = ['type', 'name', 'filters', 'order', 'sort', 'groupby', 'limit', 'summaries', 'image', 'neuralvault'];
  const unusedView = Object.keys(view).filter((k) => !VIEW_KEYS.includes(k.toLowerCase()));
  if (unusedView.length) notes.push(`This view’s ${unusedView.map((k) => `“${k}”`).join(', ')} ${unusedView.length === 1 ? 'isn’t' : 'aren’t'} used here.`);
  const unusedTop = Object.keys(data).filter((k) => !['filters', 'formulas', 'properties', 'summaries', 'views'].includes(k.toLowerCase()));
  if (unusedTop.length) notes.push(`The file’s ${unusedTop.map((k) => `“${k}”`).join(', ')} ${unusedTop.length === 1 ? 'isn’t' : 'aren’t'} used here.`);
  const columnSettings = isObj(data.properties) ? [...new Set(Object.values(data.properties).flatMap((c) => (isObj(c) ? Object.keys(c).filter((k) => k !== 'displayName') : [])))] : [];
  if (columnSettings.length) notes.push(`Column settings other than their names (${columnSettings.join(', ')}) aren’t used here.`);

  const image = keyOfRef(words(view.image));
  if (image) def.cover = image;

  const { source, filters } = readFilters(view.filters, notes);
  def.source = source;
  def.filters = filters;
  const where = andItems(data.filters, notes);

  // Ironleaf's own choices for a board, calendar or map, which the format has no place for.
  const mine = readView(JSON.stringify({ layout: def.layout, cardProps: own.cardProps, dateProp: own.dateProp, placeProp: own.placeProp, hiddenGroups: own.hiddenGroups, collapsedGroups: own.collapsedGroups, groupOrder: own.groupOrder, rollups: own.rollups, form: own.form })).def;
  Object.assign(def, { cardProps: mine.cardProps, hiddenGroups: mine.hiddenGroups, collapsedGroups: mine.collapsedGroups, groupOrder: mine.groupOrder, rollups: mine.rollups, ...(mine.form ? { form: mine.form } : {}), ...(mine.dateProp ? { dateProp: mine.dateProp } : {}), ...(mine.placeProp ? { placeProp: mine.placeProp } : {}) });

  return { def, problem: null, where, views: views.map((v, i) => (isObj(v) && words(v.name)) || `View ${i + 1}`), index, notes: [...new Set(notes)] };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The .base file with one of its views changed to `def`: only what differs from what the file says now is written,
 * into the same YAML document, so comments, other views and keys Ironleaf doesn't know are kept. A file that
 * couldn't be read is written afresh with this one view.
 */
export function writeBase(text: string, def: ViewDef, part?: string | number): string {
  let { doc, data } = parseYaml(text);
  if (!doc || !data) {
    doc = parseDocument('');
    data = {};
  }
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as never;
  const was = readBase(doc.toString(), part);
  const views = Array.isArray(data.views) ? data.views : [];
  if (!isSeq(doc.get('views'))) doc.set('views', doc.createNode([]));
  const index = views.length ? was.index : 0;
  if (!views.length) doc.setIn(['views', 0], doc.createNode({ type: LAYOUT_TO_TYPE[def.layout], name: 'Table' }));
  const at = (...keys: (string | number)[]) => ['views', index, ...keys];
  const setOrDrop = (path: (string | number)[], value: unknown) => {
    if (value === undefined || value === null || (Array.isArray(value) && !value.length) || (isObj(value) && !Object.keys(value).length)) {
      if (doc!.hasIn(path)) doc!.deleteIn(path);
    } else doc!.setIn(path, doc!.createNode(value));
  };
  const before = was.def;

  if (def.layout !== before.layout) doc.setIn(at('type'), LAYOUT_TO_TYPE[def.layout]);
  if (!same(def.columns, before.columns)) setOrDrop(at('order'), ['file.name', ...def.columns.map(refOfKey)]);
  // Every order, in order (a changed first order rewrites the list, so none is silently dropped).
  const sorts = sortsOf(def);
  const sortsWas = sortsOf(before);
  if (!same(sorts, sortsWas)) setOrDrop(at('sort'), sorts.length ? sorts.map((s) => ({ property: refOfKey(s.prop), direction: s.dir === 'desc' ? 'DESC' : 'ASC' })) : undefined);
  const group = def.layout === 'board' ? (def.groupBy ? { prop: def.groupBy, dir: 'asc' as const } : undefined) : def.sectionBy;
  const groupWas = before.layout === 'board' ? (before.groupBy ? { prop: before.groupBy, dir: 'asc' as const } : undefined) : before.sectionBy;
  if (!same(group, groupWas)) setOrDrop(at('groupBy'), group ? { property: refOfKey(group.prop), direction: group.dir === 'desc' ? 'DESC' : 'ASC' } : undefined);
  if (def.limit !== before.limit) setOrDrop(at('limit'), def.limit);
  if (def.cover !== before.cover) setOrDrop(at('image'), def.cover ? refOfKey(def.cover) : undefined);
  if (!same(def.source, before.source) || !same(def.filters, before.filters)) {
    const list = writeFilters(def);
    setOrDrop(at('filters'), list.length ? { and: list } : undefined);
  }
  if (!same(def.summaries, before.summaries)) setOrDrop(at('summaries'), Object.fromEntries(Object.entries(def.summaries).map(([k, v]) => [refOfKey(k), SUMMARY_OUT[v]])));

  // The formulas and headings belong to the whole file: only the ones that changed are touched. A formula the file
  // keeps under its own summaries is written back there, never moved under formulas.
  if (!same(def.formulas, before.formulas)) {
    const topNames = new Set(isObj(data.summaries) ? Object.keys(data.summaries) : []);
    const formulaNames = new Set(isObj(data.formulas) ? Object.keys(data.formulas) : []);
    const home = (name: string): string => (topNames.has(name) && !formulaNames.has(name) ? 'summaries' : 'formulas');
    for (const name of Object.keys(before.formulas)) if (!Object.hasOwn(def.formulas, name)) doc.deleteIn([home(name), name]);
    for (const [name, f] of Object.entries(def.formulas)) if (before.formulas[name] !== f) doc.setIn([home(name), name], f);
    for (const section of ['formulas', 'summaries']) if (isMap(doc.get(section)) && !(doc.get(section) as { items: unknown[] }).items.length) doc.delete(section);
  }
  if (!same(def.labels, before.labels)) {
    const props = isObj(data.properties) ? data.properties : {};
    const refFor = (key: string) => Object.keys(props).find((r) => keyOfRef(r) === key) ?? refOfKey(key);
    for (const key of Object.keys(before.labels)) if (!Object.hasOwn(def.labels, key)) doc.deleteIn(['properties', refFor(key), 'displayName']);
    for (const [key, name] of Object.entries(def.labels)) if (before.labels[key] !== name) doc.setIn(['properties', refFor(key), 'displayName'], name);
  }

  // Ironleaf's own choices for a board, calendar or map, kept where the format has no place for them.
  const mine = JSON.parse(writeView({ ...defaultView(), layout: def.layout, cardProps: def.cardProps, dateProp: def.dateProp, placeProp: def.placeProp, hiddenGroups: def.hiddenGroups, collapsedGroups: def.collapsedGroups, groupOrder: def.groupOrder, rollups: def.rollups, form: def.form })) as Obj;
  const mineWas = JSON.parse(writeView({ ...defaultView(), layout: before.layout, cardProps: before.cardProps, dateProp: before.dateProp, placeProp: before.placeProp, hiddenGroups: before.hiddenGroups, collapsedGroups: before.collapsedGroups, groupOrder: before.groupOrder, rollups: before.rollups, form: before.form })) as Obj;
  for (const k of ['version', 'source', 'layout']) {
    delete mine[k];
    delete mineWas[k];
  }
  if (!same(mine, mineWas)) setOrDrop(at('neuralvault'), mine);

  return doc.toString({ lineWidth: 0 });
}

/** A view file of either kind read as a view (.view.json, or .base: one of its views by name or place). */
export function readViewFile(path: string, text: string, part?: string | number): BaseView {
  if (isBasePath(path)) return readBase(text, part);
  const { def, problem } = readView(text);
  return { def, problem, where: [], views: [], index: 0, notes: [] };
}

/** A view file of either kind with its view changed. */
export function writeViewFile(path: string, text: string, def: ViewDef, part?: string | number): string {
  return isBasePath(path) ? writeBase(text, def, part) : writeView(def);
}
