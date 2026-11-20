// node --test tests/module-polish.test.mjs — 8.0 polish round 1 for modules: Needs-you cards stay compact,
// the list below never repeats the lead, Publications says Next once with proper separators, the tour link
// sits under the header, and every overview uses the premium card style.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-polish-'));
let L, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as L from ${JSON.stringify(path.join(root, 'src/renderer/src/views/modules/needsLead.ts'))};\nexport * as P from ${JSON.stringify(path.join(root, 'src/shared/module-purpose.ts'))};`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'polish.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ L, P } = await import(pathToFileURL(path.join(work, 'polish.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-10-29';

test('coming up starts after needs you, and hides when the lead already has it all', () => {
  const bills = [
    { name: 'Rent', next: '2026-11-03', amount: 3541.3, path: 'rent.md' },
    { name: 'Power', next: '2026-11-05', amount: 120, path: 'power.md' },
    { name: 'Water', next: '2026-11-06', amount: 80, path: 'water.md' },
    { name: 'Internet', next: '2026-11-07', amount: 90, path: 'internet.md' },
    { name: 'Insurance', next: '2026-11-08', amount: 200, path: 'insurance.md' },
  ];
  const cards = P.financeNeeds(bills, TODAY, (n) => `$${n}`);
  const keys = L.leadKeys(cards, TODAY);
  // The lead holds the first four; Coming up is only what is left.
  assert.deepEqual(L.afterLead(bills, keys, (b) => [`bill:${b.path}`, b.path, b.name]).map((b) => b.name), ['Insurance']);
  // When everything due is already in the lead, nothing is left for Coming up.
  assert.deepEqual(L.afterLead(bills.slice(0, 2), keys, (b) => [b.path]), []);
  // Rows are matched by title as well as by path, and the given order is kept.
  assert.deepEqual(L.afterLead([{ t: 'Other' }, { t: 'Rent' }], keys, (r) => [r.t]).map((r) => r.t), ['Other']);
});

test('needs-you cards: compact row, 15px what, when coloured by state', () => {
  const css = read('src/renderer/src/styles/module-purpose.css');
  assert.match(css, /\.needs-grid \{[^}]*minmax\(240px/);
  assert.match(css, /\.needs-card \{[^}]*max-width: 320px/);
  assert.match(css, /\.needs-what \{[^}]*font-size: var\(--fs-body\); font-weight: 600/);
  assert.match(css, /\.needs-when\.is-late \{[^}]*var\(--tone-bad\)/);
  assert.match(css, /\.needs-when\.is-soon \{[^}]*var\(--tone-warn\)/);
  const tsx = read('src/renderer/src/views/modules/NeedsYou.tsx');
  assert.match(tsx, /days >= 0 && days <= 7/);
  assert.equal((tsx.match(/<button/g) ?? []).length, 1, 'one button per card');
});

test('publications: one summary line with proper separators, one next edition', () => {
  const page = read('src/renderer/src/views/modules/PublicationsPage.tsx');
  assert.match(page, /join\(' · '\)/);
  assert.doesNotMatch(page, /— \$\{cur\.next\.edition|— not started/);
  assert.doesNotMatch(page, /<NeedsYou/, 'no Needs you card repeats the Next edition card');
  assert.match(read('src/renderer/src/views/modules/publications/Archive.tsx'), /aria-label="Next edition"/);
});

test('show me around sits at the end of the summary line in every module shell, never on its own line', () => {
  // 8.7 round 2: the packs' own pages mount no link (their ⋯ menu, the command list and Settings open the tour), so
  // the registry mounts each pack's tour with no link: shut, it renders nothing and adds no height.
  assert.match(read('src/renderer/src/views/modules/registry.ts'), /ModuleTour, \{ module: info, link: false \}/);
  for (const f of ['src/renderer/src/views/modules/work/WorkShell.tsx', 'src/renderer/src/views/modules/FamilyPage.tsx', 'src/renderer/src/views/modules/HealthPage.tsx']) {
    const src = read(f);
    assert.match(src, /ModuleTour/, f);
    // Inline with the summary: the tour is inside PageHead's lead, not a block after the header.
    assert.match(src, /lead=\{[^}]*ModuleTour|lead=\{\s*<>/s, f);
    assert.doesNotMatch(src, /\/>\s*\{(?:tour|moduleInfo)[^}]*&& <ModuleTour/, f);
    assert.doesNotMatch(src, /\/>\s*\{moduleInfo\('(?:family|health|publications)'\)[^\n]*ModuleTour/, f);
  }
  // 8.7 wave 3a round 3 (30 Oct 2026: the tour stays in ⋯ and the palette, no inline link): the work packs host no
  // tour link or dialog of their own; their ⋯ menu and palette open the one tour, which the registry hosts with no
  // link. Same intent on the new screens: the tour adds no height until it is opened.
  for (const f of ['src/renderer/src/views/modules/RecordModulePage.tsx', 'src/renderer/src/views/modules/life/BusinessPage.tsx', 'src/renderer/src/views/modules/work/VendorsPage.tsx', 'src/renderer/src/views/modules/life/SystemsPage.tsx', 'src/renderer/src/views/modules/work/SitesPage.tsx', 'src/renderer/src/views/modules/PublicationsPage.tsx', 'src/renderer/src/views/modules/personal/CareerPage.tsx', 'src/renderer/src/views/modules/work/MeetingsPage.tsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /ModuleTour/, f);
    assert.doesNotMatch(src, /PackTour/, f);
    assert.match(src, /Show me around \$\{name\}/, f);
    assert.match(src, /openTour\(/, f);
  }
  // The link itself is an inline span (not a <p> block) with a quiet separator, so it adds no height.
  const tour = read('src/renderer/src/views/modules/ModuleTour.tsx');
  assert.match(tour, /<span className="mp-tour-link">/);
  assert.doesNotMatch(tour, /<p className="mp-tour-link">/);
  assert.match(tour, /mp-tour-sep/);
  const css = read('src/renderer/src/styles/module-purpose.css');
  assert.match(css, /\.mp-tour-link \{[^}]*display: inline/);
  assert.match(css, /\.mp-tour-link \.mp-tour-button \{[^}]*display: inline;[^}]*padding: 0/);
  assert.doesNotMatch(css, /\.mp-tour-link \{[^}]*padding: 4px 28px/);
  assert.doesNotMatch(css, /padding-left: 28px/);
});

test('every module overview uses the premium card style', () => {
  const css = read('src/renderer/src/styles/module-purpose.css');
  assert.match(css, /\.rm-overview \.rm-card[^{]*\{[^}]*border-radius: var\(--r-3\)/);
  assert.match(css, /\.rm-overview \.rm-tile-value[^{]*\{[^}]*font-variant-numeric: tabular-nums/);
  assert.match(css, /\.rm-overview \{ gap: 16px/);
});

test('coming up lists in finance, sites and vehicles filter by the lead', () => {
  // 8.7 wave 3a round 3 (30 Oct 2026): the work packs' new screens have no Needs-you + Coming-up split (Money shows
  // what is due with its bills and budgets, Suppliers its quotes and orders, and so on), so there is no Coming-up
  // list to repeat the lead. Same intent on the new screens: a lead already shown is never repeated below it.
  // The classic shells that still split Needs-you from Coming-up still filter by the lead.
  for (const f of ['src/renderer/src/views/modules/personal/VehiclesPage.tsx', 'src/renderer/src/views/modules/personal/HousePage.tsx']) {
    assert.match(read(f), /leadKeys\(/, f);
  }
  for (const f of ['src/renderer/src/views/modules/RecordModulePage.tsx', 'src/renderer/src/views/modules/work/SitesPage.tsx', 'src/renderer/src/views/modules/life/SystemsPage.tsx', 'src/renderer/src/views/modules/work/VendorsPage.tsx']) {
    assert.doesNotMatch(read(f), /Coming up/, f);
  }
});
