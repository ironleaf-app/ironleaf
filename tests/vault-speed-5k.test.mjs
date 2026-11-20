// node --test tests/vault-speed-5k.test.mjs — fast on a big vault (v5-vault-speed, 5 Nov 2026). , a
// large uplift in everything. The u1 audit measured, on 5,000 notes: records:peek rebuild 7.3 s on
// every note open after a save (records.ts specificJoins scans every link pair: O(links squared)),
// 120-200 ms per search keystroke (every query folds and scans the whole vault), 6 snippets fetched
// per hit while the window shows 2, the 200-row list rendered in full with no arrow keys, a 2.2 MB
// note list on every boot, and a 3-4 MB graph on every open. Each check below fails without its fix;
// the timings at the end print for the human. Made-up notes; a fixed today (Thursday 5 Nov 2026).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.no_proxy = [process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1,localhost'].filter(Boolean).join(',');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Thursday 5 November 2026.
const NOW = new Date(2026, 10, 5, 9, 0).getTime();
const N_NOTES = 5000;
const WORDS = ['harbour', 'invoice', 'crane', 'permit', 'roster', 'defects', 'handover', 'supplier', 'council', 'deposit', 'fitout', 'safety', 'quote', 'delivery', 'rental'];

/** 5,000 notes (~1.5 KB each, tags, links, tasks), one hub note linked from every 7th note (~715),
 *  one long note (~9,000 words), and a small project with a meeting for the records spot checks. */
function seed(index) {
  for (let i = 0; i < N_NOTES; i++) {
    const w = WORDS[i % WORDS.length];
    const link = i % 7 === 0 ? '[[Hub Note]]' : `[[Note ${(i + 1) % N_NOTES}]]`;
    const body =
      `---\ntype: note\ntags: [tag${i % 40}]\n---\n# Note ${i}\n\nThe ${w} work continues ${link}. See also [[Note ${(i + 500) % N_NOTES}]] and #tag${i % 40}.\n\n` +
      `## Details ${i}\n\nRelated: [[Note ${(i + 1000) % N_NOTES}]] and [[Note ${(i + 2500) % N_NOTES}]].\n\n### Sub ${i}\n\n- [ ] Follow up the ${w} item ${i}\n- [x] File the ${w} paperwork ${i}\n\n` +
      `Paragraph about ${w} and more words to fill the note with ordinary project talk. `.repeat(16) + '\n';
    index.set(`Notes/Note ${i}.md`, body, NOW - (i % 30) * 86400000, body.length);
  }
  index.set('Hub Note.md', '# Hub Note\n\nThe centre of the vault.\n', NOW, 100);
  index.set('Long.md', '# Long\n\n' + 'sentence about the harbour works and the supplier invoices '.repeat(900), NOW, 50000);
  index.set(
    'Projects/Harbour/Harbour.md',
    ['---', 'type: project', 'status: active', 'owner: Mia Chen', '---', '# Harbour', '', "## What's next", '', '- [ ] Ring the supplier — Mia Chen', '', '## Key dates', '', '- 2026-11-20: Handover (milestone)', ''].join('\n'),
    NOW,
    300,
  );
  index.set(
    'Projects/Harbour/Kickoff.md',
    ['---', 'type: meeting', 'project: Harbour', '---', '# Kickoff', '', 'Met with [[Mia Chen]] about the [[Harbour|harbour works]].', '', '- [ ] Book the crane', ''].join('\n'),
    NOW,
    200,
  );
}

describe('5k vault: the slow paths', async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'nv-speed5k-'));
  after(() => rmSync(work, { recursive: true, force: true }));
  let O;
  let index;
  const times = {};
  const timed = (name, fn) => {
    const t = Date.now();
    const out = fn();
    times[name] = Date.now() - t;
    return out;
  };

  // The bundle holds the four modules under test plus the two new pure helpers.
  try {
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    const entry = path.join(work, 'entry.ts');
    writeFileSync(
      entry,
      `export { VaultIndex } from ${JSON.stringify(path.join(root, 'src/main/indexer.ts'))};\n` +
        `export { buildRecordModel, connectedTo } from ${JSON.stringify(path.join(root, 'src/shared/records.ts'))};\n` +
        `export { parseQuery, QueryMatcher } from ${JSON.stringify(path.join(root, 'src/shared/query.ts'))};\n` +
        `export { foldDiacritics } from ${JSON.stringify(path.join(root, 'src/shared/markdown.ts'))};\n` +
        `export { applyGraphDelta, diffGraph } from ${JSON.stringify(path.join(root, 'src/shared/graph-delta.ts'))};\n`,
    );
    await build({ input: entry, platform: 'node', external: ['yaml', 'electron'], output: { file: path.join(work, 'speed5k.mjs'), format: 'esm' }, logLevel: 'silent' });
    mkdirSync(path.join(work, 'node_modules'), { recursive: true });
    symlinkSync(path.join(root, 'node_modules', 'yaml'), path.join(work, 'node_modules', 'yaml'));
    O = await import(pathToFileURL(path.join(work, 'speed5k.mjs')).href);
    index = new O.VaultIndex();
    timed('index.set x5004', () => seed(index));
  } catch (e) {
    test('the bundle builds (graph-delta.ts exists)', () => {
      assert.fail(`bundle failed: ${(e && e.message) || e}`);
    });
  }

  test('record-link pairs are indexed: the peek rebuild is seconds, not tens of seconds', () => {
    assert.ok(O, 'the bundle builds first');
    const model = timed('records build', () => index.records({ today: '2026-11-05' }));
    console.log(`      records: ${times['records build']} ms for ${model.records.size} records, ${model.links.length} links`);
    assert.ok(times['records build'] < 12000, `the rebuild fits in 12 s, took ${times['records build']} ms`);
    assert.ok(model.links.length > 10000, 'the links are all still there');
    // A specific join still beats a generic link (p17-connected): the meeting of a project says
    // "Meeting", never "Meeting · Links here".
    const conns = O.connectedTo(model, 'meeting:Projects/Harbour/Kickoff.md');
    const proj = conns.find((c) => c.record.id === 'project:Projects/Harbour/Harbour.md');
    assert.ok(proj, 'the meeting still joins its project');
    assert.ok(proj.kinds.includes('project'), 'as its project');
    assert.ok(!proj.kinds.includes('link'), 'with no generic link beside it');
    // The hub note still gathers its hundreds of links.
    const hub = O.connectedTo(model, 'note:Hub Note.md');
    assert.ok(hub.length > 700, `the hub keeps its links (${hub.length})`);
  });

  test('search fetches the 2 snippets shown, not 6', () => {
    assert.ok(O, 'the bundle builds first');
    const hits = timed("search 'harbour'", () => index.search('harbour'));
    assert.ok(hits.length > 10, 'a common word still hits across the vault');
    assert.ok(hits.every((h) => h.snippets.length <= 2), `every hit carries at most 2 snippets (first: ${hits[0].snippets.length})`);
    assert.ok(hits.some((h) => h.snippets.length === 2), 'the cap binds: some hit shows both lines');
    assert.ok(hits.every((h) => h.matches >= h.snippets.length), 'the match counts still read whole');
  });

  test('the query words are folded once per search, not once per note', () => {
    assert.ok(O, 'the bundle builds first');
    const m = new O.QueryMatcher(O.parseQuery('café "Harbour View" -closed'));
    assert.deepEqual(
      m.positives.map((p) => p.folded),
      ['cafe', 'harbour view'],
      'each searched word carries its folded form (excluded words never highlight)',
    );
  });

  test('folded matching reads exactly as unfolding: the same hits for every operator', () => {
    assert.ok(O, 'the bundle builds first');
    const fold = (s) => O.foldDiacritics(s).toLowerCase();
    const docs = [
      { path: 'Notes/Café fit-out.md', title: 'Café fit-out', content: '# Café fit-out\nMeet Mia Chen at the café on Harbour.\n\n- [ ] Order the LED panels\n- [x] Pay the deposit\n', tags: ['site'], props: { status: 'draft' } },
      { path: 'Notes/Plain.md', title: 'Plain', content: 'Nothing here but ordinary words.\n', tags: [], props: {} },
    ];
    const queries = ['café', 'cafe harbour', '"LED panels"', 'mia OR plain', 'harbour -plain', 'file:café', 'path:Notes', 'tag:site', 'content:deposit', 'line:(LED panels)', 'section:(café harbour)', 'task:panels', 'task-todo:panels', 'task-done:deposit', '[status:draft]', '/LED\\s+panels/', 'match-case:(LED)', 'ignore-case:(LED)'];
    for (const q of queries) {
      const matcher = new O.QueryMatcher(O.parseQuery(q));
      for (const doc of docs) {
        const folded = { title: fold(doc.title), content: fold(doc.content), all: fold(`${doc.title}\n${doc.content}`), lines: doc.content.split('\n').map(fold) };
        assert.equal(matcher.matches(doc, folded), matcher.matches(doc), `${JSON.stringify(q)} on ${doc.path}`);
        assert.equal(matcher.score(doc, folded), matcher.score(doc), `score ${JSON.stringify(q)} on ${doc.path}`);
      }
    }
  });

  test('warm keystrokes stay quick; resolving a path no longer scans the vault', () => {
    assert.ok(O, 'the bundle builds first');
    index.search('harbour');
    const t = Date.now();
    for (let i = 0; i < 5; i++) index.search('harbour');
    const avg = (Date.now() - t) / 5;
    console.log(`      warm search avg: ${avg.toFixed(1)} ms`);
    assert.ok(avg < 150, `a warm keystroke stays under 150 ms (took ${avg.toFixed(1)} ms avg: hang guard)`);
    const p = 'Notes/Note 1234.md';
    assert.equal(index.resolve(p), p, 'a path still resolves to itself');
    const t2 = Date.now();
    for (let i = 0; i < 5000; i++) index.resolve(p);
    const took = Date.now() - t2;
    console.log(`      resolve x5000: ${took} ms`);
    assert.ok(took < 300, `5,000 path resolves fit in 300 ms, took ${took} ms`);
    assert.equal(index.resolve('Note 10', 'Notes/Note 9.md'), 'Notes/Note 10.md', 'titles still resolve by name');
  });

  test('a light note list for boot: the same notes, a fraction of the bytes', () => {
    assert.ok(O, 'the bundle builds first');
    assert.equal(typeof index.slimMeta, 'function', 'the index offers a slim list');
    const full = timed('allMeta', () => index.allMeta());
    const slim = timed('slimMeta', () => index.slimMeta());
    assert.deepEqual(slim.map((m) => m.path), full.map((m) => m.path), 'the same notes in the same order');
    assert.ok(slim.every((m) => Array.isArray(m.links) && m.links.length === 0), 'no body links cross on boot');
    assert.ok(slim.every((m) => Array.isArray(m.headings) && m.headings.length === 0), 'no headings cross on boot');
    const spot = slim.find((m) => m.path === 'Notes/Note 3.md');
    assert.equal(spot.title, 'Note 3', 'names intact');
    assert.deepEqual(spot.tags, ['tag3'], 'tags intact');
    assert.equal(spot.props.type, 'note', 'properties intact');
    const fullBytes = Buffer.byteLength(JSON.stringify(full));
    const slimBytes = Buffer.byteLength(JSON.stringify(slim));
    console.log(`      boot list: ${fullBytes} -> ${slimBytes} bytes (${(100 * slimBytes / fullBytes).toFixed(1)}%)`);
    assert.ok(slimBytes < fullBytes * 0.6, 'the slim list is well under the full one (names, tags and properties ride whole)');
  });

  test('the graph moves in deltas: a one-note edit crosses in kilobytes, and applies whole', () => {
    assert.ok(O, 'the bundle builds first');
    assert.equal(typeof index.graphSince, 'function', 'the index offers graph deltas');
    const g1 = timed('graph full', () => index.graph(''));
    assert.equal(typeof g1.generation, 'number', 'a full graph names its generation');
    index.set('Notes/Note 9.md', index.content('Notes/Note 9.md') + '\nA new link to [[Brand new neighbour]] and a #brand-new-tag.\n', NOW, 2000);
    const g2 = index.graph('');
    assert.ok(g2.generation !== g1.generation, 'an edit moves the generation');
    const snap = timed('graph delta', () => index.graphSince(g1.generation, ''));
    assert.equal(snap.generation, g2.generation, 'the delta lands on the new generation');
    assert.ok(snap.delta && !snap.full, 'one edit behind is a delta, not a full graph');
    assert.ok(snap.delta.nodes.upsert.length > 0 && snap.delta.links.upsert.length > 0, 'the edit moves cards and lines');
    const fullBytes = Buffer.byteLength(JSON.stringify(g2));
    const deltaBytes = Buffer.byteLength(JSON.stringify(snap.delta));
    console.log(`      graph: ${fullBytes} -> ${deltaBytes} bytes (${(100 * deltaBytes / fullBytes).toFixed(2)}%)`);
    assert.ok(deltaBytes < fullBytes * 0.1, 'the delta is under 10% of the full graph');
    const applied = O.applyGraphDelta(g1, snap.delta);
    // Order is not contracted (every view sorts its cards); the same cards and lines with the same words is whole.
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const byKey = (a, b) => (`${a.source}${a.target}${a.kind}` < `${b.source}${b.target}${b.kind}` ? -1 : 1);
    assert.deepEqual([...applied.nodes].sort(byId), [...g2.nodes].sort(byId), 'nodes apply whole');
    assert.deepEqual([...applied.links].sort(byKey), [...g2.links].sort(byKey), 'links apply whole');
    const stale = index.graphSince(-1, '');
    assert.ok(stale.full && !stale.delta, 'an unknown generation gets the whole graph');
  });

  test('related notes stay the same notes, still quick', () => {
    assert.ok(O, 'the bundle builds first');
    const t = Date.now();
    const a = index.relatedNotes('Notes/Note 10.md');
    const b = index.relatedNotes('Notes/Note 10.md');
    console.log(`      relatedNotes: ${Date.now() - t} ms`);
    assert.deepEqual(a, b, 'twice asked, the same answer');
    assert.ok(Date.now() - t < 2000, 'a hang guard, not a budget');
  });
});

describe('search result keyboard order (shared, no window)', async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'nv-speed5k-nav-'));
  after(() => rmSync(work, { recursive: true, force: true }));
  let S;
  try {
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    const entry = path.join(work, 'entry.ts');
    writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/search-ask-87.ts'))};\n`);
    await build({ input: entry, platform: 'node', output: { file: path.join(work, 'nav.mjs'), format: 'esm' }, logLevel: 'silent' });
    S = await import(pathToFileURL(path.join(work, 'nav.mjs')).href);
  } catch (e) {
    test('the search rules bundle', () => assert.fail(`bundle failed: ${(e && e.message) || e}`));
  }

  test('arrows walk commands, then notes, then files, then pictures, in the order drawn', () => {
    assert.ok(S, 'the bundle builds first');
    assert.equal(typeof S.flattenSearchNav, 'function', 'one order for the keys');
    assert.equal(typeof S.moveSearchNav, 'function', 'one way to move through it');
    const rows = S.flattenSearchNav(
      [{ id: 'new-note' }],
      [{ path: 'B.md' }, { path: 'A.md' }],
      [{ key: 'p|f.md' }],
      [{ key: 'pic.png|0' }],
    );
    assert.deepEqual(
      rows.map((r) => `${r.kind}:${r.id}`),
      ['command:new-note', 'note:B.md', 'note:A.md', 'file:p|f.md', 'pic:pic.png|0'],
      'the drawn order, top to bottom',
    );
    assert.equal(S.moveSearchNav(rows.length, -1, 1), 0, 'down from nowhere lands on the first row');
    assert.equal(S.moveSearchNav(rows.length, 0, -1), rows.length - 1, 'up from the first wraps to the last');
    assert.equal(S.moveSearchNav(rows.length, rows.length - 1, 1), 0, 'down from the last wraps to the first');
    assert.equal(S.moveSearchNav(rows.length, 1, 1), 2, 'otherwise one row at a time');
    assert.equal(S.moveSearchNav(0, -1, 1), -1, 'no rows is nowhere');
  });
});

describe('the wiring is in the window', () => {
  test('the search box walks its rows on arrows, shows the row, and opens it on Enter', () => {
    const view = read('src/renderer/src/components/SearchView.tsx');
    for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.ok(view.includes(`'${k}'`), `the search box answers ${k}`);
    assert.ok(view.includes('flattenSearchNav'), 'the keys walk the one shared order');
    assert.ok(view.includes('moveSearchNav'), 'moving wraps the one shared way');
    assert.ok(view.includes('data-nav='), 'every row carries its place in the order');
    assert.ok(view.includes("scrollIntoView({ block: 'nearest' })"), 'the arrowed row never walks out of sight');
    assert.ok(view.includes('setArrow(-1)'), 'new words start nowhere again');
  });

  test('the first chunk shows, the rest waits behind plain words', () => {
    const view = read('src/renderer/src/components/SearchView.tsx');
    assert.ok(view.includes('SEARCH_SHOW'), 'one named chunk size for the list');
    assert.ok(view.includes('Show more results'), 'the rest waits behind plain words');
    assert.ok(view.includes('setShown'), 'arrows and the button grow the same shown rows');
  });

  test('the arrowed row reads as the chosen one, in a theme colour only', () => {
    const view = read('src/renderer/src/components/SearchView.tsx');
    assert.ok(view.includes("? ' hot' : ''"), 'rows take the chosen mark from the arrowed row');
    // No new colour: the kit already marks chosen rows in the theme's side ground, for both row kinds.
    const kit = read('src/renderer/src/styles/kit.css');
    assert.ok(kit.includes('.srow2.hot { background: var(--bg-side); }'), 'note, file and picture rows mark chosen');
    assert.ok(kit.includes('.prow2.hot'), 'command rows mark chosen too');
  });

  test('boot lists light and upgrades; the graph asks for its delta', () => {
    const store = read('src/renderer/src/state/store.ts');
    assert.ok(store.includes('listSlim'), 'boot reads the light list first');
    assert.ok(store.includes('loadNotesFast'), 'then upgrades to the whole list behind it');
    const preload = read('src/preload/index.ts');
    assert.ok(preload.includes("'vault:list-slim'"), 'the bridge carries the light list');
    assert.ok(preload.includes("'index:graph-since'"), 'the bridge carries graph deltas');
    const app = read('src/main/app.ts');
    assert.ok(app.includes("handle('vault:list-slim'"), 'the main side answers the light list');
    assert.ok(app.includes("handle('index:graph-since'"), 'the main side answers graph deltas');
    const held = read('src/renderer/src/state/graphData.ts');
    assert.ok(held.includes('graphSince') && held.includes('applyGraphDelta'), 'the held graph moves in deltas');
    assert.ok(held.includes('window.nv.index.graph()'), 'an older host without deltas still answers whole');
    const tab = read('src/renderer/src/views/GraphTab.tsx');
    assert.ok(tab.includes('useGraphData(revision, !!centre)'), 'the Map holds its graph only for a focus (one draw per open)');
    const map = read('src/renderer/src/components/GraphView.tsx');
    assert.ok(map.includes('useGraphData(revision)'), 'the card map holds its graph the same way');
    const boot = read('src/renderer/src/App.tsx');
    assert.ok(boot.includes('loadNotesFast'), 'opening the notes boots light');
  });
});

describe('live: arrows and chunked results in the real window', () => {
  test('70 long hits show in chunks, walk on arrows, and open on Enter', async () => {
    const H = await import('./vault-controls-harness.mjs');
    const work = mkdtempSync(path.join(tmpdir(), 'nv-speed5k-live-'));
    const close = [];
    try {
      const vaultDir = path.join(work, 'vault');
      mkdirSync(vaultDir, { recursive: true });
      H.writeVault(vaultDir);
      // Long real content: 70 notes sharing one word, several matching lines each.
      const paras = [
        'The quayside compound has to move off the promenade before the school holidays start, and the night shift rota still needs confirming with the waterfront team.',
        'Payment retry twice then fail loud: the decision stands, and the Safari repeat failures are being chased on the quayside device lab phones this week.',
        'Harbourline works compound logistics: crane bookings, permit renewals and the quayside delivery windows for the concrete pours next month.',
      ];
      mkdirSync(path.join(vaultDir, 'Notes'), { recursive: true });
      for (let i = 0; i < 70; i++) {
        const body = `---\ntype: note\ntags: [harbourline, quayside-log]\n---\n# Quayside log ${i}\n\n` + paras.map((p, k) => `Entry ${k + 1} for log ${i}: ${p} Reference QUAY-${1000 + i * 3 + k}.\n`).join('\n') + `\n- [ ] Chase the quayside delivery docket ${i}\n- [x] File the quayside permit copy ${i}\n`;
        writeFileSync(path.join(vaultDir, 'Notes', `Quayside log entry number ${i}.md`), body);
      }
      mkdirSync(path.join(work, 'data'), { recursive: true });
      const core = await H.loadCore(work);
      const box = { current: await H.openServices(vaultDir, path.join(work, 'data'), core) };
      const distDir = await H.buildRenderer(work);
      const server = await H.startServer(distDir, () => box.current);
      close.push(() => server.close());
      const browser = await H.startBrowser(server.origin);
      close.push(() => browser.close());
      const ev = browser.ev;
      for (let i = 0; i < 90; i++) {
        await sleep(500);
        try {
          if (await ev(`!!document.querySelector('.app')`)) break;
        } catch {}
      }
      await sleep(2200);
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1219, height: 709, deviceScaleFactor: 1, mobile: false });
      const key = async (windowsVirtualKeyCode, k, code, modifiers = 0) => {
        await browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode, key: k, code, modifiers });
        await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode, key: k, code, modifiers });
        await sleep(300);
      };
      // The search window (Ctrl+Shift+F), with a word 70 long notes share.
      await key(70, 'F', 'KeyF', 2 + 8);
      await sleep(1000);
      assert.equal(await ev(`!!document.querySelector('.sas-modal')`), true, 'the search window opens on its keys');
      await ev(`document.querySelector('.sas-modal .sin input')?.focus()`);
      await browser.send('Input.insertText', { text: 'quayside' });
      await sleep(3000);
      const heading = await ev(`document.querySelector('.sas-modal .rlabel')?.textContent ?? ''`);
      assert.match(heading, /Best matches · 7\d/, `all 70-odd hits counted (${heading})`);
      const rows = await ev(`document.querySelectorAll('.sas-modal .srow2').length`);
      assert.ok(rows <= 60 && rows > 10, `the first chunk shows, not all ${rows} rows`);
      const more = await ev(`[...document.querySelectorAll('.sas-modal button')].map((b) => b.textContent).find((t) => t.startsWith('Show more results')) ?? ''`);
      assert.match(more, /Show more results/, 'the rest waits behind plain words');
      // Arrows walk the rows; the arrowed row reads chosen.
      await key(40, 'ArrowDown', 'ArrowDown');
      await key(40, 'ArrowDown', 'ArrowDown');
      const hot = await ev(`(() => { const rows = [...document.querySelectorAll('.sas-modal .srow2')]; const hot = document.querySelector('.sas-modal .srow2.hot'); return { at: rows.indexOf(hot), title: hot?.querySelector('.t')?.textContent ?? '' }; })()`);
      assert.equal(hot.at, 1, 'two downs lands on the second row');
      // Enter opens the arrowed row, not the first.
      await key(13, 'Enter', 'Enter');
      await sleep(1500);
      const gone = await ev(`!document.querySelector('.sas-modal')`);
      assert.equal(gone, true, 'Enter puts the window away');
      // t7-note-window (8 Nov 2026): the bar keeps the folders and the title below keeps the name, never
      // twice — the crumb's words no longer name the note, so the opened note reads its path from the bar.
      const opened = await ev(`document.querySelector('.topbar .crumb')?.getAttribute('title') ?? ''`);
      assert.ok(opened.includes(hot.title), `the arrowed note opens (“${hot.title}”, bar path says “${opened}”)`);
    } finally {
      for (const fn of close.reverse()) {
        try { fn(); } catch {}
      }
      rmSync(work, { recursive: true, force: true });
    }
  }, { timeout: 420000 });
});
