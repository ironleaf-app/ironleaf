// An answer's words with each [n] drawn as a chip that opens its passage (the notebook's cited answers, and the chat's
// answers over ticked sources): only numbers the answer's own citations carry become chips.

import type { Citation } from '../../../shared/notebook';
import { whereWords } from '../../../shared/notebook';
import { renderMarkdown } from './markdownRender';

export function answerHtml(text: string, citations: Citation[]): string {
  const html = renderMarkdown(text);
  const by = new Map(citations.map((c) => [c.n, c]));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return html.replace(/(<[^>]+>)|\[(\d{1,3})\]/g, (m, tag: string | undefined, n: string | undefined) => {
    if (tag) return tag;
    const c = by.get(Number(n));
    if (!c) return m;
    const where = whereWords(c);
    return `<button type="button" class="nb-chip" data-cite="${c.n}" title="${esc(`${c.title}${where ? ` › ${where}` : ''}: “${c.quote}”`)}" aria-label="${esc(`Source ${c.n}: ${c.title}${where ? `, ${where}` : ''}`)}">${c.n}</button>`;
  });
}
