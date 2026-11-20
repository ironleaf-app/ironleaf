// One page's own tabs (t255, 13 Nov 2026): one bar, one hook, every long page. The bar is a real tablist
// (arrows move, Enter opens); the hook holds history (Back returns to the tab), memory (the last tab per page)
// and reveal (an opened item lands on its tab, its row flashed). Each tab keeps its own scroll through the
// page's own key (state/pageScroll.ts). Tab panels mount with the head's tab first and stream the rest after
// paint, and stay mounted: moving between tabs is instant, with no reload and no flash.

import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type RefObject } from 'react';
import { setWorkspace } from '../state/layout';
import * as W from '../state/workspace';

export interface PageTabDef {
  id: string;
  title: string;
  /** Rows the tab holds (t249: the count equals its rows); empty tabs read quietly, never hidden. */
  count?: number;
}

/** One of the page's own tabs opened, through the shared hook below. */
export function usePageTabs(opts: {
  /** The workspace tab showing this page (history lives on it). */
  tabId: string;
  /** The page (a project path): mounting restarts per page. */
  pageKey: string;
  tabs: PageTabDef[];
  defaultTab: string;
  /** The tab history says is open (the workspace tab's section). */
  section: string | undefined;
  /** The tab remembered for this page, once loaded. */
  remembered: string | undefined;
  ready: boolean;
  remember(id: string): void;
}): {
  active: string;
  openTab(id: string, o?: { push?: boolean; focus?: boolean }): void;
  reveal(section: string, item: string, flash: (item: string) => void): void;
  isMounted(id: string): boolean;
  focusSignal: { id: string; n: number } | null;
} {
  const { tabId, pageKey, tabs, defaultTab, section, remembered, ready, remember } = opts;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const ids = new Set(tabs.map((t) => t.id));
  const valid = (id: string | undefined) => (id !== undefined && ids.has(id) ? id : undefined);
  // History first, then memory, then the default (Overview): a fresh open lands where the person was.
  const active = valid(section) ?? (ready ? valid(remembered) : undefined) ?? defaultTab;
  const [focusSignal, setFocusSignal] = useState<{ id: string; n: number } | null>(null);
  const focus = useCallback((id: string) => setFocusSignal((s) => ({ id, n: (s?.n ?? 0) + 1 })), []);

  // Settle history on mount: the open tab stands in it, without pushing (Back returns past the open).
  useEffect(() => {
    if (section === undefined && ready) setWorkspace((ws) => W.setTabSection(ws, tabId, valid(remembered) ?? defaultTab, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, ready, tabId, pageKey]);

  // The open tab is remembered per page (Back to a tab remembers it too: it is the open tab now).
  const lastRem = useRef('');
  useEffect(() => {
    if (active !== lastRem.current) {
      lastRem.current = active;
      remember(active);
    }
  }, [active, remember]);

  // Panels mount with the open tab and stream the rest after paint (t102: mounting all at once blocked
  // past the head's paint). Staying mounted keeps switching instant, with state and Find kept per tab.
  const [mounted, setMounted] = useState<Set<string>>(() => new Set([defaultTab]));
  const mountedFor = useRef(pageKey);
  if (mountedFor.current !== pageKey) {
    mountedFor.current = pageKey;
    setMounted(new Set([active]));
  }
  useEffect(() => {
    setMounted((m) => (m.has(active) ? m : new Set(m).add(active)));
  }, [active]);
  useEffect(() => {
    let live = true;
    let frames = 0;
    const max = tabsRef.current.length + 2;
    const tick = () => {
      if (!live || frames++ > max) return;
      setMounted((m) => {
        const next = tabsRef.current.find((t) => !m.has(t.id));
        if (!next) return m;
        const n = new Set(m);
        n.add(next.id);
        return n;
      });
      requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  const openTab = useCallback(
    (id: string, o?: { push?: boolean; focus?: boolean }) => {
      if (!ids.has(id)) return;
      setMounted((m) => (m.has(id) ? m : new Set(m).add(id)));
      setWorkspace((ws) => W.setTabSection(ws, tabId, id, o?.push ?? true));
      if (o?.focus) focus(id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabId],
  );

  // An item opened from anywhere (t248): its tab, without pushing (Back returns past the landing), then
  // the page flashes its row (retried: the panel mounts with this same change).
  const reveal = useCallback(
    (next: string, item: string, flash: (item: string) => void) => {
      if (!ids.has(next)) return;
      setMounted((m) => (m.has(next) ? m : new Set(m).add(next)));
      setWorkspace((ws) => W.setTabSection(ws, tabId, next, false));
      focus(next);
      flash(item);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabId],
  );

  return { active, openTab, reveal, isMounted: (id: string) => mounted.has(id), focusSignal };
}

/** The bar: a real tablist. Left and Right move along it, Enter opens, Home and End jump. Tab names
 *  never cut: the bar scrolls sideways with a fade at the end that hides more. */
export function PageTabs({ tabs, active, onOpen, label, focusSignal, idPrefix }: { tabs: PageTabDef[]; active: string; onOpen(id: string): void; label: string; focusSignal: { id: string; n: number } | null; idPrefix: string }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState(active);
  useEffect(() => setFocusId(active), [active]);
  useEffect(() => {
    if (!focusSignal) return;
    barRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(focusSignal.id)}"]`)?.focus();
    setFocusId(focusSignal.id);
  }, [focusSignal]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Enter and Space open the focused tab, handled here so one path opens for every key (prevented: the
    // button's own activation would open it a second time).
    if (e.key === 'Enter' || e.key === ' ') {
      const id = (e.target as HTMLElement | null)?.getAttribute?.('data-tab') ?? focusId;
      if (tabs.some((t) => t.id === id)) {
        e.preventDefault();
        onOpen(id);
      }
      return;
    }
    const at = tabs.findIndex((t) => t.id === focusId);
    const j = e.key === 'ArrowRight' ? (at + 1) % tabs.length : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (j === null || j < 0 || j >= tabs.length) return;
    e.preventDefault();
    const id = tabs[j].id;
    setFocusId(id);
    const el = barRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id)}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  // The fade follows what hides (plain words wrap whole below; the bar scrolls instead of cutting them).
  const [fade, setFade] = useState('none');
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setFade(max <= 2 ? 'none' : el.scrollLeft <= 4 ? 'right' : el.scrollLeft >= max - 4 ? 'left' : 'both');
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [tabs.length]);
  return (
    <div ref={barRef} role="tablist" aria-label={label} className="pt-bar" data-fade={fade} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const on = active === t.id;
        const quiet = (t.count ?? 1) === 0;
        return (
          <button
            key={t.id}
            role="tab"
            data-tab={t.id}
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={on}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={focusId === t.id ? 0 : -1}
            className={`pt-tab${on ? ' is-on' : ''}${quiet && !on ? ' is-quiet' : ''}`}
            onClick={() => onOpen(t.id)}
            onFocus={() => setFocusId(t.id)}
          >
            <span className="pt-title">{t.title}</span>
            {t.count !== undefined && t.count > 0 && <span className="pt-count">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** One list's own Find (t262, 13 Nov 2026, lifting t255's TabFind for the one-list rooms). The one box every list
 *  shares: the same place (one row above its list), the same words ("Find in this list", "N of M", "Clear"),
 *  Esc clearing it, the app's / key jumping to it from the room. Tab panels hold their own words and filter
 *  their rows where they stand; rooms that filter in state (tasks, notes, people, meetings, inbox) pass the
 *  words through and the Find only reads and counts. Shown only when the list runs past one screen, latched:
 *  once earned it stays, or filtering the list short would hide the Find with its own Clear. Rooms whose Find
 *  always stood (tasks, notes, people) keep it standing. */
export function ListFind({ id, open, value, onChange, match, always, scope, expands, inputRef, inputProps, hint }: {
  /** The list on show (a tab, a chip): recounted when it changes, the words standing. */
  id: string;
  /** The list is on show. */
  open: boolean;
  /** The words, passed through by rooms that filter in state (tabs leave them to the Find). */
  value?: string;
  onChange?(q: string): void;
  /** The count for the open list, from the room ({ n, m }, null while no words stand). */
  match?: { n: number; m: number } | null;
  /** The Find always stands (tasks, notes, people, whose Find never hid). */
  always?: boolean;
  /** The list to measure and expand (rooms); tabs measure their own panel. */
  scope?: RefObject<HTMLElement | null>;
  /** Open record-view folds and draw every windowed row while words stand (record lists). */
  expands?: boolean;
  /** The box, for the room's / key. */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Extra words on the box (a test hook); the shared words always win. */
  inputProps?: InputHTMLAttributes<HTMLInputElement> & { [key: `data-${string}`]: string | number | boolean | undefined };
  /** The key hint on the box (rooms: press / to jump here). */
  hint?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const controlled = value !== undefined;
  const [ownQ, setOwnQ] = useState('');
  const q = controlled ? value : ownQ;
  const setQ = (next: string) => (controlled ? onChange?.(next) : setOwnQ(next));
  const [shown, setShown] = useState(!!always);
  const [ownMatch, setOwnMatch] = useState<{ n: number; m: number } | null>(null);
  const count = controlled ? (match ?? null) : ownMatch;
  const listEl = () => scope?.current ?? (boxRef.current?.closest('[role="tabpanel"]') as HTMLElement | null);
  // Words standing mean the Find stands (t266: remembered words filter from the first paint, when the list
  // starts short — without this the box never earns itself and the filter can be neither seen nor cleared).
  useEffect(() => {
    if (q.trim()) setShown(true);
  }, [q]);
  useEffect(() => {
    if (always) return;
    const el = listEl();
    if (!el) return;
    const scroller = el.closest('.vscroll, .nv-page-scroll');
    const update = () => {
      // Past one screen: taller than the page shows (a short list never earns a Find). Latched: once
      // earned it stays, or filtering the list short would hide the Find with its own Clear. Group heads
      // (data-find-skip) are context, never rows: the count equals the rows, like the tab's badge.
      const rows = el.querySelectorAll('.trow:not([data-find-skip])').length;
      if (scroller ? el.scrollHeight > scroller.clientHeight + 32 : rows > 8) setShown(true);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (scroller) ro.observe(scroller);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, open]);
  useEffect(() => {
    if (controlled) return;
    const el = listEl();
    if (!el) return;
    // The list changes under standing words (a tick moves its row, an Add lands one): the filter runs
    // again as rows arrive and leave (t266, 13 Nov 2026 break job: the count stood stale at "1 of 421"
    // after its row was ticked away), or the count would lie until the words change.
    const pass = () => {
      const rows = [...el.querySelectorAll<HTMLElement>('.trow:not([data-find-skip])')];
      if (!q.trim()) {
        rows.forEach((r) => {
          r.style.display = '';
        });
        el.querySelectorAll('details[data-find-open]').forEach((d) => {
          d.removeAttribute('data-find-open');
          (d as HTMLDetailsElement).open = false;
        });
        setOwnMatch(null);
        return;
      }
      const needle = q.trim().toLowerCase();
      let n = 0;
      for (const r of rows) {
        const hit = (r.textContent ?? '').toLowerCase().includes(needle);
        r.style.display = hit ? '' : 'none';
        if (hit) {
          n++;
          const d = r.closest('details');
          if (d && !d.open) {
            d.setAttribute('data-find-open', '1');
            d.open = true;
          }
        }
      }
      setOwnMatch({ n, m: rows.length });
    };
    pass();
    const mo = new MutationObserver(pass);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, id, open]);
  useEffect(() => {
    // Record views fold their groups and window long lists in state (t260's RecordsView, never touched
    // here): while words stand, folded groups open and every window draws whole, driven like a person,
    // a click each; cleared, the folds we opened shut again. Empty groups stand, as unfound folds do.
    if (!expands) return;
    const el = listEl();
    if (!el) return;
    if (!q.trim()) {
      restoreFindFolds(el);
      return;
    }
    const pass = () => {
      el.querySelectorAll('button.ws-group-fold[aria-expanded="false"]:not([data-find-open])').forEach((b) => {
        b.setAttribute('data-find-open', '1');
        (b as HTMLElement).click();
      });
      // Board columns carry their fold on the column, never the button.
      el.querySelectorAll('button.ws-col-fold:not([data-find-open])').forEach((b) => {
        if (!b.closest('section.ws-col')?.classList.contains('is-folded')) return;
        b.setAttribute('data-find-open', '1');
        (b as HTMLElement).click();
      });
      el.querySelectorAll('button.ws-more').forEach((b) => (b as HTMLElement).click());
    };
    pass();
    const mo = new MutationObserver(pass);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, id, open]);
  // The box stands mounted while hidden (display contents takes no room): measuring needs it in the panel.
  return (
    <div ref={boxRef} style={{ display: 'contents' }}>
      {shown && (
        <div className="pt-find">
          <input
            {...inputProps}
            ref={inputRef}
            className="input pt-find-box"
            type="search"
            value={q}
            placeholder="Find in this list"
            aria-label="Find in this list"
            title={hint}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // Esc clears the words (stopped: an empty Find leaves Esc to whatever holds it).
              // Prevented: a search box would clear its own value past React's back.
              if (e.key === 'Escape' && q) {
                e.preventDefault();
                e.stopPropagation();
                setQ('');
              }
            }}
          />
          {count && (
            <span className="pt-find-n" aria-live="polite">
              {count.n === count.m ? `${count.m}` : `${count.n} of ${count.m}`}
            </span>
          )}
          {!!q && (
            <button type="button" className="btn quiet pt-find-x" aria-label="Clear the find" onClick={() => setQ('')}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Shut the record-view folds a Find opened (its own marks only, and only folds still open: a fold the
 *  person shut themselves is already as they left it). Rooms call it before a chip switch carries the
 *  words on; clearing calls it through the Find. */
export function restoreFindFolds(el: HTMLElement): void {
  el.querySelectorAll('[data-find-open]').forEach((b) => {
    b.removeAttribute('data-find-open');
    const open = b.classList.contains('ws-col-fold') ? !b.closest('section.ws-col')?.classList.contains('is-folded') : b.getAttribute('aria-expanded') === 'true';
    if (open) (b as HTMLElement).click();
  });
}

/** A tab's own Find: the one list Find, holding its own words over its panel. */
export function TabFind({ id, open }: { id: string; open: boolean }) {
  return <ListFind id={id} open={open} expands />;
}

/** One room's Find words (and the Meetings chip) as left (t266, 13 Nov 2026 break job: typed words
 *  vanished on leaving the room or opening a row, and the room forgot its chip — Tasks keeps its whole
 *  filter in localStorage, so every Find does the same through this one hook, capped like Tasks). */
export function useFindMemory(key: string, initial = ''): [string, (v: string) => void] {
  const [v, setV] = useState<string>(() => {
    try {
      return localStorage.getItem(`nv-find-${key}`) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: string) => {
      setV(next);
      try {
        localStorage.setItem(`nv-find-${key}`, next.slice(0, 200));
      } catch {}
    },
    [key],
  );
  return [v, set];
}
