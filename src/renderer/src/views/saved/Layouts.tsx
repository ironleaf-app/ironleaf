// The layout a view is drawn in, picked in one place (21 Oct 2026) so a saved view's tab and a note type's page draw the
// same nine (table, cards, list, board, calendar, gallery, timeline, chart, map) the same way.

import type { PropValue } from '../../../../shared/frontmatter';
import { columnLabel, type KnownProp, type ViewDef, type ViewRow } from '../../../../shared/views';
import { BoardLayout } from './Board';
import { CalendarLayout } from './Calendar';
import { CardsLayout } from './Cards';
import { ChartLayout } from './Chart';
import type { WriteProp } from './common';
import { GalleryLayout } from './Gallery';
import { ListLayout } from './List';
import { MapLayout } from './Map';
import { TableLayout } from './Table';
import { TimelineLayout } from './Timeline';

export interface LayoutProps {
  def: ViewDef;
  rows: ViewRow[];
  known: Map<string, KnownProp>;
  props: KnownProp[];
  canEdit: boolean;
  change(patch: Partial<ViewDef>): void;
  write: WriteProp;
  newNote(values: Record<string, PropValue>): void;
}

export function ViewLayoutBody({ def, rows, known, props, canEdit, change, write, newNote }: LayoutProps) {
  const label = (key: string) => columnLabel(def, key);
  switch (def.layout) {
    case 'table':
      return <TableLayout def={def} rows={rows} known={known} props={props} canEdit={canEdit} change={change} write={write} />;
    case 'cards':
      return <CardsLayout def={def} rows={rows} known={known} canEdit={canEdit} label={label} />;
    case 'list':
      return <ListLayout def={def} rows={rows} known={known} canEdit={canEdit} label={label} />;
    case 'board':
      return <BoardLayout def={def} rows={rows} known={known} canEdit={canEdit} change={change} write={write} newNote={newNote} />;
    case 'calendar':
      return <CalendarLayout def={def} rows={rows} known={known} canEdit={canEdit} write={write} newNote={newNote} />;
    case 'gallery':
      return <GalleryLayout def={def} rows={rows} known={known} canEdit={canEdit} label={label} />;
    case 'timeline':
      return <TimelineLayout def={def} rows={rows} known={known} canEdit={canEdit} write={write} />;
    case 'chart':
      return <ChartLayout def={def} rows={rows} />;
    case 'map':
      return <MapLayout def={def} rows={rows} known={known} canEdit={canEdit} label={label} />;
  }
}
