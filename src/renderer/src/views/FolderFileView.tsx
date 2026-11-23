// A file in a project's folder, in its own tab (t239, 12 Nov 2026): the full document viewer, the same wherever the
// file is opened from — its facts (status, signer, versions) at the top, then the file itself. Pictures, PDFs, video
// and recordings show as they are; Markdown, text and tables read; Word, Excel and PowerPoint show as their words
// (local files read the same way remote ones do); anything else by its card, with Open in its program a click away.
// Files outside the vault open the same way: this tab is how.

import { useEffect, useMemo, useState } from 'react';
import type { ProjectDocument } from '../../../shared/project-file';
import type { ProjectFile, ProjectFiles, ProjectView } from '../../../shared/types';
import { docChain, docFactsToMore, readDocFactsMore, type DocFacts as Facts, type DocNode } from '../../../shared/doc-versions';
import { isoDay } from '../../../shared/days';
import { isRemoteHandle } from '../../../shared/project-folder';
import { DocFacts } from '../components/DocFacts';
import { HitWords } from '../components/FileHits';
import { Icon } from '../components/Icon';
import type { MenuItem } from '../components/Menu';
import { PageError, PageLoading, Skel } from '../components/PageStates';
import { prompt } from '../components/Dialogs';
import { fileChainNodes, noteChainNodes } from '../lib/docNodes';
import { errorMessage } from '../lib/errors';
import { sizeWords, whenAgo } from '../lib/projectLook';
import * as A from '../state/actions';
import { takeFileQuery } from '../state/fileSearch';
import { getState, showError, toast, useApp } from '../state/store';
import type { TabState } from '../state/workspace';
import { Crumbs, ViewHeader } from './ViewHeader';
import { FileView } from './project/FilePreview';
import { kindWords } from './project/FileArt';
import { relKey, viewerFor } from './project/fileModel';

/** The tab's path split: "<project>\n<rel>". */
export function splitFolderFileTab(path: string): { project: string; rel: string } | null {
  const nl = path.indexOf('\n');
  if (nl <= 0) return null;
  const project = path.slice(0, nl);
  const rel = path.slice(nl + 1).replace(/\\/g, '/');
  return project && rel ? { project, rel } : null;
}

export function FolderFileView({ tab }: { tab: TabState }) {
  const split = splitFolderFileTab(tab.path ?? '');
  const revision = useApp((s) => s.revision);
  const canEdit = useApp((s) => s.canEdit);
  const [files, setFiles] = useState<ProjectFiles | null | undefined>(undefined);
  const [view, setView] = useState<ProjectView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [fileNodes, setFileNodes] = useState<DocNode[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The words it was found by (a search hit opens here): marked in its words, taken once.
  const [query] = useState(() => (split ? takeFileQuery(split.project, split.rel) : ''));
  useEffect(() => {
    if (!split) return;
    let alive = true;
    setFiles(undefined);
    setFailed(null);
    void Promise.all([window.nv.projects.files(split.project), window.nv.projects.view(split.project).catch(() => null), fileChainNodes()]).then(
      ([f, v, nodes]) => {
        if (!alive) return;
        setFiles(f);
        setView(v);
        setFileNodes(nodes);
      },
      (err: unknown) => alive && (setFailed(errorMessage(err)), setFiles(null)),
    );
    return () => {
      alive = false;
    };
  }, [split?.project, revision, attempt]); // eslint-disable-line react-hooks/exhaustive-deps -- rel identifies within, fetched with
  const name = split?.rel.split('/').pop() ?? '';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  const file: ProjectFile | null = useMemo(() => {
    if (!split || !files) return null;
    const key = relKey(split.rel);
    const found = files.groups.flatMap((g) => g.files).find((f) => relKey(f.rel) === key);
    if (found) return found;
    // Listed but not in the folder (moved, renamed): shown by its listing, said plainly below.
    const saved = files.saved?.files.find((f) => relKey(f.rel) === key);
    return saved ?? null;
  }, [split?.project, split?.rel, files]); // eslint-disable-line react-hooks/exhaustive-deps
  const folder = files?.folder ?? '';
  const remote = isRemoteHandle(folder);
  const entry: { doc: ProjectDocument; index: number } | null = useMemo(() => {
    if (!split || !view) return null;
    const key = relKey(split.rel);
    const index = view.project.documents.findIndex((d) => relKey(d.path) === key);
    return index >= 0 ? { doc: view.project.documents[index], index } : null;
  }, [split?.project, split?.rel, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const chain = useMemo(() => {
    if (!split) return null;
    const self: DocNode = { path: split.rel, title: name, facts: readDocFactsMore(entry?.doc.more), project: split.project };
    return docChain([...noteChainNodes(), ...(fileNodes ?? []), self], split.rel);
  }, [split?.project, split?.rel, name, entry?.doc.more, fileNodes, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!split) return <div className="media-view"><PageError title="That file couldn’t be opened" explainer="The tab no longer says which file it showed." retry={() => setFailed((f) => f)} /></div>;
  const kind = viewerFor(ext);
  const wordsKind = kind === 'office' && !remote;
  const openDefault = () => void window.nv.projects.openFile(split.project, split.rel).catch(showError);
  const menu = (): MenuItem[] => [
    ...(remote ? [] : [{ label: 'Open in its program', icon: 'external' as const, run: openDefault }]),
    ...(remote ? [] : [{ label: 'Show in folder', icon: 'reveal' as const, run: () => void window.nv.projects.showFile(split.project, split.rel).catch(showError) }]),
    { label: 'Copy its path', icon: 'copy' as const, run: () => void navigator.clipboard.writeText(split.rel).then(() => toast('Copied.')) },
  ];
  /** The entry's facts written (added when the file isn't listed yet: descriptions and facts live in Documents). */
  const writeFacts = async (facts: Facts): Promise<void> => {
    if (!view) return;
    const more = docFactsToMore(facts, entry?.doc.more);
    try {
      if (entry) await window.nv.projects.edit(split.project, { kind: 'change', list: 'documents', index: entry.index, item: { more: more ?? '' } }, view.version);
      else await window.nv.projects.edit(split.project, { kind: 'add', list: 'documents', item: { path: split.rel, ...(more ? { more } : {}) } }, view.version);
      const v = await window.nv.projects.view(split.project).catch(() => null);
      setView(v);
    } catch (err) {
      showError(err);
    }
  };
  const facts = chain?.facts ?? readDocFactsMore(entry?.doc.more);
  const setStatus = (next: Facts['status']) => {
    void writeFacts({ ...facts, status: next });
  };
  const setSigned = (signer: string, signedOn: string) => {
    void writeFacts({ ...facts, status: 'signed', signer, signedOn });
  };
  const askSigner = async () => {
    const signer = await prompt('Who signed it?', { value: facts.signer, placeholder: 'For example: June Park', ok: 'Save' });
    if (signer === null) return;
    void writeFacts({ ...facts, signer: signer.replace(/\s+/g, ' ').trim(), ...(facts.status !== 'signed' ? { status: 'signed' as const, ...(!facts.signedOn ? { signedOn: isoDay(new Date()) } : {}) } : {}) });
  };
  /** A newer file picked (one click opens the picker): attached beside this one and linked as replacing it. */
  const newVersion = () => {
    const pick = document.createElement('input');
    pick.type = 'file';
    pick.onchange = async () => {
      const f = pick.files?.[0];
      if (!f) return;
      const from = window.nv.files.pathOf(f);
      if (!from) {
        toast('That file has no place on this PC to copy from. Save it first, then try again.');
        return;
      }
      try {
        const names = await window.nv.projects.addFiles(split.project, [from]);
        const v = await window.nv.projects.view(split.project).catch(() => null);
        if (v) {
          const added = names[0] ?? f.name;
          const at = v.project.documents.findIndex((d) => relKey(d.path) === relKey(added));
          const more = docFactsToMore({ status: 'draft', signer: '', signedOn: '', replaces: `[[${split.rel}]]` }, at >= 0 ? v.project.documents[at].more : undefined);
          await window.nv.projects.edit(split.project, at >= 0 ? { kind: 'change', list: 'documents', index: at, item: { more: more ?? '' } } : { kind: 'add', list: 'documents', item: { path: added, ...(more ? { more } : {}) } }, v.version);
          A.openFolderFile(split.project, added);
        }
        toast(`Added ${names[0] ?? f.name} as the new version.`);
      } catch (err) {
        showError(err);
      }
    };
    pick.click();
  };
  const openVersion = (path: string, project: string | undefined, newTab: boolean) => {
    const where = newTab ? 'tab' as const : 'current' as const;
    if (getState().byPath.has(path)) return A.openPath(path, { where });
    if (project) return A.openFolderFile(project, path, where);
    A.openFolderFile(split.project, path, where);
  };
  return (
    <div className="media-view folder-file-view">
      <ViewHeader
        tab={tab}
        title={name}
        menu={menu}
        crumb={<Crumbs trail={[{ key: 'project', label: view?.project.name ?? A.titleOf(split.project), onClick: () => A.openPath(split.project), title: split.project }]} here={<b>{name}</b>} />}
      >
        {!remote && (
          <button className="icon-button" data-overflow="open-default" data-overflow-order={1} title="Open in its program" onClick={openDefault}>
            <Icon name="external" size={16} />
          </button>
        )}
      </ViewHeader>
      <div className="media-body folder-file-body">
        {files === undefined ? (
          <PageLoading label={`Opening ${name}…`}>
            <Skel w="min(300px, 60%)" h={22} r={8} />
          </PageLoading>
        ) : failed || !files ? (
          <PageError title="That file couldn’t be opened" explainer={failed ?? 'Its project has no folder on this PC.'} retry={() => setAttempt((a) => a + 1)} />
        ) : !file ? (
          <PageError title={`${name} isn’t in the folder now`} explainer="It may have moved or been renamed. The project's list still names it." retry={() => setAttempt((a) => a + 1)} />
        ) : (
          <>
            <h1 className="doc-head-title folder-file-title">{name}</h1>
            <p className="folder-file-meta">{[kindWords(ext), sizeWords(file.size), file.modified ? `changed ${whenAgo(file.modified)}` : '', remote ? `on ${files.remote?.name ?? 'the remote computer'}` : ''].filter(Boolean).join(' · ')}</p>
            {chain && <DocFacts kind={kindWords(ext)} chain={chain} canEdit={canEdit && !remote} showWhenPlain={chain.newer !== null || chain.earlier.length > 0} onStatus={setStatus} onSigned={setSigned} onSigner={() => void askSigner()} onNewVersion={newVersion} onOpenVersion={openVersion} />}
            <div className="folder-file-content">
              {wordsKind ? (
                <HitWords hit={{ project: split.project, projectName: view?.project.name ?? '', folder, rel: file.rel, name: file.name, ext: file.ext, size: file.size, modified: file.modified, state: 'text', score: 0, matches: 0, snippets: [], byName: false }} query={query} />
              ) : (
                <FileView project={split.project} folder={folder} file={file} big place={files.remote?.name} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
