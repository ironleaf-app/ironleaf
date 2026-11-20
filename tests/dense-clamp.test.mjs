// Dense views never stack a cell down the row (8.6: the checker found table cells wrapping into tall stacks on
// Meetings › Actions). Columns keep a readable minimum (a narrow pane scrolls instead of squeezing them one word
// wide), long text clips at two lines, and the full words stay on hover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const ws = read('styles/project-workspace.css');
const sv = read('styles/saved-views.css');

test('a records table never squeezes a column one word wide', () => {
  assert.match(ws, /\.ws-table td:not\(\.ws-td-pick, \.ws-td-title\)\s*\{[^}]*min-width:\s*96px/, 'value columns keep 96 px and the pane scrolls past that');
  assert.match(ws, /\.ws-td-title\s*\{[^}]*min-width:\s*180px/, 'the name keeps room without hogging a narrow pane');
});

test('long words in a records cell clip, whole on hover', () => {
  const parts = read('views/workspace/recordParts.tsx');
  assert.match(parts, /ws-long" title=\{/, 'long text carries its full words on hover');
  assert.ok(/return <span title=\{text\}>/.test(parts), 'plain values carry their full words on hover');
});

test('a board card wraps its name whole, whole on hover', () => {
  assert.doesNotMatch(ws, /\.ws-card-title \.ws-cell\s*\{[^}]*-webkit-line-clamp/, 'no clamp, so no dots (t207 pass 2)');
  assert.match(ws, /\.ws-card-title \.ws-cell\s*\{[^}]*overflow-wrap:\s*break-word/, 'card names wrap whole words');
  const boards = read('views/workspace/RecordLayouts.tsx');
  assert.match(boards, /ws-card-title"[^>]*title=\{r\.title\}/, 'the full name stays on hover');
});

test("a table's pills never stack past two rows", () => {
  assert.match(sv, /\.sv-table \.sv-pills\s*\{[^}]*max-height:[^}]*overflow:\s*hidden/, 'pills cap at two rows');
  const common = read('views/saved/common.tsx');
  assert.match(common, /sv-value sv-pills" title=\{/, 'the full list stays on hover');
});

test('a table cell’s words stay whole on hover', () => {
  const common = read('views/saved/common.tsx');
  assert.match(common, /<span className="sv-value" title=\{text\}>/, 'plain cell words carry their full text on hover');
});
