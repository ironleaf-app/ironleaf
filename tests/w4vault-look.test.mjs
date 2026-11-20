// node --test tests/w4vault-look.test.mjs — Wave 4 Vault rooms wear Endless Tech (10.0, 2 Nov 2026, look B
// "Endless Tech"). One static check per mechanism over the 41 room stylesheets and the room views: sentence case
// (no uppercase transform, no tracked caps, no ALL-CAPS label literals), paint only through named tokens, ink tab
// underlines, kit on-states, r-3 cards, r-4 dialogs, no pills, no cream, no em dashes in UI words. One coral
// accent (Wave 4 finish, the reviewer: Vault still paints coral everywhere): actions and links are ink, send is
// primary, tags are plain rectangles, selected filters are the soft fill, and no action, link, chip, tag, filter
// or send selector reaches for coral. Fails without each change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src/renderer/src');
const read = (p) => readFileSync(path.join(dir, p), 'utf8');

// The rooms, in daily-use order: Today; note + editor; projects + layouts; views; modules; search; empty states.
// t27-unused-panels: related.css is gone with the side's Related notes panel; the foot's Linked list wears note-foot.css.
const ROOMS = [
  'today.css', 'today-hub.css', 'home.css', 'vault-home.css', 'note-page.css', 'note-context.css',
  'note-foot.css', 'suggestions.css', 'peek.css', 'search-ask-87.css', 'file-search.css',
  'notes-inbox-search-graph.css', 'project-hub.css', 'project-page.css', 'layouts.css', 'plan.css',
  'project-workspace.css', 'saved-views.css', 'types.css', 'life.css', 'life-records.css', 'work-meetings.css',
  'work-sites.css', 'work-vendors.css', 'work-weekly.css', 'work-modules.css', 'health.css', 'family.css',
  'publications.css', 'personal-modules.css', 'record-modules.css', 'modules.css', 'module-purpose.css',
  'people-meetings.css', 'meetings-reviews.css', 'recorder.css', 'reminders.css', 'weekly-tidy.css',
  'changes.css', 'privacy.css', 'page-states-87.css',
];
const roomFiles = () => {
  const found = [];
  for (const f of ROOMS) {
    try { read(`styles/${f}`); found.push(f); } catch { assert.fail(`room sheet gone: styles/${f}`); }
  }
  return found;
};

/** Rules only: comments, pure :root token blocks and @media print (paper output) hold no room paint. */
function rulesOf(file) {
  let css = read(`styles/${file}`);
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  css = css.replace(/@media print\s*\{[\s\S]*?\n\}\n?/g, '');
  css = css.replace(/:root(\[[^\]]*\]|:[a-z-]+\([^)]*\))*\s*\{[^{}]*\}/g, '');
  return css;
}

/** Paint only: a custom-property definition (--name: #hex) is a named token, not inline paint. */
const paintOf = (css) => css.replace(/--[a-zA-Z0-9-]+\s*:[^;{}]+;/g, ';');

/** The base sheet's rules (styles.css lives beside styles/, not in it). */
function baseRules() {
  let css = read('styles.css');
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  css = css.replace(/:root(\[[^\]]*\]|:[a-z-]+\([^)]*\))*\s*\{[^{}]*\}/g, '');
  return css;
}

/** The first room rule for a selector, wherever it lives. */
function roomRule(sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const f of ROOMS) {
    const m = rulesOf(f).match(new RegExp(`${esc}[^{]*\\{([^{}]*)\\}`, 's'));
    if (m) return m[1];
  }
  return null;
}

/** Printed matter keeps print conventions: the magazine front, the made-page view, the puzzles. */
const PAPER = [/\.pb-front[a-z-]*/, /\.pb-made[a-z-]*/, /\.pz-[a-z-]*/, /\.pb-template-art[a-z-]*/];
const unpaper = (css) => {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (PAPER.some((p) => sel.split(',').every((s) => p.test(s.trim())))) css = css.replace(m[0], '');
  }
  return css;
};

// Printed caps: the masthead rule, the word list, the letter tiles, the Across/Down heads. Capitalised first
// letters and avatar initials are sentence case already, not tracked caps.
const CAPS_OK = new Set(['.pb-front-line', '.pz-words', '.pz-dw i', '.pz-clues h5', '.field-key > span::first-letter', '.pm .pm-avatar']);
// Wide-spaced DATA in mono, never labels: masked secrets (dots breathe; shown values drop to 0.02em) and plates.
const TRACK_OK = new Set(['.sl-value', '.sx-value', '.sx-masked-input', '.pm .pm-plate']);

test('no uppercase transform in the rooms: section names are small, weight 600, muted', () => {
  for (const file of roomFiles()) {
    for (const m of rulesOf(file).matchAll(/([^{}]+)\{([^{}]*text-transform\s*:\s*uppercase[^{}]*)\}/g)) {
      const sel = m[1].trim().split(/\s+/).join(' ');
      assert.ok(CAPS_OK.has(sel), `${file}: tracked caps survive (${sel})`);
    }
  }
});

test('no tracked all-caps: positive letter-spacing only on printed matter', () => {
  for (const file of roomFiles()) {
    for (const m of rulesOf(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim().split(/\s+/).join(' ');
      if (CAPS_OK.has(sel) || TRACK_OK.has(sel)) continue;
      if (PAPER.some((p) => sel.split(',').every((s) => p.test(s.trim())))) continue;
      for (const t of m[2].matchAll(/letter-spacing\s*:\s*([^;]+);/g)) {
        const v = t[1].trim();
        const em = v.match(/^([\d.]+)em$/);
        assert.ok(!em || Number(em[1]) < 0.03, `${file} ${sel}: tracked ${v}`);
      }
    }
  }
});

test('no pills in the rooms: no 999px or 99px radius', () => {
  for (const file of roomFiles()) {
    for (const m of rulesOf(file).matchAll(/border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;]+);/g))
      assert.ok(!/99px/.test(m[1]), `${file}: a pill survives (${m[1].trim()})`);
  }
});

test('room type sizes are the scale, through the tokens', () => {
  for (const file of roomFiles()) {
    const css = rulesOf(file);
    for (const m of css.matchAll(/font-size\s*:\s*([^;]+);/g))
      assert.ok(!/\dpx/.test(m[1]), `${file}: a font-size off the scale (${m[1].trim()})`);
    for (const m of css.matchAll(/(?<![a-z-])font\s*:\s*([^;]+);/g)) {
      const size = m[1].replace(/\/[\d.]+(px)?/g, '').replace(/[\d.]+pt/g, '');
      assert.ok(!/\dpx/.test(size), `${file}: a font size off the scale (${m[1].trim().slice(0, 80)})`);
    }
  }
});

test('no raw colour in room paint: every colour through a named token', () => {
  for (const file of roomFiles()) {
    const paint = unpaper(paintOf(rulesOf(file)));
    const hex = paint.match(/#[0-9a-fA-F]{3,8}\b/);
    assert.ok(!hex, `${file}: raw ${hex?.[0]} painted outside a token`);
    assert.ok(!/(?<![a-z-])rgba?\([^)]*\)/.test(paint.replace(/rgba?\(\s*20,\s*26,\s*46[^)]*\)/g, '').replace(/rgba?\(\s*27,\s*34,\s*53[^)]*\)/g, '').replace(/rgba?\(\s*0,\s*0,\s*0[^)]*\)/g, '')), `${file}: a raw rgb() painted outside a token`);
  }
});

test('no cream or warm tones in the rooms', () => {
  const warm = (hex) => {
    const h = hex.length <= 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1, 7);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return Math.min(r, g, b) >= 190 && r - b >= 8;
  };
  for (const file of roomFiles()) {
    for (const m of unpaper(paintOf(rulesOf(file))).matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g))
      assert.ok(!warm(m[0]), `${file}: warm ${m[0]}`);
  }
});

test('tabs underline in ink, never coral', () => {
  for (const [file, sel] of [['project-hub.css', '.ph-tab.is-on'], ['recorder.css', '.mp-parts button.is-on']]) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = rulesOf(file).match(new RegExp(`${esc}\\s*\\{([^{}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel} in ${file}`);
    assert.ok(!/var\(--(accent|coral)\)/.test(rule), `${file} ${sel} still underlines in coral`);
    assert.ok(rule.includes('var(--text-strong)'), `${file} ${sel} underlines in ink`);
  }
});

test('where you are is a soft fill with weight, never coral', () => {
  // Kit parity: .tab.on underlines ink, .chip.on fills navy, .srow/.frow.on fill soft. Room selectors that mark
  // the current filter, day, layout or part must not paint accent, coral or their softs.
  const spots = [
    ['today-hub.css', '.th-day.is-selected'], ['today-hub.css', '.th-day.is-selected .th-num'],
    ['work-meetings.css', '.wu-chip.is-on'], ['publications.css', '.pb-kind.is-on'],
    ['family.css', '.fy-filter button.is-on'], ['health.css', '.hl-chip.is-on'],
    ['life.css', '.ma-sum.on'], ['layouts.css', '.ly-yesno button.on'],
    ['saved-views.css', '.sv-layouts button.on'], ['layouts.css', '.ly-week-days span.on'],
  ];
  for (const [file, sel] of spots) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = rulesOf(file).match(new RegExp(`${esc}[^{]*\\{([^{}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel} in ${file}`);
    assert.ok(!/var\(--(accent|accent-soft|accent-softer|accent-line|accent-strong|accent-text|coral)\)/.test(rule), `${file} ${sel} still wears coral`);
  }
});

test('quiet actions are ink in the finish layer, danger stays red', () => {
  const premium = rulesOf('premium-layer.css');
  assert.ok(!/var\(--(accent|accent-soft|accent-softer|accent-line|accent-strong|accent-text|coral|on-accent)\)/.test(paintOf(premium)), 'the finish layer still paints an action coral');
  assert.ok(premium.includes('.btn.quiet') && premium.includes('color: var(--text-strong)'), 'quiet actions are not ink');
  assert.ok(/\.btn\.danger-text[^{]*\{[^}]*color: var\(--danger\)/.test(premium), 'destructive words are not danger red');
});

test('the kit guards actions, links and send: ink, primary, never coral', () => {
  const kit = rulesOf('kit.css');
  const guard = kit.match(/:root :is\(\.btn\.quiet[^)]*\) \{([^}]*)\}/s)?.[1] ?? assert.fail('no kit guard for quiet actions');
  assert.ok(guard.includes('color: var(--text-strong)'), 'the kit guard is not ink');
  const send = kit.match(/\.ask \.send \{([^}]*)\}/s)?.[1] ?? assert.fail('no .ask .send in the kit');
  assert.ok(!/var\(--(accent|coral)\)/.test(send), '.ask .send still wears coral');
  assert.ok(send.includes('background: var(--primary)') && send.includes('color: var(--on-primary)'), '.ask .send is not primary');
});

test('links are ink with an ink underline on hover, never coral', () => {
  const base = baseRules();
  // t27-unused-panels: .backlink-line a went with the side's Linked mentions; the foot draws snippets as text.
  for (const sel of ['.markdown a', '.cm-nv-wikilink', '.chat-source', '.pj-link:hover', '.ly-link', '.ps-link', '.wu-link', '.notices-link', '.peek-where-link']) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = base.match(new RegExp(`${esc}[^{]*\\{([^{}]*)\\}`, 's'))?.[1] ?? roomRule(sel) ?? assert.fail(`no ${sel}`);
    assert.ok(!/var\(--(accent|accent-soft|accent-softer|accent-line|accent-strong|accent-text|coral)\)/.test(rule), `${sel} still wears coral`);
  }
  const md = base.match(/\.markdown a \{([^}]*)\}/s)?.[1] ?? assert.fail('no .markdown a');
  assert.ok(md.includes('color: var(--text-strong)'), 'in-note links are not ink');
});

test('tags are plain rectangles, never coral pills', () => {
  const base = baseRules();
  for (const [css, sel] of [[base, '.prop-item.is-tag'], [base, '.cm-nv-tag'], [base, '.markdown a.tag']]) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`${esc}[^{]*\\{([^{}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel}`);
    assert.ok(!/var\(--(accent|accent-soft|accent-softer|accent-line|accent-strong|accent-text|coral)\)/.test(rule), `${sel} still wears coral`);
    assert.ok(rule.includes('var(--bg-hover)'), `${sel} is not the plain tag fill`);
  }
  const pj = rulesOf('project-page.css').match(/\.pj-tag \{([^}]*)\}/s)?.[1] ?? assert.fail('no .pj-tag');
  assert.ok(!/var\(--accent/.test(pj), '.pj-tag still wears coral');
  const sv = rulesOf('saved-views.css').match(/\.sv-chip \{([^}]*)\}/s)?.[1] ?? assert.fail('no .sv-chip');
  assert.ok(!/var\(--accent/.test(sv), '.sv-chip still wears coral');
});

test('selected filters are the soft fill, never coral', () => {
  const spots = [
    ['life.css', '.td-areas > button.on'], ['life.css', '.search-library.on'],
    ['vault-home.css', '.vh-pill.on'], ['vault-home.css', '.vh-vault.is-open'],
    ['note-page.css', '.page-picker-cell.is-current'],
    ['project-page.css', '.pf-row.is-selected'], ['project-page.css', '.pf-tile.is-selected'],
    ['layouts.css', '.ly-phases button.on'], ['layouts.css', '.ly-filter.on'],
    ['project-workspace.css', '.ws-tool.is-on'], ['life.css', '.tm-tag.on'],
    ['publications.css', '.pb-chip.is-on'], ['publications.css', '.pb-pick-row.is-on'],
    ['record-modules.css', '.rm-setup-mod.is-on'], ['life.css', '.ps-chip.ps-open'],
    ['notes-inbox-search-graph.css', '.nj-inbox-item.is-active'],
  ];
  for (const [file, sel] of spots) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = rulesOf(file).match(new RegExp(`${esc}[^{]*\\{([^{}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel} in ${file}`);
    assert.ok(!/var\(--(accent|accent-soft|accent-softer|accent-line|accent-strong|accent-text|coral)\)/.test(rule), `${file} ${sel} still wears coral`);
    assert.ok(/var\(--sel\)|var\(--bg-active\)/.test(rule), `${file} ${sel} is not the soft fill`);
  }
});

test('send is primary wherever it sends, never coral', () => {
  const kit = rulesOf('kit.css');
  assert.ok(kit.match(/\.ask \.send \{([^}]*)\}/s)?.[1].includes('background: var(--primary)'), 'kit send is not primary');
  const base = baseRules();
  for (const sel of ['.chat-send', '.home-ask-send']) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = base.match(new RegExp(`${esc}\\s*\\{([^{}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel}`);
    assert.ok(rule.includes('background: var(--primary)'), `${sel} is not primary`);
  }
});

test('Tomorrow stays warn, never coral', () => {
  const peek = read('components/Peek.tsx');
  assert.ok(peek.includes(`if (days === 1) return { words: 'Tomorrow', tone: open ? 'warn' : 'none' }`), 'Tomorrow is not warn');
});

test('no coral in any action, link, chip, tag, filter or send selector', () => {
  // A new screen that reaches for --accent* or --coral in one of these selectors fails here. Pinned coral stays
  // out by shape, not by file: switches, today's markers, needs-you dots, drop and drag-over feedback, the focus
  // ring, the palette picker itself, kind hues, and decorative icons never match these patterns.
  const pats = ['btn', 'button', 'text-button', 'link-button', 'view-action', 'home-act', 'side-title-action',
    '-link', '_link', '.link', 'wikilink', 'cm-nv-link', 'cm-nv-url', 'backlink', 'chat-source', 'chat-proposal',
    'pj-link', 'pj-from-link', 'foot-item', 'foot-link', 'tidy-link', 'ps-link', 'wu-link', 'lp-link', 'sx-link',
    'ly-link', 'peek-where', 'peek-fact-link', 'chip', 'tag', 'send', 'td-areas', 'search-library', 'vh-pill',
    'vh-vault', 'page-picker', 'field-link', 'picker-row', 'send-choice', 'search-case', 'tab-item', 'hover-title',
    'code-copy', 'cm-completion', 'result-snippet', 'sv-open', 'sv-formula-chip', 'sv-chip', 'nj-chip',
    'nj-inbox-item', 'pj-suggest', 'pj-folder', 'ph-act-words', 'ws-chart-pick', 'notice-action', 'ps-suggest',
    'ps-chip', 'rm-picker-fields', 'ly-day', 'peek-button', 'search-help-row code', 'nv-fb-item', 'nv-fb-btn',
    'chat-step-words', 'cm-nv-hl-link', 'cm-nv-hl-tag', 'cm-nv-footref', 'cm-nv-wikilink-source', 'cm-nv-tag',
    'markdown a', 'small-button', 'notices-link', 'nv-ff-chip', 'show-chip', 'places-send'];
  const skip = ['svg', '-icon', 'kind-', 'today', 'tone-accent', 'rec-kinds', 'ly-suggest', '.pt-today',
    'activity', 'kind-update', '> i', ' i,', ' i {', 'suggestion-bar', 'ph-act-icon', 'td-change-icon',
    'ribbon', 'drop-', 'palette', 'nv-fb-menu', '.pill .dot'];  // 3 Nov 2026: the small status dot on an attention chip is coral by decision (coral only for what needs attention); the chip itself stays neutral
  const coral = /var\(--(accent|accent-soft|accent-softer|accent-line|accent-strong|accent-text|coral|on-accent)\)/;
  const files = [...roomFiles().map((f) => `styles/${f}`), 'styles/kit.css', 'styles/premium-layer.css', 'styles.css'];
  for (const rel of files) {
    let css;
    try { css = rel === 'styles.css' ? baseRules() : rulesOf(rel.replace(/^styles\//, '')); }
    catch { continue; }
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim();
      const low = sel.toLowerCase();
      if (!pats.some((p) => low.includes(p))) continue;
      if (skip.some((s) => low.includes(s))) continue;
      assert.ok(!coral.test(paintOf(`x{${m[2]}}`)), `${rel} ${sel.split(/\s+/).join(' ').slice(0, 90)} reaches for coral`);
    }
  }
});

test('cards are 8px, dialogs are 10px', () => {
  const card = rulesOf('project-workspace.css').match(/\.ws-card\s*\{([^{}]*)\}/s)?.[1] ?? assert.fail('no .ws-card');
  assert.ok(card.includes('border-radius: var(--r-3)'), '.ws-card is not 8px');
  const dialog = rulesOf('today.css').match(/\.td-setup-dialog\s*\{([^{}]*)\}/s)?.[1] ?? assert.fail('no .td-setup-dialog');
  assert.ok(dialog.includes('border-radius: var(--r-4)'), '.td-setup-dialog is not 10px');
});

test('the one square switch: 44x24, square track and knob', () => {
  const css = rulesOf('record-modules.css');
  const track = css.match(/\.rf-switch \.rf-knob\s*\{([^{}]*)\}/s)?.[1] ?? assert.fail('no .rf-switch .rf-knob');
  assert.ok(track.includes('width: 44px') && track.includes('height: 24px') && track.includes('border-radius: var(--r-1)'), '.rf-switch is not the one square shape');
  const knob = css.match(/\.rf-switch \.rf-knob::after\s*\{([^{}]*)\}/s)?.[1] ?? assert.fail('no knob');
  assert.ok(knob.includes('border-radius: var(--r-1)'), '.rf-switch knob is not square');
});

// ── Room words ──────────────────────────────────────────────────────────────────────────────────────────────
const ROOM_TSX = [
  ...globSync('views/today/*.tsx', { cwd: dir }), ...globSync('views/project/*.tsx', { cwd: dir }),
  ...globSync('views/workspace/*.tsx', { cwd: dir }), ...globSync('views/saved/*.tsx', { cwd: dir }),
  ...globSync('views/modules/**/*.tsx', { cwd: dir }), ...globSync('views/meetings/*.tsx', { cwd: dir }),
  ...globSync('views/note/*.tsx', { cwd: dir }), ...globSync('views/editor/*.tsx', { cwd: dir }),
  'views/TodayView.tsx', 'views/HomeView.tsx', 'views/NoteView.tsx', 'views/DocHead.tsx',
  'views/ProjectsHome.tsx', 'views/ProjectPage.tsx', 'views/RecordsView.tsx', 'views/TypePage.tsx',
  'views/PeoplePage.tsx', 'views/PersonPage.tsx', 'views/LockedView.tsx', 'views/WeeklyReview.tsx',
  'views/WeeklyTidyView.tsx', 'views/MeetingPlayback.tsx', 'views/project/FileArt.tsx',
  'components/SearchView.tsx', 'components/SearchModal.tsx', 'components/PageStates.tsx',
  'components/EmptyState.tsx', 'components/HoverPreview.tsx', 'components/Peek.tsx',
  'components/ChangesWaiting.tsx', 'components/Modals.tsx', 'components/NotePageTop.tsx',
  'components/NoteFields.tsx', 'components/NoteFoot.tsx', 'components/SuggestionBar.tsx',
  'components/SaveNoticeBar.tsx', 'components/MeetingActions.tsx',
  'components/ScopedAsk.tsx', 'panels/ChatPanel.tsx', 'panels/SearchPanel.tsx',
  'state/commands.ts',
];
const tsxOf = (f) => {
  try { return read(f); } catch { return null; }
};
// Names and formats that are caps by convention, never tracked labels: currency and file codes, DOM tag names,
// date formats, plan-day letters, a file extension badge.
const WORDS_OK = new Set(['D MMM YYYY', 'INPUT', 'BUTTON', 'SELECT', 'ABCDEFGHIJKLMN', 'FILE',
  'AUD', 'USD', 'EUR', 'GBP', 'NZD', 'SGD', 'CAD', 'JPY', 'AED', 'PDF', 'VIN', 'VLAN', 'CV']);

test('no ALL-CAPS label literals in the rooms: sentence case', () => {
  for (const f of ROOM_TSX) {
    const src = tsxOf(f);
    if (src === null) continue;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const m of code.matchAll(/'([A-Z][A-Z\s·/&.,'’()-]{1,60})'|"([A-Z][A-Z\s·/&.,'’()"-]{1,60})"/g)) {
      const lit = (m[1] ?? m[2]).trim();
      if (WORDS_OK.has(lit)) continue;
      let probe = lit;
      for (const ok of WORDS_OK) probe = probe.split(ok).join('');
      if (!/[A-Z]{2}/.test(probe)) continue;
      assert.fail(`${f}: tracked caps literal ${JSON.stringify(lit)}`);
    }
    // Bare JSX text between tags: APPLICATIONS BOARD reads as caps with no quotes to catch.
    for (const m of code.matchAll(/>([^<>{}]{4,})</g)) {
      const text = m[1].trim();
      if (!/^[A-Z][A-Z\s·/-]+$/.test(text)) continue;
      let probe = text;
      for (const ok of WORDS_OK) probe = probe.split(ok).join('').trim();
      if (probe.replace(/[\s·/-]/g, '').length === 0) continue;
      if (!/[A-Z]{2}/.test(probe)) continue;
      assert.fail(`${f}: tracked caps text ${JSON.stringify(text)}`);
    }
  }
});

test('no generated caps in the rooms: toUpperCase only capitalises, initials or extension badges', () => {
  // Data normalisation, never a label: a typed currency becomes its ISO code (aud -> AUD).
  const CODE_OK = [`valueWords(v, 'currency').toUpperCase()`];
  for (const f of ROOM_TSX) {
    const src = tsxOf(f);
    if (src === null) continue;
    let code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const ok of CODE_OK) code = code.split(ok).join('');
    for (const m of code.matchAll(/.{0,24}\.toUpperCase\(\)/g)) {
      const before = m[0];
      assert.ok(/\[0\]!?$/.test(before.replace(/\.toUpperCase\(\)$/, '')) || /charAt\(0\)$/.test(before.replace(/\.toUpperCase\(\)$/, '')) || /slice\(0, [45]\)$/.test(before.replace(/\.toUpperCase\(\)$/, '')) || /\$\{e$/.test(before.replace(/\.toUpperCase\(\)$/, '')),
        `${f}: generated caps (${before.trim()})`);
    }
  }
});

// Note-content formats, quoted or parsed, never UI words: waiting-line owners, lead-dash stripping, the
// crossword clue format the parser reads ("ANSWER — clue", main/publications.ts readClueLines), and the one-count
// query's owner tail (5 Nov 2026: built for isOwnText to parse, fed to the counter, never rendered).
const DASH_OK = ['[(—–', '— Ana · by 30 Nov', 'HARBOUR — ', 'LIGHTHOUSE — ', 'GULL — ', ' — ${x.who}'];

test('no em dashes in room UI words', () => {
  for (const f of ROOM_TSX) {
    const src = tsxOf(f);
    if (src === null) continue;
    let code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const ok of DASH_OK) code = code.split(ok).join('');
    assert.ok(!code.includes('—'), `${f}: an em dash survives in UI words`);
  }
});
