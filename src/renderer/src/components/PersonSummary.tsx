// A person's or organisation's card at the top of the peek (Wave 4, 24 Oct 2026; src/shared/people.ts): when you last
// met or were in touch (the meeting, one click on), how much is open with them, the projects they are in, how to reach
// them, their area of life, and whether the card is protected (family and health cards are kept from agents unless the
// person allows them).

import { useEffect, useState } from 'react';
import type { PersonCard } from '../../../shared/people';
import type { VaultRecord } from '../../../shared/records';
import { readDate, shortDate } from '../lib/projectLook';
import { areaOfPath } from '../state/areas';
import { peek } from '../state/peek';
import { useApp } from '../state/store';
import { Icon, type IconName } from './Icon';

export function PersonSummary({ record }: { record: VaultRecord }) {
  const revision = useApp((s) => s.revision);
  const byPath = useApp((s) => s.byPath);
  const [card, setCard] = useState<PersonCard | null>(null);
  useEffect(() => {
    let live = true;
    void window.nv.life.people.card(record.id).then((c) => live && setCard(c), () => live && setCard(null));
    return () => {
      live = false;
    };
  }, [record.id, revision]);
  if (!card || card.id !== record.id) return null;
  const area = areaOfPath(card.path ?? card.namedIn ?? '');
  const level = String((card.path ? byPath.get(card.path)?.props?.sensitivity : '') ?? '').toLowerCase();
  const protectedCard = /family|health/.test(level) || area?.id === 'family' || area?.id === 'health';
  const last = card.lastContact;
  const lastMs = last ? readDate(last.date) : null;
  return (
    <div className="ps-card">
      <div className="ps-chips">
        {area && (
          <span className={`ps-chip nt-${area.color}`}>
            <Icon name={area.icon as IconName} size={11} /> {area.name}
          </span>
        )}
        {protectedCard && (
          <span className="ps-chip ps-protected" title="Family and health cards are kept from agents unless you allow them">
            <Icon name="lock" size={11} /> Protected
          </span>
        )}
        {card.open > 0 && <span className="ps-chip ps-open">{card.open} open</span>}
        {card.projects.length > 0 && (
          <span className="ps-chip" title={card.projects.map((p) => p.title).join('\n')}>
            <Icon name="layers" size={11} /> {card.projects.length === 1 ? card.projects[0].title : `${card.projects.length} projects`}
          </span>
        )}
      </div>
      {last && (
        <p className="ps-last">
          <Icon name="clock" size={12} />
          <span>
            Last {last.what === 'In touch' ? 'in touch' : 'met'} <strong>{lastMs !== null ? shortDate(lastMs) : last.date}</strong>
            {last.id && (
              <>
                {' · '}
                <button type="button" className="ps-link" onClick={() => peek({ id: last.id! })}>
                  {last.what}
                </button>
              </>
            )}
          </span>
        </p>
      )}
    </div>
  );
}
