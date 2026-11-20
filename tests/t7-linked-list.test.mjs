// node --test tests/t7-linked-list.test.mjs — t7 item 3 (8 Nov 2026): links in, mentions and related notes
// are ONE Linked list at the note's foot, each row saying how it is linked, no duplicates of the same note.
// The merge is one shared function (src/shared/linked-list.ts) behind the foot's one list (t27-unused-panels:
// the side's links stack is gone). Fails first (no merge: a note that links here and shares tags shows twice,
// in two sections).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── node-side: the merge ──────────────────────────────────────────
const work = mkdtempSync(path.join(tmpdir(), 'nv-t7-linked-'));
let LL;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'linked.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/linked-list.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'linked.mjs'), format: 'esm' }, logLevel: 'silent' });
  LL = await import(pathToFileURL(path.join(work, 'linked.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const backlink = (source, line, context = `see [[Harbour Launch]] here ${line}`) => ({ source, sourceTitle: source.split('/').pop().replace(/\.md$/, ''), line, context });
const mention = (source, line, context = 'the Harbour Launch work continues') => ({ source, sourceTitle: source.split('/').pop().replace(/\.md$/, ''), line, context });
const rel = (p, score = 0.5, reasons = ['Both tagged #harbourline'], kinds = ['tags']) => ({ path: p, title: p.split('/').pop().replace(/\.md$/, ''), score, reasons, kinds, parts: { links: 0, tags: score, words: 0 } });

test('a note in two sources is one row, saying both', () => {
  const rows = LL.mergeLinked([backlink('Notes/A.md', 3)], [], [rel('Notes/A.md')]);
  assert.equal(rows.length, 1, 'one row');
  assert.equal(rows[0].path, 'Notes/A.md');
  assert.deepEqual(rows[0].reasons, ['links', 'related'], 'how it is linked, strongest first');
  assert.equal(rows[0].linkedLines.length, 1, 'its lines stay with it');
  assert.ok(rows[0].related, 'its related answer stays with it');
});

test('mentions stay linkable on the merged row, links stay plain', () => {
  const rows = LL.mergeLinked([], [mention('Notes/B.md', 5), mention('Notes/B.md', 9)], []);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].reasons, ['mentions']);
  assert.equal(rows[0].mentionLines.length, 2, 'both lines, to link either');
  assert.equal(rows[0].linkedLines.length, 0);
});

test('three sources at once: linked first, then mentions, then related-only', () => {
  const rows = LL.mergeLinked(
    [backlink('Notes/A.md', 1)],
    [mention('Notes/B.md', 2)],
    [rel('Notes/A.md', 0.9), rel('Notes/C.md', 0.1)],
  );
  assert.deepEqual(rows.map((r) => r.path), ['Notes/A.md', 'Notes/B.md', 'Notes/C.md']);
  assert.deepEqual(rows[0].reasons, ['links', 'related']);
  assert.deepEqual(rows[2].reasons, ['related']);
});

test('nothing in, nothing out; the open note never lists itself', () => {
  assert.deepEqual(LL.mergeLinked([], [], []), [], 'empty in, empty out');
  const rows = LL.mergeLinked([backlink('Notes/Me.md', 1)], [], [rel('Notes/Me.md')]);
  assert.equal(rows.length, 1, 'the caller filters itself (the foot keeps x.path !== path)');
});

// ── static: the foot renders the one list ─────────────────────────
test('the foot reads the one merge and lists each note once with its reasons', () => {
  const src = read('src/renderer/src/components/NoteFoot.tsx');
  assert.ok(src.includes('mergeLinked'), 'the one shared merge, never three separate lists');
  assert.ok(src.includes("from '../../../shared/linked-list'"), 'shared, not a local copy');
  // One list: a single Linked section whose rows say how each note is linked.
  assert.ok(!src.includes("'Linked here'") && !src.includes("'Mentioned'") && !src.includes("'Related'"), 'no three section heads');
  assert.ok(src.includes('reasonWords'), 'each row says how it is linked, through the one shared words');
  const words = read('src/shared/linked-list.ts');
  assert.ok(words.includes("'Links here'") && words.includes("'Mentions'") && words.includes("'Related'"), 'the shared words say it plainly');
  // Everything else stays: the filter, linking a mention, Show-all, the zero rule, the one shared read.
  assert.ok(src.includes('Filter these notes'), 'the filter stays');
  assert.ok(src.includes('Link it'), 'linking a mention stays');
  assert.ok(src.includes('foot-showall'), 'Show-all stays for a long list');
  assert.ok(src.includes('showCount'), 'the zero rule stays on the counts');
  assert.ok(src.includes('useNoteLinks'), 'the one shared read stays');
  assert.ok(!src.includes('window.nv.index.'), 'no own index read beside the shared one');
});

// ── browser: no duplicates on a real note ─────────────────────────
const { startHarness } = await import('./vault-controls-harness.mjs');

test('the foot lists a linked-and-related note once', { timeout: 420000 }, async () => {
  const H = await startHarness();
  try {
    const w = (relp, text) => writeFileSync(path.join(H.vaultDir, relp), text);
    w('Notes/Harbour Launch.md', '---\ntags: [harbourline, launch]\n---\n\n# Harbour Launch\n\nThe shop checkout goes live. See [[Kickoff]].\n');
    for (const n of ['One', 'Two', 'Three']) {
      w(`Notes/Link ${n}.md`, `---\ntags: [harbourline]\n---\n\n# Link ${n}\n\nPoints at the launch: see the [[Harbour Launch]] plan. Harbour and launch and checkout words.\n`);
    }
    w('Notes/Plain mention.md', '---\ntags: [harbourline]\n---\n\n# Plain mention\n\nNames the Harbour Launch in plain words. Harbour and launch and checkout words.\n');
    await H.services.rescanAll();
    const ev = H.browser.ev;
    const send = (m, p) => H.browser.send(m, p);
    for (let i = 0; i < 120; i++) { await sleep(500); try { if (await ev(`!!document.querySelector('.app')`)) break; } catch {} }
    await sleep(1500);
    const key = async (keyName, code, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, modifiers });
    };
    await key('o', 'KeyO', 2);
    await sleep(1200);
    await send('Input.insertText', { text: 'Harbour Launch' });
    await sleep(1500);
    await key('Enter', 'Enter', 0);
    await sleep(4000);
    assert.ok(await ev(`!!document.querySelector('.cm-editor')`), 'the note opens');
    await ev(`(() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = s.scrollHeight; })()`);
    let foot = false;
    for (let i = 0; i < 40 && !foot; i++) { await sleep(500); foot = await ev(`!!document.querySelector('.note-foot')`); }
    assert.ok(foot, 'the foot shows at the end');
    await sleep(2500);
    const heads = await ev(`[...document.querySelectorAll('.note-foot .foot-item-name')].map((e) => e.textContent.trim())`);
    const dupes = heads.filter((h, i) => heads.indexOf(h) !== i);
    assert.deepEqual(dupes, [], `no note twice in the one list (saw ${JSON.stringify(heads)})`);
    assert.ok(heads.some((h) => h.includes('Link One')), 'a linked note lists');
    const reasons = await ev(`document.querySelector('.note-foot')?.textContent ?? ''`);
    assert.ok(reasons.includes('Links here'), 'rows say how they link');
  } finally {
    await H.close();
  }
});
