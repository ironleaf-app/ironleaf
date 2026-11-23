// Balanced columns (layout round 2, 20 Nov 2026). on a real vault: Today stood every section in its left column, far
// below the fold, and its right column held one heading for the whole height. A page that reads in two columns now says
// which sections belong to each (pinned: the work at the left, the day at the right) and which can stand in either (the
// rest); each of those goes to whichever column is shorter at that moment, measured, the tallest first. The columns then
// end at about the same height and neither is near-empty while the other runs on. Narrower than `min` (the frame's own
// width, so the right chat column and a folded side bar are counted), the page reads in one column in source order: the
// first column, then the second, then the rest. A section is placed once per set of sections and frame width (never
// re-placed because its own height changed), so a section whose height changes with its column's width never flips back
// and forth.
//
// A tail (wide-window pass, 23 Nov 2026, at 2560 with the chat column open: the work column ran ~600 px past the
// day's, a dead band under the day): one long block that reads under both columns, across the frame, its own rows
// flowing in balanced columns inside it (CSS multi-column, so the two halves always end together). The columns above
// it then only have to balance their shorter blocks, and nothing tall is left to stand alone in one of them. In three
// columns it spans the first two, the third column running the full height beside both. Narrow, it reads straight
// after the first column, where it belongs in the one-column order.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface BalanceItem {
  key: string;
  node: ReactNode;
}

export function Balance({ a, b, rest, foot, tail, min = 1180, min3, onColumns, className = '' }: { a: ReactNode; b: ReactNode; rest: BalanceItem[]; foot?: ReactNode; /** One long block under both columns, across them (see above). */ tail?: ReactNode; min?: number; /** From this frame width (round 3, a user's 3440 ultrawide) a third column holds the movable sections, balanced with the second. */ min3?: number; onColumns?(n: 1 | 2 | 3): void; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Record<string, 'a' | 'b' | 'c'>>({});
  const [two, setTwo] = useState(false);
  const [three, setThree] = useState(false);
  const sigRef = useRef('');
  const redoRef = useRef(0);
  const keys = rest.map((r) => r.key).join('|');

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const wide = el.clientWidth >= min;
      const third = wide && min3 !== undefined && el.clientWidth >= min3;
      setTwo(wide);
      setThree(third);
      if (!wide) return;
      const pinA = el.querySelector<HTMLElement>(':scope > .nv-bal-col.is-a > .nv-bal-pin');
      const pinB = el.querySelector<HTMLElement>(':scope > .nv-bal-col.is-b > .nv-bal-pin');
      let ha = pinA?.offsetHeight ?? 0;
      let hb = pinB?.offsetHeight ?? 0;
      // Three columns: the tail spans the first two, so the third balances against the two and the tail together.
      const tailH = third ? (el.querySelector<HTMLElement>(':scope > .nv-bal-tail')?.offsetHeight ?? 0) : 0;
      ha += tailH;
      hb += tailH;
      // The foot stands at the end of the day's column (the third's, in three): counted, so a short movable block
      // goes to the other column rather than leaving the work column a foot short (wide-window pass).
      const footH = el.querySelector<HTMLElement>(':scope > .nv-bal-col > .nv-bal-foot')?.offsetHeight ?? 0;
      if (!third) hb += footH;
      // A section is placed once for a given set of sections and frame width: moving it changes its own height (its
      // column's width differs) and remounts it, so re-placing on every resize would chase its own tail (seen on the
      // owner's vault: sections flipping columns, their fade-in restarting forever). A new set, a new width bucket,
      // or a section that had no height yet is (re)placed; the rest stay put.
      const sig = `${keys}|${third ? 3 : 2}|${Math.round(el.clientWidth / 64)}|${Math.round(ha / 160)}|${Math.round(hb / 160)}`;
      if (sig !== sigRef.current) redoRef.current = 0;
      const pinsA = ha, pinsB = hb;
      const items = [...el.querySelectorAll<HTMLElement>('[data-bal-key]')].map((item) => ({ k: item.dataset.balKey!, h: item.offsetHeight }));
      // The tallest sections are placed first, each in the shorter column (a greedy pass in source order lets one tall
      // block land last on the longer side); each column still reads in source order. Three columns: the movable
      // sections go to whichever of the three is shortest (the third starts empty, so it takes them first; a short day
      // of work takes the rest under it, never a blank half-column on a user's 3440).
      const lay = (keep: boolean) => {
        let a = pinsA, b = pinsB, c = third ? footH : Infinity;
        const out: Record<string, 'a' | 'b' | 'c'> = {};
        const free: { k: string; h: number }[] = [];
        const add = (s: 'a' | 'b' | 'c', h: number) => (s === 'a' ? (a += h) : s === 'b' ? (b += h) : (c += h));
        for (const { k, h } of items) {
          const was = place[k];
          if (keep && was && (third || was !== 'c')) {
            out[k] = was;
            add(was, h);
          } else if (h) free.push({ k, h });
        }
        free.sort((x, y) => y.h - x.h);
        for (const { k, h } of free) {
          const s = third ? (c <= b && c <= a ? 'c' : b <= a ? 'b' : 'a') : a <= b ? 'a' : 'b';
          out[k] = s;
          add(s, h);
        }
        return { out, a: third ? Math.min(a, c) : a, b: third ? Math.max(b, c, a) : b };
      };
      // Placed sections stay put (moving one changes its height and remounts it, which re-placing on every resize
      // would chase forever: seen on the vault, sections flipping columns with their fade replaying). Only a new
      // set, a new width, or columns that ended far apart (more than a quarter of the taller, and 240 px) as the
      // sections filled in are laid out afresh, twice at most per set and width.
      let laid = lay(sig === sigRef.current);
      sigRef.current = sig;
      const gap = Math.abs(laid.a - laid.b);
      if (gap > Math.max(240, Math.max(laid.a, laid.b) / 4) && redoRef.current < 2) {
        const fresh = lay(false);
        if (Math.abs(fresh.a - fresh.b) < gap) {
          laid = fresh;
          redoRef.current++;
        }
      }
      const next = laid.out;
      if (Object.keys(next).some((k) => next[k] !== place[k])) setPlace(next);
    };
    const ask = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const ro = new ResizeObserver(ask);
    ro.observe(el);
    for (const c of el.querySelectorAll('.nv-bal-pin, .nv-bal-tail, .nv-bal-foot, [data-bal-key]')) ro.observe(c);
    ask();
    return () => {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [keys, min, min3, place, two, three]);
  useLayoutEffect(() => onColumns?.(!two ? 1 : three ? 3 : 2), [two, three, onColumns]);

  const side = (s: 'a' | 'b' | 'c') => rest.filter((r) => two && (place[r.key] ?? (three ? 'c' : 'a')) === s && (three || s !== 'c'));
  const wrap = (r: BalanceItem) => (
    <div key={r.key} className="nv-bal-item" data-bal-key={r.key}>
      {r.node}
    </div>
  );
  return (
    <div ref={box} className={`nv-bal${two ? ' is-two' : ''}${three ? ' is-three' : ''} ${className}`} data-balance={three ? 'three' : two ? 'two' : 'one'}>
      <div className="nv-bal-col is-a">
        <div className="nv-bal-pin">{a}</div>
        {!two && tail ? <div className="nv-bal-tail">{tail}</div> : null}
        {side('a').map(wrap)}
      </div>
      <div className="nv-bal-col is-b">
        <div className="nv-bal-pin">{b}</div>
        {side('b').map(wrap)}
        {!two && rest.map(wrap)}
        {!three && foot ? <div className="nv-bal-foot">{foot}</div> : null}
      </div>
      {three && (
        <div className="nv-bal-col is-c">
          {side('c').map(wrap)}
          {foot ? <div className="nv-bal-foot">{foot}</div> : null}
        </div>
      )}
      {two && tail ? <div className="nv-bal-tail is-span">{tail}</div> : null}
    </div>
  );
}
