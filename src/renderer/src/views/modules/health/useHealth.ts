// The health store as the window reads it (Wave 5, 24 Oct 2026; src/main/modules.ts, src/shared/health.ts): read once,
// read again when anything changes it (an assistant's check-in, another part of the page), and each change shown at once
// from the store's answer. Errors are said in words (state/store showError), never thrown at the page.

import { useCallback, useEffect, useState } from 'react';
import type { HealthDb } from '../../../../../shared/health';
import type { HealthStoreStatus } from '../../../../../main/health-store';
import { errorMessage } from '../../../lib/errors';
import { useModuleTick } from '../../../state/modules';
import { showError, toast } from '../../../state/store';

export type HealthStatus = HealthStoreStatus & { words: string };

let shared: { db: HealthDb | null; status: HealthStatus | null } = { db: null, status: null };

export function useHealth(): {
  db: HealthDb | null;
  status: HealthStatus | null;
  failed: string | null;
  /** A change made through the store (its answer shown at once); a word said when given. */
  act(p: Promise<HealthDb>, said?: string): Promise<boolean>;
} {
  const tick = useModuleTick();
  const [db, setDb] = useState<HealthDb | null>(shared.db);
  const [status, setStatus] = useState<HealthStatus | null>(shared.status);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([window.nv.modules.health.read(), window.nv.modules.health.status()]).then(
      ([d, s]) => {
        if (!live) return;
        shared = { db: d, status: s };
        setDb(d);
        setStatus(s);
        setFailed(null);
      },
      (err) => live && setFailed(errorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, [tick]);
  const act = useCallback(async (p: Promise<HealthDb>, said?: string) => {
    try {
      const next = await p;
      shared = { ...shared, db: next };
      setDb(next);
      if (said) toast(said);
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  }, []);
  return { db, status, failed, act };
}

export const H = () => window.nv.modules.health;
