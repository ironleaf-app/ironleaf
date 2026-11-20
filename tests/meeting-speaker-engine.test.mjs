// node --test tests/meeting-speaker-engine.test.mjs — the speaker engine (src/main/meeting-speaker-engine.ts, its worker
// src/main/meeting-speaker-worker.ts, its doors src/main/meeting-speakers.ts; 6 Nov 2026). The pure pipeline
// (filterbank, windowing, powerset mapping, stitching, relabelling, tiny-voice joining) runs as it is; the real
// models in resources/models/speaker/ prove they load and run end to end (synthetic voices here — the quality on
// real meeting speech is measured in the report, never asserted here); the worker answers across a real thread;
// the doors fail soft with a stub runner (no models, no worker).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-speaker-engine-'));

async function bundle(entry) {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const out = path.join(work, `${Math.random().toString(36).slice(2)}.mjs`);
  await build({ input: path.join(root, entry), platform: 'node', output: { file: out, format: 'esm' }, logLevel: 'silent' });
  return import(pathToFileURL(out).href);
}

const E = await bundle('src/main/meeting-speaker-engine.ts');
const D = await bundle('src/main/meeting-speakers.ts');
test.after(() => rmSync(work, { recursive: true, force: true }));

// ── The pure pipeline ────────────────────────────────────────────────────────

test('the filterbank hears frames every 10 ms, deterministically', () => {
  assert.equal(E.fbankFrameCount(16000), 100);
  assert.equal(E.fbankFrameCount(0), 0);
  const tone = Float32Array.from({ length: 16000 }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / 16000));
  const a = E.fbankFrames(tone);
  const b = E.fbankFrames(tone);
  assert.equal(a.count, 100);
  assert.equal(a.frames.length, 100 * 80);
  assert.deepEqual([...a.frames.slice(0, 8)], [...b.frames.slice(0, 8)]);
  assert.ok(a.frames.every((v) => Number.isFinite(v)), 'no NaN in the frames');
  const { frames, count } = E.fbankFrames(tone);
  E.subtractGlobalMean(frames, count);
  let mean = 0;
  for (let f = 0; f < count; f++) mean += frames[f * 80];
  assert.ok(Math.abs(mean / count) < 1e-3, 'each bin’s mean taken away');
});

test('windows start every step with a padded tail, and classes map to local voices', () => {
  assert.deepEqual(E.windowStarts(160000, 16000).starts, [0]);
  assert.equal(E.windowStarts(160000, 16000).tail, false);
  assert.equal(E.windowStarts(8000, 16000).tail, true);
  const two = E.windowStarts(160000 + 32000, 32000);
  assert.deepEqual(two.starts, [0, 32000]);
  const map = E.powersetMapping();
  assert.deepEqual(map, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1]]);
  const scores = new Float32Array(589 * 7).fill(-10);
  scores[4 * 7 + 5] = -0.1;
  const lab = E.windowLabels(scores);
  assert.equal(lab[4 * 3], 1);
  assert.equal(lab[4 * 3 + 1], 0);
  assert.equal(lab[4 * 3 + 2], 1);
});

test('stitching counts voices per frame, and frames become timed stretches', () => {
  const lab = new Uint8Array(589 * 3);
  for (let f = 100; f < 200; f++) lab[f * 3] = 1;
  const count = E.stitchSpeakerCount([lab], [0]);
  assert.equal(count[Math.floor(0 / 270) + 150], 1);
  assert.equal(count[0], 0);
  const frames = new Uint8Array(1000);
  for (let g = 100; g < 300; g++) frames[g] = 1;
  const turns = E.framesToTurns(frames);
  assert.equal(turns.length, 1, 'one voice the whole time keeps its only stretch (the single-voice fix)');
  assert.ok(turns[0].end - turns[0].start > 3 && turns[0].start >= 0);
  assert.deepEqual(E.framesToTurns(new Uint8Array(1000)), []);
  // Short flickers drop; near ones join.
  const flick = new Uint8Array(1000);
  flick[100] = 1;
  assert.deepEqual(E.framesToTurns(flick), []);
});

test('embedding spans skip near-silent local voices, and quiet windows are not segmented', () => {
  const lab = new Uint8Array(589 * 3);
  for (let f = 0; f < 5; f++) lab[f * 3] = 1;
  for (let f = 100; f < 200; f++) lab[f * 3 + 1] = 1;
  const spans = E.embeddingSpans(lab, 16000);
  assert.deepEqual(spans[0], [], 'under ten frames is skipped');
  assert.equal(spans[1].length, 1);
  assert.ok(spans[1][0].from >= 16000 && spans[1][0].to <= 16000 + 160000);
  const loud = new Float32Array(160000).fill(0.1);
  const quiet = new Float32Array(160000).fill(0.0001);
  assert.equal(E.windowVoiced(loud, 0), true);
  assert.equal(E.windowVoiced(quiet, 0), false);
});

// Live hearing (6 Nov 2026, e1-speaker-turns): a whole twenty-second piece heard as one voiceprint is the two
// people in it averaged into nobody (on the ff7b take every piece sounded 0.65–0.94 like the first, so live
// showed "1 voice so far" throughout). Live hears each voiced stretch between pauses on its own instead.
test('voiced stretches are cut at the pauses, long ones at their quietest moment', () => {
  const loudAt = (s, from, to) => { for (let i = Math.floor(from * 16000); i < Math.floor(to * 16000) && i < s.length; i++) s[i] = 0.2 * Math.sin(i / 7); };
  const s = new Float32Array(20 * 16000);
  loudAt(s, 0.5, 4.5); loudAt(s, 5.3, 7.0); loudAt(s, 7.6, 7.9); loudAt(s, 9, 19);
  const spans = E.voicedSpans(s);
  const secs = spans.map((x) => [+(x.from / 16000).toFixed(1), +(x.to / 16000).toFixed(1)]);
  assert.ok(secs.length >= 3, JSON.stringify(secs));
  assert.ok(Math.abs(secs[0][0] - 0.5) < 0.3 && Math.abs(secs[0][1] - 4.5) < 0.3, JSON.stringify(secs));
  assert.ok(Math.abs(secs[1][0] - 5.3) < 0.3 && Math.abs(secs[1][1] - 7.0) < 0.3, `a pause cuts the stretch, and a blip too short to hear a voice in is left out: ${JSON.stringify(secs)}`);
  assert.ok(secs.every(([a, b]) => b - a <= 6.5), `no stretch runs on past a breath: ${JSON.stringify(secs)}`);
  assert.deepEqual(E.voicedSpans(new Float32Array(16000)), [], 'silence has no stretches');
});

test('tiny voices join their likest neighbour, but never across sides or named pairs', () => {
  const v = (xs) => Float32Array.from(xs);
  const prints = [v([1, 0]), v([0.99, 0.01]), v([0, 1])];
  assert.deepEqual(E.mergeTinyVoices(prints, [0, 0, 1], [10, 10, 0.5]), [0, 0, 0]);
  assert.deepEqual(E.mergeTinyVoices(prints, [0, 0, 1], [10, 10, 3]), [0, 0, 1], 'two seconds or more stays a voice');
  assert.deepEqual(E.mergeTinyVoices(prints, [0, 0, 1], [10, 10, 0.5], { sides: ['pc', 'pc', 'mic'] }), [0, 0, 1], 'sides never join');
  assert.deepEqual(E.mergeTinyVoices(prints, [0, 0, 1], [10, 10, 0.5], { forbid: new Set(['0:2', '1:2']) }), [0, 0, 1], 'named pairs never merge');
  assert.deepEqual(E.mergeTinyVoices(prints, [0, 1, 2], [0.5, 0.4, 0.3]), [0, 0, 0], 'all tiny: the largest survives');
});

test('embeddings heard under different names forbid their pair', () => {
  const spans = [
    { from: 0, to: 10 },
    { from: 20, to: 30 },
    { from: 40, to: 50 },
  ];
  const live = [
    { id: 'spk1', start: 0, end: 10, side: 'pc' },
    { id: 'spk2', start: 20, end: 30, side: 'pc' },
    { id: 'spk2', start: 40, end: 50, side: 'pc' },
  ];
  assert.deepEqual(E.forbidFromLive(spans, live, { spk1: 'Sam', spk2: 'Priya' }), [[0, 1], [0, 2]]);
  assert.deepEqual(E.forbidFromLive(spans, live, {}), []);
});

test('the models are found beside the bundle or with the app’s resources, else the engine stays quiet', () => {
  const dir = path.join(work, 'models-here');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, E.SEG_MODEL_FILE), 'seg');
  writeFileSync(path.join(dir, E.EMBED_MODEL_FILE), 'emb');
  assert.equal(E.findSpeakerModelDir([path.join(work, 'nowhere'), dir]), dir);
  assert.equal(E.findSpeakerModelDir([path.join(work, 'nowhere')]), null);
  const dirs = E.speakerModelDirs(path.join('x', 'out', 'main'));
  assert.ok(dirs[0].endsWith(path.join('speaker', 'models')), dirs[0]);
  assert.ok(dirs[1].endsWith(path.join('resources', 'models', 'speaker')), dirs[1]);
});

test('the speaker runner loads where the installed app keeps it, even reading as a module', async () => {
  // 6 Nov 2026, speakers-apart: the installed app reads as a module (its package says so), and require() of the
  // shipped .js runner threw there — every transcript stayed You and Others. The shipped set must load under that
  // scope, the way the app loads it.
  const ship = await import(pathToFileURL(path.join(root, 'tools', 'ort-ship.mjs')).href);
  const mainDir = mkdtempSync(path.join(tmpdir(), 'nv-speaker-scope-'));
  try {
    const ortDir = path.join(mainDir, 'meaning', 'ort');
    ship.copyOrtShip(path.join(root, 'node_modules', 'onnxruntime-web', 'dist'), path.join(root, 'node_modules', 'onnxruntime-common'), ortDir);
    writeFileSync(path.join(mainDir, 'package.json'), JSON.stringify({ type: 'module' }));
    const loaded = E.loadSpeakerOrt(mainDir);
    assert.ok(loaded && typeof loaded.ort.InferenceSession.create === 'function', 'the shipped runner loads under a module scope, like the installed app');
    assert.equal(loaded.wasmDir, ortDir);
  } finally {
    rmSync(mainDir, { recursive: true, force: true });
  }
});

test('a throw from the runner beside the bundle is said aloud, then the doors fall back', async () => {
  // 6 Nov 2026, speakers-apart: that throw hid, and every transcript stayed You and Others.
  const mainDir = mkdtempSync(path.join(tmpdir(), 'nv-speaker-broken-'));
  try {
    const models = path.join(mainDir, 'speaker', 'models');
    mkdirSync(models, { recursive: true });
    writeFileSync(path.join(models, E.SEG_MODEL_FILE), 'seg');
    writeFileSync(path.join(models, E.EMBED_MODEL_FILE), 'emb');
    const ortDir = path.join(mainDir, 'meaning', 'ort');
    mkdirSync(ortDir, { recursive: true });
    writeFileSync(path.join(ortDir, 'ort.node.min.cjs'), 'throw new Error("damaged runner");');
    const said = [];
    assert.equal(E.loadSpeakerOrt(mainDir, (err) => said.push(err)), null);
    assert.match(String(said[0]?.message ?? said[0]), /damaged runner/);
    const { handlers } = doors({ mainDir, log: (m) => said.push(m) });
    const s = await handlers['speakers:status']();
    assert.equal(s.ready, false);
    assert.match(s.words ?? '', /runner isn’t on this PC/);
    assert.ok(said.some((m) => /failed to load: damaged runner/.test(String(m?.message ?? m))), 'the doors say the load failure aloud');
  } finally {
    rmSync(mainDir, { recursive: true, force: true });
  }
});

test('the speaker factory hands the runner file URLs, on every platform', async () => {
  // 6 Nov 2026, speakers-apart: the runner imports its WASM glue, and on Windows a bare path fails ("Received
  // protocol 'c:'"), so no session ever started there. A folder with a space proves the encoding too.
  const fake = { env: { wasm: {} }, InferenceSession: { create: async () => ({ run: async () => ({}), release: async () => {} }) } };
  await E.ortSpeakerFactory(fake, path.join(tmpdir(), 'nv-speaker dir'))('/model.onnx', 1);
  assert.ok(fake.env.wasm.wasmPaths.startsWith('file://'), fake.env.wasm.wasmPaths);
  assert.ok(fake.env.wasm.wasmPaths.endsWith('/'), fake.env.wasm.wasmPaths);
  assert.ok(!fake.env.wasm.wasmPaths.includes(' '), 'spaces encoded');
});

// ── The real models ──────────────────────────────────────────────────────────
// Synthetic voices (two pitches apart): the shipped models load and run end to end here. What they do to real
// meeting speech is measured in the report, never asserted here.

const MODEL_DIR = path.join(root, 'resources', 'models', 'speaker');

async function realEngine(threads = 1) {
  const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
  const ort = await import(pathToFileURL(path.join(ortDist, 'ort.node.min.mjs')).href);
  const engine = new E.SpeakerEngine(MODEL_DIR, E.ortSpeakerFactory(ort, ortDist), ort.Tensor, threads);
  assert.equal(await engine.start(), true, 'the shipped models start');
  return engine;
}

const voice = (hz, seconds) => Float32Array.from({ length: Math.floor(seconds * 16000) }, (_, i) => 0.3 * Math.sin((2 * Math.PI * hz * i) / 16000) + 0.12 * Math.sin((2 * Math.PI * hz * 2 * i) / 16000));

test('the shipped voice model hears the same sound the same, and different sounds apart', async () => {
  const engine = await realEngine();
  try {
    const a = voice(180, 4);
    const b = voice(320, 4);
    const ea = await engine.embed(a);
    const ea2 = await engine.embed(Float32Array.from(a));
    const eb = await engine.embed(b);
    assert.ok(ea.length >= 64 && ea2.length === ea.length && eb.length === ea.length, `voiceprints ${ea.length}-wide, every one`);
    const cos = (x, y) => {
      let d = 0, na = 0, nb = 0;
      for (let i = 0; i < x.length; i++) { d += x[i] * y[i]; na += x[i] * x[i]; nb += y[i] * y[i]; }
      return d / Math.sqrt(na * nb);
    };
    assert.ok(cos(ea, ea2) > 0.99999, 'the same sound hears the same');
    assert.ok(cos(ea, eb) < 0.999, 'different sounds hear apart');
  } finally {
    await engine.close();
  }
});

test('one side diarised end to end: bounded turns, silence silent, the same twice', async () => {
  const engine = await realEngine();
  try {
    const a = voice(180, 8);
    const b = voice(320, 8);
    const gap = new Float32Array(8000);
    const wav = new Float32Array(a.length + gap.length + b.length);
    wav.set(a, 0);
    wav.set(gap, a.length);
    wav.set(b, a.length + gap.length);
    const once = await E.diarizeSide(engine, wav, { side: 'mix', shift: 32000 });
    const twice = await E.diarizeSide(engine, wav, { side: 'mix', shift: 32000 });
    assert.deepEqual(twice, once, 'the same sound diarises the same');
    for (const t of once.turns) {
      assert.ok(/^spk[1-9]\d*$/.test(t.id) && t.start >= 0 && t.end <= wav.length / 16000 + 0.1 && t.end > t.start, JSON.stringify(t));
      assert.equal(t.side, 'mix');
    }
    const silent = await E.diarizeSide(engine, new Float32Array(20 * 16000), { side: 'mix', shift: 32000 });
    assert.deepEqual(silent.turns, [], 'silence stays silent');
    assert.equal(silent.voices, 0);
  } finally {
    await engine.close();
  }
}, { timeout: 300000 });

// ── The worker across a real thread ──────────────────────────────────────────

test('the worker answers across its thread: voices heard, sides diarised', async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  // The worker loads its runner like the app: beside itself, so it stands where the modules are (linked here).
  const home = path.join(work, 'worker-home');
  mkdirSync(home, { recursive: true });
  await import('node:fs/promises').then((fs) => fs.symlink(path.join(root, 'node_modules'), path.join(home, 'node_modules'), 'dir'));
  const file = path.join(home, 'speaker-worker.cjs');
  await build({ input: path.join(root, 'src/main/meeting-speaker-worker.ts'), platform: 'node', external: [/^node:/, 'electron'], output: { file, format: 'cjs', exports: 'named' }, logLevel: 'silent' });
  const w = new Worker(file, { workerData: { mainDir: home } });
  try {
    const host = { post: (m) => w.postMessage(m), onMessage: (fn) => w.on('message', fn), end: async () => { await w.terminate(); } };
    const runner = new E.WorkerSpeakerRunner(host, MODEL_DIR, 1);
    const e = await runner.embed(voice(220, 2));
    assert.ok(e.length >= 64);
    const voiced = new Float32Array(17 * 16000);
    voiced.set(voice(180, 8), 0);
    voiced.set(voice(320, 8), 9 * 16000);
    const v = await runner.diarize(voiced, { side: 'mix', shift: 32000 });
    assert.ok(v.turns.every((t) => /^spk[1-9]\d*$/.test(t.id) && t.end > t.start && t.side === 'mix'), JSON.stringify(v.turns).slice(0, 300));
    const r = await runner.diarize(new Float32Array(12 * 16000), { side: 'mix', shift: 32000 });
    assert.deepEqual(r.turns, []);
    await runner.close();
  } finally {
    await w.terminate().catch(() => undefined);
  }
}, { timeout: 300000 });

// ── The doors, failing soft ──────────────────────────────────────────────────

function doors(deps = {}) {
  const handlers = {};
  const dataDir = deps.dataDir ?? mkdtempSync(path.join(tmpdir(), 'nv-speaker-doors-'));
  D.registerSpeakerEngine({ handle: (c, fn) => (handlers[c] = fn), dataDir, mainDir: deps.mainDir ?? path.join(root, 'out', 'main'), ...(deps.runner ? { runner: deps.runner } : {}), ...(deps.log ? { log: deps.log } : {}) });
  return { handlers, dataDir };
}

const wavOf = (sound) => {
  const pcm = new Int16Array(sound.length);
  for (let i = 0; i < sound.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(sound[i] * 32768)));
  const out = new Uint8Array(44 + pcm.length * 2);
  out.set(pcmToWavHeaderForTest(pcm.length), 0);
  out.set(new Uint8Array(pcm.buffer), 44);
  return out;
};

function pcmToWavHeaderForTest(samples) {
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  h.set([82, 73, 70, 70], 0);
  v.setUint32(4, 36 + samples * 2, true);
  h.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  h.set([100, 97, 116, 97], 36);
  v.setUint32(40, samples * 2, true);
  return h;
}

test('status says plainly when the models aren’t there', async () => {
  const { handlers } = doors();
  const s = await handlers['speakers:status']();
  assert.equal(typeof s.ready, 'boolean');
  if (!s.ready) assert.match(s.words ?? '', /You and Others/);
});

test('live: voices join and part, quiet never starts one, the end forgets', async () => {
  const prints = [Float32Array.from({ length: 512 }, () => 0.5), Float32Array.from({ length: 512 }, (_, i) => (i % 2 ? 0.5 : -0.5))];
  let n = 0;
  const { handlers } = doors({ runner: () => ({ embed: async () => prints[n++ % 2], diarize: async () => ({ turns: [], voices: 0 }), close: async () => {} }) });
  await handlers['speakers:live-begin']('job-12345678');
  const loud = wavOf(Float32Array.from({ length: 16000 }, () => 0.2));
  const a = await handlers['speakers:live']('job-12345678', loud, 'pc', 0, 1);
  const b = await handlers['speakers:live']('job-12345678', loud, 'pc', 1, 1);
  assert.equal(a.voice, 0);
  assert.equal(b.voice, 1);
  assert.equal((await handlers['speakers:live']('job-12345678', wavOf(new Float32Array(16000)), 'pc', 2, 1)).voice, -1);
  const end = await handlers['speakers:live-end']('job-12345678');
  assert.deepEqual(end.turns.map((t) => t.id), ['spk1', 'spk2']);
  assert.deepEqual((await handlers['speakers:live-end']('job-12345678')).turns, [], 'the end forgets');
  await assert.rejects(() => handlers['speakers:live']('../x', loud, 'pc', 0, 1), /isn’t known/);
});

test('live: two voices inside one piece are heard as two, stretch by stretch', async () => {
  // The ff7b failure at the door: one piece, two people either side of a pause, heard live as one voice.
  const prints = [Float32Array.from({ length: 512 }, () => 0.5), Float32Array.from({ length: 512 }, (_, i) => (i % 2 ? 0.5 : -0.5))];
  let n = 0;
  const { handlers } = doors({ runner: () => ({ embed: async () => prints[n++ % 2], diarize: async () => ({ turns: [], voices: 0 }), close: async () => {} }) });
  await handlers['speakers:live-begin']('job-12345678');
  const sound = new Float32Array(6 * 16000);
  for (let i = 0; i < 2 * 16000; i++) sound[i] = 0.2 * Math.sin(i / 7);
  for (let i = 3 * 16000; i < 5.5 * 16000; i++) sound[i] = 0.2 * Math.sin(i / 7);
  const heard = await handlers['speakers:live']('job-12345678', wavOf(sound), 'mix', 40, 6);
  assert.equal(n, 2, 'each stretch heard on its own, never the piece as one');
  assert.deepEqual((heard.spans ?? []).map((s) => s.voice), [0, 1], JSON.stringify(heard));
  assert.ok(Math.abs((heard.spans?.[1]?.start ?? 0) - 43) < 0.5, 'the second stretch keeps its own moment in the recording');
  const end = await handlers['speakers:live-end']('job-12345678');
  assert.deepEqual(end.turns.map((t) => t.id), ['spk1', 'spk2']);
});

test('final: the kept speech settled per side, its sound deleted after a re-run', async () => {
  const seen = [];
  const { handlers, dataDir } = doors({
    runner: () => ({
      embed: async () => new Float32Array(512),
      diarize: async (sound, opts) => {
        seen.push([sound.length, opts.side]);
        return { turns: [{ id: 'spk1', start: 0, end: 1, side: opts.side }], voices: 1 };
      },
      close: async () => {},
    }),
  });
  // A minute of stereo speech on disk (both sides voiced).
  const dir = path.join(dataDir, 'recordings', 'job-12345678');
  mkdirSync(dir, { recursive: true });
  const stereo = new Int16Array(60 * 16000 * 2).fill(2000);
  writeFileSync(path.join(dir, 'speech.pcm'), stereo);
  const call = await handlers['speakers:final']('job-12345678', 'mic+pc', true, [], {});
  assert.deepEqual(call.turns.map((t) => t.side), ['pc'], 'a call’s microphone is never told apart');
  const room = await handlers['speakers:final']('job-12345678', 'mic', false, [], {});
  assert.deepEqual(room.turns.map((t) => t.side), ['mix'], 'a room is one mixed stream');
  // A re-run in pieces, its sound deleted after.
  await handlers['speakers:rerun-begin']('job-12345678');
  await handlers['speakers:rerun-append']('job-12345678', new Uint8Array(new Int16Array(16000).fill(2000).buffer));
  const re = await handlers['speakers:rerun-end']('job-12345678');
  assert.equal(re.turns.length, 1);
  assert.equal(seen.length, 3);
});

test('the meeting’s expected others bound the voices, live and final (12 Nov 2026)', async () => {
  const prints = [Float32Array.from({ length: 512 }, () => 0.5), Float32Array.from({ length: 512 }, (_, i) => (i % 2 ? 0.5 : -0.5))];
  let n = 0;
  const seen = [];
  const { handlers, dataDir } = doors({
    runner: () => ({
      embed: async () => prints[n++ % 2],
      diarize: async (sound, opts) => {
        seen.push(opts);
        return { turns: [{ id: 'spk1', start: 0, end: 1, side: opts.side }], voices: 1 };
      },
      close: async () => {},
    }),
  });
  // Live in a 1-2-1: two dissimilar stretches join the one expected voice.
  await handlers['speakers:live-begin']('job-12345678', 1);
  const loud = wavOf(Float32Array.from({ length: 16000 }, () => 0.2));
  assert.equal((await handlers['speakers:live']('job-12345678', loud, 'pc', 0, 1)).voice, 0);
  assert.equal((await handlers['speakers:live']('job-12345678', loud, 'pc', 1, 1)).voice, 0, 'one expected: no second voice, however dissimilar');
  // The final pass over a call: the far side keeps one voice for one invited other.
  const dir = path.join(dataDir, 'recordings', 'job-12345678');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'speech.pcm'), new Int16Array(60 * 16000 * 2).fill(2000));
  await handlers['speakers:final']('job-12345678', 'mic+pc', true, [], {}, { title: '1-2-1 with Darcy', attendees: ['Darcy Lin'], me: 'Jesse Arlow' });
  assert.deepEqual([seen.at(-1).side, seen.at(-1).cap], ['pc', 1], 'the far side diarised with the meeting’s count');
  await handlers['speakers:final']('job-12345678', 'mic', false, [], {}, { title: 'Weekly sync', attendees: ['Darcy Lin'], me: 'Jesse Arlow' });
  assert.equal(seen.at(-1).cap, undefined, 'a room keeps every voice it hears: the count never bounds it');
});

test('final: a failing engine answers plainly, never throwing', async () => {
  const { handlers, dataDir } = doors({ runner: () => ({ embed: async () => { throw new Error('out of memory'); }, diarize: async () => { throw new Error('out of memory'); }, close: async () => {} }) });
  const dir = path.join(dataDir, 'recordings', 'job-12345678');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'speech.pcm'), new Int16Array(16000 * 2).fill(2000));
  const r = await handlers['speakers:final']('job-12345678', 'mic', false, [], {});
  assert.match(r.error ?? '', /out of memory/);
  const live = await handlers['speakers:live']('job-12345678', wavOf(Float32Array.from({ length: 16000 }, () => 0.2)), 'mix', 0, 1);
  assert.equal(live.voice, -1);
});
