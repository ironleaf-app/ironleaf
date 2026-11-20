// A brief line's action, wherever the brief shows (Home's brief card runs it; Today's own BriefCard went away
// with the 29 Oct 2026 redesign, and this runner is what is left of this file on purpose).

import type { BriefAction } from '../../../../shared/brief';
import { snoozeTimes } from '../../../../shared/reminders';
import type { IconName } from '../../components/Icon';
import { openMenu } from '../../components/Menu';
import * as A from '../../state/actions';
import { draftInChat } from '../../state/chat';
import { openModal } from '../../state/modals';
import { openMeetingNoteFor } from '../../state/noteTypes';
import { showError, toast } from '../../state/store';
import { revealItem } from '../timeline/reveal';

/** A brief line's action, wherever the brief shows (Today's BriefCard and Home's brief card run the same one). */
export function runBriefAction(a: BriefAction, anchor: HTMLElement, opts: { canEdit: boolean; reload(): void; tab?: boolean }): void {
  switch (a.kind) {
    case 'open':
      if (a.item) revealItem(a.path, a.item);
      A.openPath(a.path, { where: opts.tab ? 'tab' : 'current', ...(a.line !== undefined ? { line: a.line } : {}) });
      return;
    case 'meeting': {
      void openMeetingNoteFor(a.event, a.date);
      return;
    }
    case 'snooze':
      openMenu(anchor, [
        { heading: 'Snooze until' },
        ...snoozeTimes(Date.now()).map((t, i) => ({
          label: t.label,
          icon: 'clock' as IconName,
          disabled: !opts.canEdit,
          // Worked out when picked, not when the menu opened (fnv3 F43).
          run: () => {
            const fresh = snoozeTimes(Date.now())[i];
            void window.nv.reminders.snooze(a.key, fresh.at).then((words) => {
              toast(words || `Snoozed: ${fresh.label.toLowerCase()}.`);
              opts.reload();
            }, showError);
          },
        })),
      ]);
      return;
    case 'review':
      openModal({ kind: 'review-cards', path: a.path });
      return;
    case 'ask':
      draftInChat(a.words);
      return;
    case 'url':
      window.open(a.url, '_blank');
      return;
  }
}
