// node tools/verify-weekly-import.mjs <a COPY of a vault> [report.txt] — Weekly Updates' "bring in" (Wave 6 part b)
// proved on a real vault: every long note of weekly updates in it (one "## Week of …" heading a week) is brought in by
// the app's own main-side import (src/main/work/weekly.ts through src/main/work-modules.ts, Weekly Updates switched on),
// then each fact of each week in the original is looked for in the new notes: every status line, bullet, blocker and
// "Source" line word for word, every table row and "Label: A 12, B 9" line as numbers equal to what was written, every
// attached file with its link and what it is. Each new note is also read back and written again, byte for byte. The
// original note must be left exactly as it was. Run it only on a copy: it writes the new notes into the vault given.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [vaultArg, reportArg] = process.argv.slice(2);
if (!vaultArg) throw new Error('Give a copy of a vault: node tools/verify-weekly-import.mjs <vault copy> [report.txt]');
const vault = path.resolve(vaultArg);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-verify-weekly-'));
const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
writeFileSync(path.join(work, 'e.ts'), [`export * from ${JSON.stringify(path.join(root, 'src/main/work-modules.ts'))};`, `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};`, `export * as W from ${JSON.stringify(path.join(root, 'src/shared/weekly-updates.ts'))};`, `export * as P from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`].join('\n'));
await build({ input: path.join(work, 'e.ts'), platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'e.mjs'), format: 'esm' }, logLevel: 'silent' });
mkdirSync(path.join(work, 'node_modules'), { recursive: true });
symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'dir');
const M = await import(pathToFileURL(path.join(work, 'e.mjs')).href);
const { W, P } = M;

// The vault's notes into an index, as the app has them.
const index = new M.VaultIndex();
const walk = (dir, rel = '') => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r);
    else if (e.name.endsWith('.md')) {
      const text = readFileSync(path.join(dir, e.name), 'utf8');
      index.set(r, text, statSync(path.join(dir, e.name)).mtimeMs, text.length);
    }
  }
};
walk(vault);
const written = new Map();
const put = (rel, text) => {
  mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  writeFileSync(path.join(vault, rel), text);
  index.set(rel, text, Date.now(), text.length);
  written.set(rel, text);
};
const w = new M.WorkModules({
  vault: () => ({ root: vault, any: async (rel) => existsSync(path.join(vault, rel)) }),
  index,
  prefs: () => ({ templatesFolder: 'Templates', modules: { weekly: { on: true } } }),
  writeNote: async (rel, text) => put(rel, text),
  importFiles: async () => [],
  pickFiles: async () => [],
  saveFile: async () => null,
  post: () => 0,
  editProject: async () => ({}),
  projects: () => index.allMeta().filter((m) => String(m.props?.type ?? '').toLowerCase() === 'project').map((m) => ({ path: m.path, name: P.parseProject(index.content(m.path) ?? '', m.path).name || m.title })),
  records: () => index.records({ templatesFolder: 'Templates' }),
  requireCreate: async () => {},
});
const weekly = w.parts.find((p) => p.id === 'weekly');
const lines = [];
const say = (s) => (lines.push(s), console.log(s));
let failures = 0;
const fail = (s) => (failures++, say(`  MISSING ${s}`));

const model = await weekly.ops.model();
if (!model.importable.length) say('No long note of weekly updates in this vault (a heading such as “## Week of 19 October 2026” starts each week).');
for (const src of model.importable) {
  const before = readFileSync(path.join(vault, src.path), 'utf8');
  say(`${src.path}: ${src.weeks} ${src.weeks === 1 ? 'week' : 'weeks'} in it.`);
  const res = await weekly.ops.import(src.path);
  say(`  ${res.words}`);
  if (readFileSync(path.join(vault, src.path), 'utf8') !== before) fail('the original note changed');
  const made = res.created.map((rel) => ({ rel, text: readFileSync(path.join(vault, rel), 'utf8') }));
  const updates = made.map((m) => W.readWeekly(m.rel, m.text));
  for (const m of made) {
    const again = W.writeWeekly(W.readWeekly(m.rel, m.text), m.text);
    if (again !== m.text) fail(`${m.rel} doesn’t write back byte for byte`);
  }
  // Each week's section of the original, line by line.
  const flat = made.map((m) => m.text).join('\n').replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').replace(/\s+/g, ' ');
  let facts = 0;
  let week = null;
  for (const raw of before.split(/\r?\n/)) {
    const h2 = /^##\s+(.*)$/.exec(raw);
    if (h2 && !raw.startsWith('###')) {
      week = /^(week\s+(of|commencing|starting|beginning)|w\/c)\s/i.test(h2[1]) ? h2[1] : null;
      continue;
    }
    if (!week) continue;
    const line = raw.trim();
    if (!line || /^\|?\s*:?-{2,}/.test(line) || /^###\s+(attachments?|files?)\s*$/i.test(line)) continue;
    facts++;
    const heading = /^#{3,6}\s+(?:\d+[.)]\s*)?(.*)$/.exec(line);
    if (heading) {
      if (!updates.some((u) => u.sections.some((s) => s.name === heading[1].trim()))) fail(`workstream “${heading[1]}”`);
      continue;
    }
    const row = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/.exec(line);
    if (row) {
      if (/^(measure|metric|name)$/i.test(row[1])) continue;
      const v = W.readMetricValue(row[2]);
      const ok = updates.some((u) => u.sections.some((s) => s.metrics.some((x) => x.name === row[1] && x.value === v.value && (!v.unit || x.unit === v.unit))));
      if (!ok) fail(`measure ${row[1]} = ${row[2]}`);
      continue;
    }
    const group = W.readGroupLine(line);
    if (group && !/^(status|blockers?|risks?|source)\b/i.test(line)) {
      for (const g of group) if (!updates.some((u) => u.sections.some((s) => s.metrics.some((x) => x.group === g.group && x.name === g.name && x.value === g.value)))) fail(`${g.group}: ${g.name} ${g.value}`);
      continue;
    }
    const words = line.replace(/^[-*+]\s+/, '').replace(/^(status|blockers?\s*\/\s*risks?|blockers?|risks?)\s*:\s*/i, '').replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').replace(/\s+/g, ' ').trim();
    if (!flat.includes(words)) fail(`“${words.slice(0, 90)}”`);
  }
  // Attachments: each named file with its link and what it is.
  for (const u of updates) for (const a of u.attachments) say(`  attached: ${a.name}${a.link ? ` → ${a.link}` : ''}${a.what ? ` (${a.what})` : ''}`);
  for (const u of updates) say(`  ${W.weekTitle(u.week)}: ${u.status}, ${u.sections.length} workstreams (${u.sections.map((s) => `${s.name}${s.project ? ` → ${s.project}` : ''}: ${s.metrics.length} measures`).join('; ')})`);
  say(`  ${facts} facts checked.`);
}
say(failures ? `${failures} facts NOT kept.` : 'Every fact kept.');
if (reportArg) writeFileSync(reportArg, `${lines.join('\n')}\n`);
rmSync(work, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
