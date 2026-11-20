// node --test tests/template-fields.test.mjs — Template fields (src/shared/template-fields.ts, src/shared/templates.ts;
// 21 Oct 2026, gap G27): prompts asked once with what they fill in to start, dates and date arithmetic, the cursor's place,
// AI fields read back plain and short, answers cleaned, and nothing in a template ever run. A fixed now (Wednesday
// 21 October 2026, 9:30 am).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-template-fields-'));
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/template-fields.ts'))};\nexport { noteFromTemplate, bodyOfTemplate } from ${JSON.stringify(path.join(root, 'src/shared/templates.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date(2026, 9, 21, 9, 30);
const VARS = { title: 'Kick-off', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', now: NOW };

test('the fields a template has: prompts once each (with what they fill in), AI fields, the cursor', () => {
  const t = 'Client: {{prompt:Client name}}\nAgain: {{ prompt : client name }}\nBudget: {{prompt:Budget|$5,000}}\n{{ai:one-line summary of the project}}\n{{cursor}}';
  assert.deepEqual(F.templateFields(t), { prompts: [{ label: 'Client name', fallback: '' }, { label: 'Budget', fallback: '$5,000' }], ai: ['one-line summary of the project'], cursor: true });
  assert.deepEqual(F.templateFields('Just words {{title}}'), { prompts: [], ai: [], cursor: false });
});

test('prompts take their answers (a name asked once fills every place), else what they fill in, else nothing', () => {
  const t = '# {{prompt:Client name}} kick-off\nWith {{prompt:client name}}. Budget {{prompt:Budget|$5,000}}. Site {{prompt:Site}}.';
  assert.equal(F.fillFields(t, { prompts: { 'Client name': 'Acme Bakery' } }), '# Acme Bakery kick-off\nWith Acme Bakery. Budget $5,000. Site .');
  assert.equal(F.fillFields(t, { prompts: { 'Client name': 'Acme', Budget: '$9,000', Site: 'Geelong' } }), '# Acme kick-off\nWith Acme. Budget $9,000. Site Geelong.');
  assert.equal(F.fillFields(t, { preview: true }), '# ‹Client name› kick-off\nWith ‹client name›. Budget $5,000. Site ‹Site›.');
});

test('an answer inside the properties stays one safe line', () => {
  const t = '---\nclient: "{{prompt:Client}}"\n---\nNotes for {{prompt:Client}}\n';
  const out = F.fillFields(t, { prompts: { Client: 'Acme "Fresh"\nBakery' } });
  assert.equal(out, '---\nclient: "Acme ”Fresh” Bakery"\n---\nNotes for Acme "Fresh"\nBakery\n');
});

test('dates and date arithmetic, with prompts, in a note made from a template', () => {
  const t = '---\ndate: {{date}}\nclient: "{{prompt:Client name}}"\nreview: {{date+7d}}\ndescription: "A kick-off"\n---\n# {{title}} with {{prompt:Client name}}\n\nFollow up by {{date+2w:D MMM YYYY}} (last week was {{date-1w:D MMM}}).\n\n## Notes\n\n{{cursor}}\n';
  const made = F.noteFromTemplate(t, { ...VARS, answers: { prompts: { 'Client name': 'Acme' }, cursor: true } });
  const { text, cursor } = F.takeCursor(made);
  assert.equal(text, '---\ndate: 2026-10-21\nclient: "Acme"\nreview: 2026-10-28\n---\n# Kick-off with Acme\n\nFollow up by 4 Nov 2026 (last week was 14 Oct).\n\n## Notes\n\n\n');
  assert.deepEqual(cursor, { line: 11, ch: 0, offset: text.indexOf('## Notes') + '## Notes\n\n'.length });
  // An empty prompt in the properties leaves the property out rather than writing an empty one.
  assert.ok(!F.noteFromTemplate(t, VARS).includes('client:'));
});

test('the cursor: kept once (the first, never in the properties) when asked for, else taken out', () => {
  assert.deepEqual(F.takeCursor(F.fillFields('ab{{cursor}}cd\n{{cursor}}e', { cursor: true })), { text: 'abcd\ne', cursor: { line: 0, ch: 2, offset: 2 } });
  assert.equal(F.fillFields('ab{{cursor}}cd', {}), 'abcd');
  assert.deepEqual(F.takeCursor('no mark'), { text: 'no mark', cursor: null });
  assert.equal(F.takeCursor(F.fillFields('---\nx: {{cursor}}\n---\nwords', { cursor: true })).cursor, null);
  // Inserted into a note with words already: only the body, the cursor's place within it.
  const body = F.takeCursor(F.bodyOfTemplate('---\ntype: meeting\n---\n## Actions\n- [ ] {{cursor}}\n', { ...VARS, answers: { cursor: true } }));
  assert.equal(body.text, '## Actions\n- [ ] \n');
  assert.deepEqual(body.cursor, { line: 1, ch: 6, offset: 17 });
});

test('nothing in a template is ever run: scripts and other braces stay exactly as written', () => {
  globalThis.__nvRan = false;
  const t = [
    '<% tp.file.title %>',
    '<%* globalThis.__nvRan = true %>',
    '{{js: globalThis.__nvRan = true}}',
    '{{eval globalThis.__nvRan = true}}',
    '{{prompt:Name}} and {{unknown thing}}',
    '{{ai:summary}}',
  ].join('\n');
  const out = F.noteFromTemplate(t, { ...VARS, answers: { prompts: { Name: '${globalThis.__nvRan = true}' }, ai: { summary: '<%* globalThis.__nvRan = true %>' } } });
  assert.equal(globalThis.__nvRan, false);
  assert.ok(out.startsWith('<% tp.file.title %>\n<%* globalThis.__nvRan = true %>\n{{js: globalThis.__nvRan = true}}\n{{eval globalThis.__nvRan = true}}\n'));
  assert.ok(out.includes('${globalThis.__nvRan = true} and {{unknown thing}}'), 'an answer is words, put in as written');
  // An answer is put in once: braces in it are never read again as a field.
  assert.equal(F.fillFields('{{prompt:A}}', { prompts: { A: '{{prompt:B}} {{cursor}}' } }), '{{prompt:B}} {{cursor}}');
  delete globalThis.__nvRan;
});

test('AI fields: asked with the note’s name, its project and the answers; read back plain and short', () => {
  const ask = F.aiFieldsPrompt({ asks: ['one-line summary of the project'], title: 'Kick-off', project: 'Harbour Fit-out', projectSummary: 'Fit out the harbour shop.', answers: { 'Client name': 'Acme' }, today: 'Wednesday 21 October 2026' });
  assert.match(ask, /Kick-off/);
  assert.match(ask, /Harbour Fit-out/);
  assert.match(ask, /Fit out the harbour shop/);
  assert.match(ask, /Client name: Acme/);
  assert.match(ask, /- one-line summary of the project/);
  assert.match(F.AI_FIELDS_SYSTEM, /JSON only/);
  assert.match(F.AI_FIELDS_SYSTEM, /New Zealand\/Australian spelling/);
  assert.doesNotMatch(F.AI_FIELDS_SYSTEM, /plain Australian English/);
  const asks = ['one-line summary of the project', 'first risk'];
  assert.deepEqual(F.readAiFields({ fields: { 'One-line summary of the project': '  "Fitting out the harbour shop for Acme."  ', 'first risk': '```js\nalert(1)\n```Late joinery <b>delivery</b>', extra: 'not asked' } }, asks), {
    'one-line summary of the project': 'Fitting out the harbour shop for Acme.',
    'first risk': 'Late joinery delivery',
  });
  assert.deepEqual(F.readAiFields({ fields: { 'first risk': 42 } }, asks), {}, 'only words');
  assert.deepEqual(F.readAiFields(null, asks), {});
  assert.equal(F.readAiFields({ fields: { 'first risk': 'x'.repeat(5000) } }, asks)['first risk'].length, F.MAX_AI_WORDS);
  // The words fill the field.
  assert.equal(F.fillFields('Summary: {{ai:one-line summary of the project}}', { ai: { 'one-line summary of the project': 'Fitting out.' } }), 'Summary: Fitting out.');
  assert.equal(F.fillFields('Summary: {{ai:one-line summary of the project}}', {}), 'Summary: ');
});

test('answers sent from the window are cleaned: words only, so many, so long', () => {
  assert.deepEqual(F.cleanAnswers({ prompts: { Client: 'Acme', Bad: 42, '  Spaced   name ': 'x' }, ai: 'nope' }), { prompts: { Client: 'Acme', 'Spaced name': 'x' } });
  assert.deepEqual(F.cleanAnswers(null), {});
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v']));
  assert.equal(Object.keys(F.cleanAnswers({ prompts: many }).prompts).length, F.MAX_PROMPTS);
  assert.equal(F.cleanAnswers({ prompts: { a: 'x'.repeat(9000) } }).prompts.a.length, F.MAX_ANSWER);
});
