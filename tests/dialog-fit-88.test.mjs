// node --test tests/dialog-fit-88.test.mjs — every dialog fits the window (8.8 round 2, 31 Oct 2026, the reviewer:
// the template window's Start sat below the window at 1440x900: the overlay's 12vh padding and the dialog's 110px
// margin stacked, and the template list never shrank). The shared rule keeps every .dlg/.dialog under the room below
// the overlay's offset, scrolling within past that; dialogs that pin their head and foot (the template picker, the
// record form, the agent reply, the asset picker, the key dialog, the life dialog) scroll a middle region that must
// shrink (min-height: 0). New dialogs and new scroll regions join the scan below; a tall dialog anywhere fails here.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

// Window heights the brief names, in CSS pixels (the interface size is a zoom: 125% on a 900px window is 720 CSS px,
// the same as 1280x720, so proving 720 proves both).
const HEIGHTS = [900, 720];

// A flex dialog's middle region, by the dialog class that owns it: the region scrolls while the head and foot stay.
const PINNED = {
  'st-picker': 'st-list',
  'rf-dialog': 'rf-grid',
  'wu-import': 'wu-import-weeks',
  'as-picker': 'as-pick-grid',
  'life-dialog': 'ld-body',
  'sv-form-dialog': 'sv-form-body',
  'publish-dialog': 'publish-body',
};

const tsxFiles = [];
{
  const walk = (dir) => {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith('.tsx')) tsxFiles.push(path.join(dir, e.name));
    }
  };
  walk('src/renderer/src');
}

// Every dialog box with the overlay that holds it: the nearest `overlay` className above it in its own file.
const dialogs = [];
for (const f of tsxFiles) {
  const src = read(f);
  const at = [];
  for (const m of src.matchAll(/className=\{?(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)) {
    const tokens = (m[1] ?? m[2] ?? m[3]).split('${')[0].trim().split(/\s+/).filter(Boolean);
    if (tokens.includes('overlay')) at.push({ kind: 'overlay', classes: tokens });
    else if (tokens.includes('dlg') || tokens.includes('dialog')) at.push({ kind: 'dialog', classes: tokens });
  }
  let overlay = null;
  for (const e of at) {
    if (e.kind === 'overlay') overlay = e.classes;
    else dialogs.push({ file: f, classes: e.classes, overlay });
  }
}
const orphans = dialogs.filter((d) => !d.overlay);
assert.equal(orphans.length, 0, `a dialog outside an overlay: ${orphans.map((d) => `${d.file} (${d.classes.join('.')})`).join(', ')}`);
assert.ok(dialogs.some((d) => d.classes.includes('st-picker')), 'the template picker is in the scan');

// The stylesheets in the order the window loads them (main.tsx: styles.css first, kit.css last, so the shared rule
// wins its ties).
const order = [];
for (const m of read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)) order.push(m[1]);
// Only the layout sheets come after it: t300's grids, room-frames (rooms on the width system, 20 Nov 2026), compose
// (round 2) and panes (round 3: list and detail as full-window panes).
assert.ok(order[0] === 'styles.css' && order.filter((f) => f !== 'styles/t300-no-holes.css' && f !== 'styles/room-frames.css' && f !== 'styles/compose.css' && f !== 'styles/panes.css').at(-1) === 'styles/kit.css', 'styles.css first, kit.css last (only the layout sheets after it)');

// Top-level rules only (no @media/@container/@keyframes block moves a dialog: checked 31 Oct 2026).
const rules = [];
order.forEach((f, fileIdx) => {
  const src = read(`src/renderer/src/${f}`).replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) break;
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    if (!head.startsWith('@')) {
      const decls = {};
      for (const part of src.slice(open + 1, j - 1).split(';')) {
        const colon = part.indexOf(':');
        if (colon > 0) decls[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
      }
      rules.push({ selectors: head.split(',').map((s) => s.trim()), decls, fileIdx, file: f });
    }
    i = j;
  }
});

// The winning value of one property on an element: the plain class selectors it matches (.a, .a.b), most classes then
// latest file then latest rule. `overflow` answers for `overflow-x`/`overflow-y` unless beaten outright.
function winning(classes, prop) {
  const set = new Set(classes);
  let best = null;
  for (const r of rules) {
    for (const sel of r.selectors) {
      const m = /^\.[\w-]+(\.[\w-]+)*$/.exec(sel);
      if (!m) continue;
      const names = sel.slice(1).split('.');
      if (!names.every((n) => set.has(n))) continue;
      const val = r.decls[prop] ?? ((prop === 'overflow-x' || prop === 'overflow-y' ? r.decls.overflow : undefined));
      if (val === undefined) continue;
      if (!best || names.length > best.names || (names.length === best.names && r.fileIdx >= best.fileIdx)) {
        best = { val, names: names.length, fileIdx: r.fileIdx, file: r.file, sel };
      }
    }
  }
  return best;
}

// A px/vh/calc/min/max length in CSS pixels at window height H (widths never reach here: heights only).
function px(value, H) {
  const expr = value
    .replace(/(-?\d+(?:\.\d+)?)vh/g, (_, n) => `(${(+n / 100) * H})`)
    .replace(/(-?\d+(?:\.\d+)?)px/g, '($1)')
    .replace(/calc\(/g, '(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bmax\(/g, 'Math.max(');
  assert.match(expr, /^[\d\s.+\-*/(),Mathminax]+$/, `a plain length: ${value}`);
  return Function('Math', `return ${expr};`)(Math);
}

test('no dialog runs past the window: its top plus its height stay inside, at 900 and at 720', () => {
  assert.ok(dialogs.length > 10, `${dialogs.length} dialogs in the scan`);
  const seen = new Set();
  for (const d of dialogs) {
    const key = [...d.classes].sort().join('.');
    if (seen.has(key)) continue;
    seen.add(key);
    const pad = winning(d.overlay, 'padding-top');
    assert.ok(pad, `${key}: its overlay sets how far down it starts`);
    const margin = winning(d.classes, 'margin-top');
    const max = winning(d.classes, 'max-height');
    assert.ok(max, `${key}: a bounded height (the shared rule's)`);
    for (const H of HEIGHTS) {
      const top = px(pad.val, H) + (margin ? px(margin.val, H) : 0);
      const bottom = top + px(max.val, H);
      assert.ok(bottom <= H, `${key}: ${Math.round(top)} + ${Math.round(px(max.val, H))} = ${Math.round(bottom)} past ${H} (${d.file})`);
    }
  }
});

test('the template picker at the brief’s sizes: the list’s box ends above the window’s edge', () => {
  const picker = dialogs.find((d) => d.classes.includes('st-picker'));
  const pad = winning(picker.overlay, 'padding-top');
  const margin = winning(picker.classes, 'margin-top');
  const max = winning(picker.classes, 'max-height');
  for (const [H, words] of [[900, '1440x900'], [720, '1280x720 and the interface size at 125%']]) {
    const top = px(pad.val, H) + (margin ? px(margin.val, H) : 0);
    assert.ok(top + px(max.val, H) <= H, `the picker fits at ${words}`);
  }
});

test('a dialog with more in it than fits scrolls within (or pins its middle and scrolls that)', () => {
  const seen = new Set();
  for (const d of dialogs) {
    const key = [...d.classes].sort().join('.');
    if (seen.has(key)) continue;
    seen.add(key);
    const pinned = Object.keys(PINNED).some((o) => d.classes.includes(o));
    const over = winning(d.classes, 'overflow-y') ?? winning(d.classes, 'overflow');
    const within = (over && /^(auto|scroll)$/.test(over.val)) || (over?.val === 'hidden' && pinned);
    assert.ok(within, `${key}: scrolls within (${over ? over.val : 'no overflow'})`);
  }
});

test('a pinned middle shrinks: every scroll region in a flex dialog keeps min-height: 0', () => {
  for (const [owner, region] of Object.entries(PINNED)) {
    assert.ok(dialogs.some((d) => d.classes.includes(owner)), `${owner} is still in the scan`);
    const over = winning([region], 'overflow-y') ?? winning([region], 'overflow');
    assert.ok(over && /^(auto|scroll)$/.test(over.val), `${region} scrolls`);
    assert.equal(winning([region], 'min-height')?.val, '0', `${region} shrinks, so its dialog’s head and foot stay`);
  }
});
