// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test tests/ui-ratchet.test.mjs — the UI ratchet (AGENTS.md, docs/DESIGN.md). It counts what the design rules
// and Modern Web Guidance say to move away from, and holds each count against tests/ui-ratchet.json: a count may
// only go down. When a change lowers one, the test fails with the new figure so the commit lowers the file too,
// and the line never slips back. Never raise a number to make this pass.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = path.join(root, 'src', 'renderer', 'src');
const baseline = JSON.parse(readFileSync(path.join(root, 'tests', 'ui-ratchet.json'), 'utf8'));

const walk = (dir, ext) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'assets' || e.name === 'node_modules' ? [] : walk(p, ext);
    return ext.test(e.name) ? [p] : [];
  });
const css = walk(renderer, /\.css$/).map((f) => ({ f, s: readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
const tsx = walk(renderer, /\.tsx$/).map((f) => ({ f, s: readFileSync(f, 'utf8') }));
const count = (files, re, keep = () => true) => files.reduce((n, { f, s }) => n + [...s.matchAll(re)].filter((m) => keep(m, f)).length, 0);

/** What is counted. Each one has a rule in docs/DESIGN.md. */
function measure() {
  const notPalette = css.filter(({ f }) => path.basename(f) !== 'palettes.css');
  return {
    // Colours belong in palettes.css as role tokens (DESIGN.md §2).
    colourLiterals: count(notPalette, /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]/g),
    // Padding, margin and gap come from the spacing scale, not raw pixels (DESIGN.md §2).
    rawSpacing: count(css, /\b(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?\s*:\s*([^;}]*)/g, (m) => /(?<![\w.-])(?:\d*\.)?[1-9]\d*(?:\.\d+)?px\b/.test(m[1])),
    // Shadows are the elevation tokens --e-1…3 (DESIGN.md §2).
    rawShadows: count(css, /\bbox-shadow\s*:\s*([^;}]*)/g, (m) => !/^\s*(?:none|var\(--[\w-]+\)\s*(?:!important)?\s*)$/.test(m[1])),
    // !important is the sign of rules fighting each other.
    important: count(css, /!important/g),
    // Anything clickable is a <button> or <a>; a clickable div, span or li needs at least a role (DESIGN.md §4).
    clickableWithoutRole: count(tsx, /<(?:div|span|li)\b((?:[^>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*\})*?)\bonClick=/g, (m) => !/\brole=/.test(m[1])),
  };
}

/** Modern Web Guidance's legacy-pattern scan of the renderer, by guide. */
function legacyScan() {
  const cli = path.join(root, 'node_modules', 'modern-web-guidance', 'skills', 'modern-web-guidance', 'modern-web.mjs');
  // A plain Node script with no window, so this check belongs in test:fast and runs in CI on Linux and Windows.
  const r = spawnSync(process.execPath, [cli, 'legacy-scan', renderer, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  const scan = JSON.parse(out.slice(out.indexOf('{')));
  return Object.fromEntries(scan.guides.filter((g) => g.count > 0).map((g) => [g.guideId, g.count]).sort(([a], [b]) => a.localeCompare(b)));
}

function hold(name, now, was) {
  const lines = [];
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const n = now[key] ?? 0;
    const b = was[key] ?? 0;
    if (n > b) lines.push(`${name}.${key} went UP: ${b} → ${n}. Use the tokens or the platform feature instead (docs/DESIGN.md; npx modern-web-guidance search …).`);
    else if (n < b) lines.push(`${name}.${key} went down: ${b} → ${n}. Well done: set it to ${n} in tests/ui-ratchet.json in this commit.`);
  }
  return lines;
}

test('the CSS and markup counts only go down', () => {
  const problems = hold('css', measure(), baseline.css);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('Modern Web Guidance legacy patterns only go down', { timeout: 120_000 }, () => {
  const problems = hold('legacy', legacyScan(), baseline.legacy);
  assert.deepEqual(problems, [], problems.join('\n'));
});
