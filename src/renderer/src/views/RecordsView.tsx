// A view over the whole vault's records (24 Oct 2026, Workstream 1 part D): every project's actions, meetings, people…
// laid out, grouped, filtered and charted like any project view (views/workspace/RecordView.tsx), each record opening in
// the peek with one click and changing where it shows. Kept as a file in the vault (state/recordsTab.ts).

import { useEffect, useMemo, useState } from 'react';
import { fieldsOf, type RecordViewDef } from '../../../shared/record-views';
import { dropPlan, editableFields, recordEdit } from '../../../shared/project-workspace';
import type { WsRecord } from '../../../shared/workspace-records';
import type { ProjectEdit } from '../../../shared/project-file';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { prompt } from '../components/Dialogs';
import { errorMessage } from '../lib/errors';
import { openRecord, runEditBatch, setElsewhere, useVaultRecords } from '../state/projectWorkspace';
import { loadRecordsView, newRecordsView, openRecordsView, PRESETS, RECORDS_TAB, saveRecordsView } from '../state/recordsTab';
import { showError, useApp } from '../state/store';
import type { TabState } from '../state/workspace';
import { PageHead } from '../components/PageHead';
import { RecordContext, type RecordCtx } from './workspace/recordParts';
import { RecordView } from './workspace/RecordView';
import { chooseNote, FilesMoveBanner } from '../components/FilesMove';
import { addFilesTo, linkFileTo } from '../state/vaultFiles';
import { openAssets } from '../state/actions';

export function RecordsView({ tab }: { tab: TabState }) {
  const name = tab.path?.startsWith(RECORDS_TAB) ? tab.path.slice(RECORDS_TAB.length) : '';
  const canEdit = useApp((s) => s.canEdit);
  const attachments = useApp((s) => s.settings?.prefs.attachmentsFolder ?? 'Attachments');
  const [def, setDef] = useState<RecordViewDef | null>(null);
  // A view of files reads every file in the vault too (with its versions, source and record: src/shared/file-views.ts).
  const { records, ready, failed, reload } = useVaultRecords({ files: !!def?.kinds.includes('file') });
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    loadRecordsView(name).then(
      (v) => live && setDef(v.def),
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [name]);
  const [views, setViews] = useState<{ name: string; title: string }[]>([]);
  useEffect(() => void window.nv.recordViews.list().then((l) => setViews(l.map((v) => ({ name: v.name, title: v.title }))), () => undefined), [name, def?.title]);

  /** A change in a vault view goes to the record's own project file, one batch, with Undo. */
  const editIn = async (project: string | undefined, edits: ProjectEdit[], words?: string) => {
    if (!project || !edits.length) return false;
    const undoOne = () => window.nv.projects.undo(project);
    return runEditBatch({
      edits,
      words,
      apply: async (e) => (await window.nv.projects.edit(project, e)).words,
      rollbackOne: undoOne,
      // One reverse walk, one at a time — never concurrent unordered undos (9.2 uplift F76).
      undoAll: () =>
        void (async () => {
          for (let i = edits.length - 1; i >= 0; i--) {
            try {
              await undoOne();
            } catch (err) {
              showError(err);
              break;
            }
          }
        })(),
    });
  };
  const [projects, setProjects] = useState<Map<string, import('../../../shared/project-file').Project>>(new Map());
  const revision = useApp((s) => s.revision);
  useEffect(() => void window.nv.projects.all().then((l) => setProjects(new Map(l.map((p) => [p.path, p.project])))), [revision]);
  const ctx: RecordCtx = useMemo(
    () => ({
      canEdit,
      fields: fieldsOf(records),
      editable: (r: WsRecord) => (r.project && projects.has(r.project) ? editableFields(r) : []),
      setField: async (r, field, value) => {
        if (r.ref?.at === 'elsewhere') return setElsewhere(r, field, value);
        const p = r.project ? projects.get(r.project) : undefined;
        const e = p ? recordEdit(p, r, field, value) : null;
        return e ? editIn(r.project, [e]) : false;
      },
      open: (r, e) => openRecord(r, e),
      plan: (r, target) => {
        // Across projects nothing is moved between them: only within one record's own project.
        if (target.record && target.record.project !== r.project) return null;
        const p = r.project ? projects.get(r.project) : undefined;
        return p && target.record ? dropPlan(p, r, target) : null;
      },
      drop: (r, target) => {
        const p = r.project ? projects.get(r.project) : undefined;
        const plan = p ? dropPlan(p, r, target) : null;
        if (plan) void editIn(r.project, plan.edits, `${plan.words}: done.`);
      },
      byId: new Map(records.map((r) => [r.id, r])),
      people: [...new Set(records.filter((r) => r.kind === 'person').map((r) => r.title))].sort(),
    }),
    [records, canEdit, projects],
  );
  const change = (next: RecordViewDef) => {
    setDef(next);
    void saveRecordsView(name, next).catch(showError);
  };
  const header = <PageHead icon="views" title={def?.title ?? 'View'} lead="From every project in this vault. Kept in the vault, so your other PCs have it too." />;
  if (error)
    return (
      <div className="ws-root">
        {header}
        <p className="ws-failed">{error}</p>
      </div>
    );
  // The records unreadable is said, never shown as "no records" (9.2 uplift F72).
  if (!error && failed)
    return (
      <div className="ws-root">
        {header}
        <p className="ws-failed">The records could not be read. <button type="button" className="btn" onClick={reload}>Try again</button></p>
      </div>
    );
  if (!def || !ready)
    return (
      <div className="ws-root">
        {header}
        <div className="view-loading" />
      </div>
    );
  const others = [...Object.entries(PRESETS).map(([n, v]) => ({ name: n, title: v.title })), ...views.filter((v) => !PRESETS[v.name])];
  // A view of files: a line while files still sit in the flat attachments folder (src/components/FilesMove.tsx).
  const isFiles = def.kinds.length === 1 && def.kinds[0] === 'file';
  const loose = isFiles && attachments && !attachments.startsWith('./') ? records.filter((r) => r.kind === 'file' && r.path?.toLowerCase().startsWith(`${attachments.toLowerCase()}/`)).length : 0;
  return (
    <RecordContext.Provider value={ctx}>
      <div className="ws-root">
        <div className="ws-vault-view">
          {/* One page header for every page (8.0 section D): PageHead, no icon-tile header. */}
          <PageHead
            icon="views"
            title={
              <button
                type="button"
                className="ws-vault-title"
                title="Rename this view"
                onClick={async () => {
                  const t = await prompt('Rename this view', { value: def.title, ok: 'Rename' });
                  if (t?.trim()) change({ ...def, title: t.trim() });
                }}
              >
                {def.title}
              </button>
            }
            lead={isFiles ? 'Every file in this vault, with what it is for, where it came from and its versions. Kept in the vault, so your other PCs have it too.' : 'From every project in this vault. Kept in the vault, so your other PCs have it too.'}
            actions={
              <button
                type="button"
                className="ws-tool"
                onClick={(e) =>
                  openMenu(e.currentTarget, [
                    { heading: 'Views of the whole vault' },
                    ...others.map((v) => ({ label: v.title, checked: v.name === name, run: () => openRecordsView(v.name) })),
                    { separator: true },
                    { label: 'New view…', icon: 'plus', run: () => void newRecordsView() },
                  ])
                }
              >
                <Icon name="views" size={13} /> <span>Views</span> <Icon name="chevronDown" size={11} />
              </button>
            }
          />
          {isFiles && <FilesMoveBanner count={loose} folder={attachments} />}
          {isFiles && canEdit && (
            <div className="fv-tools">
              <button type="button" className="ws-tool" onClick={() => void chooseNote('the files', 'Add files to which note? They’re kept beside it, in its Files folder').then((rec) => (rec ? addFilesTo(rec) : null))}>
                <Icon name="plus" size={13} /> <span>Add files to a note…</span>
              </button>
              <button type="button" className="ws-tool" onClick={() => void chooseNote('the file', 'Link a file on this PC to which note? Nothing is copied').then((rec) => (rec ? linkFileTo(rec) : null))}>
                <Icon name="link" size={13} /> <span>Link a file on this PC…</span>
              </button>
              <button type="button" className="ws-tool" onClick={() => openAssets()}>
                <Icon name="assets" size={13} /> <span>Asset library</span>
              </button>
            </div>
          )}
          <RecordView def={def} records={records} onChange={change} />
        </div>
      </div>
    </RecordContext.Provider>
  );
}
