// Properties: the YAML block between --- lines at the top of a note. Read with a real YAML reader, and changed in
// place so the person's own order, comments and quoting stay as they wrote them.

import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml';

export interface FrontMatterRange {
  /** Where the opening --- starts (always 0). */
  from: number;
  /** Just after the closing --- line (and its line break). */
  to: number;
  /** The YAML between the fences. */
  yaml: string;
}

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m;

export function frontMatterRange(content: string): FrontMatterRange | null {
  const open = OPEN.exec(content);
  if (!open) return null;
  const rest = content.slice(open[0].length);
  // The closing fence can come straight away (an empty block).
  const close = CLOSE.exec(rest);
  if (!close) return null;
  return { from: 0, to: open[0].length + close.index + close[0].length, yaml: rest.slice(0, close.index) };
}

export type PropValue = string | number | boolean | null | PropValue[] | { [key: string]: PropValue };

/**
 * A property value as the pages expect it (8.7.1, 31 Oct 2026, pages that "couldn't show"): dates and date-times as
 * ISO text (a YAML date is midnight UTC, so its UTC day is the day written, on a Melbourne PC and every other),
 * numbers and booleans kept as they are, lists and maps normalised inside. What cannot be read gives nothing.
 */
export function normaliseProp(value: unknown): PropValue {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const day = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
    if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0) return day;
    const hm = `${day}T${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
    return value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0 ? hm : `${hm}:${String(value.getUTCSeconds()).padStart(2, '0')}`;
  }
  if (Array.isArray(value)) return value.map(normaliseProp);
  if (value && typeof value === 'object') {
    const out: Record<string, PropValue> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normaliseProp(v);
    return out;
  }
  return value as PropValue;
}

/** The note's properties, or none when there are none (or they can't be read). */
/** The last YAML block parsed, with both its readings (t102, 9 Nov 2026): readProps and propsReadable
 *  each parsed it on every keystroke, and the block only changes when the top of the note does. Callers read. */
let keptYaml: string | null = null;
let keptProps: Record<string, PropValue> = {};
let keptReadable = true;

/** The YAML block's readings, parsed once per block: each reading keeps its own options (readProps allows
 *  repeated keys and salvages, propsReadable wants a clean map), exactly as each parsed before. */
function readYaml(yaml: string): { props: Record<string, PropValue>; readable: boolean } {
  if (yaml === keptYaml) return { props: keptProps, readable: keptReadable };
  let props: Record<string, PropValue> = {};
  let readable = true;
  if (yaml.trim()) {
    try {
      const doc = parseDocument(yaml, { prettyErrors: false, uniqueKeys: false, logLevel: 'error' });
      if (doc.errors.length) props = salvageProps(yaml);
      else {
        const value = doc.toJS({ maxAliasCount: 50 }) as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value)) props = normaliseProp(value) as Record<string, PropValue>;
      }
    } catch {
      props = {};
    }
    try {
      const strict = parseDocument(yaml, { prettyErrors: false, logLevel: 'error' });
      readable = !strict.errors.length && (strict.contents === null || isMap(strict.contents));
    } catch {
      readable = false;
    }
  }
  keptYaml = yaml;
  keptProps = props;
  keptReadable = readable;
  return { props, readable };
}

export function readProps(content: string): Record<string, PropValue> {
  const range = frontMatterRange(content);
  if (!range) return {};
  return readYaml(range.yaml).props;
}

/** The properties that still read when the block as a whole doesn't: each top-level `key: value` line on its own,
 *  broken lines left out. One bad line never strips the note's type and tags everywhere (9.2). */
function salvageProps(yaml: string): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9][A-Za-z0-9 _-]*):(\s+.*|\s*)$/.exec(line);
    if (!m) continue;
    try {
      const doc = parseDocument(`${m[1]}:${m[2]}`, { prettyErrors: false, uniqueKeys: false, logLevel: 'error' });
      if (doc.errors.length) continue;
      out[m[1].trim()] = normaliseProp((doc.toJS({ maxAliasCount: 50 }) as Record<string, unknown>)[m[1].trim()]);
    } catch {
      // That line stays unread; the rest still count.
    }
  }
  return out;
}

/** Whether the properties block can be read (a broken one is shown as text to fix rather than as properties). */
export function propsReadable(content: string): boolean {
  const range = frontMatterRange(content);
  if (!range) return true;
  return readYaml(range.yaml).readable;
}

/** The note with its properties changed by `mutate` (keys added, set or removed), the rest untouched. */
export function changeProps(content: string, mutate: (doc: Document) => void): string {
  const range = frontMatterRange(content);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const doc = parseDocument(range?.yaml ?? '', { prettyErrors: false, logLevel: 'error' });
  if (doc.errors.length) throw new Error('The properties at the top of this note can’t be read. Fix them in Source mode first.');
  if (doc.contents === null) doc.contents = doc.createNode({}) as never;
  mutate(doc);
  const map = doc.contents;
  const empty = !map || (isMap(map) && map.items.length === 0);
  const body = range ? content.slice(range.to) : content;
  if (empty) return body.replace(/^(\r?\n)+/, '');
  let yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\n+$/, '');
  if (eol === '\r\n') yaml = yaml.replace(/\r?\n/g, '\r\n');
  return `---${eol}${yaml}${eol}---${eol}${range ? body : body.replace(/^(\r?\n)*/, eol === '\r\n' ? '\r\n' : '\n')}`;
}

/** The kind of value a property holds, for the editor shown beside it. */
export type PropKind = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime' | 'tags' | 'aliases';

export function propKind(key: string, value: unknown): PropKind {
  const k = key.toLowerCase();
  if (k === 'tags' || k === 'tag') return 'tags';
  if (k === 'aliases' || k === 'alias') return 'aliases';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(value)) return 'datetime';
  }
  return 'text';
}

/** A value as a list (tags, aliases and lists may be written either way). */
export function asStrings(value: unknown): string[] {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(asStrings);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [String(value)];
}

export { isMap, isScalar, isSeq };

// ── Properties the app keeps for itself (6 Nov 2026, o3-meeting-page item 1) ─────────────────────────────────
// Machine data must never be shown as a property, in any view of any note. One list, here, read by every place
// that lists properties: the note page's field rows (note-page.ts fieldRows), the Properties panel
// (relation-links.ts shownProps, used by components/Properties.tsx), the add-a-property suggestions, the
// indexer's property links, and export columns (portable-export.ts unionFields). The note's file keeps the data
// (its writer still reads it back); Print, PDF and Share never print properties at all (brand-document.ts).
// 'neuralvault-speaker-names' holds each recording's voice names (meeting-speakers.ts SPEAKERS_PROP;
// tests/machine-props pins the two together; o6 moved it off 'speakers' because that word is a person's own).

/** Properties the app keeps for itself, never shown to a person as properties. Lower case, as compared. */
export const MACHINE_PROP_KEYS: readonly string[] = ['neuralvault-speaker-names'];

/** Whether a property is the app's own keeping, not the person's to see or edit (any capitalisation, any padding). */
export function isMachineProp(key: string): boolean {
  return MACHINE_PROP_KEYS.includes(key.trim().toLowerCase());
}

/** A note's properties with the app's own keeping left out, in the note's own order. */
export function visibleProps<T extends Record<string, unknown>>(props: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (!isMachineProp(k)) out[k] = v;
  return out as T;
}
