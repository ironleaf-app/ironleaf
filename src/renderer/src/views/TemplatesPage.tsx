// The Templates page (17 Oct 2026): every template in the Templates folder as a card, grouped Notes · Projects · Reports,
// each saying in a line what it is for and where Ironleaf uses it; a live preview of the one chosen, filled in as it
// would be today; Use (a note from it, or a project shaped by it), Edit (the template itself), New template. Opened from
// a project's page, notes made here go in that project's folder.

import { ListDetail } from '../components/ListDetail';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatDate } from '../../../shared/dates';
import { showCount } from '../../../shared/words';
import { filterTemplates, GROUPS, noteFromTemplate, projectFromTemplate, sortTemplatesByUsed, splitFront, templateOutline, usedParticularly, type TemplateGroup, type TemplateInfo, type TemplateUsed } from '../../../shared/templates';
import { newDoc } from '../state/docKind';
import { Icon, type IconName } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import { PageEmpty, PageLoading, RowsSkeleton } from '../components/PageStates';
import { openMenu } from '../components/Menu';
import { VarWords } from '../components/TemplateVar';
import { PROJECT_ICONS, startsWith } from '../components/NewProjectDialog';
import { renderMarkdown } from '../lib/markdownRender';
import { isDailyTemplate } from '../lib/templateIdentity';
import * as A from '../state/actions';
import { setWorkspace } from '../state/layout';
import { openModal } from '../state/modals';
import { showError, toast, useApp, usePrefs } from '../state/store';
import { newTemplate, startFromTemplate } from '../state/templates';
import { readTemplateUsed } from '../state/templateUsed';
import * as W from '../state/workspace';
import { isEnterKey } from '../lib/enterKey';

const ICONS: Record<string, IconName> = {
  'meeting-notes': 'chat',
  'weekly-status': 'chart',
  'decision-record': 'check',
  'site-visit': 'eye',
  'risk-log': 'warning',
  'close-down-checklist': 'task',
  'project-brief': 'book',
  'daily-note': 'calendar',
  'monthly-update': 'present',
  'report-progress': 'chart',
  'report-portfolio': 'layers',
  ...PROJECT_ICONS,
};
const iconOf = (t: TemplateInfo): IconName => (t.builtIn && ICONS[t.builtIn]) || (t.kind === 'project' ? 'layers' : t.kind === 'doc' ? 'doc' : t.kind === 'report' ? 'chart' : 'notes');
const KIND_WORDS: Record<TemplateInfo['kind'], string> = { note: 'Note template', project: 'Project template', doc: 'Doc template', report: 'Report layout' };

type Filter = 'all' | TemplateGroup;

/** The words a template makes today, for its preview: a note as it would be made, a project as its file would be. */
function previewText(t: TemplateInfo, opts: { dateFormat: string; timeFormat: string; project?: string }): { body: string; props: [string, string][] } {
  let made: string;
  if (t.kind === 'project') made = projectFromTemplate(t.text, { ...opts, title: 'New project', name: 'New project', today: formatDate('YYYY-MM-DD') }).text;
  else if (t.kind === 'note') made = noteFromTemplate(t.text, { ...opts, title: `${t.name} ${formatDate('D MMM YYYY')}`, project: opts.project, answers: { preview: true } });
  else if (t.kind === 'doc') made = noteFromTemplate(t.text, { ...opts, title: 'New doc' });
  else made = t.text;
  const { lines, body } = splitFront(made);
  const props = (lines ?? [])
    .map((l) => /^([A-Za-z][\w-]*):\s*(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m && !['description', 'type', 'report', ...(t.kind === 'project' ? ['started', 'updated'] : [])].includes(m[1]))
    .map((m) => [m[1], m[2].replace(/^"(.*)"$/, '$1').replace(/^\[(.*)\]$/, '$1')] as [string, string])
    .filter(([, v]) => v.trim());
  return { body, props };
}

// One template as the mock-up draws it (8.7 wave 2, design C): a tinted glyph tile, its name (a person's own marked
// "Yours"), one clipped line saying what it is for and where it is used, Use plus the dot menu at right. Anything the
// template itself wrote (its name, its description) goes through VarWords, so a {{placeholder}} shows as a friendly
// chip, never raw braces.
const GROUP_TINT: Record<TemplateGroup, string> = { notes: 'slate', projects: 'blue', docs: 'slate', reports: 'green' };
function Row({ t, reportable, onUse, onPreview, onEdit, onReport }: { t: TemplateInfo; reportable: boolean; onUse(): void; onPreview(): void; onEdit(): void; onReport(): void }) {
  // Where it's used when that is particular to it; else what is in it.
  const used = t.kind === 'project' ? startsWith(t.counts) : usedParticularly(t) ? t.usedFor : templateOutline(t.text) || t.usedFor;
  const ds = t.description ? (used ? `${t.description} · ${used}` : t.description) : used || 'Add a description property to say what it’s for.';
  const usable = t.kind !== 'report' || reportable;
  const useIt = () => (t.kind === 'report' ? onReport() : onUse());
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (isEnterKey(e)) {
      e.preventDefault();
      useIt();
    } else if (e.key === ' ') {
      e.preventDefault();
      onPreview();
    }
  };
  return (
    <div className="w4b-tp-row" tabIndex={0} onDoubleClick={useIt} onKeyDown={onKeyDown} aria-label={`${t.name}: ${ds}`}>
      <span className={`gtile sm ${GROUP_TINT[t.group]}`} aria-hidden="true">
        <Icon name={iconOf(t)} size={16} />
      </span>
      <span style={{ display: 'block', flex: 1, minWidth: 0 }}>
        <span className="w4b-tp-nm" style={{ display: 'block' }}>
          <button className="w4b-tp-name" onClick={onPreview} title={`Preview ${t.name}`}>
            <VarWords text={t.name} />
          </button>
          {!t.builtIn && <span className="w4b-tp-own">Yours</span>}
        </span>
        <span className="w4b-tp-ds" style={{ display: 'block' }} title={ds}>
          <VarWords text={ds} />
        </span>
      </span>
      <span className="w4b-tp-ctl">
        {usable && (
          <button
            className="btn"
            style={{ height: 32 }}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              useIt();
            }}
          >
            Use
          </button>
        )}
        <button
          className="iconbtn"
          title={`More for ${t.name}`}
          aria-label={`More for ${t.name}`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e.currentTarget, [
              { label: 'Preview', icon: 'eye', run: onPreview },
              ...(t.kind === 'report' && reportable ? [{ label: 'Make one now', icon: 'spark' as const, run: onReport }] : []),
              { label: 'Edit the template', icon: 'edit', run: onEdit },
            ]);
          }}
        >
          <Icon name="more" size={16} />
        </button>
      </span>
    </div>
  );
}

export function TemplatesPage({ tab }: { tab: W.TabState }) {
  const revision = useApp((s) => s.revision);
  const canEdit = useApp((s) => s.canEdit);
  const project = tab.path;
  const projectName = useApp((s) => (project ? s.byPath.get(project)?.title : undefined));
  const prefsNow = usePrefs();
  const [data, setData] = useState<{ folder: string; templates: TemplateInfo[] } | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [used, setUsed] = useState<TemplateUsed>(() => readTemplateUsed());
  const [selected, setSelected] = useState<string | null>(null);
  // The list stands alone (8.7 wave 2 round 2, the mock-up): the preview comes in as a sheet over it when a
  // template is chosen, from its name or its menu.
  const [sheet, setSheet] = useState(false);
  // The preview reads in the pane beside the list when that pane is showing (the frame's own width decides, see
  // styles/panes.css), and as a sheet otherwise. Judged by the pane, not the window: at a 1600 px window the frame
  // can sit just under the split width, and a window-width guess left the pane folded away and the click unanswered.
  const body = useRef<HTMLDivElement>(null);
  const paneShowing = () => (body.current?.querySelector('.nv-split-side')?.getBoundingClientRect().width ?? 0) > 0;
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      // A window or menu over the page has Escape first.
      if (e.key === 'Escape' && !document.querySelector('.dialog, .settings, .menu, .picker')) {
        e.stopPropagation();
        setSheet(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sheet]);

  useEffect(() => {
    let live = true;
    window.nv.templates.list().then((r) => live && setData({ folder: r.folder, templates: r.templates }), showError);
    window.nv.templates.missing().then((m) => live && setMissing(m), () => live && setMissing([]));
    return () => {
      live = false;
    };
  }, [revision]);

  // The last-used order follows uses from any door (a make elsewhere lands in the
  // next revision, and the order follows it).
  useEffect(() => setUsed(readTemplateUsed()), [revision]);
  const templates = useMemo(() => sortTemplatesByUsed(filterTemplates(data?.templates ?? [], query), used), [data, query, used]);
  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.id, templates.filter((t) => t.group === g.id).length])) as Record<TemplateGroup, number>, [templates]);
  const shownGroups = GROUPS.filter((g) => (filter === 'all' || filter === g.id) && counts[g.id] > 0);
  const visible = shownGroups.flatMap((g) => templates.filter((t) => t.group === g.id));
  // The preview pane beside the list (round 3) shows the chosen template, or the first.
  const current = visible.find((t) => t.path === selected) ?? visible[0] ?? null;
  const preview = useMemo(() => (current ? previewText(current, { dateFormat: prefsNow.dateFormat, timeFormat: prefsNow.timeFormat, project: projectName }) : null), [current, prefsNow.dateFormat, prefsNow.timeFormat, projectName]);
  const html = useMemo(() => (preview && current ? renderMarkdown(preview.body, { from: current.path }) : ''), [preview, current]);

  const use = (t: TemplateInfo) => {
    if (!canEdit) return;
    void startFromTemplate(t, { project });
  };
  const restore = async () => {
    try {
      const n = await window.nv.templates.restore();
      toast(n ? `Brought back ${n === 1 ? 'one template' : `${n} templates`}.` : 'They’re all here.');
    } catch (err) {
      showError(err);
    }
  };
  // The preview's action (8.7 wave 2: secondary, as the mock-up's rows — the page's one primary is New template).
  const primary = (t: TemplateInfo) => {
    if (t.kind === 'note')
      return (
        <button className="button" disabled={!canEdit} onClick={() => use(t)}>
          <Icon name={isDailyTemplate(t) && !project ? 'calendar' : 'filePlus'} size={14} /> {isDailyTemplate(t) && !project ? 'Open today’s note' : 'Use'}
        </button>
      );
    if (t.kind === 'doc')
      return (
        <button className="button" disabled={!canEdit} onClick={() => void newDoc(t.path)}>
          <Icon name="doc" size={14} /> Use for a new doc
        </button>
      );
    if (t.kind === 'project')
      return (
        <button className="button" disabled={!canEdit} onClick={() => openModal({ kind: 'new-project', template: t.path })}>
          <Icon name="layers" size={14} /> Use for a new project
        </button>
      );
    return null;
  };

  const previewPanel = current && preview && (
    <aside className={`tp-preview${sheet ? ' as-sheet' : ' in-pane'}`} aria-label={`Preview of ${current.name}`}>
      <div className="tp-preview-head">
        <button className="icon-button tp-sheet-close" title="Close (Esc)" aria-label="Close" onClick={() => setSheet(false)}>
          <Icon name="close" size={15} />
        </button>
        <span className={`tp-kind group-${current.group}`}>
          <Icon name={iconOf(current)} size={12} />
          {KIND_WORDS[current.kind]}
        </span>
        <h2><VarWords text={current.name} /></h2>
        {current.description && <p className="tp-preview-desc"><VarWords text={current.description} /></p>}
        <p className="tp-preview-used">
          <Icon name="info" size={13} />
          {current.usedFor}
        </p>
        <div className="tp-preview-actions">
          {primary(current)}
          <button className="button" onClick={() => A.openPath(current.path, { where: 'tab' })}>
            <Icon name="edit" size={14} /> Edit
          </button>
        </div>
      </div>
      <div className="tp-paper">
        {preview.props.length > 0 && (
          <div className="tp-props">
            {preview.props.map(([k, v]) => (
              <span key={k} className="tp-prop">
                <span>{k}</span>
                {v}
              </span>
            ))}
          </div>
        )}
        <div className="markdown tp-preview-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <p className="tp-preview-foot">
        {current.kind === 'report' ? 'The layout a report follows.' : `As it would be made today${current.kind === 'note' && projectName ? `, in ${projectName}` : ''}.`}
      </p>
    </aside>
  );

  return (
    <div className="tp-wrap">
      <div className="tp-page">
      <div className="tp-inner has-split">
        {/* The one page head (8.7 wave 2 round 3): the title and one line, New template at right. */}
        {/* p14, 4 Nov 2026 at 3456 wide: the lead's first sentence restated the title ("Starting points…"); the brief: no help that
explains the obvious. The how-to stays. */}
        <PageHead
          title="Templates"
          lead="Use one with “New note from a template”, or type / then Template inside a note."
          actions={(
            <button className="btn pri" disabled={!canEdit || !data?.folder} onClick={() => void newTemplate()}>
              <Icon name="plus" size={14} /> New template
            </button>
          )}
        />
        {project && (
          <span className="tp-context">
            <Icon name="layers" size={13} />
            Notes you make here go in <strong>{projectName ?? A.titleOf(project)}</strong>’s folder, linked to it.
            <button className="tp-context-clear" title="Make notes where new notes usually go" onClick={() => setWorkspace((ws) => W.updateTab(ws, tab.id, { path: undefined }))}>
              <Icon name="close" size={12} />
            </button>
          </span>
        )}

        {data === null ? (
          <PageLoading label="Reading your templates…">
            <div className="glabel" style={{ margin: '14px 0 2px' }}>Notes</div>
            <div className="card" style={{ padding: '6px 20px' }}>
              <RowsSkeleton rows={3} />
            </div>
          </PageLoading>
        ) : !data.folder ? (
          <div className="card" style={{ marginTop: 14 }}>
            <PageEmpty
              icon="template"
              title="Templates are switched off"
              line="Choose a folder for them in Settings › General, and Ironleaf’s ready-made ones can go in it."
              action={{ label: 'Open Settings', run: () => openModal({ kind: 'settings', section: 'templates' }) }}
            />
          </div>
        // The folder's own count, never the filtered one (t18, 8 Nov 2026: a search matching nothing
        // showed "No templates in this folder yet" and unmounted the search box with its Clear — the page
        // was stuck until reopened. A filtered-to-zero list keeps its box and says nothing matches).
        ) : (data?.templates.length ?? 0) === 0 ? (
          <div className="card" style={{ marginTop: 14 }}>
            <PageEmpty
              icon="template"
              title="No templates in this folder yet"
              line="Ready-made ones for meeting notes, status updates, decisions, site visits, risk logs, project briefs, report layouts and more."
              action={canEdit ? { label: 'Add Ironleaf’s templates', run: () => void restore() } : undefined}
              quiet={canEdit ? { label: 'Make my own', run: () => void newTemplate() } : undefined}
            />
          </div>
        ) : (
          <>
            <label className="searchbox tp-search">
              <Icon name="search" size={14} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates by name, use or what is in them" aria-label="Search templates" />
              {query && <button type="button" className="iconbtn" aria-label="Clear the search" onClick={() => setQuery('')}><Icon name="close" size={12} /></button>}
            </label>
            {/* Filters wear the kit chips, as Notes and People (4 Nov 2026 polish: one look for every filter). */}
            <div className="chips tp-filters" role="tablist" aria-label="Kind of template">
              {(['all', ...GROUPS.map((g) => g.id)] as Filter[]).map((f) => (
                <button key={f} role="tab" aria-selected={filter === f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : GROUPS.find((g) => g.id === f)!.label}
                  {showCount(f === 'all' ? templates.length : counts[f]) ? <span className="n">{f === 'all' ? templates.length : counts[f]}</span> : null}
                </button>
              ))}
            </div>
            <div className="tp-body" ref={body}>
              {/* List and preview as panes (round 3): the templates scroll in theirs, the chosen one reads beside them. */}
              <ListDetail
                label="The template chosen"
                context={false}
                list={
              <div className="tp-groups">
                {shownGroups.length === 0 && (
                  <p className="tp-none">
                    {query ? (
                      <>No template matches those words. <button type="button" className="text-button" onClick={() => setQuery('')}>Clear the search</button></>
                    ) : (
                      'No templates here yet.'
                    )}
                  </p>
                )}
                {shownGroups.map((g, gi) => (
                  <section key={g.id} className="tp-group">
                    <div className="glabel" style={{ margin: `${gi === 0 ? 14 : 16}px 0 2px` }} title={g.words}>
                      {g.label} · {counts[g.id]}
                    </div>
                    <div>
                      {templates
                        .filter((t) => t.group === g.id)
                        .map((t) => {
                          return (
                            <Row
                              key={t.path}
                              t={t}
                              reportable={false}
                              onUse={() => (t.kind === 'project' ? openModal({ kind: 'new-project', template: t.path }) : t.kind === 'doc' ? void newDoc(t.path) : use(t))}
                              onPreview={() => (setSelected(t.path), setSheet(!paneShowing()))}
                              onEdit={() => A.openPath(t.path, { where: 'tab' })}
                              onReport={() => undefined}
                            />
                          );
                        })}
                    </div>
                  </section>
                ))}
                {missing.length > 0 && (
                  <p className="tp-missing">
                    {missing.length === 1 ? `The ready-made “${missing[0]}” template was deleted.` : `${missing.length} ready-made templates were deleted.`}{' '}
                    <button className="text-button" disabled={!canEdit} onClick={() => void restore()}>
                      Bring {missing.length === 1 ? 'it' : 'them'} back
                    </button>
                  </p>
                )}
                <p className="w4b-tp-foot">
                  Every note in the{' '}
                  <button className="tp-folder" onClick={() => data?.folder && A.revealInExplorer(data.folder)} title="Show it in the file list">
                    {data?.folder || 'Templates'}
                  </button>{' '}
                  folder is a template. Date writes as “{formatDate('D MMM YYYY')}”, time as “{formatDate('h:mm a')}”.
                </p>
              </div>
                }
                detail={!sheet ? previewPanel : null}
              />
            </div>
          </>
        )}
      </div>
      </div>
      {sheet && previewPanel && (
        <>
          <div className="tp-scrim" onMouseDown={() => setSheet(false)} />
          {previewPanel}
        </>
      )}
    </div>
  );
}
