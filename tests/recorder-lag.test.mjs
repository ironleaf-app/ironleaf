// node --test tests/recorder-lag.test.mjs — live words ran minutes behind, and the write-up took minutes
// (6 Nov 2026, m5-live-words-lag): a real run on the test laptop showed first words 33–58 s after Record,
// speech only to ~0:33 written at 204 s of recording, and ~4.5 min after Stop before the note landed.
// Cause: every piece queued one at a time (the window's send chain and Muse Code's own queue), while a
// meeting with both sides sends two clips per piece at ~15.7 s each — the line falls behind from the start.
// These checks drive the logic with fake services at realistic delays (no real model); each fails without
// its fix. A real run on the Windows laptop is still needed (see the report for what only it can prove).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-recorder-lag-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/recorder.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

test('pieces go together, up to a sensible limit, in order — never one at a time', async () => {
  assert.equal(typeof R.SendGate, 'function', 'a shared gate sends pieces together');
  assert.ok(Number.isInteger(R.SEND_SLOTS) && R.SEND_SLOTS >= 2 && R.SEND_SLOTS <= 4, `a sensible limit on requests at once (${R.SEND_SLOTS})`);
  // Six clips through a 40 ms fake service: the most running at once is the limit, every one finishes.
  const gate = new R.SendGate();
  let running = 0;
  let most = 0;
  const started = [];
  await Promise.all(Array.from({ length: 6 }, (_, i) => gate.send(`clip ${i}`, async () => {
    running++;
    most = Math.max(most, running);
    started.push(i);
    await sleep(40);
    running--;
    return `words ${i}`;
  })));
  assert.equal(most, R.SEND_SLOTS, `up to ${R.SEND_SLOTS} at once, never one at a time (saw ${most})`);
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5], 'first cut still goes first');
  assert.equal(gate.inFlight, 0, 'nothing left in flight');
});

test('the same piece is never sent twice, and a failure never jams the line', async () => {
  const gate = new R.SendGate();
  let calls = 0;
  const slow = () => sleep(30).then(() => (++calls, 'heard'));
  const [a, b] = await Promise.all([gate.send('piece 3 pc', slow), gate.send('piece 3 pc', slow)]);
  assert.equal(a, 'heard');
  assert.equal(b, 'heard');
  assert.equal(calls, 1, 'one request for two asks while it flies');
  assert.equal(gate.inFlight, 0, 'landed once');
  // A failure settles, frees its slot, and the next piece still goes.
  const gate2 = new R.SendGate();
  await assert.rejects(gate2.send('bad piece', async () => { await sleep(10); throw new Error('the service failed'); }), /the service failed/);
  assert.equal(gate2.inFlight, 0, 'the failed piece freed its slot');
  assert.equal(await gate2.send('next piece', async () => 'heard'), 'heard', 'the line moves on after a failure');
});

test('the test-laptop meeting, driven with a fake service: behind one at a time, close behind together', async () => {
  // The take: 214 s of speech, pieces of ~20 s, both sides talking (two clips a piece, 22 clips), each
  // clip answered after 157 ms — the measured 15.7 s a Muse clip takes, at a hundredth of the time, with
  // clips cut 100 ms apart (the real 10 s of audio a clip arrives every). The scale is stated, not hidden.
  const clips = [];
  for (let piece = 0; piece < 11; piece++) for (const side of ['mic', 'pc']) clips.push({ key: `piece ${piece} ${side}`, at: (piece * 2 + (side === 'pc' ? 1 : 0)) * 100 });
  async function run(slots) {
    const gate = new R.SendGate(slots);
    const land = new Map();
    let requests = 0;
    const t0 = Date.now();
    await Promise.all(clips.map(async (c) => {
      await sleep(Math.max(0, c.at - (Date.now() - t0)));
      await gate.send(c.key, async () => {
        requests++;
        await sleep(157);
        land.set(c.key, Date.now() - t0);
        return 'heard';
      });
    }));
    return { wall: Date.now() - t0, land, requests };
  }
  const one = await run(1);
  assert.equal(one.requests, 22, 'one request a clip, nothing twice');
  const firstMic = one.land.get('piece 0 mic');
  const firstPc = one.land.get('piece 0 pc');
  assert.ok(firstPc - firstMic >= 150, `one at a time, the other side waits a whole clip (${firstPc - firstMic} ms)`);
  // At the Stop moment (the last clip cut, ~2.1 s in), most clips are still unwritten one at a time.
  const lastCut = 21 * 100;
  const unwrittenOne = clips.filter((c) => (one.land.get(c.key) ?? Infinity) > lastCut).length;
  assert.ok(unwrittenOne >= 8, `one at a time leaves a backlog at Stop (${unwrittenOne} of 22 unwritten)`);
  const together = await run(R.SEND_SLOTS);
  assert.equal(together.requests, 22, 'together costs the same: one request a clip');
  const firstMic2 = together.land.get('piece 0 mic');
  const firstPc2 = together.land.get('piece 0 pc');
  assert.ok(Math.abs(firstPc2 - firstMic2) < 150, `both sides land together (${firstPc2 - firstMic2} ms apart)`);
  const unwrittenTogether = clips.filter((c) => (together.land.get(c.key) ?? Infinity) > lastCut).length;
  assert.ok(unwrittenTogether <= 2, `together stays close behind (${unwrittenTogether} unwritten at Stop)`);
  const drainOne = one.wall - lastCut;
  const drainTogether = together.wall - lastCut;
  assert.ok(drainTogether < drainOne / 2, `after Stop the wait is half as long (${drainTogether} ms against ${drainOne} ms)`);
  // Answers out of order still land on their own pieces: nothing lost, nothing on the wrong line.
  const gate = new R.SendGate(R.SEND_SLOTS);
  const heard = new Map();
  await Promise.all(clips.slice(0, 6).map((c, i) => gate.send(c.key, async () => {
    await sleep(60 - i * 8);
    heard.set(c.key, `words ${c.key}`);
    return c.key;
  })));
  assert.deepEqual([...heard.keys()].sort(), clips.slice(0, 6).map((c) => c.key).sort(), 'every answer on its own piece, however they finish');
});

test('a service that stalls, fails midway or answers out of order: the line never jams', async () => {
  // One clip stalls forever: the other two slots keep the meeting moving (the window's own 90 s piece
  // time-out still fails the stalled one; the gate never waits for it).
  const gate = new R.SendGate();
  const stalled = gate.send('stalled piece', () => new Promise(() => {}));
  stalled.catch(() => undefined);
  const heard = await Promise.all([
    gate.send('piece 9 mic', async () => { await sleep(20); return 'heard mic'; }),
    gate.send('piece 9 pc', async () => { await sleep(10); return 'heard pc'; }),
  ]);
  assert.deepEqual(heard, ['heard mic', 'heard pc'], 'a stalled clip holds one slot, never the line');
  assert.equal(gate.inFlight, 1, 'only the stalled clip still flies');
  // Failures midway free their slots: fail, fail, then the network returns and all land.
  const gate2 = new R.SendGate();
  let down = true;
  const flaky = async () => {
    await sleep(10);
    if (down) throw new Error('fetch failed');
    return 'heard late';
  };
  await assert.rejects(gate2.send('piece 1 mic', flaky), /fetch failed/);
  await assert.rejects(gate2.send('piece 1 pc', flaky), /fetch failed/);
  down = false;
  assert.deepEqual(await Promise.all([gate2.send('piece 1 mic', flaky), gate2.send('piece 1 pc', flaky)]), ['heard late', 'heard late'], 'tried again when it returns, both land');
  assert.equal(gate2.inFlight, 0, 'nothing left behind');
});

test('a route that cannot keep up says so once, in plain words — and only then', () => {
  assert.equal(typeof R.isBehind, 'function', 'behind judged from the pieces waiting');
  assert.equal(typeof R.behindWords, 'function', 'one calm line for it');
  assert.ok(!R.isBehind(0, 0), 'nothing waiting: nothing said');
  assert.ok(!R.isBehind(1, 10), 'one piece, just cut: nothing said');
  assert.ok(R.isBehind(4, 20), 'pieces piling up: said');
  assert.ok(R.isBehind(1, 120), 'one piece waiting two minutes: said');
  const words = R.behindWords();
  assert.ok(words.length >= 20 && words.length <= 220, 'short and plain');
  assert.doesNotMatch(words, /—/, 'no em dash in words a person sees');
  assert.doesNotMatch(words, /DSH|DeepSeek|pi-ai|Muse|queue|latency|buffer/i, 'no jargon, no engine names');
  assert.match(words, /behind/i, 'says it is behind');
  assert.match(words, /catch up|after (you )?stop/i, 'says it catches up');
  assert.match(words, /recording is (safe|kept)/i, 'says the recording is safe');
  // The window says it where it records, once (its own line, never a toast per piece).
  const state = read('src/renderer/src/state/recorder.ts');
  assert.match(state, /behindWords|isBehind/, 'the window judges behind and says the line');
  assert.doesNotMatch(state, /toast\(behindWords\(\)/, 'never a toast per piece');
});

test('the window sends together, and Stop says how far along from the first moment', () => {
  const state = read('src/renderer/src/state/recorder.ts');
  assert.match(state, /SendGate|SEND_SLOTS/, 'live pieces go through the shared gate');
  assert.doesNotMatch(state, /queues\.get\(id\) \?\? Promise\.resolve\(\)\)\.then\(run, run\)/, 'no more one-at-a-time send chain');
  // After Stop the card counts the live backlog too: the transcribing count is set before the live
  // pieces are waited for, so the page says what it is doing with how far along from the first moment.
  const finishAt = state.indexOf('export async function finishJob');
  assert.ok(finishAt > 0, 'finishJob found');
  const finish = state.slice(finishAt, finishAt + 6000);
  const progressAt = finish.indexOf("phase: 'transcribing'");
  const drainAt = Math.max(finish.indexOf('.drain()'), finish.indexOf('queues.get(id) ?? Promise.resolve()'));
  assert.ok(progressAt > 0 && drainAt > 0 && progressAt < drainAt, 'the transcribing count is set before the live backlog is waited for');
  const view = read('src/renderer/src/views/MeetingRecorder.tsx');
  assert.match(view, /Writing down the rest of the meeting/, 'the card says what it is doing with how far along');
});
