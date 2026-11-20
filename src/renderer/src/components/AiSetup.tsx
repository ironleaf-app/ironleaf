// The one calm place every AI entry point lands while no AI connection is set up (20 Nov 2026): "Add an AI
// connection", one line, and the button that opens Settings › AI. Never an error, never a dead button.

import { openModal } from '../state/modals';
import { getState, toast, useApp } from '../state/store';
import { Icon } from './Icon';

export const AI_SETUP_TITLE = 'Add an AI connection';
export const AI_SETUP_LINE = 'Use your own key (Anthropic, OpenAI, Google Gemini) or a model on this PC (Ollama or another local server). Nothing is sent until you add one.';

/** Settings › AI, opened. */
export const openAiSettings = (): void => openModal({ kind: 'settings', section: 'models' });

/** Why the assistant can't answer yet, or null when it can (the settings say: no connection, no model, or no key). */
export function useAiBlocked(): string | null {
  return useApp((s) => (s.settings && !s.settings.ai.ready ? (s.settings.ai.note ?? AI_SETUP_TITLE) : null));
}

/** The card: full in a panel, one line with its button where there is little room. */
export function AiSetup({ compact, why }: { compact?: boolean; why?: string | null }) {
  // A connection is there but its key or model is missing: the settings' own words say which.
  const own = why && !why.startsWith(AI_SETUP_TITLE) ? why : null;
  const line = own ?? AI_SETUP_LINE;
  if (compact)
    return (
      <p className="ai-setup is-compact" role="status">
        <span>{own ?? `${AI_SETUP_TITLE} to use this.`}</span>{' '}
        <button type="button" className="text-button" onClick={openAiSettings}>
          Open Settings › AI
        </button>
      </p>
    );
  return (
    <div className="ai-setup" role="status" aria-label={AI_SETUP_TITLE}>
      <span className="ai-setup-tile" aria-hidden="true">
        <Icon name="sparkle" size={18} />
      </span>
      <p className="ai-setup-title">{AI_SETUP_TITLE}</p>
      <p className="ai-setup-line">{line}</p>
      <button type="button" className="button primary" onClick={openAiSettings}>
        Open Settings › AI
      </button>
    </div>
  );
}

/** Before an action that needs the assistant (make the minutes, look over the review): true when it can answer;
 *  otherwise one calm line with the button to Settings › AI, and false. Never an error. */
export function aiReadyOrSay(): boolean {
  const ai = getState().settings?.ai;
  if (!ai || ai.ready) return true;
  const own = ai.note && !ai.note.startsWith(AI_SETUP_TITLE) ? ai.note : null;
  toast(own ?? `${AI_SETUP_TITLE} to use this.`, { label: 'Open Settings › AI', run: openAiSettings });
  return false;
}
