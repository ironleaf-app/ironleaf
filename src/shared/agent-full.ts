// Full control for AI agents (18 Oct 2026: an agent that is "my hands and the vault is the surface to create"; "a global
// setting not just for me"). The level an AI app on this PC reaches at Settings › Connect an AI › Read and write: every
// tool of the levels below, nothing waiting for Allow / Deny, and the tools that let an agent do what the person can do
// by hand: notes and folders, every part of a project, templates, canvases, assets and the brand kit, meetings into next
// steps, the weekly review, the daily note and properties. Private notes, Settings, the licence and keys stay out of
// reach at every level. The main side is src/main/agent-full.ts.
//
// Also here: a few read tools every level gets (a canvas read, a project's folder listed), so an agent at Read can see
// what a Full control agent makes.

import type { AgentToolDef } from './agent-access';

const S = (description: string) => ({ type: 'string', description });
const N = (description: string) => ({ type: 'number', description });
const B = (description: string) => ({ type: 'boolean', description });
const PROJECT = S('The project’s name as projects_list gives it (or its path).');
const CANVAS = S('The canvas’s path in the library, ending in .canvas (a project’s own canvas is Projects/<Name>/<Name>.canvas).');
const CARD = {
  type: 'object',
  description:
    'A card: type text (Markdown in text), note (a note or file in the library: its path in file), link (a web address in url) or group (a frame with a label). Optional: x, y, width, height (pixels; left out, it is placed in free space), color ("1" red … "6" purple, or "#rrggbb"), ref (a name of your own to link to it in the same call).',
  properties: {
    type: { type: 'string', enum: ['text', 'note', 'link', 'group'] },
    text: { type: 'string' },
    file: { type: 'string' },
    url: { type: 'string' },
    label: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
    color: { type: 'string' },
    ref: { type: 'string' },
  },
  required: ['type'],
  additionalProperties: false,
};
const LINK = {
  type: 'object',
  description: 'A line between two cards: from and to are card ids (from canvas_get) or refs given to new cards in this call; label and color optional.',
  properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, color: { type: 'string' } },
  required: ['from', 'to'],
  additionalProperties: false,
};

/** Read tools added for every level (they change nothing). */
export const READ_EXTRA_TOOLS: AgentToolDef[] = [
  {
    name: 'canvas_get',
    title: 'Read a canvas',
    level: 'read',
    readOnly: true,
    description: 'Read a canvas (a board of cards and lines): every card with its id, type, words or file, place and size, and every line between cards. Cards drawn from a project (its next steps, dates, risks…) are marked “from the project”: change those with the project tools.',
    input: { canvas: CANVAS },
    required: ['canvas'],
  },
  {
    name: 'project_files_list',
    title: 'List a project’s folder',
    level: 'read',
    readOnly: true,
    description: 'The files and folders in a project’s folder, on this PC: names, sizes and when each changed. Give a folder inside it to look deeper. Read one with file_read.',
    input: { project: PROJECT, folder: S('A folder inside the project’s folder (optional).') },
    required: ['project'],
  },
];

/** The tools only Full control has. */
export const FULL_TOOLS: AgentToolDef[] = [
  // ── Notes and folders ──
  {
    name: 'note_write',
    title: 'Rewrite a note',
    level: 'full',
    description: 'Replace the whole text of a note (made when it isn’t there). Read it first and keep what should stay. Use the project tools for a project’s file. File recovery keeps the version before. On a bill note, paid and due stay as they are: a payment is recorded with Mark paid (finance_bill_mark_paid), and the day it falls is changed with finance_bill_add.',
    input: { path: S('The note’s path, ending in .md.'), content: S('The note’s whole new text, in Markdown.') },
    required: ['path', 'content'],
  },
  {
    name: 'note_move',
    title: 'Move or rename',
    level: 'full',
    description: 'Move or rename a note, a file or a folder in the library. Links to it are brought up to date. to is the new path (for a rename, the same folder with the new name).',
    input: { from: S('Its path now.'), to: S('Its new path.') },
    required: ['from', 'to'],
  },
  {
    name: 'folder_create',
    title: 'Make a folder',
    level: 'full',
    description: 'Make a folder in the library (and the folders above it as needed).',
    input: { path: S('The folder’s path, e.g. "Clients/Harbour Lane".') },
    required: ['path'],
  },
  {
    name: 'folder_delete',
    title: 'Delete a folder',
    level: 'full',
    deletes: true,
    description: 'Delete a folder and everything in it (to the Bin; File recovery keeps copies of its notes). Never the top of the library. A project’s folder holds its project file: delete a project only when asked to.',
    input: { path: S('The folder’s path.') },
    required: ['path'],
  },
  {
    name: 'note_set_properties',
    title: 'Set properties and tags',
    level: 'full',
    description: 'Set a note’s properties (the YAML at its top): tags, status, dates, people, anything. Give them as an object; null removes one. Tags given are added to the note’s own (its other tags stay); remove_tags takes some away; replace_tags: true makes its tags exactly those given. A project’s properties change with project_set_details and project_set_field. On a bill note, paid and due are kept by Money’s own tools: setting paid records the payment with Mark paid (its due day moves and the payment is recorded); paid cannot be cleared here, and the day a bill falls is changed with finance_bill_add.',
    input: {
      path: S('The note’s path or title.'),
      properties: { type: 'object', description: 'The properties to set: {"tags": ["clients"], "status": "draft", "old": null}.', additionalProperties: true },
      remove_tags: { type: 'array', items: { type: 'string' }, description: 'Tags to take off the note.' },
      replace_tags: B('true only to make the note’s tags exactly the tags given.'),
    },
    required: ['path'],
  },
  {
    name: 'daily_note',
    title: 'Today’s note',
    level: 'full',
    description: 'Today’s daily note: made from the daily template when it isn’t there yet, then read. Give text to add to it (under a heading when given).',
    input: { text: S('Text to add (optional).'), heading: S('Add it under this heading (optional).') },
  },
  // ── Projects ──
  {
    name: 'project_set_details',
    title: 'Change more of a project',
    level: 'full',
    description: 'Change what project_set_field doesn’t: name (renames the project; its file and folder in the library move with it), repository (where its code is kept, such as github.com/owner/name), notes (the project’s own Notes section, as written) or tags (a list, replacing the old ones). An empty value clears it.',
    input: { project: PROJECT, field: { type: 'string', enum: ['name', 'repository', 'notes', 'tags'] }, value: { type: ['string', 'array', 'null'], items: { type: 'string' } } },
    required: ['project', 'field', 'value'],
  },
  {
    name: 'project_move_item',
    title: 'Reorder a project’s list',
    level: 'full',
    description: 'Move one line of a project’s list to another place (numbers from project_get, 1 is the top): for example put the most urgent next step first.',
    input: { project: PROJECT, list: { type: 'string', enum: ['next', 'dates', 'risks', 'decisions', 'people', 'documents', 'updates'] }, from: N('Its number now.'), to: N('Its new number.') },
    required: ['project', 'list', 'from', 'to'],
  },
  {
    name: 'project_archive',
    title: 'Put a project away',
    level: 'full',
    description: 'Put a finished or dropped project away: its status becomes done, so it leaves Today and the active lists (it stays in the library, under Done). done false brings it back as active. With open tasks it answers with them for the person to settle instead of closing.',
    input: { project: PROJECT, done: B('Default true.'), why: S('A line for its Updates, e.g. “Handed over to the client” (optional).') },
    required: ['project'],
  },
  {
    name: 'project_pin_file',
    title: 'Pin a project file',
    level: 'full',
    description: 'Pin a file in the project’s folder to its Documents (or unpin it with pinned false), with what it is.',
    input: { project: PROJECT, path: S('The file’s path inside the project’s folder.'), pinned: B('Default true.'), what: S('What the file is, in a few words.') },
    required: ['project', 'path'],
  },
  // ── Templates ──
  {
    name: 'template_apply',
    title: 'Make a note from a template',
    level: 'full',
    description: 'Make a new note from a note template (its path from templates_list): its dates and title filled in, for a project when given. For a new project from a project template use project_create.',
    input: { template: S('The template’s path.'), name: S('The new note’s name.'), folder: S('The folder it goes in (optional; the top of the library when left out).'), project: S('The project it is for (optional).') },
    required: ['template', 'name'],
  },
  {
    name: 'template_create',
    title: 'Make a template',
    level: 'full',
    description: 'Make a new template in the templates folder: for notes, projects or reports. Give its text (Markdown, with {{title}}, {{date}} and {{time}} where they go), or leave it out for a starter to fill in. Change a template later with note_write or note_replace on its path.',
    input: { group: { type: 'string', enum: ['notes', 'projects', 'reports'] }, name: S('The template’s name.'), content: S('Its text (optional).') },
    required: ['group', 'name'],
  },
  {
    name: 'template_from_note',
    title: 'Save a note as a template',
    level: 'full',
    description: 'Save an existing note (or a project’s file) as a new template, its own words kept as the shape.',
    input: { note: S('The note’s path or title.'), name: S('The template’s name.'), description: S('What it is for (optional).') },
    required: ['note', 'name'],
  },
  // ── Canvases ──
  {
    name: 'canvas_create',
    title: 'Make a canvas',
    level: 'full',
    description: 'Make a new canvas (a board for laying out ideas, plans and files) with cards and lines on it when given. Then canvas_add, canvas_change and canvas_remove.',
    input: { path: S('Where it goes, ending in .canvas, e.g. "Boards/Launch plan.canvas".'), cards: { type: 'array', items: CARD }, links: { type: 'array', items: LINK } },
    required: ['path'],
  },
  {
    name: 'canvas_add',
    title: 'Add to a canvas',
    level: 'full',
    description: 'Add cards and lines to a canvas. Cards left without a place go in free space. Returns each new card’s id.',
    input: { canvas: CANVAS, cards: { type: 'array', items: CARD }, links: { type: 'array', items: LINK } },
    required: ['canvas'],
  },
  {
    name: 'canvas_change',
    title: 'Change cards on a canvas',
    level: 'full',
    description: 'Change or move cards (by their ids from canvas_get): words, place, size, colour, label, file or address. Only the parts given change. Cards drawn from a project can be moved and resized; change their words with the project tools.',
    input: {
      canvas: CANVAS,
      changes: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, file: { type: 'string' }, url: { type: 'string' }, label: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, color: { type: 'string' } }, required: ['id'], additionalProperties: false },
      },
    },
    required: ['canvas', 'changes'],
  },
  {
    name: 'canvas_remove',
    title: 'Remove from a canvas',
    level: 'full',
    deletes: true,
    description: 'Remove cards or lines from a canvas by their ids (a card’s lines go with it). The notes and files cards show stay where they are.',
    input: { canvas: CANVAS, ids: { type: 'array', items: { type: 'string' } } },
    required: ['canvas', 'ids'],
  },
  // ── Assets and the brand kit ──
  {
    name: 'asset_add',
    title: 'Add to the assets',
    level: 'full',
    description: 'Copy a file into the asset store: from a full path on this PC (e.g. a picture you made) or from a web address (https). Kind, tags, a collection and a description help find it later. The same file already there is used instead of a copy.',
    input: {
      from: S('A full path on this PC, or an https:// address.'),
      name: S('Its file name in the store, e.g. "Harbour Lane logo.png" (optional).'),
      kind: { type: 'string', enum: ['logo', 'image', 'icon', 'document', 'media', 'other'] },
      tags: { type: 'array', items: { type: 'string' } },
      collection: S('A collection to put it in (optional).'),
      description: S('What it is (optional).'),
    },
    required: ['from'],
  },
  {
    name: 'asset_update',
    title: 'Describe an asset',
    level: 'full',
    description: 'Change what the asset store says about a file (its path from assets_search): kind, tags, collections, description, alt text (for people who can’t see it), and its role in the brand kit (primary, onDark or icon logo).',
    input: {
      asset: S('The asset’s path.'),
      kind: { type: 'string', enum: ['logo', 'image', 'icon', 'document', 'media', 'other'] },
      tags: { type: 'array', items: { type: 'string' } },
      collections: { type: 'array', items: { type: 'string' } },
      description: S('What it is.'),
      alt: S('Alt text.'),
      role: { type: ['string', 'null'], enum: ['primary', 'onDark', 'icon', null] },
    },
    required: ['asset'],
  },
  {
    name: 'brand_kit_set',
    title: 'Change the brand kit',
    level: 'full',
    description: 'Change the brand kit: the business’s name, its colours ([{hex, name}]), its fonts ([{name, use}]), and its logos by role ({primary, onDark, icon}: asset paths). Only the parts given change; a list given replaces that list.',
    input: {
      name: S('The business’s name as it is written.'),
      colours: { type: 'array', items: { type: 'object', properties: { hex: { type: 'string' }, name: { type: 'string' } }, required: ['hex'], additionalProperties: true } },
      fonts: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, use: { type: 'string' } }, required: ['name'], additionalProperties: true } },
      logos: { type: 'object', properties: { primary: { type: 'string' }, onDark: { type: 'string' }, icon: { type: 'string' } }, additionalProperties: false },
    },
  },
  // ── Meetings and the weekly review ──
  {
    name: 'review_draft',
    title: 'Draft the weekly review',
    level: 'full',
    readOnly: true,
    description: 'Draft this week’s review across every project, as the Weekly review page does: what moved, what is stuck, what is coming, and the changes it suggests. Returns the draft as JSON: change it if needed and give it to review_apply.',
    input: {},
  },
  {
    name: 'review_apply',
    title: 'Save the weekly review',
    level: 'full',
    description: 'Save a weekly review from a draft (review_draft’s, changed or not): its note in Reviews/ and the changes it lists made to the projects.',
    input: { draft: { type: 'object', description: 'The draft from review_draft.', additionalProperties: true } },
    required: ['draft'],
  },
];
