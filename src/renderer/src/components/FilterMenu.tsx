// One filter as a dropdown (layout round 2, 20 Nov 2026): the Files and assets page stood two full-width rows of
// about 45 chips (folders, tags, kinds) over everything else. A page keeps at most one row of chips (its main kinds);
// every longer set — areas, collections, tags, folders — is one of these: "Tag ▾", showing the choice made.
import type { MouseEvent } from 'react';
import { Icon, type IconName } from './Icon';
import { openMenu, type MenuItem } from './Menu';

export interface FilterOption {
  id: string;
  label: string;
  count?: number;
  run(): void;
  /** A submenu of its own (rename, remove…), shown beside the option. */
  manage?: MenuItem[];
}

export function FilterMenu({ label, icon, options, value, extra, onMenu }: { label: string; icon: IconName; options: FilterOption[]; value?: string | null; extra?: MenuItem[]; onMenu?(e: MouseEvent): void }) {
  if (!options.length && !extra?.length) return null;
  const chosen = options.find((o) => o.id === value);
  return (
    <button
      type="button"
      className={`chip nv-filter-menu${chosen ? ' on' : ''}`}
      aria-haspopup="menu"
      aria-pressed={!!chosen}
      title={chosen ? `${label}: ${chosen.label}` : `Show one ${label.toLowerCase()}`}
      onContextMenu={onMenu}
      onClick={(e) =>
        openMenu(e.currentTarget, [
          { heading: label },
          ...options.map((o): MenuItem => (o.manage?.length ? { label: o.label, hint: o.count !== undefined ? o.count.toLocaleString('en-AU') : undefined, checked: o.id === value, submenu: [{ label: `Show ${o.label}`, run: o.run }, { separator: true }, ...o.manage] } : { label: o.label, hint: o.count !== undefined ? o.count.toLocaleString('en-AU') : undefined, checked: o.id === value, run: o.run })),
          ...(extra?.length ? [{ separator: true } as MenuItem, ...extra] : []),
        ])
      }
    >
      <Icon name={icon} size={13} />
      <span>{chosen ? chosen.label : label}</span>
      {chosen?.count !== undefined && <span className="n">{chosen.count.toLocaleString('en-AU')}</span>}
      <Icon name="chevronDown" size={12} />
    </button>
  );
}
