// Roam file links kept (10.0 item 16, F23): a Roam JSON export holds no files itself, but its
// pictures and files sit beside it (the folder it was picked from, or its unpacked zip).
// Relative links resolve against those siblings and come in as Files, like Logseq's;
// remote links stay links; one that points nowhere is left as words and reported.

import { promises as fsp } from 'node:fs';
import nodePath from 'node:path';
import { fileSafe, linkToken, type SourceFile } from './source';

export interface RoamSiblings {
  /** The folder the export was picked from (siblings live under it). */
  root: string;
  /** Every file under it, lower-cased relative paths (like Logseq's have set). */
  have: Set<string>;
  /** The walk stopped early (deep or over 5,000 files): links beyond it miss honestly. */
  capped: boolean;
}

/** Every file beside a Roam export, so its relative links resolve against what is there. */
export async function listRoamSiblings(root: string): Promise<RoamSiblings> {
  const have = new Set<string>();
  let capped = false;
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 6 || have.size > 5000) {
      capped = true;
      return;
    }
    const dir = rel ? nodePath.join(root, ...rel.split('/')) : root;
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(r, depth + 1);
      else if (e.isFile()) have.add(r.toLowerCase());
    }
  };
  await walk('', 0);
  return { root, have, capped };
}

/**
 * One Markdown link in a Roam block against its siblings: a file beside the export
 * becomes a file token (brought with the page); remote links and page anchors stay;
 * anything else without a file shape stays too. Missing files are said once via miss.
 */
export function roamAssetLink(
  all: string,
  bang: string,
  label: string,
  href: string,
  siblings: RoamSiblings,
  own: SourceFile[],
  miss: (href: string) => void,
): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return all;
  if (!/\.[a-z0-9]{1,5}(?:[?#]|$)/i.test(href)) return all;
  let target = href;
  try {
    target = decodeURIComponent(href);
  } catch {
    // as written
  }
  const rel = target.startsWith('/') ? nodePath.posix.normalize(target.replace(/^\/+/, '')) : nodePath.posix.normalize(target);
  if (rel.startsWith('..') || !siblings.have.has(rel.toLowerCase())) {
    miss(href);
    return label || (bang ? '(a picture not in the export)' : href);
  }
  const f = { key: `roam/${rel.toLowerCase()}`, name: fileSafe(rel.split('/').pop()!, 'File'), abs: nodePath.join(siblings.root, ...rel.split('/')) };
  if (!own.some((x) => x.key === f.key)) own.push(f);
  return bang ? linkToken('embed-file', f.key) : linkToken('file', f.key, label || f.name);
}
