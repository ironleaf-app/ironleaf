// Every page's four states (8.7 wave 2, design C; the home-/note-/project-/search- -empty, -loading, -error,
// -narrow and -dark mock-ups, 30 Oct 2026): one muted glyph, one head, one line and one action when empty; a
// skeleton in the page's
// real shape while loading; what happened and one next step on an error. Narrow windows fold the side bar to its
// rail (the frame's, wave 1); dark mode follows the theme tokens, as the dark mock-ups. The kit's own files are
// frozen this wave, so these live here, on the kit's classes and tokens; other waves' pages may use them too.

import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';
import { Icon, type IconName } from './Icon';
import { getWorkspace, setWorkspace } from '../state/layout';
import * as W from '../state/workspace';
import '../styles/page-states-87.css';

export interface PageStateAction {
  label: string;
  run(): void;
  disabled?: boolean;
}

/** An empty page or section (9.5 polished, 1 Nov 2026): the one empty state, shared with every other page: this keeps its
 *  name and callers (pages-w4b pins them) and renders EmptyState. */
export function PageEmpty({ icon, title, line, action, quiet, label }: { icon: IconName; title: string; line?: ReactNode; action?: PageStateAction; quiet?: PageStateAction; label?: string }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      line={line}
      label={label}
      action={action ? { label: action.label, run: action.run, disabled: action.disabled } : undefined}
      also={quiet ? { label: quiet.label, run: quiet.run, disabled: quiet.disabled } : undefined}
    />
  );
}

/** A page that failed to load: what happened, in plain words, and one next step (the -error mock-ups).
 *  Every error page has Back (t248, 12 Nov 2026, structure N2): an explicit way back wins, else the tab's own. */
export function PageError({ title, explainer, retry, retryLabel, back }: { title: string; explainer: ReactNode; retry(): void; retryLabel?: string; back?: PageStateAction }) {
  const goBack = () => {
    const tab = W.activeTab(getWorkspace());
    if (tab.back.length) setWorkspace((w) => W.navigate(w, tab.id, -1));
  };
  const wayBack = back ?? { label: 'Back', run: goBack, ...(W.activeTab(getWorkspace()).back.length ? {} : { disabled: true }) };
  return (
    <div className="card w4b-err" role="alert">
      <span className="w4b-ering is-bad" aria-hidden="true">
        <Icon name="warning" size={26} />
      </span>
      <h3>{title}</h3>
      <p>{explainer}</p>
      <div className="w4b-empty-actions">
        <button type="button" className="btn pri w4b-empty-go" onClick={retry}>
          {retryLabel ?? 'Try again'}
        </button>
        <button type="button" className="btn" disabled={wayBack.disabled} onClick={wayBack.run}>
          {wayBack.label}
        </button>
      </div>
    </div>
  );
}

/** One grey block of a loading skeleton. Widths vary a little, as real words do. */
export function Skel({ w, h, r }: { w: string | number; h: string | number; r?: string | number }) {
  const px = (v: string | number) => (typeof v === 'number' ? `${v}px` : v);
  return <span className="w4b-skel" style={{ width: px(w), height: px(h), borderRadius: r === undefined ? undefined : px(r) }} aria-hidden="true" />;
}

/** Rows with a round tick, words and a tag at right (the home-loading shape). */
export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  const widths = ['100%', '100%', '70%', '85%', '60%'];
  return (
    <div className="w4b-skrows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="w4b-skrow">
          <Skel w={20} h={20} r="50%" />
          <Skel w={widths[i % widths.length]} h={15} />
          <Skel w={70} h={22} />
        </span>
      ))}
    </div>
  );
}

/** A row of small cards with a glyph tile and two lines (the home-loading recently-viewed shape). */
export function CardsSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="w4b-skcards" aria-hidden="true">
      {Array.from({ length: cards }, (_, i) => (
        <span key={i} className="card w4b-skcard">
          <Skel w={26} h={26} />
          <Skel w="90%" h={14} />
          <Skel w="60%" h={14} />
        </span>
      ))}
    </div>
  );
}

/** A table's head and rows (the files shape). */
export function TableSkeleton({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="w4b-sktable" aria-hidden="true">
      <span className="w4b-skthrow">
        {Array.from({ length: cols }, (_, i) => (
          <Skel key={i} w={i === 0 ? '34%' : '16%'} h={13} />
        ))}
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="w4b-skthrow is-row">
          <span className="w4b-skcell is-main">
            <Skel w={26} h={26} r={7} />
            <Skel w={`${62 - i * 6}%`} h={14} />
          </span>
          {Array.from({ length: cols - 1 }, (_, j) => (
            <span key={j} className="w4b-skcell">
              <Skel w="70%" h={13} />
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

/** Columns with a pill head and two cards each (the project-loading board shape). */
export function BoardSkeleton({ cols = 3 }: { cols?: number }) {
  return (
    <div className="boardwrap" aria-hidden="true">
      <div className="board">
        {Array.from({ length: cols }, (_, i) => (
          <div key={i} className="bcol">
            <Skel w={80} h={22} />
            <div className="bcard">
              <Skel w="100%" h={15} />
              <Skel w="60%" h={15} />
              <span className="w4b-skpad" />
              <Skel w={70} h={22} />
            </div>
            <div className="bcard">
              <Skel w="80%" h={15} />
              <span className="w4b-skpad" />
              <Skel w={60} h={22} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A loading page: the skeleton in the page's real shape plus one quiet line (the -loading mock-ups). */
export function PageLoading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="w4b-loading" role="status" aria-label={label} aria-busy="true">
      {children}
      <p className="w4b-loading-line">{label}</p>
    </div>
  );
}
