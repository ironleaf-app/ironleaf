// What a template can say (8.7 wave 2 round 2, the plan: the legend moved off the Templates page into the
// template editor, where it is used): shown under the last line of a note in the Templates folder, so the variables
// are where they are typed. Anything the template itself wrote goes through VarWords, so a {{placeholder}} shows as a
// friendly chip, never raw braces.

import { TEMPLATE_VARIABLES } from '../../../shared/dates';
import { Icon } from './Icon';
import { VarChip, VarWords } from './TemplateVar';

export function TemplateLegend() {
  return (
    <section className="tp-how" aria-label="What a template can say">
      <h3>
        <Icon name="help" size={14} /> In a template
      </h3>
      <ul>
        {TEMPLATE_VARIABLES.map((v) => (
          <li key={v.name}>
            <VarChip name={v.name} />
            <span><VarWords text={v.words} /></span>
          </li>
        ))}
        <li>
          <code>description:</code>
          <span>a property saying what it’s for (shown on the Templates page, never copied into a note)</span>
        </li>
      </ul>
    </section>
  );
}
