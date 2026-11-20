#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The fast unit checks (CI and before a pull request): every tests/*.test.mjs that does not start Electron, a browser
// or another process and does not need the built app (out/). The long UI walks run with `npm test` on a desktop.
//   node tools/test-fast.mjs [--list]
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLOW = /electron|playwright|xvfb|spawn\(|execFile|out\/main|harness|chromium|headless|Page\.navigate|Runtime\.evaluate/;
const read = (f) => readFileSync(path.join(root, 'tests', f), 'utf8');
// A check is slow if it, or a helper in tests/ it imports (t152-lib.mjs, the browser harness), starts something.
const slow = (f) => {
  const text = read(f);
  if (SLOW.test(text)) return true;
  return [...text.matchAll(/['"]\.\/([\w.-]+\.mjs)['"]/g)].some(([, helper]) => !helper.endsWith('.test.mjs') && SLOW.test(read(helper)));
};
export const fastTests = () =>
  readdirSync(path.join(root, 'tests'))
    .filter((f) => f.endsWith('.test.mjs') && !slow(f))
    .sort()
    .map((f) => path.join('tests', f));

const list = fastTests();
if (process.argv.includes('--list')) {
  console.log(list.join('\n'));
  process.exit(0);
}
const r = spawnSync(process.execPath, ['--test', ...list], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
