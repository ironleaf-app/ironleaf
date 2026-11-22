// SPDX-License-Identifier: AGPL-3.0-or-later
// The Design button (22 Nov 2026): Design with AI in plain sight, beside Share on every page that has Share (a note,
// a project, a meeting, the work pages), because a feature kept two menus deep is a feature nobody finds. One click
// opens the Design studio on this page; a private note has none (it never leaves the encrypted store), and a narrow
// bar folds it into the ⋯ menu like its neighbours.

import { isShareablePath } from '../../../shared/share';
import { openModal } from '../state/modals';
import { Icon } from './Icon';

export function DesignButton({ path, className, overflow, overflowOrder }: { path: string; className?: string; overflow?: string; overflowOrder?: number }) {
  if (!isShareablePath(path) || !/\.md$/i.test(path)) return null;
  return (
    <button
      type="button"
      className={`${className ?? 'btn'} design-button`}
      data-overflow={overflow}
      data-overflow-order={overflowOrder}
      title="Design with AI: make this page into a report, one-pager, proposal, handout, poster or slides in your brand"
      onClick={() => openModal({ kind: 'design', path })}
    >
      <Icon name="palette" size={14} />
      <span>Design</span>
    </button>
  );
}
