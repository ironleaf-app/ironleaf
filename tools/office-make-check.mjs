// node tools/office-make-check.mjs [<folder>] — the files the assistant makes (src/main/office-make.ts), opened by a
// real office program: a three-page report, a two-sheet budget and an eight-slide deck are made, then LibreOffice
// (soffice, which must be installed) turns each into a PDF and, when pdftoppm is there, PNG pages to look at. A file
// LibreOffice can't open, or opens as nothing, fails the check: that is what damaged XML does. Everything lands in the
// folder given (a new temp folder otherwise), which is printed at the end. Not part of `npm run test:fast`: the
// round trip through the app's own readers is tests/office-make.test.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ? path.resolve(process.argv[2]) : mkdtempSync(path.join(tmpdir(), 'office-make-check-'));
mkdirSync(out, { recursive: true });
const has = (cmd) => {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
if (!has('soffice')) {
  console.error('LibreOffice (soffice) is not installed, so there is nothing to open the files with.');
  process.exit(2);
}

// The module, bundled with the libraries left as the installed packages.
const build = path.join(out, '.build');
mkdirSync(build, { recursive: true });
if (!existsSync(path.join(build, 'node_modules'))) symlinkSync(path.join(root, 'node_modules'), path.join(build, 'node_modules'), 'junction');
writeFileSync(path.join(build, 'entry.ts'), `export * from ${JSON.stringify(path.join(root, 'src/main/office-make.ts'))};\n`);
const { build: bundle } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
await bundle({ input: path.join(build, 'entry.ts'), platform: 'node', external: [/^(docx|exceljs|pptxgenjs|jszip|markdown-it|yaml|electron)(\/|$)/], output: { file: path.join(build, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(build, 'm.mjs')).href);

// ── Made-up samples ─────────────────────────────────────────────────────────────────────────────────────────────────

const report = `# Riverside community garden: season report

**Status:** on track · **Updated:** 24 November 2026

## Summary

The garden's second season ends with every bed planted and a waiting list of twelve households. Spending is *within
budget*; the new water tank came in under its quote. Plans and photos are on the [garden's page](https://example.org/garden?season=2&view=plans).

> The tomato beds gave more than the group could eat, so the surplus went to the local pantry every week.

## Goals for next season

1. Add six raised beds for members who can't kneel.
2. Make every path step-free.
   1. Crushed granite on the main path.
   2. A ramp to the tool shed.
3. Catch enough rain to water through January.

## What changed

- Water tank installed in September.
  - Gutters cleaned and screened.
  - First overflow measured after the storm on 2 October.
- Compost bays rebuilt by the Saturday crew.
- Seed library opened in the shed.

### Costs at a glance

| Item | Budget | Spent | Left |
|:-----|-------:|------:|-----:|
| Water tank | $4,800 | $4,350 | $450 |
| Timber for beds | $2,600 | $2,410 | $190 |
| Tools | $900 | $1,020 | -$120 |
| Total | $8,300 | $7,780 | $520 |

---

## Next season

The raised beds need timber before the end of winter, and the path needs a dry fortnight.

### Risks

- **Timber prices.** A rise would cut the beds from six to four.
- **Volunteers.** The Saturday crew is small over the holidays.

### Before planting

- [x] Soil tested
- [ ] Beds marked out
- [ ] Seed order placed

#### Watering timer

\`\`\`
start = 06:00
run   = 20 min
days  = Mon Wed Fri
\`\`\`

## Next steps

1. Order timber (week of 1 December).
2. Book the path works.
3. Plan the open day with the members.

Questions go to <garden@example.org>.

---

## Appendix: plot list

| Plot | Holder | Since | Notes |
|---|---|---|---|
| 1 | Household A | 2025 | Herbs |
| 2 | Household B | 2025 | Tomatoes and beans |
| 3 | School group | 2026 | Visits on Thursdays |
| 4 | Household C | 2026 | New this season |

> [!tip] Keep a planting log
> A note of what went where makes rotating the beds next year simple.
`;

const book = {
  sheets: [
    {
      name: 'Budget 2026/27',
      rows: [
        ['Item', 'Category', 'Due', 'Budget', 'Spent', 'Left', '% used'],
        ['Water tank', 'Water', '2026-09-05', 4800, 4350, '=D2-E2', '=E2/D2'],
        ['Timber for beds', 'Beds', '2026-10-12', 2600, 2410, '=D3-E3', '=E3/D3'],
        ['Tools', 'Equipment', { date: '2026-11-02' }, 900, 1020, '=D4-E4', { formula: 'E4/D4', format: 'percent' }],
        ['Path works', 'Access', '2027-02-20', 3200, 0, '=D5-E5', '=E5/D5'],
        ['Total', null, null, '=SUM(D2:D5)', '=SUM(E2:E5)', '=SUM(F2:F5)', '=E6/D6'],
      ],
    },
    {
      name: 'Payments: Q3 [draft]?',
      rows: [
        ['Paid on', 'Supplier', 'Amount', 'Approved', 'Note'],
        ['2026-09-02', 'Tank Supplies Co', '$4,350.00', true, 'Tank and fittings'],
        ['2026-10-14', 'Local Timber Yard', '$2,410.00', true, 'Includes delivery and the offcuts for the compost bays, which the yard gave at half price'],
        ['2026-11-03', 'Garden Tools Shop', '$1,020.00', false, ''],
        ['Total', null, '=SUM(C2:C4)', null, null],
      ],
    },
  ],
};

const deck = {
  title: 'Riverside community garden',
  subtitle: 'Season review · Members meeting, 24 November 2026',
  slides: [
    { title: 'Where we are', bullets: ['Every bed planted this season', 'Spending is **within budget**', { text: 'Water tank $450 under', level: 1 }, { text: 'Tools $120 over', level: 1 }, 'Twelve households waiting for a plot'], notes: 'Open with the waiting list.' },
    { title: 'Next season', layout: 'section', bullets: ['Raised beds and paths'] },
    { title: 'Before and after', bullets: ['Hose from the street tap', 'Grass paths', 'No seed library'], right: ['Rain from the tank', 'Granite paths', 'A seed library in the shed'], notes: 'The tank is the big change.' },
    { title: 'The surplus went to the pantry every single week.', layout: 'quote', bullets: ['Garden coordinator'] },
    { title: 'Risks', bullets: ['Timber prices could rise', { text: 'Six beds would become four', level: 1 }, 'Volunteers are few over the holidays', 'The path needs a dry fortnight', 'Water through January'], notes: 'Ask for volunteers.' },
    { title: 'Decisions today', bullets: ['Approve the timber order (`$2,900`)', 'Agree the open day: **Saturday 14 March 2027**'], notes: 'Record each decision.' },
    { title: 'Thank you', layout: 'section', bullets: ['Questions: garden@example.org'] },
  ],
};

writeFileSync(path.join(out, 'report.docx'), await M.makeDocx(report, { title: 'Riverside community garden' }));
writeFileSync(path.join(out, 'budget.xlsx'), await M.makeXlsx(book));
writeFileSync(path.join(out, 'deck.pptx'), await M.makePptx(deck));

// ── Opened by LibreOffice ───────────────────────────────────────────────────────────────────────────────────────────

const want = { report: 3, budget: 2, deck: 8 };
let failed = false;
for (const [name, pages] of Object.entries(want)) {
  const file = path.join(out, `${name}.${name === 'report' ? 'docx' : name === 'budget' ? 'xlsx' : 'pptx'}`);
  let said = '';
  try {
    said = execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', out, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  } catch (e) {
    said = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  const pdf = path.join(out, `${name}.pdf`);
  const bytes = existsSync(pdf) ? readFileSync(pdf) : Buffer.alloc(0);
  const count = (bytes.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  const ok = bytes.length > 1000 && count > 0;
  if (!ok || /error|repair|corrupt/i.test(said)) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${path.basename(file)}: ${count} page${count === 1 ? '' : 's'} (expected ${pages})${/error|repair|corrupt/i.test(said) ? ` — LibreOffice said: ${said.trim()}` : ''}`);
  if (ok && has('pdftoppm')) execFileSync('pdftoppm', ['-r', '90', '-png', pdf, path.join(out, name)]);
}
console.log(`\nFiles and pages: ${out}`);
if (has('pdftoppm')) console.log(readdirSync(out).filter((f) => f.endsWith('.png')).sort().join('\n'));
process.exit(failed ? 1 : 0);
