// A file of the project's folder, shown beside the list when chosen: pictures, PDFs (Chromium's own viewer, as a PDF opens
// in a tab), video and recordings, Markdown read as a note, text and CSV tables; an Office file shows its card (it opens in
// its program). Its description (in the project's Documents) is edited here. "Open" shows it large over the page.

import { useEffect, useMemo, useState } from 'react';
import type { ProjectDocument } from '../../../../shared/project-file';
import type { ProjectFile, ProjectFileText } from '../../../../shared/types';
import { Icon } from '../../components/Icon';
import { errorMessage } from '../../lib/errors';
import { renderMarkdown } from '../../lib/markdownRender';
import { sizeWords, whenAgo } from '../../lib/projectLook';
import { showError } from '../../state/store';
import { csvRows, showsHereFor, viewerFor } from './fileModel';
import { KindTile, kindWords, Thumb, TypeArt } from './FileArt';
import { Inline, useEditor } from './Inline';
import { useFileUrl } from '../../lib/fileUrl';
import { PdfPages } from '../../lib/PdfPages';
import { isRemoteHandle } from '../../../../shared/project-folder';
import type { FileTextState } from '../../../../shared/file-index';

const texts = new Map<string, ProjectFileText>();

function useText(project: string, file: ProjectFile, wanted: boolean): ProjectFileText | null | undefined {
  const key = `${project}|${file.rel}|${file.modified}`;
  const [text, setText] = useState<ProjectFileText | null | undefined>(texts.get(key));
  useEffect(() => {
    if (!wanted) return;
    const known = texts.get(key);
    if (known) return setText(known);
    setText(undefined);
    let live = true;
    window.nv.projects.readFile(project, file.rel).then(
      (t) => {
        if (texts.size > 40) texts.delete(texts.keys().next().value!);
        texts.set(key, t);
        if (live) setText(t);
      },
      () => live && setText(null),
    );
    return () => {
      live = false;
    };
  }, [key, wanted]);
  return text;
}

/** A remote file's words (a Word, Excel or PowerPoint file, an email): read through the former host app by its readers, read
only. */
function RemoteWords({ project, file, place, big }: { project: string; file: ProjectFile; place: string; big?: boolean }) {
  const [got, setGot] = useState<{ state: FileTextState; text: string; cut: boolean } | null | undefined>(undefined);
  const [why, setWhy] = useState('');
  useEffect(() => {
    let live = true;
    setGot(undefined);
    window.nv.fileIndex.read(project, file.rel).then(
      (r) => live && setGot(r),
      (err: unknown) => {
        if (!live) return;
        setWhy(errorMessage(err));
        setGot(null);
      },
    );
    return () => {
      live = false;
    };
  }, [project, file.rel, file.modified]);
  if (got === undefined) return <div className="pf-view pf-view-text pf-loading" aria-label={`Reading ${file.name} on ${place}…`} />;
  if (got === null || got.state !== 'text') return <RemoteCard file={file} place={place} words={got === null ? why || `${file.name} couldn’t be read from ${place} just now.` : got.state === 'empty' ? 'There are no words in this file Ironleaf can read: it may be a scan or pictures.' : got.state === 'failed' ? 'This file couldn’t be read (it may be protected by a password).' : 'Ironleaf shows this kind of file by its name.'} />;
  return <RemoteWordsBody text={got.text} cut={got.cut} place={place} big={big} />;
}

/** A document's words as the former host app's readers give them (Markdown: headings, lists, tables), drawn as a
page. */
export function RemoteWordsBody({ text, cut, place, big }: { text: string; cut: boolean; place: string; big?: boolean }) {
  const max = big ? 400_000 : 60_000;
  const html = useMemo(
    () =>
      renderMarkdown(
        text
          .replace(/^\[Text extracted from [^\]\n]*\]\s*/, '')
          .replace(/^\f(.+)$/gm, (_m, label: string) => `### ${label.charAt(0).toUpperCase()}${label.slice(1)}`)
          .slice(0, max),
        { from: '' },
      ),
    [text, max],
  );
  return (
    <div className="pf-view pf-view-text pf-words">
      <p className="pf-words-note">
        <Icon name="text" size={13} /> Its words, read from {place}
      </p>
      <div
        className="markdown pf-markdown"
        onClick={(e) => {
          if ((e.target as Element).closest('a')) e.preventDefault();
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {(cut || text.length > max) && <p className="pf-more">The start of the file{big ? '' : ': show it larger for more'}.</p>}
    </div>
  );
}

/** A remote file shown by its card (a kind Ironleaf doesn't show, or one that couldn't be fetched). */
function RemoteCard({ file, place, words }: { file: ProjectFile; place: string; words?: string }) {
  return (
    <div className="pf-view pf-view-card">
      <span className="pf-card-art">
        <TypeArt ext={file.ext} />
      </span>
      <span className="pf-card-kind">{kindWords(file.ext)}</span>
      <span className="pf-card-words">{words ?? `On ${place}. Ironleaf shows this kind of file by its name and details.`}</span>
    </div>
  );
}

/** The file itself, as large as it is given room. `place` names a remote computer ("fileserver-01"). */
export function FileView({ project, folder, file, big, place = 'the remote computer' }: { project: string; folder: string; file: ProjectFile; big?: boolean; place?: string }) {
  const kind = viewerFor(file.ext);
  const remote = isRemoteHandle(folder);
  const shownItself = kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio';
  // A remote PDF's pages are drawn here (no file on this PC for Chromium's viewer); other kinds come as an address.
  const remotePdf = remote && kind === 'pdf';
  const url = useFileUrl(project, folder, file, shownItself && !remotePdf);
  const text = useText(project, file, kind === 'markdown' || kind === 'text' || kind === 'csv');
  const html = useMemo(() => (kind === 'markdown' && text ? renderMarkdown(text.text.slice(0, 120000), { from: '' }) : ''), [kind, text]);
  const rows = useMemo(() => (kind === 'csv' && text ? csvRows(text.text, big ? 200 : 60) : []), [kind, text, big]);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  if (broken) return remote ? <RemoteCard file={file} place={place} words="This file couldn’t be shown here." /> : <Card file={file} project={project} folder={folder} words="This file couldn’t be shown here." />;
  if (remotePdf) return <PdfPages load={() => window.nv.projects.fileBytes(project, file.rel)} name={`${project}|${file.rel}|${file.modified}|${file.size}`} big={big} onFail={() => setBroken(true)} />;
  if (shownItself && remote && url === undefined) return <div className={`pf-view pf-loading pf-view-${kind}`} aria-label={`Fetching ${file.name} from ${place}…`} />;
  if (shownItself && remote && !url) return <RemoteCard file={file} place={place} words={`${file.name} couldn’t be fetched from ${place} just now${file.size > 16 * 1048576 ? ': it is too big to show here' : ''}.`} />;
  if (!url && shownItself) return null;
  switch (kind) {
    case 'image':
      return (
        <div className="pf-view pf-view-image">
          <img src={url!} alt={file.name} onError={() => setBroken(true)} />
        </div>
      );
    case 'pdf':
      return <iframe className="pf-view pf-view-pdf" src={`${url}#toolbar=${big ? 1 : 0}&navpanes=0&view=FitH`} title={file.name} />;
    case 'video':
      return <video className="pf-view pf-view-video" controls src={url!} onError={() => setBroken(true)} />;
    case 'audio':
      return (
        <div className="pf-view pf-view-audio">
          <Icon name="audio" size={36} />
          <audio controls src={url!} onError={() => setBroken(true)} />
        </div>
      );
    case 'markdown':
    case 'text':
    case 'csv':
      if (text === undefined) return <div className="pf-view pf-view-text pf-loading" />;
      if (text === null) return remote ? <RemoteCard file={file} place={place} words={`${file.name} couldn’t be read from ${place} just now.`} /> : <Card file={file} project={project} folder={folder} words="This file couldn’t be read." />;
      return (
        <div className="pf-view pf-view-text">
          {kind === 'markdown' ? (
            <div
              className="markdown pf-markdown"
              // Links inside a document from the folder aren't notes here: they don't go anywhere from the preview.
              onClick={(e) => {
                if ((e.target as Element).closest('a')) e.preventDefault();
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : kind === 'csv' ? (
            <table className="pf-csv">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre className="pf-pre">{text.text.split('\n').slice(0, big ? 5000 : 400).join('\n')}</pre>
          )}
          {(text.truncated || (kind === 'csv' && rows.length >= (big ? 200 : 60))) && <p className="pf-more">The start of the file: open it for the rest.</p>}
        </div>
      );
    default:
      if (remote) return kind === 'office' ? <RemoteWords project={project} file={file} place={place} big={big} /> : <RemoteCard file={file} place={place} />;
      return <Card file={file} project={project} folder={folder} />;
  }
}

/** A file Ironleaf doesn't show itself: its card (a first page when Windows makes one), and that it opens in its program. */
function Card({ file, project, folder, words }: { file: ProjectFile; project: string; folder: string; words?: string }) {
  return (
    <div className="pf-view pf-view-card">
      <span className="pf-card-art">{/^(pdf|pptx?|odp)$/i.test(file.ext) ? <Thumb project={project} folder={folder} file={file} /> : <TypeArt ext={file.ext} />}</span>
      <span className="pf-card-kind">{kindWords(file.ext)}</span>
      <span className="pf-card-words">{words ?? 'Opens in its own program.'}</span>
    </div>
  );
}

export function FilePreview({ project, folder, file, doc, pinned, describeNow, onClose, onOpen, onBig, place }: { project: string; folder: string; file: ProjectFile | null; doc?: ProjectDocument; pinned: boolean; describeNow: number; onClose(): void; onOpen(): void; onBig(): void; place?: string }) {
  const { edit, canEdit } = useEditor();
  const remote = isRemoteHandle(folder);
  const large = !!file && showsHereFor(file.ext, remote);
  const rel = file?.rel ?? doc?.path ?? '';
  const name = rel.split('/').pop() ?? rel;
  const sub = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  return (
    <aside className="pf-preview" aria-label={`Preview of ${name}`}>
      <header className="pf-preview-head">
        <KindTile ext={file?.ext ?? name.split('.').pop() ?? ''} />
        <span className="pf-preview-title">
          <span className="pf-preview-name" title={rel}>
            {name}
          </span>
          <span className="pf-preview-meta">{file ? [kindWords(file.ext), sizeWords(file.size), `changed ${whenAgo(file.modified)}`, sub && `in ${sub}`].filter(Boolean).join(' · ') : 'Not in the folder any more'}</span>
        </span>
        <button className="icon-button" title="Close the preview (Esc)" onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </header>
      {file ? (
        <div className="pf-preview-body" onDoubleClick={() => (large ? onBig() : remote ? undefined : onOpen())}>
          <FileView project={project} folder={folder} file={file} place={place} />
        </div>
      ) : (
        <div className="pf-preview-body">
          <div className="pf-view pf-view-card">
            <span className="pf-card-words">The project names this file, but it isn’t in the folder now: it may have moved or been renamed.</span>
          </div>
        </div>
      )}
      <div className="pf-desc">
        <Inline
          key={`${rel}:${describeNow}`}
          autoEdit={describeNow > 0}
          value={doc?.what ?? ''}
          placeholder={pinned ? 'Add a description…' : 'Describe it (pins it to the top)…'}
          label="Description"
          className="pf-desc-text"
          onSave={(what) => edit({ kind: 'describe', path: rel, what })}
        />
        {!canEdit && !doc?.what && <span className="pj-faint">No description.</span>}
      </div>
      <footer className="pf-preview-foot">
        {file && !remote && (
          <button className="button primary" onClick={onOpen} title="Open it in its own program">
            <Icon name="external" size={14} /> Open
          </button>
        )}
        {file && large && (
          <button className={`button${remote ? ' primary' : ''}`} onClick={onBig} title="Show it large here">
            <Icon name="expand" size={14} /> Larger
          </button>
        )}
        {file && !remote && (
          <button className="button" onClick={() => void window.nv.projects.showFile(project, file.rel).catch(showError)}>
            <Icon name="reveal" size={14} /> Show in folder
          </button>
        )}
        {file && remote && (
          <span className="pf-remote-note" title="Ironleaf reads this computer’s files and never changes them">
            <Icon name="lock" size={12} /> On {place} · read only
          </span>
        )}
        <span className="pj-card-space" />
        {canEdit && (
          <button className={`button pf-pin-button${pinned ? ' is-on' : ''}`} onClick={() => void edit({ kind: 'pin', path: rel, pinned: !pinned })} title={pinned ? 'Take it off the top of the list' : 'Keep it at the top of the list'}>
            <Icon name="pin" size={14} /> {pinned ? 'Pinned' : 'Pin'}
          </button>
        )}
      </footer>
    </aside>
  );
}

/** A file shown large over the page ("Open", or Larger): ← → go through the files listed, Esc closes. */
export function FileOverlay({ project, folder, file, onClose, onStep, onOpen, place, single = false }: { project: string; folder: string; file: ProjectFile; onClose(): void; onStep(by: number): void; onOpen(): void; place?: string; /** One file on its own (a delivered file): no going to the one before or after. */ single?: boolean }) {
  const remote = isRemoteHandle(folder);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !(e.target as Element)?.closest?.('input, textarea')) {
        e.preventDefault();
        onStep(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, onStep]);
  return (
    <div className="overlay pf-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pf-overlay-box" role="dialog" aria-label={file.name}>
        <header className="pf-overlay-head">
          <KindTile ext={file.ext} />
          <span className="pf-preview-title">
            <span className="pf-preview-name">{file.name}</span>
            <span className="pf-preview-meta">
              {remote ? `On ${place} · ` : ''}
              {kindWords(file.ext)} · {sizeWords(file.size)} · changed {whenAgo(file.modified)}
            </span>
          </span>
          {!single && (
            <>
              <button className="icon-button" title="The one before (←)" onClick={() => onStep(-1)}>
                <Icon name="back" size={16} />
              </button>
              <button className="icon-button" title="The next one (→)" onClick={() => onStep(1)}>
                <Icon name="forward" size={16} />
              </button>
            </>
          )}
          {remote ? (
            <span className="pf-remote-note">
              <Icon name="lock" size={12} /> Read only
            </span>
          ) : (
            <button className="button" onClick={onOpen}>
              <Icon name="external" size={14} /> Open in its program
            </button>
          )}
          <button className="icon-button" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="pf-overlay-body">
          <FileView project={project} folder={folder} file={file} big place={place} />
        </div>
      </div>
    </div>
  );
}
