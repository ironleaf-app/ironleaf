// View forms (31 Oct 2026, 8.8 database depth): a form made from a view's fields — one per database — opened from
// the view's ⋯ or a link inside the vault; each submission is a new record. Local only: no public web form. The form
// asks for a name and the view's properties (never what is worked out); what the person chose about it — a heading,
// hidden and required fields — is kept in the view's file (FormDef in views.ts). Round 2: each field asked the right
// way (numbers, dates, yes or no, relations, choices, text). Pure: fields, choices, answers and links here; the
// dialog in views/saved/FormDialog.tsx makes the record.

import type { PropKind, PropValue } from './frontmatter';
import { cellValue, FIELDS, isFormulaKey, isRollupKey, propWords, type ViewDef } from './views';

/** A link to a view's form: the view's path with #form (a [[link]] or a Markdown link to the view file). */
export function formRefFor(viewPath: string): string {
  return `[[${viewPath}#form]]`;
}

/** A link's view when it opens a form (`Views/Bakes.view.json#form`), or null for any other link. */
export function splitFormLink(target: string): string | null {
  const hash = target.lastIndexOf('#');
  if (hash < 0) return null;
  const fragment = target.slice(hash + 1).replace(/^\^/, '').trim().toLowerCase();
  const path = target.slice(0, hash).trim();
  return fragment === 'form' && path ? path : null;
}

/** The columns a form asks for: the view's properties, hidden ones and worked-out ones left out. */
export function formKeys(def: ViewDef): string[] {
  const hidden = new Set((def.form?.hidden ?? []).map((h) => h.toLowerCase()));
  return def.columns.filter((c) => !hidden.has(c.toLowerCase()) && !FIELDS.includes(c as (typeof FIELDS)[number]) && !isFormulaKey(c) && !isRollupKey(c));
}

export interface FormField {
  key: string;
  kind: PropKind;
  required: boolean;
  label?: string;
}

/** Answers as a record's values: empties left out (a deliberate No kept), each by its kind. Relations arrive as
 *  their picked links (round 2: a multi-pick with search and create, like the relation chips). */
export function formValues(fields: readonly FormField[], answers: Record<string, string | boolean | string[]>): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const f of fields) {
    const answer = answers[f.key];
    if (f.kind === 'checkbox') {
      if (answer === true) out[f.key] = true;
      else if (answer === false) out[f.key] = false;
      continue;
    }
    if (Array.isArray(answer)) {
      const list = answer.map((s) => s.trim()).filter(Boolean);
      if (list.length) out[f.key] = list;
      continue;
    }
    if (typeof answer !== 'string') continue;
    const value = cellValue(answer, f.kind);
    if (value !== null) out[f.key] = value;
  }
  return out;
}

/** What is missing, in plain words (the name always, then each required field left empty). */
export function validateForm(name: string, fields: readonly FormField[], answers: Record<string, string | boolean | string[]>): string[] {
  const problems: string[] = [];
  if (!name.trim()) problems.push('Give it a name.');
  for (const f of fields) {
    if (!f.required) continue;
    const answer = answers[f.key];
    const empty = f.kind === 'checkbox' ? answer === undefined : Array.isArray(answer) ? !answer.length : typeof answer !== 'string' || !answer.trim();
    if (empty) problems.push(`Say what ${f.label ?? propWords(f.key)} is.`);
  }
  return problems;
}

/** How a field is asked: a relation's multi-pick, a switch, a date picker, a number box, a choice, or typed words. */
export type FormInput = 'relation' | 'checkbox' | 'date' | 'number' | 'choice' | 'text';

/** Each field asked the right way (round 2): only a text field with a few short values becomes a choice. */
export function fieldInput(kind: PropKind, isRelation: boolean, hasOptions: boolean): FormInput {
  if (isRelation) return 'relation';
  if (kind === 'checkbox') return 'checkbox';
  if (kind === 'date' || kind === 'datetime') return 'date';
  if (kind === 'number') return 'number';
  if (hasOptions && kind === 'text') return 'choice';
  return 'text';
}

/**
 * A field's values as a choice (a dropdown): a few short values, most used first; undefined when there are too many
 * or they run long, or when the field is not typed words (round 2: numbers and dates never become a dropdown),
 * and the field stays typed.
 */
export function fieldOptions(values: readonly string[], kind?: PropKind): string[] | undefined {
  if (kind && kind !== 'text') return undefined;
  const distinct = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (!distinct.length || distinct.length > 12 || distinct.some((v) => v.length > 40)) return undefined;
  return distinct;
}
