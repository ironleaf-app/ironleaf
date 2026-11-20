// node --test tests/note-page-premium.test.mjs — p14 (4 Nov 2026): a note and a project-as-note
// read premium at 3456x1408. The facts block shows the app's own chips and date look
// (Tasks' and the project page's pills, never a browser date box); step lines hide the dash and
// dots their chips replace; the right rail sits beside the text, not far away; headings and tables
// match.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(path.join(root, p), 'utf8');

test('facts use the shared pills and chips, never a bare browser date box', () => {
  const fields = src('src/renderer/src/components/NoteFields.tsx');
  assert.ok(fields.includes('StatusPill'), 'status and health show as the shared status pill');
  assert.ok(fields.includes('DatePill'), 'dates show as the shared date pill');
  assert.ok(fields.includes('OwnerChip'), 'an owner shows as the shared owner chip');
  assert.ok(fields.includes('Progress'), 'progress shows as the shared bar');
  assert.ok(fields.includes('factKind'), 'which fact is which is read once, in shared/note-page.ts');
  // The browser date box stays only as the editor behind the pill (shown while changing, never as the fact).
  const dateInputs = fields.match(/<input[^>]*type=\{?kind === 'date'/g) ?? [];
  assert.equal(dateInputs.length, 0, 'no always-on browser date box for facts');
});

test('step lines hide the separators their chips replace', () => {
  const chips = src('src/renderer/src/editor/taskChips.ts');
  assert.ok(chips.includes('hideSpans'), 'Live Preview hides the spans taskChips names');
});

test('the rail sits beside the text on a wide window', () => {
  const css = src('src/renderer/src/styles/note-context.css');
  assert.ok(/\.nv-note-layout\s*\{[^}]*justify-content:\s*center/.test(css), 'the text and the rail centre as one group');
  assert.ok(/\.nv-note-main\s*\{[^}]*flex:\s*0\s+1/.test(css), 'the text keeps its column instead of stretching away from the rail');
});

test("a note's tables read as the app's tables: one rounded edge, row lines only, a quiet head", () => {
  const css = src('src/renderer/src/styles.css');
  const block = css.slice(css.indexOf("A note's tables read as the app's tables"));
  assert.ok(block.length > 100, 'the designed table block exists');
  assert.ok(/\.cm-nv-table table \{[^}]*border-radius/.test(block), 'Live tables carry the rounded edge');
  assert.ok(/\.cm-nv-table th,\s*\n?\.cm-nv-table td \{[^}]*border-bottom/.test(block) || /border-bottom: 1px solid/.test(block), 'rows divide horizontally');
  assert.ok(!/\.markdown td,\s*\n?\.cm-nv-table td \{\s*\n?\s*border: 1px solid/.test(css.slice(css.indexOf('.markdown table,'), css.indexOf('.markdown table,') + 2000)), 'no full grid (no verticals)');
});

test('headings match in Live and Reading, in the display face (verified, no change needed)', () => {
  const css = src('src/renderer/src/styles.css');
  assert.ok(/\.cm-nv-h1 \{\s*\n?\s*font-size: 1\.85em/.test(css), 'Live h1 size');
  assert.ok(/\.markdown h1 \{\s*\n?\s*font-size: 1\.85em/.test(css), 'Reading h1 matches Live');
  assert.ok(/--font-serif: 'Geist'/.test(css), 'headings sit in the display face, as the title does');
});
