// node --test tests/inbox-one-tap.test.mjs — the Inbox files in one tap, right (t119, 9 Nov 2026). Each
// captured item shows its best home (an area, a project, a person or a meeting note) with a short reason;
// one tap files it there, with Undo; two more choices are one tap away; keeping it stays. Suggestions come
// from the vault's own links, names and meaning index — no model call for the common case. Nothing files
// without the person's tap; a filed item is linked from its new home's page; a dated capture becomes a
// task or reminder only when asked. Today's "waiting to be filed", the Inbox page and the side bar count
// one rule. Live vault on disk, made-up captures only. Each test fails without its fix.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-inbox-one-tap-'));
let L; // main/life.ts
let S; // shared helpers (project-file, frontmatter)
let M; // main/meaning-index.ts
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const lEntry = path.join(work, 'lentry.ts');
  writeFileSync(lEntry, `export { registerLife } from ${JSON.stringify(path.join(root, 'src/main/life.ts'))};\n`);
  const stub = path.join(work, 'electron-stub.mjs');
  writeFileSync(stub, 'export const shell = {};\nexport default {};\n');
  await build({ input: lEntry, platform: 'node', external: ['yaml', /^node:/], plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }], output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  const sEntry = path.join(work, 'sentry.ts');
  writeFileSync(sEntry, [`export * as proj from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`, `export * as fm from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};`].join('\n'));
  await build({ input: sEntry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const mEntry = path.join(work, 'mentry.ts');
  writeFileSync(mEntry, `export { MeaningIndex } from ${JSON.stringify(path.join(root, 'src/main/meaning-index.ts'))};\n`);
  await build({ input: mEntry, platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── An invented vault on real files ──────────────────────────────────────────
// Shaped like a real one: an active project, a person, a meeting note, a how-to note, one area, a
// private note. Never a real vault.
const HARBOUR = 'Work/Projects/Harbour/Harbour.md';
const PRIYA = 'Work/People/Priya Shah.md';
const WALK = 'Work/Meetings/2026-11-06 Site walk.md';
const STONE = 'Work/Docs/Stone care.md';
const C1 = '[ ] Ask Sam about the benchtop for the Harbour fit-out, due before Friday';
const C2 = 'Ring Priya Shah about the lease renewal';
const C3 = 'Pay the power bill by 14 November, ask Sam at the site walk';
const C4 = 'The sealant order arrived late again, and the delivery missed its slot twice now';
const vaultFiles = () => ({
  'Inbox.md': `# Inbox\n\n## Captured\n\n- ${C1}\n- ${C2}\n- ${C3}\n- ${C4}\n\n## Done\n\n- An old done line\n`,
  'Inbox/awning-quote.md': '# Awning quote\n\nAwning quote for the Harbour fit-out cafe: ShadeCo $1,200 fitted.\n',
  'Inbox/Harbour fit-out quote.pdf': 'made-up pdf bytes',
  'Inbox/Done/old.md': '# Old\n',
  [HARBOUR]: '---\ntype: project\nstatus: active\nowner: Alex Kim\n---\n# Harbour fit-out\n\n## Summary\n\nThe Harbour cafe fit-out.\n\n## What\'s next\n\n- [ ] Chase the benchtop delivery\n',
  [PRIYA]: '---\ntype: person\n---\n# Priya Shah\n\n## Notes\n\nLease contact for the Harbour site.\n',
  [WALK]: '# Site walk\n\n## Notes\n\nWalk the site with Sam before Friday.\n',
  [STONE]: '# Stone care\n\nOrder sealant before the reseal is due: the last delivery arrived late and the stone waited a week.\n',
  'Private Notes/Diary.md': '# Diary\n\nNot for filing.\n',
  '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] }),
});

function rig(files, opts = {}) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const abs = (rel) => path.join(dir, ...rel.split('/'));
  const put = (rel, text) => {
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), String(text));
  };
  for (const [rel, text] of Object.entries(files)) put(rel, text);
  const readDisk = (rel) => {
    try {
      return readFileSync(abs(rel), 'utf8');
    } catch {
      return null;
    }
  };
  const titleOf = (rel, text) => /^#\s+(.+?)\s*$/m.exec(text)?.[1] ?? rel.split('/').pop().replace(/\.md$/i, '');
  const metas = new Map();
  const mi = new M.MeaningIndex();
  const rebuild = () => {
    metas.clear();
    mi.clear();
    const walk = (d, base) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (e.name.startsWith('.') || rel.toLowerCase().startsWith('private notes/')) continue;
          walk(path.join(d, e.name), rel);
        } else if (e.isFile() && rel.endsWith('.md')) {
          const text = readFileSync(path.join(d, e.name), 'utf8');
          const title = titleOf(rel, text);
          metas.set(rel, { path: rel, title, label: title, props: S.fm.readProps(text), tags: [], links: [], mtime: 0 });
          mi.set(rel, title, text);
        }
      }
    };
    walk(dir, '');
  };
  rebuild();
  const vault = {
    root: dir,
    exists: async (rel) => readDisk(rel) !== null,
    read: async (rel) => {
      const t = readDisk(rel);
      if (t === null) throw new Error(`missing ${rel}`);
      return t;
    },
    write: async (rel, text) => {
      put(rel, String(text));
      rebuild();
    },
    create: async (rel, text = '') => {
      if (readDisk(rel) !== null) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      put(rel, text);
      rebuild();
    },
    any: async (rel) => readDisk(rel) !== null,
    listAll: async () => {
      const out = [];
      const folders = new Set();
      const scan = (d, base) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const rel = base ? `${base}/${e.name}` : e.name;
          if (e.isDirectory()) {
            if (e.name === '.git') continue;
            folders.add(rel);
            scan(path.join(d, e.name), rel);
          } else if (e.isFile()) out.push({ rel, mtime: 0, size: 0, kind: rel.endsWith('.md') ? 'note' : 'file' });
        }
      };
      scan(dir, '');
      return { files: out, folders: [...folders] };
    },
  };
  const handlers = new Map();
  L.registerLife({
    handle: (ch, fn) => handlers.set(ch, fn),
    vault: () => vault,
    index: {
      allMeta: () => [...metas.values()],
      content: (rel) => readDisk(rel),
      get: (rel) => metas.get(rel),
      resolveAny: (t) => {
        const clean = String(t ?? '').replace(/\.md$/i, '');
        for (const m of metas.values()) if (m.title === clean || m.label === clean || m.path === t) return m.path;
        return null;
      },
      delete: (rel) => void metas.delete(rel),
      // No model anywhere in this rig: suggestions must come from links, names and meaning.
      ...(opts.noMeanings ? {} : { meanings: () => mi }),
    },
    prefs: () => ({ templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments' }),
    dailyFolder: () => 'Daily',
    records: () => ({ records: new Map([['priya', { type: 'person', title: 'Priya Shah', path: PRIYA, page: true, names: [] }]]) }),
    movePath: async (from, to) => {
      const t = readDisk(from);
      if (t === null) throw new Error(`missing ${from}`);
      put(to, t);
      rmSync(abs(from));
      rebuild();
      return { path: to, linksUpdated: 0, notesUpdated: 0 };
    },
    indexFile: async () => {
      rebuild();
      return null;
    },
    refreshFiles: async () => {},
    changed: () => {},
    filesChanged: () => {},
    requireCreate: async () => {},
    editProject: async (rel, edit) => {
      const before = readDisk(rel);
      if (before === null) throw new Error(`missing ${rel}`);
      const p = S.proj.parseProject(before, rel);
      S.proj.applyProjectEdit(p, edit, '');
      put(rel, S.proj.serializeProject(p, before));
      rebuild();
      return {};
    },
  });
  return { handlers, read: readDisk };
}

const byWords = (items, sub) => items.find((i) => i.words.includes(sub));
const leadOf = (suggestions, item) => suggestions[item.id]?.[0];

test('each capture shows its best home with a short reason, from links, names and meaning', async () => {
  const r = rig(vaultFiles());
  const { items, suggestions } = await r.handlers.get('inbox:list')();
  assert.equal(items.length, 6, 'four lines plus the dropped note and file (Done kept out)');
  const c1 = byWords(items, 'Harbour fit-out');
  const c2 = byWords(items, 'Priya Shah');
  const c3 = byWords(items, 'site walk');
  const c4 = byWords(items, 'sealant');
  for (const [c, name] of [[c1, 'C1'], [c2, 'C2'], [c3, 'C3'], [c4, 'C4']]) assert.ok(c, `${name} waits in the Inbox`);
  assert.equal(leadOf(suggestions, c1).target.kind, 'project');
  assert.equal(leadOf(suggestions, c1).target.path, HARBOUR);
  assert.equal(leadOf(suggestions, c2).target.kind, 'person');
  assert.equal(leadOf(suggestions, c2).target.path, PRIYA);
  assert.equal(leadOf(suggestions, c3).target.kind, 'note', 'the dated line names its meeting note');
  assert.equal(leadOf(suggestions, c3).target.path, WALK);
  assert.equal(leadOf(suggestions, c4).target.kind, 'note', 'no names: the meaning index places it');
  assert.equal(leadOf(suggestions, c4).target.path, STONE);
  const awning = byWords(items, 'Awning quote');
  assert.ok(awning && !awning.words.includes('awning-quote'), 't243: the note’s own title, never its file name');
  assert.equal(leadOf(suggestions, awning).target.path, HARBOUR, 'the dropped note names its project');
  const pdf = byWords(items, 'Harbour fit out quote');
  assert.ok(pdf && !pdf.words.includes('.pdf'), 't243: the file reads prettified, never its raw name');
  assert.equal(leadOf(suggestions, pdf).target.path, HARBOUR, 'the dropped file names its project');
  // An area home stands among the choices, and every reason is short plain words.
  assert.ok(suggestions[c1.id].some((s) => s.target.kind === 'area' && s.target.area === 'work'), 'the project’s area is one tap away');
  for (const it of items)
    for (const s of suggestions[it.id] ?? []) {
      assert.ok(s.why && s.why.length <= 80, `a short reason: ${s.why}`);
      assert.doesNotMatch(s.why, /DSH|DeepSeek|pi-ai|embedding|vector|cosine/i, 'no engine words a person would not say');
    }
  assert.ok((suggestions[c1.id] ?? []).length <= 3, 'the best and two others at most');
});

test('one tap files it to the right home, linked from the new home’s page, Undo restoring it', async () => {
  const r = rig(vaultFiles());
  const list = () => r.handlers.get('inbox:list')();
  // A task line to its project: the step lands in the project file.
  {
    const { items, suggestions } = await list();
    const c1 = byWords(items, 'Harbour fit-out');
    const res = await r.handlers.get('inbox:file')(c1.id, leadOf(suggestions, c1).target);
    assert.ok(res.undo, 'one tap carries Undo');
    assert.match(res.words, /Harbour fit-out/);
    assert.match(r.read(HARBOUR) ?? '', /Ask Sam about the benchtop for the Harbour fit-out/, 'the step is on the project’s page');
    assert.ok(!(r.read('Inbox.md') ?? '').includes('Ask Sam about the benchtop'), 'and leaves the Inbox');
    const undone = await r.handlers.get('inbox:undo-auto')(res.undo);
    assert.match(undone.words, /back in the Inbox/);
    assert.ok((r.read('Inbox.md') ?? '').includes('Ask Sam about the benchtop'), 'Undo puts it back');
    assert.ok(!(r.read(HARBOUR) ?? '').includes('Ask Sam about the benchtop'), 'and takes the step back out');
  }
  // A line naming a person: onto their card.
  {
    const { items, suggestions } = await list();
    const c2 = byWords(items, 'Priya Shah');
    const res = await r.handlers.get('inbox:file')(c2.id, leadOf(suggestions, c2).target);
    assert.ok(res.undo, 'one tap carries Undo');
    assert.match(r.read(PRIYA) ?? '', /Ring Priya Shah about the lease renewal/, 'the line is on her card');
    const undone = await r.handlers.get('inbox:undo-auto')(res.undo);
    assert.match(undone.words, /back in the Inbox/);
    assert.ok((r.read('Inbox.md') ?? '').includes('Ring Priya Shah'), 'Undo puts it back');
    assert.ok(!(r.read(PRIYA) ?? '').includes('lease renewal'), 'and takes it off her card');
  }
  // A dated line to its meeting note: filed as said, no task and no reminder made of it.
  {
    const { items, suggestions } = await list();
    const c3 = byWords(items, 'site walk');
    const res = await r.handlers.get('inbox:file')(c3.id, leadOf(suggestions, c3).target);
    assert.ok(res.undo, 'one tap carries Undo');
    assert.match(r.read(WALK) ?? '', /Pay the power bill by 14 November/, 'the line is in the meeting note');
    assert.ok(!(r.read(HARBOUR) ?? '').includes('Pay the power bill'), 'no next step made of it');
    assert.equal(r.read('Reminders.md'), null, 'and no reminder made of it');
    await r.handlers.get('inbox:undo-auto')(res.undo);
    assert.ok((r.read('Inbox.md') ?? '').includes('Pay the power bill'), 'Undo puts it back');
    assert.ok(!(r.read(WALK) ?? '').includes('Pay the power bill'), 'and takes it out of the meeting note');
  }
  // A dropped file to its project: moved into the project’s folder, Undo bringing it back.
  {
    const { items, suggestions } = await list();
    const pdf = byWords(items, 'Harbour fit out quote');
    const res = await r.handlers.get('inbox:file')(pdf.id, leadOf(suggestions, pdf).target);
    assert.ok(res.undo, 'one tap carries Undo');
    assert.equal(r.read('Work/Projects/Harbour/Files/Harbour fit-out quote.pdf'), 'made-up pdf bytes', 'moved into the project’s folder, where its page lists it');
    assert.equal(r.read('Inbox/Harbour fit-out quote.pdf'), null, 'and gone from the Inbox folder');
    await r.handlers.get('inbox:undo-auto')(res.undo);
    assert.equal(r.read('Inbox/Harbour fit-out quote.pdf'), 'made-up pdf bytes', 'Undo brings it back');
    assert.equal(r.read('Work/Projects/Harbour/Files/Harbour fit-out quote.pdf'), null, 'and takes it out of the project');
  }
  const { items } = await list();
  assert.equal(items.length, 6, 'everything undone: the count is true again');
});

test('a dated capture becomes a task or a reminder only when the person says so', async () => {
  const r = rig(vaultFiles());
  const list = () => r.handlers.get('inbox:list')();
  // Said as a task: the meeting line becomes the project’s next step.
  {
    const { items } = await list();
    const c3 = byWords(items, 'site walk');
    const res = await r.handlers.get('inbox:file')(c3.id, { kind: 'project', path: HARBOUR, name: 'Harbour fit-out', step: true });
    assert.match(r.read(HARBOUR) ?? '', /Pay the power bill by 14 November/, 'asked: the next step is made');
    await r.handlers.get('inbox:undo-auto')(res.undo);
    assert.ok(!(r.read(HARBOUR) ?? '').includes('Pay the power bill'), 'undone again');
  }
  // Said as a reminder: tomorrow at 9am, always ahead.
  {
    const { items } = await list();
    const c3 = byWords(items, 'site walk');
    const res = await r.handlers.get('inbox:file')(c3.id, { kind: 'reminder', name: 'Reminders', when: 'tomorrow at 9am' });
    assert.match(res.words, /reminder/i);
    assert.match(r.read('Reminders.md') ?? '', /Pay the power bill/, 'asked: the reminder is set');
    await r.handlers.get('inbox:undo-auto')(res.undo);
    assert.ok(!(r.read('Reminders.md') ?? '').includes('Pay the power bill'), 'undone again');
    assert.ok((r.read('Inbox.md') ?? '').includes('Pay the power bill'), 'and back waiting');
  }
});

test('nothing files without a tap, and the common case needs no model', async () => {
  const r = rig(vaultFiles());
  const first = await r.handlers.get('inbox:list')();
  const second = await r.handlers.get('inbox:list')();
  assert.deepEqual(second.items.map((i) => i.id), first.items.map((i) => i.id), 'looking never files');
  assert.ok(first.items.every((i) => (first.suggestions[i.id] ?? []).length > 0), 'every capture has a home with no model in the rig');
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(!inbox.includes('.autoFile('), 'the page never files on its own: one tap files');
  assert.ok(!inbox.includes('undoAuto(') || inbox.includes('r.undo'), 'Undo belongs to the tap’s filing');
});

test('without the meaning index the names still place, and nothing breaks', async () => {
  const r = rig(vaultFiles(), { noMeanings: true });
  const { items, suggestions } = await r.handlers.get('inbox:list')();
  assert.equal(items.length, 6);
  assert.equal(leadOf(suggestions, byWords(items, 'Harbour fit-out')).target.path, HARBOUR);
  assert.equal(leadOf(suggestions, byWords(items, 'Priya Shah')).target.path, PRIYA);
  assert.deepEqual(suggestions[byWords(items, 'sealant').id] ?? [], [], 'meaning alone placed it, so now it waits for the person');
});

test('the count is one rule in every place that says it', async () => {
  const r = rig(vaultFiles());
  const { items } = await r.handlers.get('inbox:list')();
  assert.equal(items.length, 6, 'lines plus Inbox folder notes and files, Done kept out');
  const hook = read('src/renderer/src/panels/AreasPlaces.tsx');
  assert.ok(hook.includes('export function useInboxCount'), 'one hook reads the waiting count');
  for (const [file, name] of [['src/renderer/src/panels/Places.tsx', 'the side bar'], ['src/renderer/src/views/TodayView.tsx', 'Today'], ['src/renderer/src/views/HomeView.tsx', 'Home']])
    assert.ok(read(file).includes('useInboxCount'), `${name} reads the one hook`);
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('items.length') && inbox.includes('waiting'), 'the Inbox page counts the same list it shows');
  const today = read('src/shared/spark-needs.ts');
  assert.ok(today.includes('waiting to be filed'), 'Today’s line keeps its plain words');
});

test('the card shows why, and File… still offers a reminder when asked', () => {
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('lead.why') || inbox.includes('.why}'), 'the best home’s reason is shown, not only hovered');
  assert.ok(inbox.includes('Remind me'), 'File… offers Remind me for the person who asks');
  const tour = read('src/shared/inbox-tour.ts');
  assert.ok(!tour.includes('filed for you'), 'nothing files itself any more, and the tour says so');
  for (const word of ['Inbox', 'project', 'doc', 'note']) assert.ok(tour.includes(word), 'the four words stay: ' + word);
});
