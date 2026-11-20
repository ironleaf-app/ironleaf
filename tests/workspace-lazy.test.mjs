// node --test tests/workspace-lazy.test.mjs — every route's view loads with its route, not the boot
// (5 Nov 2026 speed audit item 7: ~6 MB eager, zero lazy). The tab strip's titles and icons stay static and
// light; a tab that fails still shows plain words with Try again.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(path.join(root, p), 'utf8');

test('views load with their route behind Suspense', () => {
  const ws = src('src/renderer/src/views/Workspace.tsx');
  for (const view of ['NoteView', 'CanvasView', 'GraphTab', 'MediaView', 'DrawingView', 'SettingsPage', 'NotesPage', 'TodayView', 'TasksView', 'TimelineView', 'ProjectsHome', 'ModulePage', 'AreaPage', 'LooseView']) {
    assert.match(ws, new RegExp(`const ${view} = lazy\\(\\(\\) => import\\(`), `${view} is lazy`);
  }
  assert.match(ws, /<Suspense fallback=\{<PageLoading label="Opening…"><CardsSkeleton cards=\{3\} \/><\/PageLoading>\}>/, 'a calm placeholder while a view loads');
  assert.match(ws, /<PageGuard key=\{tab\.id\} name=\{tab\.type\}>[\s\S]*<Suspense/, 'a failing view still shows Try again (guard outside suspense)');
  assert.doesNotMatch(ws, /import \{ NoteView \} from/, 'no static NoteView');
  assert.doesNotMatch(ws, /import \{ CanvasView \} from/, 'no static CanvasView');
  assert.doesNotMatch(ws, /from '\.\.\/editor\/NoteEditor'/, 'the tab strip never loads the editor');
});

test("the tab strip's helpers stay light", () => {
  const ws = src('src/renderer/src/views/Workspace.tsx');
  assert.match(ws, /import \{ areaIcon, areaTitle \} from '\.\/areaTabs'/, 'area titles from the light file');
  assert.match(ws, /import \{ moduleIcon, moduleTitle \} from '\.\/modules\/tabHelpers'/, 'module titles from the light file');
  assert.match(ws, /import \{ looseName \} from '\.\.\/\.\.\/\.\.\/shared\/loose-name'/, 'loose names from shared');
  assert.match(ws, /import \{ dropEditorCache \} from '\.\.\/editor\/tabCache'/, 'cache drops without the editor');
  for (const [file, heavy] of [
    ['src/renderer/src/views/areaTabs.ts', /views\/AreaPage|views\/LooseView|modules\/registry|editor\//],
    ['src/renderer/src/views/modules/tabHelpers.ts', /views\/AreaPage|views\/LooseView|modules\/registry|editor\//],
    ['src/shared/loose-name.ts', /views\/|editor\/|state\//],
    ['src/renderer/src/editor/tabCache.ts', /@codemirror|views\/|components\//],
  ]) {
    assert.doesNotMatch(src(file), heavy, `${file} loads no view or editor`);
  }
});
