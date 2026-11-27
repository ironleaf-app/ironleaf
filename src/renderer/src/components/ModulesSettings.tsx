// Settings › Packs (8.7 w4a, 30 Oct 2026; src/shared/life-modules.ts): every life module in the catalogue as one row —
// its glyph, its name, one plain line, and its on/off switch at the right edge. Off by default; switched off a pack
// hides and keeps everything it holds. Tapping a row opens its details: where its records are kept, who may read them,
// a switch for each of its parts, and its page. Generic: a module added to the catalogue shows here.

import { useEffect, useState } from 'react';
import { DEFAULT_AREAS } from '../../../shared/areas';
import { LIFE_MODULES, moduleOn, partOn, type LifeModule } from '../../../shared/life-modules';
import { moduleById, moduleFolder, type ModuleOffer } from '../../../shared/module-records';
import { useAreas } from '../state/areas';
import { openTour, setTourSeen } from '../state/moduleFills';
import { levelLabel } from '../../../shared/sensitivity';
import { openModule, setModule, useModules } from '../state/modules';
import { closeModal } from '../state/modals';
import { showError, useApp } from '../state/store';
import { Icon, type IconName } from './Icon';
import { Toggle } from './Settings';

function PackRow({ m, areaName, folder, offer, onNotNow, reveal }: { m: LifeModule; areaName: string; folder: string; offer?: ModuleOffer; onNotNow(): void; reveal?: string }) {
  const switches = useModules();
  const canEdit = useApp((s) => s.canEdit);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(m.parts.some((part) => part.name === reveal));
  }, [m, reveal]);
  const on = moduleOn(switches, m.id);
  // A pack the vault shows it would use says so under its line (8 Nov 2026, calm Today: the "switch on a
  // pack" offers moved here from Today). The switch beside it takes it; Not now puts it away.
  const offered = !on && offer && canEdit;
  return (
    <section className={`packrow${on ? ' is-on' : ''}${open ? ' is-open' : ''}${offered ? ' is-offered' : ''}`} data-setting={m.name} aria-labelledby={`ms-${m.id}`}>
      <span className={`gtile sm slate ms-${m.id}`} aria-hidden="true">
        <Icon name={m.icon as IconName} size={15} />
      </span>
      <button type="button" className="packrow-words" id={`ms-${m.id}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} title={m.words}>
        <span className="ms-pack-heading"><span className="nm">{m.name}</span>
          {m.parts.length > 0 && <span className="ms-part-count">{m.parts.length} {m.parts.length === 1 ? 'part' : 'parts'}</span>}
          <Icon name={open ? 'chevronDown' : 'chevron'} size={13} />
        </span>
        <span className="ds">{m.words}</span>
        {offered && <span className="ms-offer">{offer.why}</span>}
      </button>
      <span className="packrow-ctl">
        <Toggle value={on} label={`${m.name} on`} onChange={(v) => void setModule(m.id, v).catch(showError)} />
      </span>
      {open && (
        <div className="packrow-open">
          <p className="ms-where">
            <Icon name="layers" size={12} />
            <span>
              In the {areaName} area{folder ? <>, kept in {folder}</> : null}
            </span>
          </p>
          <p className="ms-kept">
            <Icon name="lock" size={12} />
            <span>
              {m.kept} Level: <strong>{levelLabel(m.level)}</strong>.
            </span>
          </p>
          {m.parts.length > 0 && (
            <div className="ms-parts" role="group" aria-label={`${m.name}: its parts`}>
              {!on && <p className="ms-part-help">Turn on {m.name} to use these parts.</p>}
              {m.parts.map((p) => (
                <label key={p.id} className="ms-part" data-setting={p.name} tabIndex={-1}>
                  <input type="checkbox" className="switch small" checked={partOn(switches, m.id, p.id)} disabled={!on || !canEdit} onChange={(e) => void setModule(m.id, e.target.checked, p.id).catch(showError)} />
                  <span>
                    <strong>{p.name}</strong>
                    <em>{p.words}</em>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="ms-actions">
            {on && (
              <button
                className="button small"
                onClick={() => {
                  closeModal();
                  openModule(m.id);
                }}
              >
                Open {m.name}
                <Icon name="forward" size={12} />
              </button>
            )}
            {/* A tour from here works even when the pack is off (3 Nov 2026, audit f F3: it silently did
                nothing, then fired uninvited later): the pack switches on first, so its page mounts. */}
            <button
              className="text-button"
              disabled={!on && !canEdit}
              onClick={() => {
                setTourSeen(m.id, false);
                closeModal();
                const show = () => {
                  openModule(m.id);
                  openTour(m.id);
                };
                if (on) show();
                else void setModule(m.id, true).then(show, showError);
              }}
            >
              {on ? `Show me around ${m.name}` : `Enable ${m.name} and take the tour`}
            </button>
            {offered && (
              <button type="button" className="text-button" onClick={onNotNow}>
                Hide suggestion
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function ModulesSettings({ reveal }: { reveal?: string }) {
  const switches = useModules();
  const revision = useApp((s) => s.revision);
  const vault = useApp((s) => s.vault?.path);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'available'>('all');
  useEffect(() => { if (reveal) setFilter('all'); }, [reveal]);
  const enabled = LIFE_MODULES.filter((m) => moduleOn(switches, m.id)).length;
  const filters = [
    { id: 'all', label: 'All packs', count: LIFE_MODULES.length },
    { id: 'enabled', label: 'Enabled', count: enabled },
    { id: 'available', label: 'Available', count: LIFE_MODULES.length - enabled },
  ] as const;
  const [offers, setOffers] = useState<ModuleOffer[]>([]);
  // The packs the vault shows it would use (the same read Today used to offer from): each off pack says why
  // under its line. Never again once put away.
  useEffect(() => {
    if (!vault) return;
    let live = true;
    const t = window.setTimeout(async () => {
      const inbox = await window.nv.life.inbox.list().then((r) => r.items.map((i) => i.words), () => [] as string[]);
      const list = await window.nv.recmod.offers(inbox).catch(() => [] as ModuleOffer[]);
      if (live) setOffers(list);
    }, 600);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [revision, vault, switches]);
  const notNow = (module: string) => void window.nv.recmod.setOptions(module, { dismissed: true }).then(() => setOffers((o) => o.filter((x) => x.module !== module)), showError);
  // Where each pack's records are kept in this vault (its area's folder), so a pack is never a thing apart from the
  // vault's areas (8.0 Phase 5).
  const config = useAreas();
  const areas = config?.areas ?? null;
  const areaName = (m: LifeModule) => areas?.find((a) => a.id === m.area)?.name ?? DEFAULT_AREAS.find((a) => a.id === m.area)?.name ?? m.area;
  const folderOf = (m: LifeModule) => (moduleById(m.id) ? moduleFolder(m.id, areas) : '');
  return (
    <>
      <div className="ms-filters" role="group" aria-label="Filter packs">
        {filters.map(({ id, label, count }) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label} <span>{count}</span>
          </button>
        ))}
      </div>
      <div className="ms-list">
        {LIFE_MODULES.map((m) => {
          if (filter !== 'all' && moduleOn(switches, m.id) !== (filter === 'enabled')) return null;
          return <PackRow key={m.id} m={m} reveal={reveal} areaName={areaName(m)} folder={folderOf(m)} offer={offers.find((o) => o.module === m.id)} onNotNow={() => notNow(m.id)} />;
        })}
        {filter === 'enabled' && enabled === 0 && <p>No packs enabled. Choose Available to explore your packs.</p>}
        {filter === 'available' && enabled === LIFE_MODULES.length && <p>All packs are enabled.</p>}
      </div>
    </>
  );
}
