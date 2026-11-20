// Bookmarks in the one page shape (8.7 wave 2, design C; the bookmarks mock-up, 30 Oct 2026): kept notes, files,
// folders, headings and searches as rows — a grip to drag them into order, a glyph tile, the name and where it sits,
// its kind tag, a quiet remove — under one "N KEPT" label, with the "Bookmark anything" card below. Groups stay
// (today's collapsible groups, kept), as do rename (the row's menu), dropping notes in from the file list, and
// bookmarking the open note. The mock-up's star in the top bar is not the app's: bookmarking lives in each page's ⋯
// menu, and the card says so.

import { useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { sizeWords } from '../../../shared/assets';
import type { NoteMeta } from '../../../shared/types';
import { prompt } from '../components/Dialogs';
import { Icon, type IconName } from '../components/Icon';
import { hashTint } from '../lib/projectLook';
import { openMenu } from '../components/Menu';
import { PageHead } from '../components/PageHead';
import { ListDetail, RecordDetail, useSettled } from '../components/ListDetail';
import { PageEmpty } from '../components/PageStates';
import * as A from '../state/actions';
import { addBookmark, moveBookmark, removeBookmark, renameBookmark, useBookmarks, type Bookmark } from '../state/bookmarks';
import { requestSearch } from '../state/modals';
import { toast, useApp } from '../state/store';

const MIME = 'application/x-nv-bookmark';

function label(b: Bookmark): string {
  if (b.title) return b.title;
  switch (b.type) {
    case 'file':
      return /\.md$/i.test(b.path) ? A.titleOf(b.path) : A.nameOf(b.path);
    case 'folder':
      return A.nameOf(b.path);
    case 'heading':
      return `${A.titleOf(b.path)}, ${b.heading}`;
    case 'search':
      return `Search: “${b.query}”`;
    default:
      return b.title;
  }
}

/** Where it sits, in plain words: its folders, and what kind of thing it is. */
function place(b: Bookmark, meta?: NoteMeta, size?: number): string {
  if (b.type === 'search') return 'Kept search';
  if (b.type === 'group') return `${b.items.length} ${b.items.length === 1 ? 'kept' : 'kept'}`;
  const folders = b.path.split('/').slice(0, -1).join(' / ');
  const bits = [folders || 'Top of the vault'];
  if (b.type === 'heading') bits.push(`heading “${b.heading}”`);
  else if (b.type === 'folder') bits.push('folder');
  else if (/\.md$/i.test(b.path)) bits.push(String(meta?.props?.type ?? 'note') === 'project' ? 'project' : 'note');
  else bits.push(size === undefined ? 'file' : sizeWords(size));
  return bits.join(' · ');
}

function kindTag(b: Bookmark, meta?: NoteMeta): { words: string; tint: string } {
  if (b.type === 'search') return { words: 'Search', tint: 'tag blue' };
  if (b.type === 'folder') return { words: 'Folder', tint: 'tag slate' };
  if (b.type === 'group') return { words: 'Group', tint: 'tag slate' };
  if (b.type === 'heading') return { words: 'Note', tint: 'tag slate' };
  if (/\.md$/i.test(b.path)) return String(meta?.props?.type ?? '') === 'project' ? { words: 'Project', tint: 'tag slate' } : { words: 'Note', tint: 'tag slate' };
  return { words: 'File', tint: 'tag slate' };
}

const TILE_ICON: Record<Bookmark['type'], IconName> = { file: 'file', folder: 'folder', heading: 'notes', search: 'search', group: 'layers' };

export function BookmarksPage() {
  const items = useBookmarks();
  const files = useApp((s) => s.files);
  const folders = useApp((s) => s.folders);
  const byPath = useApp((s) => s.byPath);
  const canEdit = useApp((s) => s.canEdit);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const exists = (b: Bookmark) => (b.type === 'file' || b.type === 'heading' ? files.some((f) => f.rel === b.path) : b.type === 'folder' ? folders.includes(b.path) : true);

  const activate = (b: Bookmark, newTab: boolean) => {
    switch (b.type) {
      case 'file':
        A.openPath(b.path, { where: newTab ? 'tab' : 'current', reuse: !newTab });
        break;
      case 'heading':
        A.openPath(b.path, { where: newTab ? 'tab' : 'current', heading: b.heading });
        break;
      case 'folder':
        A.revealInExplorer(b.path);
        break;
      case 'search':
        requestSearch(b.query);
        break;
      case 'group':
        setOpenGroups((prev) => {
          const next = new Set(prev);
          if (next.has(b.id)) next.delete(b.id);
          else next.add(b.id);
          return next;
        });
        break;
    }
  };

  const menu = (b: Bookmark, e: DragEvent | ReactMouseEvent) => {
    e.preventDefault();
    openMenu(e, [
      ...(b.type === 'file' ? [{ label: 'Open in a new tab', icon: 'newTab', run: () => activate(b, true) } as const] : []),
      { label: 'Rename', icon: 'edit', run: async () => { const t = await prompt('Bookmark name', { value: label(b), ok: 'Rename' }); if (t) renameBookmark(b.id, t); } },
      { label: 'Remove the bookmark', icon: 'trash', danger: true, run: () => removeBookmark(b.id) },
    ]);
  };

  const onDropOn = (b: Bookmark, e: DragEvent) => {
    const id = e.dataTransfer.getData(MIME);
    setOver(null);
    if (!id || id === b.id) return;
    e.preventDefault();
    if (b.type === 'group') moveBookmark(id, null, b.id);
    else moveBookmark(id, b.id);
  };

  const row = (b: Bookmark, depth: number) => {
    const missing = !exists(b);
    const meta = b.type === 'file' || b.type === 'heading' ? byPath.get(b.path) : undefined;
    const size = b.type === 'file' ? files.find((f) => f.rel === b.path)?.size : undefined;
    const tag = kindTag(b, meta);
    const open = b.type === 'group' && openGroups.has(b.id);
    return (
      <div key={b.id}>
        <div
          className={`w4b-bm-row${missing ? ' is-missing' : ''}${over === b.id ? ' is-drop' : ''}`}
          data-pick={'path' in b ? b.path : undefined}
          style={depth ? { paddingLeft: 10 + depth * 16 } : undefined}
          draggable={canEdit}
          onDragStart={(e) => {
            e.dataTransfer.setData(MIME, b.id);
            if (b.type === 'file') e.dataTransfer.setData('application/x-nv-paths', b.path);
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(MIME)) return;
            e.preventDefault();
            setOver(b.id);
          }}
          onDragLeave={() => setOver((o) => (o === b.id ? null : o))}
          onDrop={(e) => onDropOn(b, e)}
          title={missing ? 'This is no longer there.' : undefined}
        >
          <span className="w4b-bm-grip" aria-hidden="true"><Icon name="grip" size={14} /></span>
          <button
            className="w4b-bm-main"
            onClick={(e) => activate(b, e.ctrlKey || e.metaKey)}
            onContextMenu={(e) => menu(b, e)}
            title={b.type === 'file' ? `Open ${label(b)} (Ctrl+click for a new tab)` : label(b)}
          >
            <span className={`gtile xs ${hashTint(b.id)}`} aria-hidden="true"><Icon name={TILE_ICON[b.type]} size={14} /></span>
            <span style={{ display: 'block', flex: 1, minWidth: 0 }}>
              <span className="w4b-bm-t" style={{ display: 'block' }}>
                {b.type === 'group' && <span aria-hidden="true"><Icon name={open ? 'chevronDown' : 'chevron'} size={12} /> </span>}
                {label(b)}
              </span>
              <span className="w4b-bm-p" style={{ display: 'block' }}>{place(b, meta, size)}</span>
            </span>
          </button>
          <span className={tag.tint} style={{ marginLeft: 'auto', flex: 'none' }}>{tag.words}</span>
          <button className="w4b-bm-x" title="Remove the bookmark" aria-label={`Remove ${label(b)}`} onClick={() => removeBookmark(b.id)}><Icon name="close" size={12} /></button>
        </div>
        {b.type === 'group' && open && b.items.map((child) => row(child, depth + 1))}
      </div>
    );
  };

  const kept = items.flatMap((b) => (b.type === 'group' ? [b, ...b.items] : [b]));
  const settledPick = useSettled(picked);
  return (
    <div className="nv-page-scroll">
      <div className="w4b-bm-page has-split">
        {/* The one page head (8.7 wave 2 round 3). */}
        <PageHead title="Bookmarks" lead={items.length ? 'Notes, files and searches kept to hand. Drag to put them in order.' : 'Notes, files and searches kept to hand.'} />
        {items.length === 0 ? (
          <div className="card" style={{ marginTop: 14 }}>
            <PageEmpty icon="bookmark" title="No bookmarks yet" line="Bookmark a page from its ⋯ menu, or drag notes here." action={canEdit ? { label: 'Bookmark the open note', run: () => { const p = A.activePath(); if (p) addBookmark({ type: 'file', path: p }); else toast('Open a note first, then bookmark it.'); } } : undefined} />
          </div>
        ) : (
          // The kept list beside the one the pointer is on, read whole (round 3: list and detail, filling the window).
          <ListDetail
            label="The bookmark chosen"
            list={
              <div
                onMouseOver={(e) => {
                  const at = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick;
                  if (at) setPicked(at);
                }}
              >
                <>
            <div className="glabel" style={{ margin: '14px 0 2px' }}>{kept.length} kept</div>
            <div
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-nv-paths') || e.dataTransfer.types.includes(MIME)) e.preventDefault();
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(MIME);
                if (id) {
                  moveBookmark(id, null);
                  return;
                }
                for (const p of e.dataTransfer.getData('application/x-nv-paths').split('\n').filter(Boolean)) addBookmark(folders.includes(p) ? { type: 'folder', path: p } : { type: 'file', path: p });
              }}
            >
              {items.map((b) => row(b, 0))}
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn quiet" onClick={() => { const p = A.activePath(); if (p) addBookmark({ type: 'file', path: p }); else toast('Open a note first, then bookmark it.'); }}>
                  <Icon name="bookmark" size={13} /> Bookmark the open note
                </button>
                <button className="btn quiet" onClick={async () => { const t = await prompt('Group name', { value: 'Group', ok: 'Make the group' }); if (t) addBookmark({ type: 'group', title: t, items: [] }); }}>
                  <Icon name="folderPlus" size={13} /> New group
                </button>
              </div>
            )}
          </>
                <div className="card w4b-bm-foot">
                  <span className="gtile sm slate" aria-hidden="true"><Icon name="star" size={15} /></span>
                  <div>
                    <div className="t">Bookmark anything</div>
                    <div className="s">Bookmark a page from its ⋯ menu and it waits for you here.</div>
                  </div>
                </div>
              </div>
            }
            detail={(() => {
              const notes = kept.flatMap((b) => ('path' in b && /\.md$/i.test(b.path) ? [b.path] : []));
              const path = notes.find((x) => x === settledPick) ?? notes[0];
              return path ? <RecordDetail refTo={{ path }} /> : null;
            })()}
          />
        )}
        {items.length === 0 && (
          <div className="card w4b-bm-foot">
            <span className="gtile sm slate" aria-hidden="true"><Icon name="star" size={15} /></span>
            <div>
              <div className="t">Bookmark anything</div>
              <div className="s">Bookmark a page from its ⋯ menu and it waits for you here.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
