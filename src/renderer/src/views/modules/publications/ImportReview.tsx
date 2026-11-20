// Importing a publication note written before the module (Publications, Wave 6 part a; the plan: "with The Family
// Gazette as the first publication (import editions 1 onward: PDFs, items, puzzles, answers)"). What Ironleaf read from
// the note is shown first — its schedule, printer, sections, type and crest, and an edition for every PDF it links
// (PDFs named like it but not linked are offered, unticked) — and nothing is written until the person says. Every word
// of the note is kept; the PDFs stay where they are.

import { useEffect, useState } from 'react';
import { longDate, type ImportPlan, type Section } from '../../../../../shared/publications';
import { Icon } from '../../../components/Icon';
import { showError, useApp } from '../../../state/store';
import { StatusPill } from './Archive';
import { act, choose } from './usePub';

export function ImportReview({ path, onClose }: { path: string; onClose(): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [sections, setSections] = useState<Section[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.nv.pub.importPlan(path).then((p) => {
      setPlan(p);
      setPicked(new Set(p.editions.map((e, i) => (e.unlinked ? -1 : i)).filter((i) => i >= 0)));
      setSections(p.sections);
    }, showError);
  }, [path]);
  const apply = async () => {
    setBusy(true);
    const done = await act(() => window.nv.pub.importApply(path, { editions: [...picked], sections }), (w) => w);
    setBusy(false);
    if (done) {
      choose({ pub: path, edition: '' });
      onClose();
    }
  };
  return (
    <div className="overlay pb-overlay" onMouseDown={() => !busy && onClose()}>
      <div className="dialog pb-dialog is-wide pb-import" role="dialog" aria-label="Import a publication" onMouseDown={(e) => e.stopPropagation()}>
        <header className="pb-dialog-head">
          <span className="pb-mark" aria-hidden="true">
            <Icon name="download" size={18} />
          </span>
          <div>
            <h2>Import {plan?.title ?? 'the publication'}</h2>
            <p className="pb-faint">This is what Ironleaf read from the note. Change anything before it is kept. The note keeps every word it has; its PDFs and pictures stay where they are.</p>
          </div>
        </header>
        {!plan ? (
          <p className="pb-faint pb-pad">Reading the note…</p>
        ) : (
          <div className="pb-import-body">
            <ul className="pb-read">
              {plan.read.map((r) => (
                <li key={r}>
                  <Icon name="check" size={12} /> {r}
                </li>
              ))}
            </ul>
            <h4>Sections</h4>
            {sections.length ? (
              <div className="pb-sec-rows is-compact">
                {sections.map((s, i) => (
                  <div key={i} className="pb-sec-row">
                    <input className="pb-input" value={s.name} onChange={(e) => setSections((x) => x.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)))} aria-label="Section name" />
                    <input className="pb-input pb-num" type="number" min={0.5} step={0.5} value={s.pages} onChange={(e) => setSections((x) => x.map((y, k) => (k === i ? { ...y, pages: Number(e.target.value) || 1 } : y)))} aria-label={`${s.name}’s pages`} />
                    <input className="pb-input" value={s.sources} placeholder="Sources" onChange={(e) => setSections((x) => x.map((y, k) => (k === i ? { ...y, sources: e.target.value } : y)))} aria-label={`${s.name}’s sources`} />
                    <textarea className="pb-input pb-area is-short" rows={2} value={s.rules} onChange={(e) => setSections((x) => x.map((y, k) => (k === i ? { ...y, rules: e.target.value } : y)))} aria-label={`${s.name}’s rules`} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="pb-faint">No sections were found in the note: it starts with Front, News, Sport and Puzzles, changed in Settings afterwards.</p>
            )}
            <h4>Editions</h4>
            <ul className="pb-import-eds">
              {plan.editions.map((e, i) => (
                <li key={e.pdf + i}>
                  <label className={`pb-import-ed${picked.has(i) ? ' is-on' : ''}`}>
                    <input type="checkbox" checked={picked.has(i)} onChange={(ev) => setPicked((p) => {
                      const n = new Set(p);
                      if (ev.target.checked) n.add(i);
                      else n.delete(i);
                      return n;
                    })} />
                    <span className="pb-import-ed-words">
                      <span className="pb-import-ed-top">
                        <strong>{e.number ? `No. ${e.number}` : 'Edition'}{e.preview ? ' (preview)' : ''}</strong>
                        <span>{longDate(e.date) || 'No date found'}</span>
                        <StatusPill status={e.status} />
                      </span>
                      <span className="pb-import-ed-file">
                        <Icon name="pdf" size={12} /> {e.pdf}
                      </span>
                      {e.lead && <span className="pb-import-ed-lead">Lead: {e.lead}</span>}
                      {e.pictures.length > 0 && <span className="pb-import-ed-lead">Cartoon kept as a piece: {e.pictures.map((p) => p.label).join(', ')}</span>}
                      {e.sameAs && <span className="pb-import-ed-warn">Looks like the same file as {e.sameAs}</span>}
                      {e.unlinked && !e.sameAs && <span className="pb-import-ed-warn">Found in the vault, not linked from the note</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="pb-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Not now
          </button>
          <button type="button" className="button primary" disabled={!canEdit || !plan || busy} onClick={() => void apply()}>
            {busy ? 'Importing…' : `Import with ${picked.size} ${picked.size === 1 ? 'edition' : 'editions'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
