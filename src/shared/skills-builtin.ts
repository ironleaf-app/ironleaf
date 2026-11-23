// SPDX-License-Identifier: AGPL-3.0-or-later
// The skills built into Ironleaf (24 Nov 2026, phase 3; src/shared/skills.ts has the shape and how they load). Written
// for Ironleaf, in its own words, from what its tools really do: the Office files, PDFs, designed documents, meetings,
// project reports, keeping notes in order, and writing a skill of the person's own. Tool names are the catalogue's
// (src/shared/vault-tools.ts); each AI reads them in its own names (wordsFor). Tools only Ironleaf's own chat has are
// said as such, so an outside AI knows to use what it has instead.

import type { Skill } from './skills';

type BuiltIn = Omit<Skill, 'source' | 'files' | 'path'> & { texts?: Record<string, string> };

const WORD = `# Word documents

Use this for any job with a Word document: making a new one, changing one in a project's folder, or reading one.

## Making a new Word document
1. Decide what it is for and who reads it. Write the whole text first, in Markdown: a title line (#), headings (##, ###)
   in a clear order, short paragraphs, lists where things are a list, and a table (| pipes |) where things compare.
2. Make the file with office_make (kind docx), kept with the project or note it belongs to. It is a real Word document:
   real heading styles (so Word's navigation pane and a table of contents work), real lists and tables, in the brand kit's
   fonts and colour when there is one.
3. When the person wants it designed (a report with a cover, a proposal, a one-pager), make or find the note with the
   words, then design_document with format docx instead. That takes a minute or two; office_make is immediate.
4. Hand it over with its link as the tool gives it, and say in a line what is in it.

## Writing it well
- Lead with the point: a first paragraph a busy reader could stop after.
- Headings say what the section tells ("Costs rise 12% in March"), not just its topic ("Costs").
- One idea per paragraph, at most five or six lines. Plain words; Australian English.
- Numbers: units, dates written out ("3 March 2027"), the source of any figure. Never make a figure up.
- Tables for comparisons and figures; keep them to what fits a page's width (five or six columns at most).
- A page break is a line with only \`---\`. Tick-box lines (\`- [ ]\`) become ☐ in Word.

## Changing a Word document in a project's folder
- In Ironleaf's own chat: read it with file_read, then change words with edit_project_file (formatting is kept). A file
  you didn't make in this chat is never changed in place: the changes go into a new copy beside it.
- Bigger rewrites: write the new text and make a new document with office_make, naming it as the next version
  ("… v2.docx"); the original stays as it was.

## Reading one
- file_read gives its words (headings, lists, tables). Quote what it says with the file's link; never guess at a part
  that didn't come through.
`;

const EXCEL = `# Excel workbooks

Use this for any job with a spreadsheet: making a new workbook, reading one, or changing one in a project's folder.

## Making a new workbook
1. Work out the sheets first: one sheet per kind of thing (Budget, Transactions, Assumptions), the first row of each the
   headings.
2. Use real formulas for anything worked out, never a number you added up yourself: \`=SUM(C2:C20)\`, \`=B2*C2\`,
   \`=IF(D2>0,"Over","OK")\`. Put inputs (rates, prices, dates) in their own cells and point formulas at them, so the
   person can change one number and see everything follow.
3. Dates as dates (YYYY-MM-DD), numbers as numbers (no "$" or "," inside the value), percentages as decimals with a
   heading that says % (0.12 under "Growth %").
4. Make it with office_make (kind xlsx), kept with the project or note it is for. Headings come bold and frozen with a
   filter, columns sized to fit.
5. Check before you hand it over: every total's range covers every row; no formula points at an empty or wrong cell;
   no #REF!, #DIV/0! or #VALUE! can come from the formulas you wrote (guard a division with IF).
6. Say in a line what is on each sheet and which cells the person changes.

## Reading a workbook
- In Ironleaf's own chat, read_spreadsheet gives the whole workbook in short in one call: every sheet, its headings,
  which columns hold entries, its first rows. One look is enough; ask for a range only for something unusual.
- Elsewhere, file_read gives its sheets as text.
- Answer with the figures as they are in the cells, the sheet and cell they came from, and the file's link.

## Changing a workbook in a project's folder (Ironleaf's own chat)
- edit_project_file sets cells, clears ranges, or resets a filled-in sheet; formulas, formatting, merged cells and lists
  to pick from are kept. A file you didn't make in this chat is never changed in place: the change goes into a copy.
- "Keep it as a template", "a blank copy": make_template in one step, as the chat's instructions say.

## Good spreadsheet habits
- One table per sheet, starting at A1, no blank rows inside it.
- No merged cells inside data; totals in a row below the data or a column to its right, labelled "Total".
- Name sheets plainly (at most 31 characters).
`;

const POWERPOINT = `# PowerPoint decks and slides

Use this when the person wants slides, a deck or a presentation.

## Which way to make it
- A designed deck from a note (the plan, a report, minutes): design_document with kind slides. It saves as a PDF; give
  format pptx when they want PowerPoint. It is laid out, printed and checked page by page, in the brand kit, and takes a
  minute or two. This is the best-looking result: prefer it when there is a note to start from.
- A quick deck from an outline you write (a talk, a training session, a draft to work on in PowerPoint): office_make with
  kind pptx and the slides. It is made at once, in a calm theme in the brand kit's colour and fonts, every slide's text
  editable, with speaker notes.

## Writing the slides
1. Start from the one thing the audience should leave with; the deck argues it.
2. Every slide's title is its takeaway, as a short sentence ("Sales recovered in Q3"), not a topic ("Q3").
3. Three to five short bullets a slide, at most about eight words each; the detail goes in the speaker notes.
4. Shape: a title slide, an agenda only when it runs past eight slides, section slides between parts, one slide per
   idea, and a last slide with the ask or the next steps.
5. Numbers: one figure per slide that matters, said plainly with its source. Never make a figure up.
6. Layouts in office_make: title, section, bullets, two-column (a comparison: before and after, options), quote (a
   customer's or a decision's words).

## Hand it over
Give the file with its link as the tool gives it, its slide count, and one line on how it runs.
`;

const PDF = `# PDFs

Use this for any job with a PDF: making one from a note, a designed PDF, or reading what one says.

## Making a PDF
- The note as it is, in the brand kit ("make this a PDF", "the minutes as a PDF"): note_to_pdf with the note. It is the
  same document Export to PDF prints, kept in the note's Files as a new version.
- A designed document (a report with a cover, a one-pager, a proposal, a handout, a poster, slides): design_document
  with the note, the kind and the brief in the person's words (who it is for, what to lead with). It takes a minute or
  two; say so before you start.
- No note yet: write one with the words first (note_create, in the right place), then make the PDF from it.
- Only when the person asks for a PDF; a meeting or a note never needs one by default.

## Reading a PDF
- file_read gives a PDF's words (scanned pages are read too, when reading words in pictures is on in Settings).
- Answer with what it says (figures, dates, names) and the file's link; say which page when it matters.
- A form to fill in, a signature or changes inside a PDF can't be made here: say so in one line and offer the nearest
  thing (the answers as a note, or a Word document with office_make).
`;

const DESIGN = `# Designed documents

Use this when the person wants something that looks designed: a report, a one-pager, a proposal, a handout, a poster or
slides, from a note, in their brand.

## How
1. Find the note with the words (or write it first). The design uses every word of the note: what isn't in the note
   won't be on the page, so get the note right before designing.
2. Call design_document with the note, the kind, and a brief in their words: who it is for, what to lead with, the tone.
   A good brief: "For the board. Lead with the funding ask and the three risks. Confident, not salesy."
3. Say it takes a minute or two. It is laid out by the AI, printed, looked at page by page and fixed.
4. Format: pdf by default; pptx for slides in PowerPoint, docx for Word, xlsx for the note's tables and figures.
5. Hand it over with its link and page count. To change it, they open Design with AI on the note and say the change in
   words ("make the cover darker", "put the costs table first").

## Which kind
- report: a designed cover, then every word, with headings, figures and tables.
- one-pager: the essentials on one page: the point, three to five facts, the ask.
- proposal: the problem, the offer, the price and terms, the next step.
- handout: two pages to give out at a meeting or a class.
- poster: one big message, a few facts, where and when.
- slides: a 16:9 deck, one idea per slide.

## What makes it good (tell the brief, when it helps)
- One clear point per page; the biggest type for the most important thing.
- A few colours from the brand kit, used for meaning (one accent for what matters), never decoration.
- Generous, even spacing; aligned edges; no boxes inside boxes; no stripes down the side of cards.
- Real figures with their source; never invented numbers or stock phrases.
- Without a brand kit it comes out plain and neutral; a brand kit (Settings, or brand_kit_set) puts their logo, colours
  and fonts on everything.
`;

const MINUTES = `# Meeting minutes

Use this when the person wants a meeting written up, minutes taken, or actions and decisions pulled out of a meeting.

## Where things go in Ironleaf
- A meeting is one note of type meeting (in its project's or area's Meetings folder), named with the date and what it
  was, as Ironleaf names meetings. Find it first (meetings_list, vault_search) and bring it up to date rather than making
  a second.
- What it decided and asked for lives in the meeting's own note, linked both ways to its project: never copied into
  other notes, never a companion note ("Actions", "Summary").
- Its actions are the project's tasks already: don't copy them anywhere else.

## Writing the minutes
1. Who was there (each person linked as [[Name]] when they have a note), the date, and the project.
2. Summary: three to five lines on what the meeting was for and where it landed.
3. Decisions: each one line, with why when it was said ("Go with Rhino Ovens: cheaper install, same warranty").
4. Actions: tick-box lines with who and when, as said: \`- [ ] Send the revised quote — @Sam — Friday\`. An action
   nobody took stays without an owner; never guess one. A date never said stays out.
5. Open questions: what was asked and not answered.
6. Notes from the discussion only when they matter later; skip the back-and-forth.

## From a recording
- A recorded meeting's transcript calls voices You, Speaker 1, Speaker 2…; their names are on the meeting's page when
  the person set them. Never guess who a numbered voice is.
- Quote decisions and figures as they were said; leave out filler, side talk and anything said off the record.

## After
- A follow-up that would change another document ("this changes the lighting plan") becomes a task on the project
  ("Update the lighting plan: …") linked to that document, not an edit to it.
- A PDF of the minutes only when asked (note_to_pdf).
`;

const STATUS = `# Project status reports

Use this when the person wants a status report, an update for someone, or "where is this project at".

## Gather
1. project_get for the project: its summary, status, health, next steps, risks, decisions, dates, people and documents.
2. What changed lately: in Ironleaf's own chat, project_changes gives the files in its folder changed since it was last
   updated; read the ones that matter (newest and most telling first). Meetings since the last report: meetings_list.
3. What's due or late: today_get and timeline_get.

## Write it (one page; the reader is busy)
- Status in one word with health: On track, At risk or Off track, and one line on why. Be honest: if a date has slipped
  or a risk is live, say so. Never paint a project green.
- Since last time: three to five things done, each with where it came from (a meeting, a document's link).
- Next: the next steps with who and by when.
- Risks and issues: each with how much it matters and what is being done about it.
- Decisions needed: what you need from the reader, plainly, with a date.
- Key dates: the next milestones, and any that moved (from → to).

## Keep the project right
- Bring the project itself up to date as you go (project_log_update for the update, project_set_field for status and
  health), so the project page and the report say the same thing. A judgement call is proposed, not written straight in.
- Save the report where the person asks: a note in the project, a PDF (note_to_pdf), a designed one-pager
  (design_document), or a Word document (office_make). Default: a note in the project.
`;

const ORGANISE = `# Organising notes

Use this when the person wants their notes set up, organised, tidied or filed.

## Look first
- vault_overview and notes_list show how the notes are kept now: their areas (Work, Home, Family, Health, Me…: the
  folders at the top), folders, note types, properties, tags and naming. Follow what is there; don't impose a new system.

## Principles
- One note per thing: a project, a person, a meeting, a decision, a how-to. Find the note before making another.
- Every note belongs to an area; things for a project live in or link to the project.
- Notes of a type (person, meeting, resource, idea) go in that type's folder with type: and its fields as properties.
- Link generously with [[Title]]: people to their meetings, meetings to their projects, decisions to where they were made.
- How something is set up or done is a doc: one per subject, kept up to date in place.
- Quick thoughts go in the Inbox or today's note; filing them is a weekly job, not a reason to stop.

## Doing a big tidy
1. Say what you will change before changing much: the folders, what moves where, what merges.
2. Move and rename with note_move (links keep working), one group at a time.
3. Never delete to tidy: duplicates merge (keep every line), empty notes go to the Bin only when the person agrees.
4. The weekly tidy (tidy_list, tidy_apply) already finds duplicates, broken links, empty notes and notes in the wrong
   place: use its lines first.
5. End with what moved, what merged and what needs their call.
`;

const SKILL_MAKER = `# Making a skill

Use this when the person wants to teach the assistant a way of doing something ("always do my minutes like this",
"make that a skill", "remember how I write status reports") or wants to write or improve a skill.

## What a skill is
A folder in their notes holding <name>/SKILL.md: two lines of front matter and the instructions below. Ironleaf's assistant, and
every AI connected to Ironleaf, sees each skill's name and description, and reads its instructions when a job matches.

\`\`\`
---
name: board-report
description: Monthly board report for the bakery. Use when asked for the board report, a board update or the monthly numbers for the board.
---

# Board report
1. …
\`\`\`

## Writing one well
1. Name: a few words, lower case, joined with hyphens (board-report, client-onboarding).
2. Description: the most important line, because it decides when the skill is used. Say what it does **and** when to use
   it, with the words the person would really say. Under about 300 characters.
3. Instructions: numbered steps for the job as the person does it, what good looks like, and what to avoid. Concrete
   beats general: their headings, their order, their tone, where the result is saved, who it goes to.
4. An example of a finished result, short, when the shape matters.
5. Keep it short (under about 500 lines). Long reference material goes in other files in the skill's folder (for
   example reference.md or template.md), named in the instructions so they are read only when needed.
6. Never put passwords, keys or private details in a skill.

## Saving it
- skill_save with the name, description and instructions writes Library/Skills/<name>/SKILL.md (or Skills/<name>/ when
  the notes aren't kept by area). Saving again with the same name brings it up to date.
- A skill with a built-in skill's name is used in its place: that is how they make a built-in their own.
- Skills can be switched on and off in Settings › AI › Skills.
- After saving, say in one line when it will be used.
`;

/** The skills built into Ironleaf, by name. */
export const BUILT_IN_SKILLS: readonly BuiltIn[] = [
  {
    name: 'word-documents',
    title: 'Word documents',
    about: 'Makes, changes and reads Word documents: reports, letters, procedures.',
    description: 'Make, change or read Word documents (.docx): reports, letters, procedures, any written document as a Word file. Use when the person asks for a Word document or a .docx, or to change or read one.',
    body: WORD,
  },
  {
    name: 'excel-workbooks',
    title: 'Excel workbooks',
    about: 'Makes, reads and changes spreadsheets, with working formulas.',
    description: 'Make, read or change Excel workbooks (.xlsx): budgets, trackers, lists, models with working formulas. Use when the person asks for a spreadsheet, an Excel file or a workbook, or for figures from one.',
    body: EXCEL,
  },
  {
    name: 'powerpoint-decks',
    title: 'PowerPoint decks',
    about: 'Makes slides: designed from a note, or quickly from an outline.',
    description: 'Make slides, decks and presentations, designed from a note or quickly from an outline, as PowerPoint (.pptx) or PDF. Use when the person asks for slides, a deck, a presentation or a PowerPoint.',
    body: POWERPOINT,
  },
  {
    name: 'pdfs',
    title: 'PDFs',
    about: 'Makes PDFs from your notes, plain or designed, and reads what a PDF says.',
    description: 'Make a PDF from a note (plain or designed) and read what a PDF says. Use when the person asks for a PDF, or asks about a PDF in their notes or a project’s folder.',
    body: PDF,
  },
  {
    name: 'designed-documents',
    title: 'Designed documents',
    about: 'Turns a note into a report, one-pager, proposal, handout, poster or slides in your brand.',
    description: 'Turn a note into a designed document in the brand kit: a report with a cover, a one-pager, a proposal, a handout, a poster or slides. Use when the person wants something to look designed or professional.',
    body: DESIGN,
  },
  {
    name: 'meeting-minutes',
    title: 'Meeting minutes',
    about: 'Writes minutes with decisions, actions, owners and dates, from notes or a recording.',
    description: 'Write meeting minutes the Ironleaf way: attendees, summary, decisions, actions with owners and dates, open questions, from notes or a recording. Use for minutes, a meeting write-up, or actions and decisions from a meeting.',
    body: MINUTES,
  },
  {
    name: 'project-status-report',
    title: 'Project status reports',
    about: 'Writes an honest status report from the project, its files and its meetings.',
    description: 'Write an honest project status report from the project, its recent files and meetings: health, what was done, what is next, risks, decisions needed. Use when asked for a status report, a project update or where a project is at.',
    body: STATUS,
  },
  {
    name: 'organise-notes',
    title: 'Organising notes',
    about: 'Sets up and tidies your notes: areas, folders, types, links and duplicates.',
    description: 'Set up, organise or tidy the person’s notes: areas, folders, note types, links, merging duplicates and filing. Use when asked to organise, tidy, file, restructure or set up notes.',
    body: ORGANISE,
  },
  {
    name: 'skill-maker',
    title: 'Making a skill',
    about: 'Writes a skill of your own, so the assistant does a job your way every time.',
    description: 'Write or improve a skill of the person’s own, so the assistant does a job their way every time. Use when they say "make that a skill", "always do X like this", or ask to write or change a skill.',
    body: SKILL_MAKER,
  },
];

/** The built-in skills as skills. */
export function builtInSkills(): Skill[] {
  return BUILT_IN_SKILLS.map((s) => ({ ...s, source: 'built-in' as const, files: Object.keys(s.texts ?? {}) }));
}
