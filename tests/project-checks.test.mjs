// node --test tests/project-checks.test.mjs — the project page keeps itself up to date (10.0 item 19): standing checks
// (a stale decision, a risk with no owner, a slipped date, each named with its source) and catch-up proposals from the
// notes changed since the project was last updated (actions and open tasks as next steps, new decisions as decisions),
// each once, never a silent edit. Pure layer (src/shared/project-checks.ts). Made-up projects only; fixed today (Monday
// 2 November 2026).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-project-checks-'));
let C;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/project-checks.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'c.mjs'), format: 'esm' }, logLevel: 'silent' });
  C = await import(pathToFileURL(path.join(work, 'c.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 10, 2, 12, 0); // Monday 2 November 2026, midday
const ms = (y, mo, d, h = 12) => new Date(y, mo - 1, d, h, 0).getTime();

const project = (over = {}) => ({
  name: 'Harbour Fit-out',
  tags: [],
  summary: '',
  next: [],
  dates: [],
  people: [],
  risks: [],
  decisions: [],
  updates: [],
  documents: [],
  notes: '',
  extra: [],
  ...over,
});

// ── Standing checks ──────────────────────────────────────────────────────────────────────────────────────────────────

test('a decision 90 days past is stale, with its source; a fresh or dateless one is never flagged', () => {
  const p = project({
    decisions: [
      { date: '1 Jul 2026', what: 'Use the northern dock for deliveries' },
      { date: '20 Oct 2026', what: 'Close the yard on Fridays' },
      { what: 'Paint the office later' },
    ],
  });
  const checks = C.standingChecks(p, NOW);
  const stale = checks.filter((c) => c.kind === 'stale-decision');
  assert.equal(stale.length, 1);
  assert.match(stale[0].words, /northern dock/);
  assert.deepEqual(stale[0].ref, { kind: 'decision', index: 0 });
  assert.doesNotMatch(stale[0].words, /—/);
});

test('a risk with no owner is named; owned and closed risks stay quiet', () => {
  const p = project({
    risks: [{ what: 'The crane booking lapses', level: 'high' }, { what: 'Timber price moves', owner: 'Priya Shah' }, { what: 'Old scare', closed: true }],
  });
  const checks = C.standingChecks(p, NOW);
  const ownerless = checks.filter((c) => c.kind === 'risk-owner');
  assert.equal(ownerless.length, 1);
  assert.match(ownerless[0].words, /crane booking/);
  assert.deepEqual(ownerless[0].ref, { kind: 'risk', index: 0 });
});

test('a key date gone by and still open has slipped; future, today and finished ones have not', () => {
  const p = project({
    dates: [
      { when: '20 Oct 2026', what: 'Racking lands' },
      { when: '20 Nov 2026', what: 'Doors open' },
      { when: '2 Nov 2026', what: 'Due today' },
      { when: '19 Oct 2026', what: 'Held the review', status: 'Held' },
    ],
  });
  const checks = C.standingChecks(p, NOW);
  const slipped = checks.filter((c) => c.kind === 'slipped-date');
  assert.equal(slipped.length, 1);
  assert.match(slipped[0].words, /Racking lands/);
  assert.deepEqual(slipped[0].ref, { kind: 'date', index: 0 });
});

test('checks come slipped first, then ownerless risks, then stale decisions', () => {
  const p = project({
    dates: [{ when: '20 Oct 2026', what: 'Racking lands' }],
    risks: [{ what: 'The crane booking lapses' }],
    decisions: [{ date: '1 Jul 2026', what: 'Use the northern dock' }],
  });
  assert.deepEqual(
    C.standingChecks(p, NOW).map((c) => c.kind),
    ['slipped-date', 'risk-owner', 'stale-decision'],
  );
});

// ── Since when: the project's own updated marker ─────────────────────────────────────────────────────────────────────

const note = (over = {}) => ({ path: 'Harbour/Note.md', title: 'Note', modified: ms(2026, 10, 25), ...over });

test('notes changed since updated, newest first, capped at ten', () => {
  const notes = Array.from({ length: 12 }, (_, i) => note({ path: `Harbour/N${i}.md`, title: `N${i}`, modified: ms(2026, 10, 21 + (i % 10)) }));
  const old = note({ path: 'Harbour/Old.md', title: 'Old', modified: ms(2026, 10, 10) });
  const kept = C.notesForCatchup([...notes, old], '2026-10-20', NOW);
  assert.equal(kept.length, 10);
  assert.ok(kept.every((n) => n.path !== 'Harbour/Old.md'));
  assert.ok(kept[0].modified >= kept[kept.length - 1].modified);
});

test('with no updated marker, only the last thirty days count (never the whole history)', () => {
  const fresh = note({ path: 'Harbour/Fresh.md', modified: ms(2026, 10, 25) });
  const ancient = note({ path: 'Harbour/Ancient.md', modified: ms(2026, 9, 1) });
  assert.deepEqual(
    C.notesForCatchup([fresh, ancient], undefined, NOW).map((n) => n.path),
    ['Harbour/Fresh.md'],
  );
});

// ── Catch-up proposals ───────────────────────────────────────────────────────────────────────────────────────────────

const MEETING = `---
type: meeting
date: 2026-10-30
---

## Decisions

- The dock work starts on Monday

## Actions

- [ ] Send the quote to the mill — Priya Shah · by 6 Nov 2026
Sam to confirm the cabling contractor by Friday
`;

test('new actions and decisions in changed notes are proposed, with their source', () => {
  const p = project({});
  const out = C.catchUpProposals(p, [{ ...note({ path: 'Harbour/Review.md', title: 'Review' }), content: MEETING }], NOW);
  const whats = out.map((x) => x.what);
  assert.ok(whats.includes('Send the quote to the mill'));
  assert.ok(whats.includes('Confirm the cabling contractor'));
  const dec = out.find((x) => x.kind === 'decision');
  assert.equal(dec?.what, 'The dock work starts on Monday');
  assert.equal(dec?.from, 'Review');
  assert.equal(dec?.path, 'Harbour/Review.md');
  assert.ok(out.every((x) => x.key && !x.words?.includes('—')));
});

test('already on the project means never proposed: next steps, decisions, ticked and filed lines', () => {
  const p = project({
    next: [{ done: false, what: 'Send the quote to the mill' }],
    decisions: [{ what: 'The dock work starts on Monday' }],
  });
  const content = `${MEETING}\n- [x] Ticked long ago\nFiled away → [[Harbour Fit-out]]\n`;
  const out = C.catchUpProposals(p, [{ ...note(), content }], NOW);
  assert.deepEqual(
    out.map((x) => x.what),
    ['Confirm the cabling contractor'],
  );
});

test('no changed notes means no proposals; the page shows twenty and counts the rest', () => {
  assert.deepEqual(C.catchUpProposals(project({}), [], NOW), []);
  const many = Array.from({ length: 25 }, (_, i) => `- [ ] Job number ${i}`).join('\n');
  const out = C.catchUpProposals(project({}), [{ ...note(), content: `## Actions\n\n${many}\n` }], NOW);
  assert.equal(out.length, 25);
  const capped = C.capProposals(out);
  assert.equal(capped.shown.length, 20);
  assert.equal(capped.more, 5);
  assert.equal(C.moreWords(capped.shown.length, out.length), 'and 5 more');
  assert.equal(C.moreWords(3, 3), '');
});

test('proposal keys are steady: the same words from the same note key the same, whatever the day', () => {
  const notes = [{ ...note(), content: MEETING }];
  const a = C.catchUpProposals(project({}), notes, NOW);
  const b = C.catchUpProposals(project({}), notes, new Date(2026, 10, 9, 12, 0));
  assert.deepEqual(
    a.map((x) => x.key),
    b.map((x) => x.key),
  );
  assert.equal(new Set(a.map((x) => x.key)).size, a.length);
});

test('a hundred tick boxes across linked notes wait on nothing: only the project’s own notes propose (8 Nov 2026, calm Today)', () => {
  // "Desk Hub: 101 waiting" was the box counter at work: every tick box in every note linked to the
  // project counted. Waiting counts real tasks on the project: its own notes' open tasks. A linked
  // (see-also) note's boxes and decisions never propose, however many.
  const p = project({});
  const own = { ...note({ path: 'Harbour/Own.md', title: 'Own' }), content: '## Actions\n\n- [ ] Ring the mill about the quote\n' };
  const boxes = Array.from({ length: 100 }, (_, i) => `- [ ] Linked job ${i}`).join('\n');
  const linked = { ...note({ path: 'Elsewhere/Log.md', title: 'Log', linked: true }), content: `## Actions\n\n${boxes}\n\n## Decisions\n\n- Linked lines decide nothing\n` };
  const out = C.catchUpProposals(p, [linked, own], NOW);
  assert.deepEqual(
    out.map((x) => x.what),
    ['Ring the mill about the quote'],
  );
  // The changed-notes door shuts too: a linked note is never "changed since updated" for catch-up.
  const kept = C.notesForCatchup(
    [
      { path: 'Elsewhere/Log.md', title: 'Log', modified: ms(2026, 10, 25), linked: true },
      { path: 'Harbour/Own.md', title: 'Own', modified: ms(2026, 10, 24) },
    ],
    '2026-10-20',
    NOW,
  );
  assert.deepEqual(
    kept.map((n) => n.path),
    ['Harbour/Own.md'],
  );
});

test('the banner reads plainly: counts, never dollars, no em dash', () => {
  const words = C.catchupWords({ proposals: 3, checks: 2, updated: '20 Oct 2026' });
  assert.match(words, /3 waiting from your notes since 20 Oct 2026/);
  assert.match(words, /2 need a look/);
  // 10.0 second round N2: an ISO day renders as day words, never raw.
  assert.equal(C.catchupWords({ proposals: 1, checks: 1, updated: '2026-11-02' }, new Date(2026, 10, 2, 12, 0)), '1 waiting from your notes since Mon 2 Nov. 1 needs a look.');
  assert.doesNotMatch(C.catchupWords({ proposals: 1, checks: 0, updated: '2026-11-02' }), /2026-11-02/);
  assert.equal(C.catchupWords({ proposals: 0, checks: 0 }), 'Caught up. Nothing in your notes waits on this project.');
  assert.doesNotMatch(words, /—/);
  assert.doesNotMatch(words, /\$/);
});
