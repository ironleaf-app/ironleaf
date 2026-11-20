// Chain nodes for document versions (t239): every note (from the index, no waiting) plus every project's Documents
// entries (one read, kept while the vault stands still), so a version chain is worked out wherever the document opens.
// Revision-keyed: a change anywhere rebuilds both, never mid-render.

import { docNodesFromDocuments, docNodesFromNotes, type DocNode } from '../../../shared/doc-versions';
import { getState } from '../state/store';

let notesCache: { revision: number; nodes: DocNode[] } | null = null;
let filesCache: { revision: number; nodes: DocNode[] } | null = null;

/** Every note as a chain node (a 3,000-note vault maps once per change, not once per page). */
export function noteChainNodes(): DocNode[] {
  const revision = getState().revision;
  if (notesCache && notesCache.revision === revision) return notesCache.nodes;
  const nodes = docNodesFromNotes(getState().notes.map((n) => ({ path: n.path, title: n.title, props: n.props as Record<string, unknown> | undefined })));
  notesCache = { revision, nodes };
  return nodes;
}

/** Every project's Documents entries as chain nodes (a file replaced from another project still chains). */
export async function fileChainNodes(): Promise<DocNode[]> {
  const revision = getState().revision;
  if (filesCache && filesCache.revision === revision) return filesCache.nodes;
  try {
    const all = await window.nv.projects.all();
    const nodes = all.flatMap((p) => docNodesFromDocuments(p.path, (p.project.documents ?? []).map((d) => ({ path: d.path, ...(d.what ? { what: d.what } : {}), ...(d.more ? { more: d.more } : {}) }))));
    filesCache = { revision, nodes };
    return nodes;
  } catch {
    return filesCache?.nodes ?? [];
  }
}
