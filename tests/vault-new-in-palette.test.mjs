// node --test tests/vault-new-in-palette.test.mjs — Ctrl+K makes things again (t21, 8 Nov 2026). Since "New is
// one door", typing "new project", "new person" and the like in Ctrl+K finds nothing, or the wrong thing ("new
// project" finds "New view of records"): the kinds went behind the door as aliases, and the palette only matches
// listed commands. Each kind answers in Ctrl+K by its own words — search finding the door, not a second door: with
// words typed, the palette matches the aliases too, by their own names, ranked with everything else. Fails first:
// the palette matches listed commands only, so the kinds are unfindable.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vault-new-palette-'));
let fuzzy;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/fuzzy.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  fuzzy = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// Every command as the palette matches it: its id, its own words, and whether it is an alias (hidden from the
// browsing lists, answering when typed). Parsed from the same source the palette reads.
function commands() {
  const src = read('src/renderer/src/state/commands.ts');
  const out = [];
  for (const m of src.matchAll(/\{ id: '([a-z0-9-]+)', name: '((?:[^'\\]|\\.)*)',(?: aliasOf: '([a-z0-9-]+)')?/g)) {
    out.push({ id: m[1], name: m[2].replace(/\\'/g, "'"), alias: m[3] ?? null });
  }
  assert.ok(out.length > 100, `the palette's commands parse (${out.length})`);
  return out;
}
const top = (names, q) => fuzzy.fuzzyFilter(names, q, (r) => r.name, 80)[0]?.id ?? null;

// Every kind the New door offers answers in Ctrl+K by its own words: the query a person types, and the kind.
const KINDS = [
  ['new project', 'new-project'],
  ['new person', 'new-person'],
  ['new meeting', 'new-meeting'],
  ['new doc', 'new-doc'],
  ['new folder', 'new-folder'],
  ['new idea', 'new-idea'],
  ['new resource', 'new-resource'],
  ['new blank note', 'new-plain-note'],
  ['new note from a template', 'new-note-from-template'],
  ['new board of notes', 'new-view-board'],
  ['new calendar of notes', 'new-view-calendar'],
  ['new cards of notes', 'new-view-cards'],
  ['new flow', 'new-flow'],
  ['new note in a new tab', 'new-note-tab'],
  ['new note', 'new-note'],
  ['new canvas', 'new-canvas'],
  ['new drawing', 'new-drawing'],
];

test('the palette matches the aliases by their own names once words are typed', () => {
  const palette = read('src/renderer/src/components/Modals.tsx');
  // With nothing typed the browsing lists stay quiet (the survivor once); with words typed the aliases answer too.
  assert.ok(palette.includes('q.trim() ?'), 'typed words switch the matched set');
  assert.ok(/COMMANDS\.filter\(\(c\) => c\.aliasOf/.test(palette), 'the aliases join the matched set');
  assert.ok(palette.includes('COMMANDS.find((c) => c.id === item.id)'), 'picking one runs it by its id');
});

test('without the aliases the kinds are unfindable (why they must be matched)', () => {
  const listed = commands().filter((c) => !c.alias);
  // The bug, pinned: listed commands alone answer "new project" with the wrong thing, and most kinds with nothing.
  assert.equal(top(listed, 'new project'), 'records-new', '"new project" falls through to New view of records');
  for (const [q, id] of KINDS.filter(([, i]) => commands().find((c) => c.id === i)?.alias)) {
    assert.notEqual(top(listed, q), id, `${JSON.stringify(q)} misses ${id} without its alias`);
  }
});
