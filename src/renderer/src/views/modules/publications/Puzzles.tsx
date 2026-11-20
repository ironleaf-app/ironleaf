// The puzzle engine (Publications, Wave 6 part a; the plan: "Puzzle engine: generate, store answers, print yesterday's
// answers automatically, and track the household's solve times"). Make a crossword from your answers and clues, a sudoku
// at a difficulty, a word search from your words or a daily word; see it and its answers before keeping it; put it
// straight into the next edition. Beside it, the household's solve times: who is quickest at what, and a time recorded
// in two clicks.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PubState } from '../../../../../main/publications';
import { kindInfo, shortDate } from '../../../../../shared/publications';
import { answersText, readSolveTime, solveTimeWords, type Crossword, type DailyWord, type Puzzle, type Sudoku, type WordSearch } from '../../../../../shared/puzzles';
import { Icon } from '../../../components/Icon';
import { peek } from '../../../state/peek';
import { showError, useApp } from '../../../state/store';
import { openModule } from '../../../state/modules';
import { act, todayIso } from './usePub';

type Cur = NonNullable<PubState['current']>;
type Kind = 'crossword' | 'sudoku' | 'wordsearch' | 'dailyword';

export function CrosswordView({ p, filled }: { p: Crossword; filled?: boolean }) {
  const nums = new Map<string, number>();
  for (const e of [...p.across, ...p.down]) nums.set(`${e.row},${e.col}`, e.n);
  return (
    <div className="pz-xw" style={{ ['--w' as string]: p.width }} role="img" aria-label={`A ${p.width} by ${p.height} crossword`}>
      {p.grid.flatMap((row, r) =>
        [...row].map((ch, c) => (
          <i key={`${r}-${c}`} className={ch === '#' ? 'b' : ''}>
            {ch !== '#' && nums.get(`${r},${c}`) ? <em>{nums.get(`${r},${c}`)}</em> : null}
            {ch !== '#' && filled ? <s>{ch}</s> : null}
          </i>
        )),
      )}
    </div>
  );
}

function SudokuView({ p, filled }: { p: Sudoku; filled?: boolean }) {
  const src = filled ? p.solution : p.grid;
  return (
    <div className="pz-sd" role="img" aria-label="A sudoku grid">
      {[...src].map((ch, i) => (
        <i key={i} className={`${i % 9 === 2 || i % 9 === 5 ? 'rr ' : ''}${Math.floor(i / 9) === 2 || Math.floor(i / 9) === 5 ? 'rb ' : ''}${filled && p.grid[i] === '.' ? 'is-ans' : ''}`}>
          {ch === '.' ? '' : ch}
        </i>
      ))}
    </div>
  );
}

function WordSearchView({ p, filled }: { p: WordSearch; filled?: boolean }) {
  const hit = new Set<string>();
  if (filled) for (const w of p.words) for (let i = 0; i < w.word.length; i++) hit.add(`${w.row + w.dr * i},${w.col + w.dc * i}`);
  return (
    <div className="pz-ws" style={{ ['--n' as string]: p.size }} role="img" aria-label={`A ${p.size} by ${p.size} word search`}>
      {p.rows.flatMap((row, r) => [...row].map((ch, c) => <i key={`${r}-${c}`} className={hit.has(`${r},${c}`) ? 'is-ans' : ''}>{ch}</i>))}
    </div>
  );
}

function DailyView({ p, filled }: { p: DailyWord; filled?: boolean }) {
  return (
    <div className="pz-dw" style={{ ['--n' as string]: p.length }}>
      {p.guesses.map((g, k) => (
        <div key={k} className="pz-dw-row">
          {[...g.word].map((ch, i) => (
            <i key={i} className={g.marks[i]}>
              {ch}
            </i>
          ))}
        </div>
      ))}
      <div className="pz-dw-row">
        {[...p.answer].map((ch, i) => (
          <i key={i} className={filled ? 'right' : 'blank'}>
            {filled ? ch : ''}
          </i>
        ))}
      </div>
    </div>
  );
}

export function PuzzleView({ p, filled }: { p: Puzzle; filled?: boolean }) {
  if (p.kind === 'crossword')
    return (
      <div className="pz-cross">
        <CrosswordView p={p} filled={filled} />
        <div className="pz-clues">
          <h5>Across</h5>
          <ol>
            {p.across.map((e) => (
              <li key={`a${e.n}`}>
                <b>{e.n}</b> {e.clue} <span>({e.enumeration})</span>
              </li>
            ))}
          </ol>
          <h5>Down</h5>
          <ol>
            {p.down.map((e) => (
              <li key={`d${e.n}`}>
                <b>{e.n}</b> {e.clue} <span>({e.enumeration})</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  if (p.kind === 'sudoku') return <SudokuView p={p} filled={filled} />;
  if (p.kind === 'wordsearch')
    return (
      <div className="pz-cross">
        <WordSearchView p={p} filled={filled} />
        <ul className="pz-words">
          {p.words.map((w) => (
            <li key={w.word}>{w.words}</li>
          ))}
        </ul>
      </div>
    );
  return <DailyView p={p} filled={filled} />;
}

const KINDS: { id: Kind; name: string; line: string }[] = [
  { id: 'crossword', name: 'Crossword', line: 'From your answers and clues, joined where they share a letter.' },
  { id: 'sudoku', name: 'Sudoku', line: 'Always exactly one answer, checked by solving it.' },
  { id: 'wordsearch', name: 'Word search', line: 'Your words hidden across, down and diagonally.' },
  { id: 'dailyword', name: 'Daily word', line: 'A word to find from a few guesses already marked.' },
];

function Maker({ cur }: { cur: Cur }) {
  const canEdit = useApp((s) => s.canEdit);
  const [kind, setKind] = useState<Kind>('crossword');
  const [clues, setClues] = useState('');
  const [words, setWords] = useState('');
  const [answer, setAnswer] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [ways, setWays] = useState('easy');
  const [title, setTitle] = useState('');
  const puzzleSection = cur.pub.sections.find((s) => /puzzle|fun|game/i.test(s.name))?.name ?? cur.pub.sections.at(-1)?.name ?? '';
  const [section, setSection] = useState(puzzleSection);
  const [made, setMade] = useState<{ puzzle: Puzzle; problems: string[]; words: string } | null>(null);
  const [answers, setAnswers] = useState(false);
  const [busy, setBusy] = useState(false);
  const madeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (made) madeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [made]);
  // The edition being made: the newest that hasn't gone out yet (a draft, or built and waiting).
  const draft = cur.editions.find((e) => (e.status === 'Draft' || e.status === 'Built') && !e.preview);
  const make = async () => {
    setBusy(true);
    try {
      setMade(await window.nv.pub.makePuzzle({ kind, clues, words: words.split(/[\n,;]+/).map((w) => w.trim()).filter(Boolean), answer, difficulty, ways }));
      setAnswers(false);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const keep = async (into?: string) => {
    if (!made) return;
    const rel = await act(() => window.nv.pub.savePuzzle(cur.pub.path, { puzzle: made.puzzle, title: title || kindInfo(kind)?.name, section }), `Kept the ${kindInfo(kind)?.name.toLowerCase()} with its answers.`);
    if (!rel || !into) return;
    const d = await window.nv.pub.edition(into);
    const next = d.sections.map((s) => ({ name: s.name, items: s.items.map((i) => i.path.replace(/\.md$/i, '')) }));
    const s = next.find((x) => x.name === section) ?? next.at(-1)!;
    s.items.push(rel.replace(/\.md$/i, ''));
    await act(() => window.nv.pub.setEdition(into, { sections: next }), `Put it in ${d.edition.label}.`);
    setMade(null);
  };
  return (
    <section className="pb-panel pb-maker" aria-label="Make a puzzle">
      <h3>Make a puzzle</h3>
      <div className="pb-kinds" role="radiogroup" aria-label="Kind of puzzle">
        {KINDS.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className={`pb-kind${kind === k.id ? ' is-on' : ''}`} onClick={() => (setKind(k.id), setMade(null))}>
            {k.name}
          </button>
        ))}
      </div>
      <p className="pb-faint">{KINDS.find((k) => k.id === kind)?.line}</p>
      <div className="pb-grid2">
        <label className="pb-field">
          <span>Title</span>
          <input className="pb-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'crossword' ? 'Around the harbour' : kindInfo(kind)?.name} />
        </label>
        <label className="pb-field">
          <span>Section</span>
          <select className="pb-input" value={section} onChange={(e) => setSection(e.target.value)}>
            {cur.pub.sections.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        {kind === 'crossword' && (
          <label className="pb-field is-wide">
            <span>Answers and clues, one per line</span>
            <textarea className="pb-input pb-area pb-mono" rows={9} value={clues} onChange={(e) => setClues(e.target.value)} placeholder={'HARBOUR: Where the boats come in\nLIGHTHOUSE: It keeps ships off the rocks\nGULL: Noisy seabird after your chips'} spellCheck={false} />
            <em className="pb-hint">{clues.split('\n').filter((l) => l.trim()).length} lines. An answer of two words prints its lengths, like (6,4).</em>
          </label>
        )}
        {kind === 'sudoku' && (
          <div className="pb-field is-wide">
            <span>Difficulty</span>
            <div className="seg pb-seg" role="radiogroup" aria-label="Difficulty">
              {['easy', 'medium', 'hard'].map((d) => (
                <button key={d} type="button" role="radio" aria-checked={difficulty === d} className={difficulty === d ? 'is-on' : ''} onClick={() => setDifficulty(d)}>
                  {d[0]!.toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
        {(kind === 'wordsearch' || kind === 'dailyword') && (
          <label className="pb-field is-wide">
            <span>{kind === 'wordsearch' ? 'Words to hide' : 'Words to choose from (optional)'}</span>
            <textarea className="pb-input pb-area" rows={5} value={words} onChange={(e) => setWords(e.target.value)} placeholder={kind === 'wordsearch' ? 'harbour, lighthouse, gull, ferry, anchor, tide' : 'Leave empty for everyday five-letter words'} />
          </label>
        )}
        {kind === 'wordsearch' && (
          <div className="pb-field is-wide">
            <span>Which ways the words run</span>
            <div className="seg pb-seg" role="radiogroup" aria-label="Ways">
              <button type="button" role="radio" aria-checked={ways === 'easy'} className={ways === 'easy' ? 'is-on' : ''} onClick={() => setWays('easy')}>
                Across, down, diagonal
              </button>
              <button type="button" role="radio" aria-checked={ways === 'hard'} className={ways === 'hard' ? 'is-on' : ''} onClick={() => setWays('hard')}>
                Every way, backwards too
              </button>
            </div>
          </div>
        )}
        {kind === 'dailyword' && (
          <label className="pb-field">
            <span>The word to find (optional)</span>
            <input className="pb-input pb-mono" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Chosen for you" />
          </label>
        )}
      </div>
      <div className="pb-actions is-left">
        <button type="button" className="button primary" disabled={busy} onClick={() => void make()}>
          <Icon name="sparkle" size={13} /> {made ? 'Make another' : 'Make it'}
        </button>
      </div>
      {made && (
        <div className="pb-made" ref={madeRef}>
          <div className="pb-made-head">
            <strong>{made.words}</strong>
            {made.problems.length ? <span className="pb-piece-flag">{made.problems.join(' ')}</span> : <span className="pb-ok"><Icon name="check" size={12} /> Checked: sound</span>}
            <label className="pb-check-inline">
              <input type="checkbox" checked={answers} onChange={(e) => setAnswers(e.target.checked)} /> Show the answers
            </label>
          </div>
          <div className="pb-made-view">
            <PuzzleView p={made.puzzle} filled={answers} />
          </div>
          {answers && made.puzzle.kind !== 'sudoku' && made.puzzle.kind !== 'crossword' && <p className="pb-faint">{answersText(made.puzzle).replace(/\*\*/g, '')}</p>}
          <div className="pb-actions is-left">
            <button type="button" className="button" disabled={!canEdit || !!made.problems.length} onClick={() => void keep()}>
              Keep it
            </button>
            {draft && (
              <button type="button" className="button primary" disabled={!canEdit || !!made.problems.length} onClick={() => void keep(draft.path)}>
                Keep it and put it in {draft.label}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SolveTimes({ cur }: { cur: Cur }) {
  const canEdit = useApp((s) => s.canEdit);
  const puzzles = useMemo(() => cur.items.filter((i) => kindInfo(i.kind)?.puzzle), [cur.items]);
  const people = useMemo(() => [...new Set(cur.board.people.map((p) => p.who))], [cur.board]);
  const [which, setWhich] = useState(puzzles[0]?.path ?? '');
  const [who, setWho] = useState('');
  const [time, setTime] = useState('');
  const [day, setDay] = useState(todayIso());
  const secs = readSolveTime(time);
  const record = async () => {
    const ok = await act(() => window.nv.pub.solve(which, { who, time, day }), (w) => w);
    if (ok) setTime('');
  };
  return (
    <section className="pb-panel pb-solves" aria-label="Solve times">
      <h3>Solve times</h3>
      {cur.board.best.length > 0 ? (
        <div className="pb-best">
          {cur.board.best.map((b) => (
            <div key={b.kind} className="pb-best-one">
              <span>{kindInfo(b.kind)?.name}</span>
              <strong>{solveTimeWords(b.seconds)}</strong>
              <em>
                {b.who}
                {b.day ? ` · ${shortDate(b.day)}` : ''}
              </em>
            </div>
          ))}
        </div>
      ) : (
        <p className="pb-faint">No times yet. Record one below: the quickest for each kind of puzzle shows here.</p>
      )}
      <form
        className="pb-solve-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (which && who && secs) void record();
        }}
      >
        <label className="pb-field is-wide">
          <span>Puzzle</span>
          <select className="pb-input" value={which} onChange={(e) => setWhich(e.target.value)} disabled={!puzzles.length}>
            {!puzzles.length && <option value="">No puzzles yet</option>}
            {puzzles.map((p) => (
              <option key={p.path} value={p.path}>
                {p.kindName}: {p.headline}
                {p.editions[0] ? ` (${p.editions[0]})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="pb-field">
          <span>Who</span>
          <input className="pb-input" list="pb-solvers" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Name" />
          <datalist id="pb-solvers">
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="pb-field">
          <span>Time</span>
          <input className="pb-input pb-mono" value={time} onChange={(e) => setTime(e.target.value)} placeholder="12:30" />
          <em className={time && !secs ? 'pb-hint is-bad' : 'pb-hint'}>{time ? (secs ? solveTimeWords(secs) : 'Like 12:30 or 4 min') : 'Minutes and seconds'}</em>
        </label>
        <label className="pb-field">
          <span>Day</span>
          <input type="date" className="pb-input" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <div className="pb-actions is-left is-wide">
          <button type="submit" className="button primary small" disabled={!canEdit || !which || !who.trim() || !secs}>
            Record the time
          </button>
        </div>
      </form>
      {cur.board.people.length > 0 && (
        <table className="pb-table is-compact">
          <thead>
            <tr>
              <th>Who</th>
              <th className="n">Solved</th>
              {cur.board.best.map((b) => (
                <th key={b.kind} className="n">
                  {kindInfo(b.kind)?.name} best
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cur.board.people.map((p) => (
              <tr key={p.who}>
                <td>{p.who}</td>
                <td className="n">{p.solves}</td>
                {cur.board.best.map((b) => (
                  <td key={b.kind} className="n">
                    {p.byKind[b.kind] ? solveTimeWords(p.byKind[b.kind]!.best) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {cur.board.recent.length > 0 && (
        <>
          <h4>Lately</h4>
          <ul className="pb-recent">
            {cur.board.recent.map((r, i) => (
              <li key={i}>
                <button type="button" className="link-button" onClick={() => peek({ type: 'note', path: r.item }, { title: r.headline, type: 'note' })}>
                  {r.who}: {kindInfo(r.kind)?.name.toLowerCase()} “{r.headline}” in {solveTimeWords(r.seconds)}
                </button>
                <em>{r.day ? shortDate(r.day) : ''}</em>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function Puzzles({ cur }: { cur: Cur }) {
  const kept = cur.items.filter((i) => kindInfo(i.kind)?.puzzle);
  return (
    <div className="pb-puzzles">
      <Maker cur={cur} />
      <div className="pb-side">
        <SolveTimes cur={cur} />
        {kept.length > 0 && (
          <section className="pb-panel" aria-label="Puzzles kept">
            <h3>Puzzles kept</h3>
            <ul className="pb-kept">
              {kept.slice(0, 12).map((p) => (
                <li key={p.path}>
                  <button type="button" className="pb-kept-row" onClick={() => peek({ type: 'note', path: p.path }, { title: p.headline, type: 'note' })}>
                    <strong>{p.headline}</strong>
                    <em>{[p.kindName, p.puzzle, p.editions[0] ?? 'not in an edition yet'].filter(Boolean).join(' · ')}</em>
                  </button>
                </li>
              ))}
            </ul>
            {kept.length > 12 && (
              <button type="button" className="link-button" onClick={() => openModule('publications', 'items')}>
                {kept.length - 12} more in Pieces
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
