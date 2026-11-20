// node --test tests/today-spark-needs.test.mjs — one product: Today holds what needs you from the former host
// app too (9 Nov 2026 brief t53). With the flag on (Vault's page in the former host app's window, ?inWindow=1),
// Today's "N things need a look" list gains the former host app's needs-you rows, one per kind as the list
// already does: "2 approvals waiting", "Code task finished: <title>", "Researcher bot asked a question". Each
// opens the right the former host app place in the one window through the existing notices seam
// (window.nv.notices.open — never a new open route); the count includes them. An Inbox line ("3 captured,
// waiting to be filed") shows when the Inbox holds something and opens the Inbox. The former host app's Needs
// you page and bell stay and read the same items: Today reads the bell's own store, so its rows and the bell
// agree. Flag off: nothing changes. Made-up notices and notes; a fixed clock where it matters.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

// The shaping bundled from the real shared sources, lazily so the source checks below fail on their own
// words first (a missing module fails its own checks, never the whole file's setup).
const work = mkdtempSync(path.join(tmpdir(), 'nv-today-spark-'));
after(() => rmSync(work, { recursive: true, force: true }));
let S = null;
async function shaping() {
  if (!S) {
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    const entry = path.join(work, 'entry.ts');
    writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/spark-needs.ts'))};\n`);
    await build({ input: entry, platform: 'node', output: { file: path.join(work, 'spark-needs.mjs'), format: 'esm' }, logLevel: 'silent' });
    S = await import(pathToFileURL(path.join(work, 'spark-needs.mjs')).href);
  }
  return S;
}
let N = null;
async function notices() {
  if (!N) {
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    const entry = path.join(work, 'entry-notices.ts');
    writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/notices.ts'))};\n`);
    await build({ input: entry, platform: 'node', output: { file: path.join(work, 'notices.mjs'), format: 'esm' }, logLevel: 'silent' });
    N = await import(pathToFileURL(path.join(work, 'notices.mjs')).href);
  }
  return N;
}

// ── The rows and the count ───────────────────────────────────────────────────

const notice = (over) => ({ id: 'n1', at: 1000, kind: 'approval', title: 'the host app needs your OK', body: 'Deploy the site: it wants to run a command. Open it to answer.', sessionId: 's1', read: false, ...over });

test('approvals wait as one row: two read "2 approvals waiting", one reads as one', async () => {
  const s = await shaping();
  const rows = s.sparkTodayRows([
    notice({ id: 'a1', kind: 'approval', sessionId: 's1' }),
    notice({ id: 'a2', kind: 'automation-approval', title: 'An automation needs your OK', sessionId: 's2' }),
  ]);
  assert.equal(rows.length, 1, 'one row per kind, never one per item');
  assert.equal(rows[0].key, 'approvals');
  assert.equal(rows[0].title, '2 approvals waiting');
  assert.deepEqual(rows[0].items.map((i) => i.id), ['a1', 'a2'], 'newest first, as the bell lists them');
  const one = s.sparkTodayRows([notice({ id: 'a1', kind: 'approval' })]);
  assert.equal(one[0].title, '1 approval waiting');
});

test('a finished code task reads with its title; several fold to one row', async () => {
  const s = await shaping();
  const one = s.sparkTodayRows([notice({ id: 'c1', kind: 'done', title: 'Task finished', body: 'Harbourview quote follow-up', sessionId: 's9', surface: 'code' })]);
  assert.equal(one.length, 1);
  assert.equal(one[0].key, 'code-done');
  assert.equal(one[0].title, 'Code task finished: Harbourview quote follow-up');
  const two = s.sparkTodayRows([
    notice({ id: 'c1', kind: 'done', title: 'Task finished', body: 'Harbourview quote follow-up', sessionId: 's9', surface: 'code' }),
    notice({ id: 'c2', kind: 'done', title: 'Task finished', body: 'Fix the retry', sessionId: 's8', surface: 'code' }),
  ]);
  assert.equal(two[0].title, '2 code tasks finished');
  // A stopped code task is its own kind, never hidden inside finished.
  const stopped = s.sparkTodayRows([notice({ id: 'c3', kind: 'failed', title: 'Task stopped', body: 'Fix the retry', sessionId: 's8', surface: 'code' })]);
  assert.equal(stopped[0].key, 'code-stopped');
  assert.equal(stopped[0].title, 'Code task stopped: Fix the retry');
  // A finished chat is the bell's news, not a code row.
  assert.deepEqual(s.sparkTodayRows([notice({ id: 'c4', kind: 'done', title: 'Answer ready', body: 'Lunch spots', sessionId: 's7', surface: 'chat' })]), [], 'chat ends stay out of the code rows');
});

test('a bot asking reads with its name; several fold to one row', async () => {
  const s = await shaping();
  const one = s.sparkTodayRows([notice({ id: 'b1', kind: 'question', title: 'the host app has a question', body: 'Harbourview lobby stone. Open it to answer.', sessionId: 's5', surface: 'bot', bot: 'Researcher' })]);
  assert.equal(one.length, 1);
  assert.equal(one[0].key, 'bot-ask');
  assert.equal(one[0].title, 'Researcher bot asked a question');
  const unnamed = s.sparkTodayRows([notice({ id: 'b2', kind: 'question', sessionId: 's6', surface: 'bot' })]);
  assert.equal(unnamed[0].title, 'A bot asked a question');
  const two = s.sparkTodayRows([
    notice({ id: 'b1', kind: 'question', sessionId: 's5', surface: 'bot', bot: 'Researcher' }),
    notice({ id: 'b2', kind: 'question', sessionId: 's6', surface: 'bot', bot: 'Household' }),
  ]);
  assert.equal(two[0].title, '2 bot questions waiting');
  // A the former host app chat's own question is the bell's news, not a bot row.
  assert.deepEqual(s.sparkTodayRows([notice({ id: 'b3', kind: 'question', sessionId: 's4', surface: 'chat' })]), [], 'chat questions stay out of the bot rows');
});

test('only what still needs you rows: read ones and the vault’s own kinds stay out', async () => {
  const s = await shaping();
  assert.deepEqual(s.sparkTodayRows([notice({ id: 'r1', read: true })]), [], 'read approvals stay in the bell’s history, not Today');
  for (const kind of ['reminder', 'finance', 'documents', 'tidy', 'names']) {
    assert.deepEqual(s.sparkTodayRows([notice({ id: `o-${kind}`, kind, sessionId: '', note: 'Tasks.md', line: 1 })]), [], `${kind} is the vault’s own row, never a host row`);
  }
  // A reminder's notice carries its key: skipped even under another kind.
  assert.deepEqual(s.sparkTodayRows([notice({ id: 'o2', kind: 'done', reminder: 'Tasks.md\nRing the bank\n2' })]), [], 'a notice with a reminder key is ours');
});

test('kinds keep their order: approvals, finished code, stopped code, bot asks', async () => {
  const s = await shaping();
  const rows = s.sparkTodayRows([
    notice({ id: 'b1', kind: 'question', sessionId: 's5', surface: 'bot', bot: 'Researcher' }),
    notice({ id: 'c3', kind: 'failed', title: 'Task stopped', body: 'Fix the retry', sessionId: 's8', surface: 'code' }),
    notice({ id: 'c1', kind: 'done', title: 'Task finished', body: 'Harbourview quote follow-up', sessionId: 's9', surface: 'code' }),
    notice({ id: 'a1', kind: 'approval', sessionId: 's1' }),
  ]);
  assert.deepEqual(rows.map((r) => r.key), ['approvals', 'code-done', 'code-stopped', 'bot-ask']);
});

test('the Inbox line counts captures waiting to be filed', async () => {
  const s = await shaping();
  assert.equal(s.inboxLine(3), '3 captured, waiting to be filed');
  assert.equal(s.inboxLine(1), '1 captured, waiting to be filed');
  assert.equal(s.inboxLine(0), '', 'an empty Inbox is no line');
});

// ── The seam: surface and bot ride the bell’s notices ────────────────────────

test('the bell’s notices carry surface and bot through, made safe', async () => {
  const n = await notices();
  const view = n.cleanNotices({
    items: [
      { id: 'c1', at: 1000, kind: 'done', title: 'Task finished', body: 'Fix it', sessionId: 's9', read: false, surface: 'code' },
      { id: 'b1', at: 900, kind: 'question', title: 'the host app has a question', body: 'Stone. Open it to answer.', sessionId: 's5', read: false, surface: 'bot', bot: 'Researcher' },
      { id: 'x1', at: 800, kind: 'done', title: 'Answer ready', body: 'Lunch', sessionId: 's7', read: false, surface: 'sideways', bot: '   ' },
    ],
  });
  assert.equal(view.items[0].surface, 'code', 'code rides through');
  assert.equal(view.items[1].surface, 'bot', 'bot rides through');
  assert.equal(view.items[1].bot, 'Researcher', 'the bot’s name rides through');
  assert.equal(view.items[2].surface, undefined, 'an unknown surface never rides');
  assert.equal(view.items[2].bot, undefined, 'a blank name never rides');
  const merged = n.mergeNotices([], { items: view.items, unread: 3 });
  assert.equal(merged.items.find((i) => i.id === 'b1')?.bot, 'Researcher', 'the merge keeps them for Today and the bell alike');
});

// ── Today renders them, behind the flag ──────────────────────────────────────

test('Today reads the bell’s own store, behind the flag', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('from \'../panels/NoticeBell\''), 'Today reads the bell’s store');
  assert.ok(src.includes('useNotices()'), 'the same hook the bell reads');
  assert.ok(src.includes('refreshNotices()'), 'fresh when Today opens, so its rows and the bell agree');
  assert.ok(src.includes('inVaultView()'), 'behind the one-window flag');
  assert.ok(src.includes('spark-needs'), 'shaped by the one shared shaping');
  assert.ok(/inView \? sparkTodayRows\(notices\.items\) : \[\]/.test(src), 'flag off shapes nothing');
});

test('the host rows list first in the look list, one row per kind, counted', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  const items = src.indexOf('td-look-items');
  assert.ok(items > 0, 'the look list');
  const spark = src.indexOf('data-spark-row');
  assert.ok(spark > items, 'the host rows live inside the look list');
  assert.ok(spark < src.indexOf('<VaultTodayCards />'), 'first, before the vault rows');
  assert.ok(src.includes('data-look-row'), 'each the host app row carries the count mark');
  assert.ok(src.includes('className="td-quiet-line" data-look-row data-spark-row'), 'a lone wait opens straight from its line');
  assert.ok(src.includes('<LookRow key={row.key}'), 'several waits of a kind open to their list');
});

test('each the host app row opens its place through the existing notices seam, never a new route', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('window.nv.notices.open('), 'a host row opens through notices.open, the bell’s own door');
  assert.ok(!src.includes('nv.spark'), 'no new the host app door on the bridge');
  const preload = read('src/preload/index.ts');
  assert.ok(!preload.includes('spark-today') && !preload.includes('sparkNeeds'), 'no new channel for Today’s the host app rows');
  const main = read('src/main/app.ts');
  assert.ok(!main.includes('spark-today') && !main.includes('sparkNeeds'), 'no new main handle either: the notices seam carries them');
});

test('the Inbox line shows when the Inbox holds something, and opens the Inbox', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('inboxLine(inboxCount)'), 'the line counts captures waiting to be filed');
  assert.ok(src.includes('inView && inboxCount > 0'), 'only behind the flag, only when the Inbox holds something');
  assert.ok(src.includes('data-spark-row="inbox"'), 'marked as its own row');
  assert.ok(src.includes('openInbox()'), 'opening lands in the Inbox');
  assert.ok(src.includes("from '../state/life'"), 'through the Inbox’s own door');
});

test('nothing shows twice: the turned-on Inbox card yields to the line in the view', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(/id !== 'inbox' \|\| !inVaultView\(\)/.test(src), 'the card row steps aside where the line shows');
});

test('flag off leaves the page as today: no host, no line, cards as they were', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(src.includes('{inView && sparkRows.map'), 'no host rows without the flag');
  assert.ok(src.includes('{inView && inboxCount > 0'), 'no Inbox line without the flag');
  // The window's own Inbox card still lists when turned on (the yield above only bites in the view).
  assert.ok(src.includes('<LookCards layoutOn={homeLayout.on}'), 'the cards list as they did');
});

// ── Live: flag off unchanged ─────────────────────────────────────────────────

test('live, flag off: Today holds no host rows and no Inbox line', { timeout: 240000 }, async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const { startHarness } = await import('./vault-controls-harness.mjs');
  const h = await startHarness({ realChecks: true });
  try {
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
    const t0 = Date.now();
    for (;;) {
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
      assert.ok(Date.now() - t0 < 60000, 'the app boots');
      await new Promise((r) => setTimeout(r, 300));
    }
    await new Promise((r) => setTimeout(r, 1500));
    // Today, without ?inWindow=1: the window's own page.
    const clicked = await h.browser.ev(`(async () => {
      const els = [...document.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
      const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes('Today')));
      if (!el) return 'NOTFOUND';
      el.click();
      await new Promise((r) => setTimeout(r, 400));
      return 'CLICKED';
    })()`);
    assert.equal(clicked, 'CLICKED', 'Today opens');
    const t1 = Date.now();
    for (;;) {
      try {
        if (await h.browser.ev(`!!document.querySelector('.td-view')`)) break;
      } catch {}
      assert.ok(Date.now() - t1 < 60000, 'Today renders');
      await new Promise((r) => setTimeout(r, 300));
    }
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(await h.browser.ev(`document.querySelector('[data-spark-row]') ? 'FOUND' : 'NONE'`), 'NONE', 'no host rows without the flag');
    const line = await h.browser.ev(`document.querySelector('[data-section="also"] h2')?.innerText.replace(/\\s+/g, ' ') ?? ''`);
    assert.ok(!/approval waiting|Code task|asked a question|captured, waiting/.test(line), `Also names no host waits (saw ${JSON.stringify(line)})`);
  } finally {
    await h.close().catch(() => undefined);
  }
});
