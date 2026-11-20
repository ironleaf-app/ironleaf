// node --test tests/projects-home.test.mjs — the Projects home's cards (29 Oct 2026, redesign Job B): each project
// carries "Next for you" and how many of the person's own steps are late, worked out the hub's way
// (src/shared/project-hub.ts) with the vault's person read the Today's way (src/shared/today.ts whoIsMe), so the
// Projects home, Today and the project page count the same. Other people's late steps never count as late for you.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-projects-home-'));
let Projects;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export { Projects } from ${JSON.stringify(path.join(root, 'src/main/projects.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'projects.mjs'), format: 'esm' }, logLevel: 'silent' });
  ({ Projects } = await import(pathToFileURL(path.join(work, 'projects.mjs')).href));
});
after(() => rmSync(work, { recursive: true, force: true }));

const iso = (daysFromNow) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const project = (name, steps) => `---
type: project
status: active
health: at risk
owner: Ana Lopez
---

# ${name}

## What's next

${steps}
`;
const indexOf = (texts) => ({
  allMeta: () => texts.map(([p]) => ({ path: p, props: { type: 'project' }, mtime: 1 })),
  content: (p) => texts.find(([x]) => x === p)?.[1],
});

test('a card says Next for you and counts only the person’s own late steps', () => {
  const cards = new Projects(
    indexOf([
      ['Projects/One/One.md', project('One', `- [ ] Send the signed form — Ana Lopez · by ${iso(-3)}\n- [ ] Book the hall — Ben Hale · by ${iso(-2)}\n- [ ] Print the agenda — Ana Lopez · by ${iso(4)}`)],
      ['Projects/Two/Two.md', project('Two', `- [ ] Book the hall — Ben Hale · by ${iso(-1)}`)],
    ]),
  ).list();
  const one = cards.find((c) => c.name === 'One');
  assert.equal(one.lateMine, 1, 'only Ana’s late step counts, not Ben’s');
  assert.match(one.nextMine, /Send the signed form/, 'Next for you is the most urgent of her own steps');
  assert.equal(one.nextMineWhen, iso(-3));
  const two = cards.find((c) => c.name === 'Two');
  assert.equal(two.lateMine, 0, 'a project with only someone else’s late step has none late for you');
  assert.equal(two.nextMine, undefined, 'and nothing of hers is next there');
});
