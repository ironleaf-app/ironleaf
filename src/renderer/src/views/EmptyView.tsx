// What an empty tab shows (16 Oct 2026): Today, the one morning place (5 Nov 2026, Home folded into Today),
// or, when Settings › Appearance › Interface says "Nothing", a quiet page with the two keys people need.

import { EmptyState } from '../components/EmptyState';
import { formatHotkey } from '../lib/hotkeys';
import { newNoteOfType } from '../state/noteTypes';
import { setWorkspace } from '../state/layout';
import { openModal } from '../state/modals';
import { useApp, usePrefs } from '../state/store';
import { closeTab } from '../state/workspace';
import type { TabState } from '../state/workspace';
import { TodayView } from './TodayView';

export function EmptyView({ tab, closable }: { tab: TabState; closable: boolean }) {
  const prefsNow = usePrefs();
  const canEdit = useApp((s) => s.canEdit);
  if (prefsNow.home) return <TodayView tab={tab} />;
  return (
    <div className="home-view quiet">
      <EmptyState
        icon="file"
        title="Nothing open"
        line={
          <>
            Ask or find anything with <kbd>{formatHotkey('Mod+K')}</kbd>
            {canEdit ? (
              <>
                , or start one with <kbd>{formatHotkey('Mod+N')}</kbd>
              </>
            ) : null}
            .
          </>
        }
        action={{ label: 'Ask or find anything', icon: 'search', run: () => openModal({ kind: 'palette' }) }}
        also={canEdit ? { label: 'New note', icon: 'filePlus', run: () => void newNoteOfType() } : undefined}
      >
        {closable && (
          <button className="text-button home-close" onClick={() => setWorkspace((ws) => closeTab(ws, tab.id))}>
            Close this tab <kbd>{formatHotkey('Mod+W')}</kbd>
          </button>
        )}
      </EmptyState>
    </div>
  );
}
