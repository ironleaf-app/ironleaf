// A PDF's highlights, kept in its highlights note (src/shared/pdf-highlights.ts) through the same shared copy the
// editor uses (state/docs.ts), so a tab showing the note and the PDF's own tab stay in step both ways: a comment typed
// under a highlight in the note shows in the reader, and a highlight made in the reader shows in the note at once. The
// note is made with the first highlight, never before (19 Oct 2026, 5.0.0 PDF reader).

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseSidecar, sidecarPathFor, writeSidecar, type PdfHighlight } from '../../../../shared/pdf-highlights';
import { linkTarget } from '../../lib/links';
import { docs } from '../../state/docs';
import { getState, loadFiles, loadNotes, showError, useApp } from '../../state/store';

export interface Highlights {
  list: PdfHighlight[];
  /** The note's path (whether or not it is written yet). */
  notePath: string;
  noteExists: boolean;
  /** Whether highlights can be made and changed (without a licence Ironleaf only reads). */
  canEdit: boolean;
  /** Replaces the whole list and writes the note. */
  save(next: PdfHighlight[]): void;
}

export function useHighlights(pdfPath: string): Highlights {
  const notePath = sidecarPathFor(pdfPath);
  const canEdit = useApp((s) => s.canEdit);
  const listed = useApp((s) => s.byPath.has(notePath));
  const [list, setList] = useState<PdfHighlight[]>([]);
  const [held, setHeld] = useState(false);
  const preamble = useRef<string | null>(null);
  const origin = useRef({ pdf: pdfPath });
  const creating = useRef<Promise<void> | null>(null);

  const take = (text: string) => {
    const parsed = parseSidecar(text);
    preamble.current = parsed.preamble;
    setList(parsed.highlights);
  };

  // The note, once it exists: read through the shared copy, and followed while this tab is open.
  useEffect(() => {
    if (!listed) return;
    let live = true;
    let off = () => {};
    let acquired = false;
    void docs
      .acquire(notePath)
      .then((text) => {
        acquired = true;
        if (!live) return docs.release(notePath);
        take(text);
        setHeld(true);
        off = docs.subscribe(notePath, (next, from) => {
          if (from !== origin.current) take(next);
        });
      })
      .catch(() => {});
    return () => {
      live = false;
      off();
      if (acquired) docs.release(notePath);
      setHeld(false);
    };
  }, [notePath, listed]);

  const save = useCallback(
    (next: PdfHighlight[]) => {
      if (!getState().canEdit) return;
      setList(next);
      const text = writeSidecar({ preamble: preamble.current, highlights: next }, pdfPath, linkTarget(pdfPath, notePath));
      if (docs.text(notePath) !== undefined) {
        docs.update(notePath, text, origin.current);
        return;
      }
      // The first highlight: the note is made now (a second one made while that is written waits for it).
      const after = creating.current;
      creating.current = (async () => {
        await after;
        if (docs.text(notePath) !== undefined) return docs.update(notePath, text, origin.current);
        try {
          if (getState().byPath.has(notePath)) await window.nv.notes.write(notePath, text);
          else await window.nv.notes.create(notePath, text);
          await Promise.all([loadNotes(), loadFiles()]);
        } catch (err) {
          showError(err);
        }
      })();
    },
    [pdfPath, notePath],
  );

  return { list, notePath, noteExists: listed || held, canEdit, save };
}
