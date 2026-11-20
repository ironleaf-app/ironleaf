// node --test tests/t271-folder-counts.test.mjs — a folder's number equals what its list shows
// (t271, 13 Nov 2026, on 10.2.7). Their Finance folder said 20 with 3 rows, Systems and Home Lab 9
// with 3 rows, Show everything on. The rail counted the packs' records (bills, machines…) while the
// list left them out: NotesPage built its rows with Show everything and then filtered the folder,
// the chips and the head without it. One shared reading now: the rail, the All chip, the head and
// the rows count the same rows, Show everything on and off, and the head tracks the chip picked. A
// made-up made-up vault of realistic size. Fails without the fix.
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { clickWords, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const AREAS = ['Work', 'Me', 'Business', 'Home'];
const AREAS_JSON = JSON.stringify({ version: 1, home: 'work', areas: AREAS.map((n) => ({ id: n.toLowerCase(), name: n, folder: n, icon: 'layers', color: 'teal', about: '' })) });
const BILL = (amount, due, category, kind = 'Bill') => `---\ntype: bill\nkind: ${kind}\namount: ${amount}\ncycle: Monthly\ndue: ${due}\ncategory: ${category}\naccount:\nproject:\nautopay: No\nstatus: Active\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n| | ${amount} | Added by an assistant |\n`;

// Their rooms, made up: Me/Finance with 3 notes plus bills, a deeper note and files that are not
// notes; Home/Systems and Home Lab with 3 notes plus pack records; plain folders elsewhere.
function seedT271Vault(dir) {
  for (const e of readdirSync(dir)) rmSync(path.join(dir, e), { recursive: true, force: true });
  const w = (rel, text) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  w('.neuralvault/areas.json', `${AREAS_JSON}\n`);
  w('Me/Finance/Budget draft Oct 2026.md', '---\ntype: note\n---\n# Budget draft Oct 2026\n\nStatus: DRAFT v2. Nothing written to budget.csv or bills.csv. Prepared by Ledger, 13 Oct 2026.\n');
  w('Me/Finance/Smart Access spending report.md', '---\ntype: note\n---\n# Smart Access spending report\n\nA full pass over the Smart Access account, not a sample: every transaction exported from NetBank. Categories are grouped by payee; transfers to the NetBank Saver and to pocket money are listed last.\n');
  w('Me/Finance/Finance.md', '---\ntype: note\n---\n# Finance\n\nKept by Chief and Ledger. Live working copy in the budget sheet. A snapshot of it is attached below.\n');
  w('Me/Finance/Bills/Harbour Internet.md', BILL('89.00', '2026-11-20', 'Phone and internet'));
  // One bill, one subscription (t277): the pack's own words for each, counted together as records.
  w('Me/Finance/Bills/Gym.md', BILL('29.00', '2026-11-25', 'Subscriptions', 'Subscription'));
  w('Me/Finance/Old/Last year.md', '# Last year\n\nLast year\u2019s budget, kept for comparison.\n');
  w('Me/Finance/budget.csv', 'category,amount\nGroceries,812.40\n');
  w('Me/Finance/Statements/October.pdf', '%PDF-1.4 made-up\n');
  w('Home/Systems and Home Lab/Services.md', '# Services\n\nOne line per service. You can read this file; the Systems page reads it too.\n');
  w('Home/Systems and Home Lab/Runbooks.md', '# Runbooks\n\nOne line per runbook. Steps come from the shared pattern, filled in for what each is for.\n');
  w('Home/Systems and Home Lab/Machines.md', '# Machines\n\nOne line per machine. You can read this file; the Systems page reads it too.\n');
  w('Home/Systems and Home Lab/Machines/Media box.md', '---\ntype: machine\nkind: Server\nrole: Media\nos: Linux\nstatus: ok\n---\n# Media box\n\nServes films.\n');
  w('Home/Systems and Home Lab/Services/Photo library.md', '---\ntype: service\nruns_on: "[[Media box]]"\nstatus: ok\n---\n# Photo library\n\nKeeps photos.\n');
  w('Home/Systems and Home Lab/Runbooks/Restart the router.md', '---\ntype: runbook\nfor: Router\n---\n# Restart the router\n\nUnplug, wait thirty seconds, plug back in.\n');
  w('Me/Notes/Weekend.md', '# Weekend\n\nOrdinary weekend words.\n');
  w('Work/Notes/Kick-off.md', '# Kick-off\n\nKicked off on Monday.\n');
  w('Work/Projects/Deep/Plan.md', '# Plan\n\nA plan two levels down, proving a folder counts deep.\n');
  w('Docs/Server.md', '---\ntype: doc\n---\n# Server\n\nHow the server runs.\n');
  w('Daily/2026-11-13.md', '# 2026-11-13\n\nToday\u2019s words.\n');
}

let H = null;
before(async () => {
  H = await startHarness({});
  await H.services.invoke('settings:update', [{ prefs: { modules: { finance: { on: true }, systems: { on: true } } } }]);
  seedT271Vault(H.vaultDir);
  await H.services.rescanAll();
  await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
  assert.ok(await waitFor(H, `!!document.querySelector('.app')`, 60000), 'the app boots');
  await sleep(2500);
  await H.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  await openRoom(H, 'Notes');
  assert.ok(await waitFor(H, `!!document.querySelector('.w2b-folders')`, 15000), 'the Notes rail draws');
  await sleep(800);
}, { timeout: 600000 });
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

// ── Static: one shared reading ─────────────────────────────────────────────

test('the folder, the list and the head read the same rows: Show everything everywhere', () => {
  const src = read('src/renderer/src/views/NotesPage.tsx');
  // The folder on show, the drawn list and the Find's count filter the page's rows — which Show
  // everything built — so each carries the same switch, never the default that hides records.
  for (const [name, re] of [
    ['the folder on show', /const inFolder = useMemo\(\(\) => \(folder \? filterNoteRows\(rows, \{ folder[^}]*includeRecords: showAll/],
    ['the drawn list', /const shown = useMemo\(\(\) => filterNoteRows\(rows, \{ kind, folder: folder \|\| null, project: project \|\| null, includeRecords: showAll, query/],
    ['the Find count', /filterNoteRows\(rows, \{ kind, folder: folder \|\| null, project: project \|\| null, includeRecords: showAll, query: ''/],
  ]) assert.ok(re.test(src), `${name} carries Show everything into the shared rows`);
  const match = src.slice(src.indexOf('const match = useMemo'), src.indexOf('const match = useMemo') + 500);
  assert.ok(match.includes('includeRecords: showAll'), 'the Find’s count carries Show everything too');
  assert.ok(/count=\{shown\.length\}/.test(src), 'the head counts the rows on show, tracking the chip picked');
});

test('a preview wraps whole words; one highlight washes the whole row, hovered or active', () => {
  const css = read('src/renderer/src/styles/w2b.css');
  const rule = (start) => {
    const at = css.indexOf(start);
    assert.ok(at >= 0, `${start} exists`);
    return css.slice(at, css.indexOf('}', at));
  };
  const line2 = rule('.w2b-row-line2 .clip {');
  assert.ok(line2.includes('white-space: normal'), 'the preview wraps instead of cutting mid-word');
  // t278: a 2,000-letter line drew 2,000 letters, so the wrap is bounded at whole lines (never dots,
  // the full words on hover), never mid-word at the row's edge.
  assert.ok(/max-height:\s*54px/.test(line2), 'a boundless preview stops at three 18px lines');
  assert.ok(!/line-clamp|webkit-box/.test(line2), 'never a clamp form (dots, or nothing, here)');
  assert.ok(!line2.includes('ellipsis'), 'no dots where it stops');
  const hov = rule('.w2b-rowwrap:hover {');
  assert.ok(hov.includes('background: var(--sel)'), 'a hovered row wears the one wash on its whole wrap');
  assert.ok(!/:has\(/.test(line2 + hov) && !/!important/.test(line2 + hov), 'no :has(), no new !important');
});

// ── Static: records read their pack's kind (t277) ────────────────────────────

test('a record reads its kind from the pack registries, never a hand list', () => {
  const shared = read('src/shared/notes-list.ts');
  assert.ok(shared.includes('export function recordKindWords'), 'the shared row words a record from its type');
  assert.ok(shared.includes("f.key.toLowerCase() === 'kind'") && shared.includes('type.name'), 'type name first, kind options from the registry');
  const page = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(page.includes('recordKindWords(type, n.props)'), 'NotesPage words each record through the helper');
  assert.ok(page.includes('kindColor') && page.includes('type.color'), 'the pack colour rides with the kind');
  // Never a hand list: no kind words as literals in the row's code (comments stripped).
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const w of ['Bill', 'Subscription', 'Statement', 'Machine', 'Service', 'Runbook', 'Appliance', 'Trip', 'Goal', 'Visit']) {
    assert.ok(!new RegExp(`'${w}'|"${w}"`).test(code), `no hand '${w}' in NotesPage`);
  }
  const lib = shared.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const w of ['Bill', 'Subscription', 'Statement', 'Machine', 'Service', 'Runbook', 'Appliance', 'Trip', 'Goal', 'Visit']) {
    assert.ok(!new RegExp(`'${w}'|"${w}"`).test(lib), `no hand '${w}' in notes-list`);
  }
});

test('Records joins through the same chip mechanism; Notes counts notes only', () => {
  const shared = read('src/shared/notes-list.ts');
  assert.ok(shared.includes("'records'") && shared.includes("{ id: 'records', label: 'Records' }"), 'the Records filter lives with All, Notes, Docs, Daily');
  assert.ok(/kind === 'notes' && \(r\.kind !== 'note' \|\| r\.record\)/.test(shared), 'Notes leaves records out');
  assert.ok(/kind === 'records' && !r\.record/.test(shared), 'Records keeps records only');
  const page = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(page.includes("records: 0") && page.includes('if (r.record) counts.records++'), 'the chip counter counts records apart');
  assert.ok(/NOTE_KIND_FILTERS\.filter\(\(f\) => f\.id !== 'records'/.test(page), 'the page draws Records only while records are on show');
  assert.ok(page.includes("kind === 'records'") && page.includes('inFolder.some((r) => r.record)'), 'drawn while picked too, so Back never strands it');
});

test('a record’s kind chip wears its pack’s colour from the theme tokens', () => {
  const page = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(page.includes('w2b-kind') && page.includes('nt-${r.kindColor}'), 'the row chips a record kind in its colour');
  const css = read('src/renderer/src/styles/w2b.css');
  const at = css.indexOf('.w2b-kind.nt-stone');
  assert.ok(at >= 0, 'the kind chip rule exists');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.ok(rule.includes('background: var(--type-soft)') && rule.includes('color: var(--type)'), 'soft tint ground, type ink, theme tokens only');
  assert.ok(!/:has\(/.test(rule) && !/!important/.test(rule), 'no :has(), no new !important');
});

test('Back returns to the folder: picks rest in the tab, pushing no history', () => {
  const page = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(page.includes('folderInTab(tab)') && page.includes("s.startsWith('folder:')"), 'the folder reads from the tab section first, the deep link after');
  assert.ok(page.includes('setTabSection(ws, tab.id, `folder:${f}`, false)'), 'a pick writes the folder in place, pushing nothing');
  assert.ok(/useEffect\(\(\) => \{ setFolder\(folderInTab\(tab\)\); \}, \[tab\.path, tab\.section\]\)/.test(page), 'Back and Forward restore it');
});

// ── Live: the numbers agree ────────────────────────────────────────────────

const ev = (js) => H.browser.ev(js);
const num = (t) => {
  const m = /(\d+)\s*$/.exec(String(t ?? '').trim());
  return m ? Number(m[1]) : 0;
};
/** Every folder row on the rail: its prefix (title) and number. Only rows inside a folder group —
 *  All notes, Daily, Docs and Show everything read separately (Show everything carries a tooltip
 *  title of its own, never a folder). */
const railRows = () => ev(`[...document.querySelectorAll('.w2b-folders [data-fgroup] button.frow')].map((e) => ({ t: e.getAttribute('title'), n: e.querySelector('.n') ? Number(e.querySelector('.n').innerText) : 0 }))`);
const railFolders = async () => (await railRows()).filter((x) => x.t);
const pickFolder = async (prefix) => {
  const at = await ev(`(() => { const el = [...document.querySelectorAll('.w2b-folders button.frow')].find((e) => (e.getAttribute('title') || '') === ${JSON.stringify(prefix)}); if (!el) return 'NOTFOUND'; el.scrollIntoView({ block: 'nearest' }); el.click(); return 'CLICKED'; })()`);
  assert.equal(at, 'CLICKED', `${prefix || 'All notes'} is a drawn row to click`);
  await sleep(900);
};
const pickAllNotes = async () => {
  assert.equal(await clickWords(H, 'All notes', '.w2b-folders'), 'CLICKED', 'All notes answers');
  await sleep(900);
};
const chips = () => ev(`[...document.querySelectorAll('main .chips .chip')].map((e) => ({ label: (e.innerText||'').replace(/\\s+/g,' ').trim(), n: e.querySelector('.n') ? Number(e.querySelector('.n').innerText) : 0 }))`);
const pickChip = async (label) => {
  assert.equal(await clickWords(H, label, 'main .chips'), 'CLICKED', `${label} answers`);
  await sleep(900);
};
const rows = () => ev(`document.querySelectorAll('main .w2b-row').length`);
const rowTitles = () => ev(`[...document.querySelectorAll('main .w2b-row .t')].map((e) => (e.innerText||'').replace(/\\s+/g,' ').trim())`);
const head = () => ev(`Number(document.querySelector('main .nv-page-count')?.innerText ?? 0)`);
const showAllOn = () => ev(`[...document.querySelectorAll('.w2b-folders .frow')].find((e) => (e.innerText||'').includes('Show everything'))?.getAttribute('aria-pressed') === 'true'`);
const setShowAll = async (on) => {
  if ((await showAllOn()) === on) return;
  assert.equal(await clickWords(H, 'Show everything', '.w2b-folders'), 'CLICKED', 'Show everything answers');
  await sleep(1200);
  assert.equal(await showAllOn(), on, `Show everything is ${on ? 'on' : 'off'}`);
};

/** The folder's number, the All chip, the head and the drawn rows agree; each chip counts its rows.
 *  All is Notes plus Docs plus Daily plus Records (t277: Records only while records are on show). */
async function assertFolderAgrees(prefix, label) {
  let want;
  if (prefix) {
    want = (await railFolders()).find((r) => r.t === prefix);
    assert.ok(want, `${label}: ${prefix} stands on the rail`);
    await pickFolder(prefix);
  } else {
    const n = await ev(`(() => { const el = [...document.querySelectorAll('.w2b-folders button.frow')].find((e) => !e.getAttribute('title') && (e.innerText||'').replace(/\\s+/g,' ').startsWith('All notes')); return el?.querySelector('.n') ? Number(el.querySelector('.n').innerText) : null; })()`);
    assert.ok(n !== null, `${label}: All notes stands on the rail`);
    want = { t: '', n };
    await pickAllNotes();
  }
  await pickChip('All');
  const all = (await chips()).find((c) => c.label.startsWith('All'));
  const n = await rows();
  const h = await head();
  assert.equal(all.n, want.n, `${label}: the All chip ${all.n} is the folder's number ${want.n}`);
  assert.equal(n, want.n, `${label}: ${n} rows stand under the folder's number ${want.n}`);
  assert.equal(h, want.n, `${label}: the head ${h} tracks All at ${want.n}`);
  // All is the sum of its chips: Notes (notes only), Docs, Daily, and Records while it shows.
  const now = await chips();
  const at = (x) => now.find((c) => c.label.startsWith(x))?.n ?? 0;
  const hasRecords = now.some((c) => c.label.startsWith('Records'));
  assert.equal(all.n, at('Notes') + at('Docs') + at('Daily') + at('Records'), `${label}: All ${all.n} is Notes ${at('Notes')} plus Docs ${at('Docs')} plus Daily ${at('Daily')} plus Records ${at('Records')}`);
  for (const chip of hasRecords ? ['Notes', 'Docs', 'Daily', 'Records'] : ['Notes', 'Docs', 'Daily']) {
    await pickChip(chip);
    const c = (await chips()).find((x) => x.label.startsWith(chip));
    const rn = await rows();
    const hn = await head();
    assert.equal(rn, c.n, `${label}: the ${chip} chip ${c.n} draws ${rn} rows`);
    assert.equal(hn, c.n, `${label}: the head ${hn} tracks the ${chip} chip at ${c.n}`);
  }
  await pickChip('All');
  await sleep(300);
}

test('Show everything off: every folder’s number is its All chip is its rows', { timeout: 300000 }, async () => {
  await setShowAll(false);
  const rail = await railRows();
  assert.ok(!rail.some((r) => r.t === 'Me/Finance'), 'off, the packs’ Finance folder stands out of view');
  assert.ok(!rail.some((r) => r.t === 'Home/Systems and Home Lab'), 'off, the packs’ Systems folder stands out of view');
  await assertFolderAgrees('', 'off');
  for (const r of await railFolders()) {
    await assertFolderAgrees(r.t, 'off');
  }
  // Off, no records are on show anywhere, so no Records chip stands (t277).
  await pickAllNotes();
  await pickChip('All');
  assert.ok(!(await chips()).some((c) => c.label.startsWith('Records')), 'off, All notes shows no Records chip');
});

test('Show everything on: Finance and Systems count their records, and the list shows them', { timeout: 300000 }, async () => {
  await setShowAll(true);
  const rail = await railRows();
  const fin = rail.find((r) => r.t === 'Me/Finance');
  const sys = rail.find((r) => r.t === 'Home/Systems and Home Lab');
  assert.equal(fin?.n, 6, `Finance counts its 3 notes, its deeper note and its 2 bills (stood ${fin?.n})`);
  assert.equal(sys?.n, 6, `Systems counts its 3 notes and its 3 records (stood ${sys?.n})`);
  assert.equal(rail.find((r) => r.t === 'Me')?.n, 7, 'Me counts Finance with its own note');
  // Notes counts notes only; Records counts the records (t277).
  await pickFolder('Me/Finance');
  await pickChip('All');
  const finChips = await chips();
  assert.equal(finChips.find((c) => c.label.startsWith('Notes'))?.n, 4, 'Finance Notes counts its 4 notes, never its records');
  assert.equal(finChips.find((c) => c.label.startsWith('Records'))?.n, 2, 'Finance Records counts its bill and subscription');
  await pickFolder('Home/Systems and Home Lab');
  await pickChip('All');
  const sysChips = await chips();
  assert.equal(sysChips.find((c) => c.label.startsWith('Notes'))?.n, 3, 'Systems Notes counts its 3 notes');
  assert.equal(sysChips.find((c) => c.label.startsWith('Records'))?.n, 3, 'Systems Records counts its machine, service and runbook');
  // A folder with no records shows no Records chip, even with everything on.
  await pickFolder('Me/Notes');
  await pickChip('All');
  assert.ok(!(await chips()).some((c) => c.label.startsWith('Records')), 'a folder of only notes shows no Records chip');
  await assertFolderAgrees('Me/Finance', 'on');
  await assertFolderAgrees('Home/Systems and Home Lab', 'on');
  await assertFolderAgrees('Me', 'on');
  await assertFolderAgrees('', 'on');
});

test('records read with their kind and open; files that are not notes never list', { timeout: 300000 }, async () => {
  await setShowAll(true);
  await pickFolder('Me/Finance');
  await pickChip('All');
  const titles = await rowTitles();
  assert.ok(titles.includes('Harbour Internet') && titles.includes('Gym'), `the bills list with the notes (${titles.join(' / ')})`);
  assert.ok(!titles.some((t) => /csv|pdf|October/i.test(t)), 'the csv and the PDF never list as notes');
  // Each record reads its pack's own kind, in its pack's words and colour (t277).
  const kinds = await ev(`[...document.querySelectorAll('main .w2b-row')].map((r) => ({ t: r.querySelector('.t')?.innerText.replace(/\\s+/g,' ').trim(), k: r.querySelector('.w2b-row-line2')?.innerText.replace(/\\s+/g,' ').trim(), chip: r.querySelector('.w2b-row-line2 .w2b-kind')?.innerText.replace(/\\s+/g,' ').trim() ?? null, cls: r.querySelector('.w2b-row-line2 .w2b-kind')?.className ?? '' }))`);
  const bill = kinds.find((r) => r.t === 'Harbour Internet');
  assert.equal(bill?.chip, 'Bill', `a bill reads Bill, never Note (${bill?.k})`);
  assert.ok(bill?.cls.includes('nt-ochre'), `its kind chip wears Money's ochre (${bill?.cls})`);
  const sub = kinds.find((r) => r.t === 'Gym');
  assert.equal(sub?.chip, 'Subscription', `a subscription reads Subscription (${sub?.k})`);
  const note = kinds.find((r) => r.t === 'Budget draft Oct 2026');
  assert.ok(note && /\bNote\b/.test(note.k) && !note.chip, `a plain note still reads Note, with no kind chip (${note?.k})`);
  await pickFolder('Home/Systems and Home Lab');
  await pickChip('All');
  const sys = await ev(`[...document.querySelectorAll('main .w2b-row')].map((r) => ({ t: r.querySelector('.t')?.innerText.replace(/\\s+/g,' ').trim(), chip: r.querySelector('.w2b-row-line2 .w2b-kind')?.innerText.replace(/\\s+/g,' ').trim() ?? null, cls: r.querySelector('.w2b-row-line2 .w2b-kind')?.className ?? '' }))`);
  assert.equal(sys.find((r) => r.t === 'Media box')?.chip, 'Machine', 'a machine reads Machine');
  assert.ok(sys.find((r) => r.t === 'Media box')?.cls.includes('nt-slate'), 'its kind chip wears Systems slate');
  assert.equal(sys.find((r) => r.t === 'Photo library')?.chip, 'Service', 'a service reads Service');
  assert.equal(sys.find((r) => r.t === 'Restart the router')?.chip, 'Runbook', 'a runbook reads Runbook');
  // A bill opens as a note does, onto its own page; Back returns to the folder (t277).
  await pickFolder('Me/Finance');
  await pickChip('All');
  await ev(`[...document.querySelectorAll('main .w2b-row')].find((r) => (r.querySelector('.t')?.innerText || '').includes('Harbour Internet'))?.click()`);
  assert.ok(await waitFor(H, `(document.querySelector('.topbar .crumb')?.innerText || '').includes('Bills') && (document.querySelector('main')?.innerText || '').includes('Price history')`, 15000), 'the bill opens onto its own page');
  await ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
  assert.ok(await waitFor(H, `!!document.querySelector('.w2b-folders')`, 15000), 'Back returns to Notes');
  await sleep(900);
  const back = await ev(`({ on: document.querySelector('.w2b-folders [data-fgroup] button.frow.on')?.getAttribute('title') ?? '', all: [...document.querySelectorAll('main .chips .chip')].find((c) => (c.innerText||'').startsWith('All'))?.querySelector('.n')?.innerText ?? '' })`);
  assert.equal(back.on, 'Me/Finance', `Back returns to the Finance folder (on ${back.on || 'All notes'})`);
  assert.equal(back.all, '6', `its All chip still counts Finance at 6 (stood ${back.all})`);
  // A machine opens its page too; Back returns to Systems.
  await pickFolder('Home/Systems and Home Lab');
  await pickChip('All');
  await ev(`[...document.querySelectorAll('main .w2b-row')].find((r) => (r.querySelector('.t')?.innerText || '').includes('Media box'))?.click()`);
  assert.ok(await waitFor(H, `(document.querySelector('main')?.innerText || '').includes('Serves films')`, 15000), 'the machine opens onto its own page');
  await ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
  assert.ok(await waitFor(H, `!!document.querySelector('.w2b-folders')`, 15000), 'Back returns to Notes');
  await sleep(900);
  assert.equal(await ev(`document.querySelector('.w2b-folders [data-fgroup] button.frow.on')?.getAttribute('title') ?? ''`), 'Home/Systems and Home Lab', 'Back returns to the Systems folder');
});

test('a long preview wraps whole words, never cut at the edge', { timeout: 300000 }, async () => {
  await setShowAll(true);
  await pickFolder('Me/Finance');
  await pickChip('All');
  const cut = await ev(`(() => {
    const rows = [...document.querySelectorAll('main .w2b-row .w2b-row-line2 .clip')];
    const out = [];
    for (const el of rows) {
      const cs = getComputedStyle(el);
      // A wrapped preview shows every word (nothing clipped past its box); a one-line slot would
      // hide words past its edge, cutting the last mid-word.
      if (cs.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth + 1) out.push(el.innerText.slice(-40));
    }
    return out;
  })()`);
  assert.deepEqual(cut, [], `no preview cuts words at its edge (${cut.join(' / ')})`);
});

test('hover and active wash one highlight across the whole row', { timeout: 300000 }, async () => {
  await setShowAll(true);
  await pickFolder('Me/Finance');
  await pickChip('All');
  const sel = await ev(`(() => { const d = document.createElement('div'); d.style.background = 'var(--sel)'; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()`);
  // The keyboard-active row: the wrap and its button wash as one, out to the date.
  const active = await ev(`(() => {
    const wrap = document.querySelector('main .w2b-rowwrap.is-active');
    if (!wrap) return null;
    const btn = wrap.querySelector('button.trow.w2b-row');
    const when = wrap.querySelector('.w2b-when');
    const wb = wrap.getBoundingClientRect(), bb = btn.getBoundingClientRect(), hb = when.getBoundingClientRect();
    return { wrap: getComputedStyle(wrap).backgroundColor, btn: getComputedStyle(btn).backgroundColor, endsAt: Math.round(bb.right), dateAt: Math.round(hb.right), wrapAt: Math.round(wb.right) };
  })()`);
  assert.ok(active, 'an active row stands');
  assert.equal(active.wrap, sel, 'the active wrap wears the one wash');
  assert.equal(active.btn, sel, 'its button wears the same wash');
  assert.ok(active.wrapAt >= active.dateAt - 2, `the wash runs out to the date (${active.wrapAt} to ${active.dateAt})`);
  // A hovered row: the same one wash, the same whole width. The mouse rests over the first row
  // (hovering it), then the keyboard moves the active row down: hover without mouse-enter, as a row
  // slid under a still mouse — the two widths.
  const pt = await ev(`(() => { const w = document.querySelectorAll('main .w2b-rowwrap')[0]; if (!w) return null; const r = w.querySelector('button.trow.w2b-row').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  assert.ok(pt, 'a first row stands to hover');
  await H.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
  await sleep(400);
  // The list's keys answer inside the page (as after a click lands focus there).
  await ev(`document.querySelector('main .chips .chip.on')?.focus()`);
  await H.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await H.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await sleep(400);
  const hov = await ev(`(() => {
    const wraps = [...document.querySelectorAll('main .w2b-rowwrap')];
    const w = wraps[0];
    const when = w.querySelector('.w2b-when');
    const wb = w.getBoundingClientRect(), hb = when.getBoundingClientRect();
    return { active: w.classList.contains('is-active'), wrap: getComputedStyle(w).backgroundColor, wrapAt: Math.round(wb.right), dateAt: Math.round(hb.right) };
  })()`);
  assert.equal(hov.active, false, 'the first row is hovered, not active');
  assert.equal(hov.wrap, sel, `a hovered row wears the one wash (stood ${hov.wrap})`);
  assert.ok(hov.wrapAt >= hov.dateAt - 2, `hover runs the whole width too (${hov.wrapAt} to ${hov.dateAt})`);
  await H.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8 });
});
