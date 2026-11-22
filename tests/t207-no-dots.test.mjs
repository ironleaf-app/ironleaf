// node --test tests/t207-no-dots.test.mjs — nothing a person reads is cut off with … (t207 pass 2,
// answer 1). The former host app and Vault are one product: Vault's twin of
// ns/tests/no-ellipsis.mjs. One-line slots where one line is the design (tabs, crumbs, tree rows, selects,
// inputs, chips, table cells, the rail) clip without dots (text-overflow:clip, full words on hover); everything
// else wraps fully and grows; menus wrap whole words to three lines at most. Static: scans every Vault style
// sheet for truncation (text-overflow:ellipsis, line-clamp) and every renderer, shared and main source for
// slice+… and textOverflow ellipsis, failing on any outside the allow-list; checks the wrap rules, the menu cap
// and the hovers exist (each fails without it).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const cssOf = (dir) => readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.css')).map((f) => `${dir}/${f}`);
const SHEETS = ['src/renderer/src/styles.css', ...cssOf('src/renderer/src/styles')];
const walk = (dir, out = []) => {
  for (const e of readdirSync(path.join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e)) out.push(rel);
  }
  return out;
};
const SOURCES = [...walk('src/renderer/src'), ...walk('src/shared'), ...walk('src/main')];
// Allow-list (reported in the report): only model-facing words keep slice+… (the agent's own
// shorteners and payload caps, never shown to a person), explicit cut markers (a log file, model context
// trims that say where they cut) and the search excerpt markers (the app's word-edge snippets, pinned by
// t200, and the published site's own search). t212 also sees the list shape (`? '…'`, `+ '…'`): person-visible
// lists now read ", and N more" instead; the excerpt markers (citation quotes, archive and index snippets)
// and model tool lists stay, each entered below. Nothing a person reads in the app is on it.
const ALLOW_JS = [
  ['shared/agent-access.ts', 'slice(0, max'],
  ['shared/agent-access.ts', 'cut short here'],
  ['shared/inbox-file.ts', 'slice(0, 500)'],
  ['shared/assistant-memory.ts', 'FACT_CHARS'],
  ['shared/meeting-minutes.ts', 'MINUTES_TRANSCRIPT_LIMIT'],
  ['shared/meeting-notes.ts', 'TRANSCRIPT_LIMIT'],
  ['shared/task-write.ts', 'already there'],
  ['shared/site-publish.ts', 'p.x.slice'],
  ['shared/snippet.ts', "…'"],
  ['main/agent-access.ts', 'p.summary.slice'],
  ['main/agent-full.ts', 'slice(0, 599)'],
  ['main/agent-full.ts', 'slice(0, 299)'],
  ['main/agent.ts', '[…the rest of the note'],
  ['main/agent.ts', "f.words || '…'"],
  ['main/agent.ts', 'OLD_ANSWER_CHARS'],
  ['main/error-log.ts', 'slice(0, max - 1)'],
  ['main/office-edit.ts', 'c.formula.slice'],
  ['main/office-edit.ts', 's.slice(0, max - 1)'],
  ['main/office-edit.ts', 'v.slice(0, n - 1)'],
  ['shared/notebook.ts', 'w.slice(0, words)'],
  ['shared/publications.ts', 'flat.slice(from, at + 110)'],
  ['main/indexer.ts', 'SNIPPET_CHARS'],
  ['main/agent.ts', 'edits.slice(0, 6)'],
  ['main/agent.ts', 'lost.slice(0, 25)'],
  ['main/work/meetings.ts', 'x.people.slice(0, 6)'],
  // 23 Nov 2026: the account service's log line shortens the account id on purpose (the log file never holds
  // the whole id); the log is not shown in the app, like error-log.ts's marked cuts above.
  ['main/account/service.ts', 'profile.sub.slice(0, 8)'],
];

test('no truncation outside the allow-list', () => {
  assert.ok(SHEETS.length > 60, `the scan covers every sheet (${SHEETS.length})`);
  assert.ok(SOURCES.length > 750, `the scan covers every source (${SOURCES.length})`);
  const bad = [];
  for (const f of SHEETS) {
    const src = stripComments(read(f));
    for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const sel = m[1].trim().slice(-100).replace(/\s+/g, ' '), body = m[2];
      if (/text-overflow\s*:\s*ellipsis/.test(body)) bad.push(`${f} :: ${sel} { text-overflow:ellipsis }`);
      if (/(?:-webkit-)?line-clamp\s*:\s*(?!unset|none)/.test(body)) bad.push(`${f} :: ${sel} { line-clamp }`);
    }
  }
  for (const f of SOURCES) {
    const src = stripComments(read(f));
    for (const line of src.split('\n')) {
      if (textOverflowEllipsis(line) || lineClampDecl(line)) {
        bad.push(`${f} :: embedded CSS dots: ${line.trim().slice(0, 100)}`);
        continue;
      }
      if (/\.slice\(0,[^)\n]*\)[^\n;:?]{0,80}…/.test(line) && !ALLOW_JS.some(([file, bit]) => f.endsWith(file) && line.includes(bit)))
        bad.push(`${f} :: slice+… ${line.trim().slice(0, 100)}`);
      if (/\?\s*["']…["']|\+ ["']…["']/.test(line) && !ALLOW_JS.some(([file, bit]) => f.endsWith(file) && line.includes(bit)))
        bad.push(`${f} :: list+… ${line.trim().slice(0, 100)}`);
      if (/textOverflow\s*:\s*['"]ellipsis['"]/.test(line))
        bad.push(`${f} :: textOverflow ellipsis ${line.trim().slice(0, 100)}`);
    }
  }
  assert.equal(bad.length, 0, `no truncation outside the allow-list:\n  ${bad.slice(0, 40).join('\n  ')}${bad.length > 40 ? `\n  … and ${bad.length - 40} more` : ''}`);
});

const textOverflowEllipsis = (line) => /text-overflow\s*:\s*ellipsis/.test(line);
const lineClampDecl = (line) => /(?:-webkit-)?line-clamp\s*:\s*(?!unset|none)/.test(line);

// The allow-list itself is present (the test guards the exceptions, not an empty scan).
test('the allow-list guards real exceptions', () => {
  const agent = read('src/shared/agent-access.ts');
  assert.ok(agent.includes('cut short here'), 'the agent cut marker says where and why');
  assert.ok(read('src/shared/inbox-file.ts').includes('Capture words for the model'), 'model capture stays marked');
  assert.ok(read('src/shared/assistant-memory.ts').includes('the model is asked what to forget'), 'memory facts feed the model');
  assert.ok(read('src/shared/meeting-minutes.ts').includes('The most transcript sent at once'), 'minutes transcripts feed the model');
  assert.ok(read('src/shared/meeting-notes.ts').includes('The most transcript sent at once'), 'notes transcripts feed the model');
  assert.ok(read('src/shared/task-write.ts').includes('What the model is told on a match'), 'match words tell the model');
  assert.ok(read('src/shared/site-publish.ts').includes('p.x.slice'), 'the published search keeps its excerpt markers');
  assert.ok(read('src/shared/snippet.ts').includes('The cuts land on word edges'), 'app snippets cut on word edges (t200)');
  assert.ok(read('src/main/agent-access.ts').includes('p.summary.slice(0, 2499)'), 'agent project payloads cap with a marker');
  assert.ok(read('src/main/agent-full.ts').includes('slice(0, 599)'), 'agent canvas payloads cap with a marker');
  assert.ok(read('src/main/error-log.ts').includes('slice(0, max - 1)'), 'the log file marks its cuts');
  assert.ok(read('src/main/office-edit.ts').includes('workbookOverview'), 'workbook payloads cap with markers');
  assert.ok(read('src/shared/notebook.ts').includes("shown on the chip's hover"), 'citation quotes excerpt first words (t212)');
  assert.ok(read('src/shared/publications.ts').includes('Every item and edition the words are in'), 'archive search excerpts (t212)');
  assert.ok(read('src/main/indexer.ts').includes('SNIPPET_CHARS'), 'index snippets mark their window (t212)');
  assert.ok(read('src/main/agent.ts').includes('edits.slice(0, 6)'), 'cell lists tell the model (t212)');
  assert.ok(read('src/main/agent.ts').includes('call reorganise_project again'), 'rewrite retries tell the model (t212)');
  assert.ok(read('src/main/work/meetings.ts').includes("The agents' tools"), 'meeting lists brief the agent (t212)');
  assert.ok(read('src/main/account/service.ts').includes('this.log(`signed in (${profile.sub.slice(0, 8)}'), 'the sign-in log line shortens the account id');
});

// Menus wrap whole words to three lines at most, never dots, full words on hover (answer 1).
test('menu labels wrap whole words to three lines, never dots', () => {
  const styles = read('src/renderer/src/styles.css');
  const label = styles.match(/\.menu-label \{([^}]*)\}/s)?.[1] ?? assert.fail('no .menu-label rule');
  assert.ok(!/line-clamp/.test(label) && !/text-overflow:\s*ellipsis/.test(label), 'no dots mechanism on the label');
  assert.ok(/overflow-wrap:\s*break-word/.test(label), 'whole words (unbroken names still wrap)');
  assert.ok(/max-height/.test(label), 'three lines at most');
  assert.ok(read('src/renderer/src/components/Menu.tsx').includes('title={item.label}'), 'rows tooltip the full label');
});

// Cut lists read ", and N more", never dots (t212: six person-visible lists cut with … outside the old scan).
test('cut lists read ", and N more", never dots', () => {
  assert.ok(read('src/renderer/src/views/project/ProjectHub.tsx').includes(', and ${names.length - 3} more'), 'changed names say how many more');
  assert.ok(read('src/renderer/src/views/modules/work/MeetingsPage.tsx').includes(', and ${view.people.length - 6} more'), 'the people hint says how many more');
  assert.ok(read('src/main/site-publish.ts').includes(', and ${r.excluded.length - 3} more'), 'left-out notes say how many more');
  assert.ok(read('src/main/pairing/outliner.ts').includes('`, and ${missing.length - 3} more`'), 'missing files say how many more');
  assert.ok(read('src/renderer/src/components/PairedSources.tsx').includes('>And {summary.skipped.length - 10} more.<'), 'the pairing tail reads in words');
});

// The shared one-line and two-line mechanisms: clip without dots, wrap fully.
test('the shared clip utilities match the contract', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  const clip = kit.match(/\.clip \{([^}]*)\}/)?.[1] ?? assert.fail('no .clip rule');
  assert.ok(/white-space:\s*nowrap/.test(clip) && /text-overflow:\s*clip/.test(clip), 'one line, clipped, never dots');
  const clip2 = kit.match(/\.clip-2 \{([^}]*)\}/)?.[1] ?? assert.fail('no .clip-2 rule');
  assert.ok(!/line-clamp/.test(clip2), 'two-line titles wrap fully, never clamped with …');
});

const FILE120U = 'WiremuTeRangiFitzgeraldAssociatesNorthernRegionLtdQuarterlyCateringSupplierInvoiceNovember2026V2FinalPdfCopyForAccounts2';
const CLIENT = 'Wiremu Te Rangi-Fitzgerald & Associates (Northern Region) Ltd';
const LONGNAME = `Quarterly catering review for ${CLIENT} November 2026 final draft for signing`;

// Live: every converted family drawn at the three sizes — wrapped families read whole with no dots
// anywhere, one-line slots clip without dots, and the shortened line says the cut. Before-shots render
// the same page under the pre-pass sheets (HEAD via git show); after-shots under the worktree sheets.
test('live: converted families wrap whole and clip without dots at the three sizes', async (t) => {
  const pw = process.env.NS_PLAYWRIGHT || (process.env.HOME || '') + '/browser-test-tools/node_modules/playwright';
  const { existsSync, mkdirSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const exe = [process.env.NS_CHROMIUM, (process.env.HOME || '') + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'].find((f) => f && existsSync(f));
  if (!existsSync(pw)) { t.skip('no Playwright here'); return; }
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(import.meta.url)(pw);
  const order = [...read('src/renderer/src/main.tsx').matchAll(/import (?:.* from )?'\.\/((?:styles\/)?[^']*\.css)'/g)].map((m) => `src/renderer/src/${m[1]}`);
  assert.ok(order.length > 60 && order[0].endsWith('styles.css') && order[order.length - 1].endsWith('kit.css'), 'sheets in app order');
  const afterCss = order.map((f) => { try { return read(f); } catch { return ''; } }).join('\n');
  // The sheets as they were just before this pass (Vault main cf5cbb424, 11 Nov 2026): HEAD stopped being
  // "before" once the pass was merged, so the before-shots would show no dots and prove nothing.
  const PRE_PASS = 'cf5cbb424';
  let beforeCss = '';
  try {
    beforeCss = order.map((f) => { try { return execFileSync('git', ['show', `${PRE_PASS}:${f}`], { cwd: root, encoding: 'utf8' }); } catch { return ''; } }).join('\n');
  } catch { /* not a checkout: after-shots only */ }
  const sec = (name, inner) => `<section data-sec="${name}"><h3>${name}</h3>${inner}</section>`;
  const html = (css) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}
body{font-family:sans-serif;font-size:14px;background:#fff;color:#1b2235;margin:0;padding:24px;max-width:1100px}
section{margin:0 0 26px}h3{font-size:12px;color:#5f6779;margin:0 0 8px;font-weight:600}
.narrow{width:220px;border:1px solid #e2e7ee;padding:8px}.narrow .clip,.narrow .w2a-clip{display:block}.narrow .chat-model{max-width:100%}.narrow .chat-model span{display:block}</style></head><body>
${sec('menu', `<div class="menu" role="menu" style="position:static;max-width:320px"><button role="menuitem" class="menu-row"><span class="menu-label" title="${FILE120U}">${FILE120U}</span></button><button role="menuitem" class="menu-row"><span class="menu-label" title="${LONGNAME}">${LONGNAME}</span><span class="menu-hint">Ctrl+O</span></button><button role="menuitem" class="menu-row"><span class="menu-label">Open</span></button></div>`)}
${sec('palette', `<div class="picker"><button class="picker-row" title="${LONGNAME}"><span class="picker-label">${LONGNAME}</span><span class="picker-detail">Note · Work</span></button><button class="picker-row" title="${FILE120U}"><span class="picker-label">${FILE120U}</span><span class="picker-detail">Note · ${CLIENT}</span></button></div>`)}
${sec('tasks', `<div class="td-row"><span class="td-row-main"><span class="td-row-what"><span class="td-text" title="${LONGNAME}">${LONGNAME}</span></span></span></div><span class="tkrow-sub" title="2026-10-21 Wiring quote walkthrough for the back room refit with Tom Bradley">2026-10-21 Wiring quote walkthrough for the back room refit with Tom Bradley</span>`)}
${sec('tree', `<div class="tree-row"><span class="tree-name">${LONGNAME}</span></div><div class="tree-row"><span class="tree-name">${FILE120U}</span></div><div class="outline-row"><span class="outline-text">${LONGNAME}</span></div>`)}
${sec('search', `<div class="result"><div class="result-title"><span class="result-name">${LONGNAME}</span></div><div class="result-row"><span class="result-folder">Work/Projects/${CLIENT}/notes</span></div></div><div class="backlink-title">${LONGNAME}</div>`)}
${sec('cards', `<div class="ws-card-title"><span class="ws-cell" title="${LONGNAME}">${LONGNAME}</span></div><div class="home-cell-t">${LONGNAME}</div><div class="sv-tile-title">${LONGNAME}</div><div class="flow-card-title">${LONGNAME}</div><div class="tl-name-words">${LONGNAME}</div><div class="tp-card-desc">${LONGNAME}</div><div class="chat-job-summary">${LONGNAME} ${LONGNAME}</div><div class="notice-body">${LONGNAME}</div><div class="pj-tile-next"><span>${LONGNAME}</span></div><div class="ph-summary"><p>${LONGNAME}</p></div><span class="clip-2" title="${LONGNAME}">${LONGNAME}</span><div class="peek-row-title">${LONGNAME}</div><div class="peek-row-why">${LONGNAME}</div><div class="fh-snippet">${LONGNAME} ${LONGNAME}</div><div class="cv-doc-summary">${LONGNAME}</div><div class="as-type-name">${LONGNAME}</div><div class="hl-tile-sub">${LONGNAME}</div><div class="pb-card-lead">${LONGNAME}</div><div class="dv-what">${LONGNAME}</div><div class="oc-reply">${LONGNAME}</div><div class="nv-page-lead nv-page-lead">${LONGNAME}</div><div class="pj-next-words">${LONGNAME}</div><div class="wu-ws-card-status">${LONGNAME}</div><div class="pf-tile-name">${LONGNAME}</div><div class="ar-project-line">${LONGNAME}</div><div class="pc-sub">${LONGNAME}</div>`)}
${sec('one-line slots', `<div class="narrow"><div class="tab-title" title="${LONGNAME}">${LONGNAME}</div><span class="clip" title="${LONGNAME}">${LONGNAME}</span><div class="w2a-clip" title="${LONGNAME}">${LONGNAME}</div><div class="as-ellipsis" title="${LONGNAME}">${LONGNAME}</div><div class="chat-model" title="${LONGNAME}"><span>${LONGNAME}</span></div></div>`)}
${sec('hero lead', `<div class="w2a-psub"><span class="w2a-clip">${LONGNAME} ${LONGNAME}</span> <button type="button" class="w2a-readmore" aria-expanded="false">Read more</button></div>`)}
${sec('shortened line', `<div class="toast" role="status" style="position:static;transform:none"><span>Renamed the project to “Quarterly catering review for ${CLIENT} November 2026”. That name was shortened to fit.</span></div>`)}
</body></html>`;
  const WRAP = ['.menu-label', '.picker-label', '.picker-detail', '.td-text', '.tkrow-sub', '.tree-name', '.result-name', '.result-folder', '.outline-text', '.backlink-title', '.ws-card-title .ws-cell', '.home-cell-t', '.sv-tile-title', '.flow-card-title', '.tl-name-words', '.tp-card-desc', '.chat-job-summary', '.notice-body', '.pj-tile-next span', '.ph-summary p', '.clip-2', '.peek-row-title', '.peek-row-why', '.fh-snippet', '.cv-doc-summary', '.as-type-name', '.hl-tile-sub', '.pb-card-lead', '.dv-what', '.oc-reply', '.nv-page-lead', '.pj-next-words', '.wu-ws-card-status', '.pf-tile-name', '.ar-project-line', '.pc-sub', '.w2a-psub .w2a-clip'];
  const CLIP = ['.tab-title', '.clip', '.w2a-clip', '.as-ellipsis', '.chat-model span'];
  const shots = path.join(root, '..', 'shots');
  mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    for (const [w, h] of [[1219, 709], [1919, 1199], [3456, 1408]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.setContent(html(afterCss), { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const m = await page.evaluate(({ WRAP, CLIP }) => {
        const out = { bad: [], dots: 0, wrapped: 0, clipped: 0 };
        for (const sel of WRAP) {
          for (const el of document.querySelectorAll(sel)) {
            out.wrapped++;
            const cs = getComputedStyle(el);
            if (cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') { out.dots++; out.bad.push(sel + ' shows …'); continue; }
            if (el.scrollWidth - el.clientWidth > 2) out.bad.push(`${sel} runs past its box (${Math.round(el.scrollWidth - el.clientWidth)}px)`);
          }
        }
        for (const sel of CLIP) {
          for (const el of document.querySelectorAll(sel)) {
            out.clipped++;
            const cs = getComputedStyle(el);
            if (cs.textOverflow !== 'clip') out.bad.push(`${sel} is ${cs.textOverflow}, not clip`);
          }
        }
        return out;
      }, { WRAP, CLIP });
      assert.ok(m.wrapped > 30, `every wrapped family renders (${m.wrapped})`);
      assert.deepEqual(m.bad, [], `${w}x${h}: ` + (m.bad.join('; ') || `${m.wrapped} wrapped whole, ${m.clipped} clip without dots`));
      await page.screenshot({ path: path.join(shots, `after-nodots-${w}x${h}.png`), type: 'png', fullPage: true });
      if (beforeCss) {
        await page.setContent(html(beforeCss), { waitUntil: 'load' });
        await page.waitForTimeout(300);
        const before = await page.evaluate(() => {
          let dots = 0;
          for (const el of document.querySelectorAll('span, div, p')) {
            const cs = getComputedStyle(el);
            if (cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') dots++;
          }
          return dots;
        });
        assert.ok(before > 10, `the before page shows the old dots (${before})`);
        await page.screenshot({ path: path.join(shots, `before-nodots-${w}x${h}.png`), type: 'png', fullPage: true });
      }
    }
  } finally { await browser.close(); }
});
