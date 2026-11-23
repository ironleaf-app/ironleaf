// A designed empty place and soft loading rows (5.0.0, 19 Oct 2026; as the former host app's EmptyState and
// LoadingRows). Every page or panel with nothing in it yet says so the same way: a soft tile with a line icon, a short
// title, one line, and the one next step when there is an obvious one (a quieter second one only where both are real
// choices, such as setting projects up from a folder or by hand). Lists that are still loading show grey rows in their
// shape instead of "Loading…". Styles: styles/feel.css.
//
// Wide-window pass (23 Nov 2026): the empty place stood as a 340 px centred column on a 2,000 px page, a lonely card in
// the middle of nothing. It now reads in the page's own frame: the tile at the page's left edge, the words beside it
// at reading width, the next step under them, as the first lines of the list it stands in for would.

import { useContext, type ReactNode } from 'react';
import { ModuleFills } from '../state/moduleFills';
import { Icon, type IconName } from './Icon';

export interface EmptyAction {
  label: string;
  icon?: IconName;
  run(): void;
  disabled?: boolean;
}

export function EmptyState({
  icon,
  title,
  line,
  action,
  also,
  size = 'page',
  className,
  children,
  noFills,
  label,
}: {
  icon: IconName;
  title: string;
  /** One line under the title (words, or words with a key or a link in them). */
  line?: ReactNode;
  /** The next step, as a button. */
  action?: EmptyAction;
  /** A quieter second step, as a text button beside it. */
  also?: EmptyAction;
  /** A page's middle, or a side panel or list (smaller, closer to the top). */
  size?: 'page' | 'panel';
  className?: string;
  children?: ReactNode;
  /** Not about what fills the module (an empty search, a filter that hides everything). */
  noFills?: boolean;
  /** What a screen reader announces (9.5 polished: PageEmpty carried one; the adapter passes it through). */
  label?: string;
}) {
  // In a module's page (8.0 Phase 5, "empty states lead with fills itself"): the page's empty place says first what fills
  // it on its own and how; what can be done by hand follows.
  const mod = useContext(ModuleFills);
  const fills = size === 'page' && !noFills && mod ? mod.fills : '';
  return (
    <div className={`nv-empty is-${size}${className ? ` ${className}` : ''}`} role="status" aria-label={label ?? title}>
      <span className="nv-empty-tile" aria-hidden="true">
        <Icon name={icon} size={size === 'page' ? 20 : 16} />
      </span>
      <div className="nv-empty-words">
        <p className="nv-empty-title">{title}</p>
        {fills && (
          <p className="nv-empty-fills">
            <b>Fills itself.</b> {fills}
          </p>
        )}
        {line && <p className={`nv-empty-line${fills ? ' nv-empty-byhand' : ''}`}>{fills ? <>By hand: {line}</> : line}</p>}
        {(action || also) && (
          <div className="nv-empty-actions">
            {action && (
              <button type="button" className={`button${size === 'page' ? ' primary' : ''}`} disabled={action.disabled} onClick={action.run}>
                {action.icon && <Icon name={action.icon} size={14} />} {action.label}
              </button>
            )}
            {also && (
              <button type="button" className="text-button nv-empty-also" disabled={also.disabled} onClick={also.run}>
                {also.icon && <Icon name={also.icon} size={13} />} {also.label}
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Grey rows in a list's shape while it loads; each row's width varies a little, as real names do. */
export function LoadingRows({ rows = 4, label = 'Loading', className }: { rows?: number; label?: string; className?: string }) {
  const widths = [72, 54, 64, 46, 68, 58, 50, 62];
  return (
    <div className={`nv-skeleton${className ? ` ${className}` : ''}`} aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="nv-skeleton-row" style={{ width: `${widths[i % widths.length]}%` }} />
      ))}
    </div>
  );
}
