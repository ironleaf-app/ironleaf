// The window's way to the work modules (Wave 6 part b; src/main/work-modules.ts): one call per module's own job, by its
// name (each module's window side types its own: views/modules/work/*), and the vault's options for them. Built by the
// preload bridge with its own invoke, so every channel is Ironleaf's (nv:…).

import type { ModuleOptions, ModuleOptionsFile } from './module-records';

export function workModulesApi(invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>) {
  return {
    /** One of a module's own jobs ("model", "add-device"…) with its arguments. */
    call: <T>(module: string, name: string, ...args: unknown[]) => invoke<T>('work:call', module, name, args),
    /** The vault's options for the modules, or one module's changed. */
    options: (module: string, patch?: ModuleOptions) => invoke<ModuleOptionsFile>('work:options', module, patch ?? null),
    check: () => invoke<number>('work:check'),
  };
}

export type WorkModulesApi = ReturnType<typeof workModulesApi>;
