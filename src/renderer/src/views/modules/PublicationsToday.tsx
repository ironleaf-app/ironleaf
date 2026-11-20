// Publications on Today (Wave 6 part a; the rule: "Today pulls from every module … the paper"): the next edition when it
// is due in the next two days, whether it is started, built and set to go out by itself; an edition whose time has
// passed with no edition or no PDF, until it goes out; and the latest edition's delivery when something didn't go.
// Nothing when there is nothing to say.

import { isoOf } from '../../../../shared/finance';
import { lastScheduledDay, shortDate } from '../../../../shared/publications';
import { Icon } from '../../components/Icon';
import { openModule } from '../../state/modules';
import { choose, usePub } from './publications/usePub';

export function PublicationsToday() {
  const { state } = usePub();
  const cur = state?.current;
  if (!state?.on || !cur) return null;
  const rows: { key: string; when: string; words: string; sub: string; bad?: boolean; open(): void }[] = [];
  const next = cur.next;
  if (next && new Date(next.at).getTime() - Date.now() < 2 * 86_400_000) {
    const e = next.edition;
    rows.push({
      key: 'next',
      when: next.words,
      words: e ? `${cur.pub.masthead} ${e.label}` : `${cur.pub.masthead}: no edition yet`,
      sub: e ? (e.pdf ? `${e.status}${e.pages ? ` · ${e.pages} pages` : ''}${state.deliveryOn && (cur.pub.delivery.print || cur.pub.delivery.telegram) ? ' · goes out by itself' : ''}` : `${e.status} · ${e.pieces} ${e.pieces === 1 ? 'piece' : 'pieces'} · no PDF yet`) : 'Start it so it can go out on time',
      bad: !e || !e.pdf,
      open: () => {
        if (e) choose({ edition: e.path });
        openModule('publications', e ? 'studio' : 'editions');
      },
    });
  }
  // An edition whose time has passed with nothing to send (9 Nov 2026, break job: an edition due at 7am
  // hid past 7am, since the next run is next week). Shown until its edition exists with a PDF. A publication
  // with no editions yet is new, not overdue. The next row above already covers the day it names, so the same
  // day never shows twice.
  const overdueDay = lastScheduledDay(cur.pub.schedule ?? null, new Date());
  const nextDay = next ? isoOf(new Date(next.at)) : null;
  const started = cur.editions.some((e) => !e.preview);
  if (overdueDay && overdueDay !== nextDay && started) {
    const owed = cur.editions.find((e) => !e.preview && e.date === overdueDay);
    if (!owed || !owed.pdf) {
      rows.push({
        key: 'overdue',
        when: shortDate(overdueDay),
        words: owed ? `${cur.pub.masthead} ${owed.label} overdue` : `${cur.pub.masthead} edition overdue`,
        sub: owed ? `${owed.status} · no PDF yet. Build it now.` : 'No edition yet. Start it now.',
        bad: true,
        open: () => {
          if (owed) choose({ edition: owed.path });
          openModule('publications', owed ? 'studio' : 'editions');
        },
      });
    }
  }
  const last = cur.editions.find((e) => !e.preview && e.delivered);
  if (last && /not (sent|printed)/i.test(last.delivered)) rows.push({ key: 'failed', when: shortDate(last.date), words: `${last.label} didn’t all go out`, sub: last.delivered, bad: true, open: () => (choose({ edition: last.path }), openModule('publications', 'studio')) });
  if (!rows.length) return null;
  return (
    <section className="pb-today-card" data-section="publications" aria-label="Publications today">
      <header className="pb-today-head">
        <span className="pb-mark is-small" aria-hidden="true">
          <Icon name="newspaper" size={13} />
        </span>
        <h2>Publications</h2>
        <button type="button" className="link-button" onClick={() => openModule('publications')}>
          Editions
        </button>
      </header>
      <ul className="pb-today-rows">
        {rows.map((r) => (
          <li key={r.key}>
            <button type="button" className={`pb-today-row${r.bad ? ' is-bad' : ''}`} onClick={r.open}>
              <span className="pb-today-when">{r.when}</span>
              <span className="pb-today-words">
                <span>{r.words}</span>
                <em>{r.sub}</em>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
