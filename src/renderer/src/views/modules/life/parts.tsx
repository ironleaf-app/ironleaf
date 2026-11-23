// What the Wave 7 part b pages share (Business, Systems and Home Lab, Goals and Habits, Reading,
// Watching and Lists), beside the work modules' page blocks (../work/WorkShell.tsx) they are made of: a value changed
// where it shows, a rating, a box that adds on Enter, a fact with its label, a progress bar and a status chip that moves
// on when clicked. Every value shown can be changed in place; nothing here knows any one module.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../../components/Icon';
import { workDid } from '../../../state/workModules';
import { toneOf } from '../../workspace/recordParts';
import { isEnterKey } from '../../../lib/enterKey';

export type InlineKind = 'text' | 'date' | 'choice' | 'number' | 'long';

/** A value that turns into its input when clicked; Enter or leaving it saves, Escape puts it back. */
export function Inline({ value, shown, label, kind = 'text', options, canEdit, placeholder, onSave, className, own }: { value: string; shown?: ReactNode; label: string; kind?: InlineKind; options?: readonly string[]; canEdit: boolean; placeholder?: string; onSave(v: string): Promise<boolean>; className?: string; own?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    if (input.current instanceof HTMLInputElement || input.current instanceof HTMLTextAreaElement) input.current.select();
  }, [editing]);
  const done = async (v: string) => {
    if (busy) return;
    if (v.trim() === value.trim()) return setEditing(false);
    setBusy(true);
    const ok = await onSave(v.trim());
    setBusy(false);
    if (ok) setEditing(false);
  };
  if (!editing)
    return (
      <button type="button" className={`lr-inline${value ? '' : ' is-empty'}${kind === 'long' ? ' is-long' : ''}${className ? ` ${className}` : ''}`} disabled={!canEdit} title={canEdit ? `Change ${label.toLowerCase()}` : undefined} aria-label={`${label}: ${value || 'not set'}${canEdit ? ', change it' : ''}`} onClick={() => setEditing(true)}>
        {value ? (shown ?? value) : <span className="lr-inline-none">{canEdit ? placeholder ?? 'Add' : ''}</span>}
      </button>
    );
  if (kind === 'choice' && !own) {
    const list = options && !options.includes(value) && value ? [value, ...options] : options ?? [];
    return (
      <select ref={(el) => void (input.current = el)} className="lr-inline-edit" aria-label={label} value={text} disabled={busy} onChange={(e) => void done(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}>
        {list.map((o) => (
          <option key={o} value={o}>
            {o || ''}
          </option>
        ))}
      </select>
    );
  }
  if (kind === 'long')
    return (
      <textarea
        ref={(el) => void (input.current = el)}
        className="lr-inline-edit is-long"
        aria-label={label}
        value={text}
        disabled={busy}
        rows={Math.min(8, Math.max(3, text.split('\n').length + 1))}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void done(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void done(text);
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  const listId = kind === 'choice' && own ? `lr-own-${label.replace(/\W+/g, '-')}` : undefined;
  return (
    <>
      <input
        ref={(el) => void (input.current = el)}
        className="lr-inline-edit"
        aria-label={label}
        type={kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'}
        inputMode={kind === 'number' ? 'decimal' : undefined}
        value={text}
        disabled={busy}
        placeholder={placeholder}
        list={listId}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void done(text)}
        onKeyDown={(e) => {
          if (isEnterKey(e)) void done(text);
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      {listId && (
        <datalist id={listId}>
          {(options ?? []).filter(Boolean).map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  );
}

/** A rating of 1 to 5 stars, set by clicking one (the same one again clears it). */
export function Stars({ value, canEdit, onSave, label = 'Rating' }: { value: number | null; canEdit: boolean; onSave(v: number | null): void; label?: string }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  return (
    <span className={`lr-stars${value ? '' : ' is-empty'}`} role="group" aria-label={`${label}: ${value ? `${value} of 5` : 'not rated'}`} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={`lr-star${n <= shown ? ' is-on' : ''}`} disabled={!canEdit} aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`} aria-pressed={value === n} onMouseEnter={() => canEdit && setHover(n)} onClick={() => onSave(value === n ? null : n)}>
          <Icon name="star" size={12} />
        </button>
      ))}
    </span>
  );
}

/** A box that adds what is typed on Enter, then empties itself for the next. */
export function QuickAdd({ placeholder, canEdit, onAdd, label, icon = 'plus', compact }: { placeholder: string; canEdit: boolean; onAdd(words: string): Promise<boolean>; label?: string; icon?: IconName; compact?: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const w = text.trim();
    if (!w || busy) return;
    setBusy(true);
    const ok = await onAdd(w);
    setBusy(false);
    if (ok) setText('');
  };
  return (
    <div className={`lr-quick${compact ? ' is-compact' : ''}`}>
      <Icon name={icon} size={13} />
      <input type="text" value={text} disabled={!canEdit || busy} placeholder={canEdit ? placeholder : 'Read-only'} aria-label={label ?? placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
      {text.trim() && (
        <button type="button" className="button small" disabled={busy} onClick={() => void add()}>
          Add
        </button>
      )}
    </div>
  );
}

export function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`lr-fact${wide ? ' is-wide' : ''}`}>
      <span className="lr-fact-label">{label}</span>
      <span className="lr-fact-value">{children}</span>
    </div>
  );
}

/** How far along something is (0 to 1), with its words beside it. */
export function Progress({ value, words, tone }: { value: number | null; words?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <span className={`lr-progress${tone ? ` tone-${tone}` : ''}`}>
      <span className="lr-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
        <span className="lr-progress-fill" style={{ width: `${pct * 100}%` }} />
      </span>
      {words && <span className="lr-progress-words">{words}</span>}
    </span>
  );
}

/** A status that moves on to the next when clicked (its tone from its words). */
export function StatusChip({ status, next, canEdit, onSet, title }: { status: string; next?: string; canEdit: boolean; onSet(v: string): void; title?: string }) {
  const tone = toneOf(status, 'status');
  return (
    <button type="button" className={`lr-chip tone-${tone}`} disabled={!canEdit || !next} title={title ?? (next ? `Mark ${next.toLowerCase()}` : undefined)} aria-label={`${status || 'No status'}${next ? `: mark ${next.toLowerCase()}` : ''}`} onClick={() => next && onSet(next)}>
      <span className="lr-chip-dot" aria-hidden="true" />
      {status || 'No status'}
    </button>
  );
}

/** A plain-words count ("3 shows"). One rule everywhere (3 Nov 2026, fourth-round G5-G7). */
export { plural } from '../../../../../shared/words';

/** A web address made openable ("example.com" → https://example.com), else null. */
export function hrefOf(link: string): string | null {
  const s = link.trim().replace(/^<|>$/g, '');
  if (!s) return null;
  const md = /\]\((https?:\/\/[^)\s]+)\)/.exec(s);
  if (md) return md[1];
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return `https://${s}`;
  return null;
}

/** "example.com" from a web address, for a short link. */
export const hostOf = (href: string) => {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
};

/** A change made on the main side: true once written (a job that answers nothing is still written), its words said;
 *  false (and the error said in plain words) when it wasn't. */
export function saved(job: Promise<unknown>, words?: string): Promise<boolean> {
  return workDid(
    job.then((said) => ({ said })),
    (x) => words ?? (typeof x.said === 'string' ? x.said : ''),
  ).then((r) => r !== null);
}
