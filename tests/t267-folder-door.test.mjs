// node --test tests/t267-folder-door.test.mjs — nothing lost in the tabs (t267, 13 Nov 2026): a
// project's PC folder, and every old Add. t255 turned the project page into tabs; the foot line went
// with it, and a project with no folder on this PC lost its Choose: the Notes and files tab offered no
// way to link one, and the ⋯ menu only offered Change once one was chosen. The door is back where a
// person looks for it — the tab's head, its quiet state, the ⋯ menu beside Open/Change — through the
// one picker, and every old Add reads in one or two clicks. Made-up vault only. Fails without each change.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const tabs = () => read('src/renderer/src/views/project/ProjectTabs87.tsx');
const page = () => read('src/renderer/src/views/ProjectPage.tsx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: the door stands where a person looks ────────────────────────

test('the Notes and files head offers Choose its folder when none is linked', () => {
  const t = tabs();
  assert.ok(t.includes('Choose its folder on this PC…'), 'the head names the door in plain words');
  const head = t.slice(t.indexOf('title="Notes and files"'), t.indexOf('title="Notes and files"') + 1400);
  assert.ok(head.includes('Choose its folder on this PC…'), 'in the Notes and files head, beside Add note and Attach');
  assert.ok(head.includes('chooseProjectFolder(ctx)'), 'through the one shared call, never a second picker');
  assert.ok(t.includes('export function needsFolderChoice'), 'one rule for when the door stands open');
  const rule = t.slice(t.indexOf('export function needsFolderChoice'), t.indexOf('export function needsFolderChoice') + 800);
  assert.ok(rule.includes("'without'") && rule.includes('remote') && rule.includes('!f.exists'), 'not once this PC works without one, never for a remote project, never while reading');
  assert.ok(head.includes('needsFolderChoice(ctx)'), 'the head asks the one rule');
  assert.ok(read('src/renderer/src/styles/w2a.css').includes('.pj-folio-head .btn ~ .btn'), 'two head buttons group at the right, never split across the row');
});

test('the quiet Notes tab offers Choose its folder beside Add a note', () => {
  const p = page();
  const at = p.indexOf('function TabEmpty');
  assert.ok(at > 0, 'the quiet panel exists');
  const body = p.slice(at, at + 2600);
  assert.ok(body.includes("id === 'notes'") && body.includes('Choose its folder on this PC…'), 'the quiet Notes tab names the door');
  assert.ok(body.includes('chooseProjectFolder(ctx)'), 'through the one shared call');
  assert.ok(body.includes('needsFolderChoice(ctx)'), 'only when no folder is linked');
});

test('the ⋯ menu offers Choose beside Open the folder and Change its folder', () => {
  const p = page();
  const at = p.indexOf('const projectSub');
  assert.ok(at > 0, 'the Project submenu exists');
  const body = p.slice(at, at + 2200);
  const open = body.indexOf('Open the folder');
  const choose = body.indexOf('Choose its folder on this PC…');
  const change = body.indexOf('Change its folder on this PC…');
  assert.ok(open > 0 && choose > 0 && change > 0, 'all three folder doors read in the submenu');
  assert.ok(open < choose && choose < change, 'Choose sits between Open and Change');
  assert.ok(body.includes('chooseFolderHere(path, onFolderHere)'), 'through the FolderHere action, so the page takes the new view');
});

test('one picker: every folder door routes through the shared calls', () => {
  const t = tabs();
  const calls = [...t.matchAll(/\.folderHere\(/g)].length;
  assert.equal(calls, 1, `one folderHere call in the folio (${calls}): chooseProjectFolder's`);
  assert.ok(t.includes("export function chooseProjectFolder(ctx: TabsCtx)"), 'chooseProjectFolder stays the one call');
  assert.ok(read('src/renderer/src/views/project/FolderHere.tsx').includes('export const chooseFolderHere'), 'the menu shares the FolderHere action');
  assert.ok(!t.includes('showOpenDialog') && !page().includes('showOpenDialog'), 'no second picker in the renderer');
});

test('every old Add has a home in the tabs, one or two clicks away', () => {
  // The foot line's ten starters on 10.2.6 (467f29c1a), now in the tabs: each keeps its starter for
  // the quiet tab and its head action (or inline row) once something is there. Files split back into
  // its two doors: Attach for a file, Choose for the folder.
  const t = tabs();
  const starters = [
    ['whats-next', 'task', 'a step'],
    ['key-dates', 'key date', 'a milestone'],
    ['decisions', 'decision', 'a decision'],
    ['risks', 'risk', 'a risk'],
    ['people', 'person', 'a person'],
    ['money', 'bill', 'a bill'],
    ['notes', 'note', 'a note'],
  ];
  for (const [id, noun, what] of starters) assert.ok(t.includes(`{ id: '${id}', noun: '${noun}'`), `${what} keeps its quiet-tab starter (${id})`);
  const heads = [
    ['Add task', 'a step'],
    ['Milestone', 'a milestone'],
    ['Log decision', 'a decision'],
    ['Add a risk…', 'a risk'],
    ['Add person', 'a person'],
    ['New bill', 'a bill'],
    ['> Attach<', 'a file'],
    ['Choose its folder on this PC…', 'the folder'],
    ['Add note', 'a note'],
  ];
  for (const [words, what] of heads) assert.ok(t.includes(words) || page().includes(words), `${what} keeps its head action (${words})`);
  const start = t.slice(t.indexOf('export function startSection'), t.indexOf('export function startSection') + 1500);
  for (const id of ['whats-next', 'key-dates', 'people', 'decisions', 'risks', 'updates', 'money', 'notes']) assert.ok(start.includes(`case '${id}':`), `${id} starts straight from its tab`);
});

test('the dead foot is gone; the brand-new start stays', () => {
  const t = tabs();
  assert.ok(!t.includes('FolioFoot'), 'FolioFoot is gone: nothing rendered it since the tabs');
  assert.ok(!t.includes('data-folio-foot'), 'its marker with it');
  assert.ok(t.includes('FolioEmpty') && t.includes('data-folio-empty'), 'the brand-new start stays');
  const css = read('src/renderer/src/styles/w2a.css');
  assert.ok(!css.includes('.pj-folionav'), 'the dead section-line rules are gone');
  assert.ok(!css.includes('.pj-addline'), 'the dead foot-line rules are gone');
  assert.ok(css.includes('.pj-start'), 'the start keeps its card');
});

// ── Live: no folder, then Choose, then the files list ───────────────────

const esc = async (h) => {
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(500);
};

test('live: Choose from the menu, the head and the quiet tab lists the files at once', async () => {
  const { startHarness } = await import('./vault-controls-harness.mjs');
  const h = await startHarness();
  try {
    const clickWords = (words, scope = '') => h.browser.ev(`(async () => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
      const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
      if (!root) return 'NOROOT';
      const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter(vis);
      const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
      if (!el) return 'NOTFOUND';
      el.scrollIntoView({ block: 'nearest' }); el.click();
      await new Promise((r) => setTimeout(r, 600));
      return 'CLICKED';
    })()`);
    const openTab = async (id) => {
      await h.browser.ev(`document.querySelector('[data-tab="${id}"]')?.click()`);
      await sleep(1000);
    };
    const boot = async () => {
      for (let i = 0; i < 90; i++) {
        await sleep(500);
        try {
          if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
        } catch {}
      }
      await sleep(1500);
    };
    // The OS picker, stubbed at the page's RPC layer (the harness has no folder-here handler: the
    // choice is answered with a made-up path, the view read back through the real channel, and the
    // folder's listing served from there on — the page's own calls, nothing else doubled).
    const stubPicker = () => h.browser.ev(`(() => {
      if (window.__t267) return 'kept';
      window.__t267 = { folders: {} };
      const orig = window.fetch.bind(window);
      window.fetch = async (url, opts) => {
        let body = null;
        try { body = JSON.parse(opts?.body ?? 'null'); } catch {}
        if (body && body.channel === 'project:folder-here' && (body.args ?? [])[1] === 'choose') {
          const rel = body.args[0];
          const folder = ${JSON.stringify(path.join(h.vaultDir, 'PC folders'))} + '/' + rel.split('/').pop().replace(/\\.md$/i, '');
          window.__t267.folders[rel] = folder;
          const v = await orig(url, { ...opts, body: JSON.stringify({ channel: 'project:view', args: [rel] }) }).then((r) => r.json());
          const name = v?.result?.project?.name ?? 'The project';
          return new Response(JSON.stringify({ ok: true, result: { view: v.result, words: \`On this PC, \${name} uses \${folder}.\` } }), { headers: { 'content-type': 'application/json' } });
        }
        if (body && body.channel === 'project:files' && window.__t267.folders[body.args?.[0]]) {
          const folder = window.__t267.folders[body.args[0]];
          const now = Date.now();
          return new Response(JSON.stringify({ ok: true, result: { folder, exists: true, groups: [{ name: '', files: [{ rel: 'Counter sketch.pdf', name: 'Counter sketch.pdf', ext: 'pdf', size: 18400, modified: now - 86400000 }] }, { name: 'Quotes', files: [{ rel: 'Quotes/Tile quote.xlsx', name: 'Tile quote.xlsx', ext: 'xlsx', size: 9200, modified: now - 3600000 }] }], total: 2, more: 0 } }), { headers: { 'content-type': 'application/json' } });
        }
        return orig(url, opts);
      };
      return 'stubbed';
    })()`);
    const filesList = () => h.browser.ev(`[...document.querySelectorAll('#pj-panel-notes [data-item-card="files"] .trow')].map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim()).join(' | ')`);

    await boot();
    // Two more projects with no folder: one holding a note (its tab populated), one bare (its tab quiet).
    writeFileSync(path.join(h.vaultDir, 'Projects', 'Fitting Notes.md'), '---\ntype: project\nstatus: active\n---\n# Fitting Notes\n\n## Notes\n\nThe fitting in short.\n');
    const bareDir = path.join(h.vaultDir, 'Projects', 'Bare Block');
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(path.join(bareDir, 'Bare Block.md'), '---\ntype: project\n---\n# Bare Block\n');
    await h.services.rescanAll();
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
    await boot();
    assert.equal(await stubPicker(), 'stubbed', 'the picker answers with a made-up folder');

    const openProject = async (name) => {
      assert.equal(await clickWords('Projects'), 'CLICKED', 'Projects opens');
      await sleep(800);
      assert.equal(await clickWords(name, 'main'), 'CLICKED', `${name} opens`);
      await sleep(2200);
    };

    // 1. The ⋯ menu's door: Harbourline (no folder) offers Choose beside Open/Change's place, and
    // choosing lists the folder's files in the tab at once.
    await openProject('Harbourline Cart Fix');
    await openTab('notes');
    assert.equal(await clickWords('More', '.topbar'), 'CLICKED', 'the ⋯ menu opens');
    await sleep(400);
    assert.equal(await clickWords('Project', '.menu'), 'CLICKED', 'the Project submenu opens');
    await sleep(400);
    const submenu = await h.browser.ev(`[...document.querySelectorAll('.menu')].map((m) => m.innerText.replace(/\\s+/g, ' ').trim()).join(' / ')`);
    assert.ok(submenu.includes('Choose its folder on this PC…'), `the submenu offers Choose (${submenu.slice(0, 160)})`);
    assert.equal(await clickWords('Choose its folder on this PC…'), 'CLICKED', 'menu Choose answers');
    await sleep(1800);
    await openTab('notes');
    const menuFiles = await filesList();
    assert.ok(menuFiles.includes('Counter sketch.pdf') && menuFiles.includes('Tile quote.xlsx'), `the folder's files list at once (${menuFiles.slice(0, 120)})`);

    // 2. The head's door: Fitting Notes (a note, no folder) offers Choose in its head next to Add note.
    await openProject('Fitting Notes');
    await openTab('notes');
    const head = await h.browser.ev(`document.querySelector('#pj-panel-notes [data-section="notes"] .pj-folio-head')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`);
    assert.ok(head.includes('Add note') && head.includes('Choose its folder on this PC…'), `the head offers Add note and Choose (${head})`);
    assert.equal(await clickWords('Choose its folder on this PC…', '#pj-panel-notes'), 'CLICKED', 'head Choose answers');
    await sleep(1800);
    const headFiles = await filesList();
    assert.ok(headFiles.includes('Counter sketch.pdf') && headFiles.includes('Tile quote.xlsx'), `the folder's files list at once (${headFiles.slice(0, 120)})`);
    const headAfter = await h.browser.ev(`document.querySelector('#pj-panel-notes [data-section="notes"] .pj-folio-head')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`);
    assert.ok(headAfter.includes('Attach') && !headAfter.includes('Choose its folder'), `Choose gives way to Attach (${headAfter})`);

    // 3. The quiet tab's door: Bare Block (nothing, no folder) offers Choose beside Add a note, and
    // choosing flips the tab to the files list.
    await openProject('Bare Block');
    await openTab('notes');
    const quiet = await h.browser.ev(`document.querySelector('#pj-panel-notes [data-section="notes"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`);
    assert.ok(quiet.includes('No notes or files yet.') && quiet.includes('Add a note') && quiet.includes('Choose its folder on this PC…'), `the quiet tab offers Add a note and Choose (${quiet.slice(0, 160)})`);
    assert.equal(await clickWords('Choose its folder on this PC…', '#pj-panel-notes'), 'CLICKED', 'quiet Choose answers');
    await sleep(1800);
    const quietFiles = await filesList();
    assert.ok(quietFiles.includes('Counter sketch.pdf') && quietFiles.includes('Tile quote.xlsx'), `the folder's files list at once (${quietFiles.slice(0, 120)})`);
  } finally {
    await h.close().catch(() => {});
  }
}, { timeout: 420000 });

test('live: every old Add answers from its tab', async () => {
  const { startHarness } = await import('./vault-controls-harness.mjs');
  const h = await startHarness();
  try {
    const clickWords = (words, scope = '') => h.browser.ev(`(async () => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
      const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
      if (!root) return 'NOROOT';
      const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter(vis);
      const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
      if (!el) return 'NOTFOUND';
      el.scrollIntoView({ block: 'nearest' }); el.click();
      await new Promise((r) => setTimeout(r, 600));
      return 'CLICKED';
    })()`);
    const openTab = async (id) => {
      await h.browser.ev(`document.querySelector('[data-tab="${id}"]')?.click()`);
      await sleep(1000);
    };
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(1500);
    const bareDir = path.join(h.vaultDir, 'Projects', 'Bare Block');
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(path.join(bareDir, 'Bare Block.md'), '---\ntype: project\n---\n# Bare Block\n');
    await h.services.rescanAll();
    await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(1500);
    assert.equal(await clickWords('Projects'), 'CLICKED', 'Projects opens');
    await sleep(800);
    assert.equal(await clickWords('Bare Block', 'main'), 'CLICKED', 'the bare project opens');
    await sleep(2200);
    // Each quiet tab's Add lands where it says: a prompt dialog (dismissed), the note menu, the
    // record form, or the Send call for a chat.
    const promptAdds = [
      ['whats-next', 'Add a task', 'Add a step'],
      ['key-dates', 'Add a key date', 'Add a milestone'],
      ['people', 'Add a person', 'Add a person'],
      ['decisions', 'Log a decision', 'Log a decision'],
      ['risks', 'Add a risk', 'Add a risk'],
      ['updates', 'Add an update', 'Add an update'],
    ];
    for (const [tab, button, title] of promptAdds) {
      await openTab(tab);
      assert.equal(await clickWords(button, `#pj-panel-${tab}`), 'CLICKED', `${tab}: ${button} answers`);
      await sleep(500);
      const dialog = await h.browser.ev(`document.querySelector('[role="dialog"] h2')?.innerText.trim() ?? ''`);
      assert.equal(dialog, title, `${tab}: the ${title} prompt opens`);
      assert.equal(await clickWords('Cancel'), 'CLICKED', `${tab}: the prompt dismisses`);
      await sleep(400);
    }
    await openTab('notes');
    assert.equal(await clickWords('Add a note', '#pj-panel-notes'), 'CLICKED', 'notes: Add a note answers');
    await sleep(500);
    const menu = await h.browser.ev(`document.querySelector('.menu')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`);
    assert.ok(menu.includes('Blank note') || menu.includes('New note in'), `notes: the template menu opens (${menu.slice(0, 100)})`);
    await esc(h);
    await openTab('money');
    assert.equal(await clickWords('Add a bill', '#pj-panel-money'), 'CLICKED', 'money: Add a bill answers');
    await sleep(1200);
    assert.ok(await h.browser.ev(`!!document.querySelector('.dialog.rf-dialog')`), 'money: the bill form opens (bills switch on first)');
    await esc(h);
    await sleep(400);
    await openTab('overview');
  } finally {
    await h.close().catch(() => {});
  }
}, { timeout: 420000 });
