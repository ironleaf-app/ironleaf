// A project whose folder is on another PC (22 Oct 2026: the vault syncs between a desktop and a travel laptop,
// and a project's folder, C:\Users\alex\Downloads\projects\…, is only on the desktop). The page never says there is no
// folder: a calm card says where it is and offers what to do on this PC: choose its folder here, find it, use a new
// folder here, or work without a folder. What is chosen is this PC's alone (src/main/project-places.ts); the note, and
// the other PC, keep their own.

import { useState } from 'react';
import type { FolderPlace } from '../../../../shared/project-folder';
import { lastPart } from '../../../../shared/project-folder';
import type { FolderHereResult } from '../../../../shared/types';
import { Icon } from '../../components/Icon';
import type { MenuItem } from '../../components/Menu';
import { showError, toast } from '../../state/store';

type Action = 'choose' | 'find' | 'new' | 'without';

/** One of the choices, done: the page takes the new view, and the person hears what happened. */
async function act(path: string, action: Action | 'forget', onDone: (r: FolderHereResult) => void, folder?: string): Promise<FolderHereResult | null> {
  try {
    const r = await window.nv.projects.folderHere(path, action, folder);
    onDone(r);
    if (r.words && !(action === 'find' && (r.found?.length ?? 0) !== 1)) toast(r.words);
    return r;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** The choices as menu items (Work on it, when the folder is on another PC). */
export function folderHereItems(path: string, onDone: (r: FolderHereResult) => void, then?: () => void): MenuItem[] {
  const run = (action: Action) => () =>
    void act(path, action, onDone).then((r) => {
      // Find it with several (or none) found: the card on the page shows them.
      if (r && (action !== 'find' || r.found?.length === 1) && r.view.place?.state !== 'elsewhere') then?.();
      else if (r && action === 'find') document.querySelector('.pjfh-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  return [
    { label: 'Choose its folder on this PC…', icon: 'folderOpen', run: run('choose') },
    { label: 'Find it', icon: 'search', run: run('find') },
    { label: 'Use a new folder here', icon: 'folderPlus', run: run('new') },
    { label: 'Work without a folder', icon: 'vault', run: run('without') },
  ];
}

export function FolderHere({ path, place, onDone }: { path: string; place: FolderPlace; onDone: (r: FolderHereResult) => void }) {
  const [busy, setBusy] = useState<Action | ''>('');
  const [found, setFound] = useState<{ folders: string[]; words: string } | null>(null);
  const name = lastPart(place.recorded);
  const go = async (action: Action, folder?: string) => {
    setBusy(action);
    const r = await act(path, action, onDone, folder);
    setBusy('');
    if (r && action === 'find' && r.found?.length !== 1) setFound({ folders: r.found ?? [], words: r.words });
    else if (r) setFound(null);
  };
  return (
    <section className="pjfh-card" aria-label="This project’s folder is on another PC">
      <div className="pjfh-head">
        <span className="pjfh-mark" aria-hidden>
          <Icon name="computer" size={18} />
        </span>
        <div className="pjfh-words">
          <h2 className="pjfh-title">This project’s folder is on another PC</h2>
          <p className="pjfh-text">
            Its notes are here, but its folder isn’t on this PC. Choose where it is here; your other PC keeps its own.
          </p>
          <p className="pjfh-path" title={place.recorded}>
            <Icon name="folder" size={13} />
            <bdi dir="ltr">{place.recorded}</bdi>
          </p>
          {place.lost && (
            <p className="pjfh-lost">
              The folder chosen on this PC before, <bdi dir="ltr">{place.lost}</bdi>, isn’t there any more.
            </p>
          )}
        </div>
      </div>
      <div className="pjfh-actions">
        <button className="button primary" disabled={!!busy} onClick={() => void go('choose')}>
          <Icon name="folderOpen" size={14} /> Choose its folder on this PC…
        </button>
        <button className="button" disabled={!!busy} onClick={() => void go('find')} aria-busy={busy === 'find'}>
          <Icon name="search" size={14} /> {busy === 'find' ? 'Looking…' : 'Find it'}
        </button>
        <button className="button" disabled={!!busy} onClick={() => void go('new')} title={`A new folder called “${name}” on this PC`}>
          <Icon name="folderPlus" size={14} /> Use a new folder here
        </button>
        <button className="pjfh-quiet" disabled={!!busy} onClick={() => void go('without')} title="Its files are kept with the project in Ironleaf">
          Work without a folder
        </button>
      </div>
      {found && (
        <div className="pjfh-found" role="status">
          <p>{found.words}</p>
          {found.folders.length > 0 && (
            <ul>
              {found.folders.map((f) => (
                <li key={f}>
                  <Icon name="folder" size={13} />
                  <bdi dir="ltr" title={f}>
                    {f}
                  </bdi>
                  <button className="button" disabled={!!busy} onClick={() => void go('choose', f)}>
                    Use this
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Put back what this PC chose: the folder is looked for as the note names it again (More › Its folder on this PC). */
export const forgetFolderHere = (path: string, onDone: (r: FolderHereResult) => void) => void act(path, 'forget', onDone);

/** Choose its folder on this PC from a menu (t267, 13 Nov 2026, the tabs left a project with no folder
 *  no way to link one): the one picker, through the shared call, the page taking the new view. */
export const chooseFolderHere = (path: string, onDone: (r: FolderHereResult) => void) => void act(path, 'choose', onDone);
