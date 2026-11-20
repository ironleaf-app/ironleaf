// Quick capture's box (src/main/capture.ts opens it over whatever the person is doing): a note or a task, a screenshot,
// voice, a file dropped in; the project it belongs to suggested and changeable in one click; saved with Ctrl + Enter,
// then a confirmation with Open and Undo. Esc puts it away (what was typed stays for a couple of minutes).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chosenSuggestion, parseDue, planCapture, suggestProjects, type CaptureContext, type CaptureKind, type CaptureSaved, type ProjectSuggestion } from '../../../shared/capture';
import { isFinished } from '../../../shared/finished';
import { Icon } from '../components/Icon';
import { captureApi, dictate, fieldTarget } from '../lib/dictation';
import { errorMessage } from '../lib/errors';
import { wordsMatch } from '../lib/fuzzy';

const api = () => window.nv.capture;
/** A draft put away longer than this is cleared when the box comes back. */
const KEEP_DRAFT_MS = 2 * 60 * 1000;
const TOAST_MS = 6500;

interface Picture {
  id: string;
  name: string;
  thumb: string;
  width: number;
  height: number;
}

interface Draft {
  kind: CaptureKind;
  text: string;
  pictures: Picture[];
  files: string[];
  /** The project the person picked ('' is No project); undefined: follow the suggestion. */
  picked?: string;
  ignoreDue: boolean;
}

const EMPTY: Draft = { kind: 'note', text: '', pictures: [], files: [], ignoreDue: false };

function applyLook(ctx: CaptureContext | null): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const theme = ctx?.theme ?? 'light';
  document.documentElement.dataset.theme = theme === 'dark' || (theme === 'system' && media.matches) ? 'dark' : 'light';
  document.documentElement.dataset.palette = ctx?.palette ?? 'honey';
  if (ctx?.accent) document.documentElement.style.setProperty('--accent-base', ctx.accent);
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function CaptureBox() {
  const [ctx, setCtx] = useState<CaptureContext | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [windowTitle, setWindowTitle] = useState<string | null>(null);
  const [saved, setSaved] = useState<(CaptureSaved & { undone?: string }) | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [snipping, setSnipping] = useState(false);
  /** Each time the box is shown: the cursor goes into the words once they are on screen. */
  const [shownAt, setShownAt] = useState(0);
  const shell = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const hiddenAt = useRef<number>(0);
  const lastSaved = useRef<{ draft: Draft; at: number } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    const next = await api().context();
    setCtx(next);
    applyLook(next);
    setWindowTitle(next.windowTitle);
  }, []);

  // Shown: fresh projects and look; a draft older than a couple of minutes cleared; the cursor in the words.
  useEffect(() => {
    void load();
    const offShown = api().onShown(() => {
      void load();
      // After a capture was saved, or a draft left too long: a fresh box.
      if (savedRef.current || (hiddenAt.current && Date.now() - hiddenAt.current > KEEP_DRAFT_MS)) resetDraft();
      setSaved(null);
      setSaid(null);
      setPicker(false);
      setShownAt(Date.now());
    });
    const offHidden = api().onHidden(() => {
      hiddenAt.current = Date.now();
      setWindowTitle(null);
    });
    const offWindow = api().onWindow((title) => setWindowTitle(title));
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => applyLook(ctxRef.current);
    media.addEventListener('change', onTheme);
    requestAnimationFrame(() => field.current?.focus());
    return () => {
      offShown();
      offHidden();
      offWindow();
      media.removeEventListener('change', onTheme);
    };
  }, [load]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  function resetDraft(): void {
    setDraft((d) => {
      for (const p of d.pictures) void api().dropPicture(p.id);
      return { ...EMPTY, kind: d.kind };
    });
  }

  useEffect(() => {
    if (!saved) field.current?.focus();
  }, [shownAt, saved]);

  // The window follows the box's height.
  useLayoutEffect(() => {
    const el = shell.current;
    if (!el) return;
    const report = () => void api().resize(Math.ceil(el.getBoundingClientRect().height));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The words grow the box, to a point.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(220, Math.max(draft.kind === 'task' ? 30 : 58, el.scrollHeight))}px`;
  }, [draft.text, draft.kind, saved]);

  // Which project: the words (and the window the person was in) suggest; the person's own pick stays.
  const suggestions = useMemo<ProjectSuggestion[]>(() => (ctx ? suggestProjects({ text: draft.text, windowTitle, projects: ctx.projects, recent: ctx.recent, now: ctx.now, max: 3 }) : []), [ctx, draft.text, windowTitle]);
  const guess = useMemo(() => chosenSuggestion(suggestions), [suggestions]);
  const chosenPath = draft.picked !== undefined ? draft.picked : guess?.path ?? '';
  const chosen = ctx?.projects.find((p) => p.path === chosenPath) ?? null;
  const due = draft.kind === 'task' && !draft.ignoreDue ? parseDue(draft.text.split('\n')[0], new Date()) : null;
  const toAssets = ctx?.toAssets ?? false;
  const attachments = draft.pictures.length + draft.files.length;

  // Where it will go, in words, worked out as the main side files it.
  const destination = useMemo(() => {
    if (!ctx) return null;
    const plan = planCapture({
      kind: draft.kind,
      text: draft.text,
      ignoreDue: draft.ignoreDue,
      project: chosen ? { path: chosen.path, name: chosen.name, pcFolder: chosen.hasFolder ? 'folder' : null } : null,
      pictures: draft.pictures.length,
      files: draft.files.length,
      toAssets,
      noProject: ctx.noProject,
      dailyPath: 'today',
      inboxPath: 'Inbox.md',
      attachmentsFor: () => '',
      now: new Date(),
    });
    const parts: string[] = [];
    if (plan.nextStep) parts.push(`Next step in ${chosen!.name}`);
    else if (plan.newNote) parts.push(`New note in ${chosen!.name}`);
    else if (plan.append) parts.push(plan.append.place === 'daily' ? 'Today’s note' : 'Your Inbox');
    else if (plan.attach?.place === 'assets') parts.push('Your assets');
    else if (plan.attach && chosen) parts.push(`${chosen.name}’s Captures`);
    // Where the screenshots and files go, when that isn't already said.
    const attach = !plan.attach || (!plan.nextStep && !plan.newNote && !plan.append) ? '' : plan.attach.place === 'assets' ? 'To your assets' : plan.attach.place === 'pc' ? `To ${chosen!.name}’s folder › Captures` : plan.newNote ? 'Beside the note' : plan.append ? `In ${plan.append.place === 'daily' ? 'today’s note' : 'your Inbox'}` : 'To its Captures';
    return { main: parts.join(' · '), attach };
  }, [ctx, draft, chosen, toAssets]);

  const canSave = !busy && !!ctx && (draft.kind === 'task' ? !!draft.text.trim() : !!draft.text.trim() || attachments > 0);

  const close = () => void api().close();

  // The confirmation closes only when idle (9.2 uplift F83): while it is hovered or focused the person is still
  // reading it, so the check comes back later instead of closing mid-read.
  const closeWhenIdle = () => {
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      if (shell.current?.matches(':hover, :focus-within')) closeWhenIdle();
      else close();
    }, TOAST_MS);
  };

  async function save(): Promise<void> {
    if (!canSave) return;
    setBusy(true);
    setSaid(null);
    try {
      const result = await api().save({ kind: draft.kind, text: draft.text, project: chosen?.path ?? null, pictures: draft.pictures.map((p) => p.id), files: draft.files, toAssets: attachments > 0 && toAssets, ignoreDue: draft.ignoreDue });
      lastSaved.current = { draft: { ...draft, picked: chosenPath }, at: Date.now() };
      setSaved(result);
      setPicker(false);
      setDraft((d) => ({ ...EMPTY, kind: d.kind }));
      closeWhenIdle();
    } catch (err) {
      setSaid(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function undo(): Promise<void> {
    if (!saved) return;
    window.clearTimeout(toastTimer.current);
    const words = await api().undo(saved.undo).catch((err: unknown) => errorMessage(err));
    // The draft comes back, to change and save again (another project, a different date).
    if (lastSaved.current) setDraft(lastSaved.current.draft);
    setSaved(null);
    setSaid(words === 'Undone.' ? 'Undone. Change it and save again, or press Esc to leave it.' : words);
    requestAnimationFrame(() => field.current?.focus());
  }

  async function snip(): Promise<void> {
    setSnipping(true);
    setSaid(null);
    try {
      const result = await api().snip();
      if (result && 'words' in result) setSaid(result.words);
      else if (result) setDraft((d) => ({ ...d, pictures: [...d.pictures, result] }));
    } finally {
      setSnipping(false);
      requestAnimationFrame(() => field.current?.focus());
    }
  }

  async function voice(): Promise<void> {
    if (!field.current) return;
    await dictate(fieldTarget(field.current, (text) => setDraft((d) => ({ ...d, text, ignoreDue: d.ignoreDue && !!parseDue(text, new Date()) }))), setSaid, captureApi(), {
      prefs: { meetingMic: ctx?.dictateMic ?? '', dictationClean: ctx?.dictateClean !== false },
      notify: (words) => setSaid(words),
    });
  }

  function addFiles(list: FileList | File[]): void {
    const paths: string[] = [];
    for (const f of Array.from(list)) {
      const p = window.nv.files.pathOf(f);
      if (p) paths.push(p);
    }
    if (!paths.length) {
      setSaid('Drop files from File Explorer to attach them.');
      return;
    }
    setDraft((d) => ({ ...d, files: [...d.files, ...paths.filter((p) => !d.files.includes(p))].slice(0, 20) }));
  }

  async function paste(event: React.ClipboardEvent): Promise<void> {
    const item = [...event.clipboardData.items].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (!item) return;
    event.preventDefault();
    const file = item.getAsFile();
    if (!file) return;
    const result = await api().addPicture(new Uint8Array(await file.arrayBuffer()));
    if (result && 'words' in result) setSaid(result.words);
    else if (result) setDraft((d) => ({ ...d, pictures: [...d.pictures, result] }));
  }

  const setKind = (kind: CaptureKind) => {
    setDraft((d) => ({ ...d, kind, ignoreDue: false }));
    requestAnimationFrame(() => field.current?.focus());
  };

  // Keys anywhere in the box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (picker) setPicker(false);
        else close();
        return;
      }
      if (saved) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          void undo();
        } else if (e.key === 'Enter' && saved.open) {
          e.preventDefault();
          void api().open(saved.open);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void save();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't' && !e.shiftKey) {
        e.preventDefault();
        setKind(draft.kind === 'task' ? 'note' : 'task');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pick = (path: string) => {
    setDraft((d) => ({ ...d, picked: path }));
    setPicker(false);
    requestAnimationFrame(() => field.current?.focus());
  };

  // The chips: the suggestions (the one chosen first), No project, and Another…
  const chips: { path: string; name: string; reason?: string }[] = [];
  if (chosen && !suggestions.some((s) => s.path === chosen.path)) chips.push({ path: chosen.path, name: chosen.name, reason: 'Chosen' });
  for (const s of suggestions) chips.push({ path: s.path, name: s.name, reason: s.reason });
  const noProjectWords = ctx?.noProject === 'inbox' ? 'Inbox' : 'Today’s note';
  // The words point at more than one project equally (a person on two of them): say so, rather than chips that look random.
  const top = suggestions[0];
  const tied = !chosen && top?.evidence === 'words' ? suggestions.filter((s) => s.evidence === 'words' && s.score === top.score) : [];
  const hint = tied.length >= 2 ? `${top!.reason}, on ${tied.length === 2 ? 'two' : tied.length} of your projects: choose one.` : '';

  return (
    <div
      className={`qc${dragging ? ' qc-dragging' : ''}`}
      onDragOver={(e) => {
        if (saved) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!saved && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      <div className={`qc-shell${saved ? ' is-saved' : ''}${snipping ? ' is-snipping' : ''}`} ref={shell} role="dialog" aria-label="Quick capture">
        {saved ? (
          <Saved saved={saved} onOpen={() => void api().open(saved.open)} onUndo={() => void undo()} />
        ) : (
          <>
            <div className="qc-top">
              <div className="kindtabs" role="tablist" aria-label="What it is">
                <button role="tab" aria-selected={draft.kind === 'note'} className={draft.kind === 'note' ? 'on' : ''} onClick={() => setKind('note')} title="A note (Ctrl+T switches)">
                  Note
                </button>
                <button role="tab" aria-selected={draft.kind === 'task'} className={draft.kind === 'task' ? 'on' : ''} onClick={() => setKind('task')} title="A task: a next step (Ctrl+T switches)">
                  Task
                </button>
              </div>
              <span className="qc-keys">Ctrl+T switches{ctx?.key ? ` · ${ctx.key} anywhere` : ''}</span>
            </div>
            <textarea
              ref={field}
              className="input qc-field"
              value={draft.text}
              spellCheck
              rows={draft.kind === 'task' ? 1 : 2}
              placeholder={draft.kind === 'task' ? 'What needs doing? Say when, like “by Friday”' : 'Write it down…'}
              aria-label={draft.kind === 'task' ? 'The task' : 'The note'}
              onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value, ignoreDue: d.ignoreDue && !!parseDue(e.target.value, new Date()) }))}
              onPaste={(e) => void paste(e)}
              onKeyDown={(e) => {
                // A task is one line: Enter saves it.
                if (draft.kind === 'task' && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
            {(due || attachments > 0) && (
              <div className="qc-extras">
                {due && (
                  <>
                    <span className="tag amber" title={`Due ${due.words} (from “${due.phrase}”)`}>
                      Due {due.words}
                    </span>
                    <span className="qc-heard">
                      heard “{due.phrase}” ·{' '}
                      <button className="qc-heard-x" title="Not a due date" onClick={() => setDraft((d) => ({ ...d, ignoreDue: true }))}>
                        not a date
                      </button>
                    </span>
                  </>
                )}
                {draft.pictures.map((p) => (
                  <span key={p.id} className="qc-pic" title={`${p.name} · ${p.width} × ${p.height}`}>
                    <img src={p.thumb} alt="" />
                    <button
                      className="qc-x on-pic"
                      title="Remove"
                      aria-label="Remove the screenshot"
                      onClick={() => {
                        void api().dropPicture(p.id);
                        setDraft((d) => ({ ...d, pictures: d.pictures.filter((x) => x.id !== p.id) }));
                      }}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </span>
                ))}
                {draft.files.map((f) => (
                  <span key={f} className="qc-file" title={f}>
                    <Icon name="file" size={13} />
                    <span className="qc-file-name">{baseName(f)}</span>
                    <button className="qc-x" title="Remove" aria-label={`Remove ${baseName(f)}`} onClick={() => setDraft((d) => ({ ...d, files: d.files.filter((x) => x !== f) }))}>
                      <Icon name="close" size={11} />
                    </button>
                  </span>
                ))}
                {destination?.attach && <span className="qc-attach-dest">{destination.attach}</span>}
              </div>
            )}
            <div className="qc-for">
              <span className="glabel">Put it in</span>
              <div className="qc-for-main">
              <div className="chips">
                {chips.map((c) => (
                  <Chip key={c.path} on={chosenPath === c.path} title={c.reason ? `${c.name} · ${c.reason}` : c.name} onClick={() => pick(chosenPath === c.path ? '' : c.path)}>
                    <span className="qc-chip-name">{c.name}</span>
                    {chosenPath === c.path && c.reason && <span className="qc-chip-why">{c.reason}</span>}
                  </Chip>
                ))}
                <Chip on={!chosen} title={`No project: ${noProjectWords.toLowerCase()}`} onClick={() => pick('')}>
                  <span className="qc-chip-name">No project</span>
                  {!chosen && <span className="qc-chip-why">{noProjectWords}</span>}
                </Chip>
                {ctx && ctx.projects.length > chips.length && (
                  <button className={`chip${picker ? ' on' : ''}`} onClick={() => setPicker((v) => !v)} aria-expanded={picker}>
                    Another… <Icon name="chevron" size={12} className="qc-more-icon" />
                  </button>
                )}
              </div>
              {hint && <p className="qc-for-hint">{hint}</p>}
              </div>
            </div>
            {picker && ctx && <Picker projects={ctx.projects} current={chosenPath} onPick={pick} onClose={() => setPicker(false)} />}
            {said && (
              <p className="qc-said" role="status">
                {said}
              </p>
            )}
            <div className="qc-foot">
              <div className="qc-tools">
                <button className="btn quiet" onClick={() => void snip()} title="Take a part of the screen" disabled={snipping}>
                  <Icon name="scissors" size={15} /> Snip
                </button>
                <button className="btn quiet" onClick={() => void voice()} title={ctx?.platform === 'win32' ? 'Speak instead of typing' : 'Voice typing is part of Windows'}>
                  <Icon name="mic" size={15} /> Voice
                </button>
                {attachments > 0 ? (
                  <label className="qc-assets">
                    <input
                      type="checkbox"
                      checked={toAssets}
                      onChange={(e) => {
                        const value = e.target.checked;
                        setCtx((c) => (c ? { ...c, toAssets: value } : c));
                        void api().remember({ toAssets: value });
                      }}
                    />
                    Save to assets
                  </label>
                ) : (
                  <span className="qc-hint">or drop a file here</span>
                )}
              </div>
              <div className="qc-go">
                {destination && destination.main && (
                  <span className="qc-dest" title={destination.main}>
                    {destination.main}
                  </span>
                )}
                <button className="btn pri qc-save" disabled={!canSave} onClick={() => void save()}>
                  Save {draft.kind === 'task' ? 'task' : 'note'}
                </button>
              </div>
            </div>
          </>
        )}
        {dragging && !saved && (
          <div className="qc-drop">
            <Icon name="download" size={20} />
            Drop to attach
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ on, title, onClick, children }: { on: boolean; title: string; onClick(): void; children: ReactNode }) {
  return (
    <button className={`chip${on ? ' on' : ''}`} aria-pressed={on} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

/** Every project, to find one by its name (arrows and Enter, or a click). */
function Picker({ projects, current, onPick, onClose }: { projects: CaptureContext['projects']; current: string; onPick(path: string): void; onClose(): void }) {
  const [find, setFind] = useState('');
  const [at, setAt] = useState(0);
  const rows = useRef<HTMLDivElement>(null);
  const list = useMemo(() => {
    const q = find.trim().toLowerCase();
    // Finished projects sort last, by the one finished rule (9.2 uplift F149): "Not done" is live, never finished.
    return [...projects].filter((p) => !q || wordsMatch(q, p.name)).sort((a, b) => Number(isFinished(a.status)) - Number(isFinished(b.status)) || a.name.localeCompare(b.name));
  }, [projects, find]);
  useEffect(() => setAt(0), [find]);
  // The arrowed row stays in sight in a long list (the picker's own rule, components/Picker.tsx).
  useEffect(() => {
    rows.current?.querySelector('.qc-picker-row.at')?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  return (
    <div className="qc-picker">
      <input
        autoFocus
        className="qc-picker-find"
        placeholder="Find a project…"
        value={find}
        onChange={(e) => setFind(e.target.value)}
        onKeyDown={(e) => {
          // Arrows wrap like the pickers (components/Picker.tsx): past the last is the first again.
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAt((i) => (list.length ? (i + 1) % list.length : 0));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAt((i) => (list.length ? (i - 1 + list.length) % list.length : 0));
          } else if (e.key === 'Enter' && list[at]) {
            e.preventDefault();
            e.stopPropagation();
            onPick(list[at].path);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <div className="qc-picker-list" role="listbox" ref={rows}>
        {list.map((p, i) => (
          <button key={p.path} role="option" aria-selected={i === at} title={p.name} className={`qc-picker-row${i === at ? ' at' : ''}${p.path === current ? ' current' : ''}`} onMouseEnter={() => setAt(i)} onClick={() => onPick(p.path)}>
            <span className={`qc-dot status-${(p.status ?? 'none').replace(/\s+/g, '-')}`} />
            <span className="qc-picker-name">{p.name}</span>
            {p.status && <span className="qc-picker-status">{p.status}</span>}
            {p.path === current && <Icon name="check" size={13} />}
          </button>
        ))}
        {!list.length && <p className="qc-picker-none">No project is called that.</p>}
      </div>
    </div>
  );
}

function Saved({ saved, onOpen, onUndo }: { saved: CaptureSaved; onOpen(): void; onUndo(): void }) {
  return (
    <div className="qc-saved" role="status">
      <span className="qc-saved-mark">
        <Icon name="check" size={16} />
      </span>
      <div className="qc-saved-text">
        <div className="qc-saved-words">{saved.words}</div>
        {saved.detail && <div className="qc-saved-detail">{saved.detail}</div>}
      </div>
      <div className="qc-saved-actions">
        {saved.open && (
          <button className="button qc-open" onClick={onOpen} autoFocus>
            Open
          </button>
        )}
        <button className="button qc-undo" onClick={onUndo} title="Undo (Ctrl+Z)">
          <Icon name="undo" size={14} /> Undo
        </button>
      </div>
    </div>
  );
}
