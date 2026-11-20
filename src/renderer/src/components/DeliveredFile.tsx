// A file an agent delivered into a project (project_save_file), as one clean card: its first page (PDFs drawn here,
// pictures themselves, slides as Windows draws them), its name, the agent's one line on what it is, and Open / Show in
// folder (Open is the file itself in the full viewer). The same card on Today ("Chief delivered Closeout report.pdf to
// Harbour Lane"), at the top of the project's Updates, in What agents did and above an agent's words in its reply.

import { useEffect, useRef, useState } from 'react';
import { deliveredWords, type DeliveredFile } from '../../../shared/agent-files';
import { usePdfFirstPage } from '../lib/pdfThumb';
import { initials, personHue, sizeWords, whenAgo } from '../lib/projectLook';
import * as A from '../state/actions';
import { showDelivered } from '../state/agents';
import { closeModal } from '../state/modals';
import { folderFileUrl, viewerFor } from '../views/project/fileModel';
import { KindTile, kindWords, TypeArt } from '../views/project/FileArt';
import { Icon } from './Icon';

const split = (abs: string) => {
  const at = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'));
  return { dir: abs.slice(0, at), base: abs.slice(at + 1) };
};

function PdfPage({ f }: { f: DeliveredFile }) {
  const where = f.place === 'folder' && f.project ? { project: f.project.path, file: f.path } : { rel: f.path };
  const { ref, url } = usePdfFirstPage(f.exists ? where : null, `${f.at}:${f.size}`);
  return (
    <span className="dv-thumb" ref={ref as React.RefObject<HTMLSpanElement>}>
      {url ? <img className="dv-page" src={url} alt="" /> : <TypeArt ext={f.ext} />}
    </span>
  );
}

function SlidesPage({ f }: { f: DeliveredFile }) {
  const [url, setUrl] = useState<string | null>(null);
  // A replaced file draws its new thumbnail (9.2 uplift F124): the version stamp joins the id, as the PDF's does.
  useEffect(() => {
    if (!f.exists || f.place !== 'folder' || !f.project) return;
    let live = true;
    window.nv.projects.thumb(f.project.path, f.path).then(
      (u) => live && setUrl(u),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [f.id, f.at, f.size]);
  return <span className="dv-thumb">{url ? <img className="dv-page" src={url} alt="" /> : <TypeArt ext={f.ext} />}</span>;
}

/** The file's picture: its first page, the picture itself, or its kind's designed sheet. */
export function DeliveredThumb({ f }: { f: DeliveredFile }) {
  const [broken, setBroken] = useState(false);
  if (f.exists && f.ext === 'pdf') return <PdfPage f={f} />;
  if (f.exists && /^(pptx?|odp)$/.test(f.ext)) return <SlidesPage f={f} />;
  if (f.exists && viewerFor(f.ext) === 'image' && !broken) {
    const { dir, base } = split(f.abs);
    return (
      <span className="dv-thumb is-picture">
        <img src={folderFileUrl(dir, base)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <span className="dv-thumb">
      <TypeArt ext={f.ext} />
    </span>
  );
}

/** Open means the file itself in the full viewer (t239), whatever kind it is; its program stays one click away there. */
export function openDelivered(f: DeliveredFile): void {
  if (f.place === 'folder' && f.project) A.openFolderFile(f.project.path, f.path);
  else {
    closeModal();
    A.openPath(f.path);
  }
  void window.nv.agents.seenFile(f.id).catch(() => undefined);
}

/** One delivered file as a row of a list (t253, 13 Nov 2026, fourth picture: the Updates cards stood about
 *  140 px tall for one file): as compact as the page's other rows, keeping every fact and both buttons. */
export function DeliveredRow({ f }: { f: DeliveredFile }) {
  const open = () => openDelivered(f);
  const where = f.project ? f.project.name : f.note ? A.titleOf(f.note) : '';
  const meta = [
    f.what,
    `${kindWords(f.ext)} · ${sizeWords(f.size)}`,
    `${f.agentName} delivered it${where ? ` to ${where}` : ''}`,
    whenAgo(f.at),
    !f.exists ? 'moved or deleted since' : '',
    f.remoteName ? `kept in Ironleaf (the folder on ${f.remoteName} is read only)` : '',
    f.replaced ? 'replaced the earlier one' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="trow compact">
      <KindTile ext={f.ext} />
      <div style={{ minWidth: 0 }}>
        <button className="t" style={{ border: 0, background: 'none', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left', padding: 0, display: 'block', maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'break-word' }} onClick={open} disabled={!f.exists} title={f.exists ? `Open ${f.name}` : 'Moved or deleted since'}>
          {f.name}
        </button>
        <div className="meta">{meta}</div>
      </div>
      {f.exists && (
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flex: 'none' }}>
          <button className="button primary" style={{ height: 28 }} onClick={open}>
            Open
          </button>
          <button className="button" style={{ height: 28 }} onClick={() => void showDelivered(f)}>
            <Icon name="reveal" size={13} /> Show in folder
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * One delivered file. `heading` shows who delivered it and where (Today, What agents did); without it the card is the
 * file alone (inside a reply, at the top of the project's Updates).
 */
export function DeliveredCard({ f, heading = false, onPutAway, compact = false }: { f: DeliveredFile; heading?: boolean; onPutAway?(): void; compact?: boolean }) {
  const card = useRef<HTMLDivElement>(null);
  const open = () => openDelivered(f);
  const where = f.project ? f.project.name : f.note ? A.titleOf(f.note) : '';
  return (
    <div className={`dv-card${compact ? ' is-compact' : ''}${f.exists ? '' : ' is-gone'}${onPutAway ? ' has-away' : ''}`} ref={card}>
      {/* The body is a size container (not the card: the preview over the page is inside the card), and its grid lays out
          by the card's own width: the buttons under the words on a narrow card, never wrapped onto a second line. */}
      <div className="dv-body">
        <div className="dv-grid">
          <button className="dv-thumb-button" onClick={open} disabled={!f.exists} title={f.exists ? `Open ${f.name}` : 'Moved or deleted since'} aria-label={`Open ${f.name}`}>
            <DeliveredThumb f={f} />
          </button>
          <div className="dv-main">
            {heading && (
              <div className="dv-who">
                <AgentAvatar name={f.agentName} size="small" />
                <span>
                  {deliveredWords(f)}
                  <span className="dv-when"> · {whenAgo(f.at)}</span>
                </span>
              </div>
            )}
            <button className="dv-name" onClick={open} disabled={!f.exists} title={f.name}>
              {f.name}
            </button>
            {f.what && <p className="dv-what">{f.what}</p>}
            <p className="dv-meta">
              {kindWords(f.ext)} · {sizeWords(f.size)}
              {!heading && where ? ` · ${where}` : ''}
              {!heading ? ` · ${whenAgo(f.at)}` : ''}
              {f.exists ? '' : ' · moved or deleted since'}
              {f.remoteName ? ` · kept in Ironleaf (the folder on ${f.remoteName} is read only)` : ''}
              {f.replaced ? ' · replaced the earlier one' : ''}
            </p>
          </div>
          {f.exists && (
            <div className="dv-actions">
              <button className="button primary dv-open" onClick={open}>
                Open
              </button>
              <button className="button" onClick={() => void showDelivered(f)}>
                <Icon name="reveal" size={13} /> Show in folder
              </button>
            </div>
          )}
        </div>
      </div>
      {onPutAway && (
        <button className="icon-button dv-away" title="Put away" aria-label="Put away" onClick={onPutAway}>
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );
}

/** Several delivered files as cards (a reply's, the project's latest). */
export function DeliveredList({ files, compact = false, label }: { files: DeliveredFile[]; compact?: boolean; label?: string }) {
  if (!files.length) return null;
  return (
    <div className="dv-list" aria-label={label ?? 'Files delivered'}>
      {files.map((f) => (
        <DeliveredCard key={f.id} f={f} compact={compact} />
      ))}
    </div>
  );
}

/** An agent's face: its initials on a soft square of its own colour. */
function AgentAvatar({ name, size = 'normal' }: { name: string; size?: 'normal' | 'small' | 'large' }) {
  return (
    <span className={`ag-avatar${size === 'normal' ? '' : ` ${size}`}`} style={{ ['--hue' as string]: personHue(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
