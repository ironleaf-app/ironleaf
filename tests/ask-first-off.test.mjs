// node --test tests/ask-first-off.test.mjs — Ask before the assistant changes a note: on by default for a new install
// (20 Nov 2026, 2.0; it was off from 5 Nov 2026). A stored value nobody chose follows the default; someone who chose
// in Settings keeps their choice either way. With it off, every way the assistant changes a note goes
// through the answer's Undo as one (edit_note, set_properties, ticks, project rows, a project save's note updates and
// module tools), proven on real files in a temp vault. A task that lives only in a still-waiting suggestion is named in
// one line instead of a long failed search. Nothing promises waiting when it won't (src/shared/prefs.ts,
// src/shared/vault-settings.ts, src/main/agent.ts, src/main/app.ts, Settings.tsx, settingsSearch.ts).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-askoff-'));
let M, P, VS, S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { AgentTools, undoChanges } from ${JSON.stringify(path.join(root, 'src/main/agent.ts'))};`,
      `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`,
      `export { NoteSuggestions } from ${JSON.stringify(path.join(root, 'src/main/suggestions.ts'))};`,
      `export { noteBefore, recordingWrites } from ${JSON.stringify(path.join(root, 'src/main/module-writes.ts'))};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'agent.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    const { symlinkSync } = await import('node:fs');
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'agent.mjs')).href);
  const pure = path.join(work, 'pure.ts');
  writeFileSync(pure, `export * as P from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};\nexport * as VS from ${JSON.stringify(path.join(root, 'src/shared/vault-settings.ts'))};\n`);
  await build({ input: pure, platform: 'node', output: { file: path.join(work, 'pure.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ P, VS } = await import(pathToFileURL(path.join(work, 'pure.mjs')).href));
  const se = path.join(work, 'se.ts');
  writeFileSync(se, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/settingsSearch.ts'))};\n`);
  await build({ input: se, platform: 'node', output: { file: path.join(work, 'se.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'se.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

// ── Item 1: off by default, and the one-time move ────────────────────────────────────────────────────────────────

test('asking first is on by default for a new install (20 Nov 2026, 2.0)', () => {
  assert.equal(P.DEFAULT_PREFS.askBeforeChanges, true);
  assert.equal(P.DEFAULT_PREFS.askBeforeChangesChosen, false);
});

test('a stored value nobody chose follows the default (on); a deliberate choice keeps', () => {
  // A new install has nothing stored: on.
  assert.equal(P.loadPrefs({}).askBeforeChanges, true);
  assert.equal(P.loadPrefs(undefined).askBeforeChanges, true);
  // A stored value with no choice marker was only a saved default: it follows the default.
  assert.equal(P.loadPrefs({ askBeforeChanges: true }).askBeforeChanges, true);
  assert.equal(P.loadPrefs({ askBeforeChanges: false }).askBeforeChanges, true);
  // Deliberate since: the choice marker travels with the choice.
  assert.equal(P.loadPrefs({ askBeforeChanges: true, askBeforeChangesChosen: true }).askBeforeChanges, true);
  assert.equal(P.loadPrefs({ askBeforeChanges: false, askBeforeChangesChosen: true }).askBeforeChanges, false);
  // The marker is the person's, kept with their other choices.
  assert.equal(VS.PREF_HOME.askBeforeChangesChosen, 'personal');
  assert.equal(VS.PREF_HOME.askBeforeChanges, 'personal');
});

test('the Settings toggle records the choice, so it survives a restart', () => {
  const src = readFileSync(path.join(root, 'src/renderer/src/components/AiSettings.tsx'), 'utf8');
  assert.match(src, /onChange=\{\(askBeforeChanges\) => set\(\{ askBeforeChanges, askBeforeChangesChosen: true \}\)\}/);
});

// ── Items 2 and 3: a temp vault of real files ────────────────────────────────────────────────────────────────────

const NOTE_A = 'Bakery/Opening.md';
const NOTE_B = 'Bakery/Suppliers.md';
const NOTE_C = 'Home.md';
const NOTE_D = 'Ideas.md';
const PROJECT = 'Projects/Harbour Cafe.md';
const GROCERIES = 'Groceries.md';

const firstFiles = () => ({
  [NOTE_A]: '# Opening\n\nOpen at 7am.\nClose at 3pm.\n',
  [NOTE_B]: '---\nstatus: draft\n---\n# Suppliers\n\nLaucke.\n',
  [NOTE_C]: '# Home\n\n- [ ] Buy beans\n- [ ] Post the letter 📅 2026-11-06\n',
  [NOTE_D]: '# Ideas\n\nA quiet page.\n',
  [PROJECT]: '---\ntype: project\n---\n# Harbour Cafe\n\n## Summary\n\nA cafe by the harbour.\n',
  [GROCERIES]: '---\nproject: Harbour Cafe\n---\n# Groceries\n\n- [ ] Order cups\n',
});

/** A vault of real files in a temp folder, with the assistant's way in and asking first as given. */
function realVault(ask) {
  const vault = mkdtempSync(path.join(tmpdir(), 'nv-askoff-vault-'));
  const abs = (rel) => path.join(vault, rel);
  const files = firstFiles();
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), text);
  }
  const index = new M.VaultIndex();
  const reindex = (rel) => {
    if (!existsSync(abs(rel))) index.delete(rel);
    else {
      const text = readFileSync(abs(rel), 'utf8');
      index.set(rel, text, Date.now(), text.length);
    }
  };
  for (const rel of Object.keys(files)) reindex(rel);
  const waiting = new M.NoteSuggestions(() => {});
  const readDisk = (rel) => readFileSync(abs(rel), 'utf8');
  const host = {
    index,
    listing: async () => {
      const found = [];
      const walk = (dir, prefix) => {
        for (const n of readdirSync(dir)) {
          const f = path.join(dir, n);
          const rel = prefix ? `${prefix}/${n}` : n;
          if (statSync(f).isDirectory()) walk(f, rel);
          else found.push(rel);
        }
      };
      walk(vault, '');
      return { files: found.map((rel) => ({ rel, kind: 'note' })), folders: [] };
    },
    exists: async (rel) => existsSync(abs(rel)),
    read: async (rel) => readDisk(rel),
    write: async (rel, text) => {
      const there = existsSync(abs(rel));
      const had = there ? readDisk(rel) : undefined;
      M.noteBefore(rel, there, had);
      mkdirSync(path.dirname(abs(rel)), { recursive: true });
      writeFileSync(abs(rel), text);
      reindex(rel);
    },
    makeFolder: async () => {},
    move: async (from, to) => {
      writeFileSync(abs(to), readDisk(from));
      rmSync(abs(from));
      reindex(from);
      reindex(to);
      return { path: to, linksUpdated: 0 };
    },
    trash: async (rel) => {
      rmSync(abs(rel), { force: true });
      reindex(rel);
    },
    clean: (rel) => (typeof rel === 'string' && rel && !rel.split('/').includes('..') ? rel.replace(/^\/+/, '') : ''),
    today: () => 'Thursday 5 November 2026 (2026-11-05)',
    suggest: {
      on: () => ask,
      pending: (rel, cur) => waiting.pending(rel, cur),
      offer: (rel, cur, after) => waiting.offer(rel, cur, after),
      waiting: () => waiting.list().map((e) => e.path),
    },
    tasks: {
      tick: async (p, line, _text, done) => {
        const before = readDisk(p);
        const lines = before.split('\n');
        lines[line] = lines[line].replace(/\[[ xX]\]/, done ? '[x]' : '[ ]');
        const after = lines.join('\n');
        M.noteBefore(p, true, before);
        writeFileSync(abs(p), after);
        reindex(p);
        return { words: 'ticked', line: lines[line], changed: [{ path: p, before }] };
      },
      setDue: async (p, line, _text, iso, time) => {
        const before = readDisk(p);
        const lines = before.split('\n');
        lines[line] = lines[line].replace(/\s*📅\s*\S+( \S+)?\s*$/, '');
        if (iso) lines[line] += ` 📅 ${iso}${time ? ` ${time}` : ''}`;
        const after = lines.join('\n');
        M.noteBefore(p, true, before);
        writeFileSync(abs(p), after);
        reindex(p);
        return { words: 'moved', changed: [{ path: p, before }] };
      },
    },
    modules: {
      specs: () => [{ name: 'test_module_write', title: 'Test write', level: 'edit', description: 'A test module tool that writes a line.', input: {}, step: 'Wrote a test line' }],
      call: async (name, a) => {
        if (name !== 'test_module_write') throw new Error(`no tool ${name}`);
        const rel = String(a.path ?? NOTE_D);
        await host.write(rel, `${readDisk(rel)}Test line.\n`);
        return 'wrote a test line';
      },
      rules: () => '',
    },
  };
  const steps = [];
  const tools = new M.AgentTools(host, [], (s) => steps.push(s));
  const run = (name, args) => tools.run({ id: 'c', name, arguments: JSON.stringify(args) });
  const disk = () => Object.fromEntries(Object.keys(files).map((rel) => [rel, existsSync(abs(rel)) ? readDisk(rel) : null]));
  return { vault, host, tools, run, steps, disk, waiting, cleanup: () => rmSync(vault, { recursive: true, force: true }) };
}

test('off: every way the assistant changes a note is undone by one Undo, on real files', async () => {
  const v = realVault(false);
  try {
    const before = v.disk();
    let r = await v.run('edit_note', { path: NOTE_A, action: 'append', text: 'Closed on Mondays.' });
    assert.ok(!r.isError, r.text);
    r = await v.run('edit_note', { path: NOTE_A, action: 'replace', find: 'Open at 7am.', text: 'Open at 6:30am.' });
    assert.ok(!r.isError, r.text);
    r = await v.run('set_properties', { path: NOTE_B, properties: { status: 'active' } });
    assert.ok(!r.isError, r.text);
    r = await v.run('tick_task', { tasks: [{ task: 'Buy beans', note: NOTE_C }] });
    assert.ok(!r.isError, r.text);
    r = await v.run('reschedule_task', { tasks: [{ task: 'Post the letter', note: NOTE_C }], when: '10 Nov' });
    assert.ok(!r.isError, r.text);
    r = await v.run('add_row', { project: 'Harbour Cafe', section: 'Key dates', cells: { Date: '2026-11-10', What: 'Lease starts' } });
    assert.ok(!r.isError, r.text);
    // A project save that also brings a note's open step up to date there (one task, one home).
    r = await v.run('save_project', { name: 'Harbour Cafe', summary: 'A cafe by the harbour, nearly open.', next: [{ what: 'Order cups', who: 'Mia' }] });
    assert.ok(!r.isError, r.text);
    assert.notEqual(v.disk()[GROCERIES], before[GROCERIES], 'the note’s step was brought up to date in the note');
    r = await v.run('test_module_write', { path: NOTE_D });
    assert.ok(!r.isError, r.text);
    assert.ok(v.tools.changes.length >= 8, `every change kept for Undo, got ${v.tools.changes.length}`);
    const words = await M.undoChanges(v.host, v.tools.changes);
    assert.match(words, /Undone/);
    assert.deepEqual(v.disk(), before, 'one Undo takes the whole turn back, on disk');
  } finally {
    v.cleanup();
  }
});

test('on: behaviour is as today — edits wait, and one Undo still takes a direct turn back', async () => {
  const v = realVault(true);
  try {
    const r = await v.run('edit_note', { path: NOTE_A, action: 'append', text: 'Closed on Mondays.' });
    assert.match(r.text, /NOT changed yet/);
    assert.equal(v.disk()[NOTE_A], firstFiles()[NOTE_A]);
    assert.equal(v.tools.changes.length, 0);
  } finally {
    v.cleanup();
  }
});

test('a task that lives only in a waiting suggestion is named in one line', async () => {
  const v = realVault(true);
  try {
    const current = firstFiles()[GROCERIES];
    v.waiting.offer(GROCERIES, current, `${current}- [ ] Buy oat milk\n`);
    const tick = await v.run('tick_task', { tasks: [{ task: 'Buy oat milk' }] });
    assert.ok(tick.isError, 'ticking what is not in the note yet still fails');
    assert.equal(tick.text.split('\n').length, 1, `one line, got: ${tick.text}`);
    assert.match(tick.text, /Buy oat milk/);
    assert.match(tick.text, /waiting/);
    assert.match(tick.text, /Groceries/);
    const move = await v.run('reschedule_task', { tasks: [{ task: 'Buy oat milk' }], when: 'tomorrow' });
    assert.ok(move.isError);
    assert.match(move.text, /waiting/);
  } finally {
    v.cleanup();
  }
});

// ── Item 4: no word promises waiting when it won't ───────────────────────────────────────────────────────────────

test('the Settings search says what the row does in either state, never only waiting', () => {
  const entry = S.SETTINGS_INDEX.find((e) => e.title === 'Ask before the assistant changes a note');
  assert.ok(entry, 'the row stays findable');
  assert.match(entry.hint, /straight away/, 'says what off does');
  assert.match(entry.hint, /wait/, 'says what on does');
  // The whole hint shows: search hits wrap instead of ending in … (styles/feel.css, scoped to the hint).
  const css = readFileSync(path.join(root, 'src/renderer/src/styles/feel.css'), 'utf8');
  assert.match(css, /\.set-hit-hint \{\s*white-space: normal;/);
});
