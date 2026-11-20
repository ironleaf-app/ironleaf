// node --test tests/area-fold.test.mjs — fold one area into another (9 Nov 2026; the list: "Health and Publications
// fold into Me once the app allows"). A made-up a made-up vault of realistic size (145 notes; Health 5 and Publications 12,
// linked from Work and Me notes): fold Health then Publications into Me. Every link still resolves, the graph shows
// Me with them inside it, Today and the bills list still read right, and Undo restores the vault byte for byte. The
// menu flow's backend runs live on a real disk with real input; the menu and Ctrl+K wiring is checked where it lives.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-area-fold-'));
let M;
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const src = (p) => JSON.stringify(path.join(root, p));
  const shared = path.join(work, 'shared.ts');
  writeFileSync(
    shared,
    [
      `export * as areas from ${src('src/shared/areas.ts')};`,
      `export * as fold from ${src('src/shared/area-fold.ts')};`,
      `export * as fewer from ${src('src/shared/fewer-folders.ts')};`,
      `export * as finance from ${src('src/shared/finance.ts')};`,
      `export * as billsTable from ${src('src/shared/bills-table.ts')};`,
      `export * as graphScope from ${src('src/shared/graph-scope.ts')};`,
      `export * as MD from ${src('src/shared/markdown.ts')};`,
      `export * as P from ${src('src/shared/paths.ts')};`,
      `export * as FM from ${src('src/shared/frontmatter.ts')};`,
      `export * as SENS from ${src('src/shared/sensitivity.ts')};`,
      `export * as VIEWS from ${src('src/shared/views.ts')};`,
      `export * as BASE from ${src('src/shared/base-file.ts')};`,
      `export * as WS from ${src('src/shared/project-workspace.ts')};`,
      `export * as PROJ from ${src('src/shared/project-file.ts')};`,
      '',
    ].join('\n'),
  );
  await build({ input: shared, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  const main = path.join(work, 'main.ts');
  writeFileSync(main, [`export * as areaFold from ${src('src/main/area-fold.ts')};`, `export { VaultIndex } from ${src('src/main/indexer.ts')};`, `export { Hub } from ${src('src/main/hub.ts')};`, ''].join('\n'));
  await build({ input: main, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 9, 9, 0); // Monday 9 November 2026
const sha = (t) => createHash('sha256').update(t).digest('hex');
const under = (p, dir) => p.toLowerCase() === dir.toLowerCase() || p.toLowerCase().startsWith(`${dir.toLowerCase()}/`);

const AREAS = ['Work', 'Me', 'Business', 'Publications', 'Home', 'Health'];
const AREAS_JSON = JSON.stringify({ version: 1, home: 'work', areas: AREAS.map((n) => ({ id: n.toLowerCase(), name: n, folder: n, icon: 'layers', color: 'teal', about: '' })) });

// A bill note shaped like a real one: front matter with every field, a few words.
const BILL_NOTE = (name, amount, cycle, due, category) => {
  const front = ['type: bill', 'kind: Bill', `amount: ${amount}`, `cycle: ${cycle}`, due ? `due: ${due}` : 'due:', `category: ${category}`, 'account:', 'project:', 'autopay: No', 'status: Active'];
  return `---\n${front.join('\n')}\n---\n# ${name}\n\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n| | ${amount} | Added by an assistant |\n`;
};

// A realistic vault shape, made up: 145 notes; Health 5 and Publications 12, linked from Work and Me
// notes.
function ownerShapeFiles() {
  const files = {
    '.neuralvault/areas.json': `${AREAS_JSON}\n`,
    '.neuralvault/sensitivity.json': `${JSON.stringify({ version: 1, folders: { Health: 'health' }, types: {}, items: { 'Health/Notes/Sleep.md': 'health' }, access: {}, photos: 'ask', ignored: [] }, null, 1)}\n`,
    '.neuralvault/views/vault-health.json': `${JSON.stringify({ title: 'Health', layout: 'table', scope: 'vault', folder: 'Health/Notes', note: 'Health/Notes/Sleep.md' }, null, 2)}\n`,
    'Private notes/Do not touch.md': '# Do not touch\n\nPrivate words stay private.\n',
  };
  // Health's 5.
  files['Health/Notes/Morning run.md'] = '# Morning run\n\n- [ ] Run 5k 📅 2026-11-10\n\nSaw [[Dr Ellis]] about the knee.\n';
  files['Health/Notes/Sleep.md'] = '---\narea: Health\n---\n# Sleep\n\nEarly nights all week. See [[Morning run]] for how it pays off.\n';
  files['Health/People/Dr Ellis.md'] = '---\ntype: person\n---\n# Dr Ellis\n\nMy GP.\n';
  files['Health/Projects/Marathon/Marathon.md'] = '---\ntype: project\nstatus: active\n---\n# Marathon\n\n## What’s next\n\n- [ ] Buy shoes — Mia · by 12 Nov 2026\n\nThe routes are in [[Training routes]].\n';
  files['Health/Projects/Marathon/Training routes.md'] = '---\narea: Health\n---\n# Training routes\n\n![[Morning run]]\n';
  // Publications' 12.
  for (let n = 1; n <= 6; n++) files[`Publications/Newsletter/Issue ${n}.md`] = `# Issue ${n}\n\n${n === 1 ? 'On running: [[Morning run]].\n' : ''}${n === 3 ? 'On sleep: [[Health/Notes/Sleep]].\n' : ''}Words for the newsletter.\n`;
  files['Publications/Pieces/Draft A.md'] = '# Draft A\n\nA draft piece.\n';
  files['Publications/Pieces/Draft B.md'] = '# Draft B\n\nAnother draft, linking [[Issue 1]].\n';
  files['Publications/Pieces/Draft C.md'] = '# Draft C\n\nA third draft.\n';
  files['Publications/Editions/Spring.md'] = '# Spring\n\nThe spring edition.\n';
  files['Publications/Editions/Autumn.md'] = '# Autumn\n\nThe autumn edition.\n';
  files['Publications/Notes/Ideas.md'] = '# Ideas\n\nIdeas, and [[Draft A]].\n';
  // Work's 60: four projects with plans, meetings and people, forty filler notes, a canvas, and three more.
  const projects = ['Atlas', 'Beacon', 'Citadel', 'Dockside'];
  const healthLink = {
    Atlas: 'Runs keep me sane: [[Morning run]] and [sleep](Health/Notes/Sleep.md).',
    Beacon: 'Reading: [[Issue 3]] and ![[Training routes]].',
    Citadel: 'Health: [[Dr Ellis|my GP]] and [the marathon](Health/Projects/Marathon/Marathon.md).',
    Dockside: 'No health links here.',
  };
  for (const p of projects) {
    files[`Work/Projects/${p}/${p}.md`] = `---\ntype: project\nstatus: active\n---\n# ${p}\n\n## What’s next\n\n- [ ] Kick off ${p} — Mia · by 9 Nov 2026\n- [ ] Review ${p} — Mia · by 15 Nov 2026\n`;
    files[`Work/Projects/${p}/Plan.md`] = `# ${p} plan\n\n${healthLink[p]}\n`;
    files[`Work/Meetings/2026-11-09 ${p} standup.md`] = `---\nproject: "[[${p}]]"\n---\n# ${p} standup\n\nStood up.\n`;
    files[`Work/People/${p} Lead.md`] = `---\ntype: person\n---\n# ${p} Lead\n\nRuns ${p}.\n`;
  }
  files['Work/Meetings/2026-11-08 Marathon check.md'] = '---\nproject: "[[Marathon]]"\n---\n# Marathon check\n\nChecked the plan.\n';
  files['Work/Meetings/2026-11-09 All hands.md'] = '# All hands\n\nEveryone came.\n';
  files['Work/People/Ada Scientist.md'] = '---\ntype: person\n---\n# Ada Scientist\n\nKnows things.\n';
  files['Work/Notes/Weekly review.md'] = '# Weekly review\n\n[[Beacon]] and [[Marathon]] both move.\n';
  for (let n = 1; n <= 40; n++) {
    const extra =
      n === 1
        ? '\nA relative link: [run](../Health/Notes/Morning%20run.md).\n'
        : n === 2
          ? '\nA pathed link: [[Publications/Editions/Spring]].\n'
          : n === 3
            ? '\nAn embed: ![[Issue 1]].\n'
            : n === 4
              ? '\nA project link: [[Marathon]].\n'
              : '';
    files[`Work/Notes/Filler ${n}.md`] = `# Filler ${n}\n\nWork words ${n}.${extra}\n`;
  }
  // Me's 30: six bills and twenty-four notes.
  const bills = [
    ['Harbour Internet', '89.00', 'Monthly', '2026-11-12', 'Phone and internet'],
    ['Harbour Credit Card', '150.00', 'Monthly', '2026-11-01', 'Loans and cards'],
    ['Power', '214.50', 'Monthly', '2026-11-02', 'Home and utilities'],
    ['Water', '120.00', 'Monthly', '', 'Home and utilities'],
    ['Streamly', '16.99', 'Monthly', '', 'Subscriptions'],
    ['Council Rates', '480.00', 'Quarterly', '2026-11-20', 'Home and utilities'],
  ];
  for (const [name, amount, cycle, due, category] of bills) files[`Me/Finance/Bills/${name}.md`] = BILL_NOTE(name, amount, cycle, due, category);
  for (let n = 1; n <= 20; n++) {
    const extra =
      n === 1
        ? '\n[[Morning run]] keeps me honest.\n'
        : n === 2
          ? '\nThe plan: [[Health/Projects/Marathon/Marathon]].\n'
          : n === 3
            ? '\nRelative: [sleep](../Health/Notes/Sleep.md).\n'
            : n === 4
              ? '\nReading: ![[Issue 3]].\n'
              : '';
    const area = n === 5 ? '---\narea: Health\n---\n' : '';
    files[`Me/Notes/Note ${n}.md`] = `${area}# Note ${n}\n\nMe words ${n}.${extra}\n`;
  }
  files['Me/People/Friend.md'] = '---\ntype: person\n---\n# Friend\n\nA friend.\n';
  files['Me/Projects/Side/Side.md'] = '---\ntype: project\nstatus: active\n---\n# Side\n\n## What’s next\n\n- [ ] Tinker — Mia · by 20 Nov 2026\n';
  files['Me/Projects/Side/Note.md'] = '# Side note\n\nSide words.\n';
  files['Me/Notes/Weekend.md'] = '# Weekend\n\nWeekend words.\n';
  // Business's 20 and Home's 18.
  for (let n = 1; n <= 19; n++) files[`Business/Notes/B${n}.md`] = `# B${n}\n\nBusiness words ${n}.${n === 1 ? '\nReading: [[Spring]].\n' : ''}\n`;
  files['Business/Projects/Venture/Venture.md'] = '---\ntype: project\nstatus: active\n---\n# Venture\n\n## What’s next\n\n- [ ] Pitch — Mia · by 18 Nov 2026\n';
  for (let n = 1; n <= 15; n++) files[`Home/Notes/H${n}.md`] = `# H${n}\n\nHome words ${n}.\n`;
  files['Home/Systems and Home Lab/Machines/Media box.md'] = '---\ntype: machine\nkind: Server\nrole: Media\nos: Linux\nstatus: ok\n---\n# Media box\n\nServes films.\n';
  files['Home/Systems and Home Lab/Services/Photo library.md'] = '---\ntype: service\nruns_on: "[[Media box]]"\nstatus: ok\n---\n# Photo library\n\nKeeps photos.\n';
  files['Home/Notes/Server.md'] = '# Server\n\nThe [[Media box]] hums.\n';
  return files;
}

// ── The vault on a real disk, with the fold's work wired faithfully ────────────────────────────────────────────────

const absOf = (dir, rel) => path.join(dir, ...rel.split('/'));
const writeFiles = (dir, files) => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(absOf(dir, rel)), { recursive: true });
    writeFileSync(absOf(dir, rel), text);
  }
};
const listAll = (dir, base = '') => {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listAll(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out.sort();
};
const snapshotBytes = (dir) => {
  const out = {};
  for (const rel of listAll(dir)) {
    if (rel === '.neuralvault/area-fold.json' || rel === '.neuralvault/area-fold.lock') continue;
    if (rel.startsWith('.neuralvault/tmp/')) continue;
    out[rel] = sha(readFileSync(absOf(dir, rel)));
  }
  return out;
};

/** Every link in every note, and what it reaches now. */
const linkSnapshot = (index) => {
  const out = new Map();
  for (const m of index.allMeta()) out.set(m.path, m.links.map((l) => ({ target: l.target, reached: index.resolveAny(l.target, m.path) })));
  return out;
};

/** The fold's work over a real disk: the app's own move, faithfully — rename, reindex, every link rewritten the
 *  app's way (its name when that alone finds it, else its path), canvases, views and kept-out settings following. */
function foldVault(extraFiles = {}, { quiet = ['Health/Notes'], templatesFolder = 'Health/Templates' } = {}) {
  const files = { ...ownerShapeFiles(), ...extraFiles };
  // A canvas with a card on a Health note, a saved view of a Health folder, and the Marathon project's workspace.
  files['Work/Boards/Plan.canvas'] = JSON.stringify({ nodes: [{ id: 'a1', type: 'file', file: 'Health/Notes/Sleep.md', x: 0, y: 0, width: 200, height: 120 }], edges: [] });
  const def = S.VIEWS.defaultView({ kind: 'folder', value: 'Health/Notes' }, 'table');
  files['Views/Health board.view.json'] = S.BASE.writeViewFile('Health board.view.json', '', def);
  files[S.WS.workspaceFileOf('Health/Projects/Marathon/Marathon.md')] = S.WS.writeWorkspace({ ...S.WS.readWorkspace('', 'Health/Projects/Marathon/Marathon.md'), project: 'Health/Projects/Marathon/Marathon.md', pinned: ['plan'] });
  // The templates folder lives inside Health (empty: Health holds 5 notes, and the setting must follow).
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-fold-vault-'));
  writeFiles(dir, files);
  mkdirSync(absOf(dir, 'Health/Templates'), { recursive: true });
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(files)) if (rel.endsWith('.md')) index.set(rel, text, 0, text.length);
  index.setQuiet(quiet);
  const dataDir = mkdtempSync(path.join(tmpdir(), 'nv-fold-data-'));
  const state = { quiet: [...quiet], templatesFolder, changed: [], filesChanged: 0 };
  const hub = new M.Hub({
    index,
    dailyPath: (day) => `Daily/${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}.md`,
    templatesFolder: () => state.templatesFolder,
    reminders: () => [],
    write: async (rel, text) => {
      writeFileSync(absOf(dir, rel), text);
      index.set(rel, text, 0, text.length);
    },
    startDay: async (day) => `Daily/${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}.md`,
    now: () => NOW.getTime(),
  });
  const linkTextFor = (rel, source, written) => {
    if (/\.md$/i.test(rel)) {
      const title = S.MD.titleFromPath(rel);
      if (!written.includes('/') && index.resolve(title, source) === rel) return S.MD.normalizeTarget(written) === S.MD.normalizeTarget(title) ? written : title;
      return rel.replace(/\.md$/i, '');
    }
    const name = rel.split('/').pop() ?? rel;
    if (!written.includes('/') && index.resolveFile(name, source) === rel) return written.toLowerCase() === name.toLowerCase() ? written : name;
    return rel;
  };
  const fromFolderText = (rel, source, dotted, wiki) => {
    const text = S.P.relativePath(S.P.folderOfPath(source), wiki && /\.md$/i.test(rel) ? rel.replace(/\.md$/i, '') : rel);
    return dotted ? text : text.replace(/^\.\//, '');
  };
  const w = {
    root: dir,
    index,
    hub,
    state,
    dataDir,
    device: { id: '00000000-0000-0000-0000-000000000001', name: 'TEST-PC' },
    appVersion: '9.9.0',
    read: (rel) => readFileSync(absOf(dir, rel), 'utf8'),
    movePath: async (from, to, updateLinks) => {
      const pairs = listAll(dir).filter((f) => under(f, from)).map((f) => [f, `${to}${f.slice(from.length)}`]);
      const moved = new Map(pairs);
      const plans = new Map();
      if (updateLinks) {
        for (const meta of index.allMeta()) {
          for (const link of meta.links) {
            const reached = index.resolveAny(link.target, meta.path);
            const fromFolder = index.writtenFromFolder(link.target, meta.path);
            if (!reached || (!moved.has(reached) && !(moved.has(meta.path) && fromFolder))) continue;
            let plan = plans.get(meta.path);
            if (!plan) plans.set(meta.path, (plan = new Map()));
            plan.set(S.MD.normalizeTarget(link.target), { to: moved.get(reached) ?? reached, fromFolder, dotted: S.P.isRelativeTarget(link.target) });
          }
        }
      }
      mkdirSync(path.dirname(absOf(dir, to)), { recursive: true });
      renameSync(absOf(dir, from), absOf(dir, to));
      for (const [a, b] of pairs) {
        if (!/\.md$/i.test(a)) continue;
        index.delete(a);
        const text = readFileSync(absOf(dir, b), 'utf8');
        index.set(b, text, 0, text.length);
      }
      let linksUpdated = 0;
      let notesUpdated = 0;
      for (const [source, plan] of plans) {
        const at = moved.get(source) ?? source;
        let content = readFileSync(absOf(dir, at), 'utf8');
        let count = 0;
        let next = S.MD.replaceWikilinks(content, (link, raw, embed) => {
          const step = plan.get(S.MD.normalizeTarget(link.target));
          if (!step) return raw;
          const text = step.fromFolder ? fromFolderText(step.to, at, step.dotted, true) : linkTextFor(step.to, at, link.target);
          if (text === link.target) return raw;
          count++;
          return `${embed ? '!' : ''}[[${text}${link.heading ? `#${link.heading}` : ''}${link.alias ? `|${link.alias}` : ''}]]`;
        });
        next = S.MD.replaceMarkdownLinks(next, (target, fragment, raw, embed, label) => {
          const step = plan.get(S.MD.normalizeTarget(target));
          if (!step) return raw;
          const p = step.fromFolder ? fromFolderText(step.to, at, step.dotted, false) : step.to;
          if (S.MD.normalizeTarget(p) === S.MD.normalizeTarget(target)) return raw;
          count++;
          return `${embed ? '!' : ''}[${label}](${S.MD.encodeLinkPath(p)}${fragment})`;
        });
        if (!count || next === content) continue;
        writeFileSync(absOf(dir, at), next);
        index.set(at, next, 0, next.length);
        linksUpdated += count;
        notesUpdated++;
      }
      // Canvases' cards, views of the folder, and kept-out and single-folder settings follow, like the app.
      for (const rel of listAll(dir).filter((f) => f.endsWith('.canvas'))) {
        const text = readFileSync(absOf(dir, rel), 'utf8');
        const out = text.replace(/("(?:file|doc|project)"\s*:\s*)("(?:[^"\\]|\\.)*")/g, (whole, key, literal) => {
          let value;
          try {
            value = JSON.parse(literal);
          } catch {
            return whole;
          }
          const dest = typeof value === 'string' ? moved.get(value) : undefined;
          return dest ? `${key}${JSON.stringify(dest)}` : whole;
        });
        if (out !== text) writeFileSync(absOf(dir, rel), out);
      }
      for (const rel of listAll(dir).filter((f) => f.endsWith('.view.json') || f.endsWith('.base'))) {
        try {
          const text = readFileSync(absOf(dir, rel), 'utf8');
          const { views } = S.BASE.readViewFile(rel, text);
          let next = text;
          for (let i = 0; i < Math.max(1, views.length); i++) {
            const step = S.VIEWS.followFolder(S.BASE.readViewFile(rel, next, i).def, from, to);
            if (step) next = S.BASE.writeViewFile(rel, next, step, i);
          }
          if (next !== text) writeFileSync(absOf(dir, rel), next);
        } catch {}
      }
      state.quiet = S.fewer.movedFolderList(state.quiet, from, to);
      state.templatesFolder = S.fewer.movedFolder(state.templatesFolder, from, to);
      index.setQuiet(state.quiet);
      return { path: to, linksUpdated, notesUpdated };
    },
    indexFile: async (rel) => {
      const abs = absOf(dir, rel);
      if (!existsSync(abs)) {
        index.delete(rel);
        return;
      }
      if (/\.md$/i.test(rel)) index.set(rel, readFileSync(abs, 'utf8'), 0, 0);
    },
    refreshFiles: async () => {},
    changed: (paths, moves) => state.changed.push({ paths, moves }),
    filesChanged: () => state.filesChanged++,
  };
  return w;
};

/** Bills as the Money page reads them: every bill note through the one finance reading. */
const billModel = (w) => {
  const notes = [];
  for (const m of w.index.allMeta()) {
    if (!/\.md$/i.test(m.path)) continue;
    const props = m.props ?? {};
    if (String(props.type ?? '').toLowerCase() !== 'bill') continue;
    notes.push({ path: m.path, title: m.title, props, content: w.index.content(m.path) ?? '', type: 'bill' });
  }
  return S.finance.financeModel(notes, NOW);
};

/** Today's open words: every due item's words, paths aside. */
const dueWords = (w) => {
  const due = w.hub.due();
  const items = [...(due.overdue ?? []), ...(due.today ?? []), ...(due.week ?? []), ...(due.later ?? []), ...(due.stale ?? [])];
  return items.map((e) => (e.kind === 'task' ? e.item.words : e.item.text)).sort();
};

/** Every open task line's words, paths aside (the raw reading under Today, quiet or not). */
const taskWords = (w) => w.index.tasks().flatMap((n) => n.items.map((t) => t.text)).sort();

const multi = (list) => {
  const m = new Map();
  for (const x of [...list].sort()) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m];
};

test('the made-up vault has a realistic shape: 145 notes, Health 5 and Publications 12', () => {
  const w = foldVault();
  const notes = w.index.allMeta().filter((m) => /\.md$/i.test(m.path) && !m.path.startsWith('Private notes/'));
  assert.equal(notes.length, 145, `145 notes, got ${notes.length}`);
  assert.equal(notes.filter((m) => under(m.path, 'Health')).length, 5, 'Health holds 5');
  assert.equal(notes.filter((m) => under(m.path, 'Publications')).length, 12, 'Publications holds 12');
  assert.equal(notes.filter((m) => under(m.path, 'Work')).length, 60, 'Work holds 60');
  assert.equal(notes.filter((m) => under(m.path, 'Me')).length, 30, 'Me holds 30');
  // Every link resolves before anything moves.
  for (const [p, links] of linkSnapshot(w.index)) for (const l of links) assert.ok(l.reached, `${p} reaches ${l.target}`);
});

test('the preview says how many notes move and how many links will be updated', async () => {
  const w = foldVault();
  const plan = await M.areaFold.planAreaFold(w, 'Health', 'me');
  assert.equal(plan.from, 'Health');
  assert.equal(plan.to, 'Me/Health');
  assert.equal(plan.notes, 5, '5 notes move');
  assert.equal(plan.files, 5, '5 files in all');
  assert.ok(plan.links >= 12, `${plan.links} links will be updated`);
  assert.ok(plan.linkNotes >= 8, `${plan.linkNotes} notes hold them`);
  const words = plan.words.join(' ');
  assert.match(words, /5 notes/, 'the preview counts the notes');
  assert.match(words, new RegExp(`${plan.links} links`), 'the preview counts the links');
  assert.match(words, /backup/i, 'the preview says a backup comes first');
  assert.match(words, /Undo/, 'the preview says one Undo puts it back');
  assert.ok(!words.includes('—'), 'plain words, no em dashes');
  const pub = await M.areaFold.planAreaFold(w, 'Publications', 'me');
  assert.equal(pub.notes, 12, 'Publications moves 12 notes');
  assert.equal(pub.to, 'Me/Publications');
});

test('fold Health into Me live: every link still resolves, Me holds it, Today and bills read right', async () => {
  const w = foldVault();
  const filesBefore = listAll(w.root);
  const before = linkSnapshot(w.index);
  const dueBefore = dueWords(w);
  const taskBefore = taskWords(w);
  assert.ok(taskBefore.some((x) => x.includes('Run 5k')), 'the vault has the moved task before the fold');
  const billsBefore = billModel(w);
  assert.equal(billsBefore.bills.length, 6, 'six bills before');
  const levelBefore = S.SENS.levelOf(S.SENS.parseSensitivity(JSON.parse(w.read('.neuralvault/sensitivity.json'))), 'Health/Notes/Sleep.md').level;
  const words = await M.areaFold.runAreaFold(w, 'Health', 'me');
  assert.match(words, /Health is in Me now/, `said plainly: ${words}`);
  assert.match(words, /5 notes/, 'said how many notes moved');
  assert.match(words, /backup/i, 'said where the backup went');
  assert.match(words, /Undo/, 'said Undo puts it back');
  // The folder moved; its area left the list; nothing was deleted.
  assert.ok(!existsSync(absOf(w.root, 'Health')), 'Health is gone from the top');
  assert.equal(w.index.allMeta().filter((m) => under(m.path, 'Me/Health')).length, 5, 'its 5 notes are in Me/Health');
  const areasAfter = JSON.parse(w.read('.neuralvault/areas.json'));
  assert.ok(!areasAfter.areas.some((a) => a.id === 'health'), 'Health left the areas');
  assert.ok(areasAfter.areas.some((a) => a.id === 'me'), 'Me stays');
  const filesAfter = listAll(w.root);
  const wsOld = S.WS.workspaceFileOf('Health/Projects/Marathon/Marathon.md');
  assert.deepEqual(
    filesBefore.filter((f) => !filesAfter.includes(f)).sort(),
    [...filesBefore.filter((f) => under(f, 'Health')), wsOld].sort(),
    'only the moved files left their old paths',
  );
  const added = filesAfter.filter((f) => !filesBefore.includes(f)).sort();
  assert.deepEqual(
    added,
    [...filesBefore.filter((f) => under(f, 'Health')).map((f) => `Me/${f}`), '.neuralvault/area-fold.json', S.WS.workspaceFileOf('Me/Health/Projects/Marathon/Marathon.md')].sort(),
    'the moved files at their new paths, the workspace with them, and nothing added but the receipt',
  );
  assert.ok(!filesAfter.some((f) => f.includes('.neuralvault/bin')), 'nothing went to the Bin');
  assert.equal(readdirSync(path.join(w.dataDir, 'backups')).filter((f) => f.endsWith('.zip')).length, 1, 'a full backup was taken first');
  // Every link reaches what it reached before (rewritten or not).
  const after = linkSnapshot(w.index);
  const mapP = (p) => (under(p, 'Health') ? `Me/${p}` : p);
  for (const [p, links] of before) {
    const now = mapP(p);
    assert.ok(after.has(now), `${now} still indexed`);
    assert.deepEqual(
      multi(after.get(now).map((l) => l.reached)),
      multi(links.map((l) => (l.reached ? mapP(l.reached) : l.reached))),
      `${now} reaches what it reached`,
    );
  }
  for (const [p, links] of after) for (const l of links) assert.ok(l.reached, `${p} still reaches ${l.target}`);
  // Spot checks on the rewriting: bare names stay bare, paths follow.
  assert.match(w.read('Work/Projects/Atlas/Plan.md'), /\[\[Morning run\]\]/, 'a bare name stays bare');
  assert.match(w.read('Work/Projects/Atlas/Plan.md'), /\[sleep\]\(Me\/Health\/Notes\/Sleep\.md\)/, 'a markdown path follows');
  assert.match(w.read('Publications/Newsletter/Issue 3.md'), /\[\[Me\/Health\/Notes\/Sleep\]\]/, 'a pathed wikilink follows');
  assert.match(w.read('Work/Notes/Filler 1.md'), /Me\/Health\/Notes\/Morning%20run\.md/, 'a relative link follows');
  assert.match(w.read('Me/Notes/Note 2.md'), /\[\[Me\/Health\/Projects\/Marathon\/Marathon\]\]/, 'a project path follows');
  // The meeting note still belongs to its project, and the project still parses the same.
  assert.equal(w.index.resolveAny('Marathon', 'Work/Meetings/2026-11-08 Marathon check.md'), 'Me/Health/Projects/Marathon/Marathon.md', 'the meeting still finds its project');
  const marathon = S.PROJ.parseProject(w.read('Me/Health/Projects/Marathon/Marathon.md'));
  assert.equal(marathon.name, 'Marathon', 'the project still parses');
  assert.ok(marathon.next.some((s) => s.what.includes('Buy shoes')), 'its steps came with it');
  // The graph shows Me with Health inside it.
  for (const m of w.index.allMeta().filter((m) => under(m.path, 'Me/Health'))) assert.equal(S.graphScope.graphAreaOf(m.path), 'Me', `${m.path} graphs in Me`);
  const items = w.index.allMeta().map((m) => ({ path: m.path, props: m.props ?? {} }));
  const counts = S.areas.countAreas(items, areasAfter.areas);
  assert.equal(counts.get('me').total, items.filter((i) => S.areas.areaOf(i, areasAfter.areas)?.id === 'me').length, 'Me counts its new notes');
  assert.ok(!counts.has('health'), 'no Health cluster left');
  // Today and the bills list still read right.
  assert.deepEqual(dueWords(w), dueBefore, 'Today reads the same open words');
  assert.deepEqual(taskWords(w), taskBefore, 'every task line still reads');
  assert.ok(taskWords(w).some((x) => x.includes('Run 5k')), 'the moved note’s task still reads');
  const billsAfter = billModel(w);
  assert.deepEqual(
    billsAfter.bills.map((b) => b.name).sort(),
    billsBefore.bills.map((b) => b.name).sort(),
    'the same bills list',
  );
  const due = S.finance.billsDue(billsAfter.bills, 7, '2026-11-09');
  assert.deepEqual(
    due.map((b) => b.name).sort(),
    S.finance.billsDue(billsBefore.bills, 7, '2026-11-09').map((b) => b.name).sort(),
    'the same bills due',
  );
  // Bookmarks, pins and saved views: the moves ride along, the files follow.
  assert.ok(w.state.changed.some((c) => (c.moves ?? []).some(([a, b]) => a === 'Health' && b === 'Me/Health')), 'the moves ride along for tabs, bookmarks and the recorder');
  assert.ok(!existsSync(absOf(w.root, S.WS.workspaceFileOf('Health/Projects/Marathon/Marathon.md'))), 'the old workspace file went');
  const wsNew = S.WS.workspaceFileOf('Me/Health/Projects/Marathon/Marathon.md');
  assert.ok(existsSync(absOf(w.root, wsNew)), 'the workspace went with its project');
  assert.equal(JSON.parse(w.read(wsNew)).project, 'Me/Health/Projects/Marathon/Marathon.md', 'the workspace names the new path');
  assert.deepEqual(JSON.parse(w.read(wsNew)).pinned, ['plan'], 'its pins came with it');
  const viewDef = S.BASE.readViewFile('Views/Health board.view.json', w.read('Views/Health board.view.json')).def;
  assert.equal(viewDef.source.value, 'Me/Health/Notes', 'the saved view follows its folder');
  const vaultView = JSON.parse(w.read('.neuralvault/views/vault-health.json'));
  assert.equal(vaultView.folder, 'Me/Health/Notes', 'the vault view follows too');
  assert.equal(vaultView.note, 'Me/Health/Notes/Sleep.md', 'its note pointer follows too');
  assert.match(w.read('Work/Boards/Plan.canvas'), /"file":\s*"Me\/Health\/Notes\/Sleep\.md"/, 'the canvas card follows');
  // Kept-out-of-view, templates, privacy and area words follow.
  assert.deepEqual(w.state.quiet, ['Me/Health/Notes'], 'the kept-out folder follows');
  assert.equal(w.state.templatesFolder, 'Me/Health/Templates', 'the templates folder follows');
  const sensAfter = JSON.parse(w.read('.neuralvault/sensitivity.json'));
  assert.equal(sensAfter.folders['Me/Health'], 'health', 'the folder marking follows');
  assert.equal(sensAfter.items['Me/Health/Notes/Sleep.md'], 'health', 'the note marking follows');
  assert.equal(S.SENS.levelOf(S.SENS.parseSensitivity(JSON.parse(w.read('.neuralvault/sensitivity.json'))), 'Me/Health/Notes/Sleep.md').level, levelBefore, 'the note keeps its level');
  assert.match(w.read('Me/Health/Notes/Sleep.md'), /area: Me/, '`area:` follows into Me');
  assert.match(w.read('Me/Notes/Note 5.md'), /area: Me/, 'an outside `area:` follows too');
  assert.equal(w.read('Private notes/Do not touch.md'), '# Do not touch\n\nPrivate words stay private.\n', 'private notes untouched');
  // The Systems store reads on: the machine and its service still join.
  assert.equal(w.index.resolveAny('Media box', 'Home/Systems and Home Lab/Services/Photo library.md'), 'Home/Systems and Home Lab/Machines/Media box.md', 'the service still finds its machine');
  const st = await M.areaFold.foldState(w);
  assert.equal(st.undoable, true, 'the fold can be undone');
  assert.equal(st.last.fromName, 'Health', 'the state names the fold');
});

test('Today names the moved task when it is in view', async () => {
  const w = foldVault({}, { quiet: [] });
  assert.ok(dueWords(w).some((x) => x.includes('Run 5k')), 'Today names it before the fold');
  await M.areaFold.runAreaFold(w, 'Health', 'me');
  assert.ok(dueWords(w).some((x) => x.includes('Run 5k')), 'Today names it after the fold, at its new path');
  assert.ok(w.hub.tasks().some((t) => t.path === 'Me/Health/Notes/Morning run.md'), 'its task reads from Me/Health');
});

test('fold Publications too, then Undo twice: the vault comes back byte for byte', async () => {
  const w = foldVault();
  const bytesBefore = snapshotBytes(w.root);
  const areasBefore = w.read('.neuralvault/areas.json');
  await M.areaFold.runAreaFold(w, 'Health', 'me');
  await M.areaFold.runAreaFold(w, 'Publications', 'me');
  assert.ok(!existsSync(absOf(w.root, 'Publications')), 'Publications folded too');
  assert.equal(w.index.resolveAny('Issue 3', 'Work/Projects/Beacon/Plan.md'), 'Me/Publications/Newsletter/Issue 3.md', 'links into Publications follow');
  assert.equal(w.index.resolveAny('Morning run', 'Me/Publications/Newsletter/Issue 1.md'), 'Me/Health/Notes/Morning run.md', 'a moved note still reaches the other fold');
  assert.equal(w.index.allMeta().filter((m) => under(m.path, 'Me/Publications')).length, 12, 'its 12 notes are in Me');
  const undone1 = await M.areaFold.undoAreaFold(w);
  assert.match(undone1, /Publications is back/, `first Undo puts Publications back: ${undone1}`);
  assert.ok(existsSync(absOf(w.root, 'Publications/Newsletter/Issue 1.md')), 'Publications is back on disk');
  assert.ok(!existsSync(absOf(w.root, 'Me/Publications')), 'its folded folder is gone');
  const undone2 = await M.areaFold.undoAreaFold(w);
  assert.match(undone2, /Health is back/, `second Undo puts Health back: ${undone2}`);
  const bytesAfter = snapshotBytes(w.root);
  assert.deepEqual(Object.keys(bytesAfter).sort(), Object.keys(bytesBefore).sort(), 'the same files, no more and no fewer');
  for (const [rel, digest] of Object.entries(bytesBefore)) assert.equal(bytesAfter[rel], digest, `${rel} back byte for byte`);
  assert.equal(w.read('.neuralvault/areas.json'), areasBefore, 'the areas file back word for word');
  const st = await M.areaFold.foldState(w);
  assert.equal(st.undoable, false, 'nothing left to undo');
  assert.equal(await M.areaFold.undoAreaFold(w), 'Nothing to put back.');
});

test('a fold that cannot go refuses in plain words, before anything changes', async () => {
  const w = foldVault();
  await assert.rejects(() => M.areaFold.planAreaFold(w, 'Health', 'health'), /already in that area/, 'an area cannot fold into itself');
  await assert.rejects(() => M.areaFold.planAreaFold(w, 'Me', 'me'), /already in that area/, 'nor into itself by name');
  await assert.rejects(() => M.areaFold.planAreaFold(w, 'Health', 'no-such-area'), /Pick the area/, 'an unknown area refuses');
  await assert.rejects(() => M.areaFold.planAreaFold(w, 'Nope', 'me'), /no longer there/, 'a missing folder refuses');
  const clash = foldVault({ 'Me/Health/Clash.md': '# Clash\n' });
  await assert.rejects(() => M.areaFold.planAreaFold(clash, 'Health', 'me'), /already there/, 'a clash refuses');
  assert.ok(existsSync(absOf(w.root, 'Health/Notes/Sleep.md')), 'the vault stands as it was');
  assert.equal((await M.areaFold.foldState(w)).undoable, false, 'no Undo for a fold that never ran');
});

test('the menu flow is wired: folder menu, Ctrl+K, preview, run, one Undo', () => {
  const menus = read('src/renderer/src/state/menus.ts');
  assert.ok(menus.includes("label: 'Move into another area…'"), 'the folder menu carries it');
  const commands = read('src/renderer/src/state/commands.ts');
  assert.ok(commands.includes("id: 'fold-area'"), 'Ctrl+K carries it');
  assert.ok(commands.includes("id: 'fold-area-undo'"), 'Ctrl+K carries its Undo');
  const api = read('src/shared/life-api.ts');
  for (const fn of ['foldPreview', 'foldRun', 'foldUndo', 'foldState']) assert.ok(api.includes(fn), `the window reaches ${fn}`);
  const life = read('src/main/life.ts');
  assert.ok(life.includes("handle('areas:fold-preview'"), 'the preview channel runs');
  assert.ok(life.includes('runAreaFold(foldWork()'), 'the run goes through the fold with the app’s own move');
  assert.ok(life.includes('undoAreaFold(foldWork()'), 'the Undo goes through the same fold');
  const flow = read('src/renderer/src/state/areaFold.ts');
  assert.ok(flow.includes('foldPreview'), 'the flow previews first');
  assert.ok(flow.includes('confirm(`Move'), 'the flow asks once, plainly');
  assert.ok(flow.includes('foldRun'), 'the flow runs on yes');
  assert.ok(flow.includes("label: 'Undo'"), 'the message after carries one Undo');
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes('bookmarksRenamed(from, to)'), 'bookmarks follow the moves the fold reports');
  assert.ok(!flow.match(/—/), 'no em dashes in the new words');
});
