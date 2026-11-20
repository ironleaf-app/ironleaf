// node --test tests/peek-page.test.mjs — the peek belongs to the page it was opened from (p14-words, 4 Nov 2026):
// moving to another page closes it instead of leaving the old page's item beside the new one. The chat panel's rule,
// applied to content that cannot follow: the chat stays beside every page because its page-bound scope re-derives from
// the live tab, never showing a stale page; the peek's item has no such re-derivation, so it closes — through the same
// page-change effect as a picker.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('moving page closes the peek, beside the picker rule', () => {
  const app = readFileSync(path.join(root, 'src/renderer/src/App.tsx'), 'utf8');
  assert.match(app, /closePeek, usePeek|usePeek, closePeek/, 'App knows closePeek');
  // t239 added the hover preview's close to the same effect: the peek still closes on the same deps.
  assert.match(app, /cancelPick\(\);\n\s*closePeek\(\);/, 'the page-change effect closes the peek with the picker');
  assert.match(app, /closePeek\(\);\n\s*(closeHover\(\);\n\s*)?\}, \[pageNow\.id, pageNow\.type, pageNow\.path\]\)/, 'it runs on the page itself changing');
});

test('the chat rule it answers: its page scope tracks the live tab', () => {
  const chat = readFileSync(path.join(root, 'src/renderer/src/panels/ChatPanel.tsx'), 'utf8');
  assert.match(chat, /const note = tab\.path/, 'the chat’s page scope re-derives from the current tab');
});
