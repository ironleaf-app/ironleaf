// node --test tests/layout-fit.test.mjs — how the window's sides fit at its size (src/shared/layout-fit.ts; 17 Oct 2026,
// with a narrowed window). At every width a person might use, the middle keeps a readable width, the sides keep to their
// limits, a side that can't dock steps aside (the left first) and opens as a drawer only when asked, and nothing adds up
// to more than the window.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-fit-'));
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/layout-fit.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'fit.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'fit.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const input = (width, { left = true, right = true, lw = 280, rw = 380, drawer = null } = {}) => ({ width, left: { open: left, width: lw }, right: { open: right, width: rw }, drawer });

test('a wide window docks both sides at the widths the person set', () => {
  const fit = F.fitSides(input(1600));
  assert.equal(fit.left, 'docked');
  assert.equal(fit.right, 'docked');
  assert.equal(fit.leftWidth, 280);
  assert.equal(fit.rightWidth, 380);
  assert.equal(fit.middle, 1600 - F.RIBBON - 280 - 380);
});

test('at every width, docked sides and the middle add up to the window, and the middle stays readable', () => {
  for (let width = 500; width <= 2560; width += 10) {
    for (const [lw, rw] of [[280, 380], [480, 640], [200, 300], [900, 1200], [0, NaN]]) {
      for (const [left, right] of [[true, true], [true, false], [false, true], [false, false]]) {
        const fit = F.fitSides(input(width, { left, right, lw, rw }));
        const docked = (fit.left === 'docked' ? fit.leftWidth : 0) + (fit.right === 'docked' ? fit.rightWidth : 0);
        assert.equal(F.RIBBON + docked + fit.middle, width, `adds up at ${width}`);
        if (docked) assert.ok(fit.middle >= F.MIDDLE_MIN, `middle ${fit.middle} at ${width} (${lw}/${rw})`);
        if (fit.left === 'docked') assert.ok(fit.leftWidth >= F.SIDE_LIMITS.left.min && fit.leftWidth <= F.SIDE_LIMITS.left.max);
        if (fit.right === 'docked') assert.ok(fit.rightWidth >= F.SIDE_LIMITS.right.min && fit.rightWidth <= F.SIDE_LIMITS.right.max);
        // Never docked when closed; nothing shows as a drawer unless asked.
        if (!left) assert.notEqual(fit.left, 'docked');
        if (!right) assert.notEqual(fit.right, 'docked');
        assert.notEqual(fit.left, 'drawer');
        assert.notEqual(fit.right, 'drawer');
      }
    }
  }
});

test("a narrowed window (about 920 px): the chat keeps its place, the file list steps aside", () => {
  const fit = F.fitSides(input(920, { rw: 640 }));
  assert.equal(fit.right, 'docked');
  assert.equal(fit.left, 'hidden');
  assert.ok(fit.middle >= F.MIDDLE_MIN);
});

test('sides give up width before stepping aside', () => {
  const fit = F.fitSides(input(1100));
  assert.equal(fit.left, 'docked');
  assert.equal(fit.right, 'docked');
  assert.ok(fit.leftWidth < 280 && fit.rightWidth < 380);
  assert.equal(fit.middle, F.MIDDLE_MIN);
});

test('a small window docks nothing; a side asked for opens as a drawer, never covering the whole window', () => {
  const fit = F.fitSides(input(760));
  assert.equal(fit.left, 'hidden');
  assert.equal(fit.right, 'hidden');
  const asked = F.fitSides(input(760, { drawer: 'right', rw: 2000 }));
  assert.equal(asked.right, 'drawer');
  assert.ok(asked.rightWidth <= 760 - F.RIBBON - F.DRAWER_GAP);
  const tiny = F.fitSides(input(420, { drawer: 'left' }));
  assert.equal(tiny.left, 'drawer');
  assert.ok(tiny.leftWidth <= Math.max(160, 420 - F.RIBBON - F.DRAWER_GAP));
});

test('canDock and the most a side may be dragged to', () => {
  assert.equal(F.canDock('right', input(1600, { right: false })), true);
  assert.equal(F.canDock('right', input(760, { right: false })), false);
  // With the right side docked at 1366, the left can be dragged only as far as leaves the middle readable.
  const i = input(1366);
  const most = F.maxDockedWidth('left', i);
  const fit = F.fitSides({ ...i, left: { open: true, width: most } });
  assert.equal(fit.left, 'docked');
  assert.ok(fit.middle >= F.MIDDLE_MIN);
});
