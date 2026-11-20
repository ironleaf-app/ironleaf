// Thumbnails for the asset store, made in the window (it reads every picture kind Chromium does, SVGs included) from the
// file's bytes the main side sends (an SVG made safe first, and drawn only as a picture, where scripts never run). Each
// is kept in Ironleaf's own data with the picture's size and colours, so a store of thousands is drawn once. Only
// the tiles on screen ask; two are made at a time.

import { useEffect, useSyncExternalStore } from 'react';
import { isPicture, palette, svgSize, type AssetEntry } from '../../../../shared/assets';
import { patchAsset } from './store';

export interface ThumbState {
  url?: string;
  failed?: boolean;
}

const LONGEST = 520;
const made = new Map<string, ThumbState>();
const queue: AssetEntry[] = [];
const queued = new Set<string>();
let running = 0;
const listeners = new Set<() => void>();
let version = 0;

const keyOf = (a: Pick<AssetEntry, 'path' | 'mtime' | 'size'>) => `${a.path}\u0000${a.mtime}\u0000${a.size}`;

/** A full path on this PC as a URL the window can show. */
export function absUrl(abs: string, v?: number): string {
  const encoded = abs
    .replace(/\\/g, '/')
    .split('/')
    .map((part, i) => (i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)))
    .join('/');
  return `${encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`}${v ? `?v=${Math.round(v)}` : ''}`;
}

/** What a tile can show now: a thumbnail, its type (no thumbnail can be made), or nothing yet. */
export function thumbOf(a: AssetEntry): ThumbState | undefined {
  const known = made.get(keyOf(a));
  if (known) return known;
  if (a.thumb) return { url: absUrl(a.thumb, a.mtime) };
  if (a.noThumb || !isPicture(a.name)) return { failed: true };
  return undefined;
}

function emit(): void {
  version++;
  for (const fn of listeners) fn();
}

async function make(a: AssetEntry): Promise<ThumbState> {
  const src = await window.nv.assets.source(a.path).catch(() => null);
  const fail = async (): Promise<ThumbState> => {
    await window.nv.assets.saveThumb(a.path, null, {}).catch(() => null);
    return { failed: true };
  };
  if (!src) return fail();
  const svg = 'svg' in src ? src.svg : null;
  const blob = svg !== null ? new Blob([svg], { type: 'image/svg+xml' }) : new Blob([(src as { bytes: Uint8Array }).bytes as BlobPart], { type: (src as { type: string }).type });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (svg !== null) {
      const own = svgSize(svg);
      if (own && own.width > 0 && own.height > 0) [w, h] = [own.width, own.height];
      else if (!w || !h) [w, h] = [300, 150];
    }
    if (!w || !h) return fail();
    // A drawing scales to any size; a photo is never made bigger than it is.
    const scale = svg !== null ? LONGEST / Math.max(w, h) : Math.min(1, LONGEST / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fail();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, tw, th);
    // Its colours from a small copy (quick, and enough to tell them).
    const small = document.createElement('canvas');
    const ss = Math.min(1, 72 / Math.max(tw, th));
    small.width = Math.max(1, Math.round(tw * ss));
    small.height = Math.max(1, Math.round(th * ss));
    const sctx = small.getContext('2d', { willReadFrequently: true });
    let colours: string[] = [];
    if (sctx) {
      sctx.drawImage(canvas, 0, 0, small.width, small.height);
      colours = palette(sctx.getImageData(0, 0, small.width, small.height).data);
    }
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
    if (!out) return fail();
    const bytes = new Uint8Array(await out.arrayBuffer());
    const saved = await window.nv.assets.saveThumb(a.path, bytes, { width: w, height: h, palette: colours });
    patchAsset(a.path, { width: w, height: h, palette: colours, ...(saved ? { thumb: saved } : {}) });
    return saved ? { url: absUrl(saved, a.mtime) } : { failed: true };
  } catch {
    return fail();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pump(): void {
  while (running < 2 && queue.length) {
    const a = queue.shift()!;
    const key = keyOf(a);
    running++;
    void make(a)
      .then((r) => made.set(key, r))
      .catch(() => made.set(key, { failed: true }))
      .finally(() => {
        running--;
        queued.delete(key);
        emit();
        pump();
      });
  }
}

/** Asks for a tile's thumbnail (newest asks first: the tiles just scrolled to). */
export function requestThumb(a: AssetEntry): void {
  const key = keyOf(a);
  if (made.has(key) || queued.has(key) || thumbOf(a)) return;
  queued.add(key);
  queue.unshift(a);
  // Tiles scrolled past long ago aren't waited on.
  while (queue.length > 120) queued.delete(keyOf(queue.pop()!));
  pump();
}

/** A tile's thumbnail, asked for when the tile is drawn. */
export function useThumb(a: AssetEntry): ThumbState | undefined {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  const now = thumbOf(a);
  useEffect(() => {
    if (!thumbOf(a)) requestThumb(a);
  }, [a.path, a.mtime, a.size, a.thumb]);
  return now;
}
