import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppGuard } from './components/ErrorBoundary';
import { UpdateBanner } from './components/UpdateBanner';
import { catchSecretLinks } from './components/SecretLink';
import { startPairing } from './lib/pairing';
import 'katex/dist/katex.min.css';
import './styles.css';
import './styles/palettes.css';
import './styles/project-page.css';
import './styles/layouts.css';
import './styles/templates.css';
import './styles/timeline.css';
import './styles/project-hub.css';
import './styles/graph.css';
import './styles/canvas.css';
import './styles/canvas-nav.css';
import './styles/responsive.css';
import './styles/assets.css';
import './styles/navigator.css';
import './styles/docs.css';
import './styles/today.css';
import './styles/today-hub.css';
// The plan pieces in one place (29 Oct 2026, the plan): PlanRow, OwnerChip, DatePill, StatusPill.
import './styles/plan.css';
import './styles/meetings-reviews.css';
import './styles/capture.css';
import './styles/file-search.css';
import './styles/flows.css';
import './styles/joined.css';
import './styles/agents.css';
import './styles/remote-folders.css';
import './styles/agents-delivered.css';
import './styles/vault-place.css';
import './styles/folder-here.css';
import './styles/saved-views.css';
import './styles/notebook.css';
import './styles/project-workspace.css';
import './styles/recorder.css';
import './styles/backup.css';
import './styles/note-foot.css';
// The connected vault's peek (WS1 part B, 24 Oct 2026).
import './styles/peek.css';
import './styles/files.css';
import './styles/note-page.css';
import './styles/suggestions.css';
import './styles/changes.css';
import './styles/reminders.css';
import './styles/pdf.css';
import './styles/types.css';
import './styles/life.css';
// Drawings (gap G23) and files from outside the vault, links and the command line (gap G26); 21 Oct 2026.
import './styles/drawing.css';
import './styles/outside.css';
// Tasks across the notes (21 Oct 2026, gap G24).
import './styles/tasks.css';
// Template prompts and "Capture to…" (21 Oct 2026, gap G27).
import './styles/capture-flows.css';
// Secrets, sensitivity levels and the audit trail (Wave 4): the Secrets page, the level chips and Settings › Privacy.
import './styles/privacy.css';
import './styles/modules.css';
import './styles/health.css';
import './styles/family.css';
import './styles/record-modules.css';
import './styles/work-modules.css';
import './styles/work-meetings.css';
import './styles/work-weekly.css';
import './styles/work-sites.css';
import './styles/personal-modules.css';
import './styles/work-vendors.css';
import './styles/publications.css';
import './styles/life-records.css';
// The calm shell (Ironleaf Calm): the left side's calm list, page headers, Ask, one page at a time.
import './styles/shell-calm.css';
// One page frame (8.0 U6): every page's header, width and tabs as the former host app's.
import './styles/page-frame.css';
// The feel (5.0.0): last, so it settles what the files before it left uneven.
import './styles/feel.css';
// Polish round 1 (ITEMS 1, 2, 5 to 8): the one page frame and row polish, after the feel so the frame holds.
import './styles/polish-shell.css';
// Polish round 3 (ITEMS 2 and 5): the Projects tabs scroll sideways; summary lines keep their spacing.
import './styles/polish-round3.css';

// A locked link to a secret in a note opens its card, wherever it is clicked (components/SecretLink.tsx).
catchSecretLinks();
// Two sections share a row only when pairing leaves no hole (t300, lib/pairing.ts).
startPairing();

// The last net under everything (8.7 urgent, 30 Oct 2026): even the app failing shows plain words, never blank.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppGuard>
      <App />
    </AppGuard>
    <UpdateBanner />
  </StrictMode>,
);
// The premium finish over every card, tile and row (8.0, 29 Oct 2026): loaded last so it is the one finish.
import './styles/premium-layer.css';
// Home's own layout on the kit (8.7 wave 1, item 3).
import './styles/home.css';
// Settings and the private places (8.7 w4a): the mock-ups' rows on the kit. Before the kit, which keeps the last word.
import './styles/settings-87.css';
// Wave 2a's extras (projects, tasks, inbox): the small bits the kit doesn't carry, on the kit's tokens.
// Before the kit: the kit loads last so its word holds on ties, and these extras win on specificity, not order.
import './styles/w2a.css';
// One page's own tabs (t255): the bar every long page shares. Before the kit, like the other extras.
import './styles/page-tabs.css';
// Database depth (8.8): rollups, synced blocks, columns, forms and relations. Before the kit, which keeps the last word.
import './styles/dbdepth-88.css';
// What the Vault can do and Start from a template (8.8): the abilities page and picker, on the kit's tokens.
import './styles/abilities-88.css';
// Publish as a website (9.0 w122publish): the dialog, the Published line and Settings' sites, on the kit's tokens.
import './styles/site-publish.css';
// The weekly tidy (2 Nov 2026, 10.0 plan item 21): the review list, on the theme tokens.
import './styles/weekly-tidy.css';
// The one kit (8.7 wave 1): every control's shape and the frame, after everything so the kit's word holds on ties.
import './styles/kit.css';
// No holes from pairing (t300): the gate's stack and minutes layouts, last so they settle the grids.
import './styles/t300-no-holes.css';
// Every room on the width system (20 Nov 2026): the rooms that kept a width or an edge of their own, placed on
// --w-reading / --w-content / --w-wide (named in page-frame.css), last so the older sheets' own numbers give way.
import './styles/room-frames.css';
// Composition, not centring (layout round 2, 20 Nov 2026, on a real vault): one left edge, balanced columns, controls
// sized to content. Last of all.
import './styles/compose.css';
// App panes (layout round 3, 20 Nov 2026, at 3440x1400: the pages ended half-way down the window): list and
// detail fill the window in panes that scroll inside themselves; the meeting page in three regions. After
// everything.
import './styles/panes.css';
