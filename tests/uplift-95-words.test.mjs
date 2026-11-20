// node --test tests/uplift-95-words.test.mjs — plain words, one voice (9.5 polished, 1 Nov 2026, plain Australian
// English, no jargon, no engine names, no em dashes in new UI words). One helper names the model everywhere
// (Recommended while nothing is chosen, Checking while it loads); one helper words each Ask scope; failures and
// engine-supplied strings read through the one cleaner; tooltips and lists name the human title, never the raw
// path. The ratchet caps the remaining em dashes; the named files hold none. Every check fails without its change
// (counts verified against HEAD: 173 dashes then).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('one helper names the model on every surface', () => {
  const lib = read('src/renderer/src/lib/assistantWords.ts');
  assert.ok(lib.includes("DEFAULT_MODEL_WORDS = 'Recommended'"), 'the default has one plain name');
  assert.ok(lib.includes('export function chatModelWords'), 'one helper words the model button and title');
  assert.ok(lib.includes("'Checking…'") && lib.includes("'No model yet'"), 'loading, none and default read apart');
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(!panel.includes('Same as the host app'), 'no engine name for the default (F95, every surface)');
  assert.ok(panel.includes('chatModelWords') || panel.includes('DEFAULT_MODEL_WORDS'), 'the side chat reads the one helper');
});

test('one helper words each Ask scope', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(panel.includes('export function scopeNoteWords'), 'the scope note has one helper');
  assert.ok(!codeOf(panel).includes('about the ticked sources in ${'), 'no inline scope note copies');
  assert.ok(!panel.includes('This page + linked notes'), 'the scope reads one way');
  assert.ok(panel.includes('This page + linked'), 'the scope keeps its pinned words');
});

test('proposal and answer failures read through the one cleaner', () => {
  const chat = read('src/renderer/src/state/chat.ts');
  assert.ok(!chat.includes('err instanceof Error ? err.message : String(err)'), 'no raw engine wrappers kept');
  assert.ok(chat.includes('error: result.error ? errorMessage(result.error) : undefined'), 'settled errors are cleaned too');
  assert.equal((chat.match(/questions send next/g) ?? []).length, 2, 'ask and ticked-source queues say the same wait');
});

test('channels and warnings read plain, never engines', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(!panel.includes("{modelLabel(view)} can’t see pictures"), 'the pictures warning names no engine');
  assert.ok(panel.includes('This model can’t see pictures'), 'the pictures warning stays plain and short');
  const agents = read('src/renderer/src/components/AgentsSettings.tsx');
  assert.ok(!agents.includes('connects to MCP servers'), 'Add an app reads plain (no protocol jargon)');
});

test('no new em dashes: the renderer-wide count never grows', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith('.tsx')) files.push(path.join(dir, e.name));
    }
  };
  walk('src/renderer/src');
  let total = 0;
  for (const f of files) total += (codeOf(read(f)).match(/—/g) ?? []).length;
  assert.ok(total <= 141, `at most 141 em dashes renderer-wide (got ${total})`);
});

test('the fixed screens hold no em dashes at all', () => {
  for (const f of [
    'src/renderer/src/components/Settings.tsx',
    'src/renderer/src/views/HomeView.tsx',
    'src/renderer/src/views/ProjectsHome.tsx',
    'src/renderer/src/views/ProjectPage.tsx',
    'src/renderer/src/views/modules/PublicationsPage.tsx',
    'src/renderer/src/components/SearchView.tsx',
    'src/renderer/src/components/GraphView.tsx',
    'src/renderer/src/panels/ChatFolders.tsx',
    'src/renderer/src/views/BookmarksPage.tsx',
    'src/renderer/src/views/project/ProjectTabs87.tsx',
  ]) {
    const found = (codeOf(read(f)).match(/—/g) ?? []).length;
    assert.equal(found, 0, `${f} holds no em dashes (got ${found})`);
  }
});

test('empties and prompts teach deeds, never file syntax', () => {
  const due = codeOf(read('src/renderer/src/views/today/DueCard.tsx'));
  assert.ok(!due.includes('- [ ]') && !due.includes('📅 2026-10-24'), 'the Due empty never teaches markup');
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(!tasks.includes('It is written in the note as'), 'the day prompt never teaches storage format');
  assert.ok(tasks.includes('due ${dueDayWords(x.t.due, today)}'), 'Plan my day dates read as day words');
});

test('tooltips and lists name the title, never the raw path', () => {
  const nav = read('src/renderer/src/panels/Navigator.tsx');
  assert.ok(!nav.includes('title={it.path}') && !nav.includes('title={r.path}'), 'tree tooltips name the page, not the path');
  assert.ok(!read('src/renderer/src/views/HomeView.tsx').includes('<button key={p} className="card home-cell" title={p}'), 'recent tiles hover the title');
  assert.ok(!read('src/renderer/src/panels/ChatFolders.tsx').includes('`${e.path} — show it`'), 'file rows hover an action, not a path');
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(!panel.includes('The assistant may read ${f}'), 'folder chips hover a name, not a path');
  const cap = read('src/renderer/src/components/CaptureSettings.tsx');
  assert.ok(!cap.includes(': ${status.extensionDir}'), 'the extension hint never prints the full path');
  assert.ok(!read('src/renderer/src/views/modules/w3b/Family87.tsx').includes('Drop files into {state.folder}'), 'empty Papers never prints a raw path');
  const vault = read('src/renderer/src/components/VaultHome.tsx');
  assert.ok(!vault.includes('<li key={r}>{r}</li>'), 'import summaries list titles, not paths');
});
