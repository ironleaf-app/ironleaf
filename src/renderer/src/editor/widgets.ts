// The things Live Preview draws in place of Markdown: tick-boxes, bullets, rules, pictures, maths, embedded notes,
// tables, diagrams and callout titles. Each knows when it is the same as another (so the editor keeps its DOM).

import { WidgetType, type EditorView } from '@codemirror/view';
import katex from 'katex';
import { drawErrorHtml, drawMermaid, hydrate } from '../lib/hydrate';
import { iconSvg, renderInline, renderMarkdown, sectionOf } from '../lib/markdownRender';
import { fileUrl, isAudio, isImage, isPdf, isVideo, resolveFile, resolveNote } from '../lib/resolve';
import { docs } from '../state/docs';
import { toast } from '../state/store';
import { stripRepeatHeading } from '../../../shared/notes-list';
import { isViewPath } from '../../../shared/views';
import { normalizeTarget } from '../../../shared/markdown';
import { isSyncedPath } from '../../../shared/synced-blocks';

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-nv-checkbox';
    box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? 'Done' : 'Not done');
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

/** A link to a person, project or meeting, drawn as a chip (8.0 section E): an initial for a person, a dot for a
 *  project, a small calendar for a meeting. It carries the link's own class and target, so the editor's clicks open
 *  it as any link does (editor/setup.ts). */
export class MentionWidget extends WidgetType {
  constructor(
    readonly kind: 'person' | 'project' | 'meeting',
    readonly name: string,
    readonly target: string,
  ) {
    super();
  }
  eq(other: MentionWidget) {
    return other.kind === this.kind && other.name === this.name && other.target === this.target;
  }
  toDOM() {
    const chip = document.createElement('span');
    chip.className = `cm-nv-wikilink cm-nv-mention is-${this.kind}`;
    chip.dataset.target = this.target;
    chip.title = this.name;
    const mark = document.createElement('span');
    mark.className = 'cm-nv-mention-mark';
    mark.setAttribute('aria-hidden', 'true');
    // A person's initial; a project's dot and a meeting's square are drawn by the chip's styles.
    if (this.kind === 'person') mark.textContent = this.name.trim().charAt(0).toUpperCase() || '?';
    const words = document.createElement('span');
    words.textContent = this.name;
    chip.append(mark, words);
    return chip;
  }
  ignoreEvent() {
    return false;
  }
}

export class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-nv-bullet';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

export class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-nv-hr';
    return span;
  }
}

export class TextWidget extends WidgetType {
  constructor(readonly text: string, readonly cls: string) {
    super();
  }
  eq(other: TextWidget) {
    return other.text === this.text && other.cls === this.cls;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = this.cls;
    span.textContent = this.text;
    return span;
  }
}

export class CalloutTitleWidget extends WidgetType {
  constructor(readonly icon: string, readonly label: string | null) {
    super();
  }
  eq(other: CalloutTitleWidget) {
    return other.icon === this.icon && other.label === this.label;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-nv-callout-mark';
    span.innerHTML = `<span class="cm-nv-callout-icon">${iconSvg(this.icon, 16)}</span>${this.label ? `<span class="cm-nv-callout-label">${this.label.replace(/</g, '&lt;')}</span>` : ''}`;
    return span;
  }
}

/** A foldable callout's arrow, at the end of its first line: pointing down while open, to the side while folded. */
export class CalloutFoldWidget extends WidgetType {
  constructor(readonly folded: boolean) {
    super();
  }
  eq(other: CalloutFoldWidget) {
    return other.folded === this.folded;
  }
  toDOM() {
    const button = document.createElement('span');
    button.className = `cm-nv-callout-fold${this.folded ? ' is-folded' : ''}`;
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', this.folded ? 'Show the callout' : 'Fold the callout');
    button.title = this.folded ? 'Show' : 'Fold';
    button.innerHTML = iconSvg('chevron', 14);
    return button;
  }
  ignoreEvent() {
    return false;
  }
}

export class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly width: string | null) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.width === this.width;
  }
  toDOM() {
    const img = document.createElement('img');
    img.className = 'cm-nv-image';
    img.src = this.src;
    img.alt = this.alt;
    if (this.width) img.style.width = `${this.width}px`;
    img.onerror = () => img.classList.add('is-broken');
    return img;
  }
  ignoreEvent() {
    return false;
  }
}

export class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly display: boolean) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM() {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'cm-nv-math-block' : 'cm-nv-math';
    try {
      katex.render(this.tex, el, { throwOnError: false, displayMode: this.display });
    } catch {
      el.textContent = this.tex;
    }
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

/** ![[embeds]]: a picture, PDF, sound or video file, a view over notes, or another note (or one heading of it) drawn in
 *  place. */
export class EmbedWidget extends WidgetType {
  constructor(readonly target: string, readonly heading: string, readonly size: string, readonly from: string, readonly block: boolean, readonly version: number) {
    super();
  }
  eq(other: EmbedWidget) {
    // A view keeps itself current as notes change (views/saved/ViewEmbed.tsx), so a change elsewhere never redraws it.
    const same = other.target === this.target && other.heading === this.heading && other.size === this.size && other.from === this.from && other.block === this.block;
    return same && (other.version === this.version || isViewPath(this.target));
  }
  get estimatedHeight() {
    return this.block ? 160 : -1;
  }
  toDOM(view: EditorView) {
    const file = resolveFile(this.target, this.from);
    const size = /^(\d+)(?:x(\d+))?$/.exec(this.size);
    if (file && isImage(file)) {
      const img = document.createElement('img');
      img.className = 'cm-nv-image';
      img.src = fileUrl(file);
      img.alt = size ? '' : this.size || this.target;
      if (size) img.style.width = `${size[1]}px`;
      img.onerror = () => img.classList.add('is-broken');
      return img;
    }
    const box = document.createElement(this.block ? 'div' : 'span');
    box.className = `cm-nv-embed${this.block ? ' is-block' : ''}`;
    if (file && isViewPath(file)) {
      // A view over notes (21 Oct 2026): drawn by React into the box, read-only, taken away with the widget.
      box.className = 'cm-nv-embed is-block is-view';
      void import('../views/saved/ViewEmbed').then((m) => {
        if (unmounted.has(box)) return;
        unmountViews.set(box, m.mountViewEmbed(box, file, this.heading));
        view.requestMeasure();
      });
      return box;
    }
    if (file && isPdf(file)) {
      box.innerHTML = `<iframe class="nv-embed-pdf" src="${fileUrl(file)}${this.heading ? `#${encodeURIComponent(this.heading)}` : ''}"></iframe>`;
      return box;
    }
    if (file && (isAudio(file) || isVideo(file))) {
      const media = document.createElement(isAudio(file) ? 'audio' : 'video');
      media.controls = true;
      media.preload = 'metadata';
      media.src = fileUrl(file);
      box.appendChild(media);
      return box;
    }
    const path = resolveNote(this.target, this.from);
    const title = (this.target.split('/').pop() ?? this.target) + (this.heading ? ` › ${this.heading.replace(/^\^/, '')}` : '');
    if (!path) {
      box.innerHTML = `<span class="nv-embed-missing">“${title.replace(/</g, '&lt;')}” isn’t written yet.</span>`;
      return box;
    }
    // A synced block (8.8): the live block with its two quiet actions — "Edit the original" opens the block's own
    // note as any link does; "Unsync here" puts the block's words in place of this embed.
    if (this.block && isSyncedPath(path)) {
      box.classList.add('is-synced');
      box.innerHTML = `<span class="nv-embed-head"><span class="nv-sync-label">Synced block</span><span class="nv-sync-actions"><a class="internal-link" data-href="${this.target.replace(/"/g, '&quot;')}" href="#">Edit the original</a><button type="button" class="nv-sync-unsync">Unsync here</button></span></span><span class="nv-embed-body markdown"></span>`;
      const body = box.querySelector('.nv-embed-body') as HTMLElement;
      (box.querySelector('.nv-sync-unsync') as HTMLButtonElement).addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void unsyncHere(view, e, path, this.heading);
      });
      void (async () => {
        const text = await syncedText(path, this.heading);
        // Unreadable is said in the box, never an empty box (9.2 uplift F90).
        if (text === null) {
          body.innerHTML = '<span class="nv-embed-missing">Couldn’t load this note.</span>';
          view.requestMeasure();
          return;
        }
        body.innerHTML = renderMarkdown(text, { from: path });
        await hydrate(body, 1);
        view.requestMeasure();
      })();
      return box;
    }
    box.innerHTML = `<span class="nv-embed-head"><a class="internal-link" data-href="${(this.target + (this.heading ? `#${this.heading}` : '')).replace(/"/g, '&quot;')}" href="#">${title.replace(/</g, '&lt;')}</a></span><span class="nv-embed-body markdown"></span>`;
    const body = box.querySelector('.nv-embed-body') as HTMLElement;
    void (async () => {
      const raw = docs.text(path) ?? (await window.nv.notes.read(path).catch(() => null));
      if (raw === null) {
        body.innerHTML = '<span class="nv-embed-missing">Couldn’t load this note.</span>';
        view.requestMeasure();
        return;
      }
      const text = this.heading ? (sectionOf(raw, this.heading) ?? '') : stripRepeatHeading(raw, (path.split('/').pop() ?? path).replace(/\.md$/i, ''));
      body.innerHTML = renderMarkdown(text, { from: path });
      await hydrate(body, 1);
      view.requestMeasure();
    })();
    return box;
  }
  ignoreEvent(event: Event) {
    // A view's buttons and links are its own; in a note, links open and clicks elsewhere place the cursor. The
    // synced block's own button is its own too.
    if ((event.target as HTMLElement).closest?.('.nv-view-embed')) return true;
    if ((event.target as HTMLElement).closest?.('.nv-sync-unsync')) return true;
    return event.type === 'mousedown' && !!(event.target as HTMLElement).closest('a');
  }
  destroy(dom: HTMLElement) {
    unmounted.add(dom);
    unmountViews.get(dom)?.();
    unmountViews.delete(dom);
  }
}

/** A synced block's words as shown: the block's note (open tabs first, so nothing unsaved is missed). Null when
 *  the note can't be read — never silent emptiness (9.2 uplift F90). */
async function syncedText(path: string, heading: string): Promise<string | null> {
  const raw = docs.text(path) ?? (await window.nv.notes.read(path).catch(() => null));
  if (raw === null) return null;
  return heading ? (sectionOf(raw, heading) ?? '') : stripRepeatHeading(raw, (path.split('/').pop() ?? path).replace(/\.md$/i, ''));
}

/**
 * "Unsync here": the embed under the click put back as the block's words, the block's own note untouched. The line is
 * checked to still be that block's embed before anything is replaced.
 */
async function unsyncHere(view: EditorView, e: MouseEvent, path: string, heading: string): Promise<void> {
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos === null) return;
  const line = view.state.doc.lineAt(pos);
  const m = /^!\[\[([^[\]\n]+)\]\]$/.exec(line.text.trim());
  const inner = m?.[1].split('|')[0].split('#')[0].trim() ?? '';
  const title = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
  if (!m || (normalizeTarget(inner) !== normalizeTarget(path) && inner.toLowerCase() !== title.toLowerCase())) return;
  const raw = await syncedText(path, heading);
  if (raw === null) {
    toast('Couldn’t load the block’s note.');
    return;
  }
  const words = raw.replace(/\s+$/, '');
  view.dispatch({ changes: { from: line.from, to: line.to, insert: words }, selection: { anchor: line.from + words.length }, userEvent: 'input' });
  view.focus();
}

/** Views drawn into embed boxes, and boxes already taken away (a view still loading never draws into one). */
const unmountViews = new WeakMap<HTMLElement, () => void>();
const unmounted = new WeakSet<HTMLElement>();

/** A table drawn as a table; clicking a cell puts the cursor in that cell's Markdown. */
export class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly from: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source && other.from === this.from;
  }
  get estimatedHeight() {
    return this.source.split('\n').length * 34;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-nv-table';
    const rows = this.source.split('\n').filter((l) => l.trim());
    // A block id written alone under the table (" ^id", V12, 28 Oct 2026) names the table; it is not a row.
    while (rows.length > 2 && /^\s*\^[A-Za-z0-9][A-Za-z0-9-]{0,63}\s*$/.test(rows[rows.length - 1])) rows.pop();
    const cells = (line: string) => {
      let l = line.trim();
      if (l.startsWith('|')) l = l.slice(1);
      if (l.endsWith('|') && !l.endsWith('\\|')) l = l.slice(0, -1);
      return l.split(/(?<!\\)\|/).map((c) => c.trim());
    };
    const align = rows[1] ? cells(rows[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : '')) : [];
    let html = '<table><thead><tr>';
    cells(rows[0] ?? '').forEach((c, col) => {
      html += `<th data-row="0" data-col="${col}"${align[col] ? ` style="text-align:${align[col]}"` : ''}>${renderInline(c, { from: this.from })}</th>`;
    });
    html += '</tr></thead><tbody>';
    rows.slice(2).forEach((row, r) => {
      html += '<tr>';
      cells(row).forEach((c, col) => {
        html += `<td data-row="${r + 2}" data-col="${col}"${align[col] ? ` style="text-align:${align[col]}"` : ''}>${renderInline(c, { from: this.from })}</td>`;
      });
      html += '</tr>';
    });
    wrap.innerHTML = `${html}</tbody></table>`;
    return wrap;
  }
  ignoreEvent(event: Event) {
    return event.type === 'mousedown' && !!(event.target as HTMLElement).closest('a');
  }
}

export class MermaidWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: MermaidWidget) {
    return other.source === this.source;
  }
  get estimatedHeight() {
    return 240;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('div');
    box.className = 'cm-nv-mermaid';
    box.textContent = 'Drawing the diagram…';
    void drawMermaid(this.source).then(({ svg, error }) => {
      if (svg) box.innerHTML = svg;
      else box.innerHTML = drawErrorHtml('diagram', error);
      view.requestMeasure();
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

/** A chart block (src/shared/chart-kit.ts), worked out from the notes it names and drawn with ECharts (lib/charts.ts). */
export class ChartWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: ChartWidget) {
    return other.source === this.source;
  }
  get estimatedHeight() {
    return 280;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('div');
    box.className = 'cm-nv-mermaid cm-nv-chart';
    box.textContent = 'Working out the chart…';
    void import('../lib/charts').then((m) => m.fillChart(box, this.source)).then(() => view.requestMeasure());
    return box;
  }
  // The box is refilled, never rebuilt, while its chart is edited (5 Nov 2026): an ECharts drawing is released
  // before a new one, so typing in a chart block neither leaks a drawing a keystroke nor flashes.
  updateDOM(dom: HTMLElement, view: EditorView) {
    void import('../lib/charts').then((m) => m.fillChart(dom, this.source)).then(() => view.requestMeasure());
    return true;
  }
  destroy(dom: HTMLElement) {
    void import('../lib/charts').then((m) => m.releaseChart(dom));
  }
  ignoreEvent() {
    return false;
  }
}

/** Hides a block (the properties, shown above the note instead, or the former host app's markers) without leaving a
gap. */
export class HiddenBlockWidget extends WidgetType {
  constructor(readonly key: string) {
    super();
  }
  eq(other: HiddenBlockWidget) {
    return other.key === this.key;
  }
  get estimatedHeight() {
    return 0;
  }
  toDOM() {
    const div = document.createElement('div');
    div.className = 'cm-nv-hidden-block';
    return div;
  }
}

/** Page columns' dividers (8.8 round 2): each marker hidden behind a slim labelled divider ("Column 1 of 2"), the
 *  file keeping its markers. The first divider carries the quiet handle: add, remove or undo the columns. */
export class ColumnDividerWidget extends WidgetType {
  constructor(readonly label: string, readonly actions: boolean, readonly count: number) {
    super();
  }
  eq(other: ColumnDividerWidget) {
    return other.label === this.label && other.actions === this.actions && other.count === this.count;
  }
  get estimatedHeight() {
    return 28;
  }
  toDOM(view: EditorView) {
    const row = document.createElement('div');
    row.className = `cm-nv-column-divider${this.actions ? ' has-actions' : ''}`;
    const words = document.createElement('span');
    words.className = 'cm-nv-column-label';
    words.textContent = this.label;
    row.appendChild(words);
    if (this.actions) {
      const bar = document.createElement('span');
      bar.className = 'cm-nv-column-tools';
      const mk = (label: string, title: string, disabled: boolean, fn: (at: number | null) => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cm-nv-column-tool';
        b.textContent = label;
        b.title = title;
        b.disabled = disabled;
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          fn(view.posAtCoords({ x: e.clientX, y: e.clientY }));
        });
        return b;
      };
      // Each button finds its block from the click, so the cursor never needs to be in the markers.
      bar.append(
        mk('Add a column', this.count >= 4 ? 'Four columns is the most' : 'Add an empty column at the end', this.count >= 4, (at) => void import('./columns').then((m) => m.addColumnAt(view, at))),
        mk('Remove', this.count <= 2 ? 'Two columns is the fewest; undo the columns instead' : 'Take away the last column', this.count <= 2, (at) => void import('./columns').then((m) => m.removeColumnAt(view, at))),
        mk('Undo columns', 'Lay the columns out as plain words again', false, (at) => void import('./columns').then((m) => m.unlayColumnsAt(view, at))),
      );
      row.appendChild(bar);
    }
    return row;
  }
  ignoreEvent() {
    return true;
  }
}
