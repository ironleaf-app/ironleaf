// node --test tests/recorder-separation.test.mjs — r2 items 3+4: the far side kept apart from the microphone.
//
// lines came back as one short phrase per piece of about 18 seconds while "You" lines came through whole, and
// near-side words were sometimes misfiled ("Please join the call." under You during others' talk). The mix did make
// the You and Others labels unreliable (who-talked voted from mixed energy), so the two sources stay separate from
// the tap to the service: each piece is cut on the mix but transcribed per side (You from the microphone's audio
// alone, Others from the PC's sound alone), each side on disk in stereo, so labels follow the side that talked and
// overlap keeps both lines.
//
// What this job does NOT fix (reviewer's findings, 5 Nov 2026, measured on the real 25-minute file, the same two
// sources mixed and limited): far-side speech 0.106 to 0.128, their own voice 0.065 to 0.095, the lowest 18-second
// window 0.032. The far side is louder than they are, yet a second transcriber recovered the missing words from
// that same mix. Burial is not the cause; the earlier claim that a hot microphone buried quiet PC sound is removed.
// The loss of far-side words is still open. The live symptom for whoever continues: a far-side line usually holds
// only the first clause of an 18-second piece, as if the service stopped at the first pause, while their continuous
// speech comes through whole. No request parameters were changed to chase it: it needs a real provider test.
//
// With separate sides and no headset, the microphone hears the speakers, so far-side speech can pass the
// microphone's own gate. Each far-side moment would then be sent twice, cost twice, and appear as a false You line.
// The capture holds an echo guard at the point of deciding what to send: while the PC holds speech and the mic is
// well below its normal speech, or its level follows the PC's, the moment is Others only. Real overlap keeps both.
//
// Below, the separated capture driven with real speech-shaped stereo audio against a stand-in service that records
// exactly what was sent. Made-up sound only; no network, no microphone.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-recsep-'));
let R, M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/recorder.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  await build({ input: path.join(root, 'src/main/meeting-recorder.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const RATE = 16000;
/** Speech-shaped sound: two tones at `level` with a `hiss` floor, near-silent in `gaps` ([at, length] seconds). Deterministic. */
function voice(seconds, { level = 0.14, hiss = 0.0008, gaps = [], freq = 180 } = {}) {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const quiet = gaps.some(([at, len]) => t >= at && t < at + len);
    const hum = ((i * 7919) % 2001) / 2001 - 0.5;
    out[i] = quiet ? 0.0005 * Math.sin(i) : level * (Math.sin((2 * Math.PI * freq * i) / RATE) * 0.7 + Math.sin((2 * Math.PI * freq * 2 * i) / RATE) * 0.3) + hiss * hum * 2;
  }
  return out;
}
// The measured levels (reviewer, 5 Nov 2026): their voice 0.065–0.095, the far side 0.106–0.128 (RMS, mixed and
// limited). Speech-shaped amplitudes near those: mic 0.14 (RMS ~0.075), PC 0.20 (RMS ~0.108). Echo at a quarter of
// their normal: 0.035 (RMS ~0.019), still well above the quiet gates, so only the echo guard keeps it from doubling.
const MIC_LEVEL = 0.14;
const PC_LEVEL = 0.2;
const ECHO_LEVEL = 0.035;
/** Speakers, no headset: you 0–7.5 s, a breath, the call 8.5–20 s with pauses, its echo at a quarter of your normal. */
function meetingSpeakers() {
  const pc = voice(20, { level: PC_LEVEL, hiss: 0.0008, gaps: [[0, 8.5], [10.5, 0.5], [13.5, 0.5], [16.5, 0.5]] });
  const own = voice(20, { level: MIC_LEVEL, hiss: 0.004, gaps: [[7.5, 12.5], [2, 0.4], [5, 0.4]] });
  const mic = own.slice();
  const scale = ECHO_LEVEL / PC_LEVEL;
  for (let i = Math.round(8.5 * RATE); i < mic.length; i++) mic[i] += pc[i] * scale;
  return { mic, pc };
}
/** A headset: you 0–7.5 s, a breath, the call 8.5–20 s, nothing of the call in your microphone. */
function meetingHeadset() {
  const mic = voice(20, { level: MIC_LEVEL, hiss: 0.004, gaps: [[7.5, 12.5], [2, 0.4], [5, 0.4]] });
  const pc = voice(20, { level: PC_LEVEL, hiss: 0.0008, gaps: [[0, 8.5], [10.5, 0.5], [13.5, 0.5], [16.5, 0.5]] });
  return { mic, pc };
}

// ── The separated capture ────────────────────────────────────────────────────────────────────────────────────
/** The separated capture driven a block at a time, as the tap hands sound to the window (4096-sample blocks). */
function capture(mic, pc, seconds = 20) {
  const cap = new R.MeetingCapture({ seconds });
  const pieces = [];
  for (let at = 0; at < mic.length; at += 4096) pieces.push(...cap.block(mic.subarray(at, at + 4096), pc ? pc.subarray(at, at + 4096) : null));
  const last = cap.flush();
  if (last) pieces.push(last);
  return pieces;
}

test('item 4: each side transcribed from its own audio, so You and Others are right', () => {
  const { mic, pc } = meetingSpeakers();
  const pieces = capture(mic, pc);
  assert.ok(pieces.length >= 2, `${pieces.length} pieces`);
  // Your stretch is microphone-only; the others' stretch is PC sound alone (the room's echo does not earn a line).
  const yours = pieces.filter((p) => p.start < 7.5);
  const theirs = pieces.filter((p) => p.start >= 7.5);
  assert.ok(yours.length >= 1 && yours.every((p) => p.sides.join() === 'mic'), 'you, from your microphone alone');
  assert.ok(theirs.length >= 1 && theirs.every((p) => p.sides.join() === 'pc'), 'the others, from the PC sound alone');
  // The cut follows the turn, as before (never in the first four seconds).
  assert.ok(theirs[0].start > 7 && theirs[0].start < 10, `cut at the turn (${theirs[0].start.toFixed(1)}s)`);
  // Each side's audio is exactly its own: their transcription is the PC sound, sample for sample.
  for (const p of theirs) {
    const src = pc.subarray(Math.round(p.start * RATE), Math.round(p.start * RATE) + p.pc.length);
    let diff = 0;
    for (let i = 0; i < src.length; i++) diff += (src[i] - p.pc[i]) ** 2;
    assert.ok(Math.sqrt(diff / src.length) < 1e-6, 'nothing of your microphone reaches their transcription');
  }
});

test('item 3: what is sent is 16 kHz mono at full level — no wrong rate, no lost gain', () => {
  const { mic, pc } = meetingSpeakers();
  const pieces = capture(mic, pc);
  const sent = [];
  for (const p of pieces) for (const side of p.sides) sent.push({ side, start: p.start, len: (side === 'mic' ? p.mic : p.pc).length, wav: R.encodeWav(side === 'mic' ? p.mic : p.pc) });
  assert.ok(sent.length >= 2, 'both sides sent');
  for (const { side, wav } of sent) {
    const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    assert.equal(v.getUint16(22, true), 1, 'one channel');
    assert.equal(v.getUint32(24, true), 16000, '16 kHz, as the service takes');
    assert.equal(v.getUint16(34, true), 16, '16-bit');
  }
  // Each side arrives at its own level, not turned down: what the stand-in records is the source as heard.
  for (const s of sent) {
    const src = s.side === 'mic' ? mic : pc;
    const got = R.loudness(R.fromPcm16(s.wav.subarray(44)));
    const want = R.loudness(src.subarray(Math.round(s.start * RATE), Math.round(s.start * RATE) + s.len));
    assert.ok(Math.abs(got - want) / want < 0.05, `${s.side} at full level (sent ${got.toFixed(4)}, heard ${want.toFixed(4)})`);
  }
});

test('echo guard, speakers: far-side speech with echo at a quarter of normal is Others only, one send', () => {
  const { mic, pc } = meetingSpeakers();
  const pieces = capture(mic, pc);
  const theirs = pieces.filter((p) => p.start >= 7.5);
  assert.ok(theirs.length >= 1, 'the call has pieces');
  for (const p of theirs) assert.deepEqual(p.sides, ['pc'], `Others only at ${p.start}s, not a false You line`);
  // The echo would pass its own gate on its own: it is well above quiet, so only the guard keeps it from doubling.
  const echoRms = R.loudness(mic.subarray(9 * RATE, 10 * RATE));
  assert.ok(echoRms > 0.005, `echo ${echoRms.toFixed(4)} above the quiet gate`);
  const fresh = new R.VoiceGate();
  fresh.feed(0.0008);
  assert.equal(fresh.voice(echoRms), true, 'echo passes a quiet microphone gate on its own');
  // One send per far-side piece: the seconds sent are the pieces themselves, not doubled.
  const sentSeconds = theirs.reduce((s, p) => s + p.sides.length * p.seconds, 0);
  const pieceSeconds = theirs.reduce((s, p) => s + p.seconds, 0);
  assert.ok(Math.abs(sentSeconds - pieceSeconds) / pieceSeconds < 0.01, 'one send, not two');
});

test('echo guard, headset: exact labels, no echo to suppress', () => {
  const { mic, pc } = meetingHeadset();
  const pieces = capture(mic, pc);
  const yours = pieces.filter((p) => p.start < 7.5);
  const theirs = pieces.filter((p) => p.start >= 7.5);
  assert.ok(yours.length >= 1 && yours.every((p) => p.sides.join() === 'mic'), 'you alone while you talk');
  assert.ok(theirs.length >= 1 && theirs.every((p) => p.sides.join() === 'pc'), 'the others alone while they talk');
  const micQuiet = R.loudness(mic.subarray(9 * RATE, 10 * RATE));
  assert.ok(micQuiet < 0.005, `microphone silent while they talk (${micQuiet.toFixed(4)})`);
});

test('both talking at once: both sides sent, both lines in the transcript', () => {
  const mic = voice(6, { level: MIC_LEVEL, freq: 180 });
  const pc = voice(6, { level: PC_LEVEL, freq: 230 });
  const pieces = capture(mic, pc, 20);
  assert.equal(pieces.length, 1, 'one piece');
  assert.deepEqual(pieces[0].sides, ['mic', 'pc'], 'real overlap at normal level keeps both lines');
  const lines = R.mergeTranscript([
    { index: 0, start: 0, seconds: 6, status: 'done', who: 'You', side: 'mic', text: 'I will send it today.' },
    { index: 0, start: 0, seconds: 6, status: 'done', who: 'Others', side: 'pc', text: 'Please do.' },
  ]);
  assert.deepEqual(lines.map((l) => [l.who, l.text]), [['You', 'I will send it today.'], ['Others', 'Please do.']], 'both lines, same moment, you first');
});

test('silence on both sides is never sent; a microphone alone behaves as before', () => {
  const quiet = capture(new Float32Array(2 * RATE), new Float32Array(2 * RATE));
  assert.equal(quiet.length, 1);
  assert.deepEqual(quiet[0].sides, [], 'nothing voiced: nothing sent');
  const solo = capture(voice(3, { level: MIC_LEVEL }), null);
  assert.ok(solo.length === 1 && solo[0].sides.join() === 'mic', 'no PC sound: one microphone piece');
  assert.equal(solo[0].pc, null);
});

test('each side is judged against its own quiet, not one fixed level', () => {
  const gate = new R.VoiceGate();
  for (let i = 0; i < 200; i++) gate.feed(0.004);
  assert.equal(gate.voice(0.004), false, 'a steady hiss is the quiet, not a voice');
  assert.equal(gate.voice(0.02), true, 'a voice above it still counts');
  const fresh = new R.VoiceGate();
  fresh.feed(0.0008);
  assert.equal(fresh.voice(0.006), true, 'loopback speech counts on a quiet line');
  assert.equal(fresh.voice(0.001), false, 'and its silence does not');
});

test('the quiet gate never skips what a side called speech (moments at 0.005, sides at the send floor)', () => {
  // A gate's moment never voices below 0.005; a side voices on its loudest moments, so a quiet reply's side may
  // average below that (r3) — but never below the host's own floor (ns voice-talk.mjs QUIET_RMS is 0.002, kept in
  // step as SEND_FLOOR), or the host would drop unheard a side the capture decided to send.
  const gate = new R.VoiceGate();
  gate.feed(0.0008);
  assert.equal(gate.voice(0.0049), false, 'below 0.005: never speech');
  assert.equal(gate.voice(0.0051), true, 'just above: speech on a quiet line');
  assert.equal(R.SEND_FLOOR, 0.002, 'the send floor is the host floor');
  const { mic, pc } = meetingSpeakers();
  for (const p of capture(mic, pc)) {
    for (const side of p.sides) {
      const audio = side === 'mic' ? p.mic : p.pc;
      const rms = R.loudness(audio);
      assert.ok(rms >= R.SEND_FLOOR, `${side} at ${p.start}s reads ${rms.toFixed(4)}, never skipped as quiet`);
    }
  }
});

test('a 25-minute meeting of alternating talk costs about what the mixed route did, within 10%', () => {
  // Alternating 30 s you, 30 s the call with speakers echo, speech-shaped with pauses (floors need silence, as real
  // talk has). The old mixed route sent each piece once; without the guard the call's halves would send twice.
  const cap = new R.MeetingCapture({ seconds: 20 });
  const old = new R.Chunker({ seconds: 20 });
  let sentSeconds = 0;
  let oldSeconds = 0;
  const scale = ECHO_LEVEL / PC_LEVEL;
  const pauses = [[5, 0.5], [10, 0.5], [15, 0.5], [20, 0.5], [25, 0.5], [29, 1]];
  for (let n = 0; n < 50; n++) {
    const yours = n % 2 === 0;
    let mic;
    let pc;
    if (yours) {
      mic = voice(30, { level: MIC_LEVEL, hiss: 0.004, gaps: pauses });
      pc = voice(30, { level: PC_LEVEL, hiss: 0.0008, gaps: [[0, 30]] });
    } else {
      pc = voice(30, { level: PC_LEVEL, hiss: 0.0008, gaps: pauses });
      const silent = voice(30, { level: MIC_LEVEL, hiss: 0.004, gaps: [[0, 30]] });
      mic = silent.slice();
      for (let i = 0; i < mic.length; i++) mic[i] += pc[i] * scale;
    }
    for (let at = 0; at < mic.length; at += 4096) {
      const m = mic.subarray(at, at + 4096);
      const c = pc.subarray(at, at + 4096);
      for (const p of cap.block(m, c)) sentSeconds += p.sides.length * p.seconds;
      const mix = new Float32Array(m.length);
      for (let i = 0; i < m.length; i++) mix[i] = (m[i] + (c[i] ?? 0)) / 2;
      for (const p of old.push(mix)) if (!R.isQuiet(p)) oldSeconds += p.samples.length / RATE;
    }
  }
  const last = cap.flush();
  if (last) sentSeconds += last.sides.length * last.seconds;
  const oldLast = old.flush();
  if (oldLast && !R.isQuiet(oldLast)) oldSeconds += oldLast.samples.length / RATE;
  const totalSeconds = 25 * 60;
  assert.ok(oldSeconds > totalSeconds * 0.9, `old route sends the meeting (${oldSeconds.toFixed(0)}s)`);
  const ratio = sentSeconds / oldSeconds;
  assert.ok(Math.abs(ratio - 1) < 0.1, `separate sides send ${sentSeconds.toFixed(0)}s against mixed ${oldSeconds.toFixed(0)}s (×${ratio.toFixed(2)})`);
});

test('a job keeps which side each piece is, and stereo speech on disk reads back per side', async () => {
  const j = R.cleanJob({ id: 'job-12345678', note: 'a.md', stereo: true, pieces: [{ index: 0, start: 0, seconds: 1, status: 'done', side: 'pc', who: 'Others' }, { index: 0, start: 0, seconds: 1, status: 'done', side: 'stage', who: 'You' }] });
  assert.equal(j.stereo, true);
  assert.deepEqual(j.pieces.map((p) => p.side), ['pc', undefined], 'a side kept when it is one, dropped when it is not');
  // Stereo there and back: each side byte-close, the mix their average.
  const mic = voice(1, { level: MIC_LEVEL });
  const pc = voice(1, { level: PC_LEVEL });
  const back = R.fromPcm16Stereo(R.toPcm16Stereo(mic, pc));
  assert.ok(Math.abs(R.loudness(back.mic) - R.loudness(mic)) < 1e-4 && Math.abs(R.loudness(back.pc) - R.loudness(pc)) < 1e-4);
  const mixed = R.mixStereoToMono(R.toPcm16Stereo(mic, pc));
  assert.ok(Math.abs(R.loudness(mixed) - R.loudness(mic.map((x, i) => (x + pc[i]) / 2))) < 1e-4);
  // The main side reads back the side asked for (a crash tail with no side reads the mix, as before).
  const handlers = {};
  const dataDir = path.join(work, 'sep-data');
  const vault = path.join(work, 'sep-vault');
  mkdirSync(vault, { recursive: true });
  M.registerRecorder({
    handle: (ch, fn) => (handlers[ch] = fn),
    requireCreate: async () => {},
    askJson: async () => ({ reply: null }),
    platform: 'linux',
    dataDir,
    saveFile: async (name, file) => {
      const rel = `Attachments/${name}`;
      mkdirSync(path.join(vault, 'Attachments'), { recursive: true });
      copyFileSync(file, path.join(vault, rel));
      return rel;
    },
  });
  await handlers['recorder:begin']({ id: 'job-12345678', note: 'Meetings/Call.md', title: 'Call', date: '2026-11-04', began: new Date().toISOString(), mime: 'audio/mp4', ext: 'm4a', sources: 'mic+pc', elapsedMs: 0, phase: 'recording', pieces: [], stereo: true });
  await handlers['recorder:append']('job-12345678', 'speech', R.toPcm16Stereo(mic, pc));
  await handlers['recorder:update']('job-12345678', { pieces: [{ index: 0, start: 0, seconds: 1, status: 'pending', side: 'pc', who: 'Others' }] });
  const side = (wav) => R.fromPcm16(new Uint8Array(wav).subarray(44));
  assert.ok(Math.abs(R.loudness(side(await handlers['recorder:speech']('job-12345678', 0, 1, 'pc'))) - R.loudness(pc)) < 1e-4, 'the PC side back');
  assert.ok(Math.abs(R.loudness(side(await handlers['recorder:speech']('job-12345678', 0, 1, 'mic'))) - R.loudness(mic)) < 1e-4, 'the microphone side back');
  await handlers['recorder:update']('job-12345678', { pieces: [{ index: 0, start: 0, seconds: 1, status: 'pending' }] });
  assert.ok(Math.abs(R.loudness(side(await handlers['recorder:speech']('job-12345678', 0, 1))) - R.loudness(mixed)) < 1e-4, 'no side: the mix, as a crash tail reads');
});

test('what could not be written down counts each moment once, however many sides it has', () => {
  assert.equal(R.missedSeconds([{ index: 0, start: 0, seconds: 20, status: 'failed' }, { index: 0, start: 0, seconds: 20, status: 'failed' }]), 20, 'one span, two sides: twenty seconds, not forty');
  assert.equal(R.missedSeconds([{ index: 0, start: 0, seconds: 20, status: 'done' }, { index: 1, start: 20, seconds: 10, status: 'failed' }]), 10);
});

// ── b5-break-meeting-recorder: what a real meeting breaks ───────────────────────────────────────────────────
// The next meeting must not lose anything. Each test below failed on the code as found (5 Nov 2026), driven
// with invented speech-shaped sound only.

test('b5: sustained speech never becomes its own quiet — a long far-side stretch stays voiced', () => {
  // As found, the gate's floor followed speech up and muted continuous talk after about a minute (pieces at
  // 110 s+ of a far-side stretch came back silent despite loud speech): whole minutes lost without an error.
  const gate = new R.VoiceGate();
  for (let s = 0; s < 200; s++) for (let b = 0; b < 4; b++) gate.feed(0.108);
  assert.equal(gate.voice(0.108), true, 'three minutes of sustained speech is still speech');
  // And through the capture: 150 s of far-side talk with breath pauses, every piece Others.
  const gaps = [];
  for (let at = 5; at < 149; at += 6 + (at % 3)) gaps.push([at, 0.4]);
  const pc = voice(150, { level: PC_LEVEL, hiss: 0.0008, gaps });
  const mic = voice(150, { level: MIC_LEVEL, hiss: 0.004, gaps: [[0, 150]] });
  for (let i = 0; i < mic.length; i++) mic[i] += pc[i] * (ECHO_LEVEL / PC_LEVEL);
  const pieces = capture(mic, pc);
  assert.ok(pieces.length >= 6, `${pieces.length} pieces`);
  for (const p of pieces) assert.ok(p.sides.includes('pc'), `Others heard at ${p.start.toFixed(0)}s (sides: ${p.sides.join('+') || 'silent'})`);
});

test('b5: the recorder’s short answer inside their stretch is kept — the echo guard keeps real overlap', () => {
  // As found, their 0.6 s "okay" inside a 20 s far-side piece was judged on the piece's average level and
  // dropped as echo: their words never sent. Each side is now judged on its loudest moments, not its
  // average.
  const preM = voice(8, { level: MIC_LEVEL, hiss: 0.004, gaps: [[3, 0.4]] });
  const preP = voice(8, { level: PC_LEVEL, gaps: [[0, 8]] });
  const pc = voice(20, { level: PC_LEVEL, gaps: [[10.6, 0.4], [15, 0.5]] });
  const mic = voice(20, { level: MIC_LEVEL, hiss: 0.004, gaps: [[0, 10], [10.6, 9.4]] });
  for (let i = 0; i < mic.length; i++) mic[i] += pc[i] * (ECHO_LEVEL / PC_LEVEL);
  const cap = new R.MeetingCapture({ seconds: 20 });
  const out = [];
  for (let at = 0; at < preM.length; at += 4096) out.push(...cap.block(preM.subarray(at, at + 4096), preP.subarray(at, at + 4096)));
  for (let at = 0; at < mic.length; at += 4096) out.push(...cap.block(mic.subarray(at, at + 4096), pc.subarray(at, at + 4096)));
  const last = cap.flush();
  if (last) out.push(last);
  const mine = out.filter((p) => p.start >= 7 && p.start < 25);
  assert.ok(mine.length >= 1, 'the stretch has pieces');
  assert.ok(mine.some((p) => p.sides.includes('mic')), `the recorder’s okay kept (${mine.map((p) => `${p.start.toFixed(0)}:${p.sides.join('+') || 'silent'}`).join(' ')})`);
  assert.ok(mine.every((p) => p.sides.includes('pc')), 'their stretch still heard');
});

test('b5: a short quiet reply in a long silence is sent, on each side', () => {
  // As found, a soft half-second reply diluted over twenty seconds read below the quiet gate and was never
  // sent. A side is now sent when any moment in it holds speech.
  for (const who of ['mic', 'pc']) {
    const talk = voice(20, { level: 0.05, hiss: 0.0008, gaps: [[0, 10], [10.5, 9.5]], freq: who === 'mic' ? 180 : 230 });
    const silentMic = voice(20, { level: MIC_LEVEL, hiss: 0.004, gaps: [[0, 20]] });
    const silentPc = voice(20, { level: PC_LEVEL, gaps: [[0, 20]] });
    const pieces = who === 'mic' ? capture(talk, silentPc) : capture(silentMic, talk);
    assert.ok(pieces.some((p) => p.sides.includes(who)), `the quiet ${who === 'mic' ? 'You' : 'Others'} reply is sent`);
  }
});

test('b5: stereo speech on disk counts its seconds once, not twice', async () => {
  // As found, readJob divided stereo bytes (4 per sample) by 2: ten recorded seconds read as twenty, so the
  // card doubled the time after a crash and Finish made phantom tail pieces past the real end.
  const handlers = {};
  const dataDir = path.join(work, 'b5-data');
  mkdirSync(dataDir, { recursive: true });
  M.registerRecorder({
    handle: (ch, fn) => (handlers[ch] = fn),
    requireCreate: async () => {},
    askJson: async () => ({ reply: null }),
    platform: 'linux',
    dataDir,
    saveFile: async () => 'Attachments/x.m4a',
  });
  await handlers['recorder:begin']({ id: 'job-b5stereo1', note: 'Meetings/Call.md', title: 'Call', date: '2026-11-05', began: new Date().toISOString(), mime: 'audio/mp4', ext: 'm4a', sources: 'mic+pc', elapsedMs: 0, phase: 'recording', pieces: [], stereo: true });
  await handlers['recorder:append']('job-b5stereo1', 'speech', R.toPcm16Stereo(voice(10, { level: MIC_LEVEL }), voice(10, { level: PC_LEVEL })));
  const job = (await handlers['recorder:jobs']()).find((j) => j.id === 'job-b5stereo1');
  assert.equal(job.speechSeconds, 10, `ten stereo seconds read as ${job.speechSeconds}`);
  // A crash tail cut mid-frame (2 of 4 bytes): the partial frame is dropped, the sides never swap.
  const mic = voice(2, { level: MIC_LEVEL });
  const pc = voice(2, { level: PC_LEVEL });
  const cut = R.toPcm16Stereo(mic, pc).subarray(0, 2 * RATE * 4 - 2);
  const back = R.fromPcm16Stereo(cut);
  assert.equal(back.mic.length, 2 * RATE - 1, 'one sample short, both sides whole');
  assert.ok(Math.abs(R.loudness(back.mic) - R.loudness(mic)) < 1e-3 && Math.abs(R.loudness(back.pc) - R.loudness(pc)) < 1e-3, 'each side its own level, no swap, no noise');
});

test('b5: a microphone that hears hiss but never a voice is called out while the call talks', () => {
  // As found, only a silent microphone (below 0.0006) was called out. A dead microphone whose levelled-up
  // hiss reads above that never warned and never voiced: the whole meeting quietly empty. Two minutes of
  // call with no voice from the microphone now warns; their first words clear it.
  const watch = new R.MicWatch();
  let warnedAt = -1;
  for (let s = 0; s < 150; s++) if (watch.feed(false, true, 1) && warnedAt < 0) warnedAt = s;
  assert.ok(warnedAt >= 100 && warnedAt <= 130, `warned after a couple of minutes (${warnedAt}s)`);
  assert.equal(watch.feed(true, true, 1), false, 'the recorder’s voice clears it');
  assert.equal(watch.warned, false);
  // Quiet on both sides (an empty room, or listening before anyone speaks) never warns.
  const idle = new R.MicWatch();
  for (let s = 0; s < 600; s++) assert.equal(idle.feed(false, false, 1), false, 'silence is not a broken microphone');
  assert.equal(idle.warned, false);
});
