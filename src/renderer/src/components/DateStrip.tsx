// One date strip, everywhere (v9, 6 Nov 2026). Each stop keeps its own room in order, a long gap reads as a
// marked break, Today keeps its true place, and the stops past counting fold honestly ("8 earlier", opened).
// Clicking a stop (or one of the named rows) goes to its row. The dashboard's Milestones card and the
// workspace's Next milestones tile both draw this; positions come from shared/date-strip.ts, this only draws
// them. Dates under every stop (v10, 6 Nov 2026: 14 bare dots "still says nothing"): each day in view shows
// its date ("5 Nov", "5 Nov · 3" when shared), the next stop adds its short name, Today stays above the line
// while dates sit below it so they never collide, and an opened strip thins to what fits (first of each month
// and the next stop always kept). Colour says done, late and coming, on the dots and the dates alike.

import { useEffect, useMemo, useRef, useState } from 'react';
import { clampedLabel01, layoutStrip, stripLabels, thinLabels, type StripStop } from '../../../shared/date-strip';

export type StripKey = 'late' | 'last-done' | 'next';
const KEY_WORDS: Record<StripKey, string> = { late: 'Late', 'last-done': 'Last done', next: 'Next' };

export function DateStrip({ stops, today, onOpen, keys = ['late', 'last-done', 'next'], progress = false }: {
  /** Every dated stop, in any order (folds itself when past counting). */
  stops: StripStop[];
  today: number;
  /** A stop (or a named row) goes to its row. */
  onOpen(stop: StripStop): void;
  /** Which key stops get named rows under the strip (a tile with its own rows names fewer). */
  keys?: StripKey[];
  /** Shade the line up to today (the dashboard's done fill). */
  progress?: boolean;
}) {
  const [all, setAll] = useState(false);
  const layout = useMemo(() => layoutStrip(stops, today, all), [stops, today, all]);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTrackW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setTrackW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  const wide = all && layout.stops.length > 16;
  const stripW = wide ? layout.stops.length * 30 : trackW;
  const labels = useMemo(() => thinLabels(stripLabels(layout.stops, today), stripW), [layout.stops, today, stripW]);
  // The dashed line keeps Today's true place; its word clamps inside at either end (finding 9). The word is
  // drawn from the line, so it shifts by the clamped distance (46px allowed: the word and its padding).
  const todayWordShift = stripW > 0 ? Math.round((clampedLabel01(layout.today01, 46, stripW) - layout.today01) * stripW) : 0;
  if (!layout.stops.length) return null;
  const named = layout.stops.filter((s) => s.key && keys.includes(s.key));
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  return (
    <div className="dstrip">
      {(all || layout.earlier > 0 || layout.later > 0) && (
        <div className="dstrip-folds">
          <span>{!all && layout.earlier > 0 && <button type="button" className="dstrip-fold" onClick={() => setAll(true)}>{layout.earlier} earlier</button>}</span>
          <span>{!all && layout.later > 0 ? <button type="button" className="dstrip-fold" onClick={() => setAll(true)}>{layout.later} later</button> : all ? <button type="button" className="dstrip-fold" onClick={() => setAll(false)}>Show fewer</button> : null}</span>
        </div>
      )}
      <div ref={trackRef} className={`dstrip-track${wide ? ' is-wide' : ''}`}>
        <div className="dstrip-inner" style={wide ? { width: layout.stops.length * 30 } : undefined}>
          <span className="dstrip-line" aria-hidden="true" />
          {progress && <span className="dstrip-done" style={{ width: pct(layout.today01) }} aria-hidden="true" />}
          <span className="dstrip-today" style={{ left: pct(layout.today01) }} aria-hidden="true">
            <span style={{ left: todayWordShift }}>Today</span>
          </span>
          {layout.breaks.map((b, i) => (
            <span key={i} className="dstrip-break" style={{ left: pct(b.x01) }} title={`${b.days} days with nothing on them`} aria-label={`${b.days} days with nothing on them`}>
              //
            </span>
          ))}
          {layout.stops.map((s) => (
            <button key={s.id} type="button" className={`dstrip-stop${s.key === 'next' ? ' is-next' : ''}${s.late ? ' is-late' : ''}${s.done ? ' is-done' : ''}`} style={{ left: pct(s.x01) }} title={`${s.date} · ${s.label}`} aria-label={`${s.date}: ${s.label}`} onClick={() => onOpen(s)}>
              <span className="dstrip-dot" aria-hidden="true" />
            </button>
          ))}
          {labels.map((l) => (
            <span key={l.day} className={`dstrip-label tone-${l.tone}`} style={{ left: pct(l.x01) }} title={l.isNext ? `${l.text} · ${l.nextName}` : l.text}>
              <span className="dstrip-label-date">{l.text}</span>
              {l.isNext && <span className="dstrip-label-name">{l.nextName}</span>}
            </span>
          ))}
        </div>
      </div>
      {named.length > 0 && (
        <ul className="dstrip-keys">
          {named.map((s) => (
            <li key={s.id}>
              <button type="button" className={`dstrip-key${s.key === 'next' ? ' is-next' : ''}${s.late ? ' is-late' : ''}${s.done ? ' is-done' : ''}`} onClick={() => onOpen(s)} title={`${s.date} · ${s.label} (open it)`}>
                <span className="dstrip-dot" aria-hidden="true" />
                <span className="dstrip-key-words">
                  <b>{KEY_WORDS[s.key!]}:</b> {s.label} · {s.date}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
