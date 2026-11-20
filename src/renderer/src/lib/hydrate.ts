// What a rendered page needs once it is on screen: embedded notes filled in, Mermaid diagrams drawn, code coloured.

import { LanguageDescription } from '@codemirror/language';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { docs } from '../state/docs';
import { stripRepeatHeading } from '../../../shared/notes-list';
import { renderMarkdown, sectionOf } from './markdownRender';
import { resolveNote } from './resolve';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let languagesPromise: Promise<readonly LanguageDescription[]> | null = null;
const languages = () => (languagesPromise ??= import('@codemirror/language-data').then((m) => m.languages));

/** Code in a known language, as coloured HTML (null when the language isn't known). */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  const desc = LanguageDescription.matchLanguageName(await languages(), lang, true);
  if (!desc) return null;
  const support = await desc.load();
  const tree = support.language.parser.parse(code);
  let html = '';
  let at = 0;
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    if (from > at) html += esc(code.slice(at, from));
    html += `<span class="${classes}">${esc(code.slice(from, to))}</span>`;
    at = to;
  });
  return html + esc(code.slice(at));
}

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
let mermaidTheme = '';
let mermaidCount = 0;

// Diagrams in the app's own colours, light or dark, and its accent (26 Oct 2026 audit: Mermaid ignored the palette and drew
// black on black in dark mode). Read from the page's colour tokens each time they change.
function diagramColours(): Record<string, string> & { key: string } {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.dataset.theme === 'dark';
  const text = v('--text', dark ? '#ececec' : '#1f1e1d');
  const bg = v('--bg', dark ? '#1c1c1c' : '#ffffff');
  const surface = v('--surface', dark ? '#262626' : '#f7f6f3');
  const border = v('--border', dark ? '#3a3a3a' : '#e3e1db');
  const accent = v('--accent', '#357553');
  const muted = v('--muted', dark ? '#a3a3a3' : '#6b6a66');
  // Bars, lines and slices in strong colours (the accent first), never the pale surface tone.
  const series = [accent, '#2f6fed', '#0f9e94', '#d9a400', '#8b4ee6', '#e0457f', '#4f5b66', '#22a35a'];
  const pies = Object.fromEntries(series.map((c, i) => [`pie${i + 1}`, c]));
  const vars = { ...pies, pieStrokeColor: bg, pieOuterStrokeColor: border, pieTitleTextColor: text, pieSectionTextColor: '#ffffff', pieLegendTextColor: text, darkMode: dark ? 'true' : 'false', background: bg, primaryColor: surface, primaryBorderColor: accent, primaryTextColor: text, secondaryColor: bg, tertiaryColor: surface, lineColor: muted, textColor: text, mainBkg: surface, nodeBorder: accent, clusterBkg: bg, clusterBorder: border, edgeLabelBackground: bg, titleColor: text, noteBkgColor: surface, noteTextColor: text, noteBorderColor: border, actorBkg: surface, actorBorder: accent, actorTextColor: text, signalColor: muted, signalTextColor: text };
  return { ...vars, key: JSON.stringify(vars) };
}

async function mermaid() {
  const { key, ...themeVariables } = diagramColours();
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  const lib = await mermaidPromise;
  if (mermaidTheme !== key) {
    const series = [themeVariables.pie1, themeVariables.pie2, themeVariables.pie3, themeVariables.pie4, themeVariables.pie5].join(',');
    lib.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: { ...themeVariables, darkMode: themeVariables.darkMode === 'true', xyChart: { plotColorPalette: series, backgroundColor: themeVariables.background, titleColor: themeVariables.textColor, xAxisLabelColor: themeVariables.textColor, yAxisLabelColor: themeVariables.textColor, xAxisTitleColor: themeVariables.textColor, yAxisTitleColor: themeVariables.textColor, xAxisLineColor: themeVariables.lineColor, yAxisLineColor: themeVariables.lineColor, xAxisTickColor: themeVariables.lineColor, yAxisTickColor: themeVariables.lineColor } }, fontFamily: 'Inter, Segoe UI, sans-serif' } as Parameters<typeof lib.initialize>[0]);
    mermaidTheme = key;
  }
  return lib;
}

/** A diagram or chart that wouldn't draw (9.2 uplift F150): plain words in the page, the technical detail to
 *  the console. One helper for live preview, charts and the reading view. */
export function drawErrorHtml(what: string, error: unknown): string {
  if (error) console.warn(`Ironleaf could not draw ${what}:`, error);
  return `<div class="nv-render-error">This ${what} wouldn’t draw. Check its lines and try again.</div>`;
}

/** A Mermaid diagram as SVG (or the reason it couldn't be drawn). */
export async function drawMermaid(source: string): Promise<{ svg?: string; error?: string }> {
  try {
    const lib = await mermaid();
    const { svg } = await lib.render(`nv-mermaid-${++mermaidCount}`, source);
    return { svg };
  } catch (err) {
    document.querySelectorAll('[id^="dnv-mermaid-"]').forEach((el) => el.remove());
    return { error: err instanceof Error ? err.message.split('\n')[0] : 'The diagram could not be drawn.' };
  }
}

async function noteText(path: string): Promise<string> {
  return docs.text(path) ?? (await window.nv.notes.read(path));
}

/** Fills a rendered page in: embedded notes (to three deep), diagrams and coloured code. */
export async function hydrate(root: HTMLElement, depth = 0): Promise<void> {
  const jobs: Promise<void>[] = [];
  root.querySelectorAll<HTMLElement>('.nv-embed-note:not([data-filled])').forEach((el) => {
    el.dataset.filled = '1';
    jobs.push(
      (async () => {
        const target = el.dataset.target ?? '';
        const heading = el.dataset.heading ?? '';
        const from = el.dataset.from || undefined;
        const path = resolveNote(target, from);
        if (!path) {
          el.innerHTML = `<span class="nv-embed-missing">“${esc(target)}” isn’t written yet.</span>`;
          return;
        }
        if (depth >= 3 || path === from) {
          el.innerHTML = `<a class="internal-link" data-href="${esc(target)}" href="#">${esc(target)}</a>`;
          return;
        }
        let text = await noteText(path).catch(() => '');
        if (heading) text = sectionOf(text, heading) ?? '';
        else text = stripRepeatHeading(text, (path.split('/').pop() ?? path).replace(/\.md$/i, ''));
        const title = target.split('/').pop() + (heading ? ` › ${heading.replace(/^\^/, '')}` : '');
        el.innerHTML = `<span class="nv-embed-head"><a class="internal-link" data-href="${esc(target + (heading ? `#${heading}` : ''))}" href="#">${esc(title)}</a></span><span class="nv-embed-body markdown">${renderMarkdown(text, { from: path })}</span>`;
        await hydrate(el, depth + 1);
      })(),
    );
  });
  // Views over notes (21 Oct 2026): drawn by React into their place, read-only (views/saved/ViewEmbed.tsx).
  const views = root.querySelectorAll<HTMLElement>('.nv-embed-view:not([data-filled])');
  if (views.length)
    jobs.push(
      import('../views/saved/ViewEmbed').then((m) =>
        views.forEach((el) => {
          el.dataset.filled = '1';
          m.mountViewEmbed(el, el.dataset.path ?? '', el.dataset.part ?? '');
        }),
      ),
    );
  // Chart blocks (8.0 Phase 5): worked out from the notes as they are now, then drawn as a diagram.
  root.querySelectorAll<HTMLElement>('.nv-chart:not([data-drawn])').forEach((el) => {
    el.dataset.drawn = '1';
    el.textContent = 'Working out the chart…';
    jobs.push(import('./charts').then((m) => m.fillChart(el, el.dataset.src ?? '')));
  });
  root.querySelectorAll<HTMLElement>('.nv-mermaid:not([data-drawn])').forEach((el) => {
    el.dataset.drawn = '1';
    jobs.push(
      (async () => {
        const { svg, error } = await drawMermaid(el.dataset.src ?? '');
        if (svg) el.innerHTML = svg;
        else el.innerHTML = `${drawErrorHtml('diagram', error)}<pre><code>${esc(el.dataset.src ?? '')}</code></pre>`;
      })(),
    );
  });
  root.querySelectorAll<HTMLElement>('pre[data-lang]:not([data-coloured]) > code').forEach((code) => {
    const pre = code.parentElement as HTMLElement;
    pre.dataset.coloured = '1';
    jobs.push(
      (async () => {
        const html = await highlightCode(code.textContent ?? '', pre.dataset.lang ?? '').catch(() => null);
        if (html !== null) code.innerHTML = html;
      })(),
    );
  });
  await Promise.all(jobs);
}
