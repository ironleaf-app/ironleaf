// node --test tests/uplift-95-kit.test.mjs — one kit, no dialects (9.5 polished, 1 Nov 2026). Buttons: .btn/.button are
// two spellings of one scale (the premium finish styles both, and the old base duplicates are gone, so the two can never
// drift again); a primary keeps its primary look on hover (the premium hover used to wash every primary, .btn.pri missed,
// to the pale selection tint with pale words). Switches: the one square coral switch everywhere (10.0 Endless Tech; the
// w4a-87 pin keeps the Settings restatement). Dialogs: one shell, and the form rules live with .dialog instead of the
// capture-flows sheet. States: PageEmpty renders EmptyState; prompts share the dialog message style. Fails without each
// change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cssPxFor } from './css-px.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => cssPxFor(f, readFileSync(path.join(root, f), 'utf8'));
const norm = (s) => s.replace(/\s+/g, ' ').trim();

test('the premium finish styles .btn as the same scale as .button', () => {
  const premium = read('src/renderer/src/styles/premium-layer.css');
  // Base size: a .btn twin of the pinned .button rule (the pin keeps its exact text; the twin sits beside it).
  const base = premium.match(/:is\(\.btn[^)]*\) \{\s*height: 32px;[^}]*border-radius: var\(--r-2\);[^}]*font-size: var\(--fs-small\);[^}]*font-weight: 600;/);
  assert.ok(base, '.btn twin of the one button rule (32 px, radius 6, 13 px semibold)');
  // The finish's own border, shadow, hover, primary and focus reach .btn too, with the same declarations.
  for (const [btn, button] of [['.btn', '.button'], ['.btn.pri', '.button.primary']]) {
    const decls = (sel) => [...premium.matchAll(new RegExp(`:root [^{]*${sel.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`, 'g'))].map((m) => norm(m[1])).join(' | ');
    assert.ok(decls(btn).length > 0, `premium styles ${btn}`);
    assert.ok(decls(button).length > 0, `premium styles ${button}`);
  }
  assert.ok(premium.includes('.btn:hover'), '.btn shares the hover finish');
  assert.ok(premium.includes('.btn.pri'), '.btn.pri shares the primary finish');
  assert.ok(premium.includes('.btn.quiet'), '.btn.quiet shares the quiet finish');
});

test('a primary keeps its primary look on hover', () => {
  const premium = read('src/renderer/src/styles/premium-layer.css');
  const hover = premium.match(/:root \.button:hover:not\(\:disabled\)([^{]*)\{([^}]*)\}/);
  assert.ok(hover, 'the premium button hover rule exists');
  assert.ok(/:not\(\.primary\)/.test(hover[1]), 'it leaves .button.primary alone');
  assert.ok(!/\.btn\.pri|\.button\.primary/.test(hover[0]) || /:not/.test(hover[1]), 'no primary is washed to the pale tint');
});

test('either primary name paints on either button (.btn.pri, .btn.primary, .button.pri, .button.primary)', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  // Selector boundaries: `.button.primary` must not satisfy `.button.pri`.
  for (const sel of ['.btn.pri', '.btn.primary', '.button.pri', '.button.primary']) {
    assert.ok(new RegExp(sel.replace(/\./g, '\\.') + '(?=[, :{])').test(kit), `kit paints ${sel}`);
  }
  const premium = read('src/renderer/src/styles/premium-layer.css');
  for (const sel of [':root .button.pri', ':root .btn.primary']) {
    assert.ok(new RegExp(sel.replace(/\./g, '\\.').replace(/ /g, ' ') + '(?=[, :{])').test(premium), `premium paints ${sel}`);
  }
});

test('styles.css owns no button base to drift from the kit', () => {
  const css = read('src/renderer/src/styles.css');
  assert.doesNotMatch(css, /^\.button \{/m, 'no .button base duplicate (kit.css owns it)');
  assert.doesNotMatch(css, /^\.button\.primary \{/m, 'no .button.primary duplicate');
  assert.doesNotMatch(css, /^\.button\.primary:hover/m, 'no .button.primary:hover duplicate');
  assert.doesNotMatch(css, /^\.button:hover/m, 'no .button:hover duplicate');
  // The variants only styles.css carries stay: the filled danger and the large size.
  assert.match(css, /^\.button\.danger \{/m, '.button.danger stays');
  assert.match(css, /^\.button\.large \{/m, '.button.large stays');
});

test('one switch: square and on in primary everywhere, as the host app and Settings', () => {
  const base = read('src/renderer/src/styles.css');
  const sw = base.match(/input\[type='checkbox'\]\.switch \{([^}]*)\}/s)?.[1] ?? assert.fail('no base switch');
  assert.ok(sw.includes('border-radius: var(--r-1)'), 'the base switch is a square track');
  assert.ok(sw.includes('width: 44px') && sw.includes('height: 24px'), 'the base switch is the Settings size');
  const on = base.match(/input\[type='checkbox'\]\.switch:checked \{([^}]*)\}/s)?.[1] ?? assert.fail('no base switch on');
  assert.ok(on.includes('background: var(--primary)'), 'the base switch is on in primary');
  const knob = base.match(/input\[type='checkbox'\]\.switch::after \{([^}]*)\}/s)?.[1] ?? assert.fail('no base switch knob');
  assert.ok(knob.includes('border-radius: var(--r-1)'), 'the base knob is square');
  assert.ok(knob.includes('width: 16px') && knob.includes('height: 16px'), 'the base knob is 16 px');
});

test('one dialog shell, and the form rules live with it', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  // Design language (23 Nov 2026): the shell's inset is one 24px step all round (was 22 above and below).
  assert.match(kit, /\.dlg, \.dialog \{[^}]*padding: 24px;/, 'kit groups .dlg and .dialog on one shell');
  const css = read('src/renderer/src/styles.css');
  assert.doesNotMatch(css, /^\.dialog \{\s*width: min\(640px/m, 'no styles.css dialog geometry duplicate');
  assert.doesNotMatch(css, /^\.dialog \{\s*padding: 20px 22px;/m, 'no styles.css dialog padding duplicate');
  assert.doesNotMatch(css, /^\.dialog-actions \{/m, 'no styles.css dialog-actions duplicate (kit owns it)');
  assert.ok(css.includes('.dialog {') && css.includes('rise-in'), 'styles.css keeps only the dialog rise');
  assert.match(css, /^\.dialog-message \{/m, 'styles.css keeps the dialog message');
  // The form dialog's own rules sit with .dialog now, not in the capture-flows sheet.
  for (const sel of ['.dialog-form', '.dialog-field', '.dialog-check']) {
    assert.ok(css.includes(sel), `styles.css carries ${sel}`);
    assert.ok(!read('src/renderer/src/styles/capture-flows.css').includes(sel), `capture-flows.css no longer carries ${sel}`);
  }
});

test('one empty state: PageEmpty renders EmptyState', () => {
  const states = read('src/renderer/src/components/PageStates.tsx');
  assert.ok(states.includes('export function PageEmpty'), 'PageEmpty stays exported (pages-w4b pins its callers)');
  assert.ok(/from '\.\/EmptyState'/.test(states), 'PageEmpty shares EmptyState');
  assert.ok(/<EmptyState/.test(states), 'PageEmpty renders EmptyState, not a parallel look');
  const empty = read('src/renderer/src/components/EmptyState.tsx');
  assert.ok(empty.includes('label?: string'), 'EmptyState takes the status label PageEmpty carried');
});

test('a prompt shares the dialog message style', () => {
  const dialogs = read('src/renderer/src/components/Dialogs.tsx');
  assert.ok(!/<p className="hint">\{ask\.message\}<\/p>/.test(dialogs), 'PromptBody no longer uses the faint hint style');
  assert.ok(dialogs.includes('<div className="dialog-message">{ask.message}</div>'), 'the prompt message shares .dialog-message');
});
