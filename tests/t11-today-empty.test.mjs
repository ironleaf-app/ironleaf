// node --test tests/t11-today-empty.test.mjs — break tonight's calm Today (t11, 8 Nov 2026).
// The brief: try an empty vault, one note, and whether anything a person had on Today becomes
// unreachable, or a vault warning hides when it matters. The whole list (vault rows, projects waiting,
// packs, turned-on cards, the live hub) folded behind `{!noProjects && ...}`, so a vault with notes but
// no projects lost its vault warnings, its bills and systems rows and its cards on Today, with Home
// showing none of them either. The rows render with no projects too; only project lines stay gated.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('the list renders with no projects: vault rows, packs and cards stay reachable', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  // Layout round 2 (20 Nov 2026): the rows are Needs you, in the day's column; the vault's line its foot.
  const fold = src.indexOf('data-section="needs"');
  assert.ok(fold > 0, 'the one list is on the page');
  const before = src.slice(Math.max(0, fold - 400), fold);
  assert.ok(!before.includes('!noProjects'), 'no-projects never gates the list itself');
  const items = src.indexOf('td-look-items', fold);
  assert.ok(items > fold, 'the rows live inside the list');
  assert.ok(src.indexOf('<VaultTodayCards />', fold) > fold, 'the vault line stays, at the foot of the day');
  // 2.0.1: the Meetings pack's line (meetings finished with actions open) lives in the one Meetings card.
  assert.ok(src.includes('<MeetingsAfterLine />') && src.indexOf('<MeetingsAfterLine />') < fold, 'the meetings line stays, in the Meetings card');
  for (const block of ['<ProjectChecksToday />', '<TodayModules group="due"', '<TodayModules group="upkeep"', '<TodayModules group="rest"', '<LookCards']) {
    const at = src.indexOf(block, fold);
    assert.ok(at > items, `${block} lists with the rows, projects or none`);
  }
  for (const live of ['<ChangesWaiting />', '<CardsDue />']) {
    assert.ok(src.indexOf(live, fold) > items, `${live} stays one click away, projects or none`);
  }
});

test('only project lines stay behind no-projects', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  // The nags are project lines (review, dormant work): each keeps its own gate. Tidy left Today for
  // the weekly review (8 Nov 2026, calm list), where it shows whenever projects wait for it.
  for (const nag of ['reviewQuiet', 'dormantQuiet']) {
    const at = src.indexOf(`const ${nag} =`);
    assert.ok(at > 0 && src.slice(at, at + 120).includes('!noProjects'), `${nag} stays a project line`);
  }
  assert.ok(!src.includes('tidyQuiet'), 'no tidy line on Today any more');
  assert.ok(read('src/renderer/src/views/WeeklyReview.tsx').includes('ready to tidy'), 'the weekly review carries it');
});

test('turned-on cards still change on Home', () => {
  const home = read('src/renderer/src/views/HomeView.tsx');
  assert.ok(home.includes('Change cards') && home.includes('<ChangeHome'), 'Home keeps the card changer Today rows read from');
});
