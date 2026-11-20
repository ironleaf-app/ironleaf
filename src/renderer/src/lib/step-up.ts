// A fresh check for the truly sensitive kinds (8.2): when the main side says a step-up is needed, ask Windows Hello
// where this PC can, else the recovery password, then try the action once more. A step-up lasts 5 minutes in the main side.

import { prompt } from '../components/Dialogs';

/** A step-up refusal (9.2 uplift F147): the bridge's machine flag, never the sentence's words. */
export const isStepUpNeeded = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { needStepUp?: boolean }).needStepUp === true;

/** Runs `fn`; on a step-up refusal, confirms it is the person and runs it once more. */
export async function withStepUp<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isStepUpNeeded(err)) throw err;
    const status = await window.nv.private.status().catch(() => null);
    if (status?.hello && status.thisPc) {
      await window.nv.private.stepUpWithHello();
    } else {
      const password = await prompt('Confirm it is you', { message: 'This is one of the truly sensitive kinds. Type your recovery password to go on.', placeholder: 'Your recovery password', ok: 'Confirm', password: true });
      if (!password) throw new Error('Cancelled.');
      await window.nv.private.stepUpWithPassword(password);
    }
    return fn();
  }
}
