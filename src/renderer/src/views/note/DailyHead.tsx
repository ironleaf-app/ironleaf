// A daily note's head (8.7 w2b, 30 Oct 2026): the mock-up's daily shape. An eyebrow, the day in words (not its ISO
// file name), and one line on where filings with no project land, with the way to change it. The file name stays the
// ISO day, so the note keeps its place.

import { dailyPageTitle } from '../../../../shared/notes-list';
import { openModal } from '../../state/modals';
import { usePrefs } from '../../state/store';

export function DailyHead({ title }: { title: string }) {
  const prefs = usePrefs();
  const words = dailyPageTitle(title);
  if (!words) return null;
  const toInbox = prefs.captureNoProject === 'inbox';
  return (
    <div className="w2b-daily">
      <div className="eyebrow w2b-eyebrow">Daily note</div>
      <h1 className="vtitle">{words}</h1>
      <p className="vsub">
        {toInbox ? 'Anything filed here without a project lands in your Inbox instead.' : 'Anything with no project lands here.'}{' '}
        <span className="w2b-keep">
          Your choice, kept.{' '}
          <button type="button" className="btn quiet w2b-inline" onClick={() => openModal({ kind: 'settings', section: 'capture' })}>
            Change
          </button>
        </span>
      </p>
    </div>
  );
}
