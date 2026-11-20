// node --test tests/t244-guessing-30.test.mjs — the guessing bar on real-shaped mail (t244 break-it, 12 Nov
// 2026). Banks, newsletters and family must not file into a work project on one word — however long the word
// and however recent the work (t244: "Refit your kitchen" filed to the back-room refit on "refit" alone, and
// "The cart is fixed" filed on "cart" with recency pushing it over). Thirty-four cases, each with its
// expected answer written first: the capture box preselects nothing for them, and the Inbox offers no
// project. Work mail with two words, a person or the whole name still files. Made-up mail throughout.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t244-guess-'));
let C, S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/capture.ts'))};\n` + `export * as inbox from ${JSON.stringify(path.join(root, 'src/shared/inbox.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'g.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    (await import('node:fs')).symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  } catch {}
  const all = await import(pathToFileURL(path.join(work, 'g.mjs')).href);
  C = all;
  S = all.inbox;
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date('2026-11-12T09:00:00').getTime();
const day = 86400000;
// The cart fix worked an hour ago and captured last: the most recency any project can carry (14 points),
// so a case passing here passes however recent the work.
const PROJECTS = [
  { path: 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', name: 'Harbourline Cart Fix', folderName: 'Harbourline Cart Fix', people: ['Alex Chen'], tags: [], modified: NOW - 3600000 },
  { path: 'Projects/The December refit of the back room/The December refit of the back room.md', name: 'The December refit of the back room', folderName: 'Back Room Refit', people: ['June Park'], tags: [], modified: NOW - 9 * day },
  { path: 'Projects/ShadeCo Awning Quote/ShadeCo Awning Quote.md', name: 'ShadeCo Awning Quote', people: ['Sam Ortega'], tags: [], modified: NOW - 2 * day },
];
const RECENT = ['Projects/Harbourline Cart Fix/Harbourline Cart Fix.md'];
const ctx = () => ({ projects: PROJECTS, people: [], areas: [], resolve: () => null });

test('banks, newsletters, family and everyday mail: never a work project on one word', () => {
  // [text, why it must not file]
  const cases = [
    ['Your bank statement for October is ready to view', 'a bank statement names no project'],
    ['Your credit card payment of $184.20 is due this Friday', 'card is not cart'],
    ['We wrote back about your dispute from Saturday', 'back alone (the t243 case)'],
    ['Your term deposit matures 12 December', 'december alone, however long'],
    ['Home loan refix options inside', 'refix is not refit'],
    ['A quick quote on your insurance renewal', 'quote alone'],
    ['New security room upgrades at our branches', 'room alone'],
    ['Win a backyard makeover this summer', 'backyard is not back'],
    ['The weekend newsletter: ten slow recipes for autumn', 'a newsletter names no project'],
    ['Back to school guide 2026', 'back alone'],
    ['Room by room: style ideas for renters', 'room alone'],
    ['How we fixed our cart abandonment', 'cart alone, however recent the work'],
    ['December gift guide for gardeners', 'december alone'],
    ['Refit your kitchen on a budget', 'refit alone'],
    ['Get a quote in minutes, no calls needed', 'quote alone'],
    ['Meet the makers behind the harbour festival', 'harbour is not harbourline'],
    ['Mum says dinner is at six on Sunday', 'family names no project'],
    ['Can you ring me back tonight', 'back alone'],
    ['The spare room is yours if you want it', 'room alone'],
    ['Dad fixed the cart wheels on the trolley', 'cart alone, however recent the work'],
    ['Weekend at the beach house, bring towels', 'family names no project'],
    ['Happy birthday, love from us all', 'family names no project'],
    ['Your parcel arrived at the back door', 'back alone'],
    ['School pickup is at three today', 'family names no project'],
    ['Reminder: car service due next month', 'everyday mail names no project'],
    ['The new menu for Friday night', 'everyday mail names no project'],
    ['Power bill due Thursday, $184.20', 'everyday mail names no project'],
    ['Gym membership paused until March', 'everyday mail names no project'],
    ['The cart is fixed and rolling again', 'cart alone, however recent the work'],
  ];
  assert.ok(cases.length >= 30 - 5, `${cases.length} no-file cases plus the file cases below clear 30`);
  for (const [text, why] of cases) {
    const s = C.suggestProjects({ text, projects: PROJECTS, now: NOW, recent: RECENT, max: 3 });
    assert.equal(C.chosenSuggestion(s), null, `"${text}" preselects nothing (${why})`);
    const filing = S.suggestFiling({ words: text, text, links: [], task: false }, ctx());
    assert.ok(!filing.some((f) => f.target.kind === 'project'), `"${text}" offers no project (${why}): ${JSON.stringify(filing)}`);
  }
});

test('work mail still files: two words, a person, or the whole name', () => {
  const cases = [
    ['Harbourline Cart Fix: the cart failed again on Friday', 'Harbourline Cart Fix'],
    ['Back room rewire quotes are in', 'The December refit of the back room'],
    ['ShadeCo awning quote lapses Friday', 'ShadeCo Awning Quote'],
    ['Meeting with Alex Chen about the cart retry', 'Harbourline Cart Fix'],
    ['June Park confirmed the refit dates', 'The December refit of the back room'],
  ];
  for (const [text, want] of cases) {
    const s = C.suggestProjects({ text, projects: PROJECTS, now: NOW, recent: RECENT, max: 3 });
    assert.equal(C.chosenSuggestion(s)?.name, want, `"${text}" files to ${want}`);
    const filing = S.suggestFiling({ words: text, text, links: [], task: false }, ctx());
    assert.equal(filing[0]?.target.name, want, `"${text}" offers ${want} first`);
  }
});

test('a name said as a name still finds its project; a capital alone does not (12 Nov 2026)', () => {
  // The supplier email of the front-door walk: "Harbourline" in the subject and mid-sentence in the body.
  // (The vault here also holds a ShadeCo awning project, so the words below avoid "awning" and "quote".)
  const supplier = 'Harbourline signage proof\nHi,\nYour Harbourline shop signage proof is attached, and December books fill fast.\nHarbourline-signage-proof.pdf';
  const s = C.suggestProjects({ text: supplier, projects: PROJECTS, now: NOW, recent: RECENT, max: 3 });
  assert.equal(C.chosenSuggestion(s)?.name, 'Harbourline Cart Fix', 'a distinctive name said twice, once mid-sentence, files');
  assert.equal(C.saidAsName('Your Harbourline shop. Harbourline again', 'Harbourline'), true);
  // Not a name: once only; only at line starts; a month; lower case.
  const not = [
    ['Harbourline signage proof attached', 'once only'],
    ['Refit your kitchen on a budget.\nRefit tips inside.', 'only at the start of lines'],
    ['December books fill fast, so see you in December for the December sale', 'a month always has a capital'],
    ['the harbourline shop and the harbourline cafe', 'never written as a name'],
  ];
  for (const [text, why] of not) {
    const r = C.suggestProjects({ text, projects: PROJECTS, now: NOW, recent: RECENT, max: 3 });
    assert.equal(C.chosenSuggestion(r), null, `"${text}" preselects nothing (${why})`);
  }
});
