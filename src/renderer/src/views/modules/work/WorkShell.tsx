// The work modules' shared page blocks (Wave 6 part b): the page's shell (its header, its row of pages, a record's own
// page with the way back), a tile, a card, and the record views every workspace uses, kept in the vault as the person
// leaves them (.neuralvault/module-options.json). Each module's page (MeetingsPage, WeeklyPage, SitesPage, VendorsPage)
// is made of these, so the four read and behave as one.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { moduleFolder, type RecordModule } from '../../../../../shared/module-records';
import { getAreas } from '../../../state/areas';
import { addFromFiles } from '../recordActions';
import { cleanRecordView, fieldsOf, type RecordViewDef } from '../../../../../shared/record-views';
import type { FieldValue, RecordKind, WsRecord } from '../../../../../shared/workspace-records';
import { Icon, type IconName } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import { ShareButton } from '../../../components/ShareButton';
import { DesignButton } from '../../../components/DesignButton';
import * as A from '../../../state/actions';
import { openModule, partOfTab } from '../../../state/modules';
import { peek } from '../../../state/peek';
import { useApp } from '../../../state/store';
import { useWorkOptions, workCall, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { PageHead } from '../../../components/PageHead';
import { RecordView } from '../../workspace/RecordView';
import { RecordContext, type RecordCtx } from '../../workspace/recordParts';
import { RecordFormHost } from '../RecordForm';
import { moduleInfo } from '../../../../../shared/life-modules';
import { ModuleTour } from '../ModuleTour';

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Two module rows naming the same record (9.2 uplift F49): its note's path when both rows know one, else
 *  its exact display name — names display-only, so two spellings or a rename never split or orphan records. */
export const sameRecord = (aPath: string | null, aName: string, bPath: string | null, bName: string): boolean =>
  aPath && bPath ? aPath === bPath : aName.toLowerCase() === bName.toLowerCase();

/** The page a tab is at: one of the module's pages, or a record's own page ("site:<path>"). */
export function placeOf(tab: W.TabState, module: RecordModule, sections = module.sections): { section: string; detail: { kind: string; key: string; label?: string } | null } {
  const part = partOfTab(tab) ?? 'overview';
  const m = /^([a-z]+):(.+)$/.exec(part);
  if (m) {
    // The key is encoded, so a raw colon only ever separates the key from the label after it.
    const at = m[2].indexOf(':');
    const key = at < 0 ? m[2] : m[2].slice(0, at);
    const label = at < 0 ? undefined : unkey(m[2].slice(at + 1));
    return { section: m[1], detail: { kind: m[1], key: unkey(key), ...(label ? { label } : {}) } };
  }
  return { section: sections.some((s) => s.id === part) ? part : 'overview', detail: null };
}

/** A record's own page in the module's tab ("site:<path>"): the key kept without its slashes or #, so the tab's path
 *  never reads as folders (the page's header shows a path's folders as its trail). The label names the record for
 *  the tab bar when its key is not its name (a Systems list row's path). */
export const openDetail = (module: string, kind: string, key: string, label?: string) => openModule(module, `${kind}:${encodeURIComponent(key)}${label ? `:${encodeURIComponent(label)}` : ''}`);
const unkey = (key: string) => {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
};

export interface Detail {
  /** The record's name, as the page's title. */
  title: string;
  line?: string;
  /** The page it was opened from, for the way back. */
  back: { section: string; label: string };
  /** A pill beside the title (its status). */
  badge?: ReactNode;
}

export function WorkShell({ tab: _tab, module, sections, here, actions, more, detail, sharePath, children }: { tab: W.TabState; module: RecordModule; sections: RecordModule['sections']; here: string; actions?: ReactNode; more?(): MenuItem[]; detail?: Detail | null; sharePath?: string; children: ReactNode }) {
  void _tab;
  const info = sections.find((s) => s.id === here) ?? sections[0];
  const tour = moduleInfo(module.id);
  const canEdit = useApp((s) => s.canEdit);
  return (
    <div className={`sv-page rm-page wm-page wm-${module.id}${detail ? ' has-detail' : ''}`}>
      {/* One page header for every module page (8.0 section D): PageHead, no icon-tile header. */}
      <PageHead
        icon={module.icon as IconName}
        title={detail ? <>{detail.title}{detail.badge}</> : module.name}
        lead={<>{detail ? detail.line : info.line}{tour && <ModuleTour module={tour} sep={Boolean(detail ? detail.line : info.line)} />}</>}
        actions={
          <>
            {detail && (
              <button type="button" className="sv-tool wm-back" onClick={() => openModule(module.id, detail.back.section)}>
                <Icon name="back" size={12} /> {detail.back.label}
              </button>
            )}
            {!detail && canEdit && (
              <button
                type="button"
                className="sv-tool"
                title={`Bookings, papers, scans or spreadsheets, kept in ${module.name}’s Files`}
                onClick={() => void addFromFiles(module.name, moduleFolder(module.id, getAreas()?.areas ?? null), `add what they hold to ${module.name} as its own records (${module.types.map((t) => t.plural.toLowerCase()).join(', ')}), each with the fields ${module.name} keeps, and keep each file with its record.`)}
              >
                <Icon name="files" size={14} /> Add from a file
              </button>
            )}
            {actions}
            {sharePath && <DesignButton path={sharePath} className="sv-tool" />}
            {sharePath && <ShareButton path={sharePath} className="sv-tool" />}
            {more && (
              <button type="button" className="sv-tool sv-tool-icon" aria-label={`More for ${module.name}`} title="More" onClick={(e) => openMenu(e.currentTarget, more())}>
                <Icon name="more" size={15} />
              </button>
            )}
          </>
        }
      />
      <nav className="rm-tabs" role="tablist" aria-label={`${module.name} pages`}>
        {sections.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={!detail && here === s.id} className={`rm-tab${(!detail && here === s.id) || (detail && detail.back.section === s.id) ? ' is-on' : ''}`} onClick={() => openModule(module.id, s.id)}>
            <Icon name={s.icon as IconName} size={13} />
            {s.label}
          </button>
        ))}
      </nav>
      <div className="sv-body rm-body wm-body">{children}</div>
      <RecordFormHost />
    </div>
  );
}

export function Tile({ icon, label, value, sub, tone, onClick }: { icon: IconName; label: string; value: string; sub?: string; tone?: 'bad' | 'warn' | 'ok'; onClick?(): void }) {
  const body = (
    <>
      <span className="rm-tile-label">
        <Icon name={icon} size={13} /> {label}
      </span>
      <span className="rm-tile-value">{value}</span>
      {sub && <span className="rm-tile-sub">{sub}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={`rm-tile${tone ? ` tone-${tone}` : ''}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={`rm-tile${tone ? ` tone-${tone}` : ''}`}>{body}</div>
  );
}

export function Card({ id, title, count, link, actions, children, className }: { id: string; title: string; count?: number; link?: { label: string; run(): void }; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rm-card wm-card${className ? ` ${className}` : ''}`} aria-labelledby={`wm-${id}`}>
      <header className="rm-card-head">
        <h3 id={`wm-${id}`}>
          {title}
          {typeof count === 'number' && count > 0 && <span className="rm-faint wm-count">{count}</span>}
        </h3>
        <span className="wm-card-tools">
          {actions}
          {link && (
            <button type="button" className="text-button" onClick={link.run}>
              {link.label}
            </button>
          )}
        </span>
      </header>
      {children}
    </section>
  );
}

/** The record views' context for a module's records: one click opens the record (the peek, or its own page), a value
 *  changes with a double-click, written by the module's own "set-field" job. */
export function useWorkCtx(module: string, records: WsRecord[], opts: { editable(r: WsRecord): string[]; open?(r: WsRecord, e?: { ctrlKey?: boolean; metaKey?: boolean }): void; removeRecord?(r: WsRecord): void; people?: string[] }): RecordCtx {
  const canEdit = useApp((s) => s.canEdit);
  // Who the person is (Today's own reading), so their own name stays off their own items in every record view.
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void window.nv?.today?.data?.().then((d) => live && setMe(d.me ?? null), () => undefined);
    return () => void (live = false);
  }, []);
  return useMemo(
    () => ({
      canEdit,
      fields: fieldsOf(records),
      editable: opts.editable,
      setField: async (r: WsRecord, field: string, value: FieldValue) => {
        // The job answers null when it has nothing to add: written all the same.
        const done = await workDid(workCall<string | null>(module, 'set-field', { kind: r.kind, id: r.id, path: r.path ?? null, ref: r.ref ?? null, field, value }).then((said) => ({ said })), (x) => x.said ?? '');
        return done !== null;
      },
      open: (r: WsRecord, e?: { ctrlKey?: boolean; metaKey?: boolean }) => {
        if (opts.open) return opts.open(r, e);
        if (!r.path) return;
        if (e?.ctrlKey || e?.metaKey) return A.openPath(r.path, { where: 'tab' });
        peek({ type: 'note', path: r.path }, { title: r.title, type: 'note' });
      },
      ...(opts.removeRecord ? { removeRecord: opts.removeRecord } : {}),
      plan: () => null,
      drop: () => undefined,
      byId: new Map(records.map((r) => [r.id, r])),
      people: opts.people ?? [],
      me,
    }),
    [records, canEdit, module, me],
  );
}

/** A page's views: as the module first makes them, with the person's changes kept in the vault. */
export function WorkViews({ module, section, made, records, onAdd, addKinds, counted }: { module: string; section: string; made: RecordViewDef[]; records: WsRecord[]; onAdd?(kind: RecordKind, words: string): Promise<boolean>; addKinds?: RecordKind[]; counted?(rows: WsRecord[]): number }) {
  const { options, save } = useWorkOptions(module);
  const saved = options?.[module]?.views ?? {};
  return (
    <div className="rm-views">
      {made.map((first, i) => {
        const key = `${section}:${i}`;
        const def: RecordViewDef = saved[key] ? { ...cleanRecordView(saved[key]), scope: 'vault' } : first;
        const keep = (next: RecordViewDef | null) => void save({ views: { [key]: next } as Record<string, unknown> });
        return <RecordView key={key} def={def} records={records} titled={made.length > 1} onChange={(d) => keep(d)} onReset={saved[key] ? () => keep(null) : undefined} {...(onAdd ? { onAdd, addKinds } : {})} {...(counted ? { counted } : {})} />;
      })}
    </div>
  );
}

/** The provider for a page's record views. */
export function WithRecords({ ctx, children }: { ctx: RecordCtx; children: ReactNode }) {
  return <RecordContext.Provider value={ctx}>{children}</RecordContext.Provider>;
}

/** A small pill with a tone (a flag, a status). */
export function Pill({ tone, children, title }: { tone?: 'ok' | 'warn' | 'bad' | 'next' | 'none'; children: ReactNode; title?: string }) {
  return (
    <span className={`rm-pill tone-${tone ?? 'none'}`} title={title}>
      {children}
    </span>
  );
}

/** "Mon 26 Oct" (with the year when it isn't this one). */
export function dayText(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** "in 3 days", "today", "2 days ago". */
export function inDays(iso: string | null | undefined, today = todayIso()): string {
  if (!iso) return '';
  const a = new Date(`${today}T12:00:00`).getTime();
  const b = new Date(`${iso.slice(0, 10)}T12:00:00`).getTime();
  const n = Math.round((b - a) / 86_400_000);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
