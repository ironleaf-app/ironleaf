// node --test tests/t253-people-roles.test.mjs — People reads whole, each role their own, once
// (t253, 13 Nov 2026, the third picture: long roles ran underneath "Open card" and were cut at the
// card's edge; one repeated its own name, another held other people's lines). A stacked detail line
// under a row's title wraps whole words while trailing slots keep their line; Open card keeps its
// own place. A role reads as that person's own, once — other people's segments go, their own name
// comes off — while the file keeps the person's words until they change them. Made-up vault only.
// Fails without each change.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clickWords, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

// ── Unit: the one reading ───────────────────────────────────────────────

const work = mkdtempSync(path.join(tmpdir(), 'nv-t253-roles-'));
let H;
let F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const one = async (inFile, outFile) => {
    await build({ input: path.join(root, inFile), platform: 'node', output: { file: path.join(work, outFile), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, outFile)).href);
  };
  H = await one('src/shared/project-hub.ts', 'h.mjs');
  F = await one('src/shared/project-file.ts', 'f.mjs');
});
after(() => rmSync(work, { recursive: true, force: true }));

const KNOWN = ['June Park', 'Priya Nair', 'Tom Bradley', 'Lucy Hammond', 'Sam Ortega', 'Alex Chen'];

test('own role, once: their segments stay, others go, their own name comes off', () => {
  assert.equal(H.ownRole('Northgate requirements, plan and execution (Sam Ortega)', 'Sam Ortega', KNOWN), 'Northgate requirements, plan and execution');
  assert.equal(
    H.ownRole('Front beds (June Park); Priya Nair — Herb garden (Priya Nair); Tom Bradley — Compost; Lucy Hammond — Seed library and tool shed', 'June Park', KNOWN),
    'Front beds',
  );
  assert.equal(
    H.ownRole('Front beds (June Park); Priya Nair — Herb garden (Priya Nair); Tom Bradley — Compost', 'Priya Nair', KNOWN),
    'Herb garden',
  );
  assert.equal(
    H.ownRole('Project Manager (agency temp, Boston): milestones, reporting, roadmap (Tom Bradley)', 'Tom Bradley', KNOWN),
    'Project Manager (agency temp, Boston): milestones, reporting, roadmap',
  );
  assert.equal(H.ownRole('Herb garden lead (Priya)', 'Priya Nair', KNOWN), 'Herb garden lead', 'a first-name paren goes too');
});

test('anything else reads byte for byte as written', () => {
  assert.equal(H.ownRole('Garden coordinator', 'Alex Chen', KNOWN), 'Garden coordinator');
  assert.equal(H.ownRole('Garden beds fit-out point of contact; Responsible for the survey review', 'Priya Nair', KNOWN), 'Garden beds fit-out point of contact; Responsible for the survey review', 'several own parts stay');
  assert.equal(H.ownRole('', 'Alex Chen', KNOWN), '');
  assert.equal(H.ownRole('Herb garden (Priya Nair)', 'June Park', KNOWN), 'Herb garden (Priya Nair)', 'one segment never drops: only their own name comes off');
  assert.equal(
    H.ownRole('Herb garden (Priya Nair); Compost (Tom Bradley)', 'June Park', KNOWN),
    'Herb garden (Priya Nair); Compost (Tom Bradley)',
    'nothing of theirs to keep: the words stay rather than hide',
  );
});

test('the hub reads every person that way, keeping the words as written for the edit box', () => {
  const p = F.parseProject(
    `---\ntype: project\nstatus: active\nowner: Alex Chen\n---\n# Build\n\n## People\n\n- June Park — Front beds (June Park); Priya Nair — Herb garden (Priya Nair)\n- Priya Nair — Designer of the new receipts\n`,
    'Projects/Build/Build.md',
  );
  const hub = H.hubModel({ project: p, today: 20000, me: 'Alex Chen' });
  const june = hub.people.find((x) => x.name === 'June Park');
  const priya = hub.people.find((x) => x.name === 'Priya Nair');
  assert.equal(june.role, 'Front beds');
  assert.equal(june.roleRaw, 'Front beds (June Park); Priya Nair — Herb garden (Priya Nair)');
  assert.equal(priya.role, 'Designer of the new receipts');
  assert.equal(priya.roleRaw, undefined, 'untouched roles carry no second copy');
});

// ── Static: where the page reads it ─────────────────────────────────────

test('the People row reads the one rule and edits the words as written', () => {
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const bits = tabs.slice(tabs.indexOf('function personBits'), tabs.indexOf('function personBits') + 2500);
  assert.ok(bits.includes('ownRole(raw, x.name'), 'a role from their own page reads through the same rule');
  assert.ok(bits.includes('x.roleRaw ?? x.role'), 'the edit box opens on the words as written');
  assert.ok(bits.includes('{role || undefined}'), 'the row shows the short form');
  assert.ok(tabs.includes("style={{ marginLeft: 'auto', flex: 'none' }}") && tabs.includes('Open card'), 'Open card keeps its own place');
  assert.ok(read('src/renderer/src/styles/kit.css').includes('.pj-folio .trow > div > .meta { white-space: normal; overflow-wrap: break-word; }'), 'a stacked detail line wraps whole words');
});

// ── Live: long roles wrap whole inside their column ─────────────────────

const BIG = 'Projects/Harbour Festival Build/Harbour Festival Build.md';
let V = null;
async function harness() {
  if (!V) {
    V = await startHarness();
    await V.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    const w = (rel, text) => {
      const p = path.join(V.vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const D = (off) => iso(new Date(Date.now() + off * 864e5));
    w(BIG, `---\ntype: project\nstatus: active\nhealth: at risk\nowner: Alex Chen\ndue: ${D(14)}\n---\n# Harbour Festival Build\n\n## Summary\n\nThe summer festival build.\n\n## What's next\n\n- [ ] Ring the supplier about the invoice — Alex Chen — due ${D(-1)}\n\n## Key dates\n\n| Date | Milestone | Status |\n|---|---|---|\n| ${D(2)} | Rooms confirmed |  |\n\n## People\n\n- Alex Chen — Garden coordinator running the open days\n- Priya Nair — Garden beds fit-out point of contact; Responsible for the survey review, both action plans, equipment order and implementation\n- Sam Ortega — Northgate requirements, plan and execution (Sam Ortega)\n- June Park — Front beds (June Park); Priya Nair — Herb garden (Priya Nair); Tom Bradley — Compost; Lucy Hammond — Seed library and tool shed; Mia Kaur — Mondays and Thursdays\n- Tom Bradley — Project Manager (agency temp, Boston): milestones, reporting, communications, roadmap (Tom Bradley)\n- Lucy Hammond — Accountable for the survey review, action plans, equipment and ordering; approves the harbour plan (Lucy Hammond)\n- Mia Kaur — Weekend manager at the museum with the keys to every room\n\n## Decisions\n\n- ${D(-12)}: Open on the north wharf\n\n## Notes\n\nBuild.\n`);
    await V.services.rescanAll();
    await V.browser.send('Page.navigate', { url: `${V.origin}/harness.html` });
    assert.ok(await waitFor(V, `!!document.querySelector('.app')`, 45000), 'the app boots');
    await sleep(2500);
  }
  return V;
}

after(async () => { await V?.close().catch(() => {}); V = null; });

test('long roles wrap whole inside their column, Open card keeps its place, each role their own', { timeout: 300000 }, async () => {
  const h = await harness();
    await openRoom(h, 'Projects');
    assert.equal(await clickWords(h, 'Harbour Festival Build', 'main'), 'CLICKED', 'the project opens');
    assert.ok(await waitFor(h, `!!document.querySelector('.pj-page')`, 15000), 'the page lands');
    await sleep(1500);
    // t255: the section bar became real tabs — the People tab opens, showing its whole list unfolded.
    await h.browser.ev(`document.querySelector('[data-tab="people"]')?.click()`);
    await sleep(1200);
    for (const [W, Hg] of [[3456, 1408], [1219, 709]]) {
      await h.browser.send('Emulation.setDeviceMetricsOverride', { width: W, height: Hg, deviceScaleFactor: 2, mobile: false });
      await sleep(900);
      await sleep(600);
      const rows = await h.browser.ev(`[...document.querySelectorAll('[data-section="people"] [data-person]')].map((row) => {
        const meta = row.querySelector('.meta');
        const btn = [...row.querySelectorAll('button')].pop();
        const r = row.getBoundingClientRect();
        const q = btn.getBoundingClientRect();
        return { name: row.getAttribute('data-person'), over: meta.scrollWidth - meta.clientWidth, text: meta.innerText.replace(/\\s+/g, ' '),
          btnRight: Math.round(q.right), rowRight: Math.round(r.right) };
      })`);
      assert.ok(rows.length >= 7, `${W}: every person stands to judge (${rows.length})`);
      for (const r of rows) {
        assert.ok(r.over <= 1, `${W}: ${r.name} fits its box (${r.over}px over)`);
        assert.ok(!r.text.includes('…'), `${W}: ${r.name} reads whole, never dots`);
        assert.ok(r.btnRight <= r.rowRight + 1, `${W}: Open card keeps its own place on ${r.name}`);
      }
      const june = rows.find((r) => r.name === 'June Park').text;
      assert.ok(june.startsWith('Front beds · ') || june === 'Front beds', `June reads her own role, once (${june.slice(0, 60)})`);
      assert.ok(!june.includes('Priya') && !june.includes('Compost'), 'no other lines');
      const sam = rows.find((r) => r.name === 'Sam Ortega').text;
      assert.ok(sam.includes('Northgate requirements, plan and execution') && !sam.includes('(Sam Ortega)'), `Sam names no self (${sam.slice(0, 60)})`);
    }
});
