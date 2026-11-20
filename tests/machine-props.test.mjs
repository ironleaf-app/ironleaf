// node --test tests/machine-props.test.mjs — machine-kept properties (6 Nov 2026, o3-meeting-page item 1: the note
// showed `Speakers  {"":{"spk1":"Alex Rivera","spk2":"Kate Sullivan"}}`). Data the app keeps for itself in a note's
// properties (frontmatter.ts's one list) is never shown as a property: not in the note page's field rows, not in
// the Properties panel (shownProps), not as a CSV column on export (unionFields). The note's own file keeps it, and
// the speakers code still reads it back — it is hidden, never dropped. The map lives under neuralvault-speaker-names
// (o6 moved it off `speakers`); a person's own `speakers:` stays visible everywhere.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-machine-props-'));
let F; let P; let R; let S; let E; let V;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, [
    `export * as F from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};`,
    `export * as P from ${JSON.stringify(path.join(root, 'src/shared/note-page.ts'))};`,
    `export * as R from ${JSON.stringify(path.join(root, 'src/shared/relation-links.ts'))};`,
    `export * as S from ${JSON.stringify(path.join(root, 'src/shared/meeting-speakers.ts'))};`,
    `export * as E from ${JSON.stringify(path.join(root, 'src/shared/portable-export.ts'))};`,
    `export * as V from ${JSON.stringify(path.join(root, 'src/shared/views.ts'))};`,
  ].join('\n') + '\n');
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'm.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ F, P, R, S, E, V } = await import(pathToFileURL(path.join(work, 'm.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOTE = `---\ntype: meeting\ndate: 2026-11-06\npeople: "[[Alex Rivera]], [[Kate Sullivan]]"\nalso: "[[David Kim]]"\nspeakers: Jo and Sam\nneuralvault-speaker-names:\n  "":\n    spk1: Alex Rivera\n    spk2: Kate Sullivan\n---\n# Weekly\n`;

test('the one list names the meeting speakers property, however it is capitalised or spaced', () => {
  assert.equal(typeof F.isMachineProp, 'function', 'frontmatter must own isMachineProp');
  assert.equal(F.isMachineProp('neuralvault-speaker-names'), true);
  assert.equal(F.isMachineProp('NeuralVault-Speaker-Names'), true);
  assert.equal(F.isMachineProp(' neuralvault-speaker-names '), true);
  // The writer and the list can never drift apart.
  assert.equal(F.isMachineProp(S.SPEAKERS_PROP), true);
  assert.deepEqual([...F.MACHINE_PROP_KEYS], ['neuralvault-speaker-names']);
  // A person's own properties are never on it — `speakers` is their word now.
  for (const k of ['speakers', 'people', 'date', 'also', 'where', 'project', 'status', 'voices']) assert.equal(F.isMachineProp(k), false, k);
});

test('visibleProps drops machine properties and keeps every other one, in order', () => {
  const props = F.readProps(NOTE);
  assert.deepEqual(Object.keys(F.visibleProps(props)), ['type', 'date', 'people', 'also', 'speakers']);
  // The file itself is untouched: the speakers code still reads its names back.
  assert.deepEqual(S.readSpeakerNames(NOTE, ''), { spk1: 'Alex Rivera', spk2: 'Kate Sullivan' });
  assert.deepEqual(S.readSpeakerNames(NOTE, 'Part 1'), { spk1: 'Alex Rivera', spk2: 'Kate Sullivan' }, 'a first part kept under "" reads under Part 1');
});

test('the note page shows no field row for machine data; a person’s own speakers shows', () => {
  const rows = P.fieldRows(F.readProps(NOTE), []).map((r) => r.key.toLowerCase());
  assert.ok(!rows.includes('neuralvault-speaker-names'), `machine map must not be a field row, got ${rows}`);
  assert.ok(rows.includes('speakers'), `a person's own speakers must show, got ${rows}`);
  assert.ok(rows.includes('people'));
});

test('the Properties panel shows no row for machine data; a person’s own speakers shows', () => {
  const shown = R.shownProps(F.readProps(NOTE)).map((k) => k.toLowerCase());
  assert.ok(!shown.includes('neuralvault-speaker-names'), `machine map must not be shown, got ${shown}`);
  assert.ok(shown.includes('speakers'), `a person's own speakers must show, got ${shown}`);
  assert.ok(shown.includes('people'));
  assert.equal(R.isHiddenProp('neuralvault-speaker-names'), true, 'isHiddenProp reads the one list');
  assert.equal(R.isHiddenProp('speakers'), false, 'isHiddenProp leaves a person’s speakers alone');
});

test('tables and bases offer no column or filter for machine data', () => {
  const keys = V.knownProps([{ path: 'Meetings/Weekly.md', title: 'Weekly', props: F.readProps(NOTE) }]).map((p) => p.key.toLowerCase());
  assert.ok(!keys.includes('neuralvault-speaker-names'), `machine map must not be offered, got ${keys}`);
  assert.ok(keys.includes('speakers'), `a person's own speakers must be offered, got ${keys}`);
  assert.ok(keys.includes('people'));
});

test('export columns carry no machine data', () => {
  const fields = E.unionFields([F.readProps(NOTE)], []).map((k) => k.toLowerCase());
  assert.ok(!fields.includes('neuralvault-speaker-names'), `machine map must not be a column, got ${fields}`);
  assert.ok(fields.includes('speakers'), `a person's own speakers must be a column, got ${fields}`);
  assert.ok(fields.includes('people'));
});
