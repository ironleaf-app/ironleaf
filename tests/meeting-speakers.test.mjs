// node --test tests/meeting-speakers.test.mjs — telling the speakers apart (src/shared/meeting-speakers.ts; 6 Nov
// 2026). The engine's turns as an extra layer over the transcript's pieces (the microphone on a call untouched,
// imported names untouched, nothing when the engine says nothing); names kept apart from the lines with undo; the final
// pass carrying names without ever moving one silently; the minutes' never-guess rules; and the clustering both passes
// share (sides never join, named pairs never merge). A made-up bakery's meeting only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-meeting-speakers-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/meeting-speakers.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── Ids and plain words ──────────────────────────────────────────────────────

test('voices read "Speaker 1", and only whole labels read back', () => {
  assert.equal(S.speakerDisplay('spk1'), 'Speaker 1');
  assert.equal(S.speakerDisplay('spk10'), 'Speaker 10');
  assert.equal(S.parseSpeakerDisplay('Speaker 1'), 'spk1');
  assert.equal(S.parseSpeakerDisplay('speaker 10'), 'spk10');
  assert.equal(S.parseSpeakerDisplay('Speaker 1:'), null);
  assert.equal(S.parseSpeakerDisplay('Speakers 1'), null);
  assert.equal(S.parseSpeakerDisplay('You'), null);
  assert.equal(S.parseSpeakerDisplay('Others'), null);
  assert.equal(S.parseSpeakerDisplay('Sam Okafor'), null);
  assert.ok(S.isSpeakerDisplay('Speaker 2'));
  assert.ok(!S.isSpeakerDisplay('Speaker'));
});

test('the fallback says once, in plain words, that the transcript stays as today', () => {
  const words = S.speakersFallbackWords();
  assert.ok(words.includes('You and Others'), words);
  assert.ok(!/diaris|embed/i.test(words), words);
});

// ── The extra layer ──────────────────────────────────────────────────────────

const piece = (over) => ({ index: 0, start: 0, seconds: 20, status: 'done', text: 'hello there', ...over });

test('turns relabel splittable pieces and split timed segments by their moment', () => {
  const pieces = [piece({ side: 'pc', who: 'Others', segments: [{ start: 2, text: 'the flour' }, { start: 15, text: 'the yeast' }] })];
  const turns = [
    { id: 'spk1', start: 0, end: 10, side: 'pc' },
    { id: 'spk2', start: 10, end: 20, side: 'pc' },
  ];
  const r = S.labelPieces(pieces, turns, 'mic+pc');
  assert.ok(r && r.changed);
  assert.equal(r.pieces[0].who, 'Speaker 1');
  assert.equal(r.pieces[0].segments[0].speaker, 'Speaker 1');
  assert.equal(r.pieces[0].segments[1].speaker, 'Speaker 2');
  assert.deepEqual(
    r.marks.map((m) => m.id),
    ['spk1', 'spk2'],
  );
  assert.equal(r.marks[0].clipAt, 0);
});

test('the microphone on a call is never relabelled, whatever the turns say', () => {
  const pieces = [piece({ side: 'mic', who: 'You' }), piece({ index: 1, start: 20, seconds: 20, side: 'pc', who: 'Others' })];
  const turns = [{ id: 'spk1', start: 0, end: 40, side: 'mix' }];
  const r = S.labelPieces(pieces, turns, 'mic+pc');
  assert.ok(r);
  assert.equal(r.pieces[0].who, 'You');
  assert.equal(r.pieces[1].who, 'Speaker 1');
});

test('in a room every side is numbered, and imported names stay as they are', () => {
  const pieces = [piece({ who: 'Others' }), piece({ index: 1, start: 20, seconds: 20, who: 'Sam Okafor' })];
  const turns = [{ id: 'spk1', start: 0, end: 40, side: 'mix' }];
  const r = S.labelPieces(pieces, turns, 'mic');
  assert.ok(r);
  assert.equal(r.pieces[0].who, 'Speaker 1');
  assert.equal(r.pieces[1].who, 'Sam Okafor');
});

test('no turns touching a piece leaves the transcript exactly as today', () => {
  const pieces = [piece({ side: 'mic', who: 'You' })];
  assert.equal(S.labelPieces(pieces, [{ id: 'spk1', start: 100, end: 110, side: 'pc' }], 'mic+pc'), null);
  assert.equal(S.labelPieces(pieces, [], 'mic'), null);
  assert.equal(S.labelPieces(pieces, [{ id: 'nope', start: 0, end: 5, side: 'mix' }], 'mic'), null);
});

// A real take's shape (6 Nov 2026, e1-speaker-turns): the speech services give a piece's words with no times at
// all, so a twenty-second piece holding four short turns took one label for the lot and 13 of 31 lines sat under
// the wrong voice, while the engine's own turns had every line right. An untimed piece splits its sentences at
// the voice changes (each voice's share of the heard seconds), so each person's words sit on their own line.
test('an untimed piece splits its sentences at the voice changes', () => {
  const text = "I'll ring them. And I'll chase the stone top for Thursday morning as well. And council? They can do the final inspection in the week of the sixteenth. Can you book it for Tuesday the seventeenth at ten? Yep, I'll book it.";
  const pieces = [piece({ start: 38, seconds: 19, text })];
  const turns = [
    { id: 'spk2', start: 38.2, end: 44.0, side: 'mix' },
    { id: 'spk1', start: 44.7, end: 46.1, side: 'mix' },
    { id: 'spk2', start: 46.8, end: 53.8, side: 'mix' },
    { id: 'spk1', start: 54.5, end: 57.0, side: 'mix' },
  ];
  const r = S.labelPieces(pieces, turns, 'mic');
  assert.ok(r && r.changed);
  const segs = r.pieces[0].segments ?? [];
  assert.deepEqual(segs.map((s) => s.speaker), ['Speaker 2', 'Speaker 1', 'Speaker 2', 'Speaker 1'], JSON.stringify(segs));
  assert.equal(segs.map((s) => s.text).join(' '), text, 'no word lost, none twice');
  assert.match(segs[0].text, /stone top/);
  assert.equal(segs[1].text, 'And council?');
  assert.match(segs[3].text, /book it/);
  assert.ok(segs.every((s, i) => i === 0 || s.start > segs[i - 1].start), 'each line keeps its own moment, in order');
  assert.equal(r.pieces[0].who, 'Speaker 2', 'the piece itself keeps its majority voice');
  assert.equal(S.labelPieces(r.pieces, turns, 'mic'), null, 'the split settles: re-running changes nothing');
  // Better turns later (the final pass over live labels) may move the split: the words are whole again first.
  const settled = S.labelPieces(r.pieces, [
    { id: 'spk2', start: 38.2, end: 53.8, side: 'mix' },
    { id: 'spk1', start: 54.5, end: 57.0, side: 'mix' },
  ], 'mic');
  assert.ok(settled && settled.changed);
  assert.deepEqual((settled.pieces[0].segments ?? []).map((s) => s.speaker), ['Speaker 2', 'Speaker 1']);
  assert.equal((settled.pieces[0].segments ?? []).map((s) => s.text).join(' '), text);
});

test('an untimed piece with no sentence ends splits its words by each voice’s share, and a flicker never splits', () => {
  const text = 'can you ring the joiners today and confirm the first delivery in writing yep I will ring them today';
  const pieces = [piece({ start: 155, seconds: 9, text })];
  const turns = [
    { id: 'spk1', start: 155.2, end: 159.8, side: 'mix' },
    { id: 'spk2', start: 160.4, end: 162.9, side: 'mix' },
  ];
  const r = S.labelPieces(pieces, turns, 'mic');
  assert.ok(r && r.changed);
  const segs = r.pieces[0].segments ?? [];
  assert.deepEqual(segs.map((s) => s.speaker), ['Speaker 1', 'Speaker 2'], JSON.stringify(segs));
  assert.equal(segs.map((s) => s.text).join(' '), text);
  assert.match(segs[1].text, /ring them today$/);
  // A third of a second heard as another voice (a cough, a flicker) never cuts a line in two.
  const flicker = S.labelPieces([piece({ start: 0, seconds: 20, text: 'one voice the whole way through this piece' })], [
    { id: 'spk1', start: 0, end: 9, side: 'mix' },
    { id: 'spk2', start: 9, end: 9.3, side: 'mix' },
    { id: 'spk1', start: 9.3, end: 20, side: 'mix' },
  ], 'mic');
  assert.ok(flicker);
  assert.equal(flicker.pieces[0].segments, undefined, JSON.stringify(flicker.pieces[0].segments));
  assert.equal(flicker.pieces[0].who, 'Speaker 1');
});

test('re-running over labelled pieces changes nothing, so a piece landing refires no saves', () => {
  const pieces = [piece({ side: 'pc', who: 'Others', segments: [{ start: 2, text: 'the flour' }] })];
  const turns = [{ id: 'spk1', start: 0, end: 20, side: 'pc' }];
  const once = S.labelPieces(pieces, turns, 'mic+pc');
  assert.ok(once && once.changed);
  assert.equal(once.pieces[0].who, 'Speaker 1');
  assert.equal(S.labelPieces(once.pieces, turns, 'mic+pc'), null);
});

// ── Names ────────────────────────────────────────────────────────────────────

test('names are cleaned, labels refused, and odd characters cannot link', () => {
  assert.equal(S.speakerNameRefused(''), 'Type a name first.');
  assert.ok(S.speakerNameRefused('You'));
  assert.ok(S.speakerNameRefused('Speaker 3'));
  assert.equal(S.speakerNameRefused('Sam Okafor'), null);
  assert.deepEqual(S.setSpeakerName({}, 'spk1', '  Sam\nOkafor  '), { spk1: 'Sam Okafor' });
  assert.deepEqual(S.setSpeakerName({}, 'spk1', '[[Sam]]'), { spk1: 'Sam' });
  assert.deepEqual(S.setSpeakerName({ spk1: 'Sam' }, 'spk1', 'You'), { spk1: 'Sam' });
  assert.deepEqual(S.setSpeakerName({ spk1: 'Sam' }, 'nope', 'Jo'), { spk1: 'Sam' });
  assert.deepEqual(S.clearSpeakerName({ spk1: 'Sam' }, 'spk1'), {});
});

test('two voices may share a name, and the sharers are known', () => {
  const names = S.setSpeakerName(S.setSpeakerName({}, 'spk1', 'Sam'), 'spk2', 'Sam');
  assert.deepEqual(names, { spk1: 'Sam', spk2: 'Sam' });
  assert.deepEqual(S.speakersSharingName(names), ['spk2']);
  assert.deepEqual(S.speakersSharingName({ spk1: 'Sam' }), []);
});

test('shown lines take names without changing the lines', () => {
  const lines = [
    { at: 0, text: 'hello', who: 'Speaker 1' },
    { at: 5, text: 'hi', who: 'Speaker 2' },
    { at: 9, text: 'me', who: 'You' },
  ];
  const shown = S.shownLines(lines, { spk1: 'Sam Okafor' });
  assert.equal(shown[0].who, 'Sam Okafor');
  assert.equal(shown[1].who, 'Speaker 2');
  assert.equal(shown[2].who, 'You');
  assert.equal(lines[0].who, 'Speaker 1');
});

test('suggestions put the meeting’s people first, each once', () => {
  assert.deepEqual(S.speakerSuggestions(['Priya Natarajan', 'Sam'], ['Sam Okafor', 'Sam', 'Jo Tran']), ['Priya Natarajan', 'Sam', 'Sam Okafor', 'Jo Tran']);
});

// ── Undo ─────────────────────────────────────────────────────────────────────

test('naming undoes step by step and keeps the last fifty', () => {
  let past = [];
  past = S.pushSpeakerPast(past, { names: {}, marks: [] });
  past = S.pushSpeakerPast(past, { names: {}, marks: [] });
  assert.equal(past.length, 1);
  past = S.pushSpeakerPast(past, { names: { spk1: 'Sam' }, marks: [] });
  const undone = S.undoSpeakerPast(past);
  assert.deepEqual(undone.step, { names: { spk1: 'Sam' }, marks: [] });
  assert.equal(undone.past.length, 1);
  assert.equal(S.undoSpeakerPast([]), null);
  let long = [];
  for (let i = 0; i < 60; i++) long = S.pushSpeakerPast(long, { names: { [`spk${i}`]: 'x' }, marks: [] });
  assert.equal(long.length, 50);
});

// ── Keeping names in the note ────────────────────────────────────────────────

const NOTE = '---\ntype: meeting\ndate: 2026-11-06\n---\n# Supplier call\n\n## Transcript\n';

test('names survive in the note’s properties, per part, and junk reads as none', () => {
  assert.equal(S.speakerPartKey(0), 'Part 1', 'the first part keeps a real key, never an empty one');
  assert.equal(S.speakerPartKey(0, 'Part 2 · 14.05'), 'Part 2 · 14.05', 'a heading wins when there is one');
  assert.equal(S.speakerPartKey(2), 'Part 3');
  const withNames = S.writeSpeakerNames(NOTE, 'Part 1', { spk1: 'Sam Okafor' });
  assert.ok(!/^\s*"":\s*$/m.test(withNames), 'no empty key written');
  assert.deepEqual(S.readSpeakerNames(withNames, 'Part 1'), { spk1: 'Sam Okafor' });
  assert.deepEqual(S.readSpeakerNames(withNames, 'Part 2 · 14.05'), {});
  const two = S.writeSpeakerNames(withNames, 'Part 2 · 14.05', { spk1: 'Priya' });
  assert.deepEqual(S.readSpeakerNames(two, 'Part 1'), { spk1: 'Sam Okafor' });
  assert.deepEqual(S.readSpeakerNames(two, 'Part 2 · 14.05'), { spk1: 'Priya' });
  const cleared = S.writeSpeakerNames(two, 'Part 1', {});
  assert.deepEqual(S.readSpeakerNames(cleared, 'Part 1'), {});
  assert.deepEqual(S.readSpeakerNames(cleared, 'Part 2 · 14.05'), { spk1: 'Priya' });
  assert.deepEqual(S.readSpeakerNames(NOTE, 'Part 1'), {});
  assert.deepEqual(S.readSpeakerNames('---\nspeakers: [junk]\n---\n# x\n', 'Part 1'), {});
  assert.deepEqual(S.readSpeakerNames('---\nspeakers:\n  "":\n    spk1: You\n---\n# x\n', 'Part 1'), {});
  // A first part kept under "" before 12 Nov 2026 still reads, and moves on the next write.
  const legacy = '---\ntype: meeting\nneuralvault-speaker-names:\n  "":\n    spk1: Sam Okafor\n---\n# Call\n';
  assert.deepEqual(S.readSpeakerNames(legacy, 'Part 1'), { spk1: 'Sam Okafor' });
  const moved = S.writeSpeakerNames(legacy, 'Part 2 · 14.05', { spk1: 'Priya' });
  assert.ok(!/^\s*"":\s*$/m.test(moved), 'the empty key moved');
  assert.deepEqual(S.readSpeakerNames(moved, 'Part 1'), { spk1: 'Sam Okafor' });
  assert.deepEqual(S.readSpeakerNames(moved, 'Part 2 · 14.05'), { spk1: 'Priya' });
});

test('a re-recorded part’s old names go with it, other parts’ stay', () => {
  const note = ['---', 'type: meeting', 'speakers:', '  "":', '    spk1: Sam', '  "Part 2 · 13.02":', '    spk1: Old', '---', '# Call', ''].join('\n');
  const pruned = S.pruneSpeakerNames(note, ['Part 1', 'Part 2 · 14.05']);
  assert.deepEqual(S.readSpeakerNames(pruned, 'Part 1'), { spk1: 'Sam' });
  assert.deepEqual(S.readSpeakerNames(pruned, 'Part 2 · 13.02'), {});
  assert.deepEqual(S.readSpeakerNames(pruned, 'Part 2 · 14.05'), {});
  assert.ok(!/^\s*"":\s*$/m.test(pruned), 'the empty key moved to Part 1 rather than going with it');
  const kept = S.pruneSpeakerNames(note, ['Part 1', 'Part 2 · 13.02']);
  assert.deepEqual(S.readSpeakerNames(kept, 'Part 1'), { spk1: 'Sam' });
  assert.deepEqual(S.readSpeakerNames(kept, 'Part 2 · 13.02'), { spk1: 'Old' });
});

test('a person’s own speakers property is never ours to overwrite, in any shape (break-it 1)', () => {
  assert.equal(S.SPEAKERS_PROP, 'neuralvault-speaker-names', 'our key is one nobody would type');
  for (const own of ['speakers: Jo and Sam from the council', 'speakers: [Jo Tran, Sam Lee]', 'speakers:\n  chair: Jo Tran']) {
    const note = `---\ntype: meeting\n${own}\n---\n# Call\n`;
    const out = S.writeSpeakerNames(note, 'Part 1', { spk1: 'Alex Rivera' });
    assert.ok(out.includes(own.split('\n')[0]), `their speakers stay: ${out}`);
    assert.ok(out.includes('neuralvault-speaker-names:'), out);
    assert.ok(!/^\s*"":\s*$/m.test(out), 'no empty key written');
    assert.deepEqual(S.readSpeakerNames(out, 'Part 1'), { spk1: 'Alex Rivera' });
    const cleared = S.writeSpeakerNames(out, 'Part 1', {});
    assert.ok(cleared.includes(own.split('\n')[0]), 'still there after our names go');
    assert.ok(!cleared.includes('neuralvault-speaker-names:'), cleared);
  }
});

test('the old nested speakers map reads once and moves to our key on write (break-it 1)', () => {
  const old = '---\ntype: meeting\nspeakers:\n  "":\n    spk1: Sam\n  "Part 2 · 14.05":\n    spk1: Priya\n---\n# Call\n';
  assert.deepEqual(S.readSpeakerNames(old, ''), { spk1: 'Sam' }, 'the never-shipped shape still reads');
  assert.deepEqual(S.readSpeakerNames(old, 'Part 1'), { spk1: 'Sam' }, 'its first part reads under Part 1 too');
  const moved = S.writeSpeakerNames(old, 'Part 1', { spk1: 'Sam' });
  assert.ok(moved.includes('neuralvault-speaker-names:'), moved);
  assert.ok(!/^speakers:/m.test(moved), 'our old key goes once its names move');
  assert.ok(!/^\s*"":\s*$/m.test(moved), 'no empty key written');
  assert.deepEqual(S.readSpeakerNames(moved, 'Part 1'), { spk1: 'Sam' });
  assert.deepEqual(S.readSpeakerNames(moved, 'Part 2 · 14.05'), { spk1: 'Priya' }, 'other parts move too');
});

test('a name that cannot be saved says so in plain words and changes nothing (break-it 6)', () => {
  for (const bad of ['---\ntitle: [unclosed\n---\n# Call\n', '---\ntitle: Kitchen reno: Jo’s "final" list\n---\n# Call\n']) {
    const r = S.tryWriteSpeakerNames(bad, '', { spk1: 'Alex Rivera' });
    assert.equal(r.saved, false, bad);
    assert.equal(r.text, bad, 'the note is left exactly as it was');
    assert.ok(/properties/i.test(r.words) && /couldn’t be saved/i.test(r.words), r.words);
  }
  const ok = S.tryWriteSpeakerNames(NOTE, 'Part 1', { spk1: 'Alex Rivera' });
  assert.equal(ok.saved, true);
  assert.deepEqual(S.readSpeakerNames(ok.text, 'Part 1'), { spk1: 'Alex Rivera' });
});

test('the reading door renames only our labels and our sections, never a person’s own words (break-it 11)', () => {
  const note = S.writeSpeakerNames('---\ntype: meeting\ntitle: "Speaker 1 setup"\n---\n# Speaker 1 setup for the hall\n\nI bought a Speaker 1 for the hall.\n\n## Summary\n\nSpeaker 1 settled the date.\n\n## My notes\n\nSpeaker 1 is on the shelf.\n\n## Transcript\n\n> [!quote]- Transcript · 1 minute\n> **0:00** *Speaker 1:* I said Speaker 1 out loud.\n', '', { spk1: 'Alex Rivera' });
  const shown = S.withSpeakerNames(note);
  assert.ok(shown.includes('# Speaker 1 setup for the hall'), shown);
  assert.ok(shown.includes('I bought a Speaker 1 for the hall.'), shown);
  assert.ok(!shown.includes('Alex Rivera setup'), 'the title property and heading keep their words');
  assert.ok(shown.includes('Alex Rivera settled the date.'), 'our Summary takes the name');
  assert.ok(shown.includes('Speaker 1 is on the shelf.'), 'their own section keeps their words');
  assert.ok(shown.includes('*Alex Rivera:* I said Speaker 1 out loud.'), 'label renamed, spoken words kept');
});

test('an older version sees the lines and its own properties, never the names', () => {
  const withNames = S.writeSpeakerNames(NOTE, '', { spk1: 'Sam Okafor' });
  assert.ok(withNames.includes('## Transcript'), 'the transcript is untouched');
  assert.ok(withNames.includes('type: meeting'), 'its own properties untouched');
});

// ── The final pass ───────────────────────────────────────────────────────────

test('voices carrying different names are never merged', () => {
  assert.deepEqual(S.nameConstraints({ spk1: 'Sam', spk2: 'Priya', spk3: 'sam' }), [['spk1', 'spk2'], ['spk2', 'spk3']]);
  assert.deepEqual(S.nameConstraints({}), []);
});

test('settled voices carry names by overlap, same side only, splits staying on the longest', () => {
  const live = [
    { id: 'spk1', start: 0, end: 20, side: 'pc' },
    { id: 'spk2', start: 20, end: 40, side: 'pc' },
  ];
  const settled = [
    { id: 'spk1', start: 0, end: 20, side: 'pc' },
    { id: 'spk2', start: 20, end: 30, side: 'pc' },
    { id: 'spk3', start: 30, end: 40, side: 'pc' },
  ];
  const r = S.carrySpeakerNames(live, settled, { spk1: 'Sam', spk2: 'Priya' });
  assert.equal(r.names.spk1, 'Sam');
  assert.ok(r.names.spk2 === 'Priya' || r.names.spk3 === 'Priya', JSON.stringify(r.names));
  assert.equal(Object.values(r.names).filter((n) => n === 'Priya').length, 1);
  assert.equal(r.lost.length, 1);
  assert.ok(S.speakersSettledWords(r.lost).includes('unnamed again'));
  assert.equal(S.speakersSettledWords([]), '');
  // Another side never lends its name.
  const cross = S.carrySpeakerNames(live, [{ id: 'spk1', start: 0, end: 20, side: 'mic' }], { spk1: 'Sam' });
  assert.deepEqual(cross.names, {});
});

test('a name the settled turns never touch, and the loser when two voices settle into one, are named as lost (break-it 4)', () => {
  // Named live over 0-60s; the final listen settles that voice onto different seconds.
  const gone = S.carrySpeakerNames([{ id: 'spk1', start: 0, end: 60, side: 'pc' }], [{ id: 'spk1', start: 600, end: 660, side: 'pc' }], { spk1: 'Alex Rivera' });
  assert.deepEqual(gone.names, {});
  assert.deepEqual(gone.lost, ['spk1'], 'the notice can name the voice that lost its name');
  assert.ok(S.speakersSettledWords(gone.lost).includes('Speaker 1'));
  assert.ok(S.speakersSettledWords(gone.lost).includes('unnamed again'));
  // Two named voices settle into one: the longest overlap keeps its name, the other is named as lost, never silent.
  const live = [
    { id: 'spk1', start: 0, end: 50, side: 'pc' },
    { id: 'spk2', start: 50, end: 60, side: 'pc' },
  ];
  const joined = S.carrySpeakerNames(live, [{ id: 'spk1', start: 0, end: 60, side: 'pc' }], { spk1: 'Alex Rivera', spk2: 'Kate Sullivan' });
  assert.equal(joined.names.spk1, 'Alex Rivera');
  assert.deepEqual(joined.lost, ['spk2']);
  // A name carried whole is never reported lost.
  const kept = S.carrySpeakerNames(live, live, { spk1: 'Alex Rivera', spk2: 'Kate Sullivan' });
  assert.deepEqual(kept.lost, []);
});

// ── Minutes, actions and the PDF ─────────────────────────────────────────────

const MARKS = [
  { id: 'spk1', side: 'pc', clipAt: 0, clipLen: 6 },
  { id: 'spk2', side: 'pc', clipAt: 30, clipLen: 6 },
];

test('the write-up is told each voice and never to guess', () => {
  const add = S.speakersPromptAddition(MARKS, { spk1: 'Sam Okafor' });
  assert.ok(add.includes('Speaker 1 is Sam Okafor.'), add);
  assert.ok(add.includes('Speaker 2 (not named).'), add);
  assert.ok(/never invent a name/i.test(add), add);
  // Changed 6 Nov 2026 (owners the way people talk): an unnamed voice's job can still be owned from the words
  // (addressed by name, a clear agreement); "who" stays empty only where the words do not show who.
  assert.ok(/leave "who" empty/i.test(add), add);
  assert.ok(/addressed by name/i.test(add), add);
  assert.equal(S.speakersPromptAddition([], {}), '');
});

test('voices rebuild from a part’s own labels, first heard first', () => {
  const marks = S.marksFromLines(
    [
      { at: 30, text: 'b', who: 'Speaker 2' },
      { at: 0, text: 'a', who: 'Speaker 1' },
      { at: 9, text: 'me', who: 'You' },
    ],
    'mix',
  );
  assert.deepEqual(
    marks.map((m) => [m.id, m.clipAt]),
    [
      ['spk1', 0],
      ['spk2', 30],
    ],
  );
  assert.deepEqual(S.marksFromLines([{ at: 0, text: 'a', who: 'Others' }], 'mix'), []);
});

test('several recordings’ voices are told under their own headings', () => {
  assert.equal(S.speakersPromptForParts([]), '');
  const one = S.speakersPromptForParts([{ marks: [{ id: 'spk1', side: 'pc', clipAt: 0, clipLen: 6 }], names: { spk1: 'Sam' } }]);
  assert.ok(one.includes('Speaker 1 is Sam.'));
  const two = S.speakersPromptForParts([
    { marks: [{ id: 'spk1', side: 'pc', clipAt: 0, clipLen: 6 }], names: { spk1: 'Sam' } },
    { heading: 'Part 2 · 14.05', marks: [{ id: 'spk1', side: 'pc', clipAt: 0, clipLen: 6 }], names: {} },
  ]);
  assert.ok(two.includes('each recording separately'));
  assert.ok(two.includes('In Part 2 · 14.05:'));
  assert.ok(two.includes('Speaker 1 (not named).'));
});

test('an action’s owner is the name or nobody, never a guess', () => {
  assert.equal(S.actionOwnerFor('Speaker 1', { spk1: 'Sam Okafor' }), 'Sam Okafor');
  assert.equal(S.actionOwnerFor('Speaker 2', { spk1: 'Sam Okafor' }), '');
  assert.equal(S.actionOwnerFor('You', {}), '');
  assert.equal(S.actionOwnerFor('Others', {}), '');
  assert.equal(S.actionOwnerFor('Sam Okafor', {}), 'Sam Okafor');
  assert.equal(S.actionOwnerFor(undefined, {}), '');
});

test('two voices join by hand: every line and the name move, and junk joins nothing', () => {
  const pieces = [
    piece({ side: 'pc', who: 'Speaker 1' }),
    piece({ index: 1, start: 20, seconds: 20, side: 'pc', who: 'Speaker 2', segments: [{ start: 1, text: 'yes', speaker: 'Speaker 2' }] }),
    piece({ index: 2, start: 40, seconds: 20, side: 'mic', who: 'You' }),
  ];
  const joined = S.mergeVoicePieces(pieces, 'spk2', 'spk1');
  assert.equal(joined[0].who, 'Speaker 1');
  assert.equal(joined[1].who, 'Speaker 1');
  assert.equal(joined[1].segments[0].speaker, 'Speaker 1');
  assert.equal(joined[2].who, 'You');
  assert.deepEqual(S.mergeVoiceNames({ spk2: 'Sam' }, 'spk2', 'spk1'), { spk1: 'Sam' });
  assert.deepEqual(S.mergeVoiceNames({ spk1: 'Sam', spk2: 'Priya' }, 'spk2', 'spk1'), { spk1: 'Sam' });
  assert.deepEqual(S.mergeVoiceNames({}, 'spk2', 'spk1'), {});
  assert.equal(S.mergeVoicePieces(pieces, 'spk1', 'spk1').length, 3);
  assert.ok(S.mergeVoiceWords('spk2', 'spk1', 'Sam').includes('Sam'));
});

test('live turns rebuild from the pieces’ own labels, in time order', () => {
  const turns = S.liveTurnsFromPieces(
    [
      piece({ index: 1, start: 20, seconds: 20, side: 'pc', who: 'Speaker 2' }),
      piece({ side: 'pc', who: 'Speaker 1' }),
      piece({ index: 2, start: 40, seconds: 20, side: 'mic', who: 'You' }),
    ],
    'pc',
  );
  assert.deepEqual(
    turns.map((t) => t.id),
    ['spk1', 'spk2'],
  );
  assert.equal(turns[0].end, 20);
  assert.equal(turns[1].side, 'pc');
});

test('turns from labelled lines: runs of one voice with their moments', () => {
  const turns = S.turnsFromLines(
    [
      { at: 20, text: 'b', who: 'Speaker 1' },
      { at: 0, text: 'a', who: 'Speaker 1' },
      { at: 9, text: 'me', who: 'You' },
      { at: 12, text: 'c', who: 'Speaker 2' },
    ],
    'mix',
  );
  assert.deepEqual(
    turns.map((t) => [t.id, t.start, t.end]),
    [
      ['spk1', 0, 9],
      ['spk2', 12, 20],
      ['spk1', 20, 30],
    ],
  );
});

test('imported names pass the name layer through untouched', () => {
  assert.equal(S.shownWho('Sam Okafor', { spk1: 'Priya' }), 'Sam Okafor');
  assert.equal(S.actionOwnerFor('Priya Natarajan', { spk1: 'Sam' }), 'Priya Natarajan');
});

test('a voice’s clip stays inside the recording', () => {
  assert.deepEqual(S.clipRange({ clipAt: 30, clipLen: 6 }, 120), { at: 30, len: 6 });
  assert.deepEqual(S.clipRange({ clipAt: 200, clipLen: 6 }, 120).at <= 120, true);
  assert.deepEqual(S.clipRange({ clipAt: -5, clipLen: 6 }, 120).at, 0);
});

// ── Clustering ───────────────────────────────────────────────────────────────

const v = (xs) => Float32Array.from(xs);
const A1 = v([1, 0.1, 0]);
const A2 = v([0.95, 0.12, 0.02]);
const B1 = v([0, 1, 0.1]);
const B2 = v([0.02, 0.95, 0.12]);

test('prints join while alike, and like with like', () => {
  assert.deepEqual(S.clusterVoices([]), []);
  assert.deepEqual(S.clusterVoices([A1]), [0]);
  assert.deepEqual(S.clusterVoices([A1, A2, B1, B2], { threshold: 0.55 }), [0, 0, 1, 1]);
  assert.deepEqual(S.clusterVoices([A1, B1], { threshold: 0.99 }), [0, 1]);
  assert.deepEqual(S.clusterVoices([A1, B1], { threshold: -1 }), [0, 0]);
});

test('voices from the two sides never join, however alike', () => {
  const sides = ['mic', 'mic', 'pc', 'pc'];
  assert.deepEqual(S.clusterVoices([A1, A1, A1, A1], { threshold: -1, sides }), [0, 0, 1, 1]);
  assert.deepEqual(S.clusterVoices([A1, A1], { threshold: -1, sides: ['mix', 'pc'] }), [0, 0]);
});

test('forbidden pairs never merge, and the cap joins the likest', () => {
  assert.deepEqual(S.clusterVoices([A1, A1], { threshold: -1, forbid: [[0, 1]] }), [0, 1]);
  assert.deepEqual(S.clusterVoices([A1, A2, B1, B2], { threshold: 0.99, cap: 2 }), [0, 0, 1, 1]);
  // Deterministic: shuffled prints give the same voices by content.
  const fwd = S.clusterVoices([A1, A2, B1, B2]);
  const rev = S.clusterVoices([B2, B1, A2, A1]);
  assert.equal(fwd[0] === fwd[1] && fwd[2] === fwd[3] && fwd[0] !== fwd[2], true);
  assert.equal(rev[0] === rev[1] && rev[2] === rev[3] && rev[0] !== rev[2], true);
});

test('past the sample the rest take their likest voice, alike with alike', () => {
  // 700 prints alternating two sounds: the join samples 600 and assigns 100, all alike together.
  const prints = [];
  for (let i = 0; i < 700; i++) prints.push(i % 2 ? B1 : A1);
  const out = S.clusterVoices(prints, { threshold: 0.55 });
  assert.equal(new Set(out).size, 2);
  assert.ok(out.every((c, i) => c === out[i % 2]), 'every A with the As, every B with the Bs');
  assert.deepEqual(S.clusterVoices(prints, { threshold: 0.55 }), out, 'the same sounds give the same voices');
});

test('forbidden pairs hold across many joins, not just the first', () => {
  // Eight identical prints joining down: the barred ends never land together, however the indices shift.
  const out = S.clusterVoices(Array.from({ length: 8 }, () => A1), { threshold: -1, forbid: [[0, 7]] });
  assert.equal(new Set(out).size, 2);
  assert.notEqual(out[0], out[7]);
});

test('the sampled rest hold the sides and the forbidden pairs', () => {
  const prints = Array.from({ length: 700 }, () => A1);
  const sides = prints.map((_, i) => (i < 350 ? 'mic' : 'pc'));
  const split = S.clusterVoices(prints, { threshold: -1, sides });
  assert.equal(new Set(split).size, 2);
  assert.ok(split.slice(0, 350).every((c) => c === split[0]) && split.slice(350).every((c) => c === split[350]));
  assert.notEqual(split[0], split[350]);
  // Prints 1 and 3 both fall outside the even sample: their bar still keeps them apart.
  const barred = S.clusterVoices(prints, { threshold: -1, forbid: [[1, 3]] });
  assert.notEqual(barred[1], barred[3]);
});

test('live voices join the likest, start new ones, and hold the sides', () => {
  const live = new S.LiveVoices(0.55, 8);
  assert.equal(live.note(A1, 'pc'), 0);
  assert.equal(live.note(A2, 'pc'), 0);
  assert.equal(live.note(B1, 'pc'), 1);
  assert.equal(live.note(A1, 'mic'), 2);
  assert.equal(live.size, 3);
  const capped = new S.LiveVoices(0.99, 1);
  assert.equal(capped.note(A1, 'mix'), 0);
  assert.equal(capped.note(B1, 'mix'), 0);
});

test('a voice heard once is provisional: the next print may still join it below the settled line', () => {
  // The ff7b live failure in miniature (6 Nov 2026, e1-speaker-turns): the meeting's first stretch was half a
  // second, its print an outlier, and the same person's next print sounded 0.54 like it — just under the 0.55
  // line — so it founded the voice every later print joined, leaving a dead "Speaker 1" and 3 voices for 2
  // people. A once-heard voice is joined more easily; a settled one keeps the full line.
  const live = new S.LiveVoices(0.55, 8);
  assert.equal(live.note(v([1, 0]), 'mix'), 0);
  assert.equal(live.note(v([0.5, Math.sqrt(0.75)]), 'mix'), 0, '0.5 alike still joins a voice heard only once');
  assert.equal(live.size, 1);
  assert.equal(live.note(v([0, 1]), 'mix'), 1, '0.5 alike does not join a settled voice');
});

// ── Who is talking, from what the meeting already knows (12 Nov 2026) ────────
// The live 1-2-1: one far-side voice split into Speaker 2, 3 and 4, numbered, never named. Made-up people.

test('how many others the meeting expects: the invite without the recorder, else a 1-2-1 title', () => {
  assert.equal(S.expectedOthers({ title: 'Weekly sync', attendees: ['Darcy Lin'], me: 'Jesse Arlow' }), 1);
  assert.equal(S.expectedOthers({ title: 'Weekly sync', attendees: ['Jesse Arlow', 'Darcy Lin', 'Bettina Wang'], me: 'Jesse Arlow' }), 2);
  assert.equal(S.expectedOthers({ title: '1-2-1 with Darcy', attendees: [], me: 'Jesse Arlow' }), 1);
  assert.equal(S.expectedOthers({ title: '1:1 Darcy Lin', attendees: [], me: '' }), 1);
  assert.equal(S.expectedOthers({ title: 'Weekly sync', attendees: [], me: 'Jesse Arlow' }), null);
  assert.equal(S.expectedOthers({ title: '1-2-1 with the team about hiring', attendees: [], me: '' }), 1, 'a 1-2-1 title still expects one other, whatever follows');
  assert.deepEqual(S.othersFromAttendees(['[[Darcy Lin]]', 'Jesse Arlow'], 'Jesse'), ['Darcy Lin']);
  assert.equal(S.otherNameFromTitle('1-2-1 with Darcy Lin'), 'Darcy Lin');
  assert.equal(S.otherNameFromTitle('Darcy 1-2-1'), 'Darcy');
  assert.equal(S.otherNameFromTitle('1-2-1 with the team about hiring'), null);
  assert.equal(S.otherNameFromTitle('Weekly sync'), null);
});

test('a 1-2-1’s far side groups as one voice: one person is never split into Speaker 2, 3 and 4', () => {
  // One voice through a call, three prints no two of which reach the 0.55 joining line: unbounded they split.
  const prints = [v([1, 0]), v([0.5, Math.sqrt(0.75)]), v([-0.5, Math.sqrt(0.75)])];
  assert.equal(new Set(S.clusterVoices(prints, { threshold: 0.55 })).size, 3, 'unbounded: three groups for one person');
  assert.deepEqual(S.clusterVoices(prints, { threshold: 0.55, cap: 1 }), [0, 0, 0], 'expected one: likest-first, one voice');
  const live = new S.LiveVoices(0.55, 1);
  assert.deepEqual([live.note(prints[0], 'pc'), live.note(prints[1], 'pc'), live.note(prints[2], 'pc')], [0, 0, 0], 'live too: the cap joins the likest');
});

test('in a 1-2-1 the one other voice is the one other attendee, with confidence', () => {
  const lines = [
    { at: 0, text: 'Morning Darcy, how is the planting going?', who: 'You' },
    { at: 20, text: 'Morning, going well, the Sydney rooms are nearly done.', who: 'Speaker 1' },
    { at: 40, text: 'Good to hear. Anything blocking?', who: 'You' },
    { at: 60, text: 'Just the landlord on the ceiling mics.', who: 'Speaker 1' },
  ];
  const r = S.autoVoiceNames(lines, { attendees: ['Darcy Lin'], me: 'Jesse Arlow', sources: 'mic+pc' });
  assert.deepEqual(r.names, { spk1: 'Darcy Lin' });
  assert.ok(r.confidence.spk1 >= S.VOICE_NAME_CLEAR, `clear: ${r.confidence.spk1}`);
  // Two voices on the call side: no longer one other voice, so no automatic name.
  const two = [...lines, { at: 80, text: 'Sorry I am late, what did I miss?', who: 'Speaker 2' }];
  assert.deepEqual(S.autoVoiceNames(two, { attendees: ['Darcy Lin'], me: 'Jesse Arlow', sources: 'mic+pc' }).names, {});
  // The title's other person when the invite names nobody.
  const titled = S.autoVoiceNames(lines, { title: '1-2-1 with Darcy', me: 'Jesse Arlow', sources: 'mic+pc' });
  assert.deepEqual(titled.names, { spk1: 'Darcy' });
});

test('with more people, names come from the cues and the invite; one unclear voice stays numbered', () => {
  const lines = [
    { at: 0, text: 'Morning all, let us start with the Sydney window.', who: 'You' },
    { at: 20, text: 'Bettina here, the firmware is patched, so the 14th works.', who: 'Speaker 1' },
    { at: 40, text: 'Thanks Darcy, the trays look great. What about Melbourne?', who: 'You' },
    { at: 60, text: 'No worries, the panels land Friday.', who: 'Speaker 2' },
    { at: 80, text: 'Darcy, will the photos be ready too?', who: 'You' },
    { at: 100, text: 'Yes, by Friday midday.', who: 'Speaker 2' },
    { at: 120, text: 'The budget holds at four hundred thousand.', who: 'Speaker 3' },
  ];
  const opts = { attendees: ['Darcy Lin', 'Bettina Wang', 'Priya Sharma'], me: 'Jesse Arlow', sources: 'mic+pc' };
  const r = S.autoVoiceNames(lines, opts);
  assert.deepEqual(r.names, { spk1: 'Bettina Wang', spk2: 'Darcy Lin' });
  assert.ok(r.confidence.spk1 >= S.VOICE_NAME_CLEAR && r.confidence.spk2 >= S.VOICE_NAME_CLEAR, 'both clear');
  assert.ok(!('spk3' in r.names), 'one unclear voice stays numbered, for one-click naming with the invite offered');
  // One answer alone is not clear: a single "thanks" with one reply stays numbered.
  const once = S.autoVoiceNames(lines.slice(0, 4), opts);
  assert.ok(!('spk2' in once.names), 'a single answer stays numbered until a second cue');
  // Someone answering to their name after another voice calls them.
  const called = S.autoVoiceNames(
    [
      { at: 0, text: 'Priya, what do you think about the dates?', who: 'Speaker 1' },
      { at: 20, text: 'The dates work for me.', who: 'Speaker 2' },
      { at: 40, text: 'Priya, and the budget?', who: 'Speaker 1' },
      { at: 60, text: 'The budget holds.', who: 'Speaker 2' },
    ],
    opts,
  );
  assert.deepEqual(called.names, { spk2: 'Priya Sharma' });
});

test('automatic names never guess: ties, claims and the recorder’s own name stay numbered', () => {
  const opts = { attendees: ['Darcy Lin', 'Bettina Wang'], me: 'Jesse Arlow', sources: 'mic+pc' };
  // Two voices both answering to Darcy: the name stays on neither.
  const clash = S.autoVoiceNames(
    [
      { at: 0, text: 'Thanks Darcy.', who: 'You' },
      { at: 20, text: 'No worries.', who: 'Speaker 1' },
      { at: 40, text: 'Thanks Darcy.', who: 'You' },
      { at: 60, text: 'Anytime.', who: 'Speaker 2' },
      { at: 80, text: 'Darcy, one more thing.', who: 'You' },
      { at: 100, text: 'Go ahead.', who: 'Speaker 1' },
      { at: 120, text: 'Darcy, same question.', who: 'You' },
      { at: 140, text: 'Also fine.', who: 'Speaker 2' },
    ],
    opts,
  );
  assert.deepEqual(clash.names, {}, 'a name two voices claim stays on neither');
  // The recorder's own name never names a numbered voice on a call.
  const me = S.autoVoiceNames(
    [
      { at: 0, text: 'Thanks Jesse.', who: 'Speaker 1' },
      { at: 20, text: 'No worries at all.', who: 'Speaker 2' },
      { at: 40, text: 'Jesse, what next?', who: 'Speaker 1' },
      { at: 60, text: 'The trays, then photos.', who: 'Speaker 2' },
    ],
    { attendees: ['Jesse Arlow', 'Darcy Lin'], me: 'Jesse Arlow', sources: 'mic+pc' },
  );
  assert.ok(!('spk2' in me.names), 'the recorder’s own name never names a call-side voice');
  // "You" is never renamed, and a name merely mentioned names nobody.
  const mentioned = S.autoVoiceNames([{ at: 0, text: 'I sent the quote to Darcy last week.', who: 'Speaker 1' }], opts);
  assert.deepEqual(mentioned.names, {}, 'a name merely mentioned names nobody');
});
