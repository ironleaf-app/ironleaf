// node --test tests/areas-today.test.mjs — Today filtered by area (src/shared/areas.ts todayFor): keeping every
// area reads exactly as the unfiltered day — the same `clear` verdict and the same counts — so the area filter can
// never change what the day says, only which lines show.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-areas-today-'));
let A, T, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * as areas from ${JSON.stringify(path.join(root, 'src/shared/areas.ts'))};\nexport * as today from ${JSON.stringify(path.join(root, 'src/shared/today.ts'))};\nexport { parseProject } from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'a.mjs'), format: 'esm' }, logLevel: 'silent' });
  const M = await import(pathToFileURL(path.join(work, 'a.mjs')).href);
  A = M.areas;
  T = M.today;
  P = M;
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = new Date(2026, 9, 17, 9, 30); // Saturday 17 October 2026
const iso = (days) => {
  const d = new Date(2026, 9, 17 + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function day() {
  const text = `---\ntype: project\nstatus: active\nowner: Mia Tran\n---\n# Launch\n\n## What’s next\n\n- [ ] Send the plan — Mia · by ${iso(3)}\n\n## Updates\n\n- **17 Oct 2026** — Kick-off held.\n`;
  const data = T.buildToday({ projects: [{ path: 'Projects/Launch/Launch.md', version: 'v', modified: new Date(2026, 9, 17, 8).getTime(), project: P.parseProject(text, 'Launch.md') }], notes: [] }, TODAY);
  // A file changed in the project's folder since yesterday (Today merges these in).
  return T.withChangedFiles(data, [{ project: 'Projects/Launch/Launch.md', projectName: 'Launch', rel: 'plan.docx', name: 'plan.docx', ext: 'docx', modified: new Date(2026, 9, 17, 7).getTime(), version: 'v' }]);
}

test('keeping every area keeps the day’s verdict: clear with only this week’s work', () => {
  const data = day();
  assert.equal(data.clear, true, 'the unfiltered day is clear: nothing overdue, due today, at risk or waiting');
  const kept = A.todayFor(data, () => true);
  assert.equal(kept.clear, true, 'the same verdict with every area kept');
  assert.equal(kept.nothingOnYou, data.nothingOnYou);
});

test('keeping every area keeps the counts: changed counts lines and files, not groups', () => {
  const data = day();
  assert.equal(data.counts.changed, 2, 'one update line and one changed file');
  const kept = A.todayFor(data, () => true);
  assert.deepEqual(kept.counts, data.counts);
});

test('Today chips only the areas that hold something: an area with no folder and nothing in it is no choice (8 Nov 2026, calm Today)', () => {
  // Family and Library have no folder in their vault and must not show as chips.
  const areas = A.DEFAULT_AREAS;
  const items = [
    { path: 'Work/Projects/Launch.md', props: { type: 'project' } },
    { path: 'Business/Notes/Plan.md' },
    { path: 'Home/Notes/House.md' },
    { path: 'Health/Notes/Run.md' },
    { path: 'Me/Notes/CV.md' },
    { path: 'Publications/Notes/Draft.md' },
  ];
  const counts = A.countAreas(items, areas);
  assert.deepEqual(
    A.todayChips(areas, counts).map((a) => a.id),
    ['work', 'business', 'home', 'health', 'me', 'publications'],
    'Family and Library hold nothing, so they chip nothing',
  );
  // A hidden area never chips even when it holds notes; a quiet area with notes still chips (choosing
  // it shows its things, as before — only emptiness takes a chip away).
  const hidden = areas.map((a) => (a.id === 'work' ? { ...a, hidden: true } : a));
  assert.ok(!A.todayChips(hidden, counts).some((a) => a.id === 'work'), 'hidden stays hidden');
  const withLibrary = [...items, { path: 'Library/Templates/Standup.md' }];
  assert.ok(A.todayChips(areas, A.countAreas(withLibrary, areas)).some((a) => a.id === 'library'), 'a quiet area with notes still chips');
  // The templates folder and the asset store never make an area chip: they land in the quiet area by the
  // fallback, but they are the app's scaffolding, never notes in an area.
  const stores = [...items, { path: 'Templates/Standup.md' }, { path: 'Files and assets/Scan.png' }];
  const chipCounts = A.countChipAreas(stores, areas, { templatesFolder: 'Templates', assetsFolder: 'Files and assets' });
  assert.deepEqual(
    A.todayChips(areas, chipCounts).map((a) => a.id),
    ['work', 'business', 'home', 'health', 'me', 'publications'],
    'templates and assets chip nothing',
  );
});
