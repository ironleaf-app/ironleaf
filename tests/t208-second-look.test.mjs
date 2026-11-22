// node --test tests/t208-second-look.test.mjs — Vault judged a second time, strictly (t208, 11 Nov 2026). on
// t200's after pictures. Three were named: Today Next for you reads as three lists (some titles bold,
// some plain; "13 days late" centred on some rows, top-aligned on others; dividers between some rows), the
// project page's people stack reads "ACACSO", and the rest of t200's walk judged as strictly. Each fixed at
// its mechanism, with a check that fails without it:
// - step rows wore the premium layer's chip rule (.td-due named a row, never a chip): padding, caption size
//   and weight 550 beside note rows' 400 — the arms are gone, so every task title reads 15px/500;
// - a note's line wore the record row's class (rm-row): dividers, gaps and a wash beside bare step rows —
//   dropped, and Today's task rows divide as Tasks' and the project page's do;
// - a note line's editable day sat in a bare span: top-aligned beside centred ones — the cell itself is the
//   grid item now, as on every other task row;
// - the Tasks page's project source read the title's ink through an inline inherit, faint beside it —
//   the class reads now, and Today's own source shade is one;
// - the project page's meeting-sourced rows read bespoke (no who, day pushed right, smaller title) —
//   the same grid as a step, with its who and when;
// - a person page's day read a filled Late block beside plain "5 days late" everywhere else — the Tasks
//   page's own words through the one reader, never a tag (a gone-by key date reads plain the same way);
// - the people stack named the owner twice ("Alex Chen" beside "Alex Chen (owner)") and collided —
//   one name each, every face apart, names on hover and to a reader.
// Judged and left alone, each on purpose: page-head architecture (each page's actions stay where they are;
// moving them breaks finding the way), count and info chips (each surface consistent; unifying needs the
// owner's words), the Meetings coming-up tint (the active filter's mark), the Inbox lead button's … cap
// (pinned deliberate), board tags (cards, not rows), the priority flag (a rare marker, not status), the
// went-by callout's shared warning tint, and Waiting's dashed box (not tickable by design).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: every fix sits at its mechanism ────────────────────────────────

test('no task row wears the chip rule', () => {
  const css = read('src/renderer/src/styles/premium-layer.css');
  const line = css.split('\n').find((l) => l.includes('nj-row-chip')) ?? assert.fail('no chips rule');
  assert.ok(!line.includes('.td-due') && !line.includes('.tk-due'), 'those name rows, never a chip (was: step rows 550, note rows 400)');
});

test("a note's line is a task row, never a record row", () => {
  const due = read('src/renderer/src/views/today/DueCard.tsx');
  assert.ok(due.includes('td-row tkrow th-due-row'), 'the one task row');
  assert.ok(!due.includes('tkrow rm-row'), 'no record dividers, gaps or wash beside bare step rows');
  assert.ok(due.includes('<span className="tkrow-when" onClick'), 'the cell itself is the grid item, as on every other task row');
  assert.ok(due.includes('<WhenInner words={whenWords}'), 'the day through the shared inner, centred like the rest');
});

test("Today's task titles and dividers match every other task list", () => {
  const css = read('src/renderer/src/styles/plan.css');
  const rule = css.match(/\.td-row\.tkrow \.td-row-what \{([^}]*)\}/)?.[1] ?? assert.fail('no Today task-title rule');
  assert.ok(rule.includes('font-size: var(--fs-body)') && rule.includes('font-weight: 500'), '15px/500, as .tkrow-title (was: 13px)');
  assert.ok(css.includes('.td-row.tkrow + .td-row.tkrow { border-top: 1px solid var(--border); }'), 'dividers as .trow + .trow draws them');
});

test("every task source reads its class's muted", () => {
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  const btn = tasks.split('\n').find((l) => l.includes('className="tkrow-sub" style=')) ?? assert.fail('no Tasks source button');
  assert.ok(!btn.includes('color:'), "no inline inherit reading the title's ink (was: dark beside faint)");
  const today = read('src/renderer/src/styles/today.css');
  assert.match(today, /\.td-project \{[^}]*color: var\(--text-muted\)/s, 'one muted shade, button and span alike (t218: the one sub line)');
});

test("the project's meeting-sourced rows are the same grid as a step", () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(tabs.includes('<div className="trow tkrow" data-action={a.id}'), 'ElsewhereRow stands in the grid (was: bespoke, no who)');
  assert.ok(tabs.includes('<WhoCell name={visibleWho(a.person || a.who, ctx.hub.me) || undefined} />'), 'who sits in its column (your own hidden, as Today)');
  assert.ok(tabs.includes('<span className={`tkrow-title${a.done ? \' is-done\' : \'\'}`}>'), 'the shared title, struck when done');
  assert.ok(tabs.includes('<span className="tag is-plain is-attention"'), 'a gone-by date reads plain, never a filled block');
});

test("a person page's day reads plain words, never a tag", () => {
  const person = read('src/renderer/src/views/PersonPage.tsx');
  assert.ok(person.includes('taskDueTag(x.date, null, today)'), "the Tasks page's own words");
  assert.ok(person.includes('<WhenInner words={tag.words}'), 'the shared when, coral when late, quiet else');
  assert.ok(!person.includes('>Late<'), 'no filled Late block left');
  const css = read('src/renderer/src/styles/w2b.css');
  assert.match(css, /\.w2b-when \{[^}]*margin-left: auto/s, 'the rows\u2019 right end, as the tag was');
});

test('the people stack names each person once, to hover and reader alike', () => {
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(page.includes(`.replace(/\\s*\\(owner\\)\\s*$/i, '')`), 'the file\u2019s "(owner)" never doubles the owner (was: AC twice)');
  assert.ok(page.includes('aria-label={headPeopleLabel}') && page.includes('title={headPeopleLabel}'), 'one label, names in it, for both');
  const css = read('src/renderer/src/styles/kit.css');
  const rule = css.match(/\.avatars i \{([^}]*)\}/)?.[1] ?? assert.fail('no avatar-stack rule');
  assert.ok(rule.includes('box-shadow: 0 0 0 1px var(--border)'), 'a hairline on every ground, not only a ring the next face covers');
  // t261, 13 Nov 2026 (the head card: BM DL PN overlapped so the first read "BN"): no overlap left.
  assert.ok(rule.includes('margin-left: 2px'), 'a gap, never an overlap (was: initials colliding into "ACACSO", then "BN")');
});

// ── Live: one boot, mixed sources side by side, measured not eyeballed ─────
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The one task title, as .tkrow-title reads it: every live check anchors to this, whatever the source. */
const ONE_TITLE = '500/15px';
let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    const w = (rel, text) => {
      const p = path.join(H.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    const yest = iso(new Date(Date.now() - 864e5));
    const tmr = iso(new Date(Date.now() + 864e5));
    // Fresh steps and fresh note lines beside the vault's own (relative days, so the mix shows whenever run).
    w('Projects/T208 Second Look/T208 Second Look.md', `---\ntype: project\nstatus: active\nhealth: on track\nowner: Alex Chen\ndue: ${tmr}\n---\n# T208 Second Look\n\n## Summary\n\nProving one row style with fresh days.\n\n## What's next\n\n- [ ] Chase the failed cart refund before the window shuts — Alex Chen — due ${yest}\n- [ ] Draft the late-opening roster cover note for Sam — Priya Nair — due ${tmr}\n\n## People\n\n- Alex Chen (owner)\n- Priya Nair\n- June Park\n`);
    w('Meetings/2026-11-09 T208 standup on the rows.md', `---\ntype: meeting\ndate: ${yest}\nattendees: [Alex Chen, Priya Nair]\nproject: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md\n---\n# 2026-11-09 T208 standup on the rows\n\n## Actions\n\n- [ ] Retry the failed payment twice before showing an error — Priya Nair — due ${yest}\n- [ ] Photograph the back room wiring before Tom starts the refit — Alex Chen — due ${yest}\n- [x] Book the room for next Tuesday — Alex Chen\n`);
    w('Me/T208 loose note with dated tasks.md', `# T208 loose note with dated tasks\n\n- [ ] Ring ShadeCo about the awning quote before it lapses on Friday afternoon — June Park — due ${tmr}\n- [ ] Water the shop plants before the weekend — Alex Chen — due ${tmr}\n`);
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2500);
    await H.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
async function clickWords(h, words, scope = '') {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
}
async function openRoom(h, name) {
  assert.equal(await clickWords(h, name, '.sidebar.left, aside'), 'CLICKED', `${name} opens`);
  await sleep(1200);
}

/** Every row's title weight and size, sub shade, when centring and top divider — one shape per row kind.
 *  Rows past the fold stay unmeasured (t102 content-visibility skips their boxes): only what drew judges. */
const ROWS_JS = (rowsSel, titleSel, subSel, whenSel) => `( () => [...document.querySelectorAll(${JSON.stringify(rowsSel)})].map((row) => {
  const r = row.getBoundingClientRect();
  const cs = getComputedStyle(row);
  const one = (sel) => {
    const el = row.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (b.height < 1) return null;
    const s = getComputedStyle(el);
    return { weight: s.fontWeight, size: s.fontSize, color: s.color, dy: Math.round(b.top - r.top + b.height / 2 - r.height / 2) };
  };
  const prev = row.previousElementSibling;
  return { cls: row.className, h: Math.round(r.height), borderTop: cs.borderTopWidth, prevRow: !!prev && (prev.classList.contains('td-row') || prev.classList.contains('trow')), title: one(${JSON.stringify(titleSel)}), sub: one(${JSON.stringify(subSel)}), when: one(${JSON.stringify(whenSel)}) };
}).filter((x) => x.title))()`;

function assertOneList(rows, where, kinds) {
  assert.ok(rows.length >= 2, `${where}: rows to judge (stood ${rows.length})`);
  const titles = new Set(rows.map((x) => `${x.title?.weight}/${x.title?.size}`));
  assert.equal(titles.size, 1, `${where}: one title weight and size (stood ${[...titles].join(' vs ')})`);
  assert.equal([...titles][0], ONE_TITLE, `${where}: the one task title (stood ${[...titles][0]})`);
  const subs = new Set(rows.filter((x) => x.sub).map((x) => x.sub.color));
  assert.ok(subs.size <= 1, `${where}: one sub shade (stood ${[...subs].join(' vs ')})`);
  for (const x of rows) {
    if (!x.when) continue;
    assert.ok(Math.abs(x.when.dy) <= 2, `${where}: when centred, never top-aligned (${x.cls}: ${x.when.dy}px off)`);
  }
  for (const x of rows) assert.equal(x.borderTop, x.prevRow ? '1px' : '0px', `${where}: a divider above every row but a run's first (${x.cls})`);
  if (kinds) for (const k of kinds) assert.ok(rows.some((x) => x.cls.includes(k)), `${where}: a ${k} row stands in the mix`);
}

test('Today Next for you: one row style, whatever the source', { timeout: 120000 }, async () => {
  const h = await harness();
  await openRoom(h, 'Today');
  const rows = await h.browser.ev(ROWS_JS('.td-next .td-row', '.td-row-what', '.td-row-sub', '.tkrow-when'));
  assertOneList(rows, 'Next for you', ['td-due', 'th-due-row']);
});

test('Today Waiting: steps and note lines read as one', { timeout: 120000 }, async () => {
  const h = await harness();
  await openRoom(h, 'Today');
  assert.equal(await h.browser.ev(`(document.querySelector('[data-section="also"] .td-more')?.click(), !!document.querySelector('[data-section="also"] .td-more'))`), true, 'Also opens');
  await sleep(800);
  const rows = await h.browser.ev(ROWS_JS('[data-section="waiting"] .td-row.tkrow', '.td-row-what', '.td-row-sub', '.tkrow-when'));
  // Layout round 2: other people's lines in your notes are counted here and listed in Tasks (never 80 rows on
  // Today), so Waiting's rows are the steps, grouped by who they wait on.
  assertOneList(rows, 'Waiting on others', ['td-wait']);
  assert.equal(await h.browser.ev(`document.querySelectorAll('[data-section="waiting"] .th-due-row').length`), 0, 'note lines are a count, not rows');
});

test('Tasks: the same titles and subs as Today', { timeout: 120000 }, async () => {
  const h = await harness();
  await openRoom(h, 'Tasks');
  assert.equal(await clickWords(h, 'Everyone', 'main'), 'CLICKED', 'every owner shows');
  await sleep(800);
  const rows = await h.browser.ev(ROWS_JS('main .trow.tkrow', '.tkrow-title', '.tkrow-sub', '.tkrow-when'));
  assertOneList(rows, 'Tasks');
  const kinds = await h.browser.ev(`[...document.querySelectorAll('main .trow.tkrow .tkrow-sub')].map((e) => e.tagName)`);
  assert.ok(kinds.includes('BUTTON') && kinds.includes('SPAN'), 'a project source and a plain source both stand to judge');
});

test("a squeezed day's note lines centre their day", { timeout: 120000 }, async () => {
  const h = await harness();
  await openRoom(h, 'Today');
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await sleep(1500);
  const rows = await h.browser.ev(ROWS_JS('.th-other-day .td-row', '.td-row-what', '.td-row-sub', '.tkrow-when'));
  assert.ok(rows.length >= 1, 'tomorrow carries a note line to judge');
  assertOneList(rows.length > 1 ? rows : [...rows, ...rows], 'Due tomorrow');
});

test("the project's meeting-sourced rows stand in the grid", { timeout: 120000 }, async () => {
  const h = await harness();
  await openRoom(h, 'Projects');
  assert.equal(await clickWords(h, 'Harbourline Cart Fix', 'main'), 'CLICKED', 'the project opens');
  await sleep(1500);
  // The meeting's actions join the plan a moment after boot; wait for them, as the graph walk waits its vault.
  let rows = [];
  for (let i = 0; i < 60; i++) {
    rows = await h.browser.ev(`[...document.querySelectorAll('main [data-action]')].map((row) => {
      const title = row.querySelector('.tkrow-title');
      const s = title ? getComputedStyle(title) : null;
      return { cls: row.className, words: (row.innerText || '').replace(/\\s+/g, ' ').slice(0, 80), who: !!row.querySelector('.tkrow-who'), when: !!row.querySelector('.tkrow-when'), metrics: s ? \`\${s.fontWeight}/\${s.fontSize}\` : null };
    })`);
    if (rows.some((x) => /retry the failed payment twice before showing an error/i.test(x.words))) break;
    await sleep(500);
  }
  assert.ok(rows.some((x) => /retry the failed payment twice before showing an error/i.test(x.words)), 'a meeting action stands in the mix');
  for (const x of rows) {
    assert.ok(x.cls.includes('tkrow'), `the grid, never bespoke (${x.words})`);
    assert.ok(x.who && x.when, `who and when sit in their columns (${x.words})`);
    assert.ok(x.metrics, `titled in the title's column (${x.words})`);
    assert.equal(x.metrics, ONE_TITLE, `titled as every task (${x.words}: ${x.metrics})`);
  }
});

test("a person page's day reads plain and dated", { timeout: 120000 }, async () => {
  const h = await harness();
  await openRoom(h, 'People');
  assert.equal(await clickWords(h, 'Alex Chen', 'main'), 'CLICKED', 'the person opens');
  await sleep(1500);
  const rows = await h.browser.ev(`[...document.querySelectorAll('main .w2b-half .trow')].map((row) => {
    const when = row.querySelector('.w2b-when');
    const w = when ? getComputedStyle(when) : null;
    const inner = row.querySelector('.w2b-when .tkrow-moment');
    const s = inner ? getComputedStyle(inner) : null;
    const title = row.querySelector('.t');
    const t = title ? getComputedStyle(title) : null;
    return { words: when ? (when.innerText || '').replace(/\\s+/g, ' ') : null, bg: w?.backgroundColor ?? null, color: s?.color ?? null, weight: s?.fontWeight ?? null, metrics: t ? \`\${t.fontWeight}/\${t.fontSize}\` : null };
  })`);
  const dated = rows.filter((x) => x.words);
  assert.ok(dated.length >= 1, 'a dated promise stands to judge');
  for (const x of dated) {
    assert.equal(x.bg, 'rgba(0, 0, 0, 0)', `no filled block (${x.words})`);
    assert.match(x.words, /\d+ days? late|Today|Tomorrow|Yesterday|^\w{3} \d{1,2} \w{3}/, `the day in words (${x.words})`);
    assert.equal(x.metrics, ONE_TITLE, `titled as every task (${x.words}: ${x.metrics})`);
  }
});

test('the people stack shows each person, named to hover and reader', { timeout: 120000 }, async () => {
  const h = await harness();
  await openRoom(h, 'Projects');
  assert.equal(await clickWords(h, 'T208 Second Look', 'main'), 'CLICKED', 'the project opens');
  await sleep(1500);
  const stack = await h.browser.ev(`(() => {
    const btn = document.querySelector('button.avatars.w2a-ava');
    if (!btn) return null;
    return {
      title: btn.getAttribute('title') || '', aria: btn.getAttribute('aria-label') || '',
      kids: [...btn.querySelectorAll('i')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), w: Math.round(r.width), ring: getComputedStyle(el).boxShadow };
      }),
    };
  })()`);
  assert.ok(stack && stack.kids.length >= 2, 'faces stand to judge');
  const names = stack.title.split('. Everyone')[0].split(', ');
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, `each person once (stood ${stack.title})`);
  assert.equal(stack.aria, stack.title, 'the reader hears the names too');
  for (let i = 1; i < stack.kids.length; i++) {
    const pitch = stack.kids[i].x - stack.kids[i - 1].x;
    // t261: whole faces stand apart (was: pitch 0.75 of a face, letters still colliding into "BN").
    assert.ok(pitch >= stack.kids[i].w, `faces apart, letters never touching (pitch ${pitch}px of ${stack.kids[i].w}px)`);
    assert.notEqual(stack.kids[i].ring, 'none', 'a hairline on every ground');
  }
});
