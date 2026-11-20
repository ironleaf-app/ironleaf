// node --test tests/feel-motion.test.mjs — one calm motion language (5 Nov 2026 feel-motion: "our bots are too
// mechanical and robotic"). Vault's half: one timing token set, one shimmer, one pulse and one spinner, the toast's
// shell in one file, toasts/menus/dialogs/pickers fading out instead of vanishing, replies streaming smoothly, tab
// and list reorders gliding, and the task tick landing as one beat. Each failing check fails without its fix.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('one timing language: the tokens exist and the old attempts are gone', () => {
  const feel = read('src/renderer/src/styles/feel.css');
  for (const t of ['--nv-motion-fast: 120ms', '--nv-motion-base: 160ms', '--nv-motion-slow: 200ms', '--nv-ease-enter: cubic-bezier(0.2, 0.7, 0.2, 1)', '--nv-ease-fade: ease-out', '--nv-pulse: 1.6s', '--nv-shimmer: 1.4s', '--nv-spin: 0.8s']) {
    assert.ok(feel.includes(t), `feel.css defines ${t}`);
  }
  assert.ok(!feel.includes('--ease-settle'), 'the one-use settle easing is the shared enter easing now');
  const shell = read('src/renderer/src/styles/app-shell.css');
  assert.ok(!shell.includes('--move') && !shell.includes('--ease-out'), 'app-shell rides the shared tokens now');
  assert.ok(!feel.includes('Imported last'), 'the stale "imported last" comment says where feel really loads');
});

test('one shimmer, one pulse, one spinner: the duplicate keyframes are gone', () => {
  const files = ['src/renderer/src/styles.css', ...readdirSync(path.join(root, 'src/renderer/src/styles')).filter((f) => f.endsWith('.css')).map((f) => `src/renderer/src/styles/${f}`)];
  const all = files.map((f) => `/* ${f} */\n${read(f)}`).join('\n');
  for (const dead of ['fc-shimmer', 'peek-shimmer', 'pf-shimmer', 'as-shimmer', 'pc-shimmer', 'au-shimmer', 'td-shimmer', 'chat-attach-spin', 'pf-remote-spin', 'sx-spin', 'ma-spin', 'mr-spin', 'flow-spin', 'pb-spin', 'wr-spin', 'rp-pulse', 'w4b-pulse', 'nb-dot', 'boot-breathe', 'chat-job-pulse']) {
    // Class names (.sx-spinner, .ma-spinner…) stay; keyframes and their uses go.
    const uses = [...all.matchAll(new RegExp(`(@keyframes ${dead}|animation: ${dead}[ ;])`, 'g'))];
    assert.equal(uses.length, 0, `${dead} has no keyframes and no uses left`);
  }
  assert.ok(all.includes('@keyframes nv-pulse') && all.includes('@keyframes nv-spin') && all.includes('@keyframes nv-shimmer'), 'the one pulse, spin and shimmer exist');
  const infinite = [...all.matchAll(/animation: ([a-z0-9-]+) ([^;]*?infinite[^;]*)/gi)];
  assert.ok(infinite.length >= 25, `${infinite.length} infinite loops found`);
  for (const [, name, rest] of infinite) {
    assert.ok(/var\(--nv-(pulse|shimmer|spin)\)/.test(rest), `${name} rides a loop token (${rest.trim().slice(0, 60)})`);
  }
});

test('the thinking dots are one pattern at the shared pulse', () => {
  const css = read('src/renderer/src/styles.css');
  assert.ok(css.includes('animation: chat-dot var(--nv-pulse) infinite ease-in-out'), 'chat-dot runs at the shared pulse');
  const nb = read('src/renderer/src/styles/notebook.css');
  assert.ok(nb.includes('animation: chat-dot var(--nv-pulse)'), 'the notebook busy dots are the one dots pattern');
});

test('one owner each for the toast shell and the menu shell', () => {
  const styles = read('src/renderer/src/styles.css');
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(!/^\.toast \{/m.test(styles), 'styles.css no longer draws the toast shell');
  assert.ok(!/^\.menu \{/m.test(styles), 'styles.css no longer draws the menu shell');
  assert.ok(!styles.includes('@keyframes rise-in'), 'styles.css no longer defines the losing rise-in');
  const toast = kit.match(/^\.toast \{([^}]*)\}/ms)?.[1] ?? assert.fail('no kit toast rule');
  assert.ok(toast.includes('bottom: 28px') && toast.includes('max-width: min(600px') && toast.includes('animation: rise-in var(--nv-motion-base) var(--nv-ease-enter)'), 'the kit toast keeps the measures and rises on tokens');
  const menu = kit.match(/^\.menu \{([^}]*)\}/ms)?.[1] ?? assert.fail('no kit menu rule');
  assert.ok(menu.includes('position: fixed') && menu.includes('z-index: 60') && menu.includes('max-width: 320px') && menu.includes('min-width: 218px'), 'the kit menu keeps the measures in one rule');
});

test('shared entrances ride the tokens', () => {
  const styles = read('src/renderer/src/styles.css');
  for (const [sel, want] of [
    ['.dialog {', 'rise-in var(--nv-motion-base) var(--nv-ease-enter)'],
    ['.settings {', 'rise-in var(--nv-motion-base) var(--nv-ease-enter)'],
    ['.recovery {', 'rise-in var(--nv-motion-base) var(--nv-ease-enter)'],
    ['.hover-card {', 'rise-in var(--nv-motion-fast) var(--nv-ease-enter)'],
  ]) {
    const at = styles.indexOf(sel);
    assert.ok(at >= 0, `${sel} exists`);
    assert.ok(styles.slice(at, at + 800).includes(want), `${sel} rides ${want}`);
  }
});

test('toasts leave: a leaving phase, not a vanish', () => {
  const store = read('src/renderer/src/state/store.ts');
  assert.ok(store.includes('leaving?: boolean'), 'the toast state carries a leaving phase');
  assert.ok(store.includes('leaving: true') && store.includes('}, 140)'), 'the end fades for 120ms, then unmounts');
  assert.ok(store.includes("matchMedia('(prefers-reduced-motion: reduce)'"), 'without movement the toast goes at once');
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes("data-nv-leaving={toastState.leaving ? 'true' : undefined}"), 'the toast wears the leaving mark');
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes('@keyframes nv-leave'), 'the kit defines the one exit');
  assert.ok(kit.includes("[data-nv-leaving='true']"), 'one leaving rule for anything taken away');
});

test('menus, modals, pickers and dialogs leave through one hook', () => {
  assert.ok(read('src/renderer/src/lib/useLeaving.ts').includes('setTimeout(() => setHeld(null), ms)'), 'useLeaving holds the closing value for its fade');
  const menu = read('src/renderer/src/components/Menu.tsx');
  assert.ok(menu.includes('useLeaving(state)') && menu.includes("data-nv-leaving={leaving ? 'true' : undefined}"), 'a closing menu fades');
  assert.ok(menu.includes('if (leaving) return;'), 'a fading menu ignores keys');
  const app = read('src/renderer/src/App.tsx');
  assert.ok(app.includes('ModalLayer') && app.includes('useLeaving(modal)'), 'every full-window modal fades through one layer');
  const pickers = read('src/renderer/src/components/Pickers.tsx');
  assert.ok(pickers.includes('useLeaving(p)') && pickers.includes('nv-leave-wrap'), 'a hosted picker fades');
  const dialogs = read('src/renderer/src/components/Dialogs.tsx');
  assert.ok(dialogs.includes('useLeaving(ask)') && dialogs.includes("data-nv-leaving={held.leaving ? 'true' : undefined}"), 'a small dialog fades');
  assert.ok(dialogs.includes('if (held.leaving) return;'), 'a fading dialog cannot answer twice');
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes(".nv-leave-wrap[data-nv-leaving='true'] > *"), 'a held group fades its overlay');
});

test('the chat stream eases bursts in like the host app', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(panel.includes('useSmoothText(message.content, !!message.pending)'), 'a streaming answer shows smoothed words');
  assert.ok(panel.includes('renderMarkdown(shown,'), 'the smoothed words are what render');
});

test('tab and list reorders glide', () => {
  const ws = read('src/renderer/src/views/Workspace.tsx');
  assert.ok(ws.includes('viewMove(() => setWorkspace((ws) => W.moveTab'), 'a tab reorder runs inside a View Transition');
  assert.ok(ws.includes('viewTransitionName: `tab-${tab.id}`'), 'each tab keeps its own transition name');
  const ly = read('src/renderer/src/views/project/LayoutEdit.tsx');
  assert.ok(ly.includes('viewMove(() => onMove?.(from, over, after))'), 'a checklist reorder glides too');
  assert.ok(ly.includes('viewTransitionName:'), 'its rows keep names');
  const lib = read('src/renderer/src/lib/viewMove.ts');
  assert.ok(lib.includes('startViewTransition') && lib.includes('flushSync') && lib.includes('prefers-reduced-motion'), 'without the API or movement it lands at once');
});

test('a tick lands as one beat', () => {
  const today = read('src/renderer/src/styles/today.css');
  assert.ok(today.includes('transition: background var(--nv-motion-base) ease, opacity var(--nv-motion-base) ease;'), 'the row fades over the shared 160ms, not 300ms');
  assert.ok(!today.includes('opacity 0.3s') && !today.includes('opacity: 0.3s') && !today.includes('0.3s ease'), 'no 300ms drift left on the row');
  assert.ok(today.includes('td-strike-in') && today.includes('text-decoration-color: transparent'), 'the strike draws in with the beat');
});

test('reduced motion has one documented mechanism', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(kit.includes('the one mechanism') && kit.includes('@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }'), 'the kit keeps the single global kill, documented');
  assert.ok(kit.includes('::view-transition-group(*)'), 'View Transitions still when movement is off');
  const settings = read('src/renderer/src/styles/settings-87.css');
  assert.ok(!settings.includes('prefers-reduced-motion'), 'the duplicate kill in settings-87 is gone');
});

// smoothStep on its own clock: the pure frame step behind useSmoothText.
const work = mkdtempSync(path.join(tmpdir(), 'nv-smooth-'));
let S;
before(async () => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href);
  const entry = path.join(work, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/renderer/src/lib/smoothText.ts'))};\n`);
  await build({ input: entry, platform: 'node', output: { file: path.join(work, 's.mjs'), format: 'esm' }, logLevel: 'silent' });
  S = await import(pathToFileURL(path.join(work, 's.mjs')).href);
});
after(() => rmSync(work, { recursive: true, force: true }));

test('smoothStep eases a burst in within frames', () => {
  assert.equal(S.smoothStep(0, 100), 10, 'about a tenth of the remainder per frame');
  assert.equal(S.smoothStep(0, 5), 2, 'at least two characters, so short bursts visibly move');
  assert.equal(S.smoothStep(98, 100), 100, 'the tail lands whole');
  assert.equal(S.smoothStep(0, 5000), 4600, 'a huge burst jumps near the goal, then eases');
  assert.equal(S.smoothStep(100, 100), 100, 'nothing left shows nothing new');
  assert.equal(S.smoothStep(120, 100), 120, 'a shorter goal never rewinds the count');
});
