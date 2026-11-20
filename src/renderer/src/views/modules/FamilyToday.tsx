// Family on Today (Wave 5, 24 Oct 2026; the rule: "Today pulls from every module… kids' events"): who's where today
// and tomorrow, birthdays in the week ahead, rewards earned but not yet given, this day in earlier years and creative
// projects due (the last two came from Memories when the packs uplift item 5 merged it into Family). Each row opens
// the part of the Family page it came from. Nothing at all when there is nothing to say.

import { dayOf, nextBirthday, type Happening } from '../../../../shared/family';
import { addDays, dayWords, timeWords, todayIso } from '../../../../shared/health';
import { plural } from '../../../../shared/words';
import { Icon, type IconName } from '../../components/Icon';
import { openModule, usePartOn } from '../../state/modules';
import { useWork } from '../../state/workModules';
import { useFamily } from './FamilyPage';
import type { MemoriesView } from './life/MemoriesPage';

interface Row {
  key: string;
  icon: IconName;
  when: string;
  words: string;
  sub?: string;
  colour: string;
  part: string;
}

export function FamilyToday() {
  const { state } = useFamily();
  const calendarOn = usePartOn('family', 'calendar');
  const rewardsOn = usePartOn('family', 'rewards');
  const otdOn = usePartOn('family', 'onthisday');
  const creativeOn = usePartOn('family', 'creative');
  const { data: mem } = useWork<MemoriesView>('memories');
  if (!state) return null;
  const today = todayIso();
  const tomorrow = addDays(today, 1);
  const colourOf = (who: string[]) => state.members.find((m) => who.some((w) => w.toLowerCase() === m.name.toLowerCase()))?.colour ?? 'stone';
  const rows: Row[] = [];
  const add = (h: Happening, when: string) =>
    rows.push({ key: `${when}-${h.kind}-${h.row ?? h.what}`, icon: h.kind === 'birthday' ? 'star' : h.kind === 'activity' ? 'history' : 'calendar', when: `${when}${h.time ? ` ${timeWords(h.time)}` : ''}`, words: h.what, sub: [h.who.join(', '), h.where].filter(Boolean).join(' · ') || undefined, colour: colourOf(h.who), part: 'calendar' });
  if (calendarOn) {
    for (const h of dayOf(state.calendar, state.members, today)) add(h, 'Today');
    for (const h of dayOf(state.calendar, state.members, tomorrow)) add(h, 'Tomorrow');
  }
  for (const m of state.members) {
    const b = nextBirthday(m.born, today);
    if (b && b.in > 1 && b.in <= 7) rows.push({ key: `bday-${m.path}`, icon: 'star', when: dayWords(b.day, today), words: `${m.name} turns ${b.age}`, sub: `in ${b.in} days`, colour: m.colour, part: 'members' });
  }
  if (rewardsOn)
    for (const r of state.rewards)
      if (r.earned) rows.push({ key: `reward-${r.path}`, icon: 'star', when: 'Earned', words: `${r.who || r.title}: ${r.earned.reward}`, sub: `${plural(r.earned.at, 'day')} of ${r.habit.toLowerCase()} in a row · not given yet`, colour: colourOf([r.who]), part: 'rewards' });
  if (mem && otdOn)
    for (const o of mem.onThisDay)
      rows.push({ key: `otd-${o.album.path}`, icon: 'image', when: o.years === 1 ? '1 year ago' : `${o.years} years ago`, words: o.album.name, sub: [o.album.date ? dayWords(o.album.date, today) : '', o.album.place, plural(o.album.photos.length, 'photo')].filter(Boolean).join(' · '), colour: 'stone', part: `album:${encodeURIComponent(o.album.path)}` });
  if (mem && creativeOn)
    for (const c of mem.dueSoon)
      rows.push({ key: `due-${c.path}`, icon: 'canvas', when: c.due ? dayWords(c.due, today) : 'No day', words: c.name, sub: [c.kind, c.status, c.due ? `needed ${dayWords(c.due, today)}` : ''].filter(Boolean).join(' · '), colour: 'stone', part: `creative:${encodeURIComponent(c.path)}` });
  if (!rows.length) return null;
  const shown = rows.slice(0, 8);
  return (
    <section className="fy-today-card" data-section="family" aria-label="Family today">
      <header className="fy-today-head">
        <span className="fy-mark is-small" aria-hidden="true">
          <Icon name="people" size={13} />
        </span>
        <h2>Family</h2>
        <button type="button" className="link-button" onClick={() => openModule('family', 'calendar')}>
          Who’s where
        </button>
      </header>
      <ul className="fy-today-rows">
        {shown.map((r) => (
          <li key={r.key}>
            <button type="button" className={`fy-today-row nt-${r.colour}`} onClick={() => openModule('family', r.part)}>
              <span className="fy-today-icon" aria-hidden="true">
                <Icon name={r.icon} size={12} />
              </span>
              <span className="fy-today-when">{r.when}</span>
              <span className="fy-today-words">
                <span>{r.words}</span>
                {r.sub && <em>{r.sub}</em>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > shown.length && <p className="fy-faint fy-today-more">{rows.length - shown.length} more on the Family page.</p>}
    </section>
  );
}
