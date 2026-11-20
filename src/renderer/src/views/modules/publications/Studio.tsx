// The edition builder (Publications, Wave 6 part a; the plan: "Layout studio: choose a template, drag sections, see pages
// fill and overflow before printing, and set page counts per section"). On the left, the edition's sections in the
// publication's order, each with its page budget (changed here), how full it is, its sources and rules, and its pieces
// (dragged, moved, taken out, added from the store or written new). On the right, the real pages: the same document the
// PDF is printed from (src/shared/edition-doc.ts), so a page marked over its budget here is over in print too. Build the
// PDF, save a copy, send it and print it from the bar above.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { EditionDetail, ItemView, PubState } from '../../../../../main/publications';
import type { LaidOut } from '../../../../../shared/edition-doc';
import { EDITION_STATUSES, ITEM_KINDS, longDate, TEMPLATES, templateOf } from '../../../../../shared/publications';
import { confirm } from '../../../components/Dialogs';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import { errorMessage } from '../../../lib/errors';
import * as A from '../../../state/actions';
import { moduleChanged, useModuleTick } from '../../../state/modules';
import { peek } from '../../../state/peek';
import { showError, toast, useApp } from '../../../state/store';
import { StatusPill } from './Archive';
import { PieceForm } from './Pieces';
import { act, choose, KIND_ICON } from './usePub';

type Cur = NonNullable<PubState['current']>;
const PAGE_PX = (210 / 25.4) * 96;

export function useEditionDetail(rel: string): { detail: EditionDetail | null; failed: string | null; reload(): void } {
  const tick = useModuleTick();
  const [detail, setDetail] = useState<EditionDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!rel) return;
    let live = true;
    void window.nv.pub.edition(rel).then(
      (d) => {
        if (!live) return;
        setDetail(d);
        setFailed(null);
      },
      (err) => live && setFailed(errorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, [rel, tick, again]);
  return { detail, failed, reload: useCallback(() => setAgain((x) => x + 1), []) };
}

/** The pages in a frame, scaled to fit, read back as they lay out. */
function Pages({ rel, version, picked, onReport, onPick }: { rel: string; version: string; picked: string; onReport(r: LaidOut): void; onPick(id: string): void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(true);
  const [docH, setDocH] = useState(1200);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [spread, setSpread] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let live = true;
    setBusy(true);
    void window.nv.pub.preview(rel, picked).then(
      (r) => live && setUrl(r.url),
      (e) => {
        if (live) setBusy(false);
        showError(e);
      },
    );
    return () => {
      live = false;
    };
    // The frame shows a new picked piece without being laid out again (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rel, version]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const on = (ev: MessageEvent) => {
      if (ev.source !== frame.current?.contentWindow) return;
      const d = ev.data ?? {};
      if (d.nvEdition) {
        onReport(d.nvEdition as LaidOut);
        setDocH(Number(d.height) || 1200);
        setBusy(false);
      } else if (typeof d.nvEditionPick === 'string') onPick(d.nvEditionPick);
      else if (typeof d.nvEditionAt === 'number' && box.current) box.current.scrollTo({ top: Math.max(0, d.nvEditionAt * scaleRef.current - 40), behavior: 'smooth' });
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [onReport, onPick]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ nvEditionShow: picked }, '*');
  }, [picked]);
  const two = spread && width > 760;
  // The pages' own width in the frame (two side by side, or one), with the desk's margins and a little room to spare.
  const docW = Math.ceil((two ? PAGE_PX * 2 + 28 : PAGE_PX) + 56 + 8);
  const fit = Math.min(1, (width - 2) / docW);
  const scale = zoom === 'fit' ? fit : zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  return (
    <div className="pb-pages">
      <div className="pb-pages-bar">
        <div className="seg pb-seg" role="radiogroup" aria-label="Pages side by side">
          <button type="button" role="radio" aria-checked={two} className={two ? 'is-on' : ''} onClick={() => setSpread(true)} disabled={width <= 760}>
            Two pages
          </button>
          <button type="button" role="radio" aria-checked={!two} className={!two ? 'is-on' : ''} onClick={() => setSpread(false)}>
            One page
          </button>
        </div>
        <div className="seg pb-seg" role="radiogroup" aria-label="Zoom">
          {(['fit', 0.75, 1] as const).map((z) => (
            <button key={String(z)} type="button" role="radio" aria-checked={zoom === z} className={zoom === z ? 'is-on' : ''} onClick={() => setZoom(z)}>
              {z === 'fit' ? 'Fit' : `${Math.round(z * 100)}%`}
            </button>
          ))}
        </div>
        {busy && (
          <span className="pb-faint pb-laying">
            <span className="pb-spin" aria-hidden="true" /> Laying out the pages…
          </span>
        )}
      </div>
      <div className="pb-desk" ref={box}>
        <div className="pb-desk-in" style={{ width: docW * scale, height: docH * scale }}>
          {url && <iframe ref={frame} key={url} title="The edition’s pages" src={url} className="pb-frame" style={{ width: docW, height: docH, transform: `scale(${scale})` }} />}
        </div>
      </div>
    </div>
  );
}

function Meter({ used, budget, estimated }: { used: number; budget: number; estimated?: boolean }) {
  const over = used > budget + 0.05;
  const pct = Math.min(100, (used / Math.max(0.5, budget)) * 100);
  return (
    <div className={`pb-meter${over ? ' is-over' : used >= budget - 0.15 ? ' is-full' : ''}`} title={estimated ? 'An estimate until the pages are laid out' : undefined}>
      <span className="pb-meter-bar">
        <i style={{ width: `${pct}%` }} />
        {over && <b style={{ width: `${Math.min(100, ((used - budget) / Math.max(0.5, budget)) * 100)}%` }} />}
      </span>
      <span className="pb-meter-words">
        {estimated ? 'about ' : ''}
        {over ? `${Math.round((used - budget) * 10) / 10} of a page over` : `${used} of ${budget}`}
      </span>
    </div>
  );
}

export function Studio({ state, cur, edition }: { state: PubState; cur: Cur; edition: string }) {
  const canEdit = useApp((s) => s.canEdit);
  const pick0 = cur.editions.find((e) => e.path === edition) ?? cur.editions.find((e) => e.status === 'Draft' && !e.preview) ?? cur.editions[0];
  const rel = pick0?.path ?? '';
  const { detail, failed } = useEditionDetail(rel);
  const [report, setReport] = useState<LaidOut | null>(null);
  const [picked, setPicked] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ from: string; path: string } | null>(null);
  const [busy, setBusy] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setReport(null), [rel]);
  // What the pages are made from: a change here lays them out again.
  const version = useMemo(() => (detail ? JSON.stringify([detail.sections.map((s) => [s.name, s.pages, s.items.map((i) => `${i.path}:${i.headline}:${i.words}:${i.section}`)]), detail.edition.template, detail.edition.date, detail.edition.number, cur.pub.style, cur.pub.masthead, cur.pub.motto]) : ''), [detail, cur.pub]);
  const onReport = useCallback((r: LaidOut) => setReport(r), []);
  const onPick = useCallback((id: string) => {
    setPicked(id);
    const el = listRef.current?.querySelector(`[data-piece="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  if (!rel) return <EmptyState size="panel" icon="layers" title="No edition to build yet" line="Start an edition and its sections are ready to fill." action={{ label: 'Start an edition', run: () => void act(() => window.nv.pub.newEdition(cur.pub.path)).then((r) => r && choose({ edition: r })) }} />;
  if (failed && !detail) return <EmptyState size="panel" icon="warning" title="That edition couldn’t be read" line={failed} />;
  if (!detail) return <p className="pb-faint pb-loading">Opening the edition…</p>;

  const e = detail.edition;
  const sections = detail.sections;
  const titleOf = (id: string) => sections.flatMap((s) => s.items).find((i) => i.path === id)?.headline ?? id;
  const overflow = new Set(report?.sections.flatMap((s) => s.overflow) ?? []);
  const cut = new Set(report?.cut ?? []);
  const fitOf = (name: string) => report?.sections.find((s) => s.name === name);
  const estOf = (name: string) => detail.estimate.find((s) => s.name === name);
  const used = new Set(sections.flatMap((s) => s.items.map((i) => i.path)));
  const lastPuzzle = [...sections].reverse().find((s) => s.items.some((i) => ITEM_KINDS.find((k) => k.id === i.kind)?.puzzle))?.name ?? sections.at(-1)?.name;

  const save = async (next: { name: string; items: string[] }[], said?: string) => {
    await act(() => window.nv.pub.setEdition(rel, { sections: next }), said);
  };
  const shape = () => sections.map((s) => ({ name: s.name, items: s.items.map((i) => i.path.replace(/\.md$/i, '')) }));
  const move = (from: string, path: string, to: string, at?: number) => {
    const next = shape();
    const key = path.replace(/\.md$/i, '');
    const src = next.find((s) => s.name === from);
    const dst = next.find((s) => s.name === to);
    if (!src || !dst) return;
    const i = src.items.indexOf(key);
    if (i < 0) return;
    src.items.splice(i, 1);
    const pos = at === undefined ? dst.items.length : Math.max(0, Math.min(dst.items.length, at));
    dst.items.splice(pos, 0, key);
    void save(next);
  };
  const remove = (from: string, path: string) => {
    const next = shape();
    const s = next.find((x) => x.name === from);
    if (!s) return;
    s.items = s.items.filter((x) => x !== path.replace(/\.md$/i, ''));
    void save(next, `Took “${titleOf(path)}” out of ${e.label}. It stays in the pieces.`);
  };
  const add = (to: string, paths: string[]) => {
    const next = shape();
    const s = next.find((x) => x.name === to);
    if (!s) return;
    for (const p of paths) if (!s.items.includes(p.replace(/\.md$/i, ''))) s.items.push(p.replace(/\.md$/i, ''));
    void save(next, `${paths.length === 1 ? `Added “${titleOf(paths[0]!) === paths[0] ? 'the piece' : titleOf(paths[0]!)}”` : `Added ${paths.length} pieces`} to ${to}.`);
  };
  const budget = (name: string, pages: number) => {
    const all = cur.pub.sections.map((s) => (s.name === name ? { ...s, pages } : s));
    void act(() => window.nv.pub.sections(cur.pub.path, all));
  };
  const build = async () => {
    // An imported edition's PDF is the one that went out: a new one is built only when the person says, and the old stays.
    if (e.imported && e.pdf && !(await confirm(`Build a new PDF for ${e.label}?`, { message: `${e.label}’s PDF (${e.pdf.split('/').pop()}) is the one that went out. A new PDF is made from the pieces in this edition and kept beside it; the original stays where it is.`, ok: 'Build a new PDF' }))) return;
    setBusy('build');
    await act(() => window.nv.pub.build(rel), (r) => r.words);
    setBusy('');
  };
  const send = (how?: string[]) => {
    setBusy('send');
    void act(() => window.nv.pub.deliver(rel, how), (w) => w).finally(() => setBusy(''));
  };
  const d = cur.pub.delivery;
  const sendMenu = (el: HTMLElement) => {
    const items: MenuItem[] = [
      { label: 'Every way it is set to', icon: 'send', disabled: !(d.telegram || d.email.length || (d.print && d.printer)), run: () => send() },
      { separator: true },
      { label: d.email.length ? `Email to ${d.email.join(', ')}` : 'Email (no address set)', icon: 'mail', disabled: !state.canSend || !d.email.length, run: () => send(['email']) },
      { label: d.printer ? `Print on ${d.printer}` : 'Print (no printer chosen)', icon: 'download', disabled: !d.printer, run: () => send(['print']) },
    ];
    openMenu(el, items);
  };
  const dropOn = (to: string, at?: number) => (ev: DragEvent) => {
    ev.preventDefault();
    if (drag) move(drag.from, drag.path, to, at);
    setDrag(null);
  };

  return (
    <div className="pb-studio">
      <div className="pb-studio-bar">
        <button
          type="button"
          className="pb-ed-pick"
          onClick={(ev) =>
            openMenu(
              ev.currentTarget,
              cur.editions.map((x) => ({ label: `${x.label} · ${longDate(x.date) || 'not dated'} · ${x.status}`, checked: x.path === rel, run: () => choose({ edition: x.path }) })),
            )
          }
          aria-label="Choose the edition"
        >
          <strong>{e.label}</strong>
          <span>{longDate(e.date) || 'Not dated'}</span>
          <Icon name="chevron" size={12} />
        </button>
        <label className="pb-mini">
          <span>Date</span>
          <input type="date" className="pb-input" value={e.date ?? ''} disabled={!canEdit} onChange={(ev) => ev.target.value && void act(() => window.nv.pub.setEdition(rel, { date: ev.target.value }))} />
        </label>
        <label className="pb-mini">
          <span>Layout</span>
          <select className="pb-input" value={templateOf(e.template || cur.pub.template.id).id} disabled={!canEdit} onChange={(ev) => void act(() => window.nv.pub.setEdition(rel, { template: ev.target.value }))}>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="pb-status-btn" disabled={!canEdit} onClick={(ev) => openMenu(ev.currentTarget, EDITION_STATUSES.map((s) => ({ label: s, checked: s === e.status, run: () => void act(() => window.nv.pub.setEdition(rel, { status: s })) })))} aria-label={`Status: ${e.status}. Change it`}>
          <StatusPill status={e.status} />
        </button>
        <span className="sv-grow" />
        {e.pdf ? (
          <button type="button" className="sv-tool" onClick={() => A.openPath(e.pdf, { where: 'tab' })} title={e.pdf}>
            <Icon name="pdf" size={13} /> Open the PDF{e.pages ? ` · ${e.pages} ${e.pages === 1 ? 'page' : 'pages'}` : ''}
          </button>
        ) : (
          <span className="pb-faint">No PDF yet</span>
        )}
        <button type="button" className="sv-tool" disabled={!!busy} onClick={(ev) => sendMenu(ev.currentTarget)}>
          <Icon name="send" size={13} /> {busy === 'send' ? 'Sending…' : 'Send or print'}
        </button>
        <button type="button" className="button primary small" disabled={!canEdit || !!busy} onClick={() => void build()}>
          <Icon name="pdf" size={13} /> {busy === 'build' ? 'Building the PDF…' : e.pdf ? 'Build the PDF again' : 'Build the PDF'}
        </button>
        <button
          type="button"
          className="sv-tool sv-tool-icon"
          aria-label="More for this edition"
          onClick={(ev) =>
            openMenu(ev.currentTarget, [
              { label: 'Save a copy of the PDF…', icon: 'download', run: () => void window.nv.pub.exportPdf(rel).then((f) => f && toast(`Saved to ${f}.`), showError) },
              { label: 'Open the edition’s note', icon: 'notes', run: () => A.openPath(rel, { where: 'tab' }) },
              { label: 'Start the next edition from this one', icon: 'copy', disabled: !canEdit, run: () => void act(() => window.nv.pub.newEdition(cur.pub.path, { copyFrom: rel }), 'Started the next edition with this one’s regular pieces.').then((r) => r && choose({ edition: r })) },
            ])
          }
        >
          <Icon name="more" size={15} />
        </button>
      </div>
      <div className="pb-fit-line" role="status">
        {report ? (
          <>
            <strong>{report.pages} {report.pages === 1 ? 'page' : 'pages'}.</strong>{' '}
            {report.sections.filter((s) => s.over).length ? (
              <span className="is-bad">
                {report.sections
                  .filter((s) => s.over)
                  .map((s) => `${s.name} runs ${Math.round((s.used - s.budget) * 10) / 10} of a page over`)
                  .join('; ')}
                : move or shorten what is marked, or give the section more pages.
              </span>
            ) : (
              <span>Every section fits its pages.</span>
            )}
            {report.cut.length ? <span className="is-bad"> Too long for one page: {report.cut.map((x) => `“${titleOf(x)}”`).join(', ')}.</span> : null}
          </>
        ) : (
          <span className="pb-faint">About: {detail.estimateWords}.</span>
        )}
      </div>
      <div className="pb-studio-grid">
        <div className="pb-secs" ref={listRef} aria-label="The edition’s sections">
          {sections.map((s, si) => {
            const fit = fitOf(s.name);
            const est = estOf(s.name);
            return (
              <section key={s.name} className={`pb-sec${fit?.over ? ' is-over' : ''}`} onDragOver={(ev) => drag && ev.preventDefault()} onDrop={dropOn(s.name)} aria-label={s.name}>
                <header className="pb-sec-head">
                  <h3>{s.name}</h3>
                  <div className="pb-budget" role="group" aria-label={`${s.name}’s pages`}>
                    <button type="button" className="icon-button small" disabled={!canEdit || s.pages <= 0.5} onClick={() => budget(s.name, Math.max(0.5, s.pages - (s.pages > 1 ? 1 : 0.5)))} aria-label={`One page less for ${s.name}`}>
                      <Icon name="minus" size={12} />
                    </button>
                    <span>
                      {s.pages} {s.pages === 1 ? 'page' : 'pages'}
                    </span>
                    <button type="button" className="icon-button small" disabled={!canEdit} onClick={() => budget(s.name, s.pages >= 1 ? s.pages + 1 : 1)} aria-label={`One page more for ${s.name}`}>
                      <Icon name="plus" size={12} />
                    </button>
                  </div>
                </header>
                {fit ? <Meter used={fit.used} budget={fit.budget} /> : est ? <Meter used={est.used} budget={est.budget} estimated /> : s.items.length === 0 && si > 0 ? <p className="pb-sec-empty">Left out of the pages until it has a piece.</p> : null}
                {(s.rules || s.sources) && (
                  <p className="pb-sec-rules">
                    {s.sources && (
                      <span className="pb-src-rule">
                        <Icon name="link" size={11} /> {s.sources}
                      </span>
                    )}
                    {s.rules}
                  </p>
                )}
                <ol className="pb-pieces">
                  {s.items.map((it: ItemView, i) => {
                    const bad = overflow.has(it.path);
                    const long = cut.has(it.path);
                    return (
                      <li
                        key={it.path}
                        data-piece={it.path}
                        className={`pb-piece${picked === it.path ? ' is-picked' : ''}${bad ? ' is-over' : ''}${drag?.path === it.path ? ' is-dragging' : ''}`}
                        draggable={canEdit}
                        onDragStart={(ev) => {
                          ev.dataTransfer.effectAllowed = 'move';
                          ev.dataTransfer.setData('text/plain', it.path);
                          setDrag({ from: s.name, path: it.path });
                        }}
                        onDragEnd={() => setDrag(null)}
                        onDragOver={(ev) => drag && (ev.preventDefault(), ev.stopPropagation())}
                        onDrop={(ev) => {
                          ev.stopPropagation();
                          dropOn(s.name, i)(ev);
                        }}
                      >
                        <span className="pb-grip" aria-hidden="true">
                          <Icon name="grip" size={12} />
                        </span>
                        <button type="button" className="pb-piece-main" onClick={() => setPicked(it.path)} onDoubleClick={() => peek({ type: 'note', path: it.path }, { title: it.headline, type: 'note' })} title="Click to find it on the pages; double-click to open it">
                          <span className="pb-piece-icon" aria-hidden="true">
                            <Icon name={KIND_ICON[it.kind] ?? 'notes'} size={13} />
                          </span>
                          <span className="pb-piece-words">
                            <span className="pb-piece-head">
                              {it.lead && <em className="pb-lead-tag">Lead</em>}
                              {it.headline}
                            </span>
                            <span className="pb-piece-sub">
                              {[it.kindName, it.source, it.puzzle, it.words > 20 ? `${it.words} words` : ''].filter(Boolean).join(' · ')}
                            </span>
                            {(bad || long || it.problems.length > 0) && <span className="pb-piece-flag">{long ? 'Too long for one page' : bad ? 'Doesn’t fit the budget' : it.problems[0]}</span>}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="icon-button small pb-piece-more"
                          aria-label={`More for ${it.headline}`}
                          onClick={(ev) =>
                            openMenu(ev.currentTarget, [
                              { label: 'Open it', icon: 'notes', run: () => peek({ type: 'note', path: it.path }, { title: it.headline, type: 'note' }) },
                              { label: 'Move up', icon: 'back', disabled: !canEdit || i === 0, run: () => move(s.name, it.path, s.name, i - 1) },
                              { label: 'Move down', icon: 'forward', disabled: !canEdit || i === s.items.length - 1, run: () => move(s.name, it.path, s.name, i + 1) },
                              { label: 'Move to', icon: 'layers', disabled: !canEdit, submenu: sections.filter((x) => x.name !== s.name).map((x) => ({ label: x.name, run: () => move(s.name, it.path, x.name) })) },
                              { separator: true },
                              { label: 'Take it out of this edition', icon: 'close', disabled: !canEdit, run: () => remove(s.name, it.path) },
                            ])
                          }
                        >
                          <Icon name="more" size={13} />
                        </button>
                      </li>
                    );
                  })}
                  {s.name === lastPuzzle && detail.answers && (
                    <li className="pb-piece is-auto">
                      <span className="pb-piece-icon" aria-hidden="true">
                        <Icon name="check" size={13} />
                      </span>
                      <span className="pb-piece-words">
                        <span className="pb-piece-head">Answers to {detail.answers.from}</span>
                        <span className="pb-piece-sub">Added by itself: {detail.answers.count} {detail.answers.count === 1 ? 'puzzle' : 'puzzles'} from the last edition</span>
                      </span>
                    </li>
                  )}
                </ol>
                {s.missing.length > 0 && <p className="pb-missing">{s.missing.length === 1 ? 'A link here doesn’t lead to a piece' : `${s.missing.length} links here don’t lead to a piece`}: {s.missing.join(', ')}.</p>}
                <div className="pb-sec-add">
                  <button type="button" className="link-button" disabled={!canEdit} onClick={() => setAdding(s.name)}>
                    <Icon name="plus" size={12} /> Add pieces
                  </button>
                  <button type="button" className="link-button" disabled={!canEdit} onClick={() => setWriting(s.name)}>
                    <Icon name="pencil" size={12} /> Write a new one
                  </button>
                </div>
              </section>
            );
          })}
        </div>
        <Pages rel={rel} version={version} picked={picked} onReport={onReport} onPick={onPick} />
      </div>
      {adding && (
        <PiecePicker
          cur={cur}
          section={adding}
          sections={sections.map((s) => s.name)}
          used={used}
          onClose={() => setAdding(null)}
          onAdd={(to, paths) => {
            add(to, paths);
            setAdding(null);
          }}
        />
      )}
      {writing && (
        <div className="overlay pb-overlay" onMouseDown={() => setWriting(null)}>
          <div className="dialog pb-dialog is-wide" role="dialog" aria-label="Write a new piece" onMouseDown={(ev) => ev.stopPropagation()}>
            <PieceForm
              cur={cur}
              section={writing}
              onCancel={() => setWriting(null)}
              onDone={(path) => {
                const to = writing;
                setWriting(null);
                const next = shape();
                const sec = next.find((x) => x.name === to);
                if (sec) sec.items.push(path.replace(/\.md$/i, ''));
                void save(next, `Added to ${to}.`).then(() => moduleChanged());
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PiecePicker({ cur, section, sections, used, onClose, onAdd }: { cur: Cur; section: string; sections: string[]; used: Set<string>; onClose(): void; onAdd(to: string, paths: string[]): void }) {
  const [q, setQ] = useState('');
  const [to, setTo] = useState(section);
  const [kind, setKind] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const list = cur.items.filter((i) => !used.has(i.path) && (!kind || i.kind === kind) && (!q || `${i.headline} ${i.source} ${i.section} ${i.kindName}`.toLowerCase().includes(q.toLowerCase())));
  const mine = list.filter((i) => i.section.toLowerCase() === to.toLowerCase());
  const others = list.filter((i) => i.section.toLowerCase() !== to.toLowerCase());
  const row = (i: ItemView) => (
    <li key={i.path}>
      <label className={`pb-pick-row${chosen.includes(i.path) ? ' is-on' : ''}`}>
        <input type="checkbox" checked={chosen.includes(i.path)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, i.path] : c.filter((x) => x !== i.path)))} />
        <Icon name={KIND_ICON[i.kind] ?? 'notes'} size={13} />
        <span className="pb-pick-words">
          <strong>{i.headline}</strong>
          <em>{[i.kindName, i.section, i.source, i.editions.length ? `in ${i.editions.slice(0, 2).join(', ')}` : 'not used yet'].filter(Boolean).join(' · ')}</em>
        </span>
      </label>
    </li>
  );
  return (
    <div className="overlay pb-overlay" onMouseDown={onClose}>
      <div className="dialog pb-dialog is-wide" role="dialog" aria-label="Add pieces" onMouseDown={(e) => e.stopPropagation()}>
        <header className="pb-dialog-head">
          <h2>Add pieces</h2>
          <label className="pb-mini">
            <span>To</span>
            <select className="pb-input" value={to} onChange={(e) => setTo(e.target.value)}>
              {sections.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </header>
        <div className="pb-pick-tools">
          <input className="pb-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a piece" autoFocus />
          <select className="pb-input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
            <option value="">Every kind</option>
            {ITEM_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </div>
        <div className="pb-pick-list">
          {!list.length && <p className="pb-faint">{cur.items.length ? 'Every piece that matches is in this edition already.' : 'No pieces yet: write one, or make a puzzle.'}</p>}
          {mine.length > 0 && (
            <>
              <h4>Written for {to}</h4>
              <ul>{mine.map(row)}</ul>
            </>
          )}
          {others.length > 0 && (
            <>
              <h4>{mine.length ? 'Everything else' : 'Pieces'}</h4>
              <ul>{others.map(row)}</ul>
            </>
          )}
        </div>
        <div className="pb-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={!chosen.length} onClick={() => onAdd(to, chosen)}>
            Add {chosen.length || ''} to {to}
          </button>
        </div>
      </div>
    </div>
  );
}
