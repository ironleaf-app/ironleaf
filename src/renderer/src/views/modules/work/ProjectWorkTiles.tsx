// The work modules on a project's Overview (Wave 6 part b; the spec: "the project page shows its weekly update
// history", quotes and contracts "link to project" with expiry alerts in project attention, a project's meetings and
// sites). Each work module that is on answers its "project" job (src/main/work/*.ts) with a tile of rows and anything
// needing attention; the hub draws them in its own tiles' look. Nothing at all while every work module is off.

import { useEffect, useState } from 'react';
import { moduleInfo, modulesOn } from '../../../../../shared/life-modules';
import { WORK_MODULE_IDS } from '../../../../../shared/work-modules';
import { Icon, type IconName } from '../../../components/Icon';
import { statusReading } from '../../../lib/projectLook';
import { openModule, useModules, useModuleTick } from '../../../state/modules';
import { peek } from '../../../state/peek';
import { useApp } from '../../../state/store';
import { workCall } from '../../../state/workModules';
import { openDetail } from './WorkShell';

export interface ProjectWork {
  module: string;
  tile: { title: string; rows: { words: string; sub?: string; path?: string; detail?: { kind: string; key: string }; tone?: string }[] } | null;
  attention: { words: string; path: string; tone: 'bad' | 'warn' }[];
}

/** What each work module that is on holds for a project (read again when the notes change). */
export function useProjectWork(projectPath: string): ProjectWork[] {
  const modules = useModules();
  const revision = useApp((s) => s.revision);
  const tick = useModuleTick();
  const on = modulesOn(modules).map((m) => m.id).filter((id) => WORK_MODULE_IDS.includes(id));
  const key = on.join(',');
  const [work, setWork] = useState<ProjectWork[]>([]);
  useEffect(() => {
    if (!on.length || !projectPath) return setWork([]);
    let live = true;
    const t = window.setTimeout(async () => {
      const all = await Promise.all(on.map((id) => workCall<Omit<ProjectWork, 'module'>>(id, 'project', projectPath).then((r) => ({ module: id, tile: r?.tile ?? null, attention: r?.attention ?? [] }), () => null)));
      if (live) setWork(all.filter((x): x is ProjectWork => !!x && (!!x.tile?.rows.length || x.attention.length > 0)));
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [projectPath, key, revision, tick]);
  return work;
}

// A tile's dot: the module's known words first, then the one status reading (9.2 uplift F42), so a status the
// prefix list never saw ("Off track", "Done for now") still tones true instead of reading neutral or red wrongly.
const toneOf = (t?: string) => {
  const w = (t ?? '').trim();
  if (/^(on track|done|live|accepted|paid|sent)$/i.test(w)) return 'ok';
  if (/^(at risk|lapses soon|ending|to patch)\b/i.test(w)) return 'warn';
  if (/^(blocked|lapsed|expired|overdue|faulty)\b/i.test(w)) return 'bad';
  const tone = statusReading(w).tone;
  return tone === 'none' ? '' : tone;
};

/** The tiles, in the hub's own look ("ph-tile"). */
export function ProjectWorkTiles({ work }: { work: ProjectWork[] }) {
  return (
    <>
      {work.map((w) => {
        const info = moduleInfo(w.module);
        if (!info) return null;
        const rows = w.tile?.rows ?? [];
        return (
          <section key={w.module} className="ph-tile pw-tile" data-hub-tile={`work-${w.module}`}>
            <header className="ph-tile-head">
              <Icon name={info.icon as IconName} size={14} />
              <h3>{w.tile?.title ?? info.name}</h3>
              {rows.length > 0 && <span className="ph-count">{rows.length}</span>}
              <span className="ph-space" />
              <button className="ph-tile-link" onClick={() => openModule(w.module)}>
                {info.name} <Icon name="forward" size={11} />
              </button>
            </header>
            {w.attention.length > 0 && (
              <ul className="ph-list pw-attention">
                {w.attention.map((a) => (
                  <li key={a.words}>
                    <button className={`ph-row pw-alert tone-${a.tone}`} onClick={() => peek({ path: a.path }, { title: a.words, type: 'note' })}>
                      <Icon name="warning" size={12} />
                      <span className="ph-row-words ph-clamp">{a.words}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {rows.length > 0 && (
              <ul className="ph-list">
                {rows.map((r, i) => (
                  <li key={`${i}:${r.words}`}>
                    <button className="ph-row ph-row-top" onClick={() => (r.detail ? (r.detail.kind === 'week' ? openDetail(w.module, 'week', r.detail.key) : openDetail(w.module, r.detail.kind, r.detail.key)) : r.path ? peek({ path: r.path }, { title: r.words, type: 'note' }) : openModule(w.module))}>
                      {r.tone && <span className={`pw-dot tone-${toneOf(r.tone)}`} aria-hidden="true" />}
                      <span className="ph-row-words">
                        <span className="ph-clamp">{r.words}</span>
                        {r.sub && <span className="ph-why ph-clamp">{r.sub}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
