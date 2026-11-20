// Inline fields (V12, 28 Oct 2026): "Key:: value" written in a note's words — on a line of its own, after a list
// bullet, or inside brackets "[Key:: value]" / "(Key:: value)" in a sentence — read as the note's properties, so views,
// Properties and the AI see them beside the ones at the top. They are only read: nothing in them is ever run, and the
// note's text is never rewritten to move them. A property at the top of the note wins over a field of the same name.
// The format is the open, plain-text one people's Markdown folders already use; read from the files alone.

import type { PropValue } from './frontmatter';
import { frontMatterRange } from './frontmatter';

/** A field's name: words, digits, spaces, dashes and underscores, starting with a letter (not "https"). */
const KEY = String.raw`[\p{L}][\p{L}\p{N} _-]{0,62}`;
const LINE_FIELD = new RegExp(String.raw`^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?(?:\[[ xX]\][ \t]+)?(${KEY})::[ \t]*(.*?)[ \t]*$`, 'u');
const BRACKET_FIELD = new RegExp(String.raw`[[(](${KEY})::[ \t]*([^\])\n]*?)[ \t]*[\])]`, 'gu');
const FENCE = /^[ \t]*(```|~~~)/;

export interface InlineField {
  key: string;
  value: PropValue;
  /** The line it is on (0-based, in the whole note). */
  line: number;
}

/** A field's words as a value: a number, a tick, a day, else the words as written (links stay as written). */
export function fieldValue(raw: string): PropValue {
  const t = raw.trim();
  if (!t) return null;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(t) && t.length < 16) return Number(t);
  if (/^(true|yes)$/i.test(t)) return true;
  if (/^(false|no)$/i.test(t)) return false;
  return t;
}

/** Every inline field in a note, in order (front matter and code are skipped). */
export function inlineFields(text: string): InlineField[] {
  // No `::`, no fields of either shape (t102, 9 Nov 2026): the split and the line loop are skipped on ordinary notes.
  if (!text.includes('::')) return [];
  const fm = frontMatterRange(text);
  const skipLines = fm ? text.slice(0, fm.to).split(/\r?\n/).length - 1 : 0;
  const lines = text.split(/\r?\n/);
  const out: InlineField[] = [];
  let fence: string | null = null;
  for (let i = skipLines; i < lines.length; i++) {
    const l = lines[i];
    const f = FENCE.exec(l);
    if (fence) {
      if (f && f[1] === fence) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    if (!l.includes('::')) continue;
    const plain = l.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
    const whole = LINE_FIELD.exec(plain);
    if (whole && !/^\s*(https?|ftp|file|mailto)$/i.test(whole[1])) {
      out.push({ key: whole[1].trim(), value: fieldValue(whole[2]), line: i });
      continue;
    }
    for (const m of plain.matchAll(BRACKET_FIELD)) out.push({ key: m[1].trim(), value: fieldValue(m[2]), line: i });
  }
  return out;
}

/** The fields as properties: a name written twice becomes a list; empty ones are left out. Names are kept as written. */
export function fieldProps(text: string): Record<string, PropValue> {
  const props: Record<string, PropValue> = {};
  for (const f of inlineFields(text)) {
    if (f.value === null) continue;
    const had = props[f.key];
    if (had === undefined) props[f.key] = f.value;
    else props[f.key] = Array.isArray(had) ? [...had, f.value] : [had, f.value];
  }
  return props;
}

/** A field's value changed where it is written (Nov 2026, "everything is editable where shown"): the field keeps
 *  its line and its brackets, only its words change. The name must be written exactly once (missing, or twice, the
 *  caller leaves it alone): null then. Line endings stay as they were. */
export function setInlineField(text: string, key: string, value: string): string | null {
  const at = inlineFields(text).filter((f) => f.key === key);
  if (at.length !== 1) return null;
  const lines = text.split('\n');
  const raw = lines[at[0].line] ?? '';
  const eol = raw.endsWith('\r') ? '\r' : '';
  const line = eol ? raw.slice(0, -1) : raw;
  const plain = line.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
  const words = value.trim();
  const whole = LINE_FIELD.exec(plain);
  if (whole && whole[1].trim() === key) {
    const tail = /[ \t]*$/.exec(whole[0])![0];
    const head = whole[0].slice(0, whole[0].length - whole[2].length - tail.length);
    lines[at[0].line] = line.slice(0, whole.index) + head + words + tail + line.slice(whole.index + whole[0].length) + eol;
    return lines.join('\n');
  }
  for (const m of plain.matchAll(BRACKET_FIELD)) {
    if (m[1].trim() !== key) continue;
    const tail = /[ \t]*[\])]$/.exec(m[0])![0];
    const head = m[0].slice(0, m[0].length - m[2].length - tail.length);
    lines[at[0].line] = line.slice(0, m.index) + head + words + tail + line.slice(m.index + m[0].length) + eol;
    return lines.join('\n');
  }
  return null;
}

/** The note's properties with its inline fields added under them: a property at the top wins (case ignored). */
export function withFields(props: Record<string, PropValue>, text: string): Record<string, PropValue> {
  if (!text.includes('::')) return props;
  const fields = fieldProps(text);
  const keys = Object.keys(fields);
  if (!keys.length) return props;
  const have = new Set(Object.keys(props).map((k) => k.toLowerCase()));
  const out = { ...props };
  for (const k of keys) if (!have.has(k.toLowerCase())) out[k] = fields[k];
  return out;
}
