// A publication's settings (Publications, Wave 6 part a; the plan: "title, masthead, motto, schedule, sections and their
// page budget, house style (fonts, colours, layout grid), and delivery (Telegram, email, printer)", and "Sources and
// rules per section … editable in the vault, not hidden in a script"). Each value is saved as it is changed, into the
// publication's own note: its properties, and its Sections table.

import { useEffect, useState } from 'react';
import type { PubState } from '../../../../../main/publications';
import type { PrinterInfo } from '../../../../../main/edition-print';
import { readSchedule, scheduleText, scheduleWords, TEMPLATES, type Section } from '../../../../../shared/publications';
import { Icon } from '../../../components/Icon';
import { fileUrl } from '../../../lib/resolve';
import * as A from '../../../state/actions';
import { showError, useApp } from '../../../state/store';
import { act, SEND_BLOCKED_SUFFIX, SEND_BLOCKED_WORDS } from './usePub';

type Cur = NonNullable<PubState['current']>;

/** A text value saved when the person leaves it (or presses Enter), said back when it can't be. */
function TextSetting({ label, value, hint, placeholder, onSave, mono, wide }: { label: string; value: string; hint?: string; placeholder?: string; onSave(v: string): Promise<unknown>; mono?: boolean; wide?: boolean }) {
  const canEdit = useApp((s) => s.canEdit);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v.trim() !== value.trim()) void onSave(v.trim()).catch(() => setV(value));
  };
  return (
    <label className={`pb-field${wide ? ' is-wide' : ''}`}>
      <span>{label}</span>
      <input className={`pb-input${mono ? ' pb-mono' : ''}`} value={v} placeholder={placeholder} disabled={!canEdit} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
      {hint && <em className="pb-hint">{hint}</em>}
    </label>
  );
}

function SectionsEditor({ cur }: { cur: Cur }) {
  const canEdit = useApp((s) => s.canEdit);
  const [rows, setRows] = useState<Section[]>(cur.pub.sections);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setRows(cur.pub.sections);
    setDirty(false);
  }, [cur.pub.sections]);
  const set = (i: number, patch: Partial<Section>) => {
    setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const save = (next = rows) => void act(() => window.nv.pub.sections(cur.pub.path, next), 'Sections saved in the publication’s note.').then(() => setDirty(false));
  const moveRow = (i: number, d: number) => {
    const next = [...rows];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    setRows(next);
    save(next);
  };
  return (
    <section className="pb-panel pb-sections-ed" aria-label="Sections">
      <header className="pb-panel-head">
        <div>
          <h3>Sections</h3>
          <p className="pb-faint">In the order they print. Each starts a page; its pages are its budget. Sources say where its pieces may come from (outlets by name, or “Any named source” to need one); rules are your words for whoever writes it, the assistants included.</p>
        </div>
        <button type="button" className="sv-tool" onClick={() => A.openPath(cur.pub.path, { where: 'tab' })}>
          <Icon name="notes" size={13} /> In the note
        </button>
      </header>
      <div className="pb-sec-rows">
        <div className="pb-sec-row is-head" aria-hidden="true">
          <span>Section</span>
          <span>Pages</span>
          <span>Sources</span>
          <span>Rules</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="pb-sec-row">
            <input className="pb-input" value={r.name} disabled={!canEdit} onChange={(e) => set(i, { name: e.target.value })} aria-label="Section name" />
            <input className="pb-input pb-num" type="number" min={0.5} max={40} step={0.5} value={r.pages} disabled={!canEdit} onChange={(e) => set(i, { pages: Number(e.target.value) || 1 })} aria-label={`${r.name}’s pages`} />
            <input className="pb-input" value={r.sources} disabled={!canEdit} onChange={(e) => set(i, { sources: e.target.value })} placeholder="No rule" aria-label={`${r.name}’s sources`} />
            <textarea className="pb-input pb-area is-short" rows={2} value={r.rules} disabled={!canEdit} onChange={(e) => set(i, { rules: e.target.value })} aria-label={`${r.name}’s rules`} />
            <span className="pb-row-tools">
              <button type="button" className="icon-button small" aria-label={`Move ${r.name} up`} disabled={!canEdit || i === 0} onClick={() => moveRow(i, -1)}>
                <Icon name="back" size={12} className="pb-rot" />
              </button>
              <button type="button" className="icon-button small" aria-label={`Move ${r.name} down`} disabled={!canEdit || i === rows.length - 1} onClick={() => moveRow(i, 1)}>
                <Icon name="forward" size={12} className="pb-rot" />
              </button>
              <button
                type="button"
                className="icon-button small"
                aria-label={`Remove ${r.name}`}
                disabled={!canEdit || rows.length === 1}
                onClick={() => {
                  const next = rows.filter((_, k) => k !== i);
                  setRows(next);
                  save(next);
                }}
              >
                <Icon name="trash" size={12} />
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="pb-actions is-left">
        <button
          type="button"
          className="link-button"
          disabled={!canEdit}
          onClick={() => {
            setRows((r) => [...r, { name: `Section ${r.length + 1}`, pages: 1, sources: '', rules: '' }]);
            setDirty(true);
          }}
        >
          <Icon name="plus" size={12} /> Add a section
        </button>
        <span className="sv-grow" />
        {dirty && (
          <>
            <button type="button" className="button small" onClick={() => (setRows(cur.pub.sections), setDirty(false))}>
              Undo changes
            </button>
            <button type="button" className="button primary small" onClick={() => save()}>
              Save the sections
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function FileSetting({ cur, label, value, kind, prop, hint }: { cur: Cur; label: string; value: string; kind: 'picture' | 'font'; prop: string; hint: string }) {
  const canEdit = useApp((s) => s.canEdit);
  const set = (v: string) => act(() => window.nv.pub.set(cur.pub.path, { [prop]: v }), v ? `${label} set.` : `${label} taken off.`);
  return (
    <div className="pb-field">
      <span>{label}</span>
      <div className="pb-file-set">
        {kind === 'picture' && value ? <img src={fileUrl(value)} alt="" /> : <span className={`pb-file-kind is-${kind}`}>{kind === 'font' ? 'Aa' : <Icon name="image" size={16} />}</span>}
        <span className="pb-file-name" title={value}>
          {value ? value.split('/').pop() : 'Ironleaf’s own'}
        </span>
        <button type="button" className="button small" disabled={!canEdit} onClick={() => void window.nv.pub.pickFile(cur.pub.path, kind).then((r) => { if (r) void set(r); }, showError)}>
          Choose…
        </button>
        {value && (
          <button type="button" className="link-button" disabled={!canEdit} onClick={() => void set('')}>
            Use the default
          </button>
        )}
      </div>
      <em className="pb-hint">{hint}</em>
    </div>
  );
}

export function PubSettings({ state, cur }: { state: PubState; cur: Cur }) {
  const canEdit = useApp((s) => s.canEdit);
  const p = cur.pub;
  const [printers, setPrinters] = useState<PrinterInfo[] | null>(null);
  const [sched, setSched] = useState(scheduleText(p.schedule));
  useEffect(() => setSched(scheduleText(p.schedule)), [p.schedule]);
  useEffect(() => {
    void window.nv.pub.printers().then(setPrinters, () => setPrinters([]));
  }, []);
  const set = (patch: Record<string, unknown>, said?: string) => act(() => window.nv.pub.set(p.path, patch), said);
  const s = readSchedule(sched);
  const known = printers?.some((x) => x.name === p.delivery.printer || x.displayName === p.delivery.printer);
  return (
    <div className="pb-settings">
      <section className="pb-panel" aria-label="The publication">
        <h3>The publication</h3>
        <div className="pb-grid2">
          <TextSetting label="Masthead" value={p.masthead} hint="The name across the top of the front page." onSave={(v) => set({ masthead: v })} />
          <TextSetting label="Motto" value={p.motto} hint="A line under the masthead." onSave={(v) => set({ motto: v })} />
          <label className="pb-field">
            <span>When it comes out</span>
            <input className="pb-input" value={sched} disabled={!canEdit} onChange={(e) => setSched(e.target.value)} onBlur={() => sched !== scheduleText(p.schedule) && void set({ schedule: sched }).then((r) => r === undefined && setSched(scheduleText(p.schedule)))} placeholder="Mon, Fri 07:00" />
            <em className={sched && !s ? 'pb-hint is-bad' : 'pb-hint'}>{sched ? (s ? scheduleWords(s) : 'Write days and a time, like “Mon, Fri 07:00” or “Weekdays 6:30”.') : 'No schedule: it goes out when you send it.'}</em>
          </label>
          <div className="pb-field">
            <span>Layout</span>
            <div className="pb-templates" role="radiogroup" aria-label="Layout">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={p.template.id === t.id} disabled={!canEdit} className={`pb-template${p.template.id === t.id ? ' is-on' : ''}`} onClick={() => void set({ template: t.id })} title={t.words}>
                  <span className="pb-template-art" aria-hidden="true">
                    {Array.from({ length: t.columns }, (_, i) => (
                      <i key={i} />
                    ))}
                  </span>
                  <strong>{t.name}</strong>
                </button>
              ))}
            </div>
            <em className="pb-hint">{p.template.words}</em>
          </div>
        </div>
      </section>
      <SectionsEditor cur={cur} />
      <section className="pb-panel" aria-label="House style">
        <h3>House style</h3>
        <div className="pb-grid2">
          <FileSetting cur={cur} label="Masthead type" value={p.style.mastheadFont} kind="font" prop="masthead_font" hint="A font file in the vault (.ttf, .otf, .woff2) for the name on the front." />
          <FileSetting cur={cur} label="Body type" value={p.style.bodyFont} kind="font" prop="body_font" hint="Its bold and italic files beside it are used too." />
          <FileSetting cur={cur} label="Masthead picture" value={p.style.crest} kind="picture" prop="crest" hint="A crest or logo beside the masthead." />
          <div className="pb-field">
            <span>Ink</span>
            <div className="pb-ink">
              <input type="color" value={p.style.ink} disabled={!canEdit} onChange={(e) => void set({ ink: e.target.value })} aria-label="Ink colour" />
              <span className="pb-mono">{p.style.ink}</span>
              <label className="pb-check-inline">
                <input type="checkbox" checked={p.style.greyscale} disabled={!canEdit} onChange={(e) => void set({ greyscale: e.target.checked })} /> Pictures in black and white
              </label>
              <label className="pb-check-inline">
                <input type="checkbox" checked={p.style.justify} disabled={!canEdit} onChange={(e) => void set({ justify: e.target.checked })} /> Justified text
              </label>
            </div>
            <em className="pb-hint">The colour everything is printed in. Black and white pictures suit a black-ink printer. Justified text has both edges straight; ragged reads better in narrow columns.</em>
          </div>
        </div>
      </section>
      <section className="pb-panel" aria-label="Delivery">
        <h3>Delivery</h3>
        {!state.deliveryOn && (
          <p className="pb-note">
            <Icon name="info" size={13} /> Printing and sending on a schedule is switched off.{' '}
            <button type="button" className="link-button" onClick={() => A.openSettings('packs', 'current', 'Publications')}>
              Settings › Packs
            </button>
            . Send or print from the edition builder whenever you like.
          </p>
        )}
        <div className="pb-grid2">
          <TextSetting label="Email to" value={p.delivery.email.join(', ')} placeholder="name@example.com, another@example.com" hint={state.canSend ? 'Sent by email, the PDF attached.' : `Sent by email ${SEND_BLOCKED_SUFFIX}. ${SEND_BLOCKED_WORDS}`} onSave={(v) => set({ email: v })} />
          <div className="pb-field">
            <span>Printer</span>
            <select className="pb-input" value={p.delivery.printer} disabled={!canEdit} onChange={(e) => void set({ printer: e.target.value })}>
              <option value="">No printer</option>
              {p.delivery.printer && !known && <option value={p.delivery.printer}>{p.delivery.printer} (not on this PC)</option>}
              {(printers ?? []).map((x) => (
                <option key={x.name} value={x.displayName || x.name}>
                  {x.displayName || x.name}
                  {x.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <em className={p.delivery.printer && printers && !known ? 'pb-hint is-bad' : 'pb-hint'}>{printers === null ? 'Looking for printers…' : !printers.length ? 'This PC has no printers set up.' : p.delivery.printer && !known ? 'That printer isn’t on this PC: it prints only on the PC that has it.' : 'Printed in A4, on both PCs only where this printer is.'}</em>
          </div>
          <div className="pb-field">
            <span>Copies</span>
            <input className="pb-input pb-num" type="number" min={1} max={20} value={p.delivery.copies} disabled={!canEdit} onChange={(e) => void set({ copies: Number(e.target.value) || 1 })} />
          </div>
          <label className="pb-check is-wide">
            <input type="checkbox" checked={p.delivery.print} disabled={!canEdit || !p.delivery.printer} onChange={(e) => void set({ print: e.target.checked })} />
            <span>
              <strong>Print on the schedule</strong>
              <em>{p.schedule ? `${scheduleWords(p.schedule)}, the day’s edition is built if it isn’t yet, then printed and sent as set above.` : 'Set when it comes out first.'}</em>
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}
