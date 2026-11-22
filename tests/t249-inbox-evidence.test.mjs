// node --test tests/t249-inbox-evidence.test.mjs — a guess needs real evidence (t249, 12 Nov 2026,
// the critics: a bank email guessed to Tom Bradley, a person with no link to it; a bank task guessed to
// a past meeting; filler notes ("Me note 715") offered as alternatives). The meaning index backfill now
// refuses: a person with no link, a past meeting or a filler note unless linked, and any meeting sharing
// no word with the capture. Similarity alone never homes a new arrival. Fails without each change.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t249-inbox-'));
let L;
let IB;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const lEntry = path.join(work, 'lentry.ts');
  writeFileSync(lEntry, `export { registerLife } from ${JSON.stringify(path.join(root, 'src/main/life.ts'))};\n`);
  const stub = path.join(work, 'electron-stub.mjs');
  writeFileSync(stub, 'export const shell = {};\nexport default {};\n');
  await build({ input: lEntry, platform: 'node', external: ['yaml', /^node:/], plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }], output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    const { symlinkSync } = await import('node:fs');
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
  const iEntry = path.join(work, 'ientry.ts');
  writeFileSync(iEntry, `export * from ${JSON.stringify(path.join(root, 'src/shared/inbox.ts'))};\n`);
  await build({ input: iEntry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 'i.mjs'), format: 'esm' }, logLevel: 'silent' });
  IB = await import(pathToFileURL(path.join(work, 'i.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('filler titles read as filler; shared words need distinctive words', () => {
  for (const t of ['Me note 715', 'Home note 2542', 'Business note 720 with the long follow-up from Tuesday']) {
    assert.equal(IB.isFillerNoteTitle(t), true, `${t} is filler`);
  }
  for (const t of ['Stone care', 'Site walk', '2026-11-14 Awning deposit and December bookings review with June', 'Release notes']) {
    assert.equal(IB.isFillerNoteTitle(t), false, `${t} is a real note`);
  }
  assert.deepEqual(IB.sharedTitleWords('Pay the power bill by 14 November, ask Sam at the site walk', '2026-11-06 Site walk').sort(), ['site', 'walk'], 'the dated line names its meeting');
  assert.deepEqual(IB.sharedTitleWords('Call the bank about the card reader that failed twice on Saturday morning', '2026-11-14 Awning deposit and December bookings review with June'), [], 'the bank task shares nothing with the awning meeting');
  assert.ok(IB.sharedTitleWords('Ask June about the awning deposit', '2026-11-14 Awning deposit and December bookings review with June').includes('awning'), 'awning and deposit count; June the month does not');
  assert.ok(!IB.sharedTitleWords('Ask June about the awning deposit', '2026-11-14 Awning deposit and December bookings review with June').includes('june'), 'month names never point anywhere');
  assert.deepEqual(IB.sharedTitleWords('see you Friday at the review', 'Friday planning review'), [], 'day names and everyday words never point anywhere');
  assert.deepEqual(IB.sharedTitleWords('walk the 2026 site again', '2026 site walk').sort(), ['site', 'walk'], 'bare numbers never point anywhere');
});

// ── The backfill refuses junk, keeps evidence ────────────────────────────────────
// A vault on disk with the critics’ junk (a stranger’s card, a past and a future meeting, a filler
// note) and a meaning index stubbed to surface exactly that junk: the stub decides what similarity
// claims, the backfill decides what evidence allows. Made-up captures only.
const TOM = 'Work/People/Tom Bradley.md';
const PAST = 'Work/Meetings/2026-11-10 Tuesday standup.md';
const PAST_AWNING = 'Work/Meetings/2026-11-09 Awning site visit.md';
// A week from whenever this runs: a coming meeting stays coming (a fixed 14 Nov 2026 turned past, and a past meeting
// rightly needs a link before it is offered).
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const SOON = iso(new Date(Date.now() + 7 * 864e5));
const FUTURE = `Work/Meetings/${SOON} Awning deposit review with June.md`;
const FILLER = 'Me/Me note 715.md';
const HARBOUR = 'Work/Projects/Harbour/Harbour.md';
const BANK = 'Call the bank about the card reader that failed twice on Saturday morning';
const AWNING_ASK = 'Ask June about the awning deposit before Friday';

function rig(files, hits) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const abs = (rel) => path.join(dir, ...rel.split('/'));
  const put = (rel, text) => {
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), String(text));
  };
  for (const [rel, text] of Object.entries(files)) put(rel, text);
  const readDisk = (rel) => {
    try {
      return readFileSync(abs(rel), 'utf8');
    } catch {
      return null;
    }
  };
  const titleOf = (rel, text) => /^#\s+(.+?)\s*$/m.exec(text)?.[1] ?? rel.split('/').pop().replace(/\.md$/i, '');
  const metas = new Map();
  const rebuild = () => {
    metas.clear();
    const walk = (d, base) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (e.name.startsWith('.')) continue;
          walk(path.join(d, e.name), rel);
        } else if (e.isFile() && rel.endsWith('.md')) {
          const text = readFileSync(path.join(d, e.name), 'utf8');
          const title = titleOf(rel, text);
          metas.set(rel, { path: rel, title, label: title, props: {}, tags: [], links: [], mtime: 0 });
        }
      }
    };
    walk(dir, '');
  };
  rebuild();
  const vault = {
    root: dir,
    exists: async (rel) => readDisk(rel) !== null,
    read: async (rel) => {
      const t = readDisk(rel);
      if (t === null) throw new Error(`missing ${rel}`);
      return t;
    },
    any: async (rel) => readDisk(rel) !== null,
    listAll: async () => {
      const out = [];
      const folders = new Set();
      const scan = (d, base) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const rel = base ? `${base}/${e.name}` : e.name;
          if (e.isDirectory()) {
            folders.add(rel);
            scan(path.join(d, e.name), rel);
          } else if (e.isFile()) out.push({ rel, mtime: 0, size: 0, kind: rel.endsWith('.md') ? 'note' : 'file' });
        }
      };
      scan(dir, '');
      return { files: out, folders: [...folders] };
    },
  };
  const handlers = new Map();
  L.registerLife({
    handle: (ch, fn) => handlers.set(ch, fn),
    vault: () => vault,
    index: {
      allMeta: () => [...metas.values()],
      content: (rel) => readDisk(rel),
      get: (rel) => metas.get(rel),
      resolveAny: (t) => {
        const clean = String(t ?? '').replace(/\.md$/i, '');
        for (const m of metas.values()) if (m.title === clean || m.label === clean || m.path === t) return m.path;
        return null;
      },
      meanings: () => ({ search: () => hits.map((p) => ({ path: p, score: 0.9 })) }),
    },
    prefs: () => ({ templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments' }),
    dailyFolder: () => 'Daily',
    records: () => ({ records: new Map([['tom', { type: 'person', title: 'Tom Bradley', path: TOM, page: true, names: [] }]]) }),
    requireCreate: async () => {},
  });
  return { handlers };
}

const vaultFiles = () => ({
  'Inbox.md': `# Inbox\n\n- [ ] ${BANK}\n- ${AWNING_ASK}\n`,
  [HARBOUR]: '---\ntype: project\nstatus: active\nowner: Alex Kim\n---\n# Harbour fit-out\n\n## Summary\n\nThe Harbour cafe fit-out.\n',
  [TOM]: '---\ntype: person\n---\n# Tom Bradley\n\nElectrician.\n',
  [PAST]: '---\ntype: meeting\ndate: 2026-11-10\n---\n# 2026-11-10 Tuesday standup\n\nStood up, sat down.\n',
  [PAST_AWNING]: '---\ntype: meeting\ndate: 2026-11-09\n---\n# 2026-11-09 Awning site visit\n\nLooked at the awning brackets.\n',
  [FUTURE]: `---\ntype: meeting\ndate: ${SOON}\n---\n# ${SOON} Awning deposit review with June\n\nThe awning deposit and the December books.\n`,
  [FILLER]: '# Me note 715\n\nThe shop was quiet on Tuesday morning.\n',
  '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] }),
});

test('the backfill refuses the junk the critics saw, and keeps what has evidence', async () => {
  const r = rig(vaultFiles(), [TOM, PAST, PAST_AWNING, FILLER, FUTURE]);
  const { items, suggestions } = await r.handlers.get('inbox:list')();
  const paths = (id) => (suggestions[id] ?? []).map((s) => s.target.path);
  const bank = items.find((i) => i.words.includes('Call the bank'));
  assert.ok(bank, 'the bank task waits in the Inbox');
  assert.ok(!paths(bank.id).includes(TOM), 'no stranger’s card on similarity alone');
  assert.ok(!paths(bank.id).includes(PAST), 'no past meeting on similarity alone');
  assert.ok(!paths(bank.id).includes(FILLER), 'no filler note on similarity alone');
  assert.ok(!paths(bank.id).includes(FUTURE), 'no meeting sharing no word with the capture');
  const ask = items.find((i) => i.words.includes('awning deposit'));
  assert.ok(ask, 'the awning ask waits in the Inbox');
  assert.ok(paths(ask.id).includes(FUTURE), 'a coming meeting sharing its words still offers itself');
  assert.ok(!paths(ask.id).includes(PAST_AWNING), 'a past meeting needs a link even sharing a word');
});
