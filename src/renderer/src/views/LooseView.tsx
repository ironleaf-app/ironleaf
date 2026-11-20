// A Markdown file from outside the vault (21 Oct 2026, gap G26): opened from File Explorer ("Open with › Ironleaf"),
// dragged onto the window, or chosen with Open a file…, it is written in with Ironleaf's own editor and saved where it
// is, a moment after each change. It stays outside the notes (no links, search or graph) unless the person copies it in.
// The window reads and saves it only through the number Ironleaf gave it when it was opened (src/main/loose-files.ts).
// Guarded like a vault note (Nov 2026, nv-save F6): another program's save becomes a conflict copy beside it, never an
// overwrite; closing the window flushes it with everything else (state/looseSaves.ts).

import { useEffect, useRef, useState } from 'react';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { buildExtensions, newCompartments, type EditorHost } from '../editor/setup';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import * as A from '../state/actions';
import { errorMessage } from '../lib/errors';
import { loadFiles, loadNotes, prefs, showError, toast, useApp } from '../state/store';
import { looseSaves } from '../state/looseSaves';
import type { TabState } from '../state/workspace';
import { looseName } from '../../../shared/loose-name';

const folderOf = (p: string) => p.slice(0, Math.max(0, p.length - looseName(p).length)).replace(/[\\/]$/, '');

export function LooseView({ tab }: { tab: TabState }) {
  const abs = tab.path!;
  const canEdit = useApp((s) => s.canEdit);
  const parent = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [notice, setNotice] = useState<{ kind: 'conflict'; copy: string } | { kind: 'missing' } | null>(null);
  const actions = useRef<{ keepMine(): void; useTheirs(): void; saveBack(): void }>({ keepMine: () => {}, useTheirs: () => {}, saveBack: () => {} });

  useEffect(() => {
    let view: EditorView | null = null;
    let alive = true;
    let timer: number | undefined;
    let fileId: string | null = null;
    let last = '';
    let baseMtime = 0;
    let wasMissing = false;
    let unregister = () => {};
    const save = async (opts: { force?: boolean; blind?: boolean } = {}) => {
      timer = undefined;
      if (!view || !fileId) return;
      const words = view.state.doc.toString();
      if (!opts.force && words === last) return;
      setSaved('saving');
      try {
        const r = await window.nv.loose.write(fileId, words, opts.blind ? null : baseMtime);
        if (r.conflict) {
          last = words;
          baseMtime = r.mtime;
          if (alive) {
            setSaved('saved');
            setNotice({ kind: 'conflict', copy: r.conflict });
          }
          return;
        }
        if (r.missing) {
          wasMissing = true;
          if (alive) {
            setSaved('failed');
            setNotice({ kind: 'missing' });
          }
          return;
        }
        last = words;
        baseMtime = r.mtime;
        wasMissing = false;
        if (alive) {
          setSaved('saved');
          setNotice(null);
        }
      } catch (err) {
        if (alive) setSaved('failed');
        showError(err);
      }
    };
    actions.current = {
      // Mine win: the other change is the base now, so this save lands over it (its copy stays beside the file).
      keepMine: () => {
        setNotice(null);
        void save({ force: true });
      },
      useTheirs: () => {
        if (!view || !fileId) return;
        const id = fileId;
        void window.nv.loose
          .read(id)
          .then(({ text, mtime }) => {
            if (!alive || !view) return;
            last = text;
            baseMtime = mtime;
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)] });
            setNotice(null);
            setSaved('saved');
            toast('Kept the other version. Your words are still in its conflict copy.');
          })
          .catch(showError);
      },
      // The file is gone: these words go back where they were (an explicit recreate, never an automatic one).
      saveBack: () => void save({ force: true, blind: true }),
    };
    const later = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void save(), 600);
    };
    void (async () => {
      try {
        // Opened again by its path (after a restart the number it had is gone); a file now inside the vault opens as its note.
        const opened = await window.nv.loose.open(abs);
        if (!alive) return;
        if (opened.kind === 'vault') {
          A.openLoose(opened, 'current');
          return;
        }
        fileId = opened.file.id;
        setId(fileId);
        unregister = looseSaves.register(fileId, () => save());
        const { text, mtime } = await window.nv.loose.read(fileId);
        if (!alive || !parent.current) return;
        last = text;
        baseMtime = mtime;
        const host: EditorHost = {
          path: looseName(abs),
          version: () => 0,
          // Links in a file outside the notes open what they name in the notes, when it is there.
          openLink: (t, n) => void A.openLink(t, undefined, n ? 'right' : 'tab'),
          openUrl: (u) => window.open(u, '_blank'),
          openTag: () => {},
          hover: () => {},
          insertTemplate: () => {},
          linkToNote: () => {},
          saveFile: async () => {
            toast('Pictures go into notes in your vault. Copy this file into your notes first.');
            return null;
          },
          importFiles: async () => [],
          onChange: () => later(),
          dateFormat: () => prefs().dateFormat,
          timeFormat: () => prefs().timeFormat,
          wikilinks: () => prefs().wikilinks,
        };
        const header = document.createElement('div');
        view = new EditorView({
          state: EditorState.create({ doc: text, extensions: buildExtensions(host, header, newCompartments(), prefs().defaultMode === 'source' ? 'source' : 'live', prefs(), canEdit) }),
          parent: parent.current,
        });
      } catch (err) {
        if (alive) setProblem(errorMessage(err));
      }
    })();
    // Back in the window: what changed on disk meanwhile is shown (when nothing here is waiting to be saved).
    const onFocus = async () => {
      if (!view || !fileId || timer !== undefined) return;
      try {
        const { text, mtime } = await window.nv.loose.read(fileId);
        const now = view.state.doc.toString();
        if (text !== now && now === last) {
          last = text;
          baseMtime = mtime;
          view.dispatch({ changes: { from: 0, to: now.length, insert: text }, annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)] });
        } else if (mtime !== baseMtime && now === last) {
          baseMtime = mtime;
        }
      } catch {
        // Gone or locked: the next save says so.
      }
    };
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.removeEventListener('focus', onFocus);
      unregister();
      window.clearTimeout(timer);
      // Closing with words still here: they go back where they were. Outside the vault there is no File recovery to
      // catch them, so a file gone since is recreated on the way out, and the person is told.
      if (view && fileId && (view.state.doc.toString() !== last || wasMissing)) {
        const gone = wasMissing;
        void save({ force: true, blind: gone }).then(() => {
          if (gone) toast('Saved it back where it was.');
        });
      }
      view?.destroy();
    };
    // One editor per file shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abs]);

  const copyIn = async () => {
    if (!id) return;
    try {
      const rel = await window.nv.loose.copyIn(id);
      await Promise.all([loadNotes(), loadFiles()]);
      toast(`Copied into your notes as ${rel}. The file outside stays as it is.`, { label: 'Open', run: () => A.openPath(rel, { where: 'tab' }) });
    } catch (err) {
      showError(err);
    }
  };

  return (
    <div className="nv-loose nv-page">
      {/* Job C: the one PageHead, as every page (SPEC: no screen left on the old header). */}
      <PageHead
        icon="file"
        title={looseName(abs)}
        lead={<span title={abs}>Outside your notes · {folderOf(abs)} · <span className={`nv-loose-saved is-${saved}`} aria-live="polite">{saved === 'saving' ? 'Saving…' : saved === 'failed' ? 'Not saved' : 'Saved where it is'}</span></span>}
        actions={<button type="button" className="button" disabled={!id || !canEdit} onClick={() => void copyIn()}>Copy into your notes</button>}
      />
      {notice?.kind === 'conflict' && (
        <div className="nv-loose-problem" role="alert">
          <Icon name="warning" size={16} />
          <span>This file changed elsewhere. Both copies are kept: yours is in “{looseName(notice.copy)}”.</span>
          <button type="button" className="button" onClick={() => actions.current.keepMine()}>Keep mine</button>
          <button type="button" className="button" onClick={() => actions.current.useTheirs()}>Use theirs</button>
        </div>
      )}
      {notice?.kind === 'missing' && (
        <div className="nv-loose-problem" role="alert">
          <Icon name="warning" size={16} />
          <span>This file was moved or deleted. Your words are still here.</span>
          <button type="button" className="button" onClick={() => actions.current.saveBack()}>Save it back</button>
        </div>
      )}
      {problem ? (
        <div className="nv-loose-problem" role="alert">
          <Icon name="warning" size={16} />
          <span>{problem}</span>
        </div>
      ) : (
        <div className="nv-loose-editor note-editor" ref={parent} />
      )}
    </div>
  );
}
