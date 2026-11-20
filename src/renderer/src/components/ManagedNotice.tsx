// SPDX-License-Identifier: AGPL-3.0-or-later
// "Managed by your organisation": one quiet note at the top of a Settings page whose choices the organisation's
// policy fixes (src/main/policy.ts). Shows nothing when there is no policy, which is every personal install.
import { useEffect, useState } from 'react';
import type { ManagedApi } from '../../../preload/managed';
import type { ManagedView } from '../../../main/managed';

declare global {
  interface Window {
    nvManaged?: ManagedApi;
  }
}

/** Which policy areas each Settings page shows. */
const AREAS: Record<string, string[]> = {
  models: ['ai', 'askBeforeChanges'],
  agents: ['mcp', 'audit'],
  general: ['updates'],
  about: ['updates'],
};

// Read each time a page opens: a team's policy (Settings › Teams) can arrive while Ironleaf runs.
const load = () => (window.nvManaged ? window.nvManaged.view().catch(() => null) : Promise.resolve(null));

/** What the policy lets this window offer (everything when there is no policy, or before it is read). */
export type PolicyAllows = ManagedView['policy']['allows'];
const ALL: PolicyAllows = { providers: null, personalKeys: true, mcp: true, mcpWrite: true };
export function usePolicyAllows(): PolicyAllows {
  const [allows, setAllows] = useState<PolicyAllows>(ALL);
  useEffect(() => {
    let live = true;
    void load().then((v) => live && v?.policy.allows && setAllows(v.policy.allows));
    return () => void (live = false);
  }, []);
  return allows;
}

export function ManagedNotice({ section }: { section: string }) {
  const [view, setView] = useState<ManagedView | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((v) => live && setView(v));
    return () => void (live = false);
  }, []);
  const areas = AREAS[section];
  const locks = view && areas ? view.policy.locks.filter((l) => areas.includes(l.area)) : [];
  if (!locks.length) return null;
  return (
    <div className="managed-notice" role="note" style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border, rgba(127,127,127,.3))', fontSize: 13 }}>
      <b>{view!.policy.team && !view!.policy.machine ? 'Managed by your team.' : 'Managed by your organisation.'}</b> {locks.map((l) => l.words).join(' ')}
    </div>
  );
}
