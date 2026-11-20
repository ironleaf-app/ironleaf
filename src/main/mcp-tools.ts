// The MCP-only tools carried out (src/shared/mcp-tools.ts has their definitions). Called from AgentAccess.asLocalMcp
// inside the call's gate, with the agent layer's own note finding: Private notes are never reached, and a change
// (restoring a version) comes back with its Undo for What agents did.

import { readProps } from '../shared/frontmatter';
import { MCP_EXTRA_NAMES } from '../shared/mcp-tools';
import { isPrivatePath } from '../shared/private';
import { anyTaskText, isPersonNote, setTaskBox } from '../shared/tasks';
import type { Snapshot } from '../shared/types';
import type { VaultIndex } from './indexer';

/** What the MCP-only tools read beyond the index (the app gives it; absent pieces are said plainly). */
export interface McpToolsHost {
  versions?(rel: string): Promise<Snapshot[]>;
  version?(rel: string, id: string): Promise<string>;
  bookmarks?(): Promise<unknown>;
}

export interface McpToolsKit {
  index: VaultIndex;
  host?: McpToolsHost;
  /** A note that is there, by path or title (throws in words; never a Private note). */
  note(raw: unknown): string;
  /** A note that may be changed (throws for a project's file). */
  writable(rel: string): void;
  read(rel: string): Promise<string>;
  write(rel: string, text: string): Promise<void>;
  /** A move or rename through the agent catalogue's own note_move. */
  move(from: string, to: string): Promise<{ text: string; done?: unknown }>;
}

export { MCP_EXTRA_NAMES };

const json = (v: unknown) => JSON.stringify(v, null, 1);
const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
const open = (p: string | null | undefined): p is string => !!p && !isPrivatePath(p);

/** One MCP-only tool's answer (null: not one of them). */
export async function runMcpTool(kit: McpToolsKit, name: string, a: Record<string, unknown>): Promise<{ text: string; done?: unknown } | null> {
  if (!MCP_EXTRA_NAMES.has(name)) return null;
  const index = kit.index;
  switch (name) {
    case 'note_links': {
      const rel = kit.note(a.path);
      const links = index
        .outgoing(rel)
        .filter((l) => !l.resolved || open(l.resolved))
        .map((l) => ({ to: l.resolved ?? l.target, title: l.title, line: l.line + 1, ...(l.resolved ? {} : { notWrittenYet: true }), ...(l.embed ? { embed: true } : {}) }));
      const backlinks = index
        .backlinks(rel)
        .filter((b) => open(b.source))
        .map((b) => ({ from: b.source, title: b.sourceTitle, line: b.line + 1, text: b.context, ...(b.prop ? { property: b.prop } : {}) }));
      return { text: json({ note: rel, links, backlinks }) };
    }
    case 'graph_neighbours': {
      const limit = num(a.limit, 1, 300, 60);
      const raw = str(a.path).trim();
      const nodes = new Map<string, number>();
      const edges = new Set<string>();
      const join = (x: string, y: string) => edges.add(`${x}\u0000${y}`);
      const around = (p: string) => {
        const out: string[] = [];
        for (const l of index.outgoing(p)) if (open(l.resolved)) {
          out.push(l.resolved);
          join(p, l.resolved);
        }
        for (const b of index.backlinks(p)) if (open(b.source) && b.source !== p) {
          out.push(b.source);
          join(b.source, p);
        }
        return out;
      };
      if (raw) {
        const start = kit.note(raw);
        nodes.set(start, 0);
        let ring = [start];
        for (let d = 1; d <= num(a.depth, 1, 2, 1) && nodes.size < limit; d++) {
          const next: string[] = [];
          for (const p of ring) for (const q of around(p)) if (!nodes.has(q) && nodes.size < limit) {
            nodes.set(q, d);
            next.push(q);
          }
          ring = next;
        }
      } else {
        const top = index
          .allMeta()
          .filter((m) => open(m.path))
          .map((m) => ({ p: m.path, n: index.linkCount(m.path) }))
          .sort((x, y) => y.n - x.n)
          .slice(0, limit);
        for (const t of top) nodes.set(t.p, 0);
        for (const t of top) around(t.p);
      }
      const links = [...edges].map((e) => e.split('\u0000')).filter(([x, y]) => nodes.has(x) && nodes.has(y)).map(([source, target]) => ({ source, target }));
      return { text: json({ nodes: [...nodes].map(([path, depth]) => ({ path, title: index.get(path)?.title ?? path, ...(raw ? { depth } : { links: index.linkCount(path) }) })), links }) };
    }
    case 'tags_list':
      return { text: json(index.tags().slice(0, 1000)) };
    case 'note_properties': {
      const rel = kit.note(a.path);
      return { text: json({ note: rel, properties: readProps(index.content(rel) ?? (await kit.read(rel))) ?? {} }) };
    }
    case 'meaning_search': {
      const query = str(a.query, 300).trim();
      if (!query) throw new Error('Give what to look for in query.');
      const hits = (await index.searchAsync(query, num(a.limit, 1, 50, 10), 2)).filter((h) => open(h.path));
      return { text: hits.length ? json(hits.map((h) => ({ path: h.path, title: h.title, ...(h.meaning ? { byMeaning: true } : {}), lines: h.snippets.slice(0, 3).map((m) => m.text) }))) : 'Nothing found.' };
    }
    case 'related_notes': {
      const rel = kit.note(a.path);
      const items = index.relatedNotes(rel, num(a.limit, 1, 30, 10), (p) => !open(p));
      return { text: json(items.map((r) => ({ path: r.path, title: r.title, score: Math.round(r.score * 100) / 100, why: r.reasons }))) };
    }
    case 'reminders_list': {
      const out = index
        .reminders()
        .filter((n) => open(n.path))
        .flatMap((n) => n.items.map((r) => ({ note: n.path, title: n.title, line: r.line + 1, text: r.text, due: new Date(r.due).toISOString(), done: r.done, ...(r.repeat ? { repeats: true } : {}) })));
      return { text: out.length ? json(out.slice(0, 500)) : 'No reminders are set.' };
    }
    case 'people_list': {
      const people = index
        .allMeta()
        .filter((m) => open(m.path) && /\.md$/i.test(m.path) && isPersonNote(m.path, m.props))
        .map((m) => ({ path: m.path, name: m.title || m.path }))
        .sort((x, y) => x.name.localeCompare(y.name));
      return { text: people.length ? json(people.slice(0, 1000)) : 'No one has a page yet.' };
    }
    case 'bookmarks_list': {
      if (!kit.host?.bookmarks) throw new Error('Bookmarks are kept by the Ironleaf app (not here).');
      const raw = await kit.host.bookmarks();
      const text = JSON.stringify(raw ?? []);
      return { text: text === '[]' || text === 'null' || text === '{}' ? 'No bookmarks yet.' : json(raw) };
    }
    case 'note_versions': {
      const rel = kit.note(a.path);
      if (!kit.host?.versions) throw new Error('File recovery is kept by the Ironleaf app (not here).');
      const list = await kit.host.versions(rel);
      return { text: list.length ? json(list.slice(0, 100).map((v) => ({ id: v.id, kept: new Date(v.time).toISOString(), size: v.size, ...(v.by ? { by: v.by } : {}) }))) : `File recovery keeps no earlier versions of ${rel} yet.` };
    }
    case 'note_version_read':
    case 'note_version_restore': {
      const rel = kit.note(a.path);
      const id = str(a.id, 200).trim();
      if (!id) throw new Error('Give the version’s id (note_versions has them).');
      if (!kit.host?.version) throw new Error('File recovery is kept by the Ironleaf app (not here).');
      const old = await kit.host.version(rel, id);
      if (name === 'note_version_read') return { text: old };
      kit.writable(rel);
      const before = index.content(rel) ?? (await kit.read(rel));
      if (before === old) return { text: `${rel} is already as it was in that version.` };
      await kit.write(rel, old);
      return { text: `Put ${rel} back as it was in that version.`, done: { words: `Restored an earlier version of ${rel}.`, note: rel, undo: { kind: 'note-edited', path: rel, before, after: old } } };
    }
    case 'task_set_done': {
      const rel = kit.note(a.path);
      const want = str(a.text, 600).trim();
      if (!want) throw new Error('Give the task’s words in text (tasks_list has them).');
      const done = a.done !== false;
      kit.writable(rel);
      const before = index.content(rel) ?? (await kit.read(rel));
      const lines = before.split('\n');
      const tasks = lines.map((line, i) => ({ i, words: anyTaskText(line.replace(/\r$/, '')) })).filter((t): t is { i: number; words: string } => t.words !== null);
      const low = want.toLowerCase();
      const exact = tasks.filter((t) => t.words.trim().toLowerCase() === low);
      const hits = exact.length ? exact : tasks.filter((t) => t.words.toLowerCase().includes(low));
      if (!hits.length) throw new Error(`No task in ${rel} has those words. tasks_list shows the tasks as they are written.`);
      if (hits.length > 1 && !exact.length) throw new Error(`${hits.length} tasks in ${rel} have those words. Give more of the one you mean.`);
      const at = hits[0].i;
      const cr = lines[at].endsWith('\r') ? '\r' : '';
      const next = setTaskBox(lines[at].replace(/\r$/, ''), done) + cr;
      if (next === lines[at]) return { text: `That task is already ${done ? 'ticked' : 'open'}.` };
      lines[at] = next;
      const after = lines.join('\n');
      await kit.write(rel, after);
      const words = `${done ? 'Ticked' : 'Unticked'} “${hits[0].words.trim().slice(0, 80)}” in ${rel}.`;
      return { text: words, done: { words, note: rel, undo: { kind: 'note-edited', path: rel, before, after } } };
    }
    case 'note_rename': {
      const rel = kit.note(a.path);
      const name0 = str(a.name, 200).trim().replace(/\.md$/i, '');
      if (!name0 || /[\\/:*?"<>|]/.test(name0)) throw new Error('Give the new name, without folders or any of \\ / : * ? " < > |.');
      const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
      return kit.move(rel, `${folder}${name0}.md`);
    }
  }
  return null;
}
