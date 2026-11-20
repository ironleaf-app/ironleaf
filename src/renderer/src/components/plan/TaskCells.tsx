// One task row's who and when cells (p11 vault-care, Nov 2026: the task lists are "horrible to look at",
// "just care and premium into our software"): the project Tasks tab, the Tasks page, Today rows and meeting
// actions all use these, so who and when share one x on every row. Who: avatar plus the first name where
// there is room (avatar only when squeezed, plan.css), the full name on hover; every owner shows, including
// the person themself (a column with holes scans worse, and the steps always showed their avatars). When:
// plain words, late alone in the attention colour, today, future and states quiet neutral, no filled chips;
// no day is an empty cell. The *Cell is the grid item; where a row edits in place, a plain span carries the
// cell class and the *Inner sits inside the edit box (Inline renders nothing when read-only and empty, so the
// box itself cannot be the item). Theme tokens only.
import { hashTint, initials } from '../../lib/projectLook';
import { peek } from '../../state/peek';
import { firstNameOf, ownerName } from './plan';

export function WhoInner({ name }: { name?: string }) {
  const shown = ownerName((name ?? '').trim());
  if (!shown) return null;
  return (
    <span className="tkrow-person" title={shown}>
      <i className={`miniava ${hashTint(shown)}`} aria-hidden="true">
        {initials(shown)}
      </i>
      <span className="tkrow-name">{firstNameOf(shown)}</span>
    </span>
  );
}

export function WhoCell({ name }: { name?: string }) {
  const shown = ownerName((name ?? '').trim());
  if (!shown) return <span className="tkrow-who is-empty" aria-hidden={true} />;
  // Who opens the person (p17-connected, 4 Nov 2026): the one who cell every read-only task grid
  // uses, so Tasks, Waiting and Due rows all open who they name in the peek. The row's own click
  // still opens the task (stopped here).
  return (
    <span className="tkrow-who">
      <button
        type="button"
        style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}
        onClick={(e) => (e.stopPropagation(), peek({ type: 'person', name: shown }, { title: shown, type: 'person' }))}
        title={`Everything about ${shown}`}
        aria-label={`Everything about ${shown}`}
      >
        <WhoInner name={name} />
      </button>
    </span>
  );
}

export function WhenInner({ words, tone, title }: { words?: string | null; tone: 'coral' | 'quiet' | null; title?: string }) {
  if (!words || !tone) return null;
  return (
    <span className={`tkrow-moment is-${tone}`} title={title ?? words}>
      {words}
    </span>
  );
}

export function WhenCell({ words, tone, title, onSelect }: { words?: string | null; tone: 'coral' | 'quiet' | null; title?: string; onSelect?(e: React.MouseEvent): void }) {
  return (
    <span
      className={`tkrow-when${words && tone ? '' : ' is-empty'}${onSelect && words ? ' is-action' : ''}`}
      aria-hidden={words && tone ? undefined : true}
      title={onSelect && words ? (title ?? 'Change the day') : undefined}
      onClick={onSelect && words ? onSelect : undefined}
    >
      <WhenInner words={words} tone={tone} title={onSelect ? undefined : title} />
    </span>
  );
}
