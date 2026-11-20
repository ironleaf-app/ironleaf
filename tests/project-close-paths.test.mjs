// node --test tests/project-close-paths.test.mjs — closing a project: EVERY path that sets a project done asks
// first (p12-close-and-noise round 2). A source scan: every caller of the status edit that can write done must go
// through the shared ask-first mechanism (the CloseDialog, or the assistant's plain-words answer); anything else
// fails, so a new path that closes silently cannot slip in. Bulk actions go through the same hook, one project after
// another. Made-up paths only; it reads the sources, never the person's files.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');

/** Every source file under src/, relative, without the tests. */
function sources(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path.relative(root, full));
  }
  return out;
}
const files = sources();
const text = (rel) => readFileSync(path.join(root, rel), 'utf8');

// A file that writes status done asks first when it carries one of these: the shared dialog, the shared hook, the
// side panel's own ask, or the assistant's plain-words answer.
const ASKS = ['CloseDialog', 'useProjectCloser', 'requestDone', 'askClose', 'closeBlockedWords', 'openProjectTasks'];
const asksFirst = (rel) => ASKS.some((mark) => text(rel).includes(mark));

// Pure writers and gated proposals: the mechanism lives in their callers, or they can never fire with open tasks.
const SHARED = new Map([
  ['src/shared/projects-87.ts', 'propStatusEdits/projectBoardDrop only describe the write; ProjectPage/ProjectsHome ask first'],
  ['src/shared/project-file.ts', 'the stage applier; Lifecycle moves through the project page, which asks first'],
  ['src/shared/project-canvas.ts', 'columnValue only names the column; CanvasView asks first'],
  ['src/shared/weekly-review.ts', 'the status proposal only exists when every next step is done (allDone gate)'],
  ['src/shared/record-edits.ts', 'recordFactEdit only plans the write; Peek asks first'],
]);

test('every literal status-to-done write asks first or is a shared writer', () => {
  const skipped = [];
  for (const rel of files) {
    const lines = text(rel).split('\n');
    lines.forEach((line, i) => {
      if (!/value:\s*['"]done['"]/.test(line)) return;
      if (asksFirst(rel) || SHARED.has(rel)) return;
      skipped.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(skipped, [], `paths that set done without asking:\n${skipped.join('\n')}`);
});

test('every named path routes through the one mechanism', () => {
  // The project page: its Status control, the layout band and the lifecycle stepper (a stage move to done writes
  // the status too) — all through the one wantsDone rule.
  assert.ok(text('src/renderer/src/views/ProjectPage.tsx').includes('wantsDone'), 'the page asks through the one rule');
  assert.ok(text('src/shared/project-close.ts').includes("kind === 'stage'"), 'the rule covers a lifecycle move to done too');
  assert.ok(text('src/renderer/src/views/ProjectPage.tsx').includes('CloseDialog'), 'the page opens the shared dialog');
  // The side panel, the Projects home (Mark done and both boards), the canvas (card status and portfolio drags)
  // and the peek (a project record status).
  assert.ok(text('src/renderer/src/panels/Navigator.tsx').includes('askClose'), 'the side panel asks first');
  for (const rel of ['src/renderer/src/views/ProjectsHome.tsx', 'src/renderer/src/views/CanvasView.tsx', 'src/renderer/src/components/Peek.tsx']) {
    assert.ok(text(rel).includes('useProjectCloser') || text(rel).includes('requestDone'), `${rel} asks through the shared hook`);
  }
  // The assistant's tools never close silently: the open tasks come back in plain words.
  for (const rel of ['src/main/agent-access.ts', 'src/main/agent-full.ts', 'src/main/agent.ts']) {
    assert.ok(text(rel).includes('closeBlockedWords'), `${rel} answers with the open tasks instead of closing`);
  }
  // The shared writers above are still shared (their callers still ask): none grew its own write.
  for (const [rel] of SHARED) assert.ok(files.includes(rel), `${rel} still exists`);
});

test('bulk closes ask for each project in turn', () => {
  // The shared hook keeps a queue: dropping several cards on Done opens one dialog after another, never silently.
  const hook = text('src/renderer/src/views/project/useProjectCloser.tsx');
  assert.ok(/queue/i.test(hook), 'the shared hook queues blocked projects');
  assert.ok(hook.includes('CloseDialog'), 'the queue opens the shared dialog');
});
