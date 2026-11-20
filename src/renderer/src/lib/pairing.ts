// The pairing gate (t300, 18 Nov 2026, at 3456x1408 with a Vault on the screen). t254 paired sections
// two-across; pairing by itself makes holes wherever two paired sections differ in height or one is
// empty. Two sections share a row only when pairing leaves no hole; otherwise they flow, reading order
// never moves, and an empty section folds to one quiet line with its add action instead of holding a
// half-page slot. The meeting always reads main plus prep side at wide windows (t300 round 2, 18 Nov
// 2026: "always that shape at wide windows (from about 1600px)"); t301 owns
// MeetingMinutes.tsx's insides and what the prep list picks, the grid and placement are here, and the
// prep caps whole items behind Show all until it fits the main or one window height. One gate for every
// pairing container (the t254 five, the folio overview, the person's overview): it measures the
// children as laid out, simulates the grid's own placement row by row, and stacks the container (its
// narrow layout, full width, same order) when sharing a row would stand a blank wider than a quarter of
// the content and taller than three tenths of it. Stretched boxes report their content, not their
// stretched height, and painted panels read solid. The decision is a pure function of grid-mode
// measurements, so re-measuring converges instead of flapping; the t254 rules themselves stand
// untouched, and rooms that pair cleanly keep pairing exactly as today.
type PairContainer = {
  sel: string;
  kid: string;
  peopleSpan: string | null;
  t254odd: boolean;
  meeting: boolean;
};
const CONTAINERS: PairContainer[] = [
  { sel: '.p87-body', kid: 'section.p87-sec', peopleSpan: null, t254odd: true, meeting: false },
  { sel: '.w3b-page', kid: 'section', peopleSpan: null, t254odd: true, meeting: false },
  { sel: "div[aria-label='Waiting to be filed']", kid: 'div.card', peopleSpan: null, t254odd: true, meeting: false },
  { sel: '.td-else-groups', kid: '*', peopleSpan: null, t254odd: true, meeting: false },
  { sel: '.nv-page .w2b-meeting', kid: 'section', peopleSpan: null, t254odd: true, meeting: true },
  { sel: '.pj-ov', kid: 'section.pj-ov-block', peopleSpan: '.pj-ov-people', t254odd: false, meeting: false },
  { sel: '.pp-ov', kid: 'section.pj-ov-block', peopleSpan: null, t254odd: false, meeting: false },
];
// What counts as a content row: with none of these and under 120 characters a section holds no real
// content (its line and its add action stay; they just never hold a half-page slot).
const ROW_SEL = 'li, .trow, .srcrow, tr, .w2b-prep-line, .mm-row, table, canvas, img, video, textarea, .cm-content';
type Box = { x: number; y: number; w: number; h: number };
const rectOf = (el: Element): Box | null => {
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
};
const tracks = (c: Element): number => {
  const t = getComputedStyle(c).gridTemplateColumns.trim();
  return t === '' || t === 'none' ? 1 : t.split(/\s+/).length;
};
const paints = (el: Element): boolean => {
  const cs = getComputedStyle(el);
  const bg = cs.backgroundColor.replace(/\s+/g, '');
  if (bg !== 'transparent' && bg !== 'rgba(0,0,0,0)' && (bg.indexOf('rgb(') === 0 || (bg.indexOf('rgba(') === 0 && parseFloat(bg.split(',').pop() ?? '') > 0))) return true;
  return parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
};
function isQuiet(el: Element): boolean {
  const words = ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim();
  if (words.length >= 120) return false;
  for (const row of el.querySelectorAll(ROW_SEL)) if (rectOf(row)) return false;
  return true;
}
// Where the content ends: children and bare text lines, so a stretched box reports its content and a
// painted panel reads solid whole.
function contentBottom(el: Element): number {
  const r = el.getBoundingClientRect();
  if (paints(el)) return r.bottom;
  let bottom = r.top;
  for (const child of [...el.children]) {
    const cr = rectOf(child);
    if (cr) bottom = Math.max(bottom, cr.y + cr.h);
  }
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const lr of range.getClientRects()) {
      if (lr.width >= 2 && lr.height >= 2) bottom = Math.max(bottom, lr.bottom);
    }
  } catch {
    // Bare text unreadable: the children above already spoke.
  }
  return Math.max(bottom, r.top);
}
type Kid = { el: Element; x: number; y: number; w: number; h: number; bottom: number; pair: boolean; span: number };
type Hole = { x: number; w: number; y: number; h: number };
// The grid's own placement, row flow: spans take full rows and pairs fill the rest, so dense packing
// (which only backfills partial rows) changes nothing and the simulation stays exact.
function simulateHoles(c: Element, def: PairContainer, ncols: number): { holes: Hole[]; areaW: number; areaH: number } {
  const kids: Kid[] = [];
  // In the grid's own order: a quiet section folds to one line at the end of the grid (CSS order, 20 Nov 2026),
  // so the simulation places the kids as the grid does, by order and then by source.
  const placed = [...c.children].map((el, i) => ({ el, i, order: parseInt(getComputedStyle(el).order, 10) || 0 })).sort((a, z) => a.order - z.order || a.i - z.i);
  for (const { el } of placed) {
    const r = rectOf(el);
    if (!r) continue;
    kids.push({ el, x: r.x, y: r.y, w: r.w, h: r.h, bottom: contentBottom(el), pair: el.matches(def.kid), span: 1 });
  }
  const pairs = kids.filter((k) => k.pair);
  // The odd count's first section spans (its CSS reads :first-of-type, the source's first, wherever order puts it).
  if (def.t254odd && pairs.length % 2 === 1 && pairs.length > 0) {
    const first = [...c.children].find((el) => el.matches(def.kid));
    (pairs.find((k) => k.el === first) ?? pairs[0]).span = ncols;
  }
  if (def.peopleSpan) for (const k of pairs) if (k.el.matches(def.peopleSpan)) k.span = ncols;
  for (const k of kids) if (!k.pair) k.span = ncols;
  // Rows: a spanning kid takes its own row, the rest fill left to right.
  const rows: Kid[][] = [];
  let row: Kid[] = [];
  let col = 0;
  for (const k of kids) {
    if (k.span >= ncols) {
      if (row.length) {
        rows.push(row);
        row = [];
        col = 0;
      }
      rows.push([k]);
      continue;
    }
    row.push(k);
    col += 1;
    if (col >= ncols) {
      rows.push(row);
      row = [];
      col = 0;
    }
  }
  if (row.length) rows.push(row);
  const unspanned = kids.find((k) => k.span < ncols);
  const colW = unspanned ? unspanned.w : c.clientWidth / ncols;
  const gap = parseFloat(getComputedStyle(c).columnGap) || 0;
  const holes: Hole[] = [];
  const main = c.closest('main');
  const areaW = main ? main.clientWidth : c.clientWidth;
  const firstTop = pairs.length ? Math.min(...pairs.map((k) => k.y)) : 0;
  const gridBottom = kids.length ? Math.max(...kids.map((k) => k.y + k.h)) : 0;
  const areaH = Math.max(1, gridBottom - firstTop);
  for (const cells of rows) {
    const rowTop = Math.min(...cells.map((k) => k.y));
    const rowBottom = Math.max(...cells.map((k) => k.y + k.h));
    if (cells.some((k) => k.span >= ncols)) continue;
    // Each column's shortfall under its content; adjacent columns merge across their overlap, and a
    // column with no kid in this row stands the whole band empty.
    const rowX = Math.min(...cells.map((k) => k.x));
    let run: Hole | null = null;
    const flush = () => {
      if (run) holes.push(run);
      run = null;
    };
    for (let i = 0; i < ncols; i++) {
      const k = cells[i] ?? null;
      const top = k ? Math.max(k.bottom, rowTop) : rowTop;
      const shortfall = rowBottom - top;
      if (shortfall > 4) {
        const x = k ? k.x : rowX + i * (colW + gap);
        if (run && Math.abs(run.x + run.w + gap - x) < 8) {
          const overlapTop = Math.max(run.y, top);
          const overlapBottom = Math.min(run.y + run.h, top + shortfall);
          if (overlapBottom - overlapTop > 4) {
            run.y = overlapTop;
            run.h = overlapBottom - overlapTop;
            run.w += gap + (k ? k.w : colW);
            continue;
          }
        }
        flush();
        run = { x, w: k ? k.w : colW, y: top, h: shortfall };
      } else flush();
    }
    flush();
  }
  // Column voids stack across rows (a short column beside a tall one): merge what touches.
  const merged: Hole[] = [];
  for (const h of holes.sort((a, z) => a.y - z.y || a.x - z.x)) {
    const into = merged.find((m) => Math.abs(m.x - h.x) < 8 && Math.abs(m.w - h.w) < 8 && h.y - (m.y + m.h) < 40);
    if (into) into.h = h.y + h.h - into.y;
    else merged.push({ ...h });
  }
  return { holes: merged, areaW, areaH };
}
/** The room as a whole (20 Nov 2026, on a ~2000 px monitor): the gate judged holes between paired sections only, never
 *  the blank under a short list or a dead band beside a narrow column. The same threshold as the pairs' (a quarter
 *  of the room's width by three tenths of its height): the blank under the last content across the room's width,
 *  and each side's blank strip beside it. A room that fails is marked on its scroller, data-fill="short" (a cavern
 *  under it) or data-fill="side" (a dead band beside it), and read back for the walk and the checks. */
export type RoomReport = { w: number; h: number; left: number; right: number; below: number; fill: 'ok' | 'short' | 'side' };
export type PairingReport = { pass: number; containers: { sel: string; mode: string; kids: number; quiet: number; holes: number }[]; room?: RoomReport | null };
const LEAF_MEDIA = 'img, canvas, input, textarea, select, video, svg, iframe, .cm-content';
/** Where the room's content reaches, read from its words and media (never from wrappers that only fill space). */
export function measureRoom(main: Element, limit = 6000): RoomReport | null {
  const whole = main.getBoundingClientRect();
  const band = main.querySelector('.topbar, .view-header')?.getBoundingClientRect();
  const top = band && band.bottom > whole.top && band.bottom < whole.bottom ? band.bottom : whole.top;
  const area = { left: whole.left, right: whole.right, top, bottom: whole.bottom };
  const w = area.right - area.left;
  const h = area.bottom - area.top;
  if (w < 200 || h < 200) return null;
  let l = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  let seen = 0;
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.nextNode() as Element | null; el && seen < limit; el = walker.nextNode() as Element | null) {
    seen += 1;
    if (el.closest('.topbar, .view-header, .toast, [role="dialog"], .menu, .overlay')) continue;
    const leaf = el.matches(LEAF_MEDIA) || [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
    if (!leaf) continue;
    const q = el.getBoundingClientRect();
    if (q.width < 2 || q.height < 2 || q.bottom < area.top || q.top > area.bottom || q.right < area.left || q.left > area.right) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    l = Math.min(l, q.left);
    r = Math.max(r, q.right);
    b = Math.max(b, q.bottom);
  }
  if (r < l) return { w: Math.round(w), h: Math.round(h), left: 0, right: 0, below: Math.round(h), fill: 'short' };
  const left = Math.max(0, l - area.left);
  const right = Math.max(0, area.right - r);
  const below = Math.max(0, area.bottom - b);
  const fill = below > h * 0.3 ? 'short' : Math.max(left, right) > w * 0.25 && Math.abs(left - right) > w * 0.12 ? 'side' : 'ok';
  return { w: Math.round(w), h: Math.round(h), left: Math.round(left), right: Math.round(right), below: Math.round(below), fill };
}
let pass = 0;
function markQuiet(c: Element, def: PairContainer): number {
  let quiet = 0;
  for (const el of [...c.querySelectorAll(`:scope > ${def.kid}`)]) {
    if (rectOf(el) && isQuiet(el)) {
      quiet += 1;
      el.setAttribute('data-quiet', '1');
    } else el.removeAttribute('data-quiet');
  }
  return quiet;
}
// Prep folds whole items behind its Show all door until it fits the side (t300 round 2, 18 Nov
// 2026: the prep side "is never longer than the main column, or one window height when
// the main column is shorter", "capped by count, not cut", "whole items fold behind Show all"). Whole
// person blocks go first from the bottom, then whole source rows; the Show all door and the action
// buttons always stay. One person always stays, so the panel never empties. When the person opens
// Show all the cap lifts (their ask wins). Data attributes only, so capping never re-triggers the gate.
function capPrep(prep: Element, limit: number): number {
  const open = !!prep.querySelector('.w2b-prep-group');
  const persons = [...prep.querySelectorAll('.w2b-prep-person')] as HTMLElement[];
  const sources = [...prep.querySelectorAll('.aians > .srcrow')] as HTMLElement[];
  const label = prep.querySelector('.aians > .glabel');
  const clear = () => {
    for (const el of [...persons, ...sources]) el.removeAttribute('data-hide');
    label?.removeAttribute('data-hide');
  };
  if (open) {
    clear();
    return 0;
  }
  clear();
  if (prep.getBoundingClientRect().height <= limit) return 0;
  let hidden = 0;
  const fits = () => prep.getBoundingClientRect().height <= limit;
  for (let i = sources.length - 1; i >= 0 && !fits(); i--) {
    sources[i].setAttribute('data-hide', '1');
    hidden += 1;
  }
  if (sources.length > 0 && sources.every((s) => s.hasAttribute('data-hide'))) label?.setAttribute('data-hide', '1');
  for (let i = persons.length - 1; i >= 1 && !fits(); i--) {
    persons[i].setAttribute('data-hide', '1');
    hidden += 1;
  }
  return hidden;
}
function evaluateOne(c: HTMLElement, def: PairContainer, meetingWide: boolean): { sel: string; mode: string; kids: number; quiet: number; holes: number } {
  const pairs = [...c.querySelectorAll(`:scope > ${def.kid}`)];
  // The meeting always reads main plus prep side at wide windows (t300 round 2, 18 Nov 2026: "make the meeting page
  // always that shape at wide windows (from about 1600px)", main with
  // agenda, Recording, minutes and the rest, prep a 400px side that "never pushes Record off the first
  // screen"). Presence only, so it never flaps: with prep the grid lands, and the prep caps whole items
  // behind Show all until it fits the main or one window height. Without prep (after, live) the
  // simulation below pairs or stacks on its own merits, as t273's summary beside its note card does.
  if (def.meeting && meetingWide) {
    const quiet = markQuiet(c, def);
    const prep = c.querySelector('section[aria-label="Prep, from your notes"]');
    if (prep && rectOf(prep)) {
      c.removeAttribute('data-pair');
      c.setAttribute('data-layout', 'meeting-main');
      const top = (sel: string): number => c.querySelector(sel)?.getBoundingClientRect().top ?? 0;
      const bottom = (sel: string): number => {
        const r = c.querySelector(sel)?.getBoundingClientRect();
        return r ? r.top + r.height : 0;
      };
      const mainTop = Math.min(top('section[aria-label="Agenda"]') || Infinity, top('section[aria-label="Recording"]') || Infinity, top('section.mm') || Infinity);
      const mainBottom = Math.max(bottom('section[aria-label="Agenda"]'), bottom('section[aria-label="Recording"]'), bottom('section.mm'));
      const mainH = mainBottom > mainTop ? mainBottom - mainTop : prep.getBoundingClientRect().height;
      capPrep(prep, Math.min(Math.max(280, mainH), window.innerHeight));
      return { sel: def.sel, mode: 'meeting-main', kids: pairs.length, quiet, holes: 0 };
    }
    // Prep asked off (or not yet loaded): through to the simulation, which stacks hole-free.
  }
  c.removeAttribute('data-layout');
  // Measure in the grid: below its breakpoint the container is not a grid and there is nothing
  // to decide; stacked, the attributes come off to measure, then the decision lands back.
  c.removeAttribute('data-pair');
  const ncols = tracks(c);
  const quiet = markQuiet(c, def);
  const visible = pairs.filter((el) => rectOf(el));
  if (ncols <= 1 || visible.length < 2) return { sel: def.sel, mode: 'single', kids: pairs.length, quiet, holes: 0 };
  const { holes, areaW, areaH } = simulateHoles(c, def, ncols);
  const needW = areaW * 0.25;
  const needH = Math.max(areaH * 0.3, 120);
  const stack = holes.some((h) => h.w > needW && h.h > needH);
  if (stack) c.setAttribute('data-pair', 'stack');
  return { sel: def.sel, mode: stack ? 'stack' : 'grid', kids: pairs.length, quiet, holes: holes.length };
}
function evaluate(): void {
  pass += 1;
  const report: PairingReport = { pass, containers: [] };
  const meetingWide = window.matchMedia('(min-width: 1600px)').matches;
  for (const def of CONTAINERS) {
    for (const c of [...document.querySelectorAll(`main ${def.sel}`)] as HTMLElement[]) {
      try {
        report.containers.push(evaluateOne(c, def, meetingWide));
      } catch {
        // One container never stops the rest; a missed pass retries on the next change.
      }
    }
  }
  // The room itself, judged at most once a second (a walk of its words; the pairs above are cheap and run on
  // every change).
  const main = document.querySelector('.app main, main');
  const scroller = main?.querySelector('.nv-page-scroll, .vscroll, .settings-scroll, .td-view, .as-scroll') ?? main;
  if (main && Date.now() - lastRoom > 1000) {
    lastRoom = Date.now();
    try {
      roomNow = measureRoom(main);
    } catch {
      roomNow = null;
    }
    if (scroller) {
      if (roomNow && roomNow.fill !== 'ok') scroller.setAttribute('data-fill', roomNow.fill);
      else scroller.removeAttribute('data-fill');
    }
  } else if (!roomLater) {
    // A change inside the second is judged once the second is up, so the last word never goes stale.
    roomLater = true;
    window.setTimeout(() => {
      roomLater = false;
      schedule();
    }, 1000);
  }
  report.room = roomNow;
  (window as unknown as { __nvPairing: PairingReport }).__nvPairing = report;
}
let lastRoom = 0;
let roomLater = false;
let roomNow: RoomReport | null = null;
let scheduled = false;
let lastRun = 0;
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  const wait = Math.max(0, 150 - (Date.now() - lastRun));
  window.setTimeout(() => {
    scheduled = false;
    lastRun = Date.now();
    try {
      evaluate();
    } catch {
      // Measuring never breaks the page: a missed pass retries on the next change.
    }
  }, wait);
}
/** Starts the one pairing gate: every pairing container in the room, watched live. */
export function startPairing(): void {
  if ((window as unknown as { __nvPairingStarted?: boolean }).__nvPairingStarted) return;
  (window as unknown as { __nvPairingStarted?: boolean }).__nvPairingStarted = true;
  schedule();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  new ResizeObserver(schedule).observe(document.body);
  window.matchMedia('(min-width: 2400px)').addEventListener('change', schedule);
  window.matchMedia('(min-width: 1600px)').addEventListener('change', schedule);
}
