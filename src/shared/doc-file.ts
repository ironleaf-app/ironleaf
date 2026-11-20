// Docs (18 Oct 2026, after real use). A doc is how something is set up and run — a family game server, a backup routine,
// how payroll is done: no status, health, progress or due date, just what someone needs to know, kept current in place.
// Projects are for work with an end; docs are for things that keep going.
//  Docs/<Name>.md
//   ---
//   type: doc
//   about: One line on what it is.            (optional)
//   tags: [minecraft, family]                 (optional)
//   canvas: Docs/<Name>.canvas                (when it has one)
//   neuralspark-key: remote:<connection id>   (optional: the computer, or local:<folder>, it is about)
//   hostname: GGPlayground                    (optional: that computer's own name on the network)
//   updated: 2026-10-18 (when Ironleaf or the former host app last wrote it)
//   ---
//   # <Name>
//  A summary paragraph.
//  ## Setup / ## Access / ## Operations / ## Add-ons / ## Troubleshooting   (any headings, in any order)
//  ## Changes
//   - **18 Oct 2026** — What changed, newest first.
//A note is a doc when its `type` is doc (anywhere), or when it sits directly in the Docs folder without a type of its
// own. The former host app's assistant writes this shape too (its vault-docs plugin), so both apps read the same thing.
// Pure: no
// Node, no DOM; the main side, the window and the tests use it as it is.

import { maskCode, replaceMarkdownLinks, replaceWikilinks, type ParsedWikilink } from './markdown';
import { parseProject, repairProjectText } from './project-file';
import { cleanFileName } from './paths';

export const DOCS_FOLDER = 'Docs';
export const CHANGES_HEADING = 'Changes';
const CHANGES_RE = /^(changes|change log|changelog|history|revision history)$/i;

export interface DocSection {
  heading: string;
  /** The words under it, as written (without the heading line). */
  body: string;
  /** The heading's line in the whole file (0-based). */
  line: number;
}

export interface DocChange {
  /** "18 Oct 2026", as written ('' when the line has no date). */
  date: string;
  what: string;
  raw: string;
}

export interface Doc {
  name: string;
  about: string;
  tags: string[];
  /** The doc's canvas (a path in the notes), '' when it has none yet. */
  canvas: string;
  /** The former host app's key for the computer or folder it is about ("remote:<connection>", "local:<folder>"), or ''. */
  key: string;
  /** That computer's own name on the network, when it is written, or ''. */
  hostname: string;
  /** When it was last written by an app (2026-10-18), or ''. */
  updated: string;
  summary: string;
  /** Its `##` sections, in order, without Changes. */
  sections: DocSection[];
  changes: DocChange[];
  /** The Changes section's heading line (0-based), -1 when it has none. */
  changesLine: number;
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const H2 = /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const H1 = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const cleanDir = (d: string) => String(d ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');
const unquote = (v: string) => {
  const t = v.trim();
  if (/^".*"$/.test(t)) {
    try {
      return String(JSON.parse(t));
    } catch {
      return t.slice(1, -1);
    }
  }
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  return t;
};
const needsQuotes = (s: string) => s === '' || /^[\s\-?:,[\]{}#&*!|>'"%@`]|:\s|:$|\s#|\s$/.test(s) || /^(true|false|yes|no|null|on|off|~)$/i.test(s) || /^[\d.+-]+$/.test(s);
const yamlText = (s: string) => (needsQuotes(s) ? JSON.stringify(s) : s);
const oneLine = (s: unknown, max = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ── Recognising docs ────────────────────────────────────────────────────────────────────────────────────────────────

/** Whether a note is a doc: `type: doc` anywhere, or a note directly in the Docs folder with no type of its own. */
export function isDocNote(path: string, props: Record<string, unknown> | undefined, docsFolder = DOCS_FOLDER): boolean {
  const type = props?.type;
  if (typeof type === 'string' && type.trim().toLowerCase() === 'doc') return true;
  if (type !== undefined && type !== null && String(type).trim() !== '') return false;
  if (!/\.md$/i.test(path)) return false;
  const dir = cleanDir(docsFolder);
  if (!dir || !path.toLowerCase().startsWith(`${dir.toLowerCase()}/`)) return false;
  return !path.slice(dir.length + 1).includes('/');
}

/** Whether the words of a note say it is a doc (its properties). */
export const isDocText = (text: string) => /^---\r?\n[\s\S]*?^type:\s*["']?doc["']?\s*$/m.test(String(text ?? '').replace(/^﻿/, '').slice(0, 4000));

/** Where a doc's canvas goes when it has none: beside it, named after it. */
export const docCanvasPath = (docPath: string) => docPath.replace(/\.md$/i, '.canvas');

/** Where a new doc goes: the Docs folder, named after it. */
export const docPath = (name: string, folder = DOCS_FOLDER) => `${cleanDir(folder) ? `${cleanDir(folder)}/` : ''}${safeDocName(name)}.md`;

/** A name Windows accepts for a file. */
export function safeDocName(text: string, max = 80): string {
  return cleanFileName(text, 'Untitled doc', max);
}

// ── Reading a doc ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A note's front matter as lines and the rest. */
export function splitDocFront(text: string): { lines: string[] | null; body: string; bodyLine: number } {
  const t = String(text ?? '').replace(/^﻿/, '');
  const m = FRONT.exec(t);
  if (!m) return { lines: null, body: t, bodyLine: 0 };
  return { lines: m[1].split(/\r?\n/), body: t.slice(m[0].length), bodyLine: m[0].split(/\n/).length - 1 };
}

function frontValues(lines: string[] | null): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of lines ?? []) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const was = out[listKey];
      out[listKey] = [...(Array.isArray(was) ? was : []), unquote(item[1])];
      continue;
    }
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const v = kv[2].trim();
    listKey = v === '' ? kv[1] : null;
    if (/^\[.*\]$/.test(v))
      out[kv[1]] = v
        .slice(1, -1)
        .split(',')
        .map((x) => unquote(x))
        .filter(Boolean);
    else out[kv[1]] = unquote(v);
  }
  return out;
}

const asList = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(/[,\s]+/).filter(Boolean) : []).map((t) => t.replace(/^#/, ''));

/** Each line's place: whether it is inside a fenced code block (headings there aren't headings). */
function fencedLines(lines: string[]): boolean[] {
  const out: boolean[] = [];
  let fence: string | null = null;
  for (const l of lines) {
    const m = /^\s*(```|~~~)/.exec(l);
    if (fence) {
      out.push(true);
      if (m && m[1] === fence) fence = null;
    } else if (m) {
      fence = m[1];
      out.push(true);
    } else out.push(false);
  }
  return out;
}

/** A Changes line read: "- **18 Oct 2026** — what" (or "- 18 Oct 2026 — what", "- 2026-10-18: what"). */
export function readChange(line: string): DocChange | null {
  const t = line.replace(/^\s*[-*+]\s+/, '');
  if (t === line && !/^\s*[-*+]/.test(line)) return null;
  const bold = /^\*\*([^*]+)\*\*\s*(?:[—–:-]\s*)?(.*)$/.exec(t);
  if (bold) return { date: bold[1].trim(), what: bold[2].trim(), raw: line };
  const plain = /^(\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|\d{4}-\d{2}-\d{2})\s*[—–:-]\s*(.*)$/.exec(t);
  if (plain) return { date: plain[1].trim(), what: plain[2].trim(), raw: line };
  return { date: '', what: t.trim(), raw: line };
}

/** A doc as it reads: its name, about line, summary, sections and Changes. */
export function parseDoc(text: string, path = ''): Doc {
  const { lines: front, body, bodyLine } = splitDocFront(text);
  const values = frontValues(front);
  const lines = body.split(/\r?\n/);
  const fenced = fencedLines(lines);
  let name = '';
  let summaryStart = 0;
  // The title: the first line of words, when it is a "# " heading.
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const h = !fenced[i] && H1.exec(lines[i]);
    if (h) {
      name = h[1].trim();
      summaryStart = i + 1;
    }
    break;
  }
  const heads: { i: number; heading: string }[] = [];
  for (let i = summaryStart; i < lines.length; i++) {
    const h = !fenced[i] && H2.exec(lines[i]);
    if (h) heads.push({ i, heading: h[1].trim() });
  }
  const summaryEnd = heads.length ? heads[0].i : lines.length;
  const summary = lines.slice(summaryStart, summaryEnd).join('\n').trim();
  const sections: DocSection[] = [];
  let changes: DocChange[] = [];
  let changesLine = -1;
  heads.forEach((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    const sectionBody = lines.slice(h.i + 1, end).join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
    if (CHANGES_RE.test(h.heading) && changesLine < 0) {
      changesLine = bodyLine + h.i;
      changes = sectionBody
        .split(/\r?\n/)
        .map(readChange)
        .filter((c): c is DocChange => !!c && !!(c.what || c.date));
      return;
    }
    sections.push({ heading: h.heading, body: sectionBody, line: bodyLine + h.i });
  });
  const about = typeof values.about === 'string' ? values.about : '';
  return {
    name: name || (typeof values.title === 'string' && values.title) || stem(path) || 'Untitled doc',
    about,
    tags: asList(values.tags),
    canvas: typeof values.canvas === 'string' ? values.canvas.replace(/^\[\[|\]\]$/g, '') : '',
    key: typeof values['neuralspark-key'] === 'string' ? values['neuralspark-key'] : '',
    hostname: typeof values.hostname === 'string' ? values.hostname : '',
    updated: typeof values.updated === 'string' ? values.updated : '',
    summary,
    sections,
    changes,
    changesLine,
  };
}

/** A heading as a key (case, marks and spacing aside): "Add-ons" and "add ons" are the same section. */
export const headingKey = (h: string) =>
  String(h ?? '')
    .toLowerCase()
    .replace(/[*_`~[\]]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A section's first lines as plain words (for a canvas card, a preview). */
export function firstLines(body: string, max = 4): string[] {
  const out: string[] = [];
  const lines = body.split(/\r?\n/);
  const fenced = fencedLines(lines);
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const l = lines[i];
    if (fenced[i] || !l.trim() || /^\s*\|?\s*-{3,}/.test(l)) continue;
    const words = l
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/, '• ')
      .replace(/^\s*\d+[.)]\s+/, '• ')
      .replace(/^>\s?/, '')
      .replace(/!?\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]+))?\]\]/g, (_m, t: string, h: string, a: string) => a || h || t)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .replace(/^\s*\||\|\s*$/g, '')
      .replace(/\s*\|\s*/g, ' · ')
      .replace(/\s+/g, ' ')
      .trim();
    if (words && words !== '•') out.push(words);
  }
  return out;
}

// ── Changing a doc ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A property set in the front matter (made when there is none), every other line kept; '' removes it. */
export function setDocProp(text: string, key: string, value: string | string[]): string {
  const t = String(text ?? '').replace(/^﻿/, '');
  const m = FRONT.exec(t);
  const written = Array.isArray(value) ? (value.length ? `[${value.map((v) => oneLine(v, 60).replace(/[,[\]]/g, ' ').trim()).filter(Boolean).join(', ')}]` : '') : value ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : yamlText(oneLine(value, 600))) : '';
  if (!m) return written ? `---\n${key}: ${written}\n---\n${t}` : t;
  const lines = m[1].split(/\r?\n/);
  const out: string[] = [];
  let found = false;
  let skipping = false;
  for (const line of lines) {
    if (skipping && /^\s+\S/.test(line)) continue;
    skipping = false;
    if (new RegExp(`^${key}:`).test(line)) {
      found = true;
      skipping = true;
      if (written) out.push(`${key}: ${written}`);
      continue;
    }
    out.push(line);
  }
  if (!found && written) out.push(`${key}: ${written}`);
  return `---\n${out.join('\n')}\n---\n${t.slice(m[0].length)}`;
}

/** The body's lines with the place of each `##` heading (outside code). */
function bodyHeads(text: string): { prefix: string; lines: string[]; heads: { i: number; heading: string }[]; titleAt: number } {
  const t = String(text ?? '').replace(/^﻿/, '');
  const m = FRONT.exec(t);
  const prefix = m ? m[0] : '';
  const lines = t.slice(prefix.length).split(/\r?\n/);
  const fenced = fencedLines(lines);
  let titleAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (!fenced[i] && H1.test(lines[i])) titleAt = i;
    break;
  }
  const heads: { i: number; heading: string }[] = [];
  for (let i = titleAt + 1; i < lines.length; i++) {
    const h = !fenced[i] && H2.exec(lines[i]);
    if (h) heads.push({ i, heading: h[1].trim() });
  }
  return { prefix, lines, heads, titleAt };
}

const tidy = (s: string) => `${s.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`;

/** The summary (the words between the title and the first section) replaced. */
export function setDocSummary(text: string, summary: string): string {
  const { prefix, lines, heads, titleAt } = bodyHeads(text);
  const from = titleAt + 1;
  const to = heads.length ? heads[0].i : lines.length;
  const next = [...lines.slice(0, from), '', summary.trim(), '', ...lines.slice(to)];
  return tidy(prefix + next.join('\n'));
}

/**
 * Sections written in place: one with the same heading has its words replaced where it is; a new one goes before
 * Changes (or at the end). `rename` renames a section in place first.
 */
export function upsertDocSections(text: string, sections: { heading: string; text: string; rename?: string }[]): { text: string; added: string[]; changed: string[] } {
  let current = String(text ?? '');
  const added: string[] = [];
  const changed: string[] = [];
  for (const s of sections) {
    const heading = oneLine(s.heading, 120).replace(/^#+\s*/, '');
    if (!heading) continue;
    const { prefix, lines, heads } = bodyHeads(current);
    const find = (h: string) => heads.findIndex((x) => headingKey(x.heading) === headingKey(h));
    let at = s.rename ? find(s.rename) : -1;
    if (at < 0) at = find(heading);
    const words = String(s.text ?? '').replace(/\s+$/, '');
    if (at >= 0) {
      const start = heads[at].i;
      const end = at + 1 < heads.length ? heads[at + 1].i : lines.length;
      const next = [...lines.slice(0, start), `## ${heading}`, '', words, '', ...lines.slice(end)];
      current = tidy(prefix + next.join('\n'));
      changed.push(heading);
    } else {
      const changesAt = heads.find((x) => CHANGES_RE.test(x.heading))?.i ?? lines.length;
      const next = [...lines.slice(0, changesAt).join('\n').replace(/\s+$/, '').split('\n'), '', `## ${heading}`, '', words, '', ...lines.slice(changesAt)];
      current = tidy(prefix + next.join('\n'));
      added.push(heading);
    }
  }
  return { text: current, added, changed };
}

/** A section taken out (its heading and words), when it is there. */
export function removeDocSection(text: string, heading: string): string {
  const { prefix, lines, heads } = bodyHeads(text);
  const at = heads.findIndex((x) => headingKey(x.heading) === headingKey(heading));
  if (at < 0) return text;
  const end = at + 1 < heads.length ? heads[at + 1].i : lines.length;
  return tidy(prefix + [...lines.slice(0, heads[at].i), ...lines.slice(end)].join('\n'));
}

/** One dated line at the top of Changes (made, at the end, when there is none): "- **18 Oct 2026** — what". */
export function addDocChange(text: string, date: string, what: string): string {
  const line = `- **${oneLine(date, 40)}** — ${oneLine(what, 400).replace(/^[-*]\s+/, '')}`;
  const { prefix, lines, heads } = bodyHeads(text);
  const h = heads.find((x) => CHANGES_RE.test(x.heading));
  if (!h) return tidy(`${prefix}${lines.join('\n').replace(/\s+$/, '')}\n\n## ${CHANGES_HEADING}\n\n${line}`);
  let at = h.i + 1;
  while (at < lines.length && !lines[at].trim()) at++;
  const next = [...lines.slice(0, h.i + 1), '', line, ...lines.slice(at)];
  return tidy(prefix + next.join('\n'));
}

export interface NewDoc {
  name: string;
  about?: string;
  summary?: string;
  sections?: { heading: string; text: string }[];
  tags?: string[];
  /** The first Changes line ("Started this doc."). */
  change?: string;
  today: string;
}

/** A new doc in the shape above. */
export function newDocText(d: NewDoc): string {
  const front = ['type: doc'];
  if (d.about?.trim()) front.push(`about: ${yamlText(oneLine(d.about, 300))}`);
  const tags = (d.tags ?? []).map((t) => oneLine(t, 40).replace(/^#/, '').replace(/[,[\]]/g, ' ').trim()).filter(Boolean);
  if (tags.length) front.push(`tags: [${tags.join(', ')}]`);
  const body: string[] = [`# ${oneLine(d.name, 200) || 'Untitled doc'}`, ''];
  if (d.summary?.trim()) body.push(d.summary.trim(), '');
  for (const s of d.sections ?? []) {
    const heading = oneLine(s.heading, 120).replace(/^#+\s*/, '');
    if (!heading || CHANGES_RE.test(heading)) continue;
    body.push(`## ${heading}`, '', String(s.text ?? '').replace(/\s+$/, ''), '');
  }
  body.push(`## ${CHANGES_HEADING}`, '', `- **${d.today}** — ${oneLine(d.change || 'Started this doc.', 400)}`);
  return tidy(`---\n${front.join('\n')}\n---\n${body.join('\n')}`);
}

export interface DocSave {
  name: string;
  about?: string;
  summary?: string;
  sections?: { heading: string; text: string; rename?: string }[];
  /** Sections to take out (a wrong or merged one), by heading. */
  remove?: string[];
  tags?: string[];
  /** One short line for Changes: what changed. */
  change?: string;
}

/**
 * A doc made, or brought up to date in place (Ironleaf's assistant, save_doc): the summary and about line replaced
 * when given, each section written where it is (new ones before Changes), one dated line added to Changes. Never a
 * second doc for the same subject; never the conversation.
 */
export function applyDocSave(existing: string | null, input: DocSave, today: string, isoToday = ''): { text: string; words: string; made: boolean } {
  const r = saveDoc(existing, input, today);
  return isoToday && r.text !== existing ? { ...r, text: setDocProp(r.text, 'updated', isoToday) } : r;
}

function saveDoc(existing: string | null, input: DocSave, today: string): { text: string; words: string; made: boolean } {
  const sections = (input.sections ?? []).filter((s) => oneLine(s.heading) && !CHANGES_RE.test(oneLine(s.heading)));
  if (existing === null) {
    const text = newDocText({ name: input.name, about: input.about, summary: input.summary, sections, tags: input.tags, change: input.change || 'Started this doc.', today });
    return { text, words: `Made the doc ${oneLine(input.name, 120)}${sections.length ? ` with ${sections.length} ${sections.length === 1 ? 'section' : 'sections'}` : ''}.`, made: true };
  }
  let text = existing;
  if (!isDocText(text)) text = setDocProp(text, 'type', 'doc');
  if (input.about !== undefined && input.about.trim()) text = setDocProp(text, 'about', input.about);
  if (input.tags?.length) {
    const had = parseDoc(text).tags;
    text = setDocProp(text, 'tags', [...new Set([...had, ...input.tags.map((t) => t.replace(/^#/, ''))])]);
  }
  if (input.summary?.trim()) text = setDocSummary(text, input.summary);
  const up = upsertDocSections(text, sections);
  text = up.text;
  const removed: string[] = [];
  for (const h of input.remove ?? []) {
    const next = removeDocSection(text, h);
    if (next !== text) removed.push(h);
    text = next;
  }
  const parts = [up.added.length ? `added ${up.added.join(', ')}` : '', up.changed.length ? `updated ${up.changed.join(', ')}` : '', removed.length ? `took out ${removed.join(', ')}` : '', input.summary?.trim() ? 'rewrote the summary' : ''].filter(Boolean);
  const change = input.change?.trim() || (parts.length ? parts.join('; ').replace(/^./, (c) => c.toUpperCase()) : '');
  if (change && text !== existing) text = addDocChange(text, today, change);
  return { text, words: parts.length ? `Updated the doc ${parseDoc(text).name}: ${parts.join('; ')}.` : `The doc ${parseDoc(text).name} already said that.`, made: false };
}

// ── A project that is really documentation, turned into a doc (and back) ──────────────────────────────────────────

const CHANGE_LOG_PAGE = /^(change ?log|changes|history)$/i;
const INDEX_HEADING = /^documentation$/i;
/** Folders in a project's folder that hold no pages (as the former host app has them). */
export const NOT_PAGES = new Set(['activity', 'tasks', 'files', 'captures']);
const strip = (t: string) => String(t).replace(/^\s*\d+[\s._-]+/, '').trim().toLowerCase();

export interface DocPage {
  path: string;
  title: string;
  text: string;
}

/** A page read as the former host app reads one: its title (a first "# " line), the words before its first section, its "##"
sections. */
export function parsePage(text: string, fallbackTitle = ''): { title: string; intro: string; sections: { heading: string; body: string }[] } {
  const { body } = splitDocFront(repairProjectText(String(text ?? '')).text);
  let title = '';
  let fence = false;
  const intro: string[] = [];
  const sections: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && !title && !current && /^#\s+\S/.test(line)) {
      title = line.replace(/^#\s+/, '').trim();
      continue;
    }
    if (!fence && /^##\s+\S/.test(line)) {
      current = { heading: line.replace(/^##\s+/, '').replace(/\s*#*\s*$/, '').trim(), body: [] };
      sections.push(current);
      continue;
    }
    (current ? current.body : intro).push(line);
  }
  const trim = (a: string[]) => a.join('\n').replace(/^\s*\n|\s+$/g, '');
  return { title: title || fallbackTitle, intro: trim(intro), sections: sections.map((x) => ({ heading: x.heading, body: trim(x.body) })) };
}

/** A page's words as one section's: the words before its first section, then each of its sections as "###". */
export function nestPage(text: string, title: string): string {
  const page = parsePage(text, title);
  return [page.intro.trim(), ...page.sections.map((x) => `### ${x.heading}\n\n${x.body.trim()}`)].filter(Boolean).join('\n\n');
}

export interface DocShape {
  name: string;
  about: string;
  tags: string[];
  canvas: string;
  key: string;
  hostname: string;
  updated: string;
  summary: string;
  sections: { heading: string; body: string }[];
  changes: { date: string; what: string }[];
  /** Other property lines the person wrote, kept after the doc's own. */
  front: string[];
}

/** A doc written as the former host app writes one (its doc-file.mjs serializeDoc): its own properties first, then its
 * name, summary, sections and Changes. */
export function serializeDoc(d: DocShape): string {
  const own = ['type', 'about', 'tags', 'canvas', 'neuralspark-key', 'hostname', 'updated'];
  const front = ['type: doc'];
  if (d.about) front.push(`about: ${yamlText(oneLine(d.about, 600))}`);
  if (d.tags?.length) front.push(`tags: [${d.tags.map((t) => String(t).replace(/[,[\]]/g, ' ').trim()).filter(Boolean).join(', ')}]`);
  if (d.canvas) front.push(`canvas: ${yamlText(d.canvas)}`);
  if (d.key) front.push(`neuralspark-key: ${yamlText(d.key)}`);
  if (d.hostname) front.push(`hostname: ${yamlText(d.hostname)}`);
  if (d.updated) front.push(`updated: ${/^\d{4}-\d{2}-\d{2}$/.test(d.updated) ? d.updated : yamlText(d.updated)}`);
  for (const line of d.front ?? []) if (line.trim() && !own.some((k) => line.startsWith(`${k}:`))) front.push(line);
  const out = ['---', ...front, '---', `# ${String(d.name || '').trim() || 'Untitled'}`, ''];
  if (String(d.summary || '').trim()) out.push(d.summary.trim(), '');
  for (const x of d.sections ?? []) out.push(`## ${x.heading}`, '', String(x.body || '').trim(), '');
  if (d.changes?.length) out.push(`## ${CHANGES_HEADING}`, '', ...d.changes.map((c) => `- ${c.date ? `**${c.date}** — ` : ''}${String(c.what).trim()}`), '');
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`;
}

export interface ProjectToDoc {
  text: string;
  /** Pages merged in, by their path, each with the section it became (a Change log page: Changes). */
  merged: { path: string; heading: string }[];
  /** Section headings in the doc, in order (Changes aside). */
  headings: string[];
}

/**
 * A project file and its own pages as one doc, every word kept, exactly as the former host app's `neuralvault_doc
 * convert` writes it: its summary; its own sections in order (its Documentation list goes, other words there becoming
 * Related); each page beside it as a section named after it (the page's sections as "###"); its lists as sections (Next
 * steps, Key dates, People, Known issues, Decisions, Files, Notes); its Updates and a Change log page's lines as Changes,
 * newest first; its key (neuralspark-project) as the doc's neuralspark-key; its tags.
 */
export function projectToDoc(projectText: string, pages: DocPage[], opts: { name?: string; today?: string; canvas?: string; about?: string; isoToday?: string }): ProjectToDoc {
  const p = parseProject(repairProjectText(String(projectText ?? '')).text);
  const name = (opts.name ?? '').trim() || p.name;
  const d: DocShape = { name, about: opts.about ? oneLine(opts.about, 200) : '', tags: p.tags, canvas: opts.canvas ?? '', key: p.key ?? '', hostname: '', updated: opts.isoToday ?? '', summary: p.summary, sections: [], changes: [], front: [] };
  const add = (heading: string, body: string) => {
    const words = String(body || '').trim();
    if (!words) return;
    const at = d.sections.findIndex((x) => headingKey(x.heading) === headingKey(heading));
    if (at >= 0) d.sections[at].body += `\n\n${words}`;
    else d.sections.push({ heading, body: words });
  };
  const merged: { path: string; heading: string }[] = [];
  for (const x of p.extra) {
    if (INDEX_HEADING.test(x.heading.trim())) {
      // A link to the project itself (its own index entry) is not related to anything (18 Oct 2026).
      const self = `[[${p.name.toLowerCase()}`;
      const rest = x.body.split('\n').filter((l) => l.trim() && !l.toLowerCase().includes(`${self}]]`) && !l.toLowerCase().includes(`${self}|`) && !pages.some((pg) => l.toLowerCase().includes(`[[${pg.title.toLowerCase()}`)));
      if (rest.length) add('Related', rest.join('\n'));
      continue;
    }
    add(x.heading, x.body);
  }
  let logPage: { pg: DocPage; page: ReturnType<typeof parsePage> } | null = null;
  for (const pg of pages) {
    const page = parsePage(pg.text, pg.title);
    if (CHANGE_LOG_PAGE.test(strip(pg.title))) {
      logPage = { pg, page };
      merged.push({ path: pg.path, heading: CHANGES_HEADING });
      continue;
    }
    add(pg.title, nestPage(pg.text, pg.title));
    merged.push({ path: pg.path, heading: pg.title });
  }
  const more = (x: { more?: string }) => (x.more ? `\n${x.more.replace(/\s+$/, '')}` : '');
  const list = (heading: string, items: string[], rest?: string) => {
    const all = [...items, ...(rest?.trim() ? [rest.trim()] : [])];
    if (all.length) add(heading, all.join('\n'));
  };
  list('Next steps', p.next.map((n) => `- [${n.done ? 'x' : ' '}] ${n.what}${n.who || n.when ? ` — ${[n.who || '', n.when ? `by ${n.when}` : ''].filter(Boolean).join(' · ')}` : ''}${more(n)}`), p.rest?.next);
  list('Key dates', p.dates.map((x) => `- **${x.when}** — ${x.what}${x.status ? ` · ${x.status}` : ''}`), p.rest?.dates);
  list('People', p.people.map((x) => `- **${x.name}**${x.role ? ` — ${x.role}` : ''}${more(x)}`), p.rest?.people);
  list('Known issues', p.risks.map((r) => `- ${r.level ? `**${r.level}** — ` : ''}${r.what}${r.closed ? ' (closed)' : ''}${more(r)}`), p.rest?.risks);
  list('Decisions', p.decisions.map((x) => `- ${x.date ? `**${x.date}** — ` : ''}${x.what}${x.why ? ` *Why:* ${x.why}` : ''}${more(x)}`), p.rest?.decisions);
  list('Files', p.documents.map((x) => `- \`${x.path}\`${x.what ? ` — ${x.what}` : ''}${more(x)}`), p.rest?.documents);
  if (p.notes.trim()) add('Notes', p.notes);
  const changes = p.updates.map((u) => ({ date: u.date || '', what: `${u.what}${u.from ? ` *From:* ${u.from}` : ''}${u.more ? ` ${u.more.replace(/\s+/g, ' ').trim()}` : ''}` }));
  if (p.rest?.updates?.trim()) for (const l of p.rest.updates.split('\n')) if (l.trim()) changes.push({ date: '', what: l.replace(/^\s*[-*]\s+/, '').trim() });
  if (logPage) {
    for (const line of logPage.page.intro.split('\n')) {
      const m = /^\s*[-*]\s+(?:\*\*([^*]+)\*\*\s*[—–-]\s*)?(.*)$/.exec(line);
      if (m && m[2].trim()) changes.push({ date: (m[1] || '').trim(), what: m[2].trim() });
    }
    for (const x of logPage.page.sections) add(x.heading, x.body);
  }
  const when = (c: { date: string }) => {
    const t = Date.parse(c.date);
    return Number.isFinite(t) ? t : 0;
  };
  d.changes = changes
    .map((c, i) => ({ c, i }))
    .sort((a, b) => when(b.c) - when(a.c) || a.i - b.i)
    .map((x) => x.c);
  return { text: serializeDoc(d), merged, headings: d.sections.map((x) => x.heading) };
}

/**
 * A doc turned into a project (the other way, kept simple): the same words with a project's properties (planning, on
 * track), its summary under `## Summary`, `## Changes` as the project's Updates; every other section kept as written.
 */
export function docToProject(docText: string, opts: { today: string }): string {
  const { lines: front, body } = splitDocFront(docText);
  const keep = (front ?? []).filter((l) => !/^(type|canvas):/.test(l)).map((l) => l.replace(/^neuralspark-key:/, 'neuralspark-project:'));
  const fm = ['type: project', 'status: planning', 'health: on track', `started: ${opts.today}`, `updated: ${opts.today}`, ...keep.filter((l) => !/^(status|health|started|updated):/.test(l))];
  const lines = body.split(/\r?\n/);
  const fenced = fencedLines(lines);
  let titleAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (!fenced[i] && H1.test(lines[i])) titleAt = i;
    break;
  }
  let firstHead = lines.length;
  for (let i = titleAt + 1; i < lines.length; i++)
    if (!fenced[i] && H2.test(lines[i])) {
      firstHead = i;
      break;
    }
  const summary = lines.slice(titleAt + 1, firstHead).join('\n').trim();
  const rest = lines
    .slice(firstHead)
    .map((l, k) => (!fenced[firstHead + k] && /^##[ \t]+(changes|change log|changelog)[ \t]*$/i.test(l) ? '## Updates' : l))
    .join('\n');
  const title = titleAt >= 0 ? lines[titleAt] : '';
  return tidy(`---\n${fm.join('\n')}\n---\n${title ? `${title}\n\n` : ''}${summary ? `## Summary\n\n${summary}\n\n` : ''}${rest}`);
}

// ── Links that reached a project or its pages, sent to the doc ──────────────────────────────────────────────────────

export interface LinkRedirect {
  /** How a link to the doc is written from this note (its name, or its path without .md). */
  docLink: string;
  /** The section a merged page became ('' for the project file itself: the doc as a whole). */
  heading: string;
}

/**
 * Links in a note sent on: each wikilink or Markdown link that reached a file in `redirect` (by `resolve`) now reaches
 * the doc — at the page's section, or at the heading it named (the page's headings live in the doc now). Its words stay
 * what the person saw ("[[Server]]" becomes "[[Minecraft server#Server|Server]]"). Returns the text and how many changed.
 */
export function redirectLinks(content: string, resolve: (target: string) => string | null, redirect: Map<string, LinkRedirect>): { text: string; count: number } {
  let count = 0;
  const wiki = (link: ParsedWikilink, raw: string, embed: boolean) => {
    const reached = resolve(link.target);
    const to = reached ? redirect.get(reached) : undefined;
    if (!to) return raw;
    const heading = link.heading ?? to.heading;
    const shown = link.alias ?? (link.heading ? undefined : link.target.split('/').pop());
    const next = `${embed ? '!' : ''}[[${to.docLink}${heading ? `#${heading}` : ''}${shown && shown !== to.docLink ? `|${shown}` : ''}]]`;
    if (next === raw) return raw;
    count++;
    return next;
  };
  let text = replaceWikilinks(content, wiki);
  text = replaceMarkdownLinks(text, (target, fragment, raw, embed, label) => {
    const reached = resolve(target);
    const to = reached ? redirect.get(reached) : undefined;
    if (!to) return raw;
    const frag = fragment || (to.heading ? `#${encodeURIComponent(to.heading).replace(/%20/g, '%20')}` : '');
    const next = `${embed ? '!' : ''}[${label}](${`${to.docLink}.md`.replace(/ /g, '%20')}${frag})`;
    if (next === raw) return raw;
    count++;
    return next;
  });
  return { text, count };
}

// ── Words, for checking nothing was lost ────────────────────────────────────────────────────────────────────────────

/** Every word in a text (lower case, marks aside), for checks that a conversion kept them all. */
export function wordsOf(text: string): string[] {
  return (maskCode(String(text ?? '')).match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.toLowerCase());
}

// ── Templates for a new doc ─────────────────────────────────────────────────────────────────────────────────────────

/** The starting words of Ironleaf's doc templates (Templates/Docs): `type: doc-template` (a new doc is `type: doc`). */
export const DOC_TEMPLATES: { id: string; name: string; aliases: string[]; text: string }[] = [
  {
    id: 'doc-system',
    name: 'System or server',
    aliases: ['System', 'Server', 'System doc'],
    text: `---
type: doc-template
description: How something is set up and kept running — a server, a network, an app, a piece of kit.
about: "What it is and who it is for, in a line."
---
# {{title}}

What it is, what it is for, who uses it and where it runs.

## Setup

Where it lives (the machine, the address, the folder), what it runs on, and the settings that matter.

## Access

Who can get in and how: accounts, where the passwords are kept (never the passwords themselves), how to add someone.

## Operations

What keeps it running: starting and stopping it, backups and where they go, updates, what to check each week.

## Troubleshooting

- **When this happens** — what to try first, then what next.

## Changes

- **{{date:D MMM YYYY}}** — Started this doc.
`,
  },
  {
    id: 'doc-process',
    name: 'Process or how-to',
    aliases: ['Process', 'How-to', 'How to', 'Procedure'],
    text: `---
type: doc-template
description: How something is done, step by step, so anyone can do it the same way.
about: "What this process does, in a line."
---
# {{title}}

When this is done, who does it, and what it gets done.

## Before you start

- What you need (access, files, people)

## Steps

1. The first step
2. The next step
3. How you know it is done

## If something goes wrong

- **If this happens** — what to do.

## Changes

- **{{date:D MMM YYYY}}** — Started this doc.
`,
  },
  {
    id: 'doc-runbook',
    name: 'Runbook',
    aliases: ['Run book', 'Playbook', 'Incident runbook'],
    text: `---
type: doc-template
description: What to do when something needs attention — checks, fixes and who to call, in the order you need them.
about: "What this runbook covers, in a line."
---
# {{title}}

What this covers and when to use it.

## Quick checks

- [ ] Is it reachable?
- [ ] What changed lately?

## Fixes

### The usual problem

What it looks like, then the steps to fix it.

## Who to call

- **Name** — what they look after, how to reach them.

## After it is fixed

- Write one line in Changes saying what happened and what fixed it.

## Changes

- **{{date:D MMM YYYY}}** — Started this doc.
`,
  },
];

/** A blank doc's words (no template chosen). */
export function blankDocText(name: string, today: string): string {
  return newDocText({ name, summary: 'What this is, in a few sentences.', today });
}
