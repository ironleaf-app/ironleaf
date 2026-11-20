// The w3a packs' shared page shape (8.7 wave 3a, 30 Oct 2026): every pack page in the one page shape (the slim top bar
// above from the frame, the glyph tile with the title, one plain line under it, key facts, then labelled cards), wired
// to the pack's real data and actions. One primary button per screen; rows clip to one line; every record opens where
// it shows and deletes to Recently deleted with Undo.

import type { ReactNode } from 'react';
import { moduleInfo } from '../../../../shared/life-modules';
import { Icon } from '../../components/Icon';
import { PageHead, PageProps } from '../../components/PageHead';
import { ShareButton } from '../../components/ShareButton';
import { openMenu, type MenuItem } from '../../components/Menu';
import * as A from '../../state/actions';
import { ScopedAsk } from '../../components/ScopedAsk';
import { getState, showError, useApp } from '../../state/store';
import { RecordFormHost } from './RecordForm';
import '../../styles/packs-87.css';

/** A pack's name from the catalogue, so the short-names rename lands on every pack page and menu at once (8.7 round
 *  2: never hard-code a pack's name). The fallback is only for a pack the catalogue no longer knows. */
export const packName = (id: string, fallback: string): string => moduleInfo(id)?.name ?? fallback;

export type Tint = 'slate' | 'green' | 'amber' | 'red' | 'blue';

// The packs' day words live guarded in one place (8.7.1, 31 Oct 2026, pages that "couldn't show"), re-exported here
// so every pack page keeps its words from this one shape.
export { checkedWords, daysAgo, fullShort, longDay, monthDay, monthYear, shortDay, weekdayLong, weekdayOf } from '../../../../shared/pack-dates';

/** A pack page (or one of its inner pages): the tile with the title, one line, facts, then the labelled cards. Packs
 *  use the full page width with 32px sides (8.7 round 2), never the narrow reading column. A record's own page passes
 *  its note as sharePath (8.8): Share on its top bar shares a clean copy of that note. */
export function PackShell({ glyph, tint, title, sub, facts, actions, menu, wide, sharePath, children }: { glyph: string; tint: Tint; title: ReactNode; sub?: ReactNode; facts?: { k: string; v: ReactNode }[]; actions?: ReactNode; menu?(): MenuItem[]; wide?: boolean; sharePath?: string; children: ReactNode }) {
  return (
    // `wide`: the page lays a list and its detail side by side on a wide window (components/ListDetail.tsx).
    <div className={`nv-page full p87${wide ? ' has-split' : ''}`}>
      <PageHead
        icon={
          <span className={`gtile ${tint}`} aria-hidden="true">
            {glyph}
          </span>
        }
        title={title}
        lead={sub}
        actions={
          <>
            {actions}
            {sharePath && <ShareButton path={sharePath} />}
            {menu && (
              <button type="button" className="btn iconbtn" aria-label={`More for ${typeof title === 'string' ? title : 'this page'}`} title="More" onClick={(e) => openMenu(e.currentTarget, menu())}>
                <Icon name="more" size={16} />
              </button>
            )}
          </>
        }
      />
      {facts && facts.length > 0 && <PageProps facts={facts} />}
      <div className="p87-body">{children}</div>
      <RecordFormHost />
    </div>
  );
}

/** One labelled card section on a pack page: one element, so its label and card stay together in a pair
 *  (packs uplift item 3; Business's Customers-beside-Support). A section holding only its quiet line passes
 *  bare (t254, 13 Nov 2026: the line reads without the box, as p15's quiet line, never a card with one short
 *  line in it). */
export function PackSection({ label, action, pad, bare, children }: { label: string; action?: ReactNode; pad?: boolean; bare?: boolean; children: ReactNode }) {
  return (
    <section className="p87-sec">
      <div className="glabel" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>{label}</span>
        {action}
      </div>
      {bare ? <div className="p87-bare">{children}</div> : <div className={`card${pad ? ' pad' : ''}`}>{children}</div>}
    </section>
  );
}

/** The Ask box at the foot of a pack page (9.2 uplift F19): the one shared scoped box. The words go to the
 *  helper in the side chat, scoped to the pack. */
export function AskFloat({ hint, scope, question }: { hint?: string; scope?: string; question?(words: string): string }) {
  return <ScopedAsk hint={hint} scope={scope} question={question} />;
}

/** A row's quiet menu: open it, open its note, delete it to Recently deleted (with Undo on the toast). */
export function rowMenu(path: string, name: string, open: () => void): MenuItem[] {
  return [
    { label: `Open ${name}`, icon: 'notes', run: open },
    { label: 'Open its note', icon: 'doc', run: () => A.openPath(path, { where: 'tab' }) },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, disabled: !getState().canEdit, run: () => void A.trashPath(path).catch(showError) },
  ];
}

/** A row's menu on right-click (open it, open its note, delete it): nothing shown, nothing lost. */
export function rowContext(menu: () => MenuItem[]) {
  return {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      openMenu({ clientX: e.clientX, clientY: e.clientY }, menu());
    },
  };
}

/** A tick circle that does the row's done action (mark paid, tick the step, carry the action). */
export function Tick({ label, done, onTick }: { label: string; done?: boolean; onTick(): void }) {
  const canEdit = useApp((s) => s.canEdit);
  return <button type="button" className={`check${done ? ' done' : ''}`} aria-label={label} title={label} disabled={!canEdit} onClick={onTick}>{done ? '✓' : null}</button>;
}
