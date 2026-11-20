// The screenshot's own window: the screen as it was, dimmed; drag over the part to keep (Enter keeps the whole screen,
// Esc goes back to the box without one).

import { useEffect, useRef, useState } from 'react';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function Snip() {
  const [image, setImage] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const done = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    void window.nv.capture.snipImage().then((v) => setImage(v?.url ?? null));
    const finish = (r: Rect | null) => {
      if (done.current) return;
      done.current = true;
      void window.nv.capture.snipDone(r);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter') finish({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('keydown', onKey);
    (window as unknown as { __snipFinish?: (r: Rect | null) => void }).__snipFinish = finish;
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const finish = (r: Rect | null) => (window as unknown as { __snipFinish?: (r: Rect | null) => void }).__snipFinish?.(r);
  const box = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });

  return (
    <div
      className="qc-snip"
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY };
        setRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
      }}
      onMouseMove={(e) => {
        if (start.current) setRect(box(start.current, { x: e.clientX, y: e.clientY }));
      }}
      onMouseUp={(e) => {
        if (!start.current) return;
        const r = box(start.current, { x: e.clientX, y: e.clientY });
        start.current = null;
        if (r.width >= 4 && r.height >= 4) finish(r);
        else setRect(null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        finish(null);
      }}
    >
      {image && <img className="qc-snip-screen" src={image} alt="" draggable={false} />}
      {rect && rect.width > 0 ? (
        <div className="qc-snip-rect" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          <span className="qc-snip-size">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </span>
        </div>
      ) : (
        <div className="qc-snip-dim" />
      )}
      <div className="qc-snip-hint">
        Drag over what you want to keep <span>·</span> Enter takes the whole screen <span>·</span> Esc cancels
      </div>
    </div>
  );
}
