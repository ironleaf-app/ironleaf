// Publications as a module made of the vault's shared blocks (Wave 6 part a, 24 Oct 2026; module 7 of the catalogue,
// "Family"): its three record types are note types (src/shared/module-records.ts MODULES, so they show in the types'
// pages and the peek, and take the Family-private level whether the module is on or off), kept in the Publications area.
// Its pages, the edition builder and the puzzle engine are its own (src/renderer/src/views/modules/
// PublicationsPage.tsx); what the records hold and how they are read is src/shared/publications.ts. Pure.

import type { RecordModule } from './module-records';
import { DEFAULT_SECTIONS, EDITION_STATUSES, ITEM_KINDS, sectionsTable, TEMPLATES } from './publications';

/** A new publication's starting sections: the one source is DEFAULT_SECTIONS (9.5: the scaffold named only Front while
 *  every new publication got four, so the two disagreed from the first note). */
export const PUBLICATION_SECTIONS_TEMPLATE = `## Sections\n\n${sectionsTable(DEFAULT_SECTIONS)}\n`;
export const PUBLICATION_MODULE = { template: PUBLICATION_SECTIONS_TEMPLATE };

export const PUBLICATIONS: RecordModule = {
  id: 'publications',
  name: 'Publications',
  icon: 'newspaper',
  about: 'Newsletters and papers you make for the household: editions laid out on real pages, every piece kept with its source, puzzles with their answers, printed and sent on a schedule.',
  holds: 'Publications, editions, their pieces and puzzles',
  level: 'family',
  area: 'publications',
  // The area's own folder (each publication has a folder of its own inside it).
  folder: '',
  locked: '',
  types: [
    {
      id: 'publication',
      name: 'Publication',
      plural: 'Publications',
      icon: 'book',
      color: 'plum',
      hint: 'A newsletter or paper: its masthead, schedule, sections with their sources and rules, and how it is delivered',
      fields: [
        { key: 'masthead', kind: 'text' },
        { key: 'motto', kind: 'text' },
        { key: 'schedule', kind: 'text' },
        { key: 'template', kind: 'choice', options: TEMPLATES.map((t) => t.name), initial: 'Broadsheet' },
        { key: 'printer', kind: 'text' },
        { key: 'print', kind: 'choice', options: ['No', 'Yes'], initial: 'No' },
        { key: 'telegram', kind: 'choice', options: ['No', 'Yes'], initial: 'No' },
        { key: 'email', kind: 'text' },
      ],
      template: PUBLICATION_SECTIONS_TEMPLATE,
      sub: '',
      aliases: ['publications', 'newsletter', 'newspaper'],
      empty: { title: 'No publications yet.', line: 'Start a newsletter or family paper from the Publications page.' },
      columns: ['masthead', 'schedule', 'template'],
    },
    {
      id: 'edition',
      name: 'Edition',
      plural: 'Editions',
      icon: 'doc',
      color: 'stone',
      hint: 'One edition of a publication: its number, date, status, PDF and the pieces in each section',
      fields: [
        { key: 'publication', kind: 'link', linkType: 'publication' },
        { key: 'number', kind: 'number' },
        { key: 'date', kind: 'date' },
        { key: 'status', kind: 'choice', options: [...EDITION_STATUSES], initial: 'Draft' },
        { key: 'template', kind: 'choice', options: TEMPLATES.map((t) => t.name) },
        { key: 'pdf', kind: 'link' },
        { key: 'pages', kind: 'number' },
      ],
      template: '',
      sub: '',
      aliases: ['editions', 'issue', 'issues'],
      empty: { title: 'No editions yet.', line: 'Start an edition from the Publications page.' },
      columns: ['publication', 'number', 'date', 'status', 'pages'],
      dateProp: 'date',
    },
    {
      id: 'publication-item',
      name: 'Publication piece',
      plural: 'Publication pieces',
      icon: 'notes',
      color: 'clay',
      hint: 'One piece of a publication (a story, brief, weather, table, picture, cartoon, puzzle, quote) with its source',
      fields: [
        { key: 'kind', kind: 'choice', options: ITEM_KINDS.map((k) => k.name), initial: 'Headline story' },
        { key: 'publication', kind: 'link', linkType: 'publication' },
        { key: 'section', kind: 'text' },
        { key: 'source', kind: 'text' },
        { key: 'source_url', kind: 'url' },
        { key: 'credit', kind: 'text' },
        { key: 'date', kind: 'date' },
      ],
      template: '',
      sub: '',
      aliases: ['publication item', 'publication items', 'publication pieces', 'piece', 'pieces'],
      empty: { title: 'No pieces yet.', line: 'Add a story, a puzzle or a picture from the Publications page.' },
      columns: ['kind', 'section', 'source', 'date'],
      dateProp: 'date',
    },
  ],
  sections: [
    { id: 'editions', label: 'Editions', icon: 'newspaper', line: 'Every edition, newest first, with its pages, status and delivery; search across all of them.' },
    { id: 'studio', label: 'Edition builder', icon: 'layers', line: 'Pick the pieces, set each section’s pages, see the pages fill and what runs over, then build the PDF.' },
    { id: 'items', label: 'Pieces', icon: 'notes', line: 'Every story, picture, table and puzzle, each with its source and the editions it ran in.' },
    { id: 'puzzles', label: 'Puzzles', icon: 'grid', line: 'Make a crossword, sudoku, word search or daily word; record the household’s solve times.' },
    { id: 'settings', label: 'Settings', icon: 'settings', line: 'The masthead, schedule, sections with their sources and rules, house style and delivery.' },
  ],
  tools: ['publication_list', 'publication_search', 'publication_setup', 'publication_edition', 'publication_edition_build', 'publication_item_add', 'puzzle_generate', 'puzzle_solve_time', 'publication_edition_deliver'],
};

/** Words that say a note is about a publication (its offer on Today). A puzzle by any of its kinds, a numbered
 *  issue, the paper itself — but "a paper cut" is first aid and "an issue with the till" is a fault, never the paper. */
export const PUBLICATION_SIGNALS: RegExp = /\b(newsletter|newspaper|masthead|edition (?:no\.?|number)|puzzles?|daily word|crosswords?|sudokus?|word search(?:es)?|issues?\s+\d+|papers?(?!\s+cuts?\b))\b/i;
