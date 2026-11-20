// "Import CSV…" (21 Oct 2026; src/shared/csv.ts): a spreadsheet becomes notes — each row a note in a folder the person
// names, one column naming it and the others its properties — and the table view over that folder opens straight away,
// so the rows can be looked at, sorted and changed as notes. Rows naming notes already there update them or keep both
// (the person's choice, asked once); the folder's view is reused, never a "… 2" beside it. From the command list,
// the Views section's +, and a view's ⋯.

import { columnKindWords, csvHeadings, hasHeadings, importedNoteText, importedViewColumns, parseCsv, planImport } from '../../../shared/csv';
import { needsChoice, previewByName, previewWords } from '../../../shared/import-preview';
import { sameText } from '../../../shared/vault-merge';
import { defaultView, VIEWS_FOLDER, writeView } from '../../../shared/views';
import { choose, prompt } from '../components/Dialogs';
import { pick } from '../components/Pickers';
import { fuzzyFilter, narrowWords } from '../lib/fuzzy';
import * as A from './actions';
import { docs } from './docs';
import { getState, loadFiles, showError, toast } from './store';

// Excel serials (9.5 O5, same day rule as src/main/doc-text.ts excelSerialIso): a 5-digit day number in a date-read
// column comes in as its day, so the plan, the preview and the notes agree it holds days.
const SERIAL_DAY = /^\d{5}$/;
const DATE_HEAD = /\b(due|date|deadline|when|scheduled|start|day|created|expir|birth|dob|joined)\b/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;
const SLASH_DAY = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/;
const serialIso = (cell: string): string | null => {
  if (!SERIAL_DAY.test(cell.trim())) return null;
  const n = Number(cell.trim());
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return null;
  const d = new Date(Math.floor(n - 25569) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
// The table with serial days rewritten: a column holding a written day and only days or serials besides, or all
// serials under a date-like heading, reads its serials as days; anything else stays as it was, never guessed.
const withSerialDays = (table: string[][], headed: boolean): string[][] => {
  if (!table.length) return table;
  const width = Math.max(...table.map((r) => r.length));
  const body = headed ? table.slice(1) : table;
  const head = headed ? table[0] : [];
  const isDay = (c: string) => ISO_DAY.test(c) || SLASH_DAY.test(c);
  const rewrite: boolean[] = [];
  for (let i = 0; i < width; i++) {
    const cells = body.map((r) => (r[i] ?? '').trim()).filter(Boolean);
    if (!cells.length) {
      rewrite[i] = false;
      continue;
    }
    const mixed = cells.some(isDay) && cells.every((c) => isDay(c) || serialIso(c) !== null);
    const headedSerial = cells.every((c) => serialIso(c) !== null) && DATE_HEAD.test(head[i] ?? '');
    rewrite[i] = mixed || headedSerial;
  }
  if (!rewrite.some(Boolean)) return table;
  return table.map((row, ri) => {
    if (headed && ri === 0) return row;
    return row.map((cell, i) => (rewrite[i] ? (serialIso(cell.trim()) ?? cell) : cell));
  });
};

export async function importCsv(opts: { picked?: { name: string; text: string }; onDone?: (made: string[], where: string, source: string) => void } = {}): Promise<void> {
  const madeSoFar: string[] = [];
  let whereSoFar = '';
  let sourceSoFar = '';
  try {
    if (!getState().canEdit) return;
    const picked = opts.picked ?? (await window.nv.imports.pickCsv());
    if (!picked) return;
    const table = parseCsv(picked.text);
    if (table.length < 2) throw new Error('That file has no rows under its headings, so there is nothing to make notes from.');
    const dated = withSerialDays(table, hasHeadings(table));
    const headings = csvHeadings(dated);
    const sample = (i: number) => dated.slice(1).map((r) => (r[i] ?? '').trim()).find(Boolean) ?? '';

    // Which column names the notes: the first, unless the person picks another.
    let nameColumn = headings[0];
    if (headings.length > 1) {
      const chosen = await pick({
        placeholder: 'Which column names each note? (Enter for the first)',
        items: (q) =>
          fuzzyFilter(headings, q.trim(), (h) => h, 60).map((h) => {
            const s = sample(headings.indexOf(h));
            return { id: h, label: h, detail: s ? `For example “${s.slice(0, 60)}”` : 'Empty in the first rows', icon: 'text' as const };
          }),
        footer: [narrowWords(headings.length, 60, 'columns'), '↑↓ to move · Enter to choose · Esc to cancel'].filter(Boolean).join(' '),
      });
      if (chosen === null || chosen === undefined) return;
      nameColumn = chosen;
    }

    const plan = planImport(dated, nameColumn);
    if (!plan.notes.length) throw new Error(`No row has anything in “${nameColumn}”, so no note could be named. Choose another column.`);
    const kinds = columnKindWords(plan.columns);
    const folder = await prompt('Import CSV', {
      value: picked.name,
      ok: `Make ${plan.notes.length} ${plan.notes.length === 1 ? 'note' : 'notes'}`,
      placeholder: 'A folder, such as Clients',
      message: `Each row becomes a note named by “${nameColumn}”, with ${plan.columns.length === 1 ? 'the other column' : `the other ${plan.columns.length} columns`} as its properties${kinds ? ` (${kinds})` : ''}, in this folder (made if it isn’t there). Rows naming notes already there update them (ones already the same are left), or keep both. You see how many are new, to update and already here before you choose. A table of them opens when it’s done.`,
    });
    if (!folder?.trim()) return;
    const where = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

    // Rows naming notes already there (9.2 uplift F10): update them, or keep both, asked once, never "… 2" by surprise.
    // Compared before asking (10.0 item 16): the person sees how many are new, to update and already here.
    const there = new Map(getState().notes.filter((n) => A.folderOf(n.path) === where).map((n) => [n.title.toLowerCase(), n.path]));
    const collide = plan.notes.filter((n) => there.has(n.name.toLowerCase()));
    let update = false;
    // Notes already here with the same words: left in both choices, never duplicated.
    let sameSet = new Set<string>();
    if (collide.length) {
      const existing = new Map<string, string | null>();
      for (const n of collide) existing.set(n.name.toLowerCase(), await window.nv.notes.read(there.get(n.name.toLowerCase())!).catch(() => null));
      const full = previewByName(existing, plan.notes.map((n) => ({ name: n.name, text: importedNoteText(n) })));
      for (const n of collide) {
        const t = existing.get(n.name.toLowerCase());
        if (t !== null && t !== undefined && sameText(t, importedNoteText(n))) sameSet.add(n.name.toLowerCase());
      }
      if (needsChoice(full)) {
        const id = await choose(
          collide.length === 1 ? `“${collide[0].name}” is already in ${where}` : `${collide.length} rows name notes already in ${where}`,
          [
            { id: 'update', label: collide.length === 1 ? 'Update it' : 'Update them', primary: true },
            { id: 'both', label: 'Keep both' },
          ],
          `${previewWords(full)}. Updating replaces their properties with the rows. Keeping both makes new notes with numbers in their names. Notes already here are left as they are in both choices.`,
        );
        if (!id) return;
        update = id === 'update';
      }
    }
    // What a failure or a stop takes back (F6): set before anything is written, not after.
    whereSoFar = where;
    sourceSoFar = picked.name;
    // A large import shows its share and stops on the word Stop (F2); a second import of the same rows adds only
    // what is new (F4: rows already here, the same, are left, never rewritten or doubled).
    const signal = { stopped: false };
    const showShare = (done: number, total: number) => {
      if (total >= 20) toast(`Making notes… ${done} of ${total}.`, { label: 'Stop', run: () => { signal.stopped = true; } }, 600000);
    };
    const made: string[] = [];
    let updated = 0;
    let identical = 0;
    let done = 0;
    if (update) {
      const ups = plan.notes.filter((n) => there.has(n.name.toLowerCase()));
      for (const n of ups) {
        if (signal.stopped) break;
        showShare(done++, plan.notes.length);
        const at = there.get(n.name.toLowerCase())!;
        const mine = await window.nv.notes.read(at).catch(() => null);
        if (mine !== null && sameText(mine, importedNoteText(n))) {
          identical++;
          continue;
        }
        // The open tab's words land first (Nov 2026, nv-save F12), so the rows never strand them.
        await docs.flush(at);
        await window.nv.notes.write(at, importedNoteText(n));
        updated++;
        made.push(at);
        madeSoFar.push(at);
      }
    } else {
      identical = sameSet.size;
    }
    // Already here notes are left in both choices, never rewritten or doubled.
    const fresh = plan.notes.filter((n) => !(update && there.has(n.name.toLowerCase())) && !sameSet.has(n.name.toLowerCase()));
    // Fresh rows in batches of a hundred: the share between them, stopping finishes the batch and keeps it.
    for (let i = 0; i < fresh.length && !signal.stopped; i += 100) {
      showShare(done, plan.notes.length);
      const batch = fresh.slice(i, i + 100);
      const batchMade = await window.nv.imports.csvNotes(where, batch.map((n) => ({ name: n.name, content: importedNoteText(n) })));
      made.push(...batchMade);
      madeSoFar.push(...batchMade);
      done += batch.length;
    }
    // The folder's view, reused (never a "… 2" beside it): the exact one, else the first numbered one already there.
    const base = where.split('/').pop() || picked.name;
    const views = getState().files.map((f) => f.rel).filter((r) => r.startsWith(`${VIEWS_FOLDER}/`) && r.endsWith('.view.json'));
    const reuse = views.find((r) => r === `${VIEWS_FOLDER}/${base}.view.json`) ?? views.filter((r) => new RegExp(`^${VIEWS_FOLDER}/${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+\\.view\\.json$`).test(r)).sort()[0];
    const view = reuse ?? (await window.nv.files.create(VIEWS_FOLDER, base, '.view.json', writeView({ ...defaultView({ kind: 'folder', value: where }), columns: importedViewColumns(plan) })));
    await loadFiles();
    A.openPath(view, { where: 'tab' });
    // Renamed counted against the fresh rows only (W5-20): made is updates first, then fresh, never plan order.
    const freshMade = made.slice(updated);
    const renamed = freshMade.filter((p, i) => p.split('/').pop() !== `${fresh[i]?.name}.md`).length;
    const leftOut = plan.skipped ? `${plan.skipped} ${plan.skipped === 1 ? 'row had' : 'rows had'} no name and ${plan.skipped === 1 ? 'was' : 'were'} left out.` : '';
    if (!made.length && !signal.stopped) {
      // Nothing written (every row already here, the same): no undo record.
      toast(
        [`${identical} ${identical === 1 ? 'note is' : 'notes are'} already here, the same. Nothing was made.`, leftOut].filter(Boolean).join(' '),
        undefined,
        8000,
      );
      return;
    }
    toast(
      [`${signal.stopped ? 'Stopped. ' : ''}${updated ? `Updated ${updated}, made ${made.length - updated}` : `Made ${made.length}`} ${made.length === 1 ? 'note' : 'notes'} in ${where}.`, identical ? `${identical} ${identical === 1 ? 'was' : 'were'} already the same.` : '', renamed ? `${renamed} had a name already taken, so ${renamed === 1 ? 'it ends' : 'they end'} in a number.` : '', leftOut].filter(Boolean).join(' '),
      undefined,
      8000,
    );
    if (made.length) opts.onDone?.(made, where, picked.name);
  } catch (err) {
    // Notes already made are recorded even when a later step failed (W5-20).
    if (madeSoFar.length && whereSoFar) opts.onDone?.(madeSoFar, whereSoFar, sourceSoFar);
    showError(err);
  }
}
