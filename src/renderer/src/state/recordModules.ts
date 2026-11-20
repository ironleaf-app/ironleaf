// Finance and Documents and ID in the window (Wave 5 part a): each module's model read from the main side
// (src/main/record-modules.ts), read again whenever the notes change, and the things the pages do (add, mark paid, keep a
// file with a record, a number into Secrets).

import { useEffect, useState } from 'react';
import type { DocumentsView, FinanceView } from '../../../shared/record-modules-api';
import type { ModuleOptionsFile } from '../../../shared/module-records';
import { secretLink } from '../../../shared/sensitivity';
import { errorMessage, resultWords } from '../lib/errors';
import { setRecordCurrency } from '../views/workspace/recordParts';
import { moduleChanged, useModuleTick } from './modules';
import { showError, toast, useApp } from './store';

/** A module's model, read again when the notes or files change (null while it is first read). */
function useModel<T>(read: () => Promise<T>, on: boolean): { data: T | null; error: string; reload(): void } {
  const revision = useApp((s) => s.revision);
  const filesRevision = useApp((s) => s.filesRevision);
  const vault = useApp((s) => s.vault?.path);
  const tick = useModuleTick();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!on || !vault) return;
    let live = true;
    const t = window.setTimeout(
      () =>
        void read().then(
          (d) => live && (setData(d), setError('')),
          // A failure reads through the plain-error words (p16 loose ends: a raw message reached the page).
          (e) => live && setError(errorMessage(e)),
        ),
      data ? 120 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [revision, filesRevision, tick, vault, on, again]);
  return { data, error, reload: () => setAgain((n) => n + 1) };
}

export function useFinance(on = true) {
  const r = useModel<FinanceView>(() => window.nv.recmod.finance(), on);
  if (r.data) setRecordCurrency(r.data.currency);
  return r;
}
export const useDocuments = (on = true) => useModel<DocumentsView>(() => window.nv.recmod.documents(), on);

export function useModuleOptions(): { options: ModuleOptionsFile | null; reload(): void } {
  const tick = useModuleTick();
  const vault = useApp((s) => s.vault?.path);
  const [options, setOptions] = useState<ModuleOptionsFile | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!vault) return;
    void window.nv.recmod.options().then((r) => setOptions(r.options), () => setOptions({}));
  }, [tick, vault, again]);
  return { options, reload: () => setAgain((n) => n + 1) };
}

/** Something done, said, and every page that shows the modules reads again. */
export async function did<T>(job: Promise<T>, words?: string | ((r: T) => string)): Promise<T | null> {
  try {
    const r = await job;
    const said = typeof words === 'function' ? words(r) : words ?? resultWords(r);
    if (said) toast(said);
    moduleChanged();
    return r;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** A number (an account's, a document's) kept in Secrets: the secret made, and the locked link that stands for it in the
 *  note. Null (and said) when Secrets are locked. */
export async function numberToSecrets(name: string, value: string, where: string, kind: 'id-number' | 'bank'): Promise<string | null> {
  const v = value.trim();
  if (!v) return null;
  const status = await window.nv.secrets.status().catch(() => null);
  if (!status?.unlocked) {
    toast(status?.exists ? 'Your secrets are locked, so the number wasn’t kept. Open Locked, then add it from the record.' : 'Set up Locked first (Settings › Privacy and secrets), then add the number from the record.');
    return null;
  }
  const s = await window.nv.secrets.add({ name, kind, value: v, where });
  return secretLink(s.id, 'locked');
}

export async function secretsUnlocked(): Promise<boolean> {
  return !!(await window.nv.secrets.status().catch(() => null))?.unlocked;
}
