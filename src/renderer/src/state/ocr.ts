// Words in pictures and scans, as the window uses them (src/main/ocr.ts): the reading progress, hits for words typed,
// and a picture or scan opened from a hit with the found words marked.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ocrProgressWords, type OcrHit, type OcrStatus } from '../../../shared/ocr';
import { openPath } from './actions';

// ── The reading progress ──────────────────────────────────────────────────────────────────────────────────────────

let status: OcrStatus | null = null;
let asked = false;
const statusListeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;
const setStatus = (s: OcrStatus) => {
  status = s;
  statusListeners.forEach((fn) => fn());
};

function watchStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  if (!unsubscribe) unsubscribe = window.nv.on.ocrStatus(setStatus);
  if (!asked) {
    asked = true;
    void window.nv.ocr.status().then(setStatus, () => (asked = false));
  }
  return () => statusListeners.delete(fn);
}

/** Reading words in pictures now: on or off, reading or not, how much is read. */
export function useOcrStatus(): OcrStatus | null {
  return useSyncExternalStore(watchStatus, () => status);
}

/** 'Reading words in pictures… 34 of 79' while it reads; '' when it doesn't. */
export function ocrProgressLine(s: OcrStatus | null): string {
  if (!s?.on || !s.busy || !s.todo) return '';
  return `Reading words in pictures… ${ocrProgressWords(Math.min(s.done, s.todo), s.todo)}${s.current ? ` · ${s.current}` : ''}`;
}

// ── Hits for words typed ──────────────────────────────────────────────────────────────────────────────────────────

export function useOcrHits(query: string, { enabled = true, min = 2, limit = 12 }: { enabled?: boolean; min?: number; limit?: number } = {}): { hits: OcrHit[]; busy: boolean } {
  const s = useOcrStatus();
  const [hits, setHits] = useState<OcrHit[]>([]);
  const [busy, setBusy] = useState(false);
  const q = query.trim();
  const ready = enabled && q.length >= min && s?.on !== false && s?.available !== false;
  // Asked again when reading finishes, and every so often while it reads (pictures keep coming in).
  const round = s ? `${s.busy}:${s.busy ? Math.floor(s.done / 10) : s.files}:${s.withWords}` : '';
  useEffect(() => {
    if (!ready) {
      setHits([]);
      setBusy(false);
      return;
    }
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      window.nv.ocr
        .search(q, { limit })
        .then((r) => live && setHits(r), () => live && setHits([]))
        .finally(() => live && setBusy(false));
    }, 170);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, ready, limit, round]);
  return { hits: ready ? hits : [], busy: ready && busy };
}

/** A picture or scan opened from a hit: the picture with the found words marked, the scan on its page with them found. */
export function openOcrHit(hit: OcrHit, query: string): void {
  const find = `find=${encodeURIComponent(query.trim().slice(0, 200))}`;
  if (hit.kind === 'pdf' && hit.page) openPath(hit.path, { heading: `page=${hit.page}&${find}` });
  else openPath(hit.path, { heading: find });
}
