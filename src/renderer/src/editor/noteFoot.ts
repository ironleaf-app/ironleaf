// The element a note's foot is drawn into (components/NoteFoot.tsx: the notes that link here, mention it, or are like it),
// one per tab, like the doc head (docHead.ts): the editor places it after the note's last line, the tab's view draws into
// it. Kept for the tab's life, so the editor's kept state and the view always mean the same element.

const feet = new Map<string, HTMLElement>();

export function noteFootFor(tabId: string): HTMLElement {
  let el = feet.get(tabId);
  if (!el) {
    el = document.createElement('div');
    el.className = 'note-foot-host';
    feet.set(tabId, el);
  }
  return el;
}

export function dropNoteFoot(tabId: string): void {
  feet.delete(tabId);
}
