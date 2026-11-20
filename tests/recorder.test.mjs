// node --test tests/recorder.test.mjs — the meeting recorder (src/shared/recorder.ts, src/main/meeting-recorder.ts; 21
// Oct 2026, gap G18; rebuilt 22 Oct 2026): the live recorder's states (Pause, Resume and Stop in every order, double
// clicks and late messages changing nothing, the time recorded with pauses left out), which recording belongs to which
// note (a deleted note's are forgotten, so a new meeting under the same name starts fresh; a renamed note takes its
// along), the speech cut into pieces at the quietest moment and early when the other side starts talking, who talked (the
// microphone or the PC's sound), the WAV each piece becomes, the pieces put back as a timed transcript with who said each
// line, a recording's job on disk (begun, its sound and speech added, a stretch read back, put among the notes, and found
// again after a simulated crash, its uncut speech made into pieces to finish), and the main side with The former host
// app's transcription and the model stubbed. The permission rule, with the regression that kept the PC's sound from ever
// recording on Windows: Electron asks for getDisplayMedia as 'media' with no device types.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-recorder-'));
let R, M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/recorder.ts'), platform: 'node', output: { file: path.join(work, 'r.mjs'), format: 'esm' }, logLevel: 'silent' });
  await build({ input: path.join(root, 'src/main/meeting-recorder.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  R = await import(pathToFileURL(path.join(work, 'r.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const run = (events, from) => events.reduce((s, [e, at]) => R.recStep(s, e, at), from ?? R.IDLE);
const NOTE = 'Meetings/Meeting 22 Oct 2026.md';

test('the live recorder: start, record, pause, resume, stop; the time recorded leaves out the pauses', () => {
  let s = R.recStep(R.IDLE, { type: 'start', id: 'job-00000001', note: NOTE }, 0);
  assert.equal(s.phase, 'starting');
  assert.equal(s.note, NOTE);
  assert.equal(s.id, 'job-00000001');
  assert.equal(R.recElapsed(s, 5000), 0, 'nothing is recorded while asking for the microphone');
  s = R.recStep(s, { type: 'started' }, 1000);
  assert.equal(s.phase, 'recording');
  assert.equal(R.recElapsed(s, 61_000), 60_000);
  s = R.recStep(s, { type: 'pause' }, 61_000);
  assert.equal(s.phase, 'paused');
  assert.equal(R.recElapsed(s, 300_000), 60_000, 'the clock stands still while paused');
  s = R.recStep(s, { type: 'resume' }, 121_000);
  assert.equal(s.pausedMs, 60_000);
  assert.equal(R.recElapsed(s, 151_000), 90_000);
  // The note renamed while it records: the recorder follows it (and a folder moved with it in).
  s = R.recStep(s, { type: 'moved', from: NOTE, to: 'Meetings/Supplier call.md' }, 152_000);
  assert.equal(s.note, 'Meetings/Supplier call.md');
  s = R.recStep(s, { type: 'moved', from: 'Meetings', to: 'Work/Meetings' }, 152_000);
  assert.equal(s.note, 'Work/Meetings/Supplier call.md');
  s = R.recStep(s, { type: 'moved', from: 'Other.md', to: 'Else.md' }, 152_000);
  assert.equal(s.note, 'Work/Meetings/Supplier call.md');
  // Stop: the live recorder is free at once (the job carries on); a second Stop, Resume after it, change nothing.
  const stopped = R.recStep(s, { type: 'stop' }, 181_000);
  assert.equal(stopped, R.IDLE);
  assert.equal(R.recStep(stopped, { type: 'stop' }, 182_000), stopped);
  assert.equal(R.recStep(stopped, { type: 'resume' }, 182_000), stopped);
  assert.equal(R.recStep(stopped, { type: 'pause' }, 182_000), stopped);
  // Busy: a second start is refused; Pause while paused changes nothing.
  const paused = run([[{ type: 'start', id: 'job-00000002', note: 'a.md' }, 0], [{ type: 'started' }, 0], [{ type: 'pause' }, 30_000]]);
  assert.equal(R.recStep(paused, { type: 'start', id: 'job-00000003', note: 'b.md' }, 31_000), paused);
  assert.equal(R.recStep(paused, { type: 'pause' }, 40_000), paused);
  assert.ok(R.isLive(paused) && R.isBusy(paused) && !R.isBusy(R.IDLE));
  // The microphone refused: back to idle, and a new start allowed after.
  const refused = run([[{ type: 'start', id: 'job-00000004', note: 'm.md' }, 0], [{ type: 'fail' }, 10]]);
  assert.equal(refused.phase, 'idle');
  assert.equal(R.recStep(refused, { type: 'start', id: 'job-00000005', note: 'm.md' }, 20).phase, 'starting');
  assert.equal(R.recStep(R.IDLE, { type: 'started' }, 0), R.IDLE);
  // The words for the time, and back.
  assert.equal(R.clockWords(7000), '0:07');
  assert.equal(R.clockWords(723_000), '12:03');
  assert.equal(R.clockWords(3_723_000), '1:02:03');
  assert.equal(R.clockSeconds('12:03'), 723);
  assert.equal(R.clockSeconds('1:02:03'), 3723);
  assert.equal(R.clockSeconds('soon'), null);
  assert.equal(R.lengthWords(20_000), 'under a minute');
  assert.equal(R.lengthWords(65 * 60_000), '1 hour 5 minutes');
});

test('a recording belongs to its note: deleting the note forgets it, so a new meeting under the same name starts fresh', () => {
  // recorded, deleted, and a new meeting made — the same name.
  const jobs = [
    { id: 'job-aaaaaaaa', note: NOTE, began: '2026-10-22T01:00:00Z', phase: 'recording' },
    { id: 'job-bbbbbbbb', note: 'Meetings/Weekly.md', began: '2026-10-22T00:00:00Z', phase: 'done' },
  ];
  assert.equal(R.jobForNote(jobs, 'job-aaaaaaaa', NOTE).id, 'job-aaaaaaaa');
  const { kept, gone } = R.jobsAfterRemove(jobs, NOTE);
  assert.deepEqual(gone.map((j) => j.id), ['job-aaaaaaaa']);
  assert.equal(R.jobForNote(kept, null, NOTE), null, 'the new note of the same name has no recording of its own');
  assert.equal(R.jobForNote(kept, null, 'Meetings/Weekly.md').id, 'job-bbbbbbbb', 'other meetings keep theirs');
  // A folder deleted takes its meetings' recordings with it; a note of a similar name isn't touched.
  assert.equal(R.jobsAfterRemove(jobs, 'Meetings').gone.length, 2);
  assert.equal(R.jobsAfterRemove(jobs, 'Meetings/Meeting 22 Oct').gone.length, 0);
  assert.ok(R.goneWith('Meetings/a.md', 'Meetings') && !R.goneWith('Meetings2/a.md', 'Meetings'));
  // Renamed or moved: the recordings go along; the others are the same objects.
  const moved = R.jobsAfterMove(jobs, NOTE, 'Meetings/Supplier call.md');
  assert.equal(moved[0].note, 'Meetings/Supplier call.md');
  assert.equal(moved[1], jobs[1]);
  assert.equal(R.jobForNote(moved, null, NOTE), null);
  assert.equal(R.jobForNote(moved, null, 'Meetings/Supplier call.md').id, 'job-aaaaaaaa');
  // Two recordings of one meeting: the live one first, else the latest.
  const two = [...jobs, { id: 'job-cccccccc', note: NOTE, began: '2026-10-22T02:00:00Z', phase: 'done' }];
  assert.equal(R.jobForNote(two, null, NOTE).id, 'job-cccccccc');
  assert.equal(R.jobForNote(two, 'job-aaaaaaaa', NOTE).id, 'job-aaaaaaaa');
});

/** Speech-like sound: a tone at `level`, with near-silent gaps [at, length] in seconds. */
function speech(seconds, rate, { level = 0.3, gaps = [] } = {}) {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const quiet = gaps.some(([at, len]) => t >= at && t < at + len);
    out[i] = quiet ? 0.0005 * Math.sin(i) : level * Math.sin((2 * Math.PI * 220 * i) / rate);
  }
  return out;
}

test('the speech is cut into pieces of about twenty seconds, each at the quietest moment of its last seconds', () => {
  const rate = 16000;
  assert.equal(R.PIECE_SECONDS, 20);
  const c = new R.Chunker({ rate, seconds: 10, lookBack: 3 });
  const sound = speech(25, rate, { gaps: [[8.5, 0.2], [18.0, 0.25]] });
  const pieces = [];
  for (let at = 0; at < sound.length; at += 4096) pieces.push(...c.push(sound.subarray(at, at + 4096)));
  assert.equal(pieces.length, 2);
  const firstLen = pieces[0].samples.length / rate;
  assert.ok(firstLen > 8.5 && firstLen < 8.7, `cut at ${firstLen}s`);
  assert.equal(pieces[1].index, 1);
  assert.ok(Math.abs(pieces[1].start - firstLen) < 1e-9);
  const secondEnd = pieces[1].start + pieces[1].samples.length / rate;
  assert.ok(secondEnd > 18.0 && secondEnd < 18.25, `second cut at ${secondEnd}s`);
  const last = c.flush();
  assert.equal(last.index, 2);
  assert.equal(pieces.reduce((n, p) => n + p.samples.length, 0) + last.samples.length, sound.length, 'nothing lost or doubled');
  assert.equal(c.flush(), null);
  const d = new R.Chunker({ rate, seconds: 10 });
  d.push(speech(0.2, rate));
  assert.equal(d.flush(), null, 'a click of Stop is not a piece');
  // A chunker picking up where a crash left off numbers on from there.
  const e = new R.Chunker({ rate, seconds: 10, startIndex: 7, startAt: 140 });
  e.push(speech(3, rate));
  const p = e.flush();
  assert.equal(p.index, 7);
  assert.equal(p.start, 140);
});

test('an hour makes about 180 pieces, each well under the host app’s 4 MB', () => {
  const rate = 16000;
  const c = new R.Chunker({ rate });
  const minute = speech(60, rate);
  let count = 0;
  let biggest = 0;
  for (let m = 0; m < 60; m++)
    for (let at = 0; at < minute.length; at += 16000)
      for (const p of c.push(minute.subarray(at, at + 16000))) {
        count++;
        biggest = Math.max(biggest, R.encodeWav(p.samples, rate).length);
      }
  assert.ok(count >= 179 && count <= 182, `${count} pieces`);
  assert.ok(biggest < M.MAX_PIECE_BYTES / 6, `largest piece ${biggest} bytes`);
});

test('the other side starts talking: the piece is cut there (never shorter than four seconds), and each says who talked', () => {
  const rate = 16000;
  const cap = new R.MeetingCapture({ rate, seconds: 20 });
  // You talk for 6 s, a breath at 6.0–6.2 s, then the call talks for 5 s. Blocks of 0.1 s per source, sides apart.
  const mic = speech(11, rate, { gaps: [[6.0, 0.2], [6.2, 5]] });
  const pc = speech(11, rate, { gaps: [[0, 6.2]] });
  const pieces = [];
  const block = 1600;
  for (let at = 0; at < mic.length; at += block) pieces.push(...cap.block(mic.subarray(at, at + block), pc.subarray(at, at + block)));
  const last = cap.flush();
  if (last) pieces.push(last);
  assert.equal(pieces.length, 2, 'two pieces: you, then the others');
  const firstEnd = pieces[0].start + pieces[0].seconds;
  assert.ok(firstEnd > 5.9 && firstEnd < 7.1, `cut at the turn (${firstEnd}s)`);
  assert.deepEqual(pieces[0].sides, ['mic']);
  assert.deepEqual(pieces[1].sides, ['pc']);
  // Too early for a turn: nothing cut.
  const early = new R.Chunker({ rate });
  early.push(speech(2, rate));
  assert.equal(early.takeTurn(), null);
  // Who is talking in a moment (the turn tracker's own vote).
  assert.equal(R.talker(0.1, 0.01), 'mic');
  assert.equal(R.talker(0.02, 0.1), 'pc');
  assert.equal(R.talker(0.05, 0.05), null, 'both at once: neither');
  assert.equal(R.talker(0.001, 0.002), null, 'silence');
  // A turn has to hold: a cough from the other side doesn't cut.
  const t = new R.TurnTracker(0.7);
  assert.equal(t.feed(0.1, 0, 0.1), false);
  assert.equal(t.feed(0, 0.1, 0.3), false);
  assert.equal(t.feed(0.1, 0, 0.1), false, 'back to you: the count starts again');
  assert.equal(t.feed(0, 0.1, 0.4), false);
  assert.equal(t.feed(0, 0.1, 0.4), true);
});

test('silence is never sent; the rate brought down; the WAV a piece becomes, and the speech kept on disk', () => {
  assert.ok(R.isQuiet({ samples: new Float32Array(16000) }));
  assert.ok(!R.isQuiet({ samples: speech(1, 16000, { level: 0.05 }) }));
  const hi = speech(1, 48000);
  const lo = R.downsample(hi, 48000, 16000);
  assert.equal(lo.length, 16000);
  assert.ok(Math.abs(R.loudness(lo) - R.loudness(hi)) < 0.02);
  const wav = R.encodeWav(new Float32Array([0, 0.5, -0.5, 2, -2]), 16000);
  const v = new DataView(wav.buffer);
  const text = (a, n) => String.fromCharCode(...wav.slice(a, a + n));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 10);
  assert.equal(v.getInt16(50, true), 0x7fff);
  assert.equal(v.getInt16(52, true), -0x8000);
  // 16-bit speech there and back.
  const back = R.fromPcm16(R.toPcm16(new Float32Array([0, 0.25, -0.25])));
  assert.ok(Math.abs(back[1] - 0.25) < 1e-4 && Math.abs(back[2] + 0.25) < 1e-4);
  assert.deepEqual([...R.wavOfPcm(R.toPcm16(new Float32Array([0.5])))], [...R.encodeWav(new Float32Array([0.5]))]);
});

test('the pieces put back as a timed transcript with who said each line', () => {
  const lines = R.mergeTranscript([
    { index: 1, start: 20.2, seconds: 8, status: 'done', who: 'Others', text: 'Priya says the price drops six percent.' },
    { index: 0, start: 0, seconds: 20, status: 'done', who: 'You', text: 'ignored when segments come', segments: [{ start: 0, text: 'Morning all.' }, { start: 12.5, text: 'Let’s start with the mill.' }] },
    { index: 2, start: 28.2, seconds: 20, status: 'failed', text: '' },
    { index: 3, start: 48.2, seconds: 20, status: 'quiet' },
    { index: 4, start: 68.2, seconds: 20, status: 'done', segments: [{ start: 1, text: 'Agreed.', speaker: 'speaker_1' }, { start: 4, text: 'Done.', speaker: 'B' }] },
  ]);
  assert.deepEqual(lines, [
    { at: 0, text: 'Morning all.', who: 'You' },
    { at: 12.5, text: 'Let’s start with the mill.', who: 'You' },
    { at: 20.2, text: 'Priya says the price drops six percent.', who: 'Others' },
    { at: 69.2, text: 'Agreed.', who: 'Speaker 2' },
    { at: 72.2, text: 'Done.', who: 'Speaker 2' },
  ]);
  assert.equal(R.transcriptText(lines.slice(0, 3)), '[0:00] You: Morning all.\n[0:12] You: Let’s start with the mill.\n[0:20] Others: Priya says the price drops six percent.');
});

test('a crash mid-piece: the speech after the last piece becomes pieces to finish; what is missing in words', () => {
  const pieces = [
    { index: 0, start: 0, seconds: 20, status: 'done', text: 'a' },
    { index: 1, start: 20, seconds: 18.5, status: 'failed', error: 'offline' },
  ];
  assert.equal(R.piecesEnd(pieces), 38.5);
  const tail = R.tailPieces(pieces, 81);
  assert.deepEqual(tail.map((p) => [p.index, p.start, p.seconds, p.status]), [[2, 38.5, 20, 'pending'], [3, 58.5, 20, 'pending'], [4, 78.5, 2.5, 'pending']]);
  assert.deepEqual(R.tailPieces(pieces, 38.9), [], 'less than a click left: nothing');
  assert.deepEqual(R.piecesToDo([...pieces, ...tail], false).map((p) => p.index), [2, 3, 4]);
  assert.deepEqual(R.piecesToDo([...pieces, ...tail], true).map((p) => p.index), [1, 2, 3, 4]);
  assert.equal(R.missedSeconds(pieces), 18.5);
  assert.equal(R.missedWords(18.5), 'About 20 seconds');
  assert.equal(R.missedWords(150), 'About 3 minutes');
  assert.equal(R.missedWords(0), '');
});

test('the recording file: AAC in .m4a where Chromium can make it (never Opus in an .m4a), else WebM; kept or binned', () => {
  // Windows (proved on the build laptop, Electron 44.2.0): AAC.
  assert.deepEqual(R.pickRecordingType((t) => t.startsWith('audio/mp4') || t.startsWith('audio/webm')), { mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a' });
  // Linux's Chromium says yes to a bare "audio/mp4" and fills it with Opus: not taken.
  assert.deepEqual(R.pickRecordingType((t) => t === 'audio/mp4' || t === 'audio/mp4;codecs=opus' || t.startsWith('audio/webm')), { mime: 'audio/webm;codecs=opus', ext: 'weba' });
  assert.deepEqual(R.pickRecordingType(() => {
    throw new Error('no');
  }), { mime: '', ext: 'weba' });
  assert.equal(R.recordingName('Supplier call: Western Plains / mill?', new Date(2026, 9, 21, 14, 5), 'm4a'), 'Recording – Supplier call Western Plains mill 2026-10-21 14.05.m4a');
  assert.equal(R.recordingName('LF internal IT meeting.', new Date(2026, 9, 21, 14, 5), 'm4a'), 'Recording – LF internal IT meeting 2026-10-21 14.05.m4a', 'a title with a full stop: no trailing dot in the file (r2)');
  assert.equal(R.recordingFate('keep', true), 'keep');
  assert.equal(R.recordingFate('delete', true), 'trash');
  assert.equal(R.recordingFate('delete', false), 'keep', 'no notes: the sound is all there is');
  assert.equal(R.recordingFate('delete', true, 30), 'keep', 'part not written down: kept for Try again');
  // The words for a microphone or the PC's sound that couldn't be had.
  assert.match(R.micWords('NotAllowedError'), /Privacy & security › Microphone/);
  assert.match(R.micWords('NotFoundError'), /No microphone was found/);
  assert.match(R.micWords('NotReadableError'), /busy in another app/);
  assert.match(R.pcSoundWords('NotAllowedError'), /only your microphone/);
  assert.match(R.pcSoundWords('NotReadableError'), /speakers or headphones/);
});

test('a job checked as it comes from disk: nonsense dropped, every part its kind', () => {
  assert.equal(R.cleanJob(null), null);
  assert.equal(R.cleanJob({ id: '../../etc', note: 'a.md' }), null);
  assert.equal(R.cleanJob({ id: 'job-12345678', note: '' }), null);
  const j = R.cleanJob({ id: 'job-12345678', vault: 'C:/Users/me/Notes', note: 'a.md', title: 7, date: 'soon', phase: 'nonsense', ext: '../x', elapsedMs: -5, pieces: [{ index: 0, start: 0, seconds: 20, status: 'odd', who: 'Them' }, { bad: true }], attachment: null });
  assert.equal(j.title, 'Meeting');
  assert.equal(j.date, '');
  assert.equal(j.phase, 'stopped');
  assert.equal(j.ext, 'weba');
  assert.equal(j.elapsedMs, 0);
  assert.equal(j.vault, 'C:/Users/me/Notes');
  assert.equal(j.attachment, null);
  assert.deepEqual(j.pieces, [{ index: 0, start: 0, seconds: 20, status: 'pending' }]);
});

test('speakers: numbered voices and names survive the job on disk; junk does not', () => {
  const j = R.cleanJob({
    id: 'job-12345678', note: 'a.md',
    pieces: [
      { index: 0, start: 0, seconds: 20, status: 'done', side: 'pc', who: 'Speaker 1', text: 'hello' },
      { index: 1, start: 20, seconds: 20, status: 'done', side: 'pc', who: 'Speaker X', text: 'junk' },
    ],
    speakers: { names: { spk1: 'Sam Okafor', nope: 'Jo', spk2: '' } },
  });
  assert.equal(j.pieces[0].who, 'Speaker 1');
  assert.equal(j.pieces[1].who, undefined);
  assert.deepEqual(j.speakers, { names: { spk1: 'Sam Okafor' } });
  assert.equal(R.cleanJob({ id: 'job-12345678', note: 'a.md', speakers: { names: 'junk' } }).speakers, undefined);
  assert.equal(R.cleanJob({ id: 'job-12345678', note: 'a.md' }).speakers, undefined, 'older jobs read as before');
});

test('speakers: short far-side voices count as the other side; a room’s voices do not', () => {
  const short = (i, who, side) => ({ index: i, start: i * 20, seconds: 20, status: 'done', text: 'okay', ...(side ? { side } : {}), ...(who ? { who } : {}) });
  const pcVoices = Array.from({ length: 8 }, (_, i) => short(i, `Speaker ${(i % 2) + 1}`, 'pc'));
  assert.equal(R.hasManyShortOthers(pcVoices), true);
  const roomVoices = Array.from({ length: 8 }, (_, i) => short(i, `Speaker ${(i % 2) + 1}`));
  assert.equal(R.hasManyShortOthers(roomVoices), false);
});

/** The main side's handlers, caught as app.ts registers them. */
function mainSide(deps = {}) {
  const handlers = {};
  const asked = [];
  const dataDir = deps.dataDir ?? path.join(work, `data-${Math.random().toString(36).slice(2)}`);
  const vault = deps.vault ?? path.join(work, 'vault');
  mkdirSync(vault, { recursive: true });
  const r = M.registerRecorder({
    handle: (ch, fn) => (handlers[ch] = fn),
    requireCreate: async () => {},
    askJson: async (system, user, timeout, max) => {
      asked.push({ system, user, timeout, max });
      return deps.reply ?? { reply: { summary: 'They chose the mill.', decisions: [{ text: 'Western Plains supplies flour', at: '0:12' }], actions: [{ what: 'send the quote', who: 'Sam', due: '2026-10-24', time: '' }], people: ['Sam'] } };
    },
    platform: deps.platform ?? 'linux',
    dataDir,
    saveFile: async (name, file, forNote) => {
      const rel = `Attachments/${name}`;
      mkdirSync(path.join(vault, 'Attachments'), { recursive: true });
      copyFileSync(file, path.join(vault, rel));
      return rel;
    },
    ...deps.extra,
  });
  return { r, handlers, asked, dataDir, vault };
}
const wav = () => R.encodeWav(speech(1, 16000), 16000);

test('the main side: each piece written down by the host app (stubbed), refusals, offline and slowness in words', async () => {
  const got = [];
  const { handlers, r } = mainSide({
    extra: {
      transcribe: async (audio, mime) => {
        got.push({ size: audio.byteLength, mime });
        if (got.length === 2) return { error: 'OpenAI did not accept the key for speech.' };
        if (got.length === 3) throw new Error('fetch failed');
        if (got.length === 4) throw new Error('the host app could not answer (502).');
        return { text: '  Morning   all. ', segments: [{ start: 0, text: 'Morning all.' }, { start: 3.2, text: 'Shall we?', speaker: 'A' }, { start: -1, text: 'bad' }, { start: 2, text: '' }] };
      },
    },
  });
  assert.deepEqual(r.status(), { transcribe: true, systemAudio: false, pieceSeconds: 20 });
  assert.deepEqual(await handlers['recorder:transcribe'](wav(), 'audio/wav'), { text: 'Morning all.', segments: [{ start: 0, text: 'Morning all.' }, { start: 3.2, text: 'Shall we?', speaker: 'A' }] });
  assert.equal(got[0].mime, 'audio/wav');
  // A refused key maps to plain words with what to do, and its kind (5 Nov 2026, s2-recorder-survives).
  const refused = await handlers['recorder:transcribe'](wav(), 'audio/wav');
  assert.equal(refused.kind, 'auth');
  assert.match(refused.error, /Settings › AI/);
  assert.match((await handlers['recorder:transcribe'](wav(), 'audio/wav')).error, /couldn’t be reached.*recording is kept/);
  const gateway = await handlers['recorder:transcribe'](wav(), 'audio/wav');
  assert.equal(gateway.kind, 'offline');
  assert.match(gateway.error, /couldn’t be reached.*recording is kept/);
  assert.match((await handlers['recorder:transcribe']('not audio', 'audio/wav')).error, /didn’t arrive whole/);
  assert.match((await handlers['recorder:transcribe'](new Uint8Array(M.MAX_PIECE_BYTES + 1), 'audio/wav')).error, /too long/);
  assert.equal(got.length, 4);
  // A piece heard as one segment at its start says no more than its words.
  assert.deepEqual(M.cleanTranscribed({ text: 'Hello.', segments: [{ start: 0, end: 20, text: 'Hello.' }] }), { text: 'Hello.' });
});

test('r2: the note’s own names go to the service as hints (breakout, not blackout; the product’s own name)', () => {
  assert.deepEqual(R.transcribeHints({ title: 'Blackout planning', people: ['Sam Okafor'], project: 'Grid ADM' }), ['Sam Okafor', 'Grid ADM', 'Blackout', 'planning']);
  assert.deepEqual(R.transcribeHints({ title: 'a catch-up', people: [], project: '' }), ['catch-up'], 'filler words left out');
  assert.deepEqual(R.transcribeHints({ title: 'SAM OKAFOR sync', people: ['Sam Okafor'], project: '' }), ['Sam Okafor', 'sync'], 'each name once, however it is cased');
  assert.equal(R.transcribeHints({ title: 'Planning', people: Array(60).fill(0).map((_, i) => `Person ${i}`), project: '' }).length, 40, 'capped for the prompt');
});

test('r2: the main side hands the hints to the host app’s hearing', async () => {
  const got = [];
  const { handlers } = mainSide({ extra: { transcribe: async (audio, mime, hints) => { got.push(hints); return { text: 'Heard.' }; } } });
  await handlers['recorder:transcribe'](wav(), 'audio/wav', ['Blackout', 'ADM']);
  assert.deepEqual(got, [['Blackout', 'ADM']]);
  await handlers['recorder:transcribe'](wav(), 'audio/wav');
  assert.deepEqual(got[1] ?? [], [], 'none sent: none passed');
});

test('the hint never reaches a transcript: its lead sentence and any three names in order are cut (12 Nov 2026)', () => {
  const hints = ['2026-11-12', 'meeting', 'Darcy Lin', 'Harbour Garden', 'Studio Desk Update'];
  assert.equal(R.scrubHintEcho('Names and words to know: 2026-11-12, meeting, Darcy Lin, Harbour Garden, Studio Desk Update.', hints), '', 'an old-shaped hint read back whole: dropped');
  assert.equal(R.scrubHintEcho('Names and words to know: Darcy Lin. The planting starts Monday.', hints), 'The planting starts Monday.', 'the lead with its list cut out, the speech kept');
  assert.equal(R.scrubHintEcho('2026-11-12, meeting, Darcy Lin, Harbour Garden', hints), '', 'names in hint order, no label: the plain list read back, dropped');
  assert.equal(R.scrubHintEcho('Darcy Lin will send the quote.', hints), 'Darcy Lin will send the quote.', 'one name said for real: kept');
  assert.equal(R.scrubHintEcho('Darcy Lin and the Harbour Garden team met today.', hints), 'Darcy Lin and the Harbour Garden team met today.', 'two names said for real: kept');
  assert.equal(R.scrubHintEcho('Harbour Garden, meeting and Darcy Lin all came up.', hints), 'Harbour Garden, meeting and Darcy Lin all came up.', 'the names out of hint order: kept, never an echo');
  assert.equal(R.scrubHintEcho('Names and words to know: Darcy Lin.', []), 'Names and words to know: Darcy Lin.', 'no hints: untouched');
});

test('a fake transcriber echoing the hint leaves no hint text, live or final; real names are kept', async () => {
  const hints = ['2026-11-12', 'meeting', 'Darcy Lin'];
  const { handlers } = mainSide({
    extra: {
      transcribe: async (audio, mime, got) => {
        assert.deepEqual(got, hints);
        return { text: 'Names and words to know: 2026-11-12, meeting, Darcy Lin.' };
      },
    },
  });
  assert.deepEqual(await handlers['recorder:transcribe'](wav(), 'audio/wav', hints), { text: '' }, 'a quiet chunk echoing the hint: nothing kept (the piece stays quiet, live and final)');
  const speaking = mainSide({ extra: { transcribe: async () => ({ text: 'Darcy Lin will send the quote.', segments: [{ start: 1, text: 'Darcy Lin will send the quote.' }] }) } });
  assert.deepEqual(await speaking.handlers['recorder:transcribe'](wav(), 'audio/wav', hints), {
    text: 'Darcy Lin will send the quote.',
    segments: [{ start: 1, text: 'Darcy Lin will send the quote.' }],
  }, 'a name said aloud in the meeting: kept, with its times');
  // The live pieces and the finished note read the same kept pieces: nothing of the hint in either.
  const pieces = [
    { index: 0, start: 0, seconds: 20, status: 'quiet' },
    { index: 1, start: 20, seconds: 20, status: 'done', side: 'pc', who: 'Speaker 1', text: 'Darcy Lin will send the quote.' },
  ];
  const lines = R.mergeTranscript(pieces);
  assert.equal(lines.length, 1);
  assert.ok(!/names and words to know/i.test(R.transcriptText(lines)), 'no hint text in the transcript');
});

test('before the meeting: where it will be written down, or what to set up, in the host app’s words', async () => {
  // Plain words for every provider (7 Nov 2026, j1: the note page named an engine, "with Muse Code"): where
  // it happens, never the provider's name, so a new route can never leak one onto the screen.
  const ready = mainSide({ extra: { transcribe: async () => ({ text: '' }), transcribeStatus: async () => ({ route: 'openai', provider: 'OpenAI', ready: true }) } });
  assert.deepEqual((await ready.handlers['recorder:status']()).transcriber, { ready: true, where: 'service' });
  const plan = mainSide({ extra: { transcribe: async () => ({ text: '' }), transcribeStatus: async () => ({ route: 'muse', provider: 'Muse Code', ready: true }) } });
  assert.deepEqual((await plan.handlers['recorder:status']()).transcriber, { ready: true, where: 'service' });
  const local = mainSide({ extra: { transcribe: async () => ({ text: '' }), transcribeStatus: async () => ({ route: 'local', ready: true }) } });
  assert.deepEqual((await local.handlers['recorder:status']()).transcriber, { ready: true, where: 'pc' });
  const none = mainSide({ extra: { transcribe: async () => ({ text: '' }), transcribeStatus: async () => ({ route: '', ready: false, error: 'To transcribe audio, connect OpenAI or Gemini in Settings › Models.' }) } });
  assert.deepEqual((await none.handlers['recorder:status']()).transcriber, { ready: false, words: 'To transcribe audio, connect OpenAI or Gemini in Settings › Models.' });
  const broken = mainSide({ extra: { transcribe: async () => ({ text: '' }), transcribeStatus: async () => Promise.reject(new Error('down')) } });
  assert.equal((await broken.handlers['recorder:status']()).transcriber, undefined, 'unknown: nothing said');
  const alone = mainSide({ platform: 'win32' });
  const s = await alone.handlers['recorder:status']();
  assert.equal(s.transcribe, false);
  assert.equal(s.systemAudio, true);
  assert.match(s.transcriber.words, /No transcription connection is set up yet/);
  assert.equal(s.transcriber.needsSetup, true);
  assert.match((await alone.handlers['recorder:transcribe'](wav(), 'audio/wav')).error, /Add a transcription connection in Settings › AI/);
  // A development build's stand-in lines (and the PC's sound on Linux for its screen tests).
  const t = mainSide({ extra: { testLines: async () => ['First.', { error: 'Too fast.' }, { text: 'Third.', segments: [{ start: 1, text: 'Third.' }] }], pieceSeconds: 4, systemAudio: true } });
  assert.deepEqual(t.r.status(), { transcribe: true, systemAudio: true, pieceSeconds: 4 });
  assert.deepEqual(await t.handlers['recorder:transcribe'](wav(), 'audio/wav'), { text: 'First.' });
  assert.deepEqual(await t.handlers['recorder:transcribe'](wav(), 'audio/wav'), { error: 'Too fast.', kind: 'other' });
  assert.deepEqual(await t.handlers['recorder:transcribe'](wav(), 'audio/wav'), { text: 'Third.', segments: [{ start: 1, text: 'Third.' }] });
  assert.deepEqual(await t.handlers['recorder:transcribe'](wav(), 'audio/wav'), { text: '' });
});

test('a recording kept on disk as it goes; after a crash it is found again, read back and put among the notes', async () => {
  const dataDir = path.join(work, 'crash-data');
  const first = mainSide({ dataDir });
  const id = 'job-crash001';
  const job = await first.handlers['recorder:begin']({ id, vault: '/notes', note: NOTE, title: 'Meeting 22 Oct 2026', date: '2026-10-22', began: '2026-10-22T01:00:00.000Z', mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a', sources: 'mic+pc', elapsedMs: 0, phase: 'recording', pieces: [] });
  assert.equal(job.phase, 'recording');
  assert.equal(job.speechSeconds, 0);
  // The sound as Chromium encodes it, and 50 s of speech, arriving a second at a time (some writes at once, kept in order).
  const sec = R.toPcm16(speech(1, 16000));
  await Promise.all(Array.from({ length: 50 }, () => first.handlers['recorder:append'](id, 'speech', sec)));
  for (let i = 0; i < 5; i++) await first.handlers['recorder:append'](id, 'audio', new Uint8Array([i, i, i, i]));
  await first.handlers['recorder:update'](id, { elapsedMs: 45_000, pieces: [{ index: 0, start: 0, seconds: 20, status: 'done', who: 'You', text: 'Morning all.' }, { index: 1, start: 20, seconds: 19.4, status: 'pending', who: 'Others' }] });
  await assert.rejects(first.handlers['recorder:append']('../escape', 'speech', sec), /isn’t known/);
  await assert.rejects(first.handlers['recorder:append'](id, 'other', sec), /isn’t part/);
  // Ironleaf closes without a Stop (the crash): a new start finds it, with all the speech that reached the disk.
  const after = mainSide({ dataDir });
  const found = await after.handlers['recorder:jobs']();
  assert.equal(found.length, 1);
  const j = found[0];
  assert.equal(j.id, id);
  assert.equal(j.phase, 'recording', 'still recording when it stopped: offered to finish');
  assert.equal(j.speechSeconds, 50);
  assert.equal(j.audioBytes, 20);
  assert.equal(j.vault, '/notes');
  assert.deepEqual(j.pieces.map((p) => p.status), ['done', 'pending']);
  // Finishing: the piece in flight and the uncut speech after it are written down from disk.
  const todo = [...R.piecesToDo(j.pieces, true), ...R.tailPieces(j.pieces, j.speechSeconds)];
  assert.deepEqual(todo.map((p) => [p.start, p.seconds]), [[20, 19.4], [39.4, 10.6]]);
  const w = await after.handlers['recorder:speech'](id, 39.4, 10.6);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF');
  assert.equal(new DataView(w.buffer, w.byteOffset).getUint32(40, true), Math.floor(10.6 * 16000) * 2);
  assert.equal((await after.handlers['recorder:speech'](id, 49.5, 30)).length, 44 + 0.5 * 16000 * 2, 'past the end: only what there is');
  // The recording among the notes, once (asked again, the same file).
  const rel = await after.handlers['recorder:keep'](id, 'Recording – Meeting 22 Oct 2026 2026-10-22 12.00.m4a', NOTE);
  assert.equal(rel, 'Attachments/Recording – Meeting 22 Oct 2026 2026-10-22 12.00.m4a');
  assert.deepEqual([...readFileSync(path.join(after.vault, rel))], [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
  assert.equal(await after.handlers['recorder:keep'](id, 'other.m4a', NOTE), rel);
  assert.equal((await after.handlers['recorder:jobs']())[0].attachment, rel);
  // Written up: the folder goes; writes after that are refused, never a new folder made.
  await after.handlers['recorder:discard'](id);
  assert.deepEqual(await after.handlers['recorder:jobs'](), []);
  assert.ok(!existsSync(path.join(dataDir, 'recordings', id)));
  await assert.rejects(after.handlers['recorder:append'](id, 'speech', sec), /discarded/);
  assert.ok(!existsSync(path.join(dataDir, 'recordings', id)));
  // A private note is never recorded into.
  await assert.rejects(after.handlers['recorder:begin']({ id: 'job-private1', note: 'Private notes/Diary.md', began: '', ext: 'm4a', pieces: [] }), /Private notes/);
  void statSync;
});

test('the notes asked on the chat’s model with the transcript and people, decisions with their moment; private refused', async () => {
  const { handlers, asked } = mainSide();
  const out = await handlers['recorder:notes']('Meetings/Supplier call.md', { title: 'Supplier call', date: '2026-10-21', transcript: '[0:00] You: Sam will send the quote by the 24th.', people: ['Sam Okafor', 42] });
  assert.equal(out.error, undefined);
  assert.equal(out.notes.summary, 'They chose the mill.');
  assert.deepEqual(out.notes.decisions, ['Western Plains supplies flour']);
  assert.deepEqual(out.notes.decisionTimes, [12]);
  assert.deepEqual(out.notes.actions, [{ what: 'Send the quote', who: 'Sam', due: '2026-10-24' }]);
  assert.match(asked[0].system, /"You" is the person keeping these notes \(named below when known\), "Others" the other people on the call/);
  assert.match(asked[0].user, /<transcript>\n\[0:00\] You: Sam will send the quote by the 24th.\n<\/transcript>/);
  assert.match((await handlers['recorder:notes']('Private notes/Diary.md', { transcript: 'x' })).error, /Private notes/);
  assert.match((await handlers['recorder:notes']('m.md', { transcript: '  ' })).error, /Nothing was written down/);
  const failing = mainSide({ reply: { reply: null, error: 'The model is offline.' } });
  assert.deepEqual(await failing.handlers['recorder:notes']('m.md', { transcript: '[0:00] hi' }), { notes: null, error: 'The model is offline.' });
});

test('permissions: the PC’s sound is asked as "media" with no device types — allowed on Windows for Ironleaf’s window', async () => {
  // The regression (22 Oct 2026): this exact ask was refused, so getDisplayMedia failed and only the microphone recorded.
  assert.ok(M.recorderMayHave('media', [], true, true), 'getDisplayMedia, as Electron 44 asks it');
  assert.ok(M.recorderMayHave('media', undefined, true, true));
  assert.ok(!M.recorderMayHave('media', [], true, false), 'not where the PC’s sound isn’t recorded');
  assert.ok(M.recorderMayHave('media', ['audio'], true, false), 'the microphone');
  assert.ok(!M.recorderMayHave('media', ['audio', 'video'], true, true), 'never the camera');
  assert.ok(!M.recorderMayHave('media', ['video'], true, true));
  assert.ok(!M.recorderMayHave('media', [], false, true), 'never another window');
  assert.ok(M.recorderMayHave('display-capture', undefined, true, true));
  assert.ok(!M.recorderMayHave('notifications', undefined, true, true));
  const install = (othersAllowed, platform = 'win32', extra = {}) => {
    const h = {};
    M.allowRecording({
      contents: { id: 7, session: { setPermissionRequestHandler: (fn) => (h.perm = fn), setDisplayMediaRequestHandler: (fn) => (h.display = fn) } },
      fromFrame: (f) => (f ? { id: f.owner } : undefined),
      screens: async () => [{ id: 'screen:0' }],
      platform,
      othersAllowed,
      ...extra,
    });
    const ask = (id, permission, mediaTypes) => new Promise((ok) => h.perm({ id }, permission, ok, { mediaTypes }));
    const share = (frame, audioRequested = true) => new Promise((ok) => h.display({ frame, audioRequested }, ok));
    return { ask, share };
  };
  const inside = install(false);
  assert.equal(await inside.ask(7, 'media', ['audio']), true);
  assert.equal(await inside.ask(7, 'media', []), true, 'the PC’s sound');
  assert.equal(await inside.ask(7, 'notifications'), false);
  assert.equal(await inside.ask(3, 'media', ['audio']), false);
  assert.equal(await inside.ask(3, 'media', []), false);
  // The picture handed over with the sound is Ironleaf's own window, never the person's screen.
  const frame = { owner: 7 };
  assert.deepEqual(await inside.share(frame), { video: frame, audio: 'loopback' });
  assert.equal(await inside.share({ owner: 3 }), null);
  assert.equal(await inside.share(frame, false), null);
  const alone = install(true, 'linux');
  assert.equal(await alone.ask(3, 'notifications'), true);
  assert.equal(await alone.ask(7, 'media', ['audio', 'video']), false);
  assert.equal(await alone.ask(7, 'media', []), false);
  assert.equal(await alone.share(frame), null, 'the PC’s sound only on Windows');
  const tests = install(true, 'linux', { systemAudio: true });
  assert.deepEqual(await tests.share(frame), { video: frame, audio: 'loopback' }, 'a development build’s tests on Linux');
});

test('a PC sound that stays silent is said on its meter, never as a warning (Windows records only the default speakers)', () => {
  assert.equal(R.PC_SILENT_SECONDS, 30);
  const state = readFileSync(path.join(root, 'src/renderer/src/state/recorder.ts'), 'utf8'), view = readFileSync(path.join(root, 'src/renderer/src/views/MeetingRecorder.tsx'), 'utf8');
  assert.match(state, /if \(pc\) s\.pcQuiet = pcR < MIC_DEAD \? s\.pcQuiet \+ seconds : 0;/, 'counted while the PC is silent, back to nought when it plays');
  assert.match(state, /pcSilent: !!s\.pc && s\.pcQuiet >= PC_SILENT_SECONDS/, 'the meters read it');
  assert.match(view, /\$\{label\} · silent/, 'the meter says it');
  assert.match(view, /make it Windows’ default speaker/, 'and how to sort it');
  assert.doesNotMatch(state, /warning: 'pc-silent'/, 'never a warning: a meeting in a room has no PC sound');
});

test('9.5 batch 9: a segment past an hour keeps its moment (F101)', () => {
  const out = M.cleanTranscribed({ text: 'Late point.', segments: [{ start: 3700.5, text: 'Late point.' }, { start: 3705, text: 'Agreed.' }] });
  assert.deepEqual(out.segments.map((s) => s.start), [3700.5, 3705]);
});

test('9.5 batch 9: dropped connections read as offline, by code or by message (F104)', async () => {
  const errs = [];
  const coded = new Error('read failed');
  coded.code = 'ECONNRESET';
  const { handlers } = mainSide({ extra: { transcribe: async () => { throw errs.shift(); } } });
  errs.push(coded, Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), new Error('getaddrinfo EAI_AGAIN api.example.com'));
  for (let i = 0; i < 3; i++) assert.match((await handlers['recorder:transcribe'](wav(), 'audio/wav')).error, /couldn’t be reached.*recording is kept/);
});

test('a long transcript is asked in chunks that fit, whole lines, none lost, none twice', () => {
  const lines = Array.from({ length: 4000 }, (_, i) => `[${Math.floor(i / 2)}:${String(i % 2 ? '30' : '00')}] You: line number ${i} of the meeting.`);
  const text = lines.join('\n');
  assert.ok(text.length > R.TRANSCRIPT_CHUNK_CHARS, `the fixture is long (${text.length} chars)`);
  const chunks = R.chunkTranscript(text);
  assert.ok(chunks.length > 1, 'more than one ask');
  assert.ok(chunks.every((c) => c.length <= R.TRANSCRIPT_CHUNK_CHARS), 'each ask fits');
  assert.equal(chunks.join('\n'), text, 'together they are the whole transcript, line for line');
  assert.deepEqual(R.chunkTranscript('short'), ['short'], 'a short transcript goes as one');
  assert.deepEqual(R.chunkTranscript(''), [''], 'nothing stays nothing');
});

test('the ask’s time comes from the transcript’s length: a 25-minute meeting finishes', () => {
  const short = M.transcriptAskTimeoutMs('[0:00] You: Morning all.');
  const day = M.transcriptAskTimeoutMs('x'.repeat(30_000));
  const long = M.transcriptAskTimeoutMs('x'.repeat(600_000));
  assert.equal(short, 122_000, 'a short meeting: two minutes and a breath');
  assert.equal(day, 180_000, 'a 25-minute meeting has time to finish');
  assert.equal(long, 540_000, 'never past nine minutes: under the route’s ten');
});

test('the minutes asked in chunks when the transcript is long, and stopped when asked', async () => {
  const asks = [];
  const h = {};
  M.registerRecorder({
    handle: (ch, fn) => (h[ch] = fn),
    requireCreate: async () => {},
    askJson: async (system, user, timeout, max) => {
      asks.push({ user, timeout, max });
      const n = asks.length;
      return { reply: { present: [], absent: [], named: [], summary: `Part ${n} heard.`, figures: [], decisions: n === 1 ? [{ text: 'Ship the retry first', at: '1:00' }] : [{ text: 'Ship the retry first', at: '1:00' }, { text: 'Review receipts in April', at: '61:00' }], actions: [], open: [], topics: [] } };
    },
    platform: 'linux',
    dataDir: path.join(work, `data-chunks-${Math.random().toString(36).slice(2)}`),
    saveFile: async () => { throw new Error('not used'); },
  });
  const lines = Array.from({ length: 3000 }, (_, i) => `[${i}:00] You: line number ${i} of a long meeting about the cart retry.`);
  const out = await h['recorder:minutes']('Meetings/Long.md', { title: 'Long', date: '2026-11-05', transcript: lines.join('\n'), people: [] });
  assert.ok(asks.length > 1, `a long transcript is asked more than once (saw ${asks.length})`);
  assert.ok(asks.every((a) => a.user.length < 120_000), 'each ask fits its route');
  assert.ok(asks[0].user.includes('(part 1 of'), 'each ask knows its part');
  assert.deepEqual(out.minutes.decisions, ['Ship the retry first', 'Review receipts in April'], 'the parts come back as one, each point once');
  assert.equal(out.minutes.summary, asks.map((_, i) => `Part ${i + 1} heard.`).join(' '));
  // Stopped: the wait aborts and says so.
  const h2 = {};
  M.registerRecorder({
    handle: (ch, fn) => (h2[ch] = fn),
    requireCreate: async () => {},
    askJson: (system, user, timeout, max, opts) => new Promise((resolve) => opts?.signal?.addEventListener('abort', () => resolve({ reply: null, error: 'Stopped.' }))),
    platform: 'linux',
    dataDir: path.join(work, `data-stop-${Math.random().toString(36).slice(2)}`),
    saveFile: async () => { throw new Error('not used'); },
  });
  const p = h2['recorder:minutes']('Meetings/Long.md', { title: 'Long', date: '2026-11-05', transcript: '[0:00] hi', people: [] }, 'req-1');
  await new Promise((r) => setTimeout(r, 30));
  await h2['recorder:cancel']('req-1');
  assert.deepEqual(await p, { minutes: null, error: 'Stopped.' }, 'a stopped ask says it was stopped');
  assert.equal(await h2['recorder:cancel']('req-unknown'), undefined, 'stopping nothing is nothing');
});

test('a call on a headset that is not the default is told apart from what the recorder hears (6 Nov 2026, the lost far side)', () => {
  // The meeting (5 Nov 2026): Teams played through a headset while the recorder heard the default speakers. Calls
  // follow Windows' communications device; Chromium's loopback hears the default. When they differ, the far side is
  // lost — said at once, not after the meeting.
  const outs = (def, comm) => [{ deviceId: 'default', label: def }, { deviceId: 'communications', label: comm }];
  assert.deepEqual(
    R.unheardCall(outs('Default - Speakers (Realtek Audio)', 'Communications - Headset (WH-1000XM4)')),
    { heard: 'Speakers (Realtek Audio)', missed: 'Headset (WH-1000XM4)' },
    'the call plays where the recorder cannot hear',
  );
  // Same speakers under both names: the call is heard, nothing said.
  assert.equal(R.unheardCall(outs('Default - Speakers (Realtek Audio)', 'Communications - Speakers (Realtek Audio)')), null);
  assert.equal(R.unheardCall(outs('Default - Speakers', 'Communications - speakers')), null, 'casing is not a difference');
  assert.equal(R.unheardCall(outs('Default - Speakers (Realtek Audio)  ', '  Communications - Speakers (Realtek Audio)')), null, 'padding is not a difference');
  // One entry or none: a room, one pair of speakers, or labels hidden until the microphone is given — never an alarm.
  assert.equal(R.unheardCall([{ deviceId: 'default', label: 'Default - Speakers (Realtek Audio)' }]), null);
  assert.equal(R.unheardCall([{ deviceId: 'communications', label: 'Communications - Headset' }]), null);
  assert.equal(R.unheardCall([]), null);
  assert.equal(R.unheardCall(outs('', '')), null, 'no labels yet: nothing claimed');
  assert.equal(R.unheardCall(outs('Default - Speakers', '')), null);
  assert.equal(R.unheardCall([{ deviceId: 'default', label: '' }, { deviceId: 'communications', label: 'Communications - Headset' }]), null);
  // The named devices beside the two pseudo entries are never read: only 'default' and 'communications' decide.
  assert.equal(
    R.unheardCall([
      ...outs('Default - Speakers (Realtek Audio)', 'Communications - Speakers (Realtek Audio)'),
      { deviceId: 'f81c8b1e9d2a4f6b8c0d2e4a6c8e0a24', label: 'Headset (WH-1000XM4)' },
    ]),
    null,
  );
  assert.deepEqual(
    R.unheardCall([
      { deviceId: 'a91e4b7c0d3f4a6e9c1b5d7f0a2c4e6b8', label: 'Speakers (Realtek Audio)' },
      ...outs('Default - Speakers (Realtek Audio)', 'Communications - Headset (WH-1000XM4)'),
    ]),
    { heard: 'Speakers (Realtek Audio)', missed: 'Headset (WH-1000XM4)' },
    'the named entries do not hide a mismatch',
  );
});

test('a late piece aborts the host call, and its retry bills once (t259)', async () => {
  // A scripted slow provider: the first piece never answers (it bills only if it ever finishes); later ones do.
  let calls = 0;
  const signals = [];
  const bills = [];
  const transcribe = (audio, mime, hints, opts) => {
    calls++;
    signals.push(opts?.signal ?? null);
    if (calls === 1) return new Promise((_, reject) => opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
    bills.push(calls);
    return Promise.resolve({ text: 'Heard at last.' });
  };
  const { handlers } = mainSide({ extra: { transcribe, pieceTimeoutMs: 30 } });
  const late = await handlers['recorder:transcribe'](wav(), 'audio/wav');
  assert.equal(late.kind, 'offline');
  assert.match(late.error, /took too long/);
  assert.equal(signals.length, 1, 'the wait’s own signal rode to the host call');
  assert.equal(signals[0]?.aborted, true, 'the late piece aborted it: nothing keeps transcribing after the Vault moved on');
  assert.deepEqual(bills, [], 'the abandoned piece billed nothing');
  assert.deepEqual(await handlers['recorder:transcribe'](wav(), 'audio/wav'), { text: 'Heard at last.' }, 'the retry is heard');
  assert.deepEqual(bills, [2], 'the retry billed once: nothing twice');
});

test('the unheard call in one plain sentence with the way to fix it', () => {
  const words = R.unheardCallWords('Speakers (Realtek Audio)', 'Headset (WH-1000XM4)');
  assert.match(words, /Headset \(WH-1000XM4\)/, 'which speakers the call plays on');
  assert.match(words, /Speakers \(Realtek Audio\)/, 'which speakers are recorded');
  assert.match(words, /Windows’ default speaker \(Settings › System › Sound\)/, 'the way to fix it, in the meter’s words');
  assert.match(words, /other side/, 'whose words are at stake');
  assert.ok(!words.includes('—'), 'no em dash in new UI words');
  assert.ok(!/loopback|WASAPI|Chromium|deviceId/i.test(words), 'plain Australian English, no jargon');
});

test('the unheard call is a notice a person will see: at the start, on a device change, and when the far side stays silent', () => {
  const state = readFileSync(path.join(root, 'src/renderer/src/state/recorder.ts'), 'utf8');
  // At the start, once the PC's sound is recording (labels need the microphone first): the sentence joins the notices.
  assert.match(state, /listOutputs\(\)/, 'the speakers are listed as Chromium lists them');
  assert.match(state, /unheardCall\(/, 'start compares the default and communications speakers');
  assert.match(state, /unheardCallWords\(/, 'the sentence is the shared one');
  // A headset plugged in, unplugged or switched mid-meeting: checked again, spoken when it changes, cleared when sorted.
  assert.match(state, /routeChanged/, 'a device change re-checks the route');
  assert.match(state, /devicechange[\s\S]{0,400}routeChanged|routeChanged[\s\S]{0,400}devicechange/, 'the re-check runs on devicechange');
  // The far side silent past thirty seconds on an unheard route: the sentence stands in the notice, not only the meter.
  assert.match(state, /s\.routeWords && s\.pcQuiet >= PC_SILENT_SECONDS/, 'silence on an unheard route is noticed');
  assert.match(state, /notice: .*s\.routeWords|joinNotice\(liveExtra\.notice, s\.routeWords\)/, 'the notice carries it');
  // A meeting in a room keeps the meter only: silence with nothing amiss never becomes a warning or a notice.
  assert.doesNotMatch(state, /warning: 'pc-/, 'never a warning for the PC’s sound');
  assert.match(state, /pcSilent: !!s\.pc && s\.pcQuiet >= PC_SILENT_SECONDS/, 'the meter still says it');
  // The sentence stands beside the other notices: a full disk takes back only its own words, and writing down
  // picking up again leaves the standing sentence standing.
  assert.match(state, /dropNotice\(liveExtra\.notice, diskFullWords\(\)\)/, 'only the disk’s sentence goes');
  assert.match(state, /notice: session\?\.routeWords \?\? ''/, 'the pause lifting leaves the standing sentence');
});
