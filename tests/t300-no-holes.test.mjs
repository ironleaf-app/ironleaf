// node --test tests/t300-no-holes.test.mjs — the Vault wastes no space, on any page, in any state (t300,
// 18 Nov 2026, with a real window at 3456x1408). t254 widened the column and paired sections two-across;
// pairing by itself makes holes wherever two paired sections differ in height or one is empty, so the fix
// is in the shared pairing mechanism, not one page:
// - two sections share a row only when both hold real content and their heights are close (the pairing
//   gate in lib/pairing.ts, watched live: grid while close, one flow when not, reading order never moves);
// - an empty section folds to one quiet line with its add action and never holds a half-page slot;
// - the meeting always reads main plus prep side at wide windows (round 2: "always that
//   shape from about 1600px"): agenda, Recording, minutes and the rest in the main column, prep a 400px
//   side that never pushes Record off the first screen (t301 owns MeetingMinutes.tsx's insides and what
//   the prep list picks; the grid and placement are here, and the prep caps whole items behind Show all
//   until it fits the main or one window height, capped by count never cut); below 1600px the page
//   stacks agenda, Recording, minutes, then prep.
// The live walk below renders every room and meeting state at 3456x1408, 1920x1080 and 1366x768 on the
// big made-up vault (t200's 3,000 notes) plus owner-shaped meetings (long titles, long prep, long minutes
// and transcripts shaped like real minutes, made-up words throughout, the fixture itself
// never committed) and finds blank rectangles inside the content area (between the side bar and the
// window's right edge, below the head, above the last content): no blank rectangle larger than 25% of the
// content area's width by 30% of its height may sit between or beside content. Chrome never counts as
// blank: the page gutters (t254 sanctions them, the gutter walk judges them) and the in-page folder
// rail's column (navigation, as the excluded side bar is). Rooms whose design is a narrow column keep
// it instead and are swept for their own contract: a note keeps t254's reading width, Settings its 880
// form (each control by its words), More opens its menu (pictured, its pages judged apart). Each check
// fails without its rule: on today's tree the meeting page stands an empty agenda beside a window-tall
// prep with the recording and the minutes bar at the foot. Before and after PNGs for every room at
// 3456x1408 go in ../shots/ (this walk writes them; the run before the fix was copied to -before,
// the run after to -after).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';
import { writeT200Vault } from './t200-vault.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const exists = (p) => {
  try {
    readFileSync(path.join(root, p));
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotsDir = path.join(root, '..', 'shots');
mkdirSync(shotsDir, { recursive: true });

// ── Static: the shared mechanism ─────────────────────────────────────────────

test('the pairing gate starts with the app', () => {
  assert.ok(exists('src/renderer/src/lib/pairing.ts'), 'lib/pairing.ts holds the one gate');
  const gate = read('src/renderer/src/lib/pairing.ts');
  assert.ok(gate.includes('startPairing'), 'the gate starts through startPairing');
  assert.ok(gate.includes('__nvPairing'), 'its decisions read back for the walk, as the graph’s do');
  const main = read('src/renderer/src/main.tsx');
  assert.ok(main.includes('pairing'), 'main.tsx wires the gate');
  assert.ok(main.includes('startPairing'), 'main.tsx starts it');
});

test('stack, quiet and minutes layouts ride in the shared sheet', () => {
  const css = read('src/renderer/src/styles/t300-no-holes.css');
  for (const sel of ['.p87-body[data-pair="stack"]', '.w3b-page[data-pair="stack"]', "div[aria-label='Waiting to be filed'][data-pair=\"stack\"]", '.w2b-meeting[data-pair="stack"]', '.td-else-groups[data-pair="stack"]']) {
    assert.ok(css.includes(sel), `mismatched heights flow instead of pairing (${sel})`);
  }
  assert.ok(css.includes('.w2b-meeting[data-layout="meeting-main"]'), 'the meeting always reads main plus prep side at wide windows');
  assert.ok(css.includes('min-width: 1600px'), 'the side shape lands from about 1600px');
  assert.ok(css.includes('.w2b-prep-person[data-hide="1"]'), 'whole prep blocks fold behind Show all, capped by count not cut');
  assert.ok(css.includes('.w2b-prep > .srcrow[data-hide="1"]'), 'whole prep sources fold behind Show all');
  assert.ok(read('src/renderer/src/main.tsx').includes('t300-no-holes.css'), 'main.tsx loads the sheet');
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  const agendaAt = page.indexOf('title="Agenda"');
  const recAt = page.indexOf('aria-label="Recording"', agendaAt);
  const mmAt = page.indexOf('MeetingMinutesHere', recAt);
  const prepAt = page.indexOf('PrepPackCard', mmAt);
  assert.ok(agendaAt > 0 && recAt > agendaAt && mmAt > recAt && prepAt > mmAt, 'BeforeMeeting stacks agenda, Recording, minutes, then prep');
});

test('no :has() and no !important in the new sheet', () => {
  const css = read('src/renderer/src/styles/t300-no-holes.css');
  assert.ok(!/:has\(/.test(css), 'no :has() in the new rules');
  assert.ok(!/!important/.test(css), 'no !important in the new rules');
});

// ── The room as a whole (20 Nov 2026, on a ~2000 px monitor). The gate judged holes between paired sections
// only; the blank under
// a short list and a dead band beside a narrow column went unjudged. The same gate now judges the room too, at
// the same threshold style (a quarter of the width, three tenths of the height), and the answer to a short
// list is a detail beside it, never a longer row.

test('an empty section folds to one quiet line: data-quiet has its consumer', () => {
  const css = read('src/renderer/src/styles/t300-no-holes.css');
  for (const sel of ['.pj-ov > [data-quiet="1"]', '.pp-ov > [data-quiet="1"]', '.p87-body > [data-quiet="1"]', '.w3b-page > [data-quiet="1"]']) {
    assert.ok(css.includes(sel), `quiet sections fold (${sel})`);
  }
  assert.match(css, /\[data-quiet="1"\] \{[^}]*display: flex;[^}]*min-height: 0;/s, 'a quiet section reads as one line and holds no height of its own');
  const gate = read('src/renderer/src/lib/pairing.ts');
  assert.ok(gate.includes('getComputedStyle(el).order'), 'the gate simulates the grid in its own order, so the fold keeps the simulation exact');
});

test('one width system: reading, content, full, with a side column; rows never stretch to the window', () => {
  const frame = read('src/renderer/src/styles/page-frame.css');
  for (const v of ['--w-reading: 720px', '--w-content: 1160px', '--w-full: 100%', '--w-side: 360px', '--w-wide: 1900px']) assert.ok(frame.includes(v), `the frame names ${v}`);
  assert.ok(frame.includes('--page-max: calc(var(--w-content) + 2 * var(--page-pad-side))'), 'the rooms\u2019 column is the content width');
  for (const sp of ['--space-1: 4px', '--space-2: 8px', '--space-3: 12px', '--space-4: 16px', '--space-5: 24px', '--space-6: 36px', '--space-7: 64px']) assert.ok(frame.includes(sp), `one spacing scale (${sp})`);
  const shell = read('src/renderer/src/styles/polish-shell.css');
  assert.ok(!/--page-max:\s*(1280|2400)px/.test(shell), 'no wide-window rule stretches the column (rows of 2,176 px)');
  // A wide window adds a column: list and detail, centred.
  assert.ok(frame.includes('.nv-split') && frame.includes('@container frame (min-width: 1480px)'), 'list and detail side by side when the frame has the room');
  const ld = read('src/renderer/src/components/ListDetail.tsx');
  assert.ok(ld.includes('export function ListDetail') && ld.includes('export function RecordDetail'), 'one list-and-detail shape');
  for (const f of ['src/renderer/src/views/PeoplePage.tsx', 'src/renderer/src/views/ProjectsHome.tsx', 'src/renderer/src/views/TasksView.tsx', 'src/renderer/src/views/NotesPage.tsx', 'src/renderer/src/views/modules/work/MeetingsPage.tsx']) {
    assert.ok(read(f).includes('<ListDetail'), `${f} lays its list beside its detail`);
  }
});

// ── Layout round 2 (20 Nov 2026, on a real vault after round 1 passed this gate). The gate measured holes between
// paired sections on a five-note sample; on their vault Today stood every section in one column beside a column
// holding one heading, the assets filters ran two full rows of chips and the brand kit's fields stretched 500 px
// apart. The rules now: composed not centred (one left edge, the room's width), columns balanced by content,
// controls sized to their words, one row of chips, and inner padding on every container. The live walks below judge
// them on the t200 vault.

test('composition: one left edge, balanced columns, controls capped, one row of chips, inner padding', () => {
  const css = read('src/renderer/src/styles/compose.css');
  assert.ok(read('src/renderer/src/main.tsx').includes("import './styles/compose.css';"), 'main.tsx loads the composition sheet');
  assert.ok(/--page-max: 100%;/.test(css) && /margin-left: 0;/.test(css), 'every frame starts at one left edge and takes the room');
  assert.ok(css.includes('--w-field: 420px'), 'a text field is capped at 420 px');
  assert.ok(/\.w4b-fstrip-chips \{[^}]*flex-wrap: nowrap;/s.test(css), 'the filter chips keep to one row');
  for (const v of ['--pad-card: var(--space-5)', '--pad-row-x: var(--space-4)', '--pad-row-y: var(--space-3)']) assert.ok(css.includes(v), `inner padding from the scale (${v})`);
  const bal = read('src/renderer/src/components/Balance.tsx');
  assert.ok(bal.includes('export function Balance') && bal.includes('a <= b ? '), 'one balancing mechanism: each movable section to the shorter column, measured');
  const today = read('src/renderer/src/views/TodayView.tsx');
  assert.ok(today.includes('<Balance') && today.includes('data-column="work"') && today.includes('data-column="day"'), 'Today reads the work beside the day');
  assert.ok(today.includes('tasks with no date') && !/<More items=\{unscheduled\}/.test(today), 'the undated work is one count row, never a list of rows');
  const assets = read('src/renderer/src/views/AssetsPage.tsx');
  assert.ok(assets.includes('label="Area"') && assets.includes('label="Collection"') && assets.includes('label="Tag"'), 'areas, collections and tags are dropdowns');
  const kit = read('src/renderer/src/views/assets/BrandKit.tsx');
  assert.ok(kit.includes('as-brand-zones') && kit.indexOf('as-brand-preview') < kit.indexOf('as-brand-identity') && kit.indexOf('as-brand-identity') < kit.indexOf('as-brand-side'), 'the brand kit reads preview, identity, then logos and use');
});

test('the meeting after: minutes in the main column, recording and the note beside them', () => {
  const page = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  const after = page.slice(page.indexOf('function AfterMeeting'));
  const main = after.indexOf('w2b-after-main');
  const side = after.indexOf('w2b-after-side');
  assert.ok(main > 0 && side > main, 'main then side');
  assert.ok(after.indexOf('MeetingMinutesHere') > main && after.indexOf('MeetingMinutesHere') < side, 'the minutes read in the main column');
  assert.ok(after.indexOf('MeetingRecorder') > side, 'the recording (and Record again) sit in the side column');
  const css = read('src/renderer/src/styles/w2b.css');
  assert.match(css, /\.w2b-after \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) clamp\(var\(--w-side\), 34%, 560px\);/, 'two columns when the frame has the room');
});

// ── Layout round 3 (20 Nov 2026, at 3440x1400, Ironleaf maximised: two rounds still left the bottom half
// to two-thirds of the window blank). Pages built like documents ended where their content ended; an app on a
// big monitor is panes that fill the window and scroll inside themselves. The rules: list and detail as
// full-height panes (a third pane for connections from 2200 px of frame), the meeting page in regions (minutes |
// recording and transcript | words to check and connections), Today in three columns, the project's overview
// blocks whole with panes under them, a note's column fluid with prose at a measure and structured lines at the
// column's width, and no text under the body step to cram a column. Judged live at 3440x1400 and 1920x1080 below.

test('round 3: panes that fill the window, regions on the meeting page, three columns on Today', () => {
  const main = read('src/renderer/src/main.tsx');
  assert.ok(main.indexOf("import './styles/panes.css';") > main.indexOf("import './styles/compose.css';"), 'the panes sheet loads last');
  const css = read('src/renderer/src/styles/panes.css');
  assert.ok(/:is\(\.vscroll, \.nv-page-scroll[^)]*\):has\(\.nv-panes-root\) \{[^}]*overflow: hidden;/s.test(css), 'a page with panes does not scroll as a document');
  assert.ok(/\.nv-split\.is-panes > \.nv-pane \{[^}]*overflow: auto;/s.test(css), 'each pane scrolls inside itself');
  assert.ok(/\.nv-split\.nv-split\.is-panes\.is-three \{[^}]*grid-template-columns: clamp\(/s.test(css), 'list | detail | context, fluid');
  assert.ok(/\.w2b-after\.mt-regions\.nv-panes-root\.is-three \{[^}]*grid-template-columns:/s.test(css), 'the meeting page in three regions');
  assert.ok(/\.nv-bal\.is-two\.is-three \{/.test(css), 'Today in three columns');
  const ld = read('src/renderer/src/components/ListDetail.tsx');
  assert.ok(ld.includes('export const THREE_PANES = 2200') && ld.includes('createPortal(') && ld.includes('<ReadingView'), 'the third pane takes the connections; the detail reads the note itself');
  const meet = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(!meet.includes('w2b-stats'), 'Meetings: no band of stat tiles (the counts ride on the chips)');
  assert.ok(meet.includes('mt-regions') && meet.includes('<TranscriptOpen.Provider value={true}>'), 'the meeting page: regions, the transcript open in its own pane');
  assert.ok(read('src/renderer/src/views/MeetingMinutes.tsx').includes('createPortal(<section className="mm mm-aside"'), 'the words to check stand in the far-right region');
  assert.ok(read('src/renderer/src/components/Balance.tsx').includes('min3'), 'Balance takes a third column');
  assert.ok(read('src/renderer/src/views/TodayView.tsx').includes('min3={2200}'), 'Today asks for it');
  for (const f of ['src/renderer/src/views/InboxPage.tsx', 'src/renderer/src/views/TemplatesPage.tsx', 'src/renderer/src/views/BookmarksPage.tsx']) assert.ok(read(f).includes('<ListDetail'), `${f} reads as list and detail`);
  assert.ok(read('src/renderer/src/editor/live-preview.ts').includes("'cm-nv-list-line'"), 'list lines are marked, so they may run wider than the prose');
  assert.ok(/--note-measure: clamp\(/.test(css) && /--note-wide: clamp\(/.test(css), 'the note: a fluid column and a fluid measure');
});

// ── The realistic meetings (relative days, so the phases never rot) ───────
// Made-up people and projects throughout, shaped like their minutes from today: a long title, an empty
// agenda, a long prep from open work, a recording set-up, the minutes being made, then done with a long
// transcript. t200's Alex Chen and Priya Nair carry open steps and the Harbourline project carries open
// work, so prep reads tall the way a real one did.

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

const HARBOURLINE = 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md';
// A 13-minute transcript in the recorder's own shape: timestamped lines in a folded quote.
function transcript(n, seed) {
  const who = ['*You:*', '*Speaker 1:*', '*Speaker 1:*', '*Others:*'];
  const words = [
    'Morning all, let us start with the cart and the retry.',
    'The retry still fails on Friday afternoons when the shop is busy.',
    'Priya sent the receipt mock late last night with the tax line fixed.',
    'The Saturday soak test ran twenty orders in a row with no drops.',
    'ShadeCo can fit the awning the week after next if we pay the deposit now.',
    'The October invoices match the bank feed except the power bill.',
    'Sam will ask the weekend crew about cover for the last three Fridays.',
    'The back room rewiring starts Monday so the stock intake moves a week.',
    'The till PC gets its spare laptop set up before the December rush.',
    'We will send the receipt v2 for review once the totals are double-checked.',
  ];
  const lines = [];
  let s = seed;
  const rnd = (m) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % m;
  };
  for (let i = 0; i < n; i++) {
    const at = Math.floor((i * 13 * 60) / n);
    lines.push(`> **${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}** ${who[rnd(who.length)]} ${words[rnd(words.length)]}`);
    if (i % 3 === 2) lines.push('>');
  }
  return `## Transcript\n\nRecording: [[Recording – Walkthrough 2026-11-18 14.28.m4a]] · 13 minutes\n\n> [!quote]- Transcript · 13 minutes\n${lines.join('\n')}\n`;
}
// The minutes in the note's own shape: summary, decisions, actions with owners, questions, figures and
// the discussion by topic (## Discussion is what the minutes card reads as made).
const MINUTES = `## Summary

Alex Chen walked Priya Nair through the Harbour proposal, covering the overview, costs and room-by-room detail. The 2026 scope quoted by ShadeCo at about twelve hundred dollars was reviewed against the maintenance budget, including whether the fitting costs sat with the shop or the landlord. The roster could not be cut where Friday nights already ran short-handed, so those nights would be covered by the weekend crew, while two very small back-room jobs could wait for the January refit. Alex Chen agreed to update the quote the same day so the slides for the following day could be adjusted.

## Decisions

- The Friday openings will not be cut but will be covered by the weekend crew until the roster lands.
- The two small back-room jobs will wait for the January refit without a second quote.

## Questions

- ? Whether ShadeCo will hold the fitted price past Friday — asked by Priya Nair — for Alex Chen — answer: Likely, yes

## Actions

- [ ] Ask June about the power bill gap before the bookkeeper visit — Priya Nair
- [ ] Make the quote adjustments and send them through — Alex Chen
- [ ] Adjust the slides for tomorrow's walkthrough — Priya Nair

## Key figures

- 1200: Dollars fitted for the awning before December
- 20: Orders in a row on the Saturday soak test

## Discussion

> [!quote]- Proposal overview
> Alex Chen shared a quote in three parts covering the overview, costs and room-by-room detail.
>
> The 2026 plan covered several rooms, with no budget for next year and a further plan in 2028.

> [!quote]- Costs and fitting
> The ShadeCo quotation of about twelve hundred dollars was reviewed against the maintenance budget.
>
> The fitting covered the side screen, the wind sensor and the December start.

> [!quote]- Friday nights
> The Friday nights already ran short-handed with no further cover proposed.
>
> The nights could not be cut and had to be covered by the weekend crew.

> [!quote]- Small back-room jobs
> Two very small back-room jobs held at most a day each with no parts on hand.
>
> They would wait for the January refit without a second quote.

> [!quote]- Room designs
> The main designs were the wall mount and the counter till where a cabinet made the wall mount unsuitable.
>
> The back room running on the old wiring was not included pending June's numbers, to be addressed in 2029.

`;

function writeT300Meetings(dir) {
  const w = (rel, text) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const head = (date, where = 'Teams') => `---\ntype: meeting\ndate: ${date}\ntime: "2:30 PM"\nattendees: [Alex Chen, Priya Nair]\nproject: ${HARBOURLINE}\nwhere: ${where}\n---\n`;
  // M1: today, no agenda, lots of prep, a transcript, minutes not made (their first picture).
  w(
    'Meetings/Quick Walkthrough of Harbour Lighting Proposal with Tessaly.md',
    `${head(day(0))}# ${day(0)} Quick Walkthrough of Harbour Lighting Proposal with Tessaly\n\n## Agenda\n\n## Notes\n\n\n${transcript(24, 11)}`,
  );
  // M2: today, no agenda, lots of prep, minutes done with a long transcript (their second picture).
  w(
    'Meetings/Harbour Lighting Proposal Review with Tessaly and the Programme Team.md',
    `${head(day(0))}# ${day(0)} Harbour Lighting Proposal Review with Tessaly and the Programme Team\n\n## Agenda\n\n## Notes\n\n\n${MINUTES}${transcript(90, 23)}`,
  );
  // M3: yesterday, minutes done with a long transcript (the after state, with its recording).
  w(
    'Meetings/Cart Retry Sign-off with Alex and Priya before Friday.md',
    `${head(day(-1))}# ${day(-1)} Cart Retry Sign-off with Alex and Priya before Friday\n\n## Agenda\n\n- [ ] The retry fix and whether it is ready for Friday\n- [ ] The receipt review and who sends it\n\n## Notes\n\n\n${MINUTES}${transcript(90, 47)}`,
  );
  // M4: tomorrow, an agenda, no prep at all (nobody coming holds anything open).
  w(
    'Meetings/Roster Cover Check with Jordan Ellis for December.md',
    `---\ntype: meeting\ndate: ${day(1)}\ntime: "10:00 AM"\nattendees: [Jordan Ellis]\nwhere: The shop\n---\n# ${day(1)} Roster Cover Check with Jordan Ellis for December\n\n## Agenda\n\n- [ ] Friday cover for the first two weeks\n- [ ] Who holds the spare till key\n- [ ] Catering dates to confirm\n\n## Notes\n\n\n`,
  );
  // M5: today, minutes done, a short real prep (two open jobs, the shape t301 shortens every prep
  // to): the minutes take the main column beside it. Sam Carter holds nothing else, so M4's nobody
  // still holds nothing.
  w('People/Sam Carter.md', `---\ntype: person\nrole: Weekend manager at the museum\n---\n# Sam Carter\n\nWeekend manager at the museum. Covers the December late nights.\n`);
  w('Notes/December roster notes.md', `# December roster notes\n\nCover for the late nights.\n\n- [ ] Ask the weekend crew about cover for the first Friday night — Sam Carter — due ${day(2)}\n- [ ] Confirm the spare till key handover with the shop — Sam Carter — due ${day(3)}\n`);
  w(
    'Meetings/December Roster Cover Check with Sam Carter at the Shop.md',
    `---\ntype: meeting\ndate: ${day(0)}\ntime: "9:30 AM"\nattendees: [Sam Carter]\nwhere: The shop\n---\n# ${day(0)} December Roster Cover Check with Sam Carter at the Shop\n\n## Agenda\n\n- [ ] Friday cover for the first two weeks\n- [ ] Who holds the spare till key\n\n## Notes\n\n\n${MINUTES}${transcript(24, 71)}`,
  );
}

// ── Live: one boot, the big vault plus the realistic meetings ─────────────

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: Object.fromEntries(['finance', 'documents', 'business', 'systems', 'publications', 'goals', 'family', 'health', 'house', 'vehicles', 'career', 'travel', 'meetings', 'lists', 'memories'].map((id) => [id, { on: true }])) } }]);
    const count = writeT200Vault(H.vaultDir);
    assert.equal(count, 3000, 'the walk judges a 3,000-note vault');
    writeT300Meetings(H.vaultDir);
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
  if ((await clickWords(h, name, '.sidebar.left, aside')) === 'CLICKED') return;
  const label = name === 'Graph' ? 'Open the graph' : name === 'Templates' ? 'Open the Templates page' : name === 'Assets' ? 'Open your assets' : name;
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 4000))) {
    assert.equal(await clickWords(h, 'Ask or find anything', '.topbar'), 'CLICKED', 'the palette opens from the top bar');
    assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`), 'the palette input shows');
  }
  await h.browser.send('Input.insertText', { text: name });
  const found = await waitFor(h, `[...document.querySelectorAll('.picker-row')].some((r) => (r.querySelector('.picker-label')?.innerText.trim() ?? '') === ${JSON.stringify(label)})`, 8000);
  assert.ok(found, `${name} answers in the palette`);
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const text = (r, sel) => r.querySelector(sel)?.innerText.trim() ?? '';
    const row = rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(label)} && text(r, '.picker-detail') === 'Pack')
      ?? rows.find((r) => text(r, '.picker-label') === ${JSON.stringify(label)});
    if (!row) return 'NOTFOUND';
    row.click();
    return 'CLICKED';
  })()`);
  assert.equal(picked, 'CLICKED', `${name} opens from the palette`);
  await sleep(600);
}
async function openMeeting(h, title, chip) {
  await openRoom(h, 'Meetings');
  assert.ok(await waitFor(h, `!!document.querySelector('.w2b-meetings, .w2b-meeting')`), 'Meetings answers');
  if (await h.browser.ev(`!!document.querySelector('.w2b-meeting')`)) {
    const back = await h.browser.ev(`(() => {
      const b = [...document.querySelectorAll('button[aria-label="Back"]')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && !e.disabled; });
      if (!b) return false;
      b.click();
      return true;
    })()`);
    assert.equal(back, true, 'Back from the meeting to the list');
    assert.ok(await waitFor(h, `!!document.querySelector('.w2b-meetings')`, 8000), 'the list is back');
  }
  assert.equal(await clickWords(h, chip, 'main'), 'CLICKED', `the ${chip} chip answers`);
  await sleep(800);
  assert.ok(await waitFor(h, `(document.querySelector('.w2b-meetings')?.innerText || '').includes(${JSON.stringify(title)})`, 8000), `${title} lists under ${chip}`);
  assert.equal(await clickWords(h, title, 'main'), 'CLICKED', `${title} opens`);
  assert.ok(await waitFor(h, `!!document.querySelector('.w2b-meeting')`, 8000), 'the meeting page lands');
  await sleep(1500);
}
// Page-side stand-in for the minutes ask that never answers until cancelled (meeting-minutes-runs'
// stuck mode): the walk judges the Making state mid-run, then stops it.
async function stuckMinutes(h) {
  await h.browser.ev(`(() => {
    if (window.__minutesWrapped) { window.__minutesMode = 'stuck'; return 'ready'; }
    window.__minutesMode = 'stuck';
    window.__minutesPending = [];
    const real = window.nv.recorder;
    const stub = new Proxy(real, {
      get: (t, p) => {
        if (p === 'minutes') return () => new Promise((res) => window.__minutesPending.push(res));
        if (p === 'cancel') return async () => { const r = window.__minutesPending.shift(); if (r) r({ minutes: null, error: 'Stopped.' }); };
        return t[p];
      },
    });
    window.nv = new Proxy(window.nv, { get: (t, p) => (p === 'recorder' ? stub : t[p]) });
    window.__minutesWrapped = true;
    return 'ready';
  })()`);
}

// The content area's largest blank rectangle, measured not eyeballed: the page scrolled to its top,
// every painted thing marked on a 16px grid (each text line's own boxes, as t254's card walk does,
// plus every card, control, tile and media box), then the largest all-blank sub-rectangle by the
// histogram pass. Dialogs, menus, toasts and tours are never room content. Fixed chrome never counts.
const BLANK_JS = `(() => {
  const main = document.querySelector('main');
  if (!main) return { error: 'no main' };
  main.scrollTop = 0;
  const m = main.getBoundingClientRect();
  const skip = (el) => !el || (el.closest && el.closest('[role="dialog"], .overlay, .menu, [role="menu"], .picker, .toast, [data-tour], script, style, noscript, template'));
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') return null;
    return r;
  };
  // A leaf panel only: wrappers that hold sections (the tab group's full-page white section)
  // never count as painted cover, or every page reads covered. Cards inside a panel are the panel's
  // own content, not wrappers.
  const leaf = (el) => !el.querySelector('section');
  const painted = (cs) => {
    const bg = cs.backgroundColor.replace(/\\s+/g, '');
    const paints = bg !== 'transparent' && bg !== 'rgba(0,0,0,0)' && (bg.indexOf('rgb(') === 0 || (bg.indexOf('rgba(') === 0 && parseFloat(bg.split(',').pop()) > 0));
    const boxes = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    return paints || boxes;
  };
  // Below the head: the body starts at the first body block (heads hold no sections, cards, rows or
  // tables of their own); a page with none (an empty state under its title) starts under the title.
  let top = null;
  for (const el of main.querySelectorAll('section, .card, .gcard, table, .trow, .srcrow')) {
    if (skip(el) || el.closest('[data-tour]')) continue;
    if ((el.tagName === 'SECTION' || el.classList.contains('card') || el.classList.contains('gcard') || el.tagName === 'TABLE') && !leaf(el)) continue;
    const r = vis(el);
    if (!r) continue;
    if (top === null || r.top < top) top = r.top;
  }
  if (top === null) {
    const h1 = main.querySelector('h1');
    top = h1 && vis(h1) ? vis(h1).bottom : m.top;
  }
  top = Math.round(top);
  const left = Math.round(m.left), right = Math.round(m.right);
  const CELL = 16;
  const cols = Math.max(1, Math.ceil((right - left) / CELL));
  // Covered rows first (text lines and painted boxes in area coords), so the area's foot is the last
  // content, never the window's foot.
  const covered = [];
  // A pane that scrolls inside itself (a list's detail, 20 Nov 2026) shows only its own box: what overflows it
  // is out of sight, never cover painted below it.
  const clips = [...main.querySelectorAll('.nv-split-side-inner')].map((e) => e.getBoundingClientRect()).filter((c) => c.width > 2 && c.height > 2);
  // Round 2: a list's detail is sticky and travels with the scroll, so the column under it is the detail's, never
  // a hole (the frame now takes the room, so no gutter sanctions it any more).
  // Round 3: panes and regions that fill the window and scroll inside themselves show only their own box (what
  // overflows is out of sight, never cover below the window), and a pane is the app's own region, never a hole: the
  // round-3 walk judges what fills it.
  const panes = [...main.querySelectorAll('.nv-split.is-panes > .nv-pane, .mt-regions.nv-panes-root > *, .pj-ov-more > *')].map((e) => e.getBoundingClientRect()).filter((c) => c.width > 2 && c.height > 2);
  clips.push(...panes);
  const stickies = [...main.querySelectorAll('.nv-split:not(.is-short) > .nv-split-side')].map((e) => [e.getBoundingClientRect(), e.parentElement.getBoundingClientRect()]).filter(([r]) => r.width > 2);
  const push = (x0, y0, x1, y1, raw = false) => {
    for (const c of raw ? [] : clips) {
      if (x0 >= c.left - 1 && x1 <= c.right + 1 && y1 > c.bottom) {
        if (y0 >= c.bottom) return;
        y1 = c.bottom;
      }
    }
    x0 = Math.max(0, Math.floor((x0 - left) / CELL)); y0 = Math.max(0, Math.floor((y0 - top) / CELL));
    x1 = Math.min(cols - 1, Math.floor((x1 - left) / CELL)); y1 = Math.floor((y1 - top) / CELL);
    if (x1 < x0 || y1 < y0) return;
    covered.push([x0, y0, x1, y1]);
  };
  for (const r of panes) push(r.left, r.top, r.right, r.bottom, true);
  const range = document.createRange();
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let node;
  let guard = 0;
  while ((node = walker.nextNode())) {
    if (++guard > 60000) break;
    if (!node.nodeValue || !node.nodeValue.trim()) continue;
    const parent = node.parentElement;
    if (!parent || skip(parent)) continue;
    const pr = parent.getBoundingClientRect();
    if (pr.width < 2 || pr.height < 2) continue;
    const cs = getComputedStyle(parent);
    if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue;
    try {
      range.selectNode(node);
      for (const r of range.getClientRects()) {
        if (r.width >= 2 && r.height >= 2) push(r.left, r.top, r.right, r.bottom);
      }
    } catch {}
  }
  // Controls read as content at their own small extents.
  for (const el of main.querySelectorAll('button, input, textarea, select, img, canvas, video, .pill, .tag, .gtile, .miniava, .tile, .switch, .check')) {
    if (skip(el)) continue;
    const r = vis(el);
    if (!r) continue;
    push(r.left, r.top, r.right, r.bottom);
  }
  // Panels only when they are leaf panels that paint or draw a box (Today's blocks, the minutes
  // card, stat tiles with their borders). Bare sections (the agenda's list on the page) and
  // transparent boxes (the prep answer) stay judged, as wrappers do. A spread row (its name at one
  // edge, its facts at the other, as t254's card walk reads it) counts at its full row width, but
  // only at line scale: a paired layout is pages tall, never 80px, so no hole hides in a row band.
  // Reading prose reads as one unit to its content's own foot (the meeting summary at its capped
  // width, as the note's reading column does): never past it, so a stretched empty box still judges
  // the void under its line.
  const proseFree = (el) => !el.querySelector('button, input, select, textarea, table, canvas, img, video, .cm-content');
  const contentFoot = (el, top) => {
    let foot = top;
    for (const child of el.children) {
      const cr = vis(child);
      if (cr) foot = Math.max(foot, cr.top + cr.height);
    }
    try {
      range.selectNodeContents(el);
      for (const lr of range.getClientRects()) {
        if (lr.width >= 2 && lr.height >= 2) foot = Math.max(foot, lr.bottom);
      }
    } catch {}
    return foot;
  };
  for (const el of main.querySelectorAll('section, div, table, li, .trow, .srcrow')) {
    if (skip(el)) continue;
    const r = vis(el);
    if (!r) continue;
    const cs = getComputedStyle(el);
    const d = cs.display;
    if ((d.includes('flex') && cs.flexDirection !== 'column') || d.includes('grid')) {
      if (r.height <= 80) push(r.left, r.top, r.right, r.bottom);
      continue;
    }
    if (!leaf(el)) continue;
    if (el.tagName === 'SECTION' && proseFree(el)) {
      push(r.left, r.top, r.right, contentFoot(el, r.top));
      continue;
    }
    if (!painted(cs)) continue;
    push(r.left, r.top, r.right, r.bottom);
  }
  for (const [r, p] of stickies) push(r.left, r.top, r.right, p.bottom, true);
  let maxRow = 0;
  for (const c of covered) if (c[3] > maxRow) maxRow = c[3];
  const rows = maxRow + 1;
  if (!covered.length || rows <= 0) return { error: 'no content', areaW: right - left };
  const grid = new Uint8Array(cols * rows);
  grid.fill(1);
  for (const [x0, y0, x1, y1] of covered) {
    for (let y = y0; y <= y1 && y < rows; y++) for (let x = x0; x <= x1; x++) grid[y * cols + x] = 0;
  }
  // Chrome never counts as blank: the page gutters outside the column (t254 sanctions them and the
  // gutter walk judges them) and the in-page folder rail's own column (navigation, as the side bar
  // the brief excludes is). The hole rule judges content voids, never chrome strips. Clamped to the
  // content's own foot, so chrome never stretches the area.
  {
    const chrome = [];
    const box = main.querySelector('.nv-page, .vpage.wide, .td-inner, .tk-inner, .tp-inner, .pv-inner, .nv-page-frame, .settings-page');
    const br = box && !skip(box) ? vis(box) : null;
    if (br) {
      chrome.push([left, br.left], [br.right, right]);
    }
    const rail = main.querySelector('.w2b-folders');
    const rr = rail && !skip(rail) ? vis(rail) : null;
    if (rr) chrome.push([rr.left, rr.right]);
    for (const [cx0, cx1] of chrome) {
      const x0 = Math.max(0, Math.floor((cx0 - left) / CELL)), x1 = Math.min(cols - 1, Math.floor((cx1 - left) / CELL));
      for (let y = 0; y < rows; y++) for (let x = x0; x <= x1; x++) grid[y * cols + x] = 0;
    }
  }
  // A list's detail beside it (20 Nov 2026, components/ListDetail.tsx): the pane is sticky and travels with the
  // list as it scrolls, so its column under the pane's foot is the pane's own (as the prep side's is). Side
  // panes only (under half the content's width); a short list's detail reads under it and judges whole.
  for (const side of main.querySelectorAll('.nv-split-side')) {
    const sr = !skip(side) ? vis(side) : null;
    if (!sr || sr.width >= (right - left) * 0.5 || getComputedStyle(side).position !== 'sticky') continue;
    const x0 = Math.max(0, Math.floor((sr.left - left) / CELL)), x1 = Math.min(cols - 1, Math.floor((sr.right - left) / CELL));
    for (let y = Math.max(0, Math.floor((sr.top - top) / CELL)); y < rows; y++) for (let x = x0; x <= x1; x++) grid[y * cols + x] = 0;
  }
  // Today's side column at a wide window (20 Nov 2026: the day's meetings beside its work, under two fifths
  // of the content's width): a short side beside a longer day leaves its own column empty below it by design, as
  // the meeting's prep side does.
  {
    const sides = [...main.querySelectorAll('.td-inner.tklist > [data-section="meetings"]')].map((e) => (!skip(e) ? vis(e) : null)).filter(Boolean);
    const firstX = sides.length ? Math.min(...sides.map((r) => r.left)) : 0;
    if (sides.length && sides.every((r) => r.width < (right - left) * 0.4 && Math.abs(r.left - firstX) < 4) && firstX > left + (right - left) * 0.4) {
      const lo = Math.min(...sides.map((r) => r.left)), hi = Math.max(...sides.map((r) => r.right)), foot = Math.max(...sides.map((r) => r.bottom));
      const x0 = Math.max(0, Math.floor((lo - left) / CELL)), x1 = Math.min(cols - 1, Math.floor((hi - left) / CELL));
      for (let y = Math.max(0, Math.floor((foot - top) / CELL)); y < rows; y++) for (let x = x0; x <= x1; x++) grid[y * cols + x] = 0;
    }
  }
  // The meeting's designed prep side (t300 round 2): a short side panel beside a tall main leaves its
  // own column empty below it by design, not waste (the shape: main plus a capped 400px
  // side). That strip never counts as a hole; a hole inside the main, or a prep taller than the main
  // leaving the main's width empty, still judges as before. Side panels only (under two fifths of the
  // content's width): a stacked full-width prep judges whole.
  {
    const prep = main.querySelector('section[aria-label="Prep, from your notes"]');
    const pr = prep && !skip(prep) ? vis(prep) : null;
    if (pr && pr.width < (right - left) * 0.4) {
      const x0 = Math.max(0, Math.floor((pr.left - left) / CELL)), x1 = Math.min(cols - 1, Math.floor((pr.right - left) / CELL));
      const y0 = Math.floor((pr.bottom - top) / CELL);
      for (let y = Math.max(0, y0); y < rows; y++) for (let x = x0; x <= x1; x++) grid[y * cols + x] = 0;
    }
  }
  // Largest all-blank sub-rectangle: skyline histograms, one pass a row. A wide short strip can
  // beat a tall hole by area, so the walk also asks exactly: does any blank rectangle stand wider
  // than a quarter of the content and taller than three tenths of it (a 120px floor: a quiet line's
  // own beside-space is line-scale, never a hole)?
  const heights = new Int32Array(cols);
  const needW = Math.ceil(cols * 0.25), needH = Math.ceil(Math.max(rows * 0.3, 120 / CELL));
  let best = { w: 0, h: 0, x: 0, y: 0 };
  let holds = false;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) heights[x] = grid[y * cols + x] ? heights[x] + 1 : 0;
    const stack = [];
    for (let x = 0; x <= cols; x++) {
      const h = x < cols ? heights[x] : 0;
      let start = x;
      while (stack.length && stack[stack.length - 1][0] > h) {
        const [hh, xx] = stack.pop();
        const w = x - xx;
        if (w * hh > best.w * best.h) best = { w, h: hh, x: xx, y: y - hh + 1 };
        if (w >= needW && hh >= needH) holds = true;
        start = xx;
      }
      stack.push([h, start]);
    }
  }
  // The widest blank and the tallest blank are reported too: the largest by area can hide a
  // half-page-wide strip that is the hole pictured.
  let wide = { w: 0, h: 0 }, tall = { w: 0, h: 0 };
  heights.fill(0);
  for (let y = 0; y < rows; y++) {
    let run = 0;
    for (let x = 0; x < cols; x++) {
      run = grid[y * cols + x] ? run + 1 : 0;
      if (run > wide.w) wide = { w: run, h: 1 };
    }
  }
  for (let x = 0; x < cols; x++) {
    let run = 0;
    for (let y = 0; y < rows; y++) {
      run = grid[y * cols + x] ? run + 1 : 0;
      if (run * 1 > tall.h * Math.max(1, tall.w)) tall = { w: 1, h: run };
    }
  }
  return {
    areaW: right - left, areaH: rows * CELL,
    blankW: best.w * CELL, blankH: best.h * CELL, blankX: best.x * CELL, blankY: best.y * CELL,
    wideW: wide.w * CELL, tallH: tall.h * CELL, holds,
  };
})()`;

// A blank fails when some blank rectangle stands wider than a quarter of the content AND taller
// than three tenths of it: the hole beside a tall prep. A quiet line's own beside-space is
// line-scale (a 120px floor), never a hole, and the brief's own quiet-line rule judges it instead.
function blankFails(m) {
  if (m.error) return `no measure (${m.error})`;
  if (!m.holds) return null;
  return `blank ${m.blankW}x${m.blankH}px at (${m.blankX},${m.blankY}) in ${m.areaW}x${m.areaH}px (a quarter wide and three tenths tall stands empty)`;
}

async function shot(h, id, w, hh) {
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 2, mobile: false });
  await sleep(700);
  const res = await h.browser.send('Page.captureScreenshot', { format: 'png' });
  if (res.result?.data) writeFileSync(path.join(shotsDir, `t300-${id}-${w}x${hh}.png`), Buffer.from(res.result.data, 'base64'));
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
}

// Each sweep below keeps walking past a failure (soft asserts): the before run still pictures every
// room, and the report names every hole, not just the first.
// Transient UI (a menu, the palette, a dialog) never pollutes a measure: dismissed before every one.
async function calm(h) {
  for (let i = 0; i < 3; i++) {
    const open = await h.browser.ev(`(() => {
      const els = [...document.querySelectorAll('.menu, [role="menu"], .picker, [role="dialog"], .overlay')];
      return els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }).length;
    })()`);
    if (!open) return;
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(400);
  }
}
async function settleMeeting(h) {
  await waitFor(h, `!!document.querySelector('.w2b-meeting') && !document.querySelector('.w2b-meeting .view-loading')`, 15000);
  // The minutes card renders nothing until the note's words arrive (MeetingMinutesHere returns null
  // while loading, no .view-loading to wait on), so the walks give it a moment; a meeting with no
  // transcript (M4) never grows one, and the walks below allow its absence.
  await waitFor(h, `!!document.querySelector('.w2b-meeting section.mm')`, 5000);
  await sleep(1000);
}
async function pairingModes(h) {
  return h.browser.ev(`(() => {
    const hook = window.__nvPairing;
    if (!hook) return { error: 'the pairing hook is missing' };
    const meeting = document.querySelector('.w2b-meeting');
    return {
      pass: hook.pass,
      meeting: meeting ? { pair: meeting.getAttribute('data-pair'), layout: meeting.getAttribute('data-layout'), quiet: meeting.querySelectorAll('section[data-quiet="1"]').length } : null,
      containers: (hook.containers || []).map((c) => ({ sel: c.sel, mode: c.mode, kids: c.kids, quiet: c.quiet })),
    };
  })()`);
}

const M1 = 'Quick Walkthrough of Harbour Lighting Proposal with Tessaly';
const M2 = 'Harbour Lighting Proposal Review with Tessaly and the Programme Team';
const M3 = 'Cart Retry Sign-off with Alex and Priya before Friday';
const M4 = 'Roster Cover Check with Jordan Ellis for December';
const M5 = 'December Roster Cover Check with Sam Carter at the Shop';

// The meeting's wide shape, measured: main plus 400px prep side, Record on the first screen,
// prep capped whole behind Show all, never cut.
const SHAPE_JS = `(() => {
  const main = document.querySelector('main');
  if (main) main.scrollTop = 0;
  const q = (sel) => document.querySelector(sel);
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return b.width > 2 && b.height > 2 ? { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) } : null;
  };
  const meeting = q('.w2b-meeting');
  const prep = q('section[aria-label="Prep, from your notes"]');
  const agenda = q('section[aria-label="Agenda"]');
  const rec = q('section[aria-label="Recording"]');
  const mm = q('section.mm');
  const prepR = r(prep), agendaR = r(agenda), recR = r(rec), mmR = r(mm);
  const mainTop = Math.min(agendaR?.top ?? Infinity, recR?.top ?? Infinity, mmR?.top ?? Infinity);
  const mainBottom = Math.max(agendaR?.bottom ?? -Infinity, recR?.bottom ?? -Infinity, mmR?.bottom ?? -Infinity);
  const recBtn = [...(rec?.querySelectorAll('button') ?? [])].find((b) => (b.innerText || '').includes('Record') && b.getBoundingClientRect().width > 2);
  const btnR = recBtn?.getBoundingClientRect();
  return {
    layout: meeting?.getAttribute('data-layout') ?? null,
    pair: meeting?.getAttribute('data-pair') ?? null,
    prepW: prepR?.w ?? null, prepH: prepR?.h ?? null,
    mainH: mainBottom > mainTop ? mainBottom - mainTop : null,
    agendaTop: agendaR?.top ?? null, recTop: recR?.top ?? null, mmTop: mmR?.top ?? null, prepTop: prepR?.top ?? null,
    recordBtnTop: btnR ? Math.round(btnR.top) : null, recordBtnBottom: btnR ? Math.round(btnR.bottom) : null,
    viewportH: window.innerHeight, viewportW: window.innerWidth,
    hidden: prep?.querySelectorAll('[data-hide="1"]').length ?? 0,
    persons: prep?.querySelectorAll('.w2b-prep-person').length ?? 0,
    lines: prep?.querySelectorAll('.w2b-prep-line').length ?? 0,
    prepText: (prep?.innerText || '').slice(0, 2000),
    pageW: meeting ? Math.round(meeting.getBoundingClientRect().width) : null,
  };
})()`;
async function meetingShape(h) {
  return h.browser.ev(SHAPE_JS);
}
// The wide shape holds: side 400px, prep within the main or one window, Record on screen, whole
// items behind Show all never cut with an ellipsis.
function shapeFails(id, s) {
  if (s.layout !== 'meeting-main') return `the meeting is not main plus side (layout=${s.layout}, pair=${s.pair})`;
  if (s.prepW === null) return 'no prep section beside the main';
  if (!(s.prepW >= 360 && s.prepW <= 470)) return `the prep side is not about 400px (stood ${s.prepW}px)`;
  if (s.prepH !== null && s.mainH !== null) {
    const limit = Math.min(Math.max(280, s.mainH), s.viewportH) + 60;
    if (s.prepH > limit) return `the prep runs past the main (stood ${s.prepH}px, main ${s.mainH}px, window ${s.viewportH}px)`;
  }
  if (s.recordBtnTop === null) return 'no Record button with the meeting';
  if (!(s.recordBtnBottom <= s.viewportH)) return `Record sits off the first screen (stood ${s.recordBtnTop}px down in ${s.viewportH}px)`;
  if (s.prepText.includes('…')) return 'a prep item is cut with an ellipsis instead of folding whole behind Show all';
  return null;
}

test('the meeting page holds no half-page hole in any state', { timeout: 600000 }, async () => {
  const h = await harness();
  const bad = [];
  const fail = (id, e) => bad.push(`${id}: ${e instanceof Error ? e.message : e}`);
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  // No agenda, lots of prep, recording set up, minutes not made: their first picture. Always main
  // plus prep side now: the prep never runs full width, Record never leaves the first screen.
  try {
    await openMeeting(h, M1, 'Upcoming');
    await settleMeeting(h);
    await calm(h);
    const agenda = await h.browser.ev(`(document.querySelector('section[aria-label="Agenda"]')?.innerText || '').replace(/\\s+/g, ' ')`);
    if (!agenda.includes('No agenda yet')) fail('no-agenda', `the empty agenda reads wrong (${agenda.slice(0, 120)})`);
    const s = await meetingShape(h);
    if (s.lines < 6) fail('no-agenda', `the prep is not long like a real one (stood ${s.lines} lines)`);
    const modes = await pairingModes(h);
    if (modes.error) fail('no-agenda', modes.error);
    else if (!modes.meeting.quiet) fail('no-agenda', 'the empty agenda holds a slot instead of folding');
    const sf = shapeFails('no-agenda', s);
    if (sf) fail('no-agenda', sf);
    const m = await h.browser.ev(BLANK_JS);
    const f = blankFails(m);
    if (f) fail('no-agenda', f);
    await shot(h, 'meeting-no-agenda', 3456, 1408);
  } catch (e) { fail('no-agenda', e); }
  // Making the minutes: mid-run, the progress sits with the content in the main column, Record
  // still on screen beside the capped prep.
  try {
    await stuckMinutes(h);
    assert.equal(await clickWords(h, 'Make the minutes', '.mm'), 'CLICKED', 'the run starts');
    assert.ok(await waitFor(h, `(document.querySelector('.mm')?.innerText || '').includes('Making the minutes')`, 8000), 'the progress shows');
    await sleep(800);
    const s = await meetingShape(h);
    const sf = shapeFails('making-minutes', s);
    if (sf) fail('making-minutes', sf);
    const m = await h.browser.ev(BLANK_JS);
    const f = blankFails(m);
    if (f) fail('making-minutes', f);
    await shot(h, 'meeting-making-minutes', 3456, 1408);
    for (const [w, hh] of [[1920, 1080], [1366, 768]]) {
      await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false });
      await sleep(800);
      await calm(h);
      const ms = await h.browser.ev(BLANK_JS);
      const mf = blankFails(ms);
      if (mf) fail(`making-minutes-${w}x${hh}`, mf);
      await shot(h, 'meeting-making-minutes', w, hh);
    }
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    assert.equal(await clickWords(h, 'Stop', '.mm'), 'CLICKED', 'the run stops');
    await waitFor(h, `!!document.querySelector('.mm-error')`, 8000);
  } catch (e) { fail('making-minutes', e); }
  // Minutes done with a long transcript and their real-shaped prep: their second picture. The
  // minutes take the main column, prep a capped side, the recording with the meeting near the top.
  try {
    await openMeeting(h, M2, 'Upcoming');
    await settleMeeting(h);
    await calm(h);
    const words = await h.browser.ev(`(document.querySelector('.w2b-meeting')?.innerText || '')`);
    if (!words.includes('Minutes made')) fail('minutes-prep', 'the minutes do not read as made');
    const s = await meetingShape(h);
    const sf = shapeFails('minutes-prep', s);
    if (sf) fail('minutes-prep', sf);
    if (s.mmTop === null) fail('minutes-prep', 'no minutes card in the main column');
    else if (!(s.mmTop < 1000)) fail('minutes-prep', `the minutes start below the fold (stood ${s.mmTop}px down)`);
    const m = await h.browser.ev(BLANK_JS);
    const f = blankFails(m);
    if (f) fail('minutes-prep', f);
    await shot(h, 'meeting-minutes-prep', 3456, 1408);
  } catch (e) { fail('minutes-prep', e); }
  // Minutes done with a short real prep: the minutes take the main column, the prep a quiet side
  // panel, the recording with the meeting near the top.
  try {
    await openMeeting(h, M5, 'Upcoming');
    await settleMeeting(h);
    await calm(h);
    const words = await h.browser.ev(`(document.querySelector('.w2b-meeting')?.innerText || '')`);
    if (!words.includes('Minutes made')) fail('minutes-main', 'the minutes do not read as made');
    const s = await meetingShape(h);
    const sf = shapeFails('minutes-main', s);
    if (sf) fail('minutes-main', sf);
    if (s.mmTop === null) fail('minutes-main', 'no minutes card beside the prep');
    else if (!(s.mmTop < 1000)) fail('minutes-main', `the minutes start below the fold (stood ${s.mmTop}px down)`);
    const m = await h.browser.ev(BLANK_JS);
    const f = blankFails(m);
    if (f) fail('minutes-main', f);
    await shot(h, 'meeting-minutes-main', 3456, 1408);
  } catch (e) { fail('minutes-main', e); }
  // After, with its recording and done minutes: the recording sits with the meeting, not alone,
  // pairing or stacking on the simulation's own merits (t273's summary beside its note card).
  try {
    await openMeeting(h, M3, 'Past');
    await settleMeeting(h);
    await calm(h);
    const words = await h.browser.ev(`(document.querySelector('.w2b-meeting')?.innerText || '')`);
    if (!words.includes('Minutes made')) fail('after', 'the minutes do not read as made');
    const modes = await pairingModes(h);
    if (modes.error) fail('after', modes.error);
    else if (modes.meeting?.layout) fail('after', `the after page takes a minutes column it has no prep for (layout=${modes.meeting?.layout})`);
    const m = await h.browser.ev(BLANK_JS);
    const f = blankFails(m);
    if (f) fail('after', f);
    await shot(h, 'meeting-after', 3456, 1408);
  } catch (e) { fail('after', e); }
  // An agenda and no prep at all: the prep folds to its quiet line in the side.
  try {
    await openMeeting(h, M4, 'Upcoming');
    await settleMeeting(h);
    await calm(h);
    const prep = await h.browser.ev(`(document.querySelector('section[aria-label="Prep, from your notes"]')?.innerText || '').replace(/\\s+/g, ' ')`);
    if (!/Nothing open|clear run/i.test(prep)) fail('no-prep', `the empty prep reads wrong (${prep.slice(0, 120)})`);
    const s = await meetingShape(h);
    const sf = shapeFails('no-prep', s);
    if (sf) fail('no-prep', sf);
    const m = await h.browser.ev(BLANK_JS);
    const f = blankFails(m);
    if (f) fail('no-prep', f);
    await shot(h, 'meeting-no-prep', 3456, 1408);
  } catch (e) { fail('no-prep', e); }
  // The wide shape at 1920, stacked in order at 1366: judged, not just pictured.
  for (const [w, hh] of [[1920, 1080], [1366, 768]]) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    for (const [id, title, chip] of [['no-agenda', M1, 'Upcoming'], ['minutes-prep', M2, 'Upcoming'], ['no-prep', M4, 'Upcoming']]) {
      try {
        await openMeeting(h, title, chip);
        await settleMeeting(h);
        await calm(h);
        const s = await meetingShape(h);
        if (w >= 1600) {
          const sf = shapeFails(`${id}-${w}x${hh}`, s);
          if (sf) fail(`${id}-${w}x${hh}`, sf);
        } else {
          if (s.layout) fail(`${id}-${w}x${hh}`, `the narrow page takes a side layout it has no room for (layout=${s.layout})`);
          const tops = [s.agendaTop, s.recTop, s.mmTop, s.prepTop];
          // The minutes card stays null with no transcript to make them from (MeetingMinutes hides it;
          // M4 has no transcript), so the narrow stack is agenda, Recording, then prep when minutes are
          // absent, and agenda, Recording, minutes, prep when present.
          if (s.mmTop === null) {
            if ([s.agendaTop, s.recTop, s.prepTop].some((t) => t === null)) fail(`${id}-${w}x${hh}`, 'a meeting section is missing in the stack');
            else if (!(s.agendaTop < s.recTop && s.recTop < s.prepTop)) {
              fail(`${id}-${w}x${hh}`, `the stack reads out of order (agenda ${s.agendaTop}, recording ${s.recTop}, prep ${s.prepTop})`);
            }
          } else if (tops.some((t) => t === null)) fail(`${id}-${w}x${hh}`, 'a meeting section is missing in the stack');
          else if (!(tops[0] < tops[1] && tops[1] < tops[2] && tops[2] < tops[3])) {
            fail(`${id}-${w}x${hh}`, `the stack reads out of order (agenda ${tops[0]}, recording ${tops[1]}, minutes ${tops[2]}, prep ${tops[3]})`);
          }
        }
        const m = await h.browser.ev(BLANK_JS);
        const f = blankFails(m);
        if (f) fail(`${id}-${w}x${hh}`, f);
        await shot(h, `meeting-${id}`, w, hh);
      } catch (e) { fail(`meeting-${id}-${w}x${hh}`, e); }
    }
  }
  assert.deepEqual(bad, [], `the meeting page holds holes:\n${bad.join('\n')}`);
});

// Every room at 3456 wide, pictured.
async function sweepRoom(h, id, open) {
  await open();
  await sleep(900);
  await waitFor(h, `!document.querySelector('main .view-loading')`, 8000);
  await sleep(600);
  await calm(h);
  const m = await h.browser.ev(BLANK_JS);
  const f = blankFails(m);
  await shot(h, id, 3456, 1408);
  return f ? `${id}: ${f}` : null;
}

test('every room holds no half-page hole at 3456x1408', { timeout: 600000 }, async () => {
  const h = await harness();
  const bad = [];
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 3456, height: 1408, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const rooms = [
    ['today', () => openRoom(h, 'Today')],
    ['inbox', () => openRoom(h, 'Inbox')],
    ['projects', () => openRoom(h, 'Projects')],
    ['project', async () => { await openRoom(h, 'Projects'); assert.equal(await clickWords(h, 'Harbourline Cart Fix', 'main'), 'CLICKED', 'the project opens'); await sleep(1200); }],
    ['tasks', () => openRoom(h, 'Tasks')],
    ['meetings', () => openRoom(h, 'Meetings')],
    ['notes', () => openRoom(h, 'Notes')],
    ['people', () => openRoom(h, 'People')],
    ['money', () => openRoom(h, 'Money')],
    ['health', () => openRoom(h, 'Health')],
    ['goals', () => openRoom(h, 'Goals')],
    ['business', () => openRoom(h, 'Business')],
    ['systems', () => openRoom(h, 'Systems')],
  ];
  for (const [id, open] of rooms) {
    try {
      const f = await sweepRoom(h, id, open);
      if (f) bad.push(f);
    } catch (e) { bad.push(`${id}: ${e instanceof Error ? e.message : e}`); }
  }
  // More opens the packs menu, not a room: pictured as the person sees it, its pages judged above.
  try {
    await openRoom(h, 'Today');
    await sleep(600);
    await calm(h);
    assert.equal(await clickWords(h, 'More', '.sidebar.left, aside'), 'CLICKED', 'More answers');
    await sleep(600);
    const menu = await h.browser.ev(`[...document.querySelectorAll('.menu, [role="menu"]')].some((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; })`);
    await shot(h, 'more', 3456, 1408);
    await calm(h);
    if (!menu) bad.push('more: no menu opens');
  } catch (e) { bad.push(`more: ${e instanceof Error ? e.message : e}`); }
  // Settings keeps its form width by design (t254 pins the 880 body: each control by its words), so
  // the hole rule's full-width area never applied: the form's own width and no sideways scroll.
  try {
    await openRoom(h, 'Settings');
    await sleep(900);
    await calm(h);
    const st = await h.browser.ev(`(() => {
      const b = document.querySelector('.settings-page .settings-body');
      const r = b?.getBoundingClientRect();
      const card = document.querySelector('.settings-page .settings-card');
      const cols = card ? parseInt(getComputedStyle(card).columnCount, 10) || 1 : 1;
      return { w: r ? Math.round(r.width) : null, cols, x: document.documentElement.scrollWidth > window.innerWidth + 1 };
    })()`);
    await shot(h, 'settings', 3456, 1408);
    // 20 Nov 2026: past 2200 px the frame takes --w-wide and a group of plain rows reads in two columns, so the
    // body may be wide, but no row runs the body's width: each column stays a form's width.
    if (st.w === null) bad.push('settings: no settings body');
    else if (st.w > 960 && st.cols < 2) bad.push(`settings: the form outgrew its design width in one column (stood ${st.w})`);
    else if (st.w / Math.max(1, st.cols) > 1240) bad.push(`settings: each column outgrew a form's width (stood ${st.w} in ${st.cols})`);
    if (st.x) bad.push('settings: sideways scroll');
  } catch (e) { bad.push(`settings: ${e instanceof Error ? e.message : e}`); }
  // A person: cards in the rooms' column, so the hole rule holds here too.
  try {
    await openRoom(h, 'People');
    await sleep(900);
    assert.equal(await clickWords(h, 'Alex Chen', 'main'), 'CLICKED', 'the person opens');
    await sleep(1500);
    await calm(h);
    const m = await h.browser.ev(BLANK_JS);
    const f = blankFails(m);
    await shot(h, 'person', 3456, 1408);
    if (f) bad.push(`person: ${f}`);
  } catch (e) { bad.push(`person: ${e instanceof Error ? e.message : e}`); }
  // A note keeps its reading width by design (t254 pins it), so the hole rule's full-width area
  // never applied: swept for sideways scroll and clipping instead, as vault-three-sizes sweeps it.
  try {
    await openRoom(h, 'Notes');
    await sleep(900);
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
    assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens for the note');
    await h.browser.send('Input.insertText', { text: 'Kickoff note 1 with decisions' });
    await sleep(900);
    assert.equal(await h.browser.ev(`(() => { const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes('Kickoff note 1')); if (!row) return 'NOTFOUND'; row.click(); return 'CLICKED'; })()`), 'CLICKED', 'the note opens');
    assert.ok(await waitFor(h, `!!document.querySelector('.nv-note-main')`, 20000), 'the note lands');
    await calm(h);
    const note = await h.browser.ev(`(() => {
      const r = document.querySelector('.nv-note-main')?.getBoundingClientRect();
      const line = [...document.querySelectorAll('.nv-note-main .cm-content > .cm-line:not(.cm-nv-list-line)')].find((e) => e.textContent.trim().length > 20);
      const cs = line ? getComputedStyle(line) : null;
      const prose = line ? Math.round(line.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) : 0;
      return { w: r ? Math.round(r.width) : null, prose, x: document.documentElement.scrollWidth > window.innerWidth + 1 };
    })()`);
    await shot(h, 'note', 3456, 1408);
    if (note.w === null) bad.push('note: no note column');
    // Round 3: the column grows with the room (structured lines take it); the prose keeps a measure.
    else if (note.prose > 1120) bad.push(`note: the prose outgrew its measure (stood ${note.prose})`);
    if (note.x) bad.push('note: sideways scroll');
  } catch (e) { bad.push(`note: ${e instanceof Error ? e.message : e}`); }
  assert.deepEqual(bad, [], `rooms hold holes at 3456x1408:\n${bad.join('\n')}`);
});

test('every room holds no half-page hole at 1920x1080 and 1366x768', { timeout: 600000 }, async () => {
  const h = await harness();
  const bad = [];
  for (const [w, hh] of [[1920, 1080], [1366, 768]]) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    const rooms = [
      ['today', () => openRoom(h, 'Today')],
      ['inbox', () => openRoom(h, 'Inbox')],
      ['projects', () => openRoom(h, 'Projects')],
      ['project', async () => { await openRoom(h, 'Projects'); assert.equal(await clickWords(h, 'Harbourline Cart Fix', 'main'), 'CLICKED', 'the project opens'); await sleep(1200); }],
      ['tasks', () => openRoom(h, 'Tasks')],
      ['meetings', () => openRoom(h, 'Meetings')],
      ['notes', () => openRoom(h, 'Notes')],
      ['people', () => openRoom(h, 'People')],
      ['person', async () => { await openRoom(h, 'People'); assert.equal(await clickWords(h, 'Alex Chen', 'main'), 'CLICKED', 'the person opens'); await sleep(1200); }],
      ['money', () => openRoom(h, 'Money')],
      ['meeting-no-agenda', () => openMeeting(h, M1, 'Upcoming')],
      ['meeting-minutes-prep', () => openMeeting(h, M2, 'Upcoming')],
      ['meeting-minutes-main', () => openMeeting(h, M5, 'Upcoming')],
    ];
    for (const [id, open] of rooms) {
      try {
        await open();
        await sleep(900);
        await waitFor(h, `!document.querySelector('main .view-loading')`, 8000);
        await sleep(600);
        await calm(h);
        const m = await h.browser.ev(BLANK_JS);
        const f = blankFails(m);
        if (f) {
          bad.push(`${id} at ${w}x${hh}: ${f}`);
          await shot(h, `${id}-hole`, w, hh);
        }
      } catch (e) {
        bad.push(`${id} at ${w}x${hh}: ${e instanceof Error ? e.message : e}`);
        try { await shot(h, `${id}-hole`, w, hh); } catch {}
      }
    }
    // Settings' design contract at the small sizes too (its form width, never the hole rule).
    try {
      await openRoom(h, 'Settings');
      await sleep(900);
      await calm(h);
      const st = await h.browser.ev(`(() => {
        const b = document.querySelector('.settings-page .settings-body');
        const r = b?.getBoundingClientRect();
        const card = document.querySelector('.settings-page .settings-card');
        const cols = card ? parseInt(getComputedStyle(card).columnCount, 10) || 1 : 1;
        return { w: r ? Math.round(r.width) : null, cols, x: document.documentElement.scrollWidth > window.innerWidth + 1 };
      })()`);
      // Round 2: the frame takes the room, so a wide body reads its rows in two columns; no column outgrows a form.
      if (st.w === null) bad.push(`settings at ${w}x${hh}: no settings body`);
      else if (st.w / Math.max(1, st.cols) > 1240) bad.push(`settings at ${w}x${hh}: each column outgrew a form's width (stood ${st.w} in ${st.cols})`);
      if (st.x) bad.push(`settings at ${w}x${hh}: sideways scroll`);
    } catch (e) { bad.push(`settings at ${w}x${hh}: ${e instanceof Error ? e.message : e}`); }
  }
  assert.deepEqual(bad, [], `rooms hold holes below 2400px:\n${bad.join('\n')}`);
});

// The band between the side bar and the content: at their width the content starts where it reads
// well, the gutters even, no dead strip on one side only.
const GUTTERS_JS = `(() => {
  const main = document.querySelector('main');
  const box = document.querySelector('main .nv-page, main .vpage.wide, main .td-inner, main .tk-inner, main .tp-inner, main .pv-inner, main .nv-page-frame, main .settings-page');
  if (!main || !box) return { error: 'no page box' };
  const m = main.getBoundingClientRect(), b = box.getBoundingClientRect();
  return { gutterL: Math.round(b.left - m.left), gutterR: Math.round(m.right - b.right), boxW: Math.round(b.width) };
})()`;

test('every frame starts at one left edge with no band beside it', { timeout: 600000 }, async () => {
  const h = await harness();
  const bad = [];
  const edges = [];
  const check = async (id, w, open) => {
    await open();
    await sleep(900);
    await calm(h);
    const m = await h.browser.ev(GUTTERS_JS);
    if (m.error) { bad.push(`${id} at ${w}: ${m.error}`); return; }
    // Layout round 2 (20 Nov 2026): composition, not centring. Every frame starts at one left edge (the side bar's
    // edge, the frame's pad inside it) and takes the room, so the title sits in one place on every page and no
    // band stands on either side.
    edges.push([`${id} at ${w}`, m.gutterL]);
    if (m.gutterL > 24) bad.push(`${id} at ${w}: the frame starts ${m.gutterL}px in from the side bar (one left edge)`);
    if (m.gutterR > 24) bad.push(`${id} at ${w}: a ${m.gutterR}px band right of the frame`);
  };
  for (const [w, hh] of [[3456, 1408], [1920, 1080]]) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    for (const room of ['Today', 'Inbox', 'Projects', 'Tasks', 'Meetings', 'Notes', 'People', 'Money', 'Settings']) {
      try {
        await check(room, w, () => openRoom(h, room));
      } catch (e) { bad.push(`${room} at ${w}: ${e instanceof Error ? e.message : e}`); }
    }
    // Their band sat on a meeting page: the inner pages stand even too. The project folio reads
    // 2080 by design (t242 pins it), so its gutters run past 400 together; evenness is what it
    // owes.
    try {
      await check('meeting', w, () => openMeeting(h, M1, 'Upcoming'));
    } catch (e) { bad.push(`meeting at ${w}: ${e instanceof Error ? e.message : e}`); }
    try {
      await openRoom(h, 'Projects');
      assert.equal(await clickWords(h, 'Harbourline Cart Fix', 'main'), 'CLICKED', 'the project opens');
      await sleep(1200);
      await calm(h);
      const m = await h.browser.ev(GUTTERS_JS);
      if (m.error) bad.push(`project at ${w}: ${m.error}`);
      else if (m.gutterL > 24 || m.gutterR > 24) bad.push(`project at ${w}: the folio stands apart from the one left edge (left ${m.gutterL}, right ${m.gutterR}, column ${m.boxW})`);
    } catch (e) { bad.push(`project at ${w}: ${e instanceof Error ? e.message : e}`); }
  }
  const lefts = edges.map(([, l]) => l);
  if (lefts.length && Math.max(...lefts) - Math.min(...lefts) > 12) bad.push(`the left edge moves between pages: ${edges.map(([id, l]) => `${id} ${l}`).join(', ')}`);
  assert.deepEqual(bad, [], `the frames stand apart from one left edge:\n${bad.join('\n')}`);
});

// ── Round 2, live: Today's two columns end near each other; no column near-empty; controls capped; one row of
// chips; every settings row and card keeps its inset (20 Nov 2026).
const BALANCE_JS = `(() => {
  const cols = [...document.querySelectorAll('main .nv-bal.is-two > .nv-bal-col')];
  if (cols.length < 2) return { two: false };
  const hs = cols.map((c) => Math.round([...c.children].reduce((n, k) => Math.max(n, k.getBoundingClientRect().bottom), c.getBoundingClientRect().top) - c.getBoundingClientRect().top));
  return { two: true, hs, view: window.innerHeight };
})()`;

test('Today balances its columns, the assets filters keep one row, fields stay their size, rows keep their inset', { timeout: 600000 }, async () => {
  const h = await harness();
  const bad = [];
  for (const [w, hh] of [[3456, 1408], [2560, 1400], [1920, 1080]]) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    try {
      await openRoom(h, 'Today');
      await sleep(1500);
      await calm(h);
      const b = await h.browser.ev(BALANCE_JS);
      if (!b.two) bad.push(`today at ${w}: one column at a width that holds two`);
      else {
        const [x, y] = b.hs;
        const lo = Math.min(x, y), hi = Math.max(x, y);
        // Near-empty: the shorter column holds less than a third of the taller, while the taller runs past a screen.
        if (hi > b.view && lo < hi / 3) bad.push(`today at ${w}: one column near-empty beside the other (${b.hs.join(' / ')} px)`);
        if (lo < 80) bad.push(`today at ${w}: a column holds next to nothing (${b.hs.join(' / ')} px)`);
      }
      await shot(h, 'today-balance', w, hh);
    } catch (e) { bad.push(`today at ${w}: ${e instanceof Error ? e.message : e}`); }
    try {
      await openRoom(h, 'Assets');
      await sleep(1200);
      await calm(h);
      const f = await h.browser.ev(`(() => {
        const strip = document.querySelector('.w4b-fstrip-chips');
        const chips = strip ? [...strip.querySelectorAll('.chip')] : [];
        const rows = new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size;
        return { rows, menus: document.querySelectorAll('.w4b-fstrip-menus .nv-filter-menu').length };
      })()`);
      if (f.rows > 1) bad.push(`assets at ${w}: the filter chips run ${f.rows} rows`);
      // Collection always offers New collection; Area and Tag show when the vault has any.
      if (f.menus < 1) bad.push(`assets at ${w}: areas, collections and tags are not dropdowns`);
      assert.equal(await clickWords(h, 'Brand kit', 'main'), 'CLICKED', 'the brand kit opens');
      await sleep(1200);
      const k = await h.browser.ev(`[...document.querySelectorAll('.as-brand-name input, .as-brand-name .as-field-input')].map((e) => Math.round(e.getBoundingClientRect().width))`);
      for (const kw of k) if (kw > 440) bad.push(`brand kit at ${w}: a short field stretches to ${kw}px`);
      await shot(h, 'brand-kit', w, hh);
    } catch (e) { bad.push(`assets at ${w}: ${e instanceof Error ? e.message : e}`); }
    try {
      await openRoom(h, 'Settings');
      await sleep(900);
      await calm(h);
      const pads = await h.browser.ev(`(() => {
        const out = [];
        const px = (v) => parseFloat(v) || 0;
        const card = document.querySelector('.settings-page .settings-card');
        if (card) { const c = getComputedStyle(card); out.push(['card', Math.min(px(c.paddingLeft), px(c.paddingTop))]); }
        for (const r of [...document.querySelectorAll('.settings-page .setting-row')].slice(0, 6)) { const c = getComputedStyle(r); out.push(['row', Math.min(px(c.paddingLeft), px(c.paddingRight))]); }
        return out;
      })()`);
      if (!pads.length) bad.push(`settings at ${w}: nothing to measure`);
      for (const [what, p] of pads) if (p < 12) bad.push(`settings at ${w}: a ${what} holds ${p}px inside (rows and cards keep 12px or more)`);
    } catch (e) { bad.push(`settings at ${w}: ${e instanceof Error ? e.message : e}`); }
  }
  assert.deepEqual(bad, [], `composition:\n${bad.join('\n')}`);
});

// Round 3, live: every pane reaches the window's foot (within 80 px: a gap, or a one-line hint under the panes), the panes count by the frame, the meeting's
// regions reach the foot, Today has its third column at the ultrawide, and the panes' own words keep the body step.
const PANES_JS = `(() => {
  const H = window.innerHeight;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const panes = [...document.querySelectorAll('.nv-split.is-panes > .nv-pane, .mt-regions.nv-panes-root > *, .pj-ov-more.nv-panes-root > *')].filter(vis);
  const short = panes.filter((e) => H - e.getBoundingClientRect().bottom > 80).map((e) => e.className.split(' ')[0] + ' ends ' + Math.round(H - e.getBoundingClientRect().bottom) + ' above the foot');
  const small = [...document.querySelectorAll('.nv-pane .peek-row-title, .mt-regions .mm-minutes li, .mt-regions .mp-words, .nv-detail-title, .td-compose .td-row-what')]
    .filter(vis).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 15).map((e) => e.className + ' ' + getComputedStyle(e).fontSize).slice(0, 3);
  const split = document.querySelector('.nv-split.is-panes');
  return { panes: panes.length, three: !!document.querySelector('.nv-split.is-three'), regions: document.querySelector('.mt-regions')?.getAttribute('data-regions') ?? null, cols: document.querySelector('.nv-bal')?.getAttribute('data-balance') ?? null, short, small, x: document.documentElement.scrollWidth > window.innerWidth + 1, split: !!split };
})()`;

test('round 3: panes fill the window at 3440x1400 and 1920x1080', { timeout: 600000 }, async () => {
  const h = await harness();
  const bad = [];
  for (const [w, hh] of [[3440, 1400], [1920, 1080]]) {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: w, height: hh, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    const wide = w >= 3000;
    const lists = [['meetings', 'Meetings'], ['people', 'People'], ['notes', 'Notes'], ['tasks', 'Tasks'], ['projects', 'Projects'], ['inbox', 'Inbox']];
    for (const [id, room] of lists) {
      try {
        await openRoom(h, room);
        await sleep(1400);
        await calm(h);
        const m = await h.browser.ev(PANES_JS);
        await shot(h, `r3-${id}`, w, hh);
        if (!m.split) { bad.push(`${id} ${w}: no panes`); continue; }
        if (m.panes < 2) bad.push(`${id} ${w}: ${m.panes} pane(s) showing`);
        if (wide && id !== 'inbox' && !m.three) bad.push(`${id} ${w}: no third pane at the ultrawide`);
        if (!wide && m.three) bad.push(`${id} ${w}: a third pane at 1920`);
        for (const s of m.short) bad.push(`${id} ${w}: ${s}`);
        for (const s of m.small) bad.push(`${id} ${w}: text under the body step (${s})`);
        if (m.x) bad.push(`${id} ${w}: sideways scroll`);
      } catch (e) { bad.push(`${id} ${w}: ${e instanceof Error ? e.message : e}`); }
    }
    try {
      await openMeeting(h, 'Cart Retry Sign-off with Alex and Priya before Friday', 'Past');
      await calm(h);
      const m = await h.browser.ev(PANES_JS);
      await shot(h, 'r3-meeting', w, hh);
      if (m.regions !== (wide ? '3' : '2')) bad.push(`meeting ${w}: ${m.regions} regions`);
      for (const s of m.short) bad.push(`meeting ${w}: ${s}`);
      for (const s of m.small) bad.push(`meeting ${w}: text under the body step (${s})`);
    } catch (e) { bad.push(`meeting ${w}: ${e instanceof Error ? e.message : e}`); }
    try {
      await openRoom(h, 'Today');
      await sleep(1500);
      await calm(h);
      const m = await h.browser.ev(PANES_JS);
      if (m.cols !== (wide ? 'three' : 'two')) bad.push(`today ${w}: ${m.cols} columns`);
      for (const s of m.small) bad.push(`today ${w}: text under the body step (${s})`);
    } catch (e) { bad.push(`today ${w}: ${e instanceof Error ? e.message : e}`); }
  }
  assert.deepEqual(bad, [], `round 3 panes:\n${bad.join('\n')}`);
});
