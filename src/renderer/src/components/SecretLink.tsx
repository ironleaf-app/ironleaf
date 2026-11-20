// A locked link in a note ("iPad passcode: [locked](secret:…)", Wave 4, 24 Oct 2026): a click opens a small card with
// the secret's name and its value masked, Show for a moment and Copy (the clipboard clears itself), or Unlock when Secrets
// are locked. The note itself never holds the value. Live Preview's links come through A.openLink; the reading view's
// plain links are caught here, once for the whole window.

import { useEffect, useState } from 'react';
import type { SecretView } from '../../../shared/secrets';
import { choose } from './Dialogs';
import { Icon } from './Icon';
import { errorMessage } from '../lib/errors';
import { withStepUp } from '../lib/step-up';
import { toast } from '../state/store';

const ID = /^[A-Za-z0-9_-]{6,40}$/;

function SecretCard({ id }: { id: string }) {
  const [secret, setSecret] = useState<SecretView | null | undefined>(undefined);
  const [value, setValue] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  useEffect(() => {
    void window.nv.secrets.list().then((all) => setSecret(all.find((s) => s.id === id) ?? null), (err) => setSaid(errorMessage(err)));
  }, [id]);
  useEffect(() => {
    if (value === null) return;
    const t = window.setTimeout(() => setValue(null), 20_000);
    return () => window.clearTimeout(t);
  }, [value]);
  if (secret === undefined) return <p className="sl-faint">{said || 'Opening…'}</p>;
  if (secret === null) return <p className="sl-faint">This link’s secret isn’t in Secrets any more (deleted, or not synced to this PC yet).</p>;
  return (
    <div className="sl-card">
      <div className="sl-name">
        <Icon name="key" size={14} /> {secret.name}
      </div>
      {(secret.username || secret.where) && <div className="sl-sub">{[secret.username, secret.where].filter(Boolean).join(' · ')}</div>}
      <div className="sl-value-row">
        <span className={`sl-value${value !== null ? ' is-shown' : ''}`}>{value ?? secret.masked}</span>
        <button
          className="icon-button"
          title={value !== null ? 'Hide' : 'Show for 20 seconds'}
          onClick={async () => {
            if (value !== null) return setValue(null);
            try {
              setValue(await withStepUp(() => window.nv.secrets.reveal(id)));
            } catch (err) {
              setSaid(errorMessage(err));
            }
          }}
        >
          <Icon name="eye" size={15} />
        </button>
        <button
          className="button small"
          onClick={async () => {
            try {
              const { seconds } = await withStepUp(() => window.nv.secrets.copy(id));
              toast(`Copied. It leaves the clipboard in ${seconds} seconds.`);
            } catch (err) {
              setSaid(errorMessage(err));
            }
          }}
        >
          <Icon name="copy" size={13} /> Copy
        </button>
      </div>
      {said && <p className="pv-said">{said}</p>}
    </div>
  );
}

/** The card for a locked link (or Unlock when Locked is locked). */
export async function showSecret(rawId: string): Promise<void> {
  const id = rawId.trim();
  // A malformed locked link says so (9.2 uplift F120), never nothing.
  if (!ID.test(id)) {
    await choose('This locked link looks broken', [], 'It doesn’t name a secret the vault can open. Fix the link in the note, or make the link again.');
    return;
  }
  const { openSecrets } = await import('../state/actions');
  const status = await window.nv.secrets.status().catch(() => null);
  if (!status?.unlocked) {
    const go = await choose('This is locked', [{ id: 'unlock', label: status?.exists ? 'Unlock it' : 'Set it up', primary: true }], 'It’s kept in Locked, never in the note. Unlock it to see or copy it.');
    if (go === 'unlock') openSecrets('secrets');
    return;
  }
  const go = await choose('Locked secret', [{ id: 'open', label: 'Open in Secrets' }], <SecretCard id={id} />);
  if (go === 'open') openSecrets('secrets');
}

let caught = false;
/** Plain links to secrets in the reading view (and anywhere else in the window) open the card instead of going anywhere. */
export function catchSecretLinks(): void {
  if (caught) return;
  caught = true;
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href^="secret:"]') as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      void showSecret(a.getAttribute('href')!.slice(7));
    },
    true,
  );
}
