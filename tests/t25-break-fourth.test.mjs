// node --test tests/t25-break-fourth.test.mjs — break the third batch (t25, 8 Nov 2026).
// Faults their changes' own tests missed, each with a failing test first and a fix at the cause.
// Made-up people and notes only.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t25-break-fourth-'));
let L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { registerLife, purposefulCard } from ${JSON.stringify(path.join(root, 'src/main/life.ts'))};`,
      `export { buildRecordModel } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`,
      `export { personCard, personTimeline } from ${JSON.stringify(path.join(root, 'src/shared/people.ts'))};`,
      `export { readProps } from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};`,
    ].join('\n'),
  );
  const stub = path.join(work, 'electron-stub.mjs');
  writeFileSync(stub, 'export const shell = {};\nexport default {};\n');
  await build({ input: entry, platform: 'node', external: ['yaml', /^node:/], plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }], output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-11-08';
const AREAS = [{ id: 'work', name: 'Work', folder: 'Work' }, { id: 'health', name: 'Health', folder: 'Health' }];

/** A vault with a work project and a health note, each with a finished promise for Sam. */
function rig() {
  const files = {
    'Work/Beacon.md': '---\ntype: project\nstatus: active\nowner: Sam Lee\n---\n# Beacon\n\n## People\n\n- **Sam Lee** — Owner\n\n## What\'s next\n\n- [x] Send the beacon plan — Sam Lee\n',
    'Work/People/Sam Lee.md': '---\ntype: person\nemail: sam.lee@example.com\n---\n# Sam Lee\n',
    'Health/Cardio check-in.md': '---\nsensitivity: Health\n---\n# Cardio check-in\n\n[[Sam Lee]] joined the morning walk.\n\n- [x] Log the morning walk — Sam Lee\n',
    'Health/Walk log.md': '# Walk log\n\nWalks with [[Sam Lee]] this month.\n\n- [x] Finish the coastal walk — Sam Lee\n',
  };
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const abs = (rel) => path.join(dir, ...rel.split('/'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), String(text));
  }
  const metas = new Map();
  for (const rel of Object.keys(files)) {
    const text = readFileSync(abs(rel), 'utf8');
    const title = rel.split('/').pop().replace(/\.md$/i, '');
    metas.set(rel, { path: rel, title, props: L.readProps(text) });
  }
  const notes = Object.keys(files).map((p) => ({ path: p, title: metas.get(p).title, label: metas.get(p).title, content: readFileSync(abs(p), 'utf8'), props: metas.get(p).props, mtime: 0 }));
  const resolve = (t) => {
    const base = String(t ?? '').replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
    const hit = notes.find((n) => n.title === base || n.path === base || n.path.endsWith(`/${base}.md`));
    return hit ? hit.path : null;
  };
  const model = L.buildRecordModel({ notes, resolve, today: TODAY });
  const propsOf = (p) => metas.get(p)?.props;
  return { model, propsOf };
}

test('a new project starts in a usable area, never a quiet or hidden one', () => {
  const dlg = read('src/renderer/src/components/NewProjectDialog.tsx');
  assert.ok(dlg.includes('!a.hidden && !a.quiet'), 'the Area select offers usable areas only');
  // From a template in Library (quiet) the start must be home, not Library: the select offers
  // neither quiet nor hidden, so a quiet start shows blank yet makes the project there.
  const at = dlg.indexOf('useState<string>(() =>');
  const init = dlg.slice(at, at + 500);
  assert.ok(init.includes('quiet') && init.includes('hidden'), `the start skips quiet and hidden (got ${JSON.stringify(init.slice(0, 140))})`);
});

test('a work card keeps no finished health promise, and its Timeline neither', () => {
  const { model, propsOf } = rig();
  const raw = L.personCard(model, 'person:sam lee');
  assert.ok(raw.doneItems.some((d) => d.title === 'Log the morning walk'), 'the raw card carries the health finished promise');
  const kept = L.purposefulCard(raw, { model, propsOf, areas: AREAS });
  const titles = kept.doneItems.map((d) => d.title);
  assert.ok(!titles.some((t) => /morning walk|coastal walk/i.test(t)), `no finished health promise on the served card (got ${JSON.stringify(titles)})`);
  assert.ok(titles.includes('Send the beacon plan'), 'the finished work promise stays');
  const timeline = L.personTimeline(kept).map((e) => e.title);
  assert.ok(!timeline.some((t) => /morning walk|coastal walk/i.test(t)), `no finished health promise in the Timeline (got ${JSON.stringify(timeline)})`);
});
