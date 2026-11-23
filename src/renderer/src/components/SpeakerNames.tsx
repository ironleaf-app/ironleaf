// The meeting's voices, named once each (6 Nov 2026, speakers): each voice found so far with a short clip of its
// sound and a name set in one step — the meeting's people first, then the vault's People, free typing always. Used
// while it records (the live card, clips from the pieces) and after (the meeting's page, clips from the recording),
// the same control both doors. Naming never rewrites a line (names live apart), and every step undoes.
import { useEffect, useMemo, useState } from 'react';
import { notePeople } from '../../../shared/meetings';
import { speakerDisplay, speakerSuggestions, type SpeakerMark, type SpeakerNames } from '../../../shared/meeting-speakers';
import { useApp } from '../state/store';
import { Icon } from './Icon';
import { openMenu } from './Menu';
import { isEnterKey } from '../lib/enterKey';

/** Who each voice might be: the meeting's own people first, then the vault's People, each once. */
export function useSpeakerSuggestions(note: string | null, text: string): string[] {
  const props = useApp((s) => (note ? s.byPath.get(note)?.props : undefined));
  const [people, setPeople] = useState<string[]>([]);
  useEffect(() => {
    if (!note) return;
    let alive = true;
    window.nv.meetings.context(note).then(
      (c) => alive && setPeople(c?.people ?? []),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [note]);
  const mine = useMemo(() => (note ? notePeople(text, props ?? {}) : []), [note, text, props]);
  return useMemo(() => speakerSuggestions(mine, people), [mine, people]);
}

export function SpeakerNames({
  marks,
  names,
  suggestions,
  canEdit,
  playingId,
  onPlay,
  onName,
  onClear,
  onMerge,
  undoable,
  onUndo,
  notice,
  said,
}: {
  /** The voices found so far, first heard first. */
  marks: SpeakerMark[];
  /** The names set on them. */
  names: SpeakerNames;
  /** Who each voice might be: the meeting's people first, then the vault's People. */
  suggestions: string[];
  canEdit: boolean;
  /** The voice whose clip is playing now (null: none). */
  playingId: string | null;
  /** A voice's clip played (its first seconds). */
  onPlay(id: string): void;
  /** A name set on a voice ('' set, else why not, in plain words). */
  onName(id: string, name: string): string;
  /** A voice unnamed. */
  onClear(id: string): void;
  /** Two voices joined by hand (every line moves; said in plain words). Null: joining not offered here. */
  onMerge: ((from: string, to: string) => string) | null;
  /** A naming step back, when there is one. */
  undoable: boolean;
  onUndo(): void;
  /** Said once under the voices (they couldn't be told apart; the final listen split one). */
  notice?: string;
  /** Said after a naming step (a join, a refusal). */
  said?: string;
}) {
  // One row open at a time (its name box and suggestions); the rest stay one line each.
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  if (!marks.length && !notice) return null;
  const start = (id: string) => {
    setOpen(id);
    setDraft(names[id] ?? '');
  };
  const save = (id: string) => {
    if (!draft.trim()) {
      onClear(id);
      setOpen(null);
      return;
    }
    if (!onName(id, draft)) setOpen(null);
  };
  return (
    <div className="spk" aria-label="Speakers">
      <div className="spk-head">
        <span className="spk-title">
          <Icon name="people" size={13} />
          {marks.length === 1 ? '1 voice so far' : `${marks.length} voices so far`}
        </span>
        {undoable && canEdit && (
          <button type="button" className="text-button spk-undo" onClick={onUndo} title="Undo the last naming step">
            <Icon name="undo" size={12} />
            Undo
          </button>
        )}
      </div>
      <ol className="spk-rows">
        {marks.map((m) => {
          const name = names[m.id];
          const isOpen = open === m.id;
          return (
            <li key={m.id} className="spk-row">
              <button type="button" className="icon-button spk-play" title={`Hear ${name || speakerDisplay(m.id)}’s voice`} aria-label={`Hear ${name || speakerDisplay(m.id)}’s voice`} onClick={() => onPlay(m.id)}>
                <Icon name={playingId === m.id ? 'pause' : 'play'} size={12} />
              </button>
              {isOpen && canEdit ? (
                <span className="spk-edit">
                  <input
                    type="text"
                    className="spk-input"
                    autoFocus
                    value={draft}
                    placeholder={`Who is ${speakerDisplay(m.id)}?`}
                    aria-label={`Name for ${speakerDisplay(m.id)}`}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (isEnterKey(e)) save(m.id);
                      else if (e.key === 'Escape') setOpen(null);
                    }}
                  />
                  <button type="button" className="button small primary" onClick={() => save(m.id)}>
                    Save
                  </button>
                  <button type="button" className="button small" onClick={() => setOpen(null)}>
                    Cancel
                  </button>
                  {suggestions.length > 0 && (
                    <span className="spk-suggest" role="group" aria-label="Suggestions">
                      {suggestions.slice(0, 6).map((s) => (
                        // Picking a person sets the name there and then (6 Nov 2026, the naming-card trap: a pick
                        // only filled the box, so it looked done when nothing was saved, and a same-looking
                        // person chip elsewhere took the person to that person's page instead).
                        <button key={s} type="button" className="text-button spk-pick" title={`Set ${speakerDisplay(m.id)}’s name to ${s}`} onClick={() => !onName(m.id, s) && setOpen(null)}>
                          {s}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              ) : (
                <button type="button" className="text-button spk-name" title={canEdit ? (name ? `Change ${speakerDisplay(m.id)}’s name` : `Set ${speakerDisplay(m.id)}’s name`) : undefined} disabled={!canEdit} onClick={() => start(m.id)}>
                  <span className="mp-who is-speaker">{name || speakerDisplay(m.id)}</span>
                  {name && <span className="spk-was">{speakerDisplay(m.id)}</span>}
                  {!name && canEdit && <span className="spk-set">Set a name</span>}
                </button>
              )}
              {!isOpen && name && canEdit && (
                <button type="button" className="icon-button spk-clear" title={`Unname ${speakerDisplay(m.id)}`} aria-label={`Unname ${speakerDisplay(m.id)}`} onClick={() => onClear(m.id)}>
                  <Icon name="close" size={11} />
                </button>
              )}
              {!isOpen && onMerge && canEdit && marks.length > 1 && (
                // The app's own drop-down, as everywhere else, never a plain browser select (6 Nov 2026, break-it 10).
                <button
                  type="button"
                  className="text-button spk-join"
                  title="Say this voice is the same person as another"
                  aria-label={`Say ${name || speakerDisplay(m.id)} is the same person as another voice`}
                  aria-haspopup="menu"
                  onClick={(e) =>
                    openMenu(e.currentTarget, [
                      { heading: `${name || speakerDisplay(m.id)} is the same person as` },
                      ...marks
                        .filter((o) => o.id !== m.id && o.side === m.side)
                        .map((o) => ({ label: names[o.id] || speakerDisplay(o.id), run: () => onMerge(m.id, o.id) })),
                    ])
                  }
                >
                  Same person as…
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {(notice || said) && (
        <p className="spk-line" role="status">
          {said || notice}
        </p>
      )}
    </div>
  );
}
