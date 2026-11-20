// Settings › General › Tray and start-up (20 Nov 2026): whether closing the window keeps Ironleaf running in the
// tray (so reminders, AI access for other apps, sync and backup carry on), and whether it starts when you sign in.
// src/main/tray.ts keeps both; src/shared/tray-model.ts has the rules.

import { useEffect, useState } from 'react';
import { KEEP_IN_TRAY_WORDS, START_AT_LOGIN_WORDS, type TrayView } from '../../../shared/tray-model';
import { showError } from '../state/store';
import { Row, Toggle } from './Settings';

export function TraySettings() {
  const [view, setView] = useState<TrayView | null>(null);
  useEffect(() => {
    // Inside another window (no tray of its own) the block stays away.
    void window.nv.tray.state().then(setView).catch(() => {});
  }, []);
  if (!view) return null;
  const set = (patch: { keepInTray?: boolean; startAtLogin?: boolean }) => void window.nv.tray.set(patch).then(setView).catch(showError);
  return (
    <>
      <h3>Tray and start-up</h3>
      <Row
        title={KEEP_IN_TRAY_WORDS}
        hint={
          view.trayAvailable
            ? 'Reminders, AI access for other apps, sync and backup keep going. Click the tray icon to open Ironleaf; right-click it to quit.'
            : 'This desktop has no tray to show Ironleaf in, so closing the window quits it.'
        }
      >
        <Toggle label={KEEP_IN_TRAY_WORDS} value={view.keepInTray} onChange={(keepInTray) => set({ keepInTray })} />
      </Row>
      <Row title={START_AT_LOGIN_WORDS} hint={view.platform === 'win32' ? 'Ironleaf starts in the tray when you sign in to Windows.' : 'Ironleaf starts in the tray when you sign in.'}>
        <Toggle label={START_AT_LOGIN_WORDS} value={view.startAtLogin} onChange={(startAtLogin) => set({ startAtLogin })} />
      </Row>
    </>
  );
}
