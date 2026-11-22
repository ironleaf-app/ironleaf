// node --test tests/notes-folders-fit.test.mjs — t190 (10 Nov 2026): the Notes page's folder list fits without
// scrolling. t152 found: with 24 folders the sticky rail ran 140px past the window and its last rows answered no
// click, reaching no scroller. So the rail measures what fits and folds whole folders behind one quiet "N more
// folders" row, as the former host app's rail folds workspaces and the side bar tree windows its rows; opening
// it shows the rest in place and the rail stops sticking, so the page's own scroll reaches every row. Sticky
// only while it fits. The folder on show is always a drawn row; nothing is moved, renamed or hidden for good.
// Static checks fail without the fix; the live half clicks the last folder for real at 1219x709, 1920x1117 and
// 3456x1408 with 8, 24 and 60 folders. NV_FOLDERS_SHOTS=dir writes the 24-folder PNGs (deviceScaleFactor 2).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pageSrc = () => readFileSync(path.join(root, 'src/renderer/src/views/NotesPage.tsx'), 'utf8');
const cssSrc = () => readFileSync(path.join(root, 'src/renderer/src/styles/w2b.css'), 'utf8');

test('static: the rail folds whole folders behind N more folders, sticky only while it fits', () => {
  const src = pageSrc();
  assert.match(src, /folderChoices\(rows\)/, 'the rail still reads the shared folder choices');
  assert.match(src, /\[folderFit, setFolderFit\] = useState<number \| null>\(null\)/, 'the rail measures how many folders fit');
  assert.match(src, /\[foldersOpen, setFoldersOpen\] = useState\(false\)/, 'the rest opens in place, shut to begin with');
  assert.match(src, /data-fgroup=\{f\.prefix\}/, 'each drawn group carries its folder for the measure');
});

test('static: the more row, the fewer row and the tall rail read as one quiet mechanism', () => {
  const src = pageSrc();
  assert.match(src, /w2b-morefolders/, 'one quiet row class for more and fewer');
  assert.match(src, /more folders/, 'the row says N more folders, the brief\u2019s words');
  assert.match(src, /Fewer folders/, 'the way back says Fewer folders');
  assert.match(src, /aria-expanded/, 'the row tells assistive tech whether the rest shows');
  assert.match(src, /is-tall/, 'the opened rail stops sticking so the page scroll reaches it');
  assert.match(src, /setFoldersOpen\(true\)/, 'a link into a folded folder opens the rail, so the folder on show is always drawn');
  const css = cssSrc();
  const rail = css.match(/\.w2b-folders \{([^}]*)\}/)?.[1] ?? assert.fail('no .w2b-folders rule');
  assert.ok(rail.includes('overflow') && rail.includes('hidden'), 'the rail never scrolls on its own (overflow hidden, as the host app\u2019s rail)');
  assert.ok(!/overflow(-y)?\s*:\s*(auto|scroll)/.test(rail), 'no scrollbar of its own in any state');
  assert.match(css, /\.w2b-folders\.is-tall \{[^}]*position:\s*static/, 'the tall rail scrolls with the page instead of sticking past it');
  const more = css.match(/\.w2b-morefolders \{([^}]*)\}/)?.[1] ?? assert.fail('no more-folders rule');
  assert.ok(more.includes('var(--text'), 'quiet words from the theme tokens');
  assert.ok(!more.includes('accent'), 'never an accent');
});

const SIZES = [[1219, 709], [1920, 1117], [3456, 1408]];
const COUNTS = [8, 24, 60];
const SHOTS = process.env.NV_FOLDERS_SHOTS || '';

/** Exactly n tops on Notes' rail: Folder 01..NN with one note each, plus one note a level down in
 *  Folder 01, so its group spans two rows and proves sub rows ride with their folder. */
function seedFolders(vaultDir, n) {
  for (let i = 1; i <= n; i++) {
    const f = `Folder ${String(i).padStart(2, '0')}`;
    mkdirSync(path.join(vaultDir, f), { recursive: true });
    writeFileSync(path.join(vaultDir, f, `Harbour note ${i}.md`), `---\ntype: note\n---\n# Harbour note ${i}\n\nOrdinary words about the harbour work, job ${i}.\n`);
  }
  mkdirSync(path.join(vaultDir, 'Folder 01', 'Sub'), { recursive: true });
  writeFileSync(path.join(vaultDir, 'Folder 01', 'Sub', 'Deep note.md'), `---\ntype: note\n---\n# Deep note\n\nA note one level down, proving sub rows ride with their folder.\n`);
}

test('live: every folder is one click away at three sizes with 8, 24 and 60 folders', { timeout: 1500000 }, async () => {
  const H = await import('./vault-controls-harness.mjs');
  for (const N of COUNTS) {
    const work = mkdtempSync(path.join(tmpdir(), 'nv-folders-fit-'));
    const vaultDir = path.join(work, 'vault');
    mkdirSync(vaultDir, { recursive: true });
    seedFolders(vaultDir, N);
    mkdirSync(path.join(work, 'data'), { recursive: true });
    const core = await H.loadCore(work);
    const box = { current: await H.openServices(vaultDir, path.join(work, 'data'), core) };
    const distDir = await H.buildRenderer(work);
    const server = await H.startServer(distDir, () => box.current);
    const browser = await H.startBrowser(server.origin);
    try {
      const ev = browser.ev;
      for (let i = 0; i < 90; i++) {
        await sleep(500);
        try {
          if (await ev(`!!document.querySelector('.app')`)) break;
        } catch {}
      }
      assert.ok(await ev(`!!document.querySelector('.app')`), `the app loads with ${N} folders`);

      const sideClick = (words) => ev(`(() => {
        const root = document.querySelector('.sidebar.left');
        if (!root) return 'NOROOT';
        const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
        const el = els.find((e) => (e.innerText || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)}));
        if (!el) return 'NOTFOUND ' + els.map((e) => (e.innerText || '').replace(/\\s+/g, ' ').slice(0, 20)).join(' | ');
        el.click();
        return 'CLICKED';
      })()`);
      const waitFor = async (expr, ms = 15000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          try {
            if (await ev(expr)) return true;
          } catch {}
          await sleep(200);
        }
        return false;
      };
      assert.equal(await sideClick('Notes'), 'CLICKED', `the sidebar reaches Notes with ${N} folders`);
      assert.ok(await waitFor(`!!document.querySelector('.w2b-folders')`), `Notes draws its folder rail with ${N} folders`);

      /** The rail as a person finds it: geometry, own overflow, drawn groups, the more row, the row on show. */
      const railState = () => ev(`(() => {
        const nav = document.querySelector('.w2b-folders');
        if (!nav) return null;
        const r = nav.getBoundingClientRect();
        const cs = getComputedStyle(nav);
        return {
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          pos: cs.position, overflowY: cs.overflowY,
          // App panes (panes.css, 20 Nov 2026): the rail is a pane as tall as the window beside the list.
          panes: !!nav.parentElement?.hasAttribute('data-has-panes'),
          scrollH: nav.scrollHeight, clientH: nav.clientHeight,
          groups: [...nav.querySelectorAll('[data-fgroup]')].map((g) => g.getAttribute('data-fgroup')),
          more: [...nav.querySelectorAll('.w2b-morefolders')].map((b) => ({ text: (b.innerText || '').replace(/\\s+/g, ' ').trim(), expanded: b.getAttribute('aria-expanded') })),
          first: [...nav.querySelectorAll(':scope > button.frow')].slice(0, 3).map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ')),
          on: nav.querySelector('.frow.on') ? (nav.querySelector('.frow.on').innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40) : '',
          subRows: nav.querySelectorAll('.frow.sub').length,
          moreBtns: nav.querySelectorAll('.frow-more').length,
          vh: window.innerHeight,
        };
      })()`);
      /** A genuine pointer click at the row's centre, after proving the point hits the row itself: a
       *  stranded row (past the window, under the page edge) answers no click, as t152's did. */
      const clickRailRow = async (label) => {
        const pt = await ev(`(() => {
          const nav = document.querySelector('.w2b-folders');
          const el = [...nav.querySelectorAll('button.frow')].find((e) => (e.innerText || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(label)}));
          if (!el) return null;
          el.scrollIntoView({ block: 'nearest' });
          const r = el.getBoundingClientRect();
          const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
          const hit = document.elementFromPoint(x, y);
          const row = hit && hit.closest ? hit.closest('button.frow') : null;
          return { x, y, hit: row ? row.innerText.replace(/\\s+/g, ' ').trim().slice(0, 40) : (hit ? hit.tagName + '.' + String(hit.className).slice(0, 30) : 'NONE') };
        })()`);
        assert.ok(pt, `${N} folders: the ${label} row is drawn to click`);
        assert.ok(pt.hit.includes(label), `${N} folders: the ${label} row answers at its centre, not ${pt.hit}`);
        await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
        await sleep(700);
      };
      const lastName = `Folder ${String(N).padStart(2, '0')}`;

      for (const [W, Ht] of SIZES) {
        const tag = `${W}x${Ht}, ${N} folders`;
        await browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Ht, deviceScaleFactor: 1, mobile: false });
        // Back to the shut rail whatever the last size left: All notes, then Fewer if it offers, then the
        // page's top, so the shut rail is judged below the head (its lowest place) at every size.
        await ev(`(() => { [...document.querySelectorAll('.w2b-folders button.frow')].find((e) => (e.innerText || '').includes('All notes'))?.click(); return 1; })()`);
        await sleep(500);
        await ev(`(() => { [...document.querySelectorAll('.w2b-folders .w2b-morefolders')].find((e) => (e.innerText || '').includes('Fewer'))?.click(); return 1; })()`);
        await sleep(500);
        await ev(`(() => { const sc = document.querySelector('.nv-page-scroll'); if (sc) sc.scrollTop = 0; return 1; })()`);
        await sleep(900);
        let st = await railState();
        assert.ok(st, `${tag}: the rail is drawn`);
        const folded = st.groups.length < N;
        // Nothing moved: All notes, Daily, Docs lead in their order, folder rows keep their count and menu.
        assert.deepEqual(st.first, ['All notes', 'Daily', 'Docs'], `${tag}: All notes, Daily, Docs lead as before (${st.first.join(' / ')})`);
        // Since app panes (round 3, 20 Nov 2026) the rail beside the list is a pane as tall as the window that
        // scrolls inside itself, as every pane does, so its rows are reached in place; outside panes it never
        // scrolls on its own and sticks while it fits. Either way the fold, the counts and the real click to
        // the last folder below hold (updated 23 Nov 2026).
        const railPos = st.panes ? 'static' : 'sticky';
        if (st.panes) assert.ok(st.bottom <= st.vh, `${tag}: the rail pane ends inside the window (bottom ${st.bottom} of ${st.vh})`);
        else assert.ok(!['auto', 'scroll'].includes(st.overflowY), `${tag}: the rail never scrolls on its own (overflow ${st.overflowY})`);
        if (folded) {
          assert.equal(st.more.length, 1, `${tag}: one more row folds the rest`);
          const hidden = N - st.groups.length;
          assert.equal(st.more[0].text, hidden === 1 ? '1 more folder' : `${hidden} more folders`, `${tag}: it counts the folded folders (${st.more[0].text})`);
          assert.equal(st.more[0].expanded, 'false', `${tag}: shut to begin with`);
          assert.ok(st.bottom <= st.vh, `${tag}: the shut rail fits the window (bottom ${st.bottom} of ${st.vh})`);
          assert.ok(st.scrollH <= st.clientH + 1, `${tag}: nothing hides past its edge (${st.scrollH} of ${st.clientH})`);
        } else {
          assert.equal(st.groups.length, N, `${tag}: every folder drawn`);
          assert.equal(st.more.length, 0, `${tag}: everything fits, so no more row`);
          assert.ok(st.bottom <= st.vh, `${tag}: the rail fits the window (bottom ${st.bottom} of ${st.vh})`);
        }
        assert.ok(st.groups.includes('Folder 01'), `${tag}: the first folder draws`);
        assert.ok(st.subRows >= 1, `${tag}: its sub row rides with it`);
        assert.equal(st.moreBtns, st.groups.length + st.subRows, `${tag}: every folder row keeps its own menu button`);
        assert.equal(st.pos, railPos, `${tag}: the fitting rail ${st.panes ? 'stands as its pane' : 'stays sticky'}`);

        if (SHOTS && N === 24) {
          await browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Ht, deviceScaleFactor: 2, mobile: false });
          await sleep(900);
          const d = await browser.send('Page.captureScreenshot', { format: 'png' });
          if (d.result?.data) {
            mkdirSync(SHOTS, { recursive: true });
            writeFileSync(path.join(SHOTS, `t190-folders-24-${W}x${Ht}.png`), Buffer.from(d.result.data, 'base64'));
          }
          await browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Ht, deviceScaleFactor: 1, mobile: false });
          await sleep(600);
        }

        // The last folder, for real: open the rest if folded, then click its row with the pointer.
        if (folded) await clickRailRow('more folder');
        st = await railState();
        assert.equal(st.groups.length, N, `${tag}: the opened rail draws every folder (${st.groups.length} of ${N})`);
        if (st.panes) assert.ok(st.bottom <= st.vh, `${tag}: the opened rail pane still ends inside the window, scrolling in itself`);
        else assert.ok(!['auto', 'scroll'].includes(st.overflowY), `${tag}: the opened rail still never scrolls on its own`);
        if (st.panes) assert.equal(st.pos, 'static', `${tag}: the opened rail stands as its pane`);
        else assert.equal(st.pos, folded ? 'static' : 'sticky', `${tag}: the ${folded ? 'tall rail stops sticking so the page scroll reaches it' : 'fitting rail stays sticky'}`);
        await clickRailRow(lastName);
        st = await railState();
        assert.ok(st.on.includes(lastName), `${tag}: the last folder takes the row on show (${st.on})`);
        const main = await ev(`(() => ({
          rows: document.querySelectorAll('main .w2b-row').length,
          // textContent, not innerText: rows past the fold skip paint (content-visibility) and read empty.
          first: (document.querySelector('main .w2b-row')?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 60),
        }))()`);
        assert.equal(main.rows, 1, `${tag}: the page shows the last folder's one note`);
        assert.ok(main.first.includes(`Harbour note ${N}`), `${tag}: it is the last folder's note (${main.first})`);
        // The folder on show stays drawn: no fold-back while it would hide it; All notes brings it back.
        assert.equal(st.more.length, 0, `${tag}: no fold-back offered while it would hide the folder on show`);
        await clickRailRow('All notes');
        st = await railState();
        assert.ok(st.on.includes('All notes'), `${tag}: All notes takes the row on show again`);
        if (folded) {
          assert.ok(st.more.some((m) => m.text.includes('Fewer folders')), `${tag}: All notes brings the fold-back row (${st.more.map((m) => m.text).join(' / ')})`);
          await clickRailRow('Fewer folders');
          st = await railState();
          assert.ok(st.groups.length < N, `${tag}: Fewer folds the rest away again`);
          assert.ok(st.bottom <= st.vh, `${tag}: the shut rail fits again (bottom ${st.bottom} of ${st.vh})`);
          assert.equal(st.pos, railPos, `${tag}: and ${st.panes ? 'stands as its pane' : 'sticks'} again`);
        }
      }
    } finally {
      try {
        browser.close();
      } catch {}
      try {
        server.close();
      } catch {}
      rmSync(work, { recursive: true, force: true });
    }
  }
});
