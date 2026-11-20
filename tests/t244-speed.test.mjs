// node --test tests/t244-speed.test.mjs — the 3,000-note vault opens in under a second (t244 break-it,
// 12 Nov 2026: open a project, open Tasks, open Inbox with 200 items — nothing may take more than 1 second
// to show). The data layer behind each open (index, relations, the Tasks fold, Inbox lines with their filing
// suggestions) on the t200 made-up 3,000-note vault, timed with medians; paint rides the existing page-switch
// budgets (vault-speed-budget: under 150 ms p95). Made-up notes; prints its numbers for the report.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeT200Vault } from './t200-vault.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t244-speed-'));
let O;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n` +
      `export { TasksService } from ${JSON.stringify(path.join(root, 'src/main/tasks.ts'))};\n` +
      `export { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n` +
      `export * as oneTask from ${JSON.stringify(path.join(root, 'src/shared/one-task.ts'))};\n` +
      `export * as inbox from ${JSON.stringify(path.join(root, 'src/shared/inbox.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    (await import('node:fs')).symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  } catch {}
  O = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date('2026-11-12T09:00:00').getTime();
function readFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const abs = path.join(d, e);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (e.endsWith('.md')) out.push({ path: path.relative(dir, abs).split(path.sep).join('/'), text: readFileSync(abs, 'utf8') });
    }
  };
  walk(dir);
  return out;
}

test('open a project, Tasks, and Inbox with 200 items: each under a second', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-t244-speedvault-'));
  try {
    assert.equal(writeT200Vault(dir), 3000, 'the walk judges a 3,000-note vault');
    // An Inbox with 200 items waiting, real-shaped.
    const lines = ['# Inbox', ''];
    const subjects = ['Call the bank about the card reader', 'ShadeCo awning quote, decide by Friday', 'Buy milk and long-life cartons', 'Chase the December invoices', 'Book the electrician for the back room', 'Ring June about the October totals', 'File the council permit', 'Check the till logs from Saturday'];
    for (let i = 0; i < 200; i++) lines.push(`- [ ] ${subjects[i % subjects.length]} (${i + 1})`);
    writeFileSync(path.join(dir, 'Inbox.md'), lines.join('\n'));
    const files = readFiles(dir);

    const t0 = performance.now();
    const index = new O.VaultIndex();
    for (const f of files) index.set(f.path, f.text, NOW, f.text.length);
    const indexMs = performance.now() - t0;

    const med = async (fn, n = 5) => {
      const ds = [];
      for (let i = 0; i < n; i++) {
        const a = performance.now();
        await fn();
        ds.push(performance.now() - a);
      }
      return ds.sort((a, b) => a - b)[Math.floor(n / 2)];
    };

    // Opening a project: its relations, its file read, and the one-task fold over the vault.
    const flagship = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
    const projectMs = await med(() => {
      index.relations();
      O.parseProject(index.content(flagship), flagship);
      O.oneTask.dupNoteWords(files, new Date(NOW));
    });
    // Opening Tasks: the service's whole view.
    const tasks = new O.TasksService({ index, templatesFolder: () => 'Templates', write: async () => {}, now: () => NOW });
    const tasksMs = await med(() => tasks.view());
    // Opening Inbox: its 200 lines and each item's filing suggestion, as the page lists them.
    const projects = [];
    for (const m of index.allMeta()) {
      if (m.props?.type !== 'project') continue;
      let name = '';
      try {
        name = O.parseProject(index.content(m.path), m.path).name;
      } catch {
        continue;
      }
      projects.push({ path: m.path, name, people: [], tags: [], modified: NOW });
    }
    const inboxText = files.find((f) => f.path === 'Inbox.md').text;
    const inboxMs = await med(() => {
      const items = O.inbox.inboxLines(inboxText);
      assert.equal(items.length, 200);
      for (const it of items) O.inbox.suggestFiling(it, { projects, people: [], areas: [], resolve: () => null, now: NOW });
    });

    console.log(`t244 speed medians (ms): index-3000=${indexMs.toFixed(0)} project=${projectMs.toFixed(0)} tasks=${tasksMs.toFixed(0)} inbox-200=${inboxMs.toFixed(0)} (projects: ${projects.length})`);
    for (const [name, ms] of [['project', projectMs], ['tasks', tasksMs], ['inbox-200', inboxMs]]) {
      assert.ok(ms < 1000, `${name} shows in under a second (stood ${ms.toFixed(0)} ms)`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
