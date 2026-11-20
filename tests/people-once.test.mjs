// node --test tests/people-once.test.mjs — one person, one page (9 Nov 2026). A made-up made-up vault of realistic size:
// about 20 people, with 4 real duplicates of different kinds (the same email; the same full name in different case
// or punctuation; a first name used only where one known person fits; names on the known as list) and 2 traps (two
// different people called Sam). The duplicates are found, the traps never suggested, a merge moves everything and
// links resolve, and one Undo restores the vault byte for byte. A live People flow with real input. Made-up people.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-people-once-'));
let L;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(
    entry,
    [
      `export { registerLife } from ${JSON.stringify(path.join(root, 'src/main/life.ts'))};`,
      `export { buildRecordModel, connectedTo, personOpenItems, isOpen, projectAttention, personAliases } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};`,
      `export { personCard, personCards, samePeople, samePairKey, mergePreviewWords } from ${JSON.stringify(path.join(root, 'src/shared/people.ts'))};`,
      `export { computeRelations } from ${JSON.stringify(path.join(root, 'src/shared/relations.ts'))};`,
      `export { readProps } from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};`,
      `export { extractLinks } from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};`,
    ].join('\n'),
  );
  const stub = path.join(work, 'electron-stub.mjs');
  writeFileSync(stub, 'export const shell = {};\nexport default {};\n');
  await build({ input: entry, platform: 'node', external: ['yaml', /^node:/], plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }], output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  try {
    mkdirSync(path.join(work, 'node_modules'), { recursive: true });
    writeFileSync(path.join(work, 'package.json'), JSON.stringify({ type: 'module' }));
  } catch {}
  try {
    const link = path.join(work, 'node_modules', 'yaml');
    if (!existsSync(link)) {
      const { symlinkSync } = await import('node:fs');
      symlinkSync(path.join(root, 'node_modules', 'yaml'), link, 'junction');
    }
  } catch {}
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const TODAY = '2026-11-09';
const FILES = {
  'Work/People/Taylor Reed.md': '---\ntype: person\nrole: Owner\norg: Harbourline\nemail: taylor.reed@example.com\nphone: 0400 000 001\n---\n# Taylor Reed\n\nLeads Harbour.\n',
  'Work/People/Taylor Reed-Smith.md': '---\ntype: person\nrole: Designer\nemail: taylor.reed@example.com\n---\n# Taylor Reed-Smith\n\nDoes joinery.\n\nSee [[Quote]] for work.\n',
  'Work/People/Darcy Lin.md': '---\ntype: person\n---\n# Darcy Lin\n',
  'Work/People/Darcy-Lam.md': '---\ntype: person\n---\n# Darcy-Lam\n',
  'Work/People/Priya Nair.md': '---\ntype: person\nrole: Design\n---\n# Priya Nair\n',
  'Work/People/Priya.md': '---\ntype: person\n---\n# Priya\n',
  'Work/People/Bettina Maddox.md': '---\ntype: person\nknown as: Barb\n---\n# Bettina Maddox\n',
  'Work/People/Barb.md': '---\ntype: person\n---\n# Barb\n',
  'Work/People/Sam Carter.md': '---\ntype: person\n---\n# Sam Carter\n',
  'Work/People/Sam Rivera.md': '---\ntype: person\n---\n# Sam Rivera\n',
  'Work/People/Alex Morgan.md': '---\ntype: person\n---\n# Alex Morgan\n',
  'Work/People/Jordan Wu.md': '---\ntype: person\n---\n# Jordan Wu\n',
  'Work/People/Ana Ruiz.md': '---\ntype: person\n---\n# Ana Ruiz\n',
  'Work/People/Mia Chen.md': '---\ntype: person\n---\n# Mia Chen\n',
  'Work/People/Noah Kim.md': '---\ntype: person\n---\n# Noah Kim\n',
  'Work/People/Ella Brown.md': '---\ntype: person\n---\n# Ella Brown\n',
  'Work/People/Jack Doyle.md': '---\ntype: person\n---\n# Jack Doyle\n',
  'Work/People/Lucy Wang.md': '---\ntype: person\n---\n# Lucy Wang\n',
  'Work/People/Tom Nguyen.md': '---\ntype: person\n---\n# Tom Nguyen\n',
  'Work/People/Ava Reed.md': '---\ntype: person\n---\n# Ava Reed\n',
  'Work/Harbour.md': '---\ntype: project\nstatus: active\nowner: Alex Morgan\n---\n# Harbour\n\n## People\n\n- **Priya Nair** — Design\n- **Sam Carter** — Build\n- **Sam Rivera** — Build\n- **Taylor Reed-Smith** — Joinery\n\nSee [[Priya]] for colours.\n\n## What\'s next\n\n- [ ] Send quote — Taylor Reed-Smith\n',
  'Work/Beacon.md': '---\ntype: project\nstatus: active\nowner: Jordan Wu\n---\n# Beacon\n\n## People\n\n- **Taylor Reed** — Owner\n\n## What\'s next\n\n- [ ] Approve plan — Taylor Reed\n',
  'Work/Meetings/Kickoff.md': '---\ntype: meeting\ndate: 2026-10-20\nattendees: [Taylor Reed-Smith]\nproject: "[[Harbour]]"\n---\n# Kickoff\n\nWho came: Taylor Reed-Smith\n\n## Actions\n\n- [ ] Follow up — Taylor Reed-Smith\n',
  'Work/Meetings/Review.md': '---\ntype: meeting\ndate: 2026-11-15\nattendees: [Taylor Reed]\nproject: "[[Beacon]]"\n---\n# Review\n\nWho came: Taylor Reed\n',
  'Work/Notes/Quote.md': '# Quote\n\nDraft for [[Taylor Reed-Smith]] to review.\n',
  'Work/Notes/Plan.md': '# Plan\n\nPlan for [[Taylor Reed]] to approve.\n',
};

/** The handlers live on a real vault on disk, with the real connected model rebuilt from what is there. */
function rig() {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const abs = (rel) => path.join(dir, ...rel.split('/'));
  for (const [rel, text] of Object.entries(FILES)) {
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), String(text));
  }
  const metas = new Map();
  const refreshMeta = (rel) => {
    if (!rel.endsWith('.md') || rel.startsWith('.neuralvault/')) return;
    let text;
    try {
      text = readFileSync(abs(rel), 'utf8');
    } catch {
      metas.delete(rel);
      return;
    }
    const title = rel.split('/').pop().replace(/\.md$/i, '');
    const props = L.readProps(text);
    let links = [];
    try {
      links = L.extractLinks(text);
    } catch {
      links = [];
    }
    let aliases = [];
    try {
      aliases = L.personAliases(props);
    } catch {
      aliases = [];
    }
    metas.set(rel, { path: rel, title, label: title, props, tags: [], links, propLinks: [], aliases, mtime: 0 });
  };
  const allMd = () => {
    const out = [];
    const walk = (d, prefix) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (rel.startsWith('.neuralvault/')) continue;
        if (e.isDirectory()) walk(path.join(d, e.name), rel);
        else if (e.isFile() && e.name.endsWith('.md')) out.push(rel);
      }
    };
    walk(dir, '');
    return out.sort();
  };
  for (const rel of allMd()) refreshMeta(rel);
  const resolve = (t) => {
    const base = String(t ?? '').replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
    if (!base) return null;
    for (const m of metas.values()) if (m.title === base) return m.path;
    for (const m of metas.values()) if ((m.aliases ?? []).includes(base)) return m.path;
    const hit = [...metas.values()].find((m) => m.path === base || m.path.endsWith(`/${base}.md`));
    return hit ? hit.path : null;
  };
  const buildModel = () => {
    const notes = allMd().map((p) => ({ path: p, title: metas.get(p)?.title ?? p.split('/').pop().replace(/\.md$/i, ''), label: metas.get(p)?.title ?? p, content: readFileSync(abs(p), 'utf8'), props: metas.get(p)?.props ?? {}, mtime: 0 }));
    return L.buildRecordModel({ notes, resolve: (t, f) => resolve(t), today: TODAY });
  };
  const vault = {
    root: dir,
    exists: async (rel) => existsSync(abs(rel)),
    read: async (rel) => readFileSync(abs(rel), 'utf8'),
    write: async (rel, text) => {
      mkdirSync(path.dirname(abs(rel)), { recursive: true });
      writeFileSync(abs(rel), String(text));
    },
    create: async (rel, text) => {
      mkdirSync(path.dirname(abs(rel)), { recursive: true });
      writeFileSync(abs(rel), String(text));
    },
    any: async (rel) => existsSync(abs(rel)),
    listAll: async () => ({ files: allMd().map((rel) => ({ rel, mtime: 0, size: 0, kind: 'note' })), folders: [] }),
  };
  const handlers = new Map();
  L.registerLife({
    handle: (ch, fn) => handlers.set(ch, fn),
    vault: () => vault,
    index: {
      allMeta: () => [...metas.values()],
      content: (rel) => {
        try {
          return readFileSync(abs(rel), 'utf8');
        } catch {
          return null;
        }
      },
      get: (rel) => metas.get(rel),
      resolveAny: (t) => resolve(t),
      delete: (rel) => void metas.delete(rel),
    },
    prefs: () => ({ templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments' }),
    dailyFolder: () => 'Daily',
    records: () => buildModel(),
    movePath: async () => {
      throw new Error('not under test');
    },
    indexFile: async (v, rel) => {
      refreshMeta(rel);
      return null;
    },
    refreshFiles: async () => {},
    changed: () => {},
    filesChanged: () => {},
    requireCreate: async () => {},
    editProject: async () => ({}),
  });
  const snapshot = () => new Map(allMd().map((p) => [p, readFileSync(abs(p), 'utf8')]));
  return { dir, abs, handlers, buildModel, snapshot, allMd };
}

const pairHas = (p, a, b) => [p.keepName, p.otherName].includes(a) && [p.keepName, p.otherName].includes(b);

test('duplicates are found, each with its reason and what a merge moves', async () => {
  const { handlers, buildModel } = rig();
  const model = buildModel();
  const people = [...model.records.values()].filter((r) => r.type === 'person');
  assert.ok(people.length >= 19 && people.length <= 22, `about 20 people (got ${people.length})`);
  const same = await handlers.get('people:same')();
  assert.equal(same.length, 4, `4 real duplicates (got ${JSON.stringify(same.map((s) => [s.keepName, s.otherName, s.why]))})`);
  const email = same.find((s) => pairHas(s, 'Taylor Reed', 'Taylor Reed-Smith'));
  assert.ok(email, 'the same email is found');
  assert.match(email.why, /Both give taylor\.reed@example\.com/, `same email reason (got ${JSON.stringify(email.why)})`);
  const spelling = same.find((s) => pairHas(s, 'Darcy Lin', 'Darcy-Lam'));
  assert.ok(spelling, 'the same name in different punctuation is found');
  assert.equal(spelling.why, 'Same name, different spelling');
  const first = same.find((s) => pairHas(s, 'Priya', 'Priya Nair'));
  assert.ok(first, 'a first name where only one person fits is found');
  assert.match(first.why, /First name where only Priya Nair fits/, `first-name reason (got ${JSON.stringify(first.why)})`);
  const known = same.find((s) => pairHas(s, 'Bettina Maddox', 'Barb'));
  assert.ok(known, 'a name on the known as list is found');
  assert.equal(known.why, 'On the known as list');
  for (const s of same) {
    assert.ok(s.preview, `${s.keepName} + ${s.otherName} carries a preview`);
    for (const k of ['notes', 'meetings', 'mentions', 'links', 'tasksOwned']) assert.equal(typeof s.preview[k], 'number', `${k} is counted`);
  }
  assert.ok(email.preview.notes >= 1 && email.preview.meetings >= 1 && email.preview.mentions > 0 && email.preview.links >= 1 && email.preview.tasksOwned >= 1, `the email pair preview counts what moves (got ${JSON.stringify(email.preview)})`);
  assert.match(L.mergePreviewWords(email.preview), /Moves .*note.*meeting.*mention.*link.*tasks? owned/, 'preview words name notes, meetings, mentions, links, tasks owned');
});

test('two different people called Sam are never suggested', async () => {
  const { handlers } = rig();
  const same = await handlers.get('people:same')();
  assert.ok(!same.some((s) => pairHas(s, 'Sam Carter', 'Sam Rivera')), `Sam Carter and Sam Rivera are never paired (got ${JSON.stringify(same.map((s) => [s.keepName, s.otherName]))})`);
  assert.ok(!same.some((s) => [s.keepName, s.otherName].includes('Sam Carter') && [s.keepName, s.otherName].includes('Sam Rivera')), 'no second reason, no suggestion');
});

test('a merge moves everything, and links resolve', async () => {
  const { abs, handlers, buildModel } = rig();
  const same = await handlers.get('people:same')();
  const pair = same.find((s) => pairHas(s, 'Taylor Reed', 'Taylor Reed-Smith'));
  assert.ok(pair, 'the Taylor pair to merge');
  const preview = await handlers.get('people:merge-preview')(pair.keep, pair.other);
  assert.deepEqual(preview, pair.preview, 'the preview channel says what the pair carries');
  const beforeFiles = new Map();
  const read = (rel) => readFileSync(abs(rel), 'utf8');
  for (const rel of ['Work/Harbour.md', 'Work/Beacon.md', 'Work/Meetings/Kickoff.md', 'Work/Notes/Quote.md']) beforeFiles.set(rel, read(rel));
  assert.ok(beforeFiles.get('Work/Harbour.md').includes('Taylor Reed-Smith'), 'Harbour names the other before');
  assert.ok(beforeFiles.get('Work/Notes/Quote.md').includes('[[Taylor Reed-Smith]]'), 'Quote links the other before');
  const r = await handlers.get('people:merge')(pair.keep, pair.other);
  assert.match(r.words, /merged into/, `the merge is said (${JSON.stringify(r.words)})`);
  const keepPath = pair.keepName === 'Taylor Reed' ? 'Work/People/Taylor Reed.md' : 'Work/People/Taylor Reed-Smith.md';
  const otherPath = keepPath.endsWith('Taylor Reed.md') ? 'Work/People/Taylor Reed-Smith.md' : 'Work/People/Taylor Reed.md';
  const keepTitle = keepPath.endsWith('Taylor Reed.md') ? 'Taylor Reed' : 'Taylor Reed-Smith';
  const otherTitle = keepTitle === 'Taylor Reed' ? 'Taylor Reed-Smith' : 'Taylor Reed';
  assert.equal(r.path, keepPath, 'the kept card');
  assert.ok(!existsSync(abs(otherPath)), 'the other card moved aside, never deleted');
  assert.ok(readdirSync(abs('.neuralvault/merged')).some((f) => f.includes(otherPath.split('/').pop().replace('.md', ''))), 'the other file kept in the holding folder');
  const keepText = read(keepPath);
  assert.ok(keepText.includes(otherTitle), 'the kept card keeps the other name (aliases and the From heading)');
  assert.ok(keepText.includes(`## From ${otherTitle} (merged `), 'the other words move under their heading');
  // Every link and mention follows: owners, people, attendees, tasks, body links.
  const harbour = read('Work/Harbour.md');
  assert.ok(!harbour.includes(otherTitle), `Harbour no longer names ${otherTitle}`);
  assert.ok(harbour.includes(keepTitle), 'Harbour names the kept one (people and the owned step)');
  const kickoff = read('Work/Meetings/Kickoff.md');
  assert.ok(!kickoff.includes(otherTitle), 'the meeting no longer names the other (attendees and actions)');
  assert.ok(kickoff.includes(keepTitle), 'the meeting names the kept one');
  const quote = read('Work/Notes/Quote.md');
  assert.ok(quote.includes(`[[${keepTitle}|${otherTitle}]]`), `the body link keeps its alias and reaches the kept one (got ${JSON.stringify(quote)})`);
  // The person's page reads one person.
  const model = buildModel();
  const keepId = pair.keep;
  const otherId = pair.other;
  const card = L.personCard(model, keepId);
  assert.ok(card, 'the kept card reads');
  const titles = (refs) => refs.map((x) => x.title);
  assert.ok(titles(card.notes).includes('Quote') && titles(card.notes).includes('Plan'), `notes moved (got ${JSON.stringify(titles(card.notes))})`);
  assert.ok(titles(card.meetings).includes('Kickoff') && titles(card.meetings).includes('Review'), `meetings moved (got ${JSON.stringify(titles(card.meetings))})`);
  const owned = [...card.owesYouItems.map((x) => x.title)];
  assert.ok(owned.some((t) => t.includes('Send quote')) && owned.some((t) => t.includes('Follow up')) && owned.some((t) => t.includes('Approve plan')), `tasks owned moved (got ${JSON.stringify(owned)})`);
  assert.equal(await handlers.get('people:card')(otherId), null, 'the other card is gone from the page door');
  // The graph reads one person: both projects share the kept name now.
  const relNotes = ['Work/Harbour.md', 'Work/Beacon.md'].map((p) => ({ path: p, label: p.split('/').pop().replace(/\.md$/i, ''), content: read(p), props: L.readProps(read(p)), tags: [], links: [] }));
  const rel = L.computeRelations(relNotes);
  assert.ok(rel.relations.some((x) => x.reasons.some((w) => w.includes(keepTitle))), `the projects share ${keepTitle} (got ${JSON.stringify(rel.relations.map((x) => x.reasons))})`);
  // The bot's attention reads one person.
  const attention = L.projectAttention(model, 'Work/Harbour.md');
  assert.ok(attention, 'Harbour attention reads');
  assert.ok(attention.people.some((p) => p.title === keepTitle), `attention names ${keepTitle}`);
  assert.ok(!attention.people.some((p) => p.title === otherTitle), `attention no longer names ${otherTitle}`);
});

test('one Undo restores the vault byte for byte', async () => {
  const { handlers, snapshot } = rig();
  const before = snapshot();
  const same = await handlers.get('people:same')();
  const pair = same.find((s) => pairHas(s, 'Taylor Reed', 'Taylor Reed-Smith'));
  assert.ok(pair, 'the Taylor pair to merge and undo');
  await handlers.get('people:merge')(pair.keep, pair.other);
  const undone = await handlers.get('people:merge-undo')();
  assert.match(undone.words, /its own card again/, `undo is said (${JSON.stringify(undone.words)})`);
  const after = snapshot();
  assert.deepEqual([...after.keys()], [...before.keys()], 'the same files are there');
  for (const [p, text] of before) assert.equal(after.get(p), text, `${p} byte for byte`);
  const again = await handlers.get('people:same')();
  assert.ok(again.some((s) => pairHas(s, 'Taylor Reed', 'Taylor Reed-Smith')), 'the pair is offered again after Undo');
  await assert.rejects(() => handlers.get('people:merge-undo')(), /no merge to undo/i, 'one Undo only');
});

test('People page shows These look like the same person with reasons, preview and one-tap merge', () => {
  const src = readFileSync(path.join(root, 'src/renderer/src/views/PeoplePage.tsx'), 'utf8');
  assert.ok(src.includes('These look like the same person'), 'the heading');
  assert.ok(src.includes('mergePreviewWords(p.preview)'), 'each pair carries what a merge moves');
  assert.ok(src.includes('Merge into ${p.keepName}'), 'one tap merges into the kept card');
  assert.ok(src.includes('Not the same'), 'a pair can be said not the same');
  assert.ok(src.includes('lifeChanged()'), 'saying not the same reads again');
  assert.ok(!src.includes('—') || src.includes('String.fromCharCode'), 'no em dash in new UI words');
});

test('Review dialog previews what moves and says every link and mention follows', () => {
  const src = readFileSync(path.join(root, 'src/renderer/src/components/LifeHost.tsx'), 'utf8');
  assert.ok(src.includes('mergePreviewWords(p.preview)'), 'each pair previews notes, meetings, mentions, links, tasks owned');
  assert.ok(src.includes('every link and mention follows'), 'merging follows links and mentions');
  assert.ok(src.includes('known as list') && src.includes('first name where only one person fits'), 'all four finds are named');
});
