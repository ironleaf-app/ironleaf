// node --test tests/person-empty-hides.test.mjs — t76: a person's page shows only
// sections that hold something (10.1.7). An empty "You owe"/"Owes you" side hides beside
// 49 "Owes you" rows; with both empty the row hides. The same rule on the page's other
// sections: a bare Timeline head above open promises is noise, and facts with nothing in
// them leave no gap. Project pages already read the rule (folioEmptySections); a guard pins
// that every folio section stays covered. Each check fails without its fix, except the folio
// guard, which proves the checked claim.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: the mechanism ────────────────────────────────────────────────────

test('an empty owes side hides; with both empty the row hides', () => {
  const src = read('src/renderer/src/views/PersonPage.tsx');
  const halvesAt = src.indexOf('w2b-halves');
  assert.ok(halvesAt > 0, 'the halves row stands');
  const gate = src.slice(Math.max(0, halvesAt - 400), halvesAt);
  assert.ok(gate.includes('youOweItems.length') && gate.includes('owesYouItems.length'), 'the row reads only when a side holds something');
  assert.ok(src.includes('youOweItems.length > 0 && <ActionCard') || src.includes("youOweItems.length > 0 && (\n"), 'an empty You owe side hides');
  assert.ok(src.includes('owesYouItems.length > 0 && <ActionCard') || src.includes("owesYouItems.length > 0 && (\n"), 'an empty Owes you side hides');
});

test('no bare Timeline head: it reads with its rows, never above nothing', () => {
  const src = read('src/renderer/src/views/PersonPage.tsx');
  // t255: the Timeline tab reads its rows, else one quiet line — the head stands only with rows.
  const headAt = src.indexOf('>Timeline</div>');
  const condAt = src.indexOf('timeline.length === 0 ? (');
  assert.ok(headAt > 0 && condAt > 0, 'the head and its condition stand');
  assert.ok(headAt > condAt, 'the head stands past the empty branch, never above nothing');
  const tab = src.slice(condAt, headAt);
  assert.ok(tab.includes('No meetings, finished promises or notes yet.'), 'the empty tab reads one quiet line instead');
});

test('facts with nothing in them leave no gap', () => {
  const src = read('src/renderer/src/views/PersonPage.tsx');
  const pillsAt = src.indexOf('<div className="metapills">');
  assert.ok(pillsAt > 0, 'the facts row stands');
  const gate = src.slice(Math.max(0, pillsAt - 900), pillsAt);
  assert.ok(/&& \(\s*$/.test(gate) || /\?\s*$/.test(gate), 'the facts row reads only when something shows in it');
});

test('project pages already show only sections that hold something', () => {
  const memory = read('src/renderer/src/views/project/memory.ts');
  // t255: Overview heads the tabs and is never empty; the sections keep the empty rule.
  const ids = [...memory.matchAll(/id: '([a-z-]+)'/g)].map((m) => m[1]).filter((id) => id !== 'overview');
  assert.ok(ids.length >= 11, `the folio names its sections (${ids.length})`);
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const fn = tabs.split('export function folioEmptySections')[1]?.split('\n}\n')[0] ?? '';
  assert.ok(fn, 'the empty rule stands');
  for (const id of ids) assert.ok(fn.includes(`'${id}'`), `the empty rule covers ${id}`);
  const page = read('src/renderer/src/views/ProjectPage.tsx');
  assert.ok(page.includes('folioEmptySections('), 'the page reads the empty rule');
  assert.ok(page.includes('empty.has(t.id'), 'an empty section reads its quiet tab, never hidden');
});

// ── Live: one-sided and empty people ─────────────────────────────────────────

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.vault.createText('People/Jo Half.md', `---\ntype: person\nrole: Harbour Lane shift lead\n---\n# Jo Half\n\nFriend.\n`).catch(() => {});
    for (let i = 0; i < 4; i++) {
      await H.services.vault.createText(`Meetings/2026-11-0${1 + i} half ${i}.md`, `---\ntype: meeting\ndate: 2026-11-0${1 + i}\nattendees: [Jo Half]\n---\n# 2026-11-0${1 + i} half ${i}\n\n## Agenda\n\n- Peak\n\n## Actions\n\n- [ ] Do thing ${i} — Jo Half — due 2026-11-0${1 + i}\n`).catch(() => {});
      await H.services.rescan(`Meetings/2026-11-0${1 + i} half ${i}.md`);
    }
    await H.services.vault.createText('People/Calm Person.md', `---\ntype: person\nrole: Occasional helper\n---\n# Calm Person\n\nMet once at the market.\n`).catch(() => {});
    await H.services.rescan('People/Jo Half.md');
    await H.services.rescan('People/Calm Person.md');
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try { if (await H.browser.ev(`!!document.querySelector('.app')`)) break; } catch {}
    }
    await sleep(2000);
  }
  return H;
}
after(async () => { await H?.close().catch(() => {}); H = null; });

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
async function openPerson(h, name) {
  // A person tab already sits under People, and the rail leaves an active row alone:
  // step out through Notes so People opens the list again.
  await clickWords(h, 'Notes', '.sidebar.left, aside');
  await sleep(800);
  assert.equal(await clickWords(h, 'People', '.sidebar.left, aside'), 'CLICKED', 'People opens');
  await sleep(1200);
  // A quiet person sorts last: find them through the list's own search.
  let focused = 'NOBOX';
  for (let i = 0; i < 20 && focused !== 'FOCUSED'; i++) {
    focused = await h.browser.ev(`(() => {
      const box = document.querySelector('main [data-people-search]');
      if (!box) return 'NOBOX';
      box.focus();
      box.select();
      return document.activeElement === box ? 'FOCUSED' : 'NOFOCUS';
    })()`);
    if (focused !== 'FOCUSED') await sleep(300);
  }
  assert.equal(focused, 'FOCUSED', 'the find box takes focus');
  await h.browser.send('Input.insertText', { text: name });
  await sleep(900);
  const found = await h.browser.ev(`(document.querySelector('main [data-people-search]') || {}).value || ''`);
  assert.ok(found.includes(name.split(' ')[0]), `the find box holds the name (holds ${JSON.stringify(found)})`);
  const opened = await h.browser.ev(`(async () => {
    const tiles = [...document.querySelectorAll('main .trow.w2b-row')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 60 && r.height > 12; });
    const hit = tiles.find((e) => (e.innerText || '').includes(${JSON.stringify(name)}));
    if (!hit) return 'NOROW';
    hit.click();
    await new Promise((r) => setTimeout(r, 1000));
    return 'CLICKED';
  })()`);
  assert.equal(opened, 'CLICKED', `${name} opens`);
  await sleep(1200);
}

test('one-sided owing shows its side only', { timeout: 300000 }, async () => {
  const h = await harness();
  await openPerson(h, 'Jo Half');
  // t255: the Promises tab keeps the rule (one side only, no empty line); the Overview reads the
  // empty side as one quiet line beside the owed rows.
  const ov = await h.browser.ev(`document.querySelector('#pp-panel-overview')?.innerText ?? ''`);
  assert.ok(ov.includes('Owes you'), 'their side reads on the Overview');
  assert.ok(ov.includes('Nothing you owe them is open.'), 'the empty side reads one quiet line there');
  await h.browser.ev(`document.querySelector('[data-tab="promises"]')?.click()`);
  await sleep(1000);
  const m = await h.browser.ev(`(() => {
    const panel = document.querySelector('#pp-panel-promises');
    const text = panel?.innerText ?? '';
    const halves = panel?.querySelector('.w2b-halves');
    return {
      youOwe: text.includes('You owe'),
      owesYou: text.includes('Owes you'),
      emptyLine: text.includes('Nothing you owe them is open') || text.includes('Nothing they owe you is open'),
      halves: halves ? halves.children.length : 0,
    };
  })()`);
  assert.equal(m.owesYou, true, 'their side reads');
  assert.equal(m.youOwe, false, 'the empty side hides');
  assert.equal(m.emptyLine, false, 'no empty line reads beside owed rows');
  assert.equal(m.halves, 1, 'one side stands in the row');
});

test('nothing between you: no owes row, no empty lines', { timeout: 300000 }, async () => {
  const h = await harness();
  await openPerson(h, 'Calm Person');
  const m = await h.browser.ev(`(() => {
    const text = document.body.innerText;
    return {
      halves: !!document.querySelector('main .w2b-halves'),
      emptyLine: text.includes('Nothing you owe them is open') || text.includes('Nothing they owe you is open'),
      bareTimeline: [...document.querySelectorAll('main .w2b-section')].some((e) => e.innerText.includes('Timeline')) && !document.querySelector('main .w2b-card'),
    };
  })()`);
  assert.equal(m.halves, false, 'the row hides when both sides are empty');
  assert.equal(m.emptyLine, false, 'no empty line reads');
  assert.equal(m.bareTimeline, false, 'no bare head above nothing');
});
