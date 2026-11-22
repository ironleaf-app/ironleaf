// The life packs' shared 8.7 bits (30 Oct 2026): the page frame every pack overview and inner screen stands in
// (the kit's card, row, pill and ask shapes), the home-card strip, the ask box wired to the helper, and
// whole-record deletes to Recently deleted with Undo. One primary button per screen.

import type { ReactNode } from 'react';
import '../../../styles/w3b-packs.css';
import { moduleInfo } from '../../../../../shared/life-modules';
import { EmptyState } from '../../../components/EmptyState';
import { Icon, type IconName } from '../../../components/Icon';
import { PageHead, PageProps } from '../../../components/PageHead';
import { ShareButton } from '../../../components/ShareButton';
import { DesignButton } from '../../../components/DesignButton';
import { RecordFormHost } from '../RecordForm';
import * as A from '../../../state/actions';
import { ScopedAsk } from '../../../components/ScopedAsk';
import { useApp } from '../../../state/store';

export { EmptyState, PageHead, PageProps };

/** The page: the full page width with 32 px sides, as the mock-ups draw every pack (8.7 round 2). It mounts the
 *  record form's host (p15 packs-life, 4 Nov 2026: without it every New button on these pages did nothing): the host
 *  draws for whichever page mounted first, so sharing it across tabs is safe. */
export function PackPage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="nv-page full w3b-page" aria-label={label}>
      {children}
      <RecordFormHost />
    </div>
  );
}

/** A glyph tile in a kit tint, as the mock-ups draw each pack's mark. */
export function Glyph({ tint, children, size }: { tint: 'slate' | 'green' | 'amber' | 'red' | 'blue'; children: ReactNode; size?: 'sm' | 'xs' }) {
  return (
    <span className={`gtile ${tint}${size ? ` ${size}` : ''}`} aria-hidden="true">
      {children}
    </span>
  );
}

/** A pack's head in the one page shape: tinted tile, 32 px title, one sub line, actions right. A record's own screen
 *  passes its note as sharePath (8.8): Share on its top bar shares a clean copy of that note. */
export function PackHead({ glyph, tint, title, lead, actions, icon, sharePath }: { glyph?: ReactNode; tint: 'slate' | 'green' | 'amber' | 'red' | 'blue'; title: ReactNode; lead?: ReactNode; actions?: ReactNode; icon?: ReactNode; sharePath?: string }) {
  return <PageHead icon={icon ?? <Glyph tint={tint}>{glyph}</Glyph>} title={title} lead={lead} actions={<>{actions}{sharePath && <DesignButton path={sharePath} />}
            {sharePath && <DesignButton path={sharePath} />}{sharePath && <ShareButton path={sharePath} />}</>} />;
}

/** A section: its small grey label, then its content. No divider lines inside pages. */
export function Section({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ marginTop: 14 }}>
      <div className="glabel" style={{ display: 'flex', alignItems: 'center', margin: '0 0 8px' }}>
        <span>{label}</span>
        {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** A section's rows in their card, or the quiet line bare when there is nothing but it (t258, 13 Nov 2026: the
 *  t254 bare pattern, in one shared place: the detail pages read through it, as the overviews do. Cards
 *  with rows, tables or a primary action keep their boxes). */
export function RowsCard({ empty, words, children }: { empty: boolean; words: ReactNode; children: ReactNode }) {
  if (empty) return <p className="vsub w3b-bare">{words}</p>;
  return <div className="card" style={{ padding: '6px 20px' }}>{children}</div>;
}

/** What Home shows for this pack, opening Home. */
export function HomeCard({ pack, glyph, tint, title, meta }: { pack: string; glyph: ReactNode; tint: 'slate' | 'green' | 'amber' | 'red' | 'blue'; title: string; meta: string }) {
  return (
    <Section label={`Home card · ${pack}`}>
      <div className="card" style={{ padding: 0 }}>
        <button type="button" className="w3b-home" title="Open Home" onClick={() => A.openHome()}>
          <Glyph tint={tint} size="xs">{glyph}</Glyph>
          <span className="t clip">{title}</span>
          <span className="meta">{meta}</span>
        </button>
      </div>
    </Section>
  );
}

/** The ask pill at the foot of an inner screen (9.2 uplift F19): the one shared scoped box. Typed words go
 *  to the helper in the side chat with the page as scope. */
export function AskFloat({ hint, scope, question }: { hint?: string; scope?: string; question?(words: string): string }) {
  return <ScopedAsk hint={hint} scope={scope} question={question} />;
}

/** A meter: spent against a budget, green until near, red when over. */
export function Meter({ name, spent, budget, words }: { name: string; spent: number; budget: number; words: string }) {
  const ratio = budget > 0 ? Math.min(1, spent / budget) : 0;
  const cls = budget > 0 && spent > budget ? 'is-over' : ratio >= 0.85 ? 'is-near' : '';
  return (
    <div className={`w3b-meter ${cls}`}>
      <div className="top">
        <b>{name}</b>
        <span>{words}</span>
      </div>
      <div className="bar" role="progressbar" aria-label={`${name}: ${words}`} aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}

/** A tick row: done at left, words clipped, its tag at right. */
export function Tick({ done, title, meta, tag, tagTone, label, onTick }: { done: boolean; title: string; meta?: string; tag?: string; tagTone?: 'slate' | 'green' | 'amber' | 'red' | 'blue'; label: string; onTick(): void }) {
  return (
    <button type="button" className={`w3b-tick${done ? ' is-done' : ''}`} aria-pressed={done} aria-label={label} onClick={onTick}>
      <span className={`check${done ? ' done' : ''}`} aria-hidden="true">{done ? '✓' : ''}</span>
      <span className="t">{title}</span>
      {meta && <span className="meta">{meta}</span>}
      {tag && <span className={`tag ${tagTone ?? 'slate'}`}>{tag}</span>}
    </button>
  );
}

/** The full older page's menu words, one name everywhere (9.2 uplift F20, wording half): the kept previous
 *  layout is "every detail", never version jargon. (Its removal stays blocked: w3b-packs-87.test.mjs pins it kept.) */
export const FULL_DETAILS_LABEL = 'Show every detail';

/** How a pack fills itself, on its empty overview (5 Nov 2026, packs uplift item 2): the catalogue's fills line, so
 *  an empty pack says what is automatic and what needs a chat bot or the chat, as every EmptyState does. */
export function FillsLine({ id }: { id: string }) {
  const fills = moduleInfo(id)?.fills;
  if (!fills) return null;
  return (
    <p className="vsub">
      <b>Fills itself.</b> {fills}
    </p>
  );
}
export const EDIT_DETAILS_LABEL = 'Edit every detail';

/** The previous layout's extras, folded away but kept, so no ability is lost in the move. */
export function ClassicMore({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="w3b-more">
      <summary>{label}</summary>
      <div className="body">{children}</div>
    </details>
  );
}

/** A whole record's delete: its note to Recently deleted with Undo, never gone for good. */
export async function trashRecord(path: string): Promise<boolean> {
  return A.trashPath(path);
}

/** The ⋯ menu button PageHead's right side ends with. */
export function MoreButton({ label, onOpen }: { label: string; onOpen(el: HTMLElement): void }) {
  return (
    <button type="button" className="iconbtn" title="More" aria-label={label} onClick={(e) => onOpen(e.currentTarget)}>
      <Icon name="more" size={16} />
    </button>
  );
}

/** Whether the person can change things here (read-only vaults still read). */
export function useCanEdit(): boolean {
  return useApp((s) => s.canEdit);
}

/** Small grey count words ("3 jobs · 1 warranty ends soon"). */
export function Count({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{children}</span>;
}

/** A person chip: their 20 px avatar plus name. */
export function Who({ name, tint }: { name: string; tint?: 'slate' | 'green' | 'amber' | 'red' | 'blue' }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <i className={`miniava ${tint ?? 'slate'}`} aria-hidden="true">{initials}</i>
      {name}
    </span>
  );
}

export type { IconName };
export { Icon };
