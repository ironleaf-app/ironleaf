// The pieces (Publications, Wave 6 part a; the plan: "every piece inside it, each stored as a reusable item with its
// source"): every story, brief, table, picture, cartoon, quote and puzzle a publication has, with its source, the
// editions it ran in and anything wrong with it; and the form a new one is written in.

import { useMemo, useState } from 'react';
import type { PubState } from '../../../../../main/publications';
import { ITEM_KINDS, kindInfo, shortDate } from '../../../../../shared/publications';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { fileUrl } from '../../../lib/resolve';
import { peek } from '../../../state/peek';
import { useApp } from '../../../state/store';
import { act, KIND_ICON, todayIso } from './usePub';

type Cur = NonNullable<PubState['current']>;

const BODY_HINT: Record<string, string> = {
  story: 'The story, a paragraph per line break. Keep to what the source says.',
  brief: 'Two or three sentences.',
  weather: '| Place | Today | Tomorrow | Sat |\n| --- | --- | --- | --- |\n| Harbour Town | 21° Sunny | 18° Showers | 19° Cloudy |',
  sports: '| Team | P | W | L | Pts |\n| --- | --- | --- | --- | --- |\n| Harbour Hawks | 8 | 6 | 2 | 12 |',
  image: 'The caption: what the picture shows.',
  cartoon: '1. What happens in the first panel\n2. The second\n3. The third\n4. The punchline',
  quote: 'The words, as they were said.',
  onthisday: '- **1969:** What happened\n- **1990:** Something else',
};

export function PieceForm({ cur, section, kind: kind0, onDone, onCancel }: { cur: Cur; section?: string; kind?: string; onDone(path: string): void; onCancel(): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const kinds = ITEM_KINDS.filter((k) => !k.puzzle);
  const [kind, setKind] = useState(kind0 && !kindInfo(kind0)?.puzzle ? kind0 : 'story');
  const [sec, setSec] = useState(section ?? cur.pub.sections[1]?.name ?? cur.pub.sections[0]?.name ?? '');
  const [headline, setHeadline] = useState('');
  const [deck, setDeck] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [credit, setCredit] = useState('');
  const [who, setWho] = useState('');
  const [image, setImage] = useState('');
  const [lead, setLead] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const rule = cur.pub.sections.find((s) => s.name === sec);
  const needsSource = ['story', 'brief'].includes(kind) && !!rule?.sources;
  const pictured = ['story', 'image', 'cartoon'].includes(kind);
  const submit = async () => {
    setBusy(true);
    const rel = await act(() => window.nv.pub.addItem(cur.pub.path, { kind, section: sec, headline, deck, body, source, sourceUrl, credit, who, image, lead, date }), `Kept “${headline}”.`);
    setBusy(false);
    if (rel) onDone(rel);
  };
  return (
    <form
      className="pb-piece-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && headline.trim()) void submit();
      }}
    >
      <header className="pb-dialog-head">
        <h2>Write a piece</h2>
        <p className="pb-faint">{kindInfo(kind)?.words}</p>
      </header>
      <div className="pb-kinds" role="radiogroup" aria-label="Kind of piece">
        {kinds.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className={`pb-kind${kind === k.id ? ' is-on' : ''}`} onClick={() => setKind(k.id)}>
            <Icon name={KIND_ICON[k.id] ?? 'notes'} size={13} />
            {k.name}
          </button>
        ))}
      </div>
      <div className="pb-grid2">
        <label className="pb-field is-wide">
          <span>{kind === 'quote' ? 'A few words to know it by' : kind === 'image' || kind === 'cartoon' ? 'Title' : 'Headline'}</span>
          <input className="pb-input pb-input-big" value={headline} onChange={(e) => setHeadline(e.target.value)} required autoFocus placeholder={kind === 'story' ? 'Council approves the new harbour path' : ''} />
        </label>
        <label className="pb-field">
          <span>Section</span>
          <select className="pb-input" value={sec} onChange={(e) => setSec(e.target.value)}>
            {cur.pub.sections.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
          {rule?.rules && <em className="pb-hint">{rule.rules}</em>}
        </label>
        <label className="pb-field">
          <span>Date</span>
          <input type="date" className="pb-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {kind === 'story' && (
          <label className="pb-field is-wide">
            <span>Standfirst (optional)</span>
            <input className="pb-input" value={deck} onChange={(e) => setDeck(e.target.value)} placeholder="One line under the headline that says why it matters" />
          </label>
        )}
        <label className="pb-field is-wide">
          <span>{kind === 'weather' || kind === 'sports' ? 'The table' : kind === 'cartoon' ? 'Captions, one per panel' : kind === 'image' ? 'Caption' : 'Words'}</span>
          <textarea className="pb-input pb-area" rows={kind === 'story' ? 9 : 6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={BODY_HINT[kind] ?? ''} spellCheck />
        </label>
        {kind !== 'quote' && kind !== 'onthisday' && (
          <>
            <label className="pb-field">
              <span>Source{needsSource ? ' (needed)' : ''}</span>
              <input className="pb-input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="The outlet’s name" required={needsSource} />
              {needsSource && <em className="pb-hint">{rule!.sources}</em>}
            </label>
            <label className="pb-field">
              <span>Source link</span>
              <input className="pb-input" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" />
            </label>
          </>
        )}
        {kind === 'quote' && (
          <label className="pb-field is-wide">
            <span>Who said it</span>
            <input className="pb-input" value={who} onChange={(e) => setWho(e.target.value)} />
          </label>
        )}
        {pictured && (
          <div className="pb-field is-wide">
            <span>{kind === 'cartoon' ? 'The strip' : 'Picture'}</span>
            <div className="pb-pic-pick">
              {image ? <img src={fileUrl(image)} alt="" /> : <span className="pb-pic-none"><Icon name="image" size={18} /></span>}
              <button type="button" className="button small" onClick={() => void act(() => window.nv.pub.pickPicture(cur.pub.path)).then((r) => r && setImage(r))}>
                {image ? 'Choose another…' : 'Choose a picture…'}
              </button>
              {image && (
                <button type="button" className="link-button" onClick={() => setImage('')}>
                  No picture
                </button>
              )}
            </div>
          </div>
        )}
        {pictured && (
          <label className="pb-field is-wide">
            <span>Credit</span>
            <input className="pb-input" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="Photo: …" />
          </label>
        )}
        {kind === 'story' && (
          <label className="pb-check is-wide">
            <input type="checkbox" checked={lead} onChange={(e) => setLead(e.target.checked)} />
            <span>
              <strong>The lead story</strong>
              <em>Across the top of the front page, with a big headline and a drop cap.</em>
            </span>
          </label>
        )}
      </div>
      <div className="pb-actions">
        <button type="button" className="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={!canEdit || busy || !headline.trim() || (needsSource && !source.trim())}>
          Keep it
        </button>
      </div>
    </form>
  );
}

export function Pieces({ cur }: { cur: Cur }) {
  const canEdit = useApp((s) => s.canEdit);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [writing, setWriting] = useState(false);
  const counts = useMemo(() => Object.fromEntries(ITEM_KINDS.map((k) => [k.id, cur.items.filter((i) => i.kind === k.id).length])), [cur.items]);
  const list = cur.items.filter((i) => (!kind || i.kind === kind) && (!q || `${i.headline} ${i.source} ${i.section} ${i.credit}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="pb-store">
      <div className="pb-store-tools">
        <div className="pb-search is-small">
          <Icon name="search" size={14} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a piece" aria-label="Find a piece" />
        </div>
        <div className="pb-chips" role="radiogroup" aria-label="Kind">
          <button type="button" role="radio" aria-checked={!kind} className={`pb-chip${!kind ? ' is-on' : ''}`} onClick={() => setKind('')}>
            All <em>{cur.items.length}</em>
          </button>
          {ITEM_KINDS.filter((k) => counts[k.id]).map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} className={`pb-chip${kind === k.id ? ' is-on' : ''}`} onClick={() => setKind(k.id)}>
              {k.name} <em>{counts[k.id]}</em>
            </button>
          ))}
        </div>
        <span className="sv-grow" />
        <button type="button" className="button primary small" disabled={!canEdit} onClick={() => setWriting(true)}>
          <Icon name="pencil" size={13} /> Write a piece
        </button>
      </div>
      {!cur.items.length ? (
        <EmptyState size="panel" icon="notes" title="No pieces yet" line="Write a story, a brief or a weather table, or make a puzzle. Each is kept once and can run in any edition." action={{ label: 'Write a piece', run: () => setWriting(true) }} />
      ) : (
        <div className="pb-table-wrap">
          <table className="pb-table">
            <thead>
              <tr>
                <th>Piece</th>
                <th>Section</th>
                <th>Source</th>
                <th>Ran in</th>
                <th className="n">Date</th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.path} onClick={() => peek({ type: 'note', path: i.path }, { title: i.headline, type: 'note' })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && peek({ type: 'note', path: i.path }, { title: i.headline, type: 'note' })}>
                  <td>
                    <span className="pb-cell-piece">
                      {i.image ? <img className="pb-thumb" src={fileUrl(i.image)} alt="" loading="lazy" /> : <span className="pb-piece-icon" aria-hidden="true"><Icon name={KIND_ICON[i.kind] ?? 'notes'} size={13} /></span>}
                      <span>
                        <strong>{i.headline}</strong>
                        <em>
                          {i.kindName}
                          {i.puzzle ? ` · ${i.puzzle}` : i.words > 20 ? ` · ${i.words} words` : ''}
                          {i.solves ? ` · ${i.solves} solve ${i.solves === 1 ? 'time' : 'times'}` : ''}
                        </em>
                        {i.problems.length > 0 && <span className="pb-piece-flag">{i.problems[0]}</span>}
                      </span>
                    </span>
                  </td>
                  <td>{i.section || null}</td>
                  <td>{i.source || i.credit || null}</td>
                  <td>{i.editions.length ? i.editions.slice(0, 3).join(', ') + (i.editions.length > 3 ? ` +${i.editions.length - 3}` : '') : <span className="pb-faint">Not yet</span>}</td>
                  <td className="n">{i.date ? shortDate(i.date) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <p className="pb-faint pb-pad">No piece matches.</p>}
        </div>
      )}
      {writing && (
        <div className="overlay pb-overlay" onMouseDown={() => setWriting(false)}>
          <div className="dialog pb-dialog is-wide" role="dialog" aria-label="Write a piece" onMouseDown={(e) => e.stopPropagation()}>
            <PieceForm cur={cur} {...(kind ? { kind } : {})} onCancel={() => setWriting(false)} onDone={() => setWriting(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
