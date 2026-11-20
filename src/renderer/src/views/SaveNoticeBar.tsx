// The bar at the top of a note whose save couldn't land as usual (Nov 2026, nv-save: Ironleaf never loses an edit):
// changed elsewhere (both copies kept: this one and the conflict copy beside it), or moved or deleted elsewhere (these
// words still here, nothing recreated). One look with the suggestion bar above it; canvas tabs say it in a message.

import { Icon } from '../components/Icon';
import { openPath } from '../state/actions';
import { docs, useDocNotice } from '../state/docs';
import { setWorkspace } from '../state/layout';
import * as W from '../state/workspace';

export function SaveNoticeBar({ path, tabId }: { path: string; tabId: string }) {
  const notice = useDocNotice(path);
  if (!notice) return null;
  if (notice.kind === 'conflict') {
    const copy = notice.copy.split('/').pop() ?? notice.copy;
    return (
      <div className="suggestion-bar" role="alert">
        <Icon name="warning" size={14} />
        <span className="suggestion-bar-words" title={notice.copy}>
          This note changed elsewhere. Both copies are kept.<span className="suggestion-bar-stale"> Yours is in “{copy}”.</span>
        </span>
        <button className="suggestion-bar-button" title="Open your copy beside this note to compare" onClick={() => openPath(notice.copy, { where: 'right' })}>
          Show both
        </button>
        <button className="suggestion-bar-button primary" title="Save your words over the other change" onClick={() => void docs.resolveConflict(path, 'mine')}>
          Keep mine
        </button>
        <button className="suggestion-bar-button" title="Take the other change; your copy stays beside the note" onClick={() => void docs.resolveConflict(path, 'theirs')}>
          Use theirs
        </button>
      </div>
    );
  }
  return (
    <div className="suggestion-bar" role="alert">
      <Icon name="warning" size={14} />
      <span className="suggestion-bar-words">This note was moved or deleted elsewhere. Your words are still here.</span>
      <button className="suggestion-bar-button primary" title="Write these words back where the note was" onClick={() => void docs.bringBack(path)}>
        Bring back
      </button>
      <button className="suggestion-bar-button" title="Drop these words and close the tab (a copy stays in File recovery)" onClick={() => {
        docs.forget(path);
        setWorkspace((ws) => W.closeTab(ws, tabId));
      }}>
        Discard
      </button>
    </div>
  );
}
