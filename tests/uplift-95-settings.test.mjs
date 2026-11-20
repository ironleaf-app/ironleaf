// node --test tests/uplift-95-settings.test.mjs — settings that make sense (9.5 polished, 1 Nov 2026, one short line
// per row, detail behind Learn more). One LearnMore disclosure carries every long explanation; one Details button
// opens every row's details; the search index words groups as they work (cards move with buttons, models answer).
// Every check fails without its change.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('one LearnMore disclosure carries long explanations', () => {
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes('export function LearnMore'), 'LearnMore is shared from Settings');
  const css = read('src/renderer/src/styles/settings-87.css');
  assert.ok(css.includes('.learnmore-body'), 'the disclosure body is styled');
  for (const [f, wall] of [
    ['src/renderer/src/components/PrivacySettings.tsx', 'not through search, related notes'],
    ['src/renderer/src/components/BackupSettings.tsx', 'PROTECTS.git'],
  ]) {
    const src = read(f);
    assert.ok(src.includes('LearnMore'), `${f} discloses behind LearnMore`);
    assert.ok(src.includes(wall), `${f} keeps its words (${wall})`);
  }
});

test('one Details button opens every row’s details', () => {
  const settings = read('src/renderer/src/components/Settings.tsx');
  assert.ok(settings.includes('export function DetailsButton') || settings.includes('function DetailsButton'), 'one Details component');
  assert.ok(!settings.includes('<button className="button" style={{ height: 32 }} aria-expanded={details}'), 'no plain-button Details left');
});

test('the search index words groups as they work', () => {
  const index = read('src/renderer/src/lib/settingsSearch.ts');
  assert.ok(!index.includes('Drag to put them in order'), 'home cards move with buttons, not drag');
  assert.ok(index.includes('Pick what shows on Home'), 'home keeps its findable words');
  assert.ok(!index.includes('Which brain answers'), 'models answer, not brains');
  assert.ok(!index.includes('fully gone from view — your files are kept'), 'no em dash under Packs');
  assert.ok(!index.includes('connected apps — what each may do'), 'no em dash under Agents');
  assert.ok(!index.includes('open its folder to check, or move it'), 'the vault hint matches the row');
});
