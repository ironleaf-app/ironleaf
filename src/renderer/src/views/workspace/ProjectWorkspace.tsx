// A project's workspace (24 Oct 2026, Workstream 1 part D; the rules are in src/shared/project-workspace.ts). The
// notebook grows into the project's workspace: on the left an outline of sections — Overview (the project's hub, part C),
// Plan, Actions and follow-ups, Meetings, Files, People, Risks and decisions, Updates, Notes, the notebook's own Ask and
// Studio, and the person's own — each a proper view of the project's records. Sections are pinned, moved (drag, or Move
// up and down), hidden, renamed and added; records drag onto a section where that means something (an action onto Risks
// raises it as a risk). Everything the person arranges is kept in the vault, so every PC shows the same.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../../../shared/project-file';
import { addCustomSection, addRecordEdit, autoViews, dropPlan, editableFields, emptyWorkspace, hideSection, kindOf, KINDS, moveSection, pinSection, recordEdit, removeCustomSection, renameSection, resetSection, resolveWorkspace, SECTIONS, setSectionViews, type Section, type WorkspaceFile } from '../../../../shared/project-workspace';
import { defaultFields, defaultRecordView, fieldsOf, writeRecordView, type RecordViewDef } from '../../../../shared/record-views';
import { KIND_WORDS, type RecordKind, type WsRecord } from '../../../../shared/workspace-records';
import { Icon, type IconName } from '../../components/Icon';
import { openMenu, type MenuItem } from '../../components/Menu';
import { prompt } from '../../components/Dialogs';
import { healthTone } from '../../lib/projectLook';
import * as A from '../../state/actions';
import { openRecord, setElsewhere, useProjectData, useWorkspaceFile } from '../../state/projectWorkspace';
import { showError, toast, useApp } from '../../state/store';
import type { TabState } from '../../state/workspace';
import { NotebookColumns } from '../NotebookView';
import { EditorContext, type Editor } from '../project/Inline';
import { PlanTimeline } from '../project/PlanTimeline';
import { ProjectHub } from '../project/ProjectHub';
import { openHubItem, type OpenContext } from '../project/hubOpen';
import { ViewHeader } from '../ViewHeader';
import { draggedRecord, RECORD_MIME, RecordContext, setHint, useDropTarget, type RecordCtx } from './recordParts';
import { RecordView } from './RecordView';

const SECTION_MIME = 'application/x-nv-section';
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export function ProjectWorkspace({ tab, project: path }: { tab: TabState; project: string }) {
  const data = useProjectData(path);
  const [file, save] = useWorkspaceFile(path);
  const canEdit = useApp((s) => s.canEdit);
  const view = data.view;
  const p = view?.project;
  const sections = useMemo(() => (p ? resolveWorkspace(data.records, p, file, view?.props) : []), [data.records, p, file, view?.props]);
  const [active, setActive] = useState<string | null>(null);
  const shown = sections.filter((s) => !s.hidden);
  const current = sections.find((s) => s.id === (active ?? file?.last)) ?? shown[0];
  const w = file ?? emptyWorkspace(path);
  /** Opens a section (remembered in the workspace file); `next` is a workspace just changed (a section just made). */
  const go = (id: string, next?: WorkspaceFile) => {
    setActive(id);
    if (next) save({ ...next, last: id });
    else if (file && file.last !== id) save({ ...w, last: id });
    main.current?.scrollTo({ top: 0 });
  };
  const main = useRef<HTMLDivElement>(null);

  const ctx: RecordCtx | null = useMemo(() => {
    if (!p) return null;
    const people = [...new Set([...(view?.known.people.map((x) => x.name) ?? []), ...data.records.filter((r) => r.kind === 'person').map((r) => r.title)])].sort();
    return {
      canEdit,
      fields: fieldsOf(data.records),
      editable: (r) => editableFields(r),
      setField: async (r, field, value) => {
        // A meeting's or note's tick box: ticked on its own line there.
        if (r.ref?.at === 'elsewhere') return setElsewhere(r, field, value);
        const e = recordEdit(p, r, field, value);
        if (!e) return false;
        return data.edit([e]);
      },
      open: (r, e) => openRecord(r, e),
      plan: (r, target) => dropPlan(p, r, target),
      drop: (r, target) => {
        const plan = dropPlan(p, r, target);
        if (plan) void data.edit(plan.edits, `${plan.words}: done.`);
      },
      byId: new Map(data.records.map((r) => [r.id, r])),
      people,
    };
  }, [p, data.records, canEdit, view?.known]);

  const editor: Editor | null = useMemo(() => (view ? { path, canEdit, known: view.known, edit: (change) => data.edit([change]) } : null), [view, path, canEdit]);
  const openCtx: OpenContext = useMemo(
    () => ({
      path,
      details: async () => {
        A.openPath(path, { where: 'current' });
        return null;
      },
      openFolderFile: (rel) => A.openFolderFile(path, rel),
    }),
    [path],
  );

  const header = <ViewHeader tab={{ ...tab, path }} title={p ? `${p.name} · Workspace` : 'Workspace'} />;
  if (data.error)
    return (
      <div className="ws-root">
        {header}
        <p className="ws-failed">{data.error}</p>
      </div>
    );
  if (!view || !p || !ctx || !editor || !current)
    return (
      <div className="ws-root">
        {header}
        <div className="view-loading" />
      </div>
    );

  // ── The person's arranging ──
  const sectionMenu = (s: Section, anchor: HTMLElement | { clientX: number; clientY: number }) => {
    const i = shown.findIndex((x) => x.id === s.id);
    const items: MenuItem[] = [
      { label: s.pinned ? 'Unpin' : 'Pin to the top', icon: 'pin', run: () => save(pinSection(w, s.id, !s.pinned)) },
      { label: 'Move up', icon: 'chevron', disabled: i <= 0, run: () => save(moveSection(w, shown, s.id, shown[i - 1]?.id ?? null)) },
      { label: 'Move down', icon: 'chevronDown', disabled: i < 0 || i >= shown.length - 1, run: () => save(moveSection(w, shown, s.id, shown[i + 2]?.id ?? null)) },
      { label: 'Rename…', icon: 'pencil', run: () => void rename(s) },
      { separator: true },
      ...(s.custom ? [] : [{ label: 'Views back to how they were made', icon: 'undo' as const, disabled: !w.views[s.id] && !w.titles[s.id], run: () => save(resetSection(w, s.id)) }]),
      { label: s.hidden ? 'Show in the outline' : 'Hide from the outline', icon: 'eye', disabled: s.id === current.id && shown.length <= 1, run: () => save(hideSection(w, sections, s.id, !s.hidden)) },
      ...(s.custom ? [{ label: 'Remove this section', icon: 'trash' as const, danger: true, run: () => save(removeCustomSection(w, s.id)) }] : []),
    ];
    openMenu(anchor, items);
  };
  const rename = async (s: Section) => {
    const t = await prompt('Rename this section', { value: s.title, ok: 'Rename' });
    if (t !== null) save(renameSection(w, s.id, t));
  };
  const newSection = (anchor: HTMLElement) => {
    const kinds: RecordKind[] = ['action', 'milestone', 'workstream', 'meeting', 'file', 'person', 'risk', 'decision', 'update', 'note'];
    const have = kinds.filter((k) => data.records.some((r) => r.kind === k));
    openMenu(anchor, [
      { heading: 'A section that shows' },
      ...have.map((k) => ({
        label: KIND_WORDS[k].many,
        run: async () => {
          const t = await prompt('Name the new section', { value: `My ${KIND_WORDS[k].many.toLowerCase()}`, ok: 'Make it' });
          if (t === null) return;
          const made = addCustomSection(file?.order.length ? w : { ...w, order: shown.map((x) => x.id) }, t, { ...defaultRecordView([k], 'table', t), fields: defaultFields([k]) });
          go(made.id, made.file);
        },
      })),
    ]);
  };
  const saveAs = async (def: RecordViewDef, where: 'section' | 'vault') => {
    const t = await prompt(where === 'section' ? 'Save as a section of this project' : 'Save as a view of the whole vault', { value: def.title, ok: 'Save', message: where === 'vault' ? `It shows ${def.kinds.map((k) => KIND_WORDS[k].many.toLowerCase()).join(' and ')} from every project, kept in the vault so your other PCs have it too.` : undefined });
    if (t === null) return;
    if (where === 'section') {
      const made = addCustomSection(file?.order.length ? w : { ...w, order: shown.map((x) => x.id) }, t, def);
      go(made.id, made.file);
      toast(`“${t}” is a section of ${p.name} now.`);
      return;
    }
    try {
      const name = await window.nv.recordViews.save('', writeRecordView({ ...def, title: t, scope: 'vault' }));
      toast(`Saved “${t}” as a view of the whole vault.`, { label: 'Open', run: () => void import('../../state/recordsTab').then((m) => m.openRecordsView(name)) });
    } catch (err) {
      showError(err);
    }
  };

  return (
    <EditorContext.Provider value={editor}>
      <RecordContext.Provider value={ctx}>
        <div className="ws-root">
          {header}
          <div className="ws-shell">
            <Outline p={p} path={path} sections={sections} current={current.id} go={go} menu={sectionMenu} file={w} save={save} newSection={newSection} />
            <div className="ws-main" ref={main}>
              <SectionBody
                key={current.id}
                s={current}
                p={p}
                records={data.records}
                file={w}
                save={save}
                menu={sectionMenu}
                saveAs={saveAs}
                onAdd={async (kind, words) => {
                  const e = addRecordEdit(p, kind, words);
                  return e ? data.edit([e]) : false;
                }}
                hub={<ProjectHub view={view} files={data.files} ctx={openCtx} onTab={(t) => (t === 'timeline' ? go('plan') : A.openPath(path))} />}
                plan={<PlanTimeline p={p} onOpen={(ref, title, e) => void openHubItem(openCtx, ref, title, e)} />}
                folder={A.folderOf(path)}
              />
            </div>
          </div>
        </div>
      </RecordContext.Provider>
    </EditorContext.Provider>
  );
}

// ── The outline ──────────────────────────────────────────────────────────────────────────────────────────────────────

function Outline({ p, path, sections, current, go, menu, file, save, newSection }: { p: Project; path: string; sections: Section[]; current: string; go(id: string): void; menu(s: Section, at: HTMLElement | { clientX: number; clientY: number }): void; file: WorkspaceFile; save(w: WorkspaceFile): void; newSection(anchor: HTMLElement): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const shown = sections.filter((s) => !s.hidden);
  const hidden = sections.filter((s) => s.hidden);
  const [openHidden, setOpenHidden] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const tone = healthTone(p.health);
  const kind = KINDS[file.kind ?? kindOf(p)];
  return (
    <nav className="ws-outline" aria-label="Sections">
      <div className="ws-proj">
        <span className="ws-proj-mark" aria-hidden="true">
          <Icon name={kind.icon as IconName} size={16} />
        </span>
        <div className="ws-proj-words">
          <button type="button" className="ws-proj-name" title="Open the project’s page" onClick={(e) => A.openPath(path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })}>
            {p.name}
          </button>
          <span className="ws-proj-facts">
            {p.health && (
              <span className={`ws-pill tone-${tone === 'none' ? 'none' : tone}`}>
                <span className="ws-dot" />
                {cap(p.health)}
              </span>
            )}
            <span className="ws-faint">{p.status ? cap(p.status) : kind.name}</span>
          </span>
        </div>
      </div>
      <ul className="ws-sections" onDragLeave={() => setDragOver(null)}>
        {shown.map((s) => (
          <OutlineRow
            key={s.id}
            s={s}
            on={s.id === current}
            go={go}
            menu={menu}
            dragOver={dragOver === s.id}
            onSectionDrag={(over) => setDragOver(over ? s.id : null)}
            onSectionDrop={(id) => {
              setDragOver(null);
              if (id !== s.id) save(moveSection(file, shown, id, s.id));
            }}
          />
        ))}
      </ul>
      {hidden.length > 0 && (
        <div className="ws-hidden">
          <button type="button" className="ws-hidden-head" aria-expanded={openHidden} onClick={() => setOpenHidden(!openHidden)}>
            <Icon name={openHidden ? 'chevronDown' : 'chevron'} size={11} />
            More sections <span className="ws-faint">{hidden.length}</span>
          </button>
          {openHidden && (
            <ul>
              {hidden.map((s) => (
                <li key={s.id} className="ws-hidden-row">
                  <button type="button" className="ws-sec is-hidden" onClick={() => go(s.id)} title={s.purpose}>
                    <Icon name={s.icon as IconName} size={14} />
                    <span className="ws-sec-title">{s.title}</span>
                    {s.empty && <span className="ws-faint ws-sec-none">empty</span>}
                  </button>
                  <button type="button" className="ws-show" title="Show in the outline" onClick={() => save(hideSection(file, sections, s.id, false))}>
                    Show
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {canEdit && (
        <button type="button" className="ws-new-section" onClick={(e) => newSection(e.currentTarget)}>
          <Icon name="plus" size={13} /> New section
        </button>
      )}
      <p className="ws-outline-foot">Drag sections to reorder · drop a card on a section</p>
    </nav>
  );
}

function OutlineRow({ s, on, go, menu, dragOver, onSectionDrag, onSectionDrop }: { s: Section; on: boolean; go(id: string): void; menu(s: Section, at: HTMLElement | { clientX: number; clientY: number }): void; dragOver: boolean; onSectionDrag(over: boolean): void; onSectionDrop(id: string): void }) {
  const canEdit = useApp((st) => st.canEdit);
  const target = useDropTarget({ section: s.id });
  // A card held over a section that isn't open opens it after a moment, so it can be dropped on a record there (an
  // action onto one of Plan's workstreams): "anything can be dragged between sections" (WS1 integration, 24 Oct 2026).
  const spring = useRef(0);
  const unspring = () => {
    window.clearTimeout(spring.current);
    spring.current = 0;
  };
  useEffect(() => unspring, []);
  return (
    <li
      className={`ws-sec-row${on ? ' is-on' : ''}${dragOver ? ' is-section-over' : ''}${target.over ? ' is-over' : ''}`}
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData(SECTION_MIME, s.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(SECTION_MIME)) {
          e.preventDefault();
          onSectionDrag(true);
          return;
        }
        target.props.onDragOver(e);
        if (!on && !e.defaultPrevented && draggedRecord() && e.dataTransfer.types.includes(RECORD_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'none';
          setHint(`Hold to open ${s.title}`, e.clientX, e.clientY);
          if (!spring.current)
            spring.current = window.setTimeout(() => {
              spring.current = 0;
              setHint(null);
              go(s.id);
            }, 650);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          unspring();
          setHint(null);
        }
        target.props.onDragLeave(e);
      }}
      onDrop={(e) => {
        unspring();
        const id = e.dataTransfer.getData(SECTION_MIME);
        if (id) {
          e.preventDefault();
          onSectionDrop(id);
          return;
        }
        target.props.onDrop(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        menu(s, e);
      }}
    >
      <button type="button" className="ws-sec" aria-current={on ? 'page' : undefined} onClick={() => go(s.id)} title={s.purpose}>
        <Icon name={s.icon as IconName} size={15} />
        <span className="ws-sec-title">{s.title}</span>
        {s.pinned && <Icon name="pin" size={11} className="ws-sec-pin" />}
        {s.alert ? <span className="ws-sec-alert" title={s.id === 'actions' ? `${s.alert} overdue` : `${s.alert} high`}>{s.alert}</span> : null}
        {s.count > 0 && s.id !== 'overview' && s.id !== 'ask' && <span className="ws-sec-count">{s.count}</span>}
      </button>
      <button
        type="button"
        className="ws-sec-more"
        title={`More for ${s.title}`}
        aria-label={`More for ${s.title}`}
        onClick={(e) => {
          e.stopPropagation();
          menu(s, e.currentTarget);
        }}
      >
        <Icon name="more" size={13} />
      </button>
    </li>
  );
}

// ── A section ────────────────────────────────────────────────────────────────────────────────────────────────────────

function SectionBody({ s, p, records, file, save, menu, saveAs, onAdd, hub, plan, folder }: { s: Section; p: Project; records: WsRecord[]; file: WorkspaceFile; save(w: WorkspaceFile): void; menu(s: Section, at: HTMLElement): void; saveAs(def: RecordViewDef, where: 'section' | 'vault'): void; onAdd(kind: RecordKind, words: string): Promise<boolean>; hub: React.ReactNode; plan: React.ReactNode; folder: string }) {
  const built = (SECTIONS as Record<string, (typeof SECTIONS)[keyof typeof SECTIONS]>)[s.id];
  const setViews = (views: RecordViewDef[]) => save(setSectionViews(file, s.id, views));
  const head = (
    <header className="ws-sec-head">
      <div className="ws-sec-words">
        <h2>{s.title}</h2>
        <p>{s.purpose}</p>
      </div>
      <div className="ws-sec-actions">
        {s.id !== 'overview' && s.id !== 'ask' && (
          <button
            type="button"
            className="ws-quiet"
            onClick={(e) => {
              const kinds = [...new Set(s.views.flatMap((v) => v.kinds))];
              openMenu(e.currentTarget, [
                { heading: 'Add a view of' },
                ...(kinds.length ? kinds : (['action'] as RecordKind[])).map((k) => ({ label: KIND_WORDS[k].many, run: () => setViews([...s.views, { ...defaultRecordView([k], 'table', KIND_WORDS[k].many), fields: defaultFields([k]) }]) })),
              ]);
            }}
          >
            <Icon name="plus" size={12} /> Add a view
          </button>
        )}
        <button type="button" className="icon-button" title={`More for ${s.title}`} aria-label={`More for ${s.title}`} onClick={(e) => menu(s, e.currentTarget)}>
          <Icon name="more" size={15} />
        </button>
      </div>
    </header>
  );
  if (s.id === 'overview') return <div className="ws-section is-overview">{hub}</div>;
  if (s.id === 'ask')
    return (
      <div className="ws-section is-ask">
        {head}
        <NotebookColumns folder={folder} />
      </div>
    );
  const views = s.views.length ? s.views : autoViews(s.id, records);
  const scoped = records;
  return (
    <div className="ws-section">
      {head}
      {s.empty && (
        <div className="ws-starter">
          <Icon name={s.icon as IconName} size={18} />
          <div>
            <strong>Nothing here yet.</strong>
            <p>{built?.adds?.length ? `Add the first ${KIND_WORDS[built.adds[0]].one.toLowerCase()} below, and it’s written into ${p.name}’s note where any editor can read it.` : s.id === 'meetings' ? 'A meeting note that names this project (its project property, or a link to it) shows here by itself.' : s.id === 'files' ? 'Files in the project’s folder, and the ones its Documents list names, show here by what they’re for.' : 'What you add to this project shows here by itself.'}</p>
          </div>
        </div>
      )}
      {views.map((v, i) => (
        <RecordView
          key={`${s.id}:${i}:${v.kinds.join(',')}`}
          def={v}
          records={scoped}
          titled={views.length > 1}
          onChange={(next) => setViews(views.map((x, j) => (j === i ? next : x)))}
          onSaveAs={saveAs}
          onReset={file.views[s.id] ? () => save(resetSection(file, s.id)) : undefined}
          onRemove={views.length > 1 ? () => setViews(views.filter((_, j) => j !== i)) : undefined}
          onAdd={onAdd}
          addKinds={(built?.adds ?? []).filter((k) => v.kinds.includes(k))}
          timeline={s.id === 'plan' && v.kinds.includes('milestone') && v.layout === 'timeline' ? plan : undefined}
        />
      ))}
    </div>
  );
}

// Keeps a drag that leaves the window from leaving its hint behind.
export function useDragCleanup(): void {
  useEffect(() => {
    const end = () => document.body.classList.remove('ws-dragging');
    window.addEventListener('dragend', end);
    return () => window.removeEventListener('dragend', end);
  }, []);
}
