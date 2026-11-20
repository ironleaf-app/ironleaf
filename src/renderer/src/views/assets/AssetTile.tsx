// One asset drawn: its picture (a cached thumbnail) or, for documents, video and audio, a designed tile of its type.

import type { DragEvent, MouseEvent } from 'react';
import { BRAND_ROLES, docType, isPicture, kindInfo, sizeWords, type AssetEntry } from '../../../../shared/assets';
import { Icon } from '../../components/Icon';
import { embedFor } from './insert';
import { useThumb } from './thumbs';
import { isPdf } from '../../lib/resolve';
import { usePdfFirstPage } from '../../lib/pdfThumb';

/** A logo made for dark backgrounds: its brand role, or a name that says so ("logo white", "logo on dark"). */
export const onDark = (a: AssetEntry) => a.role === 'onDark' || (a.kind === 'logo' && /(^|[^a-z])(dark|white|reversed?|negative|knockout)([^a-z]|$)/i.test(a.name));

/** Photos fill their tile; logos, icons and drawings sit inside it whole. */
const fills = (a: AssetEntry) => a.kind === 'image' && /\.(jpe?g|webp|avif|heic|heif|bmp)$/i.test(a.name);

const luminance = (hex: string): number => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return 0.5;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** What a picture is drawn on so it can always be seen, in the light look and the dark: a logo made for dark (or a
 * drawing in white) on dark; any other logo, icon or drawing on paper; a photo that fills its tile on nothing. */
export function backdropFor(a: AssetEntry): 'dark' | 'light' | 'none' {
  if (onDark(a)) return 'dark';
  if (fills(a) || !['logo', 'icon', 'image'].includes(a.kind)) return 'none';
  const ink = a.palette?.[0];
  if (ink && luminance(ink) > 0.86) return 'dark';
  if (a.kind === 'image' && !ink) return 'none';
  return 'light';
}
const backdropClass = (a: AssetEntry) => ({ dark: ' on-dark', light: ' on-light', none: '' })[backdropFor(a)];

export { backdropClass };

export function TypeTile({ a, small }: { a: Pick<AssetEntry, 'name'>; small?: boolean }) {
  const t = docType(a.name);
  const base = a.name.replace(/\.[^.]+$/, '');
  return (
    <span className={`as-type fam-${t.family}${small ? ' small' : ''}`} aria-hidden="true">
      <span className="as-type-page">
        <span className="as-type-word">{t.word}</span>
        {!small && (
          <>
            <span className="as-type-lines">
              <i />
              <i />
              <i />
            </span>
            <span className="as-type-name">{base}</span>
          </>
        )}
      </span>
    </span>
  );
}

/** A PDF shows its first page (drawn once, when its tile comes on screen); its designed tile until then, or for good
 * when it can't be drawn. */
export function PdfPage({ a, small, className = 'as-thumb-img as-pdf-img' }: { a: Pick<AssetEntry, 'path' | 'name' | 'mtime' | 'size'>; small?: boolean; className?: string }) {
  const { ref, url } = usePdfFirstPage({ rel: a.path }, `${a.mtime}:${a.size}`);
  return url ? (
    <img className={className} src={url} alt="" draggable={false} decoding="async" />
  ) : (
    <span ref={ref as React.RefObject<HTMLSpanElement>} className="as-pdf-wait">
      <TypeTile a={a} small={small} />
    </span>
  );
}

export function Thumb({ a, small }: { a: AssetEntry; small?: boolean }) {
  const t = useThumb(a);
  if (isPdf(a.name)) return <PdfPage a={a} small={small} />;
  if (!isPicture(a.name) || t?.failed) return <TypeTile a={a} small={small} />;
  if (!t?.url) return <span className="as-thumb-wait" aria-hidden="true" />;
  return <img className={`as-thumb-img${fills(a) ? ' fill' : ''}`} src={t.url} alt={a.alt ?? ''} draggable={false} loading="lazy" decoding="async" />;
}

/** Dragging an asset into a note or onto a canvas embeds it there (its alt text with it). */
export function dragAsset(e: DragEvent, a: AssetEntry): void {
  e.dataTransfer.setData('application/x-nv-paths', a.path);
  if (a.alt) e.dataTransfer.setData('application/x-nv-alt', a.alt);
  e.dataTransfer.setData('text/plain', embedFor(a));
  e.dataTransfer.effectAllowed = 'copyLink';
}

export function metaWords(a: AssetEntry): string {
  const ext = (/\.([^.]+)$/.exec(a.name)?.[1] ?? '').toUpperCase();
  return [ext || kindInfo(a.kind).one, a.width && a.height ? `${a.width} × ${a.height}` : sizeWords(a.size)].join(' · ');
}

export function AssetTile({ a, selected, style, onSelect, onOpen, onMenu }: { a: AssetEntry; selected: boolean; style: React.CSSProperties; onSelect(e: MouseEvent): void; onOpen(): void; onMenu(e: MouseEvent): void }) {
  const role = a.role ? BRAND_ROLES.find((r) => r.id === a.role)?.label : null;
  return (
    <div
      className={`as-tile${selected ? ' is-selected' : ''}`}
      style={style}
      role="listitem"
      aria-current={selected ? true : undefined}
      tabIndex={-1}
      draggable
      data-path={a.path}
      onDragStart={(e) => dragAsset(e, a)}
      onMouseDown={(e) => {
        if (e.button === 0) onSelect(e);
      }}
      onDoubleClick={onOpen}
      onContextMenu={onMenu}
      title={a.description ? `${a.name}\n${a.description}` : a.name}
    >
      <span className={`as-tile-art kind-${a.kind}${backdropClass(a)}`}>
        <Thumb a={a} />
        {(role || a.attachment || a.protected) && (
          <span className="as-tile-badges">
            {a.protected && (
              <span className="as-badge protected" title="A Family-private photo: an agent allowed Family-private asks you each time it uses it">
                <Icon name="lock" size={10} /> Asked each use
              </span>
            )}
            {role && (
              <span className="as-badge brand">
                <Icon name="spark" size={10} /> {role}
              </span>
            )}
            {a.attachment && <span className="as-badge">In a note</span>}
          </span>
        )}
      </span>
      <span className="as-tile-words">
        <span className="as-tile-name">{a.name}</span>
        <span className="as-tile-meta">
          <span>{metaWords(a)}</span>
          {a.uses > 0 && (
            <span className="as-tile-uses" title={`Used in ${a.uses} ${a.uses === 1 ? 'place' : 'places'}`}>
              <Icon name="link" size={11} /> {a.uses}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}
