// node --test tests/p18-empty-vault.test.mjs — a new person's first look (p18, 4 Nov 2026): Vault opened with a
// brand new empty vault, and with three notes, at 3456x1408 and 1440x900. Nothing broken, no empty frames, no zero
// counts, no words that assume content, one clear next step wherever a page is empty, and it reads premium. The
// source checks fail without each fix; the live checks boot the real renderer once against an empty vault holding
// one blank project and one new person, with every pack switched on.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The one zero rule, everywhere a count shows ─────────────────────────────

test('PageHead hides a zero count itself, so no page shows "Notes 0"', () => {
  const src = read('src/renderer/src/components/PageHead.tsx');
  assert.ok(src.includes('count !== 0'), 'a numeric zero stays off, like every filter and tab');
});

test('Tasks shows its open pill only past zero, as late and today already do', () => {
  const src = read('src/renderer/src/views/TasksView.tsx');
  // 5 Nov 2026, status in plain words: the pills read plain (is-plain), never filled slate; the zero rule stands.
  assert.ok(src.includes('{leadOpen > 0 && <span className="pill is-plain is-muted">{leadOpen} open</span>}'), 'the open pill hides at zero');
  assert.ok(src.includes('{leadLate > 0 &&') && src.includes('{leadToday > 0 &&'), 'late and today hide at zero too');
  // t249: Tasks is one view — the board, its switch and its columns are gone, so no column keeps a
  // zero there; the zero rule stands on the pills above.
  assert.ok(!src.includes('col.items.length'), 'no board columns left on Tasks to count');
  const projects = read('src/renderer/src/views/ProjectsHome.tsx');
  assert.ok(projects.includes('{col.items.length > 0 && <span className="c">{col.items.length}</span>}'), 'empty project board columns keep no zero');
  assert.ok(!src.includes('{planNeed} need you · {planDone} done already'), 'no "0 need you · 0 done already" on Today');
});

test('Meetings hides its month count and its fact cards while every count is zero', () => {
  const src = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(src.includes('stats.thisMonth > 0'), 'no "0 this month" beside the title');
  // Round 3: the fact cards are gone; their numbers ride on the chips, and a zero shows no number at all.
  assert.ok(!src.includes('w2b-stats') && ['comingUp', 'openActions', 'decisionsWeek', 'openQuestions', 'series'].every((k) => src.includes(`n: stats.${k} || undefined`)), 'the four fact cards go while all four are zero');
  assert.ok(!src.includes('<b>0</b>'), 'no hard zero in the stats');
});

test('a project’s Notes and Files chips hide their zeros, as every filter does', () => {
  const src = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(src.includes("from '../../../../shared/words'") && src.includes('showCount'), 'the shared zero rule is used');
  // v9-vault-truth V1: the filter reads Notes now (Site notes was wrong outside the Sites pack).
  // 5 Nov 2026, the vault folio: the tabs became sections.
  const notes = src.slice(src.indexOf('export function NotesSection'), src.indexOf('export function NotesSection') + 3000);
  assert.ok(!/label\} <span className="n">\{k\.n\}<\/span>/.test(notes), 'Notes chips carry no bare count');
  assert.ok(src.includes('showCount(k.n)'), 'both chips hide their zeros');
});

test('a new person’s cards hide their zeros: "You owe", never "You owe · 0"', () => {
  const src = read('src/renderer/src/views/PersonPage.tsx');
  assert.ok(!src.includes('{title} · {items.length}'), 'the bare count is gone');
  assert.ok(src.includes('items.length > 0'), 'the count shows only past zero');
});

test('Today in your notes hides the zeros on its Made and Linked tabs', () => {
  const src = read('src/renderer/src/views/today/DayParts.tsx');
  assert.ok(!src.includes('{l.title} <span>{l.count}</span>'), 'the bare tab count is gone');
  assert.ok(src.includes('l.count > 0'), 'a tab with nothing in it keeps its name, not its zero');
});

test('progress reads the aim while nothing is done, never "0 of N"', () => {
  const life = read('src/renderer/src/views/project/Lifecycle.tsx');
  assert.ok(life.includes('`${STAGE_WORDS[current]} check`)} to do'), 'a new project: "5 Planning checks to do"');
  assert.ok(!life.includes('{lists[at].items.filter((i) => i.done).length} of {lists[at].items.length}'), 'the bare "0 of N" is gone');
  const today = read('src/renderer/src/views/modules/HealthToday.tsx');
  assert.ok(today.includes('to do this week'), 'Today: "3 sessions to do this week"');
  assert.ok(today.includes('words: week.done ?'), 'the "0 of N sessions" only shows past zero');
  const health = read('src/renderer/src/views/modules/w3b/Health87.tsx');
  assert.ok(health.includes('to do'), 'training: the week’s aim while none is done');
  assert.ok(health.includes('to answer'), 'the check-in counts what is left to answer');
});

test('Health never claims a rest day it never saw, and its zeros go quiet', () => {
  const src = read('src/renderer/src/views/modules/w3b/Health87.tsx');
  assert.ok(src.includes("db.sessions.length ? 'rest' : '–'"), 'a week with no training logged reads –, never rest × 7');
  assert.ok(!src.includes('<b>{food?.meals.length ?? 0}'), 'no big 0 above "No figures yet"');
  assert.ok(!src.includes('{db.targets.kcal ? \'\' : \'\'}'), 'the dead kcal fragment goes with it');
});

// ── No words that assume content ─────────────────────────────────────────────

test('Weekly says last week and projects only when they exist', () => {
  const src = read('src/renderer/src/views/modules/w3b/Weekly87.tsx');
  assert.ok(!src.includes('One section per workstream. Started from last week.${'), 'the lead earns "last week"');
  assert.ok(src.includes('Started from last week') && src.includes('hasPrev'), 'last week is conditional');
  assert.ok(!src.includes('It starts from last week’s, or gathers its first draft from your projects.</p>'), 'the empty card earns both clauses');
  assert.ok(src.includes('hasProjects'), 'projects are conditional too');
});

test('a new project’s Key dates keeps no blank card: hidden, one click away', () => {
  // 5 Nov 2026, the vault folio: the Timeline tab became the Key dates section (the plan visual moved to the
  // Timeline view of What's next). t12, 8 Nov 2026, wanted nothing empty on show: with no dates the section
  // hides instead of an empty state, and its quiet tab starts it one click away.
  const src = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const tl = src.slice(src.indexOf('export function KeyDatesSection'));
  assert.ok(!tl.includes('Plan ·'), 'no plan range in the section');
  // t255: the section still hides with no dates (the split reads through keyDatesModel now); its tab
  // reads the quiet panel with the start in itself.
  assert.ok(tl.includes('if (!asked.length && !coming.length && !past.length) return null'), 'hidden with no dates, never a blank card');
  assert.ok(!tl.includes('No key dates yet'), 'no empty words on show');
  assert.ok(src.includes("{ id: 'key-dates', noun: 'key date'"), 'with its start beside the tab');
});

test('a new person is prepped for working together until a meeting is coming', () => {
  const src = read('src/renderer/src/views/PersonPage.tsx');
  assert.ok(src.includes("card.nextMeeting ? 'Prep for next meeting' : 'Prep for working together'"), 'no "next meeting" with none coming');
});

test('House and Cars drop their "Nothing due" fact while the section below says it', () => {
  const house = read('src/renderer/src/views/modules/w3b/House87.tsx');
  assert.ok(house.includes("...(dueJobs.length || soon.length ? [{ k: 'Upkeep due'"), 'House keeps the fact only while something is due');
  const cars = read('src/renderer/src/views/modules/w3b/Vehicles87.tsx');
  assert.ok(cars.includes("...(m.due.length ? [{ k: 'Due soon'"), 'Cars keeps the fact only while something is due');
});

// ── One clear next step wherever a page is empty ─────────────────────────────

test('Tasks’ empty state offers its New task, as the Inbox offers Capture', () => {
  const src = read('src/renderer/src/views/TasksView.tsx');
  const at = src.indexOf('title="No tasks yet"');
  assert.ok(at > 0, 'the empty state is there');
  assert.ok(src.slice(at, at + 400).includes("label: 'New task'"), 'with the New task action beside it');
});

test('a new project’s every section carries its next step in itself', () => {
  // 5 Nov 2026, the vault folio: the tabs became sections; each head carries the primary the tab's bar held.
  // t12, 8 Nov 2026, wanted nothing empty on show: heads keep their primaries while visible, and each quiet
  // tab carries its missing section's start (t267: one click away, never an empty state).
  const src = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  const at = src.indexOf('export function NotesSection');
  // t239: the merged list lengthened the section, so the window runs to the next section.
  const notes = src.slice(at, src.indexOf('export function ', at + 10));
  assert.ok(notes.includes('> Add note</button>') && notes.includes('ctx.noteMenu'), 'Notes: Add note where the notes are');
  const people = src.slice(src.indexOf('export function PeopleSection'), src.indexOf('export function PeopleSection') + 2500);
  assert.ok(people.includes('Add person'), 'People: Add person in the section');
  const decisions = src.slice(src.indexOf('export function DecisionsSection'), src.indexOf('export function DecisionsSection') + 2500);
  assert.ok(decisions.includes('Log decision'), 'Decisions: Log decision in the section');
  const dates = src.slice(src.indexOf('export function KeyDatesSection'));
  assert.ok(dates.includes('> Milestone</button>'), 'Key dates: Milestone in the section');
  for (const noun of ['task', 'key date', 'person', 'decision', 'note', 'files', 'risk', 'update', 'bill']) {
    assert.ok(src.includes(`noun: '${noun}'`), `its tab starts ${noun}`);
  }
});

test('a project with no folder yet can choose one from its Notes tab', () => {
  // t12, 8 Nov 2026, wanted nothing empty on show: never-linked hides Files instead of an empty state,
  // and the Notes tab's folder door chooses it (t267: head, quiet tab and menu).
  const tabs = read('src/renderer/src/views/project/ProjectTabs87.tsx');
  assert.ok(!tabs.includes('title="No folder on this PC yet"'), 'no empty words on show');
  assert.ok(tabs.includes('export function chooseProjectFolder'), 'choosing stays one click away');
  const app = read('src/main/app.ts');
  const fh = app.indexOf("handle('project:folder-here'");
  assert.ok(fh > 0, 'the folder-here handler is there');
  const body = app.slice(fh, fh + 2500);
  assert.ok(!body.includes("if (!recorded) throw new Error('This project names no folder.')"), 'choosing no longer refuses a folderless project');
  assert.ok(body.includes('no recorded folder') || body.includes('!recorded'), 'the folderless case is handled');
});

test('the w3b shell declares its form host once, so the renderer builds', () => {
  const src = read('src/renderer/src/views/modules/w3b/W3b.tsx');
  assert.equal((src.match(/import \{ RecordFormHost \}/g) ?? []).length, 1, 'one RecordFormHost import, never two');
});

// ── The live pages: no zeros, every empty tab with its step ──────────────────

let H = null;
async function harness() {
  if (!H) {
    const { loadCore, buildRenderer, openServices, startServer, startBrowser } = await import('./vault-controls-harness.mjs');
    const work = mkdtempSync(path.join(tmpdir(), 'nv-p18-'));
    const vaultDir = path.join(work, 'vault');
    mkdirSync(vaultDir, { recursive: true });
    const w = (rel, text) => {
      const p = path.join(vaultDir, ...rel.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    w('Projects/Test Project/Test Project.md', '---\ntype: project\nstatus: planning\nhealth: on track\nstarted: 2026-11-04\nupdated: 2026-11-04\n---\n# Test Project\n');
    w('People/New Person.md', '---\ntype: person\n---\n# New Person\n');
    const core = await loadCore(work);
    const distDir = await buildRenderer(work);
    const box = { current: await openServices(vaultDir, path.join(work, 'data'), core) };
    const mods = {};
    for (const id of ['health', 'family', 'finance', 'documents', 'house', 'vehicles', 'career', 'travel', 'meetings', 'weekly', 'sites', 'vendors', 'memories', 'business', 'systems', 'goals', 'lists', 'publications']) mods[id] = { on: true };
    await box.current.invoke('settings:update', [{ prefs: { modules: mods } }]);
    const server = await startServer(distDir, () => box.current);
    const browser = await startBrowser(server.origin);
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(2500);
    H = { work, vaultDir, browser, server, close: async () => { browser.close(); server.close(); rmSync(work, { recursive: true, force: true }); } };
  }
  return H;
}
after(async () => {
  await H?.close().catch(() => undefined);
  H = null;
});

async function clickWords(h, words, scope = '') {
  return h.browser.ev(`(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return 'NOROOT';
    const els = [...root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return 'NOTFOUND';
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    await new Promise((r) => setTimeout(r, 500));
    return 'CLICKED';
  })()`);
}
const mainText = (h) => h.browser.ev(`document.querySelector('main')?.innerText ?? ''`);

test('empty pages say no zero counts: Meetings, Notes, People, Tasks, person, Today’s tabs', async () => {
  const h = await harness();
  await clickWords(h, 'Meetings', '.places-list');
  await sleep(1500);
  const meetings = await mainText(h);
  assert.doesNotMatch(meetings, /0 this month/, 'no "0 this month"');
  assert.doesNotMatch(meetings, /0\s+(coming up|actions? still open|decisions this week|series)/, 'no zero fact cards');
  await clickWords(h, 'Notes', '.places-list');
  await sleep(1500);
  assert.doesNotMatch(await mainText(h), /^Notes\n0\n/m, 'no "Notes 0" head');
  await clickWords(h, 'Tasks', '.places-list').then(async (r) => {
    if (r !== 'CLICKED') {
      await clickWords(h, 'More', '.places-list');
      await sleep(600);
      await clickWords(h, 'Tasks', '.menu, [role="menu"]');
    }
  });
  await sleep(1500);
  assert.doesNotMatch(await mainText(h), /0 open/, 'no "0 open"');
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await clickWords(h, 'People', '.places-list');
  await sleep(1500);
  assert.equal(await clickWords(h, 'New Person', 'main'), 'CLICKED', 'the new person opens');
  await sleep(1500);
  const person = await mainText(h);
  assert.doesNotMatch(person, /· 0/, 'no "· 0" on the owe cards');
  assert.ok(person.includes('Prep for working together'), 'prepped for working together, not a next meeting that isn’t');
});

test('a new project’s sections read honest with their next step in reach', async () => {
  // t255: a blank project shows every tab quietly, with a short helpful start on the Overview — and every
  // quiet tab starts one click from its own Add.
  const h = await harness();
  await clickWords(h, 'Projects', '.places-list');
  await sleep(1500);
  assert.equal(await clickWords(h, 'Test Project', 'main'), 'CLICKED', 'the blank project opens');
  await sleep(2000);
  assert.doesNotMatch(await mainText(h), /0 of \d+ .*checks/, 'no "0 of N checks" (got: ' + (await mainText(h)).slice(0, 200) + ')');
  const order = await h.browser.ev(`[...document.querySelectorAll('[role="tab"]')].map((el) => el.getAttribute('data-tab')).join(',')`);
  assert.equal(order, 'overview,whats-next,waiting,questions,key-dates,notes,people,decisions,risks,updates,money,activity', 'every tab stands on a blank project');
  const quiet = await h.browser.ev(`[...document.querySelectorAll('[role="tab"].is-quiet')].map((el) => el.getAttribute('data-tab')).join(',')`);
  assert.ok(quiet.split(',').length >= 11, `the empty tabs read quietly (${quiet})`);
  for (const words of ['Start this project', 'Add the first task, a note, or a key date']) {
    assert.ok((await mainText(h)).includes(words), `the start reads "${words}"`);
  }
  const answer = async (text) => {
    await h.browser.send('Input.insertText', { text });
    await sleep(400);
    await h.browser.ev(`[...document.querySelectorAll('.dialog-actions .button.primary')].at(-1)?.click()`);
    await sleep(1800);
  };
  // The start's first task lands Your next, unquieting its tab; the quiet Risks tab starts one click away.
  const bodyText = () => h.browser.ev(`document.body.innerText ?? ''`);
  await h.browser.ev(`document.querySelector('[data-folio-empty] [data-add="whats-next"]')?.click()`);
  await sleep(800);
  assert.ok((await bodyText()).includes('Add a step'), 'the first task asks what needs doing');
  await answer('Chase the quote for the awning');
  await h.browser.ev(`document.querySelector('[data-tab="whats-next"]')?.click()`);
  await sleep(1000);
  assert.ok((await mainText(h)).includes('Chase the quote for the awning'), 'Your next lands where it sits');
  assert.equal(await h.browser.ev(`document.querySelector('[data-tab="whats-next"]')?.classList.contains('is-quiet')`), false, 'its tab reads open now');
  await h.browser.ev(`document.querySelector('[data-tab="risks"]')?.click()`);
  await sleep(1000);
  assert.ok((await mainText(h)).includes('No risks named.'), 'Risks reads its quiet panel');
  await h.browser.ev(`document.querySelector('[data-section="risks"] [data-add="risks"]')?.click()`);
  await sleep(800);
  await answer('The awning quote never arrives');
  assert.ok((await mainText(h)).includes('The awning quote never arrives'), 'Risks lands one click from its own Add');
});
