// One page header for every page (8.0 U6, 28 Oct 2026). The former host app's pages
// (native-runtime/plugins/work/client.js Page) and Ironleaf's draw the same header at the same size and place: an
// optional icon, the page's name in the serif, an optional count, one plain line under it, and the page's own actions
// on the right. Each of the vault's pages had drawn its own <h1> (23 of them, nine widths); they all use this now,
// inside the one page frame (styles/page-frame.css .nv-page). Page tabs are PageTabs below, underlined, as the former
// host app's; a segmented control is only for a choice inside a page.

import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function PageHead({
  icon,
  title,
  count,
  lead,
  actions,
  className,
  path,
  leadTone,
}: {
  icon?: IconName | ReactNode;
  title: ReactNode;
  count?: number | string | null;
  /** The one line under the title: words, or words with a small control in them. It answers "what needs me here". */
  lead?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Where the page sits, quietly above the title (never a centred bar). */
  path?: ReactNode;
  /** Colour only when the lead needs attention: late or at risk. */
  leadTone?: 'bad' | 'warn' | 'ok' | 'none';
}) {
  return (
    <header className={`nv-page-head${className ? ` ${className}` : ''}`}>
      <div className="nv-page-words">
        {path ? <div className="nv-page-path">{path}</div> : null}
        <h1 className="nv-page-title">
          {icon ? <span className="nv-page-icon" aria-hidden="true">{typeof icon === 'string' ? <Icon name={icon as IconName} size={18} /> : icon}</span> : null}
          <span className="nv-page-name">{title}</span>
          {count !== undefined && count !== null && count !== '' && count !== 0 ? <span className="nv-page-count">{count}</span> : null}
        </h1>
        {lead ? <div className={`nv-page-lead${leadTone && leadTone !== 'none' ? ` tone-${leadTone}` : ''}`}>{lead}</div> : null}
      </div>
      {actions ? <div className="nv-page-actions">{actions}</div> : null}
    </header>
  );
}

/** A page's key facts as label/value rows (8.7 wave 1, item 4): one 140 px label column, values aligned, one left
 *  edge with the title above and the content below. */
export function PageProps({ facts }: { facts: { k: string; v: ReactNode; mark?: string }[] }) {
  if (!facts.length) return null;
  return (
    <dl className="props page-props">
      {facts.map((f) => (
        <div key={f.k} className="prow" data-item={f.mark}>
          <dt className="k">{f.k}</dt>
          <dd className="v">{f.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A page's own tabs (not a choice inside it): underlined, as the former host app's .ns-tabs. */
export function PageTabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly (readonly [T, string, (number | null)?])[]; value: T; onChange(v: T): void; label: string }) {
  return (
    <div className="nv-tabs" role="tablist" aria-label={label}>
      {tabs.map(([id, words, count]) => (
        <button key={id} role="tab" type="button" aria-selected={value === id} className={`nv-tab${value === id ? ' is-on' : ''}`} onClick={() => onChange(id)}>
          {words}
          {typeof count === 'number' ? <span className="nv-tab-count">{count}</span> : null}
        </button>
      ))}
    </div>
  );
}
