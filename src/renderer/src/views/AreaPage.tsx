// An area of life's page (Wave 4, 24 Oct 2026; src/shared/areas.ts). The area's name and what it holds, its five kinds as
// tabs with their counts, and each kind as the right shape: projects as cards with their state, notes by type, people as
// cards, files as a list, assets as pictures. New things made here go in the area. The ⋯ menu renames it (its folder with
// it), recolours it, keeps it out of Today and search, makes it where new things go, hides it, or opens the areas editor.
// "Not in an area" (id '') lists what isn't in one yet, with the move.

import { useEffect, useMemo, useState } from 'react';
import { AREA_COLORS, AREA_ICONS, AREA_KINDS, changeArea, homeIn, KIND_WORDS, type Area, type AreaKind } from '../../../shared/areas';
import type { ProjectCard } from '../../../shared/types';
import { EmptyState } from '../components/EmptyState';
import { fileIcon, Icon, type IconName } from '../components/Icon';
import { openMenu, type MenuItem } from '../components/Menu';
import { dueWords, effectiveHealth, fileKind, healthPill, sizeWords, whenAgo } from '../lib/projectLook';
import { fileUrl } from '../lib/resolve';
import * as A from '../state/actions';
import { areaOfTab, changeAreas, kindOfTab, openArea, renameArea, useAreaCounts, useAreaItems, useAreas, getAreas, type ItemRow } from '../state/areas';
import { openLife } from '../state/life';
import { LIFE_MODULES, modulesOn } from '../../../shared/life-modules';
import { openModule, useModules } from '../state/modules';
import { openModal } from '../state/modals';
import { getNoteTypes, newNoteOfType, typeChip } from '../state/noteTypes';
import { prompt } from '../components/Dialogs';
import { showError, toast, useApp } from '../state/store';
import { newProject } from '../state/templates';
import type * as W from '../state/workspace';
import { newOrganisation, PeopleGrid } from './PeoplePage';
import { PageHead } from '../components/PageHead';
import { isFinished } from '../../../shared/finished';
import { isOpenProject, projectStanding } from '../../../shared/project-standing';
import { NO_AREA } from './areaTabs';


const KIND_ICONS: Record<AreaKind, IconName> = { projects: 'layers', notes: 'notes', people: 'people', files: 'files', assets: 'image' };
const KIND_EMPTY: Record<AreaKind, { title: string; line: string }> = {
  projects: { title: 'No projects here yet', line: 'Work with an outcome, people and dates. New projects made here go in this area.' },
  notes: { title: 'No notes here yet', line: 'Docs, meetings, ideas and notes made here stay in this area.' },
  people: { title: 'No people here yet', line: 'Cards for the people and organisations of this part of your life.' },
  files: { title: 'No files here yet', line: 'Documents filed here from the Inbox, or dropped into this area’s Files folder.' },
  assets: { title: 'No assets here yet', line: 'Pictures, logos, films and fonts kept in this area.' },
};

const PICTURE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

function ProjectsKind({ area, rows }: { area: Area; rows: ItemRow[] }) {
  const revision = useApp((s) => s.revision);
  const [cards, setCards] = useState<ProjectCard[] | null>(null);
  useEffect(() => {
    let live = true;
    void window.nv.projects.list().then((c) => live && setCards(c), () => live && setCards([]));
    return () => {
      live = false;
    };
  }, [revision]);
  const paths = new Set(rows.map((r) => r.path));
  const mine = (cards ?? []).filter((c) => paths.has(c.path));
  const done = (c: ProjectCard) => isFinished(c.status);
  // Live is open (the one rule, as the Projects page splits): on hold and ideas fold apart below, never listed
  // as live work.
  const live = mine.filter((c) => isOpenProject(c.status)).sort((a, b) => toneRank(a) - toneRank(b) || a.name.localeCompare(b.name));
  const finished = mine.filter(done).sort((a, b) => a.name.localeCompare(b.name));
  const held = mine.filter((c) => !done(c) && !isOpenProject(c.status)).sort((a, b) => a.name.localeCompare(b.name));
  if (!cards) return <div className="pc-loading" aria-busy="true" />;
  const card = (c: ProjectCard) => {
    // The one standing: the effective health Projects home weighs, never the stored word alone, so an
    // area card can never stay cheerful while Projects home says At risk — and on hold reads muted, never alarm.
    const h = effectiveHealth(c);
    const tone = projectStanding({ status: c.status, health: h }).tone;
    const due = dueWords(c.due, c.status);
    return (
      <li key={c.path}>
        <button type="button" className={`ar-project tone-${done(c) ? 'none' : tone}`} onClick={(e) => A.openPath(c.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} title={`${c.name}\nOpen the project`}>
          <span className="ar-project-head">
            <span className="ar-project-name">{c.name}</span>
            {h && !done(c) && <span className={`ar-pill tone-${tone}`}>{healthPill(c).words}</span>}
            {done(c) && <span className="ar-pill tone-none">{c.status}</span>}
          </span>
          {c.line?.words ? <span className="ar-project-line">{c.line.words}</span> : c.next ? <span className="ar-project-line">Next: {c.next}</span> : null}
          <span className="ar-project-meta">
            {c.openNext > 0 && <span>{c.openNext} open</span>}
            {c.risks > 0 && <span>{c.risks} {c.risks === 1 ? 'risk' : 'risks'}</span>}
            {due && !done(c) && <span className={`tone-${due.tone}`}>{due.words}</span>}
            {typeof c.progress === 'number' && <span>{c.progress}%</span>}
            <span className="ar-faint">Changed {whenAgo(c.modified)}</span>
          </span>
        </button>
      </li>
    );
  };
  void area;
  return (
    <>
      {live.length > 0 && <ul className="ar-projects">{live.map(card)}</ul>}
      {finished.length > 0 && (
        <details className="ar-done" open={!live.length}>
          <summary>
            Done <span className="ar-faint">{finished.length}</span>
          </summary>
          <ul className="ar-projects">{finished.map(card)}</ul>
        </details>
      )}
      {held.length > 0 && (
        <details className="ar-done" open={!live.length && !finished.length}>
          <summary>
            On hold <span className="ar-faint">{held.length}</span>
          </summary>
          <ul className="ar-projects">{held.map(card)}</ul>
        </details>
      )}
    </>
  );
}

const toneRank = (c: ProjectCard) => ({ bad: 0, warn: 1, ok: 2, none: 3 })[projectStanding({ status: c.status, health: effectiveHealth(c) }).tone];

function NotesKind({ rows }: { rows: ItemRow[] }) {
  const byPath = useApp((s) => s.byPath);
  const types = getNoteTypes();
  const groups = useMemo(() => {
    const by = new Map<string, ItemRow[]>();
    for (const r of rows) {
      const raw = byPath.get(r.path)?.props?.type;
      const t = typeof raw === 'string' ? (types.find((x) => x.id === raw.toLowerCase() || x.aliases.includes(raw.toLowerCase()))?.id ?? 'note') : /\.canvas$/i.test(r.path) ? 'canvas' : 'note';
      by.set(t, [...(by.get(t) ?? []), r]);
    }
    const order = [...types.map((t) => t.id), 'canvas'];
    return [...by].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([id, list]) => ({ id, type: types.find((t) => t.id === id), list: list.sort((a, b) => b.mtime - a.mtime) }));
  }, [rows, byPath, types]);
  return (
    <div className="ar-groups">
      {groups.map((g) => (
        <section key={g.id} className="ar-group">
          <h3 className="ar-group-head">
            {g.type ? typeChip(g.type, 13) : <span className="nt-chip nt-teal" aria-hidden="true"><Icon name="canvas" size={13} /></span>}
            {g.type?.plural ?? 'Canvases'} <span className="ar-faint">{g.list.length}</span>
          </h3>
          <ul className="ar-rows">
            {g.list.map((r) => (
              <li key={r.path}>
                <button type="button" className="ar-row" onClick={(e) => A.openPath(r.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} title={r.path}>
                  <span className="ar-row-name">{r.title}</span>
                  <span className="ar-row-where">{shortFolder(r.path)}</span>
                  <span className="ar-row-when">{whenAgo(r.mtime)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** A note's folder without its area ("Work/Docs" → "Docs"). */
function shortFolder(path: string): string {
  const parts = path.split('/').slice(0, -1);
  return (getAreas()?.areas.some((a) => a.folder === parts[0]) ? parts.slice(1) : parts).join(' › ');
}

function FilesKind({ rows, inProjects }: { rows: ItemRow[]; inProjects: ItemRow[] }) {
  const [open, setOpen] = useState(false);
  const list = (items: ItemRow[]) => (
    <ul className="ar-rows ar-files">
      {items
        .sort((a, b) => b.mtime - a.mtime)
        .map((r) => {
          const ext = /\.([^.]+)$/.exec(r.path)?.[1] ?? '';
          const k = fileKind(ext);
          return (
            <li key={r.path}>
              <button type="button" className="ar-row" onClick={(e) => A.openPath(r.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} title={r.path}>
                <span className={`ar-file-kind k-${k.kind}`}>{k.label}</span>
                <span className="ar-row-name">{r.title}</span>
                <span className="ar-row-where">{r.project ? r.project.split('/').pop() : shortFolder(r.path)}</span>
                <span className="ar-row-size">{r.size !== undefined ? sizeWords(r.size) : ''}</span>
                <span className="ar-row-when">{whenAgo(r.mtime)}</span>
              </button>
            </li>
          );
        })}
    </ul>
  );
  return (
    <>
      {rows.length > 0 && list(rows)}
      {inProjects.length > 0 && (
        <details className="ar-done" open={open || !rows.length} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary>
            In its projects <span className="ar-faint">{inProjects.length}</span>
          </summary>
          {list(inProjects)}
        </details>
      )}
    </>
  );
}

function AssetsKind({ rows }: { rows: ItemRow[] }) {
  return (
    <ul className="ar-assets">
      {rows
        .sort((a, b) => b.mtime - a.mtime)
        .map((r) => (
          <li key={r.path}>
            <button type="button" className="ar-asset" onClick={(e) => A.openPath(r.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} title={r.path}>
              <span className="ar-asset-thumb">{PICTURE.test(r.path) ? <img src={fileUrl(r.path)} alt="" loading="lazy" draggable={false} /> : <Icon name={fileIcon(r.path)} size={22} />}</span>
              <span className="ar-asset-name">{r.title}</span>
            </button>
          </li>
        ))}
    </ul>
  );
}

export function AreaPage({ tab }: { tab: W.TabState }) {
  const config = useAreas();
  const id = areaOfTab(tab) ?? '';
  const area = id === '' ? NO_AREA : config?.areas.find((a) => a.id === id);
  const kind = kindOfTab(tab);
  const items = useAreaItems();
  const counts = useAreaCounts();
  const canEdit = useApp((s) => s.canEdit);
  const mine = useMemo(() => items.filter((r) => (r.area ?? '') === id), [items, id]);
  const own = mine.filter((r) => !r.project);
  const ofKind = own.filter((r) => r.kind === kind);
  const projectFiles = kind === 'files' || kind === 'assets' ? mine.filter((r) => r.project && r.kind === kind) : [];
  const c = counts.get(id);

  if (!config || !area) {
    return (
      <div className="sv-page life-page">
        <PageHead icon="layers" title="Area" lead="Areas of life put everything about each part of your life in one place." />
        <EmptyState icon="layers" title={config ? 'This area isn’t here any more' : 'Your vault isn’t organised by area yet'} line={config ? 'It was taken off the list of areas. Its folder and everything in it are where they were.' : 'Areas of life put everything about each part of your life in one place.'} action={!config ? { label: 'Organise by area…', icon: 'layers', run: () => openLife({ kind: 'migration' }) } : undefined} />
      </div>
    );
  }

  const newHere = (k: AreaKind) => {
    if (id === '') return;
    if (k === 'projects') return newProject();
    if (k === 'people') return void newNoteOfType('person', { folder: homeIn(area, 'people') });
    if (k === 'notes') return void newNoteOfType(undefined, { folder: homeIn(area, 'notes') });
    if (k === 'files' || k === 'assets') return void A.pickLooseFiles();
  };
  const newMenu = (): MenuItem[] => [
    { label: 'New project here', icon: 'layers', disabled: !canEdit, run: () => newProject() },
    { separator: true },
    ...getNoteTypes()
      .filter((t) => !t.hidden && t.id !== 'project' && t.id !== 'doc')
      .map((t): MenuItem => ({ label: `New ${t.name.toLowerCase()}`, icon: t.icon as IconName, disabled: !canEdit, run: () => void newNoteOfType(t.id, { folder: homeIn(area, t.folder || 'Notes') }) })),
    { label: 'New organisation', icon: 'briefcase', disabled: !canEdit, run: () => void newOrganisation(area.id) },
  ];
  const look = (patch: Partial<Area>) => void changeAreas((cfg) => changeArea(cfg, area.id, patch)).catch(showError);
  const menu = (): MenuItem[] => [
    {
      label: 'Rename…',
      icon: 'pencil',
      disabled: !canEdit,
      run: async () => {
        const name = await prompt('Rename the area', { message: 'Its folder is renamed with it, and every link keeps working.', value: area.name, ok: 'Rename' });
        if (name) await renameArea(area.id, name).then(() => toast(`The area is ${name.trim()} now.`), showError);
      },
    },
    { label: 'Colour', icon: 'palette', submenu: AREA_COLORS.map((col) => ({ label: col.charAt(0).toUpperCase() + col.slice(1), checked: area.color === col, run: () => look({ color: col }) })) },
    { label: 'Icon', icon: area.icon as IconName, submenu: AREA_ICONS.map((ic) => ({ label: ic.charAt(0).toUpperCase() + ic.slice(1), icon: ic as IconName, checked: area.icon === ic, run: () => look({ icon: ic }) })) },
    { separator: true },
    { label: 'Keep out of Today and search', icon: 'eye', checked: !!area.quiet, run: () => look({ quiet: !area.quiet }) },
    { label: 'New things go here', icon: 'pin', checked: config.home === area.id, disabled: area.quiet, run: () => void changeAreas((cfg) => ({ ...cfg, home: area.id })).catch(showError) },
    { label: 'Hide from the side bar', icon: 'close', run: () => look({ hidden: true }) },
    { separator: true },
    { label: 'Manage areas…', icon: 'settings', run: () => openLife({ kind: 'areas' }) },
  ];

  return (
    <div className={`sv-page nt-page nt-${area.color} life-page ar-page`}>
      {/* One page header for every page (8.0 section D): PageHead, no icon-tile header. */}
      <PageHead
        icon={area.icon as IconName}
        title={area.name}
        count={c?.total ?? 0}
        lead={<>{area.about || 'An area of your life'}{area.quiet ? ' · kept out of Today and search' : ''}</>}
        actions={
          id === '' ? (
            <button type="button" className="sv-tool nt-new" disabled={!canEdit} onClick={() => openLife({ kind: 'migration' })}>
              <Icon name="layers" size={14} />
              Move into areas…
            </button>
          ) : (
            <>
              {canEdit && (
                <button type="button" className="sv-tool nt-new" onClick={(e) => openMenu(e.currentTarget, newMenu())}>
                  <Icon name="plus" size={14} />
                  New
                  <Icon name="chevronDown" size={11} />
                </button>
              )}
              <button type="button" className="sv-tool sv-tool-icon" aria-label={`More for ${area.name}`} title="More" onClick={(e) => openMenu(e.currentTarget, menu())}>
                <Icon name="more" size={15} />
              </button>
            </>
          )
        }
      />
      {id !== '' && <AreaModules area={area} />}
      <nav className="ar-kinds" role="tablist" aria-label={`${area.name}: what it holds`}>
        {AREA_KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={`ar-kind${kind === k ? ' on' : ''}${!c?.[k] ? ' is-empty' : ''}`} onClick={() => openArea(id, k)}>
            <Icon name={KIND_ICONS[k]} size={14} />
            {KIND_WORDS[k]}
            <span className="ar-kind-count">{c?.[k] ?? 0}</span>
          </button>
        ))}
      </nav>
      <div className="sv-body life-body ar-body">
        {kind === 'people' && id !== '' ? (
          <PeopleGrid area={id} compact />
        ) : !ofKind.length && !projectFiles.length ? (
          <EmptyState size="panel" icon={KIND_ICONS[kind]} title={KIND_EMPTY[kind].title} line={KIND_EMPTY[kind].line} action={id !== '' && canEdit ? { label: kind === 'files' || kind === 'assets' ? 'Add a file…' : `New ${kind === 'people' ? 'person' : kind === 'projects' ? 'project' : 'note'}`, icon: 'plus', run: () => newHere(kind) } : undefined} />
        ) : kind === 'projects' ? (
          <ProjectsKind area={area} rows={ofKind} />
        ) : kind === 'notes' || kind === 'people' ? (
          <NotesKind rows={ofKind} />
        ) : kind === 'files' ? (
          <FilesKind rows={ofKind} inProjects={projectFiles} />
        ) : (
          <AssetsKind rows={[...ofKind, ...projectFiles]} />
        )}
      </div>
    </div>
  );
}

/** The modules that live in this area (26 Oct 2026): the ones switched on, one click each to their page; the area's others
 *  are offered beside them, switched on in Settings. */
function AreaModules({ area }: { area: Area }) {
  const switches = useModules();
  const on = new Set(modulesOn(switches).map((m) => m.id));
  const mine = LIFE_MODULES.filter((m) => m.area === area.id);
  if (!mine.length) return null;
  const shown = mine.filter((m) => on.has(m.id));
  const more = mine.length - shown.length;
  return (
    <div className="ar-modules" aria-label={`${area.name}: its modules`}>
      {shown.map((m) => (
        <button key={m.id} type="button" className="ar-module" title={m.words} onClick={() => openModule(m.id)}>
          <Icon name={m.icon as IconName} size={14} />
          {m.name}
        </button>
      ))}
      {more > 0 && (
        <button type="button" className="ar-module ar-module-more" title={mine.filter((m) => !on.has(m.id)).map((m) => m.name).join(', ')} onClick={() => openModal({ kind: 'settings', section: 'modules' })}>
          <Icon name="plus" size={13} />
          {shown.length ? `${more} more for ${area.name}` : `Modules for ${area.name} (${more})`}
        </button>
      )}
    </div>
  );
}
