// node --test tests/n3-timelines-clips.test.mjs — the Vault's other timeline, and clipped words at a smaller
// window (n3, 6 Nov 2026). The Projects home gantt clips every date pill ("Tue…", "1…"), project names clip to
// a few letters, clash dots sit on pills, and its month scale piles up; the project hero's status pill reads
// "On trac" and the section line ends in "Ris" at 1219; "Read more" shows where the lead fits whole; the same
// ellipsis fault sits on dates, statuses and owners elsewhere. Each check fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = mkdtempSync(path.join(tmpdir(), 'nv-n3-'));
let P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/projects-87.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'n3.mjs'), format: 'esm' }, logLevel: 'silent' });
  P = await import(pathToFileURL(path.join(work, 'n3.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Days are timeline days (src/shared/timeline.ts dayFrom): days since 1 Jan 1970 on the calendar.
const dayFrom = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 86400000);

describe('pure: a gantt scale that fills the width and cannot pile up', () => {
  test('month segments are proportional to their days and cover the track', () => {
    const from = dayFrom(2026, 9, 10), to = dayFrom(2026, 12, 5);
    const segs = P.ganttSegments(from, to);
    assert.equal(segs.length, 4, 'Sep, Oct, Nov, Dec');
    assert.deepEqual(segs.map((s) => s.label), ['Sep', 'Oct', 'Nov', 'Dec']);
    // October (31 days) is wider than September's part month; the parts join up edge to edge.
    assert.ok(segs[1].width > segs[0].width, `Oct ${segs[1].width} wider than part-Sep ${segs[0].width}`);
    assert.ok(Math.abs(segs[0].left) < 0.01, 'starts at 0');
    const end = segs[segs.length - 1];
    assert.ok(Math.abs(end.left + end.width - 100) < 0.01, 'ends at 100');
    for (let i = 1; i < segs.length; i++) assert.ok(Math.abs(segs[i].left - (segs[i - 1].left + segs[i - 1].width)) < 0.01, 'no gaps, no overlaps');
  });
  test('a week in one month is one segment; 18 months name every head with its year', () => {
    const week = P.ganttSegments(dayFrom(2026, 11, 2), dayFrom(2026, 11, 8));
    assert.equal(week.length, 1);
    assert.equal(week[0].label, 'Nov');
    const long = P.ganttSegments(dayFrom(2026, 6, 1), dayFrom(2027, 12, 1));
    assert.ok(long.length >= 18 && long.length <= 19, `${long.length} segments`);
    assert.ok(long.every((s) => / [0-9]{2}$/.test(s.label)), `no two heads read the same (${long.map((s) => s.label).join(',')})`);
    assert.ok(long.some((s) => s.label === 'Jan 27'), 'January 2027 reads Jan 27');
    assert.ok(long.every((s, i) => i === 0 || Math.abs(s.left - (long[i - 1].left + long[i - 1].width)) < 0.01), 'still edge to edge');
  });
  test('packed months thin to what fits, kept labels never touch', () => {
    const even = (n) => new Array(n).fill(100 / n);
    assert.deepEqual(P.thinGanttMonths(even(8), 1200), [true, true, true, true, true, true, true, true], 'room: every month reads');
    const thin = P.thinGanttMonths(even(8), 300);
    assert.ok(thin[0], 'the first month always reads');
    assert.ok(thin.filter(Boolean).length >= 2 && thin.filter(Boolean).length <= 4, `${thin.filter(Boolean).length} of 8 at 300px`);
    // Kept labels stand at least minPx apart on the track (the mechanism, not one width).
    for (const [n, px] of [[3, 200], [10, 500], [19, 900], [19, 300], [8, 1219]]) {
      const k = P.thinGanttMonths(even(n), px);
      const idx = k.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
      assert.ok(idx.length > 0, 'never bare');
      const step = px / n;
      for (let i = 1; i < idx.length; i++) assert.ok((idx[i] - idx[i - 1]) * step >= 64 - 0.01, `months ${idx[i - 1]} and ${idx[i]} clear each other at ${px}px over ${n}`);
    }
    // A sliver part-month first: its neighbour still clears it.
    const k = P.thinGanttMonths([1, 33, 33, 33], 300);
    assert.deepEqual(k, [true, false, true, true], 'the sliver reads, the touching neighbour yields, the rest fit');
  });
});

describe('pure: a bar label that cannot clip', () => {
  test('inside when it fits, beside the bar when it will not, on the roomy side', () => {
    assert.equal(P.ganttLabelSide(10, 40, 800, 'Fri 20 Nov'), 'in', 'a wide bar carries its words');
    assert.equal(P.ganttLabelSide(10, 3, 800, 'Fri 20 Nov · in 14 days'), 'right', 'a sliver early in the track reads to its right');
    assert.equal(P.ganttLabelSide(90, 3, 800, 'Fri 20 Nov · in 14 days'), 'left', 'a sliver at the end reads to its left');
    assert.equal(P.ganttLabelSide(10, 3, 320, 'Fri 20 Nov · in 14 days'), 'right', 'a narrow track still reads right');
    assert.equal(P.ganttLabelSide(60, 3, 320, 'Fri 20 Nov · in 14 days'), 'left', 'no room right: reads left');
  });
});

describe('static: the gantt, hero, section line and Read more are wired to the fix', () => {
  test('TimelinePane draws the proportional scale, measured labels and clickable names', () => {
    const view = read('src/renderer/src/views/ProjectsHome.tsx');
    assert.ok(view.includes('ganttSegments('), 'the scale is proportional to days, not one flex share each');
    assert.ok(view.includes('thinGanttMonths('), 'packed months thin');
    assert.ok(view.includes('ganttLabelSide('), 'labels sit inside or beside the bar by measured room');
    assert.ok(!view.includes('ganttMonths(from, to)'), 'the equal-share scale is gone from the pane');
  });
  test('scoped gantt rules: names wrap, bars let labels out, clash dots sit below', () => {
    const css = read('src/renderer/src/styles/w2a.css');
    assert.ok(/\.gantt \.grow \.nm[^{]*\{[^}]*white-space:\s*normal/s.test(css), 'names wrap instead of clipping to letters');
    assert.ok(css.includes('.gbar-label.is-out'), 'a label that will not fit reads beside the bar');
    assert.ok(/\.gtrack \.w2a-clash[^{]*\{[^}]*top:\s*24px/s.test(css), 'clash dots sit below the bar, never on a pill');
  });
  test('hero pill stays whole and the tab bar never clips a name', () => {
    const css = read('src/renderer/src/styles/w2a.css');
    assert.ok(/\.w2a-phead[^{]*\{[^}]*flex-wrap:\s*wrap/s.test(css), 'the hero head wraps: the pill drops down, never clips');
    // t267: the section line is the shared tab bar now (the dead folionav rules went with the foot) — its
    // tabs never wrap or cut, and the fade signals more instead of dots.
    const bar = read('src/renderer/src/styles/page-tabs.css');
    assert.ok(/\.pt-tab\s*\{[^}]*white-space:\s*nowrap/s.test(bar), 'every tab reads whole: no wrap, no cut');
    assert.ok(bar.includes('.pt-bar[data-fade="right"]'), 'the fade signals more where the bar scrolls');
  });
  test('Read more is measured, never guessed by length', () => {
    const view = read('src/renderer/src/views/ProjectPage.tsx');
    assert.ok(!view.includes('lead.length > 220'), 'the 220-character guess is gone');
    assert.ok(view.includes('scrollHeight') && view.includes('clientHeight'), 'the lead is measured against its clamp');
  });
  test('dates, statuses and owners keep whole where the same fault sat', () => {
    const css = read('src/renderer/src/styles/w2a.css');
    assert.ok(/\.tl-name-sub[^{]*\{[^}]*white-space:\s*normal/s.test(css), 'the Timeline standing line wraps, never "At ris…"');
    assert.ok(/\.pt-status[^{]*\{[^}]*max-width:\s*none/s.test(css), 'plan statuses keep whole');
    assert.ok(/\.pt-label-who[^{]*\{[^}]*max-width:\s*none/s.test(css), 'plan owners keep whole');
  });
});

describe('live: nothing a person reads is clipped', () => {
  test('gantt, hero and section line whole at 1219, 1920 and 3456', { timeout: 420000 }, async () => {
    const H = await import('./vault-controls-harness.mjs');
    const cases = path.join(tmpdir(), 'nv-n3-live-');
    const work = mkdtempSync(cases);
    const close = [];
    try {
      const vaultDir = path.join(work, 'vault');
      mkdirSync(vaultDir, { recursive: true });
      H.writeVault(vaultDir);
      // Heavy invented data: 40 projects with long names, 10 packed in one week, 30 spread
      // over 18 months, two sharing a day and a person (a clash), one with a long summary.
      const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const names = ['Brunswick Site Lease Renewal Negotiation With The Waterfront Group', 'Catering Contract For The Docklands Office Weekly Morning Tea Service', 'Fitzroy Cafe Fit-Out With Joinery And Custom Banquette Seating', 'Roastery Espresso Machine Replacement And Barista Retraining Programme', 'Supplier Tender For Milk Bread And Pantry Staples Across All Stores', 'Website And Online Ordering Rebuild With Loyalty Points Migration', 'Winter Menu Launch With Supplier Tastings And Photography Shoot', 'Point Of Sale Changeover Across Every Till And Kiosk Statewide', 'Staff Rostering System Rollout With Leave Balances Imported', 'Highpoint Kiosk Lease Extension And Weekend Trading Hours Trial'];
      for (let i = 0; i < 40; i++) {
        const name = i < names.length ? names[i] : `Harbour Precinct Project Number ${i} With A Long Descriptive Name`;
        const packed = i < 10;
        const start = packed ? new Date(Date.UTC(2026, 10, 2 + (i % 5))) : new Date(Date.UTC(2026, 5 + (i % 18), 3 + ((i * 7) % 24)));
        const due = new Date(start.getTime() + (packed ? 3 : 20 + (i % 60)) * 86400000);
        const clash = i < 2 ? '\n- 2026-11-06: Shared tasting day (milestone)\n' : '';
        // Project 1's lead is one 235-character line: past the old 220 guess, yet whole in two lines at 3456.
        const longLead = 'This lead runs past two hundred and twenty characters in a single line, yet at the widest window it still fits whole inside two lines, so the opener must stay away. Extra words to cross the line for good, and a few more to be sure.';
        if (longLead.length <= 220 || longLead.includes('\n')) throw new Error('the discriminating lead must be one line past 220 characters');
        const summary = i === 0 ? 'First paragraph of a long summary that runs well past two lines at every width, so Read more must show.\n\nSecond paragraph with the history of the lease and the waterfront group.\n\nThird paragraph with the dates that matter.' : i === 1 ? longLead : `Short summary for project ${i}: one line.`;
        const dir = path.join(vaultDir, 'Projects', `N3 ${i} ${name.slice(0, 40)}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `N3 ${i}.md`), `---\ntype: project\nstatus: ${i % 7 === 0 ? 'on hold' : 'active'}\nhealth: ${i % 3 === 0 ? 'at risk' : 'on track'}\nowner: ${i % 2 ? 'Alexandra Featherstone' : 'Samuel Okafor'}\nstarted: ${iso(start)}\ndue: ${iso(due)}\n---\n# ${name}\n\n## Summary\n\n${summary}\n\n## Key dates\n${clash}- ${iso(due)}: Handover (milestone)\n\n## People\n\n- Alexandra Featherstone\n- Samuel Okafor\n`);
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
      for (let i = 0; i < 90; i++) {
        await sleep(500);
        try {
          if (await ev(`!!document.querySelector('.app')`)) break;
        } catch {}
      }
      await sleep(2200);
      const clickWords = (words, scope = '') =>
        ev(`(async () => {
          const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
          const sc = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
          const els = [...sc.querySelectorAll('button, a[href], [role="button"], [role="tab"], summary')].filter(vis);
          const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
          if (!el) return 'NOTFOUND';
          el.scrollIntoView({ block: 'nearest' });
          el.click();
          await new Promise((r) => setTimeout(r, 500));
          return 'CLICKED';
        })()`);
      const shot = async (file) => {
        if (!process.env.N3_SHOTS) return;
        const d = await browser.send('Page.captureScreenshot', { format: 'png' });
        if (d.result?.data) writeFileSync(path.join(process.env.N3_SHOTS, file), Buffer.from(d.result.data, 'base64'));
      };
      // Projects, then its Timeline pane.
      assert.equal(await clickWords('Projects'), 'CLICKED', 'Projects opens');
      await sleep(1200);
      assert.equal(await clickWords('Timeline', '.vpage'), 'CLICKED', 'the gantt opens');
      await sleep(1200);
      const ganttClipped = () => ev(`(() => {
        const out = [];
        const rows = [...document.querySelectorAll('.gantt .grow')];
        for (const r of rows) {
          const nm = r.querySelector('.nm');
          if (nm && nm.scrollWidth > nm.clientWidth + 1) out.push('name clips: ' + nm.textContent.slice(0, 40));
          if (nm && nm.scrollHeight > nm.clientHeight + 1) out.push('name hides a line: ' + nm.textContent.slice(0, 40));
          const lab = r.querySelector('.gbar-label');
          if (lab && lab.scrollWidth > lab.clientWidth + 1) out.push('bar label clips: ' + lab.textContent.slice(0, 40));
        }
        const months = [...document.querySelectorAll('.gmonths .gm-seg span')].filter((s) => s.textContent.trim() && s.getBoundingClientRect().width > 2);
        for (let i = 1; i < months.length; i++) {
          const a = months[i - 1].getBoundingClientRect(), b = months[i].getBoundingClientRect();
          if (a.right > b.left + 1) out.push('month labels overlap: ' + months[i - 1].textContent + ' / ' + months[i].textContent);
        }
        const labels = [...document.querySelectorAll('.gbar-label')].map((l) => l.getBoundingClientRect());
        for (const c of document.querySelectorAll('.w2a-clash')) {
          const r = c.getBoundingClientRect();
          if (labels.some((l) => r.left < l.right && r.right > l.left && r.top < l.bottom && r.bottom > l.top)) out.push('a clash dot sits on a bar label');
        }
        return { rows: rows.length, out: out.slice(0, 8) };
      })()`);
      for (const [w, h, dsf, tag] of [[1219, 709, 2, '1219x709'], [1920, 1117, 2, '1920x1117'], [3456, 1408, 1, '3456x1408']]) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: false });
        await sleep(900);
        const g = await ganttClipped();
        assert.ok(g.rows >= 40, `${g.rows} gantt rows at ${tag}`);
        assert.deepEqual(g.out, [], `nothing clipped or piled on the gantt at ${tag}: ${g.out.join('; ')}`);
        await shot(`n3-gantt-after-${tag}.png`);
      }
      // Rows stay clickable: a bar opens its project.
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
      await sleep(700);
      const opened = await ev(`(async () => {
        const bar = document.querySelector('.gantt .grow .gbar');
        if (!bar) return 'NOBAR';
        bar.click();
        await new Promise((r) => setTimeout(r, 900));
        return document.querySelector('.pj-folio h1')?.textContent?.slice(0, 40) ?? 'NOOPEN';
      })()`);
      assert.ok(opened && opened !== 'NOBAR' && opened !== 'NOOPEN', `a gantt row opens its project (${opened})`);
      // Hero and tab bar at 1219 and 1000: the pill whole, every tab name whole (t255 made the
      // section line real tabs, t265: the bar scrolls sideways with a fade at the end that hides more,
      // and each tab scrolls whole into view — never cut with dots).
      const heroAt = () => ev(`(() => {
        const pill = document.querySelector('.nv-hero .pill');
        const bar = document.querySelector('.pj-page [role="tablist"]');
        const btns = bar ? [...bar.querySelectorAll('[role="tab"]')] : [];
        return {
          pill: pill ? pill.textContent : null,
          pillClips: pill ? pill.scrollWidth > pill.clientWidth + 1 : null,
          pillCut: pill ? (() => { const r = pill.getBoundingClientRect(), h = document.querySelector('.nv-hero').getBoundingClientRect(); return r.right > h.right + 1; })() : null,
          tabs: btns.length,
          over: bar ? bar.scrollWidth - bar.clientWidth : null,
          fade: bar ? bar.getAttribute('data-fade') : null,
          uncut: btns.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.slice(0, 20)),
        };
      })()`);
      const reachWhole = () => ev(`(async () => {
        const bar = document.querySelector('.pj-page [role="tablist"]');
        const bad = [];
        for (const b of bar.querySelectorAll('[role="tab"]')) {
          b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          await new Promise((r) => setTimeout(r, 120));
          const nb = bar.getBoundingClientRect(), r = b.getBoundingClientRect();
          if (r.left < nb.left - 1 || r.right > nb.right + 1) bad.push(b.textContent.slice(0, 20));
        }
        return bad;
      })()`);
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 2, mobile: false });
      await sleep(900);
      const hero = await heroAt();
      assert.ok(hero.pill, 'the hero carries its status pill');
      assert.equal(hero.pillClips, false, `the pill reads whole ("${hero.pill}")`);
      assert.equal(hero.pillCut, false, 'the pill sits inside the hero, never past its edge');
      assert.equal(hero.tabs, 13, 'thirteen tabs stand in the bar');
      assert.ok((hero.over ?? 0) > 2, 'the bar scrolls sideways past thirteen tabs');
      assert.notEqual(hero.fade, 'none', 'a fade signals the tabs that hide');
      assert.deepEqual(hero.uncut, [], `no tab name cut with dots: ${hero.uncut.join(', ')}`);
      assert.deepEqual(await reachWhole(), [], 'every tab scrolls whole into view');
      await shot('n3-project-after-1219x709.png');
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 709, deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      const narrow = await heroAt();
      assert.equal(narrow.pillClips, false, `the pill reads whole at 1000 ("${narrow.pill}")`);
      assert.equal(narrow.pillCut, false, 'the pill sits inside the hero at 1000');
      assert.deepEqual(narrow.uncut, [], `no tab name cut with dots at 1000: ${narrow.uncut.join(', ')}`);
      assert.deepEqual(await reachWhole(), [], 'every tab scrolls whole into view at 1000');
      // Read more only when something hides: the long summary offers it, the one-liner does not.
      const readMore = (name) => ev(`(async () => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
        const back = [...document.querySelectorAll('button')].filter(vis).find((e) => (e.getAttribute('aria-label') || '').toLowerCase().includes('back'));
        if (back) { back.click(); await new Promise((r) => setTimeout(r, 700)); }
        const rows = [...document.querySelectorAll('.gantt .grow .nm')].filter(vis);
        const row = rows.find((e) => (e.textContent || '').includes(${JSON.stringify(name)}));
        if (!row) return 'NOROW';
        row.click();
        await new Promise((r) => setTimeout(r, 900));
        const btn = document.querySelector('.w2a-psub .w2a-readmore');
        return btn ? 'MORE:' + btn.textContent : 'NONE';
      })()`);
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      assert.match(await readMore('Brunswick Site Lease'), /MORE:Read more/, 'the long summary offers Read more at 3456');
      assert.equal(await readMore('Catering Contract'), 'NONE', 'the 235-character lead fits whole in two lines: no Read more at 3456');
      await shot('n3-project-after-3456x1408.png');
      assert.equal(await readMore('Winter Menu Launch'), 'NONE', 'the one-line lead fits whole: no Read more at 3456');
      await shot('n3-project-short-after-3456x1408.png');
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 2, mobile: false });
      await sleep(900);
      await shot('n3-project-after-1920x1117.png');
    } finally {
      for (const c of close.reverse()) try { c(); } catch {}
      rmSync(work, { recursive: true, force: true });
    }
  });
});
