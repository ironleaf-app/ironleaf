// node --test tests/vault-one-door.test.mjs — one search door, a quiet rail, a clean header (5 Nov 2026).
// (1) The centred "Ask or find anything" bar is the one door to search, notes and ask: the rail's Search
// row and the header's Ask button are gone, Ctrl+O and Ctrl+K (and Ctrl+P) all open the same panel. (2) The
// rail is Today, Inbox, Projects, Tasks, Meetings, Notes, People, More: counts on Today and Inbox only,
// pins with Shared spaces/packs in More's quiet second group (9 Nov 2026), never scrolling at any window
// height (Home folded into Today: no Home row; old links open Today). (3) A note's header is Share, Read
// and the … menu: Publish, Yesterday/Tomorrow, the canvas pair, Send and the rest live in the … menu. Each
// check fails without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the quiet rail ─────────────────────────────────────────────────────────────

test('the rail is Today, Inbox, Projects, Tasks, Meetings, Notes, People, More, in order', () => {
  const places = read('src/renderer/src/panels/Places.tsx');
  const order = ['<Row row={f.today} />', '<Row row={f.inbox} />', '<Row row={f.projects} />', '<Row row={f.tasks} />', '<Row row={f.meetings} />', '<Row row={f.notes} />', '<Row row={f.people} />', '>More<'];
  let at = -1;
  for (const bit of order) {
    const next = places.indexOf(bit, at + 1);
    assert.ok(next > at, `${bit} follows in order`);
    at = next;
  }
  assert.ok(places.includes("label: 'Tasks'") && places.includes('A.openTasks()'), 'Tasks is a rail row opening Tasks');
  assert.ok(!places.includes('<Row row={f.search} />'), 'no Search row (the centred bar is the door)');
  assert.ok(!places.includes('<Row row={f.home} />') && !places.includes("label: 'Home'"), 'no Home row anywhere (Today is the one morning place)');
  assert.ok(!places.includes('<Row row={f.shared} />'), 'no Shared spaces row (behind More)');
  assert.ok(!places.includes('Packs ·'), 'no packs group on the rail (behind More)');
  assert.ok(!places.includes('>Projects<') && !places.includes('>Notes and people<'), 'no group labels: quiet rows');
  // The folded icon rail mirrors the same rows.
  const rail = places.split('export function Rail()')[1].split('export function PlacesFoot')[0];
  assert.ok(rail.includes('f.today') && rail.includes('f.inbox') && rail.includes('f.projects') && rail.includes('f.tasks') && rail.includes('f.meetings') && rail.includes('f.notes') && rail.includes('f.people'), 'the folded rail keeps the same rows');
  assert.ok(!rail.includes('f.search') && !rail.includes('f.home') && !rail.includes('f.shared'), 'the folded rail drops Search, Home and Shared spaces too');
});

test('counts on Today and Inbox only', () => {
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes('count: due || undefined'), 'Today keeps the one Today count');
  // t31 (8 Nov 2026): sidebarTodayCount reads the one rule, shared with the former host app's one
  // side bar.
  assert.ok(places.includes('sidebarTodayCount('), 'through the one rule Today and Tasks read');
  assert.ok(places.includes('count: inbox'), 'Inbox keeps its waiting count');
  assert.ok(!places.includes('projectsCount'), 'Projects carries no count');
  assert.ok(!places.includes('lateForYouCount'), 'no Tasks-late badge on the bar (the Tasks page reads it)');
  assert.ok(!places.includes('tasksLate'), 'no late hint rides into More');
  assert.ok(!places.includes('keyHint'), 'no key hints on quiet rows (the bar names its own keys)');
});

test('Shared spaces, packs and pins live in More; Tasks leaves More for the rail', () => {
  // 9 Nov 2026, the rows back: Shared spaces and packs sit in More's quiet second group and still answer
  // in Ctrl+K by name; pins keep their More rows. Tasks stays on the rail.
  const places = read('src/renderer/src/panels/Places.tsx');
  const more = places.slice(places.indexOf('function moreItems'), places.indexOf('export interface FrameRow'));
  assert.ok(!more.includes("label: 'Home'"), 'no Home in More (Home folded into Today: old links open Today)');
  assert.ok(more.includes("label: 'Shared spaces'"), 'Shared spaces back in More');
  assert.ok(read('src/renderer/src/state/commands.ts').includes("id: 'shared-spaces'"), 'Ctrl+K opens Shared spaces');
  assert.ok(!more.includes("label: 'Tasks'"), 'Tasks is on the rail, not doubled in More');
  assert.ok(places.includes("label: 'Choose packs…'"), 'the packs chooser back in More');
  assert.ok(read('src/renderer/src/components/Modals.tsx').includes('packPaletteRows('), 'each switched-on pack answers in Ctrl+K');
  assert.ok(places.includes('pinItems') && places.includes('slice(0, 5)'), 'pinned keep their More rows, up to five');
  assert.ok(!places.includes("{ heading: 'Packs' }"), 'no old packs heading in More (Packs and kinds holds them now)');
});

test('the fold fits the rows without scrolling: Notes and People first, then Tasks and Meetings, then Projects', () => {
  const places = read('src/renderer/src/panels/Places.tsx');
  assert.ok(places.includes('export interface BarRows { today: boolean; tasks: boolean; meetings: boolean }'), 'the fold reads what the rail shows');
  assert.ok(places.includes('(level >= 1 ? 2 : 0)') && places.includes('(level >= 2 ?') && places.includes('(level >= 3 ? 1 : 0)'), 'three fold steps');
  assert.ok(places.includes('fold >= 1') && places.includes('fold >= 2') && places.includes('fold >= 3'), 'each step folds its rows into More');
  assert.ok(read('src/renderer/src/styles/kit.css').includes('.side .places-list { flex: 1 1 0; min-height: 0; overflow: hidden; }'), 'the list itself never scrolls');
});

// ── the one door ───────────────────────────────────────────────────────────────

test('Ctrl+O and Ctrl+K (and Ctrl+P) open the one panel; the switcher keeps no default key', () => {
  const cmds = read('src/renderer/src/state/commands.ts');
  assert.ok(cmds.includes("id: 'palette'") && cmds.includes("hotkey: 'Mod+K'"), 'Ctrl+K opens the panel');
  assert.ok(cmds.includes("also: ['Mod+O', 'Mod+P']") || cmds.includes('also: ["Mod+O", "Mod+P"]'), 'Ctrl+O and Ctrl+P open the same panel');
  const at = cmds.indexOf("{ id: 'switcher'");
  const switcher = cmds.slice(at, cmds.indexOf('\n', at));
  assert.ok(!switcher.includes('hotkey'), 'Open a note keeps no default key (it lives in the panel)');
  assert.ok(switcher.includes("openModal({ kind: 'switcher' })"), 'Open a note still opens the full finder from the panel');
  assert.ok(cmds.includes('export function alsoKeys'), 'the extra combos read through one helper');
  assert.ok(read('src/renderer/src/App.tsx').includes('alsoKeys(cmd)'), 'the key loop honours every extra combo');
  assert.ok(read('src/renderer/src/components/Settings.tsx').includes('alsoKeys(c)'), 'Settings treats every extra combo as taken');
});

test('the centred bar stays on every page; its Ask button is gone', () => {
  const bar = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(bar.includes('className="top-search"') && bar.includes('Ask or find anything'), 'the centred bar stays');
  assert.ok(!bar.includes('<span>Ask</span>') && !bar.includes('toggleChat'), 'no Ask button in the header');
  assert.ok(bar.includes('formatHotkey(\'Mod+O\')') || bar.includes("Ctrl+K or Ctrl+O") || bar.includes('Mod+O'), 'the bar names both keys');
  const cmds = read('src/renderer/src/state/commands.ts');
  assert.ok(cmds.includes("id: 'ask'") && cmds.includes("hotkey: 'Mod+J'"), 'Ctrl+J still asks from anywhere');
  // One-voice pass: the helper is the assistant now; the mode still asks in the side chat (ask: runs sendChat).
  assert.ok(read('src/renderer/src/components/Modals.tsx').includes('Ask the assistant about'), 'the panel’s Ask mode still asks in the side chat');
});

// ── the clean note header ──────────────────────────────────────────────────────

test('a note’s header is Share, Read and the … menu, nothing else', () => {
  const view = read('src/renderer/src/views/NoteView.tsx');
  assert.ok(view.includes('<ShareButton path={path}'), 'Share stays');
  assert.ok(view.includes('data-overflow="read"'), 'Read stays');
  assert.ok(view.includes('menu={noteOverflowMenu}'), 'the … menu stays');
  for (const gone of ['SEND_CHOICES', 'view-action-send', 'data-overflow="send"', 'data-overflow="publish"', 'data-overflow="yesterday"', 'data-overflow="tomorrow"', 'data-overflow="canvas"', 'data-overflow="update-canvas"', 'data-overflow="project-page"']) {
    assert.ok(!view.includes(gone), `the header no longer carries ${gone}`);
  }
  assert.ok(view.includes('className="view-private"'), 'a private note still says it is private');
  assert.ok(view.includes('{dictateSaid && ('), 'the microphone shows only while recording, to stop');
  assert.ok(!view.includes("prefsNow.dictation && window.nv.dictation?.available && ("), 'dictation no longer sits in the header');
});

test('everything the header held still runs from the … menu', () => {
  const menus = read('src/renderer/src/state/menus.ts');
  assert.ok(menus.includes("label: 'Publish as a website…'"), 'Publish runs from the menu');
  assert.ok(menus.includes("label: 'Yesterday'") && menus.includes("label: 'Tomorrow'"), 'Yesterday and Tomorrow run from the menu on a daily note');
  assert.ok(menus.includes('openDailyOffset(-1)') && menus.includes('openDailyOffset(1)'), 'through the same opener');
  assert.ok(menus.includes("label: 'Project page'"), 'Project page runs from the menu on a project’s note');
  assert.ok(menus.includes("label: 'Dictate'") && menus.includes("runCommand('dictate')"), 'Dictate runs from the menu');
  assert.ok(menus.includes("label: 'Show as canvas'") && menus.includes("label: 'Update canvas from doc'"), 'the canvas pair stays in the menu');
  assert.ok(menus.includes("label: 'Reading'") && menus.includes("label: 'Live Preview'") && menus.includes("label: 'Source'"), 'the read switch stays in the menu');
});

// ── live: the real renderer ────────────────────────────────────────────────────

let H = null;
async function harness() {
  if (!H) {
    const { startHarness } = await import('./vault-controls-harness.mjs');
    H = await startHarness();
    const ev = H.browser.ev;
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2200);
    // The fullest rail: Meetings on, Tasks and Today shown.
    await H.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2500);
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => undefined);
  H = null;
});

const clickWords = (h, words, scope = '') =>
  h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`);
const key = (h, windowsVirtualKeyCode, k, code, modifiers = 0) =>
  (async () => {
    await h.browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode, key: k, code, modifiers });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode, key: k, code, modifiers });
    await sleep(400);
  })();

test('live: the rail never scrolls, short windows fold rows into More', async () => {
  const h = await harness();
  const ev = h.browser.ev;
  assert.equal(await clickWords(h, 'Today', '.places-list'), 'CLICKED', 'Today opens from the rail');
  await sleep(1200);
  for (const height of [320, 360, 400, 440, 500, 620, 709, 900, 1408]) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    const m = await ev(`(() => {
      const list = document.querySelector('.places-list');
      const side = document.querySelector('.sidebar.left');
      const rows = [...list.querySelectorAll('.srow')].map((e) => ({ label: e.querySelector('.clip')?.textContent ?? '', n: !!e.querySelector('.n'), badge: e.querySelector('.n')?.textContent ?? null }));
      return { listOver: list.scrollHeight - list.clientHeight, sideOver: side.scrollHeight - side.clientHeight, fold: list.dataset.fold, rows };
    })()`);
    const labels = m.rows.map((r) => r.label);
    assert.ok(m.listOver <= 1, `at ${height}px the places list never scrolls (${m.listOver}px over)`);
    assert.ok(m.sideOver <= 1, `at ${height}px the bar never scrolls (${m.sideOver}px over)`);
    assert.ok(!labels.includes('Search'), `at ${height}px no Search row (rows: ${labels.join(' · ')})`);
    assert.ok(labels.includes('More'), `at ${height}px More stays (rows: ${labels.join(' · ')})`);
    if (height >= 440) {
      assert.deepEqual(labels, ['Today', 'Inbox', 'Projects', 'Tasks', 'Meetings', 'Notes', 'People', 'More'], `at ${height}px the full quiet rail shows`);
      // Today reads the one count the Today page reads (5 Nov 2026, one counting query): the rail's Today
      // badge matches the page's own line ("You have 2 late and 1 due today." → 3; "Nothing needs you
      // today." → no badge). The harness vault's dated work is all other people's, so Today is correctly
      // badgeless here; the Inbox badge proves the badge path itself. Fails on the old count (3, not 0).
      const sentence = await ev(`document.querySelector('.td-sentence')?.textContent ?? ''`);
      assert.ok(sentence, `at ${height}px the Today page says its line`);
      if (!sentence.startsWith('Nothing needs you in ')) {
        const late = Number(/(\d+)\s+late/.exec(sentence)?.[1] ?? 0);
        const due = Number(/(\d+)\s+due today/.exec(sentence)?.[1] ?? 0);
        const want = late + due === 0 ? null : String(late + due);
        assert.equal(m.rows[0].badge, want, `at ${height}px the rail's Today badge matches the Today page (${JSON.stringify(sentence)} → ${JSON.stringify(want)})`);
      }
      assert.deepEqual([m.rows[1].n, ...m.rows.slice(2).map((r) => r.n)], [true, false, false, false, false, false, false], `at ${height}px counts sit on Today and Inbox only`);
    } else {
      // 20 Nov 2026: the foot lost its account row, so a short window keeps more rows; what never changes is that
      // the first places stay, the rest fold into More in order, and More is always the last row.
      const all = ['Today', 'Inbox', 'Projects', 'Tasks', 'Meetings', 'Notes', 'People'];
      assert.equal(labels.at(-1), 'More', `at ${height}px More is the last row (${labels.join(' · ')})`);
      assert.deepEqual(labels.slice(0, -1), all.slice(0, labels.length - 1), `at ${height}px the rows fold from the end, in order (${labels.join(' · ')})`);
      assert.ok(labels.length >= 4, `at ${height}px Today, Inbox and Projects always stay`);
    }
  }
  // At the shortest window the folded rows wait at the top of More.
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 320, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  assert.equal(await clickWords(h, 'More', '.places-list'), 'CLICKED', 'More opens');
  await sleep(800);
  const more = await ev(`[...document.querySelectorAll('.menu [role="menuitem"], .menu button, .menu .menu-heading')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')`);
  for (const row of ['From the side bar', 'Notes', 'People']) assert.ok(more.includes(row), `More carries ${row} (got: ${more.slice(0, 200)})`);
  await key(h, 27, 'Escape', 'Escape');
});

test('live: Ctrl+O and Ctrl+K open the one panel; no Search row, no Ask button', async () => {
  const h = await harness();
  const ev = h.browser.ev;
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  for (const [code, name] of [['KeyO', 'Ctrl+O'], ['KeyK', 'Ctrl+K']]) {
    await key(h, code === 'KeyO' ? 79 : 75, code === 'KeyO' ? 'o' : 'k', code, 2);
    await sleep(1000);
    assert.equal(await ev(`document.querySelector('.picker input')?.getAttribute('placeholder') ?? null`), 'Ask or find anything…', `${name} opens the one panel`);
    await key(h, 27, 'Escape', 'Escape');
    await sleep(600);
    assert.equal(await ev(`!!document.querySelector('.picker')`), false, 'Escape puts it away');
  }
  assert.equal(await ev(`[...document.querySelectorAll('.places-list .srow')].some((e) => e.innerText.includes('Search'))`), false, 'no Search row on the rail');
  assert.equal(await ev(`!!document.querySelector('.topbar .chip')`), false, 'no Ask button in the header');
  assert.equal(await ev(`!!document.querySelector('.top-search')`), true, 'the centred bar stays');
});

test('live: a note’s header carries Share, Read and More — and More carries Publish', async () => {
  const h = await harness();
  const ev = h.browser.ev;
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  assert.equal(await clickWords(h, 'Notes', '.places-list'), 'CLICKED', 'Notes opens from the rail');
  await sleep(1200);
  assert.equal(await clickWords(h, 'Receipts v2', 'main'), 'CLICKED', 'the note opens');
  await sleep(1800);
  const head = await ev(`(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && getComputedStyle(el).display !== 'none'; };
    const right = document.querySelector('.topbar .right');
    return [...right.children].filter(vis).map((el) => el.getAttribute('aria-label') || el.innerText.replace(/\\s+/g, ' ').trim() || el.title);
  })()`);
  // The frame's own chrome (show-side, avatar) aside, the page carries three things.
  const page = head.filter((w) => w !== 'Show the right side' && !w.includes('open Settings'));
  assert.deepEqual(page, ['Share', 'Read (Ctrl+E)', 'More'], `Share, Read and More only (got: ${JSON.stringify(head)})`);
  assert.equal(await clickWords(h, 'More', '.topbar .right'), 'CLICKED', 'the … menu opens');
  await sleep(800);
  const menu = await ev(`[...document.querySelectorAll('.menu button, .menu [role="menuitem"]')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')`);
  assert.ok(menu.includes('Publish as a website…'), `Publish runs from the … menu (got: ${menu.slice(0, 300)})`);
  // (Dictate's menu row reads dictation's availability, which headless Chromium has not; the static test
  // above pins its row and its row's conditions instead.)
  await key(h, 27, 'Escape', 'Escape');
  assert.deepEqual(await ev(`window.__nvErrors`), [], 'no page errors');
});
