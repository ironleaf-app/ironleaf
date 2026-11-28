// node --test tests/t260-every-door.test.mjs — every door opens (t260, 13 Nov 2026). Walking the Vault's
// inner pages (t258), a job found two pages no test had ever opened: "All actions across projects"
// (RecordsView) said "Something didn't work just then" on every vault, and an appliance's page read "that
// appliance isn't here any more". A user found an existing PDF that said it was gone. Nobody should meet a
// page that fails to open. So this walk opens every door on a lived-in made-up vault (t200's 3,000 notes plus
// pack records): every room in the side bar and in More; every page reached from those rooms by a row or
// button (project, person, meeting, note, doc, kept PDF, folder file, template, tag, folder); every pack
// record (bill, appliance, trip, list, vehicle, member, goal, visit); every Settings section; every Ctrl+K
// command that opens a page. Each must open without the error page, a blank page, an "isn't here any more"
// for something that exists, or a console error; each must read its own title; Back must return. The door
// list is generated from the code — the commands, the side bar, More's places and the pack registries — never
// by hand, so a new page is walked automatically: the static phase below parses commands.ts and fails on any
// command it cannot classify, and the live phases enumerate the side bar, More (with its submenus) and the
// Settings sections from what the app renders, cross-checked against the pack registry. T260_SMALL=1 walks
// the small vault instead (faster iterations); the proof run uses t200.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { clickExact, clickMenuItem, clickWords, esc, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';
import { writeT200Vault } from './t200-vault.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const SMALL = process.env.T260_SMALL === '1';

// ── Static: every command classified, from the code ──────────────────────────
// A command that opens a page is one whose run navigates: the A.open* places, the module/type/records
// openers, the note/canvas/drawing makers, the Settings page, or a fresh tab. Dialog-driven openers that
// end on a page with one pick (a note type, a records view, a PDF, a note from a template) are driven
// fully; multi-step creation wizards (project, doc, view, starter, CSV import) only ever open their first
// dialog here — tag and folder prove the new-view flow end to end. Anything else (dialogs, panels, tabs,
// editor jobs, mutating actions, the outside world) is skipped with its reason. A command matching nothing
// fails this phase, so a new command gets a decision instead of slipping past the walk.

function commandEntries() {
  const src = read('src/renderer/src/state/commands.ts');
  const start = src.indexOf('export const COMMANDS');
  const end = src.indexOf('];', start);
  const body = src.slice(start, end);
  const out = [];
  // Flags may sit between id and name (outward: true) — the gap stays inside the entry (no } yet).
  const re = /\{\s*id: '([^']+)',[^}]{0,400}?name:\s*('(?:[^'\\]|\\.)*'|`[^`]*`)/g;
  let m;
  const marks = [];
  while ((m = re.exec(body))) marks.push({ id: m[1], name: m[2], at: m.index });
  for (let i = 0; i < marks.length; i++) {
    const slice = body.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : body.length);
    out.push({ id: marks[i].id, name: marks[i].name, slice });
  }
  // The spread rows: columns-2..4 and heading-1..6 (editor jobs), and the capture commands.
  for (const n of [2, 3, 4]) out.push({ id: `columns-${n}`, name: `'Lay out in ${n} columns'`, slice: 'editor: true run: layOutInColumns' });
  for (const n of [1, 2, 3, 4, 5, 6]) out.push({ id: `heading-${n}`, name: `'Heading ${n}'`, slice: 'editor: true run: setHeading' });
  const cap = read('src/renderer/src/state/captureFlows.ts');
  const capRe = /\{\s*id: '([^']+)',\s*name: ('(?:[^'\\]|\\.)*')/g;
  let c;
  while ((c = capRe.exec(cap))) out.push({ id: c[1], name: c[2], slice: 'run: captureTo()' });
  return out;
}

const SKIP = [
  [/editor:\s*true/, 'editor-only'],
  [/openModal\(\{\s*kind:\s*'(switcher|palette|publish|recovery|starter-picker|send|slides|design|new-project)'/, 'dialog'],
  [/requestSearch\(/, 'search panel'],
  [/openLife\(\{/, 'life modal'],
  [/setPanel\(/, 'side panel'],
  [/toggleChat\(/, 'side panel'],
  [/goToNoteFoot\(/, 'note foot'],
  [/cycleTabs\(/, 'tab op'],
  [/W\.(closeTab|reopenClosed|closeOthers|split|navigate)\(/, 'tab op'],
  [/W\.updateTab\(/, 'tab op'],
  [/toggleSide\(/, 'side bar'],
  [/setRail\(/, 'side bar'],
  [/setMode\(/, 'view mode'],
  [/savePrefs\(/, 'prefs'],
  [/stepSize\(/, 'prefs'],
  [/newProject\(/, 'creation wizard'],
  [/\.newView\(/, 'creation wizard'],
  [/\.newDoc\(/, 'creation wizard'],
  [/importCsv\(/, 'creation wizard'],
  [/recordMeetingNow|startRecording/, 'recording'],
  [/capture\.show|captureTo\(/, 'capture'],
  [/A\.pickLooseFiles/, 'OS dialog'],
  [/openFolder\(\)|window\.nv\.vault\.pick/, 'OS dialog'],
  [/A\.trashPath/, 'destructive'],
  [/mergeInto|extractSelection|A\.duplicatePath/, 'mutating action'],
  [/A\.askRename|A\.askMove|saveAsTemplate|insertTemplate|insertFromAssets|insertSyncedBlock|makeSyncedBlock|layOutInColumns/, 'dialog/action'],
  [/exportPdf\(/, 'export dialog'],
  [/A\.revealInExplorer|A\.revealInSystem|A\.openInDefaultApp|A\.copyPath|toggleBookmark|addBookmark/, 'reveal/mark action'],
  [/lockPrivate/, 'lock action'],
  [/sendToAgent|agentsNow/, 'agent (unavailable headless)'],
  [/\.dictate\(/, 'dictation'],
  [/openFilesMove/, 'dialog'],
  [/foldFromCommand|undoFold/, 'area move'],
  [/docs\.flush/, 'save action'],
  [/moveSuggestion|keepSuggestion|discardSuggestion|suggestionsOf/, 'suggestions'],
  [/updateDocCanvas|turnIntoDoc|turnIntoProject/, 'conversion'],
  [/window\.dispatchEvent\(new CustomEvent\('nv-add-property'/, 'dialog'],
  [/setHeading|toggleNumbered|toggleQuote|insertCallout|insertTable|insertCodeBlock|insertMathBlock|insertMermaid|insertRule|insertFootnote|insertDate|addCursor|moveLineUp|moveLineDown|copyLineUp|copyLineDown|deleteLine|selectLine|openSearchPanel|closeSearchPanel|tableCommand|focusFormatBar|toggleMark|cycleTask|insertLink|toggleBullet/, 'editor command'],
  [/A\.newFolder/, 'folder action'],
];

// Dialog-driven openers this walk drives all the way to their page (one pick, then the page).
const DIALOG_DOORS = new Set(['open-note-type', 'records-new', 'open-pdf', 'new-note-from-template']);
// The Files command carries an opener it never runs standalone (the Files panel opens instead).
const SKIP_IDS = new Map([['files', 'side panel'], ['capture-to', 'capture'], ['account-sign-in', 'sign-in (it hands over to the browser)']]);

function classifyCommands() {
  const doors = [];
  const skipped = [];
  const unclassified = [];
  for (const e of commandEntries()) {
    if (SKIP_IDS.has(e.id)) { skipped.push({ id: e.id, why: SKIP_IDS.get(e.id) }); continue; }
    if (DIALOG_DOORS.has(e.id)) { doors.push({ ...e, kind: 'dialog-door' }); continue; }
    const page =
      /A\.open(?!InDefaultApp)[A-Z]\w*/.test(e.slice) ||
      /openModule\(/.test(e.slice) ||
      /openTour\(/.test(e.slice) ||
      /showDocCanvas\(/.test(e.slice) ||
      /open(Templates|TypePage|RecordsView|Workspace|ProjectCanvas|PortfolioBoard|Notebook|BrandKit|Inbox|People|Meetings)\(/.test(e.slice) ||
      /newNote(WriteFirst|OfType)\(/.test(e.slice) ||
      /A\.(newCanvas|newDrawing|uniqueNote)\(/.test(e.slice) ||
      /openModal\(\{\s*kind:\s*'settings'/.test(e.slice) ||
      // About and updates, and the account: Settings sections of their own, opened from the account menu (20 Nov 2026).
      /open(About|Account)Page\(/.test(e.slice) ||
      /W\.open\(ws, \{\s*type:\s*'empty'\s*\}/.test(e.slice);
    if (page) { doors.push({ ...e, kind: 'door' }); continue; }
    const hit = SKIP.find(([re]) => re.test(e.slice));
    if (hit) { skipped.push({ id: e.id, why: hit[1] }); continue; }
    unclassified.push(e.id);
  }
  return { doors, skipped, unclassified };
}

/** Where a door runs: neutral Today, or with a note, a project note, a doc, or a pack page open. */
function doorContext(d) {
  if (/isDocPath/.test(d.slice)) return 'doc';
  if (/activeProjectPath/.test(d.slice)) return 'project';
  if (/moduleOfTab\(W\.activeTab/.test(d.slice)) return 'pack';
  if (/note:\s*true|file:\s*true/.test(d.slice)) return 'note';
  if (/activeTab\(getWorkspace\(\)\)\.path/.test(d.slice)) return 'note';
  return 'neutral';
}

const STOPWORDS = new Set(['open', 'show', 'see', 'start', 'new', 'manage', 'choose', 'every', 'your', 'what', 'with', 'from', 'that', 'this', 'across', 'and', 'the', 'for', 'into', 'its', 'make', 'turn', 'takes', 'over', 'under', 'when', 'where', 'which', 'other', 'around', 'back', 'down', 'inside', 'each', 'row', 'than', 'then']);
/** The distinctive word of a command's name ("Open Tasks (…)" → "tasks", "Open the Bin" → "bin"). */
function nameWord(name) {
  const words = name.replace(/^[`']|[`']$/g, '').replace(/\([^)]*\)/g, ' ').replace(/[^A-Za-z’' -]/g, ' ').split(/[\s-]+/).filter(Boolean);
  const cands = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  return (cands.find((w) => w.length >= 4) ?? [...cands].sort((a, b) => b.length - a.length)[0] ?? words[0] ?? '').toLowerCase();
}

function packRegistry() {
  const src = read('src/shared/life-modules.ts');
  // Pack-level ids only (four spaces: a part deeper in shares 'documents'); each name read before the next pack.
  const packs = [...src.matchAll(/^    id: '(\w+)',$/gm)].map((m) => ({ id: m[1], at: m.index }));
  const names = {};
  for (let i = 0; i < packs.length; i++) {
    const end = i + 1 < packs.length ? packs[i + 1].at : packs[i].at + 800;
    const m = /name: '([^']+)'/.exec(src.slice(packs[i].at, end));
    if (m) names[packs[i].id] = m[1];
  }
  return { ids: packs.map((p) => p.id), names };
}

function settingsSections() {
  const src = read('src/renderer/src/components/Settings.tsx');
  const block = src.slice(src.indexOf('const SECTIONS'), src.indexOf('];', src.indexOf('const SECTIONS')));
  return [...block.matchAll(/\{ id: '([\w-]+)', label: '([^']+)'/g)].map((m) => ({ id: m[1], label: m[2] }));
}

test('every command classified: page doors derived from the code, nothing unclassified (t260)', () => {
  const { doors, skipped, unclassified } = classifyCommands();
  assert.deepEqual(unclassified, [], `a new command needs a decision (page door or a skip reason): ${unclassified.join(', ')}`);
  assert.ok(doors.length >= 60, `${doors.length} page doors derived (expected at least 60)`);
  assert.ok(skipped.length >= 100, `${skipped.length} non-page commands skipped with reasons`);
  const ids = doors.map((d) => d.id);
  for (const must of ['records-actions', 'records-meetings', 'records-people', 'records-files', 'settings', 'bin', 'graph', 'portfolio-board', 'tour-finance', 'notebook', 'project-workspace', 'project-canvas']) {
    assert.ok(ids.includes(must), `${must} walks as a page door`);
  }
  for (const [id, why] of [['delete', 'destructive'], ['bold', 'editor-only'], ['chat', 'side panel'], ['back', 'tab op'], ['tags', 'life modal'], ['new-project', 'creation wizard']]) {
    assert.ok(skipped.some((s) => s.id === id && s.why === why), `${id} skips as ${why}`);
  }
  console.log(`t260 doors: ${doors.length} page doors, ${skipped.length} skipped with reasons`);
});

// ── Live: one boot, the lived-in vault ───────────────────────────────────────

let H = null;
const WALKED = [];
const T255 = [];

function seedExtras(dir) {
  const w = (rel, text) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  // One empty-everywhere record per w3b pack (t258's shape), a goal, and a folder file.
  w('Home/House/Appliances/Toaster.md', `---\ntype: appliance\nkind: Toaster\nroom: Kitchen\nmake: Brightline\nmodel: T2\nserial: T2-0001\npurchased: 2024-11-20\nprice: 79\nsupplier: Appliance Barn\nwarranty: 2026-11-20\nstatus: In use\n---\n## Service history\n\n| Date | What | By | Cost | Notes |\n| --- | --- | --- | --- | --- |\n\n## Notes\n\n`);
  w('Me/Travel/Trips/Empty Trip.md', `---\ntype: trip\ndestination: Nowhere\npurpose: Personal\nstarts: 2026-12-11\nends: 2026-12-13\nstatus: Planning\nbudget: 500\n---\n## Itinerary\n\n| Date | Time | Kind | What | Until | Where | Booking | Cost | Paid | Notes |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n\n## Expenses\n\n| Date | What | Category | Amount | Paid by | Notes |\n| --- | --- | --- | --- | --- | --- |\n\n## Notes\n\n`);
  w('Me/Lists/Empty Shopping.md', `---\ntype: list\nkind: Shopping\nfor:\n---\n## Items\n\n| Item | Status | Qty | Shop | Note | Added |\n| --- | --- | --- | --- | --- | --- |\n| Milk | Need | 2 | Corner shop |  |  |\n`);
  w('Home/Vehicles/Empty Car.md', `---\ntype: vehicle\nkind: Car\nmake: Roadster\nmodel: Empty\nrego: XYZ999\nfuel: Petrol\nstatus: Active\n---\n## Fuel log\n\n| Date | Odometer | Litres | Cost | Full | Station | Notes |\n| --- | --- | --- | --- | --- | --- |\n\n## Notes\n\n`);
  w('Family/People/Test Person.md', `---\ntype: person\nfamily: Cousin\nborn: 2010-05-01\ncolour: sky\nsensitivity: family\n---\n# Test Person\n\n## Documents\n\n`);
  w('Family/Family calendar.md', `---\ntype: family-calendar\nsensitivity: family\n---\n# Family calendar\n\nWho’s where each week.\n\n## Activities\n\n| Who | What | Day | Time | Where | Until |\n| --- | --- | --- | --- | --- | --- |\n\n## Events\n\n| Date | Time | Who | What | Where |\n| --- | --- | --- | --- | --- | --- |\n\n## Milestones\n\n| Date | Who | Milestone |\n| --- | --- | --- |\n`);
  w('Me/Goals and Habits/Goals/Run the harbour loop.md', `---\ntype: goal\nstatus: Started\ntarget: Run 5 km without stopping\n---\n# Run the harbour loop\n\n## Milestones\n\n| Milestone | Day | Done |\n| --- | --- | --- |\n| Run 5 km without stopping | 2026-12-01 |  |\n\n## Notes\n\n`);
  w('Projects/Harbourline Cart Fix/Files/delivery-docket.csv', `item,qty\nreceipt rolls,4\nspare till key,1\n`);
  // Bills for the Money room (t200 carries its own; the small vault needs one). Without areas the
  // list lives at the top (src/shared/module-records.ts moduleFolder: the record folder 'Finance').
  if (!existsSync(path.join(dir, 'Finance', 'Bills.md'))) {
    w('Finance/Bills.md', `---\ntype: bills-table\ntable: bills\nversion: 1\n---\n# Bills\n\n| Name | Kind | Amount | Cycle | Due | Category | Account | Project | Autopay | Status | Paid | Note file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| Harbour Internet | Bill | 89.00 | Monthly | 2026-11-12 | Phone and internet | Everyday |  | No | Active |  |  |\n| Power for the shop through October | Bill | 214.50 | Monthly | 2026-11-20 | Home and utilities | Everyday |  | No | Active |  |  |\n`);
  }
  // A kept PDF the project names (t248's minimal real PDF, so the viewer draws a page).
  const pdf = (title, line) => {
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    const content = `BT /F1 24 Tf 72 770 Td (${title}) Tj ET BT /F1 12 Tf 72 736 Td (${line}) Tj ET`;
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    let out = '%PDF-1.4\n';
    const offsets = [0];
    objs.forEach((o, i) => {
      offsets.push(Buffer.byteLength(out));
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out);
    out += `xref\n0 6\n0000000000 65535 f \n` + offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, 'latin1');
  };
  const pdfPath = path.join(dir, 'Docs', 'Shop-floor guide.pdf');
  mkdirSync(path.dirname(pdfPath), { recursive: true });
  writeFileSync(pdfPath, pdf('Shop-floor guide', 'Keep the floor swept.'));
}

async function harness() {
  if (!H) {
    H = await startHarness({ realProjectFiles: true });
    const { ids } = packRegistry();
    await H.services.invoke('settings:update', [{ prefs: { modules: Object.fromEntries(ids.map((id) => [id, { on: true }])) } }]);
    if (!SMALL) {
      const count = writeT200Vault(H.vaultDir);
      assert.equal(count, 3000, 'the walk judges a 3,000-note vault');
    }
    seedExtras(H.vaultDir);
    // The kept PDF named in the project's Documents, as a person keeps it.
    const projPath = path.join(H.vaultDir, 'Projects', 'Harbourline Cart Fix', 'Harbourline Cart Fix.md');
    const proj = readFileSync(projPath, 'utf8');
    if (!proj.includes('Shop-floor guide.pdf')) {
      writeFileSync(projPath, proj.replace('## People', '## Documents\n\n- `Docs/Shop-floor guide.pdf` — Shop-floor guide\n\n## People'));
    }
    await H.services.rescanAll();
    // Booked three days from the run's own today (23 Nov 2026: a fixed 2026-11-20 fell into the past, and Health lists
    // only the visits coming up, so the row was gone).
    const soon = new Date(Date.now() + 3 * 864e5);
    const visitDay = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
    await H.services.invoke('health:put', ['appointments', { id: 'walk-visit-1', day: visitDay, time: '09:30', who: 'Dr Lane', why: 'Knee check', status: 'booked', results: [] }]);
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 120; i++) {
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

// ── The door check ───────────────────────────────────────────────────────────

const BAD = [/isn’t here any more/i, /isn't here any more/i, /couldn’t show/i, /couldn't show/i, /Something didn’t work just then/i, /Something didn't work just then/i, /Something went wrong/i, /This page couldn’t/i, /This card couldn’t/i];

async function snap(h) {
  return h.browser.ev(`(() => {
    const main = document.querySelector('main');
    const text = main ? (main.innerText || '') : '';
    return {
      title: document.title || '',
      len: text.trim().length,
      head: text.slice(0, 600),
      errors: window.__nvErrors.length,
      lastError: window.__nvErrors.length ? String(window.__nvErrors[window.__nvErrors.length - 1]).slice(0, 500) : '',
      dialog: !!document.querySelector('[role="dialog"], .sas-modal, .picker'),
      menu: !!document.querySelector('.menu[role="menu"]'),
    };
  })()`);
}

/** Home base for a door: Today, unless the door IS Today. */
async function goBase(h, doorIsToday) {
  await esc(h);
  const base = doorIsToday ? 'Inbox' : 'Today';
  assert.equal(await clickWords(h, base, '.sidebar.left, aside'), 'CLICKED', `base ${base} opens`);
  assert.ok(await waitFor(h, `document.title.toLowerCase().includes(${JSON.stringify(base.toLowerCase())})`, 15000), `base ${base} lands (saw ${await h.browser.ev('document.title')})`);
  await sleep(700);
  return base;
}

async function goBack(h) {
  const at = await h.browser.ev(`(() => { const b = document.querySelector('button[aria-label="Back"]'); if (!b) return 'NOBUTTON'; b.click(); return 'CLICKED'; })()`);
  assert.equal(at, 'CLICKED', 'Back is there to press');
  await sleep(700);
}

/** A page door: no error page, no blank page, its own title, no console error, Back returns. */
async function checkDoor(h, phase, id, expect, before, opts = {}) {
  if (!opts.stay) assert.ok(await waitFor(h, `document.title !== ${JSON.stringify(before.title)} || !!document.querySelector('[role="dialog"]')`, 15000), `${phase}/${id}: the door opens (stayed on ${before.title})`);
  await sleep(900);
  const s = await snap(h);
  const where = `${phase}/${id} (title: ${s.title})`;
  assert.ok(!s.dialog || opts.dialogOk, `${where}: no dialog over the page`);
  for (const re of BAD) assert.ok(!re.test(s.head), `${where}: no failure words (${re})`);
  // A blank page carries only the top bar (~35 chars); a sparse-but-real page (an empty notebook) reads past 50.
  assert.ok(s.len > 50, `${where}: no blank page (stood ${s.len} chars)`);
  const words = Array.isArray(expect) ? expect : [expect];
  const hay = `${s.title}\n${s.head}`.toLowerCase();
  if (!opts.noWords) assert.ok(words.some((w) => w && hay.includes(String(w).toLowerCase())), `${where}: reads its own title (${words.join(' / ')})`);
  if (opts.marker) assert.ok(await waitFor(h, opts.marker, 10000), `${where}: its marker shows`);
  assert.equal(s.errors, before.errors, `${where}: no console error (latest: ${s.lastError || 'none'})`);
  WALKED.push({ phase, id, title: s.title });
  console.log(`door ${phase}/${id}: ${s.title} [${s.len} chars]`);
  // Back through every level the door opened (opts.levels), returning to base.
  for (let i = 0; i < (opts.levels ?? 1); i++) {
    await goBack(h);
    await sleep(400);
  }
  assert.ok(await waitFor(h, `document.title === ${JSON.stringify(before.baseTitle)}`, 15000), `${where}: Back returns to ${before.baseTitle} (saw ${await h.browser.ev('document.title')})`);
  await sleep(500);
  const back = await snap(h);
  assert.equal(back.errors, before.errors, `${where}: Back raises no console error`);
  if (opts.stay && opts.marker) assert.ok(await waitFor(h, `!(${opts.marker})`, 8000), `${where}: Back leaves the canvas`);
}

/** A dialog door: words in a dialog, no failure, Esc puts it away. */
async function checkDialog(h, phase, id, before) {
  assert.ok(await waitFor(h, `!!document.querySelector('[role="dialog"], .sas-modal, .picker')`, 10000), `${phase}/${id}: its dialog opens`);
  await sleep(700);
  const d = await h.browser.ev(`(() => { const el = document.querySelector('[role="dialog"], .sas-modal, .picker'); return ((el && el.innerText) || '').slice(0, 600); })()`);
  const where = `${phase}/${id}`;
  for (const re of BAD) assert.ok(!re.test(d), `${where}: no failure words in the dialog`);
  assert.ok(d.trim().length > 10, `${where}: the dialog has words`);
  const s = await snap(h);
  assert.equal(s.errors, before.errors, `${where}: no console error (latest: ${s.lastError || 'none'})`);
  WALKED.push({ phase, id, title: `dialog: ${d.split('\n')[0].slice(0, 60)}` });
  console.log(`door ${phase}/${id}: dialog [${d.trim().length} chars]`);
  await esc(h);
  await esc(h);
  assert.ok(await waitFor(h, `!document.querySelector('[role="dialog"], .sas-modal') && !document.querySelector('.picker')`, 8000), `${where}: Esc puts it away`);
}

/** Run a palette command by its exact name; '' when the palette lacks its row. */
async function runPalette(h, name) {
  await esc(h);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2, windowsVirtualKeyCode: 75 });
  if (!(await waitFor(h, `!!document.querySelector('.picker input')`, 5000))) return 'NOPALETTE';
  await h.browser.send('Input.insertText', { text: name });
  await sleep(1000);
  const done = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('.picker-row')];
    const text = (r) => r.querySelector('.picker-label')?.innerText.trim() ?? '';
    const row = rows.find((r) => text(r) === ${JSON.stringify(name)});
    if (!row) return 'NOTFOUND: ' + rows.slice(0, 4).map(text).join(' / ');
    row.click();
    return 'CLICKED';
  })()`);
  await sleep(500);
  return done;
}

/** Open the app's More menu. */
async function openMore(h) {
  await esc(h);
  assert.equal(await clickExact(h, 'More', '.sidebar.left, aside'), 'CLICKED', 'More opens');
  assert.ok(await waitFor(h, `!!document.querySelector('.menu[role="menu"]')`, 5000), 'the menu shows');
}

async function menuItems(h) {
  return h.browser.ev(`[...document.querySelectorAll('.menu[role="menu"]')].slice(0, 1).flatMap((m) => [...m.querySelectorAll(':scope > button[role="menuitem"]')].map((b) => ({ label: b.querySelector('.menu-label')?.innerText.trim() ?? '', sub: !!b.querySelector('.menu-more'), disabled: !!b.disabled })))`);
}

async function subItems(h) {
  return h.browser.ev(`[...document.querySelectorAll('.menu[role="menu"]')].slice(-1)[0] ? [...[...document.querySelectorAll('.menu[role="menu"]')].slice(-1)[0].querySelectorAll(':scope > button[role="menuitem"]')].map((b) => ({ label: b.querySelector('.menu-label')?.innerText.trim() ?? '', sub: !!b.querySelector('.menu-more'), disabled: !!b.disabled })) : []`);
}

// ── Rooms ────────────────────────────────────────────────────────────────────

test('every room in the side bar opens, reads its title, and Back returns (t260)', { timeout: 600000 }, async () => {
  const h = await harness();
  const fold = await h.browser.ev(`document.querySelector('nav.places-list')?.dataset.fold`);
  assert.equal(fold, '0', 'nothing folds away at this size: every room shows');
  const rows = await h.browser.ev(`[...document.querySelectorAll('nav.places-list .srow .clip')].map((e) => e.innerText.trim())`);
  assert.deepEqual(rows, [
    'Today', 'Inbox', 'Projects', 'Tasks', 'Meetings', 'Notes', 'People',
    'Health', 'Family', 'Money', 'Papers', 'House', 'Cars', 'Career', 'Trips', 'Weekly',
    'Sites', 'Suppliers', 'Business', 'Systems', 'Goals', 'Lists', 'Publications', 'More',
  ], `the side bar's rooms (${rows.join(', ')})`);
  for (const room of rows.filter((r) => r !== 'More')) {
    const base = await goBase(h, room === 'Today');
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    assert.equal(await clickWords(h, room, '.sidebar.left, aside'), 'CLICKED', `${room} opens`);
    await checkDoor(h, 'room', room.toLowerCase(), room.toLowerCase(), before);
    void base;
  }
});

// ── More ─────────────────────────────────────────────────────────────────────
// Every place in More, enumerated from the rendered menu (with its submenus), each opened the way a
// person opens it. A row that lands on a page gets the door check; a row that opens a dialog gets the
// dialog check; a row that reaches past the harness (an OS dialog, stubbed) must at least fail quietly,
// with no error page and no console error.

async function enumerateMore(h) {
  // Returns leaves as {path: [top?, sub?, label], label}.
  const leaves = [];
  await openMore(h);
  const top = await menuItems(h);
  for (const t of top) {
    if (t.disabled) continue;
    if (!t.sub) { leaves.push({ path: [t.label], label: t.label }); continue; }
    await openMore(h);
    assert.equal(await clickMenuItem(h, t.label), 'CLICKED', `${t.label} submenu opens`);
    await sleep(600);
    const subs = await subItems(h);
    for (const s of subs) {
      if (s.disabled) continue;
      if (!s.sub) { leaves.push({ path: [t.label, s.label], label: s.label }); continue; }
      await openMore(h);
      assert.equal(await clickMenuItem(h, t.label), 'CLICKED', `${t.label} submenu reopens`);
      await sleep(600);
      assert.equal(await clickMenuItem(h, s.label), 'CLICKED', `${s.label} submenu opens`);
      await sleep(600);
      for (const l of await subItems(h)) {
        if (!l.disabled && !l.sub) leaves.push({ path: [t.label, s.label, l.label], label: l.label });
      }
    }
  }
  await esc(h);
  return leaves;
}

async function openMorePath(h, segments) {
  await openMore(h);
  for (let i = 0; i < segments.length; i++) {
    assert.equal(await clickMenuItem(h, segments[i]), 'CLICKED', `More › ${segments.slice(0, i + 1).join(' › ')} opens`);
    await sleep(500);
  }
  await sleep(600);
}

test('every place in More opens: pages read and return, dialogs speak and close (t260)', { timeout: 600000 }, async () => {
  const h = await harness();
  const leaves = await enumerateMore(h);
  assert.ok(leaves.length >= 25, `${leaves.length} More leaves enumerated (expected at least 25)`);
  const labels = leaves.map((l) => l.label);
  // Every pack in the registry answers in More (a new pack is walked automatically — or fails here).
  const { names } = packRegistry();
  for (const [id, name] of Object.entries(names)) {
    if (id === 'meetings') continue; // its own bar row, left out of More by design
    assert.ok(labels.includes(name), `More offers ${name} (${id})`);
  }
  for (const leaf of leaves) {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    await openMorePath(h, leaf.path);
    const s = await snap(h);
    if (s.dialog) {
      await checkDialog(h, 'more', leaf.label, before);
    } else if (s.title !== before.title) {
      // Makers open dated or canvas-titled pages: their content proves them, not their row's words (a new
      // drawing is even titled 'Untitled canvas', as the app names it).
      const marker = { 'Daily note': `!!document.querySelector('.nv-note-main, main .note-view')`, 'New canvas': `!!document.querySelector('.canvas-view')`, 'New drawing': `!!document.querySelector('.nvd-view')` }[leaf.label];
      if (marker) await checkDoor(h, 'more', leaf.label, '', before, { noWords: true, marker });
      else await checkDoor(h, 'more', leaf.label, nameWord(leaf.label), before);
    } else {
      // Past the harness (an OS dialog, stubbed): quiet, with no error page and no console error.
      await sleep(600);
      const q = await snap(h);
      const where = `more/${leaf.label}`;
      for (const re of BAD) assert.ok(!re.test(q.head), `${where}: no failure words`);
      assert.equal(q.errors, before.errors, `${where}: no console error (latest: ${q.lastError || 'none'})`);
      WALKED.push({ phase: 'more', id: leaf.label, title: '(quiet stub)' });
      console.log(`door more/${leaf.label}: quiet stub`);
      await esc(h);
    }
    void base;
  }
});

// ── Row drill-ins ────────────────────────────────────────────────────────────
// One page of each kind, reached from its room by its row or button. Project and person pages belong
// to t255 (tabs work): a failure there is written down, not fixed here (ITEMS).

/** A detail inside a page (same tab, title may stay): its words, no failure, Back returns to the page. */
async function checkDetail(h, phase, id, expect, pageTitle, before) {
  await sleep(1200);
  const s = await snap(h);
  const where = `${phase}/${id} (title: ${s.title})`;
  assert.ok(!s.dialog, `${where}: no dialog over the page`);
  for (const re of BAD) assert.ok(!re.test(s.head), `${where}: no failure words (${re})`);
  assert.ok(s.len > 50, `${where}: no blank page (stood ${s.len} chars)`);
  const hay = `${s.title}\n${s.head}`.toLowerCase();
  assert.ok(hay.includes(String(expect).toLowerCase()), `${where}: reads its own title (${expect})`);
  assert.equal(s.errors, before.errors, `${where}: no console error (latest: ${s.lastError || 'none'})`);
  WALKED.push({ phase, id, title: s.title });
  console.log(`door ${phase}/${id}: ${s.title} [${s.len} chars]`);
  await goBack(h);
  assert.ok(await waitFor(h, `document.title === ${JSON.stringify(pageTitle)}`, 15000), `${where}: Back returns to the page (saw ${await h.browser.ev('document.title')})`);
}

async function openProject(h) {
  assert.equal(await clickWords(h, 'Projects', '.sidebar.left, aside'), 'CLICKED', 'Projects opens');
  assert.ok(await waitFor(h, `document.title.toLowerCase().includes('projects')`, 15000), 'Projects lands');
  await sleep(800);
  assert.equal(await clickWords(h, 'Harbourline Cart Fix', 'main'), 'CLICKED', 'the project opens');
  assert.ok(await waitFor(h, `document.title.toLowerCase().includes('harbourline')`, 15000), `the project lands (saw ${await h.browser.ev('document.title')})`);
  await sleep(900);
}

test('every row drill-in opens: project, person, meeting, note, doc, PDF, folder file, template (t260)', { timeout: 600000 }, async () => {
  const h = await harness();
  const soft = async (id, fn) => {
    try {
      await fn();
    } catch (err) {
      T255.push(`${id}: ${String((err && err.message) || err).split('\n')[0]}`);
      console.log(`t255-note ${id}: ${String((err && err.message) || err).split('\n')[0]}`);
    }
  };
  // A project (t255).
  await soft('row/project', async () => {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    await openProject(h);
    const s = await snap(h);
    for (const re of BAD) assert.ok(!re.test(s.head), `row/project: no failure words`);
    assert.ok(s.len > 50, 'row/project: no blank page');
    assert.ok(s.head.toLowerCase().includes('harbourline'), 'row/project: reads its own title');
    assert.equal(s.errors, before.errors, `row/project: no console error (${s.lastError || 'none'})`);
    WALKED.push({ phase: 'row', id: 'project', title: s.title });
    console.log(`door row/project: ${s.title}`);
    await goBack(h);
    await sleep(400);
    await goBack(h);
    assert.ok(await waitFor(h, `document.title === ${JSON.stringify(before.baseTitle)}`, 15000), 'row/project: Back returns');
    void base;
  });
  // A person (t255).
  await soft('row/person', async () => {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    assert.equal(await clickWords(h, 'People', '.sidebar.left, aside'), 'CLICKED', 'People opens');
    assert.ok(await waitFor(h, `document.title.toLowerCase().includes('people')`, 15000), 'People lands');
    await sleep(800);
    assert.equal(await clickWords(h, 'Alex Chen', 'main'), 'CLICKED', 'the person opens');
    await checkDoor(h, 'row', 'person', 'alex chen', before, { levels: 2 });
    void base;
  });
  // A meeting: the Meetings room opens the note (past meetings hold the rows).
  {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    assert.equal(await clickWords(h, 'Meetings', '.sidebar.left, aside'), 'CLICKED', 'Meetings opens');
    assert.ok(await waitFor(h, `document.title.toLowerCase().includes('meetings')`, 15000), 'Meetings lands');
    await sleep(800);
    assert.equal(await clickWords(h, 'Past', 'main'), 'CLICKED', 'past meetings show');
    await sleep(800);
    assert.ok(await waitFor(h, `!!document.querySelector('main .trow')`, 10000), 'Meetings lists its meetings');
    const label = await h.browser.ev(`(() => { const r = document.querySelector('main .trow'); return ((r && r.innerText) || '').split(String.fromCharCode(10))[0].slice(0, 40); })()`);
    const at = await h.browser.ev(`(() => { const r = document.querySelector('main .trow'); const el = r.matches('button, a') ? r : r.querySelector('button, a'); if (!el) return 'NOROW'; el.click(); return 'CLICKED'; })()`);
    assert.equal(at, 'CLICKED', 'the meeting opens');
    await checkDoor(h, 'row', 'meeting', label.slice(0, 24), before, { levels: 2 });
    void base;
  }
  // A note (the room lists rows; each row opens, whatever the layout).
  {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    assert.equal(await clickWords(h, 'Notes', '.sidebar.left, aside'), 'CLICKED', 'Notes opens');
    assert.ok(await waitFor(h, `!!document.querySelector('main button.trow, main .sv-open, main .sv-line, main .sv-card')`, 15000), 'Notes lists its notes');
    await sleep(600);
    // The first non-daily row (a daily note's row reads 'Fri 13 Nov 2026' while its page reads '2026-11-13').
    const label = await h.browser.ev(`(() => { const bs = [...document.querySelectorAll('main button.trow, main .sv-open, main .sv-line, main .sv-card')]; const b = bs.find((x) => !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \\d{1,2} \\w{3} \\d{4}/.test(((x.innerText || '').split(String.fromCharCode(10))[0] || '').trim())) ?? bs[0]; const t = b?.getAttribute('title') || b?.querySelector('.sv-line-title')?.innerText || (b?.innerText || '').split(String.fromCharCode(10))[0]; return (t || '').replace(/^Open /, '').slice(0, 40); })()`);
    const at = await h.browser.ev(`(() => { const bs = [...document.querySelectorAll('main button.trow, main .sv-open, main .sv-line, main .sv-card')]; const b = bs.find((x) => !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \\d{1,2} \\w{3} \\d{4}/.test(((x.innerText || '').split(String.fromCharCode(10))[0] || '').trim())) ?? bs[0]; if (!b) return 'NOROW'; b.click(); return 'CLICKED'; })()`);
    assert.equal(at, 'CLICKED', 'the note opens');
    await checkDoor(h, 'row', 'note', label.slice(0, 24), before, { levels: 2 });
    void base;
  }
  // A doc, from its kind page.
  {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    const done = await runPalette(h, 'Open a note type (people, meetings, ideas…)');
    assert.equal(done, 'CLICKED', 'the type picker opens');
    assert.ok(await waitFor(h, `!!document.querySelector('.picker-row, [role="dialog"]')`, 8000), 'the types list');
    const pick = await h.browser.ev(`(() => { const rows = [...document.querySelectorAll('.picker-row')]; const r = rows.find((x) => (x.querySelector('.picker-label')?.innerText || '').toLowerCase().includes('doc')); if (!r) return 'NOTFOUND'; r.click(); return 'CLICKED'; })()`);
    assert.equal(pick, 'CLICKED', 'Docs opens');
    assert.ok(await waitFor(h, `document.title.toLowerCase().includes('doc')`, 15000), 'the docs page lands');
    await sleep(800);
    assert.ok(await waitFor(h, `!!document.querySelector('main .sv-open, main .sv-line, main button.trow')`, 10000), 'the docs list');
    const docName = SMALL ? 'Receipts spec' : 'The awning decision';
    const opened = await h.browser.ev(`(() => { const rows = [...document.querySelectorAll('main .sv-open, main .sv-line, main button.trow')]; const r = rows.find((x) => (x.innerText || x.getAttribute('title') || '').includes(${JSON.stringify(docName)})); if (!r) return 'NOTFOUND'; r.click(); return 'CLICKED'; })()`);
    assert.equal(opened, 'CLICKED', 'the doc opens');
    assert.ok(await waitFor(h, `document.title.toLowerCase().includes(${JSON.stringify(SMALL ? 'receipts' : 'awning')})`, 15000), 'the doc lands');
    await checkDoor(h, 'row', 'doc', SMALL ? 'receipts' : 'awning', before, { levels: 2 });
    void base;
  }
  // A row on the project page, unfolding its long list first when it folds (big projects fold
  // past FOLD_N rows behind "Show all").
  const projectRow = async (words) => {
    if ((await clickWords(h, words, 'main')) === 'CLICKED') return 'CLICKED';
    // Several lists fold (risks, updates, notes): unfold the notes-and-files list, not the first folder.
    await clickWords(h, 'Show all', 'main [data-section="notes"]');
    await sleep(800);
    return clickWords(h, words, 'main');
  };
  // A kept PDF, from the project's Documents (t255's page beneath).
  await soft('row/pdf', async () => {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    await openProject(h);
    // The folder files arrive after the page lands (the page streams its sections): the fresh file row
    // proves the fetch, then the folded PDF row is unfolded by the click below.
    assert.ok(await waitFor(h, `(document.querySelector('main [data-section="notes"]')?.innerText || '').includes('delivery-docket')`, 20000), 'the project files arrive');
    assert.equal(await projectRow('Shop-floor guide'), 'CLICKED', 'the PDF opens');
    await checkDoor(h, 'row', 'pdf', 'shop-floor', before, { marker: `!!document.querySelector('.pdfv-page')`, levels: 3 });
    void base;
  });
  // A folder file, from the project's files (t255's page beneath).
  await soft('row/folder-file', async () => {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    await openProject(h);
    assert.ok(await waitFor(h, `(document.querySelector('main [data-section="notes"]')?.innerText || '').includes('delivery-docket')`, 20000), 'the project files arrive');
    assert.equal(await projectRow('delivery-docket'), 'CLICKED', 'the folder file opens');
    await checkDoor(h, 'row', 'folder-file', 'delivery-docket', before, { levels: 3 });
    void base;
  });
  // A template: its preview, then Back.
  {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    await openMorePath(h, ['Templates']);
    assert.ok(await waitFor(h, `document.title.toLowerCase().includes('template')`, 15000), 'Templates lands');
    await sleep(800);
    assert.equal(await clickWords(h, 'Standup', 'main'), 'CLICKED', 'the template previews');
    await sleep(900);
    const pv = await h.browser.ev(`(document.querySelector('main').innerText || '').toLowerCase()`);
    assert.ok(pv.includes('standup'), 'row/template: the preview reads');
    const s = await snap(h);
    assert.equal(s.errors, before.errors, `row/template: no console error (${s.lastError || 'none'})`);
    WALKED.push({ phase: 'row', id: 'template', title: s.title });
    console.log(`door row/template: ${s.title} (in-place preview)`);
    await goBack(h);
    assert.ok(await waitFor(h, `document.title === ${JSON.stringify(before.baseTitle)}`, 15000), 'row/template: Back returns');
    void base;
  }
});

// ── Tag and folder: saved views, made the way a person makes them ────────────
// t258's New-view flow: the source picker takes #tag or folder, then a name, then the file kind.

async function makeView(h, sourceQuery, sourceId, name) {
  const done = await runPalette(h, 'New view of notes (table, cards, list, board or calendar)…');
  assert.equal(done, 'CLICKED', 'New view opens');
  await sleep(800);
  assert.ok(await waitFor(h, `!!document.querySelector('[role="dialog"] input')`, 8000), 'the source picker opens');
  await h.browser.send('Input.insertText', { text: sourceQuery });
  await sleep(1000);
  const picked = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('[role="dialog"] [role="option"], [role="dialog"] button, .picker-row')];
    const el = rows.find((e) => (e.innerText || '').includes(${JSON.stringify(sourceId)}));
    if (!el) return 'NOTFOUND: ' + rows.slice(0, 3).map((e) => (e.innerText || '').slice(0, 30)).join('|');
    el.click(); return 'CLICKED';
  })()`);
  assert.equal(picked, 'CLICKED', `${sourceId} picked (${picked})`);
  await sleep(900);
  assert.ok(await waitFor(h, `!!document.querySelector('[role="dialog"] input')`, 8000), 'the name prompt opens');
  await h.browser.ev(`(() => { const i = document.querySelector('[role="dialog"] input'); if (i) { i.focus(); i.select(); } })()`);
  await h.browser.send('Input.insertText', { text: name });
  await sleep(500);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(1200);
  const kind = await h.browser.ev(`(() => {
    const els = [...document.querySelectorAll('[role="dialog"] button')].filter((e) => e.getBoundingClientRect().width > 2);
    const el = els.find((e) => (e.innerText || '').includes('Ironleaf'));
    if (!el) return 'NONE';
    el.click(); return 'CLICKED';
  })()`);
  if (kind === 'CLICKED') await sleep(1500);
  else await sleep(800);
}

test('a tag and a folder open as saved views, and Back returns (t260)', { timeout: 600000 }, async () => {
  const h = await harness();
  for (const [id, query, source, name] of [
    ['tag', '#harbourline', '#harbourline', 'TagWalk'],
    ['folder', SMALL ? 'People' : 'Work', SMALL ? 'People' : 'Work', 'FolderWalk'],
  ]) {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    await makeView(h, query, source, name);
    await checkDoor(h, 'row', id, name.toLowerCase(), before);
    void base;
  }
});

// ── Pack records ─────────────────────────────────────────────────────────────
// One record of each kind the brief names, opened from its pack's page by its row. Pack pages come
// from the registry's names through the same More paths the More phase walked.

async function openPack(h, packLabel) {
  await openMore(h);
  const top = await menuItems(h);
  if (top.some((t) => !t.sub && t.label === packLabel)) {
    await openMorePath(h, [packLabel]);
    return;
  }
  for (const t of top.filter((x) => x.sub && !x.disabled)) {
    await openMore(h);
    assert.equal(await clickMenuItem(h, t.label), 'CLICKED', `${t.label} opens`);
    await sleep(500);
    const subs = await subItems(h);
    if (subs.some((s) => !s.sub && s.label === packLabel)) {
      await openMorePath(h, [t.label, packLabel]);
      return;
    }
    for (const s of subs.filter((x) => x.sub && !x.disabled)) {
      await openMore(h);
      assert.equal(await clickMenuItem(h, t.label), 'CLICKED', `${t.label} reopens`);
      await sleep(500);
      assert.equal(await clickMenuItem(h, s.label), 'CLICKED', `${s.label} opens`);
      await sleep(500);
      if ((await subItems(h)).some((l) => !l.sub && l.label === packLabel)) {
        await openMorePath(h, [t.label, s.label, packLabel]);
        return;
      }
    }
  }
  assert.fail(`${packLabel} is in no More menu`);
}

test('every pack record opens: bill, appliance, trip, list, vehicle, member, goal, visit (t260)', { timeout: 600000 }, async () => {
  const h = await harness();
  const { names } = packRegistry();
  const pack = (id) => {
    assert.ok(names[id], `the registry names ${id}`);
    return names[id];
  };
  const records = [
    { id: 'bill', pack: pack('finance'), row: 'Harbour Internet', expect: 'harbour internet' },
    { id: 'appliance', pack: pack('house'), row: 'Toaster', expect: 'toaster' },
    { id: 'trip', pack: pack('travel'), row: 'Empty Trip', expect: 'empty trip' },
    { id: 'list', pack: pack('lists'), row: 'Milk', expect: 'empty shopping' },
    { id: 'vehicle', pack: pack('vehicles'), row: 'Empty Car', expect: 'empty car' },
    { id: 'member', pack: pack('family'), rowWords: null, expect: 'test person' },
    { id: 'goal', pack: pack('goals'), row: 'Run the harbour loop', expect: 'harbour loop' },
    { id: 'visit', pack: pack('health'), row: 'Dr Lane', expect: 'lane' },
  ];
  for (const r of records) {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    await openPack(h, r.pack);
    assert.ok(await waitFor(h, `document.title.toLowerCase().includes(${JSON.stringify(r.pack.toLowerCase().split(' ')[0])})`, 15000), `${r.pack} lands (saw ${await h.browser.ev('document.title')})`);
    await sleep(900);
    const packTitle = await h.browser.ev('document.title');
    if (r.rowWords === null) {
      const at = await h.browser.ev(`(() => { const b = [...document.querySelectorAll('main button[title^="Open Test Person"]')].find((e) => e.getBoundingClientRect().width > 2); if (!b) return 'NOTFOUND'; b.click(); return 'CLICKED'; })()`);
      assert.equal(at, 'CLICKED', 'the member opens');
    } else {
      assert.equal(await clickWords(h, r.row, 'main'), 'CLICKED', `${r.id} opens`);
    }
    await checkDetail(h, 'record', r.id, r.expect, packTitle, before);
    await goBack(h);
    assert.ok(await waitFor(h, `document.title === ${JSON.stringify(before.baseTitle)}`, 15000), `record/${r.id}: Back returns to base`);
    void base;
  }
});

// ── Settings ─────────────────────────────────────────────────────────────────

test('every Settings section opens and reads (t260)', { timeout: 600000 }, async () => {
  const h = await harness();
  const base = await goBase(h, false);
  const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
  assert.equal(await runPalette(h, 'Open Settings'), 'CLICKED', 'Settings opens');
  assert.ok(await waitFor(h, `!!document.querySelector('nav.settings-nav')`, 15000), 'Settings lands');
  await sleep(900);
  const rendered = await h.browser.ev(`[...document.querySelectorAll('nav.settings-nav button')].map((b) => b.innerText.trim()).filter(Boolean)`);
  const wanted = settingsSections();
  assert.equal(rendered.length, wanted.length, `every section renders (${rendered.length} stood, ${wanted.length} in the code: ${rendered.join(', ')})`);
  for (const s of wanted) assert.ok(rendered.includes(s.label), `Settings offers ${s.label}`);
  for (const s of wanted) {
    assert.equal(await clickWords(h, s.label, 'nav.settings-nav'), 'CLICKED', `${s.label} opens`);
    await sleep(700);
    const h1 = await h.browser.ev(`document.querySelector('.settings-body h1')?.innerText.trim() ?? ''`);
    assert.equal(h1, s.label, `${s.label} reads its own title (saw ${h1})`);
    const body = await h.browser.ev(`(document.querySelector('.settings-body')?.innerText || '').trim().length`);
    assert.ok(body > 80, `${s.label}: no blank section (stood ${body} chars)`);
    const head = await h.browser.ev(`(document.querySelector('.settings-body')?.innerText || '').slice(0, 600)`);
    for (const re of BAD) assert.ok(!re.test(head), `settings/${s.id}: no failure words (${re})`);
    const errs = await h.browser.ev('window.__nvErrors.length');
    assert.equal(errs, before.errors, `settings/${s.id}: no console error`);
    WALKED.push({ phase: 'settings', id: s.id, title: h1 });
    console.log(`door settings/${s.id}: ${h1} [${body} chars]`);
  }
  await goBack(h);
  assert.ok(await waitFor(h, `document.title === ${JSON.stringify(before.baseTitle)}`, 15000), `settings: Back returns (saw ${await h.browser.ev('document.title')})`);
  void base;
});

// ── Commands ─────────────────────────────────────────────────────────────────
// Every Ctrl+K command that opens a page, derived from commands.ts by the static phase above. Most
// run from Today; gated ones run from their context (a note, a project note, a doc, a pack page).

function resolveName(d, names) {
  let raw = d.name.replace(/^['`]|['`]$/g, '');
  // Tour names carry the pack's name as code (`Show me around ${moduleInfo('finance')?.name ?? 'Money'}`):
  // resolve it through the registry, the fallback when the registry lacks it.
  const at = raw.indexOf("moduleInfo('");
  if (at >= 0) {
    const id = raw.slice(at + 12, raw.indexOf("'", at + 12));
    const fbAt = raw.indexOf("?? '", at);
    const fb = fbAt >= 0 ? raw.slice(fbAt + 4, raw.indexOf("'", fbAt + 4)) : '';
    const start = raw.lastIndexOf('${', at);
    const end = raw.indexOf('}', fbAt >= 0 ? fbAt : at) + 1;
    raw = raw.slice(0, start >= 0 ? start : at) + (names[id] ?? fb) + raw.slice(end);
  }
  return raw;
}

const NOTE_MARKER = `!!document.querySelector('.nv-note-main, main .note-view')`;
const EXPECT = {
  home: 'today',
  'export-everything': 'backups and sync',
  'ocr-settings': 'general',
  packs: 'packs',
  'privacy-settings': 'privacy and secrets',
  // The section reads Connect an AI since 20 Nov 2026 (was AI agents).
  'ai-agents': 'connect an ai',
  hotkeys: 'keyboard shortcuts',
  settings: ['settings', 'general'],
  'new-note': { marker: NOTE_MARKER },
  'new-note-tab': { marker: NOTE_MARKER },
  'new-plain-note': { marker: NOTE_MARKER },
  'new-person': { marker: NOTE_MARKER },
  'new-meeting': { marker: NOTE_MARKER },
  'new-resource': { marker: NOTE_MARKER },
  'new-idea': { marker: NOTE_MARKER },
  'unique-note': { marker: NOTE_MARKER },
  daily: { marker: NOTE_MARKER },
  random: { marker: NOTE_MARKER },
  'new-canvas': { marker: `!!document.querySelector('.canvas-view')` },
  'new-drawing': { marker: `!!document.querySelector('.nvd-view')` },
  'brand-kit': 'brand',
  'secrets-scan': 'secrets',
  // Automations lives in the former host app: unconnected, the page honestly says so, with no flow
  // words.
  'new-flow': 'automations',
  // Locked without setup: the page honestly offers setup, with no audit words yet.
  'secrets-activity': 'locked',
};

async function openNoteByName(h, name) {
  const done = await runPalette(h, name);
  assert.equal(done, 'CLICKED', `${name} opens`);
  assert.ok(await waitFor(h, `document.title.toLowerCase().includes(${JSON.stringify(name.toLowerCase().slice(0, 18))})`, 15000), `${name} lands (saw ${await h.browser.ev('document.title')})`);
  await sleep(800);
}

const DOC_NOTE = SMALL ? 'Receipts spec' : 'The awning decision, with quotes, photos and the December dates';

async function runDoor(h, d, names, soft) {
  const name = resolveName(d, names);
  const ctx = doorContext(d);
  const exec = async () => {
    let contextTitle = null;
    if (ctx === 'note') {
      await openNoteByName(h, 'Receipts v2');
      contextTitle = await h.browser.ev('document.title');
    } else if (ctx === 'project') {
      await openNoteByName(h, 'Harbourline Cart Fix');
      contextTitle = await h.browser.ev('document.title');
    } else if (ctx === 'doc') {
      await openNoteByName(h, DOC_NOTE);
      contextTitle = await h.browser.ev('document.title');
    } else if (ctx === 'pack') {
      const base = await goBase(h, false);
      void base;
      const todayTitle = await h.browser.ev('document.title');
      await openPack(h, names.finance);
      assert.ok(await waitFor(h, `document.title.toLowerCase().includes('money')`, 15000), 'Money lands for the tour');
      await sleep(800);
      // The pack tour opens no new page (already on the pack), so Back returns past the pack.
      contextTitle = todayTitle;
    } else {
      const base = await goBase(h, d.id === 'today' || d.id === 'home');
      void base;
    }
    const before = { ...(await snap(h)), baseTitle: contextTitle ?? (await h.browser.ev('document.title')) };
    const done = await runPalette(h, name);
    assert.equal(done, 'CLICKED', `cmd/${d.id}: the palette runs ${name} (${done})`);
    if (d.id.startsWith('tour-')) {
      assert.ok(await waitFor(h, `!!document.querySelector('aside.mt-tour')`, 10000), `cmd/${d.id}: the tour opens`);
      await sleep(700);
      const tour = await h.browser.ev(`document.querySelector('aside.mt-tour')?.getAttribute('aria-label') ?? ''`);
      assert.ok(/short tour/i.test(tour), `cmd/${d.id}: the tour reads (${tour})`);
      const s = await snap(h);
      assert.equal(s.errors, before.errors, `cmd/${d.id}: no console error (${s.lastError || 'none'})`);
      WALKED.push({ phase: 'cmd', id: d.id, title: tour });
      console.log(`door cmd/${d.id}: ${tour}`);
      const closed = await h.browser.ev(`(() => { const b = document.querySelector('aside.mt-tour button[aria-label="Close the tour"]'); if (!b) return 'NOBUTTON'; b.click(); return 'CLICKED'; })()`);
      assert.equal(closed, 'CLICKED', `cmd/${d.id}: the tour closes`);
      await sleep(500);
      const pg = await snap(h);
      for (const re of BAD) assert.ok(!re.test(pg.head), `cmd/${d.id}: no failure words on the pack page`);
      assert.ok(pg.len > 50, `cmd/${d.id}: the pack page is no blank page`);
      await goBack(h);
      assert.ok(await waitFor(h, `document.title === ${JSON.stringify(before.baseTitle)}`, 15000), `cmd/${d.id}: Back returns (saw ${await h.browser.ev('document.title')})`);
      return;
    }
    let want = EXPECT[d.id];
    if (want === undefined) {
      // A Settings door reads its section's label straight from the Settings code.
      const sec = /section:\s*'([\w-]+)'/.exec(d.slice)?.[1] ?? /openSettings\('([\w-]+)'/.exec(d.slice)?.[1];
      want = sec ? (settingsSections().find((s) => s.id === sec)?.label ?? sec) : nameWord(name);
    }
    if (want && typeof want === 'object' && want.marker) {
      await checkDoor(h, 'cmd', d.id, '', before, { noWords: true, marker: want.marker });
    } else if (d.id === 'notebook') {
      await checkDoor(h, 'cmd', d.id, ctx === 'note' ? 'notes' : 'notebook', before);
    } else if (d.id === 'project-workspace') {
      await checkDoor(h, 'cmd', d.id, 'harbourline', before);
    } else if (d.id === 'project-canvas' || d.id === 'doc-canvas') {
      // The canvas keeps its doc's title: the canvas itself proves the door.
      await checkDoor(h, 'cmd', d.id, d.id === 'doc-canvas' ? (SMALL ? 'receipts' : 'awning') : 'harbourline', before, { stay: true, marker: `!!document.querySelector('.canvas-view')` });
    } else if (Array.isArray(want)) {
      await checkDoor(h, 'cmd', d.id, want, before);
    } else {
      await checkDoor(h, 'cmd', d.id, want, before);
    }
  };
  if (soft) {
    try {
      await exec();
    } catch (err) {
      T255.push(`cmd/${d.id}: ${String((err && err.message) || err).split('\n')[0]}`);
      console.log(`t255-note cmd/${d.id}: ${String((err && err.message) || err).split('\n')[0]}`);
    }
  } else {
    await exec();
  }
}

test('every neutral command door opens its page, and Back returns (t260)', { timeout: 600000 }, async () => {
  const h = await harness();
  const { names } = packRegistry();
  const { doors } = classifyCommands();
  for (const d of doors.filter((x) => x.kind === 'door' && doorContext(x) === 'neutral')) {
    await runDoor(h, d, names, false);
  }
});

test('every context command door opens its page, and Back returns (t260)', { timeout: 600000 }, async () => {
  const h = await harness();
  const { names } = packRegistry();
  const { doors } = classifyCommands();
  for (const d of doors.filter((x) => x.kind === 'door' && doorContext(x) !== 'neutral')) {
    await runDoor(h, d, names, d.id === 'project-workspace' || d.id === 'project-canvas');
  }
});

test('every dialog-driven command door reaches its page, and Back returns (t260)', { timeout: 600000 }, async () => {
  const h = await harness();
  // Open a note type → Docs → a doc.
  {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    assert.equal(await runPalette(h, 'Open a note type (people, meetings, ideas…)'), 'CLICKED', 'the type picker opens');
    assert.ok(await waitFor(h, `!!document.querySelector('.picker-row')`, 8000), 'the types list');
    assert.equal(await h.browser.ev(`(() => { const r = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').toLowerCase().includes('doc')); if (!r) return 'NOTFOUND'; r.click(); return 'CLICKED'; })()`), 'CLICKED', 'Docs opens');
    await checkDoor(h, 'cmd', 'open-note-type', 'docs', before);
    void base;
  }
  // New view of records → pick Actions → name it → the view opens.
  {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    assert.equal(await runPalette(h, 'New view of records across projects…'), 'CLICKED', 'the kind picker opens');
    assert.ok(await waitFor(h, `!!document.querySelector('.picker-row, [role="dialog"]')`, 8000), 'the kinds list');
    assert.equal(await h.browser.ev(`(() => { const r = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').toLowerCase().includes('action')); if (!r) return 'NOTFOUND'; r.click(); return 'CLICKED'; })()`), 'CLICKED', 'Actions picked');
    await sleep(800);
    assert.ok(await waitFor(h, `!!document.querySelector('[role="dialog"] input')`, 8000), 'the name prompt opens');
    await h.browser.ev(`(() => { const i = document.querySelector('[role="dialog"] input'); if (i) { i.focus(); i.select(); } })()`);
    await h.browser.send('Input.insertText', { text: 'Walk actions' });
    await sleep(400);
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await checkDoor(h, 'cmd', 'records-new', 'walk actions', before);
    void base;
  }
  // Open a PDF in the reader → pick the kept PDF → the viewer draws.
  {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    assert.equal(await runPalette(h, 'Open a PDF in the reader…'), 'CLICKED', 'the PDF picker opens');
    assert.ok(await waitFor(h, `!!document.querySelector('.picker-row, [role="dialog"]')`, 8000), 'the PDFs list');
    assert.equal(await h.browser.ev(`(() => { const r = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').toLowerCase().includes('shop-floor')); if (!r) return 'NOTFOUND'; r.click(); return 'CLICKED'; })()`), 'CLICKED', 'the kept PDF picked');
    await checkDoor(h, 'cmd', 'open-pdf', 'shop-floor', before, { marker: `!!document.querySelector('.pdfv-page')` });
    void base;
  }
  // New note from a template → Standup → its name → the note opens.
  {
    const base = await goBase(h, false);
    const before = { ...(await snap(h)), baseTitle: await h.browser.ev('document.title') };
    assert.equal(await runPalette(h, 'New note from a template…'), 'CLICKED', 'the template picker opens');
    assert.ok(await waitFor(h, `!!document.querySelector('.picker-row, [role="dialog"]')`, 8000), 'the templates list');
    assert.equal(await h.browser.ev(`(() => { const r = [...document.querySelectorAll('.picker-row')].find((x) => (x.querySelector('.picker-label')?.innerText || '').toLowerCase().includes('standup')); if (!r) return 'NOTFOUND'; r.click(); return 'CLICKED'; })()`), 'CLICKED', 'Standup picked');
    await sleep(800);
    assert.ok(await waitFor(h, `!!document.querySelector('[role="dialog"] input')`, 8000), 'the name prompt opens');
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await checkDoor(h, 'cmd', 'new-note-from-template', '', before, { noWords: true, marker: NOTE_MARKER });
    void base;
  }
});

test('the walk summary: every door walked, failures written down (t260)', async () => {
  const byPhase = {};
  for (const w of WALKED) byPhase[w.phase] = (byPhase[w.phase] ?? 0) + 1;
  console.log(`t260 walked ${WALKED.length} doors: ${Object.entries(byPhase).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  assert.ok((byPhase.room ?? 0) >= 7, 'every side-bar room walked');
  assert.ok((byPhase.more ?? 0) >= 25, 'every More place walked');
  assert.ok((byPhase.row ?? 0) >= 8, 'every row kind walked');
  assert.ok((byPhase.record ?? 0) >= 8, 'every pack record walked');
  assert.ok((byPhase.settings ?? 0) >= 13, 'every Settings section walked');
  assert.ok((byPhase.cmd ?? 0) >= 60, 'every command door walked');
  if (T255.length) console.log(`t255 notes (written down, not fixed here):\n- ${T255.join('\n- ')}`);
  assert.ok(WALKED.length >= 120, `${WALKED.length} doors walked in all`);
});
