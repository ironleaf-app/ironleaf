// The life-OS windows (Wave 4, 24 Oct 2026): the move into areas (its proposal, the person's choices, the safety copy,
// the result and Undo), the areas editor, the tag manager, making cards for the people named in projects, and putting
// two names for one person together. Mounted once (App.tsx); it also reads the vault's areas when a vault opens and
// when the window comes back (another PC may have changed them).

import { useEffect, useMemo, useState } from 'react';
import { AREA_COLORS, AREA_ICONS, changeArea, moveArea, removeArea, writeAreas, type Area, type AreasConfig } from '../../../shared/areas';
import { cleanFileName } from '../../../shared/paths';
import { movesOf, SURE_WORDS, withChoices, type MigrationPlan, type UnitPlan } from '../../../shared/area-migration';
import type { MigrationApplied } from '../../../shared/life-api';
import type { CardSuggestion, SamePerson } from '../../../shared/people';
import { mergePreviewWords } from '../../../shared/people';
import type { TagUse } from '../../../shared/tags';
import { similarTags } from '../../../shared/tags';
import { defaultConfig } from '../../../shared/areas';
import { plural } from '../../../shared/words';
import { useEscape } from '../lib/useEscape';
import * as A from '../state/actions';
import { changeAreas, getAreas, loadAreas, newArea, openArea, renameArea, useAreas } from '../state/areas';
import { closeLife, lifeChanged, mergePair, useLifeModal } from '../state/life';
import { loadNotes, savePrefs, showError, toast, useApp } from '../state/store';
import { confirm } from './Dialogs';
import { Icon, type IconName } from './Icon';
import { openMenu } from './Menu';
import { isEnterKey } from '../lib/enterKey';

export function LifeHost() {
  const vault = useApp((s) => s.vault?.path ?? null);
  const modal = useLifeModal();
  useEffect(() => {
    void loadAreas(true);
  }, [vault]);
  useEffect(() => {
    const onFocus = () => void loadAreas(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  if (!modal) return null;
  if (modal.kind === 'migration') return <MigrationAssistant onClose={closeLife} />;
  if (modal.kind === 'areas') return <AreasEditor onClose={closeLife} />;
  if (modal.kind === 'tags') return <TagManager onClose={closeLife} start={modal.tag} />;
  if (modal.kind === 'make-cards') return <MakeCards onClose={closeLife} area={modal.area} />;
  if (modal.kind === 'same-people') return <SamePeople onClose={closeLife} />;
  return null;
}

function Frame({ title, line, icon, wide, onClose, children, foot }: { title: string; line?: string; icon: IconName; wide?: boolean; onClose(): void; children: React.ReactNode; foot?: React.ReactNode }) {
  useEscape(onClose);
  return (
    <div className="overlay life-overlay" onMouseDown={onClose}>
      <div className={`dialog life-dialog${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header className="ld-head">
          <span className="ld-mark" aria-hidden="true">
            <Icon name={icon} size={18} />
          </span>
          <div className="ld-words">
            <h2>{title}</h2>
            {line && <p className="ld-line">{line}</p>}
          </div>
          <button type="button" className="icon-button ld-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="ld-body">{children}</div>
        {foot && <footer className="ld-foot">{foot}</footer>}
      </div>
    </div>
  );
}

// ── The move into areas ───────────────────────────────────────────────────────────────────────────────────────────

const KIND_ICON: Record<UnitPlan['kind'], IconName> = { project: 'layers', person: 'person', meeting: 'calendar', doc: 'doc', note: 'notes', file: 'file' };
const KIND_WORD: Record<UnitPlan['kind'], string> = { project: 'Project', person: 'Person', meeting: 'Meeting', doc: 'Doc', note: 'Note', file: 'File' };

function MigrationAssistant({ onClose }: { onClose(): void }) {
  const had = useAreas();
  const canEdit = useApp((s) => s.canEdit);
  const [areas, setAreas] = useState<AreasConfig>(() => had ?? defaultConfig());
  const [step, setStep] = useState<'areas' | 'plan' | 'moving' | 'done'>(had ? 'plan' : 'areas');
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [result, setResult] = useState<MigrationApplied | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [newName, setNewName] = useState('');
  const capturePref = useApp((s) => s.settings?.prefs.captureNoProject);
  const [toInbox, setToInbox] = useState(true);
  const finish = () => {
    if (toInbox && capturePref !== 'inbox') void savePrefs({ captureNoProject: 'inbox', captureNoProjectChosen: true }).catch(showError);
    onClose();
  };
  useEffect(() => {
    if (step !== 'plan' || plan) return;
    void window.nv.life.migration.plan(writeAreas(areas)).then((r) => setPlan(r.plan), (err) => {
      showError(err);
      setStep('areas');
    });
  }, [step, plan, areas]);
  const shown = useMemo(() => (plan ? withChoices(plan, choices, areas.areas) : null), [plan, choices, areas]);
  const moving = shown ? shown.units.filter((u) => u.to) : [];
  const unsure = shown ? shown.units.filter((u) => !u.to) : [];
  const files = moving.reduce((s, u) => s + u.files, 0);
  const apply = async () => {
    if (!shown) return;
    setStep('moving');
    try {
      const r = await window.nv.life.migration.apply(choices, writeAreas(areas));
      setResult(r);
      await loadAreas(true);
      await loadNotes();
      lifeChanged();
      setStep('done');
    } catch (err) {
      showError(err);
      setStep('plan');
    }
  };
  const undo = async () => {
    if (!(await confirm('Undo the move into areas?', { message: 'Everything goes back where it was, and every link is brought back with it. The safety copy stays.', ok: 'Undo the move' }))) return;
    try {
      toast((await window.nv.life.migration.undo()).words);
      await loadNotes();
      onClose();
    } catch (err) {
      showError(err);
    }
  };

  if (step === 'areas') {
    const list = areas.areas;
    return (
      <Frame
        title="Organise your vault by area of life"
        line="Every project, note, person and file gets one home: the area of life it belongs to. Name the areas as you live them; you can change them any time."
        icon="layers"
        wide
        onClose={onClose}
        foot={
          <>
            <span className="ld-foot-note">
              <Icon name="info" size={13} /> Nothing moves yet: next you see where everything would go.
            </span>
            <span className="ld-space" />
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="button primary" disabled={!list.length} onClick={() => setStep('plan')}>
              See where everything would go
            </button>
          </>
        }
      >
        <ul className="ma-areas">
          {list.map((a, i) => (
            <li key={a.id} className={`ma-area nt-${a.color}`}>
              <span className="nt-chip" aria-hidden="true">
                <Icon name={a.icon as IconName} size={15} />
              </span>
              <input className="ma-area-name" value={a.name} aria-label="Area name" onChange={(e) => setAreas((c) => ({ ...c, areas: c.areas.map((x) => (x.id === a.id ? { ...x, name: e.target.value, folder: cleanFileName(e.target.value, x.folder, 60) } : x)) }))} />
              <input className="ma-area-about" value={a.about} placeholder="What it holds" aria-label={`What ${a.name} holds`} onChange={(e) => setAreas((c) => changeArea(c, a.id, { about: e.target.value }))} />
              {a.quiet && <span className="ma-quiet" title="Kept out of Today and search">Quiet</span>}
              <button type="button" className="icon-button" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => setAreas((c) => moveArea(c, a.id, -1))}>
                <Icon name="chevronDown" size={13} className="flip" />
              </button>
              <button type="button" className="icon-button" title="Take it off the list" aria-label={`Remove ${a.name}`} onClick={() => setAreas((c) => removeArea(c, a.id))}>
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="ma-add"
          onSubmit={(e) => {
            e.preventDefault();
            const n = newName.trim();
            if (!n || list.some((a) => a.name.toLowerCase() === n.toLowerCase())) return;
            setAreas((c) => ({ ...c, areas: [...c.areas, { id: n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `area-${c.areas.length}`, name: n, folder: cleanFileName(n, 'Area', 60), icon: 'layers', color: 'teal', about: '' }] }));
            setNewName('');
          }}
        >
          <Icon name="plus" size={14} />
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Add an area of your own (Home lab, Church, Sport…)" aria-label="A new area" />
          <button type="submit" className="button small" disabled={!newName.trim()}>
            Add
          </button>
        </form>
      </Frame>
    );
  }

  if (step === 'moving') {
    return (
      <Frame title="Moving into areas…" icon="layers" onClose={() => undefined}>
        <div className="ma-moving">
          <span className="ma-spinner" aria-hidden="true" />
          <div>
            <strong>Making the safety copy, then moving {moving.length} things</strong>
            <p className="ld-line">Every link is brought up to date as each one moves, and checked at the end.</p>
          </div>
        </div>
      </Frame>
    );
  }

  if (step === 'done' && result) {
    const first = areas.areas.find((a) => moving.some((u) => u.area === a.id));
    return (
      <Frame
        title="Your vault is organised by area"
        icon="check"
        onClose={onClose}
        foot={
          <>
            <button type="button" className="button" onClick={() => void undo()}>
              Undo the move
            </button>
            <span className="ld-space" />
            {first && (
              <button
                type="button"
                className="button"
                onClick={() => {
                  finish();
                  openArea(first.id);
                }}
              >
                Open {first.name}
              </button>
            )}
            <button type="button" className="button primary" onClick={finish}>
              Done
            </button>
          </>
        }
      >
        <div className="ma-result">
          <div className="ma-stat">
            <strong>{result.moved}</strong>
            <span>things moved ({result.files} files)</span>
          </div>
          <div className="ma-stat">
            <strong>{result.linksUpdated + result.linksPinned}</strong>
            <span>links brought up to date</span>
          </div>
          <div className="ma-stat">
            <strong>{result.followed}</strong>
            <span>places in views and properties followed</span>
          </div>
        </div>
        <p className="ma-safety">
          <Icon name="lock" size={13} /> A safety copy of the whole vault, as it was before, is in <code>{result.safety}</code>.
        </p>
        {capturePref !== 'inbox' && (
          <label className="ma-inbox-pref">
            <input type="checkbox" checked={toInbox} onChange={(e) => setToInbox(e.target.checked)} />
            <span>
              Send captures with no project to the <strong>Inbox</strong>, to file each into its area (from the capture box). Now they go in today’s note.
            </span>
          </label>
        )}
        {result.problems.length > 0 && (
          <div className="ma-problems">
            <strong>Left where they were</strong>
            <ul>
              {result.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </Frame>
    );
  }

  // The proposal.
  const groups = [{ id: '', name: 'Choose an area', units: unsure } as { id: string; name: string; units: UnitPlan[]; area?: Area }, ...areas.areas.map((a) => ({ id: a.id, name: a.name, area: a, units: moving.filter((u) => u.area === a.id) }))].filter((g) => g.units.length);
  const visible = filter === 'all' ? groups : groups.filter((g) => g.id === filter);
  return (
    <Frame
      title="Where everything would go"
      line="Read from what your vault already says: tags, links, who is named where, which projects sit together. Change any of it; nothing moves until you say."
      icon="layers"
      wide
      onClose={onClose}
      foot={
        <>
          <span className="ld-foot-note">
            <Icon name="lock" size={13} /> A safety copy of the whole vault is made first. Every link is brought up to date and checked.
          </span>
          <span className="ld-space" />
          <button type="button" className="button" onClick={() => setStep('areas')}>
            Change the areas
          </button>
          <button type="button" className="button primary" disabled={!canEdit || !moving.length} onClick={() => void apply()}>
            Move {moving.length} {moving.length === 1 ? 'thing' : 'things'}
          </button>
        </>
      }
    >
      {!shown ? (
        <div className="ma-moving">
          <span className="ma-spinner" aria-hidden="true" />
          <div>
            <strong>Reading your vault…</strong>
            <p className="ld-line">Projects, people, notes and files, and how they are joined.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="ma-summary" role="tablist" aria-label="Show">
            <button type="button" role="tab" aria-selected={filter === 'all'} className={`ma-sum${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>
              <strong>{moving.length}</strong>
              <span>to move · {files} files</span>
            </button>
            {unsure.length > 0 && (
              <button type="button" role="tab" aria-selected={filter === ''} className={`ma-sum is-unsure${filter === '' ? ' on' : ''}`} onClick={() => setFilter('')}>
                <strong>{unsure.length}</strong>
                <span>need you</span>
              </button>
            )}
            {areas.areas
              .filter((a) => moving.some((u) => u.area === a.id))
              .map((a) => (
                <button key={a.id} type="button" role="tab" aria-selected={filter === a.id} className={`ma-sum nt-${a.color}${filter === a.id ? ' on' : ''}`} onClick={() => setFilter(a.id)}>
                  <strong>{moving.filter((u) => u.area === a.id).length}</strong>
                  <span>
                    <Icon name={a.icon as IconName} size={11} /> {a.name}
                  </span>
                </button>
              ))}
          </div>
          {visible.map((g) => (
            <section key={g.id || 'none'} className={`ma-group${g.id === '' ? ' is-unsure' : ''}`}>
              <h3 className="ma-group-head">
                {g.area ? (
                  <span className={`nt-chip nt-${g.area.color}`} aria-hidden="true">
                    <Icon name={g.area.icon as IconName} size={13} />
                  </span>
                ) : (
                  <Icon name="help" size={15} />
                )}
                {g.name}
                <span className="ma-faint">{g.units.length}</span>
                {g.id === '' && <span className="ma-hint">Nothing in the vault says where these belong. They stay where they are unless you choose.</span>}
              </h3>
              <ul className="ma-units">
                {g.units.map((u) => (
                  <li key={u.path} className="ma-unit">
                    <span className="ma-unit-icon" aria-hidden="true">
                      <Icon name={KIND_ICON[u.kind]} size={14} />
                    </span>
                    <span className="ma-unit-words">
                      <span className="ma-unit-title">
                        {u.title}
                        {u.folder && u.files > 1 && <span className="ma-faint"> · {u.files} files</span>}
                      </span>
                      <span className="ma-unit-why">
                        <span className={`ma-sure s-${u.sure}`}>{SURE_WORDS[u.sure]}</span>
                        {u.why.join(' · ')}
                      </span>
                      <span className="ma-unit-path" title={u.to ? `${u.path} → ${u.to}` : u.path}>
                        {u.path}
                        {u.to && (
                          <>
                            {' '}
                            <Icon name="forward" size={10} /> {u.to}
                          </>
                        )}
                      </span>
                    </span>
                    <select
                      className="ma-pick"
                      value={choices[u.path] ?? u.area ?? ''}
                      aria-label={`Area for ${u.title}`}
                      onChange={(e) => setChoices((c) => ({ ...c, [u.path]: e.target.value }))}
                    >
                      <option value="">Leave where it is</option>
                      {areas.areas.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {shown.stays.length > 0 && filter === 'all' && (
            <details className="ma-stays">
              <summary>
                Staying where they are <span className="ma-faint">{shown.stays.length}</span>
              </summary>
              <ul>
                {shown.stays.map((s) => (
                  <li key={s.path}>
                    <code>{s.path}</code> {s.why}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="ma-kinds-note">{KIND_WORD.project}s move with their whole folder. {movesOf(shown).length} moves in all.</p>
        </>
      )}
    </Frame>
  );
}

// ── The areas editor ──────────────────────────────────────────────────────────────────────────────────────────────

function AreasEditor({ onClose }: { onClose(): void }) {
  const config = useAreas();
  const canEdit = useApp((s) => s.canEdit);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const save = (fn: (c: AreasConfig) => AreasConfig) => void changeAreas(fn).catch(showError);
  return (
    <Frame title="Areas of life" line="Rename, reorder, recolour or hide an area. A quiet area (the Library) stays out of Today and search." icon="layers" wide onClose={onClose}>
      {!config ? (
        <div className="ma-empty">
          <p>Your vault isn’t organised by area yet.</p>
          <button type="button" className="button primary" onClick={() => void import('../state/life').then((l) => l.openLife({ kind: 'migration' }))}>
            Organise by area…
          </button>
        </div>
      ) : (
        <>
          <ul className="ma-areas">
            {config.areas.map((a, i) => (
              <li key={a.id} className={`ma-area nt-${a.color}${a.hidden ? ' is-hidden' : ''}`}>
                <button type="button" className="nt-chip ma-icon-button" title="Icon and colour" aria-label={`Icon and colour of ${a.name}`} onClick={(e) => openMenu(e.currentTarget, [{ heading: 'Colour' }, ...AREA_COLORS.map((c) => ({ label: c.charAt(0).toUpperCase() + c.slice(1), checked: a.color === c, run: () => save((cfg) => changeArea(cfg, a.id, { color: c })) })), { separator: true }, { label: 'Icon', icon: a.icon as IconName, submenu: AREA_ICONS.map((ic) => ({ label: ic.charAt(0).toUpperCase() + ic.slice(1), icon: ic as IconName, checked: a.icon === ic, run: () => save((cfg) => changeArea(cfg, a.id, { icon: ic })) })) }])}>
                  <Icon name={a.icon as IconName} size={15} />
                </button>
                {editing?.id === a.id ? (
                  <input
                    className="ma-area-name"
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ id: a.id, name: e.target.value })}
                    onBlur={() => {
                      const n = editing.name;
                      setEditing(null);
                      void renameArea(a.id, n).catch(showError);
                    }}
                    onKeyDown={(e) => {
                      if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                  />
                ) : (
                  <button type="button" className="ma-area-name as-text" disabled={!canEdit} title="Rename (its folder is renamed with it)" onClick={() => setEditing({ id: a.id, name: a.name })}>
                    {a.name}
                    <span className="ma-faint"> · {a.folder}</span>
                  </button>
                )}
                <input className="ma-area-about" defaultValue={a.about} placeholder="What it holds" aria-label={`What ${a.name} holds`} onBlur={(e) => e.target.value !== a.about && save((cfg) => changeArea(cfg, a.id, { about: e.target.value }))} />
                <label className="ma-toggle" title="Kept out of Today and search">
                  <input type="checkbox" checked={!!a.quiet} onChange={(e) => save((cfg) => changeArea(cfg, a.id, { quiet: e.target.checked }))} /> Quiet
                </label>
                <label className="ma-toggle" title="Shown in the side bar">
                  <input type="checkbox" checked={!a.hidden} onChange={(e) => save((cfg) => changeArea(cfg, a.id, { hidden: !e.target.checked }))} /> Shown
                </label>
                <button type="button" className="icon-button" title="Move up" aria-label={`Move ${a.name} up`} disabled={i === 0} onClick={() => save((cfg) => moveArea(cfg, a.id, -1))}>
                  <Icon name="chevronDown" size={13} className="flip" />
                </button>
                <button type="button" className="icon-button" title="Move down" aria-label={`Move ${a.name} down`} disabled={i === config.areas.length - 1} onClick={() => save((cfg) => moveArea(cfg, a.id, 1))}>
                  <Icon name="chevronDown" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="Take it off the list (its folder and notes stay)"
                  aria-label={`Remove ${a.name}`}
                  onClick={async () => {
                    if (await confirm(`Take ${a.name} off the list?`, { message: `Its folder (${a.folder}) and everything in it stay where they are; they show as not in an area.`, ok: 'Take it off' })) save((cfg) => removeArea(cfg, a.id));
                  }}
                >
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="ma-add"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              const id = await newArea(name);
              if (id) setName('');
            }}
          >
            <Icon name="plus" size={14} />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="A new area (Home lab, Church, Sport…)" aria-label="A new area" disabled={!canEdit} />
            <button type="submit" className="button small" disabled={!name.trim() || !canEdit}>
              Add
            </button>
          </form>
        </>
      )}
    </Frame>
  );
}

// ── The tag manager ───────────────────────────────────────────────────────────────────────────────────────────────

function TagManager({ onClose, start }: { onClose(): void; start?: string }) {
  const revision = useApp((s) => s.revision);
  const canEdit = useApp((s) => s.canEdit);
  const [tags, setTags] = useState<TagUse[] | null>(null);
  const [find, setFind] = useState('');
  const [picked, setPicked] = useState<string | null>(start ?? null);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.nv.life.tags.list().then(setTags, () => setTags([]));
  }, [revision]);
  const similar = useMemo(() => (tags ? similarTags(tags) : []), [tags]);
  const list = useMemo(() => (tags ?? []).filter((t) => !find.trim() || t.tag.toLowerCase().includes(find.trim().toLowerCase().replace(/^#/, ''))).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)), [tags, find]);
  const sel = tags?.find((t) => t.tag === picked) ?? null;
  useEffect(() => setTo(sel?.tag ?? ''), [sel?.tag]);
  const run = async (job: () => Promise<{ words: string }>) => {
    setBusy(true);
    try {
      toast((await job()).words);
      setPicked(null);
      await loadNotes();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };
  const target = to.trim().replace(/^#/, '');
  const into = tags?.find((t) => t.tag.toLowerCase() === target.toLowerCase() && t.tag !== sel?.tag);
  return (
    <Frame title="Tags" line="Rename, merge or take off a tag in every note at once. Colour codes (#CF0A2C) and numbers aren’t tags, so they no longer show here. Templates’ tags are left out." icon="tag" wide onClose={onClose}>
      {!tags ? (
        <div className="pc-loading" aria-busy="true" />
      ) : (
        <div className="tm-wrap">
          <div className="tm-list-side">
            <label className="pc-find">
              <Icon name="search" size={13} />
              <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Find among ${plural(tags.length, 'tag')}`} aria-label="Find a tag" />
            </label>
            {similar.length > 0 && !find && (
              <div className="tm-similar">
                {similar.slice(0, 4).map(([a, b]) => (
                  <div key={`${a.tag}|${b.tag}`} className="tm-sim">
                    <span>
                      <code>#{b.tag}</code> and <code>#{a.tag}</code> look like one tag
                    </span>
                    <button type="button" className="button small" disabled={!canEdit || busy} onClick={() => void run(() => window.nv.life.tags.rename(b.tag, a.tag))}>
                      Merge into #{a.tag}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* A page's own list is a list, never a listbox (8.6: as a listbox it read as a menu left open). */}
            <ul className="tm-list" role="list" aria-label="Tags">
              {list.map((t) => (
                <li key={t.tag}>
                  <button type="button" role="listitem" aria-current={picked === t.tag ? true : undefined} className={`tm-tag${picked === t.tag ? ' on' : ''}`} onClick={() => setPicked(t.tag)}>
                    <span className="tm-hash">#</span>
                    <span className="tm-name">{t.tag}</span>
                    <span className="tm-count">{t.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="tm-detail">
            {!sel ? (
              <div className="tm-none">
                <Icon name="tag" size={22} />
                <p>Choose a tag to rename it, merge it into another, or take it off.</p>
              </div>
            ) : (
              <>
                <h3 className="tm-title">
                  #{sel.tag} <span className="ma-faint">on {sel.count} {sel.count === 1 ? 'note' : 'notes'}</span>
                </h3>
                <label className="tm-field">
                  <span>New name</span>
                  <input value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} />
                </label>
                <div className="tm-buttons">
                  <button type="button" className="button primary" disabled={!canEdit || busy || !target || target === sel.tag} onClick={() => void run(() => window.nv.life.tags.rename(sel.tag, target))}>
                    {into ? `Merge into #${into.tag}` : 'Rename'}
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={!canEdit || busy}
                    onClick={async () => {
                      if (await confirm(`Take #${sel.tag} off ${sel.count} ${sel.count === 1 ? 'note' : 'notes'}?`, { message: 'The tag goes from their words and their tags; everything else in them stays as written. Earlier versions of each note are kept.', ok: 'Take it off', danger: true })) void run(() => window.nv.life.tags.remove(sel.tag));
                    }}
                  >
                    Take it off
                  </button>
                </div>
                {into && <p className="ld-line">#{into.tag} is on {into.count} {into.count === 1 ? 'note' : 'notes'} already: the two become one.</p>}
                <h4 className="tm-sub">On these notes</h4>
                <ul className="tm-notes">
                  {sel.paths.slice(0, 40).map((p) => (
                    <li key={p}>
                      <button type="button" className="tm-note" onClick={() => A.openPath(p, { where: 'tab' })}>
                        <Icon name="notes" size={12} /> {A.titleOf(p)} <span className="ma-faint">{p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''}</span>
                      </button>
                    </li>
                  ))}
                  {sel.paths.length > 40 && <li className="ma-faint">and {sel.paths.length - 40} more</li>}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </Frame>
  );
}

// ── Cards for the people named in projects ────────────────────────────────────────────────────────────────────────

function MakeCards({ onClose, area }: { onClose(): void; area?: string }) {
  const config = useAreas();
  const byPath = useApp((s) => s.byPath);
  const [list, setList] = useState<CardSuggestion[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [areaOf, setAreaOf] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.nv.life.people.suggestions().then(setList, () => setList([]));
  }, []);
  const projectArea = (s: CardSuggestion): string => {
    if (area) return area;
    if (!config) return '';
    const p = s.projects[0];
    if (!p) return config.home ?? '';
    const top = p.split('/')[0];
    return config.areas.find((a) => a.folder === top || String(byPath.get(p)?.props?.area ?? '').toLowerCase() === a.name.toLowerCase())?.id ?? config.home ?? '';
  };
  const chosen = (list ?? []).filter((s) => !off.has(s.id));
  const make = async () => {
    setBusy(true);
    try {
      const { made, skipped } = await window.nv.life.people.make(chosen.map((s) => ({ id: s.id, name: s.name, type: s.type, role: s.role, area: areaOf[s.id] ?? projectArea(s), projects: s.projects })));
      toast(`Made ${made.length} ${made.length === 1 ? 'card' : 'cards'}${skipped.length ? `, skipped ${skipped.length} already there` : ''}. Everything that names them stays joined to them.`);
      await loadNotes();
      lifeChanged();
      onClose();
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };
  return (
    <Frame
      title={list ? `${list.length} ${list.length === 1 ? 'person' : 'people'} named in your projects` : 'People named in your projects'}
      line="They are named in projects, meetings and steps but have no card yet. A card holds their role, contact and notes, and everything that names them stays joined to it."
      icon="people"
      wide
      onClose={onClose}
      foot={
        <>
          <span className="ld-space" />
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={busy || !chosen.length} onClick={() => void make()}>
            Make {chosen.length} {chosen.length === 1 ? 'card' : 'cards'}
          </button>
        </>
      }
    >
      {!list ? (
        <div className="pc-loading" aria-busy="true" />
      ) : !list.length ? (
        <p className="ld-line">Everyone named in your projects has a card already.</p>
      ) : (
        <ul className="mc-list">
          {list.map((s) => (
            <li key={s.id} className={`mc-row${off.has(s.id) ? ' is-off' : ''}`}>
              <label className="mc-check">
                <input type="checkbox" checked={!off.has(s.id)} onChange={(e) => setOff((o) => { const n = new Set(o); if (e.target.checked) n.delete(s.id); else n.add(s.id); return n; })} />
                <span className="mc-name">
                  {s.name}
                  {s.type === 'org' && <span className="ma-faint"> · organisation</span>}
                </span>
              </label>
              <span className="mc-where">
                {s.role && <span>{s.role} · </span>}
                Named in {s.projects.map((p) => A.titleOf(p)).slice(0, 2).join(', ') || 'a meeting'}
                {s.projects.length > 2 ? ` and ${s.projects.length - 2} more` : ''}
              </span>
              {config && (
                <select className="ma-pick" value={areaOf[s.id] ?? projectArea(s)} aria-label={`Area for ${s.name}`} onChange={(e) => setAreaOf((m) => ({ ...m, [s.id]: e.target.value }))}>
                  {config.areas.filter((a) => !a.quiet).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                  <option value="">Not in an area</option>
                </select>
              )}
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

// ── Two names, one person ─────────────────────────────────────────────────────────────────────────────────────────

function SamePeople({ onClose }: { onClose(): void }) {
  const [pairs, setPairs] = useState<SamePerson[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => void window.nv.life.people.same().then(setPairs, () => setPairs([]));
  useEffect(load, []);
  const act = async (p: SamePerson, merge: boolean) => {
    setBusy(p.other);
    try {
      // The merge is said with Undo, as from the People page's list (state/life.ts).
      if (merge) await mergePair(p.keep, p.other);
      else {
        await window.nv.life.people.notSame(p.keep, p.other);
        await loadNotes();
        lifeChanged();
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
      load();
    }
  };
  return (
    <Frame title="The same person under two names?" line="Each pair below gives the same email, spells the same name differently, sits on the known as list, uses a first name where only one person fits, or shortens the other name. Merging keeps every name, detail and note on one card, and every link and mention follows." icon="merge" wide onClose={onClose}>
      {!pairs ? (
        <div className="pc-loading" aria-busy="true" />
      ) : !pairs.length ? (
        <p className="ld-line">No two names look like one person.</p>
      ) : (
        <ul className="sp-list">
          {pairs.map((p) => (
            <li key={`${p.keep}|${p.other}`} className="sp-row">
              <span className="sp-names">
                <strong>{p.otherName}</strong> <Icon name="forward" size={11} /> <strong>{p.keepName}</strong>
                <span className="ld-line">{p.why}{p.preview ? ` · ${mergePreviewWords(p.preview)}` : ''}</span>
              </span>
              <button type="button" className="button small" disabled={!!busy} onClick={() => void act(p, false)}>
                Not the same
              </button>
              <button type="button" className="button primary small" disabled={!!busy} onClick={() => void act(p, true)}>
                Merge into {p.keepName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

/** For other files: whether the vault is organised by area yet. */
export const hasAreas = () => !!getAreas();
