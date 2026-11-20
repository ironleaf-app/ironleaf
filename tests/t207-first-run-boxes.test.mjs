// node --test tests/t207-first-run-boxes.test.mjs — every Vault box with long real words (t207, 10 Nov 2026). The
// shared mechanisms, not one place: the small questions (components/Dialogs.tsx, one at a time from their queue)
// wrap a 120-character name and a long reason; the toast wraps instead of running past its box; menus wrap long
// rows with the full name on hover; tips wrap within the window; failures read through errorMessage, and a bare
// value or a status becomes one calm line. Static scans plus the plain-error units always run; the shipped kit CSS
// is measured live in Chromium at 3456x1408, 1920x1117 and 1219x709 with pictures in ../shots/. Each check
// fails without its fix.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const kit = read('src/renderer/src/styles/kit.css');
const styles = read('src/renderer/src/styles.css');
const dialogs = read('src/renderer/src/components/Dialogs.tsx');
const menuSrc = read('src/renderer/src/components/Menu.tsx');

const FILE120U = 'WiremuTeRangiFitzgeraldAssociatesNorthernRegionLtdQuarterlyCateringSupplierInvoiceNovember2026V2FinalPdfCopyForAccounts2';
const CLIENT = 'Wiremu Te Rangi-Fitzgerald & Associates (Northern Region) Ltd';

test('the small questions wrap long words and queue behind each other', () => {
  assert.match(kit, /\.dlg h2, \.dialog h2 \{[^}]*overflow-wrap: anywhere/, 'a long dialog title wraps, even unbroken');
  assert.match(styles, /\.dialog-message \{[^}]*overflow-wrap: anywhere/, 'a long dialog reason wraps, even unbroken');
  assert.match(kit, /\.dialog-actions \{[^}]*flex-wrap: wrap/, 'long dialog buttons wrap instead of running past the box');
  assert.ok(dialogs.includes('() => queue[0] ?? null'), 'one question shows at a time');
  assert.ok(dialogs.includes('queue = queue.slice(1)'), 'answering brings the next question');
  assert.equal(FILE120U.length, 120, 'the unbroken name is 120 characters');
});

test('toasts, menus and tips wrap long names', () => {
  const toast = kit.match(/^\.toast \{([^}]*)\}/ms)?.[1] ?? assert.fail('no kit toast rule');
  assert.ok(!/white-space:\s*nowrap/.test(toast) && /overflow-wrap: anywhere/.test(toast), 'the toast wraps long words');
  assert.match(kit, /\.toast > span \{[^}]*min-width: 0/, 'its words shrink inside the row');
  assert.match(kit, /\.toast button, \.toast \.toast-action \{[^}]*flex: none; white-space: nowrap/, 'its action stays whole on one line');
  assert.match(kit, /\.menu \.menu-label \{[^}]*min-width: 0[^}]*overflow-wrap: break-word/, 'a long menu row wraps to whole words inside the 320px menu');
  assert.ok(menuSrc.includes('title={item.label}'), 'a menu row keeps its full name on hover');
  const tip = kit.match(/^\.tip \{([^}]*)\}/ms)?.[1] ?? assert.fail('no kit tip rule');
  assert.ok(!/white-space:\s*nowrap/.test(tip) && /overflow-wrap: anywhere/.test(tip), 'a long tip wraps');
  assert.ok(/max-width: min\(420px/.test(tip), 'and stops inside the window');
});

let E, work;
before(async () => {
  work = mkdtempSync(path.join(tmpdir(), 'nv-t207boxes-'));
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export { errorMessage } from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/errors.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 'e.mjs'), format: 'esm' }, logLevel: 'silent' });
  E = await import(pathToFileURL(path.join(work, 'e.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('a bare value or a status becomes one calm line; plain words pass', () => {
  const CALM = 'Something didn’t work just then.';
  for (const said of ['undefined', 'null', '[object Object]', 'HTTP 500 Internal Server Error', 'Request failed with status code 500']) {
    assert.equal(E.errorMessage(new Error(said)), CALM, JSON.stringify(said) + ' becomes one calm line');
  }
  assert.equal(E.errorMessage('That note is too big to open as a note.'), 'That note is too big to open as a note.');
  assert.equal(E.errorMessage('That task isn’t in its note any more.'), 'That task isn’t in its note any more.');
  assert.equal(E.errorMessage('a plain string failure'), 'a plain string failure');
  assert.equal(E.errorMessage(new Error('ENAMETOOLONG: file name too long, rename')), 'That name is too long.', 'a too-long rename names the name (t212)');
});

test('live: the shipped boxes fit long words at the three sizes', async (t) => {
  const pw = process.env.NS_PLAYWRIGHT || (process.env.HOME || '') + '/browser-test-tools/node_modules/playwright';
  const exe = [process.env.NS_CHROMIUM, (process.env.HOME || '') + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'].find((f) => f && existsSync(f));
  if (!existsSync(pw)) { t.skip('no Playwright here'); return; }
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(import.meta.url)(pw);
  const palettes = read('src/renderer/src/styles/palettes.css');
  const html = (extra) => `<!doctype html><html><head><meta charset="utf-8"><style>${palettes}\n${kit}\n${styles}</style>${extra || ''}</head><body>
    <div class="overlay"><div class="dialog small" role="dialog" aria-modal="true"><h2>Move ${FILE120U} to the Bin?</h2><div class="dialog-message">Move “${FILE120U}” for ${CLIENT} to the Bin? You can bring it back within 30 days.</div><div class="dialog-actions"><button class="button">Keep it</button><button class="button danger">Move ${CLIENT} to the Bin</button></div></div></div>
    <div class="toast" role="status"><span>Could not move “${FILE120U}” for ${CLIENT}. Try again.</span><button class="toast-action">Retry</button></div>
    <div class="menu" role="menu" style="left: 24px; top: 24px;"><button role="menuitem" class="menu-row"><span class="menu-icon"></span><span class="menu-label">${FILE120U}</span></button><button role="menuitem" class="menu-row"><span class="menu-icon"></span><span class="menu-label">Quarterly catering review for ${CLIENT} November 2026 final draft for signing</span><span class="menu-hint">Ctrl+O</span></button></div>
    <div class="tip" style="left: 48px; top: 200px;">${FILE120U}</div>
    <div class="tip" style="left: 48px; top: 400px;">${'UnbrokenReference'.repeat(14)}</div>
  </body></html>`;
  const shots = path.join(root, '..', 'shots');
  mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    for (const [w, h] of [[3456, 1408], [1920, 1117], [1219, 709]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.setContent(html(), { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const out = { vw: innerWidth, vh: innerHeight, bad: [] };
        const check = (name, el, inner) => {
          const r = el.getBoundingClientRect();
          if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) out.bad.push(name + ' leaves the window');
          for (const e of [el, ...el.querySelectorAll('h2,.dialog-message,.dialog-actions,.menu-label,.tip,span')]) {
            if (e.scrollWidth - e.clientWidth > 2) out.bad.push(name + ' runs past its box (' + Math.round(e.scrollWidth - e.clientWidth) + 'px)');
          }
        };
        check('dialog', document.querySelector('.dialog.small'));
        check('toast', document.querySelector('.toast'));
        check('menu', document.querySelector('.menu'));
        document.querySelectorAll('.tip').forEach((el, i) => check('tip' + (i + 1), el));
        return out;
      });
      assert.deepEqual(m.bad, [], `${w}x${h}: ` + (m.bad.join('; ') || 'every box fits'));
      await page.screenshot({ path: path.join(shots, `after-vault-boxes-${w}x${h}.png`), type: 'png' });
    }
  } finally { await browser.close(); }
});
