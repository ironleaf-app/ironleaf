// The Assets page (17 Oct 2026): every logo, picture, icon, document and recording the business keeps, in the library's
// Assets folder (and the pictures pasted into notes, marked as such), with the brand kit above them. Search, kinds,
// collections and tags on the left; a grid or a list; the details of the one chosen on the right. Files dragged in from
// File Explorer (or Add files) are copied in, and ones already there are found by their content.

import { useRoomy } from '../components/ListDetail';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ASSET_KINDS, filterAssets, kindInfo, sizeWords, type AssetEntry, type AssetFilter, type AssetKind, type AssetListing, type AssetSort } from '../../../shared/assets';
import { showCount } from '../../../shared/words';
import { choose, prompt } from '../components/Dialogs';
import { FilterMenu } from '../components/FilterMenu';
import { Icon, type IconName } from '../components/Icon';
import { openMenu, type MenuItem } from '../components/Menu';
import { PageHead } from '../components/PageHead';
import { PageEmpty, PageError, PageLoading, CardsSkeleton, TableSkeleton } from '../components/PageStates';
import { showError, toast, useApp } from '../state/store';
import { assetMenu, deleteAsset, openAsset } from './assets/actions';
import { AssetDetails } from './assets/AssetDetails';
import { AssetGrid } from './assets/AssetGrid';
import { BrandKitView, BrandStrip } from './assets/BrandKit';
import { Thumb } from './assets/AssetTile';
import { insertIntoNote } from './assets/insert';
import { reloadAssets, setAssets, useAssets, type Section } from './assets/store';
import { useAreas } from '../state/areas';


const SORTS: { id: AssetSort; label: string }[] = [
  { id: 'recent', label: 'Newest first' },
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Largest first' },
  { id: 'kind', label: 'Kind' },
];

const KIND_ICONS: Record<AssetKind, IconName> = { logo: 'spark', image: 'image', icon: 'grid', document: 'file', media: 'video', other: 'files' };

const sameSection = (a: Section, b: Section) => JSON.stringify(a) === JSON.stringify(b);

function sectionFilter(s: Section): AssetFilter {
  if (s.kind === 'type') return { kind: s.type };
  if (s.kind === 'collection') return { collection: s.name };
  if (s.kind === 'tag') return { tag: s.tag };
  if (s.kind === 'attachments') return { where: 'attachments' };
  if (s.kind === 'area') return { area: s.id };
  return {};
}

function sectionTitle(s: Section): string {
  if (s.kind === 'type') return kindInfo(s.type).label;
  if (s.kind === 'collection') return s.name;
  if (s.kind === 'tag') return `#${s.tag}`;
  if (s.kind === 'attachments') return 'Pasted into notes';
  if (s.kind === 'brand') return 'Brand kit';
  if (s.kind === 'area') return `${s.name} assets`;
  return 'All assets';
}

/** One part of the store in the filter strip above the table (8.7 wave 2 round 2: the rail's filters as chips; 4 Nov 2026 polish: the kit chips, as Notes and People). */
function FilterChip({ s, icon, label, count, current, onMenu }: { s: Section; icon: IconName; label: string; count?: number; current: Section; onMenu?(e: MouseEvent): void }) {
  const on = sameSection(s, current);
  return (
    <button className={`chip${on ? ' on' : ''}`} aria-pressed={on} title={count !== undefined ? `${label} (${count.toLocaleString('en-AU')})` : label} onClick={() => setAssets({ section: s, selected: null })} onContextMenu={onMenu}>
      <Icon name={icon} size={13} />
      <span>{label}</span>
      {showCount(count) && <span className="n">{(count as number).toLocaleString('en-AU')}</span>}
    </button>
  );
}

/** Files dropped from File Explorer or chosen with Add files: copied in, duplicates offered as "use the one there". */
async function addFiles(paths: string[], section: Section): Promise<void> {
  if (!paths.length) return;
  try {
    const checked = await window.nv.assets.check(paths);
    if (!checked.length) {
      toast('Those can’t be added: only files (not folders), up to 500 MB each.');
      return;
    }
    const dupes = checked.filter((c) => c.duplicateOf);
    let duplicates: 'keep' | 'existing' = 'existing';
    if (dupes.length) {
      const names = dupes.slice(0, 4).map((d) => `“${d.name}”`).join(', ');
      const answer = await choose(
        dupes.length === 1 ? 'This one is already in your assets' : `${dupes.length} of these are already in your assets`,
        [
          { id: 'keep', label: 'Keep both' },
          { id: 'existing', label: dupes.length === 1 ? 'Use the one there' : 'Use the ones there', primary: true },
        ],
        `${names}${dupes.length > 4 ? ` and ${dupes.length - 4} more` : ''} ${dupes.length === 1 ? 'has' : 'have'} the same content as ${dupes.length === 1 ? 'a file' : 'files'} already kept. Use the one there, or add another copy.`,
      );
      if (answer === null) return;
      duplicates = answer === 'keep' ? 'keep' : 'existing';
    }
    const result = await window.nv.assets.add(paths, { duplicates, ...(section.kind === 'collection' ? { collection: section.name } : {}), ...(section.kind === 'type' ? { kind: section.type } : {}), ...(section.kind === 'area' ? { area: section.id } : {}) });
    await reloadAssets();
    const first = result.added[0] ?? result.reused[0];
    if (first) setAssets({ selected: first, query: '' });
    const copied = result.added.length === 1 ? 'one file' : `${result.added.length} files`;
    const there = result.reused.length === 1 ? 'one was' : `${result.reused.length} were`;
    if (!result.added.length) toast(result.reused.length === 1 ? 'That one is already in your assets: it’s selected.' : 'Those are already in your assets: the first is selected.');
    else toast(`Copied ${copied} into your assets${result.reused.length ? `; ${there} already there` : ''}. The originals stay where they were.`);
  } catch (err) {
    showError(err);
  }
}

const TILE_TINT: Record<AssetKind, string> = { logo: 'slate', image: 'blue', icon: 'slate', document: 'green', media: 'amber', other: 'slate' };

/** The mock-up's tiles and brand kit below the files (8.7 wave 2, design C; round 2: the table leads, these follow):
 *  one tile per kind kept (logo, picture, document first), a drop tile, and the brand kit's logos, colours and fonts.
 *  Tiles select the asset; the brand block opens the brand kit. */
function AllHighlights({ all, listing, canEdit, onPick, onSelect }: { all: AssetEntry[]; listing: AssetListing; canEdit: boolean; onPick(): void; onSelect(a: AssetEntry): void }) {
  const brand = listing.brand;
  const byKind = new Map<AssetKind, AssetEntry>();
  for (const a of all) if (!byKind.has(a.kind)) byKind.set(a.kind, a);
  const order: AssetKind[] = ['logo', 'image', 'document', 'icon', 'media', 'other'];
  const tiles = order.map((k) => byKind.get(k)).filter((a): a is AssetEntry => !!a).slice(0, 3);
  const byPath = new Map(all.map((a) => [a.path, a]));
  const primary = brand.logos.primary ? byPath.get(brand.logos.primary) : undefined;
  const onDark = brand.logos.onDark ? byPath.get(brand.logos.onDark) : undefined;
  const extOf = (name: string) => (/\.([a-z0-9]{1,4})$/i.exec(name)?.[1] ?? '').toUpperCase();
  return (
    <>
      <div className="glabel" style={{ margin: '18px 0 2px' }}>Assets · Logos, pictures, documents</div>
      <div className="w4b-tiles">
        {tiles.map((a) => (
          <button key={a.path} className="w4b-tile" onClick={() => onSelect(a)} title={`${a.name}: show its details`}>
            <span className={`art ${TILE_TINT[a.kind]}`} style={{ overflow: 'hidden' }}>
              {(a.kind === 'image' || a.kind === 'logo') && !a.noThumb ? <Thumb a={a} /> : kindInfo(a.kind).label}
            </span>
            <span className="cap" style={{ display: 'block' }}>
              <span className="w4b-file-name"><span className="w">{a.name}</span></span>
              <small>{extOf(a.name) || kindInfo(a.kind).one}{a.uses ? ` · in ${a.uses} ${a.uses === 1 ? 'note' : 'notes'}` : ` · ${sizeWords(a.size)}`}</small>
            </span>
          </button>
        ))}
        {canEdit && (
          <button className="w4b-tile" onClick={onPick} title="Copy files from this PC into your assets (or drag them here)">
            <span className="art slate">+ Add</span>
            <span className="cap" style={{ display: 'block' }}>Drop files here<small>Logos, pictures, icons</small></span>
          </button>
        )}
      </div>
      <div className="glabel" style={{ margin: '18px 0 2px' }}>{(listing.kits?.length ?? 0) > 1 ? `Brand kits · ${(listing.kits?.length ?? 0)}` : `Brand kit · ${brand.name ?? 'Your brand'}`}</div>
      {!primary && !onDark && !brand.colours.length && !brand.fonts.length ? (
        <BrandStrip listing={listing} assets={all} />
      ) : (
        <button className="w4b-tile" style={{ width: '100%', padding: '16px 18px', marginTop: 8, textAlign: 'left' }} onClick={() => setAssets({ section: { kind: 'brand' }, selected: null })} title="Open the brand kit">
          <span className="w4b-kit" style={{ marginTop: 0 }}>
            <span className="w4b-kitcol">
              {primary && (
                <span className="w4b-logo" style={{ display: 'flex' }}>
                  <Thumb a={primary} small />
                  <span>Primary<small>{primary.name}</small></span>
                </span>
              )}
              {onDark && (
                <span className="w4b-logo is-dark" style={{ display: 'flex' }}>
                  <Thumb a={onDark} small />
                  <span>On dark<small>{onDark.name}</small></span>
                </span>
              )}
              {!primary && !onDark && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No logos yet. Open the brand kit to add them.</span>}
            </span>
            <span className="w4b-kitcol">
              {brand.colours.slice(0, 4).map((c) => (
                <span key={c.hex + c.name} className="w4b-csw">
                  <i style={{ background: c.hex }} />{c.name}<code>{c.hex.toUpperCase()}</code>
                </span>
              ))}
              {brand.colours.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No colours yet.</span>}
            </span>
            <span className="w4b-kitcol">
              {brand.fonts.slice(0, 3).map((f) => (
                <span key={f.name} className="w4b-csw">
                  <span className="gtile xs slate" aria-hidden="true">Aa</span>
                  <span>
                    {f.name}
                    {f.use && <small style={{ display: 'block', color: 'var(--text-muted)' }}>{f.use}</small>}
                  </span>
                </span>
              ))}
              {brand.fonts.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No fonts yet.</span>}
            </span>
          </span>
        </button>
      )}
    </>
  );
}

export function AssetsPage() {
  const listing = useAssets((s) => s.listing);
  const error = useAssets((s) => s.error);
  const section = useAssets((s) => s.section);
  const selected = useAssets((s) => s.selected);
  const query = useAssets((s) => s.query);
  const sort = useAssets((s) => s.sort);
  const view = useAssets((s) => s.view);
  const canEdit = useApp((s) => s.canEdit);
  const filesRevision = useApp((s) => s.filesRevision);
  const revision = useApp((s) => s.revision);
  const assetsFolder = useApp((s) => s.settings?.prefs.assetsFolder);
  const areas = useAreas();
  const attachmentsFolder = useApp((s) => s.settings?.prefs.attachmentsFolder);
  const [dropping, setDropping] = useState(false);
  const columns = useRef(1);
  const page = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  // Read again when files come or go, notes change (where assets are used), or the folders change in Settings.
  useEffect(() => {
    const t = setTimeout(() => void reloadAssets(), listing ? 400 : 0);
    return () => clearTimeout(t);
  }, [filesRevision, revision, assetsFolder, attachmentsFolder]);

  const all = listing?.assets ?? [];
  const items = useMemo(() => filterAssets(all, { ...sectionFilter(section), query }, sort), [all, section, query, sort]);
  const picked = selected ? all.find((a) => a.path === selected) ?? null : null;
  // A wide window keeps the details pane open on the first file (round 3: list | detail, never a blank half): the
  // table fills the room beside it and the pane reads the file chosen, or the first in the list.
  const widePane = useRoomy('(min-width: 1600px)');
  const chosen = picked ?? (widePane && section.kind !== 'brand' ? items[0] ?? null : null);
  const counts = useMemo(() => {
    const kinds = new Map<AssetKind, number>();
    const collections = new Map<string, number>();
    let attachments = 0;
    let bytes = 0;
    const areaCounts = new Map<string, number>();
    for (const a of all) {
      if (a.area) areaCounts.set(a.area, (areaCounts.get(a.area) ?? 0) + 1);
      kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
      for (const c of a.collections) collections.set(c.toLowerCase(), (collections.get(c.toLowerCase()) ?? 0) + 1);
      if (a.attachment) attachments++;
      bytes += a.size;
    }
    return { kinds, collections, attachments, bytes, areas: areaCounts };
  }, [all]);

  const select = (a: AssetEntry | null) => setAssets({ selected: a?.path ?? null });

  const onKey = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing = target.closest('input, textarea, select, [contenteditable="true"]');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      search.current?.focus();
      return;
    }
    if (typing || section.kind === 'brand' || target.closest('.as-details')) return;
    const i = chosen ? items.findIndex((a) => a.path === chosen.path) : -1;
    const step = (d: number) => {
      e.preventDefault();
      const next = items[Math.max(0, Math.min(items.length - 1, i < 0 ? 0 : i + d))];
      if (next) select(next);
    };
    const cols = view === 'grid' ? columns.current : 1;
    if (e.key === 'ArrowRight' && view === 'grid') step(1);
    else if (e.key === 'ArrowLeft' && view === 'grid') step(-1);
    else if (e.key === 'ArrowDown') step(cols);
    else if (e.key === 'ArrowUp') step(-cols);
    else if (e.key === 'Home') step(-items.length);
    else if (e.key === 'End') step(items.length);
    else if (e.key === 'Enter' && chosen) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) void insertIntoNote(chosen);
      else openAsset(chosen);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && chosen && canEdit) {
      e.preventDefault();
      void deleteAsset(chosen);
    } else if (e.key === 'Escape' && chosen) {
      e.preventDefault();
      select(null);
    }
  };

  const collectionItems = (name: string): MenuItem[] => [
      {
        label: 'Rename…',
        icon: 'edit',
        run: async () => {
          const to = await prompt('Rename the collection', { value: name, ok: 'Rename' });
          if (!to || to === name) return;
          await window.nv.assets.collections({ kind: 'rename', name, to }).catch(showError);
          if (section.kind === 'collection' && section.name === name) setAssets({ section: { kind: 'collection', name: to } });
          await reloadAssets();
        },
      },
      {
        label: 'Remove the collection',
        icon: 'trash',
        danger: true,
        hint: 'The files stay',
        run: async () => {
          await window.nv.assets.collections({ kind: 'remove', name }).catch(showError);
          if (section.kind === 'collection' && section.name === name) setAssets({ section: { kind: 'all' } });
          await reloadAssets();
        },
      },
    ];
  const collectionMenu = (name: string) => (e: MouseEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    openMenu(e, collectionItems(name));
  };

  const newCollection = async () => {
    const name = await prompt('New collection', { ok: 'Make the collection', placeholder: 'Brand, Wexley St photos, Website…', message: 'A collection groups assets without moving them. An asset can be in several.' });
    if (!name) return;
    try {
      await window.nv.assets.collections({ kind: 'add', name });
      await reloadAssets();
      setAssets({ section: { kind: 'collection', name }, selected: null });
    } catch (err) {
      showError(err);
    }
  };

  const pick = async () => {
    // A bridge hiccup must not throw unhandled (reading length of undefined
    // outside the try): no paths is no-op, like cancelling the picker.
    const paths = (await window.nv.assets.pick().catch(() => [] as string[])) ?? [];
    await addFiles(paths, section);
  };

  const dropFiles = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-nv-paths')) return false;
    return true;
  };

  const empty = (
    <div className="as-empty">
      {all.length === 0 ? (
        <div className="card" style={{ marginTop: 14 }}>
          <PageEmpty
            icon="assets"
            title="Everything your business uses, in one place"
            line={`Logos, photos, icons, PDFs, Word and Excel files, videos. Drag them here from File Explorer, or add them: they’re copied into your ${listing?.folder ?? 'Assets'} folder, and the originals stay where they are.`}
            action={canEdit ? { label: 'Add files…', run: () => void pick() } : undefined}
            quiet={{ label: listing?.brand.name || listing?.brand.colours.length ? `Brand kit: ${listing.brand.name || 'your colours'}` : 'Set up the brand kit', run: () => setAssets({ section: { kind: 'brand' } }) }}
          />
        </div>
      ) : query ? (
        <p className="as-d-quiet">Nothing in {sectionTitle(section).toLowerCase() === 'all assets' ? 'your assets' : sectionTitle(section)} matches “{query}”.</p>
      ) : section.kind === 'collection' ? (
        <p className="as-d-quiet">Nothing in {section.name} yet. Drop files here to add them to it, or add a collection to an asset in its details.</p>
      ) : section.kind === 'attachments' ? (
        <p className="as-d-quiet">No pictures or files pasted into notes yet.</p>
      ) : (
        <p className="as-d-quiet">Nothing here yet. Drop files here to add them.</p>
      )}
    </div>
  );

  const kinds = ASSET_KINDS.filter((k) => (counts.kinds.get(k.id) ?? 0) > 0 || k.id !== 'other');
  const tags = listing?.tags ?? [];

  return (
    <div
      className={`as-page${chosen && section.kind !== 'brand' ? ' has-details' : ''}${dropping ? ' is-dropping' : ''}`}
      ref={page}
      tabIndex={-1}
      onKeyDown={onKey}
      onDragOver={(e) => {
        if (!dropFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!page.current?.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        if (!dropFiles(e)) return;
        e.preventDefault();
        if (!canEdit) return;
        const paths = [...e.dataTransfer.files].map((f) => window.nv.files.pathOf(f)).filter(Boolean);
        void addFiles(paths, section);
      }}
    >
      <main className="as-main">
        {/* The one page head (8.7 wave 2 round 3): Files and assets, Add files at right. */}
        <PageHead
          title="Files and assets"
          lead={section.kind === 'brand' ? ((listing?.kits?.length ?? 0) > 1 ? 'Your brand kits: colours, fonts and logos, one per area or project.' : 'Your brand kit: colours, fonts and logos.') : `${sectionTitle(section)} · ${items.length.toLocaleString('en-AU')} ${items.length === 1 ? 'file' : 'files'}`}
          actions={section.kind !== 'brand' ? (
            <button className="btn pri" disabled={!canEdit} onClick={() => void pick()} title="Copy files from this PC into your assets (or drag them here)">
              <Icon name="plus" size={14} /> Add files
            </button>
          ) : undefined}
        />
        {/* The filter strip (8.7 wave 2 round 2): every part of the store the rail held, as chips above the table. */}
        {listing && (
          <div className="w4b-fstrip">
            <div className="w4b-fstrip-chips" role="group" aria-label="Show">
              <FilterChip s={{ kind: 'all' }} icon="assets" label="All assets" count={all.length} current={section} />
              <FilterChip s={{ kind: 'brand' }} icon="palette" label="Brand kit" current={section} />
              {counts.attachments > 0 && <FilterChip s={{ kind: 'attachments' }} icon="notes" label="Kept with notes" count={counts.attachments} current={section} />}
              {kinds.map((k) => (
                <FilterChip key={k.id} s={{ kind: 'type', type: k.id }} icon={KIND_ICONS[k.id]} label={k.label} count={counts.kinds.get(k.id) ?? 0} current={section} />
              ))}
            </div>
            {/* One row of chips at most (layout round 2): the kinds above; areas, collections and tags as one
                dropdown each, showing the one chosen. */}
            <div className="w4b-fstrip-menus" role="group" aria-label="Filter by">
              <FilterMenu
                label="Area"
                icon="folder"
                value={section.kind === 'area' ? section.id : null}
                options={(areas?.areas ?? []).filter((a) => !a.hidden).map((a) => ({ id: a.id, label: a.name, count: counts.areas.get(a.id) ?? 0, run: () => setAssets({ section: { kind: 'area', id: a.id, name: a.name }, selected: null }) }))}
              />
              <FilterMenu
                label="Collection"
                icon="layers"
                value={section.kind === 'collection' ? section.name : null}
                onMenu={section.kind === 'collection' ? collectionMenu(section.name) : undefined}
                options={(listing.collections ?? []).map((c) => ({ id: c, label: c, count: counts.collections.get(c.toLowerCase()) ?? 0, run: () => setAssets({ section: { kind: 'collection', name: c }, selected: null }), manage: canEdit ? collectionItems(c) : undefined }))}
                extra={canEdit ? [{ label: 'New collection…', icon: 'plus', hint: 'Group assets without moving them', run: () => void newCollection() }] : undefined}
              />
              <FilterMenu
                label="Tag"
                icon="tag"
                value={section.kind === 'tag' ? section.tag : null}
                options={tags.map((t) => ({ id: t.tag, label: t.tag, count: t.count, run: () => setAssets({ section: { kind: 'tag', tag: t.tag }, selected: null }) }))}
              />
            </div>
            <span className="w4b-fstrip-sum">
              {all.length.toLocaleString('en-AU')} {all.length === 1 ? 'file' : 'files'} · {sizeWords(counts.bytes)}
            </span>
          </div>
        )}
        {section.kind === 'brand' ? (
          <div className="as-scroll">
            <div className="as-scroll-inner">{listing ? <BrandKitView listing={listing} assets={all} /> : <div className="view-loading" />}</div>
          </div>
        ) : (
          <>
            <div className="as-toolbar">
              <div className="as-toolbar-row">
                <label className="as-search">
                  <Icon name="search" size={14} />
                  <input
                    ref={search}
                    value={query}
                    placeholder="Search names, tags, descriptions"
                    aria-label="Search your assets"
                    onChange={(e) => setAssets({ query: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && query) {
                        e.stopPropagation();
                        setAssets({ query: '' });
                      }
                    }}
                  />
                  {query && (
                    <button className="icon-button small" title="Clear" onClick={() => setAssets({ query: '' })}>
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </label>
                <button className="as-tool" title="Order" onClick={(e) => openMenu(e.currentTarget, SORTS.map((s) => ({ label: s.label, checked: sort === s.id, run: () => setAssets({ sort: s.id }) })))}>
                  <Icon name="sort" size={14} />
                  <span>{SORTS.find((s) => s.id === sort)?.label}</span>
                </button>
                <div className="as-views" role="radiogroup" aria-label="View">
                  <button role="radio" aria-checked={view === 'grid'} className={view === 'grid' ? 'active' : ''} title="Grid" onClick={() => setAssets({ view: 'grid' })}>
                    <Icon name="grid" size={14} />
                  </button>
                  <button role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'active' : ''} title="List" onClick={() => setAssets({ view: 'list' })}>
                    <Icon name="list" size={14} />
                  </button>
                </div>
              </div>
              {section.kind === 'area' && (
                <p className="as-area-note">
                  <Icon name={items.some((a) => a.protected) ? 'lock' : 'folder'} size={13} />
                  {items.some((a) => a.protected)
                    ? `Photos marked Family-private are protected: an agent you allow Family-private asks you each time it uses one (Settings, Privacy and secrets).`
                    : `${section.name}’s own asset library: files you add here are kept in ${section.name}/Assets, and follow ${section.name}’s sensitivity level.`}
                </p>
              )}
            </div>
            {error ? (
              <div className="as-scroll">
                <div className="as-scroll-inner">
                  <PageError title="Your files couldn’t be read" explainer={error} retry={() => void reloadAssets()} />
                </div>
              </div>
            ) : listing === null ? (
              <div className="as-scroll">
                <div className="as-scroll-inner">
                  <PageLoading label="Reading your files…">{view === 'list' ? <TableSkeleton rows={4} /> : <CardsSkeleton cards={4} />}</PageLoading>
                </div>
              </div>
            ) : (
              <AssetGrid
                items={items}
                view={view}
                selected={selected}
                place={(a) => (a.area ? areas?.areas.find((x) => x.id === a.area)?.name ?? '' : '') || a.collections[0] || (a.attachment ? 'Kept with notes' : kindInfo(a.kind).label)}
                label={section.kind === 'all' && !query && all.length > 0 ? <div className="glabel" style={{ margin: '14px 0 2px' }}>Files · {items.length.toLocaleString('en-AU')} shown</div> : undefined}
                bottom={section.kind === 'all' && !query && all.length > 0 ? <AllHighlights all={all} listing={listing} canEdit={canEdit} onPick={() => void pick()} onSelect={(a) => { select(a); page.current?.focus({ preventScroll: true }); }} /> : undefined}
                empty={empty}
                onColumns={(n) => (columns.current = n)}
                onSelect={(a) => {
                  select(a);
                  page.current?.focus({ preventScroll: true });
                }}
                onOpen={(a) => openAsset(a)}
                onMenu={(a, e) => {
                  e.preventDefault();
                  select(a);
                  openMenu(e, assetMenu(a));
                }}
              />
            )}
          </>
        )}
        {dropping && (
          <div className="as-drop" aria-hidden="true">
            <div className="as-drop-card">
              <Icon name="assets" size={26} />
              <strong>Drop to copy into your assets</strong>
              <span>
                {section.kind === 'collection' ? `Added to ${section.name}. ` : section.kind === 'type' ? `Kept as ${kindInfo(section.type).label.toLowerCase()}. ` : ''}
                The files are copied into {listing?.folder ?? 'Assets'}; the originals stay where they are.
              </span>
            </div>
          </div>
        )}
      </main>

      {chosen && section.kind !== 'brand' && <AssetDetails key={chosen.path} a={chosen} onClose={() => select(null)} />}
    </div>
  );
}

