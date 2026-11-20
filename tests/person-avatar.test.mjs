// node --test tests/person-avatar.test.mjs — never initials from the "You" placeholder (v10shell2, 2 Nov 2026,
// the reviewer from inputs/vault-today-shell.png: the header avatar showed "YO", the initials of the placeholder
// word "You", before the person's name landed). The foot and the header both read the one account chain now
// (p11-uniform-account round 2, 4 Nov 2026: licence name, then the notes' person, then "My account"), so neither
// ever sees the placeholder: the chain always yields words, and its first letter is the avatar. Each test fails
// without its fix.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const bar = () => read('src/renderer/src/views/ViewHeader.tsx');
const places = () => read('src/renderer/src/panels/Places.tsx');
const chipModel = () => noComments(read('src/renderer/src/components/account/accountMenu.ts'));

// 20 Nov 2026: the header's avatar left; the one avatar is the account chip at the side bar's foot
// (components/account/AccountMenu.tsx), and it reads the account, never the notes' person or a placeholder.
test('no header avatar; the account chip never shows the placeholder', () => {
  assert.ok(!bar().includes('HeaderAvatar') && !bar().includes('usePerson'), 'the header draws no avatar');
  const model = chipModel();
  assert.ok(!model.includes("'You'") && !model.includes('"You"'), 'no You placeholder in the chip');
  assert.ok(model.includes("initialsOf(screen.name || screen.email || '')"), 'initials from the account’s name or email');
  assert.ok(model.includes("initials: ''"), 'signed out: the neutral avatar, never letters');
});

test('the chip names the person in plain words and opens the account menu', () => {
  const tsx = read('src/renderer/src/components/account/AccountMenu.tsx');
  assert.ok(tsx.includes('aria-label={chip.label}') && tsx.includes('aria-haspopup="menu"'), 'its aria names the person and the menu');
  assert.ok(places().includes('<AccountChip variant="foot" />'), 'at the foot of the side bar');
});

test('the person state stays null until the real name lands (no placeholder default)', () => {
  const src = noComments(read('src/renderer/src/state/person.ts'));
  assert.ok(src.includes('string | null'), 'the name is nullable');
  assert.ok(!src.includes("'You'") && !src.includes('"You"'), 'no placeholder in the state');
});
