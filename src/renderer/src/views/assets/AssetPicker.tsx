// Choosing an asset from anywhere (a note's "Picture from assets", a brand kit logo slot): the store as small tiles,
// searchable, with the kinds to narrow it; the keys move and Enter chooses.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ASSET_KINDS, filterAssets, isPicture, type AssetEntry, type AssetKind } from '../../../../shared/assets';
import { Icon } from '../../components/Icon';
import { EmptyState, LoadingRows } from '../../components/EmptyState';
import { useEscape } from '../../lib/useEscape';
import { backdropClass, metaWords, Thumb } from './AssetTile';
import { reloadAssets, useAssets } from './store';

interface Ask {
  title: string;
  pictures: boolean;
  resolve(a: AssetEntry | null): void;
}

let current: Ask | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** Opens the picker; the asset chosen, or null. */
export function pickAsset(options: { title?: string; pictures?: boolean } = {}): Promise<AssetEntry | null> {
  current?.resolve(null);
  void reloadAssets();
  return new Promise((resolve) => {
    current = { title: options.title ?? 'Insert from your assets', pictures: options.pictures ?? false, resolve };
    emit();
  });
}

function close(a: AssetEntry | null): void {
  const ask = current;
  current = null;
  emit();
  ask?.resolve(a);
}

const SHOWN = 240;

function PickerBody({ ask }: { ask: Ask }) {
  const listing = useAssets((s) => s.listing);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AssetKind | 'all'>('all');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEscape(() => close(null));
  useEffect(() => input.current?.focus(), []);
  const pool = useMemo(() => (listing?.assets ?? []).filter((a) => !ask.pictures || isPicture(a.name)), [listing, ask.pictures]);
  const items = useMemo(() => filterAssets(pool, { query, kind }, 'recent'), [pool, query, kind]);
  const kinds = ASSET_KINDS.filter((k) => pool.some((a) => a.kind === k.id));
  useEffect(() => setAt(0), [query, kind]);
  useEffect(() => {
    grid.current?.querySelector('.as-pick-tile.is-at')?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  const columns = () => {
    const el = grid.current;
    if (!el) return 1;
    return Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').length);
  };
  return (
    <div className="overlay" onMouseDown={() => close(null)}>
      <div className="dialog as-picker" role="dialog" aria-label={ask.title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="as-picker-head">
          <h2>{ask.title}</h2>
          <button className="icon-button" title="Close (Esc)" onClick={() => close(null)}>
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="as-search">
          <Icon name="search" size={15} />
          <input
            ref={input}
            value={query}
            placeholder="Search by name, tag or description"
            aria-label="Search your assets"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const cols = columns();
              const move = (d: number) => {
                e.preventDefault();
                setAt((i) => Math.max(0, Math.min(Math.min(items.length, SHOWN) - 1, i + d)));
              };
              if (e.key === 'ArrowRight') move(1);
              else if (e.key === 'ArrowLeft') move(-1);
              else if (e.key === 'ArrowDown') move(cols);
              else if (e.key === 'ArrowUp') move(-cols);
              else if (e.key === 'Enter' && items[at]) {
                e.preventDefault();
                close(items[at]);
              }
            }}
          />
        </div>
        {kinds.length > 1 && (
          <div className="as-chipbar">
            <button className={`as-filter${kind === 'all' ? ' active' : ''}`} onClick={() => setKind('all')}>
              All
            </button>
            {kinds.map((k) => (
              <button key={k.id} className={`as-filter${kind === k.id ? ' active' : ''}`} onClick={() => setKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        )}
        {listing === null ? (
          <LoadingRows rows={4} label="Reading your assets" />
        ) : !pool.length ? (
          <EmptyState size="panel" icon="assets" title={`No ${ask.pictures ? 'pictures' : 'assets'} yet`} line="Add logos, photos and files on the Assets page, and they’re here to use." />
        ) : !items.length ? (
          <EmptyState size="panel" icon="search" title="Nothing matches" line={`No asset is called “${query}”.`} />
        ) : (
          <div className="as-pick-grid" ref={grid} role="listbox" aria-label="Assets">
            {items.slice(0, SHOWN).map((a, i) => (
              <button key={a.path} role="option" aria-selected={i === at} className={`as-pick-tile${i === at ? ' is-at' : ''}`} onMouseEnter={() => setAt(i)} onClick={() => close(a)} title={a.path}>
                <span className={`as-tile-art kind-${a.kind}${backdropClass(a)}`}>
                  <Thumb a={a} />
                </span>
                <span className="as-pick-name">{a.name}</span>
                <span className="as-pick-meta">{metaWords(a)}</span>
              </button>
            ))}
          </div>
        )}
        {items.length > SHOWN && <div className="as-picker-foot">Showing {SHOWN} of {items.length}: search to find the one you want.</div>}
      </div>
    </div>
  );
}

/** Mounted once in the window: shows the picker when something asks for it. */
export function AssetPickerHost() {
  const ask = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
  return ask ? <PickerBody ask={ask} /> : null;
}
