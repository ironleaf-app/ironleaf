// A project's Overview (23 Oct 2026, workstream 1 part C): the first thing a project opens to. One calm screen: where
// the project is in its life, what needs attention now, my actions, who I'm waiting on (with Chase, which drafts a
// message and never sends it), the next milestones on a small timeline, the latest files by purpose, what changed lately
// and who changed it, the people and their parts, and the decisions. Every row goes exactly to its item
// (src/renderer/src/views/project/hubOpen.ts); empty tiles step aside. Worked out by src/shared/project-hub.ts from the
// project file as written, with the project's actions written elsewhere (a meeting's actions, task lines in its notes)
// from the connected vault (src/shared/records.ts connectedActions), so one source decides what needs attention here and
// in the side chat, the former host app and a chat bot (records.ts projectNeeds).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProjectChange } from '../../../../shared/project-hub';
import { filesByPurpose, hubModel, itemKey, projectCountdown, projectMilestones, type Attention, type HubAction, type HubFileIn, type HubMilestone, type ItemRef } from '../../../../shared/project-hub';
import type { ProjectFiles, ProjectView } from '../../../../shared/types';
import { authorWords } from '../../../../shared/versions';
import { dayFrom, readDay, shortDay, todayDay, ymd } from '../../../../shared/timeline';
import { Icon, type IconName } from '../../components/Icon';
import { renderInline, wikilinkFromClick } from '../../lib/markdownRender';
import { initials, personHue } from '../../lib/projectLook';
import * as A from '../../state/actions';
import { askInChat } from '../../state/chat';
import { closePeek } from '../../state/peek';
import { showError, toast, useApp } from '../../state/store';
import { useEditor } from './Inline';
import { Lifecycle } from './Lifecycle';
import { openHubItem, useConnected, type OpenContext } from './hubOpen';
import { ProjectChecksTile, useDismissedKeys, useProjectCheckState } from './ProjectChecks';
import { categoryOf } from './fileModel';
import { ProjectWorkTiles, useProjectWork } from '../modules/work/ProjectWorkTiles';
import { DatePill } from '../../components/plan/DatePill';
import { OwnerChip } from '../../components/plan/OwnerChip';
import { PlanRow } from '../../components/plan/PlanRow';
import { DateStrip } from '../../components/DateStrip';
import type { StripStop } from '../../../../shared/date-strip';
import { revealItem } from '../timeline/reveal';

const dayOfMs = (ms: number) => {
  const d = new Date(ms);
  return dayFrom(d.getFullYear(), d.getMonth(), d.getDate());
};
const daysWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const base = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;
const plain = (s: string) => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');

/** The project's files and notes, as the hub reads them: Documents, its folder's files and its own notes (5 Nov
 *  2026, v9-vault-truth: notes that merely link to it are see-also on the Notes tab, never its files). */
export function hubFiles(view: ProjectView, files: ProjectFiles | null | undefined, byPath: Map<string, { mtime: number; props: Record<string, unknown> }>): HubFileIn[] {
  const p = view.project;
  const out: HubFileIn[] = [];
  for (const raw of p.documents) {
    // A line naming several notes ("[[A]] and [[B]] — what"): the first one, the line's words as its name.
    const many = /\[\[([^\]|]+)/.exec(raw.path);
    const d = many ? { ...raw, path: many[1].trim(), link: `[[${many[1].trim()}]]` } : raw;
    const isNote = !!d.link && !/\.[a-z0-9]{2,5}$/i.test(d.path);
    const note = isNote ? [...byPath.keys()].find((k) => k.toLowerCase().endsWith(`/${d.path.toLowerCase()}.md`) || k.toLowerCase() === `${d.path.toLowerCase()}.md`) : undefined;
    out.push({ path: note ?? d.path, name: many ? plain(raw.path) : base(d.path), ...(d.what ? { what: plain(d.what) } : {}), pinned: true, ...(d.link ? { link: d.link } : {}), ...(note ? { note: true, modified: byPath.get(note)?.mtime } : {}) });
  }
  for (const g of files?.groups ?? []) for (const f of g.files) out.push({ path: f.rel, name: f.name, modified: f.modified });
  for (const n of view.notes) {
    const type = String(byPath.get(n.path)?.props?.type ?? '').toLowerCase();
    // People are the People tile's; daily notes, hubs and other projects aren't this project's files.
    if (/^(daily|home|templates?|people)\//i.test(n.path) || /^(project|hub|person|people|daily)$/.test(type) || /\bhub$/i.test(n.title)) continue;
    out.push({ path: n.path, name: n.title, modified: n.modified, note: true });
  }
  return out;
}

export function ProjectHub({ view, files, ctx, onTab, timeline = true }: { view: ProjectView; files: ProjectFiles | null | undefined; ctx: OpenContext; onTab(tab: 'timeline' | 'details'): void; timeline?: boolean }) {
  const { canEdit, edit, path } = useEditor();
  const byPath = useApp((s) => s.byPath);
  const revision = useApp((s) => s.revision);
  const today = todayDay();
  const p = view.project;
  // The connected vault's view of the project: its actions written in meetings and notes, and who "me" is.
  const connected = useConnected(path);
  // The work modules' tiles for this project (Wave 6 part b: weekly updates, meetings, sites, quotes and contracts).
  const work = useProjectWork(path);
  const hub = useMemo(() => hubModel({ project: p, props: view.props, today, ...(connected?.me ? { me: connected.me } : {}), connected: connected?.elsewhere ?? [] }), [p, view.props, today, connected]);
  const miles = useMemo(() => projectMilestones(p, today), [p, today]);
  // A strip stop goes to its row on the project's page (v9, 6 Nov 2026): the page opens at that very line.
  const openMilestoneRow = (m: HubMilestone) => {
    revealItem(path, itemKey(m.ref));
    A.openPath(path);
  };
  const fileList = useMemo(() => hubFiles(view, files, byPath), [view, files, byPath]);
  const groups = useMemo(() => filesByPurpose(fileList, today, 3), [fileList, today]);
  const [changes, setChanges] = useState<ProjectChange[]>([]);
  const [lifeOpen, setLifeOpen] = useState(false);
  useEffect(() => {
    let live = true;
    window.nv.projects.changes(path).then((c) => live && setChanges(c), () => live && setChanges([]));
    return () => void (live = false);
  }, [path, view.version, revision]);
  const go = (ref: ItemRef, title?: string) => (e?: React.MouseEvent) => void openHubItem(ctx, ref, title, e);
  const tick = (a: HubAction) => {
    // A tick box in a meeting or note of the project: ticked on its own line there.
    if (a.ref.kind === 'record') {
      if (a.task === undefined || a.ref.line === undefined) return;
      const done = !a.done;
      const atPath = a.ref.path;
      const atLine = a.ref.line;
      const stripBox = (line: string) => line.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[^\]]\]\s+/, '');
      return void window.nv.tasks
        .tick(atPath, atLine, a.task, done)
        .then((r) => toast(r.words, { label: 'Undo', run: () => void window.nv.tasks.tick(atPath, atLine, stripBox(r.line), !done).catch(showError) }), showError);
    }
    if (a.ref.kind === 'next') return void edit({ kind: 'change', list: 'next', index: a.ref.index, item: { done: !a.done } });
    if (a.ref.kind === 'run') {
      const x = p.extra.find((e) => e.heading === (a.ref as { section: string }).section);
      if (!x) return;
      const lines = x.body.split('\n');
      const l = lines[a.ref.line];
      if (!l || !/^\s*[-*+]\s+\[[ xX]\]/.test(l)) return;
      lines[a.ref.line] = l.replace(/\[([ xX])\]/, a.done ? '[ ]' : '[x]');
      void edit({ kind: 'section', heading: x.heading, body: lines.join('\n'), words: a.done ? `Put “${a.what.slice(0, 48)}” back on the list.` : `Ticked off “${a.what.slice(0, 48)}”.` });
    }
  };
  const chase = (person: string, items: HubAction[]) => {
    // The side chat takes the right side: a peek open there steps aside for it.
    closePeek();
    askInChat(
      `Draft a short, friendly chase message to ${person} about the project “${p.name}”, asking where these stand:\n${items.map((a) => `- ${plain(a.what)}${a.when ? ` (${a.when})` : ''}`).join('\n')}\n\nUse what the project says about each one. Write it ready to paste into an email or Teams; do not send anything and do not change any notes.`,
      path,
    );
  };

  const activity = useMemo(() => recentActivity(view, changes, fileList, today, (ref) => () => void openHubItem(ctx, ref)), [view, changes, fileList, today]);
  const counts = hub.counts;
  const planGroups = [
    { title: 'Late', items: hub.plan.late },
    { title: 'This week', items: hub.plan.week },
    { title: 'Later', items: hub.plan.later },
    { title: 'No date', items: hub.plan.undated },
  ].filter((g) => g.items.length > 0);
  const planTotal = hub.plan.late.length + hub.plan.week.length + hub.plan.later.length + hub.plan.undated.length;
  const planKeys = new Set([...hub.plan.late, ...hub.plan.week, ...hub.plan.later, ...hub.plan.undated].map((a) => itemKey(a.ref)));
  const alsoNeeds = hub.attention.filter((a) => !planKeys.has(itemKey(a.ref)));
  const summary = p.summary.trim();
  // The day the project counts to: its due date in the future, else its go-live, else the next milestone after
  // today (never one that is today: "0 days to the next milestone" for a weekly meeting, 29 Oct 2026).
  const countdown = (() => {
    const c = projectCountdown(p, today, view.props);
    if (!c) return null;
    const open = c.target === 'milestone' && c.milestone ? go(c.milestone.ref, c.milestone.what) : c.target === 'due' ? go({ kind: 'due' }) : () => onTab(timeline ? 'timeline' : 'details');
    return { days: c.days, label: c.label, open };
  })();

  const planTile = (planGroups.length > 0 || alsoNeeds.length > 0) && (
    <Tile key="plan" area="plan" icon="task" title="Your next steps" count={planTotal} action={<TileLink onClick={go({ kind: 'section', heading: 'actions' })}>All actions</TileLink>}>
      {planGroups.map((g) => (
        <PlanGroup key={g.title} title={g.title} items={g.items} today={today} canEdit={canEdit} onTick={tick} onOpen={(a) => go(a.ref, a.what)} from={path} />
      ))}
      {alsoNeeds.length > 0 && (
        <>
          <h5 className="ph-sub">Also needs you</h5>
          <ul className="ph-list">
            {alsoNeeds.map((a) => (
              <AttentionRow key={a.id} a={a} today={today} onOpen={go(a.ref, a.title)} />
            ))}
          </ul>
        </>
      )}
    </Tile>
  );

  const tiles = {
    waiting: hub.waiting.length > 0 && (
      <Tile key="waiting" area="waiting" icon="people" title="Waiting on others" count={counts.waiting}>
        <ul className="ph-wait">
          {hub.waiting.map((g) => (
            <li key={g.person} className="ph-wait-group">
              <div className="ph-wait-head">
                <button className="ph-person-chip" onClick={go({ kind: 'person', name: g.person }, g.person)} title={`Everything about ${g.person}`}>
                  <span className="pj-avatar small" style={{ ['--hue' as string]: personHue(g.person) }}>
                    {initials(g.person)}
                  </span>
                  <span className="ph-wait-name">{g.person}</span>
                </button>
                <span className={`ph-wait-age${g.overdue ? ' is-bad' : (g.waitingDays ?? 0) >= 7 ? ' is-warn' : ''}`}>
                  {g.overdue ? `${g.overdue} overdue` : g.waitingDays !== undefined ? `waiting ${daysWord(g.waitingDays)}` : g.heard !== undefined ? `heard ${shortDay(g.heard, today)}` : `${g.items.length} open`}
                </span>
                <button className="ph-chase" title={`Draft a message to ${g.person} asking where these stand (nothing is sent)`} onClick={() => chase(g.person, g.items)}>
                  <Icon name="send" size={11} /> Chase
                </button>
              </div>
              <ul className="ph-list ph-wait-items">
                {g.items.slice(0, 3).map((a) => (
                  <li key={a.id}>
                    <button className="ph-row ph-row-plain" onClick={go(a.ref, a.what)}>
                      <span className="ph-row-words ph-clamp">{plain(a.what)}</span>
                      {a.due !== undefined && <DatePill day={a.due} today={today} />}
                    </button>
                  </li>
                ))}
                {g.items.length > 3 && <li className="ph-faint ph-indent">and {g.items.length - 3} more</li>}
              </ul>
            </li>
          ))}
        </ul>
      </Tile>
    ),
    milestones: hub.upcoming.length > 0 && (
      <Tile key="milestones" area="milestones" icon="timeline" title="Next milestones" action={timeline ? <TileLink onClick={() => onTab('timeline')}>Timeline</TileLink> : undefined}>
        <MilestoneStrip miles={miles} today={today} onRow={openMilestoneRow} />
        <ul className="ph-list">
          {hub.upcoming.slice(0, 5).map((m) => (
            <PlanRow key={m.id} title={plain(m.what)} day={m.day!} today={today} onOpen={go(m.ref, m.what)} />
          ))}
        </ul>
      </Tile>
    ),
    files: groups.length > 0 && (
      <Tile key="files" area="files" icon="folder" title="Latest files" action={<TileLink onClick={go({ kind: 'section', heading: 'files' })}>All files</TileLink>}>
        <div className="ph-files">
          {groups.slice(0, 5).map((g) => (
            <div key={g.purpose} className="ph-file-group">
              <h5 className="ph-sub">{g.words}</h5>
              <ul className="ph-list">
                {g.files.map((f) => (
                  <li key={f.path}>
                    <button className="ph-row" title={f.what ? `${f.name}\n${f.what}` : f.name} onClick={go({ kind: 'file', path: f.path, ...(f.link ? { link: f.link } : {}), ...(f.note ? { note: true } : {}) }, f.name)}>
                      <FileGlyph name={f.name} note={f.note} />
                      <span className="ph-row-words">
                        <span className="ph-file-name">{f.note ? f.name : f.name}</span>
                        {f.what && <span className="ph-file-what">{f.what}</span>}
                      </span>
                      {f.day !== undefined && <span className="ph-when">{shortDay(f.day, today)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Tile>
    ),
    activity: activity.length > 0 && (
      <Tile key="activity" area="activity" icon="history" title="Recent activity">
        <ol className="ph-activity">
          {activity.slice(0, 8).map((x, i) => (
            <li key={i} className="ph-act">
              <span className={`ph-act-icon kind-${x.kind}`}>
                <Icon name={x.icon} size={12} />
              </span>
              <span className="ph-act-body">
                {x.open ? (
                  <button className="ph-act-words" onClick={x.open}>
                    {x.words}
                  </button>
                ) : (
                  <span className="ph-act-words">{x.words}</span>
                )}
                <span className="ph-act-meta">
                  {x.who ? `${x.who} · ` : ''}
                  {x.whenWords}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Tile>
    ),
    people: hub.people.length > 0 && (
      <Tile key="people" area="people" icon="person" title="People" count={hub.people.length} action={<TileLink onClick={go({ kind: 'section', heading: 'people' })}>All</TileLink>}>
        <ul className="ph-people">
          {[...hub.people].sort((a, b) => b.open - a.open).slice(0, 8).map((x) => (
            <li key={x.name}>
              <button className="ph-person" onClick={go({ kind: 'person', name: x.name }, x.name)} title={`Everything about ${x.name}`}>
                <span className="pj-avatar" style={{ ['--hue' as string]: personHue(x.name) }}>
                  {initials(x.name)}
                </span>
                <span className="ph-person-words">
                  <span className="ph-person-name">{x.name}</span>
                  {(x.role || x.company) && <span className="ph-person-role">{[x.role, x.company].filter(Boolean).join(' · ')}</span>}
                </span>
                {x.open > 0 && <span className={`ph-badge${x.overdue ? ' is-bad' : ''}`}>{x.open} open</span>}
              </button>
            </li>
          ))}
        </ul>
        {hub.people.length > 8 && <p className="ph-faint ph-indent">and {hub.people.length - 8} more</p>}
      </Tile>
    ),
    decisions: hub.decisions.length > 0 && (
      <Tile key="decisions" area="decisions" icon="check" title="Decisions" count={hub.decisions.length} action={<TileLink onClick={go({ kind: 'section', heading: 'decisions' })}>All</TileLink>}>
        <ul className="ph-list">
          {hub.decisions.slice(0, 4).map((d) => (
            <li key={`${d.ref.kind}:${'index' in d.ref ? d.ref.index : ''}`}>
              <button className="ph-row ph-row-top" onClick={go(d.ref, d.what)}>
                <span className="ph-row-words">
                  <span className="ph-clamp">{plain(d.what)}</span>
                  {d.why && <span className="ph-why ph-clamp">{plain(d.why)}</span>}
                </span>
                {d.day !== undefined && <span className="ph-when">{shortDay(d.day, today)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </Tile>
    ),
  };

  const workTiles = work.length > 0 && <ProjectWorkTiles key="work" work={work} />;
  const firstLeft = [tiles.waiting].filter(Boolean);
  const firstRight = [tiles.milestones].filter(Boolean);
  const moreLeft = [workTiles, tiles.files, tiles.decisions].filter(Boolean);
  const moreRight = [tiles.activity, tiles.people].filter(Boolean);
  // Catch-up (10.0 item 19): what waits from the notes, with its review. Mounted only when something waits (dismissed
  // lines don't count), so the layout counts it like any tile.
  const catchState = useProjectCheckState(path, view.version);
  const catchDismissed = useDismissedKeys(path);
  const showCatchup = !!catchState && (catchState.checks.length > 0 || catchState.proposals.some((p) => !catchDismissed.has(p.key)));
  const hasAny = !!(showCatchup || planTile || firstLeft.length || firstRight.length || moreLeft.length || moreRight.length || hub.toConfirm.length);
  return (
    <div className="ph-hub">
      <Lifecycle view={view} files={fileList} open={lifeOpen} onOpen={setLifeOpen} />
      {/* The key figures as one subtitle line, not big tiles (29 Oct 2026, redesign principle 4). */}
      <p className="ph-figures">
        {/* The separators trail in the shared units (page-frame.css), as Today's: the line breaks only after one. */}
        <span className="nv-fig">
          <button className="ph-figure" onClick={go({ kind: 'section', heading: 'actions' })}>
            <strong className={hub.plan.late.length ? 'is-bad' : undefined}>{hub.plan.late.length} late</strong> for you
          </button>
          <span className="ph-sep" aria-hidden="true">·</span>
        </span>
        <span className="nv-fig">
          <button className="ph-figure" onClick={go({ kind: 'section', heading: 'actions' })}>{hub.plan.week.length} this week</button>
          <span className="ph-sep" aria-hidden="true">·</span>
        </span>
        <span className="nv-fig">
          <span>{counts.waiting} waiting on others</span>
          {countdown && <span className="ph-sep" aria-hidden="true">·</span>}
        </span>
        {countdown && (
          <span className="nv-fig">
            <button className="ph-figure" onClick={countdown.open}>
              {countdown.days} {countdown.days === 1 ? 'day' : 'days'} {countdown.label}
            </button>
          </span>
        )}
      </p>
      {summary && <Summary text={summary} from={path} />}
      {hub.next && <NextLine a={hub.next} today={today} onOpen={go(hub.next.ref, hub.next.what)} from={path} />}
      {showCatchup && catchState && <ProjectChecksTile state={catchState} onOpen={(ref, title) => go(ref, title)()} />}
      {!hasAny ? (
        <div className="ph-empty-hub">
          <Icon name="sparkle" size={18} />
          <div>
            <strong>Nothing to show here yet</strong>
            <p>Add what needs doing, the key dates and the people in Details, and this overview fills itself in.</p>
          </div>
          <button className="button" onClick={() => onTab('details')}>
            Open Details
          </button>
        </div>
      ) : (
        <>
          {planTile && <div className="ph-plan">{planTile}</div>}
          {firstLeft.length + firstRight.length > 0 && (
            <div className={`ph-grid${firstRight.length === 0 || firstLeft.length === 0 ? ' is-one' : ''}`}>
              <div className="ph-col">{firstLeft}</div>
              <div className="ph-col side">{firstRight}</div>
            </div>
          )}
          {hub.toConfirm.length > 0 && (
            <details className="ph-confirm">
              <summary>Dates that went by: did they happen? {hub.toConfirm.length}</summary>
              <ul className="ph-list">
                {hub.toConfirm.map((a) => (
                  <AttentionRow key={a.id} a={a} today={today} onOpen={go(a.ref, a.title)} />
                ))}
              </ul>
            </details>
          )}
          {moreLeft.length + moreRight.length > 0 && (
            <details className="ph-more-fold">
              <summary>More about this project</summary>
              <div className={`ph-grid${moreRight.length === 0 || moreLeft.length === 0 ? ' is-one' : ''}`}>
                <div className="ph-col">{moreLeft}</div>
                <div className="ph-col side">{moreRight}</div>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function Tile({ area, icon, title, count, tone, action, children }: { area: string; icon: IconName; title: string; count?: number; tone?: 'bad'; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={`ph-tile ph-a-${area}`} data-hub-tile={area}>
      <header className="ph-tile-head">
        <Icon name={icon} size={14} />
        <h3>{title}</h3>
        {typeof count === 'number' && count > 0 && <span className={`ph-count${tone === 'bad' ? ' is-bad' : ''}`}>{count}</span>}
        <span className="ph-space" />
        {action}
      </header>
      {children}
    </section>
  );
}

function TileLink({ onClick, children }: { onClick(e: React.MouseEvent): void; children: ReactNode }) {
  return (
    <button className="ph-tile-link" onClick={onClick}>
      {children} <Icon name="forward" size={11} />
    </button>
  );
}

function Summary({ text, from }: { text: string; from: string }) {
  const [more, setMore] = useState(false);
  const html = useMemo(() => renderInline(text.replace(/\n{2,}/g, '  \n'), { from }), [text, from]);
  const long = text.length > 320;
  return (
    <div className={`ph-summary${more || !long ? ' is-open' : ''}`}>
      <p
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => {
          const target = wikilinkFromClick(e);
          if (target !== null) {
            e.preventDefault();
            void A.openLink(target, from, e.ctrlKey || e.metaKey ? 'tab' : 'current');
          }
        }}
      />
      {long && (
        <button className="ph-more" onClick={() => setMore(!more)}>
          {more ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}

function AttentionRow({ a, today, onOpen }: { a: Attention; today: number; onOpen(e: React.MouseEvent): void }) {
  const icon: IconName = a.kind === 'expiring' ? 'clock' : a.kind === 'waiting' || a.kind === 'silent' ? 'people' : a.kind === 'risk' ? 'warning' : a.kind === 'soon' ? 'calendar' : a.kind === 'unowned' ? 'person' : a.kind === 'late' ? 'flag' : 'clock';
  return (
    <li>
      <button className={`ph-row ph-att tone-${a.tone}`} onClick={onOpen}>
        <span className="ph-att-icon">
          <Icon name={icon} size={13} />
        </span>
        <span className="ph-row-words">
          <span className="ph-att-title ph-clamp">{plain(a.title)}</span>
          <span className="ph-att-detail">{a.detail}</span>
        </span>
        {a.day !== undefined && a.kind !== 'silent' && a.kind !== 'waiting' && <span className="ph-when">{shortDay(a.day, today)}</span>}
      </button>
    </li>
  );
}

function ActionRow({ a, today, canEdit, onTick, onOpen, from }: { a: HubAction; today: number; canEdit: boolean; onTick(): void; onOpen(e: React.MouseEvent): void; from: string }) {
  const html = useMemo(() => renderInline(a.what, { from }), [a.what, from]);
  // Written in a meeting's notes as a plain line (no tick box there): nothing to tick here; it's done in the meeting.
  const tickable = a.ref.kind !== 'record' || a.task !== undefined;
  const meta = [a.unassigned && a.who ? plain(a.who) : a.phase ? a.phase.replace(/\s*\(.*\)$/, '') : '', a.from ? `From ${a.from}` : '', a.since !== undefined && a.due === undefined ? `asked ${shortDay(a.since, today)}` : ''].filter(Boolean);
  return (
    <li className={`ph-action${a.done ? ' is-done' : ''}`}>
      {tickable ? (
        <button className="ph-box" role="checkbox" aria-checked={a.done} disabled={!canEdit} title={a.done ? 'Put it back on the list' : a.ref.kind === 'record' && a.from ? `Tick it off (in ${a.from})` : 'Tick it off'} onClick={onTick}>
          {a.done && <Icon name="check" size={11} />}
        </button>
      ) : (
        <span className="ph-box is-dot" title={a.from ? `Written in ${a.from}` : 'Written in a note'} aria-hidden="true" />
      )}
      <button className="ph-row ph-row-plain" onClick={onOpen}>
        <span className="ph-row-words">
          <span className="ph-clamp" dangerouslySetInnerHTML={{ __html: html }} />
          {meta.length > 0 && <span className="ph-action-meta">{meta.join(' · ')}</span>}
        </span>
        {a.person && !a.mine && <OwnerChip name={a.person} />}
        {a.due !== undefined && <DatePill day={a.due} today={today} />}
      </button>
    </li>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function NextLine({ a, today, onOpen, from }: { a: HubAction; today: number; onOpen(e: React.MouseEvent): void; from: string }) {
  const html = useMemo(() => renderInline(a.what, { from }), [a.what, from]);
  const words = a.due === undefined ? 'No date' : a.overdue ? `${daysWord(today - a.due)} late` : a.due === today ? 'Today' : `${WEEKDAYS[ymd(a.due).weekday]} ${shortDay(a.due, today)}`;
  return (
    <button className={`ph-next${a.overdue ? ' is-late' : ''}`} onClick={onOpen}>
      <span className="ph-next-label">Next for you</span>
      <span className="ph-clamp" dangerouslySetInnerHTML={{ __html: html }} />
      <span className="ph-when">{words}</span>
    </button>
  );
}

function PlanGroup({ title, items, today, canEdit, onTick, onOpen, from }: { title: string; items: HubAction[]; today: number; canEdit: boolean; onTick(a: HubAction): void; onOpen(a: HubAction): (e: React.MouseEvent) => void; from: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 5);
  return (
    <div className="ph-plan-group">
      <h4>{title}</h4>
      <ul className="ph-list">
        {shown.map((a) => (
          <ActionRow key={a.id} a={a} today={today} canEdit={canEdit} onTick={() => onTick(a)} onOpen={onOpen(a)} from={from} />
        ))}
      </ul>
      {items.length > 5 && (
        <button className="ph-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show ${items.length - 5} more`}
        </button>
      )}
    </div>
  );
}

function FileGlyph({ name, note }: { name: string; note?: boolean }) {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '';
  const c = note ? 'note' : categoryOf(ext);
  const icon: IconName = note ? 'notes' : c === 'pdfs' ? 'pdf' : c === 'spreadsheets' ? 'table' : c === 'slides' ? 'present' : c === 'pictures' ? 'image' : c === 'documents' ? 'doc' : 'file';
  return (
    <span className={`ph-glyph kind-${c}`}>
      <Icon name={icon} size={13} />
    </span>
  );
}

/** The milestones on one strip (components/DateStrip.tsx, v9, 6 Nov 2026): every dated milestone shares the one
 *  mechanism with the dashboard's Milestones card — its own room in order, long gaps as marked breaks, Today at
 *  its true place. The rows below already name what's next, so the strip names what's late and last done; a stop
 *  goes to its row on the project's page. */
function MilestoneStrip({ miles, today, onRow }: { miles: HubMilestone[]; today: number; onRow(m: HubMilestone): void }) {
  const stops: StripStop[] = useMemo(() => miles.filter((m) => m.day !== undefined).map((m) => ({ id: m.id, day: m.day!, label: plain(m.what), date: shortDay(m.day!, today), done: m.done, late: m.late })), [miles, today]);
  const byId = useMemo(() => new Map(miles.map((m) => [m.id, m])), [miles]);
  if (!stops.length) return null;
  return <DateStrip stops={stops} today={today} keys={['late', 'last-done']} onOpen={(s) => { const m = byId.get(s.id); if (m) onRow(m); }} />;
}

// ── Recent activity ──────────────────────────────────────────────────────────────────────────────────────────────────

interface ActivityEntry {
  /** For sorting: ms, or a day's noon for what's dated only by its day. */
  at: number;
  kind: 'change' | 'update' | 'note' | 'file';
  icon: IconName;
  words: string;
  who?: string;
  whenWords: string;
  open?: () => void;
}

function whenWords(at: number, today: number, timed: boolean): string {
  const day = dayOfMs(at);
  const time = timed ? new Date(at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : '';
  if (day === today) return timed ? `Today ${time}` : 'Today';
  if (day === today - 1) return timed ? `Yesterday ${time}` : 'Yesterday';
  return shortDay(day, today);
}

/** What changed lately: the project file's changes (who made them), its updates, notes and files changed. */
function recentActivity(view: ProjectView, changes: ProjectChange[], files: HubFileIn[], today: number, opener: (ref: ItemRef) => () => void): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const noon = (day: number) => {
    const { y, m, d } = ymd(day);
    return new Date(y, m, d, 12).getTime();
  };
  for (const c of changes) {
    const who = c.by ? authorWords(c.by) : undefined;
    out.push({ at: c.time, kind: 'change', icon: 'pencil', words: c.words.slice(0, 2).join(' · ') + (c.words.length > 2 ? ` · and ${c.words.length - 2} more` : ''), ...(who && who !== 'Earlier edit' ? { who } : {}), whenWords: whenWords(c.time, today, true) });
  }
  view.project.updates.forEach((u, index) => {
    const day = readDay(u.date, today);
    if (day === null || day < today - 30) return;
    out.push({ at: noon(day) + index * -1, kind: 'update', icon: 'history', words: plain(u.what).slice(0, 200), ...(u.from ? { who: plain(u.from).replace(/\s*\(.*$/, '').slice(0, 40) } : {}), whenWords: whenWords(noon(day), today, false), open: opener({ kind: 'update', index }) });
  });
  for (const f of files) {
    if (!f.modified || dayOfMs(f.modified) < today - 14) continue;
    out.push({ at: f.modified, kind: f.note ? 'note' : 'file', icon: f.note ? 'notes' : 'file', words: `${f.note ? 'Note changed' : 'File changed'}: ${f.name}`, whenWords: whenWords(f.modified, today, true), open: opener({ kind: 'file', path: f.path, ...(f.link ? { link: f.link } : {}), ...(f.note ? { note: true } : {}) }) });
  }
  // Notes and files changed together (a sync, a copy) are one line.
  const together = new Map<string, ActivityEntry[]>();
  for (const x of out) if (x.kind === 'note' || x.kind === 'file') {
    const key = `${x.kind}:${Math.floor(x.at / 120000)}`;
    together.set(key, [...(together.get(key) ?? []), x]);
  }
  for (const list of together.values()) {
    if (list.length < 2) continue;
    const names = list.map((x) => x.words.replace(/^(Note|File) changed: /, ''));
    const first = list[0];
    first.words = `${list.length} ${first.kind === 'note' ? 'notes' : 'files'} changed: ${names.slice(0, 3).join(', ')}${names.length > 3 ? `, and ${names.length - 3} more` : ''}`;
    for (const x of list.slice(1)) out.splice(out.indexOf(x), 1);
  }
  // The newest first; an update and the change that wrote it say the same: the update stays.
  return out.sort((a, b) => b.at - a.at).filter((x, _i, all) => !(x.kind === 'change' && /^Update: /.test(x.words) && all.some((y) => y.kind === 'update' && x.words.includes(y.words.slice(0, 30)))));
}
