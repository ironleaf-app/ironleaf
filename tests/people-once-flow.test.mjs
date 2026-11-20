// node --test tests/people-once-flow.test.mjs — the People flow live, with real input (9 Nov 2026, one person
// one page). A made-up vault with one duplicate pair (the same email): People shows These look like the same person
// with the reason and what a merge moves, one tap merges, and Undo brings the pair back. Real CDP input only, never
// synthetic page events. Made-up people only, never a real vault.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { startHarness } from './vault-controls-harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(h, js, ms = 120000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await h.browser.ev(js)) return true;
    } catch {}
    if (Date.now() - t0 > ms) return false;
    await sleep(500);
  }
}
async function findWords(h, words, scope = '') {
  return h.browser.ev(`(function () {
    const SEL = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"]';
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'};
    if (!root) return null;
    const els = [...root.querySelectorAll(SEL)].filter(vis);
    const el = els.find((e) => ((e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
}
const tap = async (h, x, y) => {
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
};

let H = null;
after(async () => {
  await H?.close().catch(() => {});
  H = null;
});

test('People flow live: duplicates show with preview, one tap merges, Undo brings them back', { timeout: 300000 }, async () => {
  H = await startHarness();
  await H.services.vault.createText('People/Casey Lee.md', '---\ntype: person\nrole: Owner\norg: Harbourline\nemail: casey.lee@example.com\n---\n# Casey Lee\n').catch(() => {});
  await H.services.vault.createText('People/Casey Lee Work.md', '---\ntype: person\nemail: casey.lee@example.com\n---\n# Casey Lee Work\n').catch(() => {});
  await H.services.vault.createText('Projects/Harbour.md', '---\ntype: project\nstatus: active\nowner: Casey Lee\n---\n# Harbour\n\n## People\n\n- **Casey Lee Work** — Joinery\n\n## What\'s next\n\n- [ ] Send quote — Casey Lee Work\n').catch(() => {});
  await H.services.vault.createText('Notes/Quote.md', '# Quote\n\nDraft for [[Casey Lee Work]] to review.\n').catch(() => {});
  await H.services.rescan('People/Casey Lee.md');
  await H.services.rescan('People/Casey Lee Work.md');
  await H.services.rescan('Projects/Harbour.md');
  await H.services.rescan('Notes/Quote.md');
  await H.services.rescanAll();
  await H.browser.send('Page.navigate', { url: `${H.origin}/harness.html` });
  assert.ok(await waitFor(H, `!!document.querySelector('.app')`), 'the app opens');
  await sleep(2000);
  const people = await findWords(H, 'People', '.sidebar.left, aside');
  assert.ok(people, 'People in the side bar');
  await tap(H, people.x, people.y);
  assert.ok(await waitFor(H, `!!document.querySelector('section[aria-label="These look like the same person"]')`), 'These look like the same person shows');
  const pairWords = await H.browser.ev(`(document.querySelector('section[aria-label="These look like the same person"]')?.innerText ?? '').replace(/\\s+/g, ' ')`);
  assert.ok(pairWords.includes('Casey Lee Work') && pairWords.includes('Casey Lee'), `the pair reads (${JSON.stringify(pairWords.slice(0, 200))})`);
  assert.ok(pairWords.includes('Both give casey.lee@example.com'), `the same-email reason reads (${JSON.stringify(pairWords.slice(0, 200))})`);
  assert.ok(pairWords.includes('Moves') && pairWords.includes('note') && pairWords.includes('task owned'), `the preview reads (${JSON.stringify(pairWords.slice(0, 300))})`);
  const merge = await findWords(H, 'Merge into Casey Lee', 'main');
  assert.ok(merge, 'one-tap Merge into the kept card');
  await tap(H, merge.x, merge.y);
  assert.ok(await waitFor(H, `(async () => (await window.nv.life.people.same()).length === 0)()`), 'one tap merges (no pairs left)');
  const words = await H.browser.ev(`(async () => (await window.nv.life.people.mergeUndo()).words)()`);
  assert.match(words, /its own card again/, 'Undo brings the pair back');
  assert.ok(await waitFor(H, `(async () => (await window.nv.life.people.same()).some((s) => s.keepName.includes('Casey Lee') && s.otherName.includes('Casey Lee')))()`), 'the pair is offered again after Undo');
});
