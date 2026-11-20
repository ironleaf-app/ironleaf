// node --test tests/date-strip.test.mjs — one date strip, everywhere (v9, 6 Nov 2026). Each stop keeps its own
// room in order, a long gap reads as a marked break, Today keeps its true place, the stops past counting fold
// honestly ("8 earlier"), and the stops that matter (next, late, last done) are named. Dates under every stop
// (v10, 6 Nov 2026, 14 bare dots "still says nothing"): each day its date, shared days a count, next with its
// name, Today above so they never collide, opened strips thinned to what fits with firsts and next kept. Fails
// without each change.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-date-strip-'));
let S;
let T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/date-strip.ts'), platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  await build({ input: path.join(root, 'src/shared/timeline.ts'), platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
  T = await import(pathToFileURL(path.join(work, 't.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));
const layoutStrip = (...a) => S.layoutStrip(...a);
const packMarks = (...a) => T.packMarks(...a);

const TODAY = 20400;
let n = 0;
const stop = (day, over = {}) => ({ id: `s${n++}`, day, label: `Stop ${n}`, date: `day ${day}`, done: false, late: false, ...over });
const gaps = (xs) => xs.slice(1).map((x, i) => x - xs[i]);

test('1 milestone: one stop with its own room, Today beside it', () => {
  const l = layoutStrip([stop(TODAY + 3)], TODAY);
  assert.equal(l.stops.length, 1);
  assert.equal(l.stops[0].x01, 0.5);
  assert.deepEqual(l.breaks, []);
  assert.equal(l.earlier, 0);
  assert.equal(l.later, 0);
  assert.equal(l.today01, 0);
  assert.equal(l.stops[0].key, 'next');
});

test('3 milestones: ordered, each its own room, Today at its true place', () => {
  const l = layoutStrip([stop(TODAY + 10), stop(TODAY - 40, { done: true }), stop(TODAY + 2)], TODAY);
  assert.deepEqual(l.stops.map((s) => s.day), [TODAY - 40, TODAY + 2, TODAY + 10]);
  for (const g of gaps(l.stops.map((s) => s.x01))) assert.ok(g > 0.3, `room between stops (saw ${g})`);
  assert.equal(l.today01, 1 / 3);
  assert.equal(l.stops[0].key, 'last-done');
  assert.equal(l.stops[1].key, 'next');
});

test('8 milestones: all on show, nothing folded', () => {
  const all = Array.from({ length: 8 }, (_, i) => stop(TODAY + i + 1));
  const l = layoutStrip(all, TODAY);
  assert.equal(l.stops.length, 8);
  assert.equal(l.earlier + l.later, 0);
});

for (const count of [25, 80]) {
  test(`${count} milestones: the window shows, the rest folds honestly`, () => {
    const all = [
      ...Array.from({ length: Math.floor(count / 2) }, (_, i) => stop(TODAY - (count - i), { late: i % 3 !== 0, done: i % 3 === 0 })),
      ...Array.from({ length: Math.ceil(count / 2) }, (_, i) => stop(TODAY + i)),
    ];
    const l = layoutStrip(all, TODAY);
    assert.equal(l.stops.length + l.earlier + l.later, count);
    assert.ok(l.earlier > 0 || l.later > 0, 'past counting, something folds');
    assert.ok(l.stops.length <= S.STRIP_LATE_SHOWN + 1 + S.STRIP_COMING_SHOWN, `the window stays small (saw ${l.stops.length})`);
    // Its own room: strictly ordered, evenly spaced, never piled.
    const xs = l.stops.map((s) => s.x01);
    assert.deepEqual([...xs].sort((a, b) => a - b), xs);
    for (const g of gaps(xs)) assert.ok(Math.abs(g - 1 / xs.length) < 1e-9, `even rooms (saw ${g})`);
    // The stops that matter are named.
    assert.ok(l.stops.some((s) => s.key === 'next'), 'next is named');
    assert.ok(l.stops.some((s) => s.key === 'last-done'), 'last done is named');
    assert.ok(l.stops.some((s) => s.key === 'late'), 'late is named');
    for (const s of l.stops.filter((s) => s.key)) assert.ok(s.label && s.date, 'a named stop carries its date and name');
    // Today sits after every stop up to today.
    assert.equal(l.today01, l.stops.filter((s) => s.day <= TODAY).length / l.stops.length);
  });
}

test('all in one day: every stop keeps its own room, no breaks', () => {
  const l = layoutStrip(Array.from({ length: 10 }, () => stop(TODAY + 1)), TODAY);
  assert.equal(new Set(l.stops.map((s) => s.x01)).size, l.stops.length);
  assert.deepEqual(l.breaks, []);
});

test('months apart: long gaps read as marked breaks, never empty distance', () => {
  const days = [TODAY - 200, TODAY - 100, TODAY - 90, TODAY + 5, TODAY + 200];
  const l = layoutStrip(days.map((d) => stop(d, d < TODAY ? { done: true } : {})), TODAY);
  assert.equal(l.earlier, 2);
  assert.equal(l.breaks.length, 2);
  for (const b of l.breaks) assert.ok(b.days > S.STRIP_BREAK_DAYS, `a break stands for empty days (saw ${b.days})`);
  const xs = l.stops.map((s) => s.x01);
  for (const g of gaps(xs)) assert.ok(Math.abs(g - 1 / xs.length) < 1e-9, `no empty distance (saw ${g})`);
});

test('showAll opens the folds: every stop on show, in order', () => {
  const all = Array.from({ length: 40 }, (_, i) => stop(TODAY - 20 + i));
  const l = layoutStrip(all, TODAY, true);
  assert.equal(l.stops.length, 40);
  assert.equal(l.earlier, 0);
  assert.equal(l.later, 0);
  assert.deepEqual(l.stops.map((s) => s.day), [...all].sort((a, b) => a.day - b.day).map((s) => s.day));
});

test('the Timeline packs crowded marks by the same rule: no overlap, nothing lost', () => {
  // 80 marks on one day, as the TimelineView packs them (3 lanes, 16px apart, the rest folded nearest).
  const marks = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, x: 500 }));
  const p = packMarks(marks, 16, 3);
  assert.ok(p.lanes <= 3, `three lanes at most (saw ${p.lanes})`);
  const folded = [...p.folded.values()].flat().length;
  assert.equal(p.shown.length + folded, 80);
  assert.ok(folded > 0, 'the marks past counting fold, honestly kept');
});

test('one mechanism: both cards draw the shared strip', () => {
  const dash = read('src/renderer/src/views/project/LayoutDashboard.tsx');
  assert.ok(dash.includes("from '../../components/DateStrip'"), 'the dashboard Milestones card draws DateStrip');
  assert.ok(!dash.includes('ly-track-dot'), 'no true-date dots left on the dashboard');
  const hub = read('src/renderer/src/views/project/ProjectHub.tsx');
  assert.ok(hub.includes("from '../../components/DateStrip'"), 'the Next milestones tile draws DateStrip');
  assert.ok(!hub.includes('MiniTimeline'), 'no true-date mini strip left on the hub');
  const strip = read('src/renderer/src/components/DateStrip.tsx');
  assert.ok(strip.includes('layoutStrip'), 'the strip draws the shared layout');
  assert.ok(strip.includes('stripLabels') && strip.includes('thinLabels'), 'the strip draws the shared date labels');
});

// ── Dates under every stop (v10) ───────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dstop = (day, date, over = {}) => ({ id: `d${n++}`, day, label: `Milestone ${n}`, date, done: false, late: false, ...over });
const dateOf = (day) => `${((day % 28) + 28) % 28 + 1} ${MONTHS[Math.floor(day / 28) % 12]}`;
const noEstimatedOverlap = (labels, W) => {
  const xs = [...labels].sort((a, b) => a.x01 - b.x01);
  for (let i = 1; i < xs.length; i++) {
    const gap = (xs[i].x01 - xs[i - 1].x01) * W - (S.labelWidth(xs[i - 1]) + S.labelWidth(xs[i])) / 2;
    assert.ok(gap >= 8 - 1e-6, `labels never touch (saw ${gap.toFixed(1)}px between "${xs[i - 1].text}" and "${xs[i].text}")`);
  }
};

test('date labels: every day in view shows its date, shared days carry a count', () => {
  const l = layoutStrip([dstop(TODAY, '5 Nov'), dstop(TODAY, '5 Nov'), dstop(TODAY + 1, '6 Nov')], TODAY);
  const labels = S.stripLabels(l.stops, TODAY);
  assert.deepEqual(labels.map((x) => x.text), ['5 Nov · 2', '6 Nov']);
  assert.deepEqual(labels.map((x) => x.day), [TODAY, TODAY + 1]);
  for (const x of labels) assert.ok(x.x01 > 0 && x.x01 < 1, 'a label sits on the strip');
});

test('date labels: the next stop adds its short name, firsts of months marked, tones say the state', () => {
  const all = [dstop(TODAY - 40, '26 Sep', { done: true }), dstop(TODAY - 2, '3 Nov', { late: true }), dstop(TODAY + 1, '6 Nov', { label: 'Menu proof due back' }), dstop(TODAY + 40, '16 Dec')];
  const l = layoutStrip(all, TODAY);
  const labels = S.stripLabels(l.stops, TODAY);
  const next = labels.find((x) => x.isNext);
  assert.ok(next, 'next is kept');
  assert.equal(next.nextName, 'Menu proof due back', 'the next stop shows its short name');
  assert.deepEqual(labels.filter((x) => x.firstOfMonth).map((x) => x.text), ['26 Sep', '3 Nov', '16 Dec'], 'the first of each month reads');
  assert.deepEqual(labels.map((x) => x.tone), ['done', 'late', 'next', 'coming'], 'colour says done, late and coming');
});

for (const count of [1, 3, 8, 25, 80]) {
  test(`date labels with ${count} stops: folded shows every date, opened thins to what fits with firsts and next kept`, () => {
    const all = Array.from({ length: count }, (_, i) => {
      const day = TODAY - Math.floor(count / 2) + i;
      return dstop(day, dateOf(day), day < TODAY ? (i % 3 === 0 ? { done: true } : { late: true }) : {});
    });
    const folded = S.thinLabels(S.stripLabels(layoutStrip(all, TODAY).stops, TODAY), 900);
    assert.ok(folded.length >= 1, 'something shows');
    assert.ok(folded.every((x) => x.text), 'every label carries its date');
    noEstimatedOverlap(folded, 900);
    const open = S.thinLabels(S.stripLabels(layoutStrip(all, TODAY, true).stops, TODAY), Math.max(900, count * 30));
    const labels = S.stripLabels(layoutStrip(all, TODAY, true).stops, TODAY);
    for (const x of labels.filter((y) => y.firstOfMonth || y.isNext)) assert.ok(open.some((o) => o.day === x.day), `kept: ${x.text}${x.isNext ? ' (next)' : ' (first)'}`);
    noEstimatedOverlap(open, Math.max(900, count * 30));
  });
}

test('date labels all on one day: one label with the count, never a pile', () => {
  const all = Array.from({ length: 10 }, () => dstop(TODAY + 1, '6 Nov'));
  const labels = S.stripLabels(layoutStrip(all, TODAY, true).stops, TODAY);
  assert.deepEqual(labels.map((x) => x.text), ['6 Nov · 10']);
  const thinned = S.thinLabels(labels, 900);
  assert.equal(thinned.length, 1, 'one day reads once');
});

// Break-it finding 9 (6 Nov 2026): labels centred near the ends spilled past them. Every kept label now
// sits wholly inside the strip at both ends, on a narrow tile and in the opened wide view, Today included.
test('date labels stay inside the strip at both ends (320px, 60 stops; and the wide view)', () => {
  const inside = (labels, W) => {
    for (const x of labels) {
      const half = S.labelWidth(x) / 2;
      assert.ok(x.x01 * W - half >= -1e-6, `left edge inside ("${x.text}" at ${(x.x01 * W).toFixed(1)}px of ${W})`);
      assert.ok(x.x01 * W + half <= W + 1e-6, `right edge inside ("${x.text}" at ${(x.x01 * W).toFixed(1)}px of ${W})`);
    }
    noEstimatedOverlap(labels, W);
  };
  const all60 = Array.from({ length: 60 }, (_, i) => { const day = TODAY - 30 + i; return dstop(day, dateOf(day), day < TODAY ? (i % 3 === 0 ? { done: true } : { late: true }) : {}); });
  inside(S.thinLabels(S.stripLabels(layoutStrip(all60, TODAY).stops, TODAY), 320), 320);
  inside(S.thinLabels(S.stripLabels(layoutStrip(all60, TODAY, true).stops, TODAY), 60 * 30), 60 * 30);
  // Must-keeps are still kept, just clamped.
  const kept = S.thinLabels(S.stripLabels(layoutStrip(all60, TODAY, true).stops, TODAY), 60 * 30);
  for (const x of S.stripLabels(layoutStrip(all60, TODAY, true).stops, TODAY).filter((y) => y.firstOfMonth || y.isNext)) assert.ok(kept.some((o) => o.day === x.day), `kept: ${x.text}`);
  // A single stop at an end is clamped too.
  inside(S.thinLabels([{ day: TODAY, text: '6 Nov', x01: 0, firstOfMonth: true, isNext: false, nextName: '', tone: 'coming' }], 320), 320);
  inside(S.thinLabels([{ day: TODAY, text: '6 Nov', x01: 1, firstOfMonth: true, isNext: false, nextName: '', tone: 'coming' }], 320), 320);
  // "Today" at either end (all-future and all-past projects): its word clamps inside by the same helper
  // the strip draws with, while today01 (the dashed line) keeps its true place.
  const future = layoutStrip([dstop(TODAY + 3, '9 Nov')], TODAY);
  assert.equal(future.today01, 0);
  assert.ok(S.clampedLabel01(future.today01, 40, 320) * 320 - 20 >= 0, 'Today word inside at the left end');
  const past = layoutStrip([dstop(TODAY - 3, '3 Nov', { done: true })], TODAY);
  assert.equal(past.today01, 1);
  assert.ok(S.clampedLabel01(past.today01, 40, 320) * 320 + 20 <= 320, 'Today word inside at the right end');
  // The component draws the Today word at the clamped place, not centred on the line.
  assert.ok(read('src/renderer/src/components/DateStrip.tsx').includes('clampedLabel01'), 'DateStrip clamps the Today word');
});

test('the milestone rows fold to around today, opening in place like Key dates', () => {
  // v10, 6 Nov 2026 (80 rows pushed What's next far down): under the strip show late, the last done and the
  // next few, with "Show all N" opening in place. Rows and pills stay as they are.
  const dash = read('src/renderer/src/views/project/LayoutDashboard.tsx');
  const timeline = dash.slice(dash.indexOf('function Timeline('), dash.indexOf('const BOARD_SHOWN'));
  assert.ok(timeline.includes("x.tone === 'bad'") && timeline.includes('coming.slice(0, 5)'), 'late, the last done and the next few show');
  assert.ok(timeline.includes('Show all ${m.items.length}') && timeline.includes('Show less'), 'the fold opens in place, like Key dates');
  assert.ok(timeline.includes("pj-expand") && timeline.includes('setOpen(true)'), 'a revealed line opens the fold, and a strip stop goes to its row');
  assert.ok(timeline.includes('ly-dates') && timeline.includes('ly-date-chip'), 'rows and pills stay as they are');
});
