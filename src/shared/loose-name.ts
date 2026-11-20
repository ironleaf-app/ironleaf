// A file's own name from its path (5 Nov 2026 speed audit item 7: split from LooseView so the tab strip
// can title loose tabs without loading the editor).
export const looseName = (p: string): string => p.split(/[\\/]/).pop() || p;
