// A template variable as a friendly chip (8.6: {{date}}-style placeholders showed raw in the Templates legend and
// Settings). The chip shows the name without its braces; hovering says the full {{name}} to type, so nothing to
// learn is lost. VarWords draws help words with any {{variable}} in them as words with chips.

import { splitVarWords, varInner } from '../../../shared/template-vars';

export function VarChip({ name }: { name: string }) {
  return (
    <code className="tpl-var" title={`Type ${name} in a template`}>
      {varInner(name)}
    </code>
  );
}

export function VarWords({ text }: { text: string }) {
  return (
    <>
      {splitVarWords(text).map((p, i) => ('name' in p ? <VarChip key={i} name={p.name} /> : <span key={i}>{p.words}</span>))}
    </>
  );
}
