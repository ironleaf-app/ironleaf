// node --test tests/toast-clock.test.mjs — how long a message at the foot of the window stays (src/renderer/src/lib/
// toastClock.ts; 18 Oct 2026: a "Sent to Scout…" message looked as if it never went). On a made-up clock: it goes by
// itself, a newer message starts its own time, the pointer resting on it holds it (never past 20 s), a late timer or the
// next click after its time ends it, and a hidden window shows it again for a moment when seen.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-toast-'));
let T;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/toastClock.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 't.mjs'), format: 'esm' }, logLevel: 'silent' });
  T = await import(pathToFileURL(path.join(work, 't.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** A made-up clock with timers, and a toast on it. `late` holds timers back (a busy or hidden window). */
function rig() {
  let now = 0, id = 0, ended = 0, hidden = false, late = 0;
  const timers = new Map();
  const clock = T.toastClock({
    now: () => now,
    setTimer: (fn, ms) => (timers.set(++id, { fn, at: now + ms }), id),
    clearTimer: (h) => timers.delete(h),
    hidden: () => hidden,
    onEnd: () => ended++,
  });
  const run = (ms) => {
    const to = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at + late <= to).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = Math.max(now, next[1].at + late);
      next[1].fn();
    }
    now = to;
  };
  return { clock, run, get ended() { return ended; }, hide: (v) => (hidden = v), lateBy: (ms) => (late = ms), get timers() { return timers.size; } };
}

test('a message goes by itself after its time', () => {
  const r = rig();
  r.clock.show(7000);
  r.run(6900);
  assert.equal(r.ended, 0);
  r.run(200);
  assert.equal(r.ended, 1);
  assert.equal(r.clock.active, false);
  assert.equal(r.timers, 0, 'no timer left behind');
});

test('its time stays between 3 and 9 seconds whatever the caller asks', () => {
  const r = rig();
  r.clock.show(60000);
  r.run(9001);
  assert.equal(r.ended, 1);
  r.clock.show(500);
  r.run(2900);
  assert.equal(r.ended, 1);
  r.run(200);
  assert.equal(r.ended, 2);
});

test('a newer message starts its own time; the older one’s timer never ends it early', () => {
  const r = rig();
  r.clock.show(5000);
  r.run(4000);
  r.clock.show(5000);
  r.run(4000);
  assert.equal(r.ended, 0, 'the first message’s time would have run out here');
  r.run(1100);
  assert.equal(r.ended, 1);
});

test('the pointer resting on it holds it, never past 20 s; leaving gives it 2.5 s', () => {
  const r = rig();
  r.clock.show(5000);
  r.run(1000);
  r.clock.hold(true);
  r.run(10000);
  assert.equal(r.ended, 0, 'held');
  r.clock.hold(false);
  r.run(2400);
  assert.equal(r.ended, 0);
  r.run(200);
  assert.equal(r.ended, 1, 'gone 2.5 s after the pointer left');
  r.clock.show(5000);
  r.clock.hold(true);
  r.run(19900);
  assert.equal(r.ended, 1);
  r.run(200);
  assert.equal(r.ended, 2, 'a pointer left resting on it can’t keep it for ever');
});

test('a late timer, or the next click after its time, ends it all the same', () => {
  const r = rig();
  r.lateBy(60000);
  r.clock.show(5000);
  r.run(5100);
  assert.equal(r.ended, 0, 'the timer is running late');
  r.clock.poke();
  assert.equal(r.ended, 0, 'just past its time: not yet');
  r.run(300);
  r.clock.poke();
  assert.equal(r.ended, 1, 'a click after its time ends it');
});

test('a click before its time leaves it, and closing it by hand ends it once', () => {
  const r = rig();
  r.clock.show(5000);
  r.run(1000);
  r.clock.poke();
  assert.equal(r.ended, 0);
  r.clock.close();
  r.clock.close();
  assert.equal(r.ended, 1);
  assert.equal(r.timers, 0);
});

test('a window out of sight when its time ran out shows it for 3 s when seen again', () => {
  const r = rig();
  r.clock.show(5000);
  r.hide(true);
  r.run(60000);
  assert.equal(r.ended, 0, 'never seen: it waits');
  r.hide(false);
  r.clock.seen();
  r.run(2900);
  assert.equal(r.ended, 0);
  r.run(200);
  assert.equal(r.ended, 1);
});
