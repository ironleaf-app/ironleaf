// node --test tests/alias-survivor.test.mjs — an alias's use counts as its survivor's use (t28 follow-up,
// 8 Nov 2026, the call on the break-it job's question): a person who uses the old name sees the
// survivor in recents ("used lately"), and its keys show under the survivor in Settings › Keys, so they can
// be changed there. Before, recording the alias id never surfaced (the nothing-typed list shows survivors
// once), and an alias hotkey such as Mod+Shift+N fired but could be changed nowhere. One rule for both doors
// (src/renderer/src/lib/commandAliases.ts), run here for real over the real parsed registry; the recents and
// the keys list read through it. Fails first: the alias id is stored as is, and the keys list shows the
// survivors alone.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-alias-survivor-'));
let A; // lib/commandAliases.ts, the real alias rule
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/commandAliases.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'a.mjs'), format: 'esm' }, logLevel: 'silent' });
  A = await import(pathToFileURL(path.join(work, 'a.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

/** The palette's registry as parsed: every command's id, alias and keys, from the source the doors read. */
function registry() {
  const src = read('src/renderer/src/state/commands.ts');
  const array = src.slice(src.indexOf('export const COMMANDS'), src.indexOf('let lastSearch'));
  const out = [];
  for (const line of array.split('\n')) {
    const id = line.match(/\bid: '([^']+)'/)?.[1];
    if (!id || id === 'id') continue;
    out.push({ id, aliasOf: line.match(/\baliasOf: '([^']+)'/)?.[1], hotkey: line.match(/\bhotkey: '([^']+)'/)?.[1] });
  }
  assert.ok(out.length > 100, `the registry parsed (${out.length})`);
  return out;
}

// [alias, the survivor shown instead] (the quiet More's aliases, as tests/more-eight.test.mjs pins them).
const ALIASES = [
  ['home', 'today'],
  ['new-note-tab', 'new-note'],
  ['new-plain-note', 'new-note'],
  ['new-person', 'new-note'],
  ['new-meeting', 'new-note'],
  ['new-resource', 'new-note'],
  ['new-idea', 'new-note'],
  ['new-note-from-template', 'new-note'],
  ['new-project', 'new-note'],
  ['new-doc', 'new-note'],
  ['new-view-board', 'new-view'],
  ['new-view-calendar', 'new-view'],
  ['new-view-cards', 'new-view'],
  ['new-folder', 'files'],
  ['import-csv', 'import'],
];

test('an alias counts as its survivor; survivors and unknown ids pass through', () => {
  const cmds = registry();
  for (const [alias, survivor] of ALIASES) {
    assert.equal(A.survivorId(alias, cmds), survivor, `${alias} counts as ${survivor}`);
  }
  assert.equal(A.survivorId('new-note', cmds), 'new-note', 'a survivor counts as itself');
  assert.equal(A.survivorId('no-such-command', cmds), 'no-such-command', 'an unknown id passes through');
});

test('a use is recorded first, once, at most eight remembered', () => {
  assert.deepEqual(A.withRecentUsed([], 'new-note'), ['new-note'], 'first use');
  assert.deepEqual(A.withRecentUsed(['today', 'new-note'], 'new-note'), ['new-note', 'today'], 'used again: first, once');
  const ten = Array.from({ length: 10 }, (_, i) => `c${i}`);
  assert.deepEqual(A.withRecentUsed(ten, 'new-note'), ['new-note', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'], 'eight at most');
});

test('stored ids read back as survivors, each once, order kept', () => {
  const cmds = registry();
  assert.deepEqual(A.readRecent(['new-note-tab', 'new-note', 'today', 'home'], cmds), ['new-note', 'today'], 'uses from before the rule count as the survivor too');
  assert.deepEqual(A.readRecent([], cmds), [], 'nothing stored, nothing read');
  const ten = [...ALIASES.map(([a]) => a), 'today', 'graph'].slice(0, 10);
  assert.ok(A.readRecent(ten, cmds).length <= 8, 'eight at most');
});

test('keyed aliases: defaults and the person’s own show; keyless aliases earn no row', () => {
  const cmds = registry();
  assert.deepEqual(A.keyedAliases(cmds, {}, 'new-note').map((c) => c.id), ['new-note-tab'], 'the default Mod+Shift+N shows under New note');
  assert.deepEqual(A.keyedAliases(cmds, {}, 'today'), [], 'a keyless alias (Open Home) earns no row: the lists stay quiet');
  assert.deepEqual(A.keyedAliases(cmds, { 'new-person': 'Mod+X' }, 'new-note').map((c) => c.id).sort(), ['new-note-tab', 'new-person'], 'the person’s own alias key shows too');
  assert.deepEqual(A.keyedAliases(cmds, { 'new-note-tab': '' }, 'new-note').map((c) => c.id), ['new-note-tab'], 'None still shows, so it can be changed back');
});

test('every alias names a real listed survivor', () => {
  const cmds = registry();
  const byId = new Map(cmds.map((c) => [c.id, c]));
  for (const [alias, survivor] of ALIASES) {
    assert.equal(byId.get(alias)?.aliasOf, survivor, `${alias} is an alias of ${survivor}`);
    assert.ok(byId.has(survivor) && !byId.get(survivor)?.aliasOf, `${survivor} is shown`);
  }
});

test('the recents read and write through the alias rule', () => {
  const cmds = read('src/renderer/src/state/commands.ts');
  const recent = cmds.slice(cmds.indexOf('export function recentCommands'), cmds.indexOf('export function noteCommandUsed'));
  assert.ok(recent.includes('readRecent(ids, COMMANDS)'), 'stored ids read back as survivors');
  const noted = cmds.slice(cmds.indexOf('export function noteCommandUsed'), cmds.indexOf('export function noteCommandUsed') + 600);
  assert.ok(noted.includes('survivorId(id, COMMANDS)'), 'a use is recorded as the survivor');
  assert.ok(noted.includes('withRecentUsed('), 'recorded first, once, at most eight');
  assert.ok(cmds.includes("from '../lib/commandAliases'"), 'the one rule, shared with the keys list');
});

test('Settings › Keys shows each survivor with its keyed aliases beneath, changeable there', () => {
  const src = read('src/renderer/src/components/Settings.tsx');
  const keys = src.slice(src.indexOf('function Keys('), src.indexOf('function Keys(') + 7000);
  assert.ok(keys.includes('listedCommands()'), 'the survivors list once, as before');
  assert.ok(keys.includes('keyedAliases(COMMANDS, prefs.hotkeys, c.id)'), 'each followed by its aliases with keys now');
  assert.ok(keys.includes('const c = r.cmd;'), 'a sub-row works on its own alias id');
  assert.ok(keys.includes("className={`keys-row${r.sub ? ' is-sub' : ''}`}"), 'a sub-row reads as belonging to its survivor');
  assert.ok(keys.includes('keyedAliases(COMMANDS, prefs.hotkeys, c.id).some(hits)'), 'the filter matches an alias’s own name or keys too');
  assert.ok(keys.includes('const changed = rows.filter((r) => prefs.hotkeys[r.cmd.id] !== undefined)'), 'the count counts the shown sub-rows with the survivors');
  assert.ok(read('src/renderer/src/styles.css').includes('.keys-row.is-sub .keys-name'), 'the sub-row steps its name in, its keys in line');
});

test('the key loop still reads every command, aliases too (an alias key still fires)', () => {
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes('for (const cmd of COMMANDS)'), 'every command is heard');
  assert.ok(app.includes('hotkeyOf(cmd)'), 'by the keys Settings › Keys now shows');
});
