// node --test tests/recorder-extra-loopback.test.mjs — hearing a call on any output, not just the Windows default
// (6 Nov 2026, m6-any-speaker-capture: a user lost the other people's words in a real meeting). Chromium's loopback
// hears only the default speakers; a call on any other headset records only the person's own voice. The fix is an
// extra, never a replacement: while a meeting records, a contained native process captures the other output's
// loopback too (vendored native-recorder-nodejs, WASAPI), and its sound is mixed into the existing far-side path —
// the same pieces, the same echo and voice gate, the same billing. The same call heard twice is never sent twice:
// one mixed side, and a same-device guard that stops the extra when both routes hear one sound. Pure
// choice/mix/guard rules in src/shared/recorder.ts (fake devices, fake samples), the contained child
// (src/main/extra-loopback-child.cjs) against a stub vendor, and the manager (src/main/extra-loopback.ts) against a
// scripted child. The native binary itself only loads on Windows (proven on the test laptop, see the report).
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-recorder-extra-'));
/** Forked children, killed when the file ends even if a test failed them open (a leaked child hangs the runner). */
const spawned = [];
let R, E;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/recorder.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  await build({ input: path.join(root, 'src/main/extra-loopback.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'e.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
  E = await import(pathToFileURL(path.join(work, 'e.mjs')).href);
});
after(() => {
  for (const c of spawned.splice(0)) {
    try {
      c.kill('SIGKILL');
    } catch {
      // Gone already.
    }
  }
  rmSync(work, { recursive: true, force: true });
});

const outs = (def, comms) => [
  { deviceId: 'default', label: def ? `Default - ${def}` : '' },
  { deviceId: 'communications', label: comms ? `Communications - ${comms}` : '' },
];
const natives = (...rows) => rows.map(([id, name, isDefault]) => ({ id, name, type: 'output', isDefault: !!isDefault }));

/** Speech-like sound: a tone at `level`. */
const tone = (seconds, rate = 16000, level = 0.3, hz = 220) => {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = level * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};
const quiet = (seconds, rate = 16000) => new Float32Array(Math.round(seconds * rate));
/** Float sound as 16-bit mono samples, as the child sends them. */
const pcm16 = (s) => {
  const bytes = new Uint8Array(s.length * 2);
  const v = new DataView(bytes.buffer);
  for (let i = 0; i < s.length; i++) v.setInt16(i * 2, Math.max(-1, Math.min(1, s[i])) * 0x7fff, true);
  return bytes;
};

test('which device: the communications speakers when they differ from the default, never the default itself', () => {
  const nv = natives(['id-spk', 'Speakers (Realtek Audio)', true], ['id-hs', 'Headset (Jabra Evolve2 75)', false]);
  // The case: the call plays on the headset, the loopback hears the speakers.
  assert.deepEqual(
    R.pickExtraDevice(outs('Speakers (Realtek Audio)', 'Headset (Jabra Evolve2 75)'), nv)?.id,
    'id-hs',
  );
  // The default device is right: no extra capture (Chromium hears it already).
  assert.equal(R.pickExtraDevice(outs('Speakers (Realtek Audio)', 'Speakers (Realtek Audio)'), nv), null);
  // Labels hidden or missing: nothing claimed (the manager probes instead only when a mismatch is known).
  assert.equal(R.pickExtraDevice(outs('', ''), nv), null);
  assert.equal(R.pickExtraDevice([], nv), null);
  // The missed name maps to no native device: null (the manager probes the active endpoints for real sound).
  assert.equal(R.pickExtraDevice(outs('Speakers (Realtek Audio)', 'Headset (Jabra Evolve2 75)'), natives(['id-spk', 'Speakers (Realtek Audio)', true])), null);
  // The missed name IS the default endpoint under another label: never captured twice.
  const swapped = natives(['id-spk', 'Speakers (Realtek Audio)', false], ['id-hs', 'Headset (Jabra Evolve2 75)', true]);
  assert.equal(R.pickExtraDevice(outs('Speakers (Realtek Audio)', 'Headset (Jabra Evolve2 75)'), swapped), null);
  // Casing and padding are not a difference; an ambiguous substring match claims nothing.
  assert.deepEqual(R.pickExtraDevice(outs('  Speakers (Realtek Audio)', 'HEADSET (JABRA EVOLVE2 75)  '), nv)?.id, 'id-hs');
  const two = natives(['a', 'Headset (Jabra)', true], ['b', 'Headset (Jabra Evolve2 75)', false], ['c', 'Headset (Jabra Evolve2 65)', false]);
  assert.equal(R.pickExtraDevice(outs('Headset (Jabra)', 'Headset (Jabra Evolve2)'), two), null);
});

test('probing: the endpoint with real sound wins, silence wins nothing', () => {
  assert.equal(R.pickLoudest([{ id: 'a', rms: 0 }, { id: 'b', rms: 0.05 }, { id: 'c', rms: 0.2 }]), 'c');
  assert.equal(R.pickLoudest([{ id: 'a', rms: 0 }, { id: 'b', rms: 0.0004 }]), null);
  assert.equal(R.pickLoudest([]), null);
});

test('mixing: the extra sound joins the far side, silence changes nothing, peaks never clip', () => {
  const pc = tone(0.1);
  const before = pc.slice();
  R.mixExtraInto(pc, quiet(0.1));
  assert.deepEqual(pc, before);
  const extra = tone(0.1, 16000, 0.2, 330);
  R.mixExtraInto(pc, extra);
  assert.ok(Math.abs(pc[100] - (before[100] + extra[100])) < 1e-6);
  const hot = new Float32Array([0.9, -0.9, 0.5]);
  R.mixExtraInto(hot, new Float32Array([0.9, -0.9, 0.1]));
  assert.deepEqual([...hot].slice(0, 2), [1, -1]);
  assert.ok(Math.abs(hot[2] - 0.6) < 1e-6);
  // A short extra block mixes over its length only.
  const uneven = tone(0.1);
  R.mixExtraInto(uneven, new Float32Array([0.5]));
  assert.ok(Math.abs(uneven[0] - (before[0] + 0.5)) < 1e-6 && uneven[1] === before[1]);
});

test('same sound: one call on both routes reads as one, anything else does not', () => {
  const a = tone(1);
  assert.equal(R.sameSound(a, a.slice()), true);
  // Through another resampler: quieter, with a little noise, still the same call.
  const resampled = a.map((v, i) => v * 0.5 + 0.0001 * Math.sin(i * 7));
  assert.equal(R.sameSound(a, resampled), true);
  // Another path's delay (up to a breath): still the same call.
  const late = new Float32Array(a.length + 2400);
  late.set(a, 2400);
  assert.equal(R.sameSound(a, late.subarray(0, a.length)), true);
  assert.equal(R.sameSound(tone(1, 16000, 0.3, 220), tone(1, 16000, 0.3, 330)), false, 'two voices are not one');
  assert.equal(R.sameSound(quiet(1), quiet(1)), false, 'silence never drops the extra');
  assert.equal(R.sameSound(tone(1), quiet(1)), false);
  assert.equal(R.sameSound(new Float32Array([0.5, 0.5]), new Float32Array([0.5, 0.5])), false, 'too short to tell');
});

test('the extra feed: sound in, blocks out in time; silence pads, never stalls; the old sound falls away', () => {
  const feed = new R.ExtraFeed();
  // Nothing arrived yet: silence, unheard, kept.
  let got = feed.take(1600);
  assert.equal(got.samples.length, 1600);
  assert.ok(got.samples.every((v) => v === 0));
  assert.equal(got.hearing, false);
  assert.equal(got.drop, false);
  // Sound in goes out in order.
  feed.push(pcm16(tone(0.5)));
  feed.push(pcm16(quiet(0.5)));
  const first = feed.take(8000);
  assert.ok(Math.abs(first.samples[100] - tone(0.5)[100]) < 0.002);
  const second = feed.take(8000);
  assert.ok(second.samples.every((v) => v === 0));
  // A shortfall pads with silence rather than stalling the far side.
  const short = feed.take(8000);
  assert.ok(short.samples.every((v) => v === 0));
  // More than the feed holds: the oldest falls away, the newest is heard (clocks drift; stale sound never plays).
  feed.push(pcm16(tone(1)));
  feed.push(pcm16(tone(1, 16000, 0.3, 330)));
  feed.push(pcm16(tone(1, 16000, 0.3, 440)));
  const latest = feed.take(1600);
  assert.ok(R.loudness(latest.samples) > 0.1, 'bounded sound still comes out');
  feed.clear();
  const cleared = feed.take(1600);
  assert.ok(cleared.samples.every((v) => v === 0) && cleared.hearing === false && cleared.drop === false);
});

test('the extra feed: hearing is real sound sustained, and silence takes it back', () => {
  const feed = new R.ExtraFeed();
  for (let i = 0; i < 3; i++) feed.push(pcm16(tone(0.1)));
  let got = feed.take(1600);
  assert.equal(got.hearing, false, 'one block is not yet heard');
  got = feed.take(1600);
  got = feed.take(1600);
  assert.equal(got.hearing, true, 'sustained sound is heard: the notice stays silent');
  for (let i = 0; i < 30; i++) feed.push(pcm16(quiet(0.1)));
  for (let i = 0; i < 11; i++) got = feed.take(1600);
  assert.equal(got.hearing, true, 'a pause does not unhear it');
  got = feed.take(1600);
  assert.equal(got.hearing, false, 'long silence unhears it');
});

test('the extra feed: both routes on one device drop the extra; anything else keeps it', () => {
  // The same call on both routes, the extra a breath late: dropped after about two seconds, never at once.
  const feed = new R.ExtraFeed();
  const call = tone(5);
  const late = new Float32Array(call.length);
  late.set(call.subarray(0, call.length - 800), 800);
  let dropAt = -1;
  for (let at = 0, n = 0; at + 1600 <= call.length; at += 1600, n++) {
    feed.push(pcm16(late.subarray(at, at + 1600)));
    const got = feed.take(1600, call.subarray(at, at + 1600));
    if (got.drop && dropAt < 0) dropAt = n;
  }
  assert.ok(dropAt > 5, `not dropped at once (dropped at block ${dropAt})`);
  assert.ok(dropAt > 0 && dropAt < 40, `dropped after about two seconds (dropped at block ${dropAt})`);
  // Two different voices, one per route: kept.
  const two = new R.ExtraFeed();
  const mine = tone(4, 16000, 0.3, 220);
  const theirs = tone(4, 16000, 0.3, 330);
  let kept = true;
  for (let at = 0; at + 1600 <= mine.length; at += 1600) {
    two.push(pcm16(theirs.subarray(at, at + 1600)));
    if (two.take(1600, mine.subarray(at, at + 1600)).drop) kept = false;
  }
  assert.equal(kept, true);
  // Silence on either route: kept (only one heard sound, heard twice, drops it).
  const silent = new R.ExtraFeed();
  let silentKept = true;
  for (let n = 0; n < 40; n++) {
    silent.push(pcm16(quiet(0.1)));
    if (silent.take(1600, tone(0.1)).drop) silentKept = false;
  }
  assert.equal(silentKept, true);
});

// ── The manager (src/main/extra-loopback.ts): the child spawned, watched and never trusted ──────────────────────────

/** A scripted child: says `boot` when spawned, answers the manager's messages from `script`, records all told. */
function scriptedChild(script = {}, boot = [{ t: 'ready' }]) {
  const listeners = { message: [], exit: [], error: [] };
  const told = [];
  let killed = false;
  queueMicrotask(() => listeners.message.forEach((fn) => boot.forEach((m) => fn(m))));
  const child = {
    told,
    get killed() { return killed; },
    on: (event, fn) => void listeners[event].push(fn),
    send: (msg) => {
      told.push(msg);
      const answer = script[msg.t];
      for (const m of typeof answer === 'function' ? answer(msg) : (answer ?? [])) queueMicrotask(() => listeners.message.forEach((fn) => fn(m)));
    },
    kill: () => {
      killed = true;
      queueMicrotask(() => listeners.exit.forEach((fn) => fn(1)));
    },
    die: () => queueMicrotask(() => listeners.exit.forEach((fn) => fn(1))),
  };
  return child;
}

const managerDeps = (child, sent = []) => ({
  platform: 'win32',
  here: path.join(work, 'embed'),
  exists: () => true,
  fork: () => child,
  send: (channel, payload) => void sent.push([channel, payload]),
  readyMs: 200,
  probeMs: 60,
  tickMs: 120,
});
const winDevices = [
  { id: 'id-spk', name: 'Speakers (Realtek Audio)', type: 'output', isDefault: true },
  { id: 'id-hs', name: 'Headset (Jabra Evolve2 75)', type: 'output', isDefault: false },
];

test('the manager: absent anywhere but Windows, and absent when its files are missing — never an error', async () => {
  let forks = 0;
  const off = E.createExtraLoopback({ ...managerDeps(scriptedChild()), platform: 'linux', fork: () => (forks++, scriptedChild()) });
  assert.equal(off.status().available, false);
  assert.deepEqual(await off.status(), { available: false, capturing: false, device: '' });
  assert.deepEqual(await off.start(outs('Speakers', 'Headset')), { started: false, reason: 'not-windows' });
  assert.equal(forks, 0, 'nothing is spawned off Windows');
  const gone = E.createExtraLoopback({ ...managerDeps(scriptedChild()), exists: () => false, fork: () => (forks++, scriptedChild()) });
  assert.deepEqual(await gone.start(outs('Speakers', 'Headset')), { started: false, reason: 'missing' });
  assert.equal(forks, 0, 'nothing is spawned when its files are missing');
  await gone.dispose();
  await off.dispose();
});

test('the manager: the missed speakers captured by name, their sound forwarded to the window', async () => {
  const sent = [];
  const child = scriptedChild({
    devices: [{ t: 'devices', devices: winDevices }],
    start: [{ t: 'audio', seq: 1, pcm: pcm16(tone(0.25)), rms: 0.2 }],
  });
  const m = E.createExtraLoopback(managerDeps(child, sent));
  const started = await m.start(outs('Speakers (Realtek Audio)', 'Headset (Jabra Evolve2 75)'));
  assert.deepEqual(started, { started: true, device: 'Headset (Jabra Evolve2 75)' });
  assert.equal(child.told.find((t) => t.t === 'start')?.id, 'id-hs');
  assert.equal(m.status().capturing, true);
  await new Promise((ok) => setTimeout(ok, 30));
  const audio = sent.find(([c]) => c === 'recorder:extra-audio');
  assert.ok(audio, 'the sound reaches the window');
  assert.equal(audio[1].seq, 1);
  assert.ok(audio[1].pcm.length > 1000);
  // A second start while capturing starts nothing twice.
  const forks = child.told.filter((t) => t.t === 'start').length;
  await m.start(outs('Speakers (Realtek Audio)', 'Headset (Jabra Evolve2 75)'));
  assert.equal(child.told.filter((t) => t.t === 'start').length, forks);
  await m.stop();
  assert.equal(m.status().capturing, false);
  assert.equal(child.told.at(-1).t, 'quit');
  await m.dispose();
});

test('the manager: a name that maps nowhere is probed — the endpoint with real sound wins', async () => {
  const sent = [];
  const child = scriptedChild({
    devices: [{ t: 'devices', devices: winDevices }],
    probe: [{ t: 'level', id: 'id-spk', rms: 0 }, { t: 'level', id: 'id-hs', rms: 0.09 }],
  });
  const m = E.createExtraLoopback(managerDeps(child, sent));
  const started = await m.start(outs('Speakers (Realtek Audio)', 'Jabra EVOLVE2 (mangled by Windows)'));
  assert.deepEqual(started, { started: true, device: 'Headset (Jabra Evolve2 75)' });
  assert.deepEqual(child.told.find((t) => t.t === 'probe')?.ids, ['id-hs'], 'the default is never probed: it is heard already');
  await m.dispose();
});

test('the manager: a child that fails, sulks or dies leaves the recording as it was', async () => {
  // It never loads (its binary missing on the PC): said once, cleanly.
  const broken = scriptedChild({}, [{ t: 'unavailable', reason: 'its sound library is missing' }]);
  const m1 = E.createExtraLoopback(managerDeps(broken, []));
  assert.deepEqual(await m1.start(outs('Speakers', 'Headset')), { started: false, reason: 'unavailable' });
  await m1.dispose();
  // It dies mid-meeting: the window is told, the recorder carries on as it does today.
  const sent = [];
  const dying = scriptedChild({ devices: [{ t: 'devices', devices: winDevices }] });
  const m2 = E.createExtraLoopback(managerDeps(dying, sent));
  assert.equal((await m2.start(outs('Speakers (Realtek Audio)', 'Headset (Jabra Evolve2 75)'))).started, true);
  dying.die();
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal(m2.status().capturing, false);
  assert.deepEqual(sent.find(([c]) => c === 'recorder:extra-state')?.[1], { capturing: false, device: '', died: true });
  await m2.stop();
  await m2.dispose();
  // It never answers at all: given up on, killed, never awaited past the meeting.
  const mute = scriptedChild({}, []);
  const m3 = E.createExtraLoopback(managerDeps(mute, []));
  assert.deepEqual(await m3.start(outs('Speakers', 'Headset')), { started: false, reason: 'timeout' });
  assert.equal(mute.killed, true);
  await m3.dispose();
});

test('the manager: silence on every endpoint captures nothing, and a gone-quiet child is given up on', async () => {
  const child = scriptedChild({
    devices: [{ t: 'devices', devices: winDevices }],
    probe: [{ t: 'level', id: 'id-hs', rms: 0.0001 }],
  });
  const m = E.createExtraLoopback(managerDeps(child, []));
  assert.deepEqual(await m.start(outs('Speakers (Realtek Audio)', 'Jabra EVOLVE2 (mangled by Windows)')), { started: false, reason: 'silent' });
  assert.equal(child.told.at(-1).t, 'quit');
  await m.dispose();
  // Sound once, then nothing at all: the watch gives up and says the extra died (the recording carries on).
  const sent = [];
  const goneQuiet = scriptedChild({
    devices: [{ t: 'devices', devices: winDevices }],
    start: [{ t: 'audio', seq: 1, pcm: pcm16(tone(0.25)), rms: 0.2 }],
  });
  const w = E.createExtraLoopback(managerDeps(goneQuiet, sent));
  assert.equal((await w.start(outs('Speakers (Realtek Audio)', 'Headset (Jabra Evolve2 75)'))).started, true);
  await new Promise((ok) => setTimeout(ok, 250));
  assert.equal(w.status().capturing, false);
  assert.deepEqual(sent.find(([c]) => c === 'recorder:extra-state')?.[1], { capturing: false, device: '', died: true });
  await w.dispose();
});

test('the wiring: the extra sound joins the far side at Record, and stands down where it should', () => {
  const state = readFileSync(path.join(root, 'src/renderer/src/state/recorder.ts'), 'utf8');
  assert.match(state, /if \(s\.pc && routeWords\) void startExtra\(s\)/, 'a call playing elsewhere tries the extra at Record');
  assert.match(state, /s\.extra\.feed\.take\(dm\.length, dp\)/, 'the extra sound is taken with the far side beside it');
  assert.match(state, /mixExtraInto\(dp, got\.samples\)/, 'the extra sound joins the far-side path (its speech, pieces, gates, billing)');
  assert.match(state, /if \(got\.drop\) void stopExtra\(s\)/, 'one call on both routes stands the extra down');
  assert.match(state, /got\.hearing && s\.routeWords/, 'the sentence stands down only when the far side is really heard');
  assert.match(state, /routeChanged[\s\S]{0,2000}if \(route && words && !s\.extra/, 'a mismatch newly arrived mid-meeting tries the extra');
  const stops = (state.match(/void stopExtra\(s\)/g) || []).length;
  assert.ok(stops >= 3, `the extra stops where it should (drop, end, close: ${stops})`);
  assert.match(state, /s\.extra\?\.feed\.clear\(\)/, 'a pause ends with stale extra sound forgotten');
  const main = readFileSync(path.join(root, 'src/main/meeting-recorder.ts'), 'utf8');
  assert.match(main, /recorder:extra-start/, 'the main side starts the extra on the window’s ask');
  assert.match(main, /recorder:extra-stop/, 'the main side stops it');
  assert.match(main, /recorder:extra-status/, 'the main side says whether the part is here');
  const preload = readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');
  assert.match(preload, /onExtraAudio/, 'the window receives the extra sound unasked');
  assert.match(preload, /onExtraState/, 'the window hears when the extra dies');
});

// ── The child itself (src/main/extra-loopback-child.cjs), against a stub of the native library ────────────────────

/** A stub of the native library's dist/index.js: scripted devices, a scripted tone, scripted failures. */
function stubVendor(dir, script) {
  const dist = path.join(dir, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(dist, 'index.js'), `
'use strict';
const { EventEmitter } = require('node:events');
const script = ${JSON.stringify(JSON.stringify(script))};
const S = JSON.parse(script);
class AudioRecorder extends EventEmitter {
  static getDevices() { return S.devices; }
  static getDeviceFormat() { return { sampleRate: S.rate, channels: S.channels, bitDepth: 16, rawBitDepth: 32 }; }
  async start({ deviceId }) {
    if ((S.failIds || []).includes(deviceId)) throw new Error('no such device');
    this.deviceId = deviceId;
    this.at = 0;
    const frames = Math.round(S.rate * 0.1);
    let n = 0;
    const tick = () => {
      if (this.stopped) return;
      n++;
      if (S.errorAfter && n > S.errorAfter) { this.emit('error', new Error('the device went away')); return; }
      const buf = Buffer.alloc(frames * S.channels * 2);
      for (let f = 0; f < frames; f++) {
        const v = Math.round(S.level * Math.sin((2 * Math.PI * S.hz * (this.at + f)) / S.rate) * 0x7fff);
        for (let c = 0; c < S.channels; c++) buf.writeInt16LE(v, (f * S.channels + c) * 2);
      }
      this.at = (this.at || 0) + frames;
      this.emit('data', buf);
      if (!S.once) setTimeout(tick, 5);
    };
    setTimeout(tick, 5);
  }
  async stop() { this.stopped = true; }
}
exports.AudioRecorder = AudioRecorder;
`);
  return dir;
}

const stubScript = {
  devices: [
    { id: 'id-spk', name: 'Speakers (Realtek Audio)', type: 'output', isDefault: true },
    { id: 'id-hs', name: 'Headset (Jabra Evolve2 75)', type: 'output', isDefault: false },
  ],
  rate: 48000, channels: 2, hz: 220, level: 0.3,
};

function runChild(vendor) {
  const child = fork(path.join(root, 'src/main/extra-loopback-child.cjs'), [vendor], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    // Buffers cross whole, as they do over the utility process's port in the product (plain fork IPC is JSON).
    serialization: 'advanced',
  });
  spawned.push(child);
  const heard = [];
  child.on('message', (m) => heard.push(m));
  // An exit listened for from the start (a child out before its test listens would hang the wait).
  let exited = null;
  child.on('exit', (code) => {
    exited = code;
  });
  return { child, heard, waitExit: () => (exited !== null ? Promise.resolve(exited) : new Promise((ok) => child.on('exit', ok))) };
}

test('the child: lists devices, streams the capture as 16 kHz mono, levels while probing', async () => {
  const vendor = stubVendor(path.join(work, 'stub-vendor'), stubScript);
  const { child, heard, waitExit } = runChild(vendor);
  const waitFor = async (t, ms = 4000) => {
    const until = Date.now() + ms;
    for (;;) {
      const found = heard.find((m) => m.t === t);
      if (found) return found;
      if (Date.now() > until) throw new Error(`the child never said ${t} (heard: ${heard.map((m) => m.t).join(', ')})`);
      await new Promise((ok) => setTimeout(ok, 20));
    }
  };
  await waitFor('ready');
  child.send({ t: 'devices' });
  const devices = await waitFor('devices');
  assert.equal(devices.devices.length, 2);
  assert.equal(devices.devices[1].name, 'Headset (Jabra Evolve2 75)');
  child.send({ t: 'probe', ids: ['id-hs'] });
  const level = await waitFor('level');
  assert.equal(level.id, 'id-hs');
  assert.ok(level.rms > 0.1 && level.rms < 0.3, `a tone reads as sound (rms ${level.rms})`);
  child.send({ t: 'start', id: 'id-hs' });
  const audio = await waitFor('audio');
  assert.ok(audio.pcm.length % 2 === 0 && audio.pcm.length >= 1600, '16-bit samples, a useful chunk');
  const v = new DataView(audio.pcm.buffer, audio.pcm.byteOffset, audio.pcm.byteLength);
  let sum = 0;
  for (let i = 0; i < audio.pcm.length / 2; i++) { const s = v.getInt16(i * 2, true) / 0x8000; sum += s * s; }
  const rms = Math.sqrt(sum / (audio.pcm.length / 2));
  assert.ok(rms > 0.1 && rms < 0.3, `the tone survives mono and 16 kHz (rms ${rms})`);
  // 48000 Hz stereo in, 16000 Hz mono out: three input frames per output sample, two channels to one.
  assert.ok(audio.pcm.length <= 48000 * 2 * 2 * 0.3, 'less bytes than the stereo device rate carries');
  child.send({ t: 'quit' });
  assert.equal(await waitExit(), 0);
});

test('the child: a missing library, a missing device and a device gone midway are said, never a crash', async () => {
  // No library at all: unavailable, exit clean (the recorder carries on as it does today).
  const goneRun = runChild(path.join(work, 'no-vendor'));
  const gone = goneRun.child;
  const said = goneRun.heard;
  assert.equal(await goneRun.waitExit(), 0);
  assert.equal(said[0]?.t, 'unavailable');
  // A device that is not there: an error for that ask, the child alive for the next.
  const vendor = stubVendor(path.join(work, 'stub-vendor-fail'), { ...stubScript, failIds: ['id-gone'] });
  const failRun = runChild(vendor);
  const child = failRun.child;
  const heard = failRun.heard;
  const waitFor = async (t, ms = 4000) => {
    const until = Date.now() + ms;
    for (;;) {
      const found = heard.find((m) => m.t === t);
      if (found) return found;
      if (Date.now() > until) throw new Error(`the child never said ${t}`);
      await new Promise((ok) => setTimeout(ok, 20));
    }
  };
  await waitFor('ready');
  child.send({ t: 'start', id: 'id-gone' });
  const err = await waitFor('error');
  assert.match(err.message, /no such device/);
  assert.equal(child.exitCode, null, 'still alive for the next ask');
  // The device gone midway: said, then out (the manager's died path takes it from there).
  child.send({ t: 'quit' });
  await failRun.waitExit();
  const dying = stubVendor(path.join(work, 'stub-vendor-dying'), { ...stubScript, errorAfter: 5 });
  const midRun = runChild(dying);
  const mid = midRun.child;
  const midHeardMsgs = midRun.heard;
  const midWait = async (t, ms = 4000) => {
    const until = Date.now() + ms;
    for (;;) {
      const found = midHeardMsgs.find((m) => m.t === t);
      if (found) return found;
      if (Date.now() > until) throw new Error(`the child never said ${t}`);
      await new Promise((ok) => setTimeout(ok, 20));
    }
  };
  await midWait('ready');
  mid.send({ t: 'start', id: 'id-hs' });
  await midWait('audio');
  await midWait('error');
  assert.equal(await midRun.waitExit(), 1);
});
