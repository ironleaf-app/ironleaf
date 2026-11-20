// node --test tests/uplift-92-templates.test.mjs — the 9.2 uplift's template identity and setup routing
// (F2, F52, F70): today's note is found by identity (the built-in id, or the main side's exact mark), never by
// matching "today" in a template's own words; two notes from one template on one day never collide into "… 2";
// and the folder-setup flow runs from its chip, never from matching typed words. Pure logic is checked as it
// is; the screens are guarded by the helper they call, so each check fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-u92-templates-'));
let I;
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/renderer/src/lib/templateIdentity.ts'), platform: 'node', output: { file: path.join(work, 'id.mjs'), format: 'esm' }, logLevel: 'silent' });
  I = await import(pathToFileURL(path.join(work, 'id.mjs')).href);
  await build({ input: path.join(root, 'src/shared/templates.ts'), platform: 'node', output: { file: path.join(work, 'shared.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 'shared.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('today’s note is found by identity, never by its words (F2)', () => {
  assert.equal(I.isDailyTemplate({ builtIn: 'daily-note', usedFor: 'Use it for a new note' }), true, 'the built-in in place');
  assert.equal(I.isDailyTemplate({ usedFor: I.DAILY_USED_FOR }), true, 'the vault’s chosen daily template');
  assert.equal(I.isDailyTemplate({ usedFor: 'Use it for a new note' }), false);
  assert.equal(I.isDailyTemplate({ usedFor: 'Notes for today’s meeting' }), false, 'a template about today is a template');
  assert.equal(I.isDailyTemplate({ builtIn: 'meeting', usedFor: 'What we do today' }), false);
  assert.equal(
    S.templateUsedFor({ kind: 'note', text: '---\n---\nwords', path: 'Templates/Notes/Daily.md' }, 'Templates/Notes/Daily.md'),
    I.DAILY_USED_FOR,
    'the contract: the main side marks exactly the daily template with this sentence',
  );
});

test('every template path uses the identity, and the first name stays free (F2, F70)', () => {
  const state = read('src/renderer/src/state/templates.ts');
  assert.ok(state.includes('isDailyTemplate(t) && !opts.project'), 'making from a template checks identity');
  assert.ok(state.includes('!(opts.project && isDailyTemplate(t))'), 'project menus check identity');
  assert.ok(state.includes('freeFirstName(t, folder)'), 'the first name stays free in its folder');
  assert.doesNotMatch(state, /today\/i\.test\(t\.usedFor\)/);
  const page = read('src/renderer/src/views/TemplatesPage.tsx');
  assert.ok(page.includes('isDailyTemplate(t) && !project'), 'the card button checks identity');
  assert.doesNotMatch(page, /today\/i\.test\(t\.usedFor\)/);
});

test('folder setup runs from its chip, never from typed words (F52)', () => {
  const chat = read('src/renderer/src/state/chat.ts');
  assert.ok(chat.includes('export async function setUpProjectsFromFolder'), 'one setup flow in chat state');
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(panel.includes('s === ASK_SETUP'), 'chips route by the chip itself');
  for (const [file, who] of [
    ['src/renderer/src/panels/ChatPanel.tsx', 'the side chat'],
    ['src/renderer/src/views/ProjectsHome.tsx', 'Projects home'],
  ]) {
    assert.ok(read(file).includes('setUpProjectsFromFolder()'), `${who} runs the one setup flow`);
  }
  const prompt = 'Set up my projects from the folder I added';
  const total = ['src/renderer/src/state/chat.ts', 'src/renderer/src/panels/ChatPanel.tsx', 'src/renderer/src/views/ProjectsHome.tsx']
    .reduce((n, f) => n + read(f).split(prompt).length - 1, 0);
  assert.equal(total, 1, 'the setup prompt lives in one place');
});
