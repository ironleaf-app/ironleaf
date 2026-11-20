// Hovering a link shows the note it leads to (or the heading, or the picture) in a small card, which stays while the
// pointer is on it and can be opened from there (here, or in a new tab). Escape puts it away. A private note's words
// never show in it, only that it is private (src/main/private-notes.ts). With previews switched off in Settings, holding
// Ctrl over a link still shows one. (19 Oct 2026: 5.0.0 polish.)

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { stripRepeatHeading } from '../../../shared/notes-list';
import { isPrivatePath } from '../../../shared/private';
import { hydrate } from '../lib/hydrate';
import { renderMarkdown, sectionOf, wikilinkFromClick } from '../lib/markdownRender';
import { parsePdfAnchor } from '../../../shared/pdf-highlights';
import { fileUrl, isImage, isPdf, resolveAny, resolveNote } from '../lib/resolve';
import { docs } from '../state/docs';
import { minPopupTop } from '../lib/windowButtons';
import { pagePicture } from '../views/pdf/pdfDoc';
import { prefs } from '../state/store';
import { Icon } from './Icon';

interface HoverState {
  target: string;
  from?: string;
  rect: DOMRect;
}

let current: HoverState | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

const close = () => {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  current = null;
  emit();
};

/** The hover card put away (t239): moving to another page closes it, like the peek — a card for the old page's
 *  link must never cover what the person reads now. */
export const closeHover = close;

/**
 * Shows a preview for a link under the pointer (after a short wait, so passing over links doesn't flash cards). `held`:
 * Ctrl (or Cmd) is down, which asks for one even with previews switched off.
 */
export function hoverLink(target: string, anchor: HTMLElement, from?: string, delay = 350, held = false): void {
  if (!prefs().hoverPreview && !held) return;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  const leave = () => {
    clearTimeout(showTimer);
    hideTimer = setTimeout(() => {
      current = null;
      emit();
    }, 300);
    anchor.removeEventListener('mouseleave', leave);
  };
  anchor.addEventListener('mouseleave', leave);
  showTimer = setTimeout(() => {
    current = { target, from, rect: anchor.getBoundingClientRect() };
    emit();
  }, delay);
}

export function HoverHost({ onOpen }: { onOpen(target: string, from: string | undefined, newTab: boolean): void }) {
  const state = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
  const body = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [locked, setLocked] = useState(false);
  /** Whether there is a note (or picture) to open: not for a link to one not written yet. */
  const [found, setFound] = useState(false);

  // Escape puts the card away, wherever the focus is.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the card goes: the Escape doesn't also close a dialog or leave the editor.
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    void (async () => {
      const hash = state.target.indexOf('#');
      const name = hash >= 0 ? state.target.slice(0, hash) : state.target;
      const heading = hash >= 0 ? state.target.slice(hash + 1) : '';
      const path = name ? resolveAny(name, state.from) : state.from ?? null;
      // A private note: its name only, never a word of it (the store's notes aren't listed, so the link names the folder).
      if (isPrivatePath(name) || isPrivatePath(path)) {
        setLocked(true);
        setFound(true);
        const named = name || path || '';
        setTitle((named.split('/').pop() ?? named).replace(/\.md$/i, ''));
        setHtml('');
        return;
      }
      setLocked(false);
      setFound(!!path);
      if (!path) {
        setTitle(name);
        setHtml('<p class="hover-missing">This note isn’t written yet. Click the link to make it.</p>');
        return;
      }
      if (isImage(path)) {
        setTitle(path.split('/').pop() ?? path);
        setHtml(`<img src="${fileUrl(path)}" alt="">`);
        return;
      }
      // A PDF: the page the link names, drawn small (19 Oct 2026, 5.0.0 PDF reader: [[Report.pdf#page=4]]).
      if (isPdf(path)) {
        const page = parsePdfAnchor(heading).page ?? 1;
        setTitle(`${path.split('/').pop() ?? path} › Page ${page}`);
        setHtml('<p class="hover-pdf-wait">Drawing the page…</p>');
        const picture = await pagePicture(path, page, 420);
        if (cancelled) return;
        setHtml(picture ? `<img class="hover-pdf-page" src="${picture.url}" alt="Page ${page}">` : '<p class="hover-missing">This page can’t be shown.</p>');
        return;
      }
      const notePath = resolveNote(name, state.from) ?? path;
      let text = docs.text(notePath) ?? (await window.nv.notes.read(notePath).catch(() => ''));
      if (heading) text = sectionOf(text, heading) ?? text;
      if (cancelled) return;
      const noteTitle = (notePath.split('/').pop() ?? notePath).replace(/\.md$/i, '');
      setTitle(noteTitle + (heading ? ` › ${heading.replace(/^\^/, '')}` : ''));
      // The card already says the note's name: a first heading that only repeats it is left out of a whole-note
      // peek (8.7 w2b round 4), never of one heading's section.
      if (!heading) text = stripRepeatHeading(text, noteTitle);
      setHtml(renderMarkdown(text.slice(0, 20000), { from: notePath }));
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  useEffect(() => {
    if (html && body.current) void hydrate(body.current, 1);
  }, [html]);

  if (!state || html === null) return null;
  const width = 440;
  const below = state.rect.bottom + 8 + 320 < window.innerHeight;
  const left = Math.max(8, Math.min(state.rect.left, window.innerWidth - width - 8));
  // Never up under the window buttons (8.6.1): below their band.
  const style = below ? { left, top: Math.max(minPopupTop(), state.rect.bottom + 6), width } : { left, bottom: window.innerHeight - state.rect.top + 6, width };
  const open = (newTab: boolean) => {
    onOpen(state.target, state.from, newTab);
    close();
  };
  return (
    <div
      className={`hover-card${locked ? ' is-private' : ''}`}
      style={style}
      role="dialog"
      aria-label={`Preview of ${title}`}
      onMouseEnter={() => clearTimeout(hideTimer)}
      onMouseLeave={() => {
        hideTimer = setTimeout(() => {
          current = null;
          emit();
        }, 200);
      }}
    >
      <div className="hover-head">
        <button className="hover-title" title="Open (Ctrl+click: in a new tab)" onClick={(e) => open(e.ctrlKey || e.metaKey)}>
          {title}
        </button>
        {found && (
          <span className="hover-actions">
            <button className="hover-action" onClick={() => open(false)}>
              Open
            </button>
            <button className="icon-button hover-action-icon" title="Open in new tab" aria-label="Open in new tab" onClick={() => open(true)}>
              <Icon name="newTab" size={14} />
            </button>
          </span>
        )}
      </div>
      {locked ? (
        <div className="hover-private">
          <Icon name="lock" size={14} />
          <span>Private note</span>
        </div>
      ) : (
        <div
          ref={body}
          className="hover-body markdown"
          onClick={(e) => {
            const target = wikilinkFromClick(e);
            if (target !== null) {
              e.preventDefault();
              onOpen(target, state.from, e.ctrlKey || e.metaKey);
              close();
            }
          }}
          // Rendered with raw HTML switched off (markdownRender.ts).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
