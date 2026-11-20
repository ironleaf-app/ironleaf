// What the assistant looked at in a project's folder, beside its answer (4.9.5): the folder's folders and files, or what
// changed since a date, as a tidy list — each with its kind, size and when it changed — instead of paths in the answer.
// A file opens in Ironleaf's viewer (a remote computer's too, read through the former host app); a folder row opens that
// folder, drilled in the card with a way back (9.2 uplift F31: every row opens what it names).

import { useState } from 'react';
import type { ChatFolderCard } from '../../../shared/types';
import { Icon } from '../components/Icon';
import { sizeWords, whenAgo } from '../lib/projectLook';
import { showFileHit } from '../state/fileSearch';
import { KindTile, kindWords } from '../views/project/FileArt';

const SHOWN = 8;

function FolderCard({ card, onOpen }: { card: ChatFolderCard; onOpen(path: string, newTab: boolean): void }) {
  const [all, setAll] = useState(false);
  // Drilled into a folder, or the top (9.2 uplift F31): a folder row shows that folder's entries, with a way back.
  const [at, setAt] = useState<string | null>(null);
  const scoped = at === null ? card.entries : card.entries.filter((e) => e.path.startsWith(`${at}/`));
  const rows = all ? scoped : scoped.slice(0, SHOWN);
  const hidden = scoped.length - rows.length;
  const files = scoped.filter((e) => e.kind === 'file');
  const base = at ?? card.path;
  const inside = (p: string) => (base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p);
  const drill = (path: string) => {
    setAt(path);
    setAll(false);
  };
  const back = () => {
    setAt(null);
    setAll(false);
  };
  const open = (e: ChatFolderCard['entries'][number]) =>
    showFileHit(
      { project: card.project, projectName: card.projectName, folder: card.folder, ...(card.computerName ? { remoteName: card.computerName } : {}), rel: e.path, name: e.name, ext: e.ext ?? '', size: e.size ?? 0, modified: e.modified ?? 0, created: e.modified ?? 0, state: 'text', score: 0, matches: 0, snippets: [], byName: false },
      files.map((f) => ({ project: card.project, projectName: card.projectName, folder: card.folder, ...(card.computerName ? { remoteName: card.computerName } : {}), rel: f.path, name: f.name, ext: f.ext ?? '', size: f.size ?? 0, modified: f.modified ?? 0, created: f.modified ?? 0, state: 'text' as const, score: 0, matches: 0, snippets: [], byName: false })),
    );
  const total = card.entries.length + card.more;
  return (
    <section className={`cf-card is-${card.kind}`} aria-label={card.title}>
      <header className="cf-head">
        <span className="cf-icon" aria-hidden="true">
          <Icon name={card.kind === 'made' ? 'filePlus' : card.kind === 'changed' ? 'history' : card.remote ? 'computer' : 'folder'} size={14} />
        </span>
        <span className="cf-titles">
          <span className="cf-title">
            {card.title}
            {card.kind === 'changed' && total > 0 && <span className="cf-count">{total}</span>}
          </span>
          <button className="cf-place" title={`Open ${card.projectName}`} onClick={(e) => onOpen(card.project, e.ctrlKey || e.metaKey)}>
            {card.remote && <Icon name="computer" size={11} />}
            <bdi dir="ltr">{card.place}</bdi>
          </button>
        </span>
      </header>
      {at !== null && (
        <button className="cf-row is-folder" title="Back to the top of the card" onClick={back}>
          <span className="cf-tile" aria-hidden="true">
            <Icon name="back" size={14} />
          </span>
          <span className="cf-name">Back</span>
          <span className="cf-meta">{inside(at)}</span>
        </button>
      )}
      {scoped.length === 0 ? (
        <p className="cf-empty">{at !== null ? 'Nothing listed under this folder.' : card.kind === 'changed' ? 'Nothing in the folder changed since then.' : 'The folder is empty.'}</p>
      ) : (
        <div className="cf-rows" role="list">
          {rows.map((e) =>
            e.kind === 'folder' ? (
              <button key={e.path} role="listitem" className="cf-row is-folder" title={`Open ${inside(e.path)}`} onClick={() => drill(e.path)}>
                <span className="cf-tile" aria-hidden="true">
                  <Icon name="folder" size={14} />
                </span>
                <span className="cf-name">{inside(e.path)}</span>
                <span className="cf-meta">Folder</span>
                <span className="cf-when">{e.modified ? whenAgo(e.modified) : ''}</span>
              </button>
            ) : (
              <button key={e.path} role="listitem" className="cf-row" title={`Show ${e.name}`} onClick={() => open(e)}>
                <KindTile ext={e.ext ?? ''} />
                <span className="cf-name">
                  {e.name}
                  {inside(e.path).includes('/') && <span className="cf-sub">{inside(e.path).slice(0, inside(e.path).lastIndexOf('/'))}</span>}
                </span>
                <span className="cf-meta">
                  {kindWords(e.ext ?? '')} · {sizeWords(e.size ?? 0)}
                </span>
                <span className="cf-when">{e.modified ? whenAgo(e.modified) : ''}</span>
              </button>
            ),
          )}
        </div>
      )}
      {(hidden > 0 || (at === null && card.more > 0)) && (
        <footer className="cf-foot">
          {hidden > 0 && (
            <button className="text-button" onClick={() => setAll(true)}>
              Show all {scoped.length}
            </button>
          )}
          {at === null && card.more > 0 && <span>and {card.more} more in the folder</span>}
        </footer>
      )}
    </section>
  );
}

export function FolderCards({ cards, onOpen }: { cards?: ChatFolderCard[]; onOpen(path: string, newTab: boolean): void }) {
  if (!cards?.length) return null;
  return (
    <div className="cf-cards">
      {cards.map((c) => (
        <FolderCard key={`${c.project}|${c.kind}|${c.path}`} card={c} onOpen={onOpen} />
      ))}
    </div>
  );
}
