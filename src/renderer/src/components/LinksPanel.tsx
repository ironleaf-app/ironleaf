import { isPrivatePath } from '../../../shared/private';
import { writeLink } from '../lib/links';
import { resolveNote } from '../lib/resolve';
import { useEffect, useState } from 'react';
import type { AiLinkResult, Mention, RelatedNote } from '../../../shared/types';
import type { NoteEditor } from '../state/layout';
import { AiSetup } from './AiSetup';
import { Icon } from './Icon';

interface LinksPanelProps {
  path: string;
  liveText: string;
  revision: number;
  editor(): NoteEditor | undefined;
  aiNote: string | null;
  onOpen(path: string): void;
}

/** Auto-linking: unlinked mentions while you type, related notes, and the model's suggestions. */
export function LinksPanel({ path, liveText, revision, editor, aiNote, onOpen }: LinksPanelProps) {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [related, setRelated] = useState<RelatedNote[]>([]);
  const [ai, setAi] = useState<AiLinkResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.nv.index.mentions(path, liveText).then((m) => {
      if (!cancelled) setMentions(m);
    });
    return () => {
      cancelled = true;
    };
  }, [path, liveText, revision]);

  useEffect(() => {
    let cancelled = false;
    void window.nv.index.related(path).then((r) => {
      if (!cancelled) setRelated(r);
    });
    return () => {
      cancelled = true;
    };
  }, [path, revision]);

  useEffect(() => {
    setAi(null);
    setNotice(null);
  }, [path]);

  const linkPhrase = (phrase: string, title: string, line?: number) => {
    if (!editor()?.linkPhrase(phrase, title, line)) setNotice(`Couldn't find "${phrase}" in the note any more.`);
  };

  const insertLink = (title: string) => {
    const rel = resolveNote(title, path);
    editor()?.insertAtCursor(rel ? writeLink(rel, path) : `[[${title}]]`);
  };

  const askModel = async () => {
    // A private note never goes to the AI (src/main/private-notes.ts).
    if (isPrivatePath(path)) {
      setNotice('Private notes aren’t sent to the AI.');
      return;
    }
    setAiBusy(true);
    setNotice(null);
    try {
      setAi(await window.nv.ai.suggestLinks(path, editor()?.getText() ?? liveText));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="panel-body">
      {notice && <p className="notice">{notice}</p>}

      <div className="section">
        <div className="section-title">
          Mentions in this note <span className="panel-count">{mentions.length}</span>
        </div>
        <p className="hint">Text that matches another note's title but isn't linked yet. Updates as you type.</p>
        {mentions.map((m) => (
          <div key={m.target} className="result-row">
            <button className="result-snippet" onClick={() => onOpen(m.target)} title={m.target}>
              <strong>{m.phrase}</strong> → {m.targetTitle}
            </button>
            <button className="small-button" onClick={() => linkPhrase(m.phrase, m.targetTitle, m.line)}>
              Link
            </button>
          </div>
        ))}
        {!mentions.length && <p className="empty">Nothing to link right now.</p>}
      </div>

      <div className="section">
        <div className="section-title">Related notes</div>
        <p className="hint">Notes that share distinctive words with this one and aren't linked yet.</p>
        {related.map((r) => (
          <div key={r.path} className="result-row">
            <button className="result-snippet" onClick={() => onOpen(r.path)} title={r.path}>
              {r.title}
            </button>
            <button className="small-button" onClick={() => insertLink(r.title)} title="Insert a link at the cursor">
              Insert
            </button>
          </div>
        ))}
        {!related.length && <p className="empty">No related notes found yet.</p>}
      </div>

      <div className="section">
        <div className="section-title">Assistant suggestions</div>
        {aiNote !== null ? (
          <AiSetup compact why={aiNote} />
        ) : (
          <button className="button primary" disabled={aiBusy} onClick={() => void askModel()}>
            <Icon name="sparkle" size={15} /> {aiBusy ? 'Asking the assistant…' : 'Suggest links'}
          </button>
        )}
        {ai?.error && <p className="notice">{ai.error}</p>}
        {ai?.truncated && <p className="hint">This note is long, so only its first part was read.</p>}
        {ai?.suggestions.map((s) => (
          <div key={`${s.target}:${s.phrase}`} className="suggestion">
            <div className="result-row">
              <button className="result-snippet" onClick={() => onOpen(s.target)}>
                {s.phrase ? (
                  <>
                    <strong>{s.phrase}</strong> → {s.targetTitle}
                  </>
                ) : (
                  s.targetTitle
                )}
              </button>
              <button className="small-button" onClick={() => (s.phrase ? linkPhrase(s.phrase, s.targetTitle) : insertLink(s.targetTitle))}>
                {s.phrase ? 'Link' : 'Insert'}
              </button>
            </div>
            {s.reason && <p className="hint">{s.reason}</p>}
          </div>
        ))}
        {ai && !ai.error && !ai.suggestions.length && <p className="empty">No strong links found.</p>}
      </div>
    </div>
  );
}
