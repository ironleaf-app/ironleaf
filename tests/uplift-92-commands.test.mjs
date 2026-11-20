// node --test tests/uplift-92-commands.test.mjs — the 9.2 uplift's commands and identity (F5, F6, F11, F61,
// F63, F64, F82, F134): one command per id behind one registry; one command per keys; Enter runs the command
// named exactly; merging carries properties and rewrites links by resolved path; template projects resolve by
// path end to end; recording finds today's meeting note first; taken keys name the displaced command with Undo.
// The registry is checked as parsed; the screens are guarded by the helper they call, so each check fails
// without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('one command per id, one command per keys (F5, F6)', () => {
  const cmds = read('src/renderer/src/state/commands.ts');
  const ids = [...cmds.matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 50, 'the registry parsed');
  assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), 'no id twice');
  // Extra combos read as one string or a list (5 Nov 2026, one search door: the panel answers to three).
  const hotkeys = [...cmds.matchAll(/hotkey: '([^']+)'/g)].map((m) => m[1]);
  for (const m of cmds.matchAll(/also: (\[[^\]]*\]|'[^']+')/g)) {
    const list = m[1].startsWith('[') ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [m[1].slice(1, -1)];
    hotkeys.push(...list);
  }
  assert.ok(hotkeys.includes('Mod+O') && hotkeys.includes('Mod+P') && hotkeys.includes('Mod+K'), 'the panel’s three combos parsed');
  assert.deepEqual([...new Set(hotkeys)].sort(), [...hotkeys].sort(), 'no keys twice');
  assert.equal(ids.filter((id) => id === 'tags').length, 1, "'tags' means one command: Manage tags");
  assert.ok(cmds.includes("id: 'link', name: 'Make a link', hotkey: 'Mod+U'"), 'Make a link answers its own keys');
  assert.ok(cmds.includes('commandById.get(id)'), 'runs go through the one registry');
});

test('merging carries properties and rewrites links by path (F63, F64)', () => {
  const cmds = read('src/renderer/src/state/commands.ts');
  assert.ok(cmds.includes('splitFront(mine)') && cmds.includes('clashes.push(key)'), 'properties come along, clashes said');
  assert.ok(cmds.includes('resolveNote(l.target, n.path) === path'), 'links match by resolved path');
  assert.ok(cmds.includes('resolveNote(name.trim(), n.path) === path'), 'rewrites match by resolved path');
  assert.doesNotMatch(cmds, /titleOld/, 'no title-only identity left');
  assert.ok(cmds.includes('if (own) return own.path;'), 'projects resolve by path end to end (F64)');
  assert.ok(cmds.includes('byPath.get(project)?.title'), 'the name reads off the resolved file (F64)');
});

test('recording, entering and rebinding find first and say what moved (F11, F61, F82, F134)', () => {
  const cmds = read('src/renderer/src/state/commands.ts');
  assert.ok(cmds.includes('startRecording(todays.path)'), 'today’s meeting note found first (F61)');
  const search = read('src/renderer/src/components/SearchView.tsx');
  assert.ok(search.includes('c.name.toLowerCase() === query.trim().toLowerCase()'), 'Enter runs the command named exactly (F11)');
  const slash = read('src/renderer/src/editor/slash.ts');
  assert.equal(slash.split('insertFromAssets').length - 1, 1, 'one Assets entry in the slash menu (F82)');
  assert.doesNotMatch(slash, /label: 'File'/, 'no second entry for the same insert (F82)');
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes('lost ${combo} to'), 'the displaced command is named (F134)');
  assert.ok(settings.includes('hotkeys: prev'), 'with Undo (F134)');
});
