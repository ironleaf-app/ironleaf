// Templates (17 Oct 2026): notes in the Templates folder that start a new note, shape a new project, or set out how The
// former host app writes a report. What each one is, where it is used, and how a note or a project file is made from one.
// Ironleaf's main side and its window both use this module; it touches no files.
//
//   Templates/Notes/…      a note's starting words (meeting notes, a weekly status update, today's note)
//   Templates/Projects/…   the shape of a new project: its first next steps, key dates and risks (type: project-template)
//   Templates/Docs/…       the shape of a new doc: a system or server, a process, a runbook (type: doc-template)
//   Templates/Reports/… how the former host app lays out a report (type: report-template), and notes written for reports
//
// In a template, `description:` says in a line what it is for (shown on the Templates page; never copied into a note).

import { fillTemplate, type TemplateVars } from './dates';
import { fillFields, type TemplateAnswers } from './template-fields';
import { emptyProject, parseProject, projectKey, serializeProject, type Project } from './project-file';

export type TemplateGroup = 'notes' | 'projects' | 'docs' | 'reports';
/** note: starts a note · project: shapes a new project · report: how the former host app writes a report (not a note to
make). */
export type TemplateKind = 'note' | 'project' | 'doc' | 'report';

export interface TemplateInfo {
  path: string;
  name: string;
  group: TemplateGroup;
  kind: TemplateKind;
  /** One line: what it is for. */
  description: string;
  /** One line: where Ironleaf uses it. */
  usedFor: string;
  /** Ironleaf's own (its id), still where Ironleaf put it; else the person's own. */
  builtIn?: string;
  modified: number;
  /** The template as written (the page fills it in for its preview). */
  text: string;
  /** For a project template: how many next steps, key dates and risks a project starts with. */
  counts?: { next: number; dates: number; risks: number };
}

export const GROUPS: { id: TemplateGroup; label: string; folder: string; words: string }[] = [
  { id: 'notes', label: 'Notes', folder: 'Notes', words: 'A note with its shape already there. Pick one when you make a note, or type / Template inside a note.' },
  { id: 'projects', label: 'Projects', folder: 'Projects', words: 'The shape of a new project: its first next steps, key dates and risks, ready to change. Offered when you make a project.' },
  { id: 'docs', label: 'Docs', folder: 'Docs', words: 'The shape of a new doc: how something is set up and run, a process step by step, or what to do when something needs attention. Offered when you make a doc.' },
  { id: 'reports', label: 'Reports', folder: 'Reports', words: 'How your reports are laid out, and the notes you gather for them.' },
];

/** Properties that describe a template, never copied into what is made from it. */
const TEMPLATE_ONLY = new Set(['description', 'template']);

/** The properties a project file keeps (src/shared/project-file.ts writes them in its own order). */
const PROJECT_KEYS = /^(type|status|health|progress|owner|folder|repository|started|due|updated|tags|neuralspark-project):/;

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** A note's front matter lines and the words after it. */
export function splitFront(text: string): { lines: string[] | null; body: string } {
  const t = String(text ?? '').replace(/^﻿/, '');
  const m = FRONT.exec(t);
  return m ? { lines: m[1].split(/\r?\n/), body: t.slice(m[0].length) } : { lines: null, body: t };
}

const unquote = (v: string) => v.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

/** A property's value as written in the front matter ('' when not there). */
export function frontValue(text: string, key: string): string {
  const { lines } = splitFront(text);
  for (const line of lines ?? []) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv && kv[1] === key) return unquote(kv[2]);
  }
  return '';
}

/** The front matter without the template's own properties, and without any left empty once filled ({{project}} when
 * there is no project: `project: "[[]]"` goes rather than linking nowhere). A key's indented lines go with it. */
function cleanFront(lines: string[]): string[] {
  const out: string[] = [];
  let dropping = false;
  for (const line of lines) {
    if (/^\s/.test(line) && line.trim()) {
      if (!dropping) out.push(line);
      continue;
    }
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) {
      dropping = false;
      out.push(line);
      continue;
    }
    const value = kv[2].trim();
    const empty = /^(""|''|"\[\[\]\]"|\[\[\]\]|\[\])$/.test(value);
    dropping = TEMPLATE_ONLY.has(kv[1]) || empty;
    if (!dropping) out.push(line);
  }
  return out;
}

/** What a template is, by its properties and where it is kept. */
export function templateKind(text: string): TemplateKind {
  const type = frontValue(text, 'type').toLowerCase();
  if (type === 'report-template') return 'report';
  if (type === 'project-template') return 'project';
  if (type === 'doc-template') return 'doc';
  return 'note';
}

/** Which part of the Templates page it belongs in: its folder (Templates/Projects…), else what it is. */
export function templateGroup(path: string, folder: string, kind: TemplateKind): TemplateGroup {
  if (kind === 'project') return 'projects';
  if (kind === 'doc') return 'docs';
  if (kind === 'report') return 'reports';
  const rel = folder && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
  const top = rel.includes('/') ? rel.slice(0, rel.indexOf('/')).toLowerCase() : '';
  if (top === 'reports') return 'reports';
  // A plain note kept in Templates/Projects is still a note's template (a project brief), shown with the notes.
  return 'notes';
}

/** One line on what a template is for: its description, else its first line of words. */
export function templateDescription(text: string): string {
  const own = frontValue(text, 'description');
  if (own) return own.slice(0, 200);
  const { body } = splitFront(text);
  for (const raw of body.split(/\r?\n/)) {
    if (/^\s*#/.test(raw)) continue;
    const line = raw.replace(/^#+\s*|^[-*+]\s+(\[[ xX]\]\s*)?|^>\s*(\[![^\]]*\]\s*)?/g, '').replace(/[*_`]|\{\{[^}]*\}\}/g, '').trim();
    if (line.length > 3 && !/^\|/.test(line)) return line.slice(0, 160);
  }
  return '';
}

/** A note template's sections ("Why we met · Decisions · Actions"), so a card shows what is in it. */
export function templateOutline(text: string, max = 4): string {
  const heads = splitFront(text)
    .body.split(/\r?\n/)
    .map((l) => /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(l)?.[1]?.replace(/\{\{[^}]*\}\}/g, '').trim())
    .filter((h): h is string => !!h);
  return heads.length ? `${heads.slice(0, max).join(' · ')}${heads.length > max ? ' …' : ''}` : '';
}

/** Whether where a template is used is particular to it (today's note, a report, a new project), not every note's. */
export const usedParticularly = (t: { kind: TemplateKind; usedFor: string }) => t.kind !== 'note' || /today/i.test(t.usedFor);

/** Where Ironleaf uses a template, in a line the person understands. */
export function templateUsedFor(t: { kind: TemplateKind; text: string; path: string }, daily: string | null): string {
  if (t.kind === 'report') {
    const report = frontValue(t.text, 'report').toLowerCase();
    if (report === 'portfolio') return 'Used when you make an update across all projects (Projects home)';
    if (report === 'progress') return 'Used when you make a progress report from a project’s page';
    return 'The layout a report follows';
  }
  if (t.kind === 'project') return 'Offered when you make a new project';
  if (t.kind === 'doc') return 'Offered when you make a new doc (Docs in the side bar)';
  if (daily && daily.toLowerCase() === t.path.toLowerCase()) return 'Used for today’s note (Ctrl+Shift+D)';
  return 'Use it for a new note, or insert it into one with / Template';
}

/** The words of a new note made from a template: filled in, the template's own properties left out. Its prompts, AI
 * fields and cursor (src/shared/template-fields.ts; 21 Oct 2026) take the answers given, else what they had filled in or
 * nothing; nothing in a template is ever run. */
export function noteFromTemplate(text: string, vars: TemplateVars & { answers?: TemplateAnswers }): string {
  const filled = fillFields(fillTemplate(String(text ?? ''), vars), vars.answers);
  const { lines, body } = splitFront(filled);
  if (!lines) return body.replace(/^\s*\n/, '');
  const kept = cleanFront(lines).filter((l, i, all) => l.trim() || (i > 0 && i < all.length - 1));
  const rest = body.replace(/^\s*\n/, '');
  return kept.some((l) => l.trim()) ? `---\n${kept.join('\n')}\n---\n${rest}` : rest;
}

/** A template's words to put into a note that has words already: no properties (the note has its own). */
export function bodyOfTemplate(text: string, vars: TemplateVars & { answers?: TemplateAnswers }): string {
  return splitFront(fillFields(fillTemplate(String(text ?? ''), vars), vars.answers)).body.replace(/^\s*\n/, '');
}

/** A new project's file made from a project template: its next steps, key dates and risks, the name and dates filled in,
 * written in the one project format (src/shared/project-file.ts). */
export function projectFromTemplate(text: string, vars: TemplateVars & { name: string; today: string; folder?: string }): { project: Project; text: string } {
  const filled = text.trim() ? fillTemplate(String(text), { ...vars, title: vars.name, project: vars.name }) : '';
  const { lines, body } = splitFront(filled);
  // The project's own properties are written in their usual order (src/shared/project-file.ts); the person's stay.
  const front = lines ? cleanFront(lines).filter((l) => !PROJECT_KEYS.test(l)) : [];
  const facts = lines ? cleanFront(lines).filter((l) => PROJECT_KEYS.test(l)) : [];
  const base = front.length ? `---\n${front.join('\n')}\n---\n${body}` : body;
  const p: Project = filled ? parseProject(`---\n${[...facts, ...front].join('\n')}\n---\n${body}`, `${vars.name}.md`) : emptyProject(vars.name);
  p.name = vars.name;
  p.status = p.status || 'planning';
  p.health = p.health || 'on track';
  p.started = p.started || vars.today;
  p.updated = vars.today;
  p.next = p.next.map((n) => ({ ...n, done: false }));
  if (vars.folder?.trim()) {
    p.folder = vars.folder.trim();
    p.key = projectKey(p.folder);
  }
  return { project: p, text: serializeProject(p, base) };
}

/** How many next steps, key dates and risks a project template gives a new project. */
export function projectTemplateCounts(text: string): { next: number; dates: number; risks: number } {
  const p = parseProject(splitFront(text).lines ? text : `---\ntype: project-template\n---\n${text}`);
  return { next: p.next.length, dates: p.dates.length, risks: p.risks.length };
}

/** A template made from a note the person has ("Save as template"). A project's file becomes the shape of a new project:
 * its steps (unticked), dates and risks kept, its own facts (folder, progress, updates, documents, decisions) left out. */
export function templateFromNote(text: string, opts: { description?: string; isProject: boolean; isDoc?: boolean }): string {
  if (opts.isDoc) {
    const made = templateFromNote(text, { ...opts, isDoc: false, isProject: false });
    return /^---\r?\n[\s\S]*?^type:/m.test(made) ? made.replace(/^type:\s*["']?doc["']?\s*$/m, 'type: doc-template') : made.startsWith('---\n') ? made.replace(/^---\n/, '---\ntype: doc-template\n') : `---\ntype: doc-template\n---\n${made}`;
  }
  const describe = opts.description?.trim() ? `description: ${JSON.stringify(opts.description.trim())}` : '';
  if (opts.isProject) {
    const p = parseProject(text);
    const shape: Project = { ...emptyProject('{{title}}'), status: 'planning', health: 'on track', tags: p.tags, summary: p.summary, next: p.next.map((n) => ({ what: n.what, done: false, ...(n.who ? { who: n.who } : {}) })), dates: p.dates.map((d) => ({ when: d.when, what: d.what })), people: p.people, risks: p.risks, notes: '', extra: p.extra };
    const written = serializeProject(shape).replace(/^---\ntype: project\n/, `---\ntype: project-template\n${describe ? `${describe}\n` : ''}`);
    return written;
  }
  const { lines, body } = splitFront(text);
  const kept = (lines ?? []).filter((l) => !/^(description|template):/.test(l));
  const front = [...(describe ? [describe] : []), ...kept].filter((l, i, all) => l.trim() || (i > 0 && i < all.length - 1));
  return front.length ? `---\n${front.join('\n')}\n---\n${body.replace(/^\s*\n/, '')}` : body;
}

/** The templates whose name, description, use or outline holds the words typed (every word, any case). */
export function filterTemplates(templates: readonly TemplateInfo[], query: string): TemplateInfo[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...templates];
  return templates.filter((t) => {
    const hay = `${t.name} ${t.description} ${t.usedFor} ${templateOutline(t.text)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** When each template was last used (its path to the moment), as the window keeps it. */
export type TemplateUsed = Record<string, number>;

/** The usage log with one template used now (paths that no longer exist fall away when read back). */
export function recordTemplateUsed(used: TemplateUsed, path: string, now: number = Date.now()): TemplateUsed {
  return { ...used, [path]: now };
}

/** Templates with the lately used first (most recent first), the rest in the order given. */
export function sortTemplatesByUsed(templates: readonly TemplateInfo[], used: TemplateUsed): TemplateInfo[] {
  return [...templates].sort((a, b) => (used[b.path] ?? 0) - (used[a.path] ?? 0));
}

/** A new, empty template of its kind, ready for the person's words. */
export function starterTemplate(group: TemplateGroup): string {
  if (group === 'docs')
    return `---\ntype: doc-template\ndescription: "What this kind of doc is for, in a line."\nabout: "What it is, in a line."\n---\n# {{title}}\n\nWhat it is, what it is for and who uses it.\n\n## Setup\n\n\n## How it is run\n\n\n## Changes\n\n- **{{date:D MMM YYYY}}** — Started this doc.\n`;
  if (group === 'projects')
    return `---\ntype: project-template\ndescription: "The shape of a new project: what it starts with."\nstatus: planning\nhealth: on track\n---\n# {{title}}\n\n## Summary\n\nWhat this kind of project is for, and what done looks like.\n\n## What’s next\n\n- [ ] The first thing to do — by {{date+1w:D MMM YYYY}}\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| {{date:D MMM YYYY}} | Start | planned |\n\n## Risks and issues\n\n- **Medium** — Something that could hold it up.\n\n## Notes\n`;
  return `---\ndescription: "What this template is for, in a line."\ndate: {{date}}\n---\nThe words every note made from this starts with. {{title}} becomes the note’s name, {{date}} today’s date and {{project}} the project it’s made from.\n\n## \n`;
}
