// The one way agents get into the vault (Wave 4, 24 Oct 2026): a gate per agent, made from the sensitivity rules
// (src/main/sensitivity.ts, src/shared/sensitivity.ts), wrapped around everything an agent reads or changes through:
//  - the index (search, a note's words, its properties, links both ways, related notes, the connected vault's records,
//    tags, tasks and reminders, what the chat retrieves): what the agent isn't allowed simply isn't there;
//  - the notes as the assistant's tools reach them (listing, reading, writing, moving, the Bin, tasks, Recently deleted,
//    assets, projects' folders and their files);
//  - and, for outside agents (src/main/agent-access.ts), the projects, Today, templates, saved files and Full control.
// The side chat (src/main/ai.ts), every outside agent's call (src/main/agent-access.ts) and Full control use only what is
// made here. Private notes stay out as before. Reads of sensitive items (anything not Open) go in the audit trail, and so
// do refusals; a Family-private photo needs the person's OK for each use (ConsentNeeded).

import type { AgentHost } from './agent';
import type { AgentAccessHost } from './agent-access';
import type { VaultIndex } from './indexer';
import type { Sensitivity } from './sensitivity';
import { isPrivatePath } from '../shared/private';
import { isPicture, type AgentId, type AuditAction, type Level } from '../shared/sensitivity';
import { matchBinItems } from './bin';

/** A Family-private photo the person must allow for this use (an outside agent's call waits for their card). */
export class ConsentNeeded extends Error {
  constructor(
    readonly rel: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConsentNeeded';
  }
}

export interface Gate {
  who: AgentId;
  name: string;
  /** Changes when what this agent may see could have changed (its records are kept apart by it). */
  key(): string;
  level(rel: string): Level;
  /** Whether the item shows to this agent at all (lists, search, links, records). */
  sees(rel: string): boolean;
  /** Whether this agent is allowed a level at all (a new record of a module, before it has a note to check). */
  allowsLevel(level: Level): boolean;
  /** For reading or changing one named item: throws the refusal in words (ConsentNeeded for a photo awaiting an OK). */
  check(rel: string, action?: 'read' | 'changed'): void;
  /** A sensitive item read or changed: into the audit trail (Open items aren't). */
  note(rel: string, action: AuditAction, detail?: string): void;
  /** Sensitive items in a list of results: one line in the trail for the lot. */
  listed(rels: string[], detail: string): void;
}

const PRIVATE = 'Private notes are never open to agents.';

/** The gate for one agent. */
export function makeGate(s: Sensitivity, who: AgentId, name: string): Gate {
  // A photo allowed once stays allowed for the rest of the call (or chat turn) that used it: one use, however many reads.
  const usedNow = new Set<string>();
  const gate: Gate = {
    who,
    name,
    key: () => `${who}\n${s.stamp()}`,
    level: (rel) => s.level(rel),
    allowsLevel: (level) => s.allows(who, level),
    sees: (rel) => {
      if (!rel || isPrivatePath(rel)) return false;
      if (usedNow.has(rel.toLowerCase())) return true;
      const d = s.decide(who, rel, name);
      return d.ok;
    },
    check: (rel, action = 'read') => {
      if (isPrivatePath(rel)) throw new Error(PRIVATE);
      if (usedNow.has(rel.toLowerCase())) return;
      const d = s.decide(who, rel, name);
      if (d.ok) {
        // A photo allowed once: that one use is spent now (for the rest of this call it stays allowed).
        if (d.level === 'family' && isPicture(rel) && s.useGrant(who, rel)) {
          usedNow.add(rel.toLowerCase());
          s.audit({ who, whoName: name, action: 'read', item: rel, level: d.level, detail: 'allowed once by you' });
        }
        return;
      }
      s.audit({ who, whoName: name, action: d.consent ? 'asked' : 'refused', item: rel, level: d.level, detail: action === 'changed' ? 'to change it' : 'to read it' });
      if (d.consent) throw new ConsentNeeded(rel, d.why);
      throw new Error(d.why);
    },
    note: (rel, action, detail) => {
      const level = s.level(rel);
      if (level !== 'open') s.audit({ who, whoName: name, action, item: rel, level, ...(detail ? { detail } : {}) });
    },
    listed: (rels, detail) => {
      const sensitive = [...new Set(rels)].filter((r) => s.level(r) !== 'open');
      if (!sensitive.length) return;
      const levels = [...new Set(sensitive.map((r) => s.level(r)))];
      s.audit({ who, whoName: name, action: 'listed', item: sensitive.slice(0, 12).join(', ') + (sensitive.length > 12 ? ` and ${sensitive.length - 12} more` : ''), ...(levels.length === 1 ? { level: levels[0] } : {}), detail });
    },
  };
  return gate;
}

/** The index as one agent may see it. Anything not listed here is refused, so a new reader can't slip past. */
export function gateIndex(index: VaultIndex, g: Gate): VaultIndex {
  const sees = (p: string | null | undefined) => !!p && g.sees(p);
  const api: Partial<Record<keyof VaultIndex, unknown>> = {
    generation: () => index.generation(),
    isExcluded: (p: string) => index.isExcluded(p),
    // Whether a path is in a folder kept out of view (Settings): the tools' own listings read past those (list_notes,
    // recent_notes). Says nothing about a note's words. Missing here, list_notes failed every time in the side chat.
    isQuiet: (p: string) => index.isQuiet(p),
    has: (p: string) => sees(p) && index.has(p),
    get: (p: string) => (sees(p) ? index.get(p) : undefined),
    content: (p: string) => {
      if (!sees(p)) return undefined;
      const c = index.content(p);
      if (c !== undefined) g.note(p, 'read');
      return c;
    },
    allMeta: () => index.allMeta().filter((m) => sees(m.path)),
    resolve: (t: string, from?: string) => {
      const r = index.resolve(t, from);
      return r && sees(r) ? r : null;
    },
    resolveAny: (t: string, from?: string) => {
      const r = index.resolveAny(t, from);
      return r && sees(r) ? r : null;
    },
    resolveFile: (t: string, from?: string) => {
      const r = index.resolveFile(t, from);
      return r && sees(r) ? r : null;
    },
    writtenFromFolder: (t: string, from: string) => index.writtenFromFolder(t, from),
    search: (q: string, limit?: number, lines?: number) => {
      const hits = index.search(q, (limit ?? 200) * 3, lines).filter((h) => sees(h.path)).slice(0, limit ?? 200);
      g.listed(hits.map((h) => h.path), `search for “${q.slice(0, 80)}”`);
      return hits;
    },
    query: (q: string, limit?: number) => index.query(q, 100000).filter(sees).slice(0, limit ?? 5000),
    retrieve: (q: string, limit = 8, maxChars = 24000) => {
      const out = [];
      let chars = 0;
      for (const c of index.retrieve(q, limit * 4, maxChars * 4)) {
        if (!sees(c.path)) continue;
        if (out.length >= limit || chars + c.text.length > maxChars) break;
        out.push(c);
        chars += c.text.length;
      }
      g.listed(out.map((c) => c.path), 'notes matching a question');
      return out;
    },
    backlinks: (p: string) => (sees(p) ? index.backlinks(p).filter((b) => sees(b.source)) : []),
    unlinkedMentions: (p: string) => (sees(p) ? index.unlinkedMentions(p).filter((b) => sees(b.source)) : []),
    mentionsIn: (p: string, content: string) => index.mentionsIn(p, content).filter((m) => sees(m.target)),
    outgoing: (p: string) => (sees(p) ? index.outgoing(p).map((o) => (o.resolved && !sees(o.resolved) ? { ...o, resolved: null, title: o.target } : o)) : []),
    linkCount: (p: string) => (sees(p) ? index.linkCount(p) : 0),
    relatedNotes: (p: string, limit = 12, skip?: (path: string) => boolean) => (sees(p) ? index.relatedNotes(p, limit, (x) => !sees(x) || !!skip?.(x)) : []),
    related: (p: string, limit = 10) => (sees(p) ? index.related(p, limit * 3).filter((r) => sees(r.path)).slice(0, limit) : []),
    tags: () => {
      const counts = new Map<string, number>();
      for (const m of index.allMeta()) if (sees(m.path)) for (const t of m.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
      return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
    },
    tasks: () => index.tasks().filter((t) => sees(t.path)),
    reminders: () => index.reminders().filter((r) => sees(r.path)),
    daysIn: (p: string) => (sees(p) ? index.daysIn(p) : []),
    records: (opts: Parameters<VaultIndex['records']>[0] = {}) => index.records({ ...opts, allow: sees, allowKey: g.key() }),
    graph: (templates?: string) => {
      const g2 = index.graph(templates);
      const nodes = g2.nodes.filter((n) => sees((n as { id: string }).id));
      const ids = new Set(nodes.map((n) => (n as { id: string }).id));
      return { nodes, links: g2.links.filter((l) => ids.has(String((l as { source: unknown }).source)) && ids.has(String((l as { target: unknown }).target))) };
    },
  };
  return new Proxy(index, {
    get(target, prop) {
      if (prop in api) return api[prop as keyof VaultIndex];
      const v = Reflect.get(target, prop, target);
      if (typeof v === 'function') return () => {
        throw new Error(`Agents don’t use the index’s ${String(prop)}, so this step couldn’t run: a fault in Ironleaf, not in the notes. Use another way (search_notes, read_note) for now.`);
      };
      return v;
    },
  });
}

/** The notes as the assistant's tools reach them, for one agent. */
export function gateNotes(host: AgentHost, g: Gate): AgentHost {
  const out: AgentHost = {
    ...host,
    index: gateIndex(host.index, g),
    listing: async () => {
      const l = await host.listing();
      const files = l.files.filter((f) => g.sees(f.rel));
      // A folder shows when something in it does, or when its own level (an empty folder's default) is the agent's: a
      // project's or an area's folder name never gives away what the agent can't read.
      const folders = l.folders.filter((f) => !isPrivatePath(f) && (files.some((x) => x.rel.startsWith(`${f}/`)) || g.sees(`${f}/.folder`)));
      return { files, folders, ...(l.skipped ? { skipped: l.skipped } : {}) };
    },
    // Whether it is there at all (so nothing is written over a note the agent can't see); reading it is refused.
    exists: async (rel) => host.exists(rel),
    refuseHidden: (named) => {
      const base = host.index;
      const raw = String(named ?? '').trim();
      const p = base.get(raw) ? raw : base.get(`${raw}.md`) ? `${raw}.md` : base.resolve(raw.replace(/\.md$/i, ''));
      if (p && !g.sees(p)) g.check(p);
    },
    read: async (rel) => {
      g.check(rel);
      const text = await host.read(rel);
      g.note(rel, 'read');
      return text;
    },
    write: async (rel, text) => {
      // Every write is checked, new or not: a level reads off the folder, so a new note in a folder the agent may
      // not use is refused like a change to one already there.
      g.check(rel, 'changed');
      await host.write(rel, text);
      g.note(rel, 'changed');
    },
    move: async (from, to) => {
      g.check(from, 'changed');
      g.check(to, 'changed');
      return host.move(from, to);
    },
    trash: async (rel) => {
      g.check(rel, 'changed');
      return host.trash(rel);
    },
  };
  if (host.markBillPaid) {
    const mark = host.markBillPaid;
    out.markBillPaid = async (rel, day) => {
      g.check(rel, 'changed');
      const said = await mark(rel, day);
      g.note(rel, 'changed', said);
      return said;
    };
  }
  if (host.bin) {
    const bin = host.bin;
    // Folders hold many notes of mixed levels: each note in one is checked before it goes or comes back.
    const checkTree = async (rel: string): Promise<void> => {
      g.check(rel, 'changed');
      const l = await host.listing();
      if (l.folders.includes(rel)) for (const f of l.files) if (f.rel.startsWith(`${rel}/`)) g.check(f.rel, 'changed');
    };
    out.bin = {
      put: async (rel, opts) => {
        await checkTree(rel);
        const r = await bin.put(rel, opts);
        g.note(rel, 'changed', 'to the Bin');
        return r;
      },
      list: async () => (await bin.list()).filter((it) => g.sees(it.path)),
      restore: async (which) => {
        // Checked before it comes back: what `which` means, matched the Bin's own way (no match or several is the
        // Bin's own refusal, with nothing written either way).
        const { matches } = matchBinItems(await bin.list(), which);
        if (matches.length === 1) await checkTree(matches[0].path);
        const r = await bin.restore(which);
        g.note(r.restored, 'changed', 'from the Bin');
        return r;
      },
    };
  }
  if (host.tasks) {
    const tasks = host.tasks;
    out.tasks = {
      tick: async (path, line, text, done) => {
        g.check(path, 'changed');
        const r = await tasks.tick(path, line, text, done);
        g.note(path, 'changed', done ? 'ticked a task' : 'unticked a task');
        for (const c of r.changed) if (c.path !== path) g.note(c.path, 'changed', 'a tick’s matching step');
        return r;
      },
      setDue: async (path, line, text, iso, time) => {
        g.check(path, 'changed');
        const r = await tasks.setDue(path, line, text, iso, time);
        g.note(path, 'changed', 'moved a task’s day');
        return r;
      },
    };
  }
  if (host.assets) {
    const assets = host.assets;
    out.assets = {
      list: async () => {
        const l = await assets.list();
        return { ...l, assets: l.assets.filter((a) => g.sees(a.path)) };
      },
      details: async (rel) => {
        g.check(rel);
        const d = await assets.details(rel);
        g.note(rel, 'read');
        return d;
      },
    };
  }
  if (host.pictureWords) {
    const pw = host.pictureWords;
    out.pictureWords = {
      search: (query, limit) => {
        const hits = pw.search(query, limit * 3).filter((h) => g.sees(h.path)).slice(0, limit);
        g.listed(hits.map((h) => h.path), `picture search for “${query.slice(0, 80)}”`);
        return hits;
      },
      read: (rel) => {
        g.check(rel);
        const text = pw.read(rel);
        if (text !== null) g.note(rel, 'read');
        return text;
      },
      has: (rel) => g.sees(rel) && pw.has(rel),
    };
  }
  if (host.readNoteDocument) {
    const readDoc = host.readNoteDocument;
    out.readNoteDocument = async (rel) => {
      g.check(rel);
      const text = await readDoc(rel);
      if (text !== null) g.note(rel, 'read');
      return text;
    };
  }
  if (host.projectFiles) {
    const pf = host.projectFiles;
    const visible = () => pf.projects().filter((p) => g.sees(p.path));
    const named = (project?: string) => {
      if (!project) return;
      const low = project.toLowerCase();
      const hidden = pf.projects().find((p) => (p.name.toLowerCase() === low || p.path.toLowerCase() === low) && !g.sees(p.path));
      if (hidden) g.check(hidden.path);
    };
    out.projectFiles = {
      search: (query, project, limit) => {
        named(project);
        return pf.search(query, project, (limit ?? 12) * 3).filter((h) => g.sees(h.project)).slice(0, limit ?? 12);
      },
      read: async (project, rel) => {
        named(project);
        const r = await pf.read(project, rel);
        const card = pf.projects().find((p) => p.name === r.projectName);
        if (card) {
          g.check(card.path);
          g.note(card.path, 'read', `its file ${rel}`);
        }
        return r;
      },
      projects: visible,
      status: () => pf.status(),
    };
  }
  if (host.folders) {
    const f = host.folders;
    out.folders = { access: f.access, projects: () => f.projects().filter((p) => g.sees(p.path)) };
  }
  return out;
}

/** Everything an outside agent's call reaches (src/main/agent-access.ts), for one agent. */
export function gateAccessHost(base: AgentAccessHost, g: Gate): AgentAccessHost {
  const sees = (p: string) => g.sees(p);
  const index = gateIndex(base.index, g);
  const h: AgentAccessHost = {
    ...base,
    index,
    notes: gateNotes(base.notes, g),
    projects: () => base.projects().filter((c) => sees(c.path)),
    projectView: (rel) => {
      g.check(rel);
      g.note(rel, 'read');
      return base.projectView(rel);
    },
    allProjects: () => base.allProjects().filter((x) => sees(x.path)),
    editProject: async (rel, edits, by, words) => {
      g.check(rel, 'changed');
      const r = await base.editProject(rel, edits, by, words);
      g.note(rel, 'changed', r.words);
      return r;
    },
    writeNote: async (rel, text) => {
      // Every write is checked, new or not (a level reads off the folder).
      g.check(rel, 'changed');
      await base.writeNote(rel, text);
      g.note(rel, 'changed');
    },
    trash: async (rel) => {
      g.check(rel, 'changed');
      return base.trash(rel);
    },
    today: () => {
      const t = base.today();
      const ok = <T extends { project: string }>(list: T[]) => list.filter((x) => sees(x.project));
      return {
        ...t,
        due: { overdue: ok(t.due.overdue), today: ok(t.due.today), soon: ok(t.due.soon), later: ok(t.due.later ?? []), passed: ok(t.due.passed ?? []), stale: ok(t.due.stale ?? []) },
        atRisk: ok(t.atRisk),
        ...(t.quiet ? { quiet: ok(t.quiet) } : {}),
        waiting: ok(t.waiting),
        changed: ok(t.changed),
        meetings: t.meetings.filter((m) => sees(m.path)),
        docs: t.docs.filter((d) => sees(d.path)),
        daily: t.daily && sees(t.daily.path) ? t.daily : null,
      };
    },
    templates: () => base.templates().filter((t) => sees(t.path)),
    // A skill kept in a note the agent may not read isn't offered to it (the built-in ones always are).
    ...(base.skills ? { skills: { list: () => base.skills!.list().filter((s) => s.source === 'built-in' || (!!s.path && sees(s.path))), home: () => base.skills!.home() } } : {}),
  };
  if (base.files) {
    const files = base.files;
    // A file saved for a project or onto a note: only where the agent may write.
    h.files = {
      ...files,
      target: (projectRel) => {
        g.check(projectRel, 'changed');
        return files.target(projectRel);
      },
      attachmentsFor: (noteRel) => {
        g.check(noteRel, 'changed');
        return files.attachmentsFor(noteRel);
      },
    };
  }
  if (base.full) {
    const full = base.full;
    h.full = {
      ...full,
      readText: async (rel) => {
        g.check(rel);
        const t = await full.readText(rel);
        g.note(rel, 'read');
        return t;
      },
      writeText: async (rel, text) => {
        // Every write is checked, new or not (a level reads off the folder).
        g.check(rel, 'changed');
        await full.writeText(rel, text);
        g.note(rel, 'changed');
      },
      isFolder: (rel) => full.isFolder(rel),
      move: async (from, to) => {
        g.check(from, 'changed');
        g.check(to, 'changed');
        return full.move(from, to);
      },
      trashPath: async (rel) => {
        g.check(rel, 'changed');
        return full.trashPath(rel);
      },
      templateNote: async (template, name, folder, project) => {
        g.check(template);
        if (project) g.check(project, 'changed');
        return full.templateNote(template, name, folder, project);
      },
      templateFromNote: async (note, name, description) => {
        g.check(note);
        return full.templateFromNote(note, name, description);
      },
      assets: {
        ...full.assets,
        update: async (rel, patch) => {
          g.check(rel, 'changed');
          return full.assets.update(rel, patch);
        },
        details: async (rel) => {
          g.check(rel);
          return full.assets.details(rel);
        },
      },
    };
  }
  return h;
}
