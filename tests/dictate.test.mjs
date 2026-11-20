// node --test tests/dictate.test.mjs — dictation heard by the former host app (8.6 voice, second pass, 30 Oct 2026,
// the ): a note, the side chat and quick capture hear through the former host app when inside it
// (src/shared/dictate.ts, src/main/dictation.ts: the same hearing as its message box — the person's provider, then
// this PC — with the chosen microphone, pre-roll and tail, words while speaking where the provider hears live, honest
// Hearing/Writing states otherwise), and keep Windows voice typing on their own. A private note keeps Windows voice
// typing exactly as today. The former host app is a stand-in: nothing here reaches it for real.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-dictate-'));
let D, M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/dictate.ts'), platform: 'node', output: { file: path.join(work, 'd.mjs'), format: 'esm' }, logLevel: 'silent' });
  await build({ input: path.join(root, 'src/main/dictation.ts'), platform: 'node', external: [/^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  D = await import(pathToFileURL(path.join(work, 'd.mjs')).href);
  M = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const step = (s, e) => D.dictateStep(s, e);
const level = (s, loud, at) => step(s, { type: 'level', level: loud, at });
const fxOf = (r) => r.effects.map((x) => x.type);

test('listening, hearing, writing, listening: a voice starts a turn, a pause sends it, the final words land', () => {
  const T = D.DICTATE_TUNING;
  let s = D.dictateInitial();
  assert.equal(s.phase, 'listening');
  s = level(s, 0.001, 0).state;
  s = level(s, 0.05, 100).state;
  assert.equal(s.phase, 'listening', 'one loud moment is not speech yet');
  let r = level(s, 0.05, 100 + T.startMs);
  assert.deepEqual([r.state.phase, fxOf(r)], ['hearing', ['startSegment']]);
  s = r.state;
  s = level(s, 0.03, 600).state;
  s = level(s, 0.001, 900).state;
  assert.equal(s.phase, 'hearing', 'a short pause does not end it');
  r = step(s, { type: 'partial', text: 'Book a meet' });
  assert.deepEqual([r.state.partial, r.effects], ['Book a meet', [{ type: 'show', text: 'Book a meet' }]], 'partial words show while speaking');
  s = r.state;
  r = level(s, 0.001, 600 + T.endSilenceMs);
  assert.deepEqual([r.state.phase, fxOf(r)], ['writing', ['endSegment']], 'a pause of the end time (the tail) sends the turn to be heard');
  s = r.state;
  assert.deepEqual(step(s, { type: 'partial', text: 'Book a meeting' }).effects, [{ type: 'show', text: 'Book a meeting' }], 'partials keep showing while it commits');
  r = step(s, { type: 'heard', text: '  Book a meeting.  ' });
  assert.deepEqual([r.state.phase, fxOf(r), r.state.partial], ['listening', ['land'], ''], 'the final words land and replace the partials');
  assert.deepEqual(step({ ...D.dictateInitial(), phase: 'writing' }, { type: 'heard', text: '  ' }), {
    state: { ...D.dictateInitial(), phase: 'listening' },
    effects: [{ type: 'note', note: 'Nothing was heard. Speak, then pause.' }],
  });
  assert.deepEqual(step(D.dictateInitial(), { type: 'partial', text: 'x' }).effects, [], 'partials before speech are ignored');
  assert.deepEqual(step(D.dictateInitial(), { type: 'heard', text: 'x' }).effects, [], 'words with no turn are ignored');
});

test('a cough is dropped, a failure listens again, stopping lets go of the microphone', () => {
  const T = D.DICTATE_TUNING;
  let s = D.dictateInitial();
  s = level(s, 0.05, 10000).state;
  s = level(s, 0.05, 10000 + T.startMs).state;
  const r = level(s, 0.001, 10000 + T.startMs + T.endSilenceMs);
  assert.deepEqual([r.state.phase, fxOf(r)], ['listening', ['discardSegment']], 'too short to be speech');
  s = step({ ...D.dictateInitial(), phase: 'hearing' }, { type: 'failed' }).state;
  assert.equal(s.phase, 'listening');
  const stopped = step({ ...D.dictateInitial(), phase: 'hearing' }, { type: 'stop' });
  assert.deepEqual([stopped.state.phase, fxOf(stopped)], ['ended', ['discardSegment', 'release']]);
  assert.deepEqual(step(stopped.state, { type: 'level', level: 1, at: 1e6 }).effects, [], 'after stopping nothing happens');
});

test('words join with a space, speech becomes base64 PCM, quiet speech is lifted but silence is left alone', () => {
  assert.deepEqual([D.dictateJoin('', 'Hello'), D.dictateJoin('Hello', 'there'), D.dictateJoin('Hello ', 'there'), D.dictateJoin('Hello', ''), D.dictateJoin('', '')], ['Hello', 'Hello there', 'Hello there', 'Hello', '']);
  const bytes = D.pcm16Of(Float32Array.from([0, 0.5, -0.5, 1, -1, 2]));
  const v = new DataView(bytes.buffer);
  assert.deepEqual([bytes.length, v.getInt16(0, true), v.getInt16(2, true), v.getInt16(4, true), v.getInt16(6, true), v.getInt16(8, true), v.getInt16(10, true)], [12, 0, 16383, -16384, 32767, -32768, 32767]);
  assert.equal(Buffer.from(D.b64Of(bytes), 'base64').equals(Buffer.from(bytes)), true);
  const quiet = D.boostSamples(Float32Array.from([0.001, -0.001, 0.0015]));
  assert.ok(Math.abs(quiet[0]) > 0.001, 'quiet speech lifted');
  const loud = D.boostSamples(Float32Array.from([0.5, -0.5]));
  assert.deepEqual([...loud], [0.5, -0.5], 'loud speech untouched');
  const silent = D.boostSamples(Float32Array.from([0.0001, -0.0001]));
  assert.deepEqual([...silent], [...Float32Array.from([0.0001, -0.0001])], 'silence never lifted into noise');
});

test('clean writing: fillers chosen away, punctuation and lists as meant, numbers and names right', () => {
  const clean = D.cleanDictation;
  assert.equal(clean('um meet Aroha Ngata at nine am, you know, please'), 'Meet Aroha Ngata at 9 am please.');
  assert.equal(clean('um meet Aroha Ngata at nine am, you know, please', { clean: false }), 'Um meet Aroha Ngata at 9 am, you know, please.', 'off keeps every word as said');
  assert.equal(clean('kia ora whanau new line tena koe'), 'Kia ora whānau.\nTēnā koe.', 'macrons right');
  assert.equal(clean('email me at aroha at example dot co dot nz full stop'), 'Email me at aroha@example.co.nz.');
  assert.equal(clean('first book flights comma second pack bags'), '- Book flights,\n- Pack bags');
  assert.equal(clean('meet tuesday no wednesday at two dollars and fifty cents'), 'Meet Wednesday at $2.50.');
  assert.equal(clean('twenty five people on friday in march'), '25 people on Friday in March.');
  assert.equal(clean('call bob jones', { vocabulary: ['Bob Jones'] }), 'Call Bob Jones.', 'names kept as written');
});

test('where dictation would be heard: the host app when it can hear, Windows voice typing when it cannot', async () => {
  assert.deepEqual(M.cleanDictationStatus({ ready: true, route: 'openai', live: 'openai' }), { ready: true, route: 'openai', live: 'openai' });
  assert.deepEqual(M.cleanDictationStatus({ ready: true, route: 'local', live: '' }), { ready: true, route: 'local', live: '' });
  assert.deepEqual(M.cleanDictationStatus({ ready: false, error: 'Set up Voice input.' }), { ready: false, route: '', live: '', words: 'Set up Voice input.' });
  assert.deepEqual(M.cleanDictationStatus({ ready: true, route: 'mars', live: 'mars' }), { ready: false, route: '', live: '' }, 'unknown routes are not heard');
  assert.deepEqual(M.cleanDictationStatus(null), { ready: false, route: '', live: '' });

  const none = M.dictationHandlers({ requireCreate: async () => undefined });
  assert.deepEqual(await none.status(), { hearing: 'windows', ready: false, route: '', live: '' }, 'on its own: Windows voice typing');
  const heard = M.dictationHandlers({ transcribe: async () => ({ text: 'x' }), transcribeStatus: async () => ({ ready: true, route: 'gemini', live: 'gemini' }), requireCreate: async () => undefined });
  assert.deepEqual(await heard.status(), { hearing: 'service', ready: true, route: 'gemini', live: 'gemini' });
  const bare = M.dictationHandlers({ transcribe: async () => ({ text: 'x' }), requireCreate: async () => undefined });
  assert.deepEqual(await bare.status(), { hearing: 'service', ready: true, route: '', live: '' }, 'no plan: heard, whole turns');
  const unready = M.dictationHandlers({ transcribe: async () => ({ text: 'x' }), transcribeStatus: async () => ({ ready: false, error: 'Set up Voice input in Extras.' }), requireCreate: async () => undefined });
  assert.deepEqual(await unready.status(), { hearing: 'windows', ready: false, route: '', live: '', words: 'Set up Voice input in Extras.' }, 'nothing set up there yet: the last resort, with why');
});

test('one turn written down: checked, heard by the host app, plain words when it fails', async () => {
  const heard = M.dictationHandlers({ transcribe: async () => ({ text: '  Kia ora.  ' }), requireCreate: async () => undefined });
  assert.deepEqual(await heard.hear(new Uint8Array(100), 'audio/wav'), { text: 'Kia ora.' });
  assert.deepEqual(await heard.hear(new Uint8Array(10), 'audio/wav'), { error: 'What was said didn’t arrive whole.' });
  assert.deepEqual(await heard.hear(new Uint8Array(M.MAX_DICTATION_BYTES + 1), 'audio/wav'), { error: 'That was too long to hear in one go. Say it in shorter parts.' });
  const missing = M.dictationHandlers({ requireCreate: async () => undefined });
  assert.deepEqual(await missing.hear(new Uint8Array(100), 'audio/wav'), { error: 'Add a transcription connection in Settings › AI to dictate this way. Nothing was lost: try again.' });
  const providerWords = M.dictationHandlers({ transcribe: async () => ({ error: 'Connect OpenAI in Settings.' }), requireCreate: async () => undefined });
  assert.deepEqual(await providerWords.hear(new Uint8Array(100), 'audio/wav'), { error: 'Connect OpenAI in Settings.' }, 'its own reason kept');
  const gated = M.dictationHandlers({ transcribe: async () => ({ text: 'x' }), requireCreate: async () => { throw new Error('Add the licence key in Settings.'); } });
  await assert.rejects(gated.hear(new Uint8Array(100), 'audio/wav'), /licence key/, 'changing notes needs the licence');
  const down = M.dictationHandlers({ transcribe: async () => { throw new Error('fetch failed'); }, requireCreate: async () => undefined });
  assert.deepEqual(await down.hear(new Uint8Array(100), 'audio/wav'), { error: 'The speech service couldn’t be reached to hear it. Try again in a moment.' });
});

test('a late turn aborts the host call, and its retry bills once (t260)', async () => {
  // A scripted slow provider: the first turn never answers (it bills only if it ever finishes); later ones do.
  let calls = 0;
  const signals = [];
  const bills = [];
  const transcribe = (audio, mime, opts) => {
    calls++;
    signals.push(opts?.signal ?? null);
    if (calls === 1) return new Promise((_, reject) => opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
    bills.push(calls);
    return Promise.resolve({ text: 'Heard at last.' });
  };
  const heard = M.dictationHandlers({ transcribe, requireCreate: async () => undefined, hearTimeoutMs: 30 });
  const late = await heard.hear(new Uint8Array(100), 'audio/wav');
  assert.deepEqual(late, { error: 'The speech service took too long to answer. Check the internet connection, then try again.' });
  assert.equal(signals.length, 1, 'the wait’s own signal rode to the host call');
  assert.equal(signals[0]?.aborted, true, 'the late turn aborted it: nothing keeps transcribing after the Vault moved on');
  assert.deepEqual(bills, [], 'the abandoned turn billed nothing');
  assert.deepEqual(await heard.hear(new Uint8Array(100), 'audio/wav'), { text: 'Heard at last.' }, 'the retry is heard');
  assert.deepEqual(bills, [2], 'the retry billed once: nothing twice');
});

test('live pieces: only dictation’s own ops, through the host app, cleaned on the way back', async () => {
  const calls = [];
  const live = M.dictationHandlers({ dictate: async (r) => { calls.push(r); return r.op === 'begin' ? { id: 's1', rate: 24000, provider: 'OpenAI' } : { partial: 'Book a ' }; }, requireCreate: async () => undefined });
  assert.deepEqual(await live.chunk({ op: 'shout' }), { error: 'That isn’t part of dictation.' });
  assert.deepEqual(await live.chunk({ op: 'chunk', id: 's1', audio: 'x'.repeat(91_000) }), { error: 'That piece of speech was too long.' });
  const begun = await live.chunk({ op: 'begin', route: 'openai', hear: 'auto', accent: 'en-AU', words: ['kaupapa'], injected: 'no' });
  assert.deepEqual(begun, { id: 's1', rate: 24000, provider: 'OpenAI' });
  assert.deepEqual(calls[0], { op: 'begin', route: 'openai', hear: 'auto', accent: 'en-AU', words: ['kaupapa'] }, 'only dictation’s own fields go');
  assert.deepEqual(await live.chunk({ op: 'chunk', id: 's1', audio: 'QUJD', last: false }), { partial: 'Book a ' });
  assert.deepEqual(await live.chunk({ op: 'end', id: 's1' }), {});
  const missing = M.dictationHandlers({ requireCreate: async () => undefined });
  assert.deepEqual(await missing.chunk({ op: 'begin', route: 'openai' }), { error: 'Live words aren’t available here. Nothing was lost: try again.' });
  const down = M.dictationHandlers({ dictate: async () => { throw new Error('fetch failed'); }, requireCreate: async () => undefined });
  assert.deepEqual(await down.chunk({ op: 'chunk', id: 's1', audio: 'QUJD' }), { error: 'The speech service couldn’t be reached for live words. Dictation carries on.' });
});

test('the microphone for dictation: our windows, the microphone alone, only once dictation starts', async () => {
  assert.equal(M.dictateMayHave('media', ['audio'], true), true);
  assert.equal(M.dictateMayHave('media', ['audio', 'video'], true), false, 'never the camera');
  assert.equal(M.dictateMayHave('media', [], true), false, 'never the PC’s sound');
  assert.equal(M.dictateMayHave('media', ['audio'], false), false, 'never another window');
  assert.equal(M.dictateMayHave('display-capture', undefined, true), false);
  let rule = null;
  const session = { setPermissionRequestHandler: (fn) => { rule = fn; } };
  M.allowDictationMic([{ id: 7, session }, { id: 9, session }], false);
  const ask = (id, permission, mediaTypes) => new Promise((resolve) => rule({ id }, permission, resolve, { mediaTypes }));
  assert.equal(await ask(7, 'media', ['audio']), true, 'the window dictating hears');
  assert.equal(await ask(9, 'media', ['audio']), true, 'the capture box too');
  assert.equal(await ask(7, 'media', ['video']), false);
  assert.equal(await ask(11, 'media', ['audio']), false, 'nobody else');
});

test('wired: the channels, the three microphones, the private-note rule, and no address but the host app', async () => {
  const app = readFileSync(path.join(root, 'src/main/app.ts'), 'utf8');
  const capture = readFileSync(path.join(root, 'src/main/capture.ts'), 'utf8');
  const preload = readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');
  const lib = readFileSync(path.join(root, 'src/renderer/src/lib/dictation.ts'), 'utf8');
  for (const channel of ['dictation:status', 'dictation:hear', 'dictation:chunk', 'dictation:prepare']) assert.ok(app.includes(`handle('${channel}'`), `the window’s ${channel}`);
  for (const channel of ['capture:dictate-status', 'capture:dictate-hear', 'capture:dictate-chunk', 'capture:dictate-prepare']) assert.ok(capture.includes(`handle('${channel}'`), `the box’s ${channel}`);
  assert.ok(app.includes('IronleafHost') && app.includes('dictate?(request'), 'the host offers live sessions');
  assert.ok(/dictation:\s*\{[\s\S]*status:[\s\S]*hear:[\s\S]*chunk:/.test(preload), 'the window reaches them');
  assert.ok(preload.includes('dictateStatus:') && preload.includes('dictateHear:') && preload.includes('dictateChunk:'), 'the box reaches its own');
  assert.ok(lib.includes('prefs().meetingMic') || lib.includes('meetingMic'), 'the microphone chosen');
  assert.ok(lib.includes('dictationClean'), 'clean-up per the setting');
  assert.ok(lib.includes('windowsOnly') && lib.includes('no new recipient'), 'a private note keeps Windows voice typing');
  assert.ok(!/https:\/\//.test(lib), 'audio goes only to the host app, never pasted to an address');
  const note = readFileSync(path.join(root, 'src/renderer/src/views/NoteView.tsx'), 'utf8');
  const chat = readFileSync(path.join(root, 'src/renderer/src/panels/ChatPanel.tsx'), 'utf8');
  const box = readFileSync(path.join(root, 'src/renderer/src/capture/CaptureBox.tsx'), 'utf8');
  assert.ok(note.includes('editorTarget(') && note.includes('dictate-words'), 'the note’s microphone dictates and says its state');
  assert.ok(chat.includes('fieldTarget(') && chat.includes('dictate-words'), 'the chat’s microphone dictates and says its state');
  assert.ok(box.includes('captureApi()') && box.includes('dictate('), 'quick capture dictates through the host app');
  const commands = readFileSync(path.join(root, 'src/renderer/src/state/commands.ts'), 'utf8');
  assert.ok(commands.includes("name: 'Dictate'"), 'the command is Dictate');
  const settings = readFileSync(path.join(root, 'src/renderer/src/components/Settings.tsx'), 'utf8');
});
