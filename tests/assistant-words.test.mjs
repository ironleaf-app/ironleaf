// node --test tests/assistant-words.test.mjs — the assistant's voice and words (5 Nov 2026, v8-vault-assistant:
// the audit found the tools prompt 100% operating rules with no voice, "Done"-shaped stop words, move steps printing
// raw paths, and finished steps folding to a bare count). One voice block for both doors (tools + plain), short-message
// manners, softer stop words, moves in titles, and folded summaries derived from step kinds. Each check fails without
// its fix: the words are read from the built prompt and helpers, not copied beside them.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-assistant-words-'));
let M;
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'agent.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'agent.mjs')).href);
  const sentry = path.join(work, 'steps.ts');
  writeFileSync(sentry, `export * from ${JSON.stringify(path.join(root, 'src/shared/chat-steps.ts'))};\n`);
  await build({ input: sentry, platform: 'node', output: { file: path.join(work, 'steps.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'steps.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const system = () => M.agentSystem('Muse Spark', 'Thursday 5 November 2026 (2026-11-05)', null, []);

// ── The voice block (F1, F11): one block, both doors ──────────────────────────

test('the tools prompt opens with a voice block, not operating rules alone', () => {
  const s = system();
  assert.ok(s.includes('like a capable colleague who knows their notes'), 'the colleague line the plain path already had');
  assert.ok(s.includes('Never open with') && s.includes('Done'), 'openers banned by name, Done first');
  assert.ok(/brevity/i.test(s), 'brevity ordered');
  // Before the operating rules: voice first, mechanism after.
  assert.ok(s.indexOf('Never open with') < s.indexOf('How to work:'), 'voice before rules');
});

test('a greeting or thanks gets one sentence back, with no tools and no steps', () => {
  const s = system();
  const line = s.split('\n').find((l) => /hello/i.test(l) && /thank/i.test(l)) ?? '';
  assert.ok(line, 'one short-message line names both');
  assert.ok(/one sentence/.test(line) && /no tools/.test(line), `it orders one sentence with no tools: ${line.slice(0, 120)}`);
});

test('answers from a pasted message propose unless the change is a single fact (F13)', () => {
  const s = system();
  const i = s.indexOf('Catching a project up');
  assert.ok(i >= 0, 'the catch-up bullet is there');
  const para = s.slice(i, i + 1400);
  assert.ok(/past/i.test(para) && /propose/i.test(para), 'message-sourced updates propose');
  assert.ok(/single fact/.test(para), 'a single fact still writes direct');
});

test('the plain path reads the same voice block (every door)', async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'ai.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/main/ai.ts'))};\n`);
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'ai.mjs'), format: 'esm' }, logLevel: 'silent' }).catch(() => null);
  // ai.ts reaches electron-typed stores; when it cannot bundle here, the source still pins the shared block.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(path.join(root, 'src/main/ai.ts'), 'utf8');
  assert.ok(src.includes('ASSISTANT_VOICE'), 'the plain prompt reads the one voice block, not its own copy');
});

// ── Stop words that read like a colleague (F2) ────────────────────────────────

test('stopping reads plain and warm, never a build log', () => {
  for (const why of ['steps', 'time', 'stuck', 'silent', 'error']) {
    const words = M.writtenAnswer(why, [], [], null);
    assert.doesNotMatch(words, /I stopped before finishing/, `${why}: the build-log open is gone`);
    assert.doesNotMatch(words, /The work on this has stopped/, `${why}: no work-log words`);
    assert.ok(words.includes('Next step:'), `${why}: the concrete next step stays`);
  }
  assert.match(M.writtenAnswer('steps', [], [], null), /^I ran out of steps on this/);
  assert.match(M.writtenAnswer('stuck', [], [], null), /^I got stuck/);
});

test('the plan detector still tells a plan from a summary', () => {
  assert.equal(M.announcesWork("I'll set up each project properly."), true, 'a plan alone carries on');
  assert.equal(M.announcesWork('Hello — what do you need from your notes?'), false, 'a greeting is an answer');
  assert.equal(M.announcesWork("I've set up 11 projects."), false, 'a summary of done work is an answer');
  assert.equal(M.announcesWork("I'll remind you on Friday at 9:00 am."), false, 'a reminder promise is the answer');
});

// ── Folded steps summarise what was read (F9) ─────────────────────────────────

test('folded steps: a few read as one line, many as their kinds', () => {
  assert.equal(S.foldSteps([]), '', 'no steps, no line');
  assert.equal(S.foldSteps([{ kind: 'read', words: 'Read Harbourline Cart Fix' }]), 'Read Harbourline Cart Fix');
  assert.equal(
    S.foldSteps([
      { kind: 'read', words: 'Read this page' },
      { kind: 'read', words: 'Read 2 linked notes' },
    ]),
    'Read this page · Read 2 linked notes',
    'three or fewer keep their words',
  );
  assert.equal(
    S.foldSteps([
      { kind: 'read', words: 'Read a' },
      { kind: 'read', words: 'Read b' },
      { kind: 'read', words: 'Read c' },
    ]),
    'Read a · Read b · Read c',
    'three is still words',
  );
  assert.equal(
    S.foldSteps([
      { kind: 'read', words: 'Read a' },
      { kind: 'read', words: 'Read b' },
      { kind: 'read', words: 'Read c' },
      { kind: 'read', words: 'Read d' },
    ]),
    'Read 4 notes',
    'reads fold to what they are, never a bare count',
  );
  assert.equal(
    S.foldSteps([
      { kind: 'search', words: 'Searched x' },
      { kind: 'search', words: 'Searched y' },
      { kind: 'read', words: 'Read a' },
      { kind: 'read', words: 'Read b' },
    ]),
    '2 searches · 2 reads',
    'mixed kinds fold to their counts',
  );
  assert.equal(
    S.foldSteps([
      { kind: 'say', words: 'Let me check…' },
      { kind: 'read', words: 'Read a' },
      { kind: 'read', words: 'Read b' },
      { kind: 'read', words: 'Read c' },
      { kind: 'read', words: 'Read d' },
    ]),
    'Read 4 notes',
    'thinking aloud never counts in the finished line',
  );
});

test('folded steps: long jobs keep their count beside the kinds', () => {
  const steps = [
    { kind: 'search', words: 'Searched x' },
    { kind: 'search', words: 'Searched y' },
    { kind: 'read', words: 'Read a' },
    { kind: 'read', words: 'Read b' },
    { kind: 'read', words: 'Read c' },
    { kind: 'read', words: 'Read d' },
    { kind: 'read', words: 'Read e' },
    { kind: 'write', words: 'Wrote f' },
  ];
  assert.equal(S.foldSteps(steps), '8 steps · 2 searches · 5 reads · 1 change');
});

// ── A hand-over is said once, plainly (p5) ───────────────────────────────────────

// ── Speakers in meeting transcripts (6 Nov 2026, speakers) ──────────────────────

test('the assistant reads numbered voices and their names, never guessing', () => {
  const s = system();
  const line = s.split('\n').find((l) => /tells its speakers apart by voice/.test(l)) ?? '';
  assert.ok(line, 'the speakers bullet is there');
  assert.ok(/Speaker 1/.test(line) && /speakers properties/.test(line), `voices and where their names sit: ${line.slice(0, 200)}`);
  assert.ok(/never guessed/.test(line) && /ownerless/.test(line), `unnamed voices and ownerless actions: ${line.slice(-200)}`);
});

// ── Moves in titles (F6) ─────────────────────────────────────────────────────

test('a move reads as its title and its new folder, never raw paths', () => {
  assert.equal(S.moveWords('Inbox/Supplier quote harbour.md', 'Projects/Harbourline Cart Fix/Notes/Supplier quote harbour.md'), 'Moved Supplier quote harbour to Harbourline Cart Fix · Notes');
  assert.equal(S.moveWords('Inbox/Late shift idea.md', 'Projects/Museum Late Shift/Late shift idea.md'), 'Moved Late shift idea to Museum Late Shift');
  assert.equal(S.moveWords('Notes/Old name.md', 'Notes/New name.md'), 'Renamed Old name to New name', 'a move that stays put is a rename');
  assert.equal(S.moveWords('Inbox/Loose thought.md', 'Loose thought.md'), 'Moved Loose thought to the top of your notes');
});
