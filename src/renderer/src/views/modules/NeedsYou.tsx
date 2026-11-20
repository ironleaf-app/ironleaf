// A module's Needs-you lead (8.0 round 2, SPEC section D "The bar"): up to 4 premium cards built from the module's
// own records through attentionOrder (src/shared/module-purpose.ts), each with what, when in words, the detail that
// matters, and one button that does the thing. When nothing needs the person, one calm line says so, with the
// module's next date when it has one. Below it the module's own overview follows as before.

import { dayWords, daysBetweenDays, nextNeedsDate, nothingNeedsYou, selectNeeds, whenWords, type NeedsCard } from '../../../../shared/module-purpose';
import { Icon } from '../../components/Icon';
import '../../styles/module-purpose.css';

export function NeedsYou({ cards, today, canEdit = true, onAction }: { cards: readonly NeedsCard[]; today: string; canEdit?: boolean; onAction(card: NeedsCard): void }) {
  const lead = selectNeeds(cards, today, 4);
  if (!lead.length) {
    return (
      <p className="needs-none" role="status">
        {nothingNeedsYou(nextNeedsDate(cards, today), today)}
      </p>
    );
  }
  return (
    <section className="needs" aria-label="Needs you">
      <h3 className="needs-title">Needs you</h3>
      <div className="needs-grid">
        {lead.map((c) => {
          const when = whenWords(c.due, today);
          const days = daysBetweenDays(today, c.due);
          const late = days !== null && days < 0;
          const soon = days !== null && days >= 0 && days <= 7;
          return (
            <article key={c.id} className={`needs-card${late ? ' is-late' : soon ? ' is-soon' : ''}`}>
              <span className="needs-what">{c.title}</span>
              {when && (
                <span className={`needs-when${late ? ' is-late' : soon ? ' is-soon' : ''}`}>
                  {when}
                  {c.due ? ` · ${dayWords(c.due, today)}` : ''}
                </span>
              )}
              {c.detail && <span className="needs-detail">{c.detail}</span>}
              <button type="button" className="button small needs-action" disabled={!canEdit} onClick={() => onAction(c)}>
                {c.action} <Icon name="chevron" size={11} />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
