// node --test tests/questions.test.mjs — Questions are their own kind (t238 vault rebuild step 1, 12 Nov 2026). A
// question asked in a meeting had nowhere to live; now it reads from the note's Questions section with asked by,
// asked of or owned by, where (the note), when, answered or not, and the answer. An answered question keeps its
// answer and becomes a task or a decision in one click. Made-up meetings only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-questions-'));
let Q, MT;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/questions.ts'))};\n` + `export * as meetings from ${JSON.stringify(path.join(root, 'src/shared/meetings.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'q.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  const all = await import(pathToFileURL(path.join(work, 'q.mjs')).href);
  Q = all;
  MT = all.meetings;
});
after(() => rmSync(work, { recursive: true, force: true }));

const MEETING = ['---', 'type: meeting', 'date: 2026-11-10', 'project: "[[Harbourline Cart Fix]]"', '---', '# Tuesday standup', '', '## Agenda', '', '- The retry fix', '', '## Notes', '', 'Priya asked whether the receipt shows the tax line.', '', '## Actions', '', '- [ ] Send the receipt v2 — Alex Chen', '', '## Questions', '', '- ? Does the receipt show the tax line? — asked by Priya Nair — for Alex Chen', '- ? Who signs off the till logs? — asked by June Park — answer: the shop manager signs', '- ? What time is the soak test?', '', '## Decisions', '', '- Retry twice, then fail loud', ''].join('\n');

test('questions read with asked by, owned by, answered and the answer', () => {
  const found = Q.findQuestions(MEETING);
  assert.equal(found.length, 3);
  assert.deepEqual([found[0].what, found[0].askedBy, found[0].owner, found[0].answered], ['Does the receipt show the tax line?', 'Priya Nair', 'Alex Chen', false]);
  assert.deepEqual([found[1].what, found[1].askedBy, found[1].answer, found[1].answered], ['Who signs off the till logs?', 'June Park', 'the shop manager signs', true]);
  assert.deepEqual([found[2].what, found[2].askedBy, found[2].answered], ['What time is the soak test?', undefined, false]);
});

test('only under a Questions heading: prose, actions and decisions never read', () => {
  const found = Q.findQuestions(MEETING);
  assert.ok(found.every((q) => q.line > MEETING.split('\n').findIndex((l) => l === '## Questions')));
  assert.equal(found.filter((q) => q.what.includes('Retry twice')).length, 0);
  assert.equal(Q.findQuestions('## Actions\n\n- ? Is this an action?\n').length, 0, 'a ? line under Actions is not a question');
  assert.equal(Q.findQuestions('No questions section here.\n\n- ? Is this read?\n').length, 0, 'no section, no questions');
});

test('a question line is never an action or a task', () => {
  const actions = MT.findActions(MEETING, { date: new Date(2026, 10, 10) });
  assert.ok(actions.every((a) => !a.what.includes('?') || !a.raw.includes('? ')), 'no question among the actions');
  assert.equal(actions.filter((a) => a.what.startsWith('?')).length, 0);
  assert.equal(MT.findActions('## Actions\n\n- ? Is this an action?\n', {}).length, 0, 'not an action even under Actions');
});

test('names read through [[links]], answers keep their dashes', () => {
  const found = Q.findQuestions('## Questions\n\n- ? Who approves it? — asked by [[Priya Nair]] — for [[Alex Chen]]\n- ? What did they say? — answer: yes — with the tax line fixed\n');
  assert.deepEqual([found[0].askedBy, found[0].owner], ['Priya Nair', 'Alex Chen']);
  assert.equal(found[1].answer, 'yes — with the tax line fixed');
  assert.equal(found[1].answered, true);
});

test('questions in fenced code and the properties are left out', () => {
  const text = '---\ntitle: "- ? not a question"\n---\n# Note\n\n```\n- ? not a question either\n```\n\n## Questions\n\n- ? A real one\n';
  const found = Q.findQuestions(text);
  assert.deepEqual(found.map((q) => q.what), ['A real one']);
});

test('a question line written the one plain way', () => {
  assert.equal(Q.questionLine('Who signs off?', { askedBy: 'June Park', owner: 'Alex Chen' }), '- ? Who signs off? — asked by June Park — for Alex Chen');
  assert.equal(Q.questionLine('Who signs off?', { answer: 'the manager' }), '- ? Who signs off? — answer: the manager');
  assert.equal(Q.questionLine('Who signs off?'), '- ? Who signs off?');
});

test('answering sets the answer tail and keeps the rest', () => {
  const lines = MEETING.split('\n');
  const at = lines.findIndex((l) => l.includes('Does the receipt show'));
  const next = Q.answerQuestionLine(MEETING, at, lines[at], 'yes, every line including tax');
  assert.ok(next.includes('- ? Does the receipt show the tax line? — asked by Priya Nair — for Alex Chen — answer: yes, every line including tax'));
  const found = Q.findQuestions(next);
  assert.equal(found[0].answered, true);
  assert.equal(found[0].answer, 'yes, every line including tax');
  assert.equal(found[0].askedBy, 'Priya Nair', 'asked by kept');
  assert.equal(Q.answerQuestionLine(MEETING, 9999, '- ? gone', 'x'), null, 'a moved line is said, never misapplied');
});

test('an answered question becomes a task or a decision in one click', () => {
  const found = Q.findQuestions(MEETING);
  assert.equal(Q.questionTaskLine(found[1]), '- [ ] Who signs off the till logs? — June Park');
  assert.equal(Q.questionDecisionLine(found[1]), '- Who signs off the till logs? — the shop manager signs');
  assert.equal(Q.questionTaskLine(found[0]), '- [ ] Does the receipt show the tax line? — Alex Chen', 'owned by wins over asked by');
  assert.equal(Q.questionDecisionLine(found[2]), '- What time is the soak test?');
});
