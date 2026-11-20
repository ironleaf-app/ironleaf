// One page frame (8.0 U6): every page of Ironleaf draws its title through the one page header (PageHead, or the
// .nv-page-title class inside a .nv-page-head), never its own <h1>, so every title has the former host app's size
// and place. Exceptions: the note's own title (DocHead, a document heading), the lock and set-up cards of Private
// notes and Secrets (a card in the middle of the page, not a page head), and Home's greeting (a greeting, not a
// title: Home's title is in the top bar). The 8.7 wave-2a screens (Projects, project, Tasks, Inbox) draw the
// mock-ups' own title shape instead (30 Oct 2026): one shared .w2a-title class, so those titles still share one size
// and place and never their own <h1> each. The 8.7 w4a screens (Secrets, Private notes, Recently deleted, Import,
// Earlier versions) draw the mock-ups' own title shape instead (30 Oct 2026): one shared .w4a-title class, so those
// titles still share one size and place and never their own <h1> each. Secrets' lock and set-up cards draw the
// mock-ups' lock card (.lockwrap) instead of the old pv-card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const views = path.join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'views');
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.tsx')) files.push(p); } };
walk(views);

test('every page title is the one page header', () => {
  const bad = [];
  for (const f of files) {
    if (f.endsWith('HomeView.tsx')) continue;
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/<h1(\s[^>]*)?>/g)) {
      const attrs = m[1] ?? '';
      if (/nv-page-title|doc-head-title|w2a-title|w4a-title|vtitle/.test(attrs)) continue;
      const before = text.slice(Math.max(0, m.index - 400), m.index);
      if (/className="pv-card|pv-card sx-lock|lockwrap/.test(before)) continue;
      bad.push(`${path.relative(views, f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the wave-2a screens share one title shape, not one each', () => {
  // The w2a exception above stays honest only while every w2a title is the same class, drawn once in w2a.css.
  const css = readFileSync(path.join(views, '..', 'styles', 'w2a.css'), 'utf8');
  assert.match(css, /\.w2a-title \{[^}]*font-size: var\(--fs-page\)/, 'one title size for the w2a screens');
  for (const f of ['InboxPage.tsx', 'ProjectsHome.tsx', 'TasksView.tsx', 'ProjectPage.tsx']) {
    const text = readFileSync(path.join(views, f), 'utf8');
    for (const m of text.matchAll(/<h1(\s[^>]*)?>/g)) assert.match(m[1] ?? '', /w2a-title/, `${f} titles are the shared shape`);
  }
});

test('the w4a screens share one title shape, not one each', () => {
  // The w4a exception above stays honest only while every w4a title is the same class, drawn once in settings-87.css.
  const css = readFileSync(path.join(views, '..', 'styles', 'settings-87.css'), 'utf8');
  assert.match(css, /\.w4a-title \{[^}]*font-size: var\(--fs-page\)/, 'one title size for the w4a screens');
  for (const f of ['BinView.tsx', 'ImportView.tsx', 'PrivateView.tsx', 'SecretsView.tsx']) {
    const text = readFileSync(path.join(views, f), 'utf8');
    for (const m of text.matchAll(/<h1(\s[^>]*)?>/g)) {
      const before = text.slice(Math.max(0, m.index - 400), m.index);
      if (/pv-card|lockwrap/.test(before)) continue; // lock and set-up cards, not page heads
      assert.match(m[1] ?? '', /w4a-title/, `${f} titles are the shared shape`);
    }
  }
  // Earlier versions draws the same shape from components (the main test walks views only).
  const versions = readFileSync(path.join(views, '..', 'components', 'Extras.tsx'), 'utf8');
  for (const m of versions.matchAll(/<h1(\s[^>]*)?>/g)) assert.match(m[1] ?? '', /w4a-title/, 'Extras titles are the shared shape');
});

// The wave-2b screens (Notes, meetings, people) draw the kit's own shared title (.vtitle, as Home's greeting does).
test('the wave-2b titles share the kit title, not one each', () => {
  // The vtitle exception above stays honest only while every vtitle is the kit's one title shape.
  const kit = readFileSync(path.join(views, '..', 'styles', 'kit.css'), 'utf8');
  assert.match(kit, /h1\.vtitle \{[^}]*font-size: var\(--fs-page\)/, 'one title size for the vtitle screens');
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/<h1(\s[^>]*)?>/g)) {
      const attrs = m[1] ?? '';
      if (!/vtitle/.test(attrs)) continue;
      assert.match(attrs, /vtitle/, `${path.relative(views, f)} titles are the shared shape`);
      assert.ok(!/font-size/.test(attrs), `${path.relative(views, f)} sets no size of its own`);
    }
  }
});
