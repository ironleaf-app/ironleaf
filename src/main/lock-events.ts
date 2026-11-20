// When Secrets and Private notes lock as the person leaves (8.2; changed 8.5, 30 Oct 2026): unlocking once means
// once, so Windows lock and sleep lock them only when the person turned that on in Settings (off by default).
// Signing out of Windows always locks: at 'shutdown' from the power events, and at the window's own 'session-end'
// (wired in app.ts), where the sealed remembered unlock is taken away so the next sign-in asks again. Minimise and
// losing focus never lock.

export interface LockEventSource {
  on(event: string, fn: () => void): unknown;
  off?(event: string, fn: () => void): unknown;
  removeListener?(event: string, fn: () => void): unknown;
}

function unwatch(source: LockEventSource, events: string[], fn: () => void): void {
  for (const event of events) {
    if (source.off) source.off(event, fn);
    else if (source.removeListener) source.removeListener(event, fn);
  }
}

/** Watches Windows lock and sleep; returns a stop function. `source` is a fake in tests. `shouldLock` is asked at
 *  each event (8.5): without it every lock and sleep locks (the 8.2 way); with it, only when it says so. */
export function watchLockEvents(source: LockEventSource, lock: () => void, shouldLock?: () => boolean): () => void {
  const onLock = () => {
    if (shouldLock && !shouldLock()) return;
    lock();
  };
  source.on('lock-screen', onLock);
  source.on('suspend', onLock);
  return () => unwatch(source, ['lock-screen', 'suspend'], onLock);
}

/** Watches the PC shutting down or the person signing out of Windows; returns a stop function. This one always
 *  locks (8.5): "until I sign out of Windows" is the default, so sign-out is where a remembered unlock ends. */
export function watchSignOutEvents(source: LockEventSource, lock: () => void): () => void {
  const onSignOut = () => lock();
  source.on('shutdown', onSignOut);
  return () => unwatch(source, ['shutdown'], onSignOut);
}
