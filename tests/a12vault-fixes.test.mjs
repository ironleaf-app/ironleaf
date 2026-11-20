// node --test tests/a12vault-fixes.test.mjs — the 10.0 third-round vault fixes, one guard per finding
// (inputs/a12vault-findings.md F1-F9): an unpaid bill never reads as paid (F8); a nonsense search shows the
// empty state, never hashed-cosine meaning hits (F4); one due-day words helper and one colour rule on the
// project (F5) and in both note modes (F9); one capitalisation for health and status bits (F7); no phone
// words in person-visible strings (F6); the note never crushes under ~300px (F1); tab strips show they
// scroll (F2); the waiting banner wraps instead of clipping (F3). Each test fails without its fix.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-a12vault-'));
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
let F;
let X;
let MM;
let PP;
let NT;
let RR;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'shared.ts');
  writeFileSync(
    entry,
    `export * as finance from ${JSON.stringify(path.join(root, 'src/shared/finance.ts'))};\nexport * as recordModuleTools from ${JSON.stringify(path.join(root, 'src/shared/record-module-tools.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  ({ finance: F, recordModuleTools: X } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
  const mEntry = path.join(work, 'mentry.ts');
  writeFileSync(
    mEntry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/meaning.ts'))};\nexport { MeaningIndex } from ${JSON.stringify(path.join(root, 'src/main/meaning-index.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`,
  );
  await build({ input: mEntry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  MM = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  const pEntry = path.join(work, 'plan.ts');
  writeFileSync(pEntry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/components/plan/plan.ts'))};\n`);
  await build({ input: pEntry, platform: 'node', output: { file: path.join(work, 'p.mjs'), format: 'esm' }, logLevel: 'silent' });
  PP = await import(pathToFileURL(path.join(work, 'p.mjs')).href);
  const ntEntry = path.join(work, 'notetask.ts');
  writeFileSync(ntEntry, `export * from ${JSON.stringify(path.join(root, 'src/shared/note-task.ts'))};\n`);
  await build({ input: ntEntry, platform: 'node', output: { file: path.join(work, 'nt.mjs'), format: 'esm' }, logLevel: 'silent' });
  NT = await import(pathToFileURL(path.join(work, 'nt.mjs')).href);
  // The page renderer, with the window's link lookups stood in for (as editor-markdown.test.mjs stubs them).
  const stub = path.join(work, 'resolve-stub.ts');
  writeFileSync(stub, 'export const fileUrl = (p: string) => p;\nexport const isAudio = () => false;\nexport const isImage = () => false;\nexport const isPdf = () => false;\nexport const isVideo = () => false;\nexport const resolveAny = () => null;\nexport const resolveFile = () => null;\n');
  const stubResolve = { name: 'stub-resolve', resolveId: (id, importer) => (id === './resolve' && importer?.endsWith('markdownRender.ts') ? stub : null) };
  const rEntry = path.join(work, 'render.ts');
  writeFileSync(rEntry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/markdownRender.ts'))};\n`);
  await build({ input: rEntry, platform: 'node', plugins: [stubResolve], output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  RR = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-11-02';

// ── F8: an unpaid bill never reads as paid ────────────────────────────────────────────────────────────────────

test('F8: an unpaid bill says not paid yet, and by hand is how it is paid, not that it was', () => {
  const late = F.billDueWords({ name: 'Harbour Internet', amount: 89, next: '2026-10-30', days: -3, overdue: true, autopay: false }, 'AUD', TODAY);
  assert.equal(late.title, 'Harbour Internet is overdue');
  assert.equal(late.detail, '$89.00 was due Fri 30 Oct, not paid yet; you pay it by hand');
  const due = F.billDueWords({ name: 'Gym', amount: 29, next: '2026-11-07', days: 5, overdue: false, autopay: false }, 'AUD', TODAY);
  assert.equal(due.detail, '$29.00 on Sat 7 Nov, you pay it by hand');
  assert.match(F.billDueWords({ name: 'Telstra', amount: 189, next: '2026-11-05', days: 3, overdue: false, autopay: true }, 'AUD', TODAY).detail, /\(autopay\)/);
  const agent = X.answerRecordModuleTool(
    {
      finance: [{ path: 'Me/Finance/Bills/Harbour Internet.md', title: 'Harbour Internet', props: { amount: '89.00', cycle: 'Monthly', due: '2026-10-30', autopay: 'No', category: 'Phone and internet' }, content: '', type: 'bill' }],
      on: ['finance'],
      today: new Date(2026, 10, 2, 8, 30),
    },
    'finance_bills_due',
    { days: 30 },
  );
  assert.match(agent, /OVERDUE since Fri 30 Oct, not paid yet; you pay it by hand/, 'the agent door says it too');
  for (const words of Object.values(late)) assert.doesNotMatch(words, /—/, 'no em dashes in product words');
});

test('F8: paid by hand nowhere reads as a deed — only you pay it by hand, or before the autopay day', () => {
  const victims = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e)) victims.push(p);
    }
  };
  walk(path.join(root, 'src'));
  const bad = [];
  for (const file of victims) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/paid by hand/g)) {
      const before = src.slice(Math.max(0, m.index - 12), m.index);
      const after = src.slice(m.index + 'paid by hand'.length, m.index + 'paid by hand'.length + 24);
      const ok = /you pay it $/.test(before) || after.startsWith(' before the autopay day');
      if (!ok) bad.push(`${path.relative(root, file)}: …${before.slice(-24)}paid by hand${after.slice(0, 24)}…`);
    }
  }
  assert.deepEqual(bad, [], 'every paid by hand says the method (you pay it by hand) or the deed (before the autopay day)');
});

// ── F4: a nonsense search shows the empty state, never hashed-cosine meaning hits ───────────────────────────────

/** The shots-w4vault.mjs fixture notes, as the tool writes them (same helpers, same texts): the pin for F4. */
function w4Fixture() {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const on = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d; };
  const iso = (days) => { const d = on(days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dm = (days) => { const d = on(days); return `${d.getDate()} ${MON[d.getMonth()]}`; };
  const dmy = (days) => `${dm(days)} ${on(days).getFullYear()}`;
  const notes = {
    'Projects/Launch/Launch.md': `---\ntype: project\nstatus: active\nhealth: at risk\nprogress: 60\nowner: Mia Tran\ndue: "${iso(9)}"\nupdated: "${iso(0)}"\n---\n# Launch\n\n## Summary\n\nForty Mini units land before launch day, and the product page goes live the Monday before.\n\n## What's next\n\n- [ ] Send the signed form — Mia · by ${dm(-3)}\n- [ ] Book the hall — Mia · by ${dm(0)}\n- [ ] Print the agenda — Mia · by ${dm(4)}\n- [ ] Send the invoice — Priya Nair · by ${dm(2)}\n- [x] Export the device inventory — Mia\n\n## Key dates\n\n| When | What | Status |\n| --- | --- | --- |\n| ${dmy(5)} | Doors open | on track |\n\n## Risks and issues\n\n- **High** — The hall isn't booked\n\n## Notes\n\n`,
    'Notes/Launch notes.md': `---\ntype: note\ntags: [launch]\n---\n# Launch notes\n\nThe hall holds 200. See [[Supplier quote]] for the catering numbers and [[Projects/Launch/Launch|the launch plan]].\n\n- [ ] Confirm the headcount — Mia · by ${dm(1)}\n`,
    'Notes/Supplier quote.md': `# Supplier quote\n\nCatering for 200, two courses, $38 a head.\n`,
    'People/Sam Okafor.md': `---\ntype: person\nrole: Supplier\norg: Harbour Fit-outs\nemail: sam@example.com\n---\n# Sam Okafor\n\nRuns the Harbour store fit-out.\n`,
    'People/Priya Nair.md': `---\ntype: person\nrole: Buyer\norg: Box Hill Institute\n---\n# Priya Nair\n\nFirst buyer, twelve workstations.\n`,
    'Resources/Hall layouts.md': `---\ntype: resource\nkind: Link\nurl: https://example.com/hall-layouts\nauthor: Harbour Venues\nstatus: Reading\n---\n# Hall layouts\n\nThe room plans for the three shortlisted halls.\n`,
    'Resources/Catering menus.md': `---\ntype: resource\nkind: Article\nauthor: Priya Nair\nstatus: To read\n---\n# Catering menus\n\nWhat the shortlisted caterers serve for 200.\n`,
    'Meetings/Standup.md': `---\ndate: ${iso(0)}\ntime: "09:00"\nattendees: [Mia Tran]\ntags: [meeting]\n---\n# Standup\n\nWhat each of us is doing today.\n\n## Actions\n\n- [ ] Book the hall — Mia · by ${dm(0)}\n`,
    [`Daily/${iso(0)}.md`]: `## Notes\n\n- [ ] Call Priya — by ${dmy(0)}\n`,
    'Me/Finance/Bills/Harbour Internet.md': `---\ntype: bill\namount: '89.00'\ncycle: Monthly\ndue: ${iso(-3)}\ncategory: Phone and internet\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n\n## Notes\n`,
    'Me/Finance/Bills/Gym.md': `---\ntype: bill\namount: '29.00'\ncycle: Monthly\ndue: ${iso(5)}\ncategory: Health\n---\n## Price history\n\n| Date | Amount | Note |\n| --- | --- | --- |\n\n## Notes\n`,
  };
  const index = new MM.VaultIndex();
  const now = Date.now();
  for (const [p, t] of Object.entries(notes)) index.set(p, t, now, 10);
  return index;
}

test('F4: nonsense over the shot tool fixture finds nothing, so the empty state shows', () => {
  const index = w4Fixture();
  const hits = index.search('zzz-no-such-note');
  assert.ok(hits.every((h) => !h.meaning), 'no Similar meaning hit for gibberish (one shared trivial word is not meaning)');
  assert.deepEqual(hits, [], 'nothing at all: SearchView can show Nothing matches');
});

test('F4: a real paraphrase and a short query still find their notes, labelled', () => {
  const index = new MM.VaultIndex();
  const now = Date.now();
  index.set('Notes/TechLease vendor.md', '# TechLease vendor\nThird shipment slipped again. Stock arrived late twice, always behind schedule. Thinking of switching contractor.', now, 10);
  index.set('Notes/Cake.md', '# Cake\nFlour, sugar, butter, bake at 180.', now, 10);
  const hits = index.search('the supplier who kept missing delivery dates');
  assert.ok(hits.some((h) => h.path === 'Notes/TechLease vendor.md' && h.meaning), 'the paraphrase still finds its note, labelled');
  assert.ok(!hits.some((h) => h.path === 'Notes/Cake.md'), 'the cake recipe still stays out');
  const mi = new MM.MeaningIndex();
  mi.set('Notes/A.md', 'A', 'supplier vendor late');
  assert.equal(mi.search('supplier late').length, 1, 'a short true query still hits');
});

// ── F5: one due-day words helper and one colour rule on the project ──────────────────────────────────────────────

test('F5: the project page reads due days through the shared words and tone, never the twin DayTag', () => {
  // t242's one view removed the project board and its DatePill (commit 4638960c5): days read through the
  // shared dateWords/whenTone with the one-row cells, and the F5 rule's intent (one words, one colour) stands.
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(!/DayTag/.test(tabs), 'the twin is gone: words, tone and countdowns come from the one helper');
  assert.ok(!tabs.includes('DatePill'), 'the board pill is gone with the board');
  assert.ok(/import \{[^}]*dateWords[^}]*whenTone[^}]*\} from '\.\.\/\.\.\/components\/plan\/plan'/.test(tabs), 'due days read through the shared words and tone');
  assert.ok(tabs.includes('WhenCell'), 'the Tasks rows read their when through the one row');
  const elseRow = tabs.slice(tabs.indexOf('function ElsewhereRow'), tabs.indexOf('function KeyDateRow'));
  assert.ok(elseRow.includes('<WhenInner words={whenWords}'), 'their when reads through the shared inner');
});

test('F5: one words and one colour for a due day (Tomorrow this week, the date with its countdown past it)', () => {
  // 5 Nov 2026, the plan: late by one reads Yesterday, a day not arithmetic.
  assert.equal(PP.dateWords(11, 10), 'Tomorrow');
  assert.equal(PP.dateTone(11, 10), 'week', 'tomorrow tints amber, on every screen');
  assert.equal(PP.dateTone(14, 10), 'week');
  assert.match(PP.dateWords(20, 10), /· in 10 days/, 'past a week the countdown rides along');
  assert.equal(PP.dateTone(20, 10), 'later');
  assert.equal(PP.dateWords(9, 10), 'Yesterday');
  assert.equal(PP.dateWords(undefined, 10), 'No date');
});

// ── F9: Reading shows the same due chip words as Live ────────────────────────────────────────────────────────────

test('F9: a task due day reads the same in Reading as on the Live chip', () => {
  const now = new Date(2026, 10, 2, 10, 0); // Mon 2 Nov 2026
  const line = '- [ ] Confirm the headcount — Mia · by 3 Nov';
  assert.equal(NT.taskChips(line, now, []).dueWords, 'Tomorrow', 'the Live chip words');
  const html = RR.renderMarkdown(`${line}\n`, { now });
  assert.ok(html.includes('>Tomorrow</span>'), 'Reading shows the same words');
  assert.ok(html.includes('reading-due'), 'in the due span');
  assert.ok(html.includes('Written'), 'the written words kept on hover');
  assert.ok(!html.includes('by 3 Nov</'), 'the written day replaced, not doubled');
  const canon = RR.renderMarkdown('- [ ] Ring the bank 📅 2026-11-03\n', { now });
  assert.ok(canon.includes('>Tomorrow</span>'), 'a canonical day reads the same too');
  const late = RR.renderMarkdown('- [ ] File the till report · by 30 Oct\n', { now });
  assert.ok(late.includes('>Fri 30 Oct</span>') && late.includes('is-overdue'), 'a past day with the overdue colour');
  const done = RR.renderMarkdown('- [x] File the till report · by 30 Oct\n', { now });
  assert.ok(done.includes('is-done'), 'a ticked task dims, however late');
});

test('F9: code, plain prose and day-less tasks stay exactly as written', () => {
  const now = new Date(2026, 10, 2, 10, 0);
  const code = RR.renderMarkdown('- [ ] Fix `by 3 Nov` parsing\n', { now });
  assert.ok(!code.includes('reading-due'), 'a day in code stays written');
  assert.ok(code.includes('by 3 Nov'), 'untouched');
  const prose = RR.renderMarkdown('Due by 3 Nov, no tick box.\n', { now });
  assert.ok(!prose.includes('reading-due'), 'prose is not a task');
  const plain = RR.renderMarkdown('- [ ] Water the figs\n', { now });
  assert.ok(!plain.includes('reading-due'), 'no day, no span');
});

test('F9: one colour rule (Live and Reading share dueChipTone, in theme tokens only)', () => {
  const chips = read('src/renderer/src/editor/taskChips.ts');
  assert.ok(chips.includes('dueChipTone('), 'Live tones through the shared helper');
  const render = read('src/renderer/src/lib/markdownRender.ts');
  assert.ok(render.includes('dueChipTone('), 'Reading tones through the shared helper');
  const css = read('src/renderer/src/styles.css');
  const at = css.indexOf('.markdown .reading-due');
  assert.ok(at > 0, 'the span has its own rules');
  const block = css.slice(at, css.indexOf('}', css.indexOf('}', at) + 1) + 1);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block), 'no hex colours outside the tokens');
  assert.ok(!/999px/.test(block), 'no pills');
  assert.ok(css.includes('.markdown .reading-due.is-overdue'), 'overdue reads red');
  assert.ok(css.includes('.markdown .reading-due.is-done'), 'done dims');
});

// ── F7: one capitalisation for health and status bits ─────────────────────────────────────────────────────────────

test('F7: the foot and peek capitalise standalone health and status bits, as the hero does', () => {
  const peek = read('src/renderer/src/components/Peek.tsx');
  assert.ok(peek.includes('const cap = '), 'one capitaliser in the row reader');
  assert.equal((peek.match(/text: cap\(r\.status/g) ?? []).length, 2, 'milestone/meeting/decision and workstream/risk statuses stand up');
  assert.ok(peek.includes('text: cap(health'), 'project health stands up');
  assert.ok(!peek.includes('text: r.status') && !peek.includes('text: health'), 'no raw status or health bit left');
});

// ── F6: no phone words in person-visible strings ──────────────────────────────────────────────────────────────────

test('F6: desktop customers click and choose, never tap (the widened N15 guard)', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e) && !e.endsWith('.d.ts')) files.push(p);
    }
  };
  walk(path.join(root, 'src/renderer/src'));
  walk(path.join(root, 'src/shared'));
  walk(path.join(root, 'src/main'));
  const bad = [];
  for (const file of files) {
    // Comments hold code idiom (one-tap filing, double-tap retries, the recorder's audio tap), never person words.
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'])\/\/[^\n]*/g, '$1')
      .replace(/tap-worklet|nv-tap/g, '');
    const m = src.match(/\b(double[ -]?tap(ping|ped|s)?|tap(ping|ped|s)?)\b/i);
    if (m) {
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${path.relative(root, file)}:${line}: ${JSON.stringify(m[0])} in ${JSON.stringify(src.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' '))}`);
    }
  }
  assert.deepEqual(bad, [], 'tap, tapping, tapped, taps and double-tap nowhere outside comments');
});

// ── F1-F3: the note keeps its width, tab strips show they scroll, the banner wraps ──────────────────────────────

const noCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('F1: the note layout is a container, and a narrow middle folds the rail instead of crushing the note', () => {
  const css = read('src/renderer/src/styles/note-context.css');
  const layout = noCssComments(css).match(/\.nv-note-layout\s*\{([^{}]*)\}/s)?.[1] ?? assert.fail('no .nv-note-layout');
  assert.ok(layout.includes('container: nvnote / inline-size'), 'the layout is a sized container, as the project page is');
  const narrow = noCssComments(css).match(/@container nvnote \(max-width: 600px\) \{([\s\S]*?)\n\}/)?.[1] ?? assert.fail('no narrow-middle rule');
  assert.ok(narrow.includes('.nv-rail.is-strip') && narrow.includes('width: 40px'), 'the strip folds to its bar');
  assert.ok(narrow.includes('.nv-strip-section') && narrow.includes('display: none'), 'folded sections hide, the Context way in stays');
  assert.ok(narrow.includes('.nv-rail:not(.is-strip):not(.is-shut)') && narrow.includes('position: absolute'), 'an opened rail draws over, never beside');
  assert.ok(!noCssComments(css).includes('@media (max-width: 900px)'), 'no window-keyed rule missing docked sides');
});

test('F2: every sideways tab strip shows it scrolls, through the one kit rule', () => {
  // Two strip kinds (5 Nov 2026, rest-quieten and v6): the foot's tabs became one Linked list, so the
  // foot strip is gone and .tabs and .nv-tabs remain under the one rule.
  for (const [file, sel] of [['kit.css', '.tabs'], ['page-frame.css', '.nv-tabs']]) {
    const css = noCssComments(read(`src/renderer/src/styles/${file}`));
    const rule = css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`, 's'))?.[1] ?? assert.fail(`no ${sel} in ${file}`);
    assert.ok(rule.includes('overflow-x: auto'), `${sel} still scrolls`);
    assert.ok(!rule.includes('scrollbar-width: none'), `${sel} never hides its scrollbar`);
  }
  const kit = noCssComments(read('src/renderer/src/styles/kit.css'));
  assert.ok(kit.includes('.tabs, .nv-tabs'), 'one rule over both strips at once');
  assert.ok(!kit.includes('.foot-tabs'), 'the foot strip is gone from the rule');
  assert.ok(kit.includes('scrollbar-width: thin'), 'a thin thumb, only when overflowing');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(kit.slice(kit.indexOf('.tabs, .nv-tabs'), kit.indexOf('.tabs, .nv-tabs') + 600)), 'token colours only');
});

test('F3: the waiting banner wraps its words with the buttons under, never clipping mid-word', () => {
  const css = noCssComments(read('src/renderer/src/styles/suggestions.css'));
  const bar = css.match(/\.suggestion-bar\s*\{([^{}]*)\}/s)?.[1] ?? assert.fail('no .suggestion-bar');
  assert.ok(bar.includes('flex-wrap: wrap'), 'buttons wrap under');
  const words = css.match(/\.suggestion-bar-words\s*\{([^{}]*)\}/s)?.[1] ?? assert.fail('no .suggestion-bar-words');
  assert.ok(!words.includes('white-space: nowrap') && !words.includes('text-overflow: ellipsis'), 'words wrap instead of clipping');
  assert.ok(/flex:\s*1\s+1\s+240px/.test(words), 'words yield a full row when narrow');
});
