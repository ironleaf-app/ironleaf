// The Share button on a page's top bar (8.8, 31 Oct 2026; the gap analysis: "Sharing/collaboration: read-only share
// link + realtime co-edit vs Notion/OneNote"): a small menu with the four ways to share a clean copy of the page
// (state/share.ts). A private note has no Share: it stays in the encrypted store.

import { isShareablePath } from '../../../shared/share';
import { openMenu } from './Menu';
import { shareMenuItems } from '../state/share';

export function ShareButton({ path, className, overflow, overflowOrder }: { path: string; className?: string; overflow?: string; overflowOrder?: number }) {
  if (!isShareablePath(path)) return null;
  return (
    <button
      type="button"
      className={className ?? 'btn'}
      data-overflow={overflow}
      data-overflow-order={overflowOrder}
      title="Share this page: a clean copy as a PDF, formatted text, Markdown or email"
      onClick={(e) => openMenu(e.currentTarget, shareMenuItems(path))}
    >
      Share
    </button>
  );
}
