// Help words with a {{variable}} in them (8.6: {{date}}-style placeholders showed raw in the Templates legend and
// Settings). The words split on each variable, whole, and the renderer draws each as a friendly chip
// (components/TemplateVar.tsx); the full {{name}} to type stays on hover.

export type VarPart = { words: string } | { name: string };

const VAR = /\{\{[^}]+\}\}/g;

/** Words split on each {{variable}}, offsets ({{date+2w}}), formats ({{date:dddd D MMMM}}) and prompts kept whole. */
export function splitVarWords(text: string): VarPart[] {
  const out: VarPart[] = [];
  let at = 0;
  for (const m of text.matchAll(VAR)) {
    if (m.index > at) out.push({ words: text.slice(at, m.index) });
    out.push({ name: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ words: text.slice(at) });
  return out.length ? out : [{ words: '' }];
}

/** A variable's name without its braces, for its chip ({{ date }} reads "date"). */
export function varInner(name: string): string {
  return name.replace(/^\{\{\s*|\s*\}\}$/g, '');
}
