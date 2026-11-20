// One unpublish ask (9.2 uplift F142): every one-click Unpublish confirms first, naming the site and what
// unpublishing does. Host destinations ask in the publish dialog's own words instead, so they never ask twice.

import { confirm } from '../components/Dialogs';

/** True when the person said to unpublish (folder destinations ask here; hosts ask in the publish dialog). */
export async function confirmFolderUnpublish(id: string, name: string): Promise<boolean> {
  let host = false;
  try {
    host = (await window.nv.site.list()).find((s) => s.id === id)?.host != null;
  } catch {
    host = false;
  }
  if (host) return true;
  return confirm(`Unpublish “${name}”?`, {
    message: 'The published site comes down, its files moved to the bin. Your notes stay as they are.',
    ok: 'Unpublish',
    danger: true,
  });
}
