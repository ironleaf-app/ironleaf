// node --test tests/brand-document-pages.test.mjs — a branded PDF from any note (5 Nov 2026): the finished document
// printed as real PDFs by headless Chromium, on invented kits (a green reference twin, a red band with a white logo, a
// pale yellow accent, a near-black accent, one colour and no logo, a primary-only logo that disappears on its band,
// and no kit) and invented notes (a meeting with actions, a report with wide tables, a one-paragraph note, a
// sixty-page note, right-to-left and accented names, a title with odd characters). Measured by code, every case: no
// text outside its page box, nothing under the footer, contrast on the band at least 4.5 to 1, no heading left alone at
// a page foot, long tables keeping every row whole with their header repeated, and the page count true from the layout
// to the PDF. The PDF keeps real selectable text, a title and an outline. The pages go to ../shots/ by kit and
// note as JPEG pictures at 110 dpi (the sixty-page note keeps its first, middle and last pages; every PDF is kept
// whole), and each one is looked at.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');
const root = path.join(import.meta.dirname, '..');
const shots = path.join(root, '..', 'shots', 'brand-document');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = process.env.HEADLESS_SHELL || (process.env.HOME || '') + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

let B;
const work = mkdtempSync(path.join(tmpdir(), 'nv-brand-pages-'));
const filesDir = path.join(work, 'files');
let server;
let origin = '';
let browser;

before(async () => {
  assert.ok(existsSync(SHELL), `no headless Chromium (HEADLESS_SHELL): ${SHELL}`);
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/brand-document.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'bd.mjs'), format: 'esm' }, logLevel: 'silent' });
  B = await import(pathToFileURL(path.join(work, 'bd.mjs')).href);
  rmSync(shots, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });
  mkdirSync(path.join(filesDir, 'Logos'), { recursive: true });
  mkdirSync(path.join(filesDir, 'Photos'), { recursive: true });
  // Invented logo marks (white for dark bands, dark for light ones) and an invented oven sketch.
  const mark = (fill, words) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 86"><g fill="${fill}"><path d="M75 4 106 46H90l14 18H46l14-18H44z"/><text x="75" y="83" font-family="Helvetica,Arial,sans-serif" font-size="17" font-weight="700" text-anchor="middle">${words}</text></g></svg>`;
  writeFileSync(path.join(filesDir, 'Logos/harbour-white.svg'), mark('#ffffff', 'harbour pine'));
  writeFileSync(path.join(filesDir, 'Logos/harbour-dark.svg'), mark('#123f36', 'harbour pine'));
  writeFileSync(path.join(filesDir, 'Logos/red-white.svg'), mark('#ffffff', 'redline co'));
  writeFileSync(path.join(filesDir, 'Logos/teal-white.svg'), mark('#ffffff', 'tealwork'));
  writeFileSync(path.join(filesDir, 'Logos/teal-dark.svg'), mark('#0a4a40', 'tealwork'));
  writeFileSync(path.join(filesDir, 'Logos/wattle-dark.svg'), mark('#3a2f00', 'wattle and co'));
  writeFileSync(path.join(filesDir, 'Logos/wattle-white.svg'), mark('#ffffff', 'wattle and co'));
  writeFileSync(path.join(filesDir, 'Logos/ghost-dark.svg'), mark('#1a1a1a', 'ghost gums'));
  writeFileSync(
    path.join(filesDir, 'Photos/oven.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#eef1f3"/><rect x="90" y="40" width="140" height="90" rx="6" fill="#101820"/><rect x="102" y="54" width="116" height="44" fill="#0f6b5c"/><rect x="102" y="106" width="116" height="10" fill="#d6d9dc"/><rect x="60" y="140" width="200" height="12" rx="4" fill="#5a6067"/></svg>`,
  );
  server = createServer((req, res) => {
    const p = new URL(req.url ?? '/', 'http://x').pathname;
    const file = p.startsWith('/files/') ? path.join(filesDir, decodeURIComponent(p.slice('/files/'.length))) : path.join(work, decodeURIComponent(p.slice(1)));
    if (!file.startsWith(work) || !existsSync(file)) {
      res.writeHead(404);
      res.end('no');
      return;
    }
    res.writeHead(200, { 'content-type': file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  const port = await new Promise((resolve) => {
    const s = net.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${port}`;
  browser = await startBrowser();
});

after(async () => {
  browser?.close();
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

async function startBrowser() {
  const port = await new Promise((resolve) => {
    const s = net.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const child = spawn(SHELL, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const close = () => {
    try {
      child.kill('SIGKILL');
    } catch {}
  };
  try {
    let target;
    for (let i = 0; i < 100 && !target; i++) {
      await sleep(150);
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
      } catch {}
    }
    if (!target) throw new Error('the browser opened no page');
    const WebSocket = require('ws');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let id = 1;
    const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d);
        pending.delete(d.id);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const i = id++;
        pending.set(i, resolve);
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    const ev = async (expression) => {
      const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (d.result?.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(d.result.exceptionDetails.exception?.description ?? d.result.exceptionDetails).slice(0, 500)}`);
      return d.result?.result?.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    return {
      ev,
      send,
      close: () => {
        try {
          ws.close();
        } catch {}
        close();
      },
    };
  } catch (e) {
    close();
    throw e;
  }
}

// ── The invented kits and notes ──────────────────────────────────────────────────────────────────────────────────────

const KITS = {
  harbour: {
    kit: { name: 'Harbour Pine', logos: { onDark: 'Logos/harbour-white.svg', primary: 'Logos/harbour-dark.svg' }, colours: [{ name: 'Pine', hex: '#0F6B5C', use: 'Headings' }], fonts: [], footer: 'Confidential, internal use' },
    palette: { onDark: ['#ffffff'], primary: ['#123f36'] },
  },
  red: {
    kit: { name: 'Redline Co', logos: { onDark: 'Logos/red-white.svg' }, colours: [{ name: 'Brand', hex: '#B3261E', use: 'Brand' }], fonts: [] },
    palette: { onDark: ['#ffffff'] },
  },
  pale: {
    kit: { name: 'Wattle and Co', logos: { primary: 'Logos/wattle-dark.svg', onDark: 'Logos/wattle-white.svg' }, colours: [{ name: 'Wattle', hex: '#F2E14C' }], fonts: [] },
    palette: { primary: ['#3a2f00'], onDark: ['#ffffff'] },
  },
  ink: {
    kit: { name: 'Inkwell Studio', logos: {}, colours: [{ name: 'Ink', hex: '#14171A', use: 'Headings' }], fonts: [] },
    palette: {},
  },
  solo: {
    kit: { name: 'Solo Practice', logos: {}, colours: [{ name: 'Blue', hex: '#1D4E89' }], fonts: [] },
    palette: {},
  },
  ghost: {
    kit: { name: 'Ghost Gums', logos: { primary: 'Logos/ghost-dark.svg' }, colours: [{ name: 'Night', hex: '#14202B', use: 'Headings' }], fonts: [] },
    palette: { primary: ['#1a1a1a'] },
  },
  teal: {
    kit: { name: 'Tealwork Studio', logos: { onDark: 'Logos/teal-white.svg', primary: 'Logos/teal-dark.svg' }, colours: [{ name: 'Pine', hex: '#0F6B5C', use: 'Headings' }], fonts: [] },
    palette: { onDark: ['#ffffff'], primary: ['#0a4a40'] },
  },
  none: { kit: null, palette: {} },
};

const MEETING_TEXT = `---
date: 2026-03-03
time: 9:00 am
duration: 40 minutes
project: Riverside cafe and the Quay pop-up
attendees: [Ana Reyes, Sam Okafor, Jo Tran]
absent: Lee Park
also: Marco, Dana (GM)
confidential: true
figures:
  - { value: 20 Mar, label: Fit-out finishes }
  - { value: 2 Apr, label: Doors open }
  - { value: "Thu 5 Mar, 2 pm", label: Oven trial at the Quay }
  - { value: 45 min, label: Estimate for one oven install }
---

# Riverside Cafe Opening

## Summary

The fortnightly now runs from the shared tracker to cut status chasing. The main issue is getting the new ovens into both sites before fit-out finishes on 20 March. On Thursday Jo will run one live oven trial at the Quay to show how long an install really takes, and the schedule gets revised from that. What happens if the supplier is late was left open. Staff training is pencilled in for the last week of March.

## Action items

- [ ] Confirm with Marco and Dana that Jo can be on site next week — Jo · by Wed 4 Mar
- [ ] Live trial of one oven at the Quay, including the serial numbers and the warranty portal — Jo, Priya · by Thu 5 Mar, 2 pm
- [ ] Revise the install schedule from what the trial shows, so everyone can see it. It has to allow for the cafe’s opening hours and the delivery windows — Jo · after the trial
- [ ] Add a tracker task for the trial and set its date — Ana ⏰ 2026-03-06 09:00
- [ ] Check how the fire inspection was booked last year — Sam · before opening
- [ ] Agree the next step if the supplier misses 20 March. See "Still open" on the next page — Ana, Sam · after the trial

## Decisions and agreements

- **The tracker is the record.** Agenda changes and new tasks go in it, and the fortnightly walks through it.
- **Test first.** One live oven trial at the Quay on Thursday, then revise the schedule.
- **Inspection date is an indication.** It is fine as long as it is done before doors open.

## Still open

**What if the supplier misses 20 March?** Ana asked what the impact would be if only one site were ready. Sam recommended asking for a late-install exception. The group is waiting on the trial.

## Discussion

### Fire inspection

Sam said it is typically booked by facilities. Jo has not booked one before and believes Marco did last year's. It may be as simple as repeating last year's request.

### Ovens and the fit-out

The ovens have arrived and both installers are confirmed. Each site needs a visit, with serial numbers recorded and the swap made in the warranty portal.

![The new oven](Photos/oven.svg)

> [!note] About this record
> Prepared from the meeting recording. Please send any corrections to Jo.

## Transcript

> [!quote]- Transcript · 40 minutes
> **09:01** *Ana:* Let's start with the ovens.
`;

const REPORT_TEXT = `---
type: Report
project: Kiln output
date: 2026-04-02
figures:
  - { value: 96.4%, label: First-pass yield }
  - { value: 312, label: Trays fired }
---

# Kiln Output Review

A wide table of every firing, then the long log. Both must read whole on the page.

## Firings

| Batch | Clay | Glaze | Temp | Soak | Cooled | First pass | Seconds | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| K-101 | Stoneware | Ash blue | 1240 | 40 min | Slow | 94% | 12 | Pinholes on two trays near the door |
| K-102 | Stoneware | Ash blue | 1245 | 40 min | Slow | 96% | 8 | Clean |
| K-103 | Porcelain | Clear | 1280 | 25 min | Fast | 91% | 21 | Two cracked rims |

## Log

| Day | Batch | Yield | Notes |
| --- | --- | --- | --- |
${Array.from({ length: 60 }, (_, i) => `| ${1 + (i % 28)} Apr | K-${101 + i} | ${90 + (i % 9)}% | ${i % 3 === 0 ? 'Checked the door seals and the pyrometer against the spare before lighting' : i % 3 === 1 ? 'Steady firing, no incidents' : 'Light reduction in the last hour'} |`).join('\n')}

## Notes

- The door seals on kiln two are due for replacement before the winter firing.
- Order another bag of the ash blue glaze while the supplier has stock.
`;

const SHORT_TEXT = `Rain on the windows, and the roster done by lunch. Priya takes Friday, Sam takes Saturday, and the late shift finally has cover.`;

const para = (seed) => {
  const bits = [
    'The fortnightly now runs from the shared tracker to cut status chasing across both sites.',
    'Each visit records the serial numbers and makes the swap in the warranty portal before leaving.',
    'Staff training is pencilled in for the last week of March, once the trial dates are confirmed.',
    'The supplier confirmed the delivery windows in writing, with the late-install exception left open.',
    'Both installers are booked for the fit-out week, and the cafe manager has the run sheet.',
    'The schedule gets revised from what the trial shows, so everyone can see the new dates.',
  ];
  return Array.from({ length: 9 }, (_, i) => bits[(seed + i) % bits.length]).join(' ');
};
const LONG_TEXT = `---
type: Report
project: Season review
date: 2026-05-01
---

# Season Review

${Array.from({ length: 64 }, (_, s) => `## Week ${s + 1}\n\n${para(s)}\n\n${para(s + 2)}\n\n${para(s + 4)}\n\n${para(s + 1)}\n`).join('\n')}
## Oven log

| Week | Site | Installs | Notes |
| --- | --- | --- | --- |
${Array.from({ length: 120 }, (_, i) => `| ${1 + (i % 12)} | ${i % 2 ? 'Quay' : 'Riverside'} | ${1 + (i % 4)} | ${i % 2 ? 'Evening visit after close' : 'Morning visit before open'} |`).join('\n')}
`;

const NAMES_TEXT = `---
date: 2026-06-11
time: 2:00 pm
project: Harbour fete
attendees: [ليلى حسن, Zoë Müller, Ana Reyes]
absent: Seán O'Brien
---

# Harbour Fete Planning

## Summary

The fete committee agreed the stall map with ليلى حسن and Zoë Müller. Seán O'Brien sent apologies.

## Actions

- [ ] Book the riverside lawn with the council — ليلى حسن · by 18 Jun 2026
- [ ] Confirm the marquee hire and the power boards — Zoë Müller · by 19 Jun 2026

## Decisions

- **Stalls on the lawn.** Food on the north side, crafts on the south.
`;

const ODD_TITLE = 'Q3 <Review> & "Quotes" — don’t';
const ODD_TEXT = `---
type: Report
date: 2026-07-02
---

## Summary

A short quarter with long quotes: the mill, the joiner and the electrician all came back under budget.
`;

const GAP_TEXT = `---
date: 2026-03-03
time: 9:00 am
duration: 40 minutes
project: Riverside cafe and the Quay pop-up
attendees: [Ana Reyes, Sam Okafor, Jo Tran]
absent: Lee Park
also: Marco, Dana (GM)
confidential: true
figures:
  - { value: 20 Mar, label: Fit-out finishes }
  - { value: 2 Apr, label: Doors open }
  - { value: "Thu 5 Mar, 2 pm", label: Oven trial at the Quay }
  - { value: 45 min, label: Estimate for one oven install }
---

# Riverside Cafe Opening

## Summary

The fortnightly now runs from the shared tracker to cut status chasing. The main issue is getting the new ovens into both sites before fit-out finishes on 20 March. On Thursday Jo will run one live oven trial at the Quay to show how long an install really takes, and the schedule gets revised from that.

What happens if the supplier is late was left open. Staff training is pencilled in for the last week of March, once the trial dates are confirmed. Both installers are booked for the fit-out week, and the cafe manager has the run sheet. Each visit records the serial numbers and makes the swap in the warranty portal before leaving.

## Action items

- [ ] Confirm with Marco and Dana that Jo can be on site next week — Jo · by Wed 4 Mar
- [ ] Live trial of one oven at the Quay, including the serial numbers and the warranty portal — Jo, Priya · by Thu 5 Mar, 2 pm
- [ ] Revise the install schedule from what the trial shows, so everyone can see it — Jo · after the trial
- [ ] Add a tracker task for the trial and set its date — Ana · by Fri 6 Mar
- [ ] Check how the fire inspection was booked last year — Sam · before opening
- [ ] Agree the next step if the supplier misses 20 March — Ana, Sam · after the trial
- [ ] Book the training room for the last week of March — Ana · by Fri 13 Mar
- [ ] Order the spare baking trays for both sites — Sam · by Fri 13 Mar
- [ ] Confirm the late-install exception with the supplier — Jo · by Fri 13 Mar
- [ ] Send the revised schedule to both sites — Ana · after the trial
- [ ] Check the training roster covers the trial days — Sam · before opening
- [ ] Agree who opens the Quay on trial day — Jo, Ana · by Thu 12 Mar
- [ ] Walk the Quay floor with the installer before trial day — Jo · by Wed 11 Mar
- [ ] File the trial photos with the install report — Priya · by Fri 13 Mar

## Decisions and agreements

- **The tracker is the record.** Agenda changes and new tasks go in it, and the fortnightly walks through it.
- **Test first.** One live oven trial at the Quay on Thursday, then revise the schedule.
`;

const FOOT_FILL = 'The fortnightly now runs from the shared tracker to cut status chasing across both sites and the pop-up stall.';
const FOOT_LIST = ['Stalls on the lawn, food north and crafts south.', 'Gates open at nine with tickets at the door.', 'The marquee hire includes power boards and lighting.', 'First aid tent beside the main gate.', 'Pack down starts at five with all hands.', 'Lost property to the council office on Monday.'];
const FOOT_TEXT = `---
type: Report
date: 2026-08-04
---

# Fete Review

## Setup

${Array.from({ length: 28 }, () => FOOT_FILL).join('\n\n')}

## Decisions

${FOOT_LIST.map((l) => `- ${l}`).join('\n')}

## Next

Book the lawn again for spring and confirm the marquee dates early.
`;

const NOTES = {
  meeting: { title: 'Riverside Cafe Opening', text: MEETING_TEXT, path: 'Meetings/Riverside Cafe Opening.md', words: ['Riverside Cafe Opening', 'Confirm with Marco', 'Ana Reyes', 'Page 1 of'] },
  report: { title: 'Kiln Output Review', text: REPORT_TEXT, path: 'Notes/Kiln Output Review.md', words: ['Kiln Output Review', 'Pinholes on two trays', 'First-pass yield'] },
  short: { title: 'A thought', text: SHORT_TEXT, path: 'Notes/A thought.md', words: ['Rain on the windows'] },
  long: { title: 'Season Review', text: LONG_TEXT, path: 'Notes/Season Review.md', words: ['Season Review', 'Week 40', 'Oven log'] },
  names: { title: 'Harbour Fete Planning', text: NAMES_TEXT, path: 'Meetings/Harbour Fete Planning.md', words: ['Harbour Fete Planning', 'Müller', 'Seán'] },
  odd: { title: ODD_TITLE, text: ODD_TEXT, path: 'Notes/Q3 review.md', words: ['Review', 'Quotes'] },
  gap: { title: 'Riverside Cafe Opening', text: GAP_TEXT, path: 'Meetings/Riverside Cafe Opening.md', words: ['Riverside Cafe Opening', 'Confirm with Marco', 'spare receipt rolls'] },
  foot: { title: 'Fete Review', text: FOOT_TEXT, path: 'Notes/Fete Review.md', words: ['Fete Review', 'Stalls on the lawn', 'Pack down'] },
};

const CASES = [
  ['harbour', 'meeting'],
  ['red', 'meeting'],
  ['pale', 'meeting'],
  ['ink', 'meeting'],
  ['solo', 'meeting'],
  ['ghost', 'meeting'],
  ['none', 'meeting'],
  ['harbour', 'report'],
  ['pale', 'report'],
  ['harbour', 'short'],
  ['none', 'short'],
  ['harbour', 'long'],
  ['solo', 'long'],
  ['harbour', 'names'],
  ['ink', 'names'],
  ['red', 'odd'],
  ['none', 'odd'],
  // The right brand on the right document: the business area's teal kit on the same meeting (the work red and the
  // family none print above; the project override resolves to this teal, measured in brand-document.test.mjs).
  ['teal', 'meeting'],
];

// ── One case: lay out, measure, print, convert ─────────────────────────────────────────────────────────────────────────

const MEASURE = `(() => {
  const lum = (c) => {
    const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(c) || [0, 0, 0, 0];
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const pages = [...document.querySelectorAll('#pages > .page')];
  const out = { report: window.__report || null, pages: pages.length, numbers: [], bands: [], contrast: [], outside: [], underFooter: [], orphans: [], shells: [], tablesNoHead: [], wide: [], flowLeft: !!document.getElementById('flow') };
  // A split shell with nothing in it (a table without body rows, a list without items, a meta block without
  // rows): invisible, but it sits after a heading and hides that the heading is alone.
  const emptyShell = (sib) => {
    if (sib.tagName === 'TABLE') return sib.querySelectorAll('tbody tr').length === 0;
    if (sib.tagName === 'UL' || sib.tagName === 'OL') return sib.children.length === 0;
    if (sib.classList && sib.classList.contains('meta')) return sib.children.length === 0;
    const lists = [...sib.querySelectorAll('ul,ol')];
    if (lists.length && sib.children.length === 1 && lists[0] === sib.children[0]) return lists[0].children.length === 0;
    return false;
  };
  const followed = (col, ki) => [...col.children].slice(ki + 1).some((sib) => {
    if (emptyShell(sib)) return false;
    const r = sib.getBoundingClientRect();
    return r.height > 2 && r.width > 0.5 && (sib.innerText || '').trim().length > 0;
  });
  pages.forEach((pg, i) => {
    const pr = pg.getBoundingClientRect();
    const foot = pg.querySelector('.foot');
    const fr = foot.getBoundingClientRect();
    const mast = pg.querySelector('.mast');
    const slim = pg.querySelector('.slim');
    out.bands.push(mast ? 'mast' : slim ? 'slim' : 'none');
    const band = mast || slim;
    const words = band.querySelector('.k') || band.querySelector('.t');
    out.contrast.push(Math.round(ratio(getComputedStyle(words).color, getComputedStyle(band).backgroundColor) * 100) / 100);
    out.numbers.push(pg.querySelector('.pg').textContent);
    if (fr.bottom > pr.bottom + 1) out.underFooter.push('p' + (i + 1) + ': footer past the page');
    const col = pg.querySelector('.pcol');
    col.querySelectorAll('h1,h2,h3,h4,p,li,td,th,dd,figure,pre,aside,img,div.band>div').forEach((elm) => {
      const er = elm.getBoundingClientRect();
      if (er.width < 0.5 && er.height < 0.5) return;
      if (er.left < pr.left - 1 || er.right > pr.right + 1 || er.top < pr.top - 1 || er.bottom > pr.bottom + 1)
        out.outside.push('p' + (i + 1) + ' ' + elm.tagName.toLowerCase() + ' past the page box');
      if (er.bottom > fr.top + 1.5 && er.top < fr.bottom + 1)
        out.underFooter.push('p' + (i + 1) + ' ' + elm.tagName.toLowerCase() + ' under the footer');
    });
    const kids = col.children;
    // Every heading travels with the start of what follows it: on every page but the last, each heading
    // has visible content after it on the same page (an empty split shell after it does not count).
    [...kids].forEach((kid, ki) => {
      if (i < pages.length - 1 && /^(H1|H2|H3|H4)$/.test(kid.tagName) && !followed(col, ki))
        out.orphans.push('p' + (i + 1) + ' leaves ' + kid.tagName.toLowerCase() + ' “' + (kid.innerText || '').trim().slice(0, 40) + '” alone');
    });
    [...kids].forEach((kid) => {
      if (emptyShell(kid)) out.shells.push('p' + (i + 1) + ' keeps an empty ' + kid.tagName.toLowerCase());
    });
    col.querySelectorAll('table').forEach((t) => {
      if (!t.querySelector('thead')) out.tablesNoHead.push('p' + (i + 1) + ' table without its header');
      const tr = t.getBoundingClientRect();
      if (tr.left < pr.left - 1 || tr.right > pr.right + 1) out.wide.push('p' + (i + 1) + ' table past the page');
    });
  });
  return out;
})()`;

async function runCase(kitId, noteId) {
  const { kit, palette } = KITS[kitId];
  const note = NOTES[noteId];
  const html = B.brandDocument({ title: note.title, text: note.text, path: note.path, kit, url: (rel) => `${origin}/files/${rel.split('/').map(encodeURIComponent).join('/')}`, logoPalette: palette });
  const name = `${kitId}-${noteId}`;
  writeFileSync(path.join(work, `${name}.html`), html);
  const started = Date.now();
  await browser.send('Page.navigate', { url: `${origin}/${name}.html` });
  let report = null;
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    report = await browser.ev('window.__report || null').catch(() => null);
    if (report) break;
  }
  assert.ok(report, `${name}: the pages laid out`);
  const layoutMs = Date.now() - started;
  const m = await browser.ev(MEASURE);
  const dir = path.join(shots, kitId);
  mkdirSync(dir, { recursive: true });
  const pdf = await browser.send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, generateDocumentOutline: true });
  assert.ok(!pdf.error, `${name}: printed (${pdf.error?.message ?? ''})`);
  const bytes = Buffer.from(pdf.result.data, 'base64');
  const pdfFile = path.join(dir, `${noteId}.pdf`);
  writeFileSync(pdfFile, bytes);
  return { name, m, layoutMs, pdfFile, pages: m.pages };
}

const pdfInfo = (file) => {
  const r = spawnSync('pdfinfo', [file], { encoding: 'utf8' });
  assert.equal(r.status, 0, `pdfinfo reads ${file}`);
  return r.stdout;
};
const pdfText = (file) => {
  const r = spawnSync('pdftotext', [file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `pdftotext reads ${file}`);
  return r.stdout;
};
const toJpegs = (file, prefix, first, last) => {
  const args = ['-jpeg', '-r', '110'];
  if (first !== undefined) args.push('-f', String(first), '-l', String(last));
  args.push(file, prefix);
  const r = spawnSync('pdftoppm', args, { encoding: 'utf8' });
  assert.equal(r.status, 0, `pdftoppm converts ${file}`);
};

for (const [kitId, noteId] of CASES) {
  test(`measured: ${kitId} ${noteId} lays out true, reads at 4.5 to 1, prints real pages`, async () => {
    const { name, m, layoutMs, pdfFile, pages } = await runCase(kitId, noteId);
    assert.equal(m.report.pages, pages, `${name}: the layout counted its pages`);
    assert.deepEqual(m.report.cut, [], `${name}: nothing kept whole past a page`);
    assert.equal(m.flowLeft, false, `${name}: the flow is gone, only pages print`);
    assert.equal(m.bands[0], 'mast', `${name}: page one has the 38mm band`);
    assert.ok(m.bands.slice(1).every((b) => b === 'slim'), `${name}: later pages have the slim band`);
    m.numbers.forEach((n, i) => assert.equal(n, `Page ${i + 1} of ${pages}`, `${name}: page numbers are true`));
    assert.deepEqual(m.outside, [], `${name}: no text outside its page box`);
    assert.deepEqual(m.underFooter, [], `${name}: nothing under the footer`);
    assert.deepEqual(m.orphans, [], `${name}: no heading left alone at a page foot`);
    assert.deepEqual(m.shells, [], `${name}: no split shell left empty`);
    assert.deepEqual(m.tablesNoHead, [], `${name}: every table keeps its dark header`);
    assert.deepEqual(m.wide, [], `${name}: every table fits the page`);
    m.contrast.forEach((c, i) => assert.ok(c >= 4.5, `${name}: page ${i + 1} band reads at 4.5 to 1 (${c})`));
    if (noteId === 'short') assert.equal(pages, 1, `${name}: one paragraph makes one page`);
    if (noteId === 'long') {
      assert.ok(pages >= 40 && pages <= 90, `${name}: a sixty-page note stays whole (${pages} pages)`);
      assert.ok(layoutMs < 60000, `${name}: and stays fast (${Math.round(layoutMs / 1000)}s to lay out)`);
    }
    if (noteId === 'report') assert.ok(m.report.split > 0, `${name}: the long table split across pages`);
    const info = pdfInfo(pdfFile);
    assert.ok(new RegExp(`Pages:\\s+${pages}\\b`).test(info), `${name}: the PDF has its ${pages} pages`);
    const text = pdfText(pdfFile);
    const flat = text.replace(/\s+/g, ' ');
    for (const w of NOTES[noteId].words) assert.ok(flat.includes(w), `${name}: the PDF reads "${w}"`);
    assert.ok(/Title:\s+\S/.test(info), `${name}: the PDF has a title`);
    assert.ok(readFileSync(pdfFile).includes(Buffer.from('/Outlines')), `${name}: the PDF has an outline`);
    const dir = path.join(shots, kitId);
    if (noteId === 'long') {
      // Sixty pages would bury the kit folders: the first three, two from the middle, the last two (the PDF is whole).
      const mid = Math.floor(pages / 2);
      toJpegs(pdfFile, path.join(dir, `${noteId}-a`), 1, Math.min(3, pages));
      toJpegs(pdfFile, path.join(dir, `${noteId}-b`), mid, mid + 1);
      toJpegs(pdfFile, path.join(dir, `${noteId}-c`), Math.max(1, pages - 1), pages);
    } else {
      toJpegs(pdfFile, path.join(dir, noteId));
    }
  });
}

test('p5 a heading falling in the last 40 mm of a page travels with the start of what follows it', async () => {
  // 5 Nov 2026, the real app: "Decisions" and its rule sat at the bottom of page one with its list on page
  // two. The list's split left its empty shell on page one after the heading, so the page script's guard —
  // which moves a heading left last — never saw it. Here Decisions falls 6 mm from the foot of page one.
  const { name, m } = await runCase('harbour', 'foot');
  assert.deepEqual(m.orphans, [], `${name}: no heading left alone at a page foot`);
  assert.deepEqual(m.shells, [], `${name}: no split shell left empty`);
  assert.equal(m.pages, 2, `${name}: the break falls at Decisions`);
  const where = await browser.ev(`[...document.querySelectorAll('#pages > .page')].map((pg) => {
    const heads = [...pg.querySelectorAll('h2')].map((h) => h.innerText.trim());
    const items = [...pg.querySelectorAll('li')].map((li) => li.innerText.trim().slice(0, 24));
    const kids = [...pg.querySelector('.pcol').children];
    return { heads, items, tail: kids[kids.length - 1].tagName };
  })`);
  const on = where.findIndex((p) => p.heads.includes('Decisions'));
  assert.ok(on >= 0, `${name}: Decisions is laid out`);
  assert.ok(where[on].items.some((t) => t.startsWith('Stalls on the lawn')), `${name}: Decisions shares its page with the start of its list`);
  assert.equal(where[0].tail, 'P', `${name}: page one ends with a paragraph, not a heading or an empty shell`);
});

test('p4 a table starts where it falls and splits with its header repeated, never leaving a large gap', async () => {
  // 5 Nov 2026, the real app: the whole Actions table moved to page two and left a third of page one blank.
  const { name, m } = await runCase('harbour', 'gap');
  assert.ok(m.report.split > 0, `${name}: the table split across pages`);
  const rowsPerPage = await browser.ev(`[...document.querySelectorAll('#pages > .page')].map((pg) => pg.querySelectorAll('table.actions tbody tr').length)`);
  assert.ok(rowsPerPage[0] > 0, `${name}: it starts on page one, not moved whole (${rowsPerPage.join('/')})`);
  assert.ok(rowsPerPage.slice(1).some((n) => n > 0), `${name}: and continues past it (${rowsPerPage.join('/')})`);
  const heads = await browser.ev(`[...document.querySelectorAll('#pages > .page')].map((pg) => pg.querySelectorAll('table.actions').length && !!pg.querySelector('table.actions thead'))`);
  assert.ok(heads.every((h, i) => rowsPerPage[i] === 0 || h === true), `${name}: every part keeps its header`);
});
