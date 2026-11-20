// Settings › Publish (9.0 w122publish): the person's sites kept in one place (name, what is in it, where it goes,
// last published), each opened, republished, unpublished or forgotten from here.

import { useEffect, useState } from 'react';
import type { SiteDef } from '../../../shared/site-publish';
import { describeSource } from '../../../shared/site-publish';
import { confirmFolderUnpublish } from '../lib/siteUnpublish';
import { openModal } from '../state/modals';
import { getState } from '../state/store';
import { showError, toast } from '../state/store';
import { Row } from './Settings';

const titleOf = (rel: string): string => getState().byPath.get(rel)?.label ?? getState().byPath.get(rel)?.title ?? rel.split('/').pop()!.replace(/\.md$/i, '');

function when(iso: string): string {
  if (!iso) return 'Not published yet';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Published' : `Published ${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function PublishSettings() {
  const [sites, setSites] = useState<SiteDef[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    const read = () => window.nv.site.list().then((s) => on && setSites(s), showError);
    void read();
    const off = window.nv.on.siteChanged(read);
    return () => {
      on = false;
      off();
    };
  }, []);
  const act = async (id: string, op: 'publish' | 'unpublish' | 'remove' | 'open') => {
    if (busy) return;
    // No site comes down unasked (9.2 uplift F142): folder destinations confirm here, hosts in the dialog.
    if (op === 'unpublish' && !(await confirmFolderUnpublish(id, sites?.find((s) => s.id === id)?.name ?? 'this site'))) return;
    setBusy(`${op}:${id}`);
    try {
      if (op === 'publish') {
        const r = await window.nv.site.publish(id);
        if (r) toast(r.words);
      } else if (op === 'unpublish') {
        const r = await window.nv.site.unpublish(id, true);
        if ('ask' in r) openModal({ kind: 'publish', siteId: id });
        else toast(r.words);
      } else if (op === 'remove') {
        const r = await window.nv.site.remove(id);
        toast(r.words);
      } else {
        await window.nv.site.open(id);
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Row title="New site" hint="Chosen pages as a finished site, in a folder or on your own host.">
        <span className="ctl">
          <button type="button" className="button" onClick={() => openModal({ kind: 'publish' })}>
            New site…
          </button>
        </span>
      </Row>
      <Row title="Your sites" hint="Every website kept: what is in it, where it goes, when it went." stacked>
        {sites === null ? (
          <p className="hint">Reading your sites…</p>
        ) : !sites.length ? (
          <p className="hint">No sites yet. New site turns chosen pages into a finished website.</p>
        ) : (
          <ul className="site-list">
            {sites.map((s) => (
              <li key={s.id} className="site-row">
                <div className="site-words">
                  <div className="site-name">{s.name}</div>
                  <div className="site-detail">{describeSource(s.source, titleOf)}</div>
                  <div className="site-detail hint">
                    {s.folder || 'No folder chosen yet'}
                    {s.host ? ` · ${s.host.id}` : ''} · {when(s.publishedAt)}
                  </div>
                </div>
                <div className="site-actions">
                  <button type="button" className="button" onClick={() => openModal({ kind: 'publish', siteId: s.id })}>
                    Open
                  </button>
                  {s.publishedAt ? (
                    <>
                      <button type="button" className="button" disabled={busy !== null} onClick={() => void act(s.id, 'publish')}>
                        {busy === `publish:${s.id}` ? 'Publishing…' : 'Republish'}
                      </button>
                      <button type="button" className="button" onClick={() => void act(s.id, 'open')}>
                        Open site
                      </button>
                      <button type="button" className="button quiet" disabled={busy !== null} onClick={() => void act(s.id, 'unpublish')}>
                        {busy === `unpublish:${s.id}` ? 'Unpublishing…' : 'Unpublish'}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="button primary" disabled={busy !== null} onClick={() => void act(s.id, 'publish')}>
                      {busy === `publish:${s.id}` ? 'Publishing…' : 'Publish'}
                    </button>
                  )}
                  <button type="button" className="button quiet" disabled={busy !== null} onClick={() => void act(s.id, 'remove')}>
                    Forget
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Row>
    </>
  );
}
