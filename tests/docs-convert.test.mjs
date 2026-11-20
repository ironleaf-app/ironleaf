// node --test tests/docs-convert.test.mjs — "Turn into a doc" and back (src/main/docs.ts) on a made-up library kept in
// memory: the Minecraft server, set up as a project with pages, becomes one doc — every word kept, its canvas
// re-pointed, links sent to the doc's sections, its Activity kept beside it, the project and pages to Recently deleted
// (through the trash it is given, never deleted) — and Undo puts every file back as it was.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-docs-convert-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [`export * from ${JSON.stringify(path.join(root, 'src/main/docs.ts'))};`, `export * from ${JSON.stringify(path.join(root, 'src/shared/doc-file.ts'))};`, `export { extractLinks } from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};`].join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** A library in memory, with the host Ironleaf's main side gives the docs module. */
function library(files) {
  const store = new Map(Object.entries(files));
  const bin = [];
  const stem = (p) => p.split('/').pop().replace(/\.(md|canvas)$/i, '');
  const props = (t) => {
    const m = /^---\n([\s\S]*?)\n---/.exec(t);
    const out = {};
    for (const l of m ? m[1].split('\n') : []) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(l);
      if (kv) out[kv[1]] = kv[2].replace(/^"|"$/g, '');
    }
    return out;
  };
  const notes = () => [...store.keys()].filter((p) => p.endsWith('.md')).map((p) => ({ path: p, title: stem(p), props: props(store.get(p)), links: M.extractLinks(store.get(p)) }));
  const resolve = (target) => {
    const t = target.replace(/\.md$/i, '').replace(/%20/g, ' ').toLowerCase();
    const all = [...store.keys()];
    return all.find((p) => p.toLowerCase().replace(/\.md$/i, '') === t) ?? all.find((p) => p.endsWith('.md') && stem(p).toLowerCase() === t) ?? null;
  };
  const folders = () => {
    const out = new Set();
    for (const p of store.keys()) for (let d = p.slice(0, p.lastIndexOf('/')); d; d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '') out.add(d);
    return [...out];
  };
  const host = {
    content: (rel) => (rel.endsWith('.md') ? store.get(rel) : undefined),
    notes,
    resolve,
    listing: async () => ({ files: [...store.keys()].map((rel) => ({ rel, kind: rel.endsWith('.md') ? 'note' : rel.endsWith('.canvas') ? 'canvas' : 'other' })), folders: folders() }),
    exists: async (rel) => store.has(rel) || folders().includes(rel),
    write: async (rel, text) => void store.set(rel, text),
    readText: async (rel) => {
      if (!store.has(rel)) throw new Error('missing');
      return store.get(rel);
    },
    writeText: async (rel, text) => void store.set(rel, text),
    move: async (from, to) => {
      for (const k of [...store.keys()]) {
        if (k === from || k.startsWith(`${from}/`)) {
          store.set(to + k.slice(from.length), store.get(k));
          store.delete(k);
        }
      }
      return to;
    },
    trash: async (rel) => {
      for (const k of [...store.keys()]) if (k === rel || k.startsWith(`${rel}/`)) (bin.push([k, store.get(k)]), store.delete(k));
      if (!bin.some(([k]) => k === rel)) bin.push([rel, null]);
    },
    today: () => '18 Oct 2026',
    isoToday: () => '2026-10-18',
    docsFolder: () => 'Docs',
  };
  return { store, bin, host };
}

const P = 'Projects/Minecraft server';
function minecraft() {
  return {
    [`${P}/Minecraft server.md`]: `---\ntype: project\nstatus: active\nhealth: on track\nprogress: 30\ntags: [minecraft]\n---\n# Minecraft server\n\n## Summary\n\nThe family's Minecraft server for the kids and their cousins.\n\n## Server\n\nPaper 1.21 on the study desktop.\n\n## Access\n\nWhitelist only; ask Dad.\n\n## Operations\n\nRestart on Sundays.\n\n## Add-ons\n\nEssentialsX.\n\n## Updates\n\n- **18 Oct 2026** — Whitelist turned on.\n\n## Documentation\n\n- [[Backups]]\n- [[Ports]]\n`,
    [`${P}/Backups.md`]: `# Backups\n\nThe world is copied to the NAS every night at 2 am.\n\n## Restoring\n\nStop the server, copy the folder back. See [[Ports]].\n`,
    [`${P}/Ports.md`]: `Port 25565 is forwarded on the router.\n`,
    [`${P}/Activity/Set up the whitelist.md`]: `---\nstatus: done\n---\nWhitelist on.\n`,
    [`${P}/Minecraft server.canvas`]: JSON.stringify({ nodes: [{ id: 'p', type: 'file', file: `${P}/Minecraft server.md`, x: -220, y: -136, width: 440, height: 272, neuralvault: { part: 'project', project: `${P}/Minecraft server.md` } }, { id: 'mine', type: 'text', text: 'Ask about a creative world', x: 900, y: 0, width: 260, height: 100 }], edges: [], neuralvault: { kind: 'project', project: `${P}/Minecraft server.md` } }),
    'Daily/2026-10-17.md': 'Fixed the [[Backups]] again; check [[Minecraft server]] and [[Ports#Router|the router]].\n',
    'Board.canvas': JSON.stringify({ nodes: [{ id: 'b', type: 'file', file: `${P}/Backups.md`, x: 0, y: 0, width: 300, height: 200 }], edges: [] }),
  };
}

test('Turn into a doc: one doc with every word, canvas re-pointed, links sent on, project and pages to Recently deleted', async () => {
  const lib = library(minecraft());
  const original = new Map(lib.store);
  const docs = new M.Docs(lib.host);
  const r = await docs.projectToDoc(`${P}/Minecraft server.md`);
  assert.equal(r.path, 'Docs/Minecraft server.md');
  const doc = lib.store.get(r.path);
  const d = M.parseDoc(doc, r.path);
  assert.deepEqual(d.sections.map((s) => s.heading), ['Server', 'Access', 'Operations', 'Add-ons', 'Backups', 'Ports']);
  assert.match(d.sections[4].body, /every night at 2 am\.\n\n### Restoring/);
  assert.match(d.sections[4].body, /See \[\[Minecraft server#Ports\|Ports\]\]/, 'a link between pages reaches the section now');
  assert.equal(d.canvas, 'Docs/Minecraft server.canvas');
  assert.equal(d.summary, "The family's Minecraft server for the kids and their cousins.");
  assert.equal(d.changes[0].what, 'Whitelist turned on.');
  assert.equal(d.updated, '2026-10-18');
  // Every word kept (headings that became the summary and Changes aside).
  const have = new Set(M.wordsOf(doc));
  const was = [...original].filter(([k]) => k.endsWith('.md') && k.startsWith(P) && !k.includes('/Activity/')).map(([, v]) => v.replace(/^---[\s\S]*?---\n/, '').replace(/## Documentation[\s\S]*$/, '')).join('\n');
  assert.deepEqual([...new Set(M.wordsOf(was))].filter((w) => !have.has(w) && !['summary', 'updates'].includes(w)), []);
  // To Recently deleted through the trash given (never deleted): the project file, both pages and its old canvas.
  const binned = [`${P}/Backups.md`, `${P}/Minecraft server.canvas`, `${P}/Minecraft server.md`, `${P}/Ports.md`];
  assert.deepEqual(lib.bin.map(([k]) => k).sort(), binned);
  assert.deepEqual(r.trashed.sort(), binned);
  // Its canvas beside the doc, re-pointed: the project's own card gone, the person's kept, a card per section.
  const board = JSON.parse(lib.store.get('Docs/Minecraft server.canvas'));
  assert.deepEqual(board.neuralvault, { kind: 'doc', doc: r.path });
  assert.ok(!board.nodes.some((n) => n.id === 'p'));
  assert.ok(board.nodes.some((n) => n.id === 'mine'));
  assert.equal(board.nodes.filter((n) => n.neuralvault?.part === 'doc').length, 1);
  assert.equal(board.nodes.filter((n) => n.neuralvault?.part === 'section').length, 6);
  // Links elsewhere reach the doc; the words people read stay.
  assert.equal(lib.store.get('Daily/2026-10-17.md'), 'Fixed the [[Minecraft server#Backups|Backups]] again; check [[Minecraft server]] and [[Minecraft server#Router|the router]].\n');
  assert.deepEqual(JSON.parse(lib.store.get('Board.canvas')).nodes[0], { id: 'b', type: 'file', file: r.path, subpath: '#Backups', x: 0, y: 0, width: 300, height: 200 });
  // The former host app's task notes (Activity) stay where they are.
  assert.ok(lib.store.has(`${P}/Activity/Set up the whitelist.md`));
  assert.match(r.words, /Turned “Minecraft server” into a doc: 2 pages became sections, \d+ links? now reach(?:es)? it\. The project and its pages are in Recently deleted\./);

  // Undo: every file back as it was.
  const u = await docs.undo(r.path);
  assert.match(u.words, /^Undone: Minecraft server is a project again\./);
  assert.deepEqual([...lib.store.keys()].sort(), [...original.keys()].sort());
  for (const [k, v] of original) assert.equal(lib.store.get(k), v, k);
  assert.ok(lib.bin.some(([k]) => k === 'Docs/Minecraft server.md'), 'the doc went to Recently deleted, not deleted');
});

test('a doc of the same name already there: refused, nothing changed', async () => {
  const lib = library({ ...minecraft(), 'Docs/Minecraft server.md': '---\ntype: doc\n---\n# Minecraft server\n' });
  const before = new Map(lib.store);
  await assert.rejects(new M.Docs(lib.host).projectToDoc(`${P}/Minecraft server.md`), /already a doc called “Minecraft server”/);
  assert.deepEqual([...lib.store], [...before]);
});

test('Undo is refused once the doc was changed since (File recovery has the earlier versions)', async () => {
  const lib = library(minecraft());
  const docs = new M.Docs(lib.host);
  const r = await docs.projectToDoc(`${P}/Minecraft server.md`);
  lib.store.set(r.path, `${lib.store.get(r.path)}\nMore words.\n`);
  await assert.rejects(docs.undo(r.path), /changed since/);
});

test('Turn into a project: the doc’s words as a project file, links sent on, Undo puts the doc back', async () => {
  const lib = library({
    'Docs/Payroll.md': '---\ntype: doc\nabout: How pay runs.\n---\n# Payroll\n\nEvery second Thursday.\n\n## Steps\n\n1. Export hours\n\n## Changes\n\n- **12 Oct 2026** — Written down.\n',
    'Projects/Other/Other.md': '---\ntype: project\n---\n# Other\n',
    'Notes/Office.md': 'See [[Payroll#Steps]].\n',
  });
  const docs = new M.Docs(lib.host);
  const r = await docs.docToProject('Docs/Payroll.md');
  assert.equal(r.path, 'Projects/Payroll/Payroll.md');
  const text = lib.store.get(r.path);
  assert.match(text, /^---\ntype: project\nstatus: planning\nhealth: on track\n/);
  assert.match(text, /## Summary\n\nEvery second Thursday\.[\s\S]*## Steps[\s\S]*## Updates\n\n- \*\*12 Oct 2026\*\* — Written down\./);
  assert.equal(lib.store.get('Notes/Office.md'), 'See [[Payroll#Steps]].\n');
  assert.deepEqual(lib.bin.map(([k]) => k), ['Docs/Payroll.md']);
  await docs.undo(r.path);
  assert.ok(lib.store.has('Docs/Payroll.md') && !lib.store.has(r.path));
});

test('a new doc goes in the Docs folder with a free name', async () => {
  const lib = library({ 'Docs/Backups.md': '# Backups\n' });
  const docs = new M.Docs(lib.host);
  const made = await docs.create('Backups');
  assert.equal(made, 'Docs/Backups 2.md');
  assert.match(lib.store.get(made), /^---\ntype: doc\n---\n# Backups\n/);
  const fromTemplate = await docs.create('Home network', '---\ntype: doc\nabout: "x"\n---\n# Home network\n');
  assert.equal(lib.store.get(fromTemplate), '---\ntype: doc\nabout: "x"\n---\n# Home network\n');
});

test('a conversion that fails part way (Recently deleted refuses) puts back what it changed', async () => {
  const lib = library(minecraft());
  const before = new Map(lib.store);
  let calls = 0;
  const realTrash = lib.host.trash;
  lib.host.trash = async (rel) => {
    calls++;
    if (rel.endsWith('Minecraft server.md') && rel.startsWith('Projects/')) throw new Error('Recently deleted isn’t available.');
    return realTrash(rel);
  };
  await assert.rejects(new M.Docs(lib.host).projectToDoc(`${P}/Minecraft server.md`), /Recently deleted/);
  assert.ok(calls > 0);
  for (const [k, v] of before) assert.equal(lib.store.get(k), v, `${k} as it was`);
  assert.ok(!lib.store.has('Docs/Minecraft server.md') && !lib.store.has('Docs/Minecraft server.canvas'), 'the doc and its canvas it made went too');
});
