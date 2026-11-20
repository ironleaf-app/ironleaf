// Typing / at the start of a line (or after a space) offers what can go there: headings, lists, tick-boxes, a table, a
// callout, code, maths, a diagram, a rule, a footnote, a link, a template, today's date. Beside the highlighted choice, a
// small preview of what it puts in, drawn as the note will read, with its keys if it has any (19 Oct 2026, 5.0.0).
// Typing "> [!" (or choosing Callout) offers the callout kinds, each with its own preview.

import { startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { formatDate } from '../../../shared/dates';
import { CALLOUT_HINTS, CALLOUT_PICKS, CALLOUT_TYPES, calloutMarkdown } from '../lib/callouts';
import { renderMarkdown } from '../lib/markdownRender';
import { wordsMatch } from '../lib/fuzzy';
import { keysFor } from './keysFor';
import { insertReminder } from './reminders';
import { cycleTask, insertBlock, insertCodeBlock, insertDate, insertFootnote, insertMathBlock, insertRule, insertTable, insertText, setHeading, toggleBullet, toggleNumbered, toggleQuote } from './commands';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';

export interface SlashContext {
  dateFormat(): string;
  timeFormat(): string;
  insertTemplate(view: EditorView): void;
  linkToNote(view: EditorView): void;
}

interface SlashItem {
  label: string;
  detail: string;
  keywords: string;
  /** A little more than the detail, under the preview. */
  about?: string;
  /** What it puts in, as Markdown drawn in the preview (or a function, for today's date). */
  preview?: string | (() => string);
  /** A drawing of our own when Markdown can't show it (a diagram is drawn later, in the page). */
  previewHtml?: string;
  /** The command with the same job (state/commands.ts), for its keys. */
  command?: string;
  /** Opens a picker before putting anything in: the typed /query stays until the picker confirms (fnv3 F23). */
  picker?: boolean;
  run(view: EditorView): void;
}

/** The meeting-notes shape the / menu previews and inserts (F152's one text): bold leads in both. */
export const MEETING_NOTES_TEXT = '## Meeting notes\n\n**Who came:** \n\n**What was said:**\n\n## Actions\n\n- [ ] ';

/** The kinds of callout, offered once "> [!" is typed (Callout in this menu types it). */
function startCalloutPicker(view: EditorView): void {
  insertBlock(view, '> [!', 4);
  // After this menu has closed, the kinds open in its place.
  setTimeout(() => startCompletion(view), 0);
}

function items(ctx: SlashContext): SlashItem[] {
  return [
    { label: 'Heading 1', detail: 'Big section title', about: 'The biggest heading: the main parts of a note.', keywords: 'h1 title', preview: '# Big section title', command: 'heading-1', run: (v) => setHeading(v, 1) },
    { label: 'Heading 2', detail: 'Section title', about: 'A section within a part.', keywords: 'h2', preview: '## Section title', command: 'heading-2', run: (v) => setHeading(v, 2) },
    { label: 'Heading 3', detail: 'Small section title', about: 'A smaller step within a section.', keywords: 'h3', preview: '### Small section title', command: 'heading-3', run: (v) => setHeading(v, 3) },
    { label: 'Bulleted list', detail: 'A simple list', about: 'Things in no special order.', keywords: 'bullet ul list', preview: '- Flour\n- Butter\n- Sea salt', command: 'bullets', run: toggleBullet },
    { label: 'Numbered list', detail: 'A list with numbers', about: 'Steps that go in order.', keywords: 'ordered ol 1.', preview: '1. Mix\n2. Rest overnight\n3. Bake', command: 'numbers', run: toggleNumbered },
    { label: 'Tick-box', detail: 'Something to do', about: 'Tick it off when it is done.', keywords: 'task todo checkbox check', preview: '- [ ] Order flour\n- [x] Book the van', command: 'task', run: cycleTask },
    // Reminders (19 Oct 2026): the task with ⏰ for tomorrow at 9:00 am; its pill changes the day and time.
    { label: 'Reminder', detail: 'Remind me about this', about: 'A tick-box that reminds you: tomorrow at 9:00 am to start, click the time to change it.', keywords: 'remind reminder alarm alert due notify ⏰', preview: '- [ ] Order flour from Laucke ⏰ Tomorrow, 9:00 am', run: insertReminder },
    { label: 'Quote', detail: 'Quoted words', about: 'Someone’s words, set apart.', keywords: 'blockquote', preview: '> Bake it the day before.', command: 'quote', run: toggleQuote },
    { label: 'Callout', detail: 'A box that stands out', about: 'A tinted box with a title; choose its kind next.', keywords: 'note tip info warning danger success question admonition box', preview: calloutMarkdown('tip', 'Bake the day before', 'The crumb sets overnight.'), command: 'callout', run: startCalloutPicker },
    { label: 'Table', detail: 'Rows and columns', about: 'Tab moves between the cells.', keywords: 'grid', preview: '| Item | Qty |\n| --- | --- |\n| Flour | 2 kg |\n| Butter | 500 g |', command: 'table', run: (v) => insertTable(v) },
    { label: 'Code block', detail: 'Code, as written', about: 'Code kept exactly as written.', keywords: 'pre fence', preview: '```js\nconst total = 12 * 4;\n```', command: 'code-block', run: (v) => insertCodeBlock(v) },
    { label: 'Maths', detail: 'An equation (LaTeX)', about: 'Written in LaTeX, drawn as an equation.', keywords: 'math latex equation formula katex', preview: '$$a^2 + b^2 = c^2$$', command: 'math-block', run: insertMathBlock },
    {
      label: 'Diagram',
      detail: 'A flowchart or other Mermaid diagram',
      about: 'Written as Mermaid, drawn as a diagram.', keywords: 'mermaid flowchart graph sequence',
      previewHtml: '<div class="nv-slash-flow"><span>Start</span><i aria-hidden="true"></i><span>Finish</span></div>',
      run: (v) => insertBlock(v, '```mermaid\nflowchart LR\n  A[Start] --> B[Finish]\n```', 11),
    },
    // The one chart kit (8.0 Phase 5, src/shared/chart-kit.ts): a chart of the notes in a folder, live as they change.
    {
      label: 'Chart', picker: true,
      detail: 'Bars, a line or a pie from your notes',
      about: 'Choose the notes; it counts them or adds up a number, and stays up to date.', keywords: 'chart graph bar line pie dashboard sum count total',
      previewHtml: '<div class="nv-slash-chart" aria-hidden="true"><i style="height:40%"></i><i style="height:75%"></i><i style="height:55%"></i><i style="height:90%"></i></div>',
      run: (v) => void import('./insertChart').then((m) => m.insertChart(v)),
    },
    { label: 'Divider', detail: 'A line across the page', about: 'A quiet line between two parts.', keywords: 'hr rule separator line', preview: 'Above the line\n\n---\n\nBelow the line', command: 'divider', run: insertRule },
    { label: 'Footnote', detail: 'A note at the end', about: 'A number here, its note at the end.', keywords: 'reference', preview: 'Sold out by ten.[^1]\n\n[^1]: Saturday market, 12 Oct.', command: 'footnote', run: insertFootnote },
    { label: 'Link to a note', picker: true, detail: '[[ ]]', about: 'Choose a note to link to.', keywords: 'wikilink internal', preview: 'See [[Weekly plan]]', run: (v) => ctx.linkToNote(v) },
    {
      label: 'Synced block', picker: true,
      detail: 'The same words in several notes',
      about: 'Placed here and kept in one file; editing it anywhere changes it everywhere.',
      keywords: 'sync synced shared same everywhere block mirror',
      preview: '![[Synced blocks/Opening hours]]',
      command: 'synced-block',
      run: (v) => void import('./syncedBlocks').then((m) => m.insertSyncedBlock(v)),
    },
    {
      label: 'Columns', picker: true,
      detail: 'Blocks side by side',
      about: 'Two columns to start; other apps read the same words in a line.',
      keywords: 'columns column side by side layout two three four beside',
      preview: '<!-- columns:2 -->\nLeft\n\n<!-- column -->\n\nRight\n<!-- end columns -->',
      command: 'columns-2',
      run: (v) => void import('./columns').then((m) => m.layOutInColumns(v, 2)),
    },
    // The asset store (views/assets/insert.ts): a logo, photo, icon or document kept in Assets, with its alt text.
    // The one Assets entry (9.2 uplift F82): "File" did the identical insert, so it folded into here.
    { label: 'Picture from assets', picker: true, detail: 'A logo, photo or file you keep', about: 'A logo, photo or file you keep in Assets.', keywords: 'image picture logo asset photo file svg icon brand attachment document add', run: (v) => void import('../views/assets/insert').then((m) => m.insertFromAssets(v)) },
    { label: 'Template', picker: true, detail: 'Insert one of your templates', about: 'One of your note templates, filled in.', keywords: 'snippet', command: 'insert-template', run: (v) => ctx.insertTemplate(v) },
    // Meeting notes, a decision, a person and a file (8.0 section E): the shapes a busy person adds while writing.
    // The preview and the insert come from the one shape (9.2 uplift F152): what the preview shows is what goes in.
    {
      label: 'Meeting notes',
      detail: 'Who came, what was said, actions',
      about: 'A meeting note shape: who came, what was said, and the actions, each a task others can read.',
      keywords: 'meeting notes minutes who came actions agenda',
      preview: `${MEETING_NOTES_TEXT}First action`,
      run: (v) => {
        insertBlock(v, MEETING_NOTES_TEXT, MEETING_NOTES_TEXT.length);
      },
    },
    {
      label: 'Decision',
      detail: 'What was decided, and why',
      about: 'A decision written so it is found later: what was decided, and why.',
      keywords: 'decision decided choice agreed resolution',
      preview: '> [!success] Decision\n> What we decided, and why.',
      run: (v) => insertBlock(v, '> [!success] Decision\n> ', 22),
    },
    {
      label: 'Person',
      detail: 'Link a person, project or meeting',
      about: 'Type a name after the @; picking one puts its link in as a chip.',
      keywords: 'person mention project meeting @ link name',
      preview: '@Sam Okafor',
      run: (v) => {
        insertText(v, '@');
        setTimeout(() => startCompletion(v), 0);
      },
    },
    { label: "Today's date", detail: '', keywords: 'date day', preview: () => formatDate(ctx.dateFormat()), command: 'date', run: (v) => insertDate(v, ctx.dateFormat()) },
    { label: 'The time now', detail: '', keywords: 'time clock', preview: () => formatDate(ctx.timeFormat()), command: 'time', run: (v) => insertDate(v, ctx.timeFormat()) },
  ];
}

/** The panel beside a highlighted choice: a small drawing of what it puts in, what it is for, and its keys. */
function previewPanel(opts: { markdown?: string; html?: string; about: string; keys?: string; kind?: string }): HTMLElement {
  const box = document.createElement('div');
  box.className = 'nv-slash-info';
  if (opts.markdown || opts.html) {
    const preview = document.createElement('div');
    preview.className = 'nv-slash-preview markdown';
    // Drawn by our own renderer: raw HTML in the sample is never run (lib/markdownRender.ts).
    preview.innerHTML = opts.html ?? renderMarkdown(opts.markdown!);
    preview.setAttribute('aria-hidden', 'true');
    box.appendChild(preview);
  }
  const foot = document.createElement('div');
  foot.className = 'nv-slash-about';
  const about = document.createElement('span');
  about.textContent = opts.about;
  foot.appendChild(about);
  if (opts.keys) {
    const kbd = document.createElement('kbd');
    kbd.textContent = opts.keys;
    foot.appendChild(kbd);
  }
  box.appendChild(foot);
  return box;
}

export function slashCompletions(ctx: SlashContext) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/(?:^|\s)\/[\w ]*$/);
    if (!word) return null;
    const slash = word.from + word.text.indexOf('/');
    const line = context.state.doc.lineAt(slash);
    // Not inside code: the syntax tree knows, not a guess from this line's backticks (fnv3 F23).
    if (/^\s*(```|~~~)/.test(line.text) || (line.text.match(/`/g)?.length ?? 0) % 2 === 1) return null;
    for (let n = syntaxTree(context.state).resolveInner(slash, 1); n; n = n.parent!) if (/FencedCode|InlineCode|Code/.test(n.name)) return null;
    const query = context.state.sliceDoc(slash + 1, context.pos).toLowerCase();
    if (query.length > 24) return null;
    const options: Completion[] = items(ctx)
      .filter((i) => !query || wordsMatch(query, `${i.label} ${i.keywords}`))
      .map((i, n) => ({
        label: i.label,
        detail: i.detail,
        boost: 100 - n,
        type: 'nv-slash',
        info: () => {
          const sample = typeof i.preview === 'function' ? i.preview() : i.preview;
          return previewPanel({ markdown: sample, html: i.previewHtml, about: i.about ?? (i.detail || i.label), keys: i.command ? keysFor(i.command) : undefined });
        },
        apply: (view: EditorView, _c: Completion, from: number, to: number) => {
          // A picker item keeps the typed words, selected, until it confirms: cancelling loses nothing, and
          // the picker's insert replaces the selection (fnv3 F23). Everything else replaces them at once.
          if (i.picker) view.dispatch({ selection: EditorSelection.range(from - 1, to) });
          else view.dispatch({ changes: { from: from - 1, to, insert: '' } });
          i.run(view);
        },
      }));
    if (!options.length) return null;
    return { from: slash + 1, options, filter: false };
  };
}

/**
 * The callout kinds, once "> [!" is typed at a line's start (or Callout was chosen above): the seven most used, then the
 * rest under "More kinds". Choosing one finishes "[!tip] " with the cursor where its title goes; changing the kind of
 * an existing callout keeps its title.
 */
export function calloutCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/^\s{0,3}>\s?\[![\w-]*$/);
  if (!before) return null;
  const from = before.from + before.text.indexOf('[!') + 2;
  const typed = context.state.sliceDoc(from, context.pos).toLowerCase();
  const rest = context.state.sliceDoc(context.pos, context.state.doc.lineAt(context.pos).to);
  // "[!no|te] Title": the rest of the kind's name and its "]" are already there.
  const closed = /^[\w-]*\][+-]?/.exec(rest);
  const kinds = [...CALLOUT_PICKS, ...Object.keys(CALLOUT_TYPES).filter((k) => !(CALLOUT_PICKS as readonly string[]).includes(k))];
  const options: Completion[] = kinds
    .filter((k) => !typed || k.startsWith(typed) || CALLOUT_TYPES[k].label.toLowerCase().startsWith(typed) || CALLOUT_TYPES[k].aliases?.some((a) => a.startsWith(typed)))
    .map((k, n) => ({
      label: CALLOUT_TYPES[k].label,
      detail: CALLOUT_HINTS[k],
      boost: 100 - n,
      type: `nv-callout-kind`,
      section: (CALLOUT_PICKS as readonly string[]).includes(k) ? { name: 'Callout', rank: 0 } : { name: 'More kinds', rank: 1 },
      info: () => previewPanel({ markdown: calloutMarkdown(k, '', CALLOUT_HINTS[k] + '.'), about: `Written [!${k}]: a plain quote in other apps.` }),
      apply: (view: EditorView, _c: Completion, f: number, to: number) => {
        if (closed) {
          const sign = closed[0].replace(/^[\w-]*/, '');
          const nameEnd = to + closed[0].length - sign.length;
          view.dispatch({ changes: { from: f, to: nameEnd, insert: k }, selection: { anchor: f + k.length + sign.length }, userEvent: 'input.complete' });
          return;
        }
        const insert = `${k}] `;
        view.dispatch({ changes: { from: f, to, insert }, selection: { anchor: f + insert.length }, userEvent: 'input.complete' });
      },
    }));
  if (!options.length) return null;
  return { from, options, filter: false };
}
