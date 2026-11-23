// Import (8.7 w4a, 30 Oct 2026): bring outside stuff in — a spreadsheet (each row a note), Markdown files, a folder
// of notes (read where it is, or copied in), a vault export, or notes from another app. You see where each bit goes
// first; the last import can be undone (its notes go to Recently deleted). The real paths: state/importCsv.ts for
// spreadsheets, state/imports.ts for Markdown files, components/VaultHome.tsx's ImportDialog for folders, vault
// exports and pairing.

import { useEffect, useRef, useState } from 'react';
import type { FileKind as SourceKind } from '../../../shared/pairing/types';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { ImportDialog } from '../components/VaultHome';
import { PairDialog } from '../components/PairedSources';
import * as A from '../state/actions';
import type * as W from '../state/workspace';
import { showError, toast, useApp } from '../state/store';
import { Crumbs, ViewHeader } from './ViewHeader';
import { importMarkdownFiles, loadLastImport, saveLastImport, undoLastImport, type LastImport } from '../state/imports';
import { importCsv } from '../state/importCsv';
import { landFiles, pasteEmail, pdfFromProjectFolder, saveFromMail } from '../state/intake';

const when = (at: number) => {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(at).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};
const readText = (f: File): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result ?? ''));
  r.onerror = () => reject(new Error(`Couldn’t read ${f.name}.`));
  r.readAsText(f);
});

export function ImportView({ tab }: { tab: W.TabState }) {
  const vault = useApp((s) => s.vault);
  const canEdit = useApp((s) => s.canEdit);
  const [last, setLast] = useState<LastImport | null>(null);
  // Which import door the dialog opens on (10.0 item 16): the Folder row opens on folder, the other-app row on apps.
  const [dialog, setDialog] = useState<null | 'folder' | 'apps' | 'all'>(null);
  const [pair, setPair] = useState<SourceKind | null>(null);
  const [over, setOver] = useState(false);
  const mdPick = useRef<HTMLInputElement>(null);
  const mailPick = useRef<HTMLInputElement>(null);
  const pdfPick = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setLast(loadLastImport(vault?.path));
  }, [vault?.path]);
  const done = (made: string[], where: string, source: string) => {
    const v: LastImport = { source, where, paths: made, at: Date.now() };
    saveLastImport(vault?.path, v);
    setLast(v);
  };
  const csv = (picked?: { name: string; text: string }) => void importCsv({ picked, onDone: done }).catch(showError);
  const md = async (files: File[]) => {
    const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: await readText(f) }))).catch((err: unknown) => (showError(err), null));
    if (texts) void importMarkdownFiles(texts, done);
  };
  const choose = (e: React.MouseEvent<HTMLElement>) =>
    openMenu(e.currentTarget, [
      { label: 'An email (.eml, .msg)', icon: 'mail', run: () => mailPick.current?.click() },
      { label: 'A PDF', icon: 'file', run: () => pdfPick.current?.click() },
      { label: 'A spreadsheet (CSV)', icon: 'table', run: () => csv() },
      { label: 'Notes as text files (Markdown)', icon: 'file', run: () => mdPick.current?.click() },
      { label: 'A folder, a notes export, or another app', icon: 'folder', run: () => setDialog('all') },
    ]);
  const drop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    if (!canEdit) return;
    const files = [...(e.dataTransfer?.files ?? [])];
    const csvs = files.filter((f) => /\.csv$/i.test(f.name));
    const mds = files.filter((f) => /\.(md|markdown|mdown|mkd)$/i.test(f.name));
    const arrivals = files.filter((f) => /\.(eml|msg|pdf)$/i.test(f.name));
    if (!csvs.length && !mds.length && !arrivals.length) {
      toast('Drop an email, a PDF, .csv or .md files here. A folder comes in with Choose from this PC.');
      return;
    }
    // Each spreadsheet in turn (F7): one at a time, each with its own folder and table.
    for (const c of csvs) {
      try {
        await importCsv({ picked: { name: c.name, text: await readText(c) }, onDone: done });
      } catch (err) {
        showError(err);
      }
    }
    if (mds.length) void md(mds);
    if (arrivals.length) void landFiles(arrivals);
  };
  return (
    <>
      <ViewHeader tab={tab} crumb={<Crumbs trail={[{ key: 'settings', label: 'Settings', onClick: () => A.openSettings('backups') }]} here={<b>Import</b>} />} />
      <div className="nv-page-scroll">
        <div className="nv-page im-page">
          <h1 className="w4a-title">Import</h1>
        <p className="vsub">Bring outside stuff in. You see where each bit goes first, and you can undo it.</p>
        <div
          className={`im-drop${over ? ' is-over' : ''}`}
          onDragOver={(e) => (e.preventDefault(), e.stopPropagation(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => void drop(e)}
        >
          <div className="im-drop-title">Drop files here</div>
          <div className="im-drop-sub">An email, a PDF, CSV spreadsheets or note files. A folder comes in below.</div>
          <button className="btn pri" style={{ height: 38 }} disabled={!canEdit} onClick={choose}>
            Choose from this PC…
          </button>
          <input ref={mdPick} type="file" accept=".md,.markdown,.mdown,.mkd" multiple hidden onChange={(e) => (e.target.files?.length && void md([...e.target.files]), (e.target.value = ''))} />
          <input ref={mailPick} type="file" accept=".eml,.msg" multiple hidden onChange={(e) => (e.target.files?.length && void landFiles([...e.target.files]), (e.target.value = ''))} />
          <input ref={pdfPick} type="file" accept=".pdf" multiple hidden onChange={(e) => (e.target.files?.length && void landFiles([...e.target.files]), (e.target.value = ''))} />
        </div>
        <div className="glabel" style={{ margin: '16px 0 2px' }}>How each arrives</div>
        <div className="irow">
          <span className="gtile sm slate" aria-hidden="true"><Icon name="mail" size={15} /></span>
          <div><div className="nm">Email</div><div className="ds">A saved email, pasted text, or one from Gmail or Outlook. Lands with who sent it and what it carries.</div></div>
          <span className="ctl">
            <button className="btn" style={{ height: 32 }} disabled={!canEdit} onClick={() => mailPick.current?.click()}>Bring a file in</button>
            <button className="btn" style={{ height: 32 }} disabled={!canEdit} onClick={() => void pasteEmail()}>Paste one</button>
            <button className="btn" style={{ height: 32 }} disabled={!canEdit} onClick={() => void saveFromMail()}>From Gmail or Outlook</button>
          </span>
        </div>
        <div className="irow">
          <span className="gtile sm slate" aria-hidden="true"><Icon name="pdf" size={15} /></span>
          <div><div className="nm">PDF</div><div className="ds">Drop it, or keep one from a project’s folder. A newer copy becomes its next version.</div></div>
          <span className="ctl">
            <button className="btn" style={{ height: 32 }} disabled={!canEdit} onClick={() => pdfPick.current?.click()}>Bring one in</button>
            <button className="btn" style={{ height: 32 }} disabled={!canEdit} onClick={() => void pdfFromProjectFolder()}>From a project folder</button>
          </span>
        </div>
        <div className="irow">
          <span className="gtile sm slate" aria-hidden="true"><Icon name="table" size={15} /></span>
          <div><div className="nm">Spreadsheet (CSV)</div><div className="ds">Each row becomes a note in a folder you pick, plus a table of them.</div></div>
          <span className="ctl"><button className="btn" style={{ height: 32 }} disabled={!canEdit} onClick={() => csv()}>Bring one in</button></span>
        </div>
        <div className="irow">
          <span className="gtile sm slate" aria-hidden="true"><Icon name="file" size={15} /></span>
          <div><div className="nm">Markdown files</div><div className="ds">Kept as notes, filed where you say. Links keep working.</div></div>
          <span className="ctl"><button className="btn" style={{ height: 32 }} disabled={!canEdit} onClick={() => mdPick.current?.click()}>Bring files in</button></span>
        </div>
        <div className="irow">
          <span className="gtile sm slate" aria-hidden="true"><Icon name="folder" size={15} /></span>
          <div><div className="nm">Folder of notes</div><div className="ds">Note or Word files, Apple Notes or OneNote pages. Read where it is, or copied in.</div></div>
          <span className="ctl">
            <button className="btn" style={{ height: 32 }} onClick={() => void window.nv.vault.pick().catch(showError)}>Read where it is</button>
            <button className="btn" style={{ height: 32 }} disabled={!canEdit} onClick={() => setDialog('folder')}>Copy in…</button>
          </span>
        </div>
        <div className="irow" style={{ borderBottom: 0 }}>
          <span className="gtile sm slate" aria-hidden="true"><Icon name="download" size={15} /></span>
          <div><div className="nm">From another app</div><div className="ds">Evernote, Notion, Google Keep, Readwise, Logseq or Roam, each keeping where it came from.</div></div>
          <span className="ctl"><button className="btn" style={{ height: 32 }} disabled={!canEdit} onClick={() => setDialog('apps')}>Choose…</button></span>
        </div>
        {last && (
          <>
            <div className="glabel" style={{ margin: '16px 0 2px' }}>Last import</div>
            <div className="irow" style={{ borderBottom: 0 }}>
              <span className="gtile xs green" aria-hidden="true"><Icon name="check" size={12} /></span>
              <div>
                <div className="nm" style={{ fontSize: 14 }}>{last.source} → {last.where || 'the top of your notes'} · {last.paths.length} {last.paths.length === 1 ? 'note' : 'notes'} · {when(last.at)}</div>
                <div className="ds">{last.undone ? 'Undone: its notes went to the Bin.' : 'Filed where you said.'}</div>
              </div>
              <span className="ctl">{last.undone ? <span className="tag slate">Undone</span> : <button className="btn" style={{ height: 32 }} disabled={!canEdit} onClick={() => void undoLastImport(vault?.path, last).then(setLast)}>Undo</button>}</span>
            </div>
          </>
        )}
        {dialog && <ImportDialog initial={dialog} onClose={() => setDialog(null)} onPair={(source) => (setDialog(null), setPair(source))} />}
        {pair && <PairDialog source={pair} onClose={() => setPair(null)} />}
        </div>
      </div>
    </>
  );
}
