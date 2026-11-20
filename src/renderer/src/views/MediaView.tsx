// Pictures, PDFs, sound and video among the notes, shown in their tab. PDFs open in Ironleaf's own reader, with
// highlights and notes (views/pdf/PdfView.tsx; 19 Oct 2026, 5.0.0), no longer in Chromium's built-in viewer.
// A picture opened from search (9.0 w123ocr) marks the found words where they sit in it.

import { useEffect, useState } from 'react';
import { parsePdfAnchor } from '../../../shared/pdf-highlights';
import type { OcrBox } from '../../../shared/ocr';
import { Icon } from '../components/Icon';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import { fileUrl, isAudio, isImage, isPdf, isVideo } from '../lib/resolve';
import * as A from '../state/actions';
import { searchWords } from '../state/fileSearch';
import { onReveal, takeReveal } from '../state/layout';
import { fileMenu } from '../state/menus';
import { takeWaiting } from '../state/playback';
import type { TabState } from '../state/workspace';
import { ViewHeader } from './ViewHeader';
import { PdfView } from './pdf/PdfView';

export function MediaView({ tab }: { tab: TabState }) {
  return isPdf(tab.path!) ? <PdfView tab={tab} /> : <OtherMedia tab={tab} />;
}

function OtherMedia({ tab }: { tab: TabState }) {
  const path = tab.path!;
  const url = fileUrl(path);
  const [zoomed, setZoomed] = useState(false);
  // The found words marked (opened from search with find=<words>): their boxes, as fractions of the picture.
  const [marks, setMarks] = useState<OcrBox[] | null>(null);
  useEffect(() => {
    if (!isImage(path)) return;
    let live = true;
    const show = () => {
      const where = takeReveal(path);
      const q = where?.heading ? (parsePdfAnchor(where.heading).find ?? '') : '';
      if (!q) {
        setMarks(null);
        return;
      }
      const words = searchWords(q).map((w) => w.toLowerCase());
      if (!words.length) {
        setMarks(null);
        return;
      }
      void window.nv.ocr.lines(path).then(
        (lines) => {
          if (!live) return;
          if (!lines) {
            setMarks(null);
            return;
          }
          const boxes: OcrBox[] = [];
          for (const l of lines) {
            const parts = l.words.length ? l.words : [{ text: l.text, box: l.box }];
            for (const w of parts) if (words.some((needle) => w.text.toLowerCase().includes(needle))) boxes.push(w.box);
          }
          setMarks(boxes);
        },
        () => live && setMarks(null),
      );
    };
    show();
    return onReveal((p) => {
      if (p === path) show();
    });
  }, [path]);
  return (
    <div className="media-view">
      {/* The header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred
          search): the button yields when measured within 12px of the bar; the ⋯ menu already reaches it in the
          same words below, so no row is added. */}
      <ViewHeader tab={tab} title={A.nameOf(path)} menu={() => [...overflowMenuItems(headerOverflowHidden(tab.id), { 'open-default': null }), ...fileMenu(path)]}>
        <button className="icon-button" data-overflow="open-default" data-overflow-order={1} title="Open in its default app" onClick={() => void A.openInDefaultApp(path)}>
          <Icon name="external" size={16} />
        </button>
      </ViewHeader>
      <div className="media-body">
        {isImage(path) ? (
          <span className="media-marked">
            <img className={`media-image${zoomed ? ' is-zoomed' : ''}`} src={url} alt={A.nameOf(path)} onClick={() => setZoomed((z) => !z)} />
            {marks?.map((b, i) => (
              <span key={i} className="media-mark" aria-hidden style={{ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${b[2] * 100}%`, height: `${b[3] * 100}%` }} />
            ))}
          </span>
        ) : isAudio(path) ? (
          <div className="media-audio">
            <Icon name="audio" size={42} />
            <div className="media-name">{A.nameOf(path)}</div>
            <audio
              controls
              src={url}
              onLoadedMetadata={(e) => {
                // Opened from a moment of a meeting's recording ("12:03"): it plays from there.
                const at = takeWaiting(path);
                if (at !== null) {
                  e.currentTarget.currentTime = at;
                  void e.currentTarget.play().catch(() => undefined);
                }
              }}
            />
          </div>
        ) : isVideo(path) ? (
          <video className="media-video" controls src={url} />
        ) : (
          <div className="media-other">
            <Icon name="file" size={42} />
            <div className="media-name">{A.nameOf(path)}</div>
            <p className="hint">Ironleaf can’t show this kind of file.</p>
            <button className="button" onClick={() => void A.openInDefaultApp(path)}>
              <Icon name="external" size={15} /> Open in its default app
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
