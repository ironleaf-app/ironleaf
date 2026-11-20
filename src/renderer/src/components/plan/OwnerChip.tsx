// An owner in plain words (5 Nov 2026, the plan "Vault: status in plain words"; one set,
// the plan): the face and the name, never a filled box. Small is Today and Tasks' quiet
// reading; the regular size is Projects' and the project page's. The name is shown as ownerName
// reads it, and nothing shows when it names nobody. The person's own name never shows on their own
// items (SPEC section A): callers that know who the person is (Today's data, Tasks) pass `me`;
// "Waiting on" lists name other people, so they keep their names.
import { initials, personHue } from '../../lib/projectLook';
import { isOwnName, ownerName } from './plan';

export function OwnerChip({ name, onClick, title, size = 'regular', me }: { name: string; onClick?(): void; title?: string; size?: 'small' | 'regular'; me?: string | null }) {
  const shown = ownerName(name);
  if (!shown) return null;
  if (me !== undefined && isOwnName(shown, me)) return null;
  const inner = (
    <>
      <span className="pj-avatar small plan-owner-avatar" style={{ ['--hue' as string]: personHue(shown) }} aria-hidden="true">
        {initials(shown)}
      </span>
      <span className="plan-owner-name">{shown}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={`plan-owner-words${size === 'small' ? ' is-small' : ''}`} title={title ?? (size === 'small' ? shown : `Everything about ${shown}`)} onClick={(e) => { e.stopPropagation(); onClick(); }} onKeyDown={(e) => e.stopPropagation()}>
      {inner}
    </button>
  ) : (
    <span className={`plan-owner-words${size === 'small' ? ' is-small' : ''}`} title={title ?? shown}>
      {inner}
    </span>
  );
}
