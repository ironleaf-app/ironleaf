// node --test tests/vault-speed-budget.test.mjs — t102 vault budgets on a 2,000-note vault (9 Nov 2026).
// The vault is made up (the harness's Harbourline vault plus 2,000 generated notes across six areas, people,
// meetings, bills, links and two long notes); headless Chromium at 4x CPU throttle, through the
// vault-controls harness. Page switches are click-to-paint in-page (a MutationObserver already watching when
// the click lands, plus two frames); typing and search are key-to-paint per keystroke over 200 and 11 keys.
// Budgets from the brief: page switch under 150 ms p95, typing under 32 ms p95, search keystroke under
// 50 ms p95. First open, the More and New menus and scrolling print for the report without budgets.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const p50 = (arr) => q(arr, 0.5);
const p95 = (arr) => q(arr, 0.95);
const fmt = (arr) => `p50 ${p50(arr).toFixed(1)} p95 ${p95(arr).toFixed(1)} max ${Math.max(...arr, 0).toFixed(1)} (n=${arr.length})`;

/** 2,000 notes across six areas with tags, links and tasks, plus people, meetings, bills and two long notes. */
function seedPerfNotes(vaultDir) {
  const WORDS = ['harbour', 'invoice', 'crane', 'permit', 'roster', 'defects', 'handover', 'supplier', 'council', 'deposit', 'fitout', 'safety', 'quote', 'delivery', 'rental', 'welder'];
  const AREAS = ['Work', 'Me', 'Business', 'Publications', 'Home', 'Health'];
  for (let i = 0; i < 2000; i++) {
    const w = WORDS[i % WORDS.length];
    const folder = i < 1800 ? AREAS[i % AREAS.length] : i < 1900 ? 'Notes' : 'Notes/Archive';
    const dir = path.join(vaultDir, ...folder.split('/'));
    mkdirSync(dir, { recursive: true });
    const link = i % 25 === 0 ? '[[Harbourline Cart Fix]]' : `[[Perf note ${(i + 1) % 2000}]]`;
    const who = i % 30 === 0 ? ' with Alex Chen' : '';
    const body =
      `---\ntype: note\ntags: [perf${i % 40}]\n---\n# Perf note ${i}\n\nThe ${w} work continues${who} ${link}. See also [[Perf note ${(i + 500) % 2000}]] and #perf${i % 40}.\n\n` +
      `## Details ${i}\n\nRelated: [[Perf note ${(i + 1000) % 2000}]] and [[Perf note ${(i + 1500) % 2000}]].\n\n` +
      `- [ ] Follow up the ${w} item ${i}\n- [x] File the ${w} paperwork ${i}\n\n` +
      `Paragraph about ${w} and more words to fill the note with ordinary project talk. `.repeat(10) + '\n';
    writeFileSync(path.join(dir, `Perf note ${i}.md`), body);
  }
  mkdirSync(path.join(vaultDir, 'People'), { recursive: true });
  for (const [name, role] of [['Mia Hammond', 'engineer'], ['Jay Ortega', 'planner'], ['Sam Park', 'surveyor'], ['Lee Nair', 'clerk'], ['Noah Reid', 'builder'], ['Ava Singh', 'designer']]) {
    writeFileSync(path.join(vaultDir, 'People', `${name}.md`), `---\ntype: person\nrole: ${role}\n---\n# ${name}\n\nWorks on the [[Harbourline Cart Fix]].\n`);
  }
  mkdirSync(path.join(vaultDir, 'Meetings'), { recursive: true });
  for (const [n, day] of [['Cart review', '2026-11-05'], ['Roster talk', '2026-11-06'], ['Handover walk', '2026-11-07']]) {
    writeFileSync(
      path.join(vaultDir, 'Meetings', `${day} ${n}.md`),
      `---\ntype: meeting\ndate: ${day}\nattendees: [Alex Chen, Mia Hammond]\nproject: Projects/Harbourline Cart Fix/Harbourline Cart Fix.md\n---\n# ${day} ${n}\n\n## Actions\n\n- [ ] Follow up the ${n.toLowerCase()} — Alex Chen\n`,
    );
  }
  mkdirSync(path.join(vaultDir, 'Bills'), { recursive: true });
  for (const [n, amount] of [['Power', '184.20'], ['Water', '96.10'], ['Internet', '89.00'], ['Rates', '412.55'], ['Gas', '77.40'], ['Phone', '45.00']]) {
    writeFileSync(path.join(vaultDir, 'Bills', `${n}.md`), `---\ntype: bill\namount: '${amount}'\ncycle: Monthly\ncategory: Home and utilities\n---\n# ${n}\n\nThe ${n.toLowerCase()} bill, due soon.\n`);
  }
  // Two long notes of 5,000+ words, written last so they head the Notes list.
  const paras = (tag, about) => {
    const out = [];
    for (let i = 0; i < 170; i++) out.push(`Paragraph ${i} of the long perf note, with enough ordinary words to stand in for a real report. #${tag}\n\n## Heading ${i}\n\nMore words here about ${about} and the roster.`);
    return out.join('\n\n');
  };
  mkdirSync(path.join(vaultDir, 'Notes'), { recursive: true });
  writeFileSync(path.join(vaultDir, 'Notes', 'Long perf note.md'), `---\ntype: note\ntags: [longperform]\n---\n# Long perf note\n\n${paras('longperform', 'the harbour work')}\n`);
  mkdirSync(path.join(vaultDir, 'Work'), { recursive: true });
  writeFileSync(path.join(vaultDir, 'Work', 'Annual review.md'), `---\ntype: note\ntags: [annualreview]\n---\n# Annual review\n\n${paras('annualreview', 'the yearly review')}\n`);
}

test('t102: page, typing and search budgets hold on a 2,000-note vault', { timeout: 600000 }, async () => {
  const H = await import('./vault-controls-harness.mjs');
  const work = mkdtempSync(path.join(tmpdir(), 'nv-budget-'));
  const close = [];
  try {
    const vaultDir = path.join(work, 'vault');
    mkdirSync(vaultDir, { recursive: true });
    H.writeVault(vaultDir);
    seedPerfNotes(vaultDir);
    mkdirSync(path.join(work, 'data'), { recursive: true });
    const core = await H.loadCore(work);
    const tIndex0 = Date.now();
    const box = { current: await H.openServices(vaultDir, path.join(work, 'data'), core) };
    const indexMs = Date.now() - tIndex0;
    const distDir = await H.buildRenderer(work);
    const server = await H.startServer(distDir, () => box.current);
    close.push(() => server.close());
    const browser = await H.startBrowser(server.origin);
    close.push(() => browser.close());
    const ev = browser.ev;
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    assert.ok(await ev(`!!document.querySelector('.app')`), 'the app loads on the 2,000-note vault');
    const noteCount = await ev(`document.querySelector('.app') ? document.body.innerHTML.length : 0`);
    assert.ok(noteCount > 1000, 'the app draws content');
    await browser.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 1, mobile: false });

    // First open to a usable Today, throttled: a fresh load, then Today if it is not already there.
    const tFirst0 = Date.now();
    await browser.send('Page.navigate', { url: `${server.origin}/harness.html` });
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      try {
        if (await ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    assert.ok(await ev(`!!document.querySelector('.app')`), 'the app reloads throttled');
    const onToday = await ev(`!!document.querySelector('main .td-view, .main .td-view')`);
    if (!onToday) {
      const clicked = await ev(`(() => {
        const root = document.querySelector('.sidebar.left');
        const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
        const el = els.find((e) => (e.innerText || '').replace(/\\s+/g, ' ').includes('Today'));
        if (!el) return 'NOTFOUND';
        el.click();
        return 'CLICKED';
      })()`);
      assert.equal(clicked, 'CLICKED', 'the sidebar reaches Today on first open');
    }
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try {
        if (await ev(`!!document.querySelector('main .td-view, .main .td-view')`)) break;
      } catch {}
    }
    await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`);
    const firstOpenMs = Date.now() - tFirst0;

    // Event and long-task observers, drained often so none are dropped.
    await ev(`(() => {
      window.__bev = [];
      try {
        window.__bevObs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__bev.push({ n: e.name, d: e.duration, p: e.processingEnd - e.startTime });
        });
        window.__bevObs.observe({ type: 'event', buffered: true, durationThreshold: 0 });
      } catch {}
      window.__blt = [];
      try {
        window.__bltObs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__blt.push({ d: e.duration, s: e.startTime });
        });
        window.__bltObs.observe({ type: 'longtask', buffered: true });
      } catch {}
      return 1;
    })()`);
    const drainLong = () => ev(`window.__blt.splice(0)`);

    /** Click the sidebar's row in-page (one call: no races). */
    const sideClick = (words) => ev(`(async () => {
      const root = document.querySelector('.sidebar.left');
      if (!root) return 'NOROOT';
      const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
      const el = els.find((e) => ((e.innerText || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
      if (!el) return 'NOTFOUND ' + els.map((e) => (e.innerText || '').replace(/\\s+/g, ' ').slice(0, 24)).join(' | ');
      el.click();
      return 'CLICKED';
    })()`);

    /** One measured switch: the observer is already watching when the click lands (one call, no poll lag). */
    const switchMark = (clickJs, markerJs) => ev(`(async () => {
      const t0 = performance.now();
      const ms = await new Promise((resolve) => {
        let obs = null;
        const fin = (v) => { try { obs?.disconnect(); } catch {} resolve(v); };
        obs = new MutationObserver(() => {
          try {
            const m = document.querySelector('main');
            if (m && (${markerJs})) fin(performance.now() - t0);
          } catch {}
        });
        obs.observe(document.querySelector('main') ?? document.body, { childList: true, subtree: true, characterData: true });
        setTimeout(() => fin(-2), 15000);
        ${clickJs}
      });
      try { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))); } catch {}
      return ms;
    })()`);
    const sideMark = (words, markerJs) => switchMark(`
      (() => {
        const root = document.querySelector('.sidebar.left');
        const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
        els.find((e) => ((e.innerText || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)}))).click();
      })();`, markerJs);
    const mainMark = (findJs, markerJs) => switchMark(`(() => { ${findJs} })();`, markerJs);
    // Graph lives under More, so it opens on its keys (the window takes a synthetic Ctrl+G like the real one).
    const graphKeyJs = `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ctrlKey: true, bubbles: true, cancelable: true }));`;
    const graphMark = () => switchMark(graphKeyJs, M.Graph);

    const M = {
      Today: `!!m.querySelector('.td-view')`,
      Projects: `(m.querySelector('h1')?.innerText || '').includes('Projects')`,
      Project: `!!m.querySelector('.pj-page')`,
      People: `!!m.querySelector('.w2b-people')`,
      Person: `!!m.querySelector('.w2b-person')`,
      Notes: `m.querySelectorAll('.w2b-row').length > 2 && !m.querySelector('.w2b-people') && !m.querySelector('.w2b-person')`,
      Note: `!!m.querySelector('.cm-editor')`,
      Tasks: `m.querySelectorAll('.tkrow').length > 2 && !m.querySelector('.cm-editor') && !m.querySelector('.pj-page')`,
      Graph: `!!m.querySelector('.bg-canvas')`,
    };
    const clickMainWords = (words) => `(Array.from(document.querySelector('main').querySelectorAll('button, a[href], [role="button"]')).find((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && (((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')).replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})); }) ?? (() => { throw new Error('NOTFOUND ' + ${JSON.stringify(words)}); })()).click()`;
    // The Work folder: back to All first when it is already on (untimed), so every sample is a real switch.
    const folderMark = () => ev(`(async () => {
      const frow = (name) => [...document.querySelectorAll('.w2b-folders .frow')].find((e) => (e.innerText || '').replace(/\\s+/g, ' ').includes(name));
      const isOn = (name) => { const el = frow(name); return !!el?.classList.contains('on'); };
      if (isOn('Work') && !isOn('All notes') && document.querySelector('.w2b-folders .frow.on')?.innerText?.includes('Work')) {
        const all = [...document.querySelectorAll('.w2b-folders .frow')][0];
        if (all) { all.click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))); }
      }
      const t0 = performance.now();
      const ms = await new Promise((resolve) => {
        let obs = null;
        const fin = (v) => { try { obs?.disconnect(); } catch {} resolve(v); };
        obs = new MutationObserver(() => {
          try {
            const on = document.querySelector('.w2b-folders .frow.on');
            if (on && (on.innerText || '').includes('Work')) fin(performance.now() - t0);
          } catch {}
        });
        obs.observe(document.querySelector('main') ?? document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        setTimeout(() => fin(-2), 15000);
        frow('Work').click();
      });
      try { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))); } catch {}
      return ms;
    })()`);

    // Warm every page once, in an order whose consecutive pages share no marker.
    const warm = [
      ['Today', () => sideClick('Today'), M.Today],
      ['Projects', () => sideClick('Projects'), M.Projects],
      ['Project', () => ev(`(() => { ${clickMainWords('Harbourline Cart Fix')}; return 'CLICKED'; })()`), M.Project],
      ['People', () => sideClick('People'), M.People],
      ['Person', () => ev(`(() => { ${clickMainWords('Alex Chen')}; return 'CLICKED'; })()`), M.Person],
      ['Notes', () => sideClick('Notes'), M.Notes],
      ['Folder', () => ev(`(() => { [...document.querySelectorAll('.w2b-folders .frow')].find((e) => (e.innerText || '').includes('Work'))?.click(); return 'CLICKED'; })()`), null],
      ['Note', () => ev(`(() => { document.querySelector('main .w2b-row')?.click(); return 'CLICKED'; })()`), M.Note],
      ['Tasks', () => sideClick('Tasks'), M.Tasks],
      ['Graph', () => ev(`(() => { ${graphKeyJs} return 'CLICKED'; })()`), M.Graph],
    ];
    for (const [name, go, marker] of warm) {
      const r = await go();
      assert.ok(String(r).startsWith('CLICKED') || r === 'CLICKED', `the harness reaches ${name} to warm it (stood ${r})`);
      if (marker) {
        let ok = false;
        for (let i = 0; i < 40; i++) {
          await sleep(400);
           
          try {
            const hit = await ev(`(() => { const m = document.querySelector('main'); return !!(m && (${marker})); })()`);
            if (hit) { ok = true; break; }
          } catch {}
        }
        assert.ok(ok, `${name} shows while warming`);
      } else {
        await sleep(1200);
      }
      await sleep(400);
    }
    await drainLong();

    // Page switches, warm: three rounds over every destination.
    const pages = {};
    const steps = [
      ['Today', () => sideMark('Today', M.Today)],
      ['Projects', () => sideMark('Projects', M.Projects)],
      ['Project', () => mainMark(clickMainWords('Harbourline Cart Fix'), M.Project)],
      ['People', () => sideMark('People', M.People)],
      ['Person', () => mainMark(clickMainWords('Alex Chen'), M.Person)],
      ['Notes', () => sideMark('Notes', M.Notes)],
      ['Folder', () => folderMark()],
      ['Note', () => mainMark(`(document.querySelector('main .w2b-row') ?? (() => { throw new Error('NOTFOUND note row'); })()).click()`, M.Note)],
      ['Tasks', () => sideMark('Tasks', M.Tasks)],
      ['Graph', () => graphMark()],
    ];
    for (let round = 0; round < 3; round++) {
      for (const [name, run] of steps) {
        const ms = await run();
        assert.ok(ms >= 0, `${name} switch lands (stood ${ms})`);
        (pages[name] ??= []).push(ms);
        await drainLong();
        await sleep(250);
      }
    }
    const pageAll = Object.values(pages).flat();
    // Typing in the long note: 200 keys, key to next paint each.
    assert.equal(await sideClick('Notes'), 'CLICKED', 'the sidebar returns to Notes for typing');
    await sleep(1000);
    await ev(`(() => { const frows = [...document.querySelectorAll('.w2b-folders .frow')]; (frows[0] ?? frows.find((e) => (e.innerText || '').includes('All')))?.click(); return 1; })()`);
    await sleep(800);
    const longClicked = await ev(`(() => {
      const row = [...document.querySelectorAll('main .w2b-row')].find((e) => (e.innerText || '').includes('Long perf note'));
      if (!row) return 'NOTFOUND';
      row.click();
      return 'CLICKED';
    })()`);
    assert.equal(longClicked, 'CLICKED', 'the long note opens for typing');
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      try {
        if (await ev(`!!document.querySelector('.cm-editor')`)) break;
      } catch {}
    }
    assert.ok(await ev(`!!document.querySelector('.cm-editor')`), 'the editor shows the long note');
    await sleep(1000);
    await drainLong();
    const typeMs = await ev(`(async () => {
      const el = document.querySelector('.cm-content');
      el.focus();
      const times = [];
      for (let i = 0; i < 200; i++) {
        const t0 = performance.now();
        document.execCommand('insertText', false, 'x');
        await new Promise((r) => requestAnimationFrame(r));
        times.push(performance.now() - t0);
      }
      return times;
    })()`);
    assert.equal(typeMs.length, 200, 'all 200 keystrokes land');
    const typeLong = await drainLong();

    // Ctrl+K search as you type: one key at a time, key to next paint each.
    const kd = (key, code, vcode) => browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vcode, modifiers: 2 });
    const ku = (key, code, vcode) => browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vcode, modifiers: 2 });
    await kd('k', 'KeyK', 75);
    await ku('k', 'KeyK', 75);
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      try {
        if (await ev(`!!document.querySelector('.picker')`)) break;
      } catch {}
    }
    assert.ok(await ev(`!!document.querySelector('.picker')`), 'Ctrl+K opens the palette');
    await sleep(600);
    await ev(`(() => { const i = document.querySelector('.picker-input input'); i.focus(); i.select(); return 1; })()`);
    await drainLong();
    const searchMs = await ev(`(async () => {
      const times = [];
      for (const ch of 'perf note 1') {
        const t0 = performance.now();
        document.execCommand('insertText', false, ch);
        await new Promise((r) => requestAnimationFrame(r));
        times.push(performance.now() - t0);
      }
      return times;
    })()`);
    assert.equal(searchMs.length, 11, 'all search keys land');
    const searchLong = await drainLong();
    const searchRows = await ev(`document.querySelectorAll('.picker-list .picker-row').length`);
    assert.ok(searchRows > 0, 'the search lists rows');
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(600);
    // More and the New menu: click to open each.
    const moreMs = await ev(`(async () => {
      const btn = [...document.querySelectorAll('.sidebar.left button')].find((e) => e.getAttribute('aria-haspopup') === 'menu' && e.getBoundingClientRect().width > 2)
        ?? [...document.querySelectorAll('button')].find((e) => (e.getAttribute('aria-label') || '').startsWith('More for') && e.getBoundingClientRect().width > 2);
      if (!btn) return -1;
      const t0 = performance.now();
      btn.click();
      for (let i = 0; i < 60; i++) {
        const menu = [...document.querySelectorAll('.menu, [role="menu"]')].find((e) => e.getBoundingClientRect().width > 2);
        if (menu) break;
        await new Promise((r) => setTimeout(r, 16));
      }
      await new Promise((r) => requestAnimationFrame(() => r(1)));
      return performance.now() - t0;
    })()`);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(500);
    const newMs = await ev(`(async () => {
      const btn = document.querySelector('[aria-label="New"]');
      if (!btn) return -1;
      const t0 = performance.now();
      btn.click();
      for (let i = 0; i < 60; i++) {
        const menu = [...document.querySelectorAll('.menu, [role="menu"]')].find((e) => e.getBoundingClientRect().width > 2);
        if (menu) break;
        await new Promise((r) => setTimeout(r, 16));
      }
      await new Promise((r) => requestAnimationFrame(() => r(1)));
      return performance.now() - t0;
    })()`);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(500);

    // Scrolling the Notes list and the long note: frame gaps over 30 steps each.
    assert.equal(await sideClick('Notes'), 'CLICKED', 'the sidebar returns to Notes for scrolling');
    await sleep(1000);
    const notesScroll = await ev(`(async () => {
      const sc = document.querySelector('main .nv-page-scroll') ?? document.querySelector('main [class*="scroll"]') ?? document.querySelector('main');
      const gaps = [];
      let last = performance.now();
      for (let i = 0; i < 30; i++) {
        sc.scrollTop = (i % 2 === 0 ? 1 : 0.2) * sc.scrollHeight * (i / 30) + (i % 2 === 0 ? 300 : 0);
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        gaps.push(now - last);
        last = now;
      }
      return gaps;
    })()`);
    const notesScrollLong = await drainLong();
    const longAgain = await ev(`(() => {
      const frows = [...document.querySelectorAll('.w2b-folders .frow')];
      (frows[0])?.click();
      return 1;
    })()`);
    assert.equal(longAgain, 1, 'the folder resets to All');
    await sleep(800);
    await ev(`(() => { [...document.querySelectorAll('main .w2b-row')].find((e) => (e.innerText || '').includes('Long perf note'))?.click(); return 1; })()`);
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      try {
        if (await ev(`!!document.querySelector('.cm-editor')`)) break;
      } catch {}
    }
    const noteScroll = await ev(`(async () => {
      const sc = document.querySelector('.cm-scroller') ?? document.querySelector('main');
      const gaps = [];
      let last = performance.now();
      for (let i = 0; i < 30; i++) {
        sc.scrollTop = sc.scrollHeight * (i / 30);
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        gaps.push(now - last);
        last = now;
      }
      return gaps;
    })()`);
    const noteScrollLong = await drainLong();

    // The table for the report.
    console.log('      t102 budgets (2,000 notes, 4x throttle):');
    console.log(`      index 2,000 notes (node): ${indexMs} ms; first open to usable Today: ${firstOpenMs} ms`);
    for (const [name, arr] of Object.entries(pages)) console.log(`      switch ${name}: ${fmt(arr)} ms`);
    console.log(`      switch all: ${fmt(pageAll)} ms`);
    console.log(`      typing 200 keys: ${fmt(typeMs)} ms; longtasks: ${typeLong.length} over 50 ms${typeLong.length ? ` (max ${Math.max(...typeLong.map((t) => t.d)).toFixed(1)} ms)` : ''}`);
    console.log(`      search 11 keys: ${fmt(searchMs)} ms; longtasks: ${searchLong.length} over 50 ms${searchLong.length ? ` (max ${Math.max(...searchLong.map((t) => t.d)).toFixed(1)} ms)` : ''}`);
    console.log(`      More open: ${moreMs.toFixed(1)} ms; New menu: ${newMs.toFixed(1)} ms`);
    console.log(`      Notes scroll frames: ${fmt(notesScroll)} ms; longtasks: ${notesScrollLong.length}${notesScrollLong.length ? ` (max ${Math.max(...notesScrollLong.map((t) => t.d)).toFixed(1)} ms)` : ''}`);
    console.log(`      long-note scroll frames: ${fmt(noteScroll)} ms; longtasks: ${noteScrollLong.length}${noteScrollLong.length ? ` (max ${Math.max(...noteScrollLong.map((t) => t.d)).toFixed(1)} ms)` : ''}`);

    // The budgets.
    assert.ok(p95(pageAll) < 150, `page switches stay under 150 ms p95 (stood ${p95(pageAll).toFixed(1)} ms: ${Object.entries(pages).map(([n, a]) => `${n} max ${Math.max(...a).toFixed(0)}`).join(', ')})`);
    assert.ok(p95(typeMs) < 32, `typing stays under 32 ms p95 (stood ${p95(typeMs).toFixed(1)} ms, max ${Math.max(...typeMs).toFixed(1)} ms)`);
    assert.ok(p95(searchMs) < 50, `search keystrokes stay under 50 ms p95 (stood ${p95(searchMs).toFixed(1)} ms, max ${Math.max(...searchMs).toFixed(1)} ms)`);
  } finally {
    for (const fn of close.reverse()) {
      try {
        await fn();
      } catch {}
    }
    rmSync(work, { recursive: true, force: true });
  }
});

test('t163: opening a 2,000-note folder draws its window as quick as the Notes page', { timeout: 600000 }, async () => {
  // t155's report: the tree rendered every open row with no cap, so opening a 2,000-note folder drew
  // 2,000 rows. The tree windows its list as the Notes page does (eighty rows, Show more); opening the
  // big folder holds the page-switch budget without raising it, and the side bar's places never scroll.
  const H = await import('./vault-controls-harness.mjs');
  const SHOTS = process.env.NV_T163_SHOTS || '';
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), 'nv-tree-budget-'));
  const close = [];
  try {
    const vaultDir = path.join(work, 'vault');
    mkdirSync(vaultDir, { recursive: true });
    H.writeVault(vaultDir);
    mkdirSync(path.join(vaultDir, 'Big'), { recursive: true });
    for (let i = 0; i < 2000; i++) {
      writeFileSync(path.join(vaultDir, 'Big', `Big note ${i}.md`), `---\ntype: note\n---\n# Big note ${i}\n\nWords about the harbour work ${i}.\n`);
    }
    mkdirSync(path.join(work, 'data'), { recursive: true });
    const core = await H.loadCore(work);
    const box = { current: await H.openServices(vaultDir, path.join(work, 'data'), core) };
    const distDir = await H.buildRenderer(work);
    const server = await H.startServer(distDir, () => box.current);
    close.push(() => server.close());
    const browser = await H.startBrowser(server.origin);
    close.push(() => browser.close());
    const ev = browser.ev;
    const send = (m, p) => browser.send(m, p);
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    assert.ok(await ev(`!!document.querySelector('.app')`), 'the app loads on the vault with the big folder');
    await browser.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 1, mobile: false });
    await ev(`(() => {
      window.__tlt = [];
      try {
        window.__tltObs = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__tlt.push({ d: e.duration, s: e.startTime });
        });
        window.__tltObs.observe({ type: 'longtask', buffered: true });
      } catch {}
      return 1;
    })()`);
    const drainTreeLong = () => ev(`window.__tlt.splice(0)`);
    const waitFor = async (expr, ms = 12000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        try {
          if (await ev(expr)) return true;
        } catch {}
        await sleep(200);
      }
      return false;
    };
    // The file list opens from the palette, as a person opens it, then Folders mode.
    const key = (keyName, code, modifiers = 0) =>
      send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyName.length === 1 ? keyName.toUpperCase().charCodeAt(0) : 13, modifiers }).then(() =>
        send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers }),
      );
    await key('k', 'KeyK', 2);
    assert.ok(await waitFor(`!!document.querySelector('.picker input, .palette input, .modal input')`), 'the palette opens');
    await send('Input.insertText', { text: 'Show your files' });
    await sleep(1500);
    await key('Enter', 'Enter', 0);
    assert.ok(await waitFor(`!!document.querySelector('.sidebar.left .panel.explorer, .sidebar.left .nav-mode')`), 'the file list shows in the side bar');
    await ev(`[...document.querySelectorAll('.nav-mode-option')].find((b) => b.textContent.includes('Folders'))?.click()`);
    assert.ok(await waitFor(`[...document.querySelectorAll('.nav-mode-option')].some((b) => b.textContent.includes('Folders') && b.className.includes(' on'))`), 'Folders mode switches on');
    // One measured open: the observer is already watching when the click lands (one call, no poll lag).
    const unfoldMark = () =>
      ev(`(async () => {
        const t0 = performance.now();
        const ms = await new Promise((resolve) => {
          let obs = null;
          const fin = (v) => { try { obs?.disconnect(); } catch {} resolve(v); };
          obs = new MutationObserver(() => {
            try {
              if (document.querySelector('.panel-body.tree .tree-row[data-path^="Big/"]')) fin(performance.now() - t0);
            } catch {}
          });
          obs.observe(document.querySelector('.panel-body.tree') ?? document.body, { childList: true, subtree: true });
          setTimeout(() => fin(-2), 15000);
          [...document.querySelectorAll('.panel-body.tree .tree-row.tree-folder')].find((e) => (e.textContent || '').includes('Big')).click();
        });
        try { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))); } catch {}
        return ms;
      })()`);
    const fold = async () => {
      await ev(`[...document.querySelectorAll('.panel-body.tree .tree-row.tree-folder')].find((e) => (e.textContent || '').includes('Big'))?.click()`);
      assert.ok(await waitFor(`document.querySelectorAll('.panel-body.tree .tree-row[data-path^="Big/"]').length === 0`), 'the big folder folds again');
    };
    const unfolds = [];
    await drainTreeLong();
    for (let round = 0; round < 5; round++) {
      const ms = await unfoldMark();
      assert.ok(ms >= 0, `open ${round + 1} lands (stood ${ms})`);
      unfolds.push(ms);
      if (round < 4) await fold();
    }
    const openLong = await drainTreeLong();
    const rows = await ev(`document.querySelectorAll('.panel-body.tree .tree-row').length`);
    const more = await ev(`document.querySelector('.panel-body.tree .tree-showmore')?.textContent ?? ''`);
    console.log(`      t163 tree open x5 (2,000-note folder, 4x throttle): ${fmt(unfolds)} ms; rows drawn: ${rows}; ${more.trim()}`);
    console.log(`      t163 tree longtasks over the 5 opens: ${openLong.length} over 50 ms${openLong.length ? ` (max ${Math.max(...openLong.map((t) => t.d)).toFixed(1)} ms)` : ''}`);
    // The mechanism: the window draws, not the 2,000 rows.
    assert.ok(rows >= 80 && rows < 150, `opening draws the window, not every row (drew ${rows})`);
    assert.match(more, /Show more \(\d+ left\)/, 'Show more says how many are left');
    // The tree scrolls inside its own part only: the side bar's places never scroll, the foot stays pinned.
    const containment = await ev(`(() => {
      const side = document.querySelector('.sidebar.left');
      const body = document.querySelector('.panel-body.tree');
      const foot = document.querySelector('.sidebar.left .places-foot');
      return side && body ? [side.scrollHeight <= side.clientHeight + 1, body.scrollHeight > body.clientHeight, !foot || foot.getBoundingClientRect().bottom <= window.innerHeight + 1] : null;
    })()`);
    assert.deepEqual(containment, [true, true, true], 'the side bar never scrolls, the tree scrolls in its part, the foot stays pinned');
    // The budget: the page-switch budget, not raised.
    assert.ok(p95(unfolds) < 150, `opening the big folder stays under 150 ms p95 (stood ${p95(unfolds).toFixed(1)} ms)`);
    // The window behaves: Show more draws the next eighty, the arrow keys walk the full order drawing
    // up to the key row, and folding then opening starts the window over.
    await ev(`document.querySelector('.panel-body.tree .tree-showmore')?.click()`);
    assert.ok(await waitFor(`document.querySelectorAll('.panel-body.tree .tree-row').length > 150`), 'Show more draws the next eighty');
    await ev(`document.querySelector('.panel-body.tree')?.focus()`);
    for (let k = 0; k < 170; k++) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    }
    await sleep(800);
    const keyed = await ev(`(() => ({ rows: document.querySelectorAll('.panel-body.tree .tree-row').length, focused: document.querySelector('.panel-body.tree .tree-row.focused .tree-name')?.textContent ?? '', selected: document.querySelectorAll('.panel-body.tree .tree-row.selected').length }))()`);
    assert.ok(keyed.rows > 165, `arrowing past the window draws up to the key row (${keyed.rows} rows)`);
    assert.ok(keyed.focused.length > 0, `the key row keeps focus (${keyed.focused.slice(0, 40)})`);
    assert.equal(keyed.selected, 1, 'the key row stays the selected row');
    await fold();
    const foldedRows = await ev(`document.querySelectorAll('.panel-body.tree .tree-row').length`);
    assert.ok(foldedRows < 20, `folding leaves the top folders (${foldedRows} rows)`);
    await ev(`[...document.querySelectorAll('.panel-body.tree .tree-row.tree-folder')].find((e) => (e.textContent || '').includes('Big'))?.click()`);
    assert.ok(await waitFor(`document.querySelectorAll('.panel-body.tree .tree-row[data-path^="Big/"]').length > 0`), 'the big folder opens again');
    const reopened = await ev(`document.querySelectorAll('.panel-body.tree .tree-row').length`);
    assert.ok(reopened >= 80 && reopened < 150, `opening starts the window over (drew ${reopened})`);
    if (SHOTS) {
      await ev(`(() => { const b = document.querySelector('.panel-body.tree'); if (b) b.scrollTop = b.scrollHeight; return 1; })()`);
      await sleep(600);
      for (const [w, h] of [[1219, 709], [1600, 1000], [1920, 1117], [3456, 1408]]) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
        await sleep(900);
        const d = await browser.send('Page.captureScreenshot', { format: 'png' });
        if (d.result?.data) writeFileSync(path.join(SHOTS, `t163-tree-big-${w}x${h}.png`), Buffer.from(d.result.data, 'base64'));
      }
    }
  } finally {
    for (const fn of close.reverse()) {
      try {
        await fn();
      } catch {}
    }
    rmSync(work, { recursive: true, force: true });
  }
});
