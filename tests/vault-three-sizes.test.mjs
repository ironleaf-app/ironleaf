// node --test tests/vault-three-sizes.test.mjs — t74 vault-three-sizes (9 Nov 2026): every Vault page judged at the
// window (3456x1408), the middle one (1920x1117) and the small one (1219x709), polish only. The walk opens Today,
// Projects, a project page, People, a person page, Notes, a folder, a note, Graph, Tasks, Inbox, Meetings, Money,
// Systems, Templates, Settings, More open and Ctrl+K open, on a made-up vault of realistic size (about 145 notes
// across Work, Me, Business, Publications, Home and Health, with people, projects, meetings and bills, with long
// real content). At each size every state asserts: no horizontal page scroll, the side nav never scrolls, no clipped
// text, and the main column uses a sensible share of the window. Three faults found on the walk, each fixed at its
// cause with a check that fails without it:
// - an Inbox folder note read as its slug plus its raw first line ("awning-quote-… — # Awning quote…", the #
//   printed): folderNoteWords (src/shared/inbox.ts) reads the title plus the first line that adds anything, without
//   markup, and the Inbox reads through it (src/main/life.ts);
// - the hidden edit pencil (a 20px box with visibility:hidden) added 22px of scroll overflow to every value it sat
//   in (the project title ran 22px past its box, the person page's email button 12px): the pencil is zero-size
//   until hover or focus shows it (src/renderer/src/styles/peek.css), the same geometry when shown;
// - at 1219px Notes' two drop-downs split across rows (the sort orphaned alone): drop-downs in a chips bar wrap as
//   one group (the kit's .chip-group, worn by Notes' selects).
// What the clip check lets through, each by design: one-line slots that clip without dots with their full words on
// hover, and a child wider than its parent (a Connected row's hover wash bleeds 8px by design, .foot-connected
// .peek-row). Dots are never by design (t207 pass 2): a clamp or an ellipsis anywhere in main is a fault. A hidden
// pencil is none of those, so the project title and the email button failed until the pencil fix.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: an Inbox folder note reads as words, never markup ────────────────

let IB;
before(async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'nv-three-sizes-'));
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/inbox.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  IB = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});

test('folder notes read as their title plus the first line that adds anything, without markup', () => {
  assert.equal(IB.folderNoteWords('awning-quote', '# Awning quote\n\nThe quote is $1,200 fitted.'), 'awning-quote — The quote is $1,200 fitted.', 'its own heading skipped when it only repeats the title');
  assert.equal(IB.folderNoteWords('Note name', 'Just words here'), 'Note name — Just words here');
  assert.equal(IB.folderNoteWords('Note name', '# Note name'), 'Note name', 'nothing added, nothing appended');
  assert.equal(IB.folderNoteWords('Note name', 'See [[Other note]] today'), 'Note name — See Other note today', 'link marks never reach a person');
  assert.equal(IB.folderNoteWords('slug-name_here', '# Slug name here'), 'slug-name_here', 'dashes read as spaces when comparing');
  assert.equal(IB.folderNoteWords('Empty', ''), 'Empty');
  assert.equal(IB.folderNoteWords('Empty', '\n\n'), 'Empty');
});

test('a folder note’s title is its own heading, never its file name (t243)', () => {
  assert.equal(IB.folderNoteTitle('the-long-email-from-the-bank-about-the-card-reader-failure', '# The long email from the bank about the card reader failure\n\nThe bank wrote back.'), 'The long email from the bank about the card reader failure');
  assert.equal(IB.folderNoteTitle('awning-quote', '# Awning quote from ShadeCo\n\nTwelve hundred fitted.'), 'Awning quote from ShadeCo');
  assert.equal(IB.folderNoteTitle('plain-name', 'No heading here, just words.'), 'plain-name', 'no heading: the indexed title stands');
  assert.equal(IB.folderNoteTitle('tags', '#tag weeknotes\n\nWords.'), 'tags', 'a tag is not a heading');
});

test('the Inbox reads its folder notes through the shared words', () => {
  const life = read('src/main/life.ts');
  assert.ok(life.includes('folderNoteWords('), 'life.ts builds folder-note words through folderNoteWords');
  assert.ok(!/titleFromPath\(f\.rel\) \+ \(body/.test(life), 'no raw first line is glued to the slug any more');
  assert.ok(life.includes('folderNoteTitle(index.get(f.rel)?.title || titleFromPath(f.rel), body)'), 't243: the note’s own heading, never its file name (critic 1 #6)');
  assert.ok(life.includes('titleFromName(baseOf(f.rel))'), 't243: a file reads prettified, never its raw name');
});

// ── Static: the hidden pencil takes no room, not even scroll room ────────────

test('the hidden edit pencil is zero-size; its shown geometry is unchanged', () => {
  const css = read('src/renderer/src/styles/peek.css');
  const base = css.match(/\.rec-pencil \{([^}]*)\}/s)?.[1] ?? '';
  assert.ok(/width: 0/.test(base), 'hidden, the pencil is zero wide (was: a 20px box counting toward scroll overflow)');
  assert.ok(/overflow: hidden/.test(base), 'hidden, its mark clips inside the zero box');
  assert.ok(/margin: -3px 0 -3px 0/.test(base), 'hidden, its margins add nothing either');
  // t261, 13 Nov 2026 (the head card: the zero-width box still held a 20px line under every block value).
  assert.ok(/display: none/.test(base), 'hidden, it leaves the layout entirely (width 0 still held a line in block values)');
  const shown = css.match(/\.pj-ed:hover > \.rec-pencil,\s*\.pj-ed:focus-visible > \.rec-pencil \{([^}]*)\}/s)?.[1] ?? '';
  assert.ok(/display: inline-grid/.test(shown), 'shown, it stands back in the flow');
  assert.ok(/width: 20px/.test(shown), 'shown, the 20px pencil stands');
  assert.ok(/margin: -3px -22px -3px 2px/.test(shown), 'shown, the negative margin still takes no room');
  assert.ok(/visibility: visible/.test(shown) && /opacity: 1/.test(shown), 'shown on hover or focus, as before');
});

// ── Static: chips-bar drop-downs wrap as one group ───────────────────────────

test('the kit groups chips-bar controls that must wrap together', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(/\.chips > \.chip-group \{[^}]*display: inline-flex/s.test(kit), 'the group lays its controls out');
  assert.ok(/\.chips > \.chip-group \{[^}]*flex-wrap: nowrap/s.test(kit), 'the group never breaks inside');
  assert.ok(/\.chips > \.chip-group \{[^}]*gap: 8px/s.test(kit), 'the group keeps the bar’s own gap');
});

test('Notes wears the group on its two drop-downs, pushed right as one', () => {
  const page = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(page.includes('chip-group w2b-selects'), 'the project and sort selects stand in one group');
  const css = read('src/renderer/src/styles/w2b.css');
  assert.ok(/\.w2b-selects \{[^}]*margin-left: auto/s.test(css), 'the group keeps the right push the first select carried');
  assert.ok(!/\.w2b-project \{[^}]*margin-left: auto/s.test(css), 'the push moved to the group, not doubled');
});

// ── Live: one boot, a made-up vault of realistic size, every page at three sizes ────

// Work 56 (two projects), Me 47, Business 14, Publications 12, Home 10, Health 5, Top 1, plus People, Meetings
// (past and coming), Templates, Daily, Inbox, the Bills list and the Systems tables. Long real content: long
// titles, long task lines, long paragraphs, so wrapping and clipping read as a real one would.
function writeBigVault(dir) {
  const { mkdirSync: mk, writeFileSync: w0, rmSync: rm } = { mkdirSync, writeFileSync, rmSync };
  rm(dir, { recursive: true, force: true });
  mk(dir, { recursive: true });
  const w = (rel, text) => {
    const p = path.join(dir, ...rel.split('/'));
    mk(path.dirname(p), { recursive: true });
    w0(p, text);
  };
  let seed = 20261109;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const people = ['Alex Chen', 'Priya Nair', 'Sam Ortega', 'June Park', 'Tom Bradley', 'Lucy Hammond'];
  const roles = ['Shop developer', 'Designer of the new receipts', 'Weekend manager at the museum', 'Bookkeeper for the shop and the market stall', 'Electrician, rewiring the back room', 'Caterer for Friday late openings'];
  people.forEach((p, i) => w(`People/${p}.md`, `---\ntype: person\nrole: ${roles[i]}\nemail: ${p.toLowerCase().replace(/ /g, '.')}@example.invalid\n---\n# ${p}\n\n${roles[i][0].toUpperCase() + roles[i].slice(1)}. Works with [[Harbourline Cart Fix]] most weeks and answers quickly on weekday mornings.\n\n## Notes\n\nPrefers short meetings with an agenda sent the day before. Takes notes by hand and sends a photo of the page afterwards, which then needs typing up before Friday.\n`));
  const meetings = [
    ['2026-11-03 Cart standup', '2026-11-03', ['Alex Chen', 'Priya Nair'], 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md'],
    ['2026-10-28 Roster planning for the November late openings', '2026-10-28', ['Priya Nair', 'Sam Ortega'], 'Projects/Museum Late Shift/Museum Late Shift.md'],
    ['2026-11-06 Receipt review with Priya before the Friday release', '2026-11-06', ['Alex Chen', 'Priya Nair', 'June Park'], 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md'],
    ['2026-10-21 Wiring quote walkthrough for the back room refit', '2026-10-21', ['Tom Bradley', 'Alex Chen'], null],
    ['2026-11-05 Caterer tasting and Friday roster confirmation', '2026-11-05', ['Lucy Hammond', 'Sam Ortega'], 'Projects/Museum Late Shift/Museum Late Shift.md'],
    ['2026-11-10 Tuesday standup on the retry fix before the Friday release', '2026-11-10', ['Alex Chen', 'Priya Nair'], 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md'],
    ['2026-11-12 Roster sign-off for the December late openings with Sam', '2026-11-12', ['Priya Nair', 'Sam Ortega'], 'Projects/Museum Late Shift/Museum Late Shift.md'],
    ['2026-11-14 Awning deposit and December bookings review with June', '2026-11-14', ['Alex Chen', 'June Park'], null],
  ];
  for (const [title, date, who, proj] of meetings) {
    const head = `---\ntype: meeting\ndate: ${date}\nattendees: [${who.join(', ')}]\n${proj ? `project: ${proj}\n` : ''}---\n`;
    w(`Meetings/${title}.md`, `${head}# ${title}\n\n## Agenda\n\n- The retry fix and whether it is ready for Friday\n- The receipt review and who sends it\n- Anything blocking the weekend roster\n\n## Discussion\n\nThe retry now fails twice before showing an error, which the shop tested on Saturday morning with twenty orders in a row and no drops. The receipt still needs its tax line checked against the October invoices before anyone calls it done.\n\n## Actions\n\n- [ ] Retry the failed payment twice before showing an error — Priya Nair — due 2026-11-06\n- [ ] Send the receipt v2 for review with the tax line fixed — Alex Chen — due 2026-11-04\n- [x] Book the room for next Tuesday — Alex Chen\n\n## Decisions\n\n- Retry twice, then fail loud\n`);
  }
  w('Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', `---
type: project
status: active
health: on track
owner: Alex Chen
due: 2026-11-20
---
# Harbourline Cart Fix

## Summary

The shop's cart drops about one order in forty at payment. Fix the retry, then the receipt. See the [[Receipts spec]] for what v2 shows.

## What's next

- [ ] Chase the 2 carts that failed on Friday (PAY-101, PAY-102) — Alex Chen — due 2026-11-05
- [ ] Retry the failed payment twice before showing an error, then check the Saturday orders line by line — Priya Nair — due 2026-11-06
- [ ] Send the receipt v2 for review with the tax line fixed and the totals double-checked — Alex Chen — due 2026-11-04
- [ ] Ring ShadeCo about the awning quote before it lapses on Friday afternoon — Alex Chen — due 2026-11-07

## Workstreams

| Workstream | Owner | Status | Next step |
|---|---|---|---|
| Wave list | Alex Chen | in progress | Upgrade or chase the 13 still to do at 26 Oct |
| Receipts | Priya Nair | ready to send | Send v2 (reviewer PASS) |
| Saturday soak test with twenty real orders in a row | Sam Ortega | not started | Book the test window with the shop |

## Key dates

- 2026-11-06: Retry fix live (milestone)
- 2026-11-20: Cart fix done (milestone)
- 2026-11-27: Awning fitted before the December rush (milestone)

## Decisions

- 2026-11-01: Retry twice, then fail loud (decided by Alex Chen)
- 2026-10-29: The receipt shows every line including tax, no summary rows (decided by Priya Nair)

## Risks

- Repeat failures on old Safari (owner: Priya Nair, level: medium)
- The awning quote lapses on Friday and ShadeCo books out for December (owner: Alex Chen, level: high)

## People

- Alex Chen (owner)
- Priya Nair
`);
  for (let i = 1; i <= 8; i++) w(`Projects/Harbourline Cart Fix/Notes/Kickoff note ${i} with decisions from the Tuesday session.md`, `---
type: note
tags: [harbourline, kickoff]
---
# Kickoff note ${i} with decisions from the Tuesday session

Met with [[Alex Chen]] about the [[Harbourline Cart Fix|cart fix]]. The [[Receipts v2]] design is linked. See the [[Receipts spec]].

The room agreed the retry should fail loud after two tries, and that the receipt must show every line. Priya will send v2 once the tax line matches the October invoices.
`);
  w('Projects/Museum Late Shift/Museum Late Shift.md', `---
type: project
status: active
health: at risk
owner: Priya Nair
due: 2026-10-30
---
# Museum Late Shift

## Summary

Late opening every Friday. Behind on the roster.

## What's next

- [ ] Publish the November roster with cover for all four Friday nights — Priya Nair — due 2026-10-28
- [x] Confirm the caterer — Priya Nair

## Workstreams

| Workstream | Owner | Status | Next step |
|---|---|---|---|
| Roster | Priya Nair | at risk | Fill the last 3 Friday nights |
| Catering for the late openings through December | Lucy Hammond | on track | Confirm the December dates |

## Key dates

- 2026-10-28: November roster out (milestone)
`);
  const areas = [['Work', 46], ['Me', 47], ['Business', 14], ['Publications', 12], ['Home', 10], ['Health', 5]];
  const all = ['Harbourline Cart Fix', 'Museum Late Shift', '2026-11-03 Cart standup', ...people];
  const paras = [
    'The shop was quiet on Tuesday morning, so there was time to go through the October invoices line by line and check the totals against the bank feed.',
    'Priya sent the receipt mock late in the evening with a note about the tax line, which still reads ten dollars too high on the October sample.',
    'The roster for November is nearly done; three Friday nights still need cover and Sam said he would ask around the weekend crew.',
    'Ordered the new receipt rolls and the spare till drawer key. The delivery is due Thursday, in time for the Friday rush.',
    'Went through the awning quote with June: twelve hundred dollars fitted, and ShadeCo can start the week after next if we pay the deposit now.',
  ];
  for (const [area, count] of areas) {
    for (let i = 1; i <= count; i++) {
      const longTitle = i % 7 === 0 ? ` with the long follow-up from the Tuesday session and the Friday deadline` : '';
      const links = [all[rnd(all.length)], all[rnd(all.length)]];
      w(`${area}/${area} note ${i}${longTitle}.md`, `# ${area} note ${i}${longTitle}\n\n${paras[rnd(paras.length)]} ${links.map((l) => `See [[${l}]].`).join(' ')}\n\n${paras[rnd(paras.length)]}\n\n- [ ] Follow up on ${area.toLowerCase()} note ${i} before Friday afternoon — ${people[rnd(people.length)]} — due 2026-11-${10 + rnd(15)}\n- [ ] File the October paperwork for ${area.toLowerCase()} where it belongs\n`);
    }
  }
  w('Top.md', `# Top\n\nThe vault starts here. See [[Harbourline Cart Fix]] and [[Alex Chen]].\n`);
  w('Templates/Standup.md', `# Standup\n\n## Agenda\n\n## Actions\n`);
  w('Templates/Meeting notes with agenda, discussion, actions and decisions.md', `# Meeting notes\n\n## Agenda\n\n## Discussion\n\n## Actions\n\n## Decisions\n`);
  w('Templates/Project kickoff with summary, workstreams, dates and risks.md', `# Project kickoff\n\n## Summary\n\n## What's next\n\n## Workstreams\n\n## Key dates\n\n## Decisions\n\n## Risks\n`);
  w('Daily/2026-11-04.md', `# 4 November 2026\n\n- [ ] Water the plants in the front window before the sun gets on them\n- [x] Read the brief\n- [ ] Ring the bank about the card reader that failed twice on Saturday\n`);
  w('Daily/2026-11-08.md', `# 8 November 2026\n\n- [ ] Chase the 2 carts that failed on Friday and ring both customers back\n- [ ] Send the receipt v2 for review with the tax line fixed\n`);
  w('Inbox.md', `# Inbox\n\n- [ ] Call the bank about the card reader that failed twice on Saturday morning\n- [ ] A quote for the shop awning: $1,200 from ShadeCo, decide by Friday before it lapses\n- Buy milk and the long-life cartons for the back room\n`);
  w('Inbox/awning-quote.md', `# Awning quote from ShadeCo, twelve hundred dollars fitted\n\nThe awning quote is $1,200 from ShadeCo, fitted, with the deposit due Friday before the December books fill up.\n`);
  w('Docs/Receipts spec.md', `---\ntype: doc\n---\n# Receipts spec\n\n## Summary\n\nThe v2 receipt shows every line.\n\n## Changes\n\n- 2026-11-02: Added the tax line.\n`);
  const bills = [
    ['Harbour Internet', 'Bill', '89.00', 'Monthly', '2026-11-12', 'Phone and internet', 'Everyday', '', 'No', 'Active', '', ''],
    ['Streamly annual family plan renewal', 'Subscription', '169.99', 'Yearly', '2026-11-10', 'Subscriptions', 'Everyday', '', 'Yes', 'Active', '', ''],
    ['Power for the shop through October', 'Bill', '214.50', 'Monthly', '2026-11-20', 'Home and utilities', 'Everyday', '', 'No', 'Active', '', ''],
    ['Water', 'Bill', '120.00', 'Quarterly', '', 'Home and utilities', '', '', 'No', 'Active', '', ''],
    ['Council Rates for the shop premises', 'Bill', '480.00', 'Quarterly', '', 'Home and utilities', '', '', 'No', 'Active', '', ''],
    ['Harbour Credit Card minimum for November', 'Bill', '150.00', 'Monthly', '2026-11-08', 'Loans and cards', 'Everyday', '', 'Yes', 'Active', '', ''],
    ['Phone for Alex and the shop spare', 'Bill', '45.00', 'Monthly', '2026-11-15', 'Phone and internet', 'Everyday', '', 'Yes', 'Active', '', ''],
    ['Museum catering deposit for December late nights', 'Bill', '600.00', 'Once', '2026-11-25', 'Other', 'Savings', '', 'No', 'Active', '', ''],
  ];
  const head = '| Name | Kind | Amount | Cycle | Due | Category | Account | Project | Autopay | Status | Paid | Note file |';
  const sep = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const billsText = `---\ntype: bills-table\ntable: bills\nversion: 1\n---\n# Bills\n\nOne line per bill. You can read this file; the Money page reads it too.\n\n${head}\n${sep}\n${bills.map((b) => `| ${b.join(' | ')} |`).join('\n')}\n`;
  w('Me/Finance/Bills.md', billsText);
  w('Finance/Bills.md', billsText);
  const machines = [
    ['Shop till PC behind the counter', 'PC', 'Till and eftpos', 'Windows 11', 'shop-pc', 'Behind the counter', 'Up', '2026-11-08', '', ''],
    ['Back room server for files and backups', 'Server', 'Files and backups', 'Ubuntu 24.04', '192.168.1.20', 'Back room shelf', 'Up', '2026-11-08', '', ''],
    ['Old laptop as the shop spare', 'Laptop', 'Spare', 'Windows 11', 'shop-spare', 'Office drawer', 'Down', '2026-10-30', '', ''],
  ];
  const services = [
    ['Shop website and online ordering', 'Web app', 'Back room server for files and backups', 'https://shop.example.invalid', '443', 'Up', '', '', '2026-11-08', '', ''],
    ['Nightly backup to the USB drive', 'Backup', 'Back room server for files and backups', '', '', 'Degraded', 'USB drive plugged in', 'Restore a file from the nightly backup', '2026-11-08', '', ''],
  ];
  const runbooks = [
    ['Card reader failure on a Saturday', 'Shop till PC behind the counter', 'On demand', '2026-11-01', 'Fix it', ''],
    ['Restore a file from the nightly backup', 'Back room server for files and backups', 'Monthly', '2026-10-12', 'Fix it', ''],
  ];
  const sysWrite = (base) => {
    w(`${base}/Machines.md`, `---\ntype: systems-table\ntable: machines\nversion: 1\n---\n# Machines\n\nOne line per machine. You can read this file; the Systems page reads it too.\n\n| Name | Kind | Role | System | Address | Where it is | Status | Last checked | Logins | Note file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${machines.map((b) => `| ${b.join(' | ')} |`).join('\n')}\n`);
    w(`${base}/Services.md`, `---\ntype: systems-table\ntable: services\nversion: 1\n---\n# Services\n\nOne line per service. You can read this file; the Systems page reads it too.\n\n| Name | Kind | Runs on | Address | Port | Status | Depends on | Runbook | Last checked | Logins | Note file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${services.map((b) => `| ${b.join(' | ')} |`).join('\n')}\n`);
    w(`${base}/Runbooks.md`, `---\ntype: systems-table\ntable: runbooks\nversion: 1\n---\n# Runbooks\n\nOne line per runbook. Steps come from the shared pattern, filled in for what each is for.\n\n| Name | For | How often | Last run | Pattern | Note file |\n| --- | --- | --- | --- | --- | --- |\n${runbooks.map((b) => `| ${b.join(' | ')} |`).join('\n')}\n`);
  };
  sysWrite('Systems and Home Lab');
  sysWrite('Home/Systems and Home Lab');
  w('Private notes/Secret.md', `# Secret\n\nSee [[Harbourline Cart Fix]].\n`);
}

let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.invoke('settings:update', [{ prefs: { modules: Object.fromEntries(['finance', 'documents', 'business', 'systems', 'publications', 'goals', 'family', 'health', 'house', 'vehicles', 'career', 'travel', 'meetings'].map((id) => [id, { on: true }])) } }]);
    writeBigVault(H.vaultDir);
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
  const label = name === 'Graph' ? 'Open the graph' : name === 'Templates' ? 'Open the Templates page' : name;
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 4000))) assert.fail(`no palette for ${name}`);
  await h.browser.send('Input.insertText', { text: name });
  await sleep(700);
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
async function esc(h) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(300);
}

// No clipped text: a text block whose words run past its box, excluding the by-design shapes (a hovered
// one-line slot, and a child wider than its parent — the Connected row's hover wash). Dots are never by
// design (t207 pass 2): a clamp or an ellipsis anywhere in main is a fault on its own.
const MEASURE_JS = `(() => {
  const nav = document.querySelector('nav.places-list');
  const box = document.querySelector('main .nv-page, main .vpage.wide, main .td-inner, main .tp-inner, main .settings-page, main .nv-page-frame');
  const r = box?.getBoundingClientRect();
  const folio = document.querySelector('main .pj-folio')?.getBoundingClientRect();
  const clipped = [];
  const hovered = (el) => (el.getAttribute('title') || el.getAttribute('aria-label') || el.closest('button, a')?.getAttribute('title') || el.closest('button, a')?.getAttribute('aria-label') || '');
  for (const el of document.querySelectorAll('main p, main h1, main h2, main h3, main li, main td, main th, main .td-text, main button, main a, main small')) {
    const er = el.getBoundingClientRect();
    if (er.width < 2 || er.height < 2) continue;
    const cs = getComputedStyle(el);
    const tag = \`\${el.tagName.toLowerCase()}.\${String(el.className).split(' ').slice(0, 2).join('.')}\`;
    if (cs.webkitLineClamp !== 'none' || cs.textOverflow === 'ellipsis') {
      clipped.push(tag + ' shows … (dots are never by design)');
      if (clipped.length >= 10) break;
      continue;
    }
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (cs.whiteSpace === 'nowrap' && cs.overflowX === 'hidden' && hovered(el)) continue;
    if ([...el.children].some((k) => k.getBoundingClientRect().width > er.width + 1)) continue;
    clipped.push(tag + ' +' + (el.scrollWidth - el.clientWidth) + 'px ' + (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 50));
    if (clipped.length >= 10) break;
  }
  return {
    docX: document.documentElement.scrollWidth > window.innerWidth + 1,
    navScrolls: nav ? nav.scrollHeight > nav.clientHeight + 1 : null,
    boxW: r ? Math.round(r.width) : null,
    folioW: folio ? Math.round(folio.width) : null,
    clipped,
  };
})()`;

async function ctrlK(h) {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
}

const PAGES = [
  { id: 'today', room: true, open: (h) => openRoom(h, 'Today') },
  { id: 'projects', room: true, open: (h) => openRoom(h, 'Projects') },
  { id: 'project', open: async (h) => { await openRoom(h, 'Projects'); assert.equal(await clickWords(h, 'Harbourline Cart Fix', 'main'), 'CLICKED', 'the project opens'); await sleep(1200); } },
  { id: 'people', room: true, open: (h) => openRoom(h, 'People') },
  { id: 'person', room: true, open: async (h) => { await openRoom(h, 'People'); assert.equal(await clickWords(h, 'Alex Chen', 'main'), 'CLICKED', 'the person opens'); await sleep(1200); } },
  { id: 'notes', room: true, open: (h) => openRoom(h, 'Notes') },
  { id: 'folder', room: true, open: async (h) => { await openRoom(h, 'Notes'); assert.equal(await clickWords(h, 'Work', 'main'), 'CLICKED', 'the folder filters'); await sleep(1200); } },
  { id: 'note', open: async (h) => { await openRoom(h, 'Notes'); await ctrlK(h); assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens for the note'); await h.browser.send('Input.insertText', { text: 'Kickoff note 1 with decisions' }); await sleep(900); assert.equal(await h.browser.ev(`(() => { const row = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').includes('Kickoff note 1')); if (!row) return 'NOTFOUND'; row.click(); return 'CLICKED'; })()`), 'CLICKED', 'the note opens'); await sleep(1500); } },
  { id: 'graph', open: async (h) => { await openRoom(h, 'Graph'); assert.ok(await waitFor(h, `window.__nvBrainGraph && window.__nvBrainGraph.snapshot().count > 40`, 60000), 'the big vault draws'); await sleep(2000); } },
  { id: 'tasks', room: true, open: (h) => openRoom(h, 'Tasks') },
  { id: 'inbox', room: true, open: (h) => openRoom(h, 'Inbox') },
  { id: 'meetings', room: true, open: (h) => openRoom(h, 'Meetings') },
  { id: 'money', room: true, open: (h) => openRoom(h, 'Money') },
  { id: 'systems', room: true, open: (h) => openRoom(h, 'Systems') },
  { id: 'templates', room: true, open: (h) => openRoom(h, 'Templates') },
  { id: 'settings', room: true, open: async (h) => { assert.equal(await clickWords(h, 'Settings', '.sidebar.left, aside'), 'CLICKED', 'Settings opens'); await sleep(1200); } },
  { id: 'more', open: async (h) => { await openRoom(h, 'Today'); assert.equal(await clickWords(h, 'More', '.sidebar.left, aside'), 'CLICKED', 'More opens'); await sleep(800); assert.ok(await h.browser.ev(`(() => { const m = document.querySelector('.menu[role="menu"]'); if (!m) return false; const r = m.getBoundingClientRect(); return r.width > 2 && r.height > 2; })()`), 'the menu shows'); } },
  { id: 'palette', open: async (h) => { await openRoom(h, 'Today'); await ctrlK(h); assert.ok(await waitFor(h, `!!document.querySelector('.picker input')`, 5000), 'the palette opens'); await h.browser.send('Input.insertText', { text: 'harbour' }); await sleep(900); } },
];

// A room's sensible share of the window: the designed columns (2400 past 2400px viewports — t254, 13 Nov
// 2026, replacing the 1440 that left 862 dead pixels each side — 1280 past 1700px) read 0.69/0.67/0.74; a
// column stuck at the old 1080 reads 0.31/0.56 and fails, as does one still at 1440 (0.42) at their
// window.
const SHARE = { 3456: { today: 0.6, room: 0.6, folio: 0.38 }, 1920: { today: 0.6, room: 0.6, folio: 0.6 }, 1219: { today: 0.7, room: 0.7, folio: 0.65 } };

async function walk(size) {
  const h = await harness();
  const [W, Hg] = size;
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  for (const p of PAGES) {
    const tag = `${p.id} at ${W}x${Hg}`;
    await esc(h);
    await p.open(h);
    await sleep(700);
    const m = await h.browser.ev(MEASURE_JS);
    assert.equal(m.docX, false, `${tag}: the page scrolls nowhere sideways`);
    assert.equal(m.navScrolls, false, `${tag}: the nav never scrolls`);
    assert.deepEqual(m.clipped, [], `${tag}: no clipped text`);
    if (p.room) {
      const want = SHARE[W][p.id === 'today' ? 'today' : 'room'];
      assert.ok(m.boxW !== null && m.boxW / W >= want, `${tag}: the column uses a sensible share (stood ${m.boxW}px, share ${(m.boxW / W).toFixed(2)}, needs ${want})`);
    }
    if (p.id === 'project') {
      assert.ok(m.folioW !== null && m.folioW / W >= SHARE[W].folio, `${tag}: the folio joins the rooms (stood ${m.folioW}px, needs ${SHARE[W].folio} of ${W})`);
    }
    if (p.id === 'graph') {
      const g = await h.browser.ev(`(() => {
        const cr = document.querySelector('.bg-canvas')?.getBoundingClientRect();
        const br = document.querySelector('.nj-graph-body')?.getBoundingClientRect();
        return { fill: cr && br ? Math.abs(cr.width - br.width) <= 2 && Math.abs(cr.height - br.height) <= 2 : false, count: window.__nvBrainGraph ? window.__nvBrainGraph.snapshot().count : 0 };
      })()`);
      assert.ok(g.count > 40, `${tag}: the vault draws (${g.count} points)`);
      assert.equal(g.fill, true, `${tag}: the canvas fills the page`);
    }
    if (p.id === 'inbox') {
      const hash = await h.browser.ev(`[...document.querySelectorAll('.w2a-ib-title')].map((e) => e.textContent).join('\\n')`);
      assert.ok(!/(^|\\s)#\\S/.test(hash), `${tag}: no raw markdown in the rows`);
    }
    if (p.id === 'notes') {
      const tops = await h.browser.ev(`(() => { const a = document.querySelector('.w2b-project')?.getBoundingClientRect(); const b = document.querySelector('.w2b-sort')?.getBoundingClientRect(); return a && b ? [Math.round(a.top), Math.round(b.top)] : null; })()`);
      assert.ok(tops && Math.abs(tops[0] - tops[1]) <= 2, `${tag}: the two drop-downs share one row (tops ${tops})`);
    }
    await esc(h);
  }
}

test('every page at a wide window, 3456x1408', { timeout: 600000 }, async () => {
  await walk([3456, 1408]);
});

test('every page at the middle window, 1920x1117', { timeout: 600000 }, async () => {
  await walk([1920, 1117]);
});

test('every page at the small window, 1219x709', { timeout: 600000 }, async () => {
  await walk([1219, 709]);
});
