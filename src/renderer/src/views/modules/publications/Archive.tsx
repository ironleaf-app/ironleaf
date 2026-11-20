// The archive (Publications, Wave 6 part a; the plan: "Archive and search across every edition ('the crossword with
// BOLAND in it', 'every Storm story')"): what is due next, every edition newest first with its front page, and a
// search across all of them — pieces, puzzles' answers and the PDFs' own words.

import { useEffect, useRef, useState } from 'react';
import type { PubState, EditionView } from '../../../../../main/publications';
import { kindInfo, longDate, shortDate, type SearchHit } from '../../../../../shared/publications';
import { isoOf } from '../../../../../shared/finance';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { openMenu } from '../../../components/Menu';
import { usePdfFirstPage } from '../../../lib/pdfThumb';
import * as A from '../../../state/actions';
import { openModule } from '../../../state/modules';
import { peek } from '../../../state/peek';
import { showError, useApp } from '../../../state/store';
import { act, choose, KIND_ICON } from './usePub';

type Cur = NonNullable<PubState['current']>;

export function StatusPill({ status }: { status: string }) {
  return <span className={`pb-status is-${status.toLowerCase()}`}>{status}</span>;
}

function Front({ e, masthead }: { e: EditionView; masthead: string }) {
  const meta = useApp((s) => (e.pdf ? s.files.find((f) => f.rel === e.pdf) : undefined));
  const { ref, url } = usePdfFirstPage(e.pdf ? { rel: e.pdf } : null, meta ? `${meta.mtime}:${meta.size}` : e.pdf);
  return (
    <div className="pb-front" ref={ref as React.RefObject<HTMLDivElement>}>
      {url ? (
        <img src={url} alt={`${masthead} ${e.label}, front page`} draggable={false} />
      ) : (
        <div className="pb-front-made" aria-hidden="true">
          <span className="pb-front-mast">{masthead}</span>
          <span className="pb-front-line">
            <span>{e.label}</span>
            <span>{shortDate(e.date)}</span>
          </span>
          {e.lead ? <span className="pb-front-lead">{e.lead}</span> : <span className="pb-front-empty">{e.pieces ? `${e.pieces} ${e.pieces === 1 ? 'piece' : 'pieces'}` : 'No pieces yet'}</span>}
          <span className="pb-front-cols">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
    </div>
  );
}

function EditionCard({ e, cur }: { e: EditionView; cur: Cur }) {
  const canEdit = useApp((s) => s.canEdit);
  const open = () => {
    choose({ edition: e.path });
    openModule('publications', 'studio');
  };
  const menu = (el: HTMLElement) =>
    openMenu(el, [
      { label: 'Open in the edition builder', icon: 'layers', run: open },
      { label: 'Open the PDF', icon: 'pdf', disabled: !e.pdf, run: () => e.pdf && A.openPath(e.pdf, { where: 'tab' }) },
      { label: 'Open the edition’s note', icon: 'notes', run: () => A.openPath(e.path, { where: 'tab' }) },
      { separator: true },
      { label: e.pdf ? 'Build the PDF again' : 'Build the PDF', icon: 'refresh', disabled: !canEdit, run: () => void act(() => window.nv.pub.build(e.path), (r) => r.words) },
      { label: 'Save a copy of the PDF…', icon: 'download', run: () => void window.nv.pub.exportPdf(e.path).then((f) => f && act(async () => f, `Saved to ${f}.`), showError) },
      { label: 'Send and print now', icon: 'send', disabled: !canEdit, run: () => void act(() => window.nv.pub.deliver(e.path), (w) => w) },
    ]);
  return (
    <article className={`pb-card${e.preview ? ' is-preview' : ''}`}>
      <button type="button" className="pb-card-open" onClick={open} aria-label={`Open ${cur.pub.masthead} ${e.label} in the edition builder`}>
        <Front e={e} masthead={cur.pub.masthead} />
      </button>
      <div className="pb-card-words">
        <div className="pb-card-top">
          <strong>{e.label}</strong>
          <StatusPill status={e.status} />
          <button type="button" className="icon-button small pb-card-more" aria-label={`More for ${e.label}`} onClick={(ev) => menu(ev.currentTarget)}>
            <Icon name="more" size={14} />
          </button>
        </div>
        <span className="pb-card-date">{longDate(e.date) || 'Not dated'}</span>
        {e.lead && <span className="pb-card-lead">{e.lead}</span>}
        <span className="pb-card-meta">
          {[e.pages ? `${e.pages} pages` : '', e.pieces ? `${e.pieces} ${e.pieces === 1 ? 'piece' : 'pieces'}` : '', e.pdf ? 'PDF' : 'No PDF yet'].filter(Boolean).join(' · ')}
        </span>
        {e.delivered && <span className="pb-card-sent">{e.delivered}</span>}
      </div>
    </article>
  );
}

export function Hits({ hits, query }: { hits: SearchHit[]; query: string }) {
  if (!hits.length) return <EmptyState size="panel" icon="search" title={`Nothing matches “${query}”`} line="Search looks in every piece, every puzzle’s answers and clues, and the words of every edition’s PDF." />;
  return (
    <ul className="pb-hits" aria-label="What the search found">
      {hits.map((h, i) => (
        <li key={`${h.item ?? h.edition}-${i}`}>
          <button
            type="button"
            className="pb-hit"
            onClick={() => {
              if (h.item) peek({ type: 'note', path: h.item }, { title: h.headline, type: 'note' });
              else if (h.edition) {
                choose({ edition: h.edition });
                openModule('publications', 'studio');
              }
            }}
          >
            <span className="pb-hit-icon" aria-hidden="true">
              <Icon name={h.kind === 'edition' ? 'pdf' : (KIND_ICON[h.kind] ?? 'notes')} size={14} />
            </span>
            <span className="pb-hit-words">
              <span className="pb-hit-head">
                <span className="pb-hit-kind">{h.kind === 'edition' ? 'Edition' : (kindInfo(h.kind)?.name ?? 'Piece')}</span>
                {h.headline}
              </span>
              <span className="pb-hit-snip">{h.snippet}</span>
            </span>
            <span className="pb-hit-ed">
              {h.editionLabel}
              {h.date ? <em>{shortDate(h.date)}</em> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Archive({ state, cur }: { state: PubState; cur: Cur }) {
  const canEdit = useApp((s) => s.canEdit);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setHits(null);
      return;
    }
    timer.current = setTimeout(() => {
      setSearching(true);
      void window.nv.pub
        .search(q, cur.pub.path)
        .then(setHits, showError)
        .finally(() => setSearching(false));
    }, 260);
  }, [q, cur.pub.path]);
  const next = cur.next;
  const start = async () => {
    const rel = await act(() => window.nv.pub.newEdition(cur.pub.path, { date: next ? isoOf(new Date(next.at)) : undefined }), 'Started the next edition.');
    if (rel) {
      choose({ edition: rel });
      openModule('publications', 'studio');
    }
  };
  return (
    <div className="pb-archive">
      <div className="pb-search">
        <Icon name="search" size={15} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every edition: “the crossword with HARBOUR in it”, “every rugby story”" aria-label="Search every edition" />
        {searching && <span className="pb-faint">Searching…</span>}
      </div>
      {hits && <Hits hits={hits} query={q} />}
      {!hits && (
        <>
          {next && (
            <section className={`pb-next${next.edition ? ` is-${next.edition.status.toLowerCase()}` : ' is-none'}`} aria-label="Next edition">
              <div className="pb-next-when">
                <span>Next edition</span>
                <strong>{next.words}</strong>
              </div>
              <div className="pb-next-words">
                {next.edition ? (
                  <>
                    <strong>{next.edition.label}</strong> is {next.edition.status === 'Draft' ? 'a draft' : next.edition.status.toLowerCase()} with {next.edition.pieces} {next.edition.pieces === 1 ? 'piece' : 'pieces'}{next.edition.pdf ? ', its PDF built' : ', no PDF yet'}.
                    {state.deliveryOn && (cur.pub.delivery.telegram || cur.pub.delivery.email.length || (cur.pub.delivery.print && cur.pub.delivery.printer)) ? ` It goes out by itself at the time: ${[cur.pub.delivery.telegram ? 'Telegram' : '', cur.pub.delivery.email.length ? 'email' : '', cur.pub.delivery.print && cur.pub.delivery.printer ? `printed on ${cur.pub.delivery.printer}` : ''].filter(Boolean).join(', ')}.` : ''}
                  </>
                ) : (
                  <>Nothing is started for it yet.</>
                )}
              </div>
              {next.edition ? (
                <button
                  type="button"
                  className="button small"
                  onClick={() => {
                    choose({ edition: next.edition!.path });
                    openModule('publications', 'studio');
                  }}
                >
                  Open it
                </button>
              ) : (
                <button type="button" className="button small primary" disabled={!canEdit} onClick={() => void start()}>
                  Start it
                </button>
              )}
            </section>
          )}
          {cur.editions.length ? (
            <div className="pb-cards" aria-label="Editions">
              {cur.editions.map((e) => (
                <EditionCard key={e.path} e={e} cur={cur} />
              ))}
            </div>
          ) : (
            <EmptyState size="panel" icon="newspaper" title="No editions yet" line="Start the first one: pick its pieces in the edition builder and watch the pages fill." action={{ label: 'Start the first edition', run: () => void start() }} />
          )}
        </>
      )}
    </div>
  );
}
