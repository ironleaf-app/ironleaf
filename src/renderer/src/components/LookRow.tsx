// One row of Today's "things need a look" list that opens to its full card (8 Nov 2026, calm Today: a vault
// warning, a pack the person turned on). The row carries the card's own title words; opening it shows the card
// itself, unchanged, with every button it had. A <details>, so no state: shut or open it counts once (the list's
// count reads data-look-row, and rows inside an opened row never count).
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function LookRow({ icon, title, children }: { icon?: IconName; title: ReactNode; children: ReactNode }) {
  return (
    <details className="td-look-row" data-look-row>
      <summary className="td-look-sum">
        {icon && (
          <span className="td-look-ic" aria-hidden="true">
            <Icon name={icon} size={14} />
          </span>
        )}
        <span className="td-look-title">{title}</span>
        <Icon name="chevron" size={12} className="td-look-go" />
      </summary>
      <div className="td-look-body">{children}</div>
    </details>
  );
}
