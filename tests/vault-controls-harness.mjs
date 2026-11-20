// The vault-controls harness (p10, 4 Nov 2026): the REAL Ironleaf renderer bundle
// (vite, the same sources the app ships) in headless Chromium, against a REAL test
// vault on disk served through the REAL main-side data layer (Vault, VaultIndex,
// Projects, Hub, TasksService, registerLife's inbox/people, SharedSpacesService,
// records, today) bundled for node. Only the outside world is stubbed: OS dialogs,
// AI models, external apps, sync servers, calendar accounts, recording, printing.
//   startHarness(opts) -> { origin, vaultDir, rpc, calls, close() }; opts.realChecks wires the real
//   projects:checks (stubbed empty by default).
// Part of tests/vault-controls.test.mjs; not a test itself.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the test vault ─────────────────────────────────────────────────────────────
// Made-up people and projects, shaped like a real one (a project with a Wave list workstream,
// What's next, key dates, decisions, risks), so every named view has something real to show and
// every row action exists.
export function writeVault(dir) {
  const w = (rel, text) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  w('Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', `---
type: project
status: active
health: on track
owner: Alex Chen
due: 2026-11-20
---
# Harbourline Cart Fix

## Summary

The shop's cart drops about one order in forty at payment. Fix the retry, then the receipt. See the [[Receipts spec]] for what v2 shows.

## What's next

- [ ] Chase the 2 carts that failed on Friday (PAY-101, PAY-102) — Alex Chen — due 2026-11-05
- [ ] Retry the failed payment twice before showing an error — Priya Nair — due 2026-11-06
- [ ] Send the receipt v2 for review — Alex Chen — due 2026-11-04

## Workstreams

| Workstream | Owner | Status | Next step |
|---|---|---|---|
| Wave list | Alex Chen | in progress | Upgrade or chase the 13 still to do at 26 Oct |
| Receipts | Priya Nair | ready to send | Send v2 (reviewer PASS) |

## Key dates

- 2026-11-06: Retry fix live (milestone)
- 2026-11-20: Cart fix done (milestone)

## Decisions

- 2026-11-01: Retry twice, then fail loud (decided by Alex Chen)

## Risks

- Repeat failures on old Safari (owner: Priya Nair, level: medium)

## People

- Alex Chen (owner)
- Priya Nair
`);
  w('Projects/Harbourline Cart Fix/Notes/Kickoff.md', `---
type: note
tags: [harbourline, kickoff]
---
# Kickoff

Met with [[Alex Chen]] about the [[Harbourline Cart Fix|cart fix]]. The [[Receipts v2]] design is linked. See the [[Receipts spec]].

See also the [[2026-11-03 Cart standup]] notes.
`);
  w('Projects/Museum Late Shift/Museum Late Shift.md', `---
type: project
status: active
health: at risk
owner: Priya Nair
due: 2026-10-30
---
# Museum Late Shift

## Summary

Late opening every Friday. Behind on the roster.

## What's next

- [ ] Publish the November roster — Priya Nair — due 2026-10-28
- [x] Confirm the caterer — Priya Nair

## Workstreams

| Workstream | Owner | Status | Next step |
|---|---|---|---|
| Roster | Priya Nair | at risk | Fill the last 3 Friday nights |

## Key dates

- 2026-10-28: November roster out (milestone)
`);
  w('People/Alex Chen.md', `---
type: person
role: Shop developer
email: alex@example.invalid
---
# Alex Chen

Owns the [[Harbourline Cart Fix|cart fix]]. Wants the retry live by Friday.
`);
  w('People/Priya Nair.md', `---
type: person
role: Designer
---
# Priya Nair

Designs receipts. Waiting on the [[Harbourline Cart Fix|cart fix]] review.
`);
  w('Meetings/2026-11-03 Cart standup.md', `---
type: meeting
date: 2026-11-03
attendees: [Alex Chen, Priya Nair]
project: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md
---
# 2026-11-03 Cart standup

## Agenda

- Retry fix
- Receipt review

## Actions

- [ ] Retry the failed payment twice — Priya Nair — due 2026-11-06
- [x] Book the room — Alex Chen

## Decisions

- Retry twice, then fail loud
`);
  w('Daily/2026-11-04.md', `# 4 November 2026

- [ ] Water the plants
- [x] Read the brief
`);
  w('Notes/Receipts v2.md', `---
tags: [design]
---
# Receipts v2

The new receipt. Linked from [[Harbourline Cart Fix]].
`);
  w('Inbox.md', `# Inbox

- [ ] Call the bank about the card reader
- [ ] A quote for the shop awning: $1,200 — decide by Friday
- Buy milk
`);
  w('Inbox/awning-quote.md', `# Awning quote

The awning quote is $1,200 from ShadeCo.
`);
  w('Templates/Standup.md', `# Standup

## Agenda

## Actions
`);
  w('Docs/Receipts spec.md', `---
type: doc
---
# Receipts spec

## Summary

The v2 receipt shows every line.

## Changes

- 2026-11-02: Added the tax line.
`);
  return dir;
}

// ── the real data layer, bundled for node ───────────────────────────────────────
let corePromise = null;
export function loadCore(work) {
  if (!corePromise) {
    corePromise = (async () => {
      const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
      const entry = path.join(work, 'core-entry.ts');
      writeFileSync(
        entry,
        [
          `export { Vault, setVaultBin } from ${JSON.stringify(path.join(root, 'src/main/vault.ts'))};`,
          `export { createVaultBin, KEEP_DAYS } from ${JSON.stringify(path.join(root, 'src/main/bin.ts'))};`,
          `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`,
          `export { AssetStore } from ${JSON.stringify(path.join(root, 'src/main/assets.ts'))};`,
          `export { Projects, folderFiles } from ${JSON.stringify(path.join(root, 'src/main/projects.ts'))};`,
          `export { createProjectChecks } from ${JSON.stringify(path.join(root, 'src/main/project-checks.ts'))};`,
          `export { todayData, changedFiles } from ${JSON.stringify(path.join(root, 'src/main/today.ts'))};`,
          `export { Hub } from ${JSON.stringify(path.join(root, 'src/main/hub.ts'))};`,
          `export { TasksService } from ${JSON.stringify(path.join(root, 'src/main/tasks.ts'))};`,
          `export { registerLife } from ${JSON.stringify(path.join(root, 'src/main/life.ts'))};`,
          `export { peekWithFolderFiles } from ${JSON.stringify(path.join(root, 'src/main/folder-file-peek.ts'))};`,
          `export { RECORD_TYPES } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`,
          `export { registerBrief } from ${JSON.stringify(path.join(root, 'src/main/brief.ts'))};`,
          `export { SharedSpacesService } from ${JSON.stringify(path.join(root, 'src/main/shared-spaces.ts'))};`,
          `export { WeeklyTidy } from ${JSON.stringify(path.join(root, 'src/main/weekly-tidy.ts'))};`,
          `export { buildRecordModel, findRecords, personOpenItems, meetingItems, projectAttention } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`,
          `export { DEFAULT_PREFS } from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};`,
          `export { parseProject, applyProjectEdit, serializeProject, textVersion, safeName, unclaimProjectText, claimFolderText } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
          `export { planTidy } from ${JSON.stringify(path.join(root, 'src/shared/project-tidy.ts'))};`,
          `export { projectChanges, hubModel } from ${JSON.stringify(path.join(root, 'src/shared/project-hub.ts'))};`,
          `export { formatDate } from ${JSON.stringify(path.join(root, 'src/shared/dates.ts'))};`,
          `export { dailyFolderHint, dayShapedByFolder } from ${JSON.stringify(path.join(root, 'src/shared/days.ts'))};`,
          `export { findReminders } from ${JSON.stringify(path.join(root, 'src/shared/reminders.ts'))};`,
          `export { titleFromPath } from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};`,
          `export { findUnlinkedPhrase } from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};`,
          `export { meetingsModel, readMeeting, setTick, addToSection, newMeetingText, followUpDraft, meetingDay, ACTIONS_HEADING, AGENDA_HEADING, DECISIONS_HEADING } from ${JSON.stringify(path.join(root, 'src/shared/work-meetings.ts'))};`,
          `export { isMeetingNote, sameWhat } from ${JSON.stringify(path.join(root, 'src/shared/meetings.ts'))};`,
          `export { moduleOn, partOn } from ${JSON.stringify(path.join(root, 'src/shared/life-modules.ts'))};`,
          `export { planCapture } from ${JSON.stringify(path.join(root, 'src/shared/capture.ts'))};`,
          `export { listTemplates } from ${JSON.stringify(path.join(root, 'src/main/templates.ts'))};`,
          `export { GROUPS, noteFromTemplate, starterTemplate, templateFromNote, templateKind } from ${JSON.stringify(path.join(root, 'src/shared/templates.ts'))};`,
          `export { cleanAnswers, takeCursor, templateFields } from ${JSON.stringify(path.join(root, 'src/shared/template-fields.ts'))};`,
          `export { cleanFileName as sharedCleanFileName, isReservedName } from ${JSON.stringify(path.join(root, 'src/shared/paths.ts'))};`,
          `export { isProjectProps } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`,
          `export { isDocNote } from ${JSON.stringify(path.join(root, 'src/shared/doc-file.ts'))};`,
          `export { DOCS_FOLDER, docPath, isDocText, newDocText, safeDocName, setDocProp } from ${JSON.stringify(path.join(root, 'src/shared/doc-file.ts'))};`,
          `export { WorkModules, WORK_GROUP, registerWorkModules } from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`,
          `export { PERSONAL_GROUP } from ${JSON.stringify(path.join(root, 'src/main/personal-modules.ts'))};`,
          `export { LIFE_RECORDS_GROUP } from ${JSON.stringify(path.join(root, 'src/main/life-records.ts'))};`,
          `export { RecordModules, registerRecordModules } from ${JSON.stringify(path.join(root, 'src/main/record-modules.ts'))};`,
          `export { Publications, registerPublications } from ${JSON.stringify(path.join(root, 'src/main/publications.ts'))};`,
          `export { Modules } from ${JSON.stringify(path.join(root, 'src/main/modules.ts'))};`,
          `export { Sensitivity } from ${JSON.stringify(path.join(root, 'src/main/sensitivity.ts'))};`,
          `export { cleanBackupPrefs, DEFAULT_BACKUP, remoteKind, branchProblem } from ${JSON.stringify(path.join(root, 'src/shared/backup.ts'))};`,
          `export { AGENT_GROUPS, LEVEL_IDS, accessOf, hasOwnRow, parentOf, readLevel } from ${JSON.stringify(path.join(root, 'src/shared/sensitivity.ts'))};`,
          `export { isPrivatePath } from ${JSON.stringify(path.join(root, 'src/shared/private.ts'))};`,
          `export { VaultFiles } from ${JSON.stringify(path.join(root, 'src/main/vault-files.ts'))};`,
          `export { namesAsk, namesTold, namesDecide, namesPending, namesDecision, namesUndoPairs, namesUndoneLatest } from ${JSON.stringify(path.join(root, 'src/main/vault-check.ts'))};`,
          `export { followMoves, listViews, loadWorkspace, removeView, saveView, saveWorkspace } from ${JSON.stringify(path.join(root, 'src/main/workspaces.ts'))};`,
        ].join('\n'),
      );
      const file = path.join(work, 'core.mjs');
      const electronStub = path.join(work, 'electron-stub.mjs');
      writeFileSync(electronStub, `export const shell = { openPath: async () => {}, showItemInFolder: () => {}, openExternal: async () => {} };\nexport default { shell };\n`);
      const noElectron = { name: 'no-electron', resolveId: (id) => (id === 'electron' ? electronStub : null) };
      await build({ input: entry, platform: 'node', plugins: [noElectron], output: { file, format: 'esm' }, logLevel: 'silent' });
      return import(pathToFileURL(file).href);
    })();
  }
  return corePromise;
}

// The renderer bundle, rebuilt only when the sources changed (keyed by mtime hash).
export async function buildRenderer(work) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|css|html)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(root, 'src', 'renderer'));
  walk(path.join(root, 'src', 'shared'));
  const h = createHash('sha256');
  for (const f of files.sort()) h.update(f + ':' + statSync(f).mtimeMs + ';');
  const key = h.digest('hex').slice(0, 16) + (process.env.NV_CONTROLS_SOURCEMAP ? '-map' : '');
  // Namespaced by worktree (p11, 4 Nov 2026): the box runs several coders' sweeps at once, and the old shared
  // `nv-controls-dist-*` name meant one coder's build deleted another's bundle mid-sweep (ENOENT on re-navigation).
  // Our clean-up touches our namespace only, and the name no longer matches the old shared prefix.
  const ns = createHash('sha256').update(root).digest('hex').slice(0, 8);
  const mine = `nvctrl-dist-${ns}-${key}`;
  const dir = path.join(tmpdir(), mine);
  if (!existsSync(path.join(dir, 'index.html'))) {
    for (const e of readdirSync(tmpdir())) if (e.startsWith(`nvctrl-dist-${ns}-`) && e !== mine) rmSync(path.join(tmpdir(), e), { recursive: true, force: true });
    const { build } = await import(path.join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js'));
    const react = (await import(path.join(root, 'node_modules', '@vitejs', 'plugin-react', 'dist', 'index.js'))).default;
    await build({ root: path.join(root, 'src', 'renderer'), plugins: [react()], logLevel: 'silent', build: { outDir: dir, emptyOutDir: true, sourcemap: !!process.env.NV_CONTROLS_SOURCEMAP, chunkSizeWarningLimit: 20000 } });
  }
  return dir;
}

// ── the vault services (real main-side code over the test vault) ─────────────────
export async function openServices(vaultDir, dataDir, core, opts = {}) {
  const vault = await core.Vault.open(vaultDir);
  const index = new core.VaultIndex();
  const settings = {
    prefs: { ...core.DEFAULT_PREFS, dailyFolder: 'Daily', templatesFolder: 'Templates' },
    about: { version: 'harness', host: 'standalone' },
    model: null,
    dailyFolder: 'Daily',
    dailyFormat: 'YYYY-MM-DD',
    dailyTemplate: '',
    // The harness answers the assistant's asks itself, so it reads as set up (opts.aiReady false: the no-connection state).
    ai: opts.aiReady === false ? { ready: false, note: 'Add an AI connection in Settings › AI to use this.', modelName: null } : { ready: true, note: null, modelName: 'Harness model' },
    recentVaults: [],
    library: vaultDir,
    host: 'standalone',
  };
  const state = new Map();
  const errorReports = [];
  const calls = [];
  const log = (ns, method, args) => {
    calls.push({ ns, method, at: Date.now() });
    if (calls.length > 5000) calls.splice(0, 1000);
  };

  async function rescan(rel) {
    const abs = path.join(vaultDir, ...rel.split('/'));
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      index.delete(rel);
      return;
    }
    if (!/\.md$/i.test(rel)) return;
    const st = statSync(abs);
    index.set(rel, readFileSync(abs, 'utf8'), st.mtimeMs, st.size);
  }
  async function rescanAll() {
    // Through the vault's own listing, as the app's rescan does (5 Nov 2026, u3 moving-in: the raw walk indexed
    // node_modules, nested vaults and symlinks the app excludes — UI tests saw files no person ever would).
    const all = await vault.listAll();
    index.setFiles(all.files.filter((f) => f.kind !== 'note').map((f) => f.rel));
    const notes = all.files.filter((f) => f.kind === 'note');
    const present = new Set(notes.map((f) => f.rel));
    for (const meta of index.allMeta()) if (!present.has(meta.path)) index.delete(meta.path);
    for (const f of notes) await rescan(f.rel);
  }
  await rescanAll();

  // Deletes go to the vault's own Bin like the app's (one Bin): the id back, for the toast's Undo.
  const bin = core.createVaultBin({ root: vaultDir });
  async function binTrash(rel) {
    const item = await bin.put(String(rel), { by: 'You' });
    const p = String(rel);
    for (const m of index.allMeta()) if (m.path === p || m.path.startsWith(`${p}/`)) index.delete(m.path);
    await rescanAll();
    return item.id;
  }
  async function binRestore(id) {
    const r = await bin.restore(String(id));
    await rescanAll();
    return r;
  }

  const records = (opts = {}) => index.records({ templatesFolder: settings.prefs.templatesFolder || 'Templates', ...opts });
  const projects = new core.Projects(index);
  const tasks = new core.TasksService({ index, templatesFolder: () => settings.prefs.templatesFolder || 'Templates', write: (rel, text) => writeNote(rel, text) });
  const hub = new core.Hub({
    index,
    dailyPath: (day) => `Daily/${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}.md`,
    templatesFolder: () => settings.prefs.templatesFolder || 'Templates',
    reminders: () => [],
    write: (rel, text) => writeNote(rel, text),
    startDay: async (day) => {
      const rel = `Daily/${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}.md`;
      if (!(await vault.any(rel))) {
        await vault.create(rel, `# ${rel.split('/').pop().replace(/\.md$/, '')}\n`);
        await rescan(rel);
      }
      return rel;
    },
  });
  const spaces = new core.SharedSpacesService({ root: () => vaultDir, index });
  const tidy = new core.WeeklyTidy({
    dataDir,
    index,
    library: () => vaultDir,
    read: (rel) => index.content(rel),
    write: (rel, text) => writeNote(rel, text).then(() => undefined),
    move: async (from, to) => movePath(from, to, true),
    trash: async (rel) => void (await binTrash(rel)),
    exists: (rel) => vault.any(rel),
    templatesFolder: () => settings.prefs.templatesFolder || 'Templates',
    dailyToday: () => {
      const d = new Date();
      return `Daily/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.md`;
    },
    post: () => 0,
    changed: () => {},
    now: () => Date.now(),
  });

  async function writeNote(rel, text, base) {
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    if (dir && !(await vault.any(dir))) await vault.makeFolder(dir);
    const known = index.content(rel);
    const r = await vault.writeChecked(rel, text, base !== undefined ? base : known === undefined ? null : core.textVersion(known));
    if (!r.ok) throw new Error(r.missing ? 'That note is no longer there.' : 'That note changed just now somewhere else, so this change didn’t land. Try it again.');
    await rescan(rel);
    return r;
  }
  async function movePath(from, to, updateLinks) {
    void updateLinks;
    if (!(await vault.any(from))) throw new Error('That is no longer there.');
    if (from === to) return { path: from, linksUpdated: 0, notesUpdated: 0 };
    await vault.move(from, to);
    await rescanAll();
    return { path: to, linksUpdated: 0, notesUpdated: 0 };
  }
  // A project's change by hand (app.ts editProject, same shared calls, same words).
  const history = new Map();
  async function editProject(rel, edit, version) {
    const file = String(rel ?? '');
    const before = index.content(file);
    if (before === undefined) throw new Error('That project isn’t there any more.');
    if (typeof version === 'string' && version && version !== core.textVersion(before))
      throw new Error('The project changed just now (the assistant, or the note itself). The page shows it as it is now: make the change again.');
    const p = core.parseProject(before, file);
    const edits = (Array.isArray(edit) ? edit : [edit]);
    const done = edits.map((e) => core.applyProjectEdit(p, e, core.formatDate('D MMM YYYY')));
    const words = done.length === 1 ? done[0] : `Made ${done.length} changes.`;
    p.updated = core.formatDate('YYYY-MM-DD');
    const after = core.serializeProject(p, before);
    await writeNote(file, after);
    const list = history.get(file) ?? [];
    list.push({ before, after: index.content(file) ?? after, words });
    history.set(file, list.slice(-100));
    return { view: projects.view(file), words, moves: [] };
  }
  async function projectStep(file, redo) {
    const list = history.get(file) ?? [];
    const step = redo ? undefined : list[list.length - 1];
    if (!step) throw new Error(redo ? 'There’s nothing to redo.' : 'There’s nothing to undo here.');
    const current = index.content(file);
    if (current !== step.after) throw new Error('The project was changed as a note since, so that can’t be undone here. Its earlier versions are in File recovery.');
    await writeNote(file, step.before);
    if (!redo) list.pop();
    return { view: projects.view(file), words: step.words, moves: [] };
  }

  // Life (inbox, people, areas): the real registerLife with a small host.
  const lifeHandlers = new Map();
  core.registerLife({
    handle: (channel, fn) => lifeHandlers.set(channel, fn),
    vault: () => vault,
    index,
    prefs: () => ({ templatesFolder: settings.prefs.templatesFolder || 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments' }),
    dailyFolder: () => settings.dailyFolder || 'Daily',
    records: () => records(),
    movePath: (from, to, updateLinks) => movePath(from, to, updateLinks),
    indexFile: async (v, rel) => (await rescan(rel), rel),
    refreshFiles: async () => {},
    changed: () => {},
    filesChanged: () => {},
    requireCreate: async () => {},
    editProject: (rel, edit, version) => editProject(rel, edit, version),
  });

  const briefHandlers = new Map();
  const brief = core.registerBrief({
    handle: (channel, fn) => briefHandlers.set(channel, fn),
    due: () => hub.due(),
    today: () => core.todayData(index, undefined),
    calendar: async () => ({ today: [], tomorrow: [] }),
    decks: () => [],
    meetingNotes: () => ({}),
    load: async () => state.get('brief') ?? null,
    save: async (v) => void state.set('brief', v),
  });

  const handlers = new Map(lifeHandlers);
  for (const [k, v] of briefHandlers) handlers.set(k, v);
  const on = (channel, fn) => handlers.set(channel, fn);
  // Vault, files, notes.
  on('vault:current', () => ({ path: vaultDir, name: path.basename(vaultDir), library: true }));
  on('vault:list', () => index.allMeta());
  on('vault:list-slim', () => index.slimMeta());
  on('vault:library', () => ({ path: vaultDir, name: path.basename(vaultDir), library: true }));
  on('vault:pick', () => null);
  on('vault:reveal', () => undefined);
  on('vault:open', () => ({ path: vaultDir, name: path.basename(vaultDir), library: true }));
  // Names Windows cannot keep (Nov 2026 break audit): the real check, ask, repair and Undo over the test vault.
  // The harness move renames and re-indexes without the app's link following (node tests prove that part); the bell
  // carries the real ask when a plan waits and is empty otherwise, as before.
  const vaultFiles = new core.VaultFiles({
    root: () => vaultDir,
    listAll: async () => (await vault.listAll()).files.map((f) => ({ rel: f.rel, mtime: f.mtime, size: f.size })),
    notes: () => index.allMeta().map((m) => ({ path: m.path, props: m.props })),
    resolve: (t, from) => index.resolve(t, from) ?? index.resolveFile(t, from),
    readNote: (rel) => vault.read(rel),
    writeNote: async (rel, text) => {
      await vault.write(rel, text);
      await rescan(rel);
    },
    movePath: async (from, to) => {
      await vault.move(from, to);
      await rescanAll();
      return { path: to, linksUpdated: 0 };
    },
    added: async () => {},
    dataDir,
    prefs: () => ({ attachmentsFolder: 'Attachments', templatesFolder: settings.prefs.templatesFolder, dailyFolder: 'Daily', filesWithRecord: true }),
    areaOf: () => undefined,
    areaFilesFolders: () => [],
  });
  const namesLook = () => vaultFiles.check({ repair: false, templatesFolder: settings.prefs.templatesFolder });
  on('names-preview', async () => {
    const look = await namesLook();
    const decision = await core.namesDecision(vaultDir, look.renames, look.nameLeft).catch(() => null);
    const pairs = decision === 'approved' ? await core.namesPending(vaultDir, look.renames, look.nameLeft).catch(() => []) : decision === 'declined' ? [] : look.renames;
    return { pairs, notes: look.nameLeft, decided: decision };
  });
  on('names-repair', async () => {
    const look = await namesLook();
    await core.namesDecide(vaultDir, look.renames, look.nameLeft, 'approved');
    const pending = await core.namesPending(vaultDir, look.renames, look.nameLeft).catch(() => []);
    const r = await vaultFiles.check({ repair: true, names: true, plan: pending, receipt: true, templatesFolder: settings.prefs.templatesFolder });
    await rescanAll();
    const rest = await core.namesPending(vaultDir, look.renames, look.nameLeft).catch(() => []);
    const applied = pending.filter(([a, b]) => !rest.some(([x, y]) => x === a && y === b));
    const failed = r.nameLeft.filter((l) => /couldn’t be renamed/.test(l));
    if (!applied.length && !failed.length) return 'Nothing to repair.';
    if (!applied.length) return failed.join(' ');
    const told = core.namesTold(applied, failed);
    return `${told.title}.${failed.length ? ` ${failed.length} couldn’t.` : ''}`;
  });
  on('names-leave', async () => {
    const look = await namesLook();
    await core.namesDecide(vaultDir, look.renames, look.nameLeft, 'declined');
    return 'Left as they are. They will be asked about again only if new names need it.';
  });
  on('names-undo', async () => {
    const pairs = await core.namesUndoPairs(vaultDir);
    if (!pairs.length) return 'Nothing to put back.';
    const folders = [];
    const files = [];
    for (const [from, to] of pairs) (await vault.isFolder(to).catch(() => false) ? folders : files).push([from, to]);
    let back = 0;
    const stuck = [];
    for (const [from, to] of [...folders, ...files]) {
      if (!(await vault.any(to))) continue;
      try {
        await vault.move(to, from);
        back++;
      } catch (e) {
        stuck.push(`${to}: ${(e?.message ?? String(e)).replace(/\.\s*$/, '')}.`);
      }
    }
    await rescanAll();
    if (back && !stuck.length) await core.namesUndoneLatest(vaultDir);
    if (!back && !stuck.length) return 'Everything is already back.';
    if (!back) return stuck.join(' ');
    return `${back === 1 ? 'Put 1 name back' : `Put ${back} names back`}.${stuck.length ? ` ${stuck.join(' ')}` : ''}`;
  });
  on('files:list', () => vault.listAll());
  on('file:resolve', (target, from) => index.resolveAny(String(target ?? ''), typeof from === 'string' ? from : undefined));
  on('file:read-text', (rel) => vault.readText(rel));
  on('file:open-text', (rel) => vault.readTextForEdit(rel));
  on('file:write-text', (rel, content, base) => vault.writeTextChecked(String(rel), String(content ?? ''), typeof base === 'string' ? base : null).then(async (r) => (await rescan(String(rel)), r)));
  on('file:create', async (folder, base, ext, content) => {
    const dir = String(folder ?? '');
    for (let n = 1; n < 500; n++) {
      const rel = `${dir ? `${dir}/` : ''}${base}${n > 1 ? ` ${n}` : ''}${ext}`;
      if (!(await vault.any(rel))) {
        if (dir && !(await vault.any(dir))) await vault.makeFolder(dir);
        await vault.createText(rel, String(content ?? ''));
        await rescan(rel);
        return rel;
      }
    }
    throw new Error('There is no free name for it there.');
  });
  on('folder:create', async (parent, name) => {
    const rel = `${parent ? `${parent}/` : ''}${name}`;
    await vault.makeFolder(rel);
    return rel;
  });
  on('path:move', (from, to, updateLinks) => movePath(String(from), String(to), updateLinks === true));
  on('path:links-into', (rel) => {
    const p = String(rel);
    let links = 0;
    const notes = new Set();
    for (const m of index.allMeta()) {
      for (const l of m.links) if (index.resolveAny(l.target, m.path) === p) { links++; notes.add(m.path); }
    }
    return { links, notes: notes.size };
  });
  on('path:trash', async (rel) => binTrash(rel));
  on('path:duplicate', async (rel) => {
    const src = String(rel);
    const abs = path.join(vaultDir, ...src.split('/'));
    const folder = existsSync(abs) && statSync(abs).isDirectory();
    // Folders copy whole, as the app's own duplicate does (t18, 8 Nov 2026: the harness read every
    // duplicate as text, so copying a folder toasted about what "can be edited" and copied nothing).
    const dot = !folder && src.lastIndexOf('.') > 0 ? src.lastIndexOf('.') : -1;
    const stem = dot > 0 ? src.slice(0, dot) : src;
    const ext = dot > 0 ? src.slice(dot) : '';
    for (let n = 2; n < 500; n++) {
      const dest = `${stem} ${n}${ext}`;
      if (!(await vault.any(dest))) {
        if (folder) {
          cpSync(abs, path.join(vaultDir, ...dest.split('/')), { recursive: true, errorOnExist: true });
          await rescanAll();
        } else {
          await vault.createText(dest, await vault.readText(src));
          await rescan(dest);
        }
        return dest;
      }
    }
    throw new Error('There is no free name for it there.');
  });
  on('path:reveal', () => undefined);
  on('path:open-default', () => undefined);
  on('note:read', (rel) => vault.read(rel));
  on('note:open', (rel) => vault.readForEdit(rel));
  on('note:write', (rel, content, by, base) => writeNote(String(rel), String(content ?? ''), typeof base === 'string' ? base : undefined).then((r) => r));
  on('note:create', async (rel, content) => {
    if (rel) {
      const dir = String(rel).includes('/') ? String(rel).slice(0, String(rel).lastIndexOf('/')) : '';
      if (dir && !(await vault.any(dir))) await vault.makeFolder(dir);
      await vault.create(String(rel), String(content ?? ''));
      await rescan(String(rel));
      return String(rel);
    }
    for (let n = 1; n < 500; n++) {
      const dest = n === 1 ? 'Untitled.md' : `Untitled ${n}.md`;
      if (!(await vault.any(dest))) {
        await vault.create(dest, String(content ?? ''));
        await rescan(dest);
        return dest;
      }
    }
    throw new Error('There is no free name for it there.');
  });
  on('note:resolve', (target, from) => index.resolveAny(String(target ?? ''), typeof from === 'string' ? from : undefined));
  // Settings, licence, state.
  on('settings:get', () => settings);
  on('settings:update', (patch) => {
    const p = patch && typeof patch === 'object' ? patch : {};
    if (p.prefs) settings.prefs = { ...settings.prefs, ...p.prefs };
    for (const k of ['model', 'dailyFolder', 'dailyFormat', 'dailyTemplate', 'library']) if (p[k] !== undefined) settings[k] = p[k];
    return settings;
  });
  on('licence:status', () => ({ enforcing: false, canCreate: true, reason: 'active', words: '', account: null, accountName: null, activated: true, canActivate: false }));
  on('licence:activate', () => undefined);
  on('licence:deactivate', () => undefined);
  on('licence:manage', () => undefined);
  on('state:load', (key) => state.get(String(key)) ?? null);
  on('state:save', (key, value) => void state.set(String(key), value));
  // Project workspaces and views of records: the real workspaces module over the test vault (t260: the harness
  // served none of these, so every records view read "Something didn't work just then" — the stub resolves
  // unhandled channels as undefined and loadRecordsView's list.find threw on it — and project workspace saves
  // silently vanished. Kept in the vault, exactly as the app's handlers keep them).
  on('workspace:load', (project) => core.loadWorkspace(vaultDir, project));
  on('workspace:save', (project, text) => core.saveWorkspace(vaultDir, project, text));
  on('views:list', () => core.listViews(vaultDir));
  on('views:save', (name, text) => core.saveView(vaultDir, name, text));
  on('views:remove', (name) => core.removeView(vaultDir, name));
  // Records (the real model, rebuilt from the index on every call, as the app's cache does after changes).
  const recordRef = (v) => {
    const o = (v && typeof v === 'object' ? v : {});
    const s = (k, max = 1000) => (typeof o[k] === 'string' ? o[k].slice(0, max) : undefined);
    return { id: s('id'), type: core.RECORD_TYPES.includes(o.type) ? o.type : undefined, path: s('path'), title: s('title'), name: s('name', 200), folderFile: s('folderFile'), line: typeof o.line === 'number' && Number.isFinite(o.line) ? o.line : undefined };
  };
  on('records:peek', (ref) => core.peekWithFolderFiles(records(), recordRef(ref), (p) => index.allMeta().find((m) => m.path === p)?.props?.folder));
  on('records:find', (words, types) => (typeof words === 'string' ? core.findRecords(records(), words.slice(0, 200), Array.isArray(types) ? types : undefined, 20) : []));
  on('records:person', (who, project) => (typeof who === 'string' ? core.personOpenItems(records(), who.slice(0, 200), typeof project === 'string' ? { project } : {}) : null));
  on('records:meeting', (which) => (typeof which === 'string' ? core.meetingItems(records(), which.slice(0, 1000)) : null));
  on('records:attention', (project) => (typeof project === 'string' ? core.projectAttention(records(), project) : null));
  // Index queries: the real VaultIndex.
  on('index:backlinks', (rel) => index.backlinks(String(rel)));
  on('index:unlinked', (rel) => index.unlinkedMentions(String(rel)));
  on('index:mentions', (rel, content) => index.mentionsIn(String(rel), typeof content === 'string' ? content : ''));
  // The main app's linkMention (src/main/app.ts), single-attempt: the harness runs one thing at a time.
  on('index:link-mention', async (source, line, target) => {
    if (typeof source !== 'string' || typeof line !== 'number' || typeof target !== 'string') return false;
    const meta = index.get(target);
    if (!meta) return false;
    const content = await vault.read(source).catch(() => null);
    if (typeof content !== 'string') return false;
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const text = lines[line];
    if (text === undefined) return false;
    for (const name of [meta.title, ...meta.aliases]) {
      const col = core.findUnlinkedPhrase(text, name);
      if (col < 0) continue;
      const bare = target.replace(/\.md$/i, '');
      const short = bare.split('/').pop() ?? bare;
      const dest = index.resolve(short, source) === target ? short : bare;
      const found = text.slice(col, col + name.length);
      lines[line] = text.slice(0, col) + `[[${dest}${found === meta.title ? '' : `|${found}`}]]` + text.slice(col + name.length);
      const r = await vault.writeChecked(source, lines.join(eol), core.textVersion(content));
      if (!r.ok) return false;
      await rescan(source);
      return true;
    }
    return false;
  });
  on('index:outgoing', (rel) => index.outgoing(String(rel)));
  on('index:tags', () => index.tags());
  on('index:related', (rel) => index.related(String(rel)));
  on('index:related-notes', (rel) => {
    const templates = (settings.prefs.templatesFolder || '').toLowerCase().replace(/\/+$/, '');
    return index.relatedNotes(String(rel), 12, (p) => !!templates && p.toLowerCase().startsWith(`${templates}/`));
  });
  on('index:graph', () => index.graph(settings.prefs.templatesFolder ?? ''));
  on('index:graph-since', (since) => index.graphSince(typeof since === 'number' ? since : -1, settings.prefs.templatesFolder ?? ''));
  on('index:query', (query) => (typeof query === 'string' ? index.query(query.slice(0, 1000)) : []));
  on('index:search', (query) => (typeof query === 'string' ? index.searchAsync(query.slice(0, 1000)) : []));
  // Projects.
  on('projects:list', () => projects.list());
  on('projects:all', () => projects.all());
  // Offered folders, never silent (5 Nov 2026, u3 moving-in: same checks and words as app.ts).
  on('projects:folder-offers', () => projects.folderOffers());
  on('project:from-folder', async (folder) => {
    const dir = String(folder ?? '');
    const offer = projects.folderOffers().find((o) => o.folder === dir);
    if (!offer) throw new Error('That folder isn’t offered as a project any more.');
    const file = `${dir}/${offer.name}.md`;
    if (await vault.any(file)) throw new Error('A project with that name is already there.');
    await writeNote(file, core.claimFolderText(offer.name));
    return file;
  });
  on('project:unclaim', async (rel) => {
    const file = String(rel ?? '');
    const before = index.content(file);
    if (before === undefined) throw new Error('That project isn’t there any more.');
    const after = core.unclaimProjectText(before);
    if (after === null) throw new Error('That note isn’t a project file.');
    await writeNote(file, after);
    return file;
  });
  // A damaged board's bytes, kept before starting over (5 Nov 2026, u3 moving-in: the harness stands in for
  // File recovery with a map; the app keeps a forced recovery version).
  const damagedKept = new Map();
  on('canvas:keep-damaged', async (rel) => {
    const file = String(rel ?? '');
    if (!(await vault.any(file))) throw new Error('That board isn’t there any more.');
    damagedKept.set(file, await vault.readText(file));
    return true;
  });
  // Project checks are stubbed empty by default (most rooms have no use for them); a suite that needs the
  // real waiting counts (Today's "Projects waiting from your notes") opts in with { realChecks: true }.
  const projectChecks = opts.realChecks && typeof core.createProjectChecks === 'function' ? core.createProjectChecks(projects, index) : null;
  on('projects:checks', () => (projectChecks ? projectChecks.checks() : []));
  on('project:view', (rel) => projects.view(String(rel)));
  // A project's folder, listed for real when asked (t260: the default stub answers null — "no folder on
  // this PC" — and project-folio pins the hiding that follows, so the real listing is opt-in like realChecks;
  // suites that stage their own listing keep passing projectFiles).
  on('project:files', (rel) => {
    if (opts.projectFiles !== undefined) return opts.projectFiles;
    if (!opts.realProjectFiles) return null;
    const file = String(rel ?? '');
    const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    return core.folderFiles(path.join(vaultDir, ...folder.split('/').filter(Boolean)));
  });
  // Opened things, recorded (t141, 9 Nov 2026: a file opens in one click, a chat continues in one — the calls
  // prove it, since the outside app they reach for isn't here). Read from services.opened.
  const opened = [];
  on('project:open-file', (p, f) => void opened.push({ what: 'file', path: String(p ?? ''), file: String(f ?? '') }));
  on('project:show-file', (p, f) => void opened.push({ what: 'shown', path: String(p ?? ''), file: String(f ?? '') }));
  on('project:open-folder', (p) => void opened.push({ what: 'folder', path: String(p ?? '') }));
  on('project:open-conversation', (id) => void opened.push({ what: 'conversation', id: String(id ?? '') }));
  on('project:edit', (rel, edit, version) => editProject(rel, edit, typeof version === 'string' ? version : ''));
  on('project:undo', (rel) => projectStep(String(rel), false));
  on('project:redo', (rel) => projectStep(String(rel), true));
  on('project:changes', () => []);
  on('project:tidy-preview', (rel) => {
    const file = String(rel);
    const before = index.content(file);
    if (before === undefined) throw new Error('That project isn’t there any more.');
    const plan = core.planTidy(before, new Date());
    return { path: file, name: core.parseProject(before, file).name, version: core.textVersion(before), moves: plan.moves, said: plan.said, historyPath: '' };
  });
  on('projects:tidy-preview', () =>
    projects.all().map((x) => {
      const before = index.content(x.path) ?? '';
      const plan = core.planTidy(before, new Date());
      return { path: x.path, name: core.parseProject(before, x.path).name, version: core.textVersion(before), moves: plan.moves, said: plan.said, historyPath: '' };
    }).filter((x) => x.moves.length > 0),
  );
  on('project:tidy-undo', () => ({ ok: false, words: 'Nothing to undo.' }));
  // Today, hub, tasks.
  const dailyPath = () => {
    const d = new Date();
    return `Daily/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.md`;
  };
  on('today:data', () => {
    const p = dailyPath();
    return core.todayData(index, { path: p, exists: index.has(p) });
  });
  on('today:files', (since) => core.changedFiles(index, typeof since === 'number' && Number.isFinite(since) ? since : Date.now() - 2 * 86400000));
  // The day's note, made when missing (as the app's openDailyNote: the core channel openDaily() trusts for a path).
  on('daily:open', async (iso) => {
    const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim()) : null;
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
    const day = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
    const folder = settings.dailyFolder || 'Daily';
    const rel = `${folder}/${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}.md`;
    if (!(await vault.any(rel))) {
      if (!(await vault.any(folder))) await vault.makeFolder(folder);
      await vault.create(rel, '');
      await rescan(rel);
    }
    return rel;
  });
  // Where the days live when they don't live in the day-notes folder (5 Nov 2026, u3 moving-in: same call as app.ts).
  on('daily:folder-hint', () => core.dailyFolderHint(core.dayShapedByFolder([...index.allMeta()].map((m) => m.path)), settings.dailyFolder || 'Daily'));
  on('hub:day', (iso) => hub.day(String(iso ?? '')));
  on('hub:marks', (from, to) => hub.marks(String(from ?? ''), String(to ?? '')));
  on('hub:due', () => hub.due());
  on('hub:due-on', (iso) => hub.dueOn(String(iso ?? '')));
  on('hub:tick', async (rel, line, text, done) => hub.tick(String(rel), Number(line), String(text ?? ''), done !== false));
  on('hub:start', (iso) => hub.start(String(iso ?? '')));
  // A whole PDF in the notes, for the reader (the app's pdf:bytes handler, same rules): its bytes go to
  // the window base64-tagged (results ride JSON, as t243's arguments do), decoded by the stub below.
  on('pdf:bytes', async (rel) => {
    const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!/\.pdf$/i.test(clean) || clean.includes('..')) throw new Error('Only PDFs open here.');
    const abs = path.join(vaultDir, ...clean.split('/'));
    const st = statSync(abs);
    if (!st.isFile() || st.size > 512 * 1024 * 1024) throw new Error('Only PDFs open here.');
    return new Uint8Array(readFileSync(abs));
  });
  on('tasks:view', () => tasks.view());
  on('tasks:tick', (rel, line, text, done) => tasks.tick(String(rel), Number(line), String(text ?? ''), done !== false));
  // A task's words changed where shown (p17-editable, Nov 2026): the real edit, like the app's handler — the words,
  // who and record-action saves all go through it, and without it they resolved to nothing.
  on('tasks:edit', (rel, line, text, rest) => tasks.edit(String(rel), Number(line), String(text ?? ''), String(rest ?? '')));
  on('tasks:due', (rel, line, text, iso, time) => tasks.setDue(String(rel), Number(line), String(text ?? ''), typeof iso === 'string' && iso ? iso : null, typeof time === 'string' && time ? time : null));
  on('tasks:remind', (rel, line, text) => tasks.remind(String(rel), Number(line), String(text ?? '')));
  // Shared spaces, tidy, brief.
  on('shared-spaces:list', () => spaces.list());
  on('shared-spaces:home', (folder) => spaces.home(String(folder ?? '')));
  on('tidy:status', () => tidy.status());
  // The tidy tab's own calls (Nov 2026, b6 break job: screenshots judge the tab with its proposal).
  on('tidy:get', () => tidy.get());
  on('tidy:needs', () => tidy.needs());
  on('tidy:prepare', () => tidy.prepare(true));
  on('tidy:apply', (id) => tidy.apply(String(id)));
  on('tidy:skip', (id) => tidy.skip(String(id)));
  on('tidy:apply-all', () => tidy.applyAll());
  on('tidy:undo', (id) => tidy.undo(String(id)));
  on('brief:get', () => brief.brief());
  // Templates and types (the real listTemplates over the test vault, as the app's
  // handler does: the Templates page reads .text/.group/.kind off each row).
  on('templates:list', () => {
    const folder = settings.prefs.templatesFolder || 'Templates';
    const notes = index.allMeta().filter((m) => m.path.startsWith(`${folder}/`)).map((m) => ({ path: m.path, mtime: m.mtime, text: index.content(m.path) ?? '' }));
    return { folder, templates: core.listTemplates(notes, folder, null), groups: core.GROUPS, daily: null };
  });
  on('templates:missing', () => []);
  on('templates:restore', () => 0);
  // Making from templates (t18, 8 Nov 2026: the page's Use toasted a raw `Cannot destructure property
  // 'path'…` and made nothing — no handler, and the stub resolves unhandled channels as undefined).
  // The app's own steps (src/main/app.ts makeFromTemplate/saveAsTemplate/newTemplate): the same shared
  // calls, the same words, over the test vault.
  const cleanRel = (raw) => {
    if (typeof raw !== 'string') throw new Error('Invalid name.');
    const p = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/').trim();
    if (!p) throw new Error('A name is needed.');
    if (/[<>:\"|?*\u0000-\u001f]/.test(p)) throw new Error('Names cannot contain < > : " | ? * characters.');
    if (p.split('/').some((part) => !part.trim() || part === '.' || part === '..' || /[. ]$/.test(part))) throw new Error('A name can’t be empty or end with a dot or a space.');
    if (p.split('/').some((part) => core.isReservedName(part.indexOf('.') < 0 ? part : part.slice(0, part.indexOf('.'))))) throw new Error('Windows keeps names like CON, PRN and NUL for itself. Choose another name.');
    return p;
  };
  const cleanNotePath = (raw) => {
    const p = cleanRel(raw);
    return p.toLowerCase().endsWith('.md') ? p : `${p}.md`;
  };
  const uniqueRel = async (folder, base, ext) => {
    for (let i = 0; i < 10000; i++) {
      const rel = folder ? `${folder}/${i === 0 ? base : `${base} ${i}`}${ext}` : `${i === 0 ? base : `${base} ${i}`}${ext}`;
      if (!(await vault.any(rel))) return rel;
    }
    throw new Error('No free name was found.');
  };
  const cleanFileName = (raw, fallback) => core.sharedCleanFileName(typeof raw === 'string' ? raw.split(/[\\/]/).pop() : '', fallback, 180);
  async function makeFromTemplate(template, name, folder, project, answers) {
    const rel = cleanNotePath(template);
    const root = settings.prefs.templatesFolder || 'Templates';
    if (root && !rel.startsWith(`${root}/`)) throw new Error('That note isn’t one of your templates.');
    const text = await vault.read(rel);
    if (core.templateKind(text) !== 'note') throw new Error('That template isn’t one for a note.');
    const dir = typeof folder === 'string' && folder ? cleanRel(folder) : '';
    const base = cleanFileName(name, 'Untitled');
    const made_rel = await uniqueRel(dir, base, '.md');
    const projectName = typeof project === 'string' && project && core.isProjectProps(index.allMeta().find((m) => m.path === project)?.props) ? projects.view(project).project.name : undefined;
    if (dir && !(await vault.any(dir))) await vault.makeFolder(dir);
    const made = core.takeCursor(core.noteFromTemplate(text, { title: made_rel.split('/').pop().replace(/\.md$/i, ''), dateFormat: settings.prefs.dateFormat, timeFormat: settings.prefs.timeFormat, project: projectName, answers: { ...core.cleanAnswers(answers), cursor: true } }));
    await vault.create(made_rel, made.text);
    await rescan(made_rel);
    return { path: made_rel, cursor: made.cursor ? { line: made.cursor.line, ch: made.cursor.ch } : null };
  }
  on('templates:make', (template, name, folder, project, answers) => makeFromTemplate(template, name, folder, project, answers));
  on('templates:use', (template, name, folder, project) => makeFromTemplate(template, name, folder, project, null).then((r) => r.path));
  on('templates:ai', async (template, info) => {
    const rel = cleanNotePath(template);
    const asks = core.templateFields(await vault.read(rel)).ai;
    if (!asks.length) return { fields: {} };
    return { fields: {}, error: 'No model is set up, so the fields were left empty.' };
  });
  on('templates:save-as', async (note, name, description) => {
    const root = settings.prefs.templatesFolder || 'Templates';
    if (!root) throw new Error('Choose a templates folder first (Settings › General).');
    const source = cleanNotePath(note);
    const text = await vault.read(source);
    const props = index.allMeta().find((m) => m.path === source)?.props;
    const isProject = core.isProjectProps(props);
    const isDoc = !isProject && core.isDocNote(source, props ?? {});
    const rel = await uniqueRel(`${root}/${isProject ? 'Projects' : isDoc ? 'Docs' : 'Notes'}`, cleanFileName(name, 'New template'), '.md');
    await vault.create(rel, core.templateFromNote(text, { isProject, isDoc, description: typeof description === 'string' ? description : undefined }));
    await rescan(rel);
    return rel;
  });
  on('templates:create', async (group, name) => {
    const root = settings.prefs.templatesFolder || 'Templates';
    if (!root) throw new Error('Choose a templates folder first (Settings › General).');
    const g = group === 'projects' || group === 'reports' || group === 'docs' ? group : 'notes';
    const dir = `${root}/${core.GROUPS.find((x) => x.id === g).folder}`;
    const rel = await uniqueRel(dir, cleanFileName(name, 'New template'), '.md');
    if (!(await vault.any(dir))) await vault.makeFolder(dir);
    await vault.create(rel, core.starterTemplate(g));
    await rescan(rel);
    return rel;
  });
  // A new doc (t191: the sweep's "Make the doc" made nothing — no handler, and the stub resolves unhandled
  // channels as undefined, so the window opened a tab for undefined and broke. The app's own steps
  // (src/main/app.ts docs:create, Docs.create in src/main/docs.ts): the same shared calls, the same words,
  // over the test vault).
  on('docs:create', async (name, template) => {
    let text;
    if (typeof template === 'string' && template) {
      const rel = cleanNotePath(template);
      const root = settings.prefs.templatesFolder || 'Templates';
      if (root && !rel.startsWith(`${root}/`)) throw new Error('That note isn’t one of your templates.');
      const heading = typeof name === 'string' && name.trim() ? name.trim() : 'Untitled doc';
      text = core.noteFromTemplate(await vault.read(rel), { title: heading, dateFormat: settings.prefs.dateFormat, timeFormat: settings.prefs.timeFormat }).replace(/^type:\s*["']?doc-template["']?\s*$/m, 'type: doc');
    }
    const title = core.safeDocName(typeof name === 'string' ? name : 'Untitled doc');
    const wanted = core.docPath(title, core.DOCS_FOLDER);
    let target = wanted;
    if (await vault.any(target)) {
      const dot = target.lastIndexOf('.');
      for (let i = 2; i < 1000; i++) {
        const next = `${target.slice(0, dot)} ${i}${target.slice(dot)}`;
        if (!(await vault.any(next))) { target = next; break; }
      }
      if (target === wanted) throw new Error('No free name was found.');
    }
    let body = text?.trim() ? text : core.newDocText({ name: title, summary: 'What this is, in a few sentences: what it is for, who uses it and where it runs.', today: core.formatDate('D MMM YYYY') });
    if (!core.isDocText(body)) body = core.setDocProp(body, 'type', 'doc');
    await writeNote(target, body);
    return target;
  });
  // The asset store: the real one over the test vault (empty for the standard vault, as the stub was; the brand
  // kits page reads its kits through it).
  const store = new core.AssetStore({
    root: () => vaultDir,
    listAll: () => vault.listAll(),
    absolute: (rel) => {
      const abs = path.resolve(vaultDir, rel);
      if (abs !== vaultDir && !abs.startsWith(`${vaultDir}${path.sep}`)) throw new Error('That file is outside the library.');
      return abs;
    },
    notes: () => index.allMeta(),
    resolve: (target, from) => index.resolveAny(target, from),
    folders: () => ({ assets: 'Assets', attachments: 'Attachments' }),
    cacheDir: path.join(dataDir, 'asset-thumbnails'),
    added: async () => { await rescanAll(); },
    today: () => new Date().toISOString().slice(0, 10),
  });
  on('assets:list', () => store.list());
  on('assets:details', (rel) => store.details(rel));
  on('assets:update', (rel, patch) => store.update(rel, patch));
  on('assets:brand', (brand) => store.setBrand(brand));
  on('assets:brands', (action) => store.brands(action));
  on('assets:collections', (action) => store.collections(action));
  on('types:load', () => '');
  on('types:save', () => undefined);
  // Suggestions, recovery, capture, models, calendar, plugins, misc: valid empties.
  on('suggestions:list', () => []);
  on('suggestions:settle', () => undefined);
  on('recovery:versions', () => []);
  on('recovery:list', () => []);
  on('recovery:read', () => '');
  on('capture:show', () => undefined);
  on('capture:status', () => ({ available: false }));
  const captureUndos = new Map();
  let captureN = 0;
  on('capture:save', async (request) => {
    const req = request && typeof request === 'object' ? request : {};
    const text = String(req.text ?? '').trim();
    if (!text) throw new Error(req.kind === 'task' ? 'Write the task first.' : 'Write something, or add a screenshot or a file.');
    const plan = core.planCapture({ kind: req.kind === 'task' ? 'task' : 'note', text, project: null, pictures: 0, files: 0, toAssets: false, noProject: settings.prefs.captureNoProject ?? 'inbox', dailyPath: dailyPath(), inboxPath: 'Inbox.md', attachmentsFor: () => 'Attachments', now: new Date(), ignoreDue: req.ignoreDue === true });
    const snapshots = new Map();
    const snap = async (p) => {
      if (!snapshots.has(p)) snapshots.set(p, (await vault.any(p)) ? await vault.read(p) : null);
    };
    if (plan.append) {
      await snap(plan.append.path);
      const prev = snapshots.get(plan.append.path) ?? '';
      const line = req.kind === 'task' ? `- [ ] ${plan.what}${plan.due ? ` — due ${plan.due.iso}` : ''}${plan.rest ? `\n${plan.rest}` : ''}` : plan.what;
      const head = '## Captured';
      const next = prev.includes(head) ? `${prev.replace(/\s+$/, '')}\n${line}\n` : `${prev.replace(/\s+$/, '')}\n\n${head}\n\n${line}\n`;
      await writeNote(plan.append.path, next);
    }
    if (plan.newNote) {
      const rel = `${plan.newNote.folder}/${plan.newNote.title}.md`;
      await snap(rel);
      await writeNote(rel, `# ${plan.newNote.title}\n\n${plan.what}\n`);
    }
    const id = `cap${++captureN}`;
    captureUndos.set(id, [...snapshots.entries()]);
    const open = plan.append ? plan.append.path : plan.newNote ? `${plan.newNote.folder}/${plan.newNote.title}.md` : null;
    return { words: req.kind === 'task' ? 'Filed in the Inbox.' : 'Saved.', detail: plan.what.slice(0, 120), open, undo: id };
  });
  on('capture:undo', async (id) => {
    const snaps = captureUndos.get(String(id));
    if (!snaps) throw new Error('There’s nothing to undo here.');
    for (const [p, before] of snaps) {
      if (before === null) {
        await binTrash(p);
      } else {
        await writeNote(p, before);
      }
    }
    await rescanAll();
    captureUndos.delete(String(id));
    return 'Undone.';
  });
  on('models:view', () => ({ connections: [], transcription: null, choice: null, effective: null }));
  on('models:set-key', () => ({ connections: [], transcription: null, choice: null, effective: null }));
  on('models:test', () => ({ ok: false, words: 'No model is set up in the harness.' }));
  on('calendar:list', () => ({ connected: false, reason: 'not-set-up' }));
  on('calendar:today', () => ({ connected: false, reason: 'not-set-up' }));
  on('notebook:due', () => []);
  on('change-sets:list', () => []);
  on('home:status', () => ({ home: vaultDir, homePlace: { kind: 'local' }, current: { path: vaultDir, id: null, name: path.basename(vaultDir) }, vaults: [], pcs: null, warning: null, oldFolders: [] }));
  on('place:status', () => ({ library: vaultDir, folder: vaultDir, isLibrary: true, place: { kind: 'local' }, targets: [], onlyHereCard: false, elsewhereCard: false, lostCard: false, adoptable: false }));
  on('sync:status', () => null);
  // Settings › Backups and sync (p14, 4 Nov 2026): a stand-in backend of the real BackupView shape (src/shared/backup.ts,
  // src/main/backup.ts) — the real prefs validation, but no git and no sync folder: runs refuse honestly, as the
  // printer stand-in does. Seeded with a sync folder set up, so both halves sweep (the Git half reveals itself when
  // switched on; "Stop using it" reveals the folder picker and passphrase rows).
  const backupPrefs = core.cleanBackupPrefs({ git: { ...core.DEFAULT_BACKUP.git }, sync: { ...core.DEFAULT_BACKUP.sync, on: true, folder: path.join(dataDir, 'sync-copy') } });
  const backupGit = { lastOk: 0, lastPush: 0, words: '', error: '', busy: false, commits: 0, tokenSaved: false };
  const backupSync = { lastOk: 0, words: '', error: '', busy: false, files: 14, conflicts: 0, passphraseSaved: true, existing: true };
  const backupView = () => ({
    git: { prefs: backupPrefs.git, git: 'system', tokenSaved: backupGit.tokenSaved, hostSignIn: false, lastOk: backupGit.lastOk, lastPush: backupGit.lastPush, words: backupGit.words, error: backupGit.error, busy: backupGit.busy, commits: backupGit.commits },
    sync: { prefs: backupPrefs.sync, passphraseSaved: backupSync.passphraseSaved, existing: backupSync.existing, lastOk: backupSync.lastOk, words: backupSync.words, error: backupSync.error, busy: backupSync.busy, files: backupSync.files, conflicts: backupSync.conflicts },
  });
  on('backup:view', () => backupView());
  on('backup:git', (patch) => {
    const p = (patch && typeof patch === 'object' ? patch : {});
    const next = core.cleanBackupPrefs({ ...backupPrefs, git: { ...backupPrefs.git, ...p } });
    if (typeof p.branch === 'string' && p.branch.trim() && core.branchProblem(p.branch.trim())) throw new Error(core.branchProblem(p.branch.trim()));
    if (typeof p.remote === 'string' && p.remote.trim()) {
      const kind = core.remoteKind(p.remote, path.isAbsolute);
      if ('problem' in kind) throw new Error(kind.problem);
    }
    backupPrefs.git = next.git;
    return backupView();
  });
  on('backup:git-token', (token, user) => {
    const t = typeof token === 'string' ? token.trim() : '';
    if (t && (t.length > 4096 || /[\s\u0000-\u001f]/.test(t))) throw new Error('That doesn’t look like a token. Paste the whole token, with nothing around it.');
    backupGit.tokenSaved = !!t;
    if (typeof user === 'string') backupPrefs.git = { ...backupPrefs.git, user: user.trim().slice(0, 200) };
    return backupView();
  });
  on('backup:git-now', () => {
    backupGit.error = 'Backing up needs the app on a PC (not the harness).';
    return backupView();
  });
  on('backup:sync-pick', () => ({ folder: backupPrefs.sync.folder || path.join(dataDir, 'sync-copy'), existing: true }));
  on('backup:sync-setup', (folder, passphrase) => {
    if (typeof folder !== 'string' || !path.isAbsolute(folder) || typeof passphrase !== 'string' || passphrase.length < 10) throw new Error('Choose a folder and type a passphrase.');
    backupPrefs.sync = { ...backupPrefs.sync, folder, on: true };
    backupSync.passphraseSaved = true;
    backupSync.existing = true;
    return { joined: false, view: backupView() };
  });
  on('backup:sync', (patch) => {
    const p = (patch && typeof patch === 'object' ? patch : {});
    backupPrefs.sync = core.cleanBackupPrefs({ ...backupPrefs, sync: { ...backupPrefs.sync, ...(p.on !== undefined ? { on: p.on === true } : {}), ...(p.minutes !== undefined ? { minutes: p.minutes } : {}) } }).sync;
    return backupView();
  });
  on('backup:sync-forget', () => {
    backupSync.passphraseSaved = false;
    backupSync.existing = false;
    backupPrefs.sync = { ...backupPrefs.sync, on: false, folder: '' };
    return backupView();
  });
  on('backup:sync-now', () => {
    backupSync.error = 'Syncing needs the app on a PC (not the harness).';
    return backupView();
  });
  on('plugins:list', () => []);
  on('plugins:ensure', () => []);
  on('plugins:cards', () => []);
  const namesNotice = async () => {
    try {
      const look = await namesLook();
      if (!look.renames.length && !look.nameLeft.length) return null;
      const decision = await core.namesDecision(vaultDir, look.renames, look.nameLeft).catch(() => null);
      if (decision !== null) return null;
      const ask = core.namesAsk(look.renames, look.nameLeft);
      return { id: ask.key, at: Date.now(), kind: 'names', title: ask.title, body: ask.body, sessionId: '', read: false };
    } catch {
      return null;
    }
  };
  on('notices:list', async () => {
    const ask = await namesNotice();
    return ask ? { items: [ask], unread: 1 } : { items: [], unread: 0 };
  });
  on('notices:read', async () => {
    const ask = await namesNotice();
    return ask ? { items: [{ ...ask, read: true }], unread: 0 } : { items: [], unread: 0 };
  });
  on('notices:open', async () => {
    const ask = await namesNotice();
    return ask ? { items: [{ ...ask, read: true }], unread: 0 } : { items: [], unread: 0 };
  });
  on('notices:clear', () => ({ items: [], unread: 0 }));
  // Agent deliveries, seeded per test (t261: opts.agentDelivered; empty unless a test says otherwise).
  on('agents:state', () => ({ host: 'standalone', activity: [], person: null, delivered: opts.agentDelivered ?? [], localMcp: { on: false, level: 'read' } }));
  // The model and the former host app, honestly stubbed (the app dereferences these; an undefined
  // answer crashes where a refusal runs the honest error path).
  on('ai:chat', () => { throw new Error('No model is set up in the harness.'); });
  on('ai:attachment-text', () => ({ error: 'No model is set up in the harness.' }));
  on('notebook:ask', () => { throw new Error('No model is set up in the harness.'); });
  on('neuralspark:send', () => ({ opened: false }));
  on('external:take', () => []);
  on('external:state', () => ({ allow: [], cli: null, registered: false }));
  on('recorder:status', () => ({ transcribe: false, systemAudio: false, pieceSeconds: 30 }));
  on('recorder:jobs', () => []);
  on('recorder:prepare', () => ({ transcribe: false, systemAudio: false, pieceSeconds: 30 }));
  on('vfiles:imports', () => []);
  // Nothing picked: the OS window cannot open headless (p14: the UI reads .problems off the answer).
  on('vfiles:add', () => ({ placed: [], importing: [], problems: [] }));
  // Deletes leave the vault for the run's trash folder, never a hard delete (p14: the core's toBinOrTrash fell
  // through to electron's shell, which the stub has not — every delete toasted "shell.trashItem is not a function").
  // The harness acts as the host here, as app.ts does with setVaultBin.
  core.setVaultBin(async ({ abs, rel }) => {
    try {
      const dest = path.join(dataDir, 'trash', rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      renameSync(abs, dest);
      return true;
    } catch {
      return false;
    }
  });
  on('loose:pick', () => []);
  on('reviews:status', () => ({ last: null, putOff: null }));
  // A meeting note's context (the real Reviews.meetingContext's read-only shape, src/main/reviews.ts):
  // whether it is a meeting, its day, and the people it names. The minutes card, the word check and the
  // actions panel read this; without it they stay null, as if no note were a meeting. Filing and the
  // assistant's finds stay out (no project history or model headless).
  on('meetings:context', (rel) => {
    const p = String(rel ?? '');
    const meta = index.allMeta().find((m) => m.path === p);
    if (!meta) return null;
    const props = meta.props ?? {};
    const type = String(props.type ?? '').toLowerCase();
    if (type === 'project' || type === 'review' || type === 'template') return null;
    const people = [];
    for (const k of ['attendees', 'people', 'who', 'participants', 'with']) {
      const v = props[k];
      for (const x of Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*[,;]\s*/) : []) {
        const name = String(x).replace(/^\[\[|\]\]$/g, '').split('|').pop().trim();
        if (name && name.length < 60 && !people.includes(name)) people.push(name);
      }
    }
    const date = typeof props.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(props.date) ? props.date.slice(0, 10) : new Date(meta.mtime || Date.now()).toISOString().slice(0, 10);
    return { meeting: core.isMeetingNote(p, props), date, people, projects: [], all: [], known: [...people] };
  });
  on('fileindex:status', () => ({ on: false, busy: false, done: 0, todo: 0, projects: [], files: 0, withText: 0, chars: 0, maxChars: 0, bridge: false }));
  on('fileindex:search', () => []);
  // Reading words in pictures, and meaning search: off here (their hooks read
  // .length off hits, so an undefined answer crashes where [] stays honest).
  on('ocr:status', () => ({ on: false, available: false, reason: 'off', busy: false, done: 0, todo: 0, files: 0, withWords: 0, languages: null, lang: '' }));
  on('ocr:search', () => []);
  on('meaning:status', () => ({ mode: 'starting', busy: false, done: 0, todo: 0, embedded: 0, words: '' }));
  on('project:work', () => opts.projectWork ?? null);
  on('automations:list', () => ({ ready: false, why: 'not-connected', words: 'the host app isn’t connected in the harness.', canOpen: false }));
  on('site:marks', () => []);
  on('site:list', () => []);
  // Privacy stand-in (p14, 4 Nov 2026): the real store shape and setter rules (src/main/sensitive.ts), in memory —
  // the setters answer with the full state, as the UI expects (an undefined answer blanked the section). No bots,
  // outside agents, note types or private notes in the harness, so those stay empty; folders and counts come from
  // the fresh vault itself.
  const privacyStore = { version: 1, folders: {}, types: {}, items: {}, access: {}, photos: 'ask' };
  const privacyFiles = () => {
    const out = [];
    const walk = (dir, rel) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else if (/\.md$/i.test(e.name) && !core.isPrivatePath(r)) out.push(r);
      }
    };
    try {
      walk(vaultDir, '');
    } catch {}
    return out;
  };
  const privacyLevel = (p) => privacyStore.items[p] ?? privacyStore.folders[p.split('/')[0]] ?? 'open';
  const privacyRows = () =>
    core.AGENT_GROUPS.map((g) => {
      const parent = core.parentOf(g.id) ?? undefined;
      return { id: g.id, label: g.label, words: g.words, levels: core.accessOf(privacyStore, g.id), own: core.hasOwnRow(privacyStore, g.id), ...(parent ? { parent, follows: parent } : {}), group: true };
    });
  const privacyState = () => {
    const files = privacyFiles();
    const counts = Object.fromEntries(core.LEVEL_IDS.map((l) => [l, 0]));
    const tops = new Map();
    for (const f of files) {
      counts[privacyLevel(f)]++;
      const top = f.split('/')[0];
      if (f.includes('/')) tops.set(top, (tops.get(top) ?? 0) + 1);
    }
    for (const f of Object.keys(privacyStore.folders)) if (!tops.has(f)) tops.set(f, 0);
    return {
      rows: privacyRows(),
      folders: [...tops].map(([folder, notes]) => ({ folder, notes, level: privacyStore.folders[folder] ?? null })).sort((a, b) => a.folder.localeCompare(b.folder)),
      types: [],
      photos: privacyStore.photos,
      counts,
      privateNotes: { exists: false, unlocked: false, count: 0 },
    };
  };
  const privacyLevelOf = (p) => {
    const own = privacyStore.items[p] ?? null;
    const folder = p.includes('/') ? p.split('/')[0] : '';
    const fromFolder = folder ? (privacyStore.folders[folder] ?? null) : null;
    const level = own ?? fromFolder ?? 'open';
    const readers = privacyRows()
      .filter((r) => r.group && r.levels.includes(level))
      .map((r) => r.label);
    return { level, from: own ? 'own' : fromFolder ? 'folder' : 'default', ...(fromFolder ? { folder } : {}), readers };
  };
  const privacyPathProblem = (p) => (!p || core.isPrivatePath(p) || p.split('/').some((x) => x === '..' || x.startsWith('.')));
  on('privacy:store', () => ({ ...privacyStore }));
  on('privacy:state', () => privacyState());
  on('privacy:level-of', (p) => privacyLevelOf(typeof p === 'string' ? p : ''));
  on('privacy:set-level', (rel, level) => {
    const p = typeof rel === 'string' ? rel.replace(/\\/g, '/').replace(/^\/+/, '') : '';
    if (privacyPathProblem(p)) throw new Error('That isn’t a note or file in this vault.');
    const next = level === null ? null : core.readLevel(level);
    if (level !== null && !next) throw new Error('That isn’t one of the five levels.');
    if (next) privacyStore.items[p] = next;
    else delete privacyStore.items[p];
    return privacyLevelOf(p);
  });
  on('privacy:noted', () => undefined);
  on('privacy:set-folder', (folder, level) => {
    const f = typeof folder === 'string' ? folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
    if (privacyPathProblem(f)) throw new Error('That isn’t a folder in this vault.');
    const next = level === null ? null : core.readLevel(level);
    if (next) privacyStore.folders[f] = next;
    else delete privacyStore.folders[f];
    return privacyState();
  });
  on('privacy:set-type', (type, level) => {
    const t = typeof type === 'string' ? type.trim().toLowerCase() : '';
    if (!t) throw new Error('That isn’t a note type.');
    const next = level === null ? null : core.readLevel(level);
    if (next) privacyStore.types[t] = next;
    else delete privacyStore.types[t];
    return privacyState();
  });
  on('privacy:set-access', (who, levels) => {
    const id = typeof who === 'string' ? who.trim() : '';
    if (!id || !privacyRows().some((r) => r.id === id)) throw new Error('That agent isn’t one Ironleaf knows.');
    const list = levels === null ? null : Array.isArray(levels) ? core.LEVEL_IDS.filter((l) => l === 'open' || levels.includes(l)) : null;
    if (list) privacyStore.access[id] = list;
    else delete privacyStore.access[id];
    return privacyState();
  });
  on('privacy:set-photos', (rule) => {
    privacyStore.photos = rule === 'never' ? 'never' : 'ask';
    return privacyState();
  });
  on('secrets:status', () => ({ unlocked: false, count: 0 }));
  // The Locked place, never set up in the fresh vault (p14: without it Open Locked toasted a TypeError).
  on('locked:status', () => ({ exists: false, unlocked: false, hello: false, thisPc: false, notes: 0, secrets: 0 }));
  // Private notes likewise (p14: refreshPrivate read .unlocked off the missing answer and toasted the TypeError).
  on('private:status', () => ({ exists: false, unlocked: false, hello: false, thisPc: false, count: 0 }));
  on('neuralspark:available', () => false);
  on('bin:available', () => true);
  on('bin:call', async (input) => {
    const i = input ?? {};
    if (i.action === 'restore' && typeof i.id === 'string') return binRestore(i.id);
    if (i.action === 'purge' && typeof i.id === 'string') return bin.forget(i.id);
    if (i.action === 'empty') {
      let emptied = 0;
      for (const it of await bin.list()) if ((await bin.forget(it.id).catch(() => ({ forgotten: false }))).forgotten) emptied++;
      return { emptied };
    }
    const kindWords = { note: 'Note', canvas: 'Canvas', view: 'View', file: 'File', folder: 'Folder' };
    const others = (await bin.list()).map((it) => ({ type: 'vault', id: it.id, app: 'vault', kind: it.kind === 'folder' ? 'folder' : it.kind === 'note' ? 'note' : 'file', kindWords: kindWords[it.kind] ?? 'File', title: it.title, detail: `Ironleaf · ${it.path.includes('/') ? it.path.slice(0, it.path.lastIndexOf('/')) : 'the vault'}`, where: it.path, deletedAt: it.at, daysLeft: it.daysLeft }));
    return { items: [], others, keepDays: core.KEEP_DAYS };
  });
  on('window:chrome', () => undefined);
  on('window:zoom', (factor) => Number(factor) || 1);
  on('window:own-zoom', () => undefined);
  on('edit:command', () => undefined);
  on('app:close-ready', () => undefined);
  on('errors:report', (report) => void errorReports.push(report));
  // Pasted and dropped files (t136, 9 Nov 2026): the same steps as src/main/app.ts attachment:save/import — a free
  // name in the note's Files folder, the bytes written, the rel back. The RPC crosses as JSON, so a Uint8Array
  // arrives as a plain object and is rebuilt here (Electron's IPC keeps it binary in the app).
  const splitName = (name) => (/\.view\.json$/i.test(name) ? { base: name.slice(0, -10), ext: name.slice(-10) } : (() => { const dot = name.lastIndexOf('.'); return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: '' }; })());
  on('attachment:save', async (name, data, forNote) => {
    const bytes = data instanceof Uint8Array ? data : Uint8Array.from(Object.values(data ?? {}));
    if (!bytes.length) throw new Error('That file could not be read.');
    const { base, ext } = splitName(core.sharedCleanFileName(typeof name === 'string' ? name.split(/[\\/]/).pop() : '', 'Picture.png', 180));
    const note = typeof forNote === 'string' ? forNote : '';
    const folder = note && /\.md$/i.test(note) ? vaultFiles.folderFor(note) : 'Attachments';
    if (folder && !(await vault.any(folder))) await vault.makeFolder(folder);
    for (let i = 0; i < 10000; i++) {
      const rel = folder ? `${folder}/${i === 0 ? base : `${base} ${i}`}${ext.toLowerCase()}` : `${i === 0 ? base : `${base} ${i}`}${ext.toLowerCase()}`;
      if (!(await vault.any(rel))) {
        await vault.writeBinary(rel, bytes);
        await rescanAll();
        return rel;
      }
    }
    throw new Error('No free name was found.');
  });
  on('attachment:import', async (paths, folder, forNote) => {
    if (!Array.isArray(paths)) throw new Error('Nothing to add.');
    const note = typeof forNote === 'string' ? forNote : '';
    const dir = typeof folder === 'string' ? (folder ? folder.replace(/^\/+|\/+$/g, '') : '') : note && /\.md$/i.test(note) ? vaultFiles.folderFor(note) : 'Attachments';
    const added = [];
    for (const raw of paths.slice(0, 200)) {
      if (typeof raw !== 'string' || !path.isAbsolute(raw)) continue;
      if (!raw.startsWith(`${vaultDir}${path.sep}`)) throw new Error('The harness cannot reach files outside the vault.');
      let buf;
      try { buf = readFileSync(raw); } catch { continue; }
      if (dir && !(await vault.any(dir))) await vault.makeFolder(dir);
      const { base, ext } = splitName(core.sharedCleanFileName(raw.split('/').pop() ?? 'File', 'File', 180));
      for (let i = 0; i < 10000; i++) {
        const rel = dir ? `${dir}/${i === 0 ? base : `${base} ${i}`}${ext}` : `${i === 0 ? base : `${base} ${i}`}${ext}`;
        if (!(await vault.any(rel))) {
          await vault.writeBinary(rel, new Uint8Array(buf));
          await rescanAll();
          added.push(rel);
          break;
        }
      }
    }
    return added;
  });

  // The life-module backends (p11, 4 Nov 2026): the REAL main-side modules, wired as src/main/app.ts wires them —
  // WorkModules (meetings, weekly, sites, vendors) plus the personal and life-records groups, RecordModules (Money,
  // Papers), Publications, and Modules (Health, Family). Only the outside world is doubled: OS dialogs pick nothing
  // headless, files outside the vault cannot come in, printing and mail refuse honestly, reminders are not posted,
  // and the health store's key protector passes through (made-up data in a temp folder only).
  const modPrefs = () => ({ templatesFolder: settings.prefs.templatesFolder || 'Templates', modules: settings.prefs.modules ?? {} });
  const copyIntoVault = async (paths, folder) => {
    const out = [];
    for (const abs of paths) {
      const p = String(abs ?? '');
      if (!p.startsWith(`${vaultDir}${path.sep}`)) throw new Error('The harness cannot reach files outside the vault.');
      let buf;
      try {
        buf = readFileSync(p);
      } catch {
        continue;
      }
      if (folder && !(await vault.any(folder))) await vault.makeFolder(folder);
      const base = p.split('/').pop() || 'file';
      const dot = base.lastIndexOf('.');
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : '';
      for (let n = 1; n < 500; n++) {
        const rel = `${folder ? `${folder}/` : ''}${stem}${n > 1 ? ` ${n}` : ''}${ext}`;
        if (await vault.any(rel)) continue;
        const dest = path.join(vaultDir, ...rel.split('/'));
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, buf);
        await rescan(rel);
        out.push(rel);
        break;
      }
    }
    return out;
  };
  const moduleWrite = async (rel, text) => void (await writeNote(rel, text));
  const workDeps = {
    vault: () => vault,
    index,
    prefs: modPrefs,
    writeNote: moduleWrite,
    importFiles: (paths, folder) => copyIntoVault(paths, folder),
    pickFiles: async () => [],
    saveFile: async () => null,
    post: () => 0,
    editProject: (rel, edit) => editProject(rel, edit, ''),
    projects: () => projects.list().map((c) => ({ path: c.path, name: c.name })),
    records: () => records(),
    requireCreate: async () => {},
  };
  const workModules = new core.WorkModules(workDeps);
  const lifeRecords = new core.WorkModules(workDeps, core.LIFE_RECORDS_GROUP);
  const personal = new core.WorkModules(workDeps, core.PERSONAL_GROUP);
  core.registerWorkModules([workModules, lifeRecords, personal], on);
  const recordModules = new core.RecordModules({
    ...workDeps,
    movePath: (from, to) => movePath(String(from), String(to), true).then((r) => ({ path: r.path })),
    fileText: async () => null,
  });
  core.registerRecordModules(recordModules, { handle: on, vault: () => vault, index, requireCreate: async () => {} });
  const publications = new core.Publications({
    root: () => vaultDir,
    index,
    prefs: modPrefs,
    writeNote: moduleWrite,
    requireCreate: async () => {},
    exists: (rel) => vault.any(rel),
    files: async () => (await vault.listAll()).files.map((f) => ({ path: f.rel, size: f.size })),
    placeFile: async ({ record, src }) => {
      const folder = String(record).includes('/') ? `${String(record).split('/').slice(0, -1).join('/')}/Files` : 'Files';
      const [rel] = await copyIntoVault([src], folder);
      return { rel: rel ?? folder, version: 1 };
    },
    copyIn: (abs, folder) => copyIntoVault(abs, folder),
    pickFiles: async () => [],
    pickSave: async () => null,
    printer: {
      pdf: async () => { throw new Error('Making a PDF needs the app on a PC (not the harness).'); },
      print: async () => { throw new Error('Printing needs the app on a PC (not the harness).'); },
      printers: async () => [],
      stage: async (html, key) => {
        const safe = String(key).replace(/[^a-z0-9-]+/gi, '-').slice(0, 60) || 'preview';
        const f = path.join(dataDir, `${safe}.html`);
        writeFileSync(f, String(html), 'utf8');
        return f;
      },
    },
    appFonts: async () => undefined,
    readPdfText: async () => null,
    post: () => 0,
    changed: () => {},
  });
  core.registerPublications(publications, on);
  const sensitivity = new core.Sensitivity({ root: () => vaultDir, props: (rel) => index.allMeta().find((m) => m.path === rel)?.props, pc: 'harness' });
  const lifeModules = new core.Modules({
    handle: on,
    dataDir,
    root: () => vaultDir,
    vaultKey: async (r) => createHash('sha1').update(String(r)).digest('hex'),
    index,
    modules: () => settings.prefs.modules ?? {},
    protector: { available: () => true, protect: (b) => Buffer.from(b), unprotect: (b) => Buffer.from(b) },
    sensitivity,
    requireCreate: async () => {},
    writeNote: moduleWrite,
    readNote: async (rel) => index.content(rel) ?? null,
    exists: (rel) => vault.any(rel),
    makeFolder: (rel) => vault.makeFolder(rel),
    trash: async (rel) => void (await binTrash(rel)),
    files: async () => (await vault.listAll()).files.map((f) => f.rel),
    folders: async () => (await vault.listAll()).folders,
    copyIn: (abs, folder) => copyIntoVault(abs, folder),
    pickFiles: async () => [],
    pickSave: async () => null,
    notify: () => {},
    openHealth: () => {},
    changed: () => {},
  });
  lifeModules.register();

  return {
    vault,
    index,
    calls,
    opened,
    errorReports,
    log,
    rescan,
    rescanAll,
    damagedKept,
    invoke: async (channel, args) => {
      const fn = handlers.get(channel);
      if (!fn) {
        const err = new Error(`No harness handler for ${channel}`);
        err.code = 'NO_HARNESS_HANDLER';
        throw err;
      }
      return fn(...(Array.isArray(args) ? args : []));
    },
  };
}

// ── window.nv channel map, read from the real preload ───────────────────────────
// Parses `ns: { … method: (…) => invoke('channel', …) … }` out of preload/index.ts
// and the shared *-api.ts files, so the page stub routes exactly like the app.
export function channelMap() {
  const map = new Map();
  const files = [{ f: 'src/preload/index.ts', prefix: '' }, ...readdirSync(path.join(root, 'src', 'shared')).filter((f) => f.endsWith('-api.ts')).map((f) => ({ f: `src/shared/${f}`, prefix: apiName(`src/shared/${f}`) }))];
  for (const { f, prefix } of files) {
    const src = readFileSync(path.join(root, f), 'utf8').replace(/=>\n(\s+)(?:flagUnlockNeeded\()?invoke/g, '=> $1invoke');
    const lines = src.split('\n');
    const stack = [];
    for (const line of lines) {
      const open = /^(\s*)([A-Za-z_][A-Za-z0-9_]*):\s*\{\s*(?:\/\/.*)?$/.exec(line);
      if (open) {
        while (stack.length && stack[stack.length - 1].depth >= open[1].length) stack.pop();
        stack.push({ key: open[2], depth: open[1].length });
        continue;
      }
      const inv = /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(?:<[^>]*>)?\([^)]*\)\s*=>\s*(?:flagUnlockNeeded\()?invoke.*?\(['"]([^'"]+)['"]/.exec(line);
      if (inv) {
        while (stack.length && stack[stack.length - 1].depth >= /^\s*/.exec(line)[0].length) stack.pop();
        const dotted = [...stack.map((s) => s.key), inv[1]].join('.');
        map.set(prefix ? `${prefix}.${dotted}` : dotted, inv[2]);
        continue;
      }
      if (/^\s*\},?\s*(?:\/\/.*)?$/.test(line) && stack.length) stack.pop();
    }
  }
  return map;
}
function apiName(f) {
  const b = path.basename(f, '-api.ts');
  return { life: 'life', 'vault-files': 'vfiles', modules: 'modules', 'record-modules': 'recmod', 'work-modules': 'work', publications: 'pub', 'site-publish': 'site' }[b] ?? b;
}

// ── the page stub (runs before the bundle) ──────────────────────────────────────
export function stubScript(map) {
  const entries = [...map.entries()].map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',');
  return `
(() => {
  const channels = {${entries}};
  const calls = [];
  window.__nvCalls = calls;
  window.__nvErrors = [];
  window.addEventListener('error', (e) => window.__nvErrors.push(String(e.message || e.error || e)));
  window.addEventListener('unhandledrejection', (e) => window.__nvErrors.push('reject: ' + String((e.reason && e.reason.stack) || (e.reason && e.reason.message) || e.reason).slice(0, 800)));
  const __ce = console.error.bind(console);
  console.error = (...a) => { try { window.__nvErrors.push(a.map((x) => String(x && x.stack || x && x.message || x)).join(' ').slice(0, 2000)); } catch {} __ce(...a); };
  const syncValues = { 'window.platform': 'linux', 'dictation.available': false };
  const u8ToB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return btoa(s); };
  // Bytes ride as base64 (t243: Electron carries Uint8Array over IPC; the harness's JSON cannot, so dropped
  // emails and PDFs arrived as {} and every binary door read as unreadable).
  const encBytes = (v) => (v instanceof Uint8Array ? { __nvBytes: u8ToB64(v) } : v instanceof Date ? v : Array.isArray(v) ? v.map(encBytes) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encBytes(x)])) : v);
  const b64ToU8 = (s) => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const decResult = (v) => (v && typeof v === 'object' && typeof v.__nvBytes === 'string' ? b64ToU8(v.__nvBytes) : Array.isArray(v) ? v.map(decResult) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decResult(x)])) : v);
  const callRpc = async (channel, args) => {
    const res = await fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel, args: encBytes(args) }) });
    const data = await res.json();
    if (!data.ok) {
      const e = new Error(data.error || 'The harness could not do that.');
      if (data.code) e.code = data.code;
      throw e;
    }
    return decResult(data.result ?? null);
  };
  // Every node is callable and every child exists (nested namespaces like
  // life.inbox.list, and unknown leaves that resolve undefined, never throw).
  const node = (key) => new Proxy(function () {}, {
    get: (_, prop) => {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      const child = key ? key + '.' + prop : prop;
      if (Object.prototype.hasOwnProperty.call(syncValues, child)) return syncValues[child];
      return node(child);
    },
    apply: (_, __, args) => {
      calls.push(key);
      const last = key.split('.').pop();
      if (key === 'nv' || !key) return undefined;
      if (key.startsWith('on.') || /^on[A-Z]/.test(last) || last === 'subscribe') return () => {};
      const channel = channels[key];
      if (!channel) return Promise.resolve(undefined);
      // The app wraps a work call's own arguments into one array (src/shared/work-modules-api.ts); the stub
      // passes the window's raw arguments, so wrap them here to route exactly like the app.
      const payload = channel === 'work:call' ? [args[0], args[1], args.slice(2)] : args;
      return (async () => {
        try {
          return await callRpc(channel, payload);
        } catch (e) {
          if (e && e.code === 'NO_HARNESS_HANDLER') return undefined;
          throw e;
        }
      })();
    },
  });
  window.nv = node('');
})();
`;
}

// ── http server: the bundle + rpc ───────────────────────────────────────────────
export async function startServer(distDir, services) {
  const get = typeof services === 'function' ? services : () => services;
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  const map = channelMap();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/rpc') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        (async () => {
          try {
            const { channel, args } = JSON.parse(body || '{}');
            // Bytes back out of base64 (t243, with the stub's encBytes above).
            const decBytes = (v) => (v && typeof v === 'object' && typeof v.__nvBytes === 'string' ? Buffer.from(v.__nvBytes, 'base64') : Array.isArray(v) ? v.map(decBytes) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decBytes(x)])) : v);
            const s = get();
            s.log('rpc', channel);
            const result = await s.invoke(channel, (Array.isArray(args) ? args : []).map(decBytes));
            // Bytes ride base64-tagged (the mirror of decBytes above): JSON cannot carry what Electron's IPC can.
            const encResult = (v) => (v instanceof Uint8Array ? { __nvBytes: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') } : Array.isArray(v) ? v.map(encResult) : v && typeof v === 'object' && v.constructor !== Object ? v : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encResult(x)])) : v);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result: encResult(result ?? null) }));
          } catch (e) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e), code: e?.code ?? null }));
          }
        })();
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/stub.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(stubScript(map));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/harness.html') {
      // A missing bundle answers 404 (p11: another coder's clean-up once deleted ours mid-sweep; crashing the
      // run helps no one — the waits retry and the failure, if real, shows as a view that never lands).
      const idx = path.join(distDir, 'index.html');
      if (!existsSync(idx)) {
        res.writeHead(404);
        res.end('no bundle');
        return;
      }
      const html = readFileSync(idx, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html.replace('</head>', '<script src="/stub.js"></script></head>'));
      return;
    }
    let p = path.normalize(path.join(distDir, url.pathname === '/' ? 'index.html' : '.' + url.pathname));
    if (!p.startsWith(distDir) || !existsSync(p) || !statSync(p).isFile()) {
      res.writeHead(404);
      res.end('no');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  });
  const port = await new Promise((resolve) => {
    const s = net.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

export const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

// ── the browser, over CDP (the sweep tests' pattern, no extra packages) ─────────
export async function startBrowser(origin) {
  if (!existsSync(SHELL)) throw new Error(`no headless Chromium: ${SHELL}`);
  const port = await new Promise((resolve) => {
    const s = net.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const child = spawn(SHELL, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const close = () => {
    try { child.kill('SIGKILL'); } catch {}
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
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let id = 1;
    const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d);
        pending.delete(d.id);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const i = id++;
        pending.set(i, resolve);
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    const ev = async (expression) => {
      const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (d.result?.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(d.result.exceptionDetails.exception?.description ?? d.result.exceptionDetails).slice(0, 500)}`);
      return d.result?.result?.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${origin}/harness.html` });
    return {
      ev,
      send,
      close: () => {
        try { ws.close(); } catch {}
        close();
      },
    };
  } catch (e) {
    close();
    throw e;
  }
}

// ── one call: vault + services + server + browser ───────────────────────────────
export async function startHarness(opts = {}) {
  const work = mkdtempSync(path.join(tmpdir(), 'nv-controls-'));
  const vaultDir = path.join(work, 'vault');
  mkdirSync(vaultDir, { recursive: true });
  writeVault(vaultDir);
  const core = await loadCore(work);
  mkdirSync(path.join(work, 'data'), { recursive: true });
  const box = { current: await openServices(vaultDir, path.join(work, 'data'), core, opts) };
  const distDir = await buildRenderer(work);
  const server = await startServer(distDir, () => box.current);
  const browser = await startBrowser(server.origin);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    work,
    vaultDir,
    core,
    get services() {
      return box.current;
    },
    origin: server.origin,
    browser,
    /** A pristine vault and page again (per-view isolation: the sweep may delete). */
    freshView: async () => {
      rmSync(vaultDir, { recursive: true, force: true });
      mkdirSync(vaultDir, { recursive: true });
      writeVault(vaultDir);
      box.current = await openServices(vaultDir, path.join(work, 'data'), core, opts);
      // The old page keeps matching until the new one commits (p14: section opens landed on the page being left,
      // then swept the restored one) — wait for the new boot, not just any .app.
      const bootBefore = await browser.ev(`performance.timeOrigin`).catch(() => 0);
      await browser.send('Page.navigate', { url: `${server.origin}/harness.html` });
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        try {
          if ((await browser.ev(`performance.timeOrigin`)) !== bootBefore && (await browser.ev(`!!document.querySelector('.app')`))) break;
        } catch {}
      }
      await sleep(1200);
    },
    close: async () => {
      browser.close();
      server.close();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

/** Open Settings the way a person does now: Settings left the sidebar for the
 *  account menu (the chip at the foot of the sidebar, or the avatar on the
 *  folded rail). Returns 'CLICKED' once the menu's Settings row is pressed. */
export async function openSettings(h) {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let row = document.querySelector('.acct-menu [data-id="settings"]');
    if (!row) {
      const chip = [...document.querySelectorAll('.acct-chip, .acct-chip-rail')].find(vis);
      if (!chip) return 'NOCHIP';
      chip.click();
      for (let i = 0; i < 20 && !row; i++) { await sleep(50); row = document.querySelector('.acct-menu [data-id="settings"]'); }
      if (!row) return 'NOMENU';
    }
    row.click();
    await sleep(400);
    return 'CLICKED';
  })()`);
}
