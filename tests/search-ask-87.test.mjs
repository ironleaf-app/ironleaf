// node --test tests/search-ask-87.test.mjs — the 8.7 search and Ask (w2c round 2): one search over notes, tasks,
// projects, people, meetings and files with the mock-up's filter strip and one flat Best matches list; the helper's
// answers in the side chat panel (4 Nov 2026, p9-one-ask: the floating bar and its answer card are gone) with
// numbered sources and Undo on the card and in a toast; the notebook's ticked sources as one Ask scope. The pure rules
// (src/shared/search-ask-87.ts) run here against a made-up vault; the windows and wiring are guarded by what they must
// contain. No model is called (the shots' stand-in is tools/w2c-standin.js).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'nv-search-ask-87-'));
const read = (f) => readFileSync(path.join(root, f), 'utf8');
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  await build({ input: path.join(root, 'src/shared/search-ask-87.ts'), platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

const hit = (path, snippets = [], mtime = Date.now()) => ({ path, title: path.split('/').pop().replace(/\.md$/, ''), score: 1, snippets, matches: snippets.length, mtime });
const typeOf = (p) => (p.startsWith('Projects/') && !p.slice(9).includes('/') ? 'project' : p.startsWith('People/') ? 'person' : p.startsWith('Meetings/') ? 'meeting' : undefined);
const metaOf = (h) => S.metaForSearch(h.path, h.title, typeOf(h.path), h.props);

test('a hit is a project, person or meeting by its type, a task by a tick-box match, else a note', () => {
  assert.equal(S.kindOfHit(hit('Projects/Shop.md'), typeOf), 'projects');
  assert.equal(S.kindOfHit(hit('People/Mia Tran.md'), typeOf), 'people');
  assert.equal(S.kindOfHit(hit('Meetings/Sync.md'), typeOf), 'meetings');
  assert.equal(S.kindOfHit(hit('Notes/List.md', [{ line: 3, text: '- [ ] Buy flour', ranges: [] }]), typeOf), 'tasks');
  assert.equal(S.kindOfHit(hit('Notes/Ideas.md', [{ line: 1, text: 'Buy flour soon', ranges: [] }]), typeOf), 'notes');
});

test('every kind is counted, even at zero', () => {
  const counts = S.countByKind([hit('Projects/Shop.md'), hit('Notes/A.md'), hit('Notes/B.md')], typeOf);
  assert.deepEqual(counts, { projects: 1, people: 0, meetings: 0, tasks: 0, notes: 2 });
});

test('the filters leave only the hits that match kind, person, project and date together', () => {
  const now = new Date(2026, 9, 30, 12).getTime();
  const day = 24 * 3600 * 1000;
  const a = { ...hit('Projects/Shop.md', [], now - day), props: { owner: 'Mia Tran' } };
  const b = { ...hit('Notes/Old.md', [], now - 40 * day), props: { attendees: ['Mia Tran', 'Tom Nguyen'] } };
  const hits = [a, b];
  assert.deepEqual(S.filterHits(hits, metaOf, typeOf, { kind: 'projects', person: '', project: '', date: 'any' }, now).map((h) => h.path), ['Projects/Shop.md']);
  assert.deepEqual(S.filterHits(hits, metaOf, typeOf, { kind: 'all', person: 'mia tran', project: '', date: 'any' }, now).map((h) => h.path), ['Projects/Shop.md', 'Notes/Old.md']);
  assert.deepEqual(S.filterHits(hits, metaOf, typeOf, { kind: 'all', person: '', project: 'Shop', date: 'any' }, now).map((h) => h.path), ['Projects/Shop.md']);
  assert.deepEqual(S.filterHits(hits, metaOf, typeOf, { kind: 'all', person: '', project: '', date: 'month' }, now).map((h) => h.path), ['Projects/Shop.md']);
  assert.deepEqual(S.filterHits(hits, metaOf, typeOf, { kind: 'all', person: 'Tom Nguyen', project: '', date: 'month' }, now).map((h) => h.path), []);
  assert.deepEqual(S.filterHits(hits, metaOf, typeOf, { kind: 'files', person: '', project: '', date: 'any' }, now), [], 'files shows no note hits');
});

test('the person and project menus list who and what the hits name, most-named first', () => {
  const hits = [
    { ...hit('Projects/Shop.md'), props: { owner: 'Mia Tran' } },
    { ...hit('Notes/A.md'), props: { attendees: ['Mia Tran', 'Tom Nguyen'] } },
  ];
  assert.deepEqual(S.peopleInHits(hits, metaOf).slice(0, 2), [{ name: 'Mia Tran', count: 2 }, { name: 'Notes', count: 1 }]);
  assert.deepEqual(S.projectsInHits(hits, metaOf), [{ name: 'Shop', count: 1 }]);
});

test('the changed words read the way the card and the toast say them', () => {
  const base = { turnId: 't', made: 0, changed: 0, moved: 0, paths: [] };
  assert.equal(S.changeWords({ ...base, made: 1, paths: ['Notes/A.md'] }), 'Made 1 note');
  assert.equal(S.changeWords({ ...base, made: 2, changed: 1, paths: ['Notes/A.md', 'Notes/B.md', 'Notes/C.md'] }), 'Made 2 notes, changed 1 note');
  assert.equal(S.changeWords({ ...base, made: 1, paths: ['Docs/Plan.md'] }), 'Made 1 doc');
  assert.equal(S.changeWords({ ...base, projectsMade: 1, projectsChanged: 2, changed: 1, moved: 1, filesMade: 1, filesChanged: 3, paths: ['Projects/A/A.md'] }), 'Set up 1 project, brought 2 projects up to date, changed 1 note, moved 1 note, made 1 file, changed 3 files');
  assert.equal(S.changeWords(base), 'Changed the notes');
});

test('a folder binned or restored says its name and how many notes went with it', () => {
  const base = { turnId: 't', made: 0, changed: 0, moved: 0, paths: [] };
  assert.equal(S.changeWords({ ...base, binnedFolders: [{ title: 'Receipts', notes: 5 }], paths: [] }), 'Moved the folder “Receipts” with 5 notes to the Bin');
  assert.equal(S.changeWords({ ...base, binnedFolders: [{ title: 'Receipts', notes: 1 }], paths: [] }), 'Moved the folder “Receipts” with 1 note to the Bin');
  assert.equal(S.changeWords({ ...base, binnedFolders: [{ title: 'Empty', notes: 0 }], paths: [] }), 'Moved the folder “Empty” to the Bin');
  assert.equal(S.changeWords({ ...base, changed: 1, paths: ['Notes/Kept.md'], restoredFolders: [{ title: 'Receipts', notes: 5 }] }), 'Changed 1 note, restored the folder “Receipts” with 5 notes');
  assert.equal(S.changeWords({ ...base, restoredFolders: [{ title: 'Receipts', notes: 5 }] }), 'Restored the folder “Receipts” with 5 notes');
  assert.equal(S.changeWords({ ...base, binned: 1, paths: [] }), 'Moved 1 note to the Bin', 'a note still reads as a note');
});

test('a changed list reads through the same core: the one change describer (seams O7)', () => {
  assert.equal(S.describeChangedList([]), 'Nothing changed');
  assert.equal(S.describeChangedList([{ path: 'Notes/A.md', before: null }]), 'Made 1 note');
  assert.equal(
    S.describeChangedList([
      { path: 'Notes/A.md', before: null },
      { path: 'Notes/B.md', before: null },
      { path: 'Notes/C.md', before: 'old words' },
    ]),
    'Made 2 notes, changed 1 note',
  );
  assert.equal(S.describeChangedList([{ path: 'Docs/Plan.md', before: 'old' }]), 'Changed 1 doc');
  assert.equal(S.describeChangedList([{ path: 'Notes/A.md', before: null }]), S.changeWords({ turnId: 't', made: 1, changed: 0, moved: 0, paths: ['Notes/A.md'] }), 'the list entry and the count path are one core');
});

test('only links to the answer’s sources gain a numbered chip', () => {
  const html = '<p>See <a class="internal-link" data-href="Shop" href="#">Shop</a> and <a class="internal-link" data-href="Elsewhere" href="#">Elsewhere</a>.</p>';
  assert.equal(S.citeAnswer(html, ['Shop', 'Mill']), '<p>See <a class="internal-link" data-href="Shop" href="#">Shop</a><i class="cite">1</i> and <a class="internal-link" data-href="Elsewhere" href="#">Elsewhere</a>.</p>');
  const amp = '<p><a class="internal-link" data-href="Salt &amp; Mill" href="#">Salt &amp; Mill</a></p>';
  assert.ok(S.citeAnswer(amp, ['Salt & Mill']).includes('<i class="cite">1</i>'), 'a title with & still matches');
});

test('the panel suggests questions for a project, a note, projects kept, or none yet', () => {
  assert.ok(S.suggestQuestions({ title: 'Shop', type: 'project', hasProjects: true })[0].includes('Shop'), 'the project by name');
  assert.ok(S.suggestQuestions({ title: 'Sync', type: 'meeting', hasProjects: true })[0].includes('Sync'), 'the note by name');
  assert.equal(S.suggestQuestions({ hasProjects: true }).length, 4, 'projects kept');
  assert.equal(S.suggestQuestions({ hasProjects: false })[0], S.ASK_SETUP, 'setting up from a folder first');
  assert.equal(S.shortDate(new Date(2026, 9, 12, 10).getTime()), '12 Oct', 'the short date');
});

test('the search window is the mock-up’s modal: input, filter strip, answer with sources, marked rows', () => {
  const view = read('src/renderer/src/components/SearchView.tsx');
  const modal = read('src/renderer/src/components/SearchModal.tsx');
  for (const cls of ['smodal', 'sin', 'filters', 'aians', 'sres', 'srow2', 'cite', 'srcrow']) assert.ok(view.includes(cls) || modal.includes(cls), cls);
  assert.ok(view.includes('window.nv.ai.chat'), 'the answer comes from the helper’s real model');
  assert.ok(view.includes('Best matches · ${sorted.length}'), 'best matches with the count');
  assert.ok(modal.includes("kind: 'search'") || modal.includes('SearchModal'), 'opened as the search window');
});

test('Best matches keeps no heading when no note matched (9.0 w123ocr round 2: Best matches · 0 sat above the picture results)', () => {
  const view = read('src/renderer/src/components/SearchView.tsx');
  assert.ok(view.includes('sorted.length > 0'), 'the heading shows only with matches');
  assert.ok(view.indexOf('sorted.length > 0') < view.indexOf('Best matches · ${sorted.length}'), 'the guard comes first');
});

test('the last search comes back selected, so typing replaces it (9.0 w123ocr round 2: restored words landed unselected and the next search appended to them — "totalrepairs")', () => {
  const view = read('src/renderer/src/components/SearchView.tsx');
  const at = view.indexOf(`state.load<{ query?: string }>('search')`);
  assert.ok(at > 0, 'the last search is brought back');
  const end = view.indexOf('}, []);', at);
  const sel = view.indexOf('input.current?.select()', at);
  assert.ok(sel > at && sel < end, 'brought-back words are selected');
  assert.ok(view.slice(at, end).includes('if (q) return q'), 'words already typed are left alone');
});

test('nothing today’s search could do is lost in the new search', () => {
  const view = read('src/renderer/src/components/SearchView.tsx');
  for (const kept of ['match-case', 'OPERATORS', 'rememberSearch', 'bookmark', 'setPick', 'libraryToo', 'allCollapsed', 'commandHits', 'useFileHits', 'FileIndexLine', 'useSearchRequest', 'Match capitals', 'ctrlKey']) assert.ok(view.includes(kept), kept);
});

test('the filter strip is the mock-up’s: sort, title, person, project, date, with kind under More', () => {
  const view = read('src/renderer/src/components/SearchView.tsx');
  for (const drop of ["'Sort'", "'Title'", "'Titles only'", "'Person'", "'Project'", "'Date'"]) assert.ok(view.includes(drop), drop);
  assert.ok(view.includes('More search tools') && view.includes('Only one kind'), 'kind and the rest under More');
  assert.ok(view.includes('Best matches · ${sorted.length}'), 'one flat Best matches list with the count');
  assert.ok(!view.includes('grouped'), 'no kind groups in the way');
});

test('titles-only leaves hits whose title holds the query’s plain words', () => {
  const now = Date.now();
  const a = hit('Notes/Cool-room service log.md', [], now);
  const b = hit('Notes/Random.md', [], now);
  const f = { kind: 'all', person: '', project: '', date: 'any', titlesOnly: true };
  assert.deepEqual(S.filterHits([a, b], metaOf, typeOf, f, now, 'cool room service').map((h) => h.path), ['Notes/Cool-room service log.md']);
  assert.deepEqual(S.queryWords('cool "room service" -x OR file:y /p/ match-case:yes'), ['cool', 'room', 'service']);
  assert.deepEqual(S.filterHits([a, b], metaOf, typeOf, S.NO_FILTERS, now, 'cool room').map((h) => h.path), ['Notes/Cool-room service log.md', 'Notes/Random.md'], 'off by default');
});

test('the suggestions read whole: short questions, never clipped mid-sentence', () => {
  assert.ok(S.suggestQuestions({ hasProjects: true }).every((s) => s.length <= 30), 'projects kept');
  assert.ok(S.suggestQuestions({ title: 'Sync', type: 'meeting', hasProjects: true }).slice(1).every((s) => s.length <= 25), 'a note');
  assert.ok(S.suggestQuestions({ title: 'Shop', type: 'project', hasProjects: true }).slice(1).every((s) => s.length <= 25), 'a project');
  const css = read('src/renderer/src/styles.css');
  assert.ok(!/\.chat-suggestion \{[^}]*text-overflow/.test(css), 'no ellipsis clipping the panel chips');
});

test('Ask opens the side chat panel, the one place to ask', () => {
  const chat = read('src/renderer/src/state/chat.ts');
  const fit = read('src/renderer/src/state/fit.ts');
  assert.ok(chat.includes("showSide('right', 'chat')"), 'asking opens the side chat, not a card');
  assert.ok(!chat.includes('openAskFloat'), 'no floating card to open');
  assert.ok(fit.includes("showSide('right', 'chat')"), 'the header and Ctrl+J open the side chat');
  assert.ok(fit.includes('.chat-input textarea'), 'and land in its message box');
  assert.ok(!read('src/renderer/src/views/Workspace.tsx').includes('<AskFloat'), 'no card mounted beside the page');
  assert.ok(chat.includes('draftInChat') && chat.includes("showSide('right', 'chat')"), 'drafts still open the side chat');
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  for (const part of ['Copy', 'Into the note', 'Save as note']) assert.ok(panel.includes(part), part);
});

test('the page is drawn once: one view per group, and the page fills its column', () => {
  const ws = read('src/renderer/src/views/Workspace.tsx');
  assert.equal((ws.match(/<NoteView/g) || []).length, 1, 'one note view mounting');
  const css = read('src/renderer/src/styles.css');
  const page = css.match(/\.pj-page \{[^}]*\}/);
  assert.ok(page && page[0].includes('flex: 1') && !page[0].includes('height: 100%'), 'the project page fills its column without a percentage height');
});

test('the group foot keeps the guard alone: no bar or card keys to share', () => {
  const ws = read('src/renderer/src/views/Workspace.tsx');
  assert.ok(ws.includes('<PageGuard key={tab.id}'), 'the guard stays keyed per tab');
  assert.ok(!ws.includes('<AskBar') && !ws.includes('<AskFloat'), 'no bar or card beside it to share a key');
});

test('one search, one window: no caller docks the left panel beside the centred window', () => {
  const modal = read('src/renderer/src/components/SearchModal.tsx');
  assert.ok(modal.includes('className="overlay"') && modal.includes('smodal sas-modal'), 'the window, centred like the palette');
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) {
        const lines = read(rel).split('\n');
        lines.forEach((ln, i) => {
          if (ln.includes('requestSearch(') && !ln.includes('export function') && !ln.includes('import ') && !ln.includes('requestSearch:')) {
            if (lines.slice(Math.max(0, i - 3), i + 1).join('\n').includes("showSide('left', 'search')")) hits.push(`${rel}:${i + 1}`);
          }
        });
      }
    }
  };
  walk('src/renderer/src');
  assert.deepEqual(hits, [], 'callers ask and open nothing else (the window is the one way in)');
});

test('the palette is joined to the search: pages beside commands, and a way into full search', () => {
  const modals = read('src/renderer/src/components/Modals.tsx');
  const picker = read('src/renderer/src/components/Picker.tsx');
  assert.ok(picker.includes('section'), 'the list groups rows under headings');
  assert.ok(modals.includes("'Pages'") && modals.includes("'Commands'"), 'commands and pages side by side');
  assert.ok(modals.includes('Search inside notes for'), 'typed words jump into the full search');
});

test('the Ask bar is gone; Ask, Find and Do live in the header bar’s panel', () => {
  assert.throws(() => read('src/renderer/src/components/AskBar.tsx'), 'the bar file is deleted');
  assert.ok(!read('src/renderer/src/views/Workspace.tsx').includes('<AskBar'), 'never mounted');
  const modals = read('src/renderer/src/components/Modals.tsx');
  for (const mode of ["'ask'", "'find'", "'do'"]) assert.ok(modals.includes(mode), `the palette keeps ${mode}`);
  // 9.2 uplift F1: Do files through the one A.fileTaskText (which calls capture.save).
  assert.ok(modals.includes('A.fileTaskText('), 'Do files a task the way the bar did');
});

test('every answer shows its sources, and every change shows Undo on its card and in a toast', () => {
  const chat = read('src/renderer/src/panels/ChatPanel.tsx');
  const state = read('src/renderer/src/state/chat.ts');
  assert.ok(chat.includes('From · {m.sources.length}') && chat.includes('srcrow'), 'the From block with source rows');
  assert.ok(chat.includes('Undo') && chat.includes('undoAnswer'), 'Undo on the change card');
  // 9.2 uplift F33/F156: the toast lives in runAnswer now (answerId, same answer).
  assert.ok(state.includes('undoAnswer(answerId)') && state.includes("label: 'Undo'"), 'the toast undoes the same answer');
  assert.ok(chat.includes('nb-chip') && chat.includes('openPassage'), 'cited passages open from the chat');
});

test('the notebook keeps its strict ticked-sources asking inside the new rails', () => {
  const nb = read('src/renderer/src/views/NotebookView.tsx');
  for (const kept of ['.state(', '.choose(', '.ask(', '.make(', 'Only ticked sources are read', 'Sources · {ticked} ticked', 'Make from these sources', 'Made · {outputs.length}']) assert.ok(nb.includes(kept), kept);
  assert.ok(!/deepseek/i.test(nb), 'no DeepSeek model anywhere near the helper');
});

test('the new styles use only the theme tokens, and plain words', () => {
  const css = read('src/renderer/src/styles/search-ask-87.css');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'no hex colours outside the tokens');
  assert.ok(!/creme|cream|beige/i.test(css), 'no cream anywhere');
  for (const f of ['src/renderer/src/components/SearchView.tsx', 'src/renderer/src/components/SearchModal.tsx', 'src/renderer/src/panels/ChatPanel.tsx', 'src/renderer/src/views/NotebookView.tsx', 'src/shared/search-ask-87.ts']) assert.ok(!/deepseek|pi-ai/i.test(read(f)), `no engine names in ${f}`);
});
