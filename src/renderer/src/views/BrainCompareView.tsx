// The brain designs side by side (9 Nov 2026, design first: a user picks). Dev-only behind
// ?graph=brain-compare: two live brains on the same vault, each with the same purpose (find, walk, focus,
// lenses), under the recommendation. Light page; only the canvases are dark. A third geometry, folds, was
// tried and dropped: bands stack into a tower with its threads tangled down the middle, a spine, not a brain.

import { PageHead } from '../components/PageHead';
import { BrainGraphView } from '../components/BrainGraphView';
import { useApp } from '../state/store';
import * as A from '../state/actions';

export function BrainCompareView() {
  const revision = useApp((s) => s.revision);
  const open = (p: string, newTab: boolean) => A.openPath(p, { reuse: !newTab, where: newTab ? 'right' : 'tab' });
  return (
    <div className="bgc">
      <div className="nj-graph-head" style={{ maxWidth: 'none' }}>
        <PageHead
          title="Graph designs"
          lead="Two calm brains on the same notes, each with the same find, walk, focus and lenses. Rings reads most like a brain: one rounded silhouette with the fold down the middle and what matters near the middle. Halves reads clearest: each lobe separate, the easiest to focus. My recommendation is rings."
        />
      </div>
      <div className="bgc-panels is-two">
        <section className="bgc-panel" aria-label="Rings">
          <div className="bgc-cap">
            <h2>Rings, recommended</h2>
            <p>One rounded brain with the fold down the middle. What matters sits near the middle, the rest toward the rim, so the busiest notes are one glance away. Closest to his reference.</p>
          </div>
          <div className="bgc-body">
            <BrainGraphView revision={revision} onOpen={open} designInit="rings" lockDesign />
          </div>
        </section>
        <section className="bgc-panel" aria-label="Halves">
          <div className="bgc-cap">
            <h2>Halves</h2>
            <p>Lobes stacked down each half with the fold between. The calmest to read lobe by lobe and the easiest to focus; the most organised of the two.</p>
          </div>
          <div className="bgc-body">
            <BrainGraphView revision={revision} onOpen={open} designInit="halves" lockDesign />
          </div>
        </section>
      </div>
    </div>
  );
}
