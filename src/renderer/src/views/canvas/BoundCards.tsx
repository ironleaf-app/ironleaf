// Cards drawn from projects on a canvas (src/shared/project-canvas.ts): the project's own card, its facts (a next step
// ticked with a click, a risk's level changed with a click, words edited in place), its documents and pictures from its
// folder on the PC, the person's notes, and the portfolio board's project cards. Every edit is written to the project
// file; the cards follow the file when it changes (the assistant, the project page).

import { useMemo } from 'react';
import type { Project, ProjectDate, ProjectDocument, ProjectNext, ProjectPerson, ProjectRisk } from '../../../../shared/project-file';
import { itemWords, parseItem, type BoundSection, type CanvasNode, type ItemSection, type NodeBinding } from '../../../../shared/project-canvas';
import { Icon } from '../../components/Icon';
import { renderInline, renderMarkdown, wikilinkFromClick } from '../../lib/markdownRender';
import { dueWords, fileKind, healthTone, initials, personHue, readDate, shortDate } from '../../lib/projectLook';
import * as A from '../../state/actions';

const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** A file in a project's folder on the PC as a URL the window can show (pictures). */
export function pcFileUrl(folder: string, rel: string): string {
  const full = `${folder.replace(/\\/g, '/').replace(/\/$/, '')}/${rel.replace(/\\/g, '/')}`;
  const encoded = full
    .split('/')
    .map((part, i) => (i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)))
    .join('/');
  return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`;
}
const isPicture = (p: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(p);

export interface BoundHandlers {
  canEdit: boolean;
  /** The project a project's canvas shows (its file as it is now). */
  project?: Project;
  projectPath?: string;
  /** Every project, for the portfolio board. */
  entries: Map<string, Project>;
  /** How the portfolio board's columns go (a card doesn't repeat what its column says). */
  groupBy?: 'status' | 'health';
  toggle(node: CanvasNode): void;
  level(node: CanvasNode, e: React.MouseEvent<HTMLElement>): void;
  choose(path: string, field: 'status' | 'health' | 'progress', e: React.MouseEvent<HTMLElement>): void;
  openDoc(rel: string): void;
  openProject(path: string, newTab: boolean): void;
}

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

function Pill({ tone, children, onClick, title }: { tone: string; children: React.ReactNode; onClick?: (e: React.MouseEvent<HTMLElement>) => void; title?: string }) {
  if (!onClick)
    return (
      <span className={`cv-pill tone-${tone}`} title={title}>
        <span className="cv-dot" />
        {children}
      </span>
    );
  return (
    <button className={`cv-pill tone-${tone} is-button`} title={title} onPointerDown={stop} onDoubleClick={stop} onClick={onClick}>
      <span className="cv-dot" />
      {children}
      <Icon name="chevronDown" size={10} />
    </button>
  );
}

function Bar({ value, tone }: { value?: number; tone: string }) {
  if (typeof value !== 'number') return null;
  return (
    <span className="cv-progress" title={`About ${value}% done`}>
      <span className="cv-progress-track">
        <span className={`cv-progress-fill tone-${tone}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </span>
      <span className="cv-progress-words">{value}%</span>
    </span>
  );
}

function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <span className={`cv-avatar${small ? ' small' : ''}`} style={{ ['--hue' as string]: personHue(name) }} title={name}>
      {initials(name)}
    </span>
  );
}

function Inline({ text, from }: { text: string; from: string }) {
  const html = useMemo(() => renderInline(text, { from }), [text, from]);
  return (
    <span
      onClick={(e) => {
        const target = wikilinkFromClick(e);
        if (target !== null) {
          e.preventDefault();
          e.stopPropagation();
          void A.openLink(target, from, e.ctrlKey || e.metaKey ? 'tab' : 'current');
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function niceDate(text: string): { day: string; month: string } | null {
  const ms = readDate(text);
  if (ms === null) return null;
  const d = new Date(ms);
  return { day: String(d.getDate()), month: shortDate(ms).replace(/^\d+\s+/, '') };
}

/** The project's own card, in the middle of its canvas (or a project on the portfolio board). */
function ProjectFace({ path, p, h, compact }: { path: string; p: Project | undefined; h: BoundHandlers; compact?: boolean }) {
  if (!p) return <div className="cv-project is-missing">{A.titleOf(path)}<span className="cv-faint">This project isn’t there any more.</span></div>;
  const tone = healthTone(p.health);
  const due = dueWords(p.due);
  const open = p.next.filter((n) => !n.done);
  const summary = p.summary.replace(/[*_`#>[\]]/g, '').split(/\n+/)[0] ?? '';
  return (
    <div className={`cv-project tone-${tone}${compact ? ' compact' : ''}`}>
      {!compact && <div className="cv-eyebrow">Project</div>}
      <div className="cv-project-name">{p.name}</div>
      <div className="cv-project-facts">
        {!(compact && h.groupBy === 'health') && (
          <Pill tone={tone} title="Health" onClick={h.canEdit ? (e) => h.choose(path, 'health', e) : undefined}>
            {p.health ? cap(p.health) : 'No health yet'}
          </Pill>
        )}
        {!(compact && h.groupBy !== 'health') && (
          <Pill tone="none" title="Status" onClick={h.canEdit ? (e) => h.choose(path, 'status', e) : undefined}>
            {p.status ? cap(p.status) : 'No status'}
          </Pill>
        )}
        <span className="cv-space" />
        {due && <span className={`cv-due tone-${due.tone}`}>{due.words}</span>}
      </div>
      {typeof p.progress === 'number' ? (
        h.canEdit && !compact ? (
          <button className="cv-plain" onPointerDown={stop} onClick={(e) => h.choose(path, 'progress', e)} title="How far through">
            <Bar value={p.progress} tone={tone} />
          </button>
        ) : (
          <Bar value={p.progress} tone={tone} />
        )
      ) : null}
      {compact ? (
        <div className="cv-project-next">
          {open[0] ? (
            <>
              <Icon name="forward" size={11} />
              <span>{open[0].what}</span>
            </>
          ) : (
            <span className="cv-faint">Nothing next written down</span>
          )}
        </div>
      ) : (
        summary && <div className="cv-project-summary">{summary}</div>
      )}
      <div className="cv-project-foot">
        {p.owner && (
          <span className="cv-owner">
            <Avatar name={p.owner} small />
            {!compact && p.owner}
          </span>
        )}
        <span className="cv-faint">
          {open.length ? `${open.length} next` : 'Nothing open'}
          {p.risks.length ? ` · ${p.risks.length} ${p.risks.length === 1 ? 'risk' : 'risks'}` : ''}
        </span>
        <span className="cv-space" />
        <button
          className="cv-open"
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            h.openProject(path, e.ctrlKey || e.metaKey);
          }}
          title="Open the project’s page"
        >
          {compact ? <Icon name="forward" size={13} /> : <>Open page <Icon name="forward" size={12} /></>}
        </button>
      </div>
    </div>
  );
}

function DocFace({ rel, what, h, copied }: { rel: string; what?: string; h: BoundHandlers; copied?: boolean }) {
  const folder = h.project?.folder;
  const ext = rel.includes('.') ? rel.slice(rel.lastIndexOf('.') + 1) : '';
  const k = fileKind(ext);
  const name = rel.split(/[\\/]/).pop() ?? rel;
  if (folder && isPicture(rel))
    return (
      <div className="cv-picture" title={rel}>
        <img src={pcFileUrl(folder, rel)} alt={name} draggable={false} />
        <div className="cv-picture-caption">
          <span className="cv-picture-name">{name}</span>
          {what && <span className="cv-picture-what">{what}</span>}
        </div>
      </div>
    );
  return (
    <div className="cv-doc" title={rel}>
      <span className={`cv-kind kind-${k.kind}`}>{k.label}</span>
      <span className="cv-doc-words">
        <span className="cv-doc-name">{name}</span>
        <span className="cv-doc-what">{what || (copied ? 'Copied into the project’s folder' : rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : 'In the project’s folder')}</span>
      </span>
      <button className="cv-open icon" onPointerDown={stop} onClick={(e) => { e.stopPropagation(); h.openDoc(rel); }} title={`Open ${name}`}>
        <Icon name="external" size={13} />
      </button>
    </div>
  );
}

const LEVEL_TONE: Record<string, string> = { critical: 'bad', high: 'bad', medium: 'warn', low: 'calm' };

function ItemFace({ node, section, h, from }: { node: CanvasNode; section: ItemSection; h: BoundHandlers; from: string }) {
  const item = parseItem(section, node.text ?? '');
  if (!item) return <div className="cv-faint">Empty</div>;
  switch (section) {
    case 'next': {
      const n = item as ProjectNext;
      return (
        <div className={`cv-step${n.done ? ' done' : ''}`}>
          <button className="cv-tick" role="checkbox" aria-checked={n.done} disabled={!h.canEdit} onPointerDown={stop} onDoubleClick={stop} onClick={(e) => { e.stopPropagation(); h.toggle(node); }} title={n.done ? 'Not done after all' : 'Done'}>
            {n.done && <Icon name="check" size={12} />}
          </button>
          <div className="cv-step-words">
            <div className="cv-step-what">
              <Inline text={n.what} from={from} />
            </div>
            {(n.who || n.when) && (
              <div className="cv-step-meta">
                {n.who && (
                  <span className="cv-owner">
                    <Avatar name={n.who} small />
                    {n.who}
                  </span>
                )}
                {n.when && <span className={`cv-due tone-${n.done ? 'none' : dueWords(n.when)?.tone ?? 'none'}`}>by {n.when}</span>}
              </div>
            )}
          </div>
        </div>
      );
    }
    case 'dates': {
      const d = item as ProjectDate;
      const nice = niceDate(d.when);
      const past = (readDate(d.when) ?? Infinity) < new Date().setHours(0, 0, 0, 0);
      return (
        <div className={`cv-date${past ? ' past' : ''}`}>
          <span className="cv-cal">
            {nice ? (
              <>
                <span className="cv-cal-day">{nice.day}</span>
                <span className="cv-cal-month">{nice.month}</span>
              </>
            ) : (
              <span className="cv-cal-month">{d.when}</span>
            )}
          </span>
          <span className="cv-date-words">
            <span className="cv-date-what">
              <Inline text={d.what} from={from} />
            </span>
            {d.status && <span className={`cv-status s-${d.status.toLowerCase().replace(/\s+/g, '-')}`}>{d.status}</span>}
          </span>
        </div>
      );
    }
    case 'people': {
      const x = item as ProjectPerson;
      return (
        <div className="cv-person">
          <Avatar name={x.name} />
          <span className="cv-person-words">
            <span className="cv-person-name">{x.name}</span>
            {x.role && <span className="cv-person-role">{x.role}</span>}
          </span>
        </div>
      );
    }
    case 'risks': {
      const r = item as ProjectRisk;
      const tone = LEVEL_TONE[r.level ?? ''] ?? 'none';
      return (
        <div className={`cv-risk tone-${tone}`}>
          <button className={`cv-level tone-${tone}`} disabled={!h.canEdit} onPointerDown={stop} onDoubleClick={stop} onClick={(e) => { e.stopPropagation(); h.level(node, e); }} title="How much it matters">
            {r.level ? cap(r.level) : 'Level'}
            {h.canEdit && <Icon name="chevronDown" size={10} />}
          </button>
          <div className="cv-risk-what">
            <Inline text={r.what} from={from} />
          </div>
        </div>
      );
    }
    case 'documents': {
      const d = item as ProjectDocument;
      return <DocFace rel={d.path} what={d.what} h={h} />;
    }
  }
}

function NotesFace({ text, from }: { text: string; from: string }) {
  const html = useMemo(() => (text.trim() ? renderMarkdown(text, { from }) : ''), [text, from]);
  if (!html) return <div className="cv-notes-empty">Your own notes for this project. Double-click to write.</div>;
  return (
    <div
      className="markdown canvas-markdown cv-notes"
      onClick={(e) => {
        const target = wikilinkFromClick(e);
        if (target !== null) {
          e.preventDefault();
          e.stopPropagation();
          void A.openLink(target, from, e.ctrlKey || e.metaKey ? 'tab' : 'current');
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** What a bound card shows (null: the canvas draws it as an ordinary card). */
export function BoundFace({ node, h }: { node: CanvasNode; h: BoundHandlers }) {
  const b = node.neuralvault as NodeBinding | undefined;
  const from = h.projectPath ?? '';
  if (!b) return null;
  switch (b.part) {
    case 'project':
      return <ProjectFace path={b.project} p={h.project} h={h} />;
    case 'portfolio-project':
      return <ProjectFace path={b.project} p={h.entries.get(b.project)} h={h} compact />;
    case 'item':
      return <ItemFace node={node} section={b.section} h={h} from={from} />;
    case 'notes':
      return <NotesFace text={node.text ?? ''} from={from} />;
    case 'file':
      return <DocFace rel={b.rel} h={h} copied />;
    default:
      return null;
  }
}

/** The words a bound card edits, when it has any. */
export function editableWords(node: CanvasNode): string | null {
  const b = node.neuralvault;
  if (b?.part === 'notes') return node.text ?? '';
  if (b?.part !== 'item') return null;
  const item = parseItem(b.section, node.text ?? '');
  return item ? itemWords(b.section, item) : null;
}

/** A card drawn from a project (a doc's cards are ordinary file cards: src/shared/doc-canvas.ts). */
export const isBoundCard = (node: CanvasNode) => !!node.neuralvault && node.type !== 'group' && node.neuralvault.part !== 'doc' && node.neuralvault.part !== 'section';
export const ADDABLE: Partial<Record<BoundSection, string>> = { next: 'Add a next step', dates: 'Add a key date', risks: 'Add a risk or issue', people: 'Add a person' };
export const ADD_HINT: Partial<Record<BoundSection, string>> = { next: 'What needs doing: who, by when', dates: 'When: what happens', risks: 'What could go wrong', people: 'Name: their role' };
