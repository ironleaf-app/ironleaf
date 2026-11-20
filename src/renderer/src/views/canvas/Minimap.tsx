// The whole board small, in a corner: every card as a block in its colour, the part on screen as a frame. Click
// anywhere in it to go there; drag the frame (it keeps where it was taken hold of) or anywhere to move about. Works
// with a finger too.

import { memo, useRef } from 'react';
import type { CanvasNode } from '../../../../shared/project-canvas';
import { bounds, type Rect } from './geometry';

const W = 200;
const H = 132;

export const Minimap = memo(function Minimap({ nodes, view, surface, colorOf, onMove }: { nodes: CanvasNode[]; view: { x: number; y: number; k: number }; surface: { width: number; height: number }; colorOf(c?: string): string | undefined; onMove(centre: { x: number; y: number }): void }) {
  const ref = useRef<SVGSVGElement>(null);
  /** Where the frame was taken hold of, from its middle (map px), so dragging it doesn't jump. */
  const grip = useRef({ x: 0, y: 0 });
  const seen: Rect = { x: -view.x / view.k, y: -view.y / view.k, width: surface.width / view.k, height: surface.height / view.k };
  const all = bounds([...nodes, seen]);
  const pad = 40;
  const box = { x: all.x - pad, y: all.y - pad, width: all.width + pad * 2, height: all.height + pad * 2 };
  const s = Math.min(W / box.width, H / box.height);
  const ox = (W - box.width * s) / 2;
  const oy = (H - box.height * s) / 2;
  const toMap = (r: Rect) => ({ x: ox + (r.x - box.x) * s, y: oy + (r.y - box.y) * s, width: Math.max(1.5, r.width * s), height: Math.max(1.5, r.height * s) });
  const frame = toMap(seen);
  const go = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    onMove({ x: box.x + (clientX - r.left - grip.current.x - ox) / s, y: box.y + (clientY - r.top - grip.current.y - oy) / s });
  };
  return (
    <svg
      ref={ref}
      className="cv-minimap"
      width={W}
      height={H}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        const r = ref.current!.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const onFrame = mx >= frame.x && mx <= frame.x + frame.width && my >= frame.y && my <= frame.y + frame.height;
        grip.current = onFrame ? { x: mx - (frame.x + frame.width / 2), y: my - (frame.y + frame.height / 2) } : { x: 0, y: 0 };
        go(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) go(e.clientX, e.clientY);
      }}
    >
      {nodes.map((n) => {
        const r = toMap(n);
        const c = colorOf(n.color);
        return n.type === 'group' ? (
          <rect key={n.id} {...r} rx={2} className="cv-mm-group" style={c ? { stroke: c } : undefined} />
        ) : (
          <rect key={n.id} {...r} rx={1.5} className="cv-mm-card" style={c ? { fill: c } : undefined} />
        );
      })}
      <rect {...frame} rx={3} className="cv-mm-frame" />
    </svg>
  );
});
