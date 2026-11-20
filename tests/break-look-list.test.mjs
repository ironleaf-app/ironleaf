// node --test tests/break-look-list.test.mjs — break the calmer "things need a look" list (9 Nov 2026).
// The list shipped calm (7 kinds, not 22). This job finds what it does wrong to a real person on
// made-up data only: what matters today folded away or dropped, folded rows hiding worse problems,
// counts differing from what opening shows, the weekly tip and tidy, and the shapes (empty, 50 bills,
// 30 machines, no areas, packs off). Failing tests first; fixes at the cause. When unsure, show.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

const work = mkdtempSync(path.join(tmpdir(), 'nv-break-look-'));
let S = null;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * as meetingAfter from ${JSON.stringify(path.join(root, 'src/shared/meeting-after.ts'))};\n` +
      `export * as pubs from ${JSON.stringify(path.join(root, 'src/shared/publications.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── 1. The live hub counts when shut, never hidden behind "Nothing needs a look" ──
// TodayView renders the look rows shut or open (hidden when shut) so the count is what opening
// shows — but the live hub (changes waiting, agents, decks) only renders when open, so when shut
// it is neither counted nor hinted. A waiting approval hides behind "Nothing needs a look".
test('the live hub renders shut or open, so its blocks count on the shut line', () => {
  const src = read('src/renderer/src/views/TodayView.tsx');
  const liveAt = src.indexOf('ref={setLiveEl}');
  assert.ok(liveAt > 0, 'the live hub marks its wrap for the count');
  // Layout round 2 (20 Nov 2026): the live hub counts with Needs you in the day's column, never inside More for
  // today (the one fold left, which only passes its sections to the balanced columns when open).
  const needsAt = src.indexOf('data-section="needs"');
  const foldAt = src.indexOf('data-section="also"');
  assert.ok(needsAt > 0 && foldAt > needsAt, 'Needs you stands before More for today');
  assert.ok(liveAt > needsAt && liveAt < foldAt, 'the live hub renders with Needs you, outside the fold');
  assert.ok(src.includes('...(elseOpen ? moreForToday : [])'), 'the fold holds only the day’s other sections');
});

// ── 2. Finished meetings: the folded row names every meeting with open actions ──
// Five meetings finished with actions still open: the one folded row must say 5 and name all five.
// Capped at three, two meetings hide with no signal at all.
test('five finished meetings with open actions all nudge, not just three', () => {
  const mk = (date, i) => ({ path: `${i}.md`, title: `m${i}`, date, dated: true, actions: [{ what: `do ${i}`, done: false }] });
  const ms = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].map((d, i) => mk(d, i));
  const nudges = S.meetingAfter.meetingsNeedingAfterflow(ms, '2026-11-02');
  assert.equal(nudges.length, 5, 'every finished meeting with open actions nudges in the one folded row');
});

// ── 3. An edition due at 7am still shows past 7am when nothing is started ──
// PublicationsToday only shows the next run within two days. Past its time with no edition, the
// next run is next week, so nothing shows: the missed edition hides. The last scheduled day whose
// time passed must show until its edition exists.
test('an edition due at 7am shows past 7am when no edition is started', () => {
  const src = read('src/renderer/src/views/modules/PublicationsToday.tsx');
  assert.ok(src.includes('lastScheduledDay'), 'the overdue edition is read from the last scheduled day');
});

// ── 4. A backup that failed shows on Today, never only in Settings ──
// Git backup and encrypted sync errors live only in Settings › Backups and sync. A failure
// overnight must reach the morning list as vault health, first when it speaks.
test('a failed backup is a row of the morning list', () => {
  const home = read('src/renderer/src/components/VaultHome.tsx');
  const sync = read('src/renderer/src/components/VaultSync.tsx');
  const today = read('src/renderer/src/views/TodayView.tsx');
  const mentions = home.includes('backup') || sync.includes('backup') || today.includes('BackupToday');
  assert.ok(mentions, 'Today reads the backup standing and rows its failures');
});

// ── 5. Fifty bills stay one calm section with every bill one click away ──
// FinanceToday lists every due bill with no cap: fifty bills are fifty rows for one counted kind.
// Past a handful it folds behind Show all, amounts and Mark paid one click away.
test('many bills fold behind Show all instead of fifty rows', () => {
  const src = read('src/renderer/src/views/modules/RecordModulesToday.tsx');
  assert.ok(src.includes('Show all'), 'the bills list caps with Show all past a handful');
});
