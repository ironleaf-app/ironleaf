// The right side shuts itself when it has nothing to show (8.6: it took a quarter of the window on every page to say
// "Open a note to see its connections"). Off a note, a note-only panel (links, outline, graph) draws shut; the
// person's saved choice (open, panel) is untouched, so the side comes back on a note, and opening the side off a note
// goes to the chat, which works anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-sidehide-'));
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/layout-fit.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'fit.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'fit.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the note-only panels are known in one place', () => {
  for (const p of ['backlinks', 'outgoing', 'outline', 'local-graph', 'related', 'autolink']) assert.equal(F.rightPanelNeedsNote(p), true, p);
  for (const p of ['tags', 'chat']) assert.equal(F.rightPanelNeedsNote(p), false, p);
  assert.equal(F.rightPanelNeedsNote('no-such-panel'), false);
});

test('the shell draws the right side shut when its panel has nothing to show', () => {
  const app = readFileSync(path.join(root, 'src/renderer/src/App.tsx'), 'utf8');
  assert.ok(app.includes('rightPanelNeedsNote') || app.includes('rightShown'), 'App knows the rule');
  assert.doesNotMatch(app, /\{fit\.right === 'docked' && <RightSidebar/, 'no raw-fit RightSidebar render stays');
});

test('the side reopens to what works anywhere, and the toggle reads the drawn state', () => {
  const fit = readFileSync(path.join(root, 'src/renderer/src/state/fit.ts'), 'utf8');
  assert.match(fit, /rightPanelNeedsNote\(ws\.right\.panel\)\) panel = 'chat'/, 'opening the side off a note goes to the chat');
  assert.match(fit, /side === 'right' \? rightShown\(\)/, 'the toggle reads the drawn state');
});

test('the note-only set lives in shared, not twice', () => {
  const sides = readFileSync(path.join(root, 'src/renderer/src/panels/Sidebars.tsx'), 'utf8');
  assert.doesNotMatch(sides, /new Set<RightPanel>\(\[/, 'no second copy of the set');
  // The sidebar renders the chat off a note (it works anywhere); the shell still draws the side shut when
  // the saved panel needs a note (t7-note-window, 8 Nov 2026: no tabbed fallback left to consult the rule).
  const fit = readFileSync(path.join(root, 'src/renderer/src/state/fit.ts'), 'utf8');
  assert.ok(fit.includes('rightPanelNeedsNote'), 'the shared rule still gates the drawn state');
});
