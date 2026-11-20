// One scannable row (29 Oct 2026, the redesign plan principles 2-3; one set, the plan): the action
// on one line, its meta under it in small text, a date pill at the end. Two shapes, as the screens already
// have them: Today's row (what, offset and now, with a lead and hover actions, one obvious action) and the
// project page's list row (title, owner, day and today, with a tick when one is given and status), so every
// screen's row looks and works exactly as it did.
import type { ReactNode } from 'react';
import { plainText } from '../../../../shared/plain-text';
import { Icon } from '../Icon';
import { DatePill } from './DatePill';
import { OwnerChip } from './OwnerChip';
import { StatusPill } from './StatusPill';

export function PlanRow({ what, title, meta, owner, me, day, today, dateWords, status, done = false, onOpen, onTick, canTick = true, offset, now, label, lead, actions }: {
  what?: ReactNode;
  title?: ReactNode;
  meta?: ReactNode;
  owner?: string;
  me?: string | null;
  day?: number;
  today?: number;
  dateWords?: string;
  status?: string;
  done?: boolean;
  onOpen?: (e?: React.MouseEvent) => void;
  onTick?: () => void;
  canTick?: boolean;
  offset?: number | null;
  now?: Date;
  label?: string;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  if (title !== undefined) {
    return (
      <li className={`plan-row plan-row--list${done ? ' is-done' : ''}`}>
        {onTick && (
          <button type="button" className="plan-tick" role="checkbox" aria-checked={!!done} disabled={!canTick} title={done ? 'Put it back on the list' : 'Tick it off'} onClick={onTick}>
            {done && <Icon name="check" size={11} />}
          </button>
        )}
        <button type="button" className="plan-row-main" onClick={onOpen}>
          <span className="plan-row-words">
            <span className="plan-row-title">{typeof title === 'string' ? plainText(title) : title}</span>
            {meta && <span className="plan-row-meta">{meta}</span>}
          </span>
          {owner && <OwnerChip name={owner} me={me} />}
          {status && <StatusPill words={status} />}
          <DatePill day={day} today={today ?? 0} words={dateWords} />
        </button>
      </li>
    );
  }
  return (
    <div
      className={`td-row plan-row${done ? ' is-done' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen?.(e as unknown as React.MouseEvent);
        }
      }}
    >
      {lead}
      <span className="td-row-main">
        <span className="td-row-what"><span className="td-text">{typeof what === 'string' ? plainText(what) : what}</span></span>
        {meta && <span className="td-row-sub">{meta}</span>}
      </span>
      {offset !== undefined && now && <DatePill offset={offset} now={now} />}
      {actions && <span className="td-actions">{actions}</span>}
    </div>
  );
}
