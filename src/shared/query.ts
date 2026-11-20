// Search across the notes: words (all must appear), "exact phrases", /regular expressions/, -excluded, OR, (groups), and
// the operators file:, path:, tag:, content:, line:, section:, task:, task-todo:, task-done:, match-case:, ignore-case:
// and [property] / [property:value]. Written for Ironleaf; parsed once, then matched against each note.

import { isBoxDone } from './finished';
import { foldDiacritics, TASK_LINE } from './markdown';

export type QueryNode =
  | { type: 'and'; items: QueryNode[] }
  | { type: 'or'; items: QueryNode[] }
  | { type: 'not'; item: QueryNode }
  | { type: 'term'; text: string; exact: boolean }
  | { type: 'regex'; re: RegExp }
  | { type: 'op'; op: Operator; item: QueryNode }
  | { type: 'prop'; key: string; item: QueryNode | null };

export type Operator = 'file' | 'path' | 'tag' | 'content' | 'line' | 'section' | 'task' | 'task-todo' | 'task-done' | 'match-case' | 'ignore-case';
const OPERATORS = new Set<Operator>(['file', 'path', 'tag', 'content', 'line', 'section', 'task', 'task-todo', 'task-done', 'match-case', 'ignore-case']);

/** What a note offers to the search. */
export interface QueryDoc {
  path: string;
  title: string;
  content: string;
  tags: string[];
  props: Record<string, unknown>;
}

/**
 * A note's folded text, kept by the index and reused across searches (5 Nov 2026, v5-vault-speed: folding the
 * whole vault per keystroke was the 120-200 ms). Case-sensitive matching still reads the raw text.
 */
export interface FoldedDoc {
  title: string;
  content: string;
  /** The title and content together, folded the same way matching folds them. */
  all: string;
  /** Each line folded, in file order (line: and task: scopes read these when present). */
  lines?: readonly string[];
  /** Each section folded, in file order (section: reads these when present). */
  sections?: readonly string[];
}

/** A note's folded text for matching: the title, the content and both together, folds the matcher reuses. */
export function foldedDocOf(title: string, content: string): FoldedDoc {
  const lowerTitle = foldDiacritics(title).toLowerCase();
  const lowerContent = foldDiacritics(content).toLowerCase();
  return { title: lowerTitle, content: lowerContent, all: foldDiacritics(`${title}\n${content}`).toLowerCase() };
}

interface Scope {
  text: string;
  /** Lower-cased once, for matching without case. */
  lower: string;
}

type Token = { kind: 'word' | 'phrase' | 'regex' | 'open' | 'close' | 'or' | 'not' | 'op' | 'prop'; value: string; extra?: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'open', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'close', value: ')' });
      i++;
      continue;
    }
    if (ch === '-' && i + 1 < n && !/\s/.test(input[i + 1])) {
      tokens.push({ kind: 'not', value: '-' });
      i++;
      continue;
    }
    if (ch === '"') {
      const end = input.indexOf('"', i + 1);
      const value = end < 0 ? input.slice(i + 1) : input.slice(i + 1, end);
      tokens.push({ kind: 'phrase', value });
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (ch === '/') {
      // A regular expression runs to the next unescaped slash.
      let j = i + 1;
      while (j < n && input[j] !== '/') j += input[j] === '\\' ? 2 : 1;
      if (j < n) {
        let k = j + 1;
        while (k < n && /[imsu]/.test(input[k])) k++;
        tokens.push({ kind: 'regex', value: input.slice(i + 1, j), extra: input.slice(j + 1, k) });
        i = k;
        continue;
      }
    }
    if (ch === '[' && input[i + 1] !== '[') {
      const end = input.indexOf(']', i + 1);
      if (end > i) {
        const inner = input.slice(i + 1, end);
        const colon = inner.indexOf(':');
        tokens.push({ kind: 'prop', value: (colon < 0 ? inner : inner.slice(0, colon)).trim(), extra: colon < 0 ? undefined : inner.slice(colon + 1).trim() });
        i = end + 1;
        continue;
      }
    }
    let j = i;
    while (j < n && !/[\s()"]/.test(input[j])) j++;
    const word = input.slice(i, j);
    const op = /^([a-z-]+):(.*)$/i.exec(word);
    if (op && OPERATORS.has(op[1].toLowerCase() as Operator)) {
      tokens.push({ kind: 'op', value: op[1].toLowerCase() });
      if (op[2]) {
        // The operator's word follows it directly (tag:#idea); a quoted phrase or a group may follow instead.
        i += op[1].length + 1;
        continue;
      }
      i = j;
      continue;
    }
    if (word === 'OR') tokens.push({ kind: 'or', value: 'OR' });
    // Lower-case and/or are how people join words ("credit and card"), never words to find (9.2: only upper-case OR splits).
    else if (word === 'and' || word === 'or') {
      i = j;
      continue;
    } else tokens.push({ kind: 'word', value: word });
    i = j;
  }
  return tokens;
}

class Parser {
  private at = 0;
  constructor(private tokens: Token[]) {}

  parse(): QueryNode | null {
    const node = this.or();
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private or(): QueryNode | null {
    const items: QueryNode[] = [];
    const first = this.and();
    if (first) items.push(first);
    while (this.peek()?.kind === 'or') {
      this.at++;
      const next = this.and();
      if (next) items.push(next);
    }
    if (!items.length) return null;
    return items.length === 1 ? items[0] : { type: 'or', items };
  }

  private and(): QueryNode | null {
    const items: QueryNode[] = [];
    for (;;) {
      const t = this.peek();
      if (!t || t.kind === 'or' || t.kind === 'close') break;
      const item = this.unary();
      if (item) items.push(item);
    }
    if (!items.length) return null;
    return items.length === 1 ? items[0] : { type: 'and', items };
  }

  private unary(): QueryNode | null {
    const t = this.peek();
    if (t?.kind === 'not') {
      this.at++;
      const item = this.unary();
      return item ? { type: 'not', item } : null;
    }
    return this.primary();
  }

  private primary(): QueryNode | null {
    const t = this.tokens[this.at++];
    if (!t) return null;
    switch (t.kind) {
      case 'open': {
        const inner = this.or();
        if (this.peek()?.kind === 'close') this.at++;
        return inner;
      }
      case 'close':
        return null;
      case 'word':
        return t.value ? { type: 'term', text: t.value, exact: false } : null;
      case 'phrase':
        return t.value ? { type: 'term', text: t.value, exact: true } : null;
      case 'regex':
        try {
          return { type: 'regex', re: new RegExp(t.value, (t.extra ?? '').replace(/[gy]/g, '')) };
        } catch {
          return { type: 'term', text: t.value, exact: true };
        }
      case 'op': {
        const item = this.unary();
        return item ? { type: 'op', op: t.value as Operator, item } : null;
      }
      case 'prop': {
        if (!t.value) return null;
        const value = t.extra ? new Parser(tokenize(t.extra)).parse() : null;
        return { type: 'prop', key: t.value.toLowerCase(), item: value };
      }
      default:
        return null;
    }
  }
}

export function parseQuery(input: string): QueryNode | null {
  return new Parser(tokenize(input.slice(0, 1000))).parse();
}

const scope = (text: string): Scope => ({ text, lower: foldDiacritics(text).toLowerCase() });

/**
 * Where a searched word is found: from the start of a word ("instal" finds "installed", "led" doesn't find "installed"
 * or "scheduled"); a word starting with a mark ("#tag", ".pdf", "$48") is found anywhere.
 */
const WORDY = /[\p{L}\p{N}]/u;
export function wordStarts(hay: string, needle: string, max = Infinity): number[] {
  const out: number[] = [];
  if (!needle) return out;
  const free = !WORDY.test(needle[0]);
  for (let at = hay.indexOf(needle); at >= 0 && out.length < max; at = hay.indexOf(needle, at + 1)) {
    if (free || at === 0 || !WORDY.test(hay[at - 1])) {
      out.push(at);
      at += needle.length - 1;
    }
  }
  return out;
}

function regexIn(s: Scope, re: RegExp, caseSensitive: boolean): boolean {
  const r = caseSensitive || re.flags.includes('i') ? re : new RegExp(re.source, re.flags + 'i');
  r.lastIndex = 0;
  return r.test(s.text);
}

function sectionsOf(content: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let fence = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^#{1,6}\s/.test(line) && current.length) {
      out.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length) out.push(current.join('\n'));
  return out;
}

function propValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(propValues);
  if (typeof value === 'object') return [JSON.stringify(value)];
  return [String(value)];
}

export class QueryMatcher {
  readonly positives: { text?: string; folded?: string; re?: RegExp; caseSensitive: boolean }[] = [];
  /** Each searched word folded once, not once per note (5 Nov 2026, v5-vault-speed). */
  private foldedTerms = new Map<string, string>();

  constructor(readonly root: QueryNode) {
    this.collect(root, false, false);
  }

  /** The words, phrases and patterns to highlight in results (those not excluded). */
  private collect(node: QueryNode, negated: boolean, caseSensitive: boolean): void {
    switch (node.type) {
      case 'and':
      case 'or':
        node.items.forEach((i) => this.collect(i, negated, caseSensitive));
        return;
      case 'not':
        this.collect(node.item, !negated, caseSensitive);
        return;
      case 'term':
        if (!this.foldedTerms.has(node.text)) this.foldedTerms.set(node.text, foldDiacritics(node.text).toLowerCase());
        if (!negated) this.positives.push({ text: node.text, folded: this.foldedTerms.get(node.text), caseSensitive });
        return;
      case 'regex':
        if (!negated) this.positives.push({ re: node.re, caseSensitive });
        return;
      case 'op':
        if (node.op === 'file' || node.op === 'path' || node.op === 'tag') return;
        this.collect(node.item, negated, node.op === 'match-case' ? true : node.op === 'ignore-case' ? false : caseSensitive);
        return;
      case 'prop':
        return;
    }
  }

  private termIn(s: Scope, text: string, caseSensitive: boolean): boolean {
    if (caseSensitive) return wordStarts(s.text, text, 1).length > 0;
    return wordStarts(s.lower, this.foldedTerms.get(text) ?? foldDiacritics(text).toLowerCase(), 1).length > 0;
  }

  /** Matches a node against a piece of text (a line, a section, a title): everything in it is plain text. */
  private matchScope(node: QueryNode, s: Scope, caseSensitive: boolean): boolean {
    switch (node.type) {
      case 'and':
        return node.items.every((i) => this.matchScope(i, s, caseSensitive));
      case 'or':
        return node.items.some((i) => this.matchScope(i, s, caseSensitive));
      case 'not':
        return !this.matchScope(node.item, s, caseSensitive);
      case 'term':
        return this.termIn(s, node.text, caseSensitive);
      case 'regex':
        return regexIn(s, node.re, caseSensitive);
      case 'op':
        if (node.op === 'match-case') return this.matchScope(node.item, s, true);
        if (node.op === 'ignore-case') return this.matchScope(node.item, s, false);
        return this.matchScope(node.item, s, caseSensitive);
      case 'prop':
        return false;
    }
  }

  matches(doc: QueryDoc, folded?: FoldedDoc): boolean {
    // Scopes are built only when the query reaches them, and from the kept folds when the index offers them:
    // a tag: search never touches a note's words at all.
    let content: Scope | null = null;
    let all: Scope | null = null;
    let lines: Scope[] | null = null;
    let sections: Scope[] | null = null;
    const contentScope = () => (content ??= folded ? { text: doc.content, lower: folded.content } : scope(doc.content));
    const allScope = () => (all ??= folded ? { text: `${doc.title}\n${doc.content}`, lower: folded.all } : scope(`${doc.title}\n${doc.content}`));
    const lineScopes = () => {
      if (lines) return lines;
      const raw = doc.content.split(/\r?\n/);
      lines = folded?.lines && folded.lines.length === raw.length ? raw.map((text, i) => ({ text, lower: folded.lines![i] })) : raw.map(scope);
      return lines;
    };
    const sectionScopes = () => {
      if (sections) return sections;
      const raw = sectionsOf(doc.content);
      sections = folded?.sections && folded.sections.length === raw.length ? raw.map((text, i) => ({ text, lower: folded.sections![i] })) : raw.map(scope);
      return sections;
    };
    const walk = (node: QueryNode, caseSensitive: boolean): boolean => {
      switch (node.type) {
        case 'and':
          return node.items.every((i) => walk(i, caseSensitive));
        case 'or':
          return node.items.some((i) => walk(i, caseSensitive));
        case 'not':
          return !walk(node.item, caseSensitive);
        case 'term':
          return this.termIn(allScope(), node.text, caseSensitive);
        case 'regex':
          return regexIn(allScope(), node.re, caseSensitive);
        case 'prop': {
          const entry = Object.entries(doc.props).find(([k]) => k.toLowerCase() === node.key);
          if (!entry) return false;
          if (!node.item) return true;
          const item = node.item;
          return propValues(entry[1]).some((v) => this.matchScope(item, scope(v), caseSensitive));
        }
        case 'op':
          switch (node.op) {
            case 'file':
              return this.matchScope(node.item, folded ? { text: doc.title, lower: folded.title } : scope(doc.title), caseSensitive);
            case 'path':
              return this.matchScope(node.item, scope(doc.path), caseSensitive);
            case 'tag': {
              const item = node.item;
              return doc.tags.some((tag) => {
                const wanted = item.type === 'term' ? item.text.replace(/^#/, '').toLowerCase() : null;
                if (wanted !== null) return tag.toLowerCase() === wanted || tag.toLowerCase().startsWith(`${wanted}/`);
                return this.matchScope(item, scope(tag), caseSensitive);
              });
            }
            case 'content':
              return this.matchScope(node.item, contentScope(), caseSensitive);
            case 'line':
              return lineScopes().some((l) => this.matchScope(node.item, l, caseSensitive));
            case 'section':
              return sectionScopes().some((sec) => this.matchScope(node.item, sec, caseSensitive));
            case 'task':
            case 'task-todo':
            case 'task-done':
              return lineScopes().some((l) => {
                const m = TASK_LINE.exec(l.text);
                if (!m) return false;
                const done = isBoxDone(m[2]);
                if (node.op === 'task-todo' && done) return false;
                if (node.op === 'task-done' && !done) return false;
                return this.matchScope(node.item, scope(m[4]), caseSensitive);
              });
            case 'match-case':
              return walk(node.item, true);
            case 'ignore-case':
              return walk(node.item, false);
          }
      }
    };
    return walk(this.root, false);
  }

  /** Where the highlighted words fall in a line, as [start, end) pairs. */
  ranges(line: string, max = 12): [number, number][] {
    const out: [number, number][] = [];
    const lower = line.toLowerCase();
    for (const p of this.positives) {
      if (out.length >= max) break;
      if (p.text) {
        const needle = p.caseSensitive ? p.text : p.text.toLowerCase();
        const hay = p.caseSensitive ? line : lower;
        if (!needle) continue;
        for (const at of wordStarts(hay, needle, max - out.length)) out.push([at, at + needle.length]);
      } else if (p.re) {
        const re = new RegExp(p.re.source, (p.caseSensitive || p.re.flags.includes('i') ? p.re.flags : p.re.flags + 'i').replace(/g|y/g, '') + 'g');
        for (const m of line.matchAll(re)) {
          if (out.length >= max || !m[0]) break;
          out.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
        }
      }
    }
    out.sort((a, b) => a[0] - b[0]);
    // Overlapping highlights become one.
    const merged: [number, number][] = [];
    for (const r of out) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    return merged;
  }

  /** How well a note matches: words in the title count most, then how often they appear. */
  score(doc: QueryDoc, folded?: FoldedDoc): number {
    let score = 1;
    const title = folded?.title ?? foldDiacritics(doc.title).toLowerCase();
    const lower = folded?.content ?? foldDiacritics(doc.content).toLowerCase();
    for (const p of this.positives) {
      if (!p.text) {
        score += 2;
        continue;
      }
      const w = p.folded ?? foldDiacritics(p.text).toLowerCase();
      // The same word-start rule as matching (9.2 fresh eyes): letters inside other words score nothing.
      if (title === w) score += 30;
      else if (wordStarts(title, w, 1).length) score += 12;
      score += Math.min(wordStarts(lower, w).length, 25);
    }
    return score;
  }
}
