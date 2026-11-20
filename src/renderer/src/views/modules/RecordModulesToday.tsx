// Finance and Documents and ID on Today (Wave 5 part a; the rule: "Today pulls from every module, not just projects:
// bills due…"). Bills due within the module's reminder window (and any overdue), a price that changed lately, and
// documents that expire soon or have expired; each opens its record, and a bill you pay by hand can be marked paid here.
// Nothing at all when there is nothing to say.

import { useState } from 'react';
import { LIFE_MODULES, moduleInfo, modulesByArea, modulesOn, partOn } from '../../../../shared/life-modules';
import { DEFAULT_AREAS } from '../../../../shared/areas';
import { useAreas } from '../../state/areas';
import { dueWords, moneyWords, whenWords } from '../../../../shared/finance';
import { expiryWords } from '../../../../shared/id-documents';
import { Icon, type IconName } from '../../components/Icon';
import { openModule, setModule, useModules } from '../../state/modules';
import { peek } from '../../state/peek';
import { useDocuments, useFinance } from '../../state/recordModules';
import { showError, useApp } from '../../state/store';
import { markPaid, openBill } from './recordActions';
import { billRowTag, justPaid, payableByHand } from './billRow';

function Head({ id, title, count, page, module }: { id: string; title: string; count: number; page: string; module: string }) {
  return (
    <header className="td-section-head">
      <h2 id={`td-h-${id}`}>
        {title}
        {count > 0 && <span className="td-count">{count}</span>}
      </h2>
      <button type="button" className="td-section-link" onClick={() => openModule(module, page)}>
        <Icon name={module === 'finance' ? 'wallet' : 'idcard'} size={13} /> {moduleInfo(module)?.name ?? (module === 'finance' ? 'Money' : 'Papers')}
      </button>
    </header>
  );
}

/** Bills shown before Show all (9 Nov 2026, break job: fifty bills were fifty rows for one counted kind). */
const BILLS_SHOWN = 6;

export function FinanceToday() {
  const on = partOn(useModules(), 'finance', 'bills');
  const canEdit = useApp((s) => s.canEdit);
  const { data: f } = useFinance(on);
  const [all, setAll] = useState(false);
  if (!on || !f) return null;
  // Just-paid rows stay visible with Paid plus their next day (9.2 uplift F3); the total counts only what is still due.
  const due = f.dueSoon.filter((b) => b.overdue || justPaid(b, f.today) || (b.days !== null && b.days <= Math.max(7, f.remindDays)));
  const changes = f.priceChanges;
  if (!due.length && !changes.length) return null;
  const total = due.filter((b) => !justPaid(b, f.today)).reduce((s, b) => s + (b.amount ?? 0), 0);
  const shownDue = all ? due : due.slice(0, BILLS_SHOWN);
  return (
    <section className="td-section rm-today" data-section="bills" aria-labelledby="td-h-bills">
      <Head id="bills" title="Bills due" count={due.length} page="calendar" module="finance" />
      {due.length > 0 && <p className="rm-today-line">{moneyWords(total, f.currency)} due in the next {Math.max(7, f.remindDays)} days</p>}
      <ul className="rm-today-rows">
        {shownDue.map((b) => (
          <li key={b.path} className={`rm-today-row${b.overdue ? ' is-late' : ''}`}>
            <button type="button" className="rm-today-main" onClick={() => openBill(b.path, b.name)}>
              <span className="rm-today-name">{b.name}</span>
              <span className="rm-today-sub">{justPaid(b, f.today) ? billRowTag(b, f.today).words : b.overdue ? billRowTag(b, f.today).words : `${dueWords(b.next!, f.today)} · ${whenWords(b.days!)}`}{b.autopay ? ' · autopay' : ''}</span>
            </button>
            <span className="rm-today-amount">{b.amount !== null ? moneyWords(b.amount, f.currency) : ''}</span>
            {payableByHand(b, f.today) && (
              <button type="button" className="td-act rm-today-paid" disabled={!canEdit} title="Mark paid" aria-label={`Mark ${b.name} paid`} onClick={() => markPaid(b)}>
                <Icon name="check" size={13} />
              </button>
            )}
          </li>
        ))}
        {changes.map((b) => (
          <li key={`c:${b.path}`} className="rm-today-row is-change">
            <button type="button" className="rm-today-main" onClick={() => openBill(b.path, b.name)}>
              <span className="rm-today-name">{b.name} went {b.change!.to > b.change!.from ? 'up' : 'down'}</span>
              <span className="rm-today-sub">
                {moneyWords(b.change!.from, f.currency)} → {moneyWords(b.change!.to, f.currency)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {due.length > BILLS_SHOWN && (
        <button className="td-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${due.length}`}
          <Icon name={all ? 'chevronDown' : 'chevron'} size={12} />
        </button>
      )}
    </section>
  );
}

export function DocumentsToday() {
  const { data: m } = useDocuments();
  if (!m || !m.expiring.length) return null;
  return (
    <section className="td-section rm-today" data-section="documents" aria-labelledby="td-h-documents">
      <Head id="documents" title="Documents to renew" count={m.expiring.length} page="expiry" module="documents" />
      <ul className="rm-today-rows">
        {m.expiring.map((d) => (
          <li key={d.path} className={`rm-today-row${d.status === 'Expired' ? ' is-late' : ''}`}>
            <button type="button" className="rm-today-main" onClick={() => peek({ type: 'note', path: d.path }, { title: d.name, type: 'note' })}>
              <span className="rm-today-name">{d.name}</span>
              <span className="rm-today-sub">{expiryWords(d, m.today)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// "Switch on a pack" offers never show on Today (8 Nov 2026, calm Today): they belong in Settings › Packs
// (components/ModulesSettings.tsx), beside the switch that takes them. Nothing here offers.

const SETUP_SEEN = 'nv.setup-your-life.done';
const SETUP_NO = 'nv.setup-your-life.no';
const readNo = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(SETUP_NO) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
/** Set up your life (26 Oct 2026, on the 18 modules; 8.0 Phase 5: plain questions, not a list of module names). While
 *  questions are left, Today asks them by area of life, in everyday words ("Do you have a car, motorbike, trailer or
 *  boat?"): Yes switches its module on (its page then opens with a short tour the first time), Not for me puts the
 *  question away on this PC. Done hides the card; Settings › Packs keeps every switch. */
export function SetUpYourLife() {
  const modules = useModules();
  const areas = useAreas()?.areas ?? null;
  const canEdit = useApp((s) => s.canEdit);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(SETUP_SEEN) === '1';
    } catch {
      return false;
    }
  });
  const [no, setNo] = useState<string[]>(readNo);
  const [said, setSaid] = useState<string[]>([]);
  const on = new Set(modulesOn(modules).map((m) => m.id));
  const open = LIFE_MODULES.filter((m) => !no.includes(m.id) && (!on.has(m.id) || said.includes(m.id)));
  if (hidden || !canEdit || !open.length) return null;
  const hide = () => {
    try {
      localStorage.setItem(SETUP_SEEN, '1');
    } catch {}
    setHidden(true);
  };
  const notForMe = (id: string) => {
    const next = [...new Set([...no, id])];
    try {
      localStorage.setItem(SETUP_NO, JSON.stringify(next));
    } catch {}
    setNo(next);
  };
  const yes = (id: string) => {
    setSaid((s) => [...new Set([...s, id])]);
    void setModule(id, true).catch(showError);
  };
  const left = LIFE_MODULES.filter((m) => !on.has(m.id) && !no.includes(m.id)).length;
  const groups = modulesByArea(open, areas, DEFAULT_AREAS).map((g) => ({ area: { id: g.id, name: g.name }, mods: g.mods }));
  return (
    <section className="td-section rm-setup" aria-labelledby="rm-setup-h">
      <header className="rm-setup-head">
        <div>
          <h2 id="rm-setup-h">Set up your life</h2>
          <p>A few questions, so Ironleaf keeps the parts of life you have in order. Each Yes switches on a module with its own page, its card here on Today and an assistant that knows it. You can change any of them in Settings › Packs.</p>
        </div>
        <button type="button" className="text-button" onClick={hide}>
          {left ? 'Not now' : 'Done'}
        </button>
      </header>
      <div className="rm-setup-groups">
        {groups.map((g) => (
          <div key={g.area.id} className="rm-setup-group">
            <h3>{g.area.name}</h3>
            {g.mods.map((m) =>
              on.has(m.id) ? (
                <div key={m.id} className="rm-ask is-yes">
                  <Icon name="check" size={14} />
                  <span className="rm-ask-words">
                    <b>{m.name} is on</b>
                    <small>{m.fills}</small>
                  </span>
                  <button type="button" className="button small" onClick={() => openModule(m.id)}>
                    Open
                  </button>
                </div>
              ) : (
                <div key={m.id} className="rm-ask">
                  <Icon name={m.icon as IconName} size={14} />
                  <span className="rm-ask-words">
                    <b>{m.ask}</b>
                    <small>{m.name}: {m.words}</small>
                  </span>
                  <span className="rm-ask-actions">
                    <button type="button" className="button small primary" onClick={() => yes(m.id)}>
                      Yes
                    </button>
                    <button type="button" className="text-button" onClick={() => notForMe(m.id)}>
                      Not for me
                    </button>
                  </span>
                </div>
              ),
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
