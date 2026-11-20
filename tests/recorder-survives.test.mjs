// node --test tests/recorder-survives.test.mjs — a meeting recording must survive anything (5 Nov 2026,
// job s2-recorder-survives): crash/restart, a two-hour meeting, ten minutes offline, a refused speech key, the
// microphone unplugged or a headset change, disk nearly full, the window closed mid-meeting, two recordings started
// by accident, and pieces that fail or come back too thin. Each check fails without its fix. Real provider calls are
// never made: a stand-in service stands in for failures (see the report for what that cannot prove).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-recorder-survives-'));
let R, M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/recorder.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  await build({ input: path.join(root, 'src/main/meeting-recorder.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const read = (f) => readFileSync(path.join(root, f), 'utf8');
const NOTE = 'Meetings/Survives 5 Nov 2026.md';

/** Speech-like sound: a tone at `level`. */
function speech(seconds, rate, { level = 0.3 } = {}) {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = level * Math.sin((2 * Math.PI * 220 * i) / rate);
  return out;
}

/** The main side's handlers, caught as app.ts registers them. */
function mainSide(deps = {}) {
  const handlers = {};
  const dataDir = deps.dataDir ?? path.join(work, `data-${Math.random().toString(36).slice(2)}`);
  const vault = deps.vault ?? path.join(work, 'vault');
  mkdirSync(vault, { recursive: true });
  const r = M.registerRecorder({
    handle: (ch, fn) => (handlers[ch] = fn),
    requireCreate: async () => {},
    askJson: async () => ({ reply: null, error: 'not needed here' }),
    platform: deps.platform ?? 'linux',
    dataDir,
    saveFile: async (name) => `Attachments/${name}`,
    ...deps.extra,
  });
  return { r, handlers, dataDir, vault };
}
const wav = () => R.encodeWav(speech(1, 16000), 16000);

test('a crash: every unfinished recording for the note is offered, never only the latest', () => {
  // Two crashes for one meeting (record, crash, record again, crash): both must be finishable from its panel.
  const jobs = [
    { id: 'job-aaaaaaa1', note: NOTE, began: '2026-11-05T01:00:00Z', phase: 'recording' },
    { id: 'job-aaaaaaa2', note: NOTE, began: '2026-11-05T02:00:00Z', phase: 'recording' },
    { id: 'job-bbbbbbb1', note: 'Meetings/Other.md', began: '2026-11-05T01:30:00Z', phase: 'recording' },
  ];
  assert.equal(typeof R.jobsForNote, 'function', 'all of a note\u2019s recordings, oldest first');
  assert.deepEqual(R.jobsForNote(jobs, NOTE).map((j) => j.id), ['job-aaaaaaa1', 'job-aaaaaaa2']);
  assert.deepEqual(R.jobsForNote(jobs, 'Meetings/Other.md').map((j) => j.id), ['job-bbbbbbb1']);
  // The panel shows each unfinished one with its own way to finish it.
  const view = read('src/renderer/src/views/MeetingRecorder.tsx');
  assert.match(view, /jobsForNote|interruptedJobs|unfinished.*map/s, 'each unfinished recording gets its own card');
});

test('a two-hour meeting: about 360 pieces, each small, and long gaps said in hours', () => {
  const rate = 16000;
  const c = new R.Chunker({ rate });
  const minute = speech(60, rate);
  let count = 0;
  let biggest = 0;
  for (let m = 0; m < 120; m++)
    for (let at = 0; at < minute.length; at += 16000)
      for (const p of c.push(minute.subarray(at, at + 16000))) {
        count++;
        biggest = Math.max(biggest, R.encodeWav(p.samples, rate).length);
      }
  assert.ok(count >= 358 && count <= 364, `${count} pieces for two hours`);
  assert.ok(biggest < M.MAX_PIECE_BYTES / 6, `largest piece ${biggest} bytes`);
  // Two hours of speech kept on disk (16 kHz 16-bit): about 230 MB, far under the 2 GB a recording may keep.
  assert.ok((2 * 3600 * rate * 2) < 2 * 1024 * 1024 * 1024, 'two hours fits');
  // A long stretch missed says hours, not 120 minutes.
  assert.equal(R.missedWords(7200), 'About 2 hours');
  assert.equal(R.missedWords(5400), 'About 2 hours');
  assert.equal(R.missedWords(3900), 'About 1 hour');
});

test('ten minutes offline: the kinds of failure, and the missed words written down when it returns', async () => {
  assert.equal(typeof R.transcribeErrorKind, 'function', 'offline, refused keys and the rest told apart');
  assert.equal(R.transcribeErrorKind('fetch failed', ''), 'offline');
  const reset = new Error('read failed');
  reset.code = 'ECONNRESET';
  assert.equal(R.transcribeErrorKind(reset.message, reset.code), 'offline');
  assert.equal(R.transcribeErrorKind('OpenAI did not accept the key for speech.', ''), 'auth');
  assert.equal(R.transcribeErrorKind('Incorrect API key provided', ''), 'auth');
  assert.equal(R.transcribeErrorKind('rate-limited or has no credit left', ''), 'auth');
  // The main side says the kind with its plain words, so the window knows to wait rather than hammer.
  const { handlers } = mainSide({ extra: { transcribe: async () => { throw new Error('fetch failed'); } } });
  const out = await handlers['recorder:transcribe'](wav(), 'audio/wav');
  assert.equal(out.kind, 'offline');
  assert.match(out.error, /couldn\u2019t be reached/);
  // While it records, failed pieces are tried again once the network is back (not only at Stop).
  const state = read('src/renderer/src/state/recorder.ts');
  assert.match(state, /addEventListener\(['"]online['"]|navigator\.onLine/, 'tried again when the network returns');
});

test('a refused speech key mid-way: recording carries on, the person told once in plain words', async () => {
  // A raw provider refusal, key fragment and all: never shown as is, never a secret on screen.
  const raw = mainSide({ extra: { transcribe: async () => ({ error: 'Incorrect API key provided: sk-abc123. Check it.' }) } });
  const r = await raw.handlers['recorder:transcribe'](wav(), 'audio/wav');
  assert.equal(r.kind, 'auth');
  assert.doesNotMatch(r.error, /sk-abc123/, 'no key fragment reaches the screen');
  // The models door is named where it is (5 Nov 2026, connect-finish: Settings › Models, as recorder.test.mjs).
  assert.match(r.error, /Settings \u203a AI/, 'what to do, and where');
  const quota = mainSide({ extra: { transcribe: async () => ({ error: 'You exceeded your current quota, check your plan and billing.' }) } });
  const q = await quota.handlers['recorder:transcribe'](wav(), 'audio/wav');
  assert.equal(q.kind, 'auth');
  assert.match(q.error, /credit|billing|plan|key/i, 'plain words for an empty account');
  // Told once: one notice while it records, never a toast per piece.
  const state = read('src/renderer/src/state/recorder.ts');
  assert.match(state, /Writing down has paused/, 'one notice while it records');
  assert.doesNotMatch(state, /toast\(r\.error/, 'no toast per failed piece');
});

test('the microphone unplugged or the headset changed: taken over, said, and recording carries on', () => {
  const state = read('src/renderer/src/state/recorder.ts');
  // Unplugged is heard as the track ending or muting; a headset change re-checks the microphone.
  assert.match(state, /addEventListener\(['"]mute['"]/, 'a muted track is an unplugged microphone too');
  assert.match(state, /devicechange/, 'a headset change re-checks the microphone while it records');
  assert.match(state, /Your microphone was unplugged/, 'said in plain words');
});

test('disk nearly full: plain words once, nothing lost, tried again', () => {
  assert.equal(typeof R.diskFullWords, 'function', 'plain words for a full disk');
  assert.match(R.diskFullWords(), /space/i);
  assert.match(R.diskFullWords(), /Keep Ironleaf open/i);
  const state = read('src/renderer/src/state/recorder.ts');
  // Failed writes kept and tried again in order, not dropped.
  assert.match(state, /pendingWrites|heldWrites|retryWrites/, 'failed writes kept until the disk takes them');
  const main = read('src/main/meeting-recorder.ts');
  assert.match(main, /ENOSPC|no space|running out of space/i, 'a full disk read as one in the main side');
});

test('the window closed while recording: flushed first, finished next start with one clear way', async () => {
  // Closing flushes the sound waiting in memory and the job before the window goes.
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /recorder.*close|close.*recorder|flushForClose|prepareForClose/i, 'the close handshake flushes the recording');
  const state = read('src/renderer/src/state/recorder.ts');
  assert.match(state, /export (async )?function (flushForClose|prepareForClose)/, 'a flush the close handshake can await');
  // Next start: what reached the disk is there with one clear way to finish it.
  const dataDir = path.join(work, 'close-data');
  const first = mainSide({ dataDir });
  const id = 'job-closed001';
  await first.handlers['recorder:begin']({ id, vault: '/notes', note: NOTE, title: 'Survives', date: '2026-11-05', began: '2026-11-05T01:00:00.000Z', mime: 'audio/webm;codecs=opus', ext: 'weba', sources: 'mic', elapsedMs: 0, phase: 'recording', pieces: [] });
  const sec = R.toPcm16(speech(1, 16000));
  for (let i = 0; i < 10; i++) await first.handlers['recorder:append'](id, 'speech', sec);
  await first.handlers['recorder:append'](id, 'audio', new Uint8Array([1, 2, 3, 4]));
  const after = mainSide({ dataDir });
  const found = await after.handlers['recorder:jobs']();
  assert.equal(found.length, 1);
  assert.equal(found[0].speechSeconds, 10);
  assert.equal(found[0].phase, 'recording');
  const view = read('src/renderer/src/views/MeetingRecorder.tsx');
  assert.match(view, /Finish (the recording|writing it up)/, 'one clear way to finish it');
});

test('two recordings started by accident: the second refused in plain words', async () => {
  const { handlers } = mainSide({});
  const one = { id: 'job-twice0001', vault: '/notes', note: NOTE, title: 'Survives', date: '2026-11-05', began: '2026-11-05T01:00:00.000Z', mime: '', ext: 'weba', sources: 'mic', elapsedMs: 0, phase: 'recording', pieces: [] };
  await handlers['recorder:begin'](one);
  await assert.rejects(handlers['recorder:begin']({ ...one, id: 'job-twice0002' }), /already being recorded|Finish it first/i);
  // Another meeting may still record: only the same note in the same folder waits.
  await handlers['recorder:begin']({ ...one, id: 'job-twice0003', note: 'Meetings/Other.md' });
  const state = read('src/renderer/src/state/recorder.ts');
  assert.match(state, /is already being recorded|Stop it first/, 'the window refuses a second start too');
});

test('a piece that fails: the note says that part needs another pass', () => {
  // Reason changed 5 Nov second round: isThin still defines very short (same thresholds), but short answers are
  // always kept in the transcript now ("Okay" in 18 seconds is true and complete), never gaps. Only real failures gap.
  assert.equal(typeof R.isThin, 'function', 'far fewer words than its length should give');
  assert.ok(R.isThin('Yes.', 20), 'one word for twenty seconds is very short');
  assert.ok(R.isThin('one two', 20), 'two words for twenty seconds is very short');
  assert.ok(!R.isThin('one two three four', 20), 'four words passes');
  assert.ok(!R.isThin('Morning all, let us start with the mill and the quote.', 20), 'a sentence passes');
  assert.ok(!R.isThin('Yes.', 2), 'one word for two seconds is fine');
  // The gaps as lines in the transcript, each with its moment to play from (failed only, never short).
  assert.equal(typeof R.gapLines, 'function', 'failed stretches as lines saying they need another pass');
  const gaps = R.gapLines([
    { index: 0, start: 0, seconds: 20, status: 'done', text: 'Morning.' },
    { index: 1, start: 20, seconds: 20, status: 'failed', error: 'offline' },
    { index: 2, start: 40, seconds: 20, status: 'failed', error: 'offline' },
    { index: 3, start: 60, seconds: 20, status: 'done', text: 'Back again with the quote for the mill.' },
  ]);
  assert.equal(gaps.length, 1, 'neighbouring failures join into one stretch');
  assert.equal(gaps[0].at, 20);
  assert.match(gaps[0].text, /couldn\u2019t be written down|needs another pass|Try again/i);
  // A short answer kept beside a failure: its words stay, only the failure gaps.
  const kept = R.mergeTranscript([
    { index: 0, start: 0, seconds: 18, who: 'Others', status: 'done', text: 'Okay.' },
    { index: 1, start: 18, seconds: 18, who: 'Others', status: 'failed', error: 'offline' },
  ]);
  assert.deepEqual(kept.map((l) => l.text), ['Okay.']);
  // The window keeps short answers (never failed), stays quiet on empty, and writes the gaps into the note.
  const state = read('src/renderer/src/state/recorder.ts');
  assert.doesNotMatch(state, /isThin\(r\.text/, 'short answers kept where pieces land, never failed');
  assert.match(state, /!r\.text\.trim\(\) && !r\.segments\?\.length/, 'an empty answer stays quiet');
  assert.match(state, /gapLines/, 'the gaps written into the note with the transcript');
  assert.match(state, /recordingFate\(prefs\(\)\.meetingAudio, !!notes, missed\)/, 'the saved recording kept while any part needs another pass');
});

test('short answers are always kept: eighteen-second far-side pieces answering briefly (second round)', () => {
  // Realistic far-side sequence: 18-second Others pieces answering briefly between long answers. All words kept.
  const longs = [
    'Thanks for that, so the mill quote came back higher than we hoped and we need to work through the options before Friday.',
    'The supplier said the lead time is six weeks from deposit, which puts the install just before the busy season starts.',
    'We walked the site yesterday and the access at the back is tight, so the crane will need to come in from Mill Street.',
    'If we can lock in the deposit this week then the fabrication slot is ours, otherwise it slips to late next month.',
    'I will send the updated drawings tonight and we can pick this up with the builder first thing tomorrow morning.',
  ];
  const shorts = ['Okay.', 'Sounds good.', 'January 4', 'That should be fine.'];
  const order = [longs[0], shorts[0], longs[1], shorts[1], longs[2], shorts[2], longs[3], shorts[3], longs[4]];
  const pieces = order.map((text, i) => ({ index: i, start: i * 18, seconds: 18, who: 'Others', status: 'done', text }));
  const lines = R.mergeTranscript(pieces);
  assert.deepEqual(lines.map((l) => l.text), order, 'every word in the transcript, in order');
  assert.deepEqual(R.gapLines(pieces), [], 'no gap lines for short answers');
  assert.equal(R.missedSeconds(pieces), 0, 'no missed seconds');
  assert.deepEqual(R.piecesToDo(pieces, true), [], 'nothing to resend');
  // Many very short far-side answers say one calm line at the end only (never mid-meeting, never resent).
  assert.equal(typeof R.hasManyShortOthers, 'function', 'a good share of far-side pieces very short');
  assert.equal(typeof R.otherSideShortWords, 'function', 'one calm line, recording kept');
  const many = Array.from({ length: 8 }, (_, i) => ({ index: i, start: i * 18, seconds: 18, who: 'Others', status: 'done', text: i < 7 ? 'Okay.' : longs[0] }));
  assert.ok(R.hasManyShortOthers(many), 'seven very short of eight far-side pieces');
  assert.match(R.otherSideShortWords(), /other side.*may be missing/i, 'some words may be missing');
  assert.match(R.otherSideShortWords(), /recording is kept/i, 'the recording is kept');
  const few = Array.from({ length: 8 }, (_, i) => ({ index: i, start: i * 18, seconds: 18, who: 'Others', status: 'done', text: i < 2 ? 'Okay.' : longs[i % longs.length] }));
  assert.ok(!R.hasManyShortOthers(few), 'two very short of eight is fine');
  const mine = Array.from({ length: 8 }, (_, i) => ({ index: i, start: i * 18, seconds: 18, who: 'You', status: 'done', text: 'Okay.' }));
  assert.ok(!R.hasManyShortOthers(mine), 'my side alone never says the other side missed words');
  // The window: short answers never failed, never paused, never retried; paused only when truly stopped.
  const state = read('src/renderer/src/state/recorder.ts');
  assert.doesNotMatch(state, /isThin\(r\.text/, 'short answers never failed where pieces land');
  assert.doesNotMatch(state, /notice: thin/, 'no notice for a short answer');
  assert.equal((state.match(/setLive\(\{ notice: `Writing down has paused/g) ?? []).length, 1, 'paused only where writing down truly stopped');
  assert.match(state, /r\.kind === 'auth'/, 'a refused key pauses; a one-off failure tells its card only');
  assert.match(state, /hasManyShortOthers|otherSideShortWords/, 'many shorts said once at the end');
  // A piece that truly errors still becomes a gap and is retried as built.
  const withError = [...pieces.slice(0, 4), { index: 4, start: 72, seconds: 18, who: 'Others', status: 'failed', error: 'offline' }, ...pieces.slice(5).map((p) => ({ ...p, index: p.index + 1, start: p.start + 18 }))];
  assert.equal(R.gapLines(withError).length, 1, 'the errored stretch is a gap');
  assert.equal(R.missedSeconds(withError), 18, 'counted as missed');
  assert.match(state, /retryFailedLive/, 'failed pieces retried when the network returns');
  assert.match(state, /gapLines/, 'the gap written into the note with the transcript');
});

test('b5: gap lines count each span once and say whose words are missing', () => {
  // As found, two failed sides of one 20 s piece wrote "About 40 seconds", and a span where their side
  // came through still said the whole span was missing. Each span counts once, naming the missing side.
  const both = R.gapLines([
    { index: 0, start: 0, seconds: 20, status: 'failed', side: 'mic', who: 'You', error: 'offline' },
    { index: 0, start: 0, seconds: 20, status: 'failed', side: 'pc', who: 'Others', error: 'offline' },
  ]);
  assert.equal(both.length, 1);
  assert.match(both[0].text, /About 20 seconds/, `one span, not doubled (${both[0].text})`);
  const theirs = R.gapLines([
    { index: 0, start: 0, seconds: 20, status: 'done', side: 'mic', who: 'You', text: 'I will send it today.' },
    { index: 0, start: 0, seconds: 20, status: 'failed', side: 'pc', who: 'Others', error: 'offline' },
  ]);
  assert.equal(theirs.length, 1);
  assert.match(theirs[0].text, /other side/, `says whose words are missing (${theirs[0].text})`);
  assert.match(theirs[0].text, /Try again/, 'the way to fix it stays');
  const mine = R.gapLines([
    { index: 0, start: 0, seconds: 20, status: 'failed', side: 'mic', who: 'You', error: 'offline' },
    { index: 0, start: 0, seconds: 20, status: 'done', side: 'pc', who: 'Others', text: 'Please do.' },
  ]);
  assert.equal(mine.length, 1);
  assert.match(mine[0].text, /your words/, `the recorder’s side named (${mine[0].text})`);
  // Neighbouring failures still join, and a span nobody missed stays silent.
  const joined = R.gapLines([
    { index: 0, start: 0, seconds: 20, status: 'failed' },
    { index: 1, start: 20, seconds: 20, status: 'failed' },
  ]);
  assert.equal(joined.length, 1);
  assert.match(joined[0].text, /About 40 seconds/);
});
