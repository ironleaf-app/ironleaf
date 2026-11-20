// node --test tests/status-colour.test.mjs — Vault's status colours follow the one rule the former host app
// follows (p13-vault-status, 4 Nov 2026). One set of status tokens, same names and default values as the
// former host app's theme.css: status neutral ink, attention the person's accent, danger for real errors
// only. On track and In progress neutral; At risk, Off track and Overdue attention, Off track stronger in
// weight, never a third hue; progress rings and bars neutral or accent, never green. Words stay. Each check
// fails without its fix, and the last guard fails on any literal green or amber status colour.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const rule = (css, start) => {
  const at = css.indexOf(start);
  assert.ok(at >= 0, `${start} exists`);
  return css.slice(at, css.indexOf('}', at));
};

test('one status set, same names and values as the host app, light and dark', () => {
  const css = read('src/renderer/src/styles.css');
  const light = css.slice(0, css.indexOf(":root[data-theme='dark']"));
  const dark = css.slice(css.indexOf(":root[data-theme='dark']"));
  for (const t of ['--ns-status:', '--ns-status-soft:', '--ns-attention:', '--ns-attention-words:', '--ns-error:', '--ns-error-soft:']) {
    assert.ok(light.includes(t), `light defines ${t}`);
    assert.ok(dark.includes(t), `dark defines ${t}`);
  }
  assert.ok(/--ns-status:\s*var\(--text\)/.test(light), 'status is the neutral ink');
  assert.ok(/--ns-attention:\s*var\(--accent\)/.test(light), 'attention follows the person’s accent');
  assert.ok(/--ns-attention-words:\s*var\(--accent-text/.test(light), 'attention words read in the accent');
  assert.ok(/--ns-error:\s*var\(--danger\)/.test(light), 'errors are the danger colour');
});

test('project health chips: on track neutral, at risk and off track attention, off track stronger', () => {
  const css = read('src/renderer/src/styles.css');
  assert.ok(rule(css, '.pj-pill.tone-ok,').includes('--ns-status'), 'on track neutral');
  assert.ok(rule(css, '.pj-pill.tone-warn,').includes('--ns-attention-words'), 'at risk attention');
  assert.ok(rule(css, '.pj-pill.tone-bad,').includes('--ns-attention-words'), 'off track attention, never a third hue');
  assert.ok(rule(css, '.pj-pill.tone-bad {').includes('font-weight: 700'), 'off track stronger in weight');
  assert.ok(!/\.pj-pill\.tone-(ok|warn|bad)[\s\S]{0,200}--tone-(ok|warn|bad)/.test(css), 'no green or amber tone left on pills');
});

test('progress bars and rings: neutral or accent, never green', () => {
  const css = read('src/renderer/src/styles.css');
  assert.ok(rule(css, '.pj-progress-fill.tone-ok {').includes('--ns-status'), 'an on-track bar is neutral');
  assert.ok(rule(css, '.pj-progress-fill.tone-warn,').includes('--ns-attention'), 'an at-risk bar is attention');
  const layouts = read('src/renderer/src/styles/layouts.css');
  assert.ok(rule(layouts, '.ly-ring.tone-ok {').includes('--ns-status'), 'an on-track ring is neutral');
  assert.ok(rule(layouts, '.ly-ring.tone-warn,').includes('--ns-attention'), 'an at-risk ring is attention');
  assert.ok(rule(layouts, '.ly-pct.tone-ok,').includes('--ns-status'), 'progress sliders start neutral');
  const today = read('src/renderer/src/styles/today.css');
  assert.ok(rule(today, '.td-mini > span.tone-ok {').includes('--ns-status'), 'Today’s bars neutral on track');
});

test('Today: project dots, when-lines and health read the one set', () => {
  const css = read('src/renderer/src/styles/today.css');
  assert.ok(rule(css, '.td-project.tone-ok {').includes('--ns-status'), 'an on-track dot is neutral');
  assert.ok(rule(css, '.td-project.tone-warn,').includes('--ns-attention'), 'an at-risk dot is attention');
  assert.ok(rule(css, '.td-when.tone-bad {').includes('--ns-attention-words'), 'a late when-line is attention');
  assert.ok(!/\.td-health\.tone-ok \{[^}]*--tone-ok/.test(css), 'no green health dot');
  assert.ok(!/\.td-health\.tone-warn \{[^}]*--tone-warn/.test(css), 'no amber health dot');
});

test('plan status in plain words: attention for at-risk and off track, off track stronger, never a third hue', () => {
  // 5 Nov 2026, the plan: filled pills became plain words, dots removed — weight and colour
  // carry the distinction (off track bold), not a dot. Still one hue for attention, muted otherwise.
  const css = read('src/renderer/src/styles/plan.css');
  assert.ok(rule(css, '.plan-status-words.is-muted {').includes('--text-muted'), 'on track muted');
  assert.ok(rule(css, '.plan-status-words.is-attention {').includes('--accent-strong'), 'at risk attention, strong enough to read 4.5:1 on the page');
  assert.ok(rule(css, '.plan-status-words.is-attention.is-strong {').includes('700'), 'off track stronger in weight');
  assert.ok(!/\.plan-status-words[^{]*\{[^}]*background:\s*var\(--(slate|red|amber)-bg/.test(css), 'plain words carry no fill');
  const pill = read('src/renderer/src/components/plan/StatusPill.tsx');
  assert.ok(pill.includes("s.tone === 'bad'") && pill.includes('is-attention is-strong'), 'off track reads strong when flat');
  assert.ok(!pill.includes('<span className="dot"'), 'no dot on plain words');
  const peek = read('src/renderer/src/styles/peek.css');
  assert.ok(rule(peek, '.peek-tone.tone-ok {').includes('--ns-status'), 'the peek’s on track neutral');
  assert.ok(rule(peek, '.peek-tone.tone-bad {').includes('--ns-attention-words'), 'the peek’s off track attention');
});

test('Desk Hub workstream cards and flags read the one set', () => {
  const rm = read('src/renderer/src/styles/record-modules.css');
  assert.ok(rule(rm, '.rm-pill.tone-ok {').includes('--ns-status'), 'an on-track flag neutral');
  assert.ok(rule(rm, '.rm-pill.tone-warn {').includes('--ns-attention'), 'an at-risk flag attention');
  const wu = read('src/renderer/src/styles/work-weekly.css');
  assert.ok(rule(wu, '.wu-flag.tone-ok {').includes('--ns-status'), 'a workstream on track neutral');
  assert.ok(rule(wu, '.wu-tl-dot.tone-ok {').includes('--ns-status'), 'its history dots neutral on track');
  assert.ok(!/\.wu-flag\.tone-ok \{[^}]*--tone-ok/.test(wu), 'no green flag left');
});

test('Projects list, board and Overview: neutral unless attention is needed', () => {
  // 5 Nov 2026, the plan: columns and health read plain words (is-attention/is-muted classes),
  // off track strong, never a dot or inline fill.
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(home.includes("tone === 'warn' || tone === 'bad' ? 'red' : 'slate'"), 'timeline bars neutral unless attention');
  assert.ok(home.includes("col.id === 'off-track' ? 'is-attention is-strong'"), 'the off-track column reads strong');
  assert.ok(home.includes("col.id === 'at-risk' ? 'is-attention'"), 'the at-risk column reads attention');
  assert.ok(!home.includes('<span className="dot"'), 'no dot on plain words');
  const shared = read('src/shared/projects-87.ts');
  assert.ok(shared.includes("'at-risk': 'red'") && shared.includes("'on-track': 'slate'"), 'shared tints neutral unless attention');
  const hub = read('src/renderer/src/styles/project-hub.css');
  assert.ok(rule(hub, '.ph-att.tone-warn {').includes('--ns-attention-words'), 'Overview attention rows attention');
  assert.ok(rule(hub, '.pt-span.tone-ok {').includes('--ns-status'), 'its timeline spans neutral on track');
});

test('no literal green or amber status colour left on any status selector', () => {
  const sheets = {
    styles: read('src/renderer/src/styles.css'),
    today: read('src/renderer/src/styles/today.css'),
    plan: read('src/renderer/src/styles/plan.css'),
    peek: read('src/renderer/src/styles/peek.css'),
    hub: read('src/renderer/src/styles/project-hub.css'),
    rm: read('src/renderer/src/styles/record-modules.css'),
    wu: read('src/renderer/src/styles/work-weekly.css'),
    layouts: read('src/renderer/src/styles/layouts.css'),
    ws: read('src/renderer/src/styles/project-workspace.css'),
    life: read('src/renderer/src/styles/life.css'),
  };
  const selectors = [
    ['styles', '.pj-pill.tone-'], ['styles', '.pj-dot.tone-'], ['styles', '.pj-progress-fill.tone-'],
    ['styles', '.pj-due.tone-'], ['styles', '.pj-chip.tone-'], ['styles', '.pj-level.level-'],
    ['today', '.td-health.tone-'], ['today', '.td-project.tone-'], ['today', '.td-mini > span.tone-'],
    ['today', '.td-when.tone-'], ['today', '.td-level'],
    ['plan', '.plan-pill.tone-'], ['peek', '.peek-tone.tone-'],
    ['hub', '.ph-att.tone-'], ['hub', '.pt-status.tone-'], ['hub', '.pt-span.tone-'],
    ['rm', '.rm-pill.tone-'], ['wu', '.wu-flag.tone-'], ['wu', '.wu-tl-dot.tone-'],
    ['layouts', '.ly-ring.tone-'], ['layouts', '.ly-pct.tone-'], ['layouts', '.ly-track-dot.tone-'],
    ['ws', '.ws-pill.tone-'], ['ws', '.ws-dot.tone-'],
    ['life', '.ar-pill.tone-'],
  ];
  const greenAmber = /--tone-ok|--tone-warn|--ok\b|--warn\b|#2e7d5b|#b26b00|#3f7a49|#9a6713|#8fcb95|#dcae55|#e4efe6|#eaeee6|#74c69d|#e3b25e|#e2a64a/;
  for (const [sheet, sel] of selectors) {
    const css = sheets[sheet];
    let i = -1;
    const bad = [];
    while ((i = css.indexOf(sel, i + 1)) >= 0) {
      const end = css.indexOf('}', i);
      const chunk = css.slice(i, end < 0 ? i + 300 : end);
      if (greenAmber.test(chunk)) bad.push(chunk.slice(0, 100));
    }
    assert.equal(bad.length, 0, `${sheet} ${sel} carries no green or amber: ${bad.join(' | ')}`);
  }
  // Components name no green or amber tint for a health or status.
  const home = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(!/tone === 'ok' \? 'green'/.test(home), 'Projects list names no green health');
  assert.ok(!/tone === 'warn' \? 'amber'/.test(home), 'Projects list names no amber health');
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(!/tone === 'ok' \? 'green'/.test(page), 'the project page names no green health');
  const area = read('src/renderer/src/views/AreaPage.tsx');
  assert.ok(!/ar-pill tone-ok.*status/.test(area), 'a finished area card carries no green pill');
});
