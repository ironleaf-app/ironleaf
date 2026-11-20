// node --test tests/brief-words-10.test.mjs — the morning brief reads as a person speaks (10.0 review, 2 Nov 2026: the
// card showed "bill", "step", "task" as tags and "Due today · 2026-11-02" for a task in the daily note).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
test('kind tags are plain words, and a daily note is named in words', async () => {
  const src = readFileSync(new URL('../src/shared/brief.ts', import.meta.url), 'utf8');
  assert.match(src, /export function kindWords/);
  assert.match(src, /task: 'Task', step: 'Project step'/);
  assert.match(src, /Today’s note/);
  assert.match(src, /detail: `\$\{late\(days\)\} · \$\{noteWords\(t\.title, now\)\}`/);
  const home = readFileSync(new URL('../src/renderer/src/views/HomeView.tsx', import.meta.url), 'utf8');
  assert.ok(home.includes('{kindWords(item.kind)}</span>') && !home.includes("{item.kind.split(':')[0]}</span>"), 'the card shows the plain word');
});
