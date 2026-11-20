// node --test tests/one-rule-inbox.test.mjs — one rule: don't know where it goes, put it in Inbox
// and it gets filed for you (5 Nov 2026). With a model, captures get a proposed home batched on the
// helper route; sure ones file straight there with a quiet line and one Undo; unsure stay with the
// best suggestion on one button and two others. With no model, one-click suggestions from simple
// matching, saying nothing about AI. Nothing deleted, nothing into a private note or a finished
// project. Each test fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-one-rule-'));
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/inbox-file.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'f.mjs'), format: 'esm' }, logLevel: 'silent' });
  F = await import(pathToFileURL(path.join(work, 'f.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// An invented vault shaped like a user's as measured: projects (one finished), people, docs, a
// private note, areas. Never a real vault.
const vault = () => ({
  projects: [
    { path: 'Projects/Harbour/Harbour.md', name: 'Harbour fit-out', status: 'Active', modified: Date.now() },
    { path: 'Projects/Store/Store.md', name: 'Studio upgrade', status: 'Done', modified: Date.now() - 90 * 86400000 },
  ],
  people: [{ name: 'Priya Shah', path: 'People/Priya Shah.md' }],
  notes: [
    { title: 'Oven manual', path: 'Docs/Oven manual.md' },
    { title: 'Private diary', path: 'Private Notes/Diary.md' },
  ],
  areas: [{ id: 'work', name: 'Work' }],
});
const item = (id, words) => ({ id, words, text: words, links: [], task: false });

test('the model is asked once for the whole batch, with the vault it files into', () => {
  const items = [item('line:1', 'Ring Priya about the Harbour benchtop'), item('line:2', 'How to descale the oven')];
  const user = JSON.parse(F.buildFileUser(items, vault()));
  assert.equal(user.items.length, 2, 'one payload carries every capture, never a call per keystroke');
  assert.ok(user.projects.some((p) => p.name === 'Harbour fit-out'), 'the model sees the projects');
  assert.ok(user.people.some((p) => p.name === 'Priya Shah'), 'the model sees the people');
  assert.ok(user.notes.some((n) => n.title === 'Oven manual'), 'the model sees the docs');
  assert.ok(!JSON.stringify(user).includes('Private Notes'), 'private notes are never sent to the model');
  assert.ok(user.projects.some((p) => p.name === 'Studio upgrade' && /done/i.test(p.status)), 'finished projects are marked so, not hidden');
});

test('a sure proposal files straight there; an unsure one stays with three suggestions at most', () => {
  const items = [item('line:1', 'Ring Priya about the Harbour benchtop')];
  const reply = { items: [{ id: 'line:1', homes: [{ path: 'Projects/Harbour/Harbour.md', why: 'About the Harbour benchtop', sure: true }] }] };
  const out = F.parseFileProposals(reply, items, vault());
  assert.equal(out['line:1'][0].target.kind, 'project');
  assert.equal(out['line:1'][0].target.path, 'Projects/Harbour/Harbour.md');
  assert.equal(out['line:1'][0].sure, true);
  const split = F.splitSureUnsure(items, out);
  assert.deepEqual(split.sure.map((s) => s.id), ['line:1']);
  assert.deepEqual(split.unsure, []);
  const maybe = F.parseFileProposals({ items: [{ id: 'line:1', homes: [{ path: 'Projects/Harbour/Harbour.md', why: 'Might be Harbour' }, { path: 'People/Priya Shah.md', why: 'Names Priya' }, { path: 'Docs/Oven manual.md', why: 'A doc' }, { path: 'Projects/Harbour/Harbour.md', why: 'Again' }] }] }, items, vault());
  assert.ok(maybe['line:1'].length <= 3, 'never more than the best and two others');
});

test('nothing is filed into a private note or a finished project, however sure the model is', () => {
  const items = [item('line:1', 'Something private'), item('line:2', 'Old store receipt')];
  const reply = { items: [{ id: 'line:1', homes: [{ path: 'Private Notes/Diary.md', why: 'Private', sure: true }] }, { id: 'line:2', homes: [{ path: 'Projects/Store/Store.md', why: 'Old project', sure: true }] }] };
  const out = F.parseFileProposals(reply, items, vault());
  assert.deepEqual(out['line:1'], [], 'a private note is never a home');
  assert.deepEqual(out['line:2'], [], 'a finished project is never a home');
  assert.ok(F.isPrivateTarget({ kind: 'note', path: 'Private Notes/Diary.md', name: 'Diary' }));
  assert.ok(F.isFinishedTarget({ kind: 'project', path: 'Projects/Store/Store.md', name: 'Studio upgrade' }, vault()));
});

test('an unknown path from the model is dropped, and junk is never a home', () => {
  const items = [item('line:1', 'Buy milk')];
  const out = F.parseFileProposals({ items: [{ id: 'line:1', homes: [{ path: 'Nowhere/Made up.md', why: 'Made up', sure: true }] }] }, items, vault());
  assert.deepEqual(out['line:1'], []);
  assert.deepEqual(F.parseFileProposals({ nonsense: true }, items, vault())['line:1'], []);
  assert.deepEqual(F.parseFileProposals(null, items, vault())['line:1'], []);
});

test('no keyword gates: the filing never depends on the capture’s own words matching a list', () => {
  const src = read('src/shared/inbox-file.ts');
  assert.doesNotMatch(src, /keyword|grocery|groceries|receipt|invoice/i, 'no word lists over what they type; the model reads the words');
  const items = [item('line:1', 'zxqv wobble flim')];
  const out = F.parseFileProposals({ items: [{ id: 'line:1', homes: [{ path: 'Projects/Harbour/Harbour.md', why: 'The model read it', sure: true }] }] }, items, vault());
  assert.equal(out['line:1'][0].target.path, 'Projects/Harbour/Harbour.md', 'the model’s reading stands, whatever the words');
});

test('a reminder home from the model files as a reminder, never nothing (Nov 2026 review)', () => {
  const items = [item('line:1', 'Ring Priya about the Harbour benchtop on Friday at 3pm')];
  const reply = { items: [{ id: 'line:1', homes: [{ path: 'reminder', when: 'Friday at 3pm', why: 'Asks to be told Friday', sure: true }] }] };
  const out = F.parseFileProposals(reply, items, vault());
  assert.equal(out['line:1'][0].target.kind, 'reminder');
  assert.equal(out['line:1'][0].target.name, 'Reminders');
  assert.equal(out['line:1'][0].target.when, 'Friday at 3pm');
  assert.equal(out['line:1'][0].sure, true);
  const split = F.splitSureUnsure(items, out);
  assert.deepEqual(split.sure.map((s) => s.id), ['line:1'], 'a sure reminder files straight there');
  assert.ok(F.INBOX_FILE_SYSTEM.includes('"reminder"') && F.INBOX_FILE_SYSTEM.includes('"when"'), 'the prompt names the reminder home’s shape');
  const unsure = F.parseFileProposals({ items: [{ id: 'line:1', homes: [{ path: 'reminder', why: 'Might be a reminder' }] }] }, items, vault());
  assert.equal(unsure['line:1'][0].target.kind, 'reminder', 'a reminder with no moment parsed stays unsure, never dropped');
  assert.equal(unsure['line:1'][0].target.when, undefined);
});

test('a reminder’s moment comes from the words, strictly: never guessed, never past', () => {
  const now = new Date(2026, 10, 4, 9, 0);
  const r = F.reminderLineFor('Ring Priya Friday at 3pm', 'Friday at 3pm', now);
  assert.ok(r && r.line === '- [ ] Ring Priya Friday at 3pm ⏰ 2026-11-06 15:00', r?.line ?? 'parsed');
  assert.equal(r.moment, 'Friday 6 November at 3:00 pm');
  assert.equal(r.timeGiven, true);
  const day = F.reminderLineFor('Order flour Friday', 'Friday', now);
  assert.ok(day && day.line.includes('⏰ 2026-11-06 09:00') && day.timeGiven === false, 'a day without a time is 9:00 am, said so');
  const rep = F.reminderLineFor('Water the plants every Monday', 'every Monday', now);
  assert.ok(rep && rep.line.includes('⏰ 2026-11-09 09:00 every Monday'), 'a repeat repeats: ' + rep?.line);
  assert.equal(F.reminderLineFor('Ring Priya sometime', 'sometime', now), null, 'not understood: the capture stays');
  assert.equal(F.reminderLineFor('Ring Priya', undefined, now), null, 'no moment from the model: the capture stays');
  assert.equal(F.reminderLineFor('Ring Priya', '2026-11-01 09:00', now), null, 'past: the capture stays');
  assert.equal(F.reminderLineFor('   ', 'Friday at 3pm', now), null, 'no words: nothing to remind of');
});

test('a filed capture says where it went in one quiet line, with Undo on the tap (9 Nov 2026, t119 one-tap filing: nothing files itself, so the batch banner is gone)', () => {
  assert.equal(F.filedLineWords([{ name: 'Harbour fit-out' }]), 'Filed in Harbour fit-out.');
  assert.equal(F.filedLineWords([{ name: 'Harbour fit-out' }, { name: 'Priya Shah' }]), 'Filed 2 captures where they go.');
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('r.undo'), 'one tap carries Undo');
  assert.ok(inbox.includes('undoAuto'), 'undone through the Inbox’s own Undo');
  assert.ok(inbox.includes('Undo'), 'the toast says Undo');
});

test('with no model the same page works from simple matching and says nothing about AI', () => {
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('suggestInboxHome') || inbox.includes('suggestFiling'), 'one-click suggestions without a model');
  assert.doesNotMatch(inbox, /AI suggest|Ask AI|AI filing|powered by AI/i, 'no AI words on the page');
});

test('the New button writes first and files after; empty notes leave nothing behind', () => {
  const src = read('src/renderer/src/state/noteTypes.ts');
  assert.ok(src.includes('writeFirst') || src.includes('write first'), 'New writes first, then proposes a home');
  assert.ok(read('src/renderer/src/state/actions.ts').includes('isEmptyNote') || read('src/shared/note-types.ts').includes('isEmptyNote'), 'an empty new note is recognised so closing leaves nothing behind');
});

test('the assistant answers “what do I do with this” from this vault, never with a lecture', () => {
  const agent = read('src/main/agent.ts');
  assert.ok(agent.includes('What do I do with this') || agent.includes('what to do with'), 'the tools path knows the question');
  assert.ok(agent.includes('one choice') || agent.includes('the one choice'), 'it does the sensible thing or says the one choice');
  const ai = read('src/main/ai.ts');
  assert.ok(ai.includes('What do I do with this') || ai.includes('what to do with'), 'the plain path sounds the same');
});

test('never a home: an Untitled, empty or daily note leaves the list and fails the reader', () => {
  const v = vault();
  v.notes.push(
    { title: 'Untitled', path: 'Business/Notes/Untitled.md' },
    { title: 'Empty jottings', path: 'Notes/Empty jottings.md', empty: true },
    { title: '6 November', path: 'Daily/2026-11-06.md', daily: true },
  );
  const user = JSON.parse(F.buildFileUser([item('line:1', 'Something to file')], v));
  const paths = user.notes.map((n) => n.path);
  assert.ok(!paths.includes('Business/Notes/Untitled.md'), 'Untitled is never sent to the model');
  assert.ok(!paths.includes('Notes/Empty jottings.md'), 'an empty note is never sent');
  assert.ok(!paths.includes('Daily/2026-11-06.md'), 'a daily note is never sent');
  assert.ok(paths.includes('Docs/Oven manual.md'), 'a real doc still is');
  const items = [item('line:1', 'Something to file')];
  for (const p of ['Business/Notes/Untitled.md', 'Notes/Empty jottings.md', 'Daily/2026-11-06.md']) {
    const out = F.parseFileProposals({ items: [{ id: 'line:1', homes: [{ path: p, why: 'The model said so', sure: true }] }] }, items, v);
    assert.deepEqual(out['line:1'], [], `${p} is refused, however sure the model is`);
  }
  assert.equal(F.isUntitledNoteTitle('Untitled'), true);
  assert.equal(F.isUntitledNoteTitle('untitled meeting'), true);
  assert.equal(F.isUntitledNoteTitle('Oven manual'), false);
});

test('the model gets a line on each project, and docs marked as docs', () => {
  const v = vault();
  v.projects[0].about = 'The cafe fit-out on Harbour Street, benchtop due soon';
  v.notes[0].doc = true;
  const user = JSON.parse(F.buildFileUser([item('line:1', 'Ring about the benchtop')], v));
  assert.equal(user.projects.find((p) => p.name === 'Harbour fit-out').about, 'The cafe fit-out on Harbour Street, benchtop due soon');
  assert.equal(user.notes.find((n) => n.title === 'Oven manual').doc, true);
});

test('new homes parse: a next step, a new doc and a new note', () => {
  const items = [item('line:1', 'Buy soil for the Courtyard beds'), item('line:2', 'How to reset the router'), item('line:3', 'Soil order arrived')];
  const reply = {
    items: [
      { id: 'line:1', homes: [{ path: 'Projects/Harbour/Harbour.md', step: true, why: 'Work for Harbour', sure: true }] },
      { id: 'line:2', homes: [{ path: 'new-doc', title: 'Resetting the router', why: 'Explains how it works', sure: true }] },
      { id: 'line:3', homes: [{ path: 'new-note', area: 'work', title: 'Soil order', why: 'Worth keeping in Work', sure: true }] },
    ],
  };
  const out = F.parseFileProposals(reply, items, vault());
  assert.equal(out['line:1'][0].target.kind, 'project');
  assert.equal(out['line:1'][0].target.step, true, 'the step flag survives the reader');
  assert.equal(out['line:2'][0].target.kind, 'area');
  assert.equal(out['line:2'][0].target.type, 'doc');
  assert.equal(out['line:2'][0].target.title, 'Resetting the router');
  assert.equal(out['line:3'][0].target.kind, 'area');
  assert.equal(out['line:3'][0].target.area, 'work');
  assert.equal(out['line:3'][0].target.title, 'Soil order');
  const split = F.splitSureUnsure(items, out);
  assert.deepEqual(split.sure.map((s) => s.id), ['line:1', 'line:2', 'line:3'], 'sure new homes file themselves');
  const bad = F.parseFileProposals({ items: [{ id: 'line:1', homes: [{ path: 'new-note', area: 'nowhere', title: 'x', why: 'x', sure: true }] }] }, items, vault());
  assert.deepEqual(bad['line:1'], [], 'an unknown area is dropped');
  const dirty = F.parseFileProposals({ items: [{ id: 'line:1', homes: [{ path: 'new-doc', title: '../../etc/passwd', why: 'x', sure: true }] }] }, items, vault());
  assert.ok(!(dirty['line:1'][0]?.target.title ?? '').includes('/'), 'a title can never climb out of its folder');
});

test('the prompt allows every home and teaches sure with short examples', () => {
  const src = F.INBOX_FILE_SYSTEM;
  for (const home of ['"new-doc"', '"new-note"', '"step"', '"reminder"', '"when"', '"title"']) assert.ok(src.includes(home), `the prompt names ${home}`);
  assert.match(src, /no homes/, 'nonsense gets no homes and stays in the Inbox');
  assert.match(src, /never a private note/i);
  assert.match(src, /never a finished project/i);
  assert.ok(!/Priya|Harbour|oven/i.test(src), 'the examples are invented, never real people’s names');
});

test('long lists are trimmed before sending: docs first, then recent, never more than sixty', () => {
  const notes = [];
  for (let n = 0; n < 100; n++) notes.push({ title: `Note ${n}`, path: `Notes/Note ${n}.md`, modified: n });
  notes.push({ title: 'Old doc', path: 'Docs/Old doc.md', doc: true, modified: -1 });
  const trimmed = F.trimFileVault({ projects: [], people: [], notes, areas: [] });
  assert.ok(trimmed.notes.length <= 60, `capped: ${trimmed.notes.length}`);
  assert.ok(trimmed.notes.some((n) => n.title === 'Old doc'), 'an old doc still makes the list');
  assert.ok(trimmed.notes.some((n) => n.title === 'Note 99'), 'the newest notes make it');
  assert.ok(!trimmed.notes.some((n) => n.title === 'Note 0'), 'the oldest plain notes fall off');
});

test('a first-time person gets one short tour of Inbox, project, doc, note, once', () => {
  const tour = read('src/shared/inbox-tour.ts');
  for (const word of ['Inbox', 'project', 'doc', 'note']) assert.ok(tour.includes(word), 'the four words: ' + word);
  assert.ok(tour.split('\n').length < 60, 'short: nothing more');
  const inbox = read('src/renderer/src/views/InboxPage.tsx');
  assert.ok(inbox.includes('inbox-tour') || inbox.includes('InboxTour') || inbox.includes('tourSeen'), 'shown once, in the tour system');
});
