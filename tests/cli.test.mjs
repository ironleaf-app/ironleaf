// node --test tests/cli.test.mjs — the ironleaf command (src/shared/cli.ts, src/main/cli.ts, src/main/windows-entry.ts;
// 21 Oct 2026, gap G26): its words read into a verb (quotes, --flags, the pipe, mistakes said plainly), each verb handed
// to the verbs agents use (vault_search, note_read, note_create, note_append) or done here (property:set, tasks), the
// local connection refusing anything without the secret, and its places in Windows written once (reg.exe's arguments,
// the user's PATH kept as it was with the command's folder added, nothing written again on the next start).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-cli-'));
let M;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  const src = (p) => JSON.stringify(path.join(root, p));
  writeFileSync(entry, [`export * from ${src('src/shared/cli.ts')};`, `export * from ${src('src/main/cli.ts')};`, `export * from ${src('src/main/windows-entry.ts')};`, `export * from ${src('src/main/test-build.ts')};`].join('\n'));
  await build({ input: entry, platform: 'node', external: ['yaml', 'electron', /^node:/], output: { file: path.join(work, 'cli.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  M = await import(pathToFileURL(path.join(work, 'cli.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const ok = (argv, stdin = '') => {
  const r = M.parseCli(argv, stdin);
  assert.equal(r.ok, true, r.error);
  return r.command;
};
const bad = (argv, re) => {
  const r = M.parseCli(argv);
  assert.equal(r.ok, false);
  assert.match(r.error, re);
};

test('each verb’s words are read', () => {
  assert.deepEqual(ok([]), { verb: 'help', about: '' });
  assert.deepEqual(ok(['help', 'tasks']), { verb: 'help', about: 'tasks' });
  assert.deepEqual(ok(['--version']), { verb: 'version' });
  assert.deepEqual(ok(['open', 'Site walk']), { verb: 'open', note: 'Site walk' });
  assert.deepEqual(ok(['read', 'Meetings/Site walk.md']), { verb: 'read', note: 'Meetings/Site walk.md' });
  assert.deepEqual(ok(['search', 'oven', 'service', '--limit', '5']), { verb: 'search', query: 'oven service', limit: 5 });
  assert.deepEqual(ok(['search', '"deck oven"', '--limit=99']), { verb: 'search', query: '"deck oven"', limit: 50 });
  assert.deepEqual(ok(['create', 'Inbox/Idea', 'Sourdough on Fridays', '--open']), { verb: 'create', path: 'Inbox/Idea', text: 'Sourdough on Fridays', open: true });
  assert.deepEqual(ok(['create', 'Inbox/Idea', '--text', 'From a flag']), { verb: 'create', path: 'Inbox/Idea', text: 'From a flag', open: false });
  assert.deepEqual(ok(['append', 'Oven service', 'Called the technician', '--heading', '## Log']), { verb: 'append', note: 'Oven service', text: 'Called the technician', heading: '## Log' });
  assert.deepEqual(ok(['daily:append', 'Rang the flour mill']), { verb: 'daily:append', text: 'Rang the flour mill', heading: '' });
  assert.deepEqual(ok(['daily', 'An alias works too']).verb, 'daily:append');
  assert.deepEqual(ok(['property:set', 'Oven service', 'status', 'done']), { verb: 'property:set', note: 'Oven service', name: 'status', value: 'done', list: false });
  assert.deepEqual(ok(['property:set', 'Oven service', 'tags', 'kitchen, equipment', '--list']).list, true);
  assert.deepEqual(ok(['tasks']), { verb: 'tasks', show: 'open', note: '', limit: 200 });
  assert.deepEqual(ok(['tasks', '--done', '--note', 'Oven service', '--limit', '3']), { verb: 'tasks', show: 'done', note: 'Oven service', limit: 3 });
  // After --, words that look like flags are words.
  assert.deepEqual(ok(['append', 'Log', '--', '--not-a-flag']).text, '--not-a-flag');
});

test('words can come in on the pipe', () => {
  assert.equal(ok(['create', 'Inbox/Pasted'], 'line one\r\nline two').text, 'line one\nline two');
  assert.equal(ok(['append', 'Log', '-'], 'from the pipe').text, 'from the pipe');
  assert.equal(ok(['daily:append'], 'piped day').text, 'piped day');
  assert.equal(ok(['create', 'Inbox/Empty']).text, '');
});

test('mistakes are said plainly', () => {
  bad(['frobnicate'], /no command called “frobnicate”/);
  bad(['open'], /open needs a note/);
  bad(['open', 'a', 'b'], /more words than it uses/);
  bad(['search'], /words to look for/);
  bad(['search', 'x', '--limit', 'lots'], /whole number/);
  bad(['search', 'x', '--heading', 'H'], /search doesn’t take --heading/);
  bad(['append', 'Log'], /needs the words to add/);
  bad(['append', 'Log', '--heading'], /--heading needs a value/);
  bad(['property:set', 'Note'], /a note and a property/);
  bad(['property:set', 'Note', 'a:b', 'c'], /without a colon/);
  bad(['tasks', '--done', '--all'], /not both/);
  bad(['tasks', 'extra'], /more words/);
});

test('help lists every verb, and one verb’s help says when it changes notes', () => {
  const all = M.cliHelp();
  for (const v of ['open', 'read', 'search', 'create', 'append', 'daily:append', 'property:set', 'tasks']) assert.ok(all.includes(`ironleaf ${v}`), v);
  assert.match(M.cliHelp('append'), /File recovery keeps the earlier version/);
  assert.doesNotMatch(M.cliHelp('read'), /File recovery/);
  assert.equal(M.cliWrites({ verb: 'tasks' }), false);
  assert.equal(M.cliWrites({ verb: 'property:set' }), true);
});

test('property values and tick-boxes are read as written', () => {
  assert.equal(M.propertyValue('true'), true);
  assert.equal(M.propertyValue('42'), 42);
  assert.equal(M.propertyValue('007'), '007', 'a leading zero stays words');
  assert.equal(M.propertyValue('  '), null);
  assert.deepEqual(M.propertyValue('a, b,,c', true), ['a', 'b', 'c']);
  const t = M.tasksIn('Kitchen.md', '# Kitchen\n- [ ] Order flour\n* [x] Clean the oven\n1. [-] Cancelled thing\n```\n- [ ] not a task in code\n```\n  + [ ] Nested one\n- not a task');
  assert.deepEqual(t.map((x) => [x.line, x.done, x.text]), [[2, false, 'Order flour'], [3, true, 'Clean the oven'], [4, true, 'Cancelled thing'], [8, false, 'Nested one']]);
  const open = M.tasksIn('Kitchen.md', '- [/] Halfway\n- [?] Unsure');
  assert.deepEqual(open.map((x) => x.done), [false, false], 'in-progress and questioning boxes stay open (9.5 fourth pass)');
});

/** A made-up vault behind the command: the verbs agents use, answered as AgentAccess answers them. */
function fakeHost() {
  const notes = new Map([
    ['Notes/Oven service.md', '---\nstatus: open\n---\n# Oven service\n\n- [ ] Book the technician\n- [x] Clean the racks\n'],
    ['Daily/2026-10-21.md', '# 21 October\n'],
    ['Private notes/Diary.md', '- [ ] secret task\n'],
    ['Projects/Shop/Shop.md', '---\ntype: project\n---\n# Shop\n- [ ] Paint the sign\n'],
  ]);
  const calls = [];
  const opened = [];
  const find = (raw) => {
    if (/^Private notes\//.test(raw)) throw new Error('Private notes are never open to agents.');
    for (const p of notes.keys()) if (p === raw || p.endsWith(`/${raw}.md`) || p === `${raw}.md`) return p;
    throw new Error(`There is no note “${raw}”. Find its path with vault_search or notes_list.`);
  };
  const host = {
    version: () => '9.9.9',
    tool: async (name, args) => {
      calls.push([name, args]);
      if (name === 'vault_search') return { text: `Notes/Oven service.md\n  matched ${args.query}` };
      if (name === 'note_create') {
        const rel = /\.md$/.test(args.path) ? args.path : `${args.path}.md`;
        if (notes.has(rel)) return { text: `${rel} is already there. Read it and use note_append, or choose another name.`, isError: true };
        notes.set(rel, args.content);
        return { text: `Made ${rel}.` };
      }
      if (name === 'note_append') {
        const rel = find(args.path);
        notes.set(rel, `${notes.get(rel).trimEnd()}\n\n${args.text}\n`);
        return { text: `Added to ${rel}.` };
      }
      return { text: `There is no command for ${name}.`, isError: true };
    },
    note: (raw, write) => {
      const rel = find(raw);
      if (write && /^Projects\//.test(rel)) throw new Error('That is a project’s file: use the project tools (project_set_field, project_add_next_step, project_log_update…), so the change lands in the project’s history.');
      return rel;
    },
    open: async (rel) => void opened.push(rel),
    read: async (rel) => notes.get(rel),
    write: async (rel, text) => void notes.set(rel, text),
    canWrite: async () => {},
    dailyNote: async () => 'Daily/2026-10-21.md',
    notes: () => [...notes].map(([p, content]) => ({ path: p, content })),
  };
  return { host, notes, calls, opened };
}

test('each verb is run with the verbs agents use, as the person', async () => {
  const { host, notes, calls, opened } = fakeHost();
  const run = (argv, stdin = '') => M.runCliArgs(argv, stdin, host);
  let r = await run(['search', 'oven']);
  assert.deepEqual([r.exit, calls.at(-1)], [0, ['vault_search', { query: 'oven', limit: 10 }]]);
  r = await run(['read', 'Oven service']);
  assert.equal(r.exit, 0);
  assert.match(r.text, /^---\nstatus: open/);
  r = await run(['open', 'Oven service']);
  assert.deepEqual(opened, ['Notes/Oven service.md']);
  r = await run(['create', 'Inbox/Idea', 'Sourdough Fridays', '--open']);
  assert.deepEqual([r.exit, r.text], [0, 'Made Inbox/Idea.md.']);
  assert.equal(notes.get('Inbox/Idea.md'), 'Sourdough Fridays');
  assert.equal(opened.at(-1), 'Inbox/Idea.md');
  r = await run(['create', 'Inbox/Idea']);
  assert.equal(r.exit, 1);
  assert.match(r.text, /Add to it with ironleaf append/);
  assert.doesNotMatch(r.text, /note_append/);
  r = await run(['append', 'Oven service', 'Technician booked for Tuesday']);
  assert.equal(r.exit, 0);
  assert.match(notes.get('Notes/Oven service.md'), /Technician booked for Tuesday\n$/);
  r = await run(['daily:append', 'Rang the mill'], '');
  assert.deepEqual(calls.at(-1), ['note_append', { path: 'Daily/2026-10-21.md', text: 'Rang the mill' }]);
  r = await run(['property:set', 'Oven service', 'status', 'done']);
  assert.deepEqual([r.exit, r.text], [0, 'Set status in Notes/Oven service.md.']);
  assert.match(notes.get('Notes/Oven service.md'), /^---\nstatus: done\n---\n# Oven service/);
  r = await run(['property:set', 'Oven service', 'status', 'done']);
  assert.match(r.text, /already had that/);
  r = await run(['property:set', 'Oven service', 'visits', '3']);
  assert.match(notes.get('Notes/Oven service.md'), /visits: 3\n/);
  r = await run(['property:set', 'Oven service', 'visits', '']);
  assert.doesNotMatch(notes.get('Notes/Oven service.md'), /visits/);
  r = await run(['property:set', 'Shop', 'status', 'done']);
  assert.equal(r.exit, 1);
  assert.match(r.text, /change it on the project’s page/);
  r = await run(['read', 'Private notes/Diary']);
  assert.deepEqual([r.exit, r.text], [1, 'Private notes are never reached from the command line or links.']);
  r = await run(['read', 'Nowhere']);
  assert.match(r.text, /Look for it with: ironleaf search/);
  r = await run(['version']);
  assert.equal(r.text, 'Ironleaf 9.9.9');
  r = await run(['bogus']);
  assert.equal(r.exit, 2);
});

test('tasks lists tick-boxes, never from Private notes', async () => {
  const { host } = fakeHost();
  let r = await M.runCliArgs(['tasks'], '', host);
  assert.equal(r.exit, 0);
  assert.ok(r.text.includes('[ ] Book the technician  (Notes/Oven service.md:6)'));
  assert.ok(r.text.includes('[ ] Paint the sign'));
  assert.ok(!r.text.includes('secret'));
  assert.ok(!r.text.includes('Clean the racks'));
  r = await M.runCliArgs(['tasks', '--done'], '', host);
  assert.equal(r.text, '[x] Clean the racks  (Notes/Oven service.md:7)');
  r = await M.runCliArgs(['tasks', '--all', '--limit', '1'], '', host);
  assert.match(r.text, /… and 2 more \(use --limit\)\.$/);
  r = await M.runCliArgs(['tasks', '--note', 'Daily/2026-10-21.md'], '', host);
  assert.equal(r.text, 'No open tasks in Daily/2026-10-21.md.');
});

test('the local connection answers only the command with its secret', async () => {
  const file = path.join(work, 'cli.json');
  const seen = [];
  const server = new M.CliServer({ file, version: '1.0.0', run: async (argv, stdin) => (seen.push([argv, stdin]), { exit: 0, text: `ran ${argv.join(' ')}` }) });
  const ep = await server.start();
  const kept = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(kept, ep);
  assert.ok(ep.token.length >= 30);
  const url = `http://127.0.0.1:${ep.port}/cli`;
  const post = (headers, body = { args: ['search', 'oven'], stdin: 'x' }) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let res = await post({ 'x-neuralvault-cli': ep.token });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { exit: 0, text: 'ran search oven' });
  assert.deepEqual(seen, [[['search', 'oven'], 'x']]);
  res = await post({ 'x-neuralvault-cli': 'wrong' });
  assert.equal(res.status, 403);
  res = await post({});
  assert.equal(res.status, 403);
  // A web page's request carries an Origin: refused even with the right secret.
  res = await post({ 'x-neuralvault-cli': ep.token, origin: 'https://example.com' });
  assert.equal(res.status, 403);
  res = await fetch(url, { headers: { 'x-neuralvault-cli': ep.token } });
  assert.equal(res.status, 403, 'only POST');
  res = await post({ 'x-neuralvault-cli': ep.token }, 'not json');
  assert.equal(res.status, 200, 'a string body is read as no words');
  assert.equal(seen.length, 2);
  await server.stop();
  assert.equal(existsSync(file), false, 'cli.json is taken away');
});

test('Windows: links and Open with start the program as the host does, one argument each', () => {
  const exe = 'C:\\Users\\pat\\AppData\\Local\\Programs\\HostApp\\HostApp.exe';
  const entries = M.windowsEntries({ exe, launchArgs: ['--neuralvault'] });
  const byKey = Object.fromEntries(entries.map((e) => [e.key, e.values]));
  // ironleaf:// and the alias kept from before the rename, neuralvault://, both registered the same way.
  for (const scheme of ['ironleaf', 'neuralvault']) {
    assert.equal(byKey[`HKCU\\Software\\Classes\\${scheme}`]['URL Protocol'].data, '');
    assert.equal(byKey[`HKCU\\Software\\Classes\\${scheme}`][''].data, 'URL:Ironleaf link');
    assert.equal(byKey[`HKCU\\Software\\Classes\\${scheme}\\shell\\open\\command`][''].data, `"${exe}" "--neuralvault" "%1"`);
  }
  assert.equal(byKey['HKCU\\Software\\Classes\\NeuralVault.Markdown\\shell\\open\\command'][''].data, `"${exe}" "--neuralvault" "--neuralvault-open=%1"`);
  assert.equal(byKey['HKCU\\Software\\Classes\\.md\\OpenWithProgids']['NeuralVault.Markdown'].type, 'REG_NONE');
  assert.ok(byKey['HKCU\\Software\\Classes\\.markdown\\OpenWithProgids']);
  // Every file type Ironleaf opens (16 Nov 2026 audit finding 14): the same list launchTargets accepts.
  assert.deepEqual(M.OPEN_WITH_EXTS, ['.md', '.markdown', '.mdown', '.mkd', '.txt']);
  for (const ext of ['.mdown', '.mkd', '.txt']) assert.ok(byKey[`HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`], `Open with for ${ext}`);
  // Never the person's own choice for .md (no default value written on .md itself).
  assert.ok(!entries.some((e) => e.key === 'HKCU\\Software\\Classes\\.md'));
  assert.ok(entries.every((e) => e.key.startsWith('HKCU\\')), 'this Windows user only');
  const adds = entries.flatMap(M.regAdds);
  assert.ok(adds.every((a) => a[0] === 'add' && a.at(-1) === '/f'));
  assert.ok(adds.some((a) => a.includes('/ve')));
  assert.ok(!adds.find((a) => a.includes('REG_NONE')).includes('/d'), 'REG_NONE carries no data');
});

test('Windows: reg query read, and the PATH added to once', () => {
  const out = 'HKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\Tools\r\n    (Default)    REG_SZ    x\r\n';
  assert.deepEqual(M.regValues(out), { Path: { type: 'REG_EXPAND_SZ', data: '%USERPROFILE%\\bin;C:\\Tools' }, '': { type: 'REG_SZ', data: 'x' } });
  assert.equal(M.pathWith('%USERPROFILE%\\bin;C:\\Tools', 'C:\\Data\\bin'), '%USERPROFILE%\\bin;C:\\Tools;C:\\Data\\bin');
  assert.equal(M.pathWith('C:\\Tools;c:\\data\\BIN\\', 'C:\\Data\\bin'), null);
  assert.equal(M.pathWith('', 'C:\\Data\\bin'), 'C:\\Data\\bin');
  assert.equal(M.pathWith('C:\\A;;', 'C:\\B'), 'C:\\A;C:\\B');
});

test('Windows: the command’s script hands its words over, and starts Ironleaf when it isn’t running', () => {
  const s = M.cliScripts({ exe: "C:\\Program Files\\Kaitiaki's\\HostApp.exe", launchArgs: ['--neuralvault'], endpointFile: 'C:\\Users\\pat\\AppData\\Roaming\\HostApp\\Ironleaf\\cli.json', ps1: 'C:\\Data\\bin\\neuralvault.ps1' });
  assert.match(s.cmd, /^@echo off\r\npowershell\.exe .* -File "C:\\Data\\bin\\neuralvault\.ps1" %\*\r\nexit \/b %ERRORLEVEL%/);
  assert.ok(s.ps1.includes("$exe = 'C:\\Program Files\\Kaitiaki''s\\HostApp.exe'"), 'quotes doubled');
  assert.ok(s.ps1.includes("$launch = @('--neuralvault')"));
  assert.ok(s.ps1.includes("$endpointFile = 'C:\\Users\\pat\\AppData\\Roaming\\HostApp\\Ironleaf\\cli.json'"));
  assert.ok(s.ps1.includes("'x-neuralvault-cli'"));
  assert.ok(s.ps1.includes('http://127.0.0.1:'));
  assert.ok(s.ps1.includes('Start-Process -FilePath $exe'));
  assert.ok(s.ps1.includes('exit [int]$answer.exit'));
});

// PowerShell's own quoting rules: ' ‘ ’ ‚ ‛ all open and close a single-quoted string (doubled to mean one), and
// " “ ” „ a double-quoted one (where ` escapes). Returns the line numbers left inside a string at their end.
function unclosedPsLines(script) {
  const single = /['\u2018\u2019\u201A\u201B]/;
  const double = /["\u201C\u201D\u201E]/;
  const bad = [];
  script.split(/\r?\n/).forEach((line, n) => {
    if (/^\s*#/.test(line)) return;
    let mode = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (mode === null) {
        if (c === '#') break;
        if (single.test(c)) mode = 's';
        else if (double.test(c)) mode = 'd';
      } else if (mode === 's') {
        if (single.test(c)) { if (single.test(line[i + 1] ?? '')) i++; else mode = null; }
      } else if (c === '`') i++;
      else if (double.test(c)) { if (double.test(line[i + 1] ?? '')) i++; else mode = null; }
    }
    if (mode) bad.push(n + 1);
  });
  return bad;
}

test('Windows: the command’s script parses in PowerShell, curly quotes included', () => {
  const s = M.cliScripts({ exe: 'C:\\Users\\O’Brien\\AppData\\Local\\Programs\\Ironleaf\\Ironleaf.exe', launchArgs: ['--it’s'], endpointFile: 'C:\\Users\\O’Brien\\cli.json', ps1: 'C:\\Data\\bin\\ironleaf.ps1' });
  assert.deepEqual(unclosedPsLines(s.ps1), [], 'every string closes on its own line');
  assert.ok(s.ps1.includes("$exe = 'C:\\Users\\O’’Brien\\AppData"), 'a curly apostrophe in a path is doubled');
  assert.ok(s.ps1.includes('Settings › Connect an AI'), 'points at the setting by its real name');
  // The checker itself catches the 2.0.19 fault.
  assert.deepEqual(unclosedPsLines("[Console]::Out.WriteLine('Your notes’ MCP server runs')"), [1]);
});

test('Windows: registered once — the next start writes nothing', async () => {
  const reg = new Map();
  const ran = [];
  const run = async (args) => {
    ran.push(args);
    const [verb, key] = args;
    if (verb === 'query') {
      const values = reg.get(key);
      if (!values) throw new Error('not found');
      const only = args.includes('/v') ? args[args.indexOf('/v') + 1] : null;
      return `${key}\r\n${[...values].filter(([n]) => !only || n === only).map(([n, v]) => `    ${n || '(Default)'}    ${v.type}    ${v.data}`).join('\r\n')}\r\n`;
    }
    if (verb === 'add') {
      const values = reg.get(key) ?? new Map();
      const name = args.includes('/ve') ? '' : args[args.indexOf('/v') + 1];
      const type = args[args.indexOf('/t') + 1];
      const data = args.includes('/d') ? args[args.indexOf('/d') + 1] : '';
      values.set(name, { type, data });
      reg.set(key, values);
      return '';
    }
    return '';
  };
  reg.set('HKCU\\Environment', new Map([['Path', { type: 'REG_EXPAND_SZ', data: '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps' }]]));
  const files = new Map([['C:\\NV\\icon.ico', Buffer.from('ICO')]]);
  const fs = {
    mkdir: async () => {},
    readFile: async (p) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    },
    writeFile: async (p, d) => void files.set(p, typeof d === 'string' ? Buffer.from(d) : d),
    copyFile: async () => {},
  };
  const broadcasts = [];
  const o = { exe: 'C:\\NS\\HostApp.exe', launchArgs: ['--neuralvault'], dataDir: 'C:\\Data', endpointFile: 'C:\\Data\\cli.json', icon: 'C:\\NV\\icon.ico', run, fs, powershell: async (s) => void broadcasts.push(s) };
  const first = await M.registerWindows(o);
  assert.deepEqual(first.problems, []);
  assert.equal(first.cli, 'C:\\Data\\bin\\ironleaf.cmd');
  assert.equal(first.pathAdded, true);
  assert.equal(first.changed.length, 15, 'links (ironleaf:// and neuralvault://), the program and Open with for five file types');
  assert.equal(reg.get('HKCU\\Environment').get('Path').data, '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Data\\bin');
  assert.equal(reg.get('HKCU\\Environment').get('Path').type, 'REG_EXPAND_SZ', 'its type kept');
  assert.equal(broadcasts.length, 1, 'Windows told the PATH changed');
  assert.equal(reg.get('HKCU\\Software\\Classes\\neuralvault\\DefaultIcon').get('').data, '"C:\\Data\\bin\\neuralvault.ico"');
  assert.ok(String(files.get('C:\\Data\\bin\\ironleaf.ps1')).startsWith('\uFEFF'));
  // The command's name before the rename stays beside it, the same script (AI apps set up with "neuralvault mcp").
  assert.ok(String(files.get('C:\\Data\\bin\\neuralvault.ps1')).startsWith('\uFEFF'));
  assert.equal(String(files.get('C:\\Data\\bin\\neuralvault.ps1')), String(files.get('C:\\Data\\bin\\ironleaf.ps1')));
  assert.match(String(files.get('C:\\Data\\bin\\neuralvault.cmd')), /neuralvault\.ps1/);
  assert.equal(reg.get('HKCU\\Software\\Classes\\ironleaf\\DefaultIcon').get('').data, '"C:\\Data\\bin\\neuralvault.ico"');
  ran.length = 0;
  const second = await M.registerWindows(o);
  assert.deepEqual([second.changed, second.pathAdded, second.problems], [[], false, []]);
  assert.ok(ran.every((a) => a[0] === 'query'), 'nothing written again');
  assert.equal(broadcasts.length, 1);
  // Taken away again: the keys, the Open with choice and the PATH entry.
  ran.length = 0;
  await M.unregisterWindows({ dataDir: 'C:\\Data', run });
  assert.ok(ran.some((a) => a[0] === 'delete' && a[1] === 'HKCU\\Software\\Classes\\neuralvault'));
  assert.ok(ran.some((a) => a[0] === 'delete' && a[1] === 'HKCU\\Software\\Classes\\ironleaf'));
  assert.ok(ran.some((a) => a[0] === 'delete' && a[1] === 'HKCU\\Software\\Classes\\.md\\OpenWithProgids' && a.includes('NeuralVault.Markdown')));
  assert.equal(reg.get('HKCU\\Environment').get('Path').data, '%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps');
});

test('a test build or a development copy never takes the places of the installed Ironleaf', () => {
  const takes = (o) => M.takesPlaces({ platform: 'win32', packaged: true, testBuild: false, ...o });
  assert.equal(takes({}), true, 'an installed copy does');
  assert.equal(takes({ testBuild: true }), false, 'a test build does not');
  assert.equal(takes({ packaged: false }), false, 'a development copy does not');
  assert.equal(takes({ testBuild: true, forced: true }), true, 'unless asked to');
  assert.equal(takes({ packaged: false, forced: true }), true);
  assert.equal(takes({ platform: 'linux', forced: true }), false, 'only on Windows');
  assert.equal(M.isTestBuild(() => '{"name":"ironleaf","testIdentity":true}'), true);
  for (const text of ['{"name":"ironleaf"}', '{"testIdentity":"true"}', '{"testIdentity":false}', 'null', 'not json', '']) assert.equal(M.isTestBuild(() => text), false, text);
  assert.equal(
    M.isTestBuild(() => {
      throw new Error('ENOENT');
    }),
    false,
    'a package.json that can’t be read is the real app',
  );
});

test('only a --test-identity build is marked as one, and the app asks before it registers', () => {
  const release = readFileSync(path.join(root, 'tools', 'release.mjs'), 'utf8');
  assert.match(release, /\.\.\.\(testIdentity \? \{ testIdentity: true \} : \{\}\)/);
  assert.equal(release.split('testIdentity: true').length, 2, 'set in that one place');
  assert.equal(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).testIdentity, undefined);
  const app = readFileSync(path.join(root, 'src', 'main', 'app.ts'), 'utf8');
  assert.match(app, /const registerHere = takesPlaces\(\{/);
  assert.match(app, /testBuild: !!host\.testBuild,/);
  assert.match(app, /windowsEntry: registerHere \?/);
  // And it keeps to its own data and notes, never the person's.
  assert.match(app, /if \(!host\.testBuild && \(await vaultHome\.firstStart\(\)/);
  const index = readFileSync(path.join(root, 'src', 'main', 'index.ts'), 'utf8');
  assert.match(index, /TEST_BUILD \? TEST_DATA : \['@neuralspark', 'vault'\]/);
  assert.match(index, /defaultLibrary: TEST_BUILD \? path\.join\(app\.getPath\('userData'\), 'notes'\) : defaultLibraryIn/);
  assert.match(index, /APP_ID = TEST_BUILD \? TEST_APP_ID : 'com\.kaitiaki\.neuralvault'/);
  assert.ok(release.includes(M.TEST_APP_ID), 'the installer’s own id');
});
