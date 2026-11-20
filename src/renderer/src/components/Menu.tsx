// Menus that open where the person clicks (right-click menus, ⋯ buttons): one at a time, kept on screen, driven by the
// mouse or the keys (arrows, Enter, Escape), submenus to the side.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatHotkey } from '../lib/hotkeys';
import { useLeaving } from '../lib/useLeaving';
import { minPopupTop } from '../lib/windowButtons';
import { menuPlace } from '../../../shared/menu-place';
import { Icon, type IconName } from './Icon';

export type MenuItem =
  | { label: string; icon?: IconName; hotkey?: string; run?(): void; disabled?: boolean; danger?: boolean; checked?: boolean; submenu?: MenuItem[]; hint?: string }
  | { separator: true }
  | { heading: string };

interface MenuState {
  x: number;
  y: number;
  /** The anchor's edges, so a menu with no room below opens above it instead of running off. */
  ay: number;
  ab: number;
  items: MenuItem[];
  /** Where it came from (a button keeps its pressed look while the menu is open). */
  anchor?: HTMLElement | null;
}

let current: MenuState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** Opens a menu at the pointer (a mouse event) or below an element. */
export function openMenu(at: { clientX: number; clientY: number } | HTMLElement, items: MenuItem[]): void {
  const visible = items.filter((item, i, all) => !('separator' in item) || (i > 0 && i < all.length - 1 && !('separator' in all[i - 1])));
  if (at instanceof HTMLElement) {
    const r = at.getBoundingClientRect();
    current = { x: r.left, y: r.bottom + 4, ay: r.top, ab: r.bottom, items: visible, anchor: at };
    at.classList.add('menu-open');
  } else {
    current = { x: at.clientX, y: at.clientY, ay: at.clientY, ab: at.clientY, items: visible };
  }
  emit();
}

export function closeMenu(returnFocus = false): void {
  const anchor = current?.anchor;
  anchor?.classList.remove('menu-open');
  current = null;
  emit();
  // The keys hand focus back to the opener (shell parity, 4 Nov 2026: every former host app menu
  // returns focus); a mouse shut leaves focus where the pointer put it.
  if (returnFocus) anchor?.focus?.({ preventScroll: true });
}

const isAction = (item: MenuItem): item is Extract<MenuItem, { label: string }> => 'label' in item;

function MenuList({ items, x, y, ay, ab, depth, leaving, onDone, onCloseSub }: { items: MenuItem[]; x: number; y: number; ay: number; ab: number; depth: number; leaving: boolean; onDone(): void; onCloseSub?(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [selected, setSelected] = useState(-1);
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);
  const actions = items.map((item, i) => (isAction(item) && !item.disabled ? i : -1)).filter((i) => i >= 0);

  const [maxH, setMaxH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Below its anchor when it fits, else above it, else the window's full height scrolled within (3 Nov
    // 2026 sweep D: More and Packs ran off the bottom; the shared menuPlace). The layout size, not the rect
    // (9 Nov 2026, More cut off: the settle animation scales the rect smaller while it runs, so the rect
    // sat 10px short and the menu landed too low).
    const at = menuPlace({ left: x, top: ay, bottom: ab }, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, minPopupTop());
    if (at.left !== pos.x || at.top !== pos.y) setPos({ x: at.left, y: at.top });
    setMaxH(at.maxHeight);
  }, [x, y, ay, ab, items]);

  useEffect(() => {
    // Every depth answers the keys (9 Nov 2026, More's folded groups and Other kinds: arrows walk every row);
    // only the deepest open level acts (an ancestor with a submenu open stays quiet for its child).
    const onKey = (e: KeyboardEvent) => {
      if (leaving || sub) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (depth > 0) onCloseSub?.();
        else closeMenu(true);
      } else if (e.key === 'Tab') {
        onDone();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const at = actions.indexOf(selected);
        const next = e.key === 'ArrowDown' ? actions[(at + 1) % actions.length] : actions[(at - 1 + actions.length) % actions.length];
        setSelected(next ?? -1);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        setSelected(e.key === 'Home' ? (actions[0] ?? -1) : (actions[actions.length - 1] ?? -1));
      } else if (e.key === 'Enter' && selected >= 0) {
        e.preventDefault();
        choose(selected, true);
      } else if (e.key === 'ArrowRight' && selected >= 0) {
        const item = items[selected];
        if (isAction(item) && item.submenu) openSub(selected);
      } else if (e.key === 'ArrowLeft' && depth > 0) {
        e.preventDefault();
        onCloseSub?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const openSub = (index: number) => {
    // By the row's own item, never by row order: past a separator or heading the item index is
    // not the row index, so submenus anchored at the wrong row and the last one opened nothing
    // at all (break 10.1.8: 'Packs and kinds' dead by hover, click and Right).
    const row = ref.current?.querySelector<HTMLElement>(`.menu-row[data-idx="${index}"]`);
    if (!row) return;
    const r = row.getBoundingClientRect();
    setSub({ index, x: r.right - 2, y: r.top - 5 });
  };

  const choose = (index: number, viaKeys = false) => {
    if (leaving) return;
    const item = items[index];
    if (!isAction(item) || item.disabled) return;
    // An empty submenu never opens an empty box (3 Nov 2026, audit f F16): it runs
    // its action when it has one, else it stays shut.
    if (item.submenu && item.submenu.length > 0) {
      openSub(index);
      return;
    }
    if (item.submenu && item.submenu.length === 0 && !item.run) return;
    closeMenu(viaKeys);
    item.run?.();
  };

  return (
    <>
      <div ref={ref} className="menu" role="menu" data-nv-leaving={leaving ? 'true' : undefined} inert={leaving} style={{ left: pos.x, top: pos.y, ...(maxH ? { maxHeight: maxH } : {}) }} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        {items.map((item, i) => {
          if ('separator' in item) return <div key={i} className="menu-separator" />;
          if ('heading' in item) return <div key={i} className="menu-heading">{item.heading}</div>;
          return (
            <button
              key={i}
              role="menuitem"
              data-idx={i}
              className={`menu-row${selected === i ? ' selected' : ''}${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              title={item.label}
              onMouseEnter={() => {
                setSelected(i);
                if (item.submenu && item.submenu.length > 0) openSub(i);
                else setSub(null);
              }}
              onClick={() => choose(i)}
            >
              <span className="menu-icon">{item.checked ? <Icon name="check" size={16} /> : item.icon ? <Icon name={item.icon} size={16} /> : null}</span>
              <span className="menu-label">{item.label}</span>
              {item.hint && <span className="menu-hint">{item.hint}</span>}
              {item.hotkey && <span className="menu-hotkey">{formatHotkey(item.hotkey)}</span>}
              {item.submenu && item.submenu.length > 0 && <Icon name="chevron" size={13} className="menu-more" />}
            </button>
          );
        })}
      </div>
      {sub && isAction(items[sub.index]) && (items[sub.index] as { submenu?: MenuItem[] }).submenu && (
        <MenuList items={(items[sub.index] as { submenu: MenuItem[] }).submenu} x={sub.x} y={sub.y} ay={sub.y} ab={sub.y} depth={depth + 1} leaving={leaving} onDone={onDone} onCloseSub={() => setSub(null)} />
      )}
    </>
  );
}

/** Rendered once by the app: shows whichever menu is open, held for its fade when it closes. */
export function MenuHost() {
  const state = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
  const held = useLeaving(state);
  const show = held.value;
  useEffect(() => {
    if (!state) return;
    const close = () => closeMenu();
    // A wheel turn over the menu scrolls the menu itself (3 Nov 2026, audit f F1:
    // More's rows were keyboard-only because any wheel closed it); a wheel turn
    // outside still closes it, like an outside click. Escape closes in MenuList.
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.menu')) return;
      closeMenu();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', onWheel);
    };
  }, [state]);
  if (!show) return null;
  return <MenuList key={`${show.x},${show.y}`} items={show.items} x={show.x} y={show.y} ay={show.ay} ab={show.ab} depth={0} leaving={held.leaving} onDone={closeMenu} />;
}
