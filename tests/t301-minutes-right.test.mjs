// node --test tests/t301-minutes-right.test.mjs — meeting minutes come out right (18 Nov 2026, t301: on a real
// 11-minute Teams call's minutes). The map reaches the transcript and the minutes (names shown, the mic as the
// owner, one voice claiming a side's stray lines, both sides in time order); English only (a stray fragment
// dropped, an unheard piece [inaudible], meetings asking for English); summaries whole; optional invitees absent
// and passing mentions unnamed; the owner linked like every owner, due words kept, distinct jobs kept apart;
// telling figures first; no empty scaffolding; the run always ending; the word check quiet on ordinary words and
// inflections, offering the vault's real term; prep project-first. The real-data run over their transcript and
// the Teams comparison ride in the report, never here: made-up harbour shop talk only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t301-'));
let W, Sp, R, N, M, Wm, Mr, S, B, F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [...['meeting-words', 'meeting-speakers', 'recorder', 'meeting-notes', 'meeting-minutes', 'work-meetings', 'share', 'brand-document', 'frontmatter'].map((m, i) => `export * as m${i} from ${JSON.stringify(path.join(root, `src/shared/${m}.ts`))};`), `export * as m9 from ${JSON.stringify(path.join(root, 'src/main/meeting-recorder.ts'))};`].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: [/^node:/], output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 'm.mjs')).href);
  [W, Sp, R, N, M, Wm, S, B, F, Mr] = [all.m0, all.m1, all.m2, all.m3, all.m4, all.m5, all.m6, all.m7, all.m8, all.m9];
});
after(() => rmSync(work, { recursive: true, force: true }));

const ME = 'Mia Tran';
const OTHER = 'Sam Okafor';
const PEOPLE = [OTHER, 'Priya Natarajan'];
const DATE = '2026-11-18'; // a Wednesday: today and tomorrow firm to it and the next day

/** The main side's handlers, caught as app.ts registers them (the recorder test's shape, trimmed). */
function mainSide(deps = {}) {
  const handlers = {};
  const dataDir = path.join(work, `data-${Math.random().toString(36).slice(2)}`);
  const vault = path.join(work, 'vault');
  mkdirSync(vault, { recursive: true });
  Mr.registerRecorder({
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
    ...deps.extra,
  });
  return { handlers };
}
const wav = () => R.encodeWav(new Float32Array(16000).fill(0.3), 16000);

test('t301 item 1: the map reaches the transcript shown, the mic as the owner, the file untouched', () => {
  const note = '---\ntype: meeting\ndate: 2026-11-18\nneuralvault-speaker-names:\n  Part 1:\n    spk1: Sam Okafor\n---\n## Summary\n\nSam settled the roster.\n\n## Transcript\n\n> [!quote]- Transcript · 2 minutes\n> **0:00** *Speaker 1:* Morning all, let us start with the mill.\n>\n> **0:04** *You:* Morning, Sam.\n>\n> **0:09** *Others:* Mhm.\n';
  const shown = Sp.withSpeakerNames(note, ME);
  assert.ok(shown.includes('*Sam Okafor:*') && !shown.includes('Speaker 1'), 'the named voice reads as Sam');
  assert.ok(shown.includes(`*${ME}:*`) && !shown.includes('*You:*'), 'the mic reads as the owner');
  assert.ok(shown.includes('*Others:*'), 'Others names nobody, so it stays');
  assert.ok(note.includes('*Speaker 1:*') && note.includes('*You:*'), 'the file keeps its labels');
  assert.equal(Sp.shownWho('You', {}, ME), ME);
  assert.equal(Sp.shownWho('You', {}), 'You', 'no name known: You stays');
  assert.equal(Sp.shownWho('Others', {}, ME), 'Others');
  assert.equal(Sp.shownWho('Speaker 2', {}, ME), 'Speaker 2', 'an unnamed voice stays');
  assert.equal(Sp.shownWho('Speaker 1', { spk1: OTHER }), OTHER);
});

test('t301 item 1: one voice alone claims its side\u2019s stray lines; two voices or none keep them', () => {
  const piece = (index, start, side, who, text) => ({ index, start, seconds: 20, side, status: 'done', text, who });
  const pieces = [piece(0, 0, 'pc', 'Others', 'the quote for the second lane'), piece(1, 20, 'pc', 'Others', 'uncovered words here')];
  const one = Sp.labelPieces(pieces, [{ id: 'spk1', start: 0, end: 19, side: 'pc' }], 'mic+pc');
  assert.ok(one && one.pieces[1].who === 'Speaker 1', 'one voice claims the piece its turns never touched');
  const two = Sp.labelPieces(pieces, [{ id: 'spk1', start: 0, end: 19, side: 'pc' }, { id: 'spk2', start: 0, end: 19, side: 'pc' }], 'mic+pc');
  assert.ok(two && two.pieces[1].who === 'Others', 'two voices: the stray keeps its label');
  assert.equal(Sp.labelPieces(pieces, [], 'mic+pc'), null, 'no turns: nothing moves');
  const room = Sp.labelPieces([{ index: 0, start: 0, seconds: 20, status: 'done', text: 'morning', who: 'Others' }], [{ id: 'spk1', start: 100, end: 110, side: 'mix' }], undefined);
  assert.ok(room && room.pieces[0].who === 'Speaker 1', 'one voice in a room claims too');
});

test('t301 item 1: both sides read in time order, the same moment keeping side order', () => {
  const lines = R.mergeTranscript([
    { index: 0, start: 100, seconds: 20, side: 'mic', status: 'done', who: 'You', segments: [{ start: 5, text: 'the answer' }] },
    { index: 0, start: 100, seconds: 20, side: 'pc', status: 'done', who: 'Others', segments: [{ start: 1, text: 'the question' }] },
  ]);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['the question', 'the answer'],
    'an answer never reads before its question',
  );
  const tied = R.mergeTranscript([
    { index: 0, start: 100, seconds: 20, side: 'mic', status: 'done', who: 'You', text: 'morning' },
    { index: 0, start: 100, seconds: 20, side: 'pc', status: 'done', who: 'Others', text: 'morning all' },
  ]);
  assert.deepEqual(
    tied.map((l) => l.who),
    ['You', 'Others'],
    'the same moment keeps side order',
  );
});

test('t301 item 2: English only — a stray fragment dropped, an unheard piece [inaudible], English asked for', async () => {
  assert.equal(R.englishOnly('嗯,到齊了。'), '', 'a whole foreign line leaves nothing');
  assert.equal(R.englishOnly('Hello 嗯 world'), 'Hello world', 'a stray fragment dropped');
  assert.equal(R.englishOnly('The fit-out quote came in.'), 'The fit-out quote came in.');
  assert.equal(R.englishOnly('Māori design'), 'Māori design', 'macrons are Latin and stay');
  assert.equal(R.englishOnly('嗯', ['嗯']), '嗯', 'a hint word stays whole');
  const got = [];
  const { handlers } = mainSide({
    extra: {
      transcribe: async (audio, mime, hints, opts) => {
        got.push(opts);
        return { text: got.length > 1 ? 'The quote 嗯 came in' : '嗯,到齊了。' };
      },
    },
  });
  assert.deepEqual(await handlers['recorder:transcribe'](wav(), 'audio/wav', ['Sam Okafor']), { text: '[inaudible]' }, 'speech heard in no kept words says so');
  assert.deepEqual(await handlers['recorder:transcribe'](wav(), 'audio/wav', ['Sam Okafor']), { text: 'The quote came in' });
  assert.equal(got[0]?.language, 'en', 'meetings ask for English');
  assert.equal(got[1]?.language, 'en');
  const { handlers: echoHandlers } = mainSide({ extra: { transcribe: async () => ({ text: 'Names and words to know: Sam Okafor' }) } });
  assert.deepEqual(await echoHandlers['recorder:transcribe'](wav(), 'audio/wav', ['Sam Okafor']), { text: '' }, 'nothing but the hint\u2019s echo stays quiet, as before');
});

test('t301 item 3: a summary is always whole - whole sentences to the cap, never cut mid-sentence', () => {
  const sentences = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} about the mill and the flour supply for November and the Saturday rush`);
  const long = sentences.join('. ') + '.';
  assert.ok(long.length > 2400, 'the fixture runs past the cap');
  const kept = N.wholeSentences(long, 2400);
  assert.ok(kept.length <= 2400 && kept.endsWith('.') && !kept.includes('\u2026'), 'whole sentences, no ellipsis');
  assert.equal(N.wholeSentences('Short and whole.', 2400), 'Short and whole.');
  const one = N.wholeSentences('word '.repeat(600).trim(), 2400);
  assert.ok(one.length <= 2400 && !one.includes('\u2026') && !one.endsWith('...'), 'no sentence end: whole words, still no ellipsis');
  const minutes = M.readMinutesReply({ summary: long, decisions: [], actions: [], questions: [], topics: [], present: [ME], absent: [], named: [] });
  assert.ok(minutes && minutes.summary.endsWith('.') && minutes.truncated && minutes.truncated.summary, 'the minutes reader keeps whole sentences and says it cut');
  const notes = N.readMeetingReply({ summary: long, decisions: [], actions: [], people: [ME] });
  assert.ok(notes && notes.summary.endsWith('.') && notes.truncated && notes.truncated.summary, 'the notes reader keeps whole sentences too');
  const merged = M.mergeMeetingMinutes([
    { present: [], absent: [], named: [], summary: sentences.slice(0, 6).join('. ') + '.', figures: [], decisions: [], actions: [], questions: [], topics: [] },
    { present: [], absent: [], named: [], summary: sentences.slice(6).join('. ') + '.', figures: [], decisions: [], actions: [], questions: [], topics: [] },
  ]);
  assert.ok(!merged || merged.summary.endsWith('.'), 'a merged summary stays whole');
});

test('t301 item 4: optional invitees absent, passing mentions unnamed - the ask says so, the lists obey', () => {
  assert.ok(M.MINUTES_SYSTEM.includes('optional invitee'), 'the minutes ask names optional invitees');
  assert.ok(M.MINUTES_SYSTEM.includes('passing mention'), 'the minutes ask refuses passing mentions');
  assert.ok(N.MEETING_NOTES_SYSTEM.includes('only invited or optional'), 'the notes ask names them too');
  assert.ok(N.MEETING_NOTES_SYSTEM.includes('passing mention'), 'the notes ask refuses them too');
  assert.deepEqual(N.resolveAttendees([], ['Jordan Barker'], [], ['Jordan Barker']), { present: [], named: [] }, 'an invitee the answer files absent never joins present');
});

test('t301 item 5: the owner links like every owner, due words kept, distinct jobs apart', () => {
  const note = '---\ntype: meeting\ndate: 2026-11-18\n---\n## Agenda\n\n- [ ] \n\n## Notes\n\n';
  const reply = M.readMinutesReply(
    {
      summary: 'Mia and Sam went over the flour supply.',
      decisions: [],
      actions: [
        { what: 'Make the adjustments today', who: ME, when: 'today' },
        { what: 'Adjust the slides tomorrow', who: OTHER, when: 'tomorrow' },
      ],
      questions: [],
      topics: [],
      present: [],
      absent: [],
      named: [],
    },
    {
      me: ME,
      date: DATE,
      transcript: [
        { at: 1, text: 'I will make it today', who: 'Speaker 1' },
        { at: 2, text: 'I will adjust my slides for tomorrow', who: 'You' },
      ],
    },
  );
  assert.equal(reply.actions[0].due, DATE, 'today firms to the meeting day');
  assert.equal(reply.actions[1].due, '2026-11-19', 'tomorrow firms to the next day');
  const minutes = { present: [ME, OTHER], absent: [], named: [], summary: 'Mia Tran and Sam Okafor went over the flour supply.', figures: [], decisions: ['Western Plains Mill supplies the flour from November.'], actions: [{ what: 'Ask the mill about Tuesday delivery', who: ME }], questions: [], topics: [{ heading: 'Flour', words: ['Mia Tran asked about Tuesday delivery.'] }] };
  const made = M.applyMeetingMinutes(note, minutes, { people: PEOPLE, me: ME, date: DATE });
  assert.ok(made.text.includes('— [[Mia Tran]]'), 'the owner links on actions like every owner');
  assert.ok(made.text.includes('[[Mia Tran]]') && made.text.includes('[[Sam Okafor]]'), 'the owner links in the words too');
  const notes = { summary: 'Mia Tran and Sam Okafor went over the flour supply.', decisions: [], actions: [{ what: 'Ask the mill about Tuesday delivery', who: 'You' }], people: [ME, OTHER], named: [] };
  const written = N.applyMeetingNotes(note, notes, { transcript: [], length: '2 minutes', people: PEOPLE, me: ME, date: DATE });
  assert.ok(written.text.includes('— [[Mia Tran]]'), 'the notes link a You owner as well');
  const both = M.applyMeetingMinutes(note, { ...minutes, actions: [{ what: 'Make presentation adjustments and send them through', who: OTHER, when: 'today' }, { what: 'Adjust slides for the presentation', who: ME, when: 'tomorrow' }] }, { people: PEOPLE, me: ME, date: DATE });
  assert.ok(both.text.includes('Make presentation adjustments and send them through') && both.text.includes('Adjust slides for the presentation'), 'two jobs stay two lines');
  assert.ok(M.MINUTES_SYSTEM.includes('already doing'), 'ongoing jobs are actions in the ask');
  assert.ok(M.MINUTES_SYSTEM.includes('"today", "tomorrow"'), 'today and tomorrow ride as due words');
  assert.ok(M.MINUTES_SYSTEM.includes('when and scope'), 'decisions carry their when and scope');
});

test('t301 item 6: telling figures first - the ask ranks amounts and counts over bare years', () => {
  assert.ok(M.MINUTES_SYSTEM.includes('Most telling first'), 'the figures ask ranks most telling first');
  const support = N.transcriptSupport([
    { at: 0, text: 'The quote came in at 366,000 dollars, against our 47K budget.', who: 'Speaker 1' },
    { at: 30, text: 'Three rooms asked to be cut, and we keep at most four to a room.', who: 'Speaker 1' },
  ]);
  assert.ok(N.figureSupported('US$366,000', support), 'grouped digits said land however printed');
  assert.ok(N.figureSupported('US$47,000', support), '47K said lands as 47,000');
  assert.ok(N.figureSupported('3', support) && N.figureSupported('4', support), 'counts said in words land as figures');
  assert.ok(!N.figureSupported('$4,800', support), 'a value never said never lands');
});

test('t301 item 7: empty scaffolding goes with the minutes; anything said stays', () => {
  const note = '---\ntype: meeting\ndate: 2026-11-18\n---\n## Agenda\n\n- [ ] \n\n## Notes\n\n\n## Actions\n\n';
  const minutes = { present: [ME], absent: [], named: [], summary: 'Mia Tran and Sam Okafor went over the flour supply.', figures: [], decisions: ['Western Plains Mill supplies the flour from November.'], actions: [], questions: [], topics: [{ heading: 'Flour', words: ['The quote came in.'] }] };
  const out = M.applyMeetingMinutes(note, minutes, { people: PEOPLE, me: ME, date: DATE });
  assert.ok(!/^## Agenda$/m.test(out.text), 'an empty Agenda with its bare box goes');
  assert.ok(!/^## Notes$/m.test(out.text), 'an empty Notes goes');
  const full = '---\ntype: meeting\ndate: 2026-11-18\n---\n## Agenda\n\n- [ ] The second till lane\n\n## Notes\n\nMia keeps the dock roster.\n\n';
  const kept = M.applyMeetingMinutes(full, minutes, { people: PEOPLE, me: ME, date: DATE });
  assert.ok(/^## Agenda$/m.test(kept.text) && /^## Notes$/m.test(kept.text), 'a section holding anything said stays');
});

test('t301 item 8: the run ends before the save settles - the bar always lands or errors', () => {
  const mm = readFileSync(path.join(root, 'src/renderer/src/views/MeetingMinutes.tsx'), 'utf8');
  assert.ok(mm.indexOf('finish(null)') > 0 && mm.indexOf('finish(null)') < mm.indexOf('await docs.flush(path)'), 'the run ends before the save settles');
  assert.ok(/catch \(err\) \{\s*finish\(\{ phase: 'error'/.test(mm), 'a failure ends in a plain error with a retry');
});

test('t301 word check: ordinary words and inflections never flag; the vault term is offered', () => {
  const ordinary = W.findUncertain(
    [
      { at: 0, text: 'Hi, good afternoon.', who: 'Speaker 1' },
      { at: 4, text: 'Good. I believe it is better to share it.', who: 'Speaker 1' },
      { at: 75, text: 'Are you using the mill to do the install?', who: 'You' },
    ],
    [],
  );
  assert.ok(!ordinary.some((u) => ['good', 'are'].includes(u.display.toLowerCase())), 'Good and Are are ordinary words');
  const inflected = W.findUncertain(
    [
      { at: 0, text: 'We will migrate the till lane first.', who: 'You' },
      { at: 10, text: 'Migrate the dock next, then the till.', who: 'Speaker 1' },
      { at: 20, text: 'They migrate every lane by Friday.', who: 'Speaker 1' },
      { at: 30, text: 'We migrate the rest after that.', who: 'You' },
      { at: 40, text: 'It is about migrating it to the new lane.', who: 'Speaker 1' },
    ],
    [],
  );
  assert.ok(!inflected.some((u) => u.display.toLowerCase() === 'migrating'), 'migrating is migrate said differently');
  const vault = W.findUncertain(
    [
      { at: 0, text: 'Deploy the MeshHub panel there.', who: 'Speaker 1' },
      { at: 10, text: 'The MeshUp bar suits the room.', who: 'Speaker 1' },
    ],
    ['MaxHub'],
  );
  const offered = vault.find((u) => u.reason === 'spelt-two-ways');
  assert.equal(offered && offered.known, 'MaxHub', 'a heard word close to the vault term offers it');
  const fair = W.findUncertain(
    [
      { at: 0, text: 'The proposal from Tessaly is here.', who: 'Speaker 1' },
      { at: 10, text: 'Ask Tessala to cut the quote.', who: 'You' },
    ],
    [],
  );
  assert.ok(fair.some((u) => u.reason === 'spelt-two-ways'), 'true variants still flag');
});

test('t301 prep: this meeting project first, stable either side of the line', () => {
  const items = [
    { what: 'Confirm the Northgate rooms', project: 'Projects/Northgate.md' },
    { what: 'Cut the EW quote', project: 'Projects/EW.md' },
    { what: 'Wipe the Brackwater computers', project: 'Projects/Brackwater.md' },
    { what: 'Send the EW slides', project: 'Projects/EW.md' },
  ];
  assert.deepEqual(
    Wm.prepProjectFirst(items, (x) => x.project === 'Projects/EW.md').map((x) => x.what),
    ['Cut the EW quote', 'Send the EW slides', 'Confirm the Northgate rooms', 'Wipe the Brackwater computers'],
  );
});

test('t301 on screen: the minutes read on the card, the checks as one calm column', () => {
  const mm = readFileSync(path.join(root, 'src/renderer/src/views/MeetingMinutes.tsx'), 'utf8');
  assert.ok(mm.includes('className="mm-minutes"'), 'the summary, decisions and actions read on the card');
  const css = readFileSync(path.join(root, 'src/renderer/src/styles/recorder.css'), 'utf8');
  assert.ok(/\.mm-list\s*\{[^}]*flex-direction:\s*column/s.test(css), 'the checks read as one calm column');
  assert.ok(/\.mm-list\s*\{[^}]*max-width:\s*76ch/s.test(css), 'the column caps to a reading width');
});

test('t301 round2 item 1: said words keep their pronouns; only a label or an owner swaps', () => {
  // The real run asked "Are you using Tessaly to do the install?" and the note read "Are Jesse
  // Arlow using…": a "you" asked of someone else is not the recorder. Made-up mill talk here.
  const reply = M.readMinutesReply(
    {
      present: ['Sam Okafor'],
      absent: [],
      named: [],
      figures: [],
      summary: 'You opened on the mill order with Sam.',
      decisions: [{ text: 'You will send the quote', at: '1:00' }],
      actions: [{ what: 'Ask your team to check the totals', who: 'You' }],
      questions: [{ what: 'Are you using the mill to do the install?', askedBy: 'You', owner: 'Sam Okafor', answer: 'You said likely, yes.' }],
      topics: [{ heading: 'Mill order', words: ['You said the retry fails on Fridays.'] }],
    },
    { me: ME },
  );
  assert.equal(reply.summary, 'You opened on the mill order with Sam.');
  assert.deepEqual(reply.decisions, ['You will send the quote']);
  assert.equal(reply.actions[0].what, 'Ask your team to check the totals');
  assert.equal(reply.actions[0].who, ME, 'an owner field still swaps');
  assert.equal(reply.questions[0].what, 'Are you using the mill to do the install?');
  assert.equal(reply.questions[0].askedBy, ME, 'who asked still swaps');
  assert.equal(reply.questions[0].answer, 'You said likely, yes.');
  assert.deepEqual(reply.topics[0].words, ['You said the retry fails on Fridays.']);
  const out = M.applyMeetingMinutes(
    '# Call\n',
    {
      present: ['Sam Okafor'],
      absent: [],
      named: [],
      summary: 'You opened on the mill order with Sam.',
      figures: [],
      decisions: ['You will send the quote'],
      actions: [{ what: 'Ask your team to check the totals', who: ME }],
      questions: [{ what: 'Are you using the mill to do the install?' }],
      topics: [{ heading: 'Mill order', words: ['You said the retry fails on Fridays.'] }],
    },
    { people: PEOPLE, me: ME },
  ).text;
  assert.ok(out.includes('Are you using the mill to do the install?'), 'the writer keeps the asked words too');
  assert.ok(!out.includes(`${ME} using`), 'no name swapped into them');
  const notes = N.readMeetingReply(
    {
      summary: 'You opened on the mill order.',
      decisions: [{ text: 'You will send the quote', at: '1:00' }],
      actions: [{ what: 'Send the signed quote', who: 'You' }],
      people: ['You', 'Sam'],
    },
    { me: ME },
  );
  assert.equal(notes.summary, 'You opened on the mill order.', 'the notes reader keeps them too');
  assert.deepEqual(notes.decisions, ['You will send the quote']);
  assert.deepEqual(notes.people, [ME, 'Sam'], 'a speaker label still swaps');
  assert.equal(notes.actions[0].who, ME);
});

test('t301 round2 item 2: the frontmatter is this run’s people; a hand-added name stays', () => {
  // Darcy stayed in people while absent also listed them, and a past run's also names stayed though the
  // reply named nobody. Made-up people here: Lee was invited but absent, Priya and Noah are a past run's
  // stale also, Alex was added to people by hand, and the mill supplier is the person's own words in also.
  const note = '---\ntype: meeting\ndate: 2026-11-18\npeople:\n  - "[[Sam Okafor]]"\n  - "[[Lee Park]]"\n  - "[[Mia Tran]]"\n  - "[[Alex Rivera]]"\nabsent:\n  - "[[Sam Okafor]]"\n  - the survey crew\nalso:\n  - "[[Priya Natarajan]]"\n  - "[[Noah Patel]]"\n  - the mill supplier\n---\n# Call\n';
  const out = M.applyMeetingMinutes(
    note,
    { present: ['Sam Okafor', 'Mia Tran'], absent: ['Lee Park'], named: [], summary: 'Sam and Mia went over the flour supply.', figures: [], decisions: ['Western Plains Mill supplies the flour from November.'], actions: [], questions: [], topics: [] },
    { people: ['Sam Okafor', 'Lee Park', 'Priya Natarajan', 'Noah Patel'], me: ME, attendees: ['Sam Okafor', 'Lee Park'], date: DATE },
  ).text;
  const props = F.readProps(out);
  const bare = (v) => String(v).replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
  assert.deepEqual((props.people ?? []).map(bare).sort(), ['Alex Rivera', 'Mia Tran', 'Sam Okafor'], 'people is who was there, plus the hand-added name');
  assert.deepEqual((props.absent ?? []).map(bare).sort(), ['Lee Park', 'the survey crew'], 'absent is who was not, plus the person’s own words');
  assert.deepEqual((props.also ?? []).map(bare), ['the mill supplier'], 'also is this run’s named, plus only words the vault never writes there');
  const inTwo = (props.people ?? []).map(bare).filter((n) => (props.absent ?? []).map(bare).includes(n));
  assert.deepEqual(inTwo, [], 'never the same name in both');
});

test('t301 round2 item 3: the shared copy and the branded page name the owner on the mic', () => {
  const note = '---\ntype: meeting\ndate: 2026-11-18\nneuralvault-speaker-names:\n  Part 1:\n    spk1: Sam Okafor\n---\n# Call\n\n## Transcript\n\n> [!quote]- Transcript · 2 minutes\n> **0:00** *Speaker 1:* Morning all.\n>\n> **0:04** *You:* Morning, Sam.\n';
  const shared = S.shareBody(note, { me: ME });
  assert.ok(shared.includes(`*${ME}:*`), 'the mic reads as the owner in the shared copy');
  assert.ok(!shared.includes('*You:*'), 'no You label left in it');
  assert.ok(shared.includes('*Sam Okafor:*'), 'a named voice still reads in its name');
  assert.ok(S.shareBody(note).includes('*You:*'), 'no name known: You stays');
  const html = S.shareHtml('Call', note, { url: () => '', me: ME });
  assert.ok(html.includes(`<i>${ME}:</i>`), 'the formatted copy names the owner on the mic');
  assert.ok(!html.includes('<i>You:</i>'), 'no You label left in it');
  assert.ok(S.shareHtml('Call', note, { url: () => '' }).includes('<i>You:</i>'), 'no name known: the formatted copy keeps You');
  // The branded page leaves the transcript out by design (brand-document pins it); with the name threaded
  // through, its end state carries no You label either.
  const page = B.brandDocument({ title: 'Call', text: note, path: 'Meetings/Call.md', url: () => '', me: ME });
  assert.ok(!page.includes('Morning, Sam.'), 'the transcript stays out of the branded page');
  assert.ok(!/<i>You:<\/i>|\*You:\*/.test(page), 'no You label in it');
});
