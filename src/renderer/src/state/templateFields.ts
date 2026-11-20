// Template fields in the window (21 Oct 2026, gap G27; src/shared/template-fields.ts): before a note is made from a
// template (or a template is put into a note), its prompts are asked for in one small form, and its AI fields are
// written by the assistant when the person leaves "Fill in with the assistant" ticked. Then the cursor goes where the
// template's {{cursor}} was.

import { isPrivatePath } from '../../../shared/private';
import { templateFields, type TemplateAnswers } from '../../../shared/template-fields';
import { form } from '../components/Dialogs';
import { errorMessage } from '../lib/errors';
import { editorFor, getWorkspace } from './layout';
import { getState, toast } from './store';
import * as W from './workspace';

export interface AskContext {
  /** The template's file (the main side reads it again: only a template can ask the assistant). */
  template: string;
  /** The template's name, for the form's title. */
  name: string;
  /** The note's name. */
  title: string;
  /** The project's file it is made for, when it is. */
  project?: string;
  /** The note it goes into (inserting into one), so a private note's words never reach the assistant. */
  target?: string;
}

/** The answers for a template's fields: {} when it has none, null when the person cancelled. */
export async function askTemplateAnswers(text: string, ctx: AskContext): Promise<TemplateAnswers | null> {
  const fields = templateFields(text);
  if (!fields.prompts.length && !fields.ai.length) return {};
  const ai = getState().settings?.ai;
  const isPrivate = isPrivatePath(ctx.target);
  const canAsk = !!ai?.ready && !isPrivate;
  const n = fields.ai.length;
  const answer = await form(fields.prompts.length ? `New note from “${ctx.name}”` : `“${ctx.name}” has ${n === 1 ? 'a field' : 'fields'} for the assistant`, {
    message: fields.prompts.length ? 'Fill these in for the new note. Anything left empty stays empty.' : undefined,
    fields: fields.prompts.map((p, i) => ({ id: `p${i}`, label: p.label, value: p.fallback })),
    checks: n
      ? [
          {
            id: 'ai',
            label: `Fill in ${n === 1 ? `“${fields.ai[0]}”` : `${n} fields`} with the assistant`,
            hint: isPrivate
              ? ' Not for a private note: nothing in it goes to the assistant.'
              : !ai?.ready
                ? ` ${ai?.note ?? 'No model is set up yet.'}`
                : ` Written from the note’s name, its project and your answers, on ${ai.modelName ?? 'your AI connection'}.${n > 1 ? ` (${fields.ai.join('; ')})` : ''}`,
            value: canAsk,
          },
        ]
      : [],
    ok: 'Make it',
  });
  if (!answer) return null;
  const prompts: Record<string, string> = {};
  fields.prompts.forEach((p, i) => {
    const v = answer.values[`p${i}`] ?? '';
    if (v.trim()) prompts[p.label] = v.trim();
  });
  const out: TemplateAnswers = { prompts };
  if (n && answer.checks.ai && !isPrivate) {
    toast(`Asking the assistant for ${n === 1 ? `“${fields.ai[0]}”` : `${n} fields`}…`, undefined, 60_000);
    try {
      const r = await window.nv.templates.aiFields(ctx.template, { title: ctx.title, ...(ctx.project ? { project: ctx.project } : {}), answers: prompts, ...(ctx.target ? { target: ctx.target } : {}) });
      out.ai = r.fields;
      toast(r.error ? `${errorMessage(r.error)} The ${n === 1 ? 'field is' : 'fields are'} left empty to fill in yourself.` : `The assistant filled in ${Object.keys(r.fields).length === 1 ? 'a field' : `${Object.keys(r.fields).length} fields`}. Check ${Object.keys(r.fields).length === 1 ? 'it' : 'them'} over.`);
    } catch {
      toast(`The assistant couldn’t fill ${n === 1 ? 'it' : 'them'} in. Left empty to fill in yourself.`);
    }
  }
  return out;
}

/** The cursor put at a line and column of a note once its editor is open (a note just made from a template). */
export function placeCursorLater(path: string, at: { line: number; ch: number }): void {
  let tries = 0;
  const go = () => {
    const tab = W.activeTab(getWorkspace());
    const view = tab.path === path ? editorFor(tab.id)?.view() : null;
    if (!view) {
      if (++tries < 40) window.setTimeout(go, 50);
      return;
    }
    const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, at.line + 1)));
    const pos = Math.min(line.to, line.from + at.ch);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  };
  window.setTimeout(go, 60);
}
