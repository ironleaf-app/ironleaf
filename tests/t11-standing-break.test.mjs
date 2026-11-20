// node --test tests/t11-standing-break.test.mjs — break tonight's one project standing (t11, 8 Nov 2026).
// The brief: status words in any case or spelling, front matter as a list/number/empty/missing, a due day in
// every written form, and counts agreeing between Projects, the Graph, Today and area cards. Each check below
// failed on the merged code: "Shipped" read open while a shipped key date read finished, Today and the cards
// weighed liveness with their own word lists instead of the one rule, and the Graph read due days with its own
// weaker reader (no "tomorrow", no month-first, no slashes, year-less dates pinned to this year).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'nv-t11-standing-'));
let S, G, TC, F;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const one = async (inFile, outFile) => {
    await build({ input: path.join(root, inFile), platform: 'node', output: { file: path.join(work, outFile), format: 'esm' }, logLevel: 'silent' });
    return import(pathToFileURL(path.join(work, outFile)).href);
  };
  S = await one('src/shared/project-standing.ts', 's.mjs');
  G = await one('src/shared/graph-layout.ts', 'g.mjs');
  TC = await one('src/shared/today-count.ts', 'tc.mjs');
  F = await one('src/shared/finished.ts', 'f.mjs');
});
after(() => rmSync(work, { recursive: true, force: true }));

const now = new Date();
const sharedDay = (text) => {
  const r = TC.readDay(text, now);
  return r ? TC.utcDay(r.year, r.month, r.day) : null;
};

// A project over reads over in every reader, whatever its health still says.
test('shipped is finished everywhere, like every other over word', () => {
  for (const status of ['Shipped', 'shipped', 'SHIPPED — v2 is out']) {
    assert.equal(F.isFinished(status), true, `${JSON.stringify(status)} is finished`);
    assert.equal(TC.isLive(status), false, `${JSON.stringify(status)} is not live`);
    assert.equal(S.isOpenProject(status), false, `${JSON.stringify(status)} is not open`);
    assert.equal(S.projectStanding({ status, health: 'on track' }).words, 'Finished', `${JSON.stringify(status)} never reads On track`);
  }
});

// The brief's own battery: done, on hold or idea in any case or spelling reads closed in every open count.
test('the brief battery reads closed in every open count', () => {
  for (const status of ['Done', 'complete', 'Closed ', 'on-hold', 'On Hold', 'paused', 'cancelled', 'Shipped']) {
    assert.equal(S.isOpenProject(status), false, `${JSON.stringify(status)} is not an open project`);
    assert.equal(S.projectStanding({ status }).open, false, `${JSON.stringify(status)} standing is closed`);
  }
  for (const status of ['active', 'Active', '', undefined]) {
    assert.equal(S.isOpenProject(status), true, `${JSON.stringify(status)} stays open`);
  }
});

// Front matter as the person (or another app) left it: a list holding done, a number, empty or missing.
test('odd front matter never reads open when it says over', () => {
  assert.equal(F.isFinished(['done']), true, 'a one-word list reading done is finished');
  assert.equal(TC.isLive(['done']), false, 'and not live');
  assert.equal(TC.isLive(1), true, 'a number is not a status, so it stays open');
  assert.equal(TC.isLive(''), true, 'empty stays open');
  assert.equal(TC.isLive(undefined), true, 'missing stays open');
});

// Today, the cards and the due words weigh liveness with the one rule, never their own word lists.
test('no reader keeps its own finished list', () => {
  for (const f of ['src/renderer/src/views/TodayView.tsx', 'src/renderer/src/lib/projectLook.ts']) {
    const src = read(f);
    assert.ok(!src.includes('done|closed|complete|completed'), `${f} weighs liveness with the one rule, never its own list`);
  }
  assert.ok(read('src/renderer/src/views/TodayView.tsx').includes('isLive('), 'Today counts live projects with isLive');
});

// Area readers split live the same way: on hold and ideas fold apart, never listed as live work.
test('area pages and rows fold held projects apart, like the projects page', () => {
  const page = read('src/renderer/src/views/AreaPage.tsx');
  assert.ok(page.includes('isOpenProject'), 'the area live list splits on the one open rule');
  assert.ok(/On hold/.test(page), 'held projects fold under their own head');
  const home = read('src/renderer/src/views/HomeView.tsx');
  const at = home.indexOf('cur.open += c.openNext');
  assert.ok(at > 0, 'area rows total open work');
  assert.ok(home.slice(Math.max(0, at - 260), at).includes('isOpenProject'), 'held projects keep their open work out of the area rows');
});

// A due day in every written form reads the same on the Graph as on Today.
test('the graph reads every written due day as today does', () => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const isoOf = (off) => { const x = new Date(d); x.setDate(x.getDate() + off); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const tmr = new Date(d); tmr.setDate(tmr.getDate() + 1);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const forms = [
    'tomorrow',
    'yesterday',
    isoOf(1),
    `${tmr.getDate()} ${MONTHS[tmr.getMonth()]} ${tmr.getFullYear()}`,
    `${MONTHS[tmr.getMonth()]} ${tmr.getDate()}, ${tmr.getFullYear()}`,
    `${tmr.getDate()}/${tmr.getMonth() + 1}/${tmr.getFullYear()}`,
    // Year-less: the nearest one, not always this year's (a January day read in November is next January).
    '10 Jan',
    '25 Dec',
  ];
  for (const form of forms) {
    assert.equal(G.readDay(form), sharedDay(form), `the graph reads ${JSON.stringify(form)} as today does`);
  }
});

// End to end: a project due yesterday reads Overdue on the Graph, as on Today.
test('a day-old due day presses on the graph too', () => {
  const words = G.cardDetail({ id: 'Work/Projects/Late/Late.md', kind: 'note', title: 'Late', project: true, due: 'yesterday' });
  assert.match(words, /overdue/i, `the graph says the late day plainly (saw ${JSON.stringify(words)})`);
});
