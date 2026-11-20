// node --test tests/meeting-words.test.mjs — the words to check before minutes go out (src/shared/meeting-words.ts;
// 5 Nov 2026). On an invented cart-fix meeting with garbled names built in: the unsure names and product words
// found (spelt two ways, close to a known word, or rare), each with context, spellings and its moment to play;
// quiet when nothing is unsure; one correction fixing every copy as whole words only, never inside another word;
// thin stretches found for their length; a re-heard stretch replacing only its lines; and "not assigned" owners
// reading as no owner (src/shared/meetings.ts).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-meeting-words-'));
let W, Mt, N, R, WF;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    ['meeting-words', 'meetings', 'meeting-notes', 'recorder'].map((m, i) => `export * as m${i} from ${JSON.stringify(path.join(root, `src/shared/${m}.ts`))};`).join('\n'),
  );
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'w.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 'w.mjs')).href);
  [W, Mt, N, R] = [all.m0, all.m1, all.m2, all.m3];
  const entry2 = path.join(work, 'entry2.ts');
  writeFileSync(entry2, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/state/wordFixes.ts'))};\n`);
  await build({ input: entry2, platform: 'node', output: { file: path.join(work, 'wf.mjs'), format: 'esm' }, logLevel: 'silent' });
  WF = await import(pathToFileURL(path.join(work, 'wf.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const KNOWN = ['Priya Nair', 'Alex Chen', 'Harbourline', 'ADM'];
const LINES = [
  { at: 0, text: 'Morning all, let us start with the Harbourline cart.', who: 'You' },
  { at: 20, text: 'Priya Nairr says the retry still fails on Fridays.', who: 'Others' },
  { at: 45, text: 'Did Priya Nayer chase the failed payments?', who: 'You' },
  { at: 70, text: 'The ADM panel shows two failures.', who: 'Others' },
  { at: 90, text: 'The ADN panel needs a second look.', who: 'Others' },
  { at: 120, text: 'We will ask Tessaly about the receipt printer.', who: 'You' },
  { at: 150, text: 'Harbourline drops one order in forty at payment.', who: 'Others' },
  { at: 180, text: 'Harbourline needs the retry before Friday.', who: 'You' },
];

test('unsure words found: spelt two ways, close to known, or rare; each with context and its moment', () => {
  const found = W.findUncertain(LINES, KNOWN);
  const byDisplay = new Map(found.map((f) => [f.display, f]));
  // Nairr and Nayer are one name twice (close to Priya Nair too).
  const nair = found.find((f) => f.spellings.includes('Nairr'));
  assert.ok(nair, `Nairr flagged: ${JSON.stringify(found.map((f) => f.spellings))}`);
  assert.equal(nair.reason, 'spelt-two-ways');
  assert.deepEqual(nair.spellings, ['Nairr', 'Nayer']);
  assert.equal(nair.known, 'Nair');
  assert.ok(nair.spots[0].context.includes('Nairr') && nair.spots[0].at === 20, 'context and the moment to play');
  // ADM and ADN are one product word twice.
  const adm = found.find((f) => f.spellings.includes('ADN'));
  assert.ok(adm);
  assert.equal(adm.reason, 'spelt-two-ways');
  assert.deepEqual(adm.spellings, ['ADM', 'ADN']);
  // Tessaly is said once with nothing near: quiet (n4 reason change — a real take's said-once Green, David,
  // Kim and Brunswick were all noise, and noise is worse than a miss; a clipped tail of a steady word still
  // flags, covered below).
  assert.ok(!byDisplay.get('Tessaly'), 'said once with nothing near stays quiet');
  // Read right, never flagged: Priya, Alex, Harbourline (said three ways alike), Fridays, the prose.
  assert.ok(!found.some((f) => f.spellings.includes('Priya')), 'Priya spelt right');
  assert.ok(!found.some((f) => f.spellings.includes('Harbourline')), 'a steady word, however often');
  assert.ok(!found.some((f) => f.spellings.includes('Fridays')), 'a day word');
  assert.ok(found.length <= W.CHECK_LIMIT, 'a short list');
});

test('quiet when nothing is unsure; close alone still flags', () => {
  const calm = [
    { at: 0, text: 'Morning all.' },
    { at: 10, text: 'We will send the quote by Friday.' },
    { at: 20, text: 'Priya Nair will chase the mill tomorrow.' },
  ];
  assert.deepEqual(W.findUncertain(calm, KNOWN), []);
  const close = [{ at: 0, text: 'Priya Nairr will chase the mill.' }];
  const found = W.findUncertain(close, KNOWN);
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'close-to-known');
  assert.equal(found[0].known, 'Nair');
});

test('a line’s first word is a sentence, not a rare name; later words still count', () => {
  const lines = [
    { at: 0, text: 'Did Priya chase the mill?' },
    { at: 30, text: 'Then the retry shipped.' },
    { at: 60, text: 'Anything still open?' },
    { at: 90, text: 'Quick standup, Alex.' },
  ];
  assert.deepEqual(W.findUncertain(lines, KNOWN), [], 'openers never rare');
  const mid = [{ at: 0, text: 'We will ask Tessaly about the printer.' }];
  assert.deepEqual(W.findUncertain(mid, KNOWN), [], 'said once with nothing near stays quiet, past the start too');
  const clip = [
    { at: 0, text: 'Fitzroy opens in March.' },
    { at: 30, text: 'Fitzroy opens in March.' },
    { at: 60, text: 'Fitzroy opens in March.' },
    { at: 90, text: 'We will ask Roy about the printer.' },
  ];
  const roy = W.findUncertain(clip, KNOWN);
  assert.equal(roy.length, 1);
  assert.equal(roy[0].display, 'Roy');
  assert.equal(roy[0].reason, 'rare', 'a clipped tail of a steady word still flags');
  const startMiss = [{ at: 0, text: 'Nayer chased the mill today.' }];
  assert.equal(W.findUncertain(startMiss, KNOWN)[0].reason, 'close-to-known', 'a near miss flags wherever it stands');
  const generic = [{ at: 0, text: 'Then the retry shipped.' }];
  assert.deepEqual(W.findUncertain(generic, [...KNOWN, 'Thin']), [], 'a generic word never flags, however near a known one');
});

test('one correction fixes every copy as whole words only, never inside another word', () => {
  const note = ['# Cart fix', '', 'Priya Nairr owns the retry.', '', '## Transcript', '', '> [!quote]- Transcript · 3 minutes', '> **0:20** *Others:* Priya Nairr says it fails.', '> **1:10** The nairr count is two.'].join('\n');
  const fixed = W.applyCorrection(note, ['Nairr'], 'Nair');
  assert.equal(fixed.count, 3, 'the note, the transcript, however cased');
  assert.ok(fixed.text.includes('Priya Nair owns the retry.'));
  assert.ok(fixed.text.includes('Priya Nair says it fails.'));
  assert.ok(!/Nairr/i.test(fixed.text));
  const inside = W.applyCorrection('Kylies and well-Kylie-known stay; Kyliee’s possessive is fixed.', ['Kyliee', 'Kylie'], 'Kylie');
  assert.ok(inside.text.includes('Kylies and well-Kylie-known stay;'), 'never inside another word');
  assert.ok(inside.text.includes('Kylie’s possessive'), 'a possessive fixed with its word');
  assert.deepEqual(W.applyCorrection('Nothing here.', ['Nairr'], 'Nair').count, 0);
  assert.deepEqual(W.applyCorrection('Nairr here.', ['Nairr'], '  ').text, 'Nairr here.', 'an empty correction changes nothing');
});

test('a person’s name told from a product word; known words lifted for the check', () => {
  assert.equal(W.isPersonName('Priya Nair'), true);
  assert.equal(W.isPersonName('Sam Okafor'), true);
  assert.equal(W.isPersonName('ADM'), false);
  assert.equal(W.isPersonName('Tessaly'), false);
  assert.equal(W.isPersonName('Friday'), false);
  const known = W.extractKnownWords({ people: ['Priya Nair'], projectText: 'The Harbourline cart drops orders. See Western Plains Mill.', earlierTexts: ['Tessaly quoted the printer.'] });
  assert.ok(known.includes('Priya Nair') && known.includes('Harbourline') && known.includes('Western Plains Mill') && known.includes('Tessaly'), `lifted: ${known.join(', ')}`);
  assert.ok(known.length <= 500, 'capped');
});

test('earlier meetings lend corrected words, never their raw transcript spellings', () => {
  const earlier = '# Standup\n\n## Summary\n\nPriya Nair chased the retry.\n\n## Transcript\n\n> [!quote]- Transcript · 1 minute\n> **0:00** Priya Nairr says it fails.\n';
  const stripped = W.withoutTranscript(earlier);
  assert.ok(!stripped.includes('## Transcript') && !stripped.includes('Nairr'), 'the transcript gone');
  assert.ok(stripped.includes('Priya Nair chased the retry.'), 'the corrected words kept');
  const known = W.extractKnownWords({ people: [], projectText: '', earlierTexts: [stripped] });
  assert.ok(known.includes('Priya Nair') && !known.some((k) => /nairr/i.test(k)), `known: ${known.join(', ')}`);
  const found = W.findUncertain([{ at: 20, text: 'Priya Nairr says it still fails.' }], [...known, 'Priya Nair']);
  assert.equal(found.length, 1);
  assert.equal(found[0].known, 'Nair', 'the suggestion survives an earlier transcript');
});

test('thin stretches found for their length; a good transcript stays quiet', () => {
  assert.equal(W.lengthMs('42 minutes'), 42 * 60_000);
  assert.equal(W.lengthMs('1 hour 5 minutes'), 65 * 60_000);
  assert.equal(W.lengthMs('under a minute'), 30_000);
  assert.equal(W.lengthMs('soon'), null);
  const thin = [
    { at: 0, text: 'Morning all, let us start with the cart and the retry.' },
    { at: 30, text: 'Priya will chase the failed payments tomorrow.' },
  ];
  const stretches = W.findThinStretches(thin, 10 * 60_000);
  assert.equal(stretches.length, 1);
  assert.equal(stretches[0].start, 60);
  assert.equal(stretches[0].end, 600);
  assert.equal(stretches[0].words, 0);
  assert.equal(stretches[0].cover, '1:00 to 10:00');
  const good = Array.from({ length: 20 }, (_, i) => ({ at: i * 6, text: 'The retry fails on Fridays and Priya will chase the mill tomorrow morning.' }));
  assert.deepEqual(W.findThinStretches(good, 2 * 60_000), [], 'a full transcript: nothing to re-hear');
  assert.deepEqual(W.findThinStretches(thin, 10_000), [], 'too short to judge');
  assert.deepEqual(W.findThinStretches([], 10 * 60_000), [], 'nothing at all is Try again’s, not gaps’');
});

test('a re-heard stretch replaces only its lines; the person’s own words stay', () => {
  const note = ['# Cart fix', '', '## Notes', '', 'The mill rep was friendly.', '', '## Transcript', '', '> [!quote]- Transcript · 10 minutes', '> **0:00** Morning all.', '>', '> **1:00** The retry fails.', '>', '> **5:00** We will ask Tessaly.'].join('\n');
  const out = W.replaceTranscriptStretch(note, 30, 90, [{ at: 60, text: 'The retry fails on Fridays.', who: 'Others' }]);
  assert.equal(out.replaced, 1);
  assert.ok(out.text.includes('> **1:00** *Others:* The retry fails on Fridays.'), 'the new line with its moment');
  assert.ok(!out.text.includes('> **1:00** The retry fails.\n'), 'the old line gone');
  assert.ok(out.text.includes('> **0:00** Morning all.') && out.text.includes('> **5:00** We will ask Tessaly.'), 'the rest of the transcript kept');
  assert.ok(out.text.includes('The mill rep was friendly.'), 'the person’s own words kept');
  // A stretch with no lines is filled at its chronological spot.
  const empty = W.replaceTranscriptStretch(note, 120, 180, [{ at: 150, text: 'Tessaly quoted the printer.' }]);
  assert.equal(empty.replaced, 0);
  assert.ok(empty.text.indexOf('Tessaly quoted') > empty.text.indexOf('**1:00**') && empty.text.indexOf('Tessaly quoted') < empty.text.indexOf('**5:00**'), 'between its neighbours');
});

test('an owner nobody named reads as no owner, never as a person', () => {
  const read = Mt.readAction('Send the signed quote to the mill — not assigned');
  assert.equal(read.what, 'Send the signed quote to the mill');
  assert.equal(read.who, undefined);
  const named = Mt.readAction('Send the signed quote to the mill — Sam — by Friday');
  assert.equal(named.who, 'Sam');
  const found = Mt.findActions('## Actions\n\n- [ ] Send the quote — not assigned · by 24 Oct 2026\n', { date: new Date(2026, 9, 21) });
  assert.equal(found[0].who, undefined);
  assert.equal(found[0].what, 'Send the quote');
});

// p9-minutes-actions-words (5 Nov 2026): a real run on Muse Spark 1.3 flagged Harbourline only
// for being said twice — noise when the meeting's words are otherwise consistent. Rare now means said once; a name
// like Ballman or a product word like Adyen said many times and spelt several ways is still caught, and an
// all-capitals word said twice or more gets one row (PCI heard as PCR can never be known from the transcript alone).

test('p9: a steady word said twice is consistent, not unsure; said once needs a clipped tail', () => {
  // Harbourline twice, as the run had it: mid-line once, opening a line once.
  const twice = [
    { at: 0, text: 'Morning all, let us start with the Harbourline cart.' },
    { at: 150, text: 'Harbourline drops one order in forty at payment.' },
  ];
  assert.deepEqual(W.findUncertain(twice, ['Priya Nair', 'Alex Chen']), [], 'said twice alike: no row');
  // Said once with nothing near: quiet now (n4 reason change — a real take's said-once words were all noise).
  const once = W.findUncertain([{ at: 0, text: 'We will ask Tessaly about the receipt printer.' }], ['Priya Nair', 'Alex Chen']);
  assert.deepEqual(once, [], 'said once with nothing near: no row');
  // Said once as a clipped tail of a word said steadily: still worth a row.
  const clip = [
    { at: 0, text: 'Fitzroy opens in March.' },
    { at: 30, text: 'Fitzroy opens in March.' },
    { at: 60, text: 'Fitzroy opens in March.' },
    { at: 90, text: 'We will ask Roy about the printer.' },
  ];
  const roy = W.findUncertain(clip, ['Priya Nair', 'Alex Chen']);
  assert.equal(roy.length, 1);
  assert.equal(roy[0].display, 'Roy');
  assert.equal(roy[0].reason, 'rare');
  assert.equal(roy[0].count, 1);
  // Said three times alike: consistent too.
  const thrice = [
    { at: 0, text: 'We will ask Tessaly about the printer.' },
    { at: 30, text: 'Tessaly quoted four thousand for it.' },
    { at: 60, text: 'Let us keep Tessaly as the supplier.' },
  ];
  assert.deepEqual(W.findUncertain(thrice, ['Priya Nair', 'Alex Chen']), [], 'said three times alike: no row');
});

test('p9: many times spelt several ways is still caught (Ballman, Adyen)', () => {
  const lines = [
    { at: 0, text: 'Ballman quoted the fit-out yesterday.' },
    { at: 30, text: 'We chased Ballmann twice this week.' },
    { at: 60, text: 'Ballman promised Friday delivery.' },
    { at: 90, text: 'Ballmann rang back this morning.' },
    { at: 120, text: 'Adyen settled the batch overnight.' },
    { at: 150, text: 'Adian held one payment back.' },
    { at: 180, text: 'Adyen cleared it by lunch.' },
  ];
  const found = W.findUncertain(lines, ['Priya Nair', 'Alex Chen']);
  const ballman = found.find((f) => f.spellings.includes('Ballmann'));
  assert.ok(ballman, `Ballman caught: ${JSON.stringify(found.map((f) => f.spellings))}`);
  assert.equal(ballman.reason, 'spelt-two-ways');
  assert.ok(ballman.count >= 4);
  const adyen = found.find((f) => f.spellings.includes('Adian'));
  assert.ok(adyen, `Adyen caught: ${JSON.stringify(found.map((f) => f.spellings))}`);
  assert.equal(adyen.reason, 'spelt-two-ways');
});

test('p9: an all-capitals word said twice or more gets one row with its context (PCI heard as PCR)', () => {
  const twice = [
    { at: 70, text: 'The PCR panel shows two failures.' },
    { at: 95, text: 'The PCR panel needs a second look.' },
  ];
  const found = W.findUncertain(twice, ['Priya Nair', 'Alex Chen']);
  assert.equal(found.length, 1, `one row: ${JSON.stringify(found.map((f) => f.display))}`);
  assert.equal(found[0].display, 'PCR');
  assert.deepEqual(found[0].spellings, ['PCR']);
  assert.equal(found[0].count, 2);
  assert.ok(found[0].spots[0].context.includes('PCR'), 'with its context');
  // Three times alike: still one row.
  const thrice = W.findUncertain([...twice, { at: 120, text: 'We will replace the PCR panel.' }], ['Priya Nair', 'Alex Chen']);
  assert.equal(thrice.length, 1);
  assert.equal(thrice[0].count, 3);
  // Wherever they stand: line openers in capitals are initialisms, not sentences.
  const openers = [
    { at: 0, text: 'PCR shows two failures tonight.' },
    { at: 30, text: 'PCR needs a second look.' },
  ];
  assert.equal(W.findUncertain(openers, ['Priya Nair', 'Alex Chen']).length, 1);
  // Read right it stays quiet: PCR the project already knows is never flagged.
  assert.deepEqual(W.findUncertain(twice, ['Priya Nair', 'Alex Chen', 'PCR']), [], 'a known initialism reads right');
  // Close to a known word it flags as close, with the likeliest spelling to prefill.
  const close = W.findUncertain(twice, ['Priya Nair', 'Alex Chen', 'PCI']);
  assert.equal(close.length, 1);
  assert.equal(close[0].reason, 'close-to-known');
  assert.equal(close[0].known, 'PCI');
});

test('speakers: labels are never flagged, and a lone product word stays quiet', () => {
  const lines = [
    { at: 0, text: 'The Speaker was loud today', who: 'Speaker 1' },
    { at: 5, text: 'We need Blackwood flour daily', who: 'Speaker 2' },
  ];
  const found = W.findUncertain(lines, KNOWN);
  assert.ok(!found.some((f) => /speaker/i.test(f.display)), `no speaker row: ${found.map((f) => f.display).join(', ')}`);
  // Said once with nothing near (n4 reason change — a real take's said-once words were all noise).
  assert.ok(!found.some((f) => f.display === 'Blackwood'), 'a lone product word stays quiet');
});

// m4-minutes-clean fault 5 (6 Nov 2026, the Fitzroy run flagged 19th, 27th, Alex's and Green as noise and
// missed "books counsel" for "books council"): dates, possessives of a known name and ordinary words never flag;
// a wrong word that makes no sense in its sentence is offered once. Invented meeting words, safe to keep.
test('m4: dates, possessives and ordinary words stay quiet; a wrong word is offered once', () => {
  const lines = [
    { at: 0, text: 'Morning Alex. On the opening date, the fit-out is tracking well.', who: 'Others' },
    { at: 20, text: "On Alex's line, the revised drawing is locked.", who: 'You' },
    { at: 40, text: 'The joiners can install on Thursday the 19th of November.', who: 'You' },
    { at: 60, text: 'We can open Friday the 27th of November.', who: 'You' },
    { at: 80, text: 'Green beans from David Kim arrive on the 20th.', who: 'You' },
    { at: 80, text: 'green beans from David Kim arrive on the 20th.', who: 'Others' },
    { at: 100, text: 'Noah, what about the council inspection?', who: 'You' },
    { at: 120, text: 'Council can do the final inspection in the week of the 16th.', who: 'Others' },
    { at: 140, text: 'The council date works for the joiners.', who: 'You' },
    { at: 160, text: 'Noah books counsel by Monday the 9th.', who: 'You' },
    { at: 160, text: 'Noah books counsel by Monday the 9th.', who: 'Others' },
  ];
  const known = ['Alex Rivera', 'Mia Chen', 'Kate Sullivan', 'Noah Patel'];
  const found = W.findUncertain(lines, known);
  const spellings = found.flatMap((f) => f.spellings);
  for (const noise of ['19th', '27th', "Alex's", 'Green', '20th', '16th', '9th']) assert.ok(!spellings.includes(noise), `${noise} stays quiet: ${JSON.stringify(spellings)}`);
  const counsel = found.find((f) => f.spellings.includes('counsel'));
  assert.ok(counsel, `counsel offered: ${JSON.stringify(found.map((f) => f.display))}`);
  assert.equal(counsel.known, 'council');
  assert.equal(found.length, 1, 'one row');
});

// m7-minutes-last fault 5 (6 Nov 2026, the Fitzroy run flagged "stock" as noise and missed "Pittsroy"
// for "Fitzroy" and "tils" for "tills", both said steadily): a near-spelling of a word the meeting says many
// times, said once, is offered ask-first; two ordinary words merely alike stay quiet. Invented meeting words.
test('m7: a near-spelling of a steady word is offered; ordinary lookalikes stay quiet', () => {
  const lines = [
    { at: 0, text: 'Morning all, the Dranfield winches are on the dock.', who: 'Others' },
    { at: 30, text: 'Two new winches for the Dranfield dock arrived today.', who: 'You' },
    { at: 30, text: 'Two new winches for the Dranfield dock arrived today.', who: 'Others' },
    { at: 60, text: 'Tranfield quoted the green winchs by Friday.', who: 'You' },
    { at: 90, text: 'The green grain tally can wait till Monday.', who: 'Others' },
    { at: 120, text: 'Green crates hold the spare grain scoops.', who: 'You' },
  ];
  const found = W.findUncertain(lines, ['Priya Nair', 'Alex Chen']);
  const bySpelling = (w) => found.find((f) => f.spellings.includes(w));
  const tranfield = bySpelling('Tranfield');
  assert.ok(tranfield, `Tranfield offered: ${JSON.stringify(found.map((f) => f.display))}`);
  assert.equal(tranfield.reason, 'close-to-known');
  assert.equal(tranfield.known, 'Dranfield');
  const winchs = bySpelling('winchs');
  assert.ok(winchs, `winchs offered: ${JSON.stringify(found.map((f) => f.display))}`);
  assert.equal(winchs.reason, 'close-to-known');
  assert.equal(winchs.known, 'winches');
  const spellings = found.flatMap((f) => f.spellings);
  for (const quiet of ['green', 'Green', 'grain']) assert.ok(!spellings.includes(quiet), `${quiet} stays quiet: ${JSON.stringify(spellings)}`);
  assert.equal(found.length, 2, 'two rows, nothing else');
});

// n4-minutes-pdf fault 2 (6 Nov 2026, a real take raised 11 with 8 noise — said-once Green, David, Kim
// and Brunswick, Fit/Fix, stock/stone/store, joiners/joinery, delivery/deliveries — while Noah/NOAA,
// Merrick's and Marix were useful): barely-said words with nothing near stay quiet, in every shape the take
// showed, and the useful shapes stay. Invented meeting words, safe to keep.
test('n4: said-once strays stay quiet; nearness still flags', () => {
  const lines = [
    { at: 0, text: 'Morning all, Fitzroy opens in March with the usual crew.', who: 'Others' },
    { at: 30, text: 'Fitzroy opens in March with the usual crew.', who: 'You' },
    { at: 60, text: 'Fitzroy opens in March with the usual crew.', who: 'Others' },
    { at: 90, text: 'Spare Green crates from David Okafor hold the Marix valves, said Wren.', who: 'You' },
  ];
  const known = ['Priya Nair', 'Alex Chen'];
  const found = W.findUncertain(lines, known);
  const spellings = found.flatMap((f) => f.spellings);
  for (const quiet of ['Green', 'David', 'Okafor', 'Marix', 'Wren']) assert.ok(!spellings.includes(quiet), `${quiet} stays quiet: ${JSON.stringify(spellings)}`);
  assert.deepEqual(found, [], 'no row at all');
  // The same Marix with a near vault word is worth a row (the take suggested Mark, wrongly but usefully).
  const marix = W.findUncertain(lines, [...known, 'Mark']);
  assert.equal(marix.length, 1);
  assert.equal(marix[0].display, 'Marix');
  assert.equal(marix[0].reason, 'close-to-known');
  assert.equal(marix[0].known, 'Mark');
  // A prefix of a known word is its own word, not a clip ("Fit" starting "Fitzroy").
  const fit = W.findUncertain([{ at: 0, text: 'The Fit crew is tracking well.' }], [...known, 'Fitzroy Hall']);
  assert.deepEqual(fit, [], 'a prefix stays quiet');
});

// n4-minutes-pdf fault 2, the lowercase shapes: a twice-said almost-word is not steady enough to correct by,
// one word inside another is a form of it, singulars and plurals are different words, and each spelling gets
// its own row — while a real mishear against a steady word is still offered. Invented mill words.
test('n4: steady means three times; forms and plurals stay quiet; each spelling its own row', () => {
  const lines = [
    { at: 0, text: 'Council can inspect the mill.', who: 'You' },
    { at: 10, text: 'Council can inspect the mill.', who: 'Others' },
    { at: 20, text: 'Council can inspect the mill.', who: 'You' },
    { at: 30, text: 'Noah books counsel by Monday.', who: 'You' },
    { at: 40, text: 'The stone bench lands Friday.', who: 'You' },
    { at: 50, text: 'The stone bench lands Friday.', who: 'Others' },
    { at: 60, text: 'The Fitzroy store opens soon.', who: 'You' },
    { at: 70, text: 'Till training starts Monday.', who: 'You' },
    { at: 80, text: 'Till training starts Monday.', who: 'Others' },
    { at: 90, text: 'Till training starts Monday.', who: 'You' },
    { at: 100, text: 'We will train the crew on Monday.', who: 'You' },
    { at: 110, text: 'Confirm the delivery date soon.', who: 'You' },
    { at: 120, text: 'Confirm the delivery date soon.', who: 'Others' },
    { at: 130, text: 'Confirm the delivery date soon.', who: 'You' },
    { at: 140, text: 'Start the morning deliveries early.', who: 'You' },
  ];
  const found = W.findUncertain(lines, ['Priya Nair']);
  assert.equal(found.length, 1, `one row: ${JSON.stringify(found.map((f) => f.display))}`);
  assert.equal(found[0].display, 'counsel');
  assert.deepEqual(found[0].spellings, ['counsel'], 'this spelling only, never its group');
  assert.equal(found[0].known, 'Council');
});

// n4-minutes-pdf fault 2: the list shows the best 5, ordered by how likely each is wrong — two spellings
// first, then nearness, fewer sayings first within each.
test('n4: the best 5 show, likeliest first', () => {
  assert.equal(W.CHECK_LIMIT, 5);
  const lines = [
    { at: 0, text: 'We chased Nairr twice today.' },
    { at: 10, text: 'Then Nayer rang back and Nayer wrote soon.' },
    { at: 20, text: 'Ballman quoted the job today.' },
    { at: 30, text: 'So Ballman sent terms and Ballman rang back.' },
    { at: 40, text: 'We chased Ballmann twice today.' },
    { at: 50, text: 'Then Ballmann wrote back soon.' },
    { at: 60, text: 'We asked Quil about terms.' },
    { at: 70, text: 'Then Bril rang and Bril wrote soon.' },
    { at: 80, text: 'Stil quoted terms and Stil rang and Stil wrote.' },
    { at: 90, text: 'Gril quoted and Gril rang and Gril wrote and Gril billed.' },
  ];
  const found = W.findUncertain(lines, ['Priya Nair', 'Quill', 'Brill', 'Stall', 'Grill']);
  assert.deepEqual(found.map((f) => f.display), ['Nayer', 'Ballman', 'Quil', 'Bril', 'Stil'], 'two ways first, fewer sayings first, the sixth cut');
});

// n4-minutes-pdf fault 4 (6 Nov 2026, the Fitzroy run's "Fixed 9 copies and remembered" toast had no
// Undo): a fix taken back forgets what it remembered, from the project and the people list — and never a
// newer correction of the same word. Invented spellings, safe to keep.
test('n4: Undo forgets the remembered word, never a newer correction', async () => {
  const store = new Map();
  globalThis.window = { nv: { state: { load: async (n) => store.get(n) ?? null, save: async (n, v) => void store.set(n, JSON.parse(JSON.stringify(v))) } } };
  try {
    await WF.rememberFix('Projects/Undo.md', ['Zeler'], 'Zeller', false);
    await WF.rememberFix('Projects/Undo.md', ['June Zeler'], 'June Zeller', true);
    assert.equal(WF.fixesFor('Projects/Undo.md').zeler, 'Zeller');
    await WF.forgetFix('Projects/Undo.md', ['Zeler'], 'Zeller', false);
    assert.ok(!('zeler' in WF.fixesFor('Projects/Undo.md')), 'the project fix forgotten');
    assert.equal(WF.fixesFor('Projects/Undo.md')['june zeler'], 'June Zeller', 'the other fix kept');
    await WF.forgetFix('Projects/Undo.md', ['June Zeler'], 'June Zeller', true);
    assert.ok(!('june zeler' in WF.fixesFor('Projects/Undo.md')), 'the people fix forgotten too');
    assert.ok(!('june zeler' in WF.fixesFor('Projects/Elsewhere.md')), 'gone everywhere');
    // A newer correction of the same word survives an older Undo.
    await WF.rememberFix('Projects/Undo.md', ['Zeler'], 'Zeller', false);
    await WF.rememberFix('Projects/Undo.md', ['Zeler'], 'Zellar', false);
    await WF.forgetFix('Projects/Undo.md', ['Zeler'], 'Zeller', false);
    assert.equal(WF.fixesFor('Projects/Undo.md').zeler, 'Zellar', 'the newer correction kept');
    // The card offers the Undo that restores the copies and forgets the word.
    const card = readFileSync(path.join(root, 'src/renderer/src/views/MeetingMinutes.tsx'), 'utf8');
    assert.ok(card.includes("label: 'Undo'") && card.includes('forgetFix(projectKey, f.spellings, value, person)'), 'Fix every copy offers Undo for the copies and the word');
    assert.ok(card.includes('The note changed since, so nothing was undone.'), 'the note judges, as the minutes’ Undo does');
  } finally {
    delete globalThis.window;
  }
});

test('remembered fixes ride next time: stored per project and people, applied as whole words', async () => {
  const store = new Map();
  globalThis.window = { nv: { state: { load: async (n) => store.get(n) ?? null, save: async (n, v) => void store.set(n, JSON.parse(JSON.stringify(v))) } } };
  try {
    await WF.rememberFix('Projects/Cart.md', ['Nairr', 'Nayer'], 'Nair', false);
    await WF.rememberFix('Projects/Cart.md', ['Priya Nairr'], 'Priya Nair', true);
    assert.deepEqual(WF.fixesFor('Projects/Cart.md'), { nairr: 'Nair', nayer: 'Nair', 'priya nairr': 'Priya Nair' });
    assert.deepEqual(WF.fixesFor('Projects/Other.md'), { 'priya nairr': 'Priya Nair' }, 'people ride everywhere');
    assert.equal(WF.fixText('Nairr and nayer met.', WF.fixesFor('Projects/Cart.md')), 'Nair and Nair met.');
    assert.deepEqual(WF.fixHintWords('Projects/Cart.md').sort(), ['Nair', 'Priya Nair']);
  } finally {
    delete globalThis.window;
  }
});

// e2-meeting-faults fault 1 (6 Nov 2026, the Fitzroy take on 10.1.4: "Noted: close to Notes" and
// "Leave: close to Lease" were noise, and "Marix" got "Mark" while the same meeting said
// "Merrick's Creek"): a common word whose capital is only its sentence's is no doubt from nearness
// alone, and two spellings in the same name's slot in this meeting are one word to check, its
// suggestion from this meeting's and the vault's names first. The take's own scripted words.
test('e2: sentence words stay quiet; one name in two spellings is one row with the meeting suggestion', () => {
  const lines = [
    { at: 0, text: "Right. Doors shut. Mind the wall. The paint's still wet. Noted.", who: 'You' },
    { at: 60, text: "And the menu boards? They still need printing before opening week. We haven't agreed who owns that. Leave it open?", who: 'You' },
    { at: 120, text: 'Leave it open. Last one, the milk. We agreed last week to move to Marix Creek Dairy for both stores.', who: 'Others' },
    { at: 180, text: "Can you ring Merrick's Creek today and confirm the first delivery in writing?", who: 'You' },
  ];
  const known = ['Alex Rivera', 'Kate Sullivan', 'Mark Doyle', 'Notes', 'Brunswick Site Lease Renewal', 'Merricks Creek Dairy'];
  const found = W.findUncertain(lines, known);
  const spellings = found.flatMap((f) => f.spellings);
  for (const quiet of ['Noted', 'Leave']) assert.ok(!spellings.includes(quiet), `${quiet} stays quiet: ${JSON.stringify(spellings)}`);
  assert.equal(found.length, 1, `one row: ${JSON.stringify(found.map((f) => f.display))}`);
  assert.deepEqual(found[0].spellings, ['Marix', "Merrick's"], 'both spellings of the one name, so one fix mends every copy');
  assert.equal(found[0].reason, 'spelt-two-ways');
  assert.equal(found[0].known, 'Merricks', "the meeting's own supplier name, never a person's first name");
});

// t169-meeting-faults-narrow (9 Nov 2026, t166's Michael/Mitchell mix-up: the transcript named Michael Roberts
// while Sarah Mitchell was known, and the check grouped them as one spelling and prefilled Mitchell for Michael —
// one "Fix every copy" from renaming a person everywhere, then remembered for every later transcript). Close names
// never swap without the person's say: two different names are never one spelling, nor suggested for each other.
test('t169: close names never swap: Michael stays Michael where Mitchell is known', () => {
  const known = ['Sarah Mitchell', 'Priya Sharma'];
  // Both said: two people, never one "spelt two ways" row.
  const both = [
    { at: 10, text: 'Michael Roberts will draft the move notice for staff.' },
    { at: 40, text: 'Sarah Mitchell and Priya Sharma reviewed the network window.' },
  ];
  assert.deepEqual(W.findUncertain(both, known), [], 'two full names never merge');
  // Only Michael said, in full: never offered Mitchell.
  const full = [{ at: 10, text: 'Michael Roberts will draft the move notice for staff.' }];
  assert.deepEqual(W.findUncertain(full, known), [], 'a full name never takes another name’s part');
  // Only Michael said, bare: never offered Mitchell either.
  const bare = [{ at: 10, text: 'Ring Michael each Friday about the landlord.' }];
  assert.deepEqual(W.findUncertain(bare, known), [], 'three changed letters in a name is a different name');
  // A Mitchell said once where Michael said steadily is a different person, never a misspelling.
  const steady = [
    { at: 0, text: 'Michael opened the review today.' },
    { at: 30, text: 'Michael took the actions home.' },
    { at: 60, text: 'Then Michael closed the review.' },
    { at: 90, text: 'Mitchell sent the photos over.' },
  ];
  assert.deepEqual(W.findUncertain(steady, []), [], 'steadiness never swaps a name');
  // A genuine slip still flags: one letter off Mitchell, in full or bare.
  const slip = [{ at: 10, text: 'Sarah Mitchel will draft the move notice.' }];
  const slipFound = W.findUncertain(slip, known);
  assert.equal(slipFound.length, 1);
  assert.equal(slipFound[0].known, 'Mitchell');
  const bareSlip = [{ at: 0, text: 'Nayer chased the mill today.' }];
  assert.equal(W.findUncertain(bareSlip, ['Priya Nair'])[0].known, 'Nair', 'a two-letter slip still flags');
});
