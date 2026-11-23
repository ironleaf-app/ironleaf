// node --test tests/skills.test.mjs — skills (24 Nov 2026, phase 3; src/shared/skills.ts, src/shared/skills-builtin.ts,
// src/main/skills.ts, the skill tools in src/main/agent-access.ts, prompts in src/main/mcp-local.ts). Proven: a SKILL.md
// reads as a skill or says plainly why not; the built-in skills are all well formed and name only tools there are; a
// skill kept in the notes is found with its other files, stands in for a built-in of its name and can be switched off;
// the side chat's instructions list names and descriptions only; skill_use, skill_file and skill_save work through the
// one catalogue for Ironleaf's own chat and an outside AI alike (Private notes never, nothing read outside the skill's
// folder, no keys saved); and an AI connected over MCP gets the skills as prompts.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zip } from '../tools/office-fixtures.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-skills-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(
    entry,
    [
      `export * from ${src('src/shared/skills.ts')};`,
      `export { BUILT_IN_SKILLS, builtInSkills } from ${src('src/shared/skills-builtin.ts')};`,
      `export { SkillLibrary, notesSkills, skillsHome } from ${src('src/main/skills.ts')};`,
      `export { packFrom, packFromZip, skillRoot, leftOut } from ${src('src/main/skill-import.ts')};`,
      `export { AgentAccess, officeBrand } from ${src('src/main/agent-access.ts')};`,
      `export { readWorkbook } from ${src('src/main/office-edit.ts')};`,
      `export { AGENT_TOOLS } from ${src('src/shared/agent-access.ts')};`,
      `export { VaultIndex } from ${src('src/main/indexer.ts')};`,
      `export { catalogueFor, SIDE_EVERYDAY } from ${src('src/shared/vault-tools.ts')};`,
      `export { TOOLS as SIDE_TOOLS } from ${src('src/main/agent.ts')};`,
      `export { handleMcpLine, MCP_INSTRUCTIONS } from ${src('src/main/mcp-local.ts')};`,
    ].join('\n'),
  );
  await build({ input: entry, platform: 'node', external: ['yaml', /^node:/], output: { file: path.join(work, 'skills.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'skills.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const MINE = `---\nname: board-report\ndescription: Monthly board report for the bakery. Use when asked for the board report.\n---\n\n# Board report\n\n1. Lead with cash.\n2. See checklist.md before sending.\n`;
const MINUTES_MINE = `---\nname: meeting-minutes\ndescription: Our minutes, the bakery way. Use for any meeting write-up.\n---\n\nAlways put decisions first.\n`;
const NOTES = {
  'Library/Skills/board-report/SKILL.md': MINE,
  'Library/Skills/board-report/checklist.md': '# Checklist\n\n- Cash on hand\n- Orders\n',
  'Library/Skills/minutes/SKILL.md': MINUTES_MINE,
  'Library/Skills/broken/SKILL.md': '---\nname: broken\n---\n\nNo description above.\n',
  'Private notes/Skills/secret-skill/SKILL.md': '---\nname: secret-skill\ndescription: Should never be seen.\n---\n\nHidden.\n',
  'Notes/Oven service.md': '# Oven service\n\nThe deck oven is serviced every March.\n',
};

function makeIndex(notes = NOTES) {
  const index = new M.VaultIndex();
  for (const [rel, text] of Object.entries(notes)) index.set(rel, text, Date.now(), text.length);
  index.setFiles(['Library/Skills/board-report/logo.png', 'Library/Skills/board-report/data.csv']);
  return index;
}

test('a SKILL.md reads as a skill, or says plainly why not', () => {
  const ok = M.parseSkill(MINE, 'board-report');
  assert.equal(ok.skill.name, 'board-report');
  assert.match(ok.skill.description, /^Monthly board report/);
  assert.match(ok.skill.body, /^# Board report/);
  assert.match(M.parseSkill('---\nname: x\n---\n\nwords\n', 'x').problem, /no description/);
  assert.match(M.parseSkill(`---\nname: x\ndescription: ${'a'.repeat(1100)}\n---\n\nwords\n`, 'x').problem, /longer than 1024/);
  assert.match(M.parseSkill('---\nname: x\ndescription: d\n---\n', 'x').problem, /no instructions/);
  assert.equal(M.parseSkill('---\ndescription: d\n---\n\nw\n', 'My Folder').skill.name, 'my-folder', 'no name: its folder’s');
  assert.equal(M.skillName('  Board Report (Monthly)! '), 'board-report-monthly');
  assert.ok(M.validName('a-b-1') && !M.validName('A') && !M.validName('a--b') && !M.validName('-a'));
  const round = M.parseSkill(M.skillText('x-y', 'Does "this": and that', '# Steps\n\n1. One'), 'x-y');
  assert.deepEqual(round.skill, { name: 'x-y', description: 'Does "this": and that', body: '# Steps\n\n1. One' }, 'what skill_save writes reads back the same');
  assert.equal(M.skillFilePath('../secrets.md'), null);
  assert.equal(M.skillFilePath('ref/../../x'), null);
  assert.equal(M.skillFilePath('./ref/checklist.md'), 'ref/checklist.md');
});

test('the built-in skills are well formed and name only tools there are', () => {
  const skills = M.builtInSkills();
  assert.ok(skills.length >= 9);
  const names = new Set();
  const known = new Set([...M.AGENT_TOOLS.map((t) => t.name), ...M.SIDE_TOOLS.map((t) => t.name), 'office_make']);
  for (const s of skills) {
    assert.ok(M.validName(s.name), s.name);
    assert.ok(!names.has(s.name), `${s.name} twice`);
    names.add(s.name);
    assert.ok(s.description.length > 40 && s.description.length <= 300, `${s.name}: a description an AI can choose by`);
    assert.match(s.description, /Use (when|for)/, `${s.name}: the description says when to use it`);
    const back = M.parseSkill(M.skillText(s.name, s.description, s.body), s.name);
    assert.ok(back.skill, `${s.name} round-trips as a SKILL.md`);
    // Every snake_case word that looks like a tool is one.
    for (const m of s.body.matchAll(/\b([a-z]+_[a-z_]+)\b/g)) assert.ok(known.has(m[1]), `${s.name} names ${m[1]}, which is no tool`);
  }
});

test('the person’s skills are found in the notes, stand in for a built-in, and switch off', () => {
  const index = makeIndex();
  const found = M.notesSkills(index);
  assert.deepEqual(found.skills.map((s) => s.name).sort(), ['board-report', 'meeting-minutes']);
  const board = found.skills.find((s) => s.name === 'board-report');
  assert.deepEqual(board.files, ['checklist.md', 'data.csv', 'logo.png']);
  assert.deepEqual(found.problems, [{ path: 'Library/Skills/broken/SKILL.md', problem: found.problems[0].problem }]);
  assert.ok(!found.skills.some((s) => s.name === 'secret-skill'), 'a Private note is never a skill');
  let off = [];
  const lib = new M.SkillLibrary(() => index, () => off);
  const minutes = lib.list().find((s) => s.name === 'meeting-minutes');
  assert.equal(minutes.source, 'notes', 'the person’s minutes stand in for the built-in');
  assert.equal(lib.list().filter((s) => s.name === 'meeting-minutes').length, 1);
  assert.ok(lib.every().find((e) => e.skill.name === 'meeting-minutes').replaces);
  off = ['word-documents', 'board-report'];
  assert.ok(!lib.list().some((s) => s.name === 'word-documents' || s.name === 'board-report'), 'switched off');
  assert.equal(lib.every().find((e) => e.skill.name === 'board-report').on, false, 'Settings still lists it, off');
  assert.equal(M.skillsHome(index, false), 'Library/Skills');
  assert.equal(M.skillsHome(makeIndex({ 'Notes/a.md': 'a' }), false), 'Skills');
});

test('the instructions list names and descriptions only, never a skill’s instructions', () => {
  const lib = new M.SkillLibrary(() => makeIndex(), () => []);
  const brief = M.skillsBrief(lib.list());
  assert.match(brief, /- board-report: Monthly board report/);
  assert.match(brief, /- excel-workbooks: /);
  assert.match(brief, /your very first step is skill_use/);
  assert.match(brief, /never widens what you may do/);
  assert.ok(!brief.includes('Lead with cash'), 'instructions stay out until loaded');
  assert.ok(brief.length < 6000, `the list stays short (${brief.length})`);
  assert.equal(M.skillsBrief([]), '');
  const many = Array.from({ length: 70 }, (_, i) => ({ name: `s-${i}`, description: 'd', body: 'b', source: 'notes', files: [] }));
  assert.match(M.skillsBrief(many), /10 more: skills_list lists them/);
});

test('the skill tools are in the one catalogue: the side chat has them every round, an outside AI at Read only', () => {
  for (const n of ['skills_list', 'skill_use', 'skill_file', 'skill_save']) {
    assert.ok(M.SIDE_EVERYDAY.has(n), `${n} every round`);
    assert.ok(M.catalogueFor('mcp').some((t) => t.name === n), `${n} over MCP`);
  }
  assert.equal(M.AGENT_TOOLS.find((t) => t.name === 'skill_save').level, 'edit');
  assert.ok(M.AGENT_TOOLS.filter((t) => t.name.startsWith('skill')).every((t) => t.name === 'skill_save' || t.readOnly));
});

let lastDir = '';
/** The least of Ironleaf an agent's skill calls reach: the notes in memory and the skills. */
function setup() {
  const index = makeIndex();
  const files = new Map(Object.entries(NOTES));
  const writeNote = async (rel, text) => {
    files.set(rel, text);
    index.set(rel, text, Date.now(), text.length);
  };
  const dir = path.join(work, `lib-${Math.random().toString(36).slice(2)}`);
  lastDir = path.join(dir, 'pc', 'winter');
  mkdirSync(path.join(dir, 'Library/Skills/board-report'), { recursive: true });
  mkdirSync(path.join(dir, 'pc', 'winter'), { recursive: true });
  writeFileSync(path.join(dir, 'Library/Skills/board-report/data.csv'), 'month,cash\nMarch,1200\n');
  let off = [];
  const lib = new M.SkillLibrary(() => index, () => off);
  const host = {
    dataDir: path.join(dir, '.data'),
    kind: 'standalone',
    ready: async () => {},
    library: () => dir,
    index,
    notes: { index, exists: async (rel) => files.has(rel), read: async (rel) => files.get(rel), clean: (r) => r },
    projects: () => [{ name: 'Winter Menu Launch', path: 'Projects/Winter Menu Launch/Winter Menu Launch.md' }],
    projectView: () => {
      throw new Error('none');
    },
    allProjects: () => [],
    writeNote,
    trash: async () => {},
    today: () => ({}),
    dailyPath: () => 'Daily/today.md',
    dailyNote: async () => 'Daily/today.md',
    freeNote: async (f, t) => `${f}/${t}.md`,
    prefs: () => ({ captureNoProject: 'inbox', timeFormat: 'HH:mm', templatesFolder: 'Templates' }),
    templates: () => [],
    lastReview: async () => null,
    person: () => null,
    changed: () => {},
    files: {
      absolute: (rel) => path.join(dir, rel),
      target: () => ({ kind: 'folder', folder: path.join(dir, 'pc', 'winter') }),
      addedToLibrary: async () => {},
      trashFile: async () => {},
      attachmentsFor: () => 'Notes/attachments',
    },
    skills: { list: () => lib.list(), home: () => 'Library/Skills' },
  };
  const access = new M.AgentAccess(host);
  access.load();
  return { access, files, setOff: (o) => (off = o) };
}
const words = (r) => r.content.map((c) => c.text).join('\n');
const own = (access, name, args) => access.asOwn({ id: 'assistant', name: 'Ironleaf’s assistant', consumer: 'side' }, null, name, args);

test('skill_use loads a skill, skill_file its files, inside its folder only', async () => {
  const { access } = setup();
  const list = JSON.parse(words(await own(access, 'skills_list', {})));
  assert.ok(list.skills.some((s) => s.name === 'board-report' && s.from === 'Library/Skills/board-report/SKILL.md'));
  const used = words(await own(access, 'skill_use', { name: '/Board Report' }));
  assert.match(used, /<skill name="board-report" from="from the person’s notes/);
  assert.match(used, /Lead with cash/);
  assert.match(used, /checklist\.md, data\.csv, logo\.png/);
  const builtIn = words(await own(access, 'skill_use', { name: 'excel-workbooks' }));
  assert.match(builtIn, /built into Ironleaf/);
  assert.match(builtIn, /read_project_file|read_spreadsheet/, 'the side chat reads its own tool names');
  assert.match(words(await own(access, 'skill_file', { name: 'board-report', file: 'checklist.md' })), /Cash on hand/);
  assert.match(words(await own(access, 'skill_file', { name: 'board-report', file: 'data.csv' })), /March,1200/, 'a file beside it, read from disk');
  const pic = await own(access, 'skill_file', { name: 'board-report', file: 'logo.png' });
  assert.ok(pic.isError && /isn’t words/.test(words(pic)));
  const out = await own(access, 'skill_file', { name: 'board-report', file: '../../../Notes/Oven service.md' });
  assert.ok(out.isError, 'nothing outside the skill’s folder');
  const none = await own(access, 'skill_use', { name: 'secret-skill' });
  assert.ok(none.isError && /no skill called/.test(words(none)), 'a skill in a Private note is never loaded');
});

test('skill_save keeps the person’s skill in their notes, brings it up to date, and never holds a key', async () => {
  const { access, files } = setup();
  const r = await own(access, 'skill_save', { name: 'Client Onboarding', description: 'Onboard a new client. Use when a client signs.', instructions: '1. Make their project.\n2. Book the kickoff.' });
  assert.ok(!r.isError, words(r));
  const rel = 'Library/Skills/client-onboarding/SKILL.md';
  assert.match(files.get(rel), /^---\nname: client-onboarding\ndescription: "Onboard a new client\. Use when a client signs\."\n---\n\n1\. Make their project/);
  assert.match(words(await own(access, 'skill_use', { name: 'client-onboarding' })), /Book the kickoff/, 'used straight away');
  const again = await own(access, 'skill_save', { name: 'client-onboarding', description: 'Onboard a new client. Use when a client signs.', instructions: '1. Make their project.\n2. Book the kickoff.\n3. Send the welcome pack.' });
  assert.match(words(again), /Brought up to date/);
  assert.match(files.get(rel), /welcome pack/);
  const replaced = await own(access, 'skill_save', { name: 'pdfs', description: 'Our PDFs. Use for any PDF.', instructions: 'Always A4.' });
  assert.match(words(replaced), /in place of the built-in skill/);
  const key = await own(access, 'skill_save', { name: 'x', description: 'd', instructions: 'Use sk-abcdefghijklmnopqrstuvwxyz123456 to log in.' });
  assert.ok(key.isError && /key or password/.test(words(key)));
});

test('an AI connected over MCP gets the skills as prompts, and is told about them', async () => {
  const { access, setOff } = setup();
  await access.setLocalMcp({ on: true, level: 'read' });
  const backend = {
    version: () => '2.0.17',
    tools: () => access.localMcpTools(),
    call: async (n, a) => ({ text: words(await access.asLocalMcp(n, a)) }),
    prompts: async () => access.localMcpPrompts(),
    prompt: async (n, a) => access.localMcpPrompt(n, a),
  };
  const rpc = async (method, params = {}) => JSON.parse(await M.handleMcpLine(backend, JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })));
  const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
  assert.ok(init.result.capabilities.prompts, 'prompts are offered');
  assert.match(init.result.instructions, /skill_use/);
  const listed = (await rpc('prompts/list')).result.prompts;
  assert.ok(listed.some((p) => p.name === 'board-report' && p.title === 'Board report'));
  assert.ok(!listed.some((p) => p.name === 'secret-skill'));
  const got = (await rpc('prompts/get', { name: 'board-report', arguments: { task: 'The March report' } })).result;
  assert.match(got.messages[0].content.text, /Lead with cash[\s\S]*The job: The March report/);
  assert.match(words(await access.asLocalMcp('skill_use', { name: 'meeting-minutes' })), /decisions first/, 'skill_use at Read only');
  const save = await access.asLocalMcp('skill_save', { name: 'x', description: 'd', instructions: 'i' });
  assert.ok(save.isError, 'saving a skill needs Read and write');
  setOff(['board-report']);
  assert.ok(!(await rpc('prompts/list')).result.prompts.some((p) => p.name === 'board-report'), 'a skill switched off is no prompt');
  assert.equal((await rpc('prompts/get', { name: 'board-report' })).error.code, -32602);
  await access.setLocalMcp({ on: false });
  assert.deepEqual((await rpc('prompts/list')).result.prompts, [], 'Connect an AI off: no prompts');
});

test('a skill someone published comes in from its folder or a zip: words only, nothing outside it', async () => {
  const z = zip({
    'board-report-main/README.md': 'About the repo',
    'board-report-main/skills/board-report/SKILL.md': MINE,
    'board-report-main/skills/board-report/checklist.md': '# Checklist',
    'board-report-main/skills/board-report/scripts/totals.py': 'print(1)',
    'board-report-main/skills/board-report/tool.exe': 'MZ',
    'board-report-main/skills/board-report/.secret': 'x',
    'board-report-main/skills/board-report/__MACOSX/x': 'x',
    'board-report-main/skills/other/SKILL.md': MINUTES_MINE,
  });
  const pack = await M.packFromZip(z, 'board-report.zip');
  assert.equal(pack.name, 'board-report');
  assert.deepEqual([...pack.files.keys()], ['checklist.md', 'scripts/totals.py', 'SKILL.md'].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(pack.skipped.sort(), ['.secret', '__MACOSX/x', 'tool.exe'].sort(), 'programs and hidden files left out');
  assert.equal(M.skillRoot(['a/SKILL.md', 'SKILL.md']), '');
  assert.equal(M.skillRoot(['x/y.md']), null);
  await assert.rejects(M.packFromZip(zip({ 'a/readme.md': 'x' }), 'nothing.zip'), /no SKILL\.md/);
  await assert.rejects(M.packFromZip(zip({ 'SKILL.md': '---\nname: x\n---\n\nbody\n' }), 'x.zip'), /no description/);
  const dir = path.join(work, 'pub', 'minutes');
  mkdirSync(path.join(dir, 'ref'), { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), MINUTES_MINE);
  writeFileSync(path.join(dir, 'ref', 'example.md'), '# Example');
  writeFileSync(path.join(dir, 'run.bat'), 'echo');
  const fromMd = await M.packFrom(path.join(dir, 'SKILL.md'));
  assert.equal(fromMd.name, 'meeting-minutes');
  assert.deepEqual([...fromMd.files.keys()].sort(), ['SKILL.md', 'ref/example.md']);
  assert.deepEqual(fromMd.skipped, ['run.bat']);
  const zipped = path.join(work, 'pub', 'minutes.skill');
  writeFileSync(zipped, zip({ 'SKILL.md': MINUTES_MINE }));
  assert.equal((await M.packFrom(zipped)).name, 'meeting-minutes', 'a .skill file is a zip');
});

test('office_make makes a new Word, Excel or PowerPoint file and keeps it with its project or note', async () => {
  const { access, files } = setup();
  const r = await own(access, 'office_make', { kind: 'xlsx', name: 'Winter menu budget', project: 'winter menu', sheets: [{ name: 'Budget', rows: [['Item', 'Cost'], ['Flour', 120], ['Packaging', 80], ['Total', '=SUM(B2:B3)']] }] });
  assert.ok(!r.isError, words(r));
  assert.match(words(r), /Saved Winter menu budget\.xlsx .*into Winter Menu Launch’s folder/);
  const book = await M.readWorkbook(readFileSync(path.join(lastDir, 'Winter menu budget.xlsx')));
  assert.equal(book.sheets[0].name, 'Budget');
  assert.equal(book.sheets[0].cells.get('B4').formula, 'SUM(B2:B3)', 'the total is a formula');
  assert.equal(book.sheets[0].cells.get('B2').value, 120);
  const d = await own(access, 'office_make', { kind: 'docx', name: 'Oven care', note: 'Oven service', markdown: '# Oven care\n\n- Clean the deck weekly\n' });
  assert.ok(!d.isError, words(d));
  assert.match(files.get('Notes/Oven service.md'), /\[\[Notes\/attachments\/Oven care\.docx\|Oven care\.docx\]\]/, 'linked from its note');
  const p = await own(access, 'office_make', { kind: 'pptx', name: 'Winter menu', project: 'Winter Menu Launch', title: 'Winter menu', slides: [{ title: 'Soups sell in June', bullets: ['Three soups', { text: 'Pumpkin first', level: 1 }] }, { title: 'Before and after', layout: 'two-column', bullets: ['Old'], right: ['New'] }] });
  assert.ok(!p.isError, words(p));
  const none = await own(access, 'office_make', { kind: 'docx', name: 'x', markdown: 'y' });
  assert.ok(none.isError && /Give the project/.test(words(none)));
  const bad = await own(access, 'office_make', { kind: 'pages', name: 'x', project: 'Winter' });
  assert.ok(bad.isError);
  assert.deepEqual(M.officeBrand({ logos: {}, colours: [{ name: 'Sea', hex: '#1d5c7a', use: 'Headings' }, { name: 'Ink', hex: '#14202b', use: 'Text' }], fonts: [{ name: 'Lora', use: 'Headings' }, { name: 'Inter', use: 'Body' }] }), { accent: '#1d5c7a', dark: '#14202b', headingFont: 'Lora', font: 'Inter' });
  assert.equal(M.officeBrand(null), null);
});
