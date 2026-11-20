// node --test tests/empty-box.test.mjs — an empty tick box is never a task (p12-close-and-noise D): the Daily note
// template writes no empty "- [ ]" lines, and every task count (notes, run sheets, projects) skips an empty box.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-empty-box-'));
let M, L, T, UB, P;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, ['main/templates', 'shared/layouts', 'shared/tasks', 'shared/hub', 'shared/project-file'].map((m, i) => `export * as m${i} from ${JSON.stringify(path.join(root, 'src', `${m}.ts`))};`).join('\n'));
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'e.mjs'), format: 'esm' }, logLevel: 'silent' });
  const all = await import(pathToFileURL(path.join(work, 'e.mjs')).href);
  [M, L, T, UB, P] = [all.m0, all.m1, all.m2, all.m3, all.m4];
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the Daily note template has no empty tick boxes', () => {
  const daily = M.BUILT_INS.find((b) => b.id === 'daily-note').text;
  for (const line of daily.split('\n')) {
    const m = /^(\s*[-*+]\s+\[[ xX]\]\s*)(.*)$/.exec(line);
    assert.ok(!m || m[2].trim(), `an empty box the person never wrote: ${JSON.stringify(line)}`);
  }
  assert.ok(/## Focus/.test(daily) && /## Tomorrow/.test(daily), 'the sections stay');
});

test('an empty box counts nowhere: notes, run sheets and projects', () => {
  const note = '## Focus\n\n- [ ]\n- [ ]   \n- [ ] Reply to Thaddeus\n- [x]\n';
  assert.deepEqual(T.findAllTasks(note).map((t) => t.words), ['Reply to Thaddeus']);
  assert.deepEqual(UB.findTasks(note).map((t) => t.text.trim()), ['Reply to Thaddeus']);
  assert.equal(T.parseTaskLine('- [ ] '), null);
  assert.equal(T.parseTaskLine('- [ ]'), null);
  const sheet = L.runSheet('### Fit-out\n\n- [ ] \n- [ ] Hang the sign\n- [x] Paint the sign\n');
  assert.deepEqual(sheet[0].items.map((i) => i.what), ['Hang the sign', 'Paint the sign']);
  assert.equal(sheet[0].total, 2);
  const p = P.parseProject('---\ntype: project\nstatus: active\n---\n# Shop\n\n## What’s next\n\n- [ ] Reply to Thaddeus\n- [ ]\n', 'Shop.md');
  assert.deepEqual(P.openSteps(p), ['Reply to Thaddeus']);
});
