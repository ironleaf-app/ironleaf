// node --test tests/inbox-suggest.test.mjs — the suggested home of an Inbox capture (src/shared/inbox-suggest.ts):
// a module or one of its records named first, then a project, person, note or area from the vault's own structure
// (src/shared/inbox.ts), at most three, nothing when nothing points anywhere, and the one-click button's words.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-inbox-suggest-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/inbox-suggest.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const ctx = {
  projects: [{ path: 'Projects/Harbour/Harbour.md', name: 'Harbour fit-out', people: ['Priya Shah'], tags: [], modified: Date.now(), area: 'work' }],
  people: [{ name: 'Priya Shah', path: 'People/Priya Shah.md', names: [], area: 'work' }],
  notes: [],
  areas: [{ id: 'work', name: 'Work' }],
  modules: [{ id: 'finance', name: 'Finance', records: [{ name: 'Telstra bill', path: 'Finance/Telstra.md', label: 'Add as a bill' }] }],
  resolve: () => null,
};
const item = (words) => ({ words, text: words, links: [], task: false });

test('a capture naming a module record is offered that module first, in its own words', () => {
  const out = S.suggestInboxHome(item('Telstra bill arrived, due Monday'), ctx);
  assert.equal(out[0].target.kind, 'module');
  assert.equal(out[0].target.name, 'Telstra bill');
  assert.equal(S.fileToWords(out[0]), 'File in Telstra bill');
});

test('a capture naming a project is offered it, with the one-click words', () => {
  const out = S.suggestInboxHome(item('Harbour fit-out quote is ready'), ctx);
  assert.ok(out.some((s) => s.target.kind === 'project' && s.target.name === 'Harbour fit-out'), JSON.stringify(out));
  assert.equal(S.fileToWords(out.find((s) => s.target.kind === 'project')), 'File to Harbour fit-out');
  assert.equal(S.leadSuggestion(out)?.target.kind, out[0].target.kind);
});

test('a reminder home says when in the same words everywhere (Nov 2026 review)', () => {
  assert.equal(S.remindTargetWords({ when: 'Friday at 3pm' }), 'Remind Friday at 3pm');
  assert.equal(S.remindTargetWords({}), 'Remind me');
  assert.equal(S.fileToWords({ target: { kind: 'reminder', name: 'Reminders', when: 'Friday at 3pm' }, why: 'Asks to be told Friday' }), 'Remind Friday at 3pm', 'the one-click button says it too');
  assert.equal(S.fileToWords({ target: { kind: 'reminder', name: 'Reminders' }, why: 'Might be a reminder' }), 'Remind me');
});

test('nothing named, nothing linked: no suggestion invented', () => {
  assert.deepEqual(S.suggestInboxHome(item('Buy milk on the way home'), ctx), []);
  assert.equal(S.leadSuggestion([]), null);
});

test('a single name still points at its card or note, in capitals only', () => {
  const people = { ...ctx, people: [{ name: 'Ava Reed', path: 'People/Ava Reed.md', names: ['Ava'], area: 'home' }], areas: [{ id: 'home', name: 'Home' }] };
  const ava = S.suggestInboxHome(item('Ask Ava about Friday'), people);
  assert.ok(ava.some((s) => s.target.kind === 'person' && s.target.name === 'Ava Reed'), JSON.stringify(ava));
  const bill = { ...ctx, people: [{ name: 'Bill Smith', path: 'People/Bill Smith.md', names: ['Bill'], area: 'home' }], areas: [{ id: 'home', name: 'Home' }] };
  assert.ok(!S.suggestInboxHome(item('pay the power bill'), bill).some((s) => s.target.kind === 'person'), 'a lowercase bill is no Bill');
  assert.ok(S.suggestInboxHome(item('Ask Bill about the invoice'), bill).some((s) => s.target.kind === 'person'), 'a capital Bill is');
  const car = { ...ctx, notes: [{ title: 'Car', path: 'Notes/Car.md', area: 'home' }], areas: [{ id: 'home', name: 'Home' }] };
  assert.ok(S.suggestInboxHome(item('Pick up the car'), car).some((s) => s.target.kind === 'note'), 'a one-word note still matches');
  const may = { ...ctx, notes: [{ title: 'May', path: 'Notes/May.md', area: 'home' }], areas: [{ id: 'home', name: 'Home' }] };
  assert.ok(!S.suggestInboxHome(item('it may rain today'), may).some((s) => s.target.kind === 'note'), 'a month-word matches nothing');
});

test('filing to an area keeps a task a task', () => {
  const task = S.suggestInboxHome({ words: 'Harbour fit-out quote is ready', text: 'Harbour fit-out quote is ready', links: [], task: true }, ctx);
  assert.equal(task.find((s) => s.target.kind === 'area')?.target.type, 'task');
  const note = S.suggestInboxHome(item('Harbour fit-out quote is ready'), ctx);
  assert.equal(note.find((s) => s.target.kind === 'area')?.target.type, 'note');
});
