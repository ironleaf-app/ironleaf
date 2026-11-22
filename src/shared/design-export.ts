// SPDX-License-Identifier: AGPL-3.0-or-later
// What the Design studio's Word and Excel exports are made from (22 Nov 2026, phase 2). One shape for both, so the
// two exporters read the same note the same way: the note's cleaned words as the branded document reads them, the
// brand kit as a theme, what kind of document it is, the brand's name and its logo. Types only: nothing runs here.

import type { BrandContent } from './brand-document';
import type { DesignTheme } from './design-doc';

export interface DesignExportInput {
  /** The note's words as brandContent reads them: title, label, sub lines, figures, people, blocks of HTML. */
  content: BrandContent;
  /** The brand kit as a theme (designTheme(kit)): its colour and font tokens. */
  theme: DesignTheme;
  /** What it is, as the person picked it: 'Report', 'Proposal', 'One-pager'. */
  kindName: string;
  /** The kit's name, or '' when it has none. */
  brandName: string;
  /** The kit's primary logo as PNG bytes, or null. */
  logo?: Buffer | null;
}
