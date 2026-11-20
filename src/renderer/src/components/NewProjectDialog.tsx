// New project (every way a project is made by hand: the Projects home, the Templates page, the command list): its name,
// and how it starts — a project template (Templates/Projects) gives it first next steps, key dates and risks, all the
// person's to change; Blank gives just the name.

import { useEffect, useRef, useState } from 'react';
import type { TemplateInfo } from '../../../shared/templates';
import { plural } from '../../../shared/words';
import { isProjectProps } from '../../../shared/project-file';
import { emptyWorkspace, KINDS, PROJECT_KINDS, SECTIONS, writeWorkspace, type ProjectKind } from '../../../shared/project-workspace';
import { openWorkspace } from '../state/projectWorkspace';
import { useEscape } from '../lib/useEscape';
import * as A from '../state/actions';
import { loadNotes, showError, toast, useApp } from '../state/store';
import { fitTypedName } from '../../../shared/paths';
import { Icon, type IconName } from './Icon';
import { homeArea } from '../../../shared/areas';
import { currentArea, getAreas, useAreas } from '../state/areas';
import { markTemplateUsed } from '../state/templateUsed';

export const PROJECT_ICONS: Record<string, IconName> = {
  'project-it-rollout': 'settings',
  'project-site-opening': 'folderPlus',
  'project-site-close-down': 'lock',
  'project-event': 'calendar',
  'project-monthly-reporting': 'chart',
  'project-blank': 'plus',
};

// One plural rule everywhere (3 Nov 2026, fourth-round G5-G7): imported from shared/words above.
export function startsWith(c?: TemplateInfo['counts']): string {
  if (!c || (!c.next && !c.dates && !c.risks)) return 'Just the name';
  return [c.next && plural(c.next, 'next step', 'next steps'), c.dates && plural(c.dates, 'date', 'dates'), c.risks && plural(c.risks, 'risk', 'risks')].filter(Boolean).join(' · ');
}

export function NewProjectDialog({ template, onClose }: { template?: string; onClose(): void }) {
  const [shapes, setShapes] = useState<TemplateInfo[] | null>(null);
  const [chosen, setChosen] = useState<string>(template ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const notes = useApp((s) => s.notes);
  // A typed name past 120 is fitted to leading words, said aloud on make (t212, 11 Nov 2026: the main side
  // cut it mid-word with no words — the project rename's own fit, project-file.ts set-name).
  const fit = fitTypedName(name, 120, false);
  // A project already here by that name (9.2 uplift F139): offered inline, never an error after the click.
  const clash = fit.name ? notes.find((n) => isProjectProps(n.props) && n.title.toLowerCase() === fit.name.toLowerCase()) : undefined;
  const [moreOpen, setMoreOpen] = useState(false);
  // Which area of life it goes in (Wave 4): the usable area the person is in (quiet and hidden hold
  // no new projects, and the select below offers neither), else where new things go.
  const areas = useAreas();
  const [areaId, setAreaId] = useState<string>(() => {
    const cur = currentArea();
    if (cur && !cur.quiet && !cur.hidden) return cur.id;
    const home = homeArea(getAreas());
    if (home && !home.quiet && !home.hidden) return home.id;
    return '';
  });
  const area = areas?.areas.find((a) => a.id === areaId);
  const input = useRef<HTMLInputElement>(null);
  useEscape(onClose);
  useEffect(() => {
    window.nv.templates.list().then(
      (r) => {
        const list = r.templates.filter((t) => t.kind === 'project');
        setShapes(list);
        // Blank unless a shape was asked for (from the Templates page).
        if (!template) setChosen(list.find((t) => t.builtIn === 'project-blank')?.path ?? '');
      },
      () => setShapes([]),
    );
    input.current?.focus();
  }, [template]);
  const hasBlank = !!shapes?.some((t) => t.builtIn === 'project-blank');
  const pickedShape = shapes?.find((t) => t.path === chosen);
  // A clean start by kind (24 Oct 2026, Workstream 1 part D): the kind's ready-made project, and its workspace's
  // sections set up from the first minute (src/shared/project-workspace.ts KINDS), so a project made by hand is
  // well structured with no AI. Other templates (the person's own, the older shapes) stay below.
  const kindOfShape = (t?: TemplateInfo) => PROJECT_KINDS.find((k) => KINDS[k].template === t?.builtIn);
  const kindShapes = PROJECT_KINDS.map((k) => ({ kind: k, shape: shapes?.find((t) => t.builtIn === KINDS[k].template) })).filter((x) => x.shape);
  const otherShapes = (shapes ?? []).filter((t) => !kindOfShape(t));
  const make = async () => {
    const title = fit.name;
    if (!title || busy) return;
    if (clash) {
      onClose();
      A.openPath(clash.path, { where: 'tab' });
      return;
    }
    setBusy(true);
    try {
      const file = await window.nv.projects.create(title, undefined, chosen || undefined, area?.folder);
      if (fit.cut) toast('That name was shortened to fit.');
      if (chosen) markTemplateUsed(chosen);
      const kind: ProjectKind | undefined = kindOfShape(shapes?.find((t) => t.path === chosen));
      // The sections are part of making it (W5-17): a failed save is said, never swallowed.
      if (kind) await window.nv.workspace.save(file, writeWorkspace({ ...emptyWorkspace(file, kind), order: KINDS[kind].sections })).catch((err) => { showError(err); });
      await loadNotes();
      onClose();
      if (kind) openWorkspace(file, 'tab');
      else A.openPath(file, { where: 'tab' });
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog np-dialog" role="dialog" aria-modal="true" aria-label="New project" onMouseDown={(e) => e.stopPropagation()}>
        <div className="np-head">
          <span className="np-mark">
            <Icon name="layers" size={18} />
          </span>
          <div>
            <h2>New project</h2>
            <p className="hint">Give it a name and choose what kind of project it is. It starts with the sections that kind needs, all yours to rearrange.</p>
          </div>
        </div>
        <label className="np-field">
          <span>Name</span>
          <input
            ref={input}
            value={name}
            placeholder="For example: Melbourne office opening"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void make();
            }}
          />
        </label>
        {clash && (
          <p className="hint np-clash">
            “{clash.title}” is already a project.{' '}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                onClose();
                A.openPath(clash.path, { where: 'tab' });
              }}
            >
              Open it
            </button>{' '}
            instead?
          </p>
        )}
        {areas && areas.areas.some((a) => !a.hidden && !a.quiet) && (
          <label className="np-field np-area">
            <span>Area</span>
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="The area of life it belongs to">
              {areas.areas
                .filter((a) => !a.hidden && !a.quiet)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              <option value="">Not in an area</option>
            </select>
          </label>
        )}
        <div className="np-label">Starts as</div>
        <div className="np-shapes" role="radiogroup" aria-label="Starts as">
          {!hasBlank && (
            <button role="radio" aria-checked={chosen === ''} className={`np-shape${chosen === '' ? ' active' : ''}`} onClick={() => setChosen('')}>
              <span className="np-shape-icon">
                <Icon name="plus" size={16} />
              </span>
              <span className="np-shape-name">Blank</span>
              <span className="np-shape-words">Just the name: write in the rest as you go.</span>
            </button>
          )}
          {kindShapes.map(({ kind, shape }) => (
            <button key={kind} role="radio" aria-checked={chosen === shape!.path} className={`np-shape np-kind${chosen === shape!.path ? ' active' : ''}`} onClick={() => setChosen(shape!.path)} onDoubleClick={() => void make()} title={KINDS[kind].line}>
              <span className="np-shape-icon">
                <Icon name={KINDS[kind].icon as IconName} size={16} />
              </span>
              <span className="np-shape-name">{KINDS[kind].name}</span>
              <span className="np-shape-words">{KINDS[kind].line}</span>
            </button>
          ))}
        </div>
        {otherShapes.length > 0 && (
          <button type="button" className="np-more-toggle" aria-expanded={moreOpen || otherShapes.some((t) => t.path === chosen)} onClick={() => setMoreOpen(!moreOpen)}>
            <Icon name={moreOpen || otherShapes.some((t) => t.path === chosen) ? 'chevronDown' : 'chevron'} size={11} /> From a template ({otherShapes.length})
          </button>
        )}
        {otherShapes.length > 0 && (moreOpen || otherShapes.some((t) => t.path === chosen)) && (
          <>
            <div className="np-shapes np-shapes-more" role="radiogroup" aria-label="From a template">
              {otherShapes.map((t) => (
                <button key={t.path} role="radio" aria-checked={chosen === t.path} className={`np-shape${chosen === t.path ? ' active' : ''}`} onClick={() => setChosen(t.path)} onDoubleClick={() => void make()} title={t.path}>
                  <span className="np-shape-icon">
                    <Icon name={(t.builtIn && PROJECT_ICONS[t.builtIn]) || 'template'} size={16} />
                  </span>
                  <span className="np-shape-name">{t.name}</span>
                  <span className="np-shape-words">{t.description}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="np-foot">
          <span className="np-starts">
            <Icon name="check" size={13} />
            {kindOfShape(pickedShape) ? `Sections: ${KINDS[kindOfShape(pickedShape)!].sections.filter((x) => x !== 'ask').map((x) => (SECTIONS as Record<string, { title: string }>)[x]?.title ?? (x === 'log' ? 'Log' : x.replace(/^table:/, ''))).join(' · ')}` : pickedShape ? startsWith(pickedShape.counts) : 'Just the name'}
            {pickedShape && pickedShape.counts && pickedShape.counts.dates > 0 && <span className="np-faint"> · dates count from today</span>}
          </span>
          <span className="np-space" />
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!name.trim() || busy} onClick={() => void make()}>
            Make the project
          </button>
        </div>
      </div>
    </div>
  );
}
