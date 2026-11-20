// Graph deltas (5 Nov 2026, v5-vault-speed): the Map refetches on every change, but one edit moves a few
// cards out of thousands. The main side diffs the new graph against the one the window holds and sends only
// what moved; the window applies it onto what it holds, keeping the cards it already drew. Order is not
// contracted (every view sorts its cards); the same cards and lines with the same words is whole. Pure, so
// tests/vault-speed-5k.test.mjs proves a delta applies whole without the window.

import type { GraphData, GraphLink, GraphNode } from './types';

/** What moved between two graphs: cards and lines to add or replace, and ids to drop. */
export interface GraphDelta {
  nodes: { upsert: GraphNode[]; removed: string[] };
  links: { upsert: GraphLink[]; removed: string[] };
}

/** A line's identity: its ends and its main kind (its reasons and strength are its words, not its name). */
export const graphLinkKey = (l: Pick<GraphLink, 'source' | 'target' | 'kind'>): string => `${l.source}\n${l.target}\n${l.kind}`;

/** The delta from the graph the window holds to the new one. */
export function diffGraph(prev: GraphData, next: GraphData): GraphDelta {
  const before = new Map(prev.nodes.map((n) => [n.id, JSON.stringify(n)]));
  const upsert: GraphNode[] = [];
  const seen = new Set<string>();
  for (const n of next.nodes) {
    seen.add(n.id);
    if (before.get(n.id) !== JSON.stringify(n)) upsert.push(n);
  }
  const removed = prev.nodes.map((n) => n.id).filter((id) => !seen.has(id));
  const beforeLinks = new Map(prev.links.map((l) => [graphLinkKey(l), JSON.stringify(l)]));
  const upLinks: GraphLink[] = [];
  const seenLinks = new Set<string>();
  for (const l of next.links) {
    const key = graphLinkKey(l);
    seenLinks.add(key);
    if (beforeLinks.get(key) !== JSON.stringify(l)) upLinks.push(l);
  }
  return { nodes: { upsert, removed }, links: { upsert: upLinks, removed: prev.links.map(graphLinkKey).filter((k) => !seenLinks.has(k)) } };
}

/** The new graph: upserts applied, removals dropped, untouched cards kept as they were (so the window keeps
 *  them drawn without redrawing). New cards land at the end; every view sorts before showing. */
export function applyGraphDelta(prev: GraphData, delta: GraphDelta): GraphData {
  const dropNodes = new Set(delta.nodes.removed);
  const dropLinks = new Set(delta.links.removed);
  const upNodes = new Map(delta.nodes.upsert.map((n) => [n.id, n]));
  const upLinks = new Map(delta.links.upsert.map((l) => [graphLinkKey(l), l]));
  const prevIds = new Set(prev.nodes.map((n) => n.id));
  const keptNodes = prev.nodes.filter((n) => !dropNodes.has(n.id)).map((n) => upNodes.get(n.id) ?? n);
  for (const n of delta.nodes.upsert) if (!prevIds.has(n.id)) keptNodes.push(n);
  const keptLinks = prev.links.filter((l) => !dropLinks.has(graphLinkKey(l))).map((l) => upLinks.get(graphLinkKey(l)) ?? l);
  const prevKeys = new Set(prev.links.map(graphLinkKey));
  for (const l of delta.links.upsert) if (!prevKeys.has(graphLinkKey(l))) keptLinks.push(l);
  return { nodes: keptNodes, links: keptLinks };
}
