// node --test tests/hooks-order.test.mjs — no React component calls a hook after one of its early returns (8.0, 29 Oct 2026:
// the rebuilt Graph called useRef after `if (!data) return …`, React error #310, and the whole vault window went blank,
// opening blank again because the vault reopens on its last page). A component's own top-level lines are two spaces in.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src');
const files = (dir) => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(n) ? [p] : []; });

test('no hook after an early return in a component', () => {
  const found = [];
  for (const f of files(src)) {
    let inComp = false, returned = 0;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^(export )?(default )?function [A-Z]\w*\(/.test(line)) { inComp = true; returned = 0; return; }
      if (inComp && /^\}/.test(line)) { inComp = false; return; }
      if (!inComp) return;
      if (/^  if \(.*\) return\b/.test(line) || /^  return\b/.test(line)) { if (!returned) returned = i + 1; return; }
      if (returned && /^  (const|let|\[|use)[^=]*=?\s*use[A-Z]\w*\(|^  use[A-Z]\w*\(/.test(line)) found.push(`${path.relative(src, f)}:${i + 1} (after the return at ${returned})`);
    });
  }
  assert.deepEqual(found, [], 'a hook after an early return');
});
