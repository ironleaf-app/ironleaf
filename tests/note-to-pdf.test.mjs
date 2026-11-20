// node --test tests/note-to-pdf.test.mjs — one tool turns a note into its finished branded PDF (5 Nov 2026, the ).
// The tool (note_to_pdf in the one catalogue) takes a note by title or path, lays it out through the same branded
// document Export to PDF prints (src/shared/brand-document.ts — never a second version), keeps it in the note's
// Files as a new version through vault-files.ts, and returns the file with its page count. On an invented vault
// with an invented kit: the tool from each door (the former host app, a bot, the side chat, an outside agent)
// through the real gates; the same pages and the same words as Export to PDF (both printed for real by headless
// Chromium and read back with pdfinfo/pdftotext); a private note refused for a bot that may not read it; a second
// make a second version; two notes of one title asked about by name; no brand kit still a document, with one line
// saying so; and several kits printing the note's own (its area's, else the default, or clean with no brand).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-note-pdf-'));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let M;
before(async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * from ${src('src/main/agent-access.ts')};`,
      `export { AGENT_TOOLS } from ${src('src/shared/agent-access.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { Projects } from ${src('src/main/projects.ts')};`,
      `export { catalogueFor, nameFor, served } from ${src('src/shared/vault-tools.ts')};`,
      `export { AgentTools, TOOLS, catalogueSpec, moduleSpec, WEB_TOOLS, MEMORY_TOOLS } from ${src('src/main/agent.ts')};`,
      `export { brandDocument } from ${src('src/shared/brand-document.ts')};`,
      `export { VaultFiles } from ${src('src/main/vault-files.ts')};`,
      `export { Sensitivity } from ${src('src/main/sensitivity.ts')};`,
      `export { makeGate } from ${src('src/main/agent-gate.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'pdf.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    const { symlinkSync } = await import('node:fs');
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'pdf.mjs')).href);
});

// ── The invented vault: a meeting with figures, rows and actions; a plain note; two notes of one title ──

const MEETING = `---
date: 2026-03-03
time: 9:00 am
duration: 40 minutes
project: Riverside cafe
attendees: [Ana Reyes, Sam Okafor]
absent: Lee Park
figures:
  - { value: 20 Mar, label: Fit-out finishes }
  - { value: 2 Apr, label: Doors open }
---

## Summary

The fortnightly now runs from the shared tracker to cut status chasing. Thursday's oven trial at the Quay decides the install schedule.

## Actions

- [ ] Confirm the trial with the kitchen team — Ana · by 4 Mar 2026
- [ ] Run one live oven trial at the Quay — Sam · by 5 Mar 2026

## Decisions

- **Test first.** One live oven trial at the Quay on Thursday.
`;
const DATED_MEETING = `---
project: Riverside cafe
attendees: [Ana Reyes]
---

## Summary

Met and agreed the roster.
`;
const NOTES = {
  'Meetings/Harbour site meeting.md': MEETING,
  'Meetings/2026-11-05 Weekly sync.md': DATED_MEETING,
  'Notes/Oven service.md': '# Oven service\n\nThe deck oven is serviced every March.\n',
  'Work/Plans.md': '# Plans\n\nThe work plans for the quarter.\n',
  'Home/Plans.md': '# Plans\n\nThe home plans for the weekend.\n',
  'Health/Physio sessions.md': '# Physio sessions\n\nPhysio about the knee, twice weekly.\n',
  'Private notes/Diary.md': '# Diary\n\nSecret sourdough ratios.\n',
};
// The invented kit: Harbour Pine, a green band, two invented logo marks.
const KIT = {
  name: 'Harbour Pine',
  logos: { primary: 'Assets/Logos/hp-dark.svg', onDark: 'Assets/Logos/hp-white.svg' },
  colours: [{ hex: '#0f6b5c', name: 'Harbour green', use: 'Headings' }],
  fonts: [{ name: 'Helvetica', use: 'Body' }],
};
const PALETTE = { primary: ['#123f36'], onDark: ['#ffffff'] };
const mark = (fill, words) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 86"><g fill="${fill}"><path d="M75 4 106 46H90l14 18H46l14-18H44z"/><text x="75" y="83" font-family="Helvetica,Arial,sans-serif" font-size="17" font-weight="700" text-anchor="middle">${words}</text></g></svg>`;

/** A made-up vault on disk with the notes and logos above, and Ironleaf's steps as the app takes them. */
function makeHost(base, { kit = KIT } = {}) {
  const vaultRoot = path.join(base, 'vault');
  const dataDir = path.join(base, 'data');
  for (const [rel, text] of Object.entries(NOTES)) {
    const abs = path.join(vaultRoot, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  for (const [rel, svg] of [['Assets/Logos/hp-dark.svg', mark('#123f36', 'harbour pine')], ['Assets/Logos/hp-white.svg', mark('#ffffff', 'harbour pine')]]) {
    const abs = path.join(vaultRoot, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, svg);
  }
  mkdirSync(path.join(vaultRoot, '.neuralvault'), { recursive: true });
  writeFileSync(path.join(vaultRoot, '.neuralvault', 'sensitivity.json'), JSON.stringify({ folders: { Health: 'health' }, access: {}, photos: 'ask' }));
  const index = new M.VaultIndex();
  const files = new Map(Object.entries(NOTES));
  const now = Date.now();
  const reindex = (rel) => (files.has(rel) ? index.set(rel, files.get(rel), now, files.get(rel).length) : index.delete(rel));
  for (const rel of files.keys()) reindex(rel);
  const projects = new M.Projects(index);
  const writeNote = async (rel, text) => {
    files.set(rel, text);
    const abs = path.join(vaultRoot, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    reindex(rel);
  };
  const clean = (raw) => {
    const p = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!p || p.split('/').some((x) => !x.trim() || x === '.' || x === '..')) return '';
    return p;
  };
  const notes = {
    index,
    listing: async () => ({ files: [...files.keys()].map((rel) => ({ rel, kind: 'note' })), folders: [...new Set([...files.keys()].filter((r) => r.includes('/')).map((r) => r.slice(0, r.lastIndexOf('/'))))] }),
    exists: async (rel) => files.has(rel),
    read: async (rel) => {
      if (!files.has(rel)) throw new Error(`No ${rel}`);
      return files.get(rel);
    },
    write: writeNote,
    makeFolder: async () => {},
    move: async () => ({ path: '', linksUpdated: 0 }),
    trash: async (rel) => {
      files.delete(rel);
      reindex(rel);
    },
    clean,
    today: () => 'Tuesday 3 March 2026 (2026-03-03)',
    assets: {
      list: async () => ({
        folder: 'Assets', attachments: '', index: '', collections: [], tags: [],
        assets: [
          { path: 'Assets/Logos/hp-dark.svg', name: 'hp-dark.svg', size: 100, mtime: 0, kind: 'logo', tags: [], collections: [], palette: PALETTE.primary },
          { path: 'Assets/Logos/hp-white.svg', name: 'hp-white.svg', size: 100, mtime: 0, kind: 'logo', tags: [], collections: [], palette: PALETTE.onDark },
        ],
        brand: kit,
      }),
      details: async (rel) => ({ path: rel, name: rel.split('/').pop(), kind: 'logo', tags: [], collections: [] }),
    },
  };
  // The real files class, over this vault (its own small host, as the app's).
  const walk = (dir, baseRel = '') => {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const rel = baseRel ? `${baseRel}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
      else {
        const st = statSync(path.join(dir, e.name));
        out.push({ rel, mtime: st.mtimeMs, size: st.size });
      }
    }
    return out;
  };
  const vfiles = new M.VaultFiles({
    root: () => vaultRoot,
    listAll: async () => walk(vaultRoot),
    notes: () => index.allMeta().map((m) => ({ path: m.path, props: m.props, links: [] })),
    resolve: (target, from) => index.resolveAny(target, from),
    readNote: async (rel) => files.get(rel) ?? readFileSync(path.join(vaultRoot, ...rel.split('/')), 'utf8'),
    movePath: async (from, to) => ({ path: to, linksUpdated: 0 }),
    added: async () => {},
    dataDir,
    prefs: () => ({ attachmentsFolder: 'Attachments', templatesFolder: 'Templates', dailyFolder: 'Daily', filesWithRecord: true }),
  });
  const host = {
    dataDir,
    kind: 'embedded',
    ready: async () => {},
    library: () => vaultRoot,
    index,
    notes,
    projects: () => projects.list(),
    projectView: (rel) => projects.view(rel),
    allProjects: () => projects.all(),
    editProject: async () => ({ file: '', words: '', before: '', after: '' }),
    undoProject: async () => {},
    createProject: async (name) => `Projects/${name}/${name}.md`,
    writeNote,
    trash: async (rel) => notes.trash(rel),
    today: () => ({}),
    dailyPath: () => 'Daily/2026-03-03.md',
    dailyNote: async () => 'Daily/2026-03-03.md',
    freeNote: async (folder, title) => `${folder ? `${folder}/` : ''}${title}.md`,
    prefs: () => ({ captureNoProject: 'daily', timeFormat: 'HH:mm', templatesFolder: 'Templates' }),
    templates: () => [],
    lastReview: async () => null,
    person: () => 'Sam',
    changed: () => {},
    files: {
      target: (rel) => ({ kind: 'library', folder: `Projects/Files` }),
      absolute: (rel) => (rel ? path.join(vaultRoot, ...rel.split('/')) : vaultRoot),
      addedToLibrary: async () => {},
      trashFile: async (abs) => rmSync(abs, { force: true }),
      attachmentsFor: (note) => vfiles.folderFor(note),
      recorded: async (rel, o) => {
        // describe now (the app says later): nothing still writing when the run ends.
        await vfiles.recordAdded(rel, { source: { by: o.by, how: o.how, ...(o.from ? { from: o.from } : {}), at: new Date().toISOString() }, ...(o.record ? { record: o.record } : {}), ...(o.what ? { what: o.what } : {}), describe: 'now' });
      },
      newVersion: async (rel, src, o) => {
        const e = await vfiles.addVersion(rel, src, { source: { by: o.by, how: o.how, ...(o.from ? { from: o.from } : {}), at: new Date().toISOString() }, move: o.move });
        return e.version;
      },
    },
  };
  const sensitivity = new M.Sensitivity({ root: () => vaultRoot, props: (rel) => index.get(rel)?.props, pc: 'TEST-PC' });
  host.gate = (who, name) => M.makeGate(sensitivity, who, name);
  host.grantOnce = (who, rel) => sensitivity.grant(who, rel);
  return { host, files, index, vaultRoot, vfiles, sensitivity };
}

let n = 0;
const captured = [];
async function setup(opts = {}) {
  const base = path.join(work, `case-${++n}`);
  const t = makeHost(base, opts);
  t.host.brandPrint = async (html) => {
    captured.push(html);
    const { pdf, pages } = await printHtml(html, `tool-${captured.length}`);
    return { pdf, pages };
  };
  const access = new M.AgentAccess(t.host);
  access.load();
  return { ...t, access };
}
const said = (r) => r.content.map((c) => c.text).join('\n');

// ── Headless Chromium, printing HTML the way the hidden window does ──

let server;
let origin = '';
let browser;
async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
async function startBrowser() {
  const port = await freePort();
  const child = spawn(SHELL, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const close = () => {
    try {
      child.kill('SIGKILL');
    } catch {}
  };
  try {
    let target;
    for (let i = 0; i < 100 && !target; i++) {
      await sleep(150);
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
      } catch {}
    }
    if (!target) throw new Error('the browser opened no page');
    const WebSocket = require('ws');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let id = 1;
    const pending = new Map();
    ws.onmessage = (m) => {
      const v = JSON.parse(String(m.data));
      if (v.id && pending.has(v.id)) {
        const { resolve, reject } = pending.get(v.id);
        pending.delete(v.id);
        if (v.error) reject(new Error(v.error.message));
        else resolve(v.result);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const my = id++;
        pending.set(my, { resolve, reject });
        ws.send(JSON.stringify({ id: my, method, params }));
      });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };
    return { send, ev, close };
  } catch (err) {
    close();
    throw err;
  }
}
/** One HTML document printed for real: its PDF bytes and its true page count. */
async function printHtml(html, name) {
  // Served over http (the tool's file:// vault addresses rewritten to the same files), so pictures load as they do
  // in the hidden window; only the address scheme changes, never the document.
  writeFileSync(path.join(work, `${name}.html`), html);
  await browser.send('Page.navigate', { url: `${origin}/doc/${name}.html` });
  let report = null;
  for (let i = 0; i < 240 && !report; i++) {
    await sleep(250);
    report = await browser.ev('window.__report || null').catch(() => null);
  }
  assert.ok(report, `${name}: the pages laid out`);
  const pdf = await browser.send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, generateDocumentOutline: true });
  assert.ok(pdf?.data, `${name}: printed`);
  return { pdf: Buffer.from(pdf.data, 'base64'), pages: report.pages };
}
const pdfInfo = (file) => {
  const r = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
  assert.equal(r.status, 0, `pdfinfo reads ${file}`);
  return r.stdout;
};
const pdfText = (file) => {
  const r = spawnSync('pdftotext', [file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `pdftotext reads ${file}`);
  return r.stdout;
};

before(async () => {
  server = createServer((req, res) => {
    const p = new URL(req.url ?? '/', 'http://x').pathname;
    if (p.startsWith('/doc/')) {
      const file = path.join(work, decodeURIComponent(p.slice('/doc/'.length)));
      if (!file.startsWith(work) || !existsSync(file)) {
        res.writeHead(404);
        res.end('no');
        return;
      }
      // The tool's file:// vault addresses served over http, so pictures load; only the scheme changes.
      const html = readFileSync(file, 'utf8').replaceAll(`file://${work}`, `${origin}/files`);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
      return;
    }
    if (p.startsWith('/files/')) {
      const file = path.join(work, decodeURIComponent(p.slice('/files/'.length)));
      if (!file.startsWith(work) || !existsSync(file)) {
        res.writeHead(404);
        res.end('no');
        return;
      }
      res.writeHead(200, { 'content-type': file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream' });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(404);
    res.end('no');
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${port}`;
  browser = await startBrowser();
});

after(async () => {
  browser?.close();
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

const spark = { id: 'neuralspark', name: 'the host app', consumer: 'spark' };
const bot = { id: 'bot:harbour', name: 'Chat bot (harbour)', consumer: 'spark' };
const side = { id: 'assistant', name: 'Ironleaf’s assistant', consumer: 'side' };
const gateFor = (t, who) => M.makeGate(t.sensitivity, who.id, who.name);

test('the catalogue serves one PDF tool, an edit, to every door', () => {
  const def = M.AGENT_TOOLS.find((t) => t.name === 'note_to_pdf');
  assert.ok(def, 'note_to_pdf is in the catalogue');
  assert.equal(def.level, 'edit', 'making a PDF files it, so it is an edit');
  assert.ok(!def.readOnly, 'it writes the note’s Files');
  assert.ok(!def.deletes, 'it waits for nobody');
  assert.ok(M.served('spark', def) && M.served('side', def), 'served to the host app and the side chat');
  assert.equal(M.nameFor('spark', 'note_to_pdf'), 'neuralvault_note_to_pdf', 'a change, so neuralvault_*');
  assert.equal(M.nameFor('side', 'note_to_pdf'), 'note_to_pdf');
  const toSpark = M.catalogueFor('spark').find((t) => t.tool === 'note_to_pdf');
  assert.equal(toSpark.family, 'neuralvault_more', 'with the rest of the catalogue');
  assert.match(def.description, /note becomes a finished branded PDF/, 'this is how a note becomes its PDF');
  assert.match(def.description, /Export to PDF/, 'the same document Export prints');
  assert.match(def.description, /design tools/, 'new designed documents stay with the design tools');
  assert.deepEqual(def.required, ['note']);
});

test('p5 the side chat offers note_to_pdf: its offered list, the way the turn builds it', () => {
  // 5 Nov 2026, the real app: the assistant named 40 tools with no note_to_pdf. Ruled out on this side (the
  // cause was the former host app's bridge cutting the list at 40): the turn offers tools.offeredTools()
  // (ai.ts) — s10-assistant-tools-lean leans the list with a more_tools door but keeps note_to_pdf in the
  // everyday set, so it is offered with the door still shut. Wired from catalogueFor('side') (app.ts).
  const ai = readFileSync(path.join(root, 'src/main/ai.ts'), 'utf8');
  assert.ok(ai.includes('tools.offeredTools()'), 'the turn offers the list AgentTools builds');
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  assert.ok(app.includes("catalogueFor('side')"), 'the wired catalogue is the side chat’s own');
  const t = new M.AgentTools(
    { index: { get: () => undefined }, catalogue: { specs: () => M.catalogueFor('side'), call: async () => ({ text: '', isError: false, changed: [] }) }, web: {}, memory: {} },
    [],
    () => {},
  );
  const pdf = t.offeredTools().find((t) => t.name === 'note_to_pdf');
  assert.ok(pdf, 'note_to_pdf is offered with the door still shut');
  assert.deepEqual(pdf.parameters.required, ['note'], 'with the note it takes');
  assert.match(pdf.description, /branded PDF/, 'and its words');
});

test('from every door: the file and its page count, kept in the note’s Files', async () => {
  const doors = [
    ['the host app', spark],
    ['a bot', bot],
    ['the side chat', side],
  ];
  for (const [door, who] of doors) {
    const t = await setup();
    const r = await t.access.asOwn(who, gateFor(t, who), 'note_to_pdf', { note: 'Harbour site meeting' });
    assert.ok(!r.isError, `${door}: made (${said(r).slice(0, 200)})`);
    const words = said(r);
    assert.match(words, /Harbour site meeting\.pdf/, `${door}: the file`);
    assert.match(words, /\d+ pages?/, `${door}: its page count`);
    const rel = `${t.vfiles.folderFor('Meetings/Harbour site meeting.md')}/Harbour site meeting.pdf`;
    assert.ok(existsSync(path.join(t.vaultRoot, ...rel.split('/'))), `${door}: kept in the note’s Files (${rel})`);
    assert.ok(words.includes(t.vaultRoot), `${door}: the whole path, to hand over`);
    const escRel = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(t.files.get('Meetings/Harbour site meeting.md'), new RegExp(`\\[\\[${escRel}(\\|[^\\]]+)?\\]\\]`), `${door}: linked in the note`);
    const leftovers = [];
    const sweepParts = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) sweepParts(p);
        else if (e.name.endsWith('.part')) leftovers.push(p);
      }
    };
    try {
      sweepParts(t.host.dataDir);
    } catch {}
    assert.deepEqual(leftovers, [], `${door}: no temp file left behind`);
  }
  // An outside agent over MCP, at Edit, through its own gate.
  const t = await setup();
  await t.access.setLocalMcp({ on: true, level: 'edit' });
  const r = await t.access.asLocalMcp('note_to_pdf', { note: 'Notes/Oven service.md' });
  assert.ok(!r.isError, `an outside agent: made (${said(r).slice(0, 200)})`);
  assert.match(said(r), /Oven service\.pdf.*\d+ pages?/s, 'the file and its page count');
});

test('the same pages and the same words as Export to PDF', async () => {
  const t = await setup();
  const r = await t.access.asOwn(spark, gateFor(t, spark), 'note_to_pdf', { note: 'Meetings/Harbour site meeting.md' });
  assert.ok(!r.isError, `made (${said(r).slice(0, 200)})`);
  const toolHtml = captured[captured.length - 1];
  assert.match(toolHtml, /Harbour Pine/, 'set in the brand kit');
  assert.match(toolHtml, /#0f6b5c/, 'the kit’s band');
  const rel = `${t.vfiles.folderFor('Meetings/Harbour site meeting.md')}/Harbour site meeting.pdf`;
  const toolPdf = path.join(t.vaultRoot, ...rel.split('/'));
  assert.ok(readFileSync(toolPdf).subarray(0, 4).toString() === '%PDF', 'real PDF bytes, filed');
  const reported = Number(/(\d+) pages?/.exec(said(r))[1]);
  assert.ok(new RegExp(`Pages:\\s+${reported}\\b`).test(pdfInfo(toolPdf)), `the filed PDF has its ${reported} pages`);
  // Export to PDF, independently: the same note and kit through the same document, printed the same way.
  const caseRel = path.relative(work, t.vaultRoot).split(path.sep).join('/');
  const exportHtml = M.brandDocument({ title: 'Harbour site meeting', text: MEETING, path: 'Meetings/Harbour site meeting.md', kit: KIT, url: (rel2) => `${origin}/files/${caseRel}/${rel2.split('/').map(encodeURIComponent).join('/')}`, logoPalette: PALETTE });
  const { pdf } = await printHtml(exportHtml, 'export');
  const exportPdf = path.join(work, 'export.pdf');
  writeFileSync(exportPdf, pdf);
  assert.ok(new RegExp(`Pages:\\s+${reported}\\b`).test(pdfInfo(exportPdf)), 'Export prints the same pages');
  const flat = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(flat(pdfText(toolPdf)), flat(pdfText(exportPdf)), 'the same words');
});

test('a second make is a second version, the first kept', async () => {
  const t = await setup();
  const call = () => t.access.asOwn(spark, gateFor(t, spark), 'note_to_pdf', { note: 'Harbour site meeting' });
  assert.ok(!(await call()).isError, 'made once');
  const twice = await call();
  assert.ok(!twice.isError, 'made twice');
  assert.match(said(twice), /version 2/, 'said as a second version');
  const rel = `${t.vfiles.folderFor('Meetings/Harbour site meeting.md')}/Harbour site meeting.pdf`;
  const rows = await t.vfiles.versions(rel);
  assert.equal(rows.length, 2, 'two versions kept');
  assert.ok(rows.some((v) => v.n === 1 && v.latest === false), 'the first kept as v1');
  assert.ok(rows.some((v) => v.n === 2 && v.latest === true), 'the second the latest');
  const links = (t.files.get('Meetings/Harbour site meeting.md').match(/\[\[[^\]]*Harbour site meeting\.pdf[^\]]*\]\]/g) ?? []).length;
  assert.equal(links, 1, 'linked in the note once: the link reaches the new one');
});

test('a private note stays private, and a levelled note is refused by name', async () => {
  const t = await setup();
  const g = gateFor(t, bot);
  const diary = await t.access.asOwn(bot, g, 'note_to_pdf', { note: 'Private notes/Diary.md' });
  assert.equal(diary.isError, true, 'a private note refused');
  assert.match(said(diary), /Private notes are never open/, 'in plain words');
  const physio = await t.access.asOwn(bot, g, 'note_to_pdf', { note: 'Health/Physio sessions.md' });
  assert.equal(physio.isError, true, 'a note the bot may not read refused');
  assert.match(said(physio), /marked Health/, 'saying its level, never its words');
  assert.doesNotMatch(said(physio), /knee/);
  const pdfs = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith('.pdf')) pdfs.push(e.name);
    }
  };
  walk(t.vaultRoot);
  assert.deepEqual(pdfs, [], 'nothing filed for either');
});

test('two notes of one title are asked about by name', async () => {
  const t = await setup();
  const r = await t.access.asOwn(spark, gateFor(t, spark), 'note_to_pdf', { note: 'Plans' });
  assert.equal(r.isError, true, 'not guessed');
  assert.match(said(r), /More than one note/, 'asked which');
  assert.match(said(r), /Home\/Plans\.md/, 'naming them');
  assert.match(said(r), /Work\/Plans\.md/, 'naming them');
});

test('no brand kit: the neutral document still comes, with one line', async () => {
  const t = await setup({ kit: null });
  const r = await t.access.asOwn(spark, gateFor(t, spark), 'note_to_pdf', { note: 'Harbour site meeting' });
  assert.ok(!r.isError, `still made (${said(r).slice(0, 200)})`);
  const toolHtml = captured[captured.length - 1];
  assert.ok(!toolHtml.includes('Harbour Pine'), 'no brand on the band');
  assert.match(toolHtml, /#101820/, 'the neutral band');
  assert.match(said(r), /no brand kit yet.*logo on it/i, 'one line saying a brand kit would put their logo on it');
});

test('a note that is not there is said plainly', async () => {
  const t = await setup();
  const r = await t.access.asOwn(spark, gateFor(t, spark), 'note_to_pdf', { note: 'No such note' });
  assert.equal(r.isError, true);
  assert.match(said(r), /There is no note/, 'in plain words');
});

test('p4 a dated file keeps its name for the PDF, while the document names itself without the date', async () => {
  const t = await setup();
  const r = await t.access.asOwn(spark, gateFor(t, spark), 'note_to_pdf', { note: 'Meetings/2026-11-05 Weekly sync.md' });
  assert.ok(!r.isError, `made (${said(r).slice(0, 200)})`);
  assert.match(said(r), /2026-11-05 Weekly sync\.pdf/, 'the file keeps the filing date');
  const toolHtml = captured[captured.length - 1];
  assert.ok(toolHtml.includes('<h1 class="blk" dir="auto">Weekly sync</h1>'), 'the document without it');
  assert.ok(toolHtml.includes('Thursday 5 November 2026'), 'the day kept in the subtitle');
});

test('several kits: a note prints in its area’s kit, or clean with no brand', async () => {
  // The right brand on the right document: the tool reads the note's own kit through the one function Export to PDF
  // prints through (invented kits: Redline Co red for Work, no brand for Home, the default for the rest).
  const RED = { id: 'redline-co', name: 'Redline Co', logos: {}, colours: [{ name: 'Signal red', hex: '#b3261e', use: 'Headings' }], fonts: [] };
  const TEAL = { id: 'tealwork-studio', name: 'Tealwork Studio', logos: {}, colours: [{ name: 'Pine', hex: '#0f6b5c', use: 'Headings' }], fonts: [] };
  const AREAS = [
    { id: 'work', name: 'Work', folder: 'Work', icon: 'briefcase', color: 'slate', about: 'Your job' },
    { id: 'home', name: 'Home', folder: 'Home', icon: 'home', color: 'ochre', about: 'The house' },
  ];
  const printed = async (note) => {
    const t = await setup();
    const base = await t.host.notes.assets.list();
    t.host.notes.assets.list = async () => ({ ...base, brand: { name: RED.name, logos: {}, colours: RED.colours, fonts: [] }, kits: [RED, TEAL], brandDefault: 'redline-co', brandAreas: { work: 'redline-co', home: null }, brandProjects: {} });
    t.host.areas = () => AREAS;
    const r = await t.access.asOwn(spark, gateFor(t, spark), 'note_to_pdf', { note });
    assert.ok(!r.isError, `${note}: made (${said(r).slice(0, 200)})`);
    return captured[captured.length - 1];
  };
  const work = await printed('Work/Plans.md');
  assert.ok(work.includes('--accent:#b3261e') && work.includes('Redline Co'), 'the work note in its red kit');
  const home = await printed('Home/Plans.md');
  assert.ok(home.includes('--accent:#101820'), 'the home note clean and neutral');
  assert.ok(!home.includes('Redline Co') && !home.includes('Tealwork Studio'), 'no brand on it');
  const loose = await printed('Notes/Oven service.md');
  assert.ok(loose.includes('--accent:#b3261e') && loose.includes('Redline Co'), 'a note with no area takes the default');
});
