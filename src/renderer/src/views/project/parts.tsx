// Small pieces of a project's page and the Projects home: a health pill, progress (a bar, or a slider on the page), a
// card, and words written in a project as they read (links open, bold is bold).

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { renderInline, wikilinkFromClick } from '../../lib/markdownRender';
import * as A from '../../state/actions';

export function Pill({ tone, children, onClick, title }: { tone: string; children: ReactNode; onClick?: (e: React.MouseEvent<HTMLElement>) => void; title?: string }) {
  return onClick ? (
    <button className={`pj-pill tone-${tone}`} onClick={onClick} title={title} aria-haspopup="menu">
      <span className="pj-dot" />
      {children}
      <Icon name="chevronDown" size={11} />
    </button>
  ) : (
    <span className={`pj-pill tone-${tone}`} title={title}>
      <span className="pj-dot" />
      {children}
    </span>
  );
}

export function Progress({ value, tone, wide }: { value?: number; tone: string; wide?: boolean }) {
  if (typeof value !== 'number') return null;
  return (
    <span className={`pj-progress${wide ? ' wide' : ''}`} title={`About ${value}% done`}>
      <span className="pj-progress-track">
        <span className={`pj-progress-fill tone-${tone}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </span>
      <span className="pj-progress-words">{value}%</span>
    </span>
  );
}

/**
 * How far through, set by hand: the bar itself is a slider (drag along it, or the arrow keys in steps of 5); it is saved
 * when let go. Without a value yet, "Set progress" starts it.
 */
export function ProgressControl({ value, tone, canEdit, onSave }: { value?: number; tone: string; canEdit: boolean; onSave(value: number | null): void }) {
  const [live, setLive] = useState<number | null>(null);
  const track = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  if (!canEdit) return <Progress value={value} tone={tone} />;
  if (typeof value !== 'number' && live === null)
    return (
      <button className="pj-plain pj-faint" onClick={() => setLive(0)}>
        Set progress
      </button>
    );
  const shown = live ?? value ?? 0;
  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * 20) * 5;
  };
  const commit = (n: number) => {
    clearTimeout(timer.current);
    timer.current = 0;
    setLive(null);
    if (n !== value) onSave(n);
  };
  return (
    <span
      className={`pj-progress pj-progress-edit${live !== null ? ' is-live' : ''}`}
      ref={(el) => {
        // Just started from "Set progress": the keys go to it.
        if (el && typeof value !== 'number' && live === 0 && document.activeElement !== el) el.focus();
      }}
      role="slider"
      tabIndex={0}
      aria-label="How far through"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown}
      aria-valuetext={`${shown}%`}
      title="Drag to set how far through it is"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setLive(at(e.clientX));
      }}
      onPointerMove={(e) => {
        if (live !== null && (e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) setLive(at(e.clientX));
      }}
      onPointerUp={(e) => {
        if (live === null) return;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        commit(at(e.clientX));
      }}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : 0;
        const jump = e.key === 'Home' ? 0 : e.key === 'End' ? 100 : null;
        if (!step && jump === null) return;
        e.preventDefault();
        const n = jump ?? Math.max(0, Math.min(100, Math.round(shown / 5) * 5 + step));
        setLive(n);
        // Saved once the keys stop.
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => commit(n), 700);
      }}
      onBlur={() => {
        if (live !== null && !timer.current) setLive(null);
      }}
    >
      <span className="pj-progress-track" ref={track}>
        <span className={`pj-progress-fill tone-${tone}`} style={{ width: `${Math.max(2, Math.min(100, shown))}%` }} />
        <span className="pj-progress-knob" style={{ left: `${shown}%` }} />
      </span>
      <span className="pj-progress-words">{shown}%</span>
    </span>
  );
}

export function Card({ title, count, icon, children, action, className, empty, item }: { title: string; count?: number; icon: IconName; children: ReactNode; action?: ReactNode; className?: string; empty?: boolean; item?: string }) {
  return (
    <section className={`pj-card ${className ?? ''}${empty ? ' is-empty' : ''}`} data-item-card={item}>
      <header className="pj-card-head">
        <Icon name={icon} size={14} />
        <h3>{title}</h3>
        {typeof count === 'number' && count > 0 && <span className="pj-count">{count}</span>}
        <span className="pj-card-space" />
        {action}
      </header>
      {children}
    </section>
  );
}

/** Words written in the project (a next step, an update, a decision…) as they read: links open, bold is bold. */
export function Words({ text, from, className }: { text: string; from: string; className?: string }) {
  const html = useMemo(() => renderInline(text, { from }), [text, from]);
  return (
    <span
      className={className}
      onClick={(e) => {
        const target = wikilinkFromClick(e);
        if (target !== null) {
          e.preventDefault();
          e.stopPropagation();
          void A.openLink(target, from, e.ctrlKey || e.metaKey ? 'tab' : 'current');
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Where an update came from: a document in the project's folder opens with a click, in the full viewer (t239). */
export function From({ path, from, remote = false }: { path: string; from: string; remote?: boolean }) {
  const file = /^[^<>:"|?*]+\.[A-Za-z0-9]{2,5}$/.test(from.trim()) ? from.trim() : null;
  if (!file) return <span className="pj-from">from {from}</span>;
  void remote;
  return (
    <button className="pj-from pj-from-link" title={`Open ${file}`} onClick={() => A.openFolderFile(path, file)}>
      from {file.split('/').pop()}
    </button>
  );
}
