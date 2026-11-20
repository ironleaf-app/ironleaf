// The element a doc's head is drawn into (views/DocHead.tsx), one per tab: the editor places it under the doc's title
// (editor/live-preview.ts), the tab's view draws into it. Kept for the tab's life, so the editor's kept state and the view
// always mean the same element.

const heads = new Map<string, HTMLElement>();

export function docHeadFor(tabId: string): HTMLElement {
  let el = heads.get(tabId);
  if (!el) {
    el = document.createElement('div');
    el.className = 'doc-head-host';
    heads.set(tabId, el);
  }
  return el;
}

export function dropDocHead(tabId: string): void {
  heads.delete(tabId);
}
