// node --test tests/vault-tidy.test.mjs — The vault tidy, safe by design (t238 vault rebuild step 1, 12 Nov
// 2026, the decision 5: converted on a copy first, seen before anything touches the real vault, nothing
// deleted). One tool reads a vault in the current format and writes the new format: one Task list per project,
// meeting actions as the project's tasks (old copies removed), questions as `- ?` lines, bare reminders boxed.
// Dry run first (a plain report, nothing written), then run on a copy, never in place; every changed note keeps
// its original in a dated backup folder, and one command puts it all back. Made-up vaults only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main as tidyMain } from '../tools/vault-tidy.mjs';
import { writeT200Vault } from './t200-vault.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-vault-tidy-'));
let V, P, A;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(root, 'src/shared/vault-tidy.ts'))};\n` +
      `export * as prefs from ${JSON.stringify(path.join(root, 'src/shared/prefs.ts'))};\n` +
      `export * as app from ${JSON.stringify(path.join(root, 'src/main/vault-tidy.ts'))};\n`,
  );
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'v.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
  const all = await import(pathToFileURL(path.join(work, 'v.mjs')).href);
  V = all;
  P = all.prefs;
  A = all.app;
});
after(() => rmSync(work, { recursive: true, force: true }));

const NOW = new Date('2026-11-12T09:00:00');
const PROJ = 'Projects/Harbourline Cart Fix.md';
const MEET = 'Meetings/2026-11-10 Tuesday standup.md';

const projectFile = (sections) => ['---', 'type: project', 'status: active', 'owner: Alex Chen', '---', '# Harbourline Cart Fix', '', ...sections].join('\n');
const meetingFile = (sections) => ['---', 'type: meeting', 'date: 2026-11-10', 'project: "[[Harbourline Cart Fix]]"', '---', '# Tuesday standup', '', ...sections].join('\n');

function tidy(files) {
  return V.tidyVault(files.map(([path, text]) => ({ path, text })), NOW);
}

test('project sections fold into one What’s next, Waiting kept waiting', () => {
  const { changes, report } = tidy([
    [PROJ, projectFile(["## What's next", '', '- [ ] Ring ShadeCo', '', '## Waiting', '', '- [ ] Awning deposit — June Park', '- Photograph the wiring', 'Ask June when she lands', '', '## Follow-ups', '', '- [ ] Check the logs — Alex Chen'])],
  ]);
  assert.equal(changes.length, 1);
  const after = changes[0].after;
  assert.ok(after.includes("## What's next"), 'one list');
  assert.ok(!after.includes('## Waiting') || after.includes('Ask June when she lands'), 'Waiting goes unless prose keeps it');
  assert.ok(!after.includes('## Follow-ups'), 'Follow-ups folds');
  assert.ok(after.includes('- [ ] Awning deposit — June Park'), 'owned lines keep their owner');
  assert.ok(after.includes('- [ ] Photograph the wiring ⏳'), 'ownerless Waiting lines stay waiting');
  assert.ok(after.includes('- [ ] Check the logs — Alex Chen'));
  assert.equal(report.tasksFolded, 3);
  assert.equal(report.unplaced.length, 1, 'the prose line is reported, not invented into a task');
  assert.equal(report.unplaced[0].line, 16);
});

test('a meeting action’s project copy is removed, never doubled', () => {
  const { changes, report } = tidy([
    [PROJ, projectFile(["## What's next", '', '- [ ] Send the receipt v2 — Alex Chen', '- [ ] Ring ShadeCo'])],
    [MEET, meetingFile(['## Actions', '', '- [ ] Send the receipt v2 — Alex Chen → [[Harbourline Cart Fix]]'])],
  ]);
  const proj = changes.find((c) => c.path === PROJ).after;
  assert.ok(!proj.includes('Send the receipt v2'), 'the copy goes');
  assert.ok(proj.includes('Ring ShadeCo'), 'the rest stands');
  const meet = changes.find((c) => c.path === MEET).after;
  assert.ok(meet.includes('- [ ] Send the receipt v2 — Alex Chen'), 'the meeting keeps the task');
  assert.ok(!meet.includes('→'), 'its filed mark stripped');
  assert.equal(report.copiesRemoved, 1);
  assert.equal(report.marksStripped, 1);
});

test('done wins either way, and a carried day moves across', () => {
  const { changes } = tidy([
    [PROJ, projectFile(["## What's next", '', '- [x] Book the room', '- [ ] Pay the deposit — by 20 Nov 2026'])],
    [MEET, meetingFile(['## Actions', '', '- [ ] Book the room', '- [ ] Pay the deposit'])],
  ]);
  const meet = changes.find((c) => c.path === MEET).after;
  assert.ok(meet.includes('- [x] Book the room'), 'the ticked copy ticks its meeting line');
  assert.ok(meet.includes('- [ ] Pay the deposit 📅 2026-11-20'), 'the carried day moves across, the one plain way');
  const proj = changes.find((c) => c.path === PROJ).after;
  assert.ok(!proj.includes('Book the room') && !proj.includes('Pay the deposit'), 'both copies go');
});

test('another owner’s same words are never a copy, and notes under a step keep it', () => {
  const { changes, report } = tidy([
    [PROJ, projectFile(["## What's next", '', '- [ ] Send the receipt v2 — Sam Ortega', '- [ ] Send the receipt v2 — Alex Chen', '  The October sample, both pages'])],
    [MEET, meetingFile(['## Actions', '', '- [ ] Send the receipt v2 — Alex Chen'])],
  ]);
  assert.equal(changes.length, 0, 'nothing copied, nothing removed');
  assert.equal(report.copiesRemoved, 0);
  assert.equal(report.unplaced.length, 1, 'the noted step is reported, kept');
  assert.ok(report.unplaced[0].why.includes('has notes under it'));
});

test('meeting sections fold into one Actions, questions gather as - ?', () => {
  const { changes, report } = tidy([
    [MEET, meetingFile(['## Actions', '', '- [ ] Send the receipt v2', '', '## To-dos', '', '- Sam to ring the mill', '', '## Open questions', '', '- [ ] Who signs off? — Alex Chen', '- What time is the soak test?', '', '## Q&A', '', '- ? Who files the dockets?'])],
  ]);
  const after = changes.find((c) => c.path === MEET).after;
  assert.ok(!after.includes('## To-dos'), 'To-dos folds');
  assert.ok(after.includes('- [ ] Sam to ring the mill') || after.includes('Sam to ring the mill'), 'its lines move');
  assert.ok(!after.includes('## Q&A'), 'one Questions section');
  assert.ok(after.includes('- ? Who signs off? — for Alex Chen'), 'a box becomes a question, its owner kept');
  assert.ok(after.includes('- ? What time is the soak test?'), 'a plain line becomes a question');
  assert.ok(after.includes('- ? Who files the dockets?'), 'the Q&A line gathers');
  assert.ok(report.questionsFolded >= 3);
});

test('bare reminders box into tasks; empty ones are reported', () => {
  const { changes, report } = tidy([['Notes/Scratch.md', '# Scratch\n\n⏰ 2026-11-12 09:00 Ring June\n\n⏰ 2026-11-13 09:00\n']]);
  const after = changes.find((c) => c.path === 'Notes/Scratch.md').after;
  assert.ok(after.includes('- [ ] Ring June ⏰ 2026-11-12 09:00'));
  assert.ok(report.unplaced.some((u) => u.why.includes('no words')), 'the empty reminder is reported, not boxed');
  assert.equal(report.remindersBoxed, 1);
});

test('line ends and the trailing newline stand as they were', () => {
  const crlf = projectFile(["## What's next", '', '- [ ] Ring ShadeCo', '', '## Waiting', '', '- Chase the deposit', '']).replace(/\n/g, '\r\n');
  const { changes } = tidy([[PROJ, crlf]]);
  assert.ok(changes[0].after.includes('\r\n'), 'CRLF kept');
  assert.ok(changes[0].after.endsWith('\r\n'), 'trailing newline kept');
  assert.ok(!changes[0].after.endsWith('\r\n\r\n'), 'never stacked');
  const bare = '## Questions\n\n- Who signs off?';
  const again = tidy([['Notes/Scratch.md', bare]]);
  assert.equal(again.changes[0].after.endsWith('\n'), false, 'no trailing newline added');
});

test('tidying twice changes nothing more', () => {
  const files = [
    [PROJ, projectFile(["## What's next", '', '- [ ] Send the receipt v2 — Alex Chen', '', '## Waiting', '', '- Chase the deposit'])],
    [MEET, meetingFile(['## Actions', '', '- [ ] Send the receipt v2 — Alex Chen → [[Harbourline Cart Fix]]', '', '## To-dos', '', '- Ring the mill', '', '## Questions', '', '- Who signs off?'])],
  ];
  const first = tidy(files);
  assert.ok(first.changes.length > 0);
  const second = tidy(first.changes.map((c) => [c.path, c.after]).concat(files.filter(([p]) => !first.changes.some((c) => c.path === p))));
  assert.equal(second.changes.length, 0, 'the second run changes nothing');
  assert.deepEqual(
    second.report.unplaced.map((u) => u.text),
    first.report.unplaced.map((u) => u.text),
    'the report reads the same',
  );
});

test('the dry-run report says what each note becomes, with counts', () => {
  const { report } = tidy([[PROJ, projectFile(["## What's next", '', '- [ ] Ring ShadeCo', '', '## Waiting', '', 'Ask June when'])]]);
  const words = V.tidyReportWords(report, true);
  assert.ok(words.includes('dry run (nothing written)'));
  assert.ok(words.includes(PROJ));
  assert.ok(words.includes('could not be placed'));
  assert.ok(words.includes('Nothing was written.'));
});

// ── The command line, end to end on made-up vaults ───────────────────────────

const SMALL = () => [
  [PROJ, projectFile(["## What's next", '', '- [ ] Send the receipt v2 — Alex Chen', '', '## Waiting', '', '- Chase the deposit'])],
  [MEET, meetingFile(['## Actions', '', '- [ ] Send the receipt v2 — Alex Chen → [[Harbourline Cart Fix]]', '', '## Questions', '', '- Who signs off?'])],
  ['Notes/Scratch.md', '# Scratch\n'],
];
function writeVault(dir, files) {
  for (const [rel, text] of files) {
    const abs = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
}
function readVault(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const abs = path.join(d, e);
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      if (rel.split('/').includes('.tidy-backup')) continue;
      if (statSync(abs).isDirectory()) walk(abs);
      else out.set(rel, readFileSync(abs, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

test('--dry reports and writes nothing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-tidy-dry-'));
  try {
    writeVault(dir, SMALL());
    const before = readVault(dir);
    const said = [];
    assert.equal(await tidyMain(['--dry', dir], (s) => said.push(s)), 0);
    assert.deepEqual(readVault(dir), before, 'not a byte written');
    assert.ok(said.join('\n').includes('dry run (nothing written)'));
    assert.ok(said.join('\n').includes('1 copy removed'), 'the report counts the copy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--to tidies a copy, keeps originals in a dated backup, never touches the vault', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-tidy-copy-'));
  try {
    const src = path.join(dir, 'vault');
    const dest = path.join(dir, 'copy');
    writeVault(src, SMALL());
    const before = readVault(src);
    const said = [];
    assert.equal(await tidyMain(['--from', src, '--to', dest], (s) => said.push(s)), 0);
    assert.deepEqual(readVault(src), before, 'the vault stands as it was');
    const tidied = readFileSync(path.join(dest, ...PROJ.split('/')), 'utf8');
    assert.ok(!tidied.includes('Send the receipt v2 — Alex Chen\n'), 'the copy in the copy is gone');
    assert.ok(tidied.includes('Chase the deposit ⏳'), 'Waiting kept waiting in the copy');
    const backups = readdirSync(path.join(dest, '.tidy-backup'));
    assert.equal(backups.length, 1, 'one dated backup folder');
    assert.equal(readFileSync(path.join(dest, '.tidy-backup', backups[0], ...PROJ.split('/')), 'utf8'), before.get(PROJ), 'the original beside it');
    assert.ok(said.join('\n').includes('Tidied a copy at'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('running twice changes nothing more, and --restore puts it all back', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-tidy-restore-'));
  try {
    const src = path.join(dir, 'vault');
    const dest = path.join(dir, 'copy');
    const dest2 = path.join(dir, 'copy2');
    writeVault(src, SMALL());
    const said = [];
    await tidyMain(['--from', src, '--to', dest], (s) => said.push(s));
    const said2 = [];
    assert.equal(await tidyMain(['--from', dest, '--to', dest2], (s) => said2.push(s)), 0);
    assert.ok(said2.join('\n').includes('already the new shape'), 'the second run changes nothing');
    const backup = path.join(dest, '.tidy-backup', readdirSync(path.join(dest, '.tidy-backup'))[0]);
    const said3 = [];
    assert.equal(await tidyMain(['--restore', backup], (s) => said3.push(s)), 0);
    assert.deepEqual(readVault(dest), readVault(src), 'one command puts it all back, byte for byte');
    assert.ok(said3.join('\n').includes('Put back 2 notes'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('on the t200 made-up vault: a dry run, a copy run, a full restore, and twice changes nothing', async () => {
  // The same 3,000-note vault the walk judges (tests/t200-vault.mjs), pristine: the one strict meeting copy
  // goes (same words, same owner, same project — near-repeats and other projects' lines stand), everything
  // else stands. (Waiting sections, Questions rewrites and bare reminders ride the synthetic vaults above;
  // the t200 vault carries none.)
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-tidy-t200-'));
  try {
    const src = path.join(dir, 'vault');
    mkdirSync(src, { recursive: true });
    assert.equal(writeT200Vault(src), 3000, 'the walk judges a 3,000-note vault');
    const readFiles = (d) => {
      const out = [];
      const walk = (x) => {
        for (const e of readdirSync(x)) {
          const abs = path.join(x, e);
          const rel = path.relative(d, abs).split(path.sep).join('/');
          if (rel.split('/').includes('.tidy-backup')) continue;
          if (statSync(abs).isDirectory()) walk(abs);
          else if (e.endsWith('.md')) out.push({ path: rel, text: readFileSync(abs, 'utf8') });
        }
      };
      walk(d);
      return out;
    };
    const { report } = V.tidyVault(readFiles(src), NOW);
    assert.equal(report.copiesRemoved, 1, 'the one strict meeting copy goes; near-repeats stand');
    assert.equal(report.unplaced.length, 0, 'every line of the made-up vault places');
    const said = [];
    assert.equal(await tidyMain(['--dry', src], (s) => said.push(s)), 0);
    assert.ok(said.join('\n').includes('3,000 notes') || said.join('\n').includes('3000 notes'), 'the dry run counts the vault');
    const dest = path.join(dir, 'copy');
    const said2 = [];
    assert.equal(await tidyMain(['--from', src, '--to', dest], (s) => said2.push(s)), 0);
    const flagship = readFileSync(path.join(dest, 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md'), 'utf8');
    assert.ok(!flagship.includes('Write the rollback note for the retry fix in case Friday goes badly'), 'the copy is gone from the copy');
    assert.ok(flagship.includes('Chase the 2 carts that failed on Friday'), 'the rest stands');
    const standup = readFileSync(path.join(dest, 'Meetings/2026-11-10 Tuesday standup on the retry fix before the Friday release.md'), 'utf8');
    assert.ok(standup.includes('Write the rollback note for the retry fix in case Friday goes badly'), 'the meeting keeps the task');
    const dest2 = path.join(dir, 'copy2');
    const said3 = [];
    assert.equal(await tidyMain(['--from', dest, '--to', dest2], (s) => said3.push(s)), 0);
    assert.ok(said3.join('\n').includes('already the new shape'), 'running twice changes nothing more');
    const backup = path.join(dest, '.tidy-backup', readdirSync(path.join(dest, '.tidy-backup'))[0]);
    assert.equal(await tidyMain(['--restore', backup], () => {}), 0);
    assert.deepEqual(readFiles(dest), readFiles(src), 'a full restore, byte for byte');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Inside the app, behind the switch (off until turned on) ────────────────────

test('the switch starts off, and only true turns it on', () => {
  assert.equal(P.DEFAULT_PREFS.vaultTidy, false);
  assert.equal(P.mergePrefs(P.DEFAULT_PREFS, {}).vaultTidy, false);
  assert.equal(P.mergePrefs(P.DEFAULT_PREFS, { vaultTidy: true }).vaultTidy, true);
  assert.equal(P.mergePrefs(P.DEFAULT_PREFS, { vaultTidy: 'yes' }).vaultTidy, false, 'only true turns it on');
});

test('the app previews over the index and tidies a copy beside the vault', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-tidy-app-'));
  try {
    const src = path.join(dir, 'vault');
    writeVault(src, SMALL());
    const before = new Map(SMALL());
    const index = { allMeta: () => [...before.keys()].map((p) => ({ path: p })), content: (p) => before.get(p) };
    const preview = A.previewVault(index, NOW);
    assert.ok(preview.words.includes('dry run (nothing written)'));
    assert.equal(preview.report.copiesRemoved, 1);
    const run = A.tidyCopyTo(src, NOW);
    assert.ok(run.folder.startsWith(`${src}-tidy-`), 'a copy beside the vault');
    assert.ok(run.backup && run.backup.includes('.tidy-backup'), 'originals kept');
    assert.equal(readFileSync(path.join(run.folder, ...PROJ.split('/')), 'utf8').includes('Send the receipt v2 — Alex Chen\n'), false, 'the copy tidied');
    assert.deepEqual(readVault(src), before, 'the open vault untouched');
    const back = A.restoreBackupFs(run.backup);
    assert.equal(back.restored, 2, 'one command puts it all back');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the app wires the preview, the copy run and the plain words', () => {
  const read = (p) => readFileSync(path.join(root, p), 'utf8');
  assert.ok(read('src/main/app.ts').includes("handle('vault:tidy-preview'"), 'the preview channel');
  assert.ok(read('src/main/app.ts').includes("handle('vault:tidy-copy'"), 'the copy channel');
  assert.ok(read('src/preload/index.ts').includes('vaultTidy'), 'the bridge');
  assert.ok(read('src/renderer/src/components/BackupSettings.tsx').includes('VaultTidySettings'), 'the switch rides Backups and sync');
  const dialog = read('src/renderer/src/components/VaultTidy.tsx');
  assert.ok(dialog.includes('Tidy my vault into the new shape'), 'the one plain button');
  assert.ok(dialog.includes('prefs.vaultTidy'), 'behind the switch');
});

test('never in place: the vault itself, inside it, and non-empty folders are refused', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nv-tidy-refuse-'));
  try {
    const src = path.join(dir, 'vault');
    writeVault(src, SMALL());
    const said = [];
    assert.equal(await tidyMain(['--from', src, '--to', src], (s) => said.push(s)), 2);
    assert.equal(await tidyMain(['--from', src, '--to', path.join(src, 'copy')], (s) => said.push(s)), 2);
    const busy = path.join(dir, 'busy');
    mkdirSync(busy);
    writeFileSync(path.join(busy, 'x.md'), 'x');
    assert.equal(await tidyMain(['--from', src, '--to', busy], (s) => said.push(s)), 2);
    assert.ok(said.join('\n').includes('Never in place'));
    assert.ok(said.join('\n').includes('not empty'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
