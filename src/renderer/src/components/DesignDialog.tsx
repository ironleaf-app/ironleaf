// SPDX-License-Identifier: AGPL-3.0-or-later
// The Design studio (22 Nov 2026, phase 1): a note designed into a finished PDF by the person's own AI, in their brand
// kit. Choose what to make (a report, a one-pager, a proposal, a handout, a poster, slides) and say anything it should
// know; the AI lays the pages out, Ironleaf prints and measures them and the AI fixes what is wrong (and, when the
// model sees pictures, looks the printed pages over), then the pages show here. Ask for changes in words, try another
// kind, or save the PDF (a meeting's or project's PDF can be kept with the note). The note itself is never changed.

import { useEffect, useRef, useState } from 'react';
import { DESIGN_KINDS, type DesignKind, type DesignViewOut } from '../../../shared/design-doc';
import { useEscape } from '../lib/useEscape';
import * as A from '../state/actions';
import { openModal } from '../state/modals';
import { designInputFor, isKeepNote, keepWithNote } from '../state/share';
import { docs } from '../state/docs';
import { showError, toast } from '../state/store';
import { Icon, type IconName } from './Icon';

const KIND_ICONS: Record<DesignKind, IconName> = { report: 'doc', 'one-pager': 'file', proposal: 'briefcase', handout: 'newspaper', poster: 'image', slides: 'present' };

type Stage = 'choose' | 'working' | 'result';

const newRequest = () => `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function DesignDialog({ path, onClose }: { path: string; onClose(): void }) {
  const title = A.titleOf(path);
  const [stage, setStage] = useState<Stage>('choose');
  const [kind, setKind] = useState<DesignKind>('report');
  const [brief, setBrief] = useState('');
  const [ready, setReady] = useState<{ model: string | null; pictures: boolean } | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [view, setView] = useState<DesignViewOut | null>(null);
  const [change, setChange] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const request = useRef<string>('');
  useEscape(() => {
    if (stage !== 'working') onClose();
  });

  useEffect(() => {
    let live = true;
    window.nv.design
      .ready()
      .then((r) => live && setReady(r))
      .catch(() => live && setReady({ model: null, pictures: false }));
    const off = window.nv.on.designStep((e) => {
      if (e.requestId === request.current) setSteps((s) => (s[s.length - 1] === e.words ? s : [...s, e.words]));
    });
    return () => {
      live = false;
      off();
      if (request.current) void window.nv.design.cancel(request.current);
    };
  }, []);

  const run = async (go: (id: string) => Promise<DesignViewOut>) => {
    const id = newRequest();
    request.current = id;
    setSteps([]);
    setFailed(null);
    setStage('working');
    try {
      const v = await go(id);
      if (request.current !== id) return;
      setView(v);
      setStage('result');
    } catch (err) {
      if (request.current !== id) return;
      const words = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err);
      setFailed(words === 'Stopped.' ? null : words);
      setStage(view ? 'result' : 'choose');
    } finally {
      if (request.current === id) request.current = '';
    }
  };

  const start = async () => {
    await docs.settle();
    const input = await designInputFor(path, kind, brief);
    if (!input) return;
    await run((id) => window.nv.design.start(id, input));
  };

  const ask = async () => {
    if (!view || !change.trim()) return;
    const words = change;
    setChange('');
    await run((id) => window.nv.design.change(id, view.id, words));
  };

  const stop = () => {
    if (request.current) void window.nv.design.cancel(request.current);
  };

  const save = async () => {
    if (!view) return;
    setSaving(true);
    try {
      const file = await window.nv.design.save(view.id, title);
      if (!file) return;
      const name = file.split(/[\\/]/).pop();
      const text = docs.text(path) ?? (await window.nv.notes.read(path));
      if (isKeepNote(path, text)) toast(`Saved ${name}.`, { label: 'Keep with this note', run: () => void keepWithNote(path, file) });
      else toast(`Saved ${name}.`, { label: 'Show', run: () => void window.nv.exports.reveal(file) });
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  const info = DESIGN_KINDS.find((k) => k.id === (view?.kind ?? kind)) ?? DESIGN_KINDS[0];
  const noModel = ready && !ready.model;

  return (
    <div className="overlay" onMouseDown={() => stage !== 'working' && onClose()}>
      <div className={`dialog ds-dialog is-${stage}`} role="dialog" aria-modal="true" aria-label="Design with AI" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ds-head">
          <span className="ds-mark">
            <Icon name="palette" size={18} />
          </span>
          <div className="ds-head-words">
            <h2>Design with AI</h2>
            <p className="hint">
              {stage === 'result' && view
                ? `${info.name} of “${title}” · ${view.pages} ${view.pages === 1 ? 'page' : 'pages'}${view.rounds ? ` · checked and improved ${view.rounds === 1 ? 'once' : `${view.rounds} times`}` : ' · checked'}`
                : `Your AI lays out “${title}” in your brand kit, prints it, checks every page and fixes what is wrong. The note itself is never changed.`}
            </p>
          </div>
          <button className="icon-button ds-close" aria-label="Close" disabled={stage === 'working'} onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        {stage === 'choose' && (
          <div className="ds-body ds-choose">
            <div className="ds-label">Make</div>
            <div className="ds-kinds" role="radiogroup" aria-label="What to make">
              {DESIGN_KINDS.map((k) => (
                <button key={k.id} role="radio" aria-checked={kind === k.id} className={`ds-kind${kind === k.id ? ' active' : ''}`} onClick={() => setKind(k.id)} onDoubleClick={() => !noModel && void start()}>
                  <span className="ds-kind-icon">
                    <Icon name={KIND_ICONS[k.id]} size={16} />
                  </span>
                  <span className="ds-kind-name">{k.name}</span>
                  <span className="ds-kind-words">{k.line}</span>
                </button>
              ))}
            </div>
            <label className="ds-field">
              <span className="ds-label">Anything it should know? (optional)</span>
              <textarea
                rows={3}
                value={brief}
                placeholder="For example: for the board, lead with the budget, keep it formal and calm."
                onChange={(e) => setBrief(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !noModel) void start();
                }}
              />
            </label>
            {failed && (
              <p className="ds-failed" role="alert">
                <Icon name="warning" size={13} /> {failed}
              </p>
            )}
            <div className="ds-foot">
              <span className="ds-model">
                {noModel ? (
                  <>
                    Designing needs an AI.{' '}
                    <button type="button" className="text-button" onClick={() => openModal({ kind: 'settings', section: 'models' })}>
                      Connect one
                    </button>
                  </>
                ) : ready ? (
                  `On ${ready.model}${ready.pictures ? ', which also looks over the printed pages' : ''}.`
                ) : (
                  ''
                )}
              </span>
              <span className="ds-space" />
              <button className="button" onClick={onClose}>
                Cancel
              </button>
              <button className="button primary" disabled={!!noModel || !ready} onClick={() => void start()}>
                Design it
              </button>
            </div>
          </div>
        )}

        {stage === 'working' && (
          <div className="ds-body ds-working" aria-live="polite">
            <div className="ds-spinner" aria-hidden="true" />
            <ol className="ds-steps">
              {(steps.length ? steps : ['Starting']).map((s, i, all) => (
                <li key={`${i}-${s}`} className={i === all.length - 1 ? 'is-now' : 'is-done'}>
                  {i === all.length - 1 ? <span className="ds-dot" /> : <Icon name="check" size={12} />}
                  {s}
                </li>
              ))}
            </ol>
            <p className="hint">A good design takes a minute or two: your AI writes the pages, then checks and fixes them.</p>
            <button className="button" onClick={stop}>
              Stop
            </button>
          </div>
        )}

        {stage === 'result' && view && (
          <div className="ds-body ds-result">
            <div className={`ds-pages${info.page.w > info.page.h ? ' is-wide' : ''}`}>
              {view.shots.map((src, i) => (
                <figure key={i} className="ds-page">
                  <img src={src} alt={`Page ${i + 1}`} />
                  <figcaption>{i + 1}</figcaption>
                </figure>
              ))}
              {view.pages > view.shots.length && <p className="hint ds-more">and {view.pages - view.shots.length} more in the PDF</p>}
            </div>
            <aside className="ds-side">
              {view.problems.length > 0 && (
                <div className="ds-left">
                  <div className="ds-label">Still to look at</div>
                  <ul>
                    {view.problems.slice(0, 5).map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {failed && (
                <p className="ds-failed" role="alert">
                  <Icon name="warning" size={13} /> {failed}
                </p>
              )}
              <label className="ds-field">
                <span className="ds-label">Ask for a change</span>
                <textarea
                  rows={4}
                  value={change}
                  placeholder="For example: bolder cover, put the key figures first, fewer words on page 2."
                  onChange={(e) => setChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void ask();
                  }}
                />
              </label>
              <button className="button" disabled={!change.trim()} onClick={() => void ask()}>
                <Icon name="sparkle" size={13} /> Change it
              </button>
              <button
                className="button ds-again"
                onClick={() => {
                  setFailed(null);
                  setStage('choose');
                }}
              >
                Make something else
              </button>
              <span className="ds-space" />
              <button className="button primary ds-save" disabled={saving} onClick={() => void save()}>
                <Icon name="download" size={13} /> Save as PDF…
              </button>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
