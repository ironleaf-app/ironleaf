// The work modules in the window (Wave 6 part b; src/main/work-modules.ts): a module's model read from the main side and
// read again whenever the notes, files or modules change, its jobs called by name, and the vault's options for it.

import { useEffect, useState } from 'react';
import type { ModuleOptions, ModuleOptionsFile } from '../../../shared/module-records';
import { errorMessage, resultWords } from '../lib/errors';
import { moduleChanged, useModuleTick } from './modules';
import { showError, toast, useApp } from './store';

/** One of a module's jobs on the main side, by its name. */
export const workCall = <T>(module: string, name: string, ...args: unknown[]): Promise<T> => window.nv.work.call<T>(module, name, ...args);

/** A module's model (or another of its reads), read again when the notes or files change (null while first read). */
export function useWork<T>(module: string, name = 'model', args: unknown[] = [], on = true): { data: T | null; error: string; reload(): void } {
  const revision = useApp((s) => s.revision);
  const filesRevision = useApp((s) => s.filesRevision);
  const vault = useApp((s) => s.vault?.path);
  const tick = useModuleTick();
  const key = JSON.stringify([vault, module, name, args]);
  const [result, setResult] = useState<{ key: string; data: T | null; error: string } | null>(null);
  const [again, setAgain] = useState(0);
  // A failed or slow load may retain the last result for this request only.
  const data = on && result?.key === key ? result.data : null;
  const error = on && result?.key === key ? result.error : '';
  useEffect(() => {
    if (!on || !vault) return;
    let live = true;
    const t = window.setTimeout(
      () =>
        void workCall<T>(module, name, ...args).then(
          (d) => live && setResult({ key, data: d, error: '' }),
          (e) => live && setResult({ key, data, error: plainWords(e) }),
        ),
      data ? 120 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [revision, filesRevision, tick, vault, on, again, module, name, key]);
  return { data, error, reload: () => setAgain((n) => n + 1) };
}

/** A main-side error in the person's own words (lib/errors.ts, 9.2 uplift F22). */
export const plainWords = errorMessage;

/** Something done, said, and every page that shows the modules reads again. Null (and the error said) when it failed.
 *  A result the main side returns with no words of its own is cleaned before it shows (9.2 uplift F23): never raw. */
export async function workDid<T>(job: Promise<T>, words?: string | ((r: T) => string), action?: { label: string; run(): void }): Promise<T | null> {
  try {
    const r = await job;
    const said = typeof words === 'function' ? words(r) : words ?? resultWords(r);
    if (said) toast(said, action);
    moduleChanged();
    return r;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** The vault's options for the modules (each page's views, its own settings), read again when they change. */
export function useWorkOptions(module: string): { options: ModuleOptionsFile | null; save(patch: ModuleOptions): Promise<void> } {
  const tick = useModuleTick();
  const vault = useApp((s) => s.vault?.path);
  const [options, setOptions] = useState<ModuleOptionsFile | null>(null);
  useEffect(() => {
    if (!vault) return;
    void window.nv.work.options(module).then(setOptions, () => setOptions({}));
  }, [tick, vault, module]);
  return {
    options,
    save: async (patch) => {
      try {
        setOptions(await window.nv.work.options(module, patch));
        moduleChanged();
      } catch (err) {
        showError(new Error(plainWords(err)));
      }
    },
  };
}
