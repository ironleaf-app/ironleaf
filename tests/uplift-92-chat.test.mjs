// node --test tests/uplift-92-chat.test.mjs — the 9.2 uplift's chat reliability (F1, F7, F14, F29, F32, F33,
// F60, F92, F94, F95, F96, F97, F98, F156, F158, F159, F22, F23): Do-mode failures speak and keep the words; a
// question asked while an answer streams waits its turn; retry keeps earlier change cards and Undo; one predicate
// shows the change card and its toast; every failure reads in the person's own words. Pure logic is checked as it
// is; the screens are guarded by the helper they call, so each check fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u92-chat-'));
let E;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/lib/errors.ts'), platform: 'node', output: { file: path.join(work, 'e.mjs'), format: 'esm' }, logLevel: 'silent' });
  E = await import(pathToFileURL(path.join(work, 'e.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('failures read in the person’s own words, never paths or codes (F22, F60)', () => {
  assert.equal(E.errorMessage(new Error("Error invoking remote method 'notes': No note templates yet.")), 'No note templates yet.');
  assert.equal(E.errorMessage(new Error('ENOENT: no such file, open /home/you/notes/a.md')), 'A file it needed is missing.');
  assert.equal(E.errorMessage(new Error('EACCES: permission denied')), 'It didn’t have permission to do that.');
  assert.equal(E.errorMessage(new Error('ENOTFOUND registry.pi.ai')), 'The network didn’t answer.');
  assert.equal(E.errorMessage(new Error('The job was cancelled by the user')), 'Stopped.');
  assert.equal(E.errorMessage(new Error('')), 'Something didn’t work just then.');
  assert.equal(E.errorMessage(new Error('TypeError: Cannot read properties of null')), 'Something didn’t work just then.');
  assert.equal(E.errorMessage('a plain string failure'), 'a plain string failure');
  assert.equal(E.resultWords('Saved 3 notes.'), 'Saved 3 notes.');
  assert.equal(E.resultWords("Error invoking remote method 'x': **Done**."), 'Done.');
  assert.equal(E.resultWords('ENOENT: /tmp/x vanished'), '', 'engine output never shows as a result');
  assert.equal(E.resultWords(42), '');
  assert.equal(E.stripMarkdown('**Done** — see [the note](nv:/x) and <b>this</b>'), 'Done — see the note and this');
});

test('no renderer surface strips engine wrappers of its own', () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if ((p.endsWith('.ts') || p.endsWith('.tsx')) && !p.split(path.sep).join('/').endsWith('lib/errors.ts')) {
        if (readFileSync(p, 'utf8').includes('Error invoking remote method')) hits.push(path.relative(root, p));
      }
    }
  };
  walk(path.join(root, 'src/renderer/src'));
  assert.deepEqual(hits, [], 'every surface calls lib/errors.ts errorMessage');
  assert.ok(read('src/renderer/src/state/store.ts').includes('toast(errorMessage(err)'), 'showError speaks plain words (F22)');
  assert.ok(read('src/renderer/src/state/workModules.ts').includes('words ?? resultWords(r)'), 'job results clean before they show (F23)');
  assert.ok(read('src/renderer/src/state/recordModules.ts').includes('words ?? resultWords(r)'), 'record results clean before they show (F23)');
});

test('Do mode files through the one path: failures speak, words stay (F1)', () => {
  assert.ok(read('src/renderer/src/state/actions.ts').includes('export async function fileTaskText'), 'one filing path');
  // (4 Nov 2026: Home's middle box moved to the header bar's panel, which stays open until filed; p9-one-ask took
  // the floating Ask bar away, so the header panel is the one Do left.)
  const src = read('src/renderer/src/components/Modals.tsx');
  assert.ok(src.includes('A.fileTaskText('), 'the header panel files through the one path');
  assert.doesNotMatch(src, /\(\) => setBusy\(false\)/, 'never swallowing a filing failure');
  assert.ok(src.includes('if (filed) onClose()'), 'the panel stays open on a failure, with the words still there');
});

test('a question asked while answering waits its turn, never lost (F7)', () => {
  const chat = read('src/renderer/src/state/chat.ts');
  assert.ok(chat.includes('queued: QueuedAsk[]'), 'the chat keeps a queue');
  assert.ok(chat.includes('Still answering. Your question sends next.'), 'the wait is said');
  assert.ok(chat.includes('sendQueued()'), 'the queue sends when the answer lands');
  assert.doesNotMatch(chat, /if \(store\.requestId\) return;/, 'no silent drop on a busy chat');
  assert.ok(read('src/renderer/src/panels/ChatPanel.tsx').includes('if ((!question && !attachedReady) || reading) return;'), 'the side chat sends to the queue');
});

test('retry keeps earlier change cards and Undo (F33)', () => {
  const chat = read('src/renderer/src/state/chat.ts');
  assert.doesNotMatch(chat, /messages\.slice\(0, at\)/, 'retry never slices answers away');
  assert.ok(chat.includes('const history = [...store.messages, answer]'), 'the new answer joins the kept ones');
});

test('one predicate shows the change card and its toast (F92, F94, F156, F158, F159)', () => {
  const chat = read('src/renderer/src/state/chat.ts');
  assert.ok(chat.includes('export function showChanges'), 'one shared predicate');
  assert.ok(chat.includes('if (showChanges(result.changes))'), 'the toast follows it');
  assert.doesNotMatch(chat, /changedSomething/, 'the split predicate is gone');
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(panel.includes('if (!showChanges(c)) return null;'), 'the card follows it');
  assert.ok(panel.includes('<Changes message={m} onOpen={openNote} showMe />'), 'the side chat card offers Show me (F92)');
  assert.ok(panel.includes('proposalHead(list)'), 'proposal heads count distinct projects (F94)');
  assert.ok(panel.includes('more of {items.length}'), 'the chip row reconciles against its total (F158)');
  assert.ok(panel.includes('entry !== undefined && waiting === 0'), 'suggestions wait until their events land (F159)');
});

test('answers keep, enter notes, and scope through the shared helpers (F14, F32, F96, F97)', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(panel.includes('export function insertAnswerIntoNote'), 'one shared insertAnswerIntoNote');
  assert.ok(panel.includes('export async function saveAnswerAsNote'), 'one shared saveAnswerAsNote');
  // v8-vault-assistant: the per-answer scope head went with its helper ("All notes" read twice). Scope lives in
  // one line now — the bar's control, with the question's own note — still in plain words (F14).
  assert.doesNotMatch(panel, /answerScopeWords/, 'no per-answer scope label any more');
  assert.ok(panel.includes('This page + linked'), 'scopes read in plain words (F14)');
  assert.ok(panel.includes('about the ticked sources'), 'the ticked-sources footnote keeps its plain words');
  assert.doesNotMatch(panel, /ASK · /, 'no shouted scope codes');
  assert.ok(panel.includes('Already kept as'), 'saving twice opens the note it made (F32)');
  assert.ok(panel.includes('Asked in the chat on'), 'the footer is a plain dateline (F97)');
  assert.doesNotMatch(panel, /Asked in Ironleaf chat/, 'no product stamp in notes');
  assert.doesNotMatch(panel, /Live Preview or Source/, 'no editor mode names (F96)');
});

test('the model menu names its default plainly (F95)', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(panel.includes("label: 'Recommended'"), 'the default reads Recommended');
  assert.doesNotMatch(panel, /Same as NeuralSpark/, 'no engine name in the menu');
});
