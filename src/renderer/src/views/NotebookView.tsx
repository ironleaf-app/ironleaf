// A folder as a notebook (21 Oct 2026, gap G10; the rules are in src/shared/notebook.ts, the main side in
// src/main/notebook.ts): on the left the folder's notes, PDFs and documents with ticks choosing which count (others added
// by link, never moved), in the middle questions answered only from the
// ticked sources with numbered chips that open the exact passage, and on the right the Studio, which makes a briefing,
// a mind map, flashcards, a quiz, a data table or an audio script from them as files in the folder's Notebook folder.
// Opened from a project's ⋯ menu or a folder's menu ("Open as a notebook").

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NotebookOutput, NotebookSource, NotebookState } from '../../../main/notebook';
import { NOTEBOOK_FOLDER, NOTEBOOK_REFUSAL, STUDIO, folderOfNotebookTab, isSourcePath, projectNotebookWords, whereWords, type StudioKind } from '../../../shared/notebook';
import { fileIcon, Icon, type IconName } from '../components/Icon';
import { pickFile } from '../components/Pickers';
import { answerHtml } from '../lib/citedAnswer';
import { NOT_READY_WORDS } from '../lib/assistantWords';
import { errorMessage } from '../lib/errors';
import { wikilinkFromClick } from '../lib/markdownRender';
import { whenAgo } from '../lib/projectLook';
import * as A from '../state/actions';
import { openModal } from '../state/modals';
import { keepThread, openFrom, openPassage, readAloud, threadOf, useReading, type Turn } from '../state/notebook';
import { getState, showError, toast, useApp } from '../state/store';
import type { TabState } from '../state/workspace';
import { PageError, PageLoading, RowsSkeleton } from '../components/PageStates';
import { ViewHeader } from './ViewHeader';
import '../styles/search-ask-87.css';
import { ProjectWorkspace } from './workspace/ProjectWorkspace';
import { projectInFolder } from '../state/projectWorkspace';

const KIND_ICONS: Record<NotebookOutput['kind'], IconName> = { briefing: 'outline', mindmap: 'canvas', flashcards: 'layers', quiz: 'help', table: 'table', audio: 'audio', answer: 'chat', found: 'globe', other: 'file' };
const STUDIO_ICONS: Record<StudioKind, IconName> = { briefing: 'outline', mindmap: 'canvas', flashcards: 'layers', quiz: 'help', table: 'table', audio: 'audio' };
export function NotebookView({ tab }: { tab: TabState }) {
  const folder = folderOfNotebookTab(tab.path) ?? '';
  // A project's folder opens as the project's workspace (24 Oct 2026, Workstream 1 part D): its sections in an outline,
  // the notebook's sources, questions and Studio among them (views/workspace/ProjectWorkspace.tsx). Said in the page
  // (10.0 papercuts), so the door never reads as the wrong place.
  const project = useApp((s) => (s.notes.length ? projectInFolder(folder) : null));
  const projectName = useApp((s) => (project ? (s.byPath.get(project)?.label ?? s.byPath.get(project)?.title ?? A.titleOf(project)) : ''));
  if (project)
    return (
      <div className="nb-view">
        <p className="nb-door" role="note">
          <Icon name="info" size={13} /> {projectNotebookWords(projectName)}
        </p>
        <ProjectWorkspace tab={tab} project={project} />
      </div>
    );
  return <FolderNotebook tab={tab} folder={folder} />;
}

/** The notebook's three columns for a folder (also the workspace's Ask and Studio section). */
export function NotebookColumns({ folder }: { folder: string }) {
  const revision = useApp((s) => s.revision);
  const filesRevision = useApp((s) => s.filesRevision);
  const [nb, setNb] = useState<NotebookState | null>(null);
  const [failed, setFailed] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () =>
        void window.nv.notebook.state(folder).then(
          (s) => live && (setNb(s), setFailed('')),
          (e) => live && setFailed(errorMessage(e)),
        ),
      nb ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [folder, revision, filesRevision, attempt]);
  if (failed) return <PageError title="Couldn't read the notebook" explainer={failed} retry={() => { setFailed(''); setAttempt((a) => a + 1); }} />;
  if (!nb)
    return (
      <PageLoading label="Reading the notebook…">
        <RowsSkeleton rows={4} />
      </PageLoading>
    );
  const ticked = nb.sources.filter((s) => s.ticked && !s.missing).length;
  return (
    <>
      {/* As the notebook's own page says it: which sources the answers come from. */}
      <p className="nb-sub is-embedded">
        {ticked} of {nb.sources.length} {nb.sources.length === 1 ? 'source' : 'sources'} ticked · answers come only from them
        {nb.capped ? ` (the first ${nb.capped} are read)` : ''}
      </p>
      <div className="nb-cols is-embedded">
        <Sources nb={nb} onChange={setNb} />
        <Ask folder={folder} ticked={ticked} />
        <Studio nb={nb} ticked={ticked} />
      </div>
    </>
  );
}

function FolderNotebook({ tab, folder }: { tab: TabState; folder: string }) {
  const revision = useApp((s) => s.revision);
  const filesRevision = useApp((s) => s.filesRevision);
  const [nb, setNb] = useState<NotebookState | null>(null);
  const [failed, setFailed] = useState('');
  const asked = useRef(folder);
  asked.current = folder;

  const load = useCallback(
    () =>
      window.nv.notebook.state(folder).then(
        (s) => {
          if (asked.current !== folder) return;
          setNb(s);
          setFailed('');
        },
        (e) => asked.current === folder && setFailed(errorMessage(e)),
      ),
    [folder],
  );
  // Read again when the notes or files change (a little after, so a burst is read once).
  useEffect(() => {
    const t = setTimeout(() => void load(), nb ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, revision, filesRevision]);

  const header = <ViewHeader tab={{ ...tab, path: folder ? `${folder}/${NOTEBOOK_FOLDER}` : NOTEBOOK_FOLDER }} title="Notebook" />;
  if (failed)
    return (
      <div className="nb-view">
        {header}
        <PageError title="Couldn't read the notebook" explainer={failed} retry={() => void load()} />
      </div>
    );
  if (!nb)
    return (
      <div className="nb-view">
        {header}
        <PageLoading label="Reading the notebook…">
          <RowsSkeleton rows={4} />
        </PageLoading>
      </div>
    );
  const ticked = nb.sources.filter((s) => s.ticked && !s.missing).length;
  return (
    <div className="nb-view">
      {header}
      <header className="nb-head">
        <span className="nb-mark" aria-hidden="true">
          <Icon name="book" size={18} />
        </span>
        <div>
          <h1 className="nv-page-title">{nb.name}</h1>
          <p className="nv-page-lead nb-sub">
            {ticked} of {nb.sources.length} {nb.sources.length === 1 ? 'source' : 'sources'} ticked · answers come only from them
            {nb.capped ? ` (the first ${nb.capped} are read)` : ''}
          </p>
        </div>
      </header>
      <div className="nb-cols">
        <Sources nb={nb} onChange={setNb} />
        <Ask folder={folder} ticked={ticked} />
        <Studio nb={nb} ticked={ticked} />
      </div>
    </div>
  );
}

// ── Sources ──────────────────────────────────────────────────────────────────────────────────────────────────────

function Sources({ nb, onChange }: { nb: NotebookState; onChange(s: NotebookState): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const [finding, setFinding] = useState<{ topic: string; open: boolean; id?: string; words?: string }>({ topic: '', open: false });
  const own = nb.sources.filter((s) => !s.added);
  const added = nb.sources.filter((s) => s.added);
  const choice = (sources: NotebookSource[]) => ({ added: sources.filter((s) => s.added).map((s) => s.path), off: sources.filter((s) => !s.ticked).map((s) => s.path) });
  const save = (sources: NotebookSource[]) => {
    // Shown at once; written to the Sources note behind it. A failed write rolls the tick back to what the
    // notebook truly holds (9.2 uplift F41), never a tick the write never made.
    onChange({ ...nb, sources });
    window.nv.notebook.choose(nb.folder, choice(sources)).then(onChange, (err) => {
      showError(err);
      window.nv.notebook.state(nb.folder).then(onChange, () => undefined);
    });
  };
  const tick = (path: string, on: boolean) => save(nb.sources.map((s) => (s.path === path ? { ...s, ticked: on } : s)));
  const allOn = nb.sources.every((s) => s.ticked);
  const add = async () => {
    const have = new Set(nb.sources.map((s) => s.path));
    const st = getState();
    const paths = [...st.notes.map((n) => n.path), ...st.files.filter((f) => f.kind !== 'note').map((f) => f.rel)].filter((p) => isSourcePath(p) && !have.has(p) && !p.split('/').slice(0, -1).includes(NOTEBOOK_FOLDER));
    const picked = await pickFile('Add a note, PDF or document as a source (it stays where it is)…', paths, (p) => (/\.md$/i.test(p) ? A.titleOf(p) : A.nameOf(p)));
    if (!picked) return;
    save([...nb.sources, { path: picked, title: /\.md$/i.test(picked) ? A.titleOf(picked) : A.nameOf(picked), kind: /\.md$/i.test(picked) ? 'note' : /\.pdf$/i.test(picked) ? 'pdf' : 'doc', ticked: true, added: true }]);
  };
  // Find sources (only where a web search is wired): its reply arrives as a note in the Notebook folder, already a source.
  useEffect(() => {
    if (!finding.id) return;
    const id = finding.id;
    const timer = setInterval(() => {
      void window.nv.notebook.findStatus(id).then((s) => {
        if (s.status === 'working') return;
        clearInterval(timer);
        setFinding({ topic: '', open: false });
        if (s.status === 'done' && s.path) toast('Sources found: they’re in the notebook now.', { label: 'Open', run: () => A.openPath(s.path!, { where: 'tab' }) });
        else toast(s.why ?? 'No sources were found this time.');
      }, () => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [finding.id]);
  const find = () => {
    const topic = finding.topic.trim();
    if (!topic) return;
    setFinding({ ...finding, words: 'Starting the search…' });
    window.nv.notebook.find(nb.folder, topic).then(
      (r) => setFinding({ topic, open: true, id: r.id, words: 'Searching the web. You can keep working; the sources arrive here.' }),
      (e) => {
        setFinding({ ...finding, words: undefined });
        showError(e);
      },
    );
  };

  const ticked = nb.sources.filter((s) => s.ticked && !s.missing).length;
  const row = (s: NotebookSource) => (
    <li key={s.path} className={`nb-src${s.ticked ? '' : ' is-off'}${s.missing ? ' is-missing' : ''}`}>
      <button type="button" className={`check${s.ticked && !s.missing ? ' done' : ''}`} disabled={!canEdit || s.missing} onClick={() => tick(s.path, !(s.ticked && !s.missing))} aria-label={`Use ${s.title}`} aria-pressed={s.ticked && !s.missing}>
        {s.ticked && !s.missing ? <Icon name="check" size={12} /> : ''}
      </button>
      {/* One click opens the source beside the notebook (t239: a click opens the document itself); Ctrl+click a new tab. */}
      <button
        className="nb-src-name"
        onClick={(e) => {
          if (s.missing) return;
          openFrom(s.path, e);
        }}
        onDoubleClick={(e) => {
          if (s.missing) return;
          openFrom(s.path, e);
        }}
        title={s.missing ? `${s.path} isn’t in your notes any more` : `${s.path}\nClick to open it beside the notebook`}
      >
        <Icon name={fileIcon(s.path)} size={14} />
        <span>{s.title}</span>
      </button>
      {!s.missing && (
        <button className="nb-src-open" title={`Open ${s.title}`} aria-label={`Open ${s.title}`} onClick={(e) => openFrom(s.path, e)}>
          <Icon name="pencil" size={11} />
        </button>
      )}
      {s.added && canEdit && (
        <button className="nb-src-x" title="Take off this notebook (the note stays where it is)" aria-label={`Take ${s.title} off this notebook`} onClick={() => save(nb.sources.filter((x) => x.path !== s.path))}>
          <Icon name="close" size={11} />
        </button>
      )}
    </li>
  );

  return (
    <aside className="nb-pane nb-sources" aria-label="Sources">
      <header className="nb-pane-head">
        <span className="glabel">
          Sources · {ticked} ticked
        </span>
        <button className="btn quiet nb-add" disabled={!canEdit} onClick={() => void add()} title="Add a note, PDF or document as a source (it stays where it is)">
          + Add
        </button>
      </header>
      {((nb.sources.length > 1 && canEdit) || nb.canFind) && (
        <div className="nb-src-actions">
          {nb.sources.length > 1 && canEdit && (
            <button className="nb-quiet" onClick={() => save(nb.sources.map((s) => ({ ...s, ticked: !allOn })))}>
              {allOn ? 'Untick all' : 'Tick all'}
            </button>
          )}
          {nb.canFind && (
            <button className={`nb-quiet${finding.open ? ' is-active' : ''}`} disabled={!canEdit || !!finding.id} onClick={() => setFinding({ ...finding, open: !finding.open })} aria-expanded={finding.open} title="Search the web for sources">
              Find sources
            </button>
          )}
        </div>
      )}
      {finding.open && (
        <form
          className="nb-find"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <input autoFocus value={finding.topic} disabled={!!finding.id} onChange={(e) => setFinding({ ...finding, topic: e.currentTarget.value })} placeholder="What to look for on the web?" aria-label="What to look for" />
          {!finding.id && (
            <button type="submit" className="button primary" disabled={!finding.topic.trim()}>
              Search
            </button>
          )}
          {finding.words && <p className="nb-find-words">{finding.words}</p>}
        </form>
      )}
      {nb.sources.length === 0 ? (
        <p className="nb-none">Nothing to read here yet. Add notes or PDFs to this folder, or add a source from elsewhere.</p>
      ) : (
        <>
          {own.length > 0 && (
            <>
              <h3 className="nb-group">In this folder</h3>
              <ul className="nb-src-list card">{own.map(row)}</ul>
            </>
          )}
          {added.length > 0 && (
            <>
              <h3 className="nb-group">Added from elsewhere</h3>
              <ul className="nb-src-list card">{added.map(row)}</ul>
            </>
          )}
        </>
      )}
      <p className="nb-strict">Only ticked sources are read. Nothing else in the vault is touched.</p>
    </aside>
  );
}

// ── Ask ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function Ask({ folder, ticked }: { folder: string; ticked: number }) {
  const aiReady = useApp((s) => !!s.settings?.ai.ready);
  const aiNote = useApp((s) => s.settings?.ai.note ?? null);
  const canEdit = useApp((s) => s.canEdit);
  const [turns, setTurns] = useState<Turn[]>(() => threadOf(folder));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setTurns(threadOf(folder)), [folder]);
  useEffect(() => {
    thread.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [turns.length, busy]);
  const set = (next: Turn[]) => {
    keepThread(folder, next);
    setTurns(next);
  };
  const send = () => {
    const question = draft.trim();
    if (!question || busy) return;
    const previous = [...turns].reverse().find((t) => t.answer && !t.answer.refused)?.question;
    const next = [...turns, { question }];
    set(next);
    setDraft('');
    setBusy(true);
    window.nv.notebook
      .ask(folder, question, previous)
      .then(
        (answer) => set([...next.slice(0, -1), { question, answer }]),
        (e) => set([...next.slice(0, -1), { question, error: errorMessage(e) }]),
      )
      .finally(() => {
        setBusy(false);
        box.current?.focus();
      });
  };
  const onClick = (e: React.MouseEvent, t: Turn) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.nb-chip');
    if (chip && t.answer) {
      const c = t.answer.citations.find((x) => x.n === Number(chip.dataset.cite));
      if (c) openPassage(c);
      return;
    }
    const link = wikilinkFromClick(e);
    if (link !== null) {
      e.preventDefault();
      void A.openLink(link, '', e.ctrlKey || e.metaKey ? 'tab' : 'current');
    }
  };
  const saveAnswer = (t: Turn) =>
    t.answer &&
    window.nv.notebook.saveAnswer(t.answer.id).then(
      (path) => toast(`Saved as “${A.titleOf(path)}” in the Notebook folder.`, { label: 'Open', run: () => A.openPath(path, { where: 'tab' }) }),
      showError,
    );
  const blocked = !aiReady ? (aiNote ?? NOT_READY_WORDS) : ticked === 0 ? 'Tick at least one source to ask about.' : '';

  return (
    <section className="nb-pane nb-ask" aria-label="Ask the sources">
      <div className="nb-thread" ref={thread} aria-live="polite">
        {turns.length === 0 && !busy && (
          <div className="nb-ask-empty">
            <Icon name="sparkle" size={20} />
            <h2>Ask about these sources</h2>
            <p>Every answer comes only from the ticked sources. Each numbered chip opens the passage it came from; when they don’t say, you’re told so.</p>
          </div>
        )}
        {turns.map((t, i) => (
          <article key={i} className="nb-turn">
            <p className="nb-q">{t.question}</p>
            {t.error ? (
              <p className="nb-error">
                <Icon name="warning" size={14} /> {t.error}
              </p>
            ) : t.answer?.refused ? (
              <div className="nb-a is-refused">
                <Icon name="info" size={15} />
                <p>{NOTEBOOK_REFUSAL} Try other words, or tick more sources.</p>
              </div>
            ) : t.answer ? (
              <div className="nb-a">
                <div className="markdown nb-a-words" onClick={(e) => onClick(e, t)} dangerouslySetInnerHTML={{ __html: answerHtml(t.answer.text, t.answer.citations) }} />
                <div className="glabel" style={{ margin: '10px 0 4px' }}>
                  Sources for this answer · {t.answer.citations.length}
                </div>
                <ol className="nb-cites" aria-label="Sources for this answer">
                  {t.answer.citations.map((c) => (
                    <li key={c.n}>
                      <button className="nb-cite srcrow" onClick={() => openPassage(c)} title={`${c.title}${whereWords(c) ? `, ${whereWords(c)}` : ''}: “${c.quote}”`}>
                        <span className="gtile xs slate">{c.n}</span>
                        <span className="nb-cite-name clip">{c.title}</span>
                        <span className="n clip">· “{c.quote}”</span>
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="nb-a-tools">
                  <span className="nb-a-from">
                    From {t.answer.read} {t.answer.read === 1 ? 'passage' : 'passages'}
                  </span>
                  {canEdit && (
                    <button className="btn" onClick={() => void saveAnswer(t)}>
                      <Icon name="filePlus" size={13} /> Save as a note
                    </button>
                  )}
                  <button className="btn" onClick={() => void navigator.clipboard.writeText(t.answer!.text).then(() => toast('Copied.'), showError)}>
                    <Icon name="copy" size={13} /> Copy
                  </button>
                </div>
              </div>
            ) : (
              <div className="nb-a is-busy" aria-busy="true">
                <span />
                <span />
                <span />
                <small>Reading the ticked sources…</small>
              </div>
            )}
          </article>
        ))}
      </div>
      <form
        className="nb-compose ask float"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <span className="tag slate">
          {ticked} {ticked === 1 ? 'source' : 'sources'}
        </span>
        <textarea
          ref={box}
          rows={1}
          value={draft}
          disabled={!!blocked || !canEdit}
          placeholder={blocked || 'Ask about the ticked sources…'}
          aria-label="Ask a question about the ticked sources"
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" className="nb-send send" disabled={!draft.trim() || busy || !!blocked} title="Ask (Enter)" aria-label="Ask">
          <Icon name="send" size={16} />
        </button>
      </form>
    </section>
  );
}

// ── Studio ───────────────────────────────────────────────────────────────────────────────────────────────────────

function Studio({ nb, ticked }: { nb: NotebookState; ticked: number }) {
  const aiReady = useApp((s) => !!s.settings?.ai.ready);
  const canEdit = useApp((s) => s.canEdit);
  const [making, setMaking] = useState<StudioKind | null>(null);
  const reading = useReading();
  const make = (kind: StudioKind) => {
    setMaking(kind);
    window.nv.notebook
      .make(nb.folder, kind)
      .then((path) => {
        const label = STUDIO.find((s) => s.kind === kind)!.label;
        toast(`${label} made in ${nb.name}’s Notebook folder.`, { label: kind === 'flashcards' ? 'Review' : 'Open', run: () => (kind === 'flashcards' ? openModal({ kind: 'review-cards', path }) : A.openPath(path, { where: 'tab' })) });
      }, showError)
      .finally(() => setMaking(null));
  };
  const why = !canEdit ? 'These notes are open for reading only.' : !aiReady ? NOT_READY_WORDS : ticked === 0 ? 'Tick at least one source first.' : '';
  const outputs = useMemo(() => nb.outputs.slice(0, 30), [nb.outputs]);
  return (
    <aside className="nb-pane nb-studio" aria-label="Studio">
      <span className="glabel">Make from these sources</span>
      <div className="nb-make card">
        {STUDIO.map((s) => (
          <button key={s.kind} className={`nb-make-item${making === s.kind ? ' is-making' : ''}`} disabled={!!why || (!!making && making !== s.kind)} aria-busy={making === s.kind} onClick={() => making === null && make(s.kind)} title={why || `${s.label}: ${s.words}`}>
            <span className="gtile xs blue">
              <Icon name={STUDIO_ICONS[s.kind]} size={13} />
            </span>
            <span className="nb-make-label">{making === s.kind ? 'Making…' : s.label}</span>
          </button>
        ))}
      </div>
      {why && <p className="nb-foot">{why}</p>}
      <div className="glabel" style={{ margin: '14px 0 6px' }}>
        Made · {outputs.length}
      </div>
      {outputs.length === 0 ? (
        <p className="nb-none">What the Studio makes is saved in {nb.folder ? `${nb.folder}/` : ''}Notebook, and listed here.</p>
      ) : (
        <ul className="nb-outs">
          {outputs.map((o) => (
            <li key={o.path} className="nb-out card">
              <button className="nb-out-name" onClick={(e) => openFrom(o.path, e)} title={o.path}>
                <span className="gtile xs slate">
                  <Icon name={KIND_ICONS[o.kind]} size={13} />
                </span>
                <span className="clip">{o.title}</span>
                <small>{whenAgo(o.made)}</small>
              </button>
              {o.kind === 'flashcards' && (
                <button className="nb-out-act" onClick={() => openModal({ kind: 'review-cards', path: o.path })} title="Review these flashcards">
                  Review{o.due ? <span className="nb-due">{o.due}</span> : null}
                </button>
              )}
              {o.kind === 'audio' && (
                <button className={`nb-out-act${reading === o.path ? ' is-on' : ''}`} onClick={() => void readAloud(o.path).catch(showError)} aria-pressed={reading === o.path} title={reading === o.path ? 'Stop reading' : 'Read this script aloud in two voices, on this PC'}>
                  <Icon name={reading === o.path ? 'stop' : 'play'} size={12} /> {reading === o.path ? 'Stop' : 'Read aloud'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
