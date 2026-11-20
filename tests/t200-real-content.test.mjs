// node --test tests/t200-real-content.test.mjs — Vault judged with real, long content (t200, 10 Nov 2026). sent
// from a real Bot page. Earlier jobs checked every Vault control on made-up data; this one judges every page full
// of real, long content at three sizes. The vault is made up but shaped like a real one (Business, Me, Projects
// — the flagship with 16 open steps and 13 risks — People, Bills, Inbox, Docs, meetings with minutes; 3,000 notes;
// long names; long notes with headings, tables, images and links), walked at 3456x1408, 1920x1117 and 1219x709
// with a picture of every page and state in ../shots/. Seven faults found on the walk, each fixed at its
// mechanism with a check that fails without it:
// - search snippets read raw link targets ("where the awning would hang](assets/awning-photo.png)"): plainLine
//   (src/shared/snippet.ts) keeps a link's words and drops its target, images read as their alt, footnote markers
//   go whole — for search, file hits, plain-text and note context alike, the marks still moved to match;
// - snippets cut mid-word ("and Shad…", "due…"): windowSnippet lands its cuts on word edges, keeping the row
//   bounds, the marks and the match-near-start the panel needs;
// - a meeting's name under a Today row clipped raw past the … ("2026-10-21 Wiring quote walkt", no tooltip):
//   DueCard's sub reads through the shared .td-text with its title, as a due line's project name does; the Tasks
//   page's span variant stands as a block (inline boxes ignore overflow) and carries its title too;
// - a bare "15" beside each search result, no words: the count says "15 matches in this note" (files say file)
//   on hover and to a reader, through the one plural helper;
// - the files panel's "Show everything · 994" read in the accent: .nav-more is the same calm faint row as the
//   folder tree's, never an accent;
// - the graph legend read "+1 more lobes": the tail counts through the one plural helper ("1 more lobe").
// Judged and left alone, each on purpose: the breadcrumb's leading … and Inbox folder-note slugs (both pinned by
// their tests), "Says …" reasons (pinned vocabulary), the greeting's bare "7 late" (pinned; needs the words),
// meeting dates in task labels (they tell recurring meetings apart; Meetings shows its dates separately), and the
// Money empty card (the shared design). t207 pass 2 went further than this walk: one-line rows clip without dots
// with whole words on hover, two-line titles wrap whole, and the Inbox lead button's old … cap went with them.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';
import { writeT200Vault } from './t200-vault.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotsDir = path.join(root, '..', 'shots');

// ── Static: links read as words, cuts land on word edges ───────────────────

let SN;
before(async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'nv-t200-'));
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/snippet.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  SN = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});

test('a link keeps its words and drops its target, images read as their alt', () => {
  assert.equal(SN.plainLine('See [the care guide](https://example.invalid/awning-care) first', []).text, 'See the care guide first');
  assert.equal(SN.plainLine('![The shop front on a rainy Tuesday, showing where the awning would hang](assets/awning-photo.png)', []).text, 'The shop front on a rainy Tuesday, showing where the awning would hang');
  assert.equal(SN.plainLine('The [spec][receipts] stands', []).text, 'The spec stands', 'reference links drop their key too');
  assert.equal(SN.plainLine('A word[^1] with a note', []).text, 'A word with a note', 'footnote markers go whole');
  assert.equal(SN.plainLine('A [stray bracket stays', []).text, 'A [stray bracket stays', 'no target, no link, kept as written');
  assert.equal(SN.plainLine('See [[Harbourline Cart Fix]] today', []).text, 'See Harbourline Cart Fix today', 'wiki links read as before');
});

test('a word found inside a link’s words stays marked where it stands', () => {
  const raw = 'See [the awning care guide](https://example.invalid/awning-care) first';
  const a = raw.indexOf('awning');
  const r = SN.plainLine(raw, [[a, a + 'awning'.length]]);
  assert.equal(r.text, 'See the awning care guide first');
  assert.deepEqual(r.ranges.map(([x, y]) => r.text.slice(x, y)), ['awning']);
});

test('snippet cuts land on word edges, never mid-word', () => {
  const line = 'Went through the awning quote with June: twelve hundred dollars fitted, and ShadeCo can start the week after next if we pay the deposit now';
  for (const word of ['awning', 'ShadeCo', 'deposit']) {
    const a = line.indexOf(word);
    const r = SN.windowSnippet(line, [[a, a + word.length]]);
    for (const m of r.text.matchAll(/…/g)) {
      const beforeCh = r.text[m.index - 1] ?? '';
      const afterCh = r.text[m.index + 1] ?? '';
      assert.ok(beforeCh === '' || beforeCh === ' ' || afterCh === '' || afterCh === ' ', `${word}: no cut word (${r.text})`);
    }
    assert.ok(r.text.length <= 82, 'smaller than the row, as before');
    assert.deepEqual(r.ranges.map(([x, y]) => r.text.slice(x, y)), [word], 'the mark still marks the word');
  }
  const panel = SN.windowSnippet(line, [[line.indexOf('ShadeCo'), line.indexOf('ShadeCo') + 7]], 44, 14);
  assert.ok(!/…\S/.test(panel.text) || panel.text.endsWith('…'), `the panel cuts whole too (${panel.text})`);
});

// ── Static: every fix sits at its mechanism ────────────────────────────────

test('a meeting’s name under a Today row reads through .td-text with its title', () => {
  const due = read('src/renderer/src/views/today/DueCard.tsx');
  assert.ok(due.includes('<span className="td-text" title={') && due.includes(': title}'), 'the sub wraps whole with its title, as a due line’s project name does (t207 pass 2: no dots; t238 names every source, the note’s name last)');
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('title={`Open ${x.projectName}`}><span className="td-text">{x.projectName}</span></button>'), 'the waiting line’s project clips the same way');
  assert.ok(today.includes('<span className="td-project" title={x.projectName}><span className="td-text">{x.projectName}</span></span>'), 'the unscheduled line’s project clips the same way');
});

test('the Tasks page’s meeting sub stands as a block, wraps whole and carries its title', () => {
  const tasks = read('src/renderer/src/views/TasksView.tsx');
  assert.ok(tasks.includes('<span className="tkrow-sub" title={t.projectName || where}>'), 'whole words on hover, as the project button above it');
  const plan = read('src/renderer/src/styles/plan.css');
  const rule = plan.match(/\.tkrow-sub \{([^}]*)\}/)?.[1] ?? assert.fail('no .tkrow-sub rule');
  assert.ok(/display: block/.test(rule), 'a block on its own line');
  assert.ok(!/text-overflow: ellipsis/.test(rule) && !/white-space: nowrap/.test(rule), 'never cut with … (t207 pass 2: the … stands no more)');
  assert.ok(/overflow-wrap: break-word/.test(rule), 'whole words');
});

test('a result’s count says its words through the one plural helper', () => {
  const view = read('src/renderer/src/components/SearchView.tsx');
  assert.ok(view.includes(`from '../../../shared/words'`), 'the one plural helper, not a local rule');
  assert.ok(view.includes(`plural(n, 'match', 'matches')`), 'one match, two matches');
  const counts = [...view.matchAll(/<span className="sas-count"([^>]*)>/g)];
  assert.equal(counts.length, 3, 'three result lists, all three labelled');
  for (const [, attrs] of counts) {
    assert.ok(/title=\{matchWords\(/.test(attrs) && /aria-label=\{matchWords\(/.test(attrs), 'hover and reader both hear it');
  }
});

test('the files panel’s Show everything is the same calm row as the tree’s', () => {
  const css = read('src/renderer/src/styles/navigator.css');
  const rule = css.match(/\.nav-more \{([^}]*)\}/)?.[1] ?? assert.fail('no .nav-more rule');
  assert.ok(rule.includes('var(--text-faint)'), 'quiet words from the theme, as .tree-showall');
  assert.ok(!rule.includes('accent'), 'never an accent');
  const tree = read('src/renderer/src/styles.css');
  assert.ok(/\.tree-showall \{[^}]*var\(--text-faint\)/s.test(tree), 'the tree’s own row still sets the shape');
});

test('the graph legend counts its tail through the one plural helper', () => {
  const brain = read('src/renderer/src/components/BrainGraphView.tsx');
  assert.ok(brain.includes(`plural(tailLobes, 'more lobe', 'more lobes')`), 'one more lobe, two more lobes (was: "+1 more lobes")');
});

// ── Live: one boot, a made-up vault of realistic size, every page at three sizes ───
// Business, Me, Projects (the flagship with 16 open steps and 13 risks), People, Bills, Inbox, Docs, meetings
// with minutes; 3,000 notes; long names; long notes with headings, tables, images and links. Never their real
// vault: made-up people and projects throughout.
let H = null;
async function harness() {
  if (!H) {
    const H0 = await import('./vault-controls-harness.mjs');
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: Object.fromEntries(['finance', 'documents', 'business', 'systems', 'publications', 'goals', 'family', 'health', 'house', 'vehicles', 'career', 'travel', 'meetings'].map((id) => [id, { on: true }])) } }]);
    const count = writeT200Vault(H.vaultDir);
    assert.equal(count, 3000, 'the walk judges a 3,000-note vault');
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await H.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2500);
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
async function waitFor(h, js, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
}
async function openRoom(h, name) {
  if ((await clickWords(h, name, '.sidebar.left, aside')) === 'CLICKED') return true;
  const label = name === 'Graph' ? 'Open the graph' : name === 'Templates' ? 'Open the Templates page' : name;
  await ctrlK(h);
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 4000))) return false;
  await h.browser.send('Input.insertText', { text: name });
  await sleep(700);
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const text = (r, sel) => r.querySelector(sel)?.innerText.trim() ?? '';
    const row = rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(label)} && text(r, '.picker-detail') === 'Pack')
      ?? rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(label)});
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  await sleep(600);
  return picked === 'CLICKED';
}
async function esc(h) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(300);
}
async function ctrlK(h) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
}
async function palettePick(h, words) {
  await ctrlK(h);
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 5000))) return 'NOPALETTE';
  await h.browser.send('Input.insertText', { text: words });
  await sleep(900);
  return h.browser.ev(`(() => {
    const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes(${JSON.stringify(words)}));
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
}

// The walk's standing measures (the three-sizes shape): never sideways, the nav never scrolls, no clipped text
// past the by-design rows, a sensible share of the window, and no raw link targets anywhere a person reads.
// t207 pass 2: dots are never by design — a clamp or an ellipsis anywhere in main is a fault on its own; a
// one-line slot clips without dots with its full words on hover.
const MEASURE_JS = `(() => {
  const nav = document.querySelector('nav.places-list');
  const box = document.querySelector('main .nv-page, main .vpage.wide, main .td-inner, main .tp-inner, main .settings-page, main .nv-page-frame');
  const r = box?.getBoundingClientRect();
  const clipped = [];
  const hovered = (el) => (el.getAttribute('title') || el.getAttribute('aria-label') || el.closest('button, a')?.getAttribute('title') || el.closest('button, a')?.getAttribute('aria-label') || '');
  for (const el of document.querySelectorAll('main p, main h1, main h2, main h3, main li, main td, main th, main .td-text, main button, main a, main small')) {
    const er = el.getBoundingClientRect();
    if (er.width < 2 || er.height < 2) continue;
    const cs = getComputedStyle(el);
    const tag = \`\${el.tagName.toLowerCase()}.\${String(el.className).split(' ').slice(0, 2).join('.')}\`;
    if (cs.webkitLineClamp !== 'none' || cs.textOverflow === 'ellipsis') {
      clipped.push(tag + ' shows … (dots are never by design)');
      if (clipped.length >= 10) break;
      continue;
    }
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (cs.whiteSpace === 'nowrap' && cs.overflowX === 'hidden' && hovered(el)) continue;
    if ([...el.children].some((k) => k.getBoundingClientRect().width > er.width + 1)) continue;
    clipped.push(tag + ' +' + (el.scrollWidth - el.clientWidth) + 'px');
    if (clipped.length >= 10) break;
  }
  const rawTargets = [];
  for (const el of document.querySelectorAll('main p, main li, main td, main .td-text, main button, main a, main h1, main h2, main h3, .smodal p, .smodal li, .smodal button')) {
    if (el.querySelector('code, pre, textarea, input')) continue;
    const t = (el.innerText || '');
    if (/\]\([^)]*\)/.test(t)) {
      rawTargets.push(t.replace(/\\s+/g, ' ').slice(0, 90));
      if (rawTargets.length >= 5) break;
    }
  }
  return {
    docX: document.documentElement.scrollWidth > window.innerWidth + 1,
    navScrolls: nav ? nav.scrollHeight > nav.clientHeight + 1 : null,
    boxW: r ? Math.round(r.width) : null,
    clipped,
    rawTargets,
  };
})()`;

const PAGES = [
  { id: 'today', room: true, open: (h) => openRoom(h, 'Today') },
  { id: 'note', open: async (h) => { await openRoom(h, 'Notes'); assert.equal(await palettePick(h, 'Kickoff note 1 with decisions'), 'CLICKED', 'the note opens'); await sleep(1500); } },
  { id: 'project', open: async (h) => { await openRoom(h, 'Projects'); assert.equal(await clickWords(h, 'Harbourline Cart Fix', 'main'), 'CLICKED', 'the project opens'); await sleep(1200); } },
  { id: 'person', open: async (h) => { await openRoom(h, 'People'); assert.equal(await clickWords(h, 'Alex Chen', 'main'), 'CLICKED', 'the person opens'); await sleep(1200); } },
  { id: 'notes', room: true, open: (h) => openRoom(h, 'Notes') },
  { id: 'tasks', room: true, open: (h) => openRoom(h, 'Tasks') },
  { id: 'meetings', room: true, open: (h) => openRoom(h, 'Meetings') },
  {
    id: 'graph', open: async (h) => {
      await openRoom(h, 'Graph');
      assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 40`, 90000), 'the vault draws');
      await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().framed`, 90000);
      await sleep(2000);
    },
  },
  {
    id: 'note-graph', open: async (h) => {
      await openRoom(h, 'Notes');
      assert.equal(await palettePick(h, 'Kickoff note 1 with decisions'), 'CLICKED', 'the note opens');
      await sleep(1500);
      if ((await h.browser.ev(`!!document.querySelector('.sidebar.right')`)) === false) await clickWords(h, 'Show the right side');
      await sleep(1200);
    },
  },
  {
    id: 'search', open: async (h) => {
      await openRoom(h, 'Today');
      assert.equal(await palettePick(h, 'Search inside notes'), 'CLICKED', 'the search opens');
      await sleep(800);
      await h.browser.send('Input.insertText', { text: 'awning quote receipt' });
      await sleep(2000);
    },
  },
  { id: 'inbox', room: true, open: (h) => openRoom(h, 'Inbox') },
  { id: 'money', room: true, open: (h) => openRoom(h, 'Money') },
  {
    id: 'sidebar-tree', open: async (h) => {
      await openRoom(h, 'Today');
      assert.equal(await palettePick(h, 'Show your files'), 'CLICKED', 'the file tree opens');
      await sleep(1200);
    },
  },
  { id: 'more', open: async (h) => { await openRoom(h, 'Today'); assert.equal(await clickWords(h, 'More', '.sidebar.left, aside'), 'CLICKED', 'More opens'); await sleep(800); } },
  { id: 'settings', room: true, open: async (h) => { assert.equal(await clickWords(h, 'Settings', '.sidebar.left, aside'), 'CLICKED', 'Settings opens'); await sleep(1200); } },
];

const SHARE = { 3456: { today: 0.45, room: 0.4 }, 1920: { today: 0.6, room: 0.6 }, 1219: { today: 0.7, room: 0.7 } };

async function walk(size) {
  const h = await harness();
  const [W, Hg] = size;
  mkdirSync(shotsDir, { recursive: true });
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 2, mobile: false });
  await sleep(600);
  for (const p of PAGES) {
    const tag = `${p.id} at ${W}x${Hg}`;
    await esc(h);
    if ((await h.browser.ev(`!!document.querySelector('.sidebar.right')`)) === true && p.id !== 'note-graph') {
      await clickWords(h, 'Hide the right side');
      await sleep(400);
    }
    if ((await h.browser.ev(`!!document.querySelector('.side-title-back')`)) === true) {
      await h.browser.ev(`document.querySelector('.side-title-back').click()`);
      await sleep(400);
    }
    await p.open(h);
    await sleep(700);
    const m = await h.browser.ev(MEASURE_JS);
    assert.equal(m.docX, false, `${tag}: the page scrolls nowhere sideways`);
    if (p.id !== 'sidebar-tree') assert.equal(m.navScrolls, false, `${tag}: the nav never scrolls`);
    assert.deepEqual(m.clipped, [], `${tag}: no clipped text`);
    assert.deepEqual(m.rawTargets, [], `${tag}: no raw link targets where a person reads`);
    if (p.room) {
      const want = SHARE[W][p.id === 'today' ? 'today' : 'room'];
      assert.ok(m.boxW !== null && m.boxW / W >= want, `${tag}: the column uses a sensible share (stood ${m.boxW}px, needs ${want} of ${W})`);
    }
    if (p.id === 'graph') {
      const tail = await h.browser.ev(`document.querySelector('.bg-more')?.innerText ?? ''`);
      assert.match(tail, /^\+\d+ more lobes?$/, `${tag}: the legend counts its tail whole (${tail})`);
      assert.ok(!/1 more lobes/.test(tail), `${tag}: never "+1 more lobes"`);
    }
    if (p.id === 'search') {
      const counts = await h.browser.ev(`[...document.querySelectorAll('.sas-count')].map((e) => ({ t: e.getAttribute('title') || '', a: e.getAttribute('aria-label') || '' }))`);
      assert.ok(counts.length > 0, `${tag}: results carry counts`);
      for (const c of counts) {
        assert.match(c.t, /^\d+ match(es)? in this (note|file)$/, `${tag}: the count says its words (${c.t})`);
        assert.equal(c.a, c.t, `${tag}: the reader hears the same`);
      }
      const cuts = await h.browser.ev(`[...document.querySelectorAll('.sas-snippet')].map((e) => ({ s: (e.innerText || '').replace(/\\s+/g, ' '), over: e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1 }))`);
      assert.ok(cuts.length > 0, `${tag}: snippets show`);
      for (const { s, over } of cuts) {
        assert.equal(over, false, `${tag}: the window fits its row, never clipped again (${s.slice(0, 60)})`);
        for (let i = 0; i < s.length; i++) {
          if (s[i] !== '…') continue;
          const beforeCh = s[i - 1] ?? '';
          const afterCh = s[i + 1] ?? '';
          assert.ok(beforeCh === '' || beforeCh === ' ' || afterCh === '' || afterCh === ' ', `${tag}: no cut word (${s.slice(0, 80)})`);
        }
      }
    }
    if (p.id === 'sidebar-tree') {
      const more = await h.browser.ev(`(() => {
        const el = document.querySelector('.nav-more');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { style: cs.fontStyle, color: cs.color };
      })()`);
      assert.ok(more, `${tag}: Show everything shows`);
      assert.equal(more.style, 'italic', `${tag}: the calm row, as the tree's`);
      const accentText = await h.browser.ev(`(() => { const d = document.createElement('div'); d.style.color = 'var(--accent-text)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`);
      assert.notEqual(more.color, accentText, `${tag}: never the accent`);
    }
    const shot = await h.browser.send('Page.captureScreenshot', { format: 'png' });
    if (shot.result?.data) writeFileSync(path.join(shotsDir, `${p.id}-${W}x${Hg}-after.png`), Buffer.from(shot.result.data, 'base64'));
    await esc(h);
  }
}

test('every page at a wide window, 3456x1408', { timeout: 600000 }, async () => {
  await walk([3456, 1408]);
});

test('every page at the middle window, 1920x1117', { timeout: 600000 }, async () => {
  await walk([1920, 1117]);
});

test('every page at the small window, 1219x709', { timeout: 600000 }, async () => {
  await walk([1219, 709]);
});

// A person with the right side open reads a narrower Today and Tasks (t200: the squeeze): a meeting's name
// wraps whole in place, never dots — and never raw past the edge without its hover (t207 pass 2).
test('squeezed task rows wrap their source whole, never dots, whole on hover', { timeout: 600000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  for (const room of ['Today', 'Tasks']) {
    await esc(h);
    await openRoom(h, room);
    if (room === 'Tasks') {
      await clickWords(h, 'Everyone', 'main');
      await sleep(800);
    }
    await h.browser.ev(`(() => { const b = [...document.querySelectorAll('button')].find((e) => (e.getAttribute('aria-label') || e.title || '') === 'Show the right side'); b?.click(); })()`);
    await sleep(1000);
    // Dots never render (a clamp or an ellipsis anywhere is a fault); anything still overflowing must be a
    // hovered one-line slot, never raw past the edge.
    const subs = await h.browser.ev(`[...document.querySelectorAll('main .td-row-sub .td-text, main .td-row-sub > *, main .tkrow-sub')].map((kid) => {
      const cs = getComputedStyle(kid);
      return {
        cls: kid.className, over: kid.scrollWidth > kid.clientWidth + 1,
        dots: cs.webkitLineClamp !== 'none' || cs.textOverflow === 'ellipsis',
        slot: cs.whiteSpace === 'nowrap' && cs.overflowX === 'hidden',
        title: kid.getAttribute('title') || kid.closest('button')?.getAttribute('title') || '',
      };
    })`);
    assert.ok(subs.length > 0, `${room} squeezed: source labels show`);
    for (const s of subs) assert.equal(s.dots, false, `${room} squeezed: ${s.cls} never shows …`);
    for (const s of subs.filter((s) => s.over)) {
      assert.ok(s.slot && s.title.length > 0, `${room} squeezed: ${s.cls} overflows only as a hovered one-line slot`);
    }
    await h.browser.ev(`(() => { const b = [...document.querySelectorAll('button')].find((e) => (e.innerText || e.getAttribute('aria-label') || e.title || '').includes('Hide the right side')); b?.click(); })()`);
    await sleep(400);
    await esc(h);
  }
});
