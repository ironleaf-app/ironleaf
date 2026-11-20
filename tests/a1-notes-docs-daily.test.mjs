// node --test tests/a1-notes-docs-daily.test.mjs — a1 (6 Nov 2026): Docs and Daily
// notes are the person's own notes, shown on the Notes page without asking for
// Show everything. Docs/ and Daily/ are store folders (fewer-folders.ts), hidden
// as machinery from the file tree, but the Notes page offers Docs and Daily tabs
// and folders: with docs and daily notes in the vault, those tabs show their
// counts and their lists, and All includes them. Before: rows excluded every
// machinery path, so Docs showed 0 and an empty "Nothing matches" despite docs
// on disk (seen with Harbour Lane Coffee Co. heavy data: 8 docs, Docs tab empty).
// Each check fails without the fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Static: the mechanism ────────────────────────────────────────────────────
// Notes rows keep docs and daily notes even though their folders are machinery
// (store folders, hidden from the tree). Templates, Assets and the rest stay
// behind Show everything; only the person's docs and dailies join the list.
test('notes rows keep docs and dailies out of the machinery hiding', () => {
  const src = read('src/renderer/src/views/NotesPage.tsx');
  // The rows memo reads the one shared rule (one window, 9 Nov 2026: the one side bar counts by it too, so the
  // bar and the page never disagree); the rule lets docs and dailies through and hides anything else machinery.
  // kindCount already names the kinds for counting — this pins the hiding filter itself.
  const rowsMemo = src.slice(src.indexOf('const rows = useMemo'), src.indexOf('const hiddenCount'));
  assert.ok(rowsMemo.includes('notesPageKeepsPath'), 'the rows read the shared rule');
  const shared = read('src/shared/notes-list.ts');
  const rule = shared.slice(shared.indexOf('export function notesPageKeepsPath'), shared.indexOf('export function countsOnNotes'));
  assert.ok(rule.includes('isMachineryPath'), 'machinery still hides the rest');
  assert.ok(rule.includes("'doc'") && rule.includes("'daily'"), 'rows keep the doc and daily kinds out of the hiding');
  // The hidden count agrees (docs and dailies no longer counted as hidden).
  const hidden = src.slice(src.indexOf('const hiddenCount'), src.indexOf('const recordCount'));
  assert.ok(hidden.includes('notesPageKeepsPath'), 'hidden count reads the same rule');
});

test('docs and daily are the person’s kinds, never records', () => {
  // notes-yours already proves doc/daily are not record types; this pins the
  // Notes page reading the same kinds (noteKindOf), so the fix cannot drift.
  const shared = read('src/shared/notes-list.ts');
  assert.ok(shared.includes("if (note.typeId === 'doc'") && shared.includes("return 'doc'"), 'docs by type');
  assert.ok(shared.includes("return 'daily'"), 'dailies by type or folder');
});

// ── Live: one doc and one daily note show without Show everything ────────────
let H = null;
async function harness() {
  if (!H) {
    H = await startHarness();
    await H.services.vault.createText('Docs/Harbour runbook.md', `---\ntype: doc\n---\n# Harbour runbook\n\nHow to close.\n`).catch(() => {});
    await H.services.vault.createText('Daily/2026-11-05.md', `# 5 November 2026\n\n- [ ] Water the plants\n`).catch(() => {});
    await H.services.rescan('Docs/Harbour runbook.md');
    await H.services.rescan('Daily/2026-11-05.md');
    await H.services.rescanAll();
    await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try { if (await H.browser.ev(`!!document.querySelector('.app')`)) break; } catch {}
    }
    await sleep(2000);
  }
  return H;
}
after(async () => { await H?.close().catch(() => {}); H = null; });

const SEL = 'button, a[href], select, input, textarea, [role="button"], [role="tab"], [role="menuitem"], summary';
async function clickWords(h, words, scope = '') {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'CLICKED';
  })()`);
}

test('docs show under Docs without Show everything', { timeout: 300000 }, async () => {
  const h = await harness();
  await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  assert.equal(await clickWords(h, 'Notes', '.sidebar.left, aside'), 'CLICKED', 'Notes opens from the rail');
  await sleep(1500);
  // Docs tab carries a count (before: no count, docs hidden).
  const docsTab = await h.browser.ev(`(() => {
    const tabs = [...document.querySelectorAll('main button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 10 && r.height > 10; });
    const docs = tabs.find((e) => e.innerText.replace(/\\s+/g, ' ').startsWith('Docs'));
    return docs ? docs.innerText.replace(/\\s+/g, ' ') : null;
  })()`);
  assert.ok(docsTab && /\d/.test(docsTab), `Docs tab counts the docs (saw ${JSON.stringify(docsTab)})`);
  assert.equal(await clickWords(h, 'Docs', 'main'), 'CLICKED', 'Docs filter opens');
  await sleep(1000);
  const list = await h.browser.ev(`(() => {
    const rows = [...document.querySelectorAll('main .w2b-row')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 10; });
    const empty = document.querySelector('main')?.innerText.includes('Nothing matches');
    return { rows: rows.length, empty: !!empty, text: (document.querySelector('main')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 150) };
  })()`);
  assert.equal(list.empty, false, `Docs lists the docs, not "Nothing matches" (${list.text})`);
  assert.ok(list.rows >= 1, `at least one doc row shows (saw ${list.rows})`);
});
