// SPDX-License-Identifier: AGPL-3.0-or-later The account chip at the foot of the side bar, and its menu (20 Nov 2026).
// One row, as the account chip in VS Code, Slack or Linear: the avatar (with the update dot), the person's name and
// their plan, or "Sign in" with why it is optional. It opens one compact menu above it: who (name, email, plan), Account
// and plan, Manage billing when there is something to manage, Settings, About and updates with the version, Sign out.
// The folded rail draws the avatar alone and opens the same menu beside it. Settings and About keep their own doors too
// (Ctrl+, and the palette). What the row and the menu say is accountMenu.ts (checked on its own); the account and update
// state are the shared views (accountState.ts, aboutState.ts): no IPC of its own.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatHotkey } from '../../lib/hotkeys';
import { openModal } from '../../state/modals';
import { useApp } from '../../state/store';
import { openAboutPage, useUpdateState } from '../about/aboutState';
import { confirm } from '../Dialogs';
import { Icon } from '../Icon';
import { closeMenu } from '../Menu';
import { account, openAccountPage, signInFromAnywhere, useAccount } from './accountState';
import { accountChip, accountMenuEntries, type AccountChip as Chip, type AccountMenuId } from './accountMenu';
import { SupporterBadge } from './SupporterBadge';
import '../../styles/account.css';

/** The round avatar: initials when signed in, a neutral person otherwise; the dot when an update waits. */
function Avatar({ chip, big = false }: { chip: Chip; big?: boolean }) {
  return (
    <span className={`acct-ava${chip.initials ? ' is-in' : ' is-out'}${big ? ' big' : ''}`} aria-hidden="true">
      {chip.initials || <Icon name="person" size={big ? 18 : 16} />}
      {!big && chip.dot && <span className="acct-ava-dot" />}
    </span>
  );
}

function run(id: AccountMenuId): void {
  switch (id) {
    case 'sign-in':
      return signInFromAnywhere();
    case 'cancel':
      return void account.cancel();
    case 'account':
      return openAccountPage();
    case 'billing':
      return void account.portal();
    case 'settings':
      return openModal({ kind: 'settings' });
    case 'about':
      return openAboutPage();
    case 'sign-out':
      void confirm('Sign out of Ironleaf?', { message: 'Your notes stay exactly as they are. Paid cloud products stop on this PC until you sign in again.', ok: 'Sign out' }).then((yes) => yes && void account.signOut());
  }
}

interface MenuProps {
  anchor: HTMLElement;
  /** Above the foot's row, or to the right of the rail's avatar. */
  side: 'above' | 'right';
  chip: Chip;
  entries: ReturnType<typeof accountMenuEntries>;
  /** Opened from the keys: the first row takes focus. */
  viaKeys: boolean;
  onClose(refocus: boolean): void;
}

function AccountMenu({ anchor, side, chip, entries, viaKeys, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; width?: number } | null>(null);
  const [selected, setSelected] = useState(viaKeys ? 0 : -1);
  const actions = entries.flatMap((e) => ('id' in e ? [e] : []));

  useLayoutEffect(() => {
    const place = () => {
      // The foot's whole row (the chip and the bell) is the menu's width; the rail's avatar opens it beside the rail.
      const row = (side === 'above' ? anchor.closest('.places-profile') : null) ?? anchor;
      const r = row.getBoundingClientRect();
      const vh = window.innerHeight;
      if (side === 'above') setPos({ left: Math.max(6, r.left), bottom: vh - r.top + 6, width: Math.max(248, Math.min(320, r.width)) });
      else setPos({ left: r.right + 8, bottom: Math.max(6, vh - r.bottom) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, side]);

  // Focus follows the selected row, so Enter and Space press it as a button would.
  useEffect(() => {
    if (selected < 0) return;
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[selected]?.focus({ preventScroll: true });
  }, [selected, pos]);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (ref.current?.contains(t) || anchor.contains(t))) return;
      onClose(false);
    };
    const blur = () => onClose(false);
    window.addEventListener('mousedown', outside, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('mousedown', outside, true);
      window.removeEventListener('blur', blur);
    };
  }, [anchor, onClose]);

  // The keys, wherever focus is while the menu is open (a mouse-opened menu answers them too, as the app's menus do).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = actions.length;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose(true);
      } else if (e.key === 'Tab') {
        onClose(false);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelected((s) => (e.key === 'ArrowDown' ? (s + 1) % n : s < 0 ? n - 1 : (s - 1 + n) % n));
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        setSelected(e.key === 'Home' ? 0 : n - 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const choose = (id: AccountMenuId, viaKeysNow: boolean) => {
    onClose(viaKeysNow);
    run(id);
  };

  let at = -1;
  return createPortal(
    <div
      ref={ref}
      className={`menu acct-menu is-${side}`}
      role="menu"
      aria-label={chip.kind === 'in' ? `Account: ${[chip.name, chip.email, chip.sub].filter(Boolean).join(', ')}` : 'Account'}
      style={pos ? { left: pos.left, bottom: pos.bottom, top: 'auto', ...(pos.width ? { width: pos.width } : {}) } : { visibility: 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {chip.kind === 'in' && (
        <div className="acct-menu-who" role="presentation">
          <Avatar chip={chip} big />
          <div className="acct-menu-id">
            <div className="acct-menu-name">{chip.name}</div>
            {chip.email && chip.email !== chip.name && <div className="acct-menu-email">{chip.email}</div>}
            <div className="acct-menu-plan">
              <span>{chip.sub}</span>
              {chip.supporter && <SupporterBadge />}
            </div>
          </div>
        </div>
      )}
      {chip.kind === 'busy' && (
        <div className="acct-menu-note" role="presentation">
          Finish signing in in your browser. This updates by itself.
        </div>
      )}
      {chip.kind !== 'in' && chip.kind !== 'busy' && chip.supporter && (
        <div className="acct-menu-note" role="presentation">
          <SupporterBadge />
        </div>
      )}
      {chip.kind === 'in' && <div className="menu-separator" role="separator" />}
      {entries.map((e, i) => {
        if (!('id' in e)) return <div key={`sep-${i}`} className="menu-separator" role="separator" />;
        const index = ++at;
        return (
          <button
            key={e.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-id={e.id}
            className={`menu-row${selected === index ? ' selected' : ''}`}
            onMouseEnter={() => setSelected(index)}
            onClick={(ev) => choose(e.id, ev.detail === 0)}
          >
            <span className="menu-icon">{e.icon && <Icon name={e.icon} size={16} />}</span>
            <span className="menu-label">{e.label}</span>
            {e.dot && <span className="acct-menu-dot" aria-label="Update waiting" />}
            {e.hint && <span className="menu-hint">{e.hint}</span>}
            {e.hotkey && <span className="menu-hotkey">{formatHotkey(e.hotkey)}</span>}
            {e.external && <Icon name="external" size={12} className="menu-more" />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** The account's one door: the foot's row (avatar, name, plan) or, on the folded rail, the avatar alone. */
export function AccountChip({ variant }: { variant: 'foot' | 'rail' }) {
  const view = useAccount();
  const update = useUpdateState();
  const version = useApp((s) => s.settings?.about.version ?? '');
  const chip = accountChip(view, update);
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ viaKeys: boolean } | null>(null);
  const close = useRef((refocus: boolean) => {
    setOpen(null);
    if (refocus) btn.current?.focus({ preventScroll: true });
  }).current;
  const show = (viaKeys: boolean) => {
    closeMenu();
    setOpen({ viaKeys });
  };
  const tip = chip.kind === 'in' ? `${chip.name} · ${chip.sub}` : chip.kind === 'out' ? 'Sign in (optional), Settings, About and updates' : `${chip.name} · ${chip.sub}`;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={variant === 'foot' ? `srow acct-chip is-${chip.kind}` : `rrow acct-chip-rail is-${chip.kind}`}
        aria-haspopup="menu"
        aria-expanded={!!open}
        aria-label={chip.label}
        title={variant === 'foot' ? tip : undefined}
        onClick={(e) => (open ? close(false) : show(e.detail === 0))}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !open) {
            e.preventDefault();
            show(true);
          }
        }}
      >
        <Avatar chip={chip} />
        {variant === 'foot' ? (
          <span className="acct-chip-words">
            <span className="acct-chip-name">{chip.name}</span>
            <span className="acct-chip-sub">
              {chip.kind === 'in' && chip.supporter && <Icon name="heart" size={11} className="acct-chip-heart" />}
              {chip.sub}
            </span>
          </span>
        ) : (
          <span className="tip" aria-hidden="true">
            {tip}
          </span>
        )}
      </button>
      {open && btn.current && <AccountMenu anchor={btn.current} side={variant === 'foot' ? 'above' : 'right'} chip={chip} entries={accountMenuEntries(view, update, version)} viaKeys={open.viaKeys} onClose={close} />}
    </>
  );
}
