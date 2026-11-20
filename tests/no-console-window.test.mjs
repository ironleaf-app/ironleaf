// node --test tests/no-console-window.test.mjs — no black console window (16 Nov 2026 audit finding 10):
// every child process started from nv/src hides its console window (windowsHide). A spawn without it flashes
// a black window on the person's PC. Method calls (utilityProcess.fork, an injected fork) are not spawns. Starting
// Ironleaf itself (a windowed program) states windowsHide: false: hiding would hide its first window, and a windowed
// program has no console to flash; the key must still be written, so every spawn is a decision.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) walk(f);
    else if (/\.tsx?$/.test(f)) files.push(f);
  }
};
walk(root);

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length)).replace(/(^|\s)\/\/.*$/gm, '$1');

const CHILD_NAMES = ['spawn', 'execFile', 'execFileSync', 'execSync', 'exec', 'fork'];
const importedChild = (text) => {
  const names = new Set();
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['\"]node:child_process['\"]/g))
    for (const n of m[1].split(',')) {
      const id = n.trim().split(/\s+as\s+/).pop().trim();
      if (CHILD_NAMES.includes(id)) names.add(id);
    }
  for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['\"]node:child_process['\"]\s*\)/g))
    for (const n of m[1].split(',')) {
      const id = n.trim().split(/\s*:\s*/).pop().trim();
      if (CHILD_NAMES.includes(id)) names.add(id);
    }
  return names;
};

test('every spawn hides its console window', () => {
  const bad = [];
  for (const f of files) {
    const text = stripComments(readFileSync(f, 'utf8'));
    const names = importedChild(text);
    if (!names.size) continue;
    const re = new RegExp(`(^|[^\\w$.])(${[...names].join('|')})\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(text))) {
      const after = text.slice(m.index, m.index + 600);
      if (!/windowsHide\s*:/.test(after)) {
        const line = text.slice(0, m.index).split('\n').length;
        bad.push(`${path.relative(root, f)}:${line}: ${m[2]} without windowsHide`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('the scan itself catches a bare spawn', () => {
  const sample = `import { spawn } from 'node:child_process';\nspawn('x', [], { detached: true });\n`;
  const re = /(^|[^\w$.])(spawn|execFile|execFileSync|execSync|exec)\s*\(/g;
  const found = [];
  let m;
  while ((m = re.exec(sample))) {
    if (!/windowsHide\s*:/.test(sample.slice(m.index, m.index + 600))) found.push(m[2]);
  }
  assert.deepEqual(found, ['spawn']);
  assert.ok(!/(^|[^\w$.])(spawn)\s*\(/.test('child = d.fork(a, b); proc = utilityProcess.fork(c);'));
});
