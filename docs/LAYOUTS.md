# Project layouts: the contract (21 Oct 2026)

One page shape cannot serve every kind of work (work, fitness, notes, personal, business). Every project today is the same page (Summary, What's next, Key dates, People, Risks, Decisions,
Updates, Documents, Notes). A project now picks a **layout** that shows its information the way that kind of work is read.

Rules: files stay plain Markdown that reads well in any editor; nothing is hidden in code blocks; one front-matter key picks
the layout; everything the dashboard shows comes from front matter, Markdown tables, tick-box lines, and **log notes**.
A project with no `layout:` keeps today's page exactly. Clean room (no Obsidian/Capacities/Notion code or visuals).

## Front matter (project file, `type: project` stays)

`layout:` one of `programme`, `site`, `register`, `fitness`, `wellbeing`, `venture`.

Common keys kept as today: status, health (`on track` | `at risk` | `off track` | `done`), progress (0-100), owner, due,
started, updated, tags, folder, neuralspark-project.

Layout keys:
- programme: `sponsor`, `budget` (text, e.g. "A$1.2m capex"), `phase`.
- site: `go_live` (YYYY-MM-DD; event/opening/close date), `site_kind` (`opening` | `close` | `event` | `pop-up`), `address`, `phase`.
- register: `register_of` (what one row is, e.g. "spare device").
- fitness: `goal` (one line), `start` / `end` (dates), `start_weight`, `target_weight` (numbers, kg), `sessions_per_week` (number).
- wellbeing: `streak_start` (date), `streak_label` (e.g. "Alcohol-free"), `milestones` (list of day counts, e.g. [7, 14, 30, 90]).
- venture: `stage` (`idea` | `building` | `launched` | `growing`), `site` (URL).

## Sections the layouts read (Markdown, H2 headings, exact names)

- `## Workstreams` (programme): table `| Workstream | Owner | Status | Progress | Next step |` (Progress = number 0-100 or %).
- `## Key dates` (all): table `| Date | Milestone | Status |` (Status = done | next | at risk | late | blank).
- `## Run sheet` (site): H3 phases (e.g. `### Eight weeks out`, `### Build week`, `### Go-live day`, `### After`), each with tick-box lines.
- `## Suppliers and contacts` (site, venture): table `| Name | Role | Company | Contact |`.
- `## Register` (register): any Markdown table; first column is the item name; a `Status` or `Qty` column gets counts.
- `## Plan` (fitness, wellbeing): free text plus an optional table `| Day | Session |` or `| When | What |`.
- `## Pipeline` / `## Campaigns` (venture): table `| Item | Stage | Owner | Due | Notes |`.
- Kept everywhere: `## Summary`, `## What's next` (tick boxes "- [ ] … — Owner · by YYYY-MM-DD"), `## Risks and issues`
  (table `| Risk | Impact | Owner | Status |` or bullets), `## Decisions`, `## Updates`, `## Documents`, `## Notes`.

## Log notes (the data behind fitness, wellbeing, and any tracker)

A log note has front matter `type: log`, `project: <project title>`, optional `fields:` list naming the numeric fields to
chart (e.g. `fields: [Weight, Waist]`) and `units:` map (e.g. `{Weight: kg, Waist: cm}`).
Entries: one H2 per day, heading starts with a date Ironleaf can read (`## Sun 18 Oct 2026` or `## 2026-10-18`, extra words
after a comma allowed: `## Sun 18 Oct 2026, Day 1`). Under it, bullets `- Field: value`. Numbers are read from the value
(`- Weight: 104.2 kg`, `- Urges: 3/10`, `- Toe pain: 2`), Y/N fields as yes/no (`- Alcohol-free: Y`), anything else is text.
Free bullets without `Field:` are notes. Newest entries may be at the top or bottom (sort by date).

## What each layout shows (above the existing sections; sections still render below as today)

- programme: status band (health colour, progress ring, due countdown, phase, sponsor/budget), workstream table as cards
  with progress bars, milestone timeline from Key dates, open risks count, next 5 actions.
- site: big countdown to go_live ("47 days to opening"), phase strip, run-sheet progress per phase (done/total), contacts cards.
- register: the register table as a sortable, filterable grid with totals (count, by Status, sum of Qty).
- fitness: goal line, weight trend chart (start → now → target) from the log with `Weight`, sessions this week vs
  sessions_per_week, last session card, current block week ("Week 1 of 8"), plan table.
- wellbeing: streak ring (days since streak_start, next milestone), last 14 days grid from the check-in log (Y/N field
  coloured), small trend lines for numeric fields (urges, pain, sleep, water), milestones list.
- venture: stage strip, pipeline board (columns by Stage), campaign calendar from Due dates, site link.

Charts and rings are drawn locally (SVG), calm, existing tokens, light + dark, readable at the app's narrowest width.

## Blocks: what the layouts are made of (21 Oct 2026)

Every dashboard is made of generic **blocks** that adapt to whatever a project holds; the six layouts above are presets
of blocks, nothing is tied to one kind of content. A project can list its own blocks, which then win over its layout:

```yaml
blocks: [status, countdown:go_live, board:Pipeline, trend:Weight, streak, entry, cards]
```

Each item is a block name, optionally `:` and what it reads (a date key, a section, a log field). Without an argument a
block finds what it reads itself.

| Block | Reads | Shows |
| --- | --- | --- |
| `status` | health, progress, due, owner, any other simple property (sponsor, budget, phase, address, a URL…) | progress ring, health, due countdown, the properties as facts; `stage`/`phase` on a path (a `stages:`/`phases:` list, the run sheet's phases, or idea → building → launched → growing); a `goal:`/`objective:`/`aim:` line |
| `countdown[:key]` | a date key (default: go_live, end, due…) | "47 days to opening" (`site_kind` names the day), the date and address; with `start`/`started`: "Week 3 of 8" |
| `progress[:Section]` | a table with a Progress column (cards with bars), H3 phases with tick boxes (phase strip, tick them on the page), or What's next | done of total, per row or phase |
| `timeline[:Section]` | Key dates, or any table with a Date/Due/When column | a track with today marked, and the dates listed, the next one highlighted |
| `board[:Section]` | any table with a Stage (or Status) column | a column per stage (finished stages last), cards with owner and due (overdue marked) |
| `grid[:Section]` | any table | sortable, filterable grid; counts by Status, sums of Qty/Count/Cost/Value-like columns; `register_of:` names a row |
| `trend[:Field]` | numeric fields in the project's log notes (`fields:` if given) | a chart per field; `start_<field>` and `target_<field>` keys add the start and a target line, `start`/`end` a planned path; several fields: small lines side by side |
| `streak[:Field]` | a Y/N field in the logs (the one named like `streak_label`, else the first); `streak_start`; `milestones`; any `<things>_per_week` key | Day N or the run in a row, the next milestone, the last 14 days, best run, "3 of 4 sessions this week" |
| `entry` | the project's log notes | the latest entry, and **Add entry**: a form built from the log's own fields (Y/N as a choice, numbers with their unit), written in the contract's format; the first entry starts a log (`<Project> log.md` beside the project file) with the fields named |
| `cards[:Section]` | a Name/Role/Company/Contact table (default Suppliers and contacts), else People | contact cards (email and phone as links) |
| `actions` | What's next | the first five open steps, ticked off on the page |

Presets: programme = status, progress:Workstreams, timeline:Key dates, actions · site ("Site or event") = countdown,
progress:Run sheet, timeline:Key dates, cards:Suppliers and contacts · register = grid:Register · fitness (shown as
**Tracker**; `layout: fitness` and `layout: tracker` both work) = status, countdown:end, trend, streak, entry, grid:Plan ·
wellbeing (shown as **Habit**; `layout: wellbeing` and `layout: habit`) = streak, trend, entry, grid:Plan · venture =
status, board:Pipeline, timeline:Campaigns, cards:Suppliers and contacts. In a preset, an optional block with nothing to
show (a plan table, contacts, a streak without Y/N fields, actions) steps aside; blocks listed in `blocks:` always show,
each saying what to add when empty, with a one-click add that writes contract-correct Markdown. On the folio page the
actions block, a timeline read from Key dates and a progress checklist read from What's next step aside even so
(13 Nov 2026: the same list never draws twice — Your next and Key dates below are the one place for those lists).

The page also: redraws the moment a project, table or log changes (a soft mark on the block that changed); offers a
**Layout** choice in the page's facts (writes `layout:` only, with Undo); and on a project without a layout may show one
quiet suggestion worked out from its structure (a go-live key, phases of tick boxes, a table with a Progress or Stage
column, a long table with Status or Qty, logs with Y/N days or numbers), never from its topic, put away per project.

One-liners on the Projects home and Today ("47 days to opening", "Day 4 alcohol-free", "95% · at risk", "Week 3 of 8 ·
104.2 kg") come from the first block with something to say.

Pure helpers (src/shared/layouts.ts) for the assistant and other tools: `LAYOUTS`, `layoutOf`, `blocksOf`, `parseBlocks`,
`blockModel`, `dashboard`, `layoutLine`, `suggestLayout`, `parseLog`, `logsFor`, `logFields`, `appendLogEntry`,
`newLogNote`, `readTable`, `addTableRow`, `runSheet`, `toggleRunSheetItem`, `addRunSheetPhase`, `addRunSheetItem`,
`SECTION_TABLES`. Project edits (src/shared/project-file.ts): `{ kind: 'set', field: 'layout', value }`,
`{ kind: 'prop', key, value }` (any property of the person's own), `{ kind: 'section', heading, body }` (a section set or
added). Templates/Projects has a ready-made project for each preset (Programme, Site or event, Register, Tracker, Habit,
Venture).

Notes on the contract as built: the Key dates table keeps the header the person wrote (`| Date | Milestone | Status |`)
when the page writes the file back (it used to write `| When | What | Status |`); a risks table stays a table (open risks
are counted from it and from bullets); "Day N" counts the start day as day 1, matching log headings such as
`## Sun 18 Oct 2026, Day 1`.

Proved on a real person's reorganised projects (21 Oct 2026; fixes in the generic code, tests on neutral notes):
- A risks table (`| Risk | Impact | Owner | Status |`) is the project's risks: shown in Risks and issues, counted on Today,
  closed ("Closed 21 Oct 2026" in its Status) and reopened on the page, and written back as the same table, every other
  cell as written. Links in Documents stay links, a blank key-date status stays blank in the person's own table, and the
  person's own sections (Workstreams, Run sheet…) stay where they were when the page writes the file.
- Logs: a yes or no with words after it (`- Done: Y (first try)`) is a yes or no; a bullet naming a day (`- Fri 23 Oct:
  away`) is a note, not a field; a field answered yes or no stays yes/no on a "not confirmed" day. The fields a log's own
  format shows before its first entry (`` `- Water:` (glasses) ``) are its fields; Add entry asks those (else the ones it
  charts and keeps), and with several logs it asks which one, each in its own fields. The latest entry shows the log's
  fields and short answers as tiles (a number with its unit, the words written with it beneath) and sentences as lines.
- A workstream table where not every row has a Progress figure shows how many are done, never the average of the few.
- A tracker before its start counts down to the start ("Starts in 3 days"); a session written "none yet" isn't one; the
  measure the project gives a start or target for comes first in Trends and its one line.
- A register with a quantity column (Qty, Count, On hand…) counts the things, not the rows ("60 spare devices · 3 in
  repair"; chips and totals by quantity); `register_of` may go on after a comma ("spare units, grouped by status").
- A preset's section names are where it looks first: a venture with its stages in Campaigns (no Pipeline) gets its board
  from Campaigns; an empty timeline or board steps aside in a preset. A finished project (status done) is never overdue.
- One lines: "at risk · <phase>" for a programme without a progress figure, "0 days sugar-free · best 3" after a run
  ends, "Cravings 2/10" for a score, "29 days since closing".

## Editing in place (22 Oct 2026)

On the dashboards nothing used to be editable in place. Every value a block shows now changes where it is, and each change is one edit of the file that
keeps every other character (one table cell, one tick-box line, one property, one log field or note), shown at once and
then redrawn from the file as written, with Undo in its message (project edits also Ctrl+Z on the page).

| Block | What changes in place, and how |
| --- | --- |
| status | Health and status from their menus; progress from the ring (a slider, quick values, clear); the due date from the calendar; the owner (with suggestions); the goal line; each detail (words typed, dates from the calendar, a link by its pencil; emptied, the property goes); the stage or phase by clicking a step on its path; "+ Detail" adds a property of the person's own. The open next steps and risks counts go to their cards. |
| countdown | Its day (or the start while it's ahead) from the calendar; the address; for a go-live, what the day is (opening, close, event, pop-up); the period's start and end. |
| progress (a table) | Each card's name, owner, status (the column's own words first, then the usual ones, or "Something else…"), progress (the bar is a slider: drag, arrows in fives, Home/End, or type the figure; written as that row writes it, `60` or `60%`), next step. Its ⋯: Edit… (every column in one form), Move up/down (or Alt+↑/↓), Mark done (the column's own done word and 100), Delete. |
| progress (a run sheet) / actions / What's next | Tick boxes: the words (a click), who and by when ("+ Who", "+ By when"; a run sheet's "— 9 Sep" stays without "by"), ticked, deleted, dragged into order by the grip (or Alt+↑/↓); a phase renamed by double-clicking its tab (or F2); "Add a step to <phase>…". |
| timeline | Each row's date (calendar; written as the table writes days, ISO or "30 Nov 2026"), words and status (menu); deleted from the row. The block's ⋯ puts the key dates (or the section's rows) in date order in the file when they aren't. |
| board | Cards dragged between stage columns (writes the Stage cell; a column emptied by a move stays as a drop target while the page is open, and the columns keep their places), or Alt+←/→, or ⋯ › Move to; title, notes, owner and due in place; ⋯ Edit… and Delete; "+ Add" at the foot of each column. |
| grid | A spreadsheet: a click picks a cell; a double-click, Enter, F2 or just typing opens it; Enter saves and goes down (Shift+Enter up), Tab right (Shift+Tab left), Esc leaves it, arrows move, Delete empties; a status cell offers its column's words; "+ Add a <noun>" opens a new row of fields under the others; each row's bin deletes it. A grid of Key dates or People (not a section's own table) stays read-only. |
| cards | Name, role, company and how to reach them in place (an email or phone stays a link, with a pencil); ⋯ Edit… and Delete. |
| entry | The latest entry, and with ‹ › the ones before it: a tile's value (yes/no from its choices, a number or words typed), a line, a note — each written on that day's line of the log that keeps it. |
| streak | Any of the last 14 days set yes, no or not logged (the log's day made when it isn't written yet); the streak's start from the calendar; the week's target. |
| trend | The latest figure (that entry of its log) and the target (`target_<field>`). |

Risks and issues (the page's card, from a risks table): Owner and Status edited in place too; a Status chosen as Closed
closes the risk ("Closed 22 Oct 2026"), Reopen says Open.

Calm affordances: nothing at rest; over a card or row its values underline softly, over a value the page's wash and a
small pencil that takes no room; statuses show a faint chevron; empty parts offer "+ …" over their row; a card's ⋯ comes
up over it. Every value is a tab stop (Enter edits), focus rings in the accent.

Pure helpers (src/shared/layouts.ts): `tableRowLines`, `setTableCell`, `setTableCells`, `removeTableRow`,
`moveTableRow`, `orderTableRows`, `dayInStyle`, `itemParts`, `withItemParts`, `setRunSheetItem`, `removeRunSheetItem`,
`moveRunSheetItem`, `renameRunSheetPhase`, `setLogValue`, `setLogNote`. Blocks carry the row (or key-date index) each
card and line came from and the columns that hold each part. Project edits (src/shared/project-file.ts): risks take
`owner` and `status`; `{ kind: 'order', list, order }`; `{ kind: 'section', heading, body, words }` says the change in
its own words; a number of the person's own is written as a number; a section a caller replaces with a new object keeps
its place in the file.

## Click goes there; editing is deliberate (24 Oct 2026, WS1 part B; opened as itself 12 Nov 2026, t239)

A click should go to the connected information, not start an edit (23 Oct). Every value above still
changes where it is, but a single click no longer starts it. Since 12 Nov one click opens the referenced document itself in the main view, at the top with its title, never in a
side panel (state/peek.ts openReference; the side peek panel stands for nothing now):

- One click on an action, workstream, key date, decision, risk or person (on the dashboard, the page's own cards, Today's
  lines and the Tasks view) opens its document: a note, meeting, person or project as itself; an item where it is
  written. Back returns to where the person was, scrolled where they were; Ctrl or Cmd opens it in a new tab. A file
  in a project's folder opens in the full viewer as a tab (views/FolderFileView.tsx), whatever kind it is.
- Editing: a double-click on the value, its small pencil (over the value, taking no room), or E or F2 with it focused.
  Space or Enter opens the document. An empty value's "+ Owner", "+ Status" still adds with one click; a status pill, the
  progress ring and a card's ⋯ are menus as before.
- The records and their links come from src/shared/records.ts (the connected vault: every project item a record with a
  stable id, read from the Markdown above with no format changes); a note's foot lists what is **Connected** the same way.


## The project hub and its timeline (23 Oct 2026)

A project overview has to read at a glance, and the timeline with it. A
project opens on **Overview** (src/shared/project-hub.ts, views/project/ProjectHub.tsx); **Timeline** is its plan
(src/shared/project-plan.ts, views/project/PlanTimeline.tsx); **Details** is the page above (dashboard, sections, files).
Everything is worked out from the file as written; three things are new in the file, all plain Markdown:

- `stage:` in the front matter, the project's lifecycle: `idea`, `planning`, `active`, `closing` or `done` (when `stage:`
  already holds another kind of stage, a venture's `building`, the lifecycle is written as `lifecycle:`). Without it the
  stage follows `status` (on hold is still Active). Moving the stage sets `status` to `idea`, `planning` or `done`, and to
  `active` for Active and Closing unless the project is on hold.
- `## Stage checklist`, one `### <Stage>` per stage, each with tick boxes. Until the person changes it the hub shows a
  short default list; the first tick writes all five stages. It is never read as a layout's run sheet.
- `after: <words>` in a step's or tick box's tail (`— Ana · by 2026-11-20 · after: Approve the quote`) or `(after: …)` in a
  key date's words: what it comes after, drawn on the timeline (red and dashed when planned before it).

Overview: Needs attention (overdue actions; quotes, validity and deadlines ending in the last fortnight or next three
weeks; missed milestones; the project's due date passed; waiting on someone a week or more, from "Requested 13 Oct",
"asked on 14 Oct"; high risks; the next three days; nothing heard in the updates for a fortnight from someone with open
items; actions with no owner), My actions (nobody named is the owner's; "Unassigned", "TBC" have no owner), Waiting on
others by person with **Chase** (the side chat drafts a message; nothing is sent), Next milestones on a small line,
Latest files by purpose, Recent activity (what changed between the project file's earlier versions and who changed it,
its updates, notes and files changed), People with their parts and open items, Decisions. Every row opens its item as
itself (t239), else where it lives. At Done (and Closing) **Write the close-out report** makes `<Project> close-out
report.md` beside it from the project's data.

Timeline: one line per milestone and dated action, grouped by the Workstreams table's rows (a line goes to the workstream
whose distinctive words it shares), else the run sheet's phases; key dates no workstream names group at the top; Week,
Month and Quarter; a mark drags to another day (arrow keys a day, Shift a week) and only its date changes, written as it
was ("by Mon 26 Oct (see …)" → "by Wed 28 Oct (see …)"), with Undo.

Written back, a next step keeps every word after its dash in the person's order ("— Jesse · Fri 23 Oct, 11:00",
"— Ana · suggest by Friday, when Jay is back"), a Documents line naming notes by their links stays as written, a known
section keeps the heading the person gave it ("## Files"), and unchanged tags keep their line.
