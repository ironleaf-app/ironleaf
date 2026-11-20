// node --test tests/agent-tasks.test.mjs — ticking and rescheduling tasks for the Vault's assistant (5 Nov 2026:
// the audit found the side chat could list tasks (tasks_list) but not tick one or move one to another day — every
// tick went through edit_note's exact-text replace, which refuses a line said twice). tick_task and reschedule_task
// address tasks by their words in their note and write through the Tasks view's own actions (src/main/tasks.ts), one
// task or several at once, with one Undo for all of it. Real tool rounds through AgentTools on a temp vault on disk.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-agent-tasks-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};\nexport { gateNotes } from ${JSON.stringify(path.join(root, 'src/main/agent-gate.ts'))};\nexport { TasksService } from ${JSON.stringify(path.join(root, 'src/main/tasks.ts'))};\nexport { noteBefore, recordingWrites } from ${JSON.stringify(path.join(root, 'src/main/module-writes.ts'))};\nexport { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'agent.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try { symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction'); } catch {}
  M = await import(pathToFileURL(path.join(work, 'agent.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const run = (tools, name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });
// Thursday 5 November 2026: "Friday" is 2026-11-06, "tomorrow" too.
const NOW = new Date(2026, 10, 5, 10, 0, 0);

/** A vault on disk with the real Tasks view actions and the real write recorder behind them. */
function diskHost(initial) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-tasks-vault-'));
  const index = new M.VaultIndex();
  const abs = (rel) => path.join(dir, ...rel.split('/'));
  const now = NOW.getTime();
  const reindex = (rel) => {
    const f = abs(rel);
    if (existsSync(f) && /\.md$/i.test(rel)) {
      const text = readFileSync(f, 'utf8');
      index.set(rel, text, now, text.length);
    } else index.delete(rel);
  };
  for (const [rel, text] of Object.entries(initial)) {
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), text);
    reindex(rel);
  }
  const allRels = () => {
    const out = [];
    const walk = (d, prefix) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (rel.startsWith('.neuralvault')) continue;
        if (e.isDirectory()) walk(path.join(d, e.name), rel);
        else out.push(rel);
      }
    };
    walk(dir, '');
    return out;
  };
  const write = async (rel, text) => {
    const f = abs(rel);
    const existed = existsSync(f);
    M.noteBefore(rel, existed, existed ? readFileSync(f, 'utf8') : undefined);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
    reindex(rel);
  };
  const tasks = new M.TasksService({ index, templatesFolder: () => 'Templates', write, now: () => NOW.getTime() });
  const host = {
    dir,
    index,
    listing: async () => {
      const files = allRels();
      return { files: files.map((rel) => ({ rel, kind: 'note' })), folders: [...new Set(files.filter((r) => r.includes('/')).map((r) => r.slice(0, r.lastIndexOf('/'))))] };
    },
    exists: async (rel) => existsSync(abs(rel)),
    read: async (rel) => readFileSync(abs(rel), 'utf8'),
    write,
    makeFolder: async (rel) => mkdirSync(abs(rel), { recursive: true }),
    move: async (from, to) => {
      mkdirSync(path.dirname(abs(to)), { recursive: true });
      writeFileSync(abs(to), readFileSync(abs(from)));
      rmSync(abs(from));
      reindex(from);
      reindex(to);
      return { path: to, linksUpdated: 0 };
    },
    trash: async (rel) => {
      rmSync(abs(rel), { recursive: true, force: true });
      reindex(rel);
    },
    clean: (rel) => (typeof rel === 'string' && rel && !rel.split('/').includes('..') ? rel.replace(/^\/+/, '') : ''),
    today: () => 'Thursday 5 November 2026 (2026-11-05)',
    now: () => new Date(NOW.getTime()),
    tasks: {
      tick: async (p, line, text, done) => {
        const { out, changed } = await M.recordingWrites(() => tasks.tick(p, line, text, done));
        return { ...out, changed };
      },
      setDue: async (p, line, text, iso, time) => {
        const { out, changed } = await M.recordingWrites(() => tasks.setDue(p, line, text, iso, time));
        return { ...out, changed };
      },
    },
  };
  return { host, dir, read: (rel) => readFileSync(abs(rel), 'utf8'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const SHOPPING = '# Shopping\n\n- [ ] Buy oat milk\n- [ ] Buy flour from Laucke\n';
const WORK = '# Work\n\n- [ ] Buy oat milk for the kitchen\n- [x] File the invoice\n';

test('ticking a task by its words, in its note', async () => {
  const v = diskHost({ 'Notes/Shopping.md': SHOPPING });
  try {
    const steps = [];
    const tools = new M.AgentTools(v.host, [], (s) => steps.push(s));
    const r = await run(tools, 'tick_task', { tasks: [{ note: 'Shopping', task: 'Buy oat milk' }] });
    assert.equal(r.isError, undefined, r.text);
    assert.match(r.text, /Done/, 'says it is done');
    assert.match(v.read('Notes/Shopping.md'), /- \[x\] Buy oat milk\n/, 'the line flipped, nothing else moved');
    assert.match(v.read('Notes/Shopping.md'), /- \[ \] Buy flour from Laucke/, 'its neighbour left alone');
    assert.ok(steps.some((s) => s.kind === 'write' && /oat milk/i.test(s.words)), 'a step names the task');
    assert.equal(tools.changes.length, 1, 'one change for Undo');
    assert.equal(tools.changes[0].kind, 'edited');
  } finally {
    v.cleanup();
  }
});

test('unticking, and a line said twice named by its note', async () => {
  const v = diskHost({ 'Notes/Shopping.md': SHOPPING, 'Notes/Work.md': '# Work\n\n- [ ] Buy oat milk\n- [ ] Buy oat milk for the kitchen\n- [x] File the invoice\n' });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    const vague = await run(tools, 'tick_task', { tasks: [{ task: 'Buy oat milk' }] });
    assert.equal(vague.isError, true, 'the same words in two notes is not a pick');
    assert.match(vague.text, /Shopping|Work/, 'it names where each is');
    const exact = await run(tools, 'tick_task', { tasks: [{ task: 'Buy oat milk for the kitchen' }] });
    assert.equal(exact.isError, undefined, exact.text);
    assert.match(v.read('Notes/Work.md'), /- \[x\] Buy oat milk for the kitchen/, 'the exact words win over a shorter match');
    const back = await run(tools, 'tick_task', { tasks: [{ note: 'Notes/Work.md', task: 'File the invoice', done: false }] });
    assert.equal(back.isError, undefined, back.text);
    assert.match(v.read('Notes/Work.md'), /- \[ \] File the invoice/, 'unticked again');
    const missing = await run(tools, 'tick_task', { tasks: [{ task: 'Walk the dog' }] });
    assert.equal(missing.isError, true, 'nothing with those words is said');
  } finally {
    v.cleanup();
  }
});

test('rescheduling to the day as said, with a time when given', async () => {
  const v = diskHost({ 'Notes/Shopping.md': SHOPPING, 'Notes/Reminders.md': '# Reminders\n\n- [ ] Call Priya ⏰ 2026-11-06 09:00\n' });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    const r = await run(tools, 'reschedule_task', { tasks: [{ note: 'Shopping', task: 'Buy flour from Laucke' }], when: 'Friday' });
    assert.equal(r.isError, undefined, r.text);
    assert.match(v.read('Notes/Shopping.md'), /Buy flour from Laucke 📅 2026-11-06/, 'Friday from Thursday is the 6th');
    const timed = await run(tools, 'reschedule_task', { tasks: [{ task: 'Buy oat milk' }], when: 'tomorrow at 3pm' });
    assert.equal(timed.isError, undefined, timed.text);
    assert.match(v.read('Notes/Shopping.md'), /Buy oat milk 📅 2026-11-06 15:00/, 'the time rides with the day');
    const off = await run(tools, 'reschedule_task', { tasks: [{ task: 'Buy oat milk' }] });
    assert.equal(off.isError, undefined, off.text);
    assert.ok(!/📅/.test(v.read('Notes/Shopping.md').split('\n').find((l) => l.includes('Buy oat milk'))), 'no day takes the day off');
    const vague = await run(tools, 'reschedule_task', { tasks: [{ task: 'Buy flour from Laucke' }], when: 'not a day at all xyz' });
    assert.equal(vague.isError, true, 'words that are no day ask once, never guess');
    const bell = await run(tools, 'reschedule_task', { tasks: [{ note: 'Reminders', task: 'Call Priya' }], when: 'Friday' });
    assert.equal(bell.isError, true, 'a reminder keeps its time from the reminder');
    assert.match(bell.text, /reminder/i, 'and says so');
  } finally {
    v.cleanup();
  }
});

test('tasks in bulk, with one Undo for all of it', async () => {
  const v = diskHost({ 'Notes/Shopping.md': SHOPPING, 'Notes/Work.md': WORK });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    const r = await run(tools, 'tick_task', { tasks: [{ note: 'Shopping', task: 'Buy oat milk' }, { note: 'Shopping', task: 'Buy flour from Laucke' }, { note: 'Work', task: 'Buy oat milk for the kitchen' }] });
    assert.equal(r.isError, undefined, r.text);
    assert.match(r.text, /3/, 'says how many went');
    assert.ok(!/- \[ \]/.test(v.read('Notes/Shopping.md')), 'every line in the note flipped');
    const words = await M.undoChanges(v.host, tools.changes);
    assert.match(words, /Undone: 3 changes/, 'one Undo takes the whole bulk back');
    assert.equal(v.read('Notes/Shopping.md'), SHOPPING, 'back word for word');
    assert.match(v.read('Notes/Work.md'), /- \[ \] Buy oat milk for the kitchen/, 'the other note back too');
  } finally {
    v.cleanup();
  }
});

test('a tick that matches its project’s step closes both, and Undo opens both', async () => {
  const project = ['---', 'type: project', 'status: active', 'owner: Alex Rivera', '---', '# Brunswick site', '', "## What's next", '', '- [ ] Reply to Shana Tran – Alex Rivera · by 31 Oct 2026', ''].join('\n');
  const meeting = ['---', 'project: Brunswick site', '---', '# Clause call', '', '## Actions', '', '- [ ] Reply to Shana Tran – Alex Rivera · by 31 Oct 2026', ''].join('\n');
  const v = diskHost({ 'Business/Projects/Brunswick site.md': project, 'Business/Meetings/Clause call.md': meeting });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    const r = await run(tools, 'tick_task', { tasks: [{ note: 'Clause call', task: 'Reply to Shana Tran' }] });
    assert.equal(r.isError, undefined, r.text);
    assert.match(v.read('Business/Meetings/Clause call.md'), /- \[x\] Reply to Shana Tran/, 'the line ticked');
    assert.match(v.read('Business/Projects/Brunswick site.md'), /- \[x\] Reply to Shana Tran/, 'its project step ticked with it');
    const paths = tools.changes.map((c) => c.path).sort();
    assert.deepEqual(paths, ['Business/Meetings/Clause call.md', 'Business/Projects/Brunswick site.md'], 'Undo knows both notes');
    await M.undoChanges(v.host, tools.changes);
    assert.equal(v.read('Business/Projects/Brunswick site.md'), project, 'the step back open');
    assert.equal(v.read('Business/Meetings/Clause call.md'), meeting, 'the line back open');
  } finally {
    v.cleanup();
  }
});

test('the gate holds tasks like every other write', async () => {
  const v = diskHost({ 'Secret/Plan.md': '# Plan\n- [ ] Call Priya\n', 'Notes/Open.md': '# Open\n- [ ] Call Priya\n' });
  try {
    const gate = {
      who: 'side-chat',
      name: 'The side chat',
      key: () => 'k',
      level: () => 'open',
      sees: (p) => !String(p).startsWith('Secret/'),
      allowsLevel: () => true,
      check: (rel) => {
        if (String(rel).startsWith('Secret/')) throw new Error('That is marked Family-private and The side chat isn’t allowed Family-private items (the person sets this in Ironleaf › Settings › Privacy and secrets).');
      },
      note: () => {},
      listed: () => {},
    };
    const tools = new M.AgentTools(M.gateNotes(v.host, gate), [], () => {});
    const refused = await run(tools, 'tick_task', { tasks: [{ note: 'Secret/Plan.md', task: 'Call Priya' }] });
    assert.equal(refused.isError, true, 'a task it may not change is refused');
    assert.match(refused.text, /Privacy and secrets/, 'the refusal says the limit and where to change it');
    assert.match(v.read('Secret/Plan.md'), /- \[ \] Call Priya/, 'nothing flipped');
    const moved = await run(tools, 'reschedule_task', { tasks: [{ note: 'Secret/Plan.md', task: 'Call Priya' }], when: 'Friday' });
    assert.equal(moved.isError, true, 'rescheduling it refuses too');
    const ok = await run(tools, 'tick_task', { tasks: [{ note: 'Notes/Open.md', task: 'Call Priya' }] });
    assert.equal(ok.isError, undefined, ok.text);
  } finally {
    v.cleanup();
  }
});

test('task tool replies never invite refusal', async () => {
  const v = diskHost({ 'Notes/Shopping.md': SHOPPING });
  try {
    const tools = new M.AgentTools(v.host, [], () => {});
    const replies = [
      (await run(tools, 'tick_task', { tasks: [{ task: 'nothing like this' }] })).text,
      (await run(tools, 'tick_task', { tasks: [{ task: 'Buy oat milk' }] })).text,
      (await run(tools, 'reschedule_task', { tasks: [{ task: 'Buy oat milk' }], when: 'not a day at all xyz' })).text,
      (await run(tools, 'reschedule_task', { tasks: [{ task: 'Buy oat milk' }], when: 'Friday' })).text,
    ];
    const forbidden = ['read-only', 'read only', 'writes are disabled', 'in this session', 'when you are in Ironleaf', "otherwise you can't", 'when it is offered'];
    for (const text of replies) {
      for (const line of String(text).split('\n')) {
        for (const phrase of forbidden) {
          if (!line.toLowerCase().includes(phrase)) continue;
          assert.ok(/remote computer/i.test(line), `a tool reply invites refusal: “${line.slice(0, 160)}”`);
        }
      }
    }
  } finally {
    v.cleanup();
  }
});
