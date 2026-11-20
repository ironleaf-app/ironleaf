// node --test tests/intake.test.mjs — The front door for email and PDF (t243, 12 Nov 2026).
// A saved email (.eml, .msg), pasted email text, one mailed in from Gmail or Outlook, or a PDF lands in the
// Inbox with its real subject or title (src/main/life.ts intake:*). An email keeps its fields, its sender
// matched to a person by address or made a stranger card (organisation from the domain), its attachments
// beside it. Answering the one question files it under the project — linked both ways with typed links — and
// makes the next step a Task; a repeat PDF links what it replaces, so it becomes the next version, never a
// second document. Nothing is written outside the project it is filed under. Live vault on disk, made-up mail
// only; the one .msg is Apache POI's public test email (tests/fixtures/SOURCE.txt, Apache-2.0, never shipped).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-intake-'));
let L;
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const lEntry = path.join(work, 'lentry.ts');
  writeFileSync(lEntry, `export { registerLife } from ${JSON.stringify(path.join(root, 'src/main/life.ts'))};\n`);
  const stub = path.join(work, 'electron-stub.mjs');
  writeFileSync(stub, 'export const shell = {};\nexport default {};\n');
  await build({ input: lEntry, platform: 'node', external: ['yaml', /^node:/], plugins: [{ name: 'electron-stub', resolveId: (id) => (id === 'electron' ? stub : null) }], output: { file: path.join(work, 'l.mjs'), format: 'esm' }, logLevel: 'silent' });
  mkdirSync(path.join(work, 'node_modules'), { recursive: true });
  try {
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'), 'junction');
  } catch {}
  const sEntry = path.join(work, 'sentry.ts');
  writeFileSync(sEntry, [`export * as proj from ${JSON.stringify(path.join(root, 'src/shared/project-file.ts'))};`, `export * as fm from ${JSON.stringify(path.join(root, 'src/shared/frontmatter.ts'))};`].join('\n'));
  await build({ input: sEntry, platform: 'node', external: ['yaml'], output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  L = await import(pathToFileURL(path.join(work, 'l.mjs')).href);
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const HARBOUR = 'Work/Projects/Harbour/Harbour.md';
const REFIT = 'Work/Projects/Refit/Refit.md';
const PRIYA = 'Work/People/Priya Shah.md';
const JUNE = 'Work/People/June Park.md';
const vaultFiles = () => ({
  'Inbox.md': '# Inbox\n\n## Captured\n\n- Buy milk\n',
  [HARBOUR]: '---\ntype: project\nstatus: active\nowner: Alex Kim\n---\n# Harbour fit-out\n\n## Summary\n\nThe Harbour cafe fit-out.\n\n## What\'s next\n\n- [ ] Chase the benchtop delivery\n',
  [REFIT]: '---\ntype: project\nstatus: active\nowner: Priya Shah\n---\n# The December refit of the back room\n\n## Summary\n\nWiring, awning, roster.\n',
  [PRIYA]: '---\ntype: person\nemail: priya.shah@example.invalid\n---\n# Priya Shah\n\n## Notes\n\nLease contact.\n',
  [JUNE]: '---\ntype: person\nemail: june.park@example.invalid\n---\n# June Park\n\n## Notes\n\nBookkeeper.\n',
  '.neuralvault/areas.json': JSON.stringify({ version: 1, areas: [{ id: 'work', name: 'Work', folder: 'Work' }] }),
});
const QUOTE_BYTES = Buffer.from('%PDF-1.4 made-up quote bytes for the Harbour fit-out', 'latin1');
const EML = (from, subject, words) => ['From: ' + from, 'To: Alex Kim <alex.kim@example.invalid>', 'Date: Tue, 10 Nov 2026 09:14:00 +1100', 'Subject: ' + subject, 'Content-Type: multipart/mixed; boundary="abc"', '', '--abc', 'Content-Type: text/plain; charset=utf-8', '', words, '', '--abc', 'Content-Type: application/pdf; name="Harbour-quote.pdf"', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="Harbour-quote.pdf"', '', QUOTE_BYTES.toString('base64'), '--abc--', ''].join('\r\n');

function rig(files, opts = {}) {
  const dir = mkdtempSync(path.join(work, 'vault-'));
  const abs = (rel) => path.join(dir, ...rel.split('/'));
  const put = (rel, content) => {
    mkdirSync(path.dirname(abs(rel)), { recursive: true });
    writeFileSync(abs(rel), content);
  };
  for (const [rel, text] of Object.entries(files)) put(rel, String(text));
  const readDisk = (rel) => {
    try {
      return readFileSync(abs(rel), 'utf8');
    } catch {
      return null;
    }
  };
  const readBytes = (rel) => {
    try {
      return readFileSync(abs(rel));
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
          if (e.name.startsWith('.') || rel.toLowerCase().startsWith('private notes/')) continue;
          walk(path.join(d, e.name), rel);
        } else if (e.isFile() && rel.endsWith('.md')) {
          const text = readFileSync(path.join(d, e.name), 'utf8');
          const title = titleOf(rel, text);
          metas.set(rel, { path: rel, title, label: title, props: S.fm.readProps(text), tags: [], links: [], mtime: 0 });
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
    write: async (rel, text) => {
      put(rel, String(text));
      rebuild();
    },
    create: async (rel, text = '') => {
      if (readDisk(rel) !== null) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      put(rel, text);
      rebuild();
    },
    writeBinary: async (rel, data) => {
      put(rel, Buffer.from(data));
      rebuild();
    },
    any: async (rel) => readDisk(rel) !== null || readBytes(rel) !== null,
    listAll: async () => {
      const out = [];
      const folders = new Set();
      const scan = (d, base) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const rel = base ? `${base}/${e.name}` : e.name;
          if (e.isDirectory()) {
            if (e.name === '.git') continue;
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
      delete: (rel) => void metas.delete(rel),
    },
    prefs: () => ({ templatesFolder: 'Templates', assetsFolder: 'Assets', attachmentsFolder: 'Attachments' }),
    dailyFolder: () => 'Daily',
    records: () => ({ records: new Map([...metas.values()].filter((m) => m.props?.type === 'person').map((m, i) => [`p${i}`, { type: 'person', title: m.title, path: m.path, page: true, names: [], facts: Object.entries(m.props).map(([key, value]) => ({ key, label: key, value: String(value) })) }])) }),
    movePath: async (from, to) => {
      const raw = readBytes(from);
      if (raw === null) throw new Error(`missing ${from}`);
      put(to, raw);
      rmSync(abs(from));
      rebuild();
      return { path: to, linksUpdated: 0, notesUpdated: 0 };
    },
    indexFile: async () => {
      rebuild();
      return null;
    },
    refreshFiles: async () => {},
    changed: () => {},
    filesChanged: () => {},
    requireCreate: async () => {},
    editProject: async (rel, edit) => {
      const before = readDisk(rel);
      if (before === null) throw new Error(`missing ${rel}`);
      const p = S.proj.parseProject(before, rel);
      S.proj.applyProjectEdit(p, edit, '');
      put(rel, S.proj.serializeProject(p, before));
      rebuild();
      return {};
    },
    ...(opts.mail ? { mail: opts.mail } : {}),
  });
  const snapshot = () => {
    const out = new Map();
    const scan = (d, base) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) scan(path.join(d, e.name), rel);
        else if (e.isFile()) out.set(rel, readBytes(rel).toString('base64'));
      }
    };
    scan(dir, '');
    return out;
  };
  return { handlers, read: readDisk, readBytes, snapshot, dir };
}
const byWords = (items, sub) => items.find((i) => i.words.includes(sub));
const emlBytes = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));

test('.eml in: fields kept, sender matched, attachment beside it, project suggested', async () => {
  const r = rig(vaultFiles());
  const landed = await r.handlers.get('intake:email')('quote.eml', emlBytes(EML('June Park <june.park@example.invalid>', 'Harbour fit-out quote lapses Friday', 'ShadeCo quoted twelve hundred fitted for the Harbour fit-out. Ring them before Friday.')));
  assert.equal(landed.title, 'Harbour fit-out quote lapses Friday');
  assert.deepEqual(landed.person, { name: 'June Park', path: JUNE }, 'matched by address, no new card');
  assert.equal(landed.madeCard, null);
  assert.equal(landed.suggestions[0]?.target.path, HARBOUR, 'the project suggested from its words');
  assert.equal(landed.suggestions[0]?.target.kind, 'project', 'projects first: the question asks which project');
  const note = r.read(landed.path);
  assert.match(note, /^type: email$/m);
  assert.match(note, /^subject: Harbour fit-out quote lapses Friday$/m);
  assert.match(note, /^email_from: "June Park <june\.park@example\.invalid>"$/m);
  assert.match(note, /^sender: "\[\[June Park\]\]"$/m, 'the sender as a typed link');
  assert.match(note, /^# Harbour fit-out quote lapses Friday$/m, 'the subject as its title');
  assert.match(note, /twelve hundred fitted/);
  assert.match(note, /^- !\[\[Harbour-quote\.pdf\]\] \(PDF, /m);
  assert.deepEqual(r.readBytes('Inbox/Attachments/Harbour fit-out quote lapses Friday/Harbour-quote.pdf'), QUOTE_BYTES, 'the attachment beside it, byte for byte');
  const { items } = await r.handlers.get('inbox:list')();
  const row = items.find((i) => i.id === landed.id);
  assert.ok(row.words.startsWith('Harbour fit-out quote lapses Friday'), `the Inbox shows its subject, never a file name (${row.words})`);
  assert.ok(!items.some((i) => i.path.startsWith('Inbox/Attachments/')), 'attachments are never items of their own');
});

test('the same email dropped twice lands once (t244 break-it)', async () => {
  const r = rig(vaultFiles());
  const withId = EML('June Park <june.park@example.invalid>', 'Harbour fit-out quote lapses Friday', 'ShadeCo quoted twelve hundred fitted.').replace('To: ', 'Message-ID: <quote-1@example.invalid>\r\nTo: ');
  const first = await r.handlers.get('intake:email')('quote.eml', emlBytes(withId));
  assert.match(r.read(first.path), /^email_id: "<quote-1@example.invalid>"$/m, 'the id kept on the note');
  const again = await r.handlers.get('intake:email')('quote.eml', emlBytes(withId));
  assert.equal(again.path, first.path, 'the second drop answers the kept note, never a second one');
  assert.equal(again.madeCard, null);
  const other = withId.replace('<quote-1@example.invalid>', '<quote-2@example.invalid>');
  const second = await r.handlers.get('intake:email')('quote.eml', emlBytes(other));
  assert.notEqual(second.path, first.path, 'a different email still lands');
  // Filed, the id stays on the note: dropping it again still answers the one kept.
  const filed = await r.handlers.get('intake:answer')(first.id, HARBOUR, 'Ring ShadeCo before Friday');
  assert.ok(filed.paths.some((p) => p.endsWith('.md') && p.includes('Harbour')), 'filed under the project');
  const after = await r.handlers.get('intake:email')('quote.eml', emlBytes(withId));
  assert.ok(after.path.includes('Harbour'), `the kept note answers, where it is now (${after.path})`);
});

test('.msg in: the same door, and a stranger gets a card with their organisation', async () => {
  const r = rig(vaultFiles());
  const raw = new Uint8Array(readFileSync(path.join(root, 'tests', 'fixtures', 'example_received_unicode.msg')));
  const landed = await r.handlers.get('intake:email')('Test.msg', raw);
  assert.equal(landed.title, 'This is a test message please ignore');
  assert.equal(landed.person.name, 'Mike Farman');
  assert.ok(landed.madeCard, 'a stranger gets a card');
  const card = r.read(landed.madeCard);
  assert.match(card, /^type: person$/m);
  assert.match(card, /^email: "mike\.farman@alfresco\.com"$/m);
  assert.match(card, /^org: Alfresco$/m, 'the organisation from the domain');
  assert.match(card, /^# Mike Farman$/m);
  const note = r.read(landed.path);
  assert.match(note, /^sender: "\[\[Mike Farman\]\]"$/m);
  assert.match(note, /The quick brown fox/);
  const gif = r.readBytes('Inbox/Attachments/This is a test message please ignore/alfresco.gif');
  assert.equal(gif?.subarray(0, 2).toString(), 'BM', 'its picture beside it, byte for byte (a BMP inside, as the host app reads it)');
  // A second email from the same stranger links the card made for the first (never "Mike Farman 2").
  const again = await r.handlers.get('intake:email')('Test2.msg', raw);
  assert.equal(again.person.path, landed.person.path);
  assert.equal(again.madeCard, null);
});

test('a stranger on free mail gets a card with no organisation; an address-less paste gets none', async () => {
  const r = rig(vaultFiles());
  const free = await r.handlers.get('intake:email')('q.eml', emlBytes(EML('Ava Nguyen <ava.nguyen.sample@outlook.com>', 'Harbour fit-out: weekend cover', 'Can you cover Saturday?')));
  assert.equal(free.person.name, 'Ava Nguyen');
  assert.ok(!/^org:/m.test(r.read(free.madeCard)), 'free mail names no organisation');
  const plain = await r.handlers.get('intake:paste')('Ring ShadeCo before Friday\nThey lapse the quote.');
  assert.equal(plain.person, null);
  assert.equal(plain.madeCard, null);
  assert.match(r.read(plain.path), /^# Ring ShadeCo before Friday$/m, 'subject from its first line');
});

test('pasted email text with headers lands as an email; damaged files are refused plainly', async () => {
  const r = rig(vaultFiles());
  const pasted = await r.handlers.get('intake:paste')(EML('June Park <june.park@example.invalid>', 'Harbour fit-out awning photo', 'The photo is attached.').replace(/--abc[\s\S]*$/, 'The photo is attached.\n'));
  assert.equal(pasted.title, 'Harbour fit-out awning photo');
  assert.deepEqual(pasted.person, { name: 'June Park', path: JUNE });
  await assert.rejects(r.handlers.get('intake:email')('x.eml', emlBytes('just words, no headers\n')), /isn’t an email/, 'not mail, said plainly');
  await assert.rejects(r.handlers.get('intake:email')('x.msg', new Uint8Array(600)), /isn’t an email/);
  await assert.rejects(r.handlers.get('intake:pdf')('x.pdf', emlBytes('not a pdf')), /isn’t a PDF/);
  await assert.rejects(r.handlers.get('intake:paste')('   '), /Paste the email’s text first/);
});

test('PDF in: lands with its title; answering files it under the project with its next step', async () => {
  const r = rig(vaultFiles());
  const landed = await r.handlers.get('intake:pdf')('Harbour-fitout-quote.pdf', new Uint8Array(QUOTE_BYTES));
  assert.equal(landed.title, 'Harbour fitout quote');
  assert.equal(landed.person, null);
  const { items } = await r.handlers.get('inbox:list')();
  assert.ok(items.some((i) => i.id === landed.id && i.words === 'Harbour fitout quote'), 'the Inbox shows its title, never the file name');
  const before = r.snapshot();
  const answered = await r.handlers.get('intake:answer')(landed.id, HARBOUR, 'Ring ShadeCo before the quote lapses');
  assert.match(answered.words, /Filed “Harbour fitout quote” under Harbour fit-out/);
  assert.match(answered.words, /Next step: “Ring ShadeCo before the quote lapses”/);
  assert.ok(answered.undo, 'the answer carries Undo');
  assert.match(r.read(HARBOUR), /Ring ShadeCo before the quote lapses/, 'the next step is a Task on the project');
  assert.match(r.read(HARBOUR), /Harbour fitout quote/, 'the project lists it in Documents');
  assert.equal(r.read(landed.path), null, 'gone from the Inbox');
  assert.deepEqual(r.readBytes('Work/Projects/Harbour/Files/Harbour-fitout-quote.pdf'), QUOTE_BYTES, 'the file in the project’s files');
  // Nothing written outside the project it was filed under (plus the filing's own journal).
  const after = r.snapshot();
  const changed = [...after.keys()].filter((k) => before.get(k) !== after.get(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  assert.deepEqual(removed, [landed.path], 'only the Inbox file left');
  for (const k of changed) assert.ok(k === HARBOUR || k.startsWith('Work/Projects/Harbour/') || k.startsWith('.neuralvault/journal/'), `nothing outside the project (${k})`);
  assert.equal(before.get('Inbox.md'), after.get('Inbox.md'), 'the Inbox note untouched');
});

test('answering an email: contained — project link, Documents line, attachments along, step made', async () => {
  const r = rig(vaultFiles());
  const landed = await r.handlers.get('intake:email')('quote.eml', emlBytes(EML('June Park <june.park@example.invalid>', 'Harbour fit-out quote lapses Friday', 'ShadeCo quoted twelve hundred fitted for the Harbour fit-out.')));
  const answered = await r.handlers.get('intake:answer')(landed.id, HARBOUR, 'Pay the deposit once June confirms');
  assert.match(answered.words, /Filed “Harbour fit-out quote lapses Friday” under Harbour fit-out/);
  const dest = 'Work/Projects/Harbour/Notes/Harbour fit-out quote lapses Friday.md';
  const note = r.read(dest);
  assert.match(note, /^project: "\[\[Harbour fit-out\]\]"$/m, 'the note carries the typed project link');
  assert.match(note, /^sender: "\[\[June Park\]\]"$/m, 'and keeps its sender');
  assert.match(r.read(HARBOUR), /^- `Harbour fit-out quote lapses Friday`$/m, 'the project lists it back (both ways)');
  assert.match(r.read(HARBOUR), /Pay the deposit once June confirms/, 'the next step made');
  assert.deepEqual(r.readBytes('Work/Projects/Harbour/Files/Harbour fit-out quote lapses Friday/Harbour-quote.pdf'), QUOTE_BYTES, 'attachments ride along');
  assert.equal(r.read(landed.path), null);
  // Undo puts every bit back: the note, its link out, its Documents line out, attachments back, step out.
  await r.handlers.get('inbox:undo-auto')(answered.undo);
  assert.ok(r.read(landed.path), 'the note back in the Inbox');
  assert.ok(!/^project:/m.test(r.read(landed.path)), 'its project link out');
  assert.ok(!r.read(HARBOUR).includes('Harbour fit-out quote lapses Friday'), 'its Documents line out');
  assert.ok(!r.read(HARBOUR).includes('Pay the deposit once June confirms'), 'its step out');
  assert.deepEqual(r.readBytes('Inbox/Attachments/Harbour fit-out quote lapses Friday/Harbour-quote.pdf'), QUOTE_BYTES, 'attachments back beside it');
});

test('"No next step" files it plainly; a repeat PDF becomes the next version, never a second document', async () => {
  const r = rig(vaultFiles());
  const first = await r.handlers.get('intake:pdf')('Harbour-quote.pdf', new Uint8Array(QUOTE_BYTES));
  const a1 = await r.handlers.get('intake:answer')(first.id, HARBOUR, '');
  assert.match(a1.words, /No next step/);
  assert.ok(!r.read(HARBOUR).includes('- [ ]') || !/Harbour-quote/.test(r.read(HARBOUR).split("## What's next")[1].split('## ')[0].replace('Chase the benchtop delivery', '')), 'no step added');
  const second = await r.handlers.get('intake:pdf')('Harbour quote v2.pdf', new Uint8Array(QUOTE_BYTES));
  // The project holding its earlier copy comes first, whatever its words say (12 Nov 2026).
  assert.equal(second.suggestions[0]?.target.path, HARBOUR, `the earlier copy's project is suggested first (${JSON.stringify(second.suggestions)})`);
  assert.match(second.suggestions[0].why, /earlier copy/i);
  await r.handlers.get('intake:answer')(second.id, HARBOUR, 'Send v2 to June');
  const text = r.read(HARBOUR);
  const docs = S.proj.parseProject(text, HARBOUR).documents;
  assert.equal(docs.length, 2, 'two entries, chained — the list shows the latest only');
  const latest = docs.find((x) => x.path.includes('v2'));
  assert.ok(latest.more && /replaces: "\[\[.*Harbour-quote\.pdf.*\]\]"/.test(latest.more) || /replaces: \[\[.*Harbour-quote\.pdf.*\]\]/.test(latest.more), `the repeat links what it replaces (${latest.more})`);
  assert.equal(docs.filter((x) => !x.more).length, 1, 'the first version stays plain');
});

test('one short word suggests nothing; filing from the row contains the same as answering', async () => {
  const r = rig(vaultFiles());
  // Critic 1 #6 end to end: "wrote back" must not file a bank email to the refit.
  const bank = await r.handlers.get('intake:paste')('The bank wrote back about the Saturday card failure. They want the till logs before they send a technician.');
  assert.ok(!(bank.suggestions[0]?.target.kind === 'project' && bank.suggestions[0]?.target.path === REFIT), 'no confident wrong guess');
  const landed = await r.handlers.get('intake:email')('quote.eml', emlBytes(EML('June Park <june.park@example.invalid>', 'Harbour fit-out benchtop is late', 'The benchtop missed its slot again.')));
  const filed = await r.handlers.get('inbox:file')(landed.id, { kind: 'project', path: HARBOUR, name: 'Harbour fit-out' });
  assert.match(filed.words, /Filed “Harbour fit-out benchtop is late” under Harbour fit-out/);
  assert.match(r.read('Work/Projects/Harbour/Notes/Harbour fit-out benchtop is late.md'), /^project: "\[\[Harbour fit-out\]\]"$/m);
  await r.handlers.get('inbox:undo-auto')(filed.undo);
  assert.ok(r.read(landed.path), 'row filing undoes too');
  assert.ok(!r.read(HARBOUR).includes('benchtop is late'), 'its Documents line out');
});

test('the assistant is taught containment: an email or file stays with its project', () => {
  const agent = readFileSync(path.join(root, 'src/main/agent.ts'), 'utf8');
  assert.ok(agent.includes('An email or file stays with its project'), 'the assistant keeps arrivals contained');
  assert.ok(agent.includes('never a companion note ("Summary", "Notes on'), 'the assistant never scatters companion notes');
  assert.ok(agent.includes('linked to that document with [[its title]], not a new note'), 'changes become Tasks linked to the document');
});

test('Done keeps an email’s attachments with it; mail saves through the connection', async () => {
  const r = rig(vaultFiles());
  const landed = await r.handlers.get('intake:email')('quote.eml', emlBytes(EML('June Park <june.park@example.invalid>', 'Harbour fit-out weekend cover', 'Can you cover Saturday?')));
  await r.handlers.get('inbox:done')(landed.id);
  assert.ok(r.read('Inbox/Done/Harbour fit-out weekend cover.md'), 'the note kept under Done');
  assert.deepEqual(r.readBytes('Inbox/Done/Harbour fit-out weekend cover/Harbour-quote.pdf'), QUOTE_BYTES, 'its attachment with it');
  // Standalone: no mailboxes, and saving says where mail comes from.
  assert.deepEqual(await r.handlers.get('intake:mailboxes')(), []);
  await assert.rejects(r.handlers.get('intake:mail-save')('m', 1), /No mailbox is connected to Ironleaf/);
  const m = rig(vaultFiles(), { mail: { mailboxes: async () => [{ id: 'g', label: 'Gmail', address: 'me@example.invalid' }], list: async () => [{ uid: 7, from: 'June Park <june.park@example.invalid>', date: 'Tue', subject: 'Harbour fit-out paint', words: 'painter booked', unread: true }], read: async () => ({ raw: emlBytes('From: June Park <june.park@example.invalid>\r\nSubject: Harbour fit-out paint\r\nContent-Type: text/plain\r\n\r\nPainter booked for Monday.\r\n') }) } });
  assert.deepEqual(await m.handlers.get('intake:mailboxes')(), [{ id: 'g', label: 'Gmail', address: 'me@example.invalid' }]);
  const listed = await m.handlers.get('intake:mail-list')('g', 5);
  assert.equal(listed[0].subject, 'Harbour fit-out paint');
  const saved = await m.handlers.get('intake:mail-save')('g', 7);
  assert.equal(saved.title, 'Harbour fit-out paint');
  assert.deepEqual(saved.person, { name: 'June Park', path: JUNE });
});
