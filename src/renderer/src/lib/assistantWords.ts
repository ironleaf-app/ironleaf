// The assistant in plain words (9.2 uplift F13, F15, F16): one name for it ("the assistant", never the engine),
// one sentence when it isn't ready, one renderer for the task lines that come from the other app, and agent names
// with the engine suffix off. Pure, so tests pin it directly.

import type { ModelsView } from '../../../shared/types';

/** Why asking is unavailable: the deed, first (the model connects in the other app, Settings › Models). */
export const NOT_READY_WORDS = 'Add an AI connection in Settings › AI first.';

/** The default model choice, in plain words (9.5 polished: the side chat's menu and the Ask bar's title share it,
 *  never the engine's name for it). */
export const DEFAULT_MODEL_WORDS = 'Recommended';

/** The model answering, in plain words (9.5 polished): checking while the roster loads, the plain default while
 *  nothing is chosen, "no model yet" only when none is set up anywhere, else the roster's own name. */
export function chatModelWords(view: ModelsView | null): string {
  if (!view) return 'Checking…';
  if (!view.effective) return view.connections.length ? DEFAULT_MODEL_WORDS : 'No model yet';
  const conn = view.connections.find((c) => c.id === view.effective!.provider);
  return conn?.models.find((m) => m.id === view.effective!.model)?.name ?? view.effective.model;
}

/** A task line from the other app: what it is and its standing, never the engine's name. */
export function activityWords(status?: string): string {
  return status ? `Task · ${status}` : 'Task';
}

