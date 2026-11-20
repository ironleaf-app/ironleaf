// Where the viewer finds a project's file: on this PC its own address (file://…); on a remote computer its bytes, fetched
// through the former host app once and kept as an address in this window while it is in use (pictures, PDFs, recordings).

import { useEffect, useState } from 'react';
import { isRemoteHandle } from '../../../shared/project-folder';
import { folderFileUrl } from '../views/project/fileModel';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
  pdf: 'application/pdf',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac',
};

/** Remote files' addresses, newest last; the oldest let go beyond a few dozen. */
const urls = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
function keep(key: string, url: string): void {
  urls.set(key, url);
  while (urls.size > 40) {
    const [k, u] = urls.entries().next().value!;
    urls.delete(k);
    URL.revokeObjectURL(u);
  }
}

/** A remote file's address (its bytes asked for once, however many places show it at the same time). */
export function remoteFileUrl(project: string, file: { rel: string; ext: string; modified: number; size: number }): Promise<string> {
  const key = `${project}|${file.rel}|${file.modified}|${file.size}`;
  const known = urls.get(key);
  if (known) return Promise.resolve(known);
  let asking = pending.get(key);
  if (!asking) {
    asking = window.nv.projects
      .fileBytes(project, file.rel)
      .then((bytes) => {
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[file.ext.toLowerCase()] ?? 'application/octet-stream' }));
        keep(key, url);
        return url;
      })
      .finally(() => pending.delete(key));
    pending.set(key, asking);
  }
  return asking;
}

/**
 * The address to show a project's file from: at once for a file on this PC; for a remote one undefined while it comes,
 * then its address, or null when it couldn't be fetched. `wanted` false asks for nothing (a kind that isn't shown).
 */
export function useFileUrl(project: string, folder: string, file: { rel: string; ext: string; modified: number; size: number }, wanted = true): string | null | undefined {
  const remote = isRemoteHandle(folder);
  const key = `${project}|${file.rel}|${file.modified}|${file.size}`;
  const [url, setUrl] = useState<string | null | undefined>(() => (remote ? urls.get(key) : folderFileUrl(folder, file.rel)));
  useEffect(() => {
    if (!remote) return setUrl(folderFileUrl(folder, file.rel));
    if (!wanted) return;
    const known = urls.get(key);
    if (known) return setUrl(known);
    setUrl(undefined);
    let live = true;
    remoteFileUrl(project, file).then(
      (u) => live && setUrl(u),
      () => live && setUrl(null),
    );
    return () => {
      live = false;
    };
  }, [key, folder, wanted]);
  return url;
}
