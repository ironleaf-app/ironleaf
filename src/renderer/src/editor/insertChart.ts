// /chart (8.0 Phase 5, the one chart kit): choose the notes (a folder), and a chart block is put in, already set to what
// those notes hold (a property with a handful of values, a number to add up, or the table in each note such as a month of
// spending), drawn at once and live as the notes change. Its settings stay plain words in the block, to change any time.

import type { EditorView } from '@codemirror/view';
import { suggestChart, writeChartBlock, type ChartBlock, type ChartNote } from '../../../shared/chart-kit';
import { pick } from '../components/Pickers';
import { fuzzyFilter } from '../lib/fuzzy';
import { docs } from '../state/docs';
import { getState, toast } from '../state/store';
import { insertBlock } from './commands';

export async function insertChart(view: EditorView): Promise<void> {
  const { folders, notes } = getState();
  const withNotes = folders.filter((f) => notes.some((n) => n.path.startsWith(`${f}/`)));
  const id = await pick({
    placeholder: 'Chart the notes in which folder?',
    items: (q) => fuzzyFilter(withNotes, q, (f) => f).map((f) => ({ id: `folder:${f}`, label: f, detail: `${notes.filter((n) => n.path.startsWith(`${f}/`)).length} notes` })),
  });
  if (id === null) return;
  const folder = id.slice('folder:'.length);
  const inside = notes.filter((n) => n.path.startsWith(`${folder}/`)).slice(0, 200);
  const read: ChartNote[] = await Promise.all(inside.slice(0, 40).map(async (n) => ({ ...n, text: docs.text(n.path) ?? (await window.nv.notes.read(n.path).catch(() => '')) })));
  // Nothing invented (9.2 uplift F85): no suggestion falls back to the first property the notes really share, and
  // with no shared property the person is told and nothing goes in, never a chart by a made-up "status".
  const chart: ChartBlock | null = suggestChart(read.length < inside.length ? [...read, ...inside.slice(40)] : read, { folder }) ?? fallbackChart(read, folder);
  if (!chart) {
    toast(`No countable property in “${folder}” yet. Add one the notes share, then chart again.`);
    return;
  }
  const block = writeChartBlock(chart);
  insertBlock(view, block, block.length, view.state.selection.main.from !== view.state.selection.main.to);
}

/** The first property (besides type) that at least two notes hold: a real fallback, or nothing to chart by. */
function fallbackChart(notes: readonly ChartNote[], folder: string): ChartBlock | null {
  const seen = new Map<string, number>();
  for (const n of notes) {
    for (const key of Object.keys(n.props ?? {})) {
      if (key.toLowerCase() === 'type') continue;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const shared = [...seen].find(([, count]) => count > 1)?.[0];
  if (!shared) return null;
  const name = folder.split('/').pop() ?? folder;
  return { title: `${name} by ${shared}`, type: 'bar', source: { folder }, by: shared };
}
