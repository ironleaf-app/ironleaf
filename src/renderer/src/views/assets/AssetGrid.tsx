// The assets as a grid of tiles or a list of rows, drawn only where they are on screen (a store of thousands scrolls as
// lightly as one of ten). The heading above them and whatever sits below them (the mock-up's asset tiles and brand
// kit) scroll with them. The list is the files mock-up's table (8.7 wave 2, design C): NAME with a kind tile, IN (its
// area, collection or kind), SIZE, CHANGED.

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { sizeWords, type AssetEntry } from '../../../../shared/assets';
import { formatDate } from '../../../../shared/dates';
import { AssetTile, dragAsset } from './AssetTile';

const GAP = 14;
const MIN_TILE = 168;
const WORDS = 56;
const ROW = 44;
const OVERSCAN = 3;

export interface GridHandlers {
  onSelect(a: AssetEntry, e: MouseEvent): void;
  onOpen(a: AssetEntry): void;
  onMenu(a: AssetEntry, e: MouseEvent): void;
}

/** The tile's words and tint from the file's kind, as the mock-up draws them (PDF red, pictures blue, sheets green). */
function tileOf(a: AssetEntry): { words: string; tint: string } {
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(a.name)?.[1] ?? '').toUpperCase();
  if (a.kind === 'image' || ['JPG', 'JPEG', 'PNG', 'GIF', 'WEBP', 'SVG', 'BMP', 'AVIF'].includes(ext)) return { words: ext === 'SVG' ? 'SVG' : 'IMG', tint: 'blue' };
  if (ext === 'PDF') return { words: 'PDF', tint: 'red' };
  if (['XLS', 'XLSX', 'CSV', 'ODS'].includes(ext)) return { words: 'XLS', tint: 'green' };
  if (['DOC', 'DOCX', 'ODT', 'RTF', 'TXT', 'MD'].includes(ext)) return { words: ext === 'DOCX' ? 'DOC' : ext, tint: 'slate' };
  if (a.kind === 'media' || ['MP3', 'M4A', 'WAV', 'OGG', 'MP4', 'MOV', 'WEBM'].includes(ext)) return { words: ['MP4', 'MOV', 'WEBM'].includes(ext) ? 'VID' : 'MP3', tint: 'slate' };
  if (a.kind === 'logo' || a.kind === 'icon') return { words: ext || 'IMG', tint: 'amber' };
  return { words: ext || 'FILE', tint: 'slate' };
}

/** When it changed, as the mock-up writes it ("21 Oct", with the year when it wasn't this year). */
export function changedWords(mtime: number): string {
  const d = new Date(mtime);
  return formatDate(d.getFullYear() === new Date().getFullYear() ? 'D MMM' : 'D MMM YYYY', d);
}

export function AssetGrid({ items, view, selected, label, bottom, empty, place, onColumns, ...h }: GridHandlers & { items: AssetEntry[]; view: 'grid' | 'list'; selected: string | null; label?: ReactNode; bottom?: ReactNode; empty?: ReactNode; place?(a: AssetEntry): string; onColumns(n: number): void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0, scroll: 0, offset: 0 });

  useLayoutEffect(() => {
    const s = scroller.current;
    const b = body.current;
    if (!s || !b) return;
    const measure = () => setBox((old) => ({ ...old, width: b.clientWidth, height: s.clientHeight, offset: b.offsetTop }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    ro.observe(b);
    if (b.previousElementSibling) ro.observe(b.previousElementSibling);
    return () => ro.disconnect();
  }, []);

  // Whatever is above the assets (the brand strip, the list's heading) may change height.
  useLayoutEffect(() => {
    const b = body.current;
    if (b && b.offsetTop !== box.offset) setBox((old) => ({ ...old, offset: b.offsetTop }));
  });

  const cols = view === 'grid' ? Math.max(1, Math.floor((box.width + GAP) / (MIN_TILE + GAP))) : 1;
  const tileW = view === 'grid' ? (box.width - GAP * (cols - 1)) / cols : box.width;
  const artH = Math.round(tileW * 0.72);
  const rowH = view === 'grid' ? artH + WORDS + GAP : ROW;
  const rows = Math.ceil(items.length / cols);
  const inBody = box.scroll - box.offset;
  const first = Math.max(0, Math.floor(inBody / rowH) - OVERSCAN);
  const last = Math.min(rows, Math.ceil((inBody + box.height) / rowH) + OVERSCAN);

  useEffect(() => {
    onColumns(cols);
  }, [cols]);

  // The selected asset kept in view when it moves by the keys.
  const selIndex = selected ? items.findIndex((a) => a.path === selected) : -1;
  useEffect(() => {
    const s = scroller.current;
    if (!s || selIndex < 0) return;
    const row = Math.floor(selIndex / cols);
    const y = box.offset + row * rowH;
    if (y < s.scrollTop) s.scrollTo({ top: Math.max(0, y - 8) });
    else if (y + rowH > s.scrollTop + s.clientHeight) s.scrollTo({ top: y + rowH - s.clientHeight + 8 });
  }, [selIndex]);

  const shown: ReactNode[] = [];
  for (let r = first; r < last; r++) {
    for (let c = 0; c < cols; c++) {
      const a = items[r * cols + c];
      if (!a) break;
      if (view === 'grid') {
        shown.push(
          <AssetTile
            key={a.path}
            a={a}
            selected={a.path === selected}
            style={{ transform: `translate(${c * (tileW + GAP)}px, ${r * rowH}px)`, width: tileW, ['--art' as string]: `${artH}px` }}
            onSelect={(e) => h.onSelect(a, e)}
            onOpen={() => h.onOpen(a)}
            onMenu={(e) => h.onMenu(a, e)}
          />,
        );
      } else {
        const tile = tileOf(a);
        shown.push(
          <div
            key={a.path}
            className={`as-row${a.path === selected ? ' is-selected' : ''}`}
            style={{ transform: `translateY(${r * rowH}px)` }}
            role="listitem"
            aria-current={a.path === selected ? true : undefined}
            draggable
            onDragStart={(e) => dragAsset(e, a)}
            onMouseDown={(e) => e.button === 0 && h.onSelect(a, e)}
            onDoubleClick={() => h.onOpen(a)}
            onContextMenu={(e) => h.onMenu(a, e)}
            title={a.description || a.name}
          >
            <span className={`gtile xs ${tile.tint}`} aria-hidden="true" style={{ fontSize: 9, fontWeight: 800 }}>
              {tile.words}
            </span>
            <span className="as-row-name">
              <span className="as-row-title">{a.name}</span>
            </span>
            <span className="as-row-col" title={place?.(a) ?? ''}>{place?.(a) ?? ''}</span>
            <span className="as-row-col num">{sizeWords(a.size)}</span>
            <span className="as-row-col when">{changedWords(a.mtime)}</span>
          </div>,
        );
      }
    }
  }

  return (
    <div className="as-scroll" ref={scroller} onScroll={(e) => {
      const top = e.currentTarget.scrollTop;
      setBox((old) => (Math.abs(old.scroll - top) < 1 ? old : { ...old, scroll: top }));
    }}>
      <div className="as-scroll-inner">
        {label}
        {view === 'list' && items.length > 0 && (
          <div className="as-list-head" aria-hidden="true">
            <span />
            <span>Name</span>
            <span>In</span>
            <span className="num">Size</span>
            <span>Changed</span>
          </div>
        )}
        {/* A page's own list is a list, never a listbox (8.6: as a listbox it read as a menu left open). */}
        <div ref={body} className={`as-body ${view}`} role="list" aria-label="Assets" style={{ height: items.length ? rows * rowH - (view === 'grid' ? GAP : 0) : undefined }}>
          {items.length ? shown : empty}
        </div>
        {bottom}
      </div>
    </div>
  );
}
