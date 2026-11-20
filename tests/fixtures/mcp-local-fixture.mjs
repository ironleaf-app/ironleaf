// A fixture vault behind the local MCP server (tests only): notes, projects, tasks and one pack in memory, kept to the
// same rules the app's own helper follows (Private notes never readable; every write with Undo into What agents did;
// the switch and Read only honoured). tests/mcp-local.test.mjs starts McpLocalServer with it over real stdio, then
// reads back what happened (dump). applyUndo proves a recorded Undo restores. Made-up values only.

import { writeFileSync } from 'node:fs';

const PRIVATE = 'Private notes are never open to agents.';
const isPrivate = (p) => String(p ?? '').split('/').some((s) => s.trim().toLowerCase() === 'private notes');

export function createFixtureBackend(shared, seed) {
  const notes = new Map(Object.entries(seed.notes ?? {}));
  const packs = new Map(Object.entries(seed.packs ?? {}).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const activity = [];
  const settings = { on: seed.settings?.on === true, level: seed.settings?.level === 'edit' ? 'edit' : 'read' };
  let n = 0;
  const titleOf = (rel) => (rel.split('/').pop() ?? rel).replace(/\.md$/i, '');
  // The fixture vault serves the first seven tools only (the app serves the whole catalogue: tests/mcp-server.test.mjs).
  const FIXTURE_TOOLS = ['vault_search', 'note_read', 'projects_list', 'tasks_list', 'note_create', 'note_append', 'note_add_task'];
  const fixedDefs = () => FIXTURE_TOOLS.map((n) => shared.localMcpDef(n));
  const fixed = fixedDefs();
  const packDefs = [
    { name: 'testpack_records', title: 'Test pack records', level: 'read', readOnly: true, description: 'List the test pack’s records (a fixture pack for the local MCP tests).', input: { pack: { type: 'string', description: 'The pack.' } }, required: ['pack'] },
    { name: 'testpack_record_add', title: 'Add a test pack record', level: 'edit', description: 'Add a record to the test pack.', input: { pack: { type: 'string', description: 'The pack.' }, title: { type: 'string', description: 'The record’s title.' } }, required: ['pack', 'title'] },
  ];
  const WRITES = new Set(['note_create', 'note_append', 'note_add_task', 'testpack_record_add']);
  const logged = (tool, words, undo) => {
    const entry = { id: `a${++n}`, agent: 'Other AI apps', tool, words, at: Date.now(), undone: false, ...(undo ? { undo } : {}) };
    activity.push(entry);
    return entry;
  };
  const resolveNote = (raw) => {
    const given = String(raw ?? '').trim();
    if (!given) throw new Error('Give the note’s path.');
    if (isPrivate(given)) throw new Error(PRIVATE);
    const rel = /\.md$/i.test(given) ? given : `${given}.md`;
    if (notes.has(rel)) return rel;
    const lower = given.replace(/\.md$/i, '').toLowerCase();
    const found = [...notes.keys()].find((k) => titleOf(k).toLowerCase() === lower);
    if (found && !isPrivate(found)) return found;
    throw new Error(`There is no note “${given}”.`);
  };

  const dispatch = (name, a) => {
    switch (name) {
      case 'vault_search': {
        const q = String(a.query ?? '').trim().toLowerCase();
        if (!q) throw new Error('Give the words to search for.');
        const limit = Math.min(Math.max(Number(a.limit) || 10, 1), 30);
        const hits = [];
        for (const [rel, text] of notes) {
          if (isPrivate(rel)) continue;
          for (const line of String(text).split('\n')) {
            if (line.toLowerCase().includes(q)) hits.push(`${rel}: ${line.trim().slice(0, 120)}`);
            if (hits.length >= limit) break;
          }
          if (hits.length >= limit) break;
        }
        return hits.length ? hits.join('\n') : `Nothing in your notes matches “${String(a.query).trim()}”.`;
      }
      case 'note_read':
        return notes.get(resolveNote(a.path));
      case 'projects_list':
        return JSON.stringify({ projects: seed.projects ?? [] });
      case 'tasks_list': {
        const tasks = [];
        for (const [rel, text] of notes) {
          if (isPrivate(rel)) continue;
          String(text).split('\n').forEach((line, i) => {
            const m = /^-\s*\[([ xX])\]\s*(.+)$/.exec(line.trim());
            if (m) tasks.push({ note: rel, line: i + 1, done: m[1].toLowerCase() === 'x', what: m[2].trim() });
          });
        }
        return JSON.stringify({ count: tasks.length, tasks: tasks.slice(0, 50) });
      }
      case 'note_create': {
        const given = String(a.path ?? '').trim();
        if (!given) throw new Error('Give the note’s path.');
        if (isPrivate(given)) throw new Error(PRIVATE);
        const rel = /\.md$/i.test(given) ? given : `${given}.md`;
        if (notes.has(rel)) throw new Error(`There is already a note “${rel}”.`);
        notes.set(rel, String(a.content ?? ''));
        const e = logged(name, `Created the note “${titleOf(rel)}”.`, { kind: 'created', path: rel });
        return `Created ${rel} (activity ${e.id}).`;
      }
      case 'note_append':
      case 'note_add_task': {
        const rel = resolveNote(a.path);
        const add = name === 'note_add_task' ? `- [ ] ${String(a.text ?? '').trim()}` : String(a.text ?? '').trim();
        if (!add || add === '- [ ]') throw new Error(name === 'note_add_task' ? 'Give the task’s words.' : 'Give the text to add.');
        const before = notes.get(rel);
        const heading = String(a.heading ?? '').replace(/^#+\s*/, '').trim().toLowerCase();
        let after;
        if (heading) {
          const lines = before.split('\n');
          const at = lines.findIndex((l) => l.replace(/^#+\s*/, '').trim().toLowerCase() === heading);
          after = at < 0 ? `${before.replace(/\s*$/, '')}\n\n${add}\n` : [...lines.slice(0, at + 1), '', add, ...lines.slice(at + 1)].join('\n');
        } else {
          after = `${before.replace(/\s*$/, '')}${before.trim() ? '\n\n' : ''}${add}\n`;
        }
        notes.set(rel, after);
        const e = logged(name, name === 'note_add_task' ? `Added a task to the note “${titleOf(rel)}”.` : `Added to the note “${titleOf(rel)}”.`, { kind: 'edited', path: rel, before, after });
        return `Added to ${rel} (activity ${e.id}).`;
      }
      case 'testpack_records': {
        const list = packs.get(String(a.pack ?? ''));
        if (!list) throw new Error(`There is no pack “${String(a.pack ?? '').slice(0, 60)}”.`);
        return JSON.stringify({ records: list });
      }
      case 'testpack_record_add': {
        const list = packs.get(String(a.pack ?? ''));
        if (!list) throw new Error(`There is no pack “${String(a.pack ?? '').slice(0, 60)}”.`);
        const title = String(a.title ?? '').trim();
        if (!title) throw new Error('Give the record’s title.');
        const record = { id: `r${list.length + 1}`, title };
        list.push(record);
        const e = logged(name, `Added “${title}” to the test pack.`, { kind: 'pack-remove', pack: String(a.pack), id: record.id });
        return `Added “${title}” (activity ${e.id}).`;
      }
      default:
        throw new Error(`There is no tool called ${name || 'that'}.`);
    }
  };

  return {
    settings,
    version: () => 'fixture-1.0.0',
    tools: () => {
      const serve = settings.on ? (d) => settings.level === 'edit' || !WRITES.has(d.name) : () => true;
      return [...fixedDefs().filter(serve), ...packDefs.filter(serve)].map(shared.mcpToolOf);
    },
    call: async (name, args) => {
      if (!settings.on) return { text: shared.LOCAL_MCP_OFF, isError: true };
      const def = [...fixed, ...packDefs].find((d) => d.name === name);
      if (!def) return { text: `There is no tool called ${name || 'that'}.`, isError: true };
      if (WRITES.has(def.name) && settings.level !== 'edit') return { text: shared.LOCAL_MCP_READONLY, isError: true };
      try {
        return { text: dispatch(def.name, args && typeof args === 'object' ? args : {}) };
      } catch (e) {
        return { text: e instanceof Error ? e.message : String(e), isError: true };
      }
    },
    /** A recorded Undo carried out (proves the write was Undo-able). */
    applyUndo: (id) => {
      const e = activity.find((x) => x.id === id);
      if (!e?.undo || e.undone) return 'That can’t be undone.';
      e.undone = true;
      const u = e.undo;
      if (u.kind === 'created') notes.delete(u.path);
      else if (u.kind === 'edited') notes.set(u.path, u.before);
      else if (u.kind === 'pack-remove') packs.set(u.pack, (packs.get(u.pack) ?? []).filter((r) => r.id !== u.id));
      return `Undid ${e.words}`;
    },
    activity: () => activity.map((e) => ({ ...e })),
    /** What happened, for the test to read after stdio ends. */
    dump: () => {
      if (seed.outPath) writeFileSync(seed.outPath, JSON.stringify({ settings, activity, notes: Object.fromEntries(notes), packs: Object.fromEntries(packs) }));
    },
  };
}
