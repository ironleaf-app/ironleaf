// Publications (8.7 wave 3a, the Vault redesign, work half): the household's papers as a normal pack page (the tile
// with the title, one line, the next edition, then the labelled cards), wired to the pack's real data and actions. The
// main page lists every edition newest first with its state, and the next edition's pieces and puzzles with what each
// still needs; each edition has its own page (its page plan against each section's budget, its puzzles, sending and
// printing). The edition builder, pieces, puzzles and settings stay as inner pages in the same shape, reached from the
// one menu. Everything is notes in the Publications area; every value shown changes where it is shown.

import { useEffect, useRef, useState } from 'react';
import type { EditionDetail, EditionView, PubState } from '../../../../main/publications';
import { editionDay, kindInfo, shortDate, timeWords, type SearchHit } from '../../../../shared/publications';
import { plural } from '../../../../shared/words';
import { EmptyState } from '../../components/EmptyState';
import type { MenuItem } from '../../components/Menu';
import * as A from '../../state/actions';
import { openModal } from '../../state/modals';
import { openTour } from '../../state/moduleFills';
import { openModule, partOfTab } from '../../state/modules';
import { peek } from '../../state/peek';
import { showError, useApp } from '../../state/store';
import type * as W from '../../state/workspace';
import { Hits } from './publications/Archive';
import { ImportReview } from './publications/ImportReview';
import { Pieces } from './publications/Pieces';
import { PubSettings } from './publications/PubSettings';
import { Puzzles } from './publications/Puzzles';
import { StartPublication } from './publications/StartPublication';
import { Studio, useEditionDetail } from './publications/Studio';
import { act, choose, useChosen, usePub, todayIso } from './publications/usePub';
import { AskFloat, PackSection, PackShell, packName, rowContext, rowMenu, shortDay, type Tint } from './pack87';

type Cur = NonNullable<PubState['current']>;
type Part = 'editions' | 'studio' | 'items' | 'puzzles' | 'settings';
const LINES: Record<Part, string> = {
  editions: 'Every edition, newest first. Search all of them, puzzles’ answers and PDFs included.',
  studio: 'Pick the pieces, set each section’s pages, and see the real pages fill before you build the PDF.',
  items: 'Every story, picture, table and puzzle, each kept once with its source and used in any edition.',
  puzzles: 'Make a crossword, sudoku, word search or daily word. Answers print in the next edition by themselves.',
  settings: 'The masthead, schedule, sections with their sources and rules, house style and how it is delivered.',
};
const PART_LABEL: Record<Part, string> = { editions: 'Editions', studio: 'Edition builder', items: 'Pieces', puzzles: 'Puzzles', settings: 'Settings' };

/** An edition's tag: Late when its day passed unbuilt and unsent, else its state in plain words. */
function editionTag(e: EditionView, today: string): { tone: Tint; words: string } {
  const late = e.date !== null && e.date < today && e.status !== 'Delivered' && e.status !== 'Printed';
  if (late) return { tone: 'red', words: 'Late' };
  if (e.status === 'Draft') return { tone: 'amber', words: 'Building' };
  if (e.status === 'Built') return { tone: 'green', words: 'Built' };
  if (e.status === 'Delivered') return { tone: 'green', words: 'Sent' };
  return { tone: 'slate', words: e.pieces > 0 ? `${e.pieces} kept` : 'Printed' };
}

const openEdition = (e: EditionView) => {
  choose({ edition: e.path });
  openModule('publications', `edition:${e.path}`);
};

function EditionTrow({ e, today }: { e: EditionView; today: string }) {
  const tag = editionTag(e, today);
  // The middle says when it went out, or how long it is; when neither is known it says nothing at all.
  const meta = e.delivered || (e.pages ? `${plural(e.pages, 'page')}` : '');
  return (
    <div
      className="trow"
      {...rowContext(() => [
        { label: `Open ${e.label}`, icon: 'newspaper', run: () => openEdition(e) },
        { label: 'Open in the edition builder', icon: 'layers', run: () => { choose({ edition: e.path }); openModule('publications', 'studio'); } },
        { label: 'Open the PDF', icon: 'pdf', disabled: !e.pdf, run: () => e.pdf && A.openPath(e.pdf, { where: 'tab' }) },
        { label: 'Open the edition’s note', icon: 'notes', run: () => A.openPath(e.path, { where: 'tab' }) },
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, run: () => void A.trashPath(e.path).catch(showError) },
      ])}
    >
      <span className={`gtile xs ${tag.tone}`} aria-hidden="true">
        ¶
      </span>
      <button type="button" onClick={() => openEdition(e)} className="t" title={e.label} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {e.label}
        {e.lead ? ` · ${e.lead}` : e.date ? ` · ${shortDay(e.date)}` : ''}
      </button>
      <span className="end">
        {meta && <span className="meta">{meta} ·</span>}
        <span className={`tag ${tag.tone}`}>{tag.words}</span>
      </span>
    </div>
  );
}

/** The next edition's pieces and puzzles: what is picked and ready, and what is still missing. */
function NextPieces({ detail, label }: { detail: EditionDetail; label: string }) {
  const picked = detail.sections.flatMap((s) => s.items.map((it) => ({ section: s.name, it })));
  const missing = detail.sections.flatMap((s) => s.missing.map((name) => ({ section: s.name, rules: s.rules, name })));
  if (!picked.length && !missing.length) return null;
  return (
    <PackSection label={`Pieces and puzzles for ${label}`}>
      {[...picked, ...Array(missing.length).fill(null)].slice(0, 8).map((row, i) =>
        row ? (
          <div key={row.it.path} className="trow">
            {/* Every row starts with the one tile slot, so every row's words share one left edge. */}
            <span className="gtile xs green" aria-hidden="true">
              ✓
            </span>
            <button type="button" onClick={() => peek({ type: 'note', path: row.it.path }, { title: row.it.headline, type: 'note' })} className="t" title={row.it.headline} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
              {row.it.headline}
            </button>
            <span className="end">
              <span className="meta">{row.it.source ? `source: ${row.it.source}` : kindInfo(row.it.kind)?.name ?? row.section} ·</span>
              <span className="tag green">Ready</span>
            </span>
          </div>
        ) : (
          <div key={`missing-${i}`} className="trow">
            <span className="gtile xs slate" aria-hidden="true">
              ○
            </span>
            <span className="t">{missing[i - picked.length].name}</span>
            <span className="end">
              <span className="meta">{missing[i - picked.length].rules || missing[i - picked.length].section} ·</span>
              <span className="tag slate">Waiting</span>
            </span>
          </div>
        ),
      )}
      {picked.length + missing.length > 8 && (
        <p style={{ marginTop: 10 }}>
          <button type="button" className="btn quiet" onClick={() => openModule('publications', 'studio')}>
            The rest in the edition builder
          </button>
        </p>
      )}
    </PackSection>
  );
}

function PublicationsMain({ state, cur, canEdit, today, starting, importing }: { state: PubState; cur: Cur; canEdit: boolean; today: string; starting(): void; importing(path: string): void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [find, setFind] = useState(false);
  const toggleFind = () => setFind((v) => {
    if (v) {
      setQ('');
      setHits(null);
    }
    return !v;
  });
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
  const { detail: nextDetail } = useEditionDetail(next?.edition?.path ?? '');
  const picked = nextDetail ? nextDetail.sections.reduce((s, x) => s + x.items.length, 0) : 0;
  const planned = nextDetail ? nextDetail.sections.reduce((s, x) => s + x.items.length + x.missing.length, 0) : 0;
  return (
    <PackShell
      glyph="¶"
      tint="slate"
      title={packName('publications', 'Publications')}
      sub={`${cur.pub.masthead || 'Papers and puzzles'} for the household: pieces, puzzles, archive.`}
      facts={
        next
          ? [
              {
                k: 'Next edition',
                v: (
                  <>
                    {next.edition?.label ?? 'Next issue'} · {next.words}{' '}
                    {nextDetail && planned > 0 ? <span className="pill amber">{`${picked} of ${planned} pieces`}</span> : !next.edition ? <span className="pill slate">Not started</span> : null}
                  </>
                ),
              },
            ]
          : []
      }
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={() => void startEdition(cur)}>
          + Start an edition
        </button>
      }
      menu={() => publicationsMenu(state, cur, canEdit, { finding: toggleFind, found: find, starting, importing })}
    >
      {hits ? (
        <>
          <div className="glabel" style={{ margin: '18px 0 8px' }}>
            Searching every edition
          </div>
          <Hits hits={hits} query={q} />
          <p style={{ marginTop: 10 }}>
            <button type="button" className="btn quiet" onClick={() => { setQ(''); setHits(null); }}>
              Back to the editions
            </button>
          </p>
        </>
      ) : (
        <>
          <PackSection
            label="Editions"
            action={
              find ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {searching && <span className="vsub">Searching…</span>}
                  <input autoFocus type="search" className="input" style={{ width: 190, height: 28, fontSize: 13 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every edition…" aria-label="Search every edition" />
                </span>
              ) : undefined
            }
          >
            {cur.editions.length ? (
              cur.editions.map((e) => <EditionTrow key={e.path} e={e} today={today} />)
            ) : (
              <p className="vsub">No editions yet.</p>
            )}
          </PackSection>
          {next?.edition && nextDetail && <NextPieces detail={nextDetail} label={next.edition.label} />}
        </>
      )}
    </PackShell>
  );
}

async function startEdition(cur: Cur): Promise<void> {
  const rel = await act(() => window.nv.pub.newEdition(cur.pub.path), (r) => `Started ${r.split('/').pop()?.replace(/\.md$/, '')}.`);
  if (rel) {
    choose({ edition: rel });
    openModule('publications', 'studio');
  }
}

/** One edition's own page: its plan against each section's budget, its puzzles, sending and printing. */
function EditionPage({ cur, e, canEdit, today }: { cur: Cur; e: EditionView; canEdit: boolean; today: string }) {
  const { detail } = useEditionDetail(e.path);
  const tag = editionTag(e, today);
  const time = cur.pub.schedule?.time ? timeWords(cur.pub.schedule.time) : '';
  const deliveryWords = [cur.pub.delivery.print ? (cur.pub.delivery.printer ? `Prints on ${cur.pub.delivery.printer}` : 'Prints at home') : null, cur.pub.delivery.telegram ? `sends on Telegram${time ? ` at ${time}` : ''}` : null, cur.pub.delivery.email.length ? `sends by email${time ? ` at ${time}` : ''}` : null].filter(Boolean).join(', ') || 'Delivery not set up';
  const planned = detail ? detail.sections.reduce((s, x) => s + x.pages, 0) : 0;
  const filled = detail ? Math.round(detail.estimate.reduce((s, x) => s + Math.min(x.used, x.budget), 0)) : 0;
  const puzzles = detail ? detail.sections.flatMap((s) => s.items.filter((it) => it.kindName.toLowerCase().includes('puzzle') || ['crossword', 'sudoku', 'wordsearch', 'word-search', 'dailyword', 'daily-word'].includes(it.kind))) : [];
  const methods = [cur.pub.delivery.print && 'Print', cur.pub.delivery.telegram && 'Telegram', cur.pub.delivery.email.length ? 'Email' : ''].filter(Boolean).join(' + ') || 'Not set up';
  const late = tag.words === 'Late';
  const missingFirst = detail?.sections.find((s) => s.missing.length) ?? null;
  return (
    <PackShell
      glyph="¶"
      tint={tag.tone}
      title={`${cur.pub.masthead || 'Publication'}: ${e.label}`}
      sub={`${editionDay(e.date) || 'Not dated'}. ${deliveryWords}.`}
      sharePath={e.path}
      facts={[
        { k: 'Pages', v: detail ? `${planned} planned · ${filled} filled · ${Math.max(0, planned - filled)} to fill` : e.pages ? `${plural(e.pages, 'page')}` : 'No pages yet' },
        { k: 'Delivery', v: <>{methods} <span className={`pill ${late ? 'red' : 'green'}`}>{late ? 'Late' : 'on schedule'}</span></> },
      ]}
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={() => void act(() => window.nv.pub.build(e.path), (r) => r.words)}>
          {e.pdf ? 'Build the PDF again' : 'Build the PDF'}
        </button>
      }
      menu={() => [
        { label: packName('publications', 'Publications'), icon: 'newspaper', run: () => openModule('publications', 'editions') },
        { label: 'Open in the edition builder', icon: 'layers', run: () => { choose({ edition: e.path }); openModule('publications', 'studio'); } },
        { separator: true },
        { label: 'Send and print now', icon: 'send', disabled: !canEdit, run: () => void act(() => window.nv.pub.deliver(e.path), (w) => w) },
        { label: 'Open the PDF', icon: 'pdf', disabled: !e.pdf, run: () => e.pdf && A.openPath(e.pdf, { where: 'tab' }) },
        { label: 'Save a copy of the PDF…', icon: 'download', run: () => void window.nv.pub.exportPdf(e.path).then((f) => f && act(async () => f, `Saved to ${f}.`), showError) },
        { label: 'Open the edition’s note', icon: 'notes', run: () => A.openPath(e.path, { where: 'tab' }) },
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(e.path).catch(showError) },
      ]}
    >
      <PackSection label="Page plan" pad>
        {!detail ? (
          <p className="vsub">Reading its sections…</p>
        ) : (
          detail.sections.map((s) => {
            const fit = detail.estimate.find((x) => x.name === s.name);
            const pct = fit && fit.budget > 0 ? Math.min(100, Math.round((fit.used / fit.budget) * 100)) : 0;
            return (
              <div key={s.name} className={`p87-meter${fit?.over ? ' over' : ''}`}>
                <span className="nm">{s.name} · {s.pages}</span>
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span className="amt">{s.missing.length ? `${s.missing.length} ${s.missing.length === 1 ? 'piece' : 'pieces'} short` : s.items[0]?.headline ?? 'Empty'}</span>
              </div>
            );
          })
        )}
      </PackSection>
      {puzzles.length > 0 && (
        <PackSection label="Puzzles">
          {puzzles.map((p) => {
            const recent = cur.board.recent.find((r) => r.item === p.path);
            return (
              <div key={p.path} className="trow" {...rowContext(() => rowMenu(p.path, p.headline, () => peek({ type: 'note', path: p.path }, { title: p.headline, type: 'note' })))}>
                <button type="button" onClick={() => peek({ type: 'note', path: p.path }, { title: p.headline, type: 'note' })} className="t" title={p.headline} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                  {p.headline}
                </button>
                <span className="end">
                  <span className="meta">{recent ? `${recent.who} solved in ${Math.max(1, Math.round(recent.seconds / 60))} min` : p.source ? `source: ${p.source}` : p.solves ? `${p.solves} ${p.solves === 1 ? 'solve' : 'solves'} logged` : 'No solves yet'}</span>
                </span>
              </div>
            );
          })}
        </PackSection>
      )}
      {detail && detail.edition.delivery.length > 0 && (
        <PackSection label="Sent">
          {detail.edition.delivery.map((d, i) => (
            <div key={`${d.when}-${i}`} className="trow">
              <span className="t">{d.how}{d.to ? ` to ${d.to}` : ''}</span>
              <span className="end">
                <span className="meta">{[d.when ? shortDate(d.when) || d.when : '', d.result].filter(Boolean).join(' · ')}</span>
              </span>
            </div>
          ))}
        </PackSection>
      )}
      <AskFloat hint={missingFirst ? `Suggest the missing ${missingFirst.name.toLowerCase()} piece…` : undefined} question={(w) => `About ${cur.pub.masthead || 'the publication'} ${e.label}: ${w}`} />
    </PackShell>
  );
}

/** Every Publications page and action in the one menu, so nothing is more than a tap away. */
function publicationsMenu(state: PubState | null, cur: Cur | null, canEdit: boolean, extra?: { starting?(): void; importing?(path: string): void; finding?(): void; found?: boolean }): MenuItem[] {
  if (!state) return [];
  const puzzlesOn = state.puzzlesOn !== false;
  const name = packName('publications', 'Publications');
  return [
    ...(state.publications.length > 1 ? [{ heading: name } as MenuItem, ...state.publications.map((p) => ({ label: p.title, icon: 'newspaper' as const, checked: p.path === cur?.pub.path, run: () => choose({ pub: p.path, edition: '' }) })), { separator: true } as MenuItem] : []),
    { label: name, icon: 'newspaper', run: () => openModule('publications', 'editions') },
    { label: 'Edition builder', icon: 'layers', run: () => openModule('publications', 'studio') },
    { label: 'Pieces', icon: 'notes', run: () => openModule('publications', 'items') },
    ...(puzzlesOn ? [{ label: 'Puzzles', icon: 'grid' as const, run: () => openModule('publications', 'puzzles') }] : []),
    { label: 'Settings', icon: 'settings', run: () => openModule('publications', 'settings') },
    ...(extra?.finding ? [{ label: 'Search every edition…', icon: 'search' as const, checked: extra.found, run: () => extra.finding!() }] : []),
    { separator: true },
    { label: 'Start an edition', icon: 'plus', disabled: !canEdit || !cur, run: () => cur && void startEdition(cur) },
    { label: 'Start another publication…', icon: 'plus', disabled: !canEdit, run: () => void extra?.starting?.() },
    ...(state.waiting.length && extra?.importing ? state.waiting.map((w) => ({ label: `Import ${w.title}…`, icon: 'download' as const, disabled: !canEdit, run: () => void extra.importing?.(w.path) })) : []),
    { separator: true },
    { label: 'Open the publication’s note', icon: 'notes', disabled: !cur, run: () => cur && A.openPath(cur.pub.path, { where: 'tab' }) },
    { label: 'Show its folder', icon: 'folder', disabled: !cur, run: () => cur && A.revealInExplorer(cur.pub.folder) },
    { separator: true },
    { label: `Who may read ${name}…`, icon: 'lock', run: () => openModal({ kind: 'settings', section: 'privacy' }) },
    { label: `${name}’ parts (Settings › Packs)…`, icon: 'settings', run: () => openModal({ kind: 'settings', section: 'modules' }) },
    { separator: true },
    { label: `Show me around ${name}`, icon: 'help', run: () => openTour('publications') },
  ];
}

export function PublicationsPage({ tab }: { tab: W.TabState }) {
  const { state, failed } = usePub();
  const chosen = useChosen();
  const canEdit = useApp((s) => s.canEdit);
  const [importing, setImporting] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const today = todayIso();
  const asked = partOfTab(tab) ?? 'editions';
  const editionMatch = /^edition:(.+)$/.exec(asked);
  const puzzlesOn = state?.puzzlesOn !== false;
  const part: Part = asked === 'studio' || asked === 'items' || asked === 'settings' || (asked === 'puzzles' && puzzlesOn) ? (asked as Part) : 'editions';
  const cur = state?.current ?? null;
  const pub = cur?.pub ?? null;
  const edition = editionMatch && cur ? (cur.editions.find((e) => e.path === editionMatch[1]) ?? null) : null;


  return (
    <div className="p87-pub">
      {failed && !state && (
        <div className="nv-page full p87">
          <EmptyState size="panel" icon="warning" title={`${packName('publications', 'Publications')} couldn’t be read`} line={failed} />
        </div>
      )}
      {!state && !failed && (
        <div className="nv-page full p87">
          <p className="vsub">Reading your publications…</p>
        </div>
      )}
      {state && state.waiting.length > 0 && (
        <div className="nv-page full p87">
          <div className="callout amber" style={{ marginTop: 14 }}>
            <span aria-hidden="true">↓</span>
            <span>
              <b>{state.waiting.map((w) => w.title).join(', ')}</b> {state.waiting.length === 1 ? 'was' : 'were'} written before Publications. Import {state.waiting.length === 1 ? 'it' : 'them'}: the note’s sections, schedule and editions become a publication you can build, search and print.{' '}
              <button type="button" className="btn quiet" style={{ height: 26 }} disabled={!canEdit} onClick={() => setImporting(state.waiting[0]!.path)}>
                Review the import
              </button>
            </span>
          </div>
        </div>
      )}
      {/* First run in the pack frame like every sibling pack (6 Nov 2026, the rest-of-Vault audit: the bare form had no
          title and jumped focus into its Name field): the start form keeps every control, now under the title. */}
      {state && !pub && !state.waiting.length && (
        <PackShell glyph="¶" tint="slate" title={packName('publications', 'Publications')} sub="Household newsletters and papers, laid out, printed and sent." menu={() => publicationsMenu(state, cur, canEdit, { starting: () => setStarting(true), importing: setImporting })}>
          <StartPublication first onDone={(rel) => choose({ pub: rel })} />
        </PackShell>
      )}
      {state && cur && pub && editionMatch && (edition ? <EditionPage cur={cur} e={edition} canEdit={canEdit} today={today} /> : (
        <PackShell glyph="¶" tint="slate" title="That edition isn’t here any more" sub="It may have been renamed, moved or taken out." menu={() => publicationsMenu(state, cur, canEdit, { starting: () => setStarting(true), importing: setImporting })}>
          <p>
            <button type="button" className="btn" onClick={() => openModule('publications', 'editions')}>
              {packName('publications', 'Publications')}
            </button>
          </p>
        </PackShell>
      ))}
      {state && cur && pub && !editionMatch && part === 'editions' && <PublicationsMain state={state} cur={cur} canEdit={canEdit} today={today} starting={() => setStarting(true)} importing={setImporting} />}
      {state && cur && pub && !editionMatch && part !== 'editions' && (
        <PackShell glyph="¶" tint="slate" title={part === 'studio' ? `Edition builder${chosen.edition ? `: ${cur.editions.find((e) => e.path === chosen.edition)?.label ?? ''}` : ''}` : PART_LABEL[part]} sub={LINES[part]} menu={() => publicationsMenu(state, cur, canEdit, { starting: () => setStarting(true), importing: setImporting })}>
          <div className={`pb-part pb-part-${part}`} key={`${part}:${pub.path}`}>
            {part === 'studio' && <Studio state={state} cur={cur} edition={chosen.edition} />}
            {part === 'items' && <Pieces cur={cur} />}
            {part === 'puzzles' && <Puzzles cur={cur} />}
            {part === 'settings' && <PubSettings state={state} cur={cur} />}
          </div>
        </PackShell>
      )}
      {importing && <ImportReview path={importing} onClose={() => setImporting(null)} />}
      {starting && (
        <div className="overlay pb-overlay" onMouseDown={() => setStarting(false)}>
          <div className="dialog pb-dialog" role="dialog" aria-label="Start a publication" onMouseDown={(e) => e.stopPropagation()}>
            <StartPublication
              onDone={(rel) => {
                setStarting(false);
                choose({ pub: rel, edition: '' });
              }}
              onCancel={() => setStarting(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
