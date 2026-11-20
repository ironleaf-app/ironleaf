// node --test tests/t266-break.test.mjs — break the Vault in 10.2.7 (t266, 13 Nov 2026): what a real
// person trips over in the new tabs and Find, each fixed at its mechanism. The rooms forgot the Find's words
// on leaving or opening a row, and Meetings forgot its chip; a tab's Find stood stale while its list changed
// under it and counted group heads as rows; quiet titles, count badges and the Find's count fell below 4.5:1
// in the light looks; a full Waiting tab offered no Add; a rename from the Projects home orphaned the
// remembered tab. One boot on the t262 rich vault plus a 120-step project; made-up words only. Each live test
// fails without its fix (observed on the unfixed tree while breaking it).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { clickWords, esc, openRoom, sleep, waitFor } from './t152-lib.mjs';
import { startHarness } from './vault-controls-harness.mjs';
import { seedT262Vault } from './t262-seed.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const D = (off) => iso(new Date(Date.now() + off * 864e5));
const BIG = 'Projects/Harbour Festival Build/Harbour Festival Build.md';
const PEOPLE = ['Alex Chen', 'Bettina Maddox', 'Darcy Lin', 'Priya Nair', 'June Park', 'Tom Bradley'];

// ── Static: each fix written once, at its mechanism ──────────────────────────

test('one Find memory: every room Find stands as left, Tasks keeps its own', () => {
  const bar = read('src/renderer/src/components/PageTabs.tsx');
  assert.equal(bar.indexOf('export function useFindMemory'), bar.lastIndexOf('export function useFindMemory'), 'the memory is written once');
  assert.ok(bar.includes('nv-find-${key}'), 'one key per room, capped like Tasks');
  for (const [f, key] of [
    ['src/renderer/src/views/modules/work/MeetingsPage.tsx', "useFindMemory('meetings')"],
    ['src/renderer/src/views/InboxPage.tsx', "useFindMemory('inbox')"],
    ['src/renderer/src/views/NotesPage.tsx', "useFindMemory('notes')"],
    ['src/renderer/src/views/PeoplePage.tsx', "useFindMemory('people')"],
  ]) {
    const t = read(f);
    assert.ok(t.includes('useFindMemory } from') || t.includes('useFindMemory,'), `${f} walks through the shared memory`);
    assert.ok(t.includes(key), `${f} remembers under its own key`);
  }
  assert.ok(read('src/renderer/src/views/TasksView.tsx').includes('nv-tasks-filter'), 'Tasks keeps its own filter memory, untouched');
  const meet = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(meet.includes("useFindMemory('meetings-chip', 'upcoming')"), 'a fresh visit lands on the chip as left');
  assert.ok(meet.includes("!chipHere || chipHere === 'overview'"), 'the bare list home carries no chip choice, so memory answers');
  assert.ok(meet.includes('listed ? chipFor(chipWas) : chipFor(chipHere)'), 'history still wins over memory');
});

test('a tab Find refilters as its rows change, and counts rows, never group heads', () => {
  const bar = read('src/renderer/src/components/PageTabs.tsx');
  assert.ok(bar.includes('new MutationObserver(pass)'), 'rows arriving and leaving refilter under standing words');
  assert.ok(bar.includes('if (q.trim()) setShown(true)'), 'standing words stand the box, even over a short list');
  assert.equal(bar.split('.trow:not([data-find-skip])').length - 1, 2, 'the latch and the filter both skip group heads');
  const t = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.equal(t.split('data-find-skip').length - 1, 3, 'the waiting, meeting-day and money heads are marked context');
});

test('tab ink reads in every look: theme tokens, muted never faint', () => {
  const css = read('src/renderer/src/styles/page-tabs.css');
  assert.ok(!css.includes('--text-faint'), 'no faint ink left on tabs or the Find');
  assert.ok(css.includes('.pt-tab.is-quiet { color: var(--text-muted); }'), 'quiet titles read muted');
  assert.ok(css.includes('.pt-tab .pt-count { margin-left: 6px; font-weight: 400; color: var(--text-muted); }'), 'count badges read muted');
  assert.ok(css.includes('.pt-find-n { font-size: var(--fs-small); color: var(--text-muted);'), 'the Find count reads muted');
  assert.ok(!css.includes(':has(') && !css.includes('!important'), 'no :has(), no !important');
});

test('every tab carries its own Add: the full Waiting tab too', () => {
  const t = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const sec = t.slice(t.indexOf('export function WaitingSection'), t.indexOf('export function WaitingSection') + 900);
  assert.ok(sec.includes("startSection('waiting', ctx, edit"), 'the head action is the empty tab’s same starter');
  assert.ok(sec.includes('Add a step for someone else'), 'in the same words');
});

test('a rename from anywhere moves the remembered tab with the project', () => {
  const app = read('src/renderer/src/App.tsx');
  const loop = app.slice(app.indexOf('if (moves?.length)'), app.indexOf('if (moves?.length)') + 700);
  assert.ok(loop.includes('moveProjectMemory(from, to)'), 'the global moves loop carries the memory');
  assert.ok(read('src/renderer/src/views/ProjectPage.tsx').includes('moveProjectMemory(from, to)'), 'the page’s own renames still move it');
});

// ── Live: one boot ───────────────────────────────────────────────────────────

let H = null;
before(async () => {
  H = await startHarness({});
  await H.services.invoke('settings:update', [{ prefs: { modules: Object.fromEntries(['meetings', 'finance', 'health', 'goals', 'systems', 'sites', 'house', 'travel'].map((id) => [id, { on: true }])), statusLine: true } }]);
  seedT262Vault(H.vaultDir, D);
  const w = (rel, text) => {
    const p = path.join(H.vaultDir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  // 120 steps across six people: 20 of mine, 100 with five others under five group heads.
  w(BIG, `---\ntype: project\nstatus: active\nowner: Alex Chen\ndue: ${D(14)}\n---\n# Harbour Festival Build\n\n## Summary\n\nThe build.\n\n## What's next\n\n${Array.from({ length: 120 }, (_, i) => `- [ ] Festival job number ${i + 1} — ${PEOPLE[i % PEOPLE.length]} — due ${D(i % 5)}`).join('\n')}\n\n## People\n\n${PEOPLE.map((n) => `- ${n}`).join('\n')}\n`);
  await H.services.rescanAll();
  await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
  assert.ok(await waitFor(H, `!!document.querySelector('.app')`, 45000), 'the app boots');
  await sleep(2500);
  await H.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 1, mobile: false });
}, { timeout: 600000 });
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

const chip = () => H.browser.ev(`document.querySelector('main .w2b-chips [aria-selected="true"]')?.innerText`);
const count = () => H.browser.ev(`document.querySelector('main .pt-find-n')?.innerText ?? null`);
const words = () => H.browser.ev(`document.querySelector('main input[aria-label="Find in this list"]')?.value ?? 'NOBOX'`);
async function pickChip(label) {
  assert.equal(await clickWords(H, label, 'main'), 'CLICKED', `${label} opens`);
  await sleep(1000);
}
async function type(q) {
  await H.browser.ev(`document.querySelector('main input[aria-label="Find in this list"]')?.focus()`);
  await H.browser.send('Input.insertText', { text: q });
  await sleep(800);
}
const panelCount = () => H.browser.ev(`[...document.querySelectorAll('[role="tabpanel"]')].find((el) => el.getClientRects().length > 0)?.querySelector('.pt-find-n')?.innerText ?? null`);
async function typePanel(q) {
  const r = await H.browser.ev(`(() => { const panel = [...document.querySelectorAll('[role="tabpanel"]')].find((el) => el.getClientRects().length > 0); const box = panel?.querySelector('input[aria-label="Find in this list"]'); if (!box) return 'NOBOX'; box.focus(); return 'FOCUSED'; })()`);
  assert.equal(r, 'FOCUSED', 'the open tab earned its Find');
  await H.browser.send('Input.insertText', { text: q });
  await sleep(800);
}
async function openProject() {
  await openRoom(H, 'Projects');
  assert.equal(await clickWords(H, 'Harbour Festival Build', 'main'), 'CLICKED', 'the project opens');
  assert.ok(await waitFor(H, `!!document.querySelector('.pj-page')`, 15000), 'the page lands');
  await sleep(1800);
}
async function openTab(id) {
  await H.browser.ev(`document.querySelector('[data-tab="${id}"]')?.click()`);
  await sleep(900);
}

test('Meetings stands as left: chip, words and count survive leaving the room', { timeout: 300000 }, async () => {
  await openRoom(H, 'Meetings');
  assert.ok(await waitFor(H, `document.querySelectorAll('main .trow').length > 5`, 15000), 'meetings lands');
  await pickChip('Past');
  await type('marquee');
  assert.equal(await count(), '3 of 61', 'narrowed first');
  await openRoom(H, 'Today');
  await sleep(900);
  await openRoom(H, 'Meetings');
  await sleep(1200);
  assert.equal(await chip(), 'Past', 'the chip stands as left');
  assert.equal(await words(), 'marquee', 'the words stand as left');
  assert.equal(await count(), '3 of 61', 'the count stands with them');
});

test('Meetings words survive opening a row and coming Back', { timeout: 300000 }, async () => {
  await pickChip('Every action');
  assert.equal(await words(), 'marquee', 'the words stand across chips');
  assert.equal(await count(), '11 of 212', 'counted for the open chip');
  await H.browser.ev(`document.querySelector('main tr.ws-tr .ws-cell button, main tr.ws-tr a, main tr.ws-tr')?.click()`);
  assert.ok(await waitFor(H, `!document.querySelector('main .w2b-chips')`, 10000), 'a row opens away from the list');
  await H.browser.ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
  assert.ok(await waitFor(H, `!!document.querySelector('main .w2b-chips')`, 10000), 'Back returns to the list');
  await sleep(600);
  assert.equal(await chip(), 'Every action', 'Back returns to the chip');
  assert.equal(await words(), 'marquee', 'with the words still standing');
  assert.equal(await count(), '11 of 212', 'and its count');
});

test('the Inbox, Notes and People stand as left too', { timeout: 300000 }, async () => {
  await openRoom(H, 'Inbox');
  assert.ok(await waitFor(H, `!!document.querySelector('main input[aria-label="Find in this list"]')`, 8000), 'the inbox earns its Find');
  await type('harbour');
  assert.equal(await count(), '4 of 47', 'narrowed first');
  await openRoom(H, 'Today');
  await sleep(900);
  await openRoom(H, 'Inbox');
  await sleep(1200);
  assert.equal(await words(), 'harbour', 'inbox words stand');
  assert.equal(await count(), '4 of 47', 'inbox count stands');
  await esc(H);
  await sleep(500);
  await openRoom(H, 'Notes');
  await sleep(1200);
  await type('sourdough');
  await openRoom(H, 'Today');
  await sleep(900);
  await openRoom(H, 'Notes');
  await sleep(1200);
  assert.equal(await words(), 'sourdough', 'notes words stand');
  assert.match((await count()) ?? '', /^1 of \d+$/, 'still narrowing to its row');
  await esc(H);
  await sleep(500);
  await openRoom(H, 'People');
  await sleep(1200);
  await type('maddox');
  assert.equal(await count(), '1 of 12', 'narrowed first');
  await openRoom(H, 'Today');
  await sleep(900);
  await openRoom(H, 'People');
  await sleep(1200);
  assert.equal(await words(), 'maddox', 'people words stand');
  assert.equal(await count(), '1 of 12', 'people count stands');
  await esc(H);
  await sleep(500);
});

test('a meeting saved in the background joins the standing Find', { timeout: 300000 }, async () => {
  await openRoom(H, 'Meetings');
  await sleep(1200);
  await pickChip('Past');
  assert.equal(await words(), 'marquee', 'the words stand from before');
  assert.equal(await count(), '3 of 61', 'before the background save');
  const p = path.join(H.vaultDir, 'Meetings', `${D(-5)} Marquee finale review.md`);
  writeFileSync(p, `---\ntype: meeting\ndate: ${D(-5)}\nattendees: [Alex Chen, Bettina Maddox]\nproject: Festival Build\n---\n# Marquee finale review\n\n## Agenda\n\n- The stalls and the power walk\n`);
  await H.services.rescanAll();
  await sleep(1200);
  await openRoom(H, 'Today');
  await sleep(900);
  await openRoom(H, 'Meetings');
  await sleep(1200);
  assert.equal(await chip(), 'Past', 'still on the chip as left');
  assert.equal(await words(), 'marquee', 'the words stand across the revisit');
  assert.equal(await count(), '4 of 62', 'the new row joins, counted');
  await esc(H);
  await sleep(500);
});

test('a fresh chip pick lands without pushing: Back returns past the list', { timeout: 300000 }, async () => {
  await openRoom(H, 'Today');
  await sleep(900);
  await openRoom(H, 'Meetings');
  await sleep(1200);
  await pickChip('Past');
  assert.ok(await waitFor(H, `!!document.querySelector('main .trow')`, 10000), 'Past lists its meetings');
  await H.browser.ev(`document.querySelector('main .trow')?.click()`);
  assert.ok(await waitFor(H, `!document.querySelector('main .w2b-chips')`, 10000), 'a meeting opens');
  await H.browser.ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
  await sleep(900);
  await H.browser.ev(`document.querySelector('button[aria-label="Back"]')?.click()`);
  assert.ok(await waitFor(H, `document.title.toLowerCase().includes('today')`, 15000), 'Back twice returns past the list to Today');
});

test('a tab Find counts rows, never group heads: the badge equals its M', { timeout: 300000 }, async () => {
  await openProject();
  await openTab('waiting');
  const badge = await H.browser.ev(`document.querySelector('[data-tab="waiting"] .pt-count')?.innerText ?? null`);
  assert.equal(badge, '100', '100 wait with five others');
  await typePanel('job');
  assert.equal(await panelCount(), '100', 'M is the rows, not rows plus five heads: all 100 match, like the badge');
  await esc(H);
  await sleep(500);
});

test('ticking a row under a standing Find recounts at once', { timeout: 300000 }, async () => {
  await typePanel('job number 119');
  assert.equal(await panelCount(), '1 of 100', 'narrowed to its row');
  const ticked = await H.browser.ev(`(() => { const panel = [...document.querySelectorAll('[role="tabpanel"]')].find((el) => el.getClientRects().length > 0); const row = [...panel.querySelectorAll('.trow:not([data-find-skip])')].find((r) => r.style.display !== 'none'); const b = row?.querySelector('input[type="checkbox"], button[aria-label*="ick" i], button.tick, .tick'); if (!b) return 'NOTICK'; b.click(); return 'CLICKED:' + (row.innerText || '').slice(0, 40); })()`);
  assert.match(ticked, /^CLICKED:Stress job number 119|CLICKED:Festival job number 119/, `the shown row ticks (${ticked})`);
  assert.ok(await waitFor(H, `[...document.querySelectorAll('[role="tabpanel"]')].find((el) => el.getClientRects().length > 0)?.querySelector('.pt-find-n')?.innerText === '0 of 99'`, 10000), 'the count recounts without retyping');
  await esc(H);
  await sleep(500);
});

test('a full Waiting tab carries its Add, and the added row lands in the standing Find', { timeout: 300000 }, async () => {
  await typePanel('zzbrandnew');
  assert.equal(await panelCount(), '0 of 99', 'nothing matches yet');
  const added = await H.browser.ev(`(() => { const panel = [...document.querySelectorAll('[role="tabpanel"]')].find((el) => el.getClientRects().length > 0); const b = [...(panel ?? document).querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Add a step for someone else'); if (!b) return 'NOADD'; b.click(); return 'CLICKED'; })()`);
  assert.equal(added, 'CLICKED', 'the full tab carries its Add');
  assert.ok(await waitFor(H, `!!document.querySelector('[role="dialog"] input, .overlay input')`, 10000), 'it asks what they are doing');
  await H.browser.ev(`document.querySelector('[role="dialog"] input, .overlay input')?.focus()`);
  await H.browser.send('Input.insertText', { text: 'zzbrandnew follow up with the crew' });
  await sleep(400);
  await H.browser.ev(`[...document.querySelectorAll('[role="dialog"] button, .overlay button')].find((x) => (x.innerText || '').trim() === 'Next')?.click()`);
  assert.ok(await waitFor(H, `(document.querySelector('[role="dialog"], .overlay')?.innerText ?? '').includes('Who is doing it')`, 10000), 'then who is doing it');
  await H.browser.ev(`document.querySelector('[role="dialog"] input, .overlay input')?.focus()`);
  await H.browser.send('Input.insertText', { text: 'Bettina Maddox' });
  await sleep(400);
  await H.browser.ev(`[...document.querySelectorAll('[role="dialog"] button, .overlay button')].find((x) => (x.innerText || '').trim() === 'Add it')?.click()`);
  assert.ok(await waitFor(H, `[...document.querySelectorAll('[role="tabpanel"]')].find((el) => el.getClientRects().length > 0)?.querySelector('.pt-find-n')?.innerText === '1 of 100'`, 15000), 'the added row lands in the standing Find, counted');
  await esc(H);
  await sleep(500);
});

function parseA(c) {
  c = String(c).trim();
  const num = (v) => (v === 'none' ? 0 : +v);
  const oklch = (L, C, Hh) => {
    const h = (Hh * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    const f = (u) => { u = Math.min(Math.max(u, 0), 1); return u > 0.0031308 ? 1.055 * u ** (1 / 2.4) - 0.055 : 12.92 * u; };
    return [f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), f(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), f(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s), 1];
  };
  let m = c.match(/^oklch\(\s*([\d.]+|none)\s+([\d.]+|none)\s+([\d.]+|none)/);
  if (m) return oklch(num(m[1]), num(m[2]), num(m[3]));
  m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (m) return [m[1] / 255, m[2] / 255, m[3] / 255, m[4] === undefined ? 1 : +m[4]];
  m = c.match(/^#([0-9a-fA-F]{6})$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).concat([1]);
  return null;
}
const lum = ([r, g, b]) => {
  const f = (u) => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('tabs and the Find read 4.5:1 in every look, light and dark', { timeout: 300000 }, async () => {
  // The app's own look list (src/shared/prefs.ts), never retyped. Tab ink reads off the text tokens, so the
  // looks and themes are the axes; the accent only underlines the open tab.
  const PALETTES = [...read('src/shared/prefs.ts').match(/export const PALETTES[^=]*=\s*\[([\s\S]*?)\];/)[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(PALETTES.length >= 14, `the look list loaded (${PALETTES.length})`);
  await openProject();
  await openTab('waiting');
  await typePanel('job');
  assert.equal(await panelCount(), '99 of 100', 'the Find stands for the read');
  const bad = [];
  for (const theme of ['light', 'dark']) {
    for (const [i, palette] of PALETTES.entries()) {
      await H.browser.ev(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.documentElement.dataset.palette = ${JSON.stringify(palette)}; })()`);
      // The theme eases over 160ms: the first look of each theme settles outlasts it, or the read lands
      // mid-flight (dark honey, first after the switch, read grey-on-navy at 60ms).
      await sleep(i === 0 ? 500 : 120);
      const m = await H.browser.ev(`(() => {
        const ground = (el) => { let p = el; for (let i = 0; i < 8 && p; i++) { const bg = getComputedStyle(p).backgroundColor; const m4 = bg.match(/^rgba?\\([\\d.\\s,]+,\\s*([\\d.]+)\\)$/); if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && (!m4 || +m4[1] > 0.5)) return bg; p = p.parentElement; } return 'rgb(255, 255, 255)'; };
        const fg = (s) => getComputedStyle(document.querySelector(s)).color;
        const g = (s) => ground(document.querySelector(s));
        return {
          on: { fg: fg('[data-tab="waiting"]'), bg: g('[data-tab="waiting"]') },
          off: { fg: fg('[data-tab="whats-next"]'), bg: g('[data-tab="whats-next"]') },
          quiet: { fg: fg('[data-tab="risks"]'), bg: g('[data-tab="risks"]') },
          count: { fg: fg('[data-tab="whats-next"] .pt-count'), bg: g('[data-tab="whats-next"] .pt-count') },
          n: { fg: document.querySelector('main .pt-find-n') ? getComputedStyle(document.querySelector('main .pt-find-n')).color : 'rgb(0, 0, 0)', bg: document.querySelector('main .pt-find-n') ? ground(document.querySelector('main .pt-find-n')) : 'rgb(255, 255, 255)' },
        };
      })()`);
      for (const [label, cell] of [['open tab', m.on], ['tab', m.off], ['quiet tab', m.quiet], ['count badge', m.count], ['find count', m.n]]) {
        const f = parseA(cell.fg), b = parseA(cell.bg);
        assert.ok(f && b, `${label} colours parse (${cell.fg} on ${cell.bg})`);
        const q = ratio(f.slice(0, 3), b.slice(0, 3));
        if (q < 4.5) bad.push(`${theme} ${palette}: ${label} ${q.toFixed(2)}:1 (${cell.fg} on ${cell.bg})`);
      }
    }
  }
  await H.browser.ev(`(() => { document.documentElement.dataset.theme = 'light'; })()`);
  assert.deepEqual(bad, [], `unreadable tab or Find words:\n${bad.join('\n')}`);
});
