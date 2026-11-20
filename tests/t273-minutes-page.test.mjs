// node --test tests/t273-minutes-page.test.mjs — a meeting's minutes page, compact (t273, 13 Nov 2026, on
// 10.2.7, with a picture of a real meeting's minutes page). Each word check read as five stacked lines across
// the full width, its Play alone at the far right edge (~1700px from the words), its correction box stretched
// ~1650px for one word, Fix every copy at the edge; below, the summary ran as a wall of text and the
// meeting-note card read "Tasks · 11, 5 open · Decisions · 9 · Questions · 0" in a box mostly air. Now each
// check is one compact row (word and hint, Seen as, the heard line with Play beside it, a word-sized box, Fix
// beside the box), wrapping whole on narrow windows and pairing across the width past 2400px (t254's pairing);
// the bottom reads as one calm block (the summary at a reading width in short paragraphs, plain counts with a
// quiet zero left out, the button as other primary buttons). One made-up recorded meeting (6 uncertain words, a
// long summary, 11 tasks with 5 open, 9 decisions, no questions), walked at 1219x709, 1920x1117 and 3456x1408,
// driven like a person throughout. t275 (13 Nov 2026) extends it: t273's rows were ragged (each box where its
// row ended), so the checks now read as one aligned set (every box and Fix in the same columns, each half
// aligned in itself past 2400px, the same tidy two-line wrap on narrow windows), and each voice's "Join…" reads
// "Same person as…", sitting beside the name, its menu still joining two voices by hand.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = path.join(root, '..', 'shots');
mkdirSync(shotsDir, { recursive: true });
// Before/after pictures from the same walk: T275_TAG=before on the unmodified tree, then plain (after).
const TAG = process.env.T275_TAG || process.env.T273_TAG || 'after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterday = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return iso(d);
})();

// Twelve transcript lines, one sentence each, a STOP word first: six words spelt two ways (each pair its own
// first letter, so pairs never join), every other capitalised word at a line start only, so findUncertain raises
// exactly these six (CHECK_LIMIT shows five; the sixth stays queued — the cap stands, never raised).
const PAIR_LINES = [
  'Morning all, Kestoon will send the revised roadmap before Friday lunch.',
  'Thanks, Keston already sent the survey sheet to the mill team.',
  'Right, Cobbisen quoted the fitting work for the foyer site.',
  'Sure, Cobbison keeps the old quote open until the end of term.',
  'Well, Tavvish served the late shift during the market cover.',
  'Okay, Tavish helped the early crew with the stock count.',
  'Morning, Arlow pushed most remaining rooms into next year.',
  'Thanks, Arloow kept two studio rooms in this half.',
  'Right, Merrow covers the harbour stall while the crew trains.',
  'Sure, Merow takes the weekend stocktake at the north shed.',
  'Well, Wondow tinting for the gallery starts after the audit.',
  'Okay, Window locks for the side doors arrive with the crates.',
];
const stamp2 = (at) => `${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}`;

// One long paragraph (six sentences, one link to strip), so the page must break it into short paragraphs.
const SUMMARY =
  'Mia Tran and Jordan Lee met for a one-to-one covering the harbour stall, the oven install and the weekend stocktake. ' +
  'They agreed the foyer fitting work stays open until the end of term, with the revised quote due back before Friday lunch. ' +
  'The gallery tinting starts after the audit, and the side door locks arrive with the next crates. ' +
  'Most remaining rooms move into next year, with two studio rooms kept in this half. ' +
  'Jordan takes the weekend stocktake at the [[Harbour Stores|Harbour]] north shed while the crew trains. ' +
  'They left with the stocktake roster settled and the fitting quote as the only open thread.';

const DECISIONS = [
  'Keep the foyer fitting quote open until the end of term.',
  'Start the gallery tinting after the audit.',
  'Move most remaining rooms into next year.',
  'Keep two studio rooms in this half.',
  'Run the weekend stocktake at the north shed.',
  'Send the revised roadmap before Friday lunch.',
  'Serve the late shift through the market cover.',
  'Photograph the training room for the facilities team.',
  'Hold the fitting budget until the quote lands.',
];
// Eleven tasks, five open: six ticked, five open, mixed through.
const ACTIONS = [
  '- [x] Send the revised roadmap to the mill team',
  '- [ ] Chase the foyer fitting quote before Friday',
  '- [x] Book the gallery tinting after the audit',
  '- [ ] Count the spare baking trays in the harbour stall',
  '- [x] File the survey sheet with the job record',
  '- [ ] Rota the late shift through the market cover',
  '- [x] Confirm the north shed stocktake day',
  '- [ ] Photograph the training room for the facilities team',
  '- [x] Move the remaining rooms into next year',
  '- [ ] Label the cable trays before the acceptance tests',
  '- [x] Lock the side doors order with the crates',
];

const meetingNote = () =>
  [
    '---',
    'type: meeting',
    `date: ${yesterday}`,
    'time: 10:00 AM',
    'where: Harbour Stores',
    '---',
    '## Agenda',
    '',
    '- [x] Harbour stall and the oven install',
    '- [x] Weekend stocktake',
    '',
    '## Summary',
    '',
    SUMMARY,
    '',
    '## Decisions',
    '',
    ...DECISIONS.map((d) => `- ${d}`),
    '',
    '## Actions',
    '',
    ...ACTIONS,
    '',
    '## Discussion',
    '',
    '> [!quote]- Oven install',
    '> The foyer fitting work stays open until the end of term.',
    '>',
    '> Jordan takes the weekend stocktake at the north shed.',
    '',
    '## Transcript',
    '',
    'Recording: [[Files/t273-harbour/recording.wav]] · 2 minutes',
    '',
    '> [!quote]- Transcript · 2 minutes',
    ...PAIR_LINES.flatMap((text, i) => [`> **${stamp2(5 + i * 9)}** *Speaker ${(i % 2) + 1}:* ${text}`, ...(i + 1 < PAIR_LINES.length ? ['>'] : [])]),
    '',
  ].join('\n');

/** A silent recording (digital zeroes): Play opens it, nothing ever sounds. */
function silentWav(seconds = 2, rate = 8000) {
  const n = seconds * rate;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + n * 2, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(n * 2, 40);
  return Buffer.concat([head, Buffer.alloc(n * 2)]);
}

test('t273 static: the calm column and the calm bottom live in the shared rules (t301: no grid, no pairing)', () => {
  const rec = readFileSync(path.join(root, 'src/renderer/src/styles/recorder.css'), 'utf8');
  const mm = rec.slice(rec.indexOf('/* Minutes ready to send'));
  assert.ok(mm.includes('.mm-row'), 'the row keeps its shared place');
  assert.ok(!/\.mm-context\s*\{[^}]*space-between/s.test(mm), 'Play sits beside the heard line, never pushed to the edge');
  assert.ok(/\.mm-fix input\s*\{[^}]*max-width:\s*360px/s.test(mm), 'the correction box caps at a word or so');
  // t301: one calm column — each check its own stack (the word, Seen as, the heard line with Play, the box
  // with Fix), capped to a reading width at every window. The shared grid and the wide pairing are gone.
  assert.ok(/\.mm-list\s*\{[^}]*flex-direction:\s*column/s.test(mm), 'the checks read as one calm column');
  assert.ok(/\.mm-list\s*\{[^}]*max-width:\s*76ch/s.test(mm), 'the column caps to a reading width');
  assert.ok(/\.mm-row\s*\{[^}]*flex-direction:\s*column/s.test(mm), 'each check stacks its own lines');
  assert.ok(/\.mm-fix\s*\{[^}]*display:\s*flex/s.test(mm), 'the box and Fix sit beside each other');
  assert.ok(!/@media \(min-width: 2400px\)/.test(mm), 'no pairing: one column at every width');
  // t275: each voice row hugs its name, and the choice reads in plain words, menu to aria.
  assert.ok(/\.spk-row\s*\{[^}]*minmax\(0,\s*max-content\)/s.test(rec), 'each voice row hugs its name');
  assert.ok(!/\.spk-join\s*\{[^}]*max-width:\s*96px/s.test(rec), 'the voice choice fits its plain words');
  const spk = readFileSync(path.join(root, 'src/renderer/src/components/SpeakerNames.tsx'), 'utf8');
  assert.ok(spk.includes('Same person as…'), 'the voice choice reads in plain words');
  assert.ok(!spk.includes('Join…'), 'Join says nothing on a voice');
  assert.ok(spk.includes('is the same person as'), 'its menu, title and aria words match');
  assert.ok(!/:has\(/.test(mm) && !/!important/.test(mm), 'no :has(), no new !important in the minutes rules');
  const w2b = readFileSync(path.join(root, 'src/renderer/src/styles/w2b.css'), 'utf8');
  assert.ok(/\.w2b-summary\s*\{[^}]*max-width:\s*76ch/s.test(w2b), 'the summary keeps a reading width');
  const page = readFileSync(path.join(root, 'src/renderer/src/views/modules/work/MeetingsPage.tsx'), 'utf8');
  assert.ok(page.includes('countWords('), 'the note card counts in the shared count words');
  assert.ok(!page.includes('Tasks · ${'), 'the dotted Tasks/Decisions/Questions line is gone');
});

test('t273 live: calm checks in one column and a calm bottom at 1219, 1920 and 3456, driven like a person', { timeout: 600000 }, async () => {
  const h = await startHarness();
  try {
    await h.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    const rel = `Meetings/${yesterday} Harbour one-to-one review.md`;
    const w = (r, text) => {
      const p = path.join(h.vaultDir, ...r.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    w(rel, meetingNote());
    {
      const p = path.join(h.vaultDir, 'Files', 't273-harbour', 'recording.wav');
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, silentWav());
    }
    await h.services.rescanAll();
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(1500);
    const SEL = 'button, a[href], [role="button"], [role="tab"]';
    const clickWords = async (words, scope = '') => {
      const r = await h.browser.ev(`(async () => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
        const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
        if (!root) return 'NOROOT';
        const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter((e) => vis(e) && !e.disabled);
        const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
        if (!el) return 'NOTFOUND';
        el.scrollIntoView({ block: 'nearest' }); el.click();
        await new Promise((r) => setTimeout(r, 500));
        return 'CLICKED';
      })()`);
      assert.equal(r, 'CLICKED', `clicked ${words}${scope ? ` in ${scope}` : ''}`);
    };
    const waitFor = async (js, ms = 30000) => {
      const t0 = Date.now();
      for (;;) {
        try {
          if (await h.browser.ev(js)) return;
        } catch {}
        if (Date.now() - t0 > ms) throw new Error(`waited: ${js.slice(0, 140)}`);
        await sleep(300);
      }
    };
    const openRoom = async (name) => {
      if (
        (await h.browser.ev(`(async () => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
        const els = [...document.querySelectorAll('.sidebar.left button, aside button')].filter(vis);
        const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(name)})));
        if (!el) return 'NOTFOUND';
        el.click();
        await new Promise((r) => setTimeout(r, 500));
        return 'CLICKED';
      })()`)) === 'CLICKED'
      )
        return;
      await clickWords('More', '.sidebar.left, aside');
      await sleep(500);
      await clickWords(name, '.menu, [role="menu"]');
    };
    const shot = async (file, clip) => {
      const d = await h.browser.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
      assert.ok(d.result?.data ?? d.data, `pixels for ${file}`);
      writeFileSync(path.join(shotsDir, file), Buffer.from(d.result?.data ?? d.data, 'base64'));
    };

    await openRoom('Meetings');
    await waitFor(`!!document.querySelector('.w2b-meetings')`);
    await clickWords('Past');
    await waitFor(`(document.querySelector('.w2b-meetings')?.innerText || '').includes('Harbour one-to-one review')`);
    await clickWords('Harbour one-to-one review');
    await waitFor(`!!document.querySelector('.w2b-meeting')`);
    // Five checks show (CHECK_LIMIT caps the six raised; the cap stands).
    await waitFor(`document.querySelectorAll('.w2b-meeting .mm-row').length === 5`, 30000);
    await waitFor(`(document.querySelector('.w2b-meeting .mm-check')?.innerText || '').includes('5 words to check')`);
    await waitFor(`!!document.querySelector('.w2b-meeting section[aria-label="Tasks, decisions and questions"]')`);

    const MEASURE_JS = `(() => {
      const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; };
      const rows = [...document.querySelectorAll('.w2b-meeting .mm-row')].map((row) => {
        const q = row.querySelector('.mm-quote');
        const play = row.querySelector('.mm-context button');
        const input = row.querySelector('.mm-fix input');
        const fix = row.querySelector('.mm-fix button');
        const pos = (a, b) => (a && b ? (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'not-after') : 'missing');
        return {
          row: rect(row), quote: q ? rect(q) : null,
          play: play ? { ...rect(play), words: play.innerText.trim() } : null,
          input: input ? rect(input) : null, fix: fix ? rect(fix) : null,
          order: [pos(play, input), pos(input, fix)],
          scrollW: row.scrollWidth, clientW: row.clientWidth, words: row.innerText,
        };
      });
      const spks = [...document.querySelectorAll('.w2b-meeting .spk-row')].map((row) => {
        const name = row.querySelector('.spk-name');
        const join = row.querySelector('.spk-join');
        return { name: name ? rect(name) : null, join: join ? { ...rect(join), words: join.innerText.trim(), title: join.title || '', aria: join.getAttribute('aria-label') || '' } : null };
      });
      const sumSec = [...document.querySelectorAll('.w2b-meeting section')].find((s) => s.getAttribute('aria-label') === 'Summary');
      const noteSec = document.querySelector('.w2b-meeting section[aria-label="Tasks, decisions and questions"]');
      const paras = [...document.querySelectorAll('.w2b-meeting .w2b-summary')].map((p) => ({ ...rect(p), scrollW: p.scrollWidth, clientW: p.clientWidth, words: p.innerText }));
      const card = noteSec?.querySelector('.card');
      const noteBtn = noteSec?.querySelector('.button');
      const pdfBtn = document.querySelector('.w2b-meeting .mm-finish .button.primary');
      return {
        rows, spks,
        summary: sumSec ? rect(sumSec) : null, note: noteSec ? rect(noteSec) : null,
        paras, cardWords: noteSec?.innerText ?? '',
        card: card ? rect(card) : null, noteBtn: noteBtn ? rect(noteBtn) : null, pdfBtn: pdfBtn ? rect(pdfBtn) : null,
        docX: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    })()`;

    // Pictures at every size first, so a failing check still leaves the full set behind.
    const measured = [];
    for (const [width, height] of [[1219, 709], [1920, 1117], [3456, 1408]]) {
      await h.browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
      await sleep(1200);
      await h.browser.ev(`document.querySelector('.w2b-meeting .mm-check')?.scrollIntoView({ block: 'start' })`);
      await sleep(400);
      await shot(`t275-${TAG}-${width}.png`);
      if (width === 3456) {
        const clip = await h.browser.ev(`(() => {
          const mm = document.querySelector('.w2b-meeting .mm-check')?.getBoundingClientRect();
          const sec = [...document.querySelectorAll('.w2b-meeting section')].find((s) => s.getAttribute('aria-label') === 'Summary')?.getBoundingClientRect();
          if (!mm) return null;
          return { x: 0, y: Math.max(0, mm.top - 40), width: 3456, height: Math.min(1408, ((sec?.bottom ?? mm.bottom + 900) - mm.top) + 120), scale: 1 };
        })()`);
        if (clip) await shot(`t275-${TAG}-3456-bottom.png`, clip);
      }
      await h.browser.ev(`document.querySelector('.w2b-meeting .spk')?.scrollIntoView({ block: 'start' })`);
      await sleep(400);
      await shot(`t275-${TAG}-${width}-spk.png`);
      measured.push([width, await h.browser.ev(MEASURE_JS)]);
    }
    const eq1 = (xs, what, width) => {
      assert.ok(Math.max(...xs) - Math.min(...xs) <= 1, `${what} at ${width} (lefts ${xs.join(', ')})`);
    };
    for (const [width, m] of measured) {
      assert.equal(m.rows.length, 5, `five checks at ${width}`);
      // t275: each voice names the choice plainly and sits it beside the name, never floating mid-row.
      assert.equal(m.spks.length, 2, `two voices above the checks at ${width}`);
      for (const [i, s] of m.spks.entries()) {
        assert.equal(s.join.words, 'Same person as…', `voice ${i} names the choice plainly at ${width}`);
        assert.ok(s.join.left - s.name.right >= 0 && s.join.left - s.name.right <= 32, `voice ${i} sits its choice beside the name at ${width} (stood ${s.join.left - s.name.right}px past it)`);
        assert.ok(s.join.title.includes('same person') && s.join.aria.includes('same person'), `voice ${i} keeps its title and aria words in step at ${width}`);
      }
      for (const [i, r] of m.rows.entries()) {
        assert.ok(r.play && r.play.words === 'Play', `row ${i} offers Play at ${width} (saw ${JSON.stringify(r.play?.words)})`);
        assert.ok(r.play.left - r.quote.right <= 32, `row ${i} Play beside its heard line at ${width} (stood ${r.play.left - r.quote.right}px past it)`);
        assert.ok(Math.abs(r.play.top + r.play.height / 2 - (r.quote.top + r.quote.height / 2)) <= 24 || r.play.top - r.quote.bottom <= 8, `row ${i} Play within a line's reach at ${width}`);
        assert.ok(r.input.width <= 360, `row ${i} box word-sized at ${width} (stood ${r.input.width}px)`);
        // t275: narrow rows wrap whole (box and Fix on their own aligned line below); one-line rows keep Fix beside the box.
        if (width !== 1219) assert.ok(r.fix.left - r.input.right <= 24, `row ${i} Fix beside its box at ${width}`);
        assert.deepEqual(r.order, ['after', 'after'], `row ${i} keyboard order stays Play, box, Fix at ${width}`);
        assert.ok(r.scrollW <= r.clientW + 1, `row ${i} cuts nothing at ${width}`);
        assert.ok(!r.words.includes('…'), `row ${i} hides nothing behind dots at ${width}`);
      }
      // t301: one calm column at every width — each check stacks its box under its heard line, Fix beside
      // the box, every row starting at the same edge. No pairing, no shared grid.
      if (width === 3456) {
        const tops = m.rows.map((r) => r.row.top);
        assert.ok(tops.every((t, i) => tops.every((u, j) => j === i || Math.abs(t - u) > 8)), `the checks stack one per row at 3456 (tops ${tops.join(', ')})`);
        eq1(m.rows.map((r) => r.row.left), 'every row starts at the same edge', width);
      }
      if (width === 1920 || width === 3456) {
        eq1(m.rows.map((r) => r.quote.left), 'every heard line starts at the same edge', width);
        eq1(m.rows.map((r) => r.input.left), "every word check's box left edge is equal", width);
      }
      for (const [i, r] of m.rows.entries()) {
        assert.ok(r.input.top > r.quote.top + 8, `row ${i} stacks its box under the heard line at ${width}`);
        assert.ok(Math.abs(r.fix.top - r.input.top) <= 8, `row ${i} keeps Fix beside its box at ${width}`);
      }
      if (width === 1219) {
        for (const [i, r] of m.rows.entries()) {
          assert.ok(r.play.bottom <= r.input.top + 2, `row ${i} keeps Play on the top line at ${width}`);
        }
        eq1(m.rows.map((r) => r.input.left), 'every wrapped box left edge is equal', width);
      }
      // The counts read in plain words, the quiet zero left out.
      assert.ok(m.cardWords.includes('11 tasks, 5 open'), `the tasks count reads plainly at ${width} (${m.cardWords.slice(0, 120)})`);
      assert.ok(m.cardWords.includes('9 decisions'), `the decisions count reads at ${width}`);
      assert.ok(!m.cardWords.includes('Questions') && !/· 0/.test(m.cardWords), `no zeroed questions at ${width}`);
      assert.ok(!m.cardWords.includes('Tasks · 11'), `the dotted line is gone at ${width}`);
      // The button sized as other primary buttons.
      assert.equal(m.noteBtn.height, m.pdfBtn.height, `Open the meeting note matches Save as PDF at ${width} (${m.noteBtn.height} vs ${m.pdfBtn.height})`);
      // The summary at a reading width, in short paragraphs, nothing cut.
      assert.ok(m.paras.length >= 2, `the long summary breaks into paragraphs at ${width} (stood ${m.paras.length})`);
      for (const [i, p] of m.paras.entries()) {
        assert.ok(p.width <= 780, `summary paragraph ${i} keeps a reading width at ${width} (stood ${p.width}px)`);
        assert.ok(p.scrollW <= p.clientW + 1, `summary paragraph ${i} cuts nothing at ${width}`);
      }
      assert.ok(!m.paras.some((p) => p.words.includes('[[')), 'note links read as words, never brackets');
      assert.equal(m.docX, false, `nowhere sideways at ${width}`);
    }
    // No empty half: at the window the summary pairs beside the note card.
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 2, mobile: false });
    await sleep(1200);
    const pair = await h.browser.ev(`(() => {
      const secs = [...document.querySelectorAll('.nv-page .w2b-meeting > section')].map((s) => ({ label: s.getAttribute('aria-label') || s.className, top: Math.round(s.getBoundingClientRect().top) }));
      return secs;
    })()`);
    const sumTop = pair.find((s) => s.label === 'Summary')?.top;
    const noteTop = pair.find((s) => s.label === 'Tasks, decisions and questions')?.top;
    assert.ok(sumTop !== undefined && noteTop !== undefined, `both bottom sections show (${JSON.stringify(pair)})`);
    assert.ok(Math.abs(sumTop - noteTop) <= 8, `the summary pairs beside the note card, no empty half (tops ${sumTop} vs ${noteTop})`);

    // t275: the voices' choice still joins two voices by hand, driven like a person, then undoes.
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 2, mobile: false });
    await sleep(900);
    const joinHint = await h.browser.ev(`[...document.querySelectorAll('.w2b-meeting .spk-join')].map((b) => b.innerText.trim()).join('|')`);
    assert.equal(joinHint, 'Same person as…|Same person as…', 'both voices offer the plain choice');
    await clickWords('Same person as…', '.w2b-meeting .spk-rows');
    await waitFor(`!!document.querySelector('.menu .menu-heading')`);
    const heading = await h.browser.ev(`document.querySelector('.menu .menu-heading')?.innerText ?? ''`);
    assert.ok(heading.includes('is the same person as'), `the menu names the choice (${heading})`);
    await clickWords('Speaker 2', '.menu');
    await waitFor(`document.querySelectorAll('.w2b-meeting .spk-row').length === 1`, 30000);
    await waitFor(`(document.querySelector('.w2b-meeting .spk-title')?.innerText || '').includes('1 voice so far')`);
    await waitFor(`(document.querySelector('.w2b-meeting .spk-line')?.innerText || '').includes('is now part of')`);
    await clickWords('Undo', '.w2b-meeting .spk');
    await waitFor(`document.querySelectorAll('.w2b-meeting .spk-row').length === 2`, 30000);
    // Play, Fix and Save as PDF still work, driven like a person.
    // Play: the meeting's own player answers the moment (its transcript opens; the file itself is silent).
    const wasShut = await h.browser.ev(`(() => {
      const btn = document.querySelector('.w2b-meeting .mm-row .mm-context button');
      if (!btn) return 'NOBUTTON';
      const was = document.querySelector('.w2b-meeting .mp-toggle')?.getAttribute('aria-expanded') ?? 'NOTOGGLE';
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      return was;
    })()`);
    assert.equal(wasShut, 'false', 'the transcript starts shut, so Play opening it proves the wiring');
    await waitFor(`document.querySelector('.w2b-meeting .mp-toggle')?.getAttribute('aria-expanded') === 'true'`, 30000);
    await waitFor(`document.querySelectorAll('.w2b-meeting .mp-lines .mp-line').length === 12`, 30000);
    const fixR = await h.browser.ev(`(async () => {
      const row = document.querySelector('.w2b-meeting .mm-row');
      const input = row?.querySelector('.mm-fix input');
      if (!input) return 'NOINPUT';
      input.scrollIntoView({ block: 'center' });
      input.focus();
      input.select();
      document.execCommand('selectAll', false);
      await new Promise((r) => setTimeout(r, 200));
      return 'READY';
    })()`);
    assert.equal(fixR, 'READY', 'the first box takes focus');
    // The box grows with what is typed (then back to the real correction).
    const w0 = await h.browser.ev(`document.querySelector('.w2b-meeting .mm-row .mm-fix input').getBoundingClientRect().width`);
    await h.browser.send('Input.insertText', { text: 'Kestonkestonkestonkestonkestonkeston' });
    await sleep(400);
    const w1 = await h.browser.ev(`document.querySelector('.w2b-meeting .mm-row .mm-fix input').getBoundingClientRect().width`);
    assert.ok(w1 > w0 + 30 && w1 <= 360, `the box grows with typing yet caps at a word or so (${Math.round(w0)}px to ${Math.round(w1)}px)`);
    await h.browser.ev(`document.querySelector('.w2b-meeting .mm-row .mm-fix input').select()`);
    await h.browser.send('Input.insertText', { text: 'Keston' });
    await sleep(400);
    await clickWords('Fix every copy', '.w2b-meeting .mm-row');
    await waitFor(`(document.querySelector('.toast')?.innerText || '').includes('Fixed 2 copies')`, 30000);
    {
      const t0 = Date.now();
      for (;;) {
        const note = readFileSync(path.join(h.vaultDir, ...rel.split('/')), 'utf8');
        if (!note.includes('Kestoon') && (note.match(/Keston/g) ?? []).length >= 2) break;
        if (Date.now() - t0 > 20000) throw new Error('the fix never landed in the note');
        await sleep(400);
      }
    }
    // The fixed word leaves and the queued sixth takes its place (the cap still shows five).
    await waitFor(`![...document.querySelectorAll('.w2b-meeting .mm-row')].some((r) => (r.innerText || '').includes('Kestoon'))`, 30000);
    await waitFor(`[...document.querySelectorAll('.w2b-meeting .mm-row')].some((r) => (r.innerText || '').includes('Wondow'))`, 30000);
    // The rest skipped, so Save as PDF's own saved words (not its words-nudge) are what show.
    await clickWords('Skip for now', '.w2b-meeting .mm-check');
    await waitFor(`document.querySelectorAll('.w2b-meeting .mm-row').length === 0`, 30000);
    // Save as PDF: the button as a person presses it (the harness answers no exports door, and its window.nv
    // Proxy ignores plain assignment, so the file dialog is answered by wrapping it, as t166 wraps the minutes).
    await h.browser.ev(`(() => {
      if (window.__t273wrapped) return 'ready';
      const real = window.nv;
      window.nv = new Proxy(real, { get: (t, p) => (p === 'exports' ? { brandPdf: async () => 'T273 Made-up Minutes.pdf' } : t[p]) });
      window.__t273wrapped = true;
      return 'ready';
    })()`);
    await clickWords('Save as PDF', '.w2b-meeting .mm-finish');
    await waitFor(`(document.querySelector('.toast')?.innerText || '').includes('Saved T273 Made-up Minutes.pdf')`, 30000);
  } finally {
    await h.close().catch(() => {});
  }
});
