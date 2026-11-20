// The PDF reader's smaller parts (19 Oct 2026, 5.0.0 PDF reader): page pictures down the left, the highlights list on
// the right, the find bar, the small bar over selected words, and the card for one highlight (its colour, the person's
// note, copy, quote, remove). Clips (31 Oct 2026, 8.9) show their picture in the list and the card; a highlight dragged
// out of the list drops its words (or its picture) with a link back.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clipCaption, PDF_COLOURS, sortHighlights, type PdfColour, type PdfHighlight } from '../../../../shared/pdf-highlights';
import { Icon } from '../../components/Icon';
import { fileUrl } from '../../lib/resolve';
import { minPopupTop } from '../../lib/windowButtons';
import type { PdfDocument } from './pdfDoc';

export const COLOUR_WORDS: Record<PdfColour, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' };

/** Four round swatches; the chosen one ringed. */
export function Swatches({ value, onPick, label = 'Highlight' }: { value?: PdfColour | null; onPick(c: PdfColour): void; label?: string }) {
  return (
    <span className="pdfv-swatches" role="group" aria-label={`${label} colour`}>
      {PDF_COLOURS.map((c) => (
        <button key={c} className={`pdfv-swatch pdfv-hl-${c}${value === c ? ' is-on' : ''}`} title={`${label} in ${COLOUR_WORDS[c].toLowerCase()}`} aria-label={`${label} in ${COLOUR_WORDS[c].toLowerCase()}`} aria-pressed={value === c} onClick={() => onPick(c)} />
      ))}
    </span>
  );
}

/** Keeps a floating box on screen near some words: below them (`y`) or above them (`above`) as preferred, the other
 *  way when there's no room, never over them. */
function useOnScreen(x: number, y: number, above: number, prefer: 'above' | 'below' = 'below'): { left: number; top: number; ref: React.RefObject<HTMLDivElement | null> } {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 280;
    const h = el?.offsetHeight ?? 40;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
    // Never up under the window buttons (8.6.1): above the words only when it clears their band.
    const clear = minPopupTop();
    const fitsBelow = y + h + 8 < window.innerHeight;
    const fitsAbove = above - h - 8 > clear;
    const top = prefer === 'above' ? (fitsAbove || !fitsBelow ? Math.max(clear, above - h - 8) : Math.max(clear, y)) : fitsBelow || !fitsAbove ? Math.max(clear, y) : above - h - 8;
    setPos({ left, top });
  }, [x, y, above, prefer]);
  return { ...pos, ref };
}

/** The bar over selected words (just above them, as the editor's formatting bar). */
export function SelectionBar({ x, y, above, canEdit, onColour, onNote, onCopy, onQuote }: { x: number; y: number; above: number; canEdit: boolean; onColour(c: PdfColour): void; onNote(): void; onCopy(): void; onQuote(): void }) {
  const { left, top, ref } = useOnScreen(x, y, above, 'above');
  return (
    <div ref={ref} className="pdfv-float pdfv-selbar" style={{ left, top }} role="toolbar" aria-label="Selected words" onMouseDown={(e) => e.preventDefault()}>
      {canEdit && (
        <>
          <Swatches onPick={onColour} />
          <span className="pdfv-float-sep" />
          <button className="pdfv-float-btn" onClick={onNote}>
            <Icon name="pencil" size={14} /> Add note
          </button>
        </>
      )}
      <button className="pdfv-float-btn" onClick={onCopy}>
        <Icon name="copy" size={14} /> Copy
      </button>
      {canEdit && (
        <button className="pdfv-float-btn" onClick={onQuote} title="Put these words, with a link back to this page, at the end of a note">
          <Icon name="quote" size={14} /> Quote in a note
        </button>
      )}
    </div>
  );
}

/** One highlight's card: recolour, the person's note, copy, quote, remove. */
export function HighlightCard({
  h,
  x,
  y,
  above,
  canEdit,
  focusNote,
  onColour,
  onNote,
  onCopy,
  onQuote,
  onRemove,
  onOpenNote,
  onClose,
}: {
  h: PdfHighlight;
  x: number;
  y: number;
  above: number;
  canEdit: boolean;
  focusNote: boolean;
  onColour(c: PdfColour): void;
  onNote(text: string): void;
  onCopy(): void;
  onQuote(): void;
  onRemove(): void;
  onOpenNote(): void;
  onClose(): void;
}) {
  const { left, top, ref } = useOnScreen(x, y, above);
  const [note, setNote] = useState(h.note);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ note, saved: h.note, onNote });
  latest.current.onNote = onNote;
  const field = useRef<HTMLTextAreaElement>(null);
  // A change made in the highlights note while the card is open shows here (unless typing is under way).
  useEffect(() => {
    if (latest.current.note === latest.current.saved) {
      setNote(h.note);
      latest.current = { ...latest.current, note: h.note, saved: h.note };
    }
  }, [h.note]);
  useEffect(() => {
    if (focusNote) field.current?.focus();
  }, [focusNote]);
  const flush = () => {
    clearTimeout(timer.current);
    if (latest.current.note !== latest.current.saved) {
      latest.current.saved = latest.current.note;
      latest.current.onNote(latest.current.note);
    }
  };
  // Saved shortly after typing stops, and whenever the card closes.
  useEffect(() => () => flush(), []);
  // A click anywhere else puts the card away.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.('.menu, .picker, .overlay')) onClose();
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', keys, true);
    return () => {
      window.removeEventListener('mousedown', away, true);
      window.removeEventListener('keydown', keys, true);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="pdfv-float pdfv-card" style={{ left, top }} role="dialog" aria-label={`Highlight on page ${h.page}`}>
      <div className="pdfv-card-head">
        {canEdit ? <Swatches value={h.colour} onPick={onColour} label="Colour" /> : <span className={`pdfv-swatch pdfv-hl-${h.colour} is-on`} />}
        <span className="pdfv-card-page">Page {h.page}</span>
        {canEdit && (
          <button className="icon-button" title="Remove this highlight" aria-label="Remove this highlight" onClick={onRemove}>
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
      {h.image ? (
        <img className="pdfv-card-clip" src={fileUrl(h.image)} alt={clipCaption(h.page)} draggable={false} />
      ) : (
        <blockquote className="pdfv-card-quote">{h.text}</blockquote>
      )}
      {canEdit ? (
        <textarea
          ref={field}
          className="pdfv-card-note"
          placeholder="Add a note…"
          value={note}
          rows={2}
          spellCheck
          onChange={(e) => {
            setNote(e.target.value);
            latest.current.note = e.target.value;
            clearTimeout(timer.current);
            timer.current = setTimeout(flush, 600);
          }}
          onBlur={flush}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              flush();
              onClose();
            }
          }}
        />
      ) : (
        h.note && <p className="pdfv-card-note is-read">{h.note}</p>
      )}
      <div className="pdfv-card-actions">
        <button className="pdfv-float-btn" onClick={onCopy}>
          <Icon name="copy" size={14} /> Copy
        </button>
        {canEdit && (
          <button className="pdfv-float-btn" onClick={onQuote}>
            <Icon name="quote" size={14} /> Quote in a note
          </button>
        )}
        <button className="pdfv-float-btn" onClick={() => (flush(), onOpenNote())} title="Show this highlight in the highlights note">
          <Icon name="notes" size={14} /> In the note
        </button>
      </div>
    </div>
  );
}

/** Find in the document: the words, how many places, previous and next. */
export function FindBar({ query, count, at, busy, onQuery, onStep, onClose }: { query: string; count: number; at: number; busy: boolean; onQuery(q: string): void; onStep(dir: 1 | -1): void; onClose(): void }) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  return (
    <div className="pdfv-find" role="search">
      <Icon name="search" size={14} />
      <input
        ref={field}
        className="pdfv-find-field"
        value={query}
        placeholder="Find in this PDF"
        aria-label="Find in this PDF"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <span className="pdfv-find-count" aria-live="polite">
        {!query.trim() ? '' : busy ? 'Looking…' : count ? `${at + 1} of ${count}` : 'Not found'}
      </span>
      <button className="icon-button" title="Previous (Shift+Enter)" aria-label="Previous" disabled={!count} onClick={() => onStep(-1)}>
        <Icon name="chevron" size={14} className="pdfv-up" />
      </button>
      <button className="icon-button" title="Next (Enter)" aria-label="Next" disabled={!count} onClick={() => onStep(1)}>
        <Icon name="chevronDown" size={14} />
      </button>
      <button className="icon-button" title="Close (Esc)" aria-label="Close find" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/** One page picture in the left rail, drawn once it scrolls into the rail. */
function Thumb({ doc, n, ratio, current, onGo }: { doc: PdfDocument; n: number; ratio: number; current: boolean; onGo(): void }) {
  const holder = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let ok = true;
    const seen = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        seen.disconnect();
        void doc.getPage(n).then(async (page) => {
          const c = canvas.current;
          if (!ok || !c) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (THUMB_W * Math.min(2, window.devicePixelRatio || 1)) / Math.max(1, base.width) });
          c.width = Math.round(viewport.width);
          c.height = Math.round(viewport.height);
          const ctx = c.getContext('2d');
          if (!ctx) return;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise.catch(() => undefined);
          if (ok) setDrawn(true);
        });
      },
      { root: el.closest('.pdfv-rail'), rootMargin: '300px 0px' },
    );
    seen.observe(el);
    return () => {
      ok = false;
      seen.disconnect();
    };
  }, [doc, n]);
  useEffect(() => {
    if (current) holder.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <button ref={holder} className={`pdfv-thumb${current ? ' is-current' : ''}${drawn ? ' is-drawn' : ''}`} onClick={onGo} aria-label={`Page ${n}`} aria-current={current ? 'page' : undefined}>
      <canvas ref={canvas} style={{ width: THUMB_W, height: Math.round(THUMB_W * ratio) }} />
      <span className="pdfv-thumb-n">{n}</span>
    </button>
  );
}

const THUMB_W = 112;

export function Thumbs({ doc, ratios, current, onGo }: { doc: PdfDocument; ratios: number[]; current: number; onGo(index: number): void }) {
  return (
    <nav className="pdfv-rail" aria-label="Pages">
      {ratios.map((r, i) => (
        <Thumb key={i} doc={doc} n={i + 1} ratio={r} current={i === current} onGo={() => onGo(i)} />
      ))}
    </nav>
  );
}

/** Every highlight in reading order, with a colour filter; a click goes to it, a drag into a note quotes it there. */
export function HighlightsPanel({ list, noteName, noteExists, onGo, onOpenNote, onClose, dragText }: { list: PdfHighlight[]; noteName: string; noteExists: boolean; onGo(h: PdfHighlight): void; onOpenNote(): void; onClose(): void; dragText(h: PdfHighlight): string }) {
  const [only, setOnly] = useState<PdfColour | null>(null);
  const sorted = sortHighlights(list);
  const shown = only ? sorted.filter((h) => h.colour === only) : sorted;
  const used = PDF_COLOURS.filter((c) => list.some((h) => h.colour === c));
  return (
    <aside className="pdfv-panel" aria-label="Highlights">
      <div className="pdfv-panel-head">
        <span className="pdfv-panel-title">Highlights</span>
        <span className="pdfv-panel-count">{list.length || ''}</span>
        <button className="icon-button" title="Close" aria-label="Close highlights" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {used.length > 1 && (
        <div className="pdfv-panel-filter" role="group" aria-label="Show one colour">
          <button className={`pdfv-chip${only ? '' : ' is-on'}`} onClick={() => setOnly(null)}>
            All
          </button>
          {used.map((c) => (
            <button key={c} className={`pdfv-chip${only === c ? ' is-on' : ''}`} onClick={() => setOnly(only === c ? null : c)} aria-pressed={only === c}>
              <span className={`pdfv-dot pdfv-hl-${c}`} /> {COLOUR_WORDS[c]}
            </button>
          ))}
        </div>
      )}
      <div className="pdfv-panel-list">
        {shown.length ? (
          shown.map((h) => (
            <button
              key={h.id}
              className="pdfv-panel-item"
              onClick={() => onGo(h)}
              title="Go to this highlight. Drag it into a note to quote it."
              draggable
              onDragStart={(e) => {
                // Plain Markdown, so it drops into a note (or any app) as words with a link back.
                e.dataTransfer.setData('text/plain', dragText(h));
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <span className={`pdfv-panel-bar pdfv-hl-${h.colour}`} />
              <span className="pdfv-panel-body">
                {h.image && <img className="pdfv-panel-thumb" src={fileUrl(h.image)} alt={clipCaption(h.page)} draggable={false} />}
                <span className="pdfv-panel-quote">{h.image ? clipCaption(h.page) : h.text}</span>
                {h.note && <span className="pdfv-panel-note">{h.note}</span>}
                <span className="pdfv-panel-page">Page {h.page}</span>
              </span>
            </button>
          ))
        ) : (
          <p className="pdfv-panel-empty">
            {list.length ? 'No highlights in this colour.' : 'Select words and choose a colour to highlight them, or clip a picture with the scissors above. Everything is kept in a note beside the PDF; the PDF itself is never changed.'}
          </p>
        )}
      </div>
      <div className="pdfv-panel-foot">
        <button className="button" disabled={!noteExists} onClick={onOpenNote} title={noteExists ? noteName : 'The note is made with your first highlight'}>
          <Icon name="notes" size={14} /> Open highlights note
        </button>
      </div>
    </aside>
  );
}
