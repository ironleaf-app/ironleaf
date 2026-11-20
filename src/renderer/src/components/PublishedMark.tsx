// The Published line in a page's head (9.0 w122publish): each site the open page is published in, with a link to
// the published site and unpublish in one step. Quiet when the page is in no site.

import { useEffect, useState } from 'react';
import { confirmFolderUnpublish } from '../lib/siteUnpublish';
import { openModal } from '../state/modals';
import { showError, toast } from '../state/store';

export function useSiteMarks() {
  const [marks, setMarks] = useState<{ path: string; sites: { id: string; name: string }[] }[]>([]);
  useEffect(() => {
    let on = true;
    const read = () => window.nv.site.marks().then((m) => on && setMarks(m), () => undefined);
    void read();
    const off = window.nv.on.siteChanged(read);
    return () => {
      on = false;
      off();
    };
  }, []);
  return marks;
}

export function PublishedMark({ path }: { path: string }) {
  const marks = useSiteMarks();
  const here = marks.find((m) => m.path === path);
  const [busy, setBusy] = useState<string | null>(null);
  if (!here) return null;
  const open = (id: string) => window.nv.site.open(id).catch(showError);
  const unpublish = async (id: string, name: string) => {
    if (busy) return;
    // A page-level click never takes down the whole site unasked (9.2 uplift F142).
    if (!(await confirmFolderUnpublish(id, name))) return;
    setBusy(id);
    try {
      const r = await window.nv.site.unpublish(id, true);
      if ('ask' in r) {
        // A host destination asks first: the dialog asks in its own words.
        openModal({ kind: 'publish', siteId: id });
        return;
      }
      toast(r.words || `“${name}” is unpublished.`);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="published-mark" role="status">
      <span className="published-dot" aria-hidden="true" />
      <span>
        Published{here.sites.length > 1 ? ` in ${here.sites.length} sites` : ''}:{' '}
        {here.sites.map((s, i) => (
          <span key={s.id}>
            {i > 0 && ', '}
            <button type="button" className="text-button" title="Open the published site" onClick={() => open(s.id)}>
              {s.name}
            </button>{' '}
            <button type="button" className="text-button subtle" title={`Unpublish “${s.name}”`} disabled={busy === s.id} onClick={() => void unpublish(s.id, s.name)}>
              {busy === s.id ? 'Unpublishing…' : 'Unpublish'}
            </button>
          </span>
        ))}
      </span>
    </div>
  );
}
