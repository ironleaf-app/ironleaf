// node --test tests/recorder-echo-doubles.test.mjs — m8-echo-doubles: a call on speakers must not double.
//
// What happened: a real recording on the test laptop, 6 Nov 2026 — the far side through the laptop's own
// speakers, the microphone on in the same room (no headset, an everyday case). The transcript carried
// near-identical words under both You and Others, so every line appears twice and every clip is sent and
// paid for twice.
//
// Cause: the echo guard's envelope check correlates the microphone against the PC's sound sample-aligned,
// with no allowance for delay. A room delays the echo (5 to 60 ms, more on Bluetooth), and real speech
// envelopes shift enough in 60 ms that the check reads "not an echo" and both sides are sent. The old
// tests never saw it: they add the echo with no delay at all. Below, the echo is delayed and filtered as a
// room does, then driven through the real capture; and the transcript's second guard drops a You piece
// whose words match the far side's same-moment words nearly exactly, so a gate mistake never shows doubled.
//
// Made-up sound only; no network, no microphone.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-echodbl-'));
let R;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/recorder.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const RATE = 16000;
/** Speech-shaped sound: two tones at `level` with a `hiss` floor, near-silent in `gaps`, swelling and
 *  falling at syllable rate as real talk does (a steady tone's flat envelope would forgive any delay, hiding
 *  the room's shift the guard must survive). Deterministic. */
function voice(seconds, { level = 0.14, hiss = 0.0008, gaps = [], freq = 180 } = {}) {
  const out = new Float32Array(Math.round(seconds * RATE));
  // Word-by-word swells that never repeat (a seed per voice, so two voices never share a shape).
  let s = ((freq * 131 + Math.round(seconds * 7)) >>> 0) || 1;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const step = Math.floor(RATE * 0.12);
  let cur = 0.5 + rnd() * 0.5;
  let next = 0.5 + rnd() * 0.5;
  let at = 0;
  for (let i = 0; i < out.length; i++) {
    if (i - at >= step) {
      at = i;
      cur = next;
      next = 0.5 + rnd() * 0.5;
    }
    const t = i / RATE;
    const quiet = gaps.some(([g, len]) => t >= g && t < g + len);
    const hum = ((i * 7919) % 2001) / 2001 - 0.5;
    const swell = cur + (next - cur) * ((i - at) / step);
    out[i] = quiet ? 0.0005 * Math.sin(i) : swell * level * (Math.sin((2 * Math.PI * freq * i) / RATE) * 0.7 + Math.sin((2 * Math.PI * freq * 2 * i) / RATE) * 0.3) + hiss * hum * 2;
  }
  return out;
}
/** A room: the call delayed, its tops taken off (speakers and air), room noise with it. Deterministic. */
function roomEcho(pc, { delayMs = 60, gain = 0.3, noise = 0.002 } = {}) {
  const delay = Math.round((delayMs * RATE) / 1000);
  const mic = new Float32Array(pc.length);
  let last = 0;
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x40000000 - 1;
  };
  for (let i = 0; i < pc.length; i++) {
    last += 0.25 * ((i - delay >= 0 ? pc[i - delay] : 0) - last);
    mic[i] = last * gain + rand() * noise * 0.5;
  }
  return mic;
}
/** The capture driven a block at a time, as the tap hands sound to the window (4096-sample blocks). */
function capture(mic, pc, seconds = 20) {
  const cap = new R.MeetingCapture({ seconds });
  const pieces = [];
  for (let at = 0; at < mic.length; at += 4096) pieces.push(...cap.block(mic.subarray(at, at + 4096), pc ? pc.subarray(at, at + 4096) : null));
  const last = cap.flush();
  if (last) pieces.push(last);
  return pieces;
}
/** Seconds of audio sent to be written down (each side of each piece), and in how many requests. */
function cost(pieces) {
  return { seconds: pieces.reduce((s, p) => s + p.sides.length * p.seconds, 0), requests: pieces.reduce((s, p) => s + p.sides.length, 0) };
}

// The 6 Nov case: nobody near the laptop speaks — the whole meeting is the far side through its speakers,
// heard twice (loopback, and the microphone across the room). Nothing may go as You; nothing is written twice.
test('speakers, far side only: a 60 ms room echo is Others only — one send, no You line', () => {
  const pc = voice(40, { level: 0.2, hiss: 0.0008, gaps: [[3, 0.5], [6, 0.4], [9, 0.5], [12, 0.4], [15, 0.5], [18, 0.4], [21, 0.5], [24, 0.4], [27, 0.5], [30, 0.4], [33, 0.5], [36, 0.4]] });
  const mic = roomEcho(pc, { delayMs: 60, gain: 0.3 });
  // The echo is loud enough to pass a quiet gate on its own: only the guard keeps it from doubling.
  assert.ok(R.loudness(mic.subarray(6 * RATE, 9 * RATE)) > 0.005, 'echo above the quiet gate');
  const pieces = capture(mic, pc);
  assert.ok(pieces.length >= 2, `${pieces.length} pieces`);
  for (const p of pieces) assert.deepEqual(p.sides, ['pc'], `Others only at ${p.start}s (sides: ${p.sides.join('+') || 'silent'})`);
  const c = cost(pieces);
  const span = pieces.reduce((s, p) => s + p.seconds, 0);
  assert.ok(Math.abs(c.seconds - span) / span < 0.01, `one send (${c.seconds.toFixed(1)}s sent for ${span.toFixed(1)}s heard)`);
});

test('speakers, far side only: delays from a room to a Bluetooth speaker stay Others only', () => {
  const pc = voice(24, { level: 0.2, hiss: 0.0008, gaps: [[6, 0.6], [12, 0.6], [18, 0.6]] });
  for (const delayMs of [5, 20, 60, 150, 300]) {
    const pieces = capture(roomEcho(pc, { delayMs, gain: 0.3 }), pc);
    for (const p of pieces) assert.deepEqual(p.sides, ['pc'], `${delayMs} ms: Others only at ${p.start}s (sides: ${p.sides.join('+') || 'silent'})`);
  }
});

test('speakers with the recorder talking too: their words still go, between and over the far side', () => {
  // They talk 0–8 s while the call is silent, then answers 14–16 s over the call's stretch.
  const pc = voice(24, { level: 0.2, hiss: 0.0008, gaps: [[0, 8.5], [10.5, 0.5], [18, 0.5]] });
  const own = voice(24, { level: 0.14, hiss: 0.004, gaps: [[8, 6], [16, 8], [2, 0.4], [5, 0.4]] });
  const echo = roomEcho(pc, { delayMs: 60, gain: 0.3 });
  const mic = own.map((x, i) => x + echo[i]);
  const pieces = capture(mic, pc);
  const mine = pieces.filter((p) => p.start < 8);
  const over = pieces.filter((p) => p.start >= 8 && p.start < 20);
  assert.ok(mine.length >= 1 && mine.every((p) => p.sides.includes('mic')), `the recorder’s stretch kept (${mine.map((p) => `${p.start.toFixed(0)}:${p.sides.join('+')}`).join(' ')})`);
  assert.ok(over.some((p) => p.sides.includes('mic')), `the recorder’s answer over the call kept (${over.map((p) => `${p.start.toFixed(0)}:${p.sides.join('+')}`).join(' ')})`);
  assert.ok(over.every((p) => p.sides.includes('pc')), 'their stretch still heard whole');
});

test('headset and microphone-alone meetings are unchanged', () => {
  const mic = voice(12, { level: 0.14, hiss: 0.004, gaps: [[7.5, 4.5], [2, 0.4]] });
  const pc = voice(12, { level: 0.2, hiss: 0.0008, gaps: [[0, 8.5], [10.5, 0.5]] });
  const pieces = capture(mic, pc);
  assert.ok(pieces.filter((p) => p.start < 7.5).every((p) => p.sides.join() === 'mic'), 'you alone while you talk');
  assert.ok(pieces.filter((p) => p.start >= 7.5).every((p) => p.sides.join() === 'pc'), 'the others alone while they talk');
  const solo = capture(voice(3, { level: 0.14 }), null);
  assert.ok(solo.length === 1 && solo[0].sides.join() === 'mic', 'no PC sound: one microphone piece');
});

// The second guard: a You piece that says the far side's same-moment words nearly exactly is the gate's
// mistake, not their words — the transcript keeps the Others line and drops the doubled You line.
test('transcript second guard: doubled You words are dropped, real words are kept', () => {
  assert.equal(R.sameWords('Merricks Creek Dairy starts Monday the twenty-third', 'Merricks Creek Dairy starts Monday the twenty-third'), true, 'identical');
  assert.equal(R.sameWords("Merrick's Creek dairy starts Monday the 23rd!", 'merricks creek dairy starts monday the 23rd'), true, 'casing and punctuation aside');
  assert.equal(R.sameWords('Merricks Creek Dairy starts Monday the twenty-third', 'Merricks Creek Dairy starts Tuesday the twenty-third'), true, 'one word misheard aside');
  assert.equal(R.sameWords('I will send the stock order by Friday', 'Merricks Creek Dairy starts Monday'), false, 'different words kept');
  assert.equal(R.sameWords('I will ring them today and confirm in writing too', 'I will ring them today'), false, 'the recorder’s longer answer is not their echo');
  assert.equal(R.sameWords('', 'Merricks Creek'), false, 'nothing said matches nothing');
  const lines = R.mergeTranscript([
    { index: 0, start: 8.5, seconds: 11.5, status: 'done', who: 'You', side: 'mic', text: 'Merricks Creek Dairy starts Monday the twenty-third' },
    { index: 0, start: 8.5, seconds: 11.5, status: 'done', who: 'Others', side: 'pc', text: "Merrick's Creek dairy starts Monday the twenty third" },
    { index: 1, start: 20, seconds: 10, status: 'done', who: 'You', side: 'mic', text: 'I will ring them today' },
    { index: 1, start: 20, seconds: 10, status: 'done', who: 'Others', side: 'pc', text: 'Council meets Tuesday' },
  ]);
  assert.deepEqual(lines.map((l) => [l.who, l.text]), [['Others', 'Merrick\'s Creek dairy starts Monday the twenty third'], ['You', 'I will ring them today'], ['Others', 'Council meets Tuesday']], 'the doubled You line goes, the rest stands');
});

// Break-it finding 8 (6 Nov 2026): two lines that differ in any number or figure, in digits or in words,
// are different statements, never an echo; and a short acknowledgement said on both sides at different
// moments (more than the 2 s an echo's start can differ by) is real on both sides.
test('a different figure is a different statement, and echoed timing decides short lines', () => {
  assert.equal(R.sameWords('the quote is four thousand two hundred dollars', 'the quote is four thousand three hundred dollars'), false, '4200 in words is not 4300 in words');
  assert.equal(R.sameWords('the quote is 4200 dollars today', 'the quote is 4300 dollars today'), false, 'digits differ');
  assert.equal(R.sameWords('the quote is four thousand two hundred dollars', 'the quote is 4300 dollars'), false, 'words against different digits');
  assert.equal(R.sameWords('the room holds twenty three people in all today', 'the room holds twenty 3 people in all today'), true, 'the same figure said in words and in digits is the one figure');
  assert.equal(R.sameWords('the room holds twenty three people in all today', 'the room holds twenty 4 people in all today'), false, 'words against a different digit');
  assert.equal(R.sameWords('starts Monday the twenty-third of the month', 'starts Monday the twenty-fourth of the month'), false, 'a different date');
  // Their correction in the same piece stands; the far side's wrong figure does not swallow it.
  const corrected = R.mergeTranscript([
    { index: 0, start: 0, seconds: 20, status: 'done', who: 'You', side: 'mic', text: 'the quote is four thousand three hundred dollars' },
    { index: 0, start: 0, seconds: 20, status: 'done', who: 'Others', side: 'pc', text: 'the quote is four thousand two hundred dollars' },
  ]);
  assert.equal(corrected.length, 2, 'both figures stand');
  assert.ok(corrected.some((l) => l.who === 'You' && l.text.includes('three hundred')), 'the recorder’s corrected figure is kept');
  // Both sides really say "Yeah sounds good", seconds apart: not an echo (an echo starts within 2 s).
  const both = R.mergeTranscript([
    { index: 0, start: 0, seconds: 20, status: 'done', who: 'You', side: 'mic', segments: [{ start: 8, text: 'Yeah sounds good' }] },
    { index: 0, start: 0, seconds: 20, status: 'done', who: 'Others', side: 'pc', segments: [{ start: 1, text: 'Yeah sounds good' }] },
  ]);
  assert.deepEqual(both.map((l) => l.who).sort(), ['Others', 'You'], 'a real acknowledgement on each side is kept on each side');
  // The same words with the microphone a room's echo behind the PC (inside the lag window): still doubled, still dropped.
  const echoed = R.mergeTranscript([
    { index: 0, start: 0, seconds: 20, status: 'done', who: 'You', side: 'mic', segments: [{ start: 1.2, text: 'Yeah sounds good' }] },
    { index: 0, start: 0, seconds: 20, status: 'done', who: 'Others', side: 'pc', segments: [{ start: 1, text: 'Yeah sounds good' }] },
  ]);
  assert.deepEqual(echoed.map((l) => l.who), ['Others'], 'the echoed copy still goes');
});

// The speakers layer on top (m2 merge, 6 Nov 2026): a numbered far side is still the far side —
// the doubled You line is dropped and the Speaker 2 line stands.
test('transcript second guard with a numbered far side: Speaker 2 is still the far side', () => {
  const lines = R.mergeTranscript([
    { index: 0, start: 8.5, seconds: 11.5, status: 'done', who: 'You', side: 'mic', text: 'Merricks Creek Dairy starts Monday the twenty-third' },
    { index: 0, start: 8.5, seconds: 11.5, status: 'done', who: 'Speaker 2', side: 'pc', text: "Merrick's Creek dairy starts Monday the twenty third" },
  ]);
  assert.deepEqual(lines.map((l) => [l.who, l.text]), [['Speaker 2', "Merrick's Creek dairy starts Monday the twenty third"]], 'the doubled You line goes, the numbered far side stands');
});
