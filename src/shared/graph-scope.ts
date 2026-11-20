// The graph's filters by tag and by folder (src/renderer/src/components/GraphView.tsx): which tags and top folders there
// are to choose from (most notes first), whether a dot stays when some are chosen, and how a note's name fades in as you
// zoom rather than popping up. (19 Oct 2026: the graph refreshed for 5.0.0, its filters in one tidy panel.)

export interface ScopeNode {
  id: string;
  kind: 'note' | 'file' | 'missing' | 'tag';
  tags: string[];
}

export interface Scope {
  /** Top folders chosen ('' is the notes at the top of the vault); none chosen: every folder. */
  folders: string[];
  /** Tags chosen (no #); none chosen: every note, tagged or not. */
  tags: string[];
}

export const topFolderOf = (id: string): string => (id.includes('/') ? id.slice(0, id.indexOf('/')) : '');

/** A tag, or one under it: #work takes in #work/clients. */
const tagWithin = (tag: string, chosen: string) => {
  const t = tag.toLowerCase();
  const c = chosen.toLowerCase();
  return t === c || t.startsWith(`${c}/`);
};

/** The top folders notes are in, most notes first (the top of the vault as ''). */
export function folderChoices(nodes: ScopeNode[]): { folder: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of nodes) if (n.kind === 'note') counts.set(topFolderOf(n.id), (counts.get(topFolderOf(n.id)) ?? 0) + 1);
  return [...counts].map(([folder, count]) => ({ folder, count })).sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder));
}

/** The tags on notes, most notes first. */
export function tagChoices(nodes: ScopeNode[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const n of nodes) {
    if (n.kind !== 'note') continue;
    for (const t of new Set(n.tags.map((x) => x.replace(/^#/, '')))) {
      const key = t.toLowerCase();
      const had = counts.get(key);
      if (had) had.count++;
      else counts.set(key, { tag: t, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Whether a dot stays with these filters. A note: in a chosen folder, and carrying a chosen tag (or one under it). A tag's
 * own dot: when it is chosen, or none are. A picture or file: in a chosen folder. A note not written yet has no folder
 * or tags of its own, so it goes once either filter is on.
 */
export function inScope(node: ScopeNode, scope: Scope): boolean {
  const folders = scope.folders ?? [];
  const tags = scope.tags ?? [];
  if (node.kind === 'tag') return !tags.length || tags.some((c) => tagWithin(node.id.replace(/^tag:/, ''), c));
  if (node.kind === 'missing') return !folders.length && !tags.length;
  if (folders.length && !folders.includes(topFolderOf(node.id))) return false;
  if (node.kind === 'file') return true;
  return !tags.length || node.tags.some((t) => tags.some((c) => tagWithin(t.replace(/^#/, ''), c)));
}

/** A graph node as the focus groups need it (src/shared/types.ts GraphNode, the fields that matter here). The card
 *  fields (health, due, summary, role, org, date) are the words a card shows when the index knows them
 *  (src/shared/graph-layout.ts cardDetail); every one is optional, and a card without them still reads well. */
export interface FocusNode { id: string; title: string; kind: 'note' | 'file' | 'missing' | 'tag'; tags?: string[]; project?: boolean; doc?: boolean; owner?: string; template?: boolean; /** Kept out of view by the person (hidden unless asked for, like a template). */ quiet?: boolean; health?: string; due?: string; status?: string; summary?: string; role?: string; org?: string; date?: string; degree?: number; /** Its note type when known ('project', 'person', 'meeting'): what it is beats where it is filed (9.2). */ type?: string }
export type FocusGroupId = 'people' | 'meetings' | 'decisions' | 'projects' | 'notes' | 'files';
export const FOCUS_GROUPS: readonly { id: FocusGroupId; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'projects', label: 'Related projects' },
  { id: 'notes', label: 'Notes' },
  { id: 'files', label: 'Files' },
];
/** Which filters the graph's side list offers (SPEC C: People, Meetings, Projects, Notes, Files). */
export const FOCUS_FILTERS: readonly { id: FocusGroupId; label: string }[] = [
  { id: 'people', label: 'People' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'projects', label: 'Projects' },
  { id: 'notes', label: 'Notes' },
  { id: 'files', label: 'Files' },
];

const folderSegment = (id: string, names: string[]) => id.split('/').some((p) => names.includes(p.toLowerCase()));

/** What a node is, for the labelled groups around a centre: a file, a project, a person or meeting by its type when
 *  known else its folder, a decision by its tag, else a note. */
export function focusGroupOf(node: FocusNode): FocusGroupId {
  if (node.kind === 'file') return 'files';
  if (node.project) return 'projects';
  const type = (node.type ?? '').toLowerCase();
  if (type === 'person' || type === 'people') return 'people';
  if (type === 'meeting' || type === 'meetings') return 'meetings';
  if (folderSegment(node.id, ['people', 'contacts'])) return 'people';
  if (folderSegment(node.id, ['meetings'])) return 'meetings';
  if ((node.tags ?? []).some((t) => /^(decision|decisions)$/i.test(t.replace(/^#/, '')))) return 'decisions';
  return 'notes';
}

export interface FocusGroup { id: FocusGroupId; label: string; nodes: (FocusNode & { depth: 1 | 2 })[] }

/**
 * The labelled groups around one node (SPEC C, 29 Oct 2026): everything within two levels of it, grouped People,
 * Meetings, Decisions, Related projects, Notes and Files, each group busiest first within itself by depth then
 * name. The centre itself and any node whose title is in `ownNames` (the person's own card, so they never become
 * a hub) are left out. Only the groups named in `only` are kept (none named: all of them).
 */
export function focusGroups(nodes: readonly FocusNode[], links: readonly { source: string; target: string }[], centreId: string, opts: { ownNames?: readonly string[]; only?: readonly FocusGroupId[]; showHidden?: boolean } = {}): FocusGroup[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(centreId)) return [];
  const own = new Set((opts.ownNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean));
  const depth = new Map<string, 1 | 2>([[centreId, 1]]);
  const seen = new Set([centreId]);
  let frontier = [centreId];
  for (let d = 1 as 1 | 2; d <= 2; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const l of links) {
      const other = l.source === id ? l.target : l.target === id ? l.source : null;
      if (other && !seen.has(other) && byId.has(other)) { seen.add(other); depth.set(other, d); next.push(other); }
    }
    frontier = next;
  }
  const groups = new Map<FocusGroupId, (FocusNode & { depth: 1 | 2 })[]>();
  for (const [id, d] of depth) {
    if (id === centreId) continue;
    const node = byId.get(id)!;
    if (!opts.showHidden && isHiddenGraphNode(node)) continue;
    if (own.has(node.title.trim().toLowerCase())) continue;
    const g = focusGroupOf(node);
    if (opts.only?.length && !opts.only.includes(g) && !(g === 'decisions' && opts.only.includes('notes'))) continue;
    groups.set(g, [...(groups.get(g) ?? []), { ...node, depth: d }]);
  }
  return FOCUS_GROUPS.filter((g) => groups.has(g.id)).map((g) => ({ ...g, nodes: groups.get(g.id)!.sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title)) }));
}

/* ── Whole-vault clustering (round 3, 29 Oct 2026; the plan) ───────────────────────────────
 * A project's cluster holds the project note AND its own notes, meetings and files: everything in
 * its folder, everything whose `owner` (src/shared/relations.ts, from its folder or its `project`
 * property) is that project, and everything joined to it by an "owns" link. Areas are the outer
 * grouping: the top folder of the project's (or the loose note's) path, holding their projects'
 * clusters plus one loose cluster for the notes in no project. Folders that are not clusters:
 * Templates, Daily and Dashboards never name a cluster; Daily and Templates are left out of the
 * graph by default (a node in them, or a template, is hidden) and a filter shows them again. */

export const HIDDEN_GRAPH_FOLDERS: readonly string[] = ['daily', 'templates'];
const NON_CLUSTER_FOLDERS = new Set(['templates', 'daily', 'dashboards']);
const STRUCTURAL_FOLDERS = new Set(['projects', 'notes', 'people', 'meetings', 'docs', 'files', 'assets', 'dashboards', 'templates', 'daily']);

/** Left out of the graph by default: in Daily or Templates, a template itself, or a folder the person kept out of view. */
export function isHiddenGraphNode(node: FocusNode): boolean {
  return !!node.template || !!node.quiet || HIDDEN_GRAPH_FOLDERS.includes(topFolderOf(node.id).toLowerCase());
}

export interface ClusterLink { source: string; target: string; kind?: string; kinds?: readonly string[] }
export interface ClusterOptions { showHidden?: boolean; links?: readonly ClusterLink[] }

export interface VaultCluster { id: string; name: string; area: string; count: number; ids: string[]; projectId?: string; loose?: boolean }
export interface VaultArea { name: string; count: number; ids: string[]; clusters: VaultCluster[] }

const folderOfPath = (id: string) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '');

/** The project a node belongs to: itself when it is one, else its owner, else an "owns" link, else
 *  the one project whose folder holds it (deepest folder wins; a folder shared by two projects is
 *  nobody's, as relations.ts has it). */
export function projectOfNode(node: FocusNode, nodes: readonly FocusNode[], links: readonly ClusterLink[] = []): FocusNode | undefined {
  if (node.project) return node;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (node.owner && byId.get(node.owner)) return byId.get(node.owner);
  for (const l of links) {
    if (!(l.kind === 'owns' || (l.kinds ?? []).includes('owns'))) continue;
    const other = l.source === node.id ? byId.get(l.target) : l.target === node.id ? byId.get(l.source) : undefined;
    if (other?.project) return other;
  }
  const holding = nodes.filter((n) => n.project && folderOfPath(n.id) && node.id.startsWith(`${folderOfPath(n.id)}/`)).sort((a, b) => folderOfPath(b.id).length - folderOfPath(a.id).length);
  if (holding.length && (!holding[1] || folderOfPath(holding[1].id) !== folderOfPath(holding[0].id))) return holding[0];
  return undefined;
}

/** The area a path sits in: its top folder, unless that folder is a kind folder (Projects, Meetings,
 *  Dashboards and the rest) or none, in which case the note is at the top of the vault. */
export function graphAreaOf(id: string): string {
  const top = topFolderOf(id);
  if (!top || STRUCTURAL_FOLDERS.has(top.toLowerCase()) || NON_CLUSTER_FOLDERS.has(top.toLowerCase())) return 'Notes at the top';
  return top;
}

/** Which cluster a node sits in: its project's, else its area's loose cluster ("Work notes"). */
export function graphClusterOf(node: FocusNode, nodes: readonly FocusNode[], links: readonly ClusterLink[] = []): { id: string; name: string; area: string; projectId?: string; loose?: boolean } {
  const project = projectOfNode(node, nodes, links);
  if (project) return { id: `project:${project.id}`, name: project.title, area: graphAreaOf(project.id), projectId: project.id };
  const area = graphAreaOf(node.id);
  return { id: `loose:${area}`, name: area === 'Notes at the top' ? 'Notes at the top' : `${area} notes`, area, loose: true };
}

const clusterArgs = (linksOrOpts?: readonly ClusterLink[] | ClusterOptions, opts: ClusterOptions = {}): Required<ClusterOptions> => {
  const o = Array.isArray(linksOrOpts) ? { ...opts, links: linksOrOpts as readonly ClusterLink[] } : { ...(linksOrOpts as ClusterOptions | undefined), ...opts };
  return { showHidden: !!o.showHidden, links: o.links ?? [] };
};

/** The whole vault's clusters, busiest first: one per project (project note and its own together),
 *  plus one loose cluster per area. Daily and Templates stay out unless `showHidden`. */
export function vaultClusters(nodes: readonly FocusNode[], linksOrOpts?: readonly ClusterLink[] | ClusterOptions, opts: ClusterOptions = {}): VaultCluster[] {
  const { showHidden, links } = clusterArgs(linksOrOpts, opts);
  const byKey = new Map<string, VaultCluster>();
  for (const n of nodes) {
    if (n.kind !== 'note' && n.kind !== 'file') continue;
    if (!showHidden && isHiddenGraphNode(n)) continue;
    const c = graphClusterOf(n, nodes, links);
    const had = byKey.get(c.id);
    if (had) { if (!had.ids.includes(n.id)) had.ids.push(n.id); }
    else byKey.set(c.id, { ...c, count: 0, ids: [n.id] });
  }
  const out = [...byKey.values()];
  for (const c of out) {
    c.count = c.ids.length;
    if (c.projectId) c.ids = [c.projectId, ...c.ids.filter((id) => id !== c.projectId)];
  }
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The areas holding the clusters, busiest cluster first inside each, areas by their busiest cluster
 *  then their size: the counts add up (an area's count is the sum of its clusters'). */
export function vaultAreas(nodes: readonly FocusNode[], linksOrOpts?: readonly ClusterLink[] | ClusterOptions, opts: ClusterOptions = {}): VaultArea[] {
  const areas = new Map<string, VaultCluster[]>();
  for (const c of vaultClusters(nodes, linksOrOpts, opts)) areas.set(c.area, [...(areas.get(c.area) ?? []), c]);
  return [...areas.entries()]
    .map(([name, clusters]) => ({ name, clusters, count: clusters.reduce((n, c) => n + c.count, 0), ids: clusters.flatMap((c) => c.ids) }))
    .sort((a, b) => (b.clusters[0]?.count ?? 0) - (a.clusters[0]?.count ?? 0) || b.count - a.count || a.name.localeCompare(b.name));
}

/** The whole vault clustered (kept for round 2's callers): now the project clusters and loose area
 *  clusters above, Daily and Templates left out by default. */
export function wholeVaultClusters(nodes: readonly FocusNode[], linksOrOpts?: readonly ClusterLink[] | ClusterOptions, opts: ClusterOptions = {}): VaultCluster[] {
  return vaultClusters(nodes, linksOrOpts, opts);
}

/**
 * How strongly a name shows at zoom `k`: nothing below `threshold`, all of it a little above, easing between (so names
 * fade in as you zoom, never pop). Names that always show (projects, busy notes) are at full strength.
 */
export function labelAlpha(k: number, threshold: number, always = false): number {
  if (always) return 1;
  const from = threshold * 0.85;
  const to = threshold * 1.3;
  if (k <= from) return 0;
  if (k >= to) return 1;
  const t = (k - from) / (to - from);
  return Math.round(t * t * (3 - 2 * t) * 1000) / 1000;
}
