# Drawings (.nvdraw)

A drawing is a file of its own, `Name.nvdraw`, beside the notes. It is plain UTF-8 JSON in Ironleaf's own small
format, written from scratch (21 Oct 2026, gap G23). Anyone may read or write it. The code is
`src/shared/drawing.ts`; the screen is `src/renderer/src/views/DrawingView.tsx`.

## The file

```json
{
	"type": "neuralvault-drawing",
	"version": 1,
	"elements": [
		{"id":"a1","kind":"stroke","colour":"ink","width":4,"points":[[10,10,0.2],[20,14,0.6],[34,22,1]]},
		{"id":"b2","kind":"rect","x":100,"y":40,"w":160,"h":90,"colour":"blue","width":2,"fill":true},
		{"id":"c3","kind":"ellipse","x":300,"y":40,"w":80,"h":80,"colour":"green","width":2},
		{"id":"d4","kind":"arrow","x1":260,"y1":85,"x2":300,"y2":80,"colour":"red","width":2},
		{"id":"e5","kind":"line","x1":0,"y1":200,"x2":400,"y2":200,"colour":"#7a5c3e","width":1.5},
		{"id":"f6","kind":"text","x":110,"y":60,"size":18,"colour":"violet","text":"Till 1\nand the counter"}
	]
}
```

- `type` is always `"neuralvault-drawing"`. `version` is 1. Any other top-level key is kept as it is when Ironleaf
  saves the file.
- `elements` are drawn in order, so later ones are on top. Each has an `id` that is unique in the file (letters,
  digits, `_` and `-`, up to 64 characters).
- Coordinates are drawing units, with y going down. Ironleaf writes numbers to two decimal places and pressure to
  three.
- `colour` is one of `ink`, `red`, `orange`, `green`, `blue` or `violet`, or a `#rrggbb` colour. Named colours are
  drawn in the light or dark look's own shade, so a drawing reads in both. Exports use the light shades.
- `width` is the line's width. For a stroke it is the width at full pressure.

| kind | fields |
| --- | --- |
| `stroke` | `points`: `[x, y, pressure]` for each point, pressure from 0 to 1 (a mouse gives 0.5) |
| `rect`, `ellipse` | `x`, `y` (top-left corner), `w`, `h`, optional `fill: true` (a soft wash of the colour) |
| `line`, `arrow` | `x1`, `y1` to `x2`, `y2` (an arrow's head is at the second end) |
| `text` | `x`, `y` (top-left of the first line), `size`, `text` (lines split by `\n`) |

When the file is read, an element that can't be read is left out and the person is told. A file that isn't JSON, or
whose `type` is something else, is never written over.

## On a canvas

A canvas shows a drawing as an ordinary JSON Canvas file node, for example
`{"id":"…","type":"file","file":"Plans/Shop floor.nvdraw","x":320,"y":0,"width":420,"height":300}`. The node has no
keys of Ironleaf's own, so the `.canvas` file stays valid for every app that reads JSON Canvas. Those apps simply
show a file there. Ironleaf draws the drawing on the card, and double-clicking the card opens it.

## Export

- **Export as SVG** writes a standalone SVG fitted to the drawing, with the light shades.
- **Export as a picture (PNG)** writes the same drawing at twice its size on white.
