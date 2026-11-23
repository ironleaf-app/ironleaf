// What the Vault can do (8.8, 31 Oct 2026: rival notes apps "have a much higher feature list than us"): every
// ability in one searchable page, grouped, each in one plain line with "Open" going to the real place or doing the
// first step (3 Nov 2026, audit f F22: tours are "Show me around"; opening is "Open"). Built from the one registry
// (src/shared/abilities.ts); the website's features page reads the same source (docs/abilities.json). Reached from
// More, the palette, Settings › General's About and Home.

import { useMemo, useState } from 'react';
import { ABILITIES, ABILITY_GROUPS, searchAbilities, type Ability } from '../../../shared/abilities';
import { moduleOn } from '../../../shared/life-modules';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import { runAbility } from '../state/abilities';
import { useModules } from '../state/modules';

function AbilityRow({ ability, packOn }: { ability: Ability; packOn?: boolean }) {
  return (
    <div className="trow ab-row">
      <span className="ab-open">
        <span className="t clip">{ability.title}</span>
        <span className="meta clip">{ability.words}</span>
      </span>
      {packOn !== undefined && <span className="tag slate">{packOn ? 'On' : 'Off'}</span>}
      <button className="btn quiet ab-show" style={{ marginLeft: 'auto' }} title={`Open: ${ability.title}`} onClick={() => runAbility(ability.target)}>
        Open
      </button>
    </div>
  );
}

export function AbilitiesPage() {
  const [query, setQuery] = useState('');
  const switches = useModules();
  const found = useMemo(() => searchAbilities(query), [query]);
  const groups = useMemo(() => ABILITY_GROUPS.map((g) => ({ ...g, items: found.filter((a) => a.group === g.id) })).filter((g) => g.items.length > 0), [found]);
  return (
    <div className="nv-page-scroll">
      <div className="ab-page">
        <PageHead
          icon="sparkle"
          title="What Ironleaf can do"
          count={ABILITIES.length}
          lead={query ? `${found.length} ${found.length === 1 ? 'ability matches' : 'abilities match'} “${query}”.` : 'Every ability, grouped. Open goes to the real place.'}
        />
        <label className="searchbox ab-search">
          <Icon name="search" size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the abilities (try spreadsheet, diagram, secret)" aria-label="Search the abilities" />
          {query && <button type="button" className="iconbtn" aria-label="Clear the search" onClick={() => setQuery('')}><Icon name="close" size={12} /></button>}
        </label>
        {!found.length ? (
          <EmptyState icon="search" title="Nothing matches" line={`No ability mentions “${query}”.`} action={{ label: 'Clear the search', run: () => setQuery('') }} />
        ) : (
          groups.map((g) => (
            <section key={g.id} aria-label={g.title} className="ab-group">
              <div className="glabel">{g.title}</div>
              <div className="card ab-card">
                {g.items.map((a) => (
                  <AbilityRow key={a.id} ability={a} packOn={a.target.kind === 'pack' ? moduleOn(switches, a.target.pack) : undefined} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
