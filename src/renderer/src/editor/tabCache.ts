// A tab's kept editor state, by tab id (5 Nov 2026 speed audit item 7: the tab strip forgets a closed tab here,
// without loading the editor itself). Untyped on purpose: only the editor reads what it kept.
const kept = new Map<string, unknown>();
export const readKept = <T>(tabId: string): T | undefined => kept.get(tabId) as T | undefined;
export const keepFor = (tabId: string, value: unknown): void => {
  kept.set(tabId, value);
};
// A note's page-top host, kept per tab and note (t146, 9 Nov 2026): every return to a note rebuilt its whole
// editor state (extensions, full parse of a long note) because the host was made fresh each mount and the kept
// state points at its host. The same tab showing the same note is the same host, so the kept state stands;
// anything else (another tab, another note, settings changed) builds again in the editor. Twenty at most.
const heads = new Map<string, HTMLElement>();

/** Forgets a tab's kept editor (the tab closed). */
export function dropEditorCache(tabId: string): void {
  kept.delete(tabId);
  for (const k of [...heads.keys()]) if (k.startsWith(`${tabId}\n`)) heads.delete(k);
}
export function headerFor(tabId: string, path: string): HTMLElement {
  const key = `${tabId}\n${path}`;
  const had = heads.get(key);
  if (had) return had;
  const el = document.createElement('div');
  el.className = 'note-head-host';
  heads.set(key, el);
  while (heads.size > 20) heads.delete(heads.keys().next().value!);
  return el;
}
