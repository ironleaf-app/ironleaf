// The Graph place (8 Nov 2026: one dark canvas for the whole vault and for one note's neighbourhood;
// 10 Nov 2026: rings is the graph, the living graph retired from the UI but kept in its file). Opened from
// a note (Ctrl+G or the page's Graph) it starts centred on that note, marked; from the side bar it is the
// whole vault fitted to the window. Click a point to see its links, double-click to open it; the card and
// Space centre, Whole vault steps back out.

import { useEffect, useState } from 'react';
import { BrainGraphView } from '../components/BrainGraphView';
import { GraphView } from '../components/GraphView';
import { PageHead } from '../components/PageHead';
import * as A from '../state/actions';
import { useGraphData } from '../state/graphData';
import { setWorkspace } from '../state/layout';
import { useApp } from '../state/store';
import * as W from '../state/workspace';
import { todayData } from '../lib/todayData';
import { BrainCompareView } from './BrainCompareView';
import '../styles/notes-inbox-search-graph.css';

export function GraphTab({ tab }: { tab: W.TabState }) {
  const revision = useApp((s) => s.revision);
  // Dev-only doors, nothing links to them: the compare page, and the retired living graph until rings
  // carries everything and its file goes. The default, with no query, is rings.
  const [proto] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('graph');
    } catch {
      return null;
    }
  });
  const [brainSummary, setBrainSummary] = useState<string | null>(null);
  const [centre, setCentre] = useState<string | null>(tab.path ?? null);
  const { data } = useGraphData(revision, !!centre);
  const [ownNames, setOwnNames] = useState<string[]>([]);
  useEffect(() => { setCentre(tab.path ?? null); }, [tab.path]);
  useEffect(() => { let live = true; void todayData().then((d) => { if (live) setOwnNames(d.me ? [d.me] : []); }, () => undefined); return () => { live = false; }; }, [revision]);

  const centreNode = data?.nodes.find((n) => n.id === centre);
  const linked = data && centre ? data.links.filter((l) => l.source === centre || l.target === centre).length : 0;
  const recentre = (path: string) => { setCentre(path); setWorkspace((ws) => W.updateTab(ws, tab.id, { path })); };
  const wholeVault = () => { setCentre(null); setWorkspace((ws) => W.updateTab(ws, tab.id, { path: undefined })); };
  // Opening from the graph (t239): where the person is, so Back returns; held Ctrl or Cmd opens beside instead.
  const open = (p: string, newTab: boolean) => A.openPath(p, { reuse: !newTab, where: newTab ? 'tab' : 'current' });

  const whole = !centre;
  if (proto === 'brain-compare') return <BrainCompareView />;
  if (proto === 'living') {
    return (
      <div className="graph-view nj-graph">
        <div className="nj-graph-head" style={{ maxWidth: 'none' }}>
          <PageHead
            title="Graph"
            count={centreNode ? `${linked} linked` : null}
            lead={whole ? 'Click a point to see its links. Double-click to open it.' : undefined}
            actions={centre ? (
              <button className="btn quiet" onClick={wholeVault}>
                Whole vault
              </button>
            ) : undefined}
          />
        </div>
        <div className="nj-graph-body">
          <GraphView current={centre} revision={revision} local={false} onOpen={open} ownNames={ownNames} onCentre={recentre} />
        </div>
      </div>
    );
  }
  return (
    <div className="graph-view nj-graph">
      <div className="nj-graph-head" style={{ maxWidth: 'none' }}>
        <PageHead
          title="Graph"
          count={centreNode && !whole ? `${linked} linked` : null}
          lead={brainSummary ?? 'Click a point to see its links. Double-click to open it.'}
          actions={centre ? (
            <button className="btn quiet" onClick={wholeVault}>
              Whole vault
            </button>
          ) : undefined}
        />
      </div>
      <div className="nj-graph-body">
        <BrainGraphView revision={revision} onOpen={open} designInit="rings" onSummary={setBrainSummary} centre={centre} onCentre={recentre} />
      </div>
    </div>
  );
}
