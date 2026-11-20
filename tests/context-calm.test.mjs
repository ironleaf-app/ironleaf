// node --test tests/context-calm.test.mjs — a note's Context panel and the Notes head say nothing empty
// and nothing twice (5 Nov 2026): an empty rail box does not show (People, Open tasks, Related meetings
// appear only with something in them; the link lists left for the foot and the side on 8 Nov 2026,
// t22-note-once); Belongs to stays but is one quiet line opening the choice when the note belongs to
// nothing; the rail's sections are a heading and a dividing line, never boxes in a panel; the Notes head
// drops its repeated count and says its changed-today line only when it is news. Nothing a person can do
// is lost: @, / and [[ still work in the note, and Project and Area can still be set. Each check fails
// without its change.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

const rail = () => read('src/renderer/src/views/note/ContextRail.tsx');

test('an empty box does not show: no instructing empties, sections only with content', () => {
  const src = rail();
  for (const words of ['No people named yet', 'No open tasks', 'No links yet', 'Nothing links here yet', 'No meetings are joined to this note yet', 'Type @ to name someone', 'Type / and choose Task', 'Type [[ to link a note']) {
    assert.ok(!src.includes(words), `no "${words}"`);
  }
  for (const [name, cond] of [['People in it', 'rail.people.length > 0'], ['Open tasks', 'rail.openTasks.length > 0'], ['Related meetings', 'rail.meetings.length > 0']]) {
    assert.ok(src.includes(`{${cond} && (`), `${name} appears only with something in it`);
  }
  // The link lists left the rail for their one homes (t22-note-once, 8 Nov 2026): what links here reads at the
  // foot, what the note links to reads in the side, so neither is said twice.
  for (const gone of ['Links to', 'Linked from', 'Linked here', 'Could not check what links here just now.']) {
    assert.ok(!src.includes(gone), `no "${gone}" in the rail`);
  }
  const foot = read('src/renderer/src/components/NoteFoot.tsx');
  assert.ok(foot.includes('Try again'), 'the failed check still says so, quietly, where the links live');
});

test('nothing a person can do is lost from the rail', () => {
  const src = rail();
  assert.ok(src.includes("setProp('project'") && src.includes("setProp('area'"), 'Project and Area can still be set');
  assert.equal((src.match(/<select/g) ?? []).length, 2, 'both choices stay');
  assert.ok(src.includes('onJump(t.line)') && src.includes('onToggleTask(t.line)'), 'tasks still jump and tick');
  assert.ok(src.includes('onOpen(p, e.ctrlKey || e.metaKey)') || src.includes('onOpen(p,'), 'rows still open');
});

test('Belongs to is one quiet line when the note belongs to nothing', () => {
  const src = rail();
  assert.ok(src.includes('nv-rail-belonging-none'), 'the quiet line');
  assert.ok(src.includes('setPlacing(true)'), 'it opens the choice');
  assert.ok(src.includes('No project or area'), 'it says what is so, plainly');
  assert.ok(src.includes('belongsSet') || src.includes('belongsToSomething'), 'set notes keep their fields');
  const css = read('src/renderer/src/styles/note-context.css');
  const rule = css.match(/\.nv-rail-belonging-none \{([^}]*)\}/s)?.[1] ?? assert.fail('no quiet-line rule');
  assert.ok(rule.includes('color: var(--text-faint)'), 'quiet until hovered');
  assert.ok(rule.includes('width: 100%') && rule.includes('text-align: left'), 'one full line');
});

test('the rail reads as one panel: sections unboxed, a dividing line between them', () => {
  const premium = read('src/renderer/src/styles/premium-layer.css');
  const tail = premium.slice(premium.indexOf('one panel, not cards in a panel'));
  assert.ok(tail.length > 100, 'the unboxing rule sits at the shared sheet’s end');
  assert.ok(tail.includes(':root .nv-rail-section') && tail.includes('background: transparent') && tail.includes('box-shadow: none') && tail.includes('border-radius: 0'), 'no box: no fill, no shadow, no corners');
  assert.ok(/section \+ section \{[^}]*border-top: 1px solid var\(--border\)/.test(tail), 'a dividing line where a heading and a line do the job');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(tail), 'theme tokens only');
});

test('the Notes head says one count, and only when it is news', () => {
  const page = read('src/renderer/src/views/NotesPage.tsx');
  const lead = page.match(/lead=\{([\s\S]*?)\n\s*actions=/)?.[1] ?? assert.fail('no Notes lead');
  assert.ok(lead.includes("plural(todayCount, 'note changed today', 'notes changed today')"), 'the changed-today count keeps its noun');
  assert.ok(!lead.includes('note, doc or daily note'), 'the repeated total is gone: the title count and the All chip already say it');
  assert.ok(!lead.includes('rows.length'), 'no second sentence from the row count');
  assert.ok(/lead=\{todayCount \?/.test(page), 'said only when it is news: nothing on a fresh or unchanged vault');
  assert.ok(!page.includes("lead={rows.length"), 'the old always-a-lead shape is gone');
});

// Measured: the open rail beside a long note at the three windows, sections full: unboxed
// (transparent, no shadow, square) with a dividing line between sections, and every row inside the
// rail. The scene mirrors views/note/ContextRail.tsx (same classes, same order).
test('measured: sections unboxed with dividers, rows inside, at three windows', async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const WebSocket = require('ws');
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import '\.\/(styles\.css|styles\/[^']+\.css)';/g)].map((m) => m[1]);
  const css = [...order, 'styles/note-context.css', 'styles/w2b.css'].map((f) => `/* ${f} */\n${read(`src/renderer/src/${f}`)}`).join('\n');
  const svg = (s) => `<svg width="${s}" height="${s}"></svg>`;
  const P = 'The hall holds two hundred when the back wall folds away, and the caterers want the final headcount a fortnight out, so the plan is to confirm numbers on the Friday and send the seating map the following Monday. ';
  const html = `<!doctype html><html lang="en-AU" data-theme="light" data-palette="bright"><head><meta charset="utf-8"><style>${css}</style>
<style>html, body { margin: 0; height: 100%; } .app { height: 100vh; display: flex; } .note-view { flex: 1; min-width: 0; display: flex; flex-direction: column; }</style></head>
<body><div class="app" data-platform="linux"><div class="note-view w2b-note mode-reading readable"><div class="nv-note-layout"><div class="nv-note-main"><div class="reading-page"><h1>Harbour fit-out review</h1><p>${P.repeat(6)}</p><h2>What is working</h2><p>${P.repeat(6)}</p><h2>Roster notes</h2><p>${P.repeat(6)}</p></div></div>
<aside class="nv-rail" aria-label="This note's context"><div class="nv-rail-head"><span>Context</span><button class="icon-button">${svg(13)}</button></div>
<section class="nv-strip-section"><h3>On this page</h3><ul class="nv-strip-list"><li><button class="nv-strip-row"><span>What is working</span></button></li><li><button class="nv-strip-row"><span>Roster notes</span></button></li><li><button class="nv-strip-row"><span>Changes</span></button></li></ul></section>
<section class="nv-rail-section"><h3>Belongs to</h3><label class="nv-rail-field"><span>Project</span><select><option>Harbourline Cart Fix</option></select></label><label class="nv-rail-field"><span>Area</span><select><option>Harbourline</option></select></label></section>
<section class="nv-rail-section"><h3>People in it <span class="nv-rail-count">2</span></h3><ul class="nv-rail-list"><li><button class="nv-rail-row"><span class="nv-rail-avatar">G</span><span>Jesse Rossi</span></button></li><li><button class="nv-rail-row"><span class="nv-rail-avatar">M</span><span>Mia Tran, who looks after the suppliers and the loading dock bookings</span></button></li></ul></section>
<section class="nv-rail-section"><h3>Related meetings <span class="nv-rail-count">1</span></h3><ul class="nv-rail-list"><li><button class="nv-rail-row">${svg(12)}<span>Friday standup</span></button></li></ul></section>
</aside></div></div></div></body></html>`;
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-context-calm-'));
  const file = path.join(dir, 'rail.html');
  writeFileSync(file, html);
  const port = await new Promise((resolve) => {
    const s = require('node:net').createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const child = spawn(SHELL, ['--headless', '--no-sandbox', '--disable-gpu', '--no-proxy-server', `--remote-debugging-port=${port}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    let target;
    for (let i = 0; i < 100 && !target; i++) {
      await sleep(150);
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
      } catch {}
    }
    assert.ok(target, 'the browser opened');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 1;
    const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d.result);
        pending.delete(d.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const i = id++;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
    await send('Page.enable');
    await send('Runtime.enable');
    for (const [W, H] of [[3456, 1408], [1920, 1117], [1219, 709]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: pathToFileURL(file).href });
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        await sleep(150);
        try {
          ready = await ev(`!!document.querySelector('.nv-rail-section .nv-rail-row')`);
        } catch {}
      }
      assert.ok(ready, `the rail drew at ${W}x${H}`);
      const m = await ev(`(() => {
        const rail = document.querySelector('.nv-rail');
        const rb = rail.getBoundingClientRect();
        const sections = [...rail.querySelectorAll(':scope > section')].map((el) => {
          const cs = getComputedStyle(el);
          const b = el.getBoundingClientRect();
          return { cls: el.className, bg: cs.backgroundColor, shadow: cs.boxShadow, radius: cs.borderRadius, topW: cs.borderTopWidth, topC: cs.borderTopColor, top: b.top, left: b.left, right: b.right };
        });
        const rows = [...rail.querySelectorAll('.nv-rail-row, .nv-rail-field select')].map((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right }; });
        return { rail: { left: rb.left, right: rb.right }, sections, rows };
      })()`);
      const where = `${W}x${H}`;
      const boxed = m.sections.filter((s) => s.cls.includes('nv-rail-section'));
      assert.ok(boxed.length === 3, `${where}: three sections drawn`);
      for (const s of boxed) {
        assert.equal(s.bg, 'rgba(0, 0, 0, 0)', `${where}: a section has no fill`);
        assert.equal(s.shadow, 'none', `${where}: a section has no shadow`);
        assert.ok(s.radius === '0px' || s.radius.startsWith('0px '), `${where}: a section has no corners (${s.radius})`);
      }
      // A dividing line between sections: every section past the first carries the top line.
      for (const s of m.sections.slice(1)) assert.equal(s.topW, '1px', `${where}: ${s.cls} is divided from what is above`);
      assert.equal(m.sections[0].topW, '0px', `${where}: the first section starts clean`);
      for (const r of m.rows) assert.ok(r.left >= m.rail.left - 1 && r.right <= m.rail.right + 1, `${where}: every row stays in the rail`);
    }
    ws.close();
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
