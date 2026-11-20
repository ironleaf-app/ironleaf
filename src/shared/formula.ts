// Formulas in views (21 Oct 2026): a column worked out from a note's properties — "price * quantity", "if(done, 'Yes',
// 'Not yet')", "daysBetween(today(), due)" — usable as a column, an order, a filter or a group like any property.
//
// A small language of our own, read by hand here and never handed to eval or Function, so a formula in a view file
// someone sent can only ever work out a value: no loops, no reaching outside the note it is given, nothing written.
// What it reads:
//   numbers 12, 4.5 · words "Done" or 'Done' · true, false, null · lists [1, 2]
//   a property by its name (status, due) · note.status · note["due date"] · another formula: formula.total
//   the note's own fields: file.title, file.folder, file.modified, file.tags (file.name, file.mtime, file.path too)
//   + - * / %  ·  == != < <= > >=  ·  && || ! (and, or, not)  ·  ( )
//   functions: if, concat, lower, upper, trim, length, round, floor, ceil, abs, min, max, now, today, daysBetween,
//   dateAdd, date, number, text, toFixed, join, contains, empty, hasTag, inFolder
//   and any function written after a value: status.lower() is lower(status), file.hasTag("x") is hasTag(file, "x").
//
// Days are worked out as local days (a property written 2026-10-24 is that day here, wherever "here" is); a day that
// comes out of a formula is written back as 2026-10-24 (or 2026-10-24T09:30 with a time), the way notes write days, so
// a formula's day sorts, groups and goes on a calendar like any other. Something that can't be worked out — a word
// where a number is needed, a function Ironleaf doesn't know — gives a FormulaFault with the reason in plain words,
// shown as a quiet dash with the reason on hover; it never stops the view.

import { daysBetween as wholeDays, isoDay, readDay } from './days';

/** A formula that couldn't be worked out for a note, and why (in words a person can act on). */
export class FormulaFault {
  constructor(readonly reason: string) {}
}
export const isFault = (v: unknown): v is FormulaFault => v instanceof FormulaFault;

/** What a formula can read about the note it is worked out for. */
export interface FormulaScope {
  /** A property's value by its name (any case); undefined when the note hasn't it. */
  prop(name: string): unknown;
  /** One of the note's own fields. */
  file(field: 'title' | 'folder' | 'modified' | 'tags' | 'path'): unknown;
  /** Another formula of the same view by name: its value (or fault), or undefined when there is no such formula. */
  formula?(name: string): unknown;
  /** "Now", the same for every note in one go (so a sort never sees two different nows). */
  now: Date;
}

class Problem extends Error {}

type Node =
  | { t: 'lit'; v: unknown }
  | { t: 'name'; name: string }
  | { t: 'member'; obj: Node; name: string }
  | { t: 'index'; obj: Node; key: Node }
  | { t: 'call'; name: string; args: Node[]; recv?: Node }
  | { t: 'not' | 'neg'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'list'; items: Node[] };

// ── Reading a formula ─────────────────────────────────────────────────────────────────────────────────────────────────

type Tok = { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'id'; v: string } | { k: 'op'; v: string } | { k: 'end' };

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!', '(', ')', '[', ']', ',', '.', '='];
const WORD_OPS: Record<string, string> = { and: '&&', or: '||', not: '!' };
const QUOTES: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’' };
const MAX_LENGTH = 2000;
/** A table lookup that never finds what every object has (a formula naming "constructor" is only ever a property). */
const own = <T>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);
const MAX_DEPTH = 60;

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const close = own(QUOTES, c);
    if (close) {
      let words = '';
      let j = i + 1;
      for (; j < src.length && src[j] !== close; j++) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const e = src[++j];
          words += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else words += src[j];
      }
      if (j >= src.length) throw new Problem(`A quote (${c}) is opened but never closed.`);
      out.push({ k: 'str', v: words });
      i = j + 1;
      continue;
    }
    const id = /^[\p{L}_$][\p{L}\p{N}_$]*/u.exec(src.slice(i));
    if (id) {
      const word = id[0];
      const lower = word.toLowerCase();
      const wordOp = own(WORD_OPS, lower);
      if (wordOp) out.push({ k: 'op', v: wordOp });
      else out.push({ k: 'id', v: word });
      i += word.length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Problem(`“${c}” can’t be used in a formula.`);
    // A single = is read as "is equal to", the way people write it in a spreadsheet.
    out.push({ k: 'op', v: op === '=' ? '==' : op });
    i += op.length;
  }
  out.push({ k: 'end' });
  return out;
}

function parse(src: string): Node {
  if (!src.trim()) throw new Problem('The formula is empty.');
  if (src.length > MAX_LENGTH) throw new Problem(`The formula is longer than ${MAX_LENGTH} characters.`);
  const toks = tokens(src);
  let at = 0;
  let depth = 0;
  const peek = () => toks[at];
  const isOp = (v: string) => {
    const t = toks[at];
    return t.k === 'op' && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new Problem(`A “${v}” is missing${describe(peek()) ? ` before ${describe(peek())}` : ' at the end'}.`);
    at++;
  };
  const deeper = () => {
    if (++depth > MAX_DEPTH) throw new Problem('The formula has too many brackets inside each other.');
  };

  const binary = (next: () => Node, ops: string[]) => (): Node => {
    let a = next();
    for (;;) {
      const t = peek();
      if (t.k !== 'op' || !ops.includes(t.v)) return a;
      at++;
      a = { t: 'bin', op: t.v, a, b: next() };
    }
  };
  const args = (): Node[] => {
    const list: Node[] = [];
    if (isOp(')')) {
      at++;
      return list;
    }
    for (;;) {
      list.push(or());
      if (isOp(',')) {
        at++;
        continue;
      }
      expect(')');
      return list;
    }
  };
  const primary = (): Node => {
    const t = peek();
    at++;
    if (t.k === 'num' || t.k === 'str') return { t: 'lit', v: t.v };
    if (t.k === 'id') {
      const lower = t.v.toLowerCase();
      if (lower === 'true' || lower === 'false') return { t: 'lit', v: lower === 'true' };
      if (lower === 'null') return { t: 'lit', v: null };
      if (isOp('(')) {
        at++;
        deeper();
        const node: Node = { t: 'call', name: t.v, args: args() };
        depth--;
        return node;
      }
      return { t: 'name', name: t.v };
    }
    if (t.k === 'op' && t.v === '(') {
      deeper();
      const inner = or();
      expect(')');
      depth--;
      return inner;
    }
    if (t.k === 'op' && t.v === '[') {
      deeper();
      const items: Node[] = [];
      if (!isOp(']'))
        for (;;) {
          items.push(or());
          if (isOp(',')) {
            at++;
            continue;
          }
          break;
        }
      expect(']');
      depth--;
      return { t: 'list', items };
    }
    at--;
    throw new Problem(t.k === 'end' ? 'The formula stops before it is finished.' : `${describe(t)} is in a place it can’t be.`);
  };
  const postfix = (): Node => {
    let node = primary();
    for (;;) {
      if (isOp('.')) {
        at++;
        const t = peek();
        if (t.k !== 'id') throw new Problem('A name is missing after a “.”.');
        at++;
        if (isOp('(')) {
          at++;
          deeper();
          node = { t: 'call', name: t.v, args: args(), recv: node };
          depth--;
        } else node = { t: 'member', obj: node, name: t.v };
      } else if (isOp('[')) {
        at++;
        deeper();
        const key = or();
        expect(']');
        depth--;
        node = { t: 'index', obj: node, key };
      } else return node;
    }
  };
  const unary = (): Node => {
    if (isOp('!')) {
      at++;
      deeper();
      const a = unary();
      depth--;
      return { t: 'not', a };
    }
    if (isOp('-')) {
      at++;
      deeper();
      const a = unary();
      depth--;
      return { t: 'neg', a };
    }
    if (isOp('+')) {
      at++;
      return unary();
    }
    return postfix();
  };
  const mul = binary(unary, ['*', '/', '%']);
  const add = binary(mul, ['+', '-']);
  const cmp = binary(add, ['<', '<=', '>', '>=']);
  const eq = binary(cmp, ['==', '!=']);
  const and = binary(eq, ['&&']);
  const or = binary(and, ['||']);

  const node = or();
  if (peek().k !== 'end') throw new Problem(`Something follows the end of the formula: ${describe(peek())}.`);
  return node;
}

function describe(t: Tok): string {
  if (t.k === 'end') return '';
  if (t.k === 'str') return `“${t.v}”`;
  return `“${String(t.v)}”`;
}

/** A formula read once and kept (a view works the same formula out for every note). */
export type Compiled = { ok: true; node: Node } | { ok: false; reason: string };
const compiled = new Map<string, Compiled>();

export function compileFormula(src: string): Compiled {
  let c = compiled.get(src);
  if (c) return c;
  try {
    c = { ok: true, node: parse(src) };
  } catch (err) {
    c = { ok: false, reason: err instanceof Problem ? err.message : 'The formula couldn’t be read.' };
  }
  if (compiled.size > 500) compiled.clear();
  compiled.set(src, c);
  return c;
}

/** Why a formula can't be read, or null when it reads (shown while a formula is typed). */
export function formulaProblem(src: string): string | null {
  const c = compileFormula(src);
  return c.ok ? null : c.reason;
}

// ── Working a formula out ─────────────────────────────────────────────────────────────────────────────────────────────

/** The note itself (file), its properties (note) and the view's formulas (formula), as values a formula can name. */
class Namespace {
  constructor(readonly kind: 'file' | 'note' | 'formula') {}
}
const FILE = new Namespace('file');
const NOTE = new Namespace('note');
const FORMULA = new Namespace('formula');

const DAY_MS = 86_400_000;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

const isBlank = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.every(isBlank));

/** A value as a day and time, or null when it isn't one (2026-10-24, 2026-10-24T09:30, "24 Oct 2026"). */
function asDate(v: unknown, now: Date): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  const m = ISO.exec(t);
  if (m) {
    if (m[7]) {
      const d = new Date(t);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
    return d.getMonth() === Number(m[2]) - 1 ? d : null;
  }
  // Written as words with a day number ("24 Oct 2026"): never a bare "Friday", whose day moves.
  if (!/\d/.test(t) || !/[a-z]/i.test(t) || t.length > 40) return null;
  return readDay(t, now);
}

const NUMERIC = /^\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*$/;
function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && NUMERIC.test(v)) return Number(v);
  return null;
}

function text(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (v instanceof Date) return outDate(v);
  if (v instanceof Namespace) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function truthy(v: unknown): boolean {
  if (isBlank(v)) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  return true;
}

/** How a day leaves a formula: 2026-10-24, or 2026-10-24T09:30 when it has a time. */
function outDate(d: Date): string {
  const day = isoDay(d);
  if (!d.getHours() && !d.getMinutes() && !d.getSeconds()) return day;
  return `${day}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const need = (v: unknown, what: string): never => {
  throw new Problem(`${isBlank(v) ? 'An empty value' : `“${text(v).slice(0, 40)}”`} isn’t ${what}.`);
};
const num = (v: unknown): number => asNumber(v) ?? need(v, 'a number');

type Unit = 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds';
const UNIT_WORDS: [RegExp, Unit][] = [
  [/^(?:years?|yrs?)$/i, 'years'],
  [/^months?$/i, 'months'],
  [/^(?:weeks?|wks?)$/i, 'weeks'],
  [/^days?$/i, 'days'],
  [/^(?:hours?|hrs?)$/i, 'hours'],
  [/^(?:minutes?|mins?)$/i, 'minutes'],
  [/^(?:seconds?|secs?)$/i, 'seconds'],
];
// Single letters are case-sensitive: M is months, m is minutes.
const UNIT_LETTERS: Record<string, Unit> = { y: 'years', Y: 'years', M: 'months', w: 'weeks', W: 'weeks', d: 'days', D: 'days', h: 'hours', H: 'hours', m: 'minutes', s: 'seconds' };
function unitOf(word: string): Unit | null {
  const w = word.trim();
  return own(UNIT_LETTERS, w) ?? UNIT_WORDS.find(([re]) => re.test(w))?.[1] ?? null;
}

/** "1 week", "3 days", "2M": a length of time, or null. */
function asDuration(v: unknown): { n: number; unit: Unit } | null {
  if (typeof v !== 'string') return null;
  const m = /^\s*([+-]?\d+(?:\.\d+)?)?\s*([a-zA-Z]+)\s*$/.exec(v);
  const unit = m ? unitOf(m[2]) : null;
  return m && unit ? { n: m[1] === undefined ? 1 : Number(m[1]), unit } : null;
}

function addTime(d: Date, n: number, unit: Unit): Date {
  const x = new Date(d);
  switch (unit) {
    case 'years':
    case 'months': {
      // The 31st plus a month is the last day of a shorter month, not a day into the one after.
      const months = Math.trunc(n) * (unit === 'years' ? 12 : 1);
      const day = x.getDate();
      x.setDate(1);
      x.setMonth(x.getMonth() + months);
      const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
      x.setDate(Math.min(day, last));
      return x;
    }
    case 'weeks':
    case 'days':
      // By calendar days, so a day stays a day across a change of daylight saving.
      x.setDate(x.getDate() + Math.round(n * (unit === 'weeks' ? 7 : 1)));
      return x;
    case 'hours':
      return new Date(x.getTime() + n * 3_600_000);
    case 'minutes':
      return new Date(x.getTime() + n * 60_000);
    case 'seconds':
      return new Date(x.getTime() + n * 1000);
  }
}

function equal(a: unknown, b: unknown, now: Date): boolean {
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    const la = Array.isArray(a) ? a : [a];
    const lb = Array.isArray(b) ? b : [b];
    return la.length === lb.length && la.every((x, i) => equal(x, lb[i], now));
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b) && /^(?:true|false|yes|no|1|0)$/i.test(text(typeof a === 'boolean' ? b : a));
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na === nb;
  if (a instanceof Date || b instanceof Date) {
    const da = asDate(a, now);
    const db = asDate(b, now);
    return !!da && !!db && da.getTime() === db.getTime();
  }
  // Words match in any case, as a view's "is" filter does: "done" is "Done".
  return collator.compare(text(a).trim(), text(b).trim()) === 0;
}

function compare(a: unknown, b: unknown, now: Date): number | null {
  if (isBlank(a) || isBlank(b)) return null;
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na - nb;
  const da = asDate(a, now);
  const db = asDate(b, now);
  if (da && db) return da.getTime() - db.getTime();
  return collator.compare(text(a), text(b));
}

function arithmetic(op: string, a: unknown, b: unknown, now: Date): unknown {
  // A day and a length of time: due + "1 week", now() - "3 days", or a number of days (due + 7).
  const da = a instanceof Date ? a : (op === '+' || op === '-') && (asDuration(b) || typeof b === 'number' || b instanceof Date) ? asDate(a, now) : null;
  if (da && (op === '+' || op === '-')) {
    const dur = asDuration(b);
    if (dur) return addTime(da, op === '+' ? dur.n : -dur.n, dur.unit);
    if (typeof b === 'number') return addTime(da, op === '+' ? b : -b, 'days');
    const db = asDate(b, now);
    if (op === '-' && db) {
      // Two days apart: whole days when neither has a time, else a part day too.
      const plain = !da.getHours() && !da.getMinutes() && !db.getHours() && !db.getMinutes();
      return plain ? wholeDays(db, da) : Math.round(((da.getTime() - db.getTime()) / DAY_MS) * 100) / 100;
    }
    if (isBlank(b)) return da;
  }
  if (op === '+') {
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    if (isBlank(a) && isBlank(b)) return null;
    const na = isBlank(a) ? 0 : asNumber(a);
    const nb = isBlank(b) ? 0 : asNumber(b);
    if (na !== null && nb !== null) return na + nb;
    // Words joined: "Order " + number.
    return text(a) + text(b);
  }
  // An empty property counts as nothing in a sum (spreadsheets do the same); two empties stay empty.
  if (isBlank(a) && isBlank(b)) return null;
  const x = isBlank(a) ? 0 : num(a);
  if (isBlank(b)) return op === '-' ? x : op === '*' ? 0 : null;
  const y = num(b);
  switch (op) {
    case '-':
      return x - y;
    case '*':
      return x * y;
    case '/':
      if (y === 0) throw new Problem('It divides by zero.');
      return x / y;
    case '%':
      if (y === 0) throw new Problem('It divides by zero.');
      return x % y;
  }
  return null;
}

const flat = (list: unknown[]): unknown[] => list.flatMap((v) => (Array.isArray(v) ? flat(v) : [v]));

interface Ctx {
  scope: FormulaScope;
}

type Fn = (args: unknown[], ctx: Ctx) => unknown;

const atLeast = (name: string, args: unknown[], n: number) => {
  if (args.length < n) throw new Problem(`${name}() needs ${n === 1 ? 'a value' : `${n} values`} inside its brackets.`);
};

function tagsOf(v: unknown, ctx: Ctx): string[] {
  const raw = v instanceof Namespace ? ctx.scope.file('tags') : v;
  return (Array.isArray(raw) ? raw : isBlank(raw) ? [] : [raw]).map((t) => text(t).replace(/^#/, '').toLowerCase());
}

const FUNCTIONS: Record<string, Fn> = {
  concat: (args) => flat(args).map(text).join(''),
  lower: (args) => (atLeast('lower', args, 1), text(args[0]).toLowerCase()),
  upper: (args) => (atLeast('upper', args, 1), text(args[0]).toUpperCase()),
  trim: (args) => (atLeast('trim', args, 1), text(args[0]).trim()),
  length: (args) => {
    atLeast('length', args, 1);
    const v = args[0];
    if (isBlank(v)) return 0;
    return Array.isArray(v) ? v.filter((x) => !isBlank(x)).length : text(v).length;
  },
  round: (args) => {
    atLeast('round', args, 1);
    if (isBlank(args[0])) return null;
    const places = args.length > 1 ? Math.max(0, Math.min(10, Math.trunc(num(args[1])))) : 0;
    const f = 10 ** places;
    return Math.round(num(args[0]) * f) / f;
  },
  floor: (args) => (atLeast('floor', args, 1), isBlank(args[0]) ? null : Math.floor(num(args[0]))),
  ceil: (args) => (atLeast('ceil', args, 1), isBlank(args[0]) ? null : Math.ceil(num(args[0]))),
  abs: (args) => (atLeast('abs', args, 1), isBlank(args[0]) ? null : Math.abs(num(args[0]))),
  min: (args, ctx) => extreme(args, ctx, -1),
  max: (args, ctx) => extreme(args, ctx, 1),
  now: (_args, ctx) => new Date(ctx.scope.now),
  today: (_args, ctx) => {
    const d = new Date(ctx.scope.now);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  daysbetween: (args, ctx) => {
    atLeast('daysBetween', args, 2);
    if (isBlank(args[0]) || isBlank(args[1])) return null;
    const a = asDate(args[0], ctx.scope.now) ?? need(args[0], 'a day');
    const b = asDate(args[1], ctx.scope.now) ?? need(args[1], 'a day');
    return wholeDays(a, b);
  },
  dateadd: (args, ctx) => {
    atLeast('dateAdd', args, 2);
    if (isBlank(args[0])) return null;
    const d = asDate(args[0], ctx.scope.now) ?? need(args[0], 'a day');
    const unit = args.length > 2 ? unitOf(text(args[2])) : 'days';
    if (!unit) throw new Problem(`“${text(args[2])}” isn’t a length of time: use 'days', 'weeks', 'months' or 'years'.`);
    return addTime(d, num(args[1]), unit);
  },
  date: (args, ctx) => (atLeast('date', args, 1), isBlank(args[0]) ? null : (asDate(args[0], ctx.scope.now) ?? need(args[0], 'a day'))),
  number: (args) => (atLeast('number', args, 1), isBlank(args[0]) ? null : num(typeof args[0] === 'string' ? args[0].replace(/,/g, '') : args[0])),
  text: (args) => (atLeast('text', args, 1), text(args[0])),
  tofixed: (args) => {
    atLeast('toFixed', args, 1);
    if (isBlank(args[0])) return null;
    return num(args[0]).toFixed(args.length > 1 ? Math.max(0, Math.min(10, Math.trunc(num(args[1])))) : 0);
  },
  join: (args) => (atLeast('join', args, 1), (Array.isArray(args[0]) ? args[0] : [args[0]]).map(text).filter(Boolean).join(args.length > 1 ? text(args[1]) : ', ')),
  contains: (args, ctx) => {
    atLeast('contains', args, 2);
    const [hay, needle] = args;
    if (hay instanceof Namespace) throw new Problem('contains() looks inside a list or some words, not a whole note.');
    if (Array.isArray(hay)) return hay.some((x) => equal(x, needle, ctx.scope.now));
    return text(hay).toLowerCase().includes(text(needle).toLowerCase());
  },
  empty: (args) => (atLeast('empty', args, 1), isBlank(args[0])),
  hastag: (args, ctx) => {
    atLeast('hasTag', args, 2);
    const have = tagsOf(args[0], ctx);
    // A tag counts with the tags under it: #work finds #work/clients.
    return args.slice(1).some((want) => {
      const w = text(want).replace(/^#/, '').toLowerCase();
      return have.some((t) => t === w || t.startsWith(`${w}/`));
    });
  },
  infolder: (args, ctx) => {
    atLeast('inFolder', args, 2);
    const folder = text(args[0] instanceof Namespace ? ctx.scope.file('folder') : args[0]);
    const want = text(args[1]).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return !want || folder === want || folder.startsWith(`${want}/`);
  },
};
// Other spellings people reach for.
FUNCTIONS.isempty = FUNCTIONS.empty;
FUNCTIONS.tostring = FUNCTIONS.text;
FUNCTIONS.len = FUNCTIONS.length;

function extreme(args: unknown[], ctx: Ctx, sign: 1 | -1): unknown {
  const values = flat(args).filter((v) => !isBlank(v));
  if (!values.length) return null;
  if (values.every((v) => asNumber(v) !== null)) {
    const nums = values.map((v) => asNumber(v)!);
    return sign > 0 ? Math.max(...nums) : Math.min(...nums);
  }
  const days = values.map((v) => asDate(v, ctx.scope.now));
  if (days.every(Boolean)) return days.reduce((a, b) => ((sign > 0 ? b!.getTime() > a!.getTime() : b!.getTime() < a!.getTime()) ? b : a));
  return [...values].sort((a, b) => sign * collator.compare(text(b), text(a)))[0];
}

/** The fields a note has (file.title…), by the names people write. */
const FILE_FIELDS: Record<string, 'title' | 'folder' | 'modified' | 'tags' | 'path'> = { title: 'title', name: 'title', basename: 'title', folder: 'folder', modified: 'modified', mtime: 'modified', tags: 'tags', path: 'path' };

function member(obj: unknown, name: string, ctx: Ctx): unknown {
  if (obj === FILE) {
    const field = own(FILE_FIELDS, name.toLowerCase());
    if (!field) throw new Problem(`Notes have no “file.${name}”. Try file.title, file.folder, file.modified or file.tags.`);
    const v = ctx.scope.file(field);
    return field === 'modified' && typeof v === 'number' ? new Date(v) : v;
  }
  if (obj === NOTE) return ctx.scope.prop(name) ?? null;
  if (obj === FORMULA) {
    const v = ctx.scope.formula?.(name);
    if (v === undefined) throw new Problem(`There’s no formula called “${name}”.`);
    if (isFault(v)) throw new Problem(`“${name}” can’t be worked out: ${v.reason}`);
    return v;
  }
  if (name.toLowerCase() === 'length') return FUNCTIONS.length([obj], ctx);
  if (obj && typeof obj === 'object' && !Array.isArray(obj) && !(obj instanceof Date)) {
    const key = Object.keys(obj).find((k) => k.toLowerCase() === name.toLowerCase());
    return key === undefined ? null : (obj as Record<string, unknown>)[key];
  }
  if (isBlank(obj)) return null;
  throw new Problem(`“${text(obj).slice(0, 40)}” has no “${name}”.`);
}

function evaluate(node: Node, ctx: Ctx): unknown {
  switch (node.t) {
    case 'lit':
      return node.v;
    case 'list':
      return node.items.map((n) => evaluate(n, ctx));
    case 'name': {
      const lower = node.name.toLowerCase();
      if (lower === 'file') return FILE;
      if (lower === 'note') return NOTE;
      if (lower === 'formula') return FORMULA;
      if (lower === 'this') throw new Problem('“this” isn’t something Ironleaf’s formulas can read.');
      const v = ctx.scope.prop(node.name);
      if (v !== undefined) return v;
      // A bare name that isn't a property may be another formula of the view.
      const f = ctx.scope.formula?.(node.name);
      if (f !== undefined) {
        if (isFault(f)) throw new Problem(`“${node.name}” can’t be worked out: ${f.reason}`);
        return f;
      }
      return null;
    }
    case 'member':
      return member(evaluate(node.obj, ctx), node.name, ctx);
    case 'index': {
      const obj = evaluate(node.obj, ctx);
      const key = evaluate(node.key, ctx);
      if (Array.isArray(obj)) {
        const i = Math.trunc(num(key));
        return obj[i < 0 ? obj.length + i : i] ?? null;
      }
      return member(obj, text(key), ctx);
    }
    case 'not':
      return !truthy(evaluate(node.a, ctx));
    case 'neg': {
      const v = evaluate(node.a, ctx);
      return isBlank(v) ? null : -num(v);
    }
    case 'bin': {
      if (node.op === '&&') return truthy(evaluate(node.a, ctx)) && truthy(evaluate(node.b, ctx));
      if (node.op === '||') return truthy(evaluate(node.a, ctx)) || truthy(evaluate(node.b, ctx));
      const a = evaluate(node.a, ctx);
      const b = evaluate(node.b, ctx);
      const now = ctx.scope.now;
      switch (node.op) {
        case '==':
          return equal(a, b, now);
        case '!=':
          return !equal(a, b, now);
        case '<':
        case '<=':
        case '>':
        case '>=': {
          const c = compare(a, b, now);
          if (c === null) return false;
          return node.op === '<' ? c < 0 : node.op === '<=' ? c <= 0 : node.op === '>' ? c > 0 : c >= 0;
        }
        default:
          return arithmetic(node.op, a, b, now);
      }
    }
    case 'call': {
      const name = node.name.toLowerCase();
      // if() works out only the side it needs, so the other side's problem never shows.
      if (name === 'if') {
        const all = node.recv ? [node.recv, ...node.args] : node.args;
        if (all.length < 2) throw new Problem('if() needs a question and an answer: if(done, "Yes", "No").');
        return truthy(evaluate(all[0], ctx)) ? evaluate(all[1], ctx) : all[2] ? evaluate(all[2], ctx) : null;
      }
      const fn = own(FUNCTIONS, name);
      if (!fn) throw new Problem(`Ironleaf doesn’t know the function “${node.name}”.`);
      const args = node.args.map((n) => evaluate(n, ctx));
      return fn(node.recv ? [evaluate(node.recv, ctx), ...args] : args, ctx);
    }
  }
}

/** A value as it leaves a formula: days as written in notes, the note itself as its name, nothing that isn't a value. */
function out(v: unknown): unknown {
  if (v instanceof Date) return outDate(v);
  if (v instanceof Namespace) throw new Problem(v.kind === 'file' ? 'Name one of the note’s fields, such as file.title.' : `Name one of the ${v.kind === 'note' ? 'properties' : 'formulas'} after “${v.kind}.”.`);
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Problem('The answer is too big to show.');
  // Sums of decimals come out as 153.60000000000002 in binary arithmetic; nine places is more than any note needs.
  if (typeof v === 'number' && Math.abs(v) < 1e15) return Math.round(v * 1e9) / 1e9;
  if (Array.isArray(v)) return v.map(out);
  return v;
}

/** A formula worked out for one note: its value, or a FormulaFault saying why not. */
export function runFormula(src: string, scope: FormulaScope): unknown {
  const c = compileFormula(src);
  if (!c.ok) return new FormulaFault(c.reason);
  try {
    return out(evaluate(c.node, { scope }));
  } catch (err) {
    if (err instanceof Problem) return new FormulaFault(err.message);
    if (err instanceof RangeError) return new FormulaFault('The formula goes round in circles.');
    return new FormulaFault('The formula couldn’t be worked out.');
  }
}

/** Whether a value counts as yes (for a formula used as a filter): ticked, a number other than 0, words, a list. */
export const formulaTruthy = truthy;

// ── Reading a filter's shape ──────────────────────────────────────────────────────────────────────────────────────────

/** A filter formula that is one of the simple kinds a view's filter list can show as a chip. */
type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type SimpleFilter =
  | { kind: 'compare'; ref: string; op: CompareOp; value: string | number | boolean | null }
  | { kind: 'folder'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'contains'; ref: string; value: string }
  | { kind: 'empty' | 'not-empty'; ref: string };

const FLIP: Record<string, CompareOp> = { '==': '==', '!=': '!=', '<': '>', '<=': '>=', '>': '<', '>=': '<=' };

/** What a node names: a property (status, note.status, note["due date"]), a field (file.title) or a formula. */
function refOf(node: Node): string | null {
  if (node.t === 'name') return ['file', 'note', 'formula', 'this'].includes(node.name.toLowerCase()) ? null : node.name;
  if (node.t === 'member' && node.obj.t === 'name') {
    const ns = node.obj.name.toLowerCase();
    if (ns === 'note') return node.name;
    if (ns === 'file' || ns === 'formula') return `${ns}.${node.name}`;
  }
  if (node.t === 'index' && node.obj.t === 'name' && node.key.t === 'lit' && typeof node.key.v === 'string') {
    const ns = node.obj.name.toLowerCase();
    if (ns === 'note') return node.key.v;
    if (ns === 'formula') return `formula.${node.key.v}`;
  }
  return null;
}

const isFileNode = (n: Node | undefined) => !!n && n.t === 'name' && n.name.toLowerCase() === 'file';
const litOf = (n: Node | undefined): string | number | boolean | null | undefined => (n && n.t === 'lit' && (n.v === null || ['string', 'number', 'boolean'].includes(typeof n.v)) ? (n.v as string | number | boolean | null) : undefined);

/**
 * A filter formula's shape when it is a simple one — a property compared with a value (status == "Done", price > 10), a
 * folder (file.inFolder("Bakery")), a tag (file.hasTag("client")), contains, or empty — so a view file from elsewhere
 * shows its filters as chips; null for anything else (it stays a formula filter).
 */
export function simpleFilter(src: string): SimpleFilter | null {
  const c = compileFormula(src);
  if (!c.ok) return null;
  let node = c.node;
  let negated = false;
  if (node.t === 'not') {
    negated = true;
    node = node.a;
  }
  if (node.t === 'bin' && FLIP[node.op] && !negated) {
    const left = refOf(node.a);
    const right = refOf(node.b);
    const lv = litOf(node.a);
    const rv = litOf(node.b);
    if (left && rv !== undefined) return { kind: 'compare', ref: left, op: node.op as CompareOp, value: rv };
    if (right && lv !== undefined) return { kind: 'compare', ref: right, op: FLIP[node.op], value: lv };
    return null;
  }
  if (node.t !== 'call') return null;
  const name = node.name.toLowerCase();
  const all = node.recv ? [node.recv, ...node.args] : node.args;
  if ((name === 'isempty' || name === 'empty') && all.length === 1) {
    const ref = refOf(all[0]);
    return ref ? { kind: negated ? 'not-empty' : 'empty', ref } : null;
  }
  if (negated) return null;
  if (name === 'infolder' && all.length === 2 && isFileNode(all[0]) && typeof litOf(all[1]) === 'string') return { kind: 'folder', value: litOf(all[1]) as string };
  if (name === 'hastag' && all.length === 2 && isFileNode(all[0]) && typeof litOf(all[1]) === 'string') return { kind: 'tag', value: (litOf(all[1]) as string).replace(/^#/, '') };
  if (name === 'contains' && all.length === 2) {
    const ref = refOf(all[0]);
    const v = litOf(all[1]);
    return ref && (typeof v === 'string' || typeof v === 'number') ? { kind: 'contains', ref, value: String(v) } : null;
  }
  return null;
}
