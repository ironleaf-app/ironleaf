// node --test tests/today-loose-tasks.test.mjs — Today over a vault of loose notes with late tick-boxes
// (t163, 9 Nov 2026: t156's new person opened an existing folder of 500 notes with 12 open tasks, some late,
// and Today said "Nothing needs a look" — Today's work rows only counted tasks in projects. The decision: Today never
// says nothing while late or due-today tasks sit anywhere in the vault). The late and
// due-today tick-boxes outside projects show in Today's work, ranked with the rest by the same rank
// (shared/brief-tasks.ts rankAllFor); the nothing line stays for when it is true. Each check fails without
// its fix. Pictures go to $NV_T163_SHOTS when set (PNG, deviceScaleFactor 2).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.NV_T163_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

test('the work list and the day’s sentence never gate on projects; only project lines do', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  const ranked = src.indexOf('const ranked = useMemo');
  assert.ok(ranked > 0, 'the one ranked list is there');
  assert.ok(!src.slice(ranked, ranked + 220).includes('!noProjects'), 'note lines rank into Today’s work with no projects too');
  assert.ok(src.slice(ranked, ranked + 220).includes('rankAllFor(projectSteps, ownNoteDated, now)'), 'through the same rank as the rest');
  const sentence = src.indexOf('const sentence = ');
  assert.ok(sentence > 0, 'the day’s sentence is there');
  assert.ok(!src.slice(sentence, sentence + 200).includes('? daySentence') || src.slice(sentence, sentence + 200).includes('welcomeOn'), 'the sentence reads with no projects unless the welcome does');
  for (const nag of ['reviewQuiet', 'dormantQuiet']) {
    const at = src.indexOf(`const ${nag} =`);
    assert.ok(at > 0 && src.slice(at, at + 120).includes('!noProjects'), `${nag} stays a project line`);
  }
});

const iso = (days) => {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

test('loose late and due-today tick-boxes show in Today’s work, ranked by the same rank', { timeout: 420000 }, async () => {
  const H = await import('./vault-controls-harness.mjs');
  const work = mkdtempSync(path.join(tmpdir(), 'nv-loose-today-'));
  const close = [];
  try {
    // A vault of loose notes, no projects: two late boxes, one due today, one later, one with no
    // day and one done. Made-up harbour shop words throughout.
    const vaultDir = path.join(work, 'vault');
    mkdirSync(path.join(vaultDir, 'Notes'), { recursive: true });
    writeFileSync(
      path.join(vaultDir, 'Notes', 'Jobs.md'),
      `# Jobs\n\n- [ ] Ring the supplier due ${iso(-2)}\n- [ ] File the BAS due ${iso(-1)}\n- [ ] Send the quote 📅 ${iso(0)}\n- [ ] Later filing due ${iso(9)}\n- [ ] Buy stamps\n- [x] Filed the old claim due ${iso(-1)}\n`,
    );
    writeFileSync(path.join(vaultDir, 'Notes', 'More.md'), '# More\n\nOrdinary words about the roster.\n');
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
    assert.ok(await ev(`!!document.querySelector('.app')`), 'the app loads on the loose-notes vault');
    await ev(`(() => {
      const root = document.querySelector('.places-list') ?? document.querySelector('.sidebar.left');
      const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
      els.find((e) => ((e.innerText || '').replace(/\\s+/g, ' ').includes('Today')))?.click();
      return 1;
    })()`);
    const waitFor = async (js, ms = 20000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        try {
          if (await ev(js)) return true;
        } catch {}
        await sleep(400);
      }
      return false;
    };
    assert.ok(await waitFor(`!!document.querySelector('.td-view')`), 'Today shows');
    assert.ok(await waitFor(`!!document.querySelector('section.td-next')`), 'Late and Next show over loose notes with late work');
    // Step 2: Late answers first, Next next — the loose boxes split across the two, each once.
    const late = await ev(`document.querySelector('section[data-section="late"]')?.innerText ?? ''`);
    const next = await ev(`document.querySelector('section[data-section="next"]')?.innerText ?? ''`);
    for (const words of ['Ring the supplier', 'File the BAS']) {
      assert.ok(late.includes(words), `Late names the loose box: ${words}`);
    }
    assert.ok(next.includes('Send the quote'), 'Next names the due-today box');
    assert.ok(late.indexOf('Ring the supplier') < late.indexOf('File the BAS'), 'the 2-days-late box ranks before the 1-day-late box');
    assert.ok(!next.includes('Ring the supplier') && !next.includes('File the BAS'), 'the late boxes never repeat in Next');
    assert.ok(!next.includes('Buy stamps') && !late.includes('Buy stamps'), 'the box with no day never ranks into Late or Next');
    assert.ok(!next.includes('Filed the old claim') && !late.includes('Filed the old claim'), 'the done box never shows as work');
    assert.equal(await ev(`document.querySelector('.td-sentence')?.textContent ?? ''`), 'You have 2 late and 1 due today.', 'the day’s sentence says the true shape');
    assert.ok(!(await ev(`!!document.querySelector('.td-welcome')`)), 'no empty-vault block over a vault with work on the person');
    if (SHOTS) {
      for (const [w, h] of [[1219, 709], [1600, 1000], [1920, 1117], [3456, 1408]]) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
        await sleep(900);
        const d = await browser.send('Page.captureScreenshot', { format: 'png' });
        if (d.result?.data) writeFileSync(path.join(SHOTS, `t163-today-loose-${w}x${h}.png`), Buffer.from(d.result.data, 'base64'));
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
