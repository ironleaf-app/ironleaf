// node --test tests/a13vault-fixes.test.mjs — the 10.0 fourth-round vault fixes, one guard per finding
// (inputs/a13vault-findings.md G1-G7): Today's figures count bills from the same due list the brief and the Bills
// card show (G1); Money's Looking ahead button names the deed (G2); every Projects filter hides its zero (G3); the
// header key reads the shared formatter like the Keys catalogue (G4); one plural helper for every count a person
// reads or hears, with the audit export counting entries (G5), the Bin's one-item confirm (G6) and the Inbox ticked
// name (G7). Each test fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-a13vault-'));
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
let F;
let B;
let W;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as finance from ${JSON.stringify(path.join(root, 'src/shared/finance.ts'))};\nexport * as brief from ${JSON.stringify(path.join(root, 'src/shared/brief.ts'))};\nexport * as words from ${JSON.stringify(path.join(root, 'src/shared/words.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ finance: F, brief: B, words: W } = await import(pathToFileURL(path.join(work, 's.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-11-02';
const bill = (over) => ({ path: `Me/Finance/Bills/${over.name ?? 'X'}.md`, name: over.name ?? 'X', amount: 89, next: '2026-11-02', days: 0, overdue: false, autopay: false, paid: null, ...over });

// ── G1: Today's late figure counts every late thing the page shows (bills included) ──────────────────────────────

test('G1: one due list — overdue or within ahead, just-paid never due, soonest first', () => {
  const bills = [
    bill({ name: 'Late', next: '2026-10-30', days: -3, overdue: true }),
    bill({ name: 'Today', next: TODAY, days: 0 }),
    bill({ name: 'Week', next: '2026-11-05', days: 3 }),
    bill({ name: 'Far', next: '2026-11-14', days: 12 }),
    bill({ name: 'Paid', next: '2026-11-12', days: 10, paid: '2026-11-01' }),
    bill({ name: 'Paused', next: null, days: null }),
  ];
  const due = F.billsDue(bills, 7, TODAY);
  assert.deepEqual(
    due.map((b) => b.name),
    ['Late', 'Today', 'Week'],
    'overdue and within 7 days count; far, just-paid and paused do not',
  );
  const wide = F.billsDue(bills, 14, TODAY);
  assert.ok(
    wide.some((b) => b.name === 'Far') && !wide.some((b) => b.name === 'Paid'),
    'earlier warning reaches further, but a just-paid row stays paid, never due',
  );
});

test('G1: bills as head figures — late, today, within ahead; nothing while Money loads', () => {
  const bills = [bill({ name: 'Late', next: '2026-10-30', days: -3, overdue: true }), bill({ name: 'Today', next: TODAY, days: 0 }), bill({ name: 'Week', next: '2026-11-05', days: 3 })];
  assert.deepEqual(F.billsHeadCounts(bills, 7, TODAY), { late: 1, today: 1, week: 1 });
  assert.deepEqual(F.billsHeadCounts(null, 7, TODAY), { late: 0, today: 0, week: 0 }, 'not loaded yet: nothing, like Due');
  assert.equal(F.billsKeepWelcome(bills, 7, TODAY), true);
  assert.equal(F.billsKeepWelcome([], 7, TODAY), false);
  assert.equal(F.billsKeepWelcome(null, 7, TODAY), false);
});

test('G1: the brief counts the same list, so its bills never escape the figures', () => {
  const money = { currency: 'AUD', today: TODAY, remindDays: 7, bills: [bill({ name: 'Harbour Internet', next: '2026-10-30', days: -3, overdue: true }), bill({ name: 'Gym', next: '2026-11-05', days: 3 })], over: [], prices: [] };
  const brief = B.buildBrief({ now: new Date(2026, 10, 2, 8, 30).getTime(), calendar: null, meetingNotes: {}, due: null, projects: null, decks: [], found: [], foundState: 'off', prefs: B.NO_PREFS, money });
  const kinds = brief.items.filter((i) => i.kind === 'bill').map((i) => i.title);
  assert.ok(kinds.some((t) => t.includes('Harbour Internet is overdue')), 'the overdue bill lines up');
  const counts = F.billsHeadCounts(money.bills, money.remindDays, money.today);
  assert.equal(counts.late, 1, 'and the figures count it late too');
});

test('G1: Today feeds bills into the welcome/all-clear guards (the figures line is one sentence now)', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  // 5 Nov 2026, the day's shape: the figures line is one sentence now (late, today, meetings — a bill is said
  // in its own card, never beside the day's shape), so bills feed the welcome/all-clear guards, not figures.
  assert.ok(src.includes('billsHeadCounts(finance.bills, finance.remindDays, finance.today)'), 'the head counts bills');
  assert.ok(src.includes('billsHead.late') && src.includes('billsHead.today'), 'late and today carry bills');
  assert.ok(src.includes('billsKeepWelcome(finance.bills, finance.remindDays, finance.today)'), 'bills keep “Nothing on you yet” away');
  assert.ok(src.includes('billsHead.late === 0 && billsHead.today === 0'), 'bills keep “All clear” away');
  const brief = read('src/shared/brief.ts');
  assert.ok(brief.includes('billsDue(money.bills, money.remindDays, money.today)'), 'the brief reads the same due list');
  const home = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(home.includes('billsDue(f.bills, f.remindDays, f.today)'), 'the Bills card reads the same due list');
});

// ── G2: Money never stutters ────────────────────────────────────────────────────────────────────────────────────

test('G2: Looking ahead says the line, then the deed — the target page keeps its title', () => {
  const src = read('src/renderer/src/views/modules/RecordModulePage.tsx');
  assert.ok(src.includes('>See the next 90 days</button>'), 'the button names the deed');
  assert.ok(!src.includes('{forecastHeadline(f.forecast, cur)}. <button type="button" className="text-button" onClick={() => openModule(\'finance\', \'lookahead\')}>Next 90 days</button>'), 'no bare repeat after the line');
  assert.ok(src.includes('title="Next 90 days"'), 'the target page keeps its title');
  const line = F.forecastHeadline({ events: [{ name: 'Power', amount: 120, date: '2026-11-05' }], totalOut: 443, totalIn: 0, tightest: null }, 'AUD');
  assert.ok(line.includes('going out in the next 90 days'), 'the line itself is untouched');
});

// ── G3: one rule for zeros on every Projects filter ────────────────────────────────────────────────────────────

test('G3: every filter hides its zero — no Finished special case', () => {
  const src = noComments(read('src/renderer/src/views/ProjectsHome.tsx'));
  assert.doesNotMatch(src, /f\.id !== 'done'/, 'the done special case is gone');
  assert.ok(src.includes('{showCount(n) ? <span className="n">{n}</span> : null}'), 'one zero rule for all five, through the shared helper (H1)');
});

// ── G4: one writing for the key ────────────────────────────────────────────────────────────────────────────────

test('G4: the header chip and its tooltip read the shared formatter', () => {
  const src = read('src/renderer/src/views/ViewHeader.tsx');
  assert.ok(src.includes("formatHotkey('Mod+K')"), 'routed through the formatter, like the Keys catalogue');
  assert.ok(!src.includes('<kbd>Ctrl'), 'no hardcoded key chip');
  assert.ok(!src.includes('(Ctrl+K)'), 'no hardcoded tooltip either (a Mac reads its own keys)');
});

test('G4: no space-form key anywhere a person reads', () => {
  const bad = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(e)) {
        const src = noComments(readFileSync(p, 'utf8'));
        if (/Ctrl K/.test(src)) bad.push(path.relative(root, p));
      }
    }
  };
  walk(path.join(root, 'src'));
  assert.deepEqual(bad, [], 'Ctrl K with a space survives nowhere outside comments');
});

// ── G5-G7: one plural helper ─────────────────────────────────────────────────────────────────────────────────

test('G5-G7: the one helper reads right with one and with many', () => {
  assert.equal(W.plural(1, 'entry', 'entries'), '1 entry');
  assert.equal(W.plural(2, 'entry', 'entries'), '2 entries');
  assert.equal(W.plural(1, 'item'), '1 item');
  assert.equal(W.plural(3, 'capture', 'captures'), '3 captures');
  for (const words of [W.plural(1, 'entry', 'entries'), W.plural(0, 'item'), W.plural(2, 'capture', 'captures')]) assert.doesNotMatch(words, /—/, 'no em dashes in product words');
});

test('G5: the audit export counts entries, never lines', () => {
  const src = read('src/renderer/src/views/SecretsView.tsx');
  assert.ok(src.includes("plural(rows.length, 'entry', 'entries')"), 'entries with the one helper');
  assert.ok(!src.includes('lines to'), 'no lines count left');
});

test('G6: emptying one item removes the one item, never all 1', () => {
  const src = read('src/renderer/src/views/BinView.tsx');
  assert.ok(src.includes('the ${plural(all.length, \'item\')}'), 'one reads as the 1 item');
  assert.ok(src.includes('all ${plural(all.length, \'item\')}'), 'many read as all N items');
  assert.ok(!src.includes('Remove all {all.length}'), 'no bare count left');
});

test('G7: one ticked capture tells screen readers 1 capture ticked', () => {
  const src = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(src.includes("plural(selected.length, 'capture', 'captures')"), 'the toolbar name reads right aloud');
  assert.ok(!src.includes('${selected.length} captures ticked'), 'no bare plural left');
  const notes = read('src/renderer/src/views/NotesPage.tsx');
  assert.ok(notes.includes("plural(selected.length, 'note', 'notes')"), 'Notes ticks the same way (the same toolbar, the same rule)');
});

test('G5-G7: no bare `${n} <plural>` counts anywhere a person reads or hears', () => {
  // The same class as G5-G7: a .length count followed by a plural noun, with no helper and no singular branch on
  // its line. Allowed: the helper (plural/countWords), a singular guard (=== 1, > 1), and the three documented
  // safe lines below (state words with no noun, a pill with no noun, a puzzle size that is never one).
  const allow = [
    ['LayoutDashboard.tsx', '} yes, ${'], // "3 yes, 1 no": counts of states, no noun ("1 yes" reads right).
    ['RecordModulePage.tsx', 'this week'], // "2 this week": a pill with no noun, like "1 ticked".
    ['puzzles.ts', 'letters.'], // A puzzle's answer length (crossword/word length, never one).
  ];
  const bad = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e) && !/\.test\./.test(e)) {
        const lines = noComments(readFileSync(p, 'utf8')).split('\n');
        lines.forEach((line, i) => {
          if (!/\$\{[^}]*\.length[^}]*\} [a-z]+s\b/.test(line)) return;
          if (/plural\(|countWords\(|===\s*1|!==\s*1|> 1|>= 2|=== 0/.test(line)) return;
          if (allow.some(([f, bit]) => p.endsWith(f) && line.includes(bit))) return;
          bad.push(`${path.relative(root, p)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
      }
    }
  };
  walk(path.join(root, 'src/renderer'));
  walk(path.join(root, 'src/shared'));
  assert.deepEqual(bad, [], 'every .length count reads through the helper or a singular branch');
});
