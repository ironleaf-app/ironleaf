// Projects at a glance on Today (21 Oct 2026, docs/LAYOUTS.md): each project with a layout, by its layout's one line
// ("47 days to opening", "Day 4 alcohol-free", "95% · at risk"), read live from the project files and their logs.

import { useEffect, useState } from 'react';
import type { ProjectCard } from '../../../../shared/types';
import * as A from '../../state/actions';
import { useApp } from '../../state/store';
import { isFinished } from '../../../../shared/finished';

/** The projects with a one line, most pressing first; null while reading, [] when none has a layout. */
export function useGlance(): ProjectCard[] | null {
  const revision = useApp((s) => s.revision);
  const [cards, setCards] = useState<ProjectCard[] | null>(null);
  useEffect(() => {
    let live = true;
    window.nv.projects.list().then(
      (all) => live && setCards(all.filter((c) => c.line && !isFinished(c.status)).sort((a, b) => ({ bad: 0, warn: 1, ok: 2, none: 3 })[a.line!.tone] - ({ bad: 0, warn: 1, ok: 2, none: 3 })[b.line!.tone] || a.name.localeCompare(b.name))),
      () => live && setCards([]),
    );
    return () => {
      live = false;
    };
  }, [revision]);
  return cards;
}

export function Glance({ cards }: { cards: ProjectCard[] }) {
  // The first five, and the rest a click away (the count beside the title is all of them).
  const [all, setAll] = useState(false);
  return (
    <div className="ly-glance">
      <ul>
        {(all ? cards : cards.slice(0, 5)).map((c) => (
          <li key={c.path}>
            <button onClick={(e) => A.openPath(c.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} title={`Open ${c.name}: ${c.line!.words}`}>
              <span className="ly-glance-name">{c.name}</span>
              <span className={`ly-glance-line tone-${c.line!.tone}`}>{c.line!.words}</span>
            </button>
          </li>
        ))}
      </ul>
      {cards.length > 5 && (
        <button className="td-more ly-glance-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${cards.length}`}
        </button>
      )}
    </div>
  );
}
