// node --test tests/meeting-start-to-minutes.test.mjs — a meeting from start to minutes, walked (t166, 9 Nov 2026).
// One meeting as a person runs it, with the fit-out-shaped vault (tests/fitout-project.mjs, made-up people
// throughout): the meeting note made by hand, a scripted transcript brought in (no microphone), Speaker 1 and 2
// named afterwards, the minutes made, their actions checked (owner, date, project), one ticked, the project page
// showing it under the meeting (t141), and the minutes as a branded PDF to a file (never mailed). The minutes come
// from a page-side stub answering as the connected model would (the harness has no model, as in
// meeting-minutes-runs); the PDF is the same branded document Share prints, printed for real by headless Chromium
// and read back. Fails without each step holding.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startHarness } from './vault-controls-harness.mjs';
import { HALL_PATH, hallChats, hallProjectFiles, writeFitoutProject } from './fitout-project.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = path.join(root, '..', 'shots');
mkdirSync(shotsDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dueWords = (y, m, d) => `${d} ${MONTHS[m - 1]} ${y}`;

// A scripted transcript in the recorder's own timed shape (readTranscriptText's "[mm:ss] Name: words" door), with
// the engine's numbered voices to name afterwards. Made-up lighting words: two decisions, four actions with owners and
// dates, four figures, one open question. Dates match the real November 2026 calendar (10 Tue, 13 Fri, 16 Mon,
// 20 Fri) so each weekday with its number is exact. The four jobs are new (nothing the project or its meetings
// already hold), so the project page shows each under this meeting rather than as its own step's twin.
const TRANSCRIPT = [
  '[00:00:05] Speaker 1: Morning all, let us start with the Northside power shutdown. David Nguyen said Saturday the 14th of November is the last day before the community dry run.',
  '[00:00:40] Speaker 2: The switch firmware is patched, so the 14th works. I will label the cable trays before the acceptance tests, by Tuesday the 10th.',
  '[00:01:20] Speaker 1: Good, we agreed Northside rooms 1 to 4 go live on the 20th of November.',
  '[00:02:05] Speaker 2: Southside acoustic panels, order K-2210, land on Friday, and the craft room still needs its walkthrough photos. I will photograph the craft room for the facilities team by Friday the 13th.',
  '[00:03:10] Speaker 1: Eastside ceiling fans still wait on the landlord. Michael Roberts will draft the January move notice for staff by Monday the 16th.',
  '[00:04:00] Speaker 2: The budget holds at $86,000 with $38,000 contingency left. We agreed to hold the contingency to December.',
  '[00:05:15] Speaker 1: Priya Sharma will count the spare stage lights in the Northside store by tomorrow.',
  '[00:06:00] Speaker 2: Open question: whether the Eastside install dates clash with the builder fit-out.',
].join('\n');

// The stubbed answer, as the connected model would give it for that transcript (already in the minutes' own shape,
// as recorder:minutes hands it over): who was there, a short summary, four figures actually said, two decisions,
// four actions with owners and dates, one open item, four topics. Nothing invented, names as the People notes spell
// them. The sound desk sign-off's "tomorrow" is the day the walk runs.
const goodMinutes = (today) => ({
  present: ['Sarah Mitchell', 'Priya Sharma'],
  absent: [],
  named: ['David Nguyen', 'Michael Roberts'],
  summary: 'Sarah Mitchell and Priya Sharma reviewed the Northside power shutdown, the Southside craft room and the Eastside ceiling fans. Northside rooms 1 to 4 will go live on the 20th of November, and the $38,000 contingency stays held to December. Four actions were agreed, each with its owner and date.',
  figures: [
    { value: '20 Nov', label: 'Northside rooms live' },
    { value: '$86,000', label: 'Project budget' },
    { value: '$38,000', label: 'Contingency left' },
    { value: 'K-2210', label: 'Southside panels order' },
  ],
  decisions: ['Northside rooms 1 to 4 go live on the 20th of November.', 'Hold the $38,000 contingency to December.'],
  actions: [
    { what: 'Label the Northside cable trays before the acceptance tests', who: 'Priya Sharma', due: '2026-11-10' },
    { what: 'Photograph the Southside craft room for the facilities team', who: 'Priya Sharma', due: '2026-11-13' },
    { what: 'Draft the Eastside January move notice for staff', who: 'Michael Roberts', due: '2026-11-16' },
    { what: 'Count the spare stage lights in the Northside store', who: 'Priya Sharma', due: today },
  ],
  questions: [{ what: 'Whether the Eastside install dates clash with the builder fit-out.' }],
  topics: [
    { heading: 'Northside power shutdown', words: ['The 14th of November is the last day before the community dry run.', 'Northside rooms 1 to 4 go live on the 20th of November.'] },
    { heading: 'Southside craft room', words: ['Order K-2210 lands on Friday.', 'Priya Sharma will photograph the craft room for the facilities team by Friday the 13th.'] },
    { heading: 'Eastside ceiling fans', words: ['The ceiling fans still wait on the landlord.', 'Michael Roberts will draft the January move notice for staff by Monday the 16th.'] },
    { heading: 'Budget', words: ['The budget holds at $86,000 with $38,000 contingency left.'] },
  ],
});

test('a meeting from start to minutes: note, transcript, names, minutes, tick, project, branded PDF', async () => {
  const h = await startHarness({ projectFiles: hallProjectFiles(), projectWork: hallChats() });
  try {
    await h.services.invoke('settings:update', [{ prefs: { modules: { meetings: { on: true } } } }]);
    writeFitoutProject(h.vaultDir);
    // The meeting note, made by hand (the New-meeting form is t152's; the calendar is not set up in the harness):
    // yesterday, so the meeting reads as past with its transcript and minutes doors open.
    const yesterday = day(-1);
    const today = day(0);
    const rel = `Meetings/${yesterday} Northside power shutdown review.md`;
    const w = (r, text) => {
      const p = path.join(h.vaultDir, ...r.split('/'));
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
    };
    w(
      rel,
      `---\ntype: meeting\ndate: ${yesterday}\ntime: 10:00 AM\npeople:\n  - "[[Sarah Mitchell]]"\n  - "[[Priya Sharma]]"\nproject: "[[Southern Cross Hall Refurbishment]]"\nwhere: Teams\n---\n## Agenda\n\n- [ ] Northside power shutdown\n- [ ] Southside acoustic panels\n\n## Notes\n\n\n## Decisions\n\n\n## Actions\n\n`,
    );
    await h.services.rescanAll();
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      try {
        if (await h.browser.ev(`!!document.querySelector('.app')`)) break;
      } catch {}
    }
    await sleep(1500);
    const readVault = (r) => readFileSync(path.join(h.vaultDir, ...r.split('/')), 'utf8');
    const SEL = 'button, a[href], [role="button"], [role="tab"]';
    const clickWords = async (words, scope = '') => {
      const r = await h.browser.ev(`(async () => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
        const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
        if (!root) return 'NOROOT';
        const els = [...root.querySelectorAll(${JSON.stringify(SEL)})].filter((e) => vis(e) && !e.disabled);
        const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
        if (!el) return 'NOTFOUND';
        el.scrollIntoView({ block: 'nearest' }); el.click();
        await new Promise((r) => setTimeout(r, 500));
        return 'CLICKED';
      })()`);
      assert.equal(r, 'CLICKED', `clicked ${words}${scope ? ` in ${scope}` : ''}`);
    };
    const waitFor = async (js, ms = 30000) => {
      const t0 = Date.now();
      for (;;) {
        if (await h.browser.ev(js)) return;
        if (Date.now() - t0 > ms) throw new Error(`waited: ${js.slice(0, 140)}`);
        await sleep(300);
      }
    };
    const openRoom = async (name) => {
      if (
        (await h.browser.ev(`(async () => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
        const els = [...document.querySelectorAll('.sidebar.left button, aside button')].filter(vis);
        const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(name)})));
        if (!el) return 'NOTFOUND';
        el.click();
        await new Promise((r) => setTimeout(r, 500));
        return 'CLICKED';
      })()`)) === 'CLICKED'
      )
        return;
      await clickWords('More', '.sidebar.left, aside');
      await sleep(500);
      await clickWords(name, '.menu, [role="menu"]');
    };
    const shot = async (file, scrollTo = '') => {
      await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1117, deviceScaleFactor: 2, mobile: false });
      await sleep(900);
      if (scrollTo) {
        await h.browser.ev(`document.querySelector(${JSON.stringify(scrollTo)})?.scrollIntoView()`);
        await sleep(400);
      }
      const d = await h.browser.send('Page.captureScreenshot', { format: 'png' });
      assert.ok(d.result?.data ?? d.data, `pixels for ${file}`);
      writeFileSync(path.join(shotsDir, file), Buffer.from(d.result?.data ?? d.data, 'base64'));
    };

    // The stubbed minutes ask (no model in the harness): the connected model's answer for this transcript.
    // Re-installed after every reload (it lives in the page).
    const stubMinutes = () =>
      h.browser.ev(`(() => {
        if (window.__t166wrapped) return 'ready';
        const GOOD = ${JSON.stringify(goodMinutes(today))};
        const real = window.nv.recorder;
        window.nv = new Proxy(window.nv, { get: (t, p) => (p === 'recorder' ? new Proxy(real, { get: (u, q) => (q === 'minutes' ? async () => ({ minutes: GOOD }) : u[q]) }) : t[p]) });
        window.__t166wrapped = true;
        return 'ready';
      })()`);
    await stubMinutes();
    const reloadPage = async () => {
      await h.browser.send('Page.navigate', { url: `${h.origin}/harness.html` });
      await waitFor(`!!document.querySelector('.app')`, 60000);
      await sleep(2000);
      await stubMinutes();
    };

    // Open the meeting from the Meetings rail.
    await openRoom('Meetings');
    await waitFor(`!!document.querySelector('.w2b-meetings')`);
    await clickWords('Past');
    await waitFor(`(document.querySelector('.w2b-meetings')?.innerText || '').includes('Northside power shutdown review')`);
    await clickWords('Northside power shutdown review');
    await waitFor(`!!document.querySelector('.w2b-meeting')`);
    await sleep(1500);
    const title = await h.browser.ev(`document.querySelector('.w2b-meeting h1')?.innerText ?? ''`);
    assert.ok(title.includes('Northside power shutdown review'), `the meeting opens (${title})`);

    // Bring in the scripted transcript (no microphone): pasted, as Teams and Zoom transcripts paste.
    await clickWords('Bring in a transcript');
    await waitFor(`!!document.querySelector('.wmt-tarea')`);
    await h.browser.ev(`document.querySelector('.wmt-tarea').focus()`);
    await sleep(300);
    await h.browser.send('Input.insertText', { text: TRANSCRIPT });
    await sleep(600);
    const pasted = await h.browser.ev(`({ lines: document.querySelector('.wmt-tdialog .wu-faint')?.innerText ?? '', disabled: [...document.querySelectorAll('.wmt-tdialog .dialog-actions .button')].find((b) => (b.innerText || '').includes('Bring it in'))?.disabled ?? null })`);
    assert.ok(pasted.lines.includes('8 lines'), `the dialog read the paste (${JSON.stringify(pasted)})`);
    assert.equal(pasted.disabled, false, 'Bring it in enabled');
    await clickWords('Bring it in');
    await waitFor(`!document.querySelector('.wmt-tdialog')`, 30000);
    // The transcript landed on disk; the harness has no file watcher (the app re-reads the note when it lands),
    // so the page is reloaded to pick it up, as the watcher's push would.
    {
      const t0 = Date.now();
      for (;;) {
        if (readVault(rel).includes('## Transcript')) break;
        if (Date.now() - t0 > 20000) throw new Error('the transcript never landed in the note');
        await sleep(400);
      }
    }
    await reloadPage();
    await openRoom('Meetings');
    await waitFor(`!!document.querySelector('.w2b-meetings')`);
    if (await h.browser.ev(`!!document.querySelector('.w2b-meeting')`)) {
      await h.browser.ev(`(() => { const b = [...document.querySelectorAll('button[aria-label="Back"]')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && !e.disabled; }); b?.click(); return !!b; })()`);
      await waitFor(`!!document.querySelector('.w2b-meetings') && !document.querySelector('.w2b-meeting')`);
    }
    await waitFor(`(document.querySelector('.w2b-meetings')?.innerText || '').includes('Past')`);
    await sleep(800);
    await clickWords('Past');
    await waitFor(`(document.querySelector('.w2b-meetings')?.innerText || '').includes('Northside power shutdown review')`);
    await clickWords('Northside power shutdown review');
    await waitFor(`!!document.querySelector('.w2b-meeting')`);
    await waitFor(`(document.querySelector('.w2b-meeting')?.innerText || '').includes('Speaker')`, 30000);
    const afterTranscript = readVault(rel);
    assert.ok(afterTranscript.includes('## Transcript'), 'the transcript is folded at the end of the note');
    assert.ok(afterTranscript.includes('Speaker 1:') && afterTranscript.includes('Speaker 2:'), 'both voices kept their labels on disk');
    const lineCount = (afterTranscript.match(/\*Speaker \d:/g) ?? []).length;
    assert.equal(lineCount, 8, `eight timed lines (saw ${lineCount})`);

    // Name Speaker 1 and 2 afterwards: each voice named once, every line taking the name.
    await waitFor(`document.querySelectorAll('.spk-row').length >= 2`);
    const voices = await h.browser.ev(`[...document.querySelectorAll('.spk-row .mp-who')].map((el) => el.innerText.trim()).join('|')`);
    assert.ok(voices.includes('Speaker 1') && voices.includes('Speaker 2'), `two voices to name (${voices})`);
    for (const [voice, name] of [['Speaker 1', 'Sarah Mitchell'], ['Speaker 2', 'Priya Sharma']]) {
      const done = await h.browser.ev(`(async () => {
        const rows = [...document.querySelectorAll('.spk-row')];
        const row = rows.find((r) => (r.innerText || '').includes(${JSON.stringify(voice)}));
        if (!row) return 'NOROW';
        const open = row.querySelector('.spk-name');
        if (open) { open.scrollIntoView({ block: 'nearest' }); open.click(); }
        await new Promise((r) => setTimeout(r, 500));
        // A suggestion with the name sets it in one click; else type it.
        const pick = [...document.querySelectorAll('.spk-pick')].find((b) => (b.innerText || '').trim() === ${JSON.stringify(name)});
        if (pick) { pick.click(); await new Promise((r) => setTimeout(r, 800)); return 'PICKED'; }
        const input = document.querySelector('.spk-input');
        if (!input) return 'NOINPUT';
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(input, ${JSON.stringify(name)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
        const save = [...document.querySelectorAll('.spk-edit .button')].find((b) => (b.innerText || '').trim() === 'Save');
        if (!save) return 'NOSAVE';
        save.click();
        await new Promise((r) => setTimeout(r, 800));
        return 'TYPED';
      })()`);
      assert.ok(done === 'PICKED' || done === 'TYPED', `${voice} named ${name} (${done})`);
      await sleep(600);
    }
    // Naming saves through the window (debounced), so wait for the disk to catch up.
    {
      const t0 = Date.now();
      for (;;) {
        if (readVault(rel).includes('neuralvault-speaker-names:')) break;
        if (Date.now() - t0 > 20000) throw new Error('the speaker names never landed in the note');
        await sleep(400);
      }
    }
    const afterNames = readVault(rel);
    assert.ok(afterNames.includes('neuralvault-speaker-names:'), 'the names live in the note properties');
    assert.ok(afterNames.includes('Sarah Mitchell') && afterNames.includes('Priya Sharma'), 'both names kept');
    // Renaming changes every line where a person reads: open the transcript and read it.
    // It may stand open already (layout round 3 opens the transcript beside the minutes): open it only if shut.
    await h.browser.ev(`(() => { const t = document.querySelector('.mp-toggle'); if (t && t.getAttribute('aria-expanded') !== 'true') t.click(); })()`);
    await sleep(800);
    const shown = await h.browser.ev(`document.querySelector('.mp-lines')?.innerText ?? ''`);
    assert.ok(shown.includes('Sarah Mitchell') && shown.includes('Priya Sharma'), 'every line reads in its name');
    assert.ok(!shown.includes('Speaker 1') && !shown.includes('Speaker 2'), 'no numbered voice left where read');

    // Make the minutes: who was there, summary, figures, decisions, actions, questions, discussion.
    await clickWords('Make the minutes', '.mm');
    await waitFor(`(document.querySelector('.mm')?.innerText || '').includes('Minutes made')`, 30000);
    {
      const t0 = Date.now();
      for (;;) {
        if (readVault(rel).includes('## Discussion')) break;
        if (Date.now() - t0 > 20000) throw new Error('the minutes never landed in the note');
        await sleep(400);
      }
    }
    const note = readVault(rel);
    // A good secretary: decisions and actions with owners and dates, nothing invented, names right.
    for (const s of ['## Summary', '## Decisions', '## Actions', '## Questions', '## Discussion', '## Key figures']) assert.ok(note.includes(s), `the note holds ${s}`);
    assert.ok(note.includes('Northside rooms 1 to 4 go live on the 20th of November'), 'decision one written');
    assert.ok(note.includes('Hold the $38,000 contingency to December'), 'decision two written');
    for (const [what, who, when] of [
      ['Label the Northside cable trays before the acceptance tests', 'Priya Sharma', dueWords(2026, 11, 10)],
      ['Photograph the Southside craft room for the facilities team', 'Priya Sharma', dueWords(2026, 11, 13)],
      ['Draft the Eastside January move notice for staff', 'Michael Roberts', dueWords(2026, 11, 16)],
      ['Count the spare stage lights in the Northside store', 'Priya Sharma', null],
    ]) {
      const line = note.split('\n').find((l) => l.startsWith('- [ ]') && l.includes(what));
      assert.ok(line, `an action for ${what}`);
      assert.ok(line.includes(who), `${what} owned by ${who} (${line})`);
      if (when) assert.ok(line.includes(when), `${what} due ${when} (${line})`);
    }
    const store = note.split('\n').find((l) => l.startsWith('- [ ]') && l.includes('Count the spare stage lights in the Northside store'));
    const [ty, tm, td] = today.split('-').map(Number);
    assert.ok(store.includes(dueWords(ty, tm, td)), `tomorrow firmed to today (${store})`);
    // Nothing invented: every figure was said; nobody guessed; no numbered voice owns anything.
    for (const f of ['20 Nov: Northside rooms live', '$86,000: Project budget', '$38,000: Contingency left', 'K-2210: Southside panels order']) assert.ok(note.includes(f), `figure said and written (${f})`);
    const minutesPart = note.split('## Transcript')[0];
    assert.ok(!minutesPart.includes('Speaker 1') && !minutesPart.includes('Speaker 2'), 'no numbered voice in the minutes');
    assert.ok(!/\\bYou\\b/.test(minutesPart.split('## Summary')[1] ?? ''), 'no "You" in the minutes');
    assert.ok(!minutesPart.includes('not assigned'), 'every action has its owner from the words');
    await shot('t166-meeting-minutes.png', '.mm');

    // The actions are real tasks: Today's Tasks read them, with owners and dates.
    const tasks = await h.services.invoke('tasks:view', []);
    const taskWords = JSON.stringify(tasks);
    for (const what of ['Label the Northside cable trays', 'Photograph the Southside craft room', 'Draft the Eastside January move notice', 'Count the spare stage lights']) assert.ok(taskWords.includes(what), `Tasks holds ${what}`);

    // The note is the meeting (t248): its four tasks tick where they show, in the note, read again after
    // the minutes land (t166: the room kept "No actions yet" until the person left and came back).
    await clickWords('Open the meeting note', '.w2b-meeting');
    await waitFor(`document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row').length >= 4`, 30000);
    const tickR = await h.browser.ev(`(async () => {
      const rows = [...document.querySelectorAll('section[aria-label="Tasks in this note"] .mt-row')];
      const row = rows.find((e) => (e.innerText || '').includes('Label the Northside cable trays'));
      const box = row?.querySelector('button.check');
      if (!box || box.disabled) return 'NOBOX';
      box.scrollIntoView({ block: 'nearest' });
      box.click();
      await new Promise((r) => setTimeout(r, 800));
      return 'TICKED';
    })()`);
    if (tickR !== 'TICKED') {
      // The meeting's own tick door through the backend (the same call its box makes).
      const lines = readVault(rel).split('\n');
      const i = lines.findIndex((l) => l.startsWith('- [ ]') && l.includes('Label the Northside cable trays'));
      assert.ok(i >= 0, 'the action line to tick');
      await h.services.invoke('work:call', ['meetings', 'tick', [rel, i, lines[i], true]]);
      await sleep(800);
    }
    const ticked = readVault(rel);
    assert.ok(ticked.split('\n').some((l) => l.startsWith('- [x]') && l.includes('Label the Northside cable trays')), 'the tick written in the meeting');

    // The project page shows the meeting with its actions (t141), the ticked one ticked.
    await openRoom('Projects');
    await sleep(800);
    await clickWords('Southern Cross Hall Refurbishment');
    await sleep(2500);
    await h.browser.ev(`document.querySelector('[data-section="notes"]')?.scrollIntoView({ block: 'start' })`);
    await sleep(500);
    const meetings = await h.browser.ev(`[...document.querySelectorAll('[data-section="notes"] [data-meeting]')].map((el) => el.getAttribute('data-meeting')).join(',')`);
    assert.ok(meetings.includes(rel), `the project lists the walked meeting (${meetings.slice(0, 200)})`);
    const under = await h.browser.ev(`document.querySelector('[data-meeting="${rel}"]')?.innerText ?? ''`);
    for (const what of ['Label the Northside cable trays', 'Photograph the Southside craft room', 'Draft the Eastside January move notice', 'Count the spare stage lights']) assert.ok(under.includes(what), `the meeting holds ${what}`);
    // Owners as the minutes wrote them (t166: linked "[[Priya Sharma]]" blanked in the records, so the page blamed
    // the project's owner Sarah for Priya's three).
    assert.ok(under.includes('Priya') && under.includes('Michael'), `Priya's and Michael's names on their rows (${under.slice(0, 300)})`);
    assert.ok(!under.includes('Sarah'), 'nobody blamed on the project owner');
    await shot('t166-project-page.png', '[data-section="notes"]');

    // The branded PDF, to a file only (never mailed): the same branded document Share prints, printed for real.
    const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
    const entry = path.join(h.work, 'pdf-entry.ts');
    writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/shared/brand-document.ts'))};\n`);
    await build({ input: entry, platform: 'node', output: { file: path.join(h.work, 'pdf.mjs'), format: 'esm' }, logLevel: 'silent' });
    const BD = await import(pathToFileURL(path.join(h.work, 'pdf.mjs')).href);
    const mark = (fill, words) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 86"><g fill="${fill}"><path d="M75 4 106 46H90l14 18H46l14-18H44z"/><text x="75" y="83" font-family="Helvetica,Arial,sans-serif" font-size="17" font-weight="700" text-anchor="middle">${words}</text></g></svg>`;
    const kit = { name: 'Southern Cross lighting', logos: { primary: 'Assets/Logos/sc-dark.svg', onDark: 'Assets/Logos/sc-white.svg' }, colours: [{ hex: '#1f3a5f', name: 'Southern navy', use: 'Headings' }], fonts: [{ name: 'Helvetica', use: 'Body' }] };
    const logos = { 'Assets/Logos/sc-dark.svg': `data:image/svg+xml,${encodeURIComponent(mark('#1f3a5f', 'southern cross'))}`, 'Assets/Logos/sc-white.svg': `data:image/svg+xml,${encodeURIComponent(mark('#ffffff', 'southern cross'))}` };
    const html = BD.brandDocument({ title: `${yesterday} Northside power shutdown review`, text: readVault(rel), path: rel, kit, url: (r) => logos[r] ?? '', logoPalette: { primary: ['#1f3a5f'], onDark: ['#ffffff'] } });
    assert.ok(html.includes('Southern Cross lighting'), 'set in the brand kit');
    assert.ok(!html.includes('Speaker 1:'), 'the PDF reads names, never numbered voices');
    await h.browser.send('Page.navigate', { url: 'about:blank' });
    await sleep(600);
    // Served to the page as its own document (data URL: same bytes, only the address changes).
    await h.browser.send('Page.navigate', { url: `data:text/html,${encodeURIComponent(html)}` });
    let report = null;
    for (let i = 0; i < 120 && !report; i++) {
      await sleep(250);
      report = await h.browser.ev('window.__report || null').catch(() => null);
    }
    assert.ok(report, 'the pages laid out');
    const pdf = await h.browser.send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, generateDocumentOutline: true });
    const bytes = Buffer.from(pdf.result?.data ?? pdf.data, 'base64');
    assert.ok(bytes.subarray(0, 4).toString() === '%PDF', 'real PDF bytes');
    const pdfFile = path.join(shotsDir, 't166-meeting-minutes.pdf');
    writeFileSync(pdfFile, bytes);
    assert.ok(new RegExp(`Pages:\\s+${report.pages}\\b`).test(spawnSync('pdfinfo', [pdfFile], { encoding: 'utf8' }).stdout), 'the filed PDF has its pages');
    const words = spawnSync('pdftotext', [pdfFile, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout;
    for (const s of ['Northside rooms 1 to 4 go live', 'Label the Northside cable trays', 'Priya Sharma', 'Michael Roberts', '$38,000']) assert.ok(words.includes(s), `the PDF reads ${s}`);
    assert.ok(!words.includes('Speaker 1'), 'the PDF names every voice');
    await shot('t166-meeting-pdf.png');
  } finally {
    await h.close().catch(() => {});
  }
}, { timeout: 600000 });
