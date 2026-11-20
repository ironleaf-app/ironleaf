// Ironleaf's ready-made templates (17 Oct 2026): notes for the work people do (IT programmes, site openings and closures,
// events, monthly reporting; they suit a small business too), project shapes, and the report layouts the former host app
// follows. They are written into the library's Templates folder when they aren't there: never over a note that is there,
// never beside the person's own template of the same name, and once only — a template the person deletes stays deleted
// (the record of what was written is kept in Ironleaf's own data, not among the notes). "Bring them back" on the
// Templates page writes the missing ones again. The person changes them like any note.

import { templateDescription, templateGroup, templateKind, templateUsedFor, projectTemplateCounts, type TemplateInfo } from '../shared/templates';
import { PORTFOLIO_TEMPLATE, PROGRESS_TEMPLATE, REPORTS_FOLDER } from './report-templates';
import { DOC_TEMPLATES } from '../shared/doc-file';

export interface BuiltInTemplate {
  id: string;
  /** Its folder inside Templates: Notes, Projects, Docs or Reports. */
  folder: 'Notes' | 'Projects' | 'Docs' | 'Reports';
  name: string;
  /** Names a person's own template of the same kind may have (theirs is kept; ours isn't added beside it). */
  aliases: string[];
  text: string;
}

const MEETING = `---
description: Who came, what was asked and decided, and who does what by when.
type: meeting
date: {{date}}
project: "[[{{project}}]]"
tags: [meeting]
---
**When:** {{date:dddd D MMMM YYYY}}, {{time}}
**Where:**
**Who came:**
**Apologies:**

## Why we met


## What we talked about
-

## Decisions
-

## Questions
-

## Actions
- [ ] What needs doing — who — by when

## Next meeting

`;

const WEEKLY = `---
description: Where things stand this week — what got done, what’s next, and what’s in the way.
type: status-update
week: "{{date:YYYY [week] w}}"
project: "[[{{project}}]]"
tags: [status]
---
**Week of {{date:D MMMM YYYY}}** · Overall: On track / At risk / Off track (keep one)

## Summary
Two or three sentences someone can read in twenty seconds: where it’s at, what changed, and anything they need to do.

## Done this week
-

## Coming up next week
-

## Blocked or at risk
| What | Why it matters | What’s needed, and from whom |
| --- | --- | --- |
|  |  |  |

## Decisions needed
-

## Numbers
| Measure | Last week | This week |
| --- | --- | --- |
|  |  |  |
`;

const DECISION = `---
description: One decision — what was decided, why, and what else was looked at.
type: decision
date: {{date}}
status: decided
project: "[[{{project}}]]"
tags: [decision]
---
## The decision
In one sentence.

## Why
What made this the right call: the facts, the cost, the timing.

## Options we looked at
| Option | For | Against |
| --- | --- | --- |
| The one we chose |  |  |
|  |  |  |

## Who decided, and who was told
- Decided by:
- Told:

## What changes because of it
-

## Look at it again
On {{date+3m:D MMMM YYYY}}, or sooner if something big changes.
`;

const SITE_VISIT = `---
description: A visit to a site — what you checked, what you found, and what needs fixing.
type: site-visit
date: {{date}}
site:
project: "[[{{project}}]]"
tags: [site-visit]
---
**Site:**
**Visited by:**
**When:** {{date:dddd D MMMM YYYY}}, arrived {{time}}

## Why we went


## Who we met
- Name — role

## Checklist
- [ ] Access: keys, cards and alarm codes work
- [ ] Power and network: outlets, data points, the rack or comms cupboard tidy and labelled
- [ ] Internet and Wi-Fi: speed tested, coverage where people work
- [ ] Devices counted against the list (laptops, printers, phones, screens)
- [ ] Health and safety: exits clear, first aid kit, nothing hazardous left out
- [ ] Signage and anything customers see

## What we found


## To fix
| Issue | How urgent | Who | By when |
| --- | --- | --- | --- |
|  |  |  |  |

## Photos
Paste or drop photos here; they’re saved beside your notes.

## Follow-up
- [ ] Send a summary of the visit to the site contact
`;

const RISK_LOG = `---
description: Every risk in one place — how likely, how bad, and what’s being done about it.
type: risk-log
updated: {{date}}
project: "[[{{project}}]]"
tags: [risks]
---
How to rate: **Likelihood** and **Impact** each Low, Medium or High. Both High is **Critical**: raise it the same day.

## Open risks
| Risk | Likelihood | Impact | Rating | What we’re doing | Owner | Review by |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  | {{date+2w:D MMM}} |

## Issues (risks that have happened)
| Issue | Impact | What we’re doing | Owner | Fixed by |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Closed
| Risk | Closed on | Why |
| --- | --- | --- |
|  |  |  |
`;

const CLOSE_DOWN = `---
description: Everything to finish when a site, office or service closes — before, on the day and after.
type: checklist
site:
closing:
project: "[[{{project}}]]"
tags: [close-down]
---
**Closing:** (the date) · **Site contact:**

## Weeks before
- [ ] Tell staff first, then customers and suppliers: the date, and what changes for them
- [ ] Check every contract — lease, power, internet, phones, cleaning, security — for its end date and notice period
- [ ] Give notice in writing, and keep the confirmations
- [ ] List every device and asset on site, and decide where each goes: another site, storage, sale or recycling
- [ ] Book removalists and an e-waste recycler that gives certificates of destruction
- [ ] Move shared files and back up anything kept only on site

## IT
- [ ] Take devices off the management tools and the asset register as they leave
- [ ] Wipe drives (keep the certificates)
- [ ] Return leased network gear, modems and phones
- [ ] Port or cancel phone numbers; set up a message or forward
- [ ] Turn off building access cards and alarm codes

## On the day
- [ ] Walk through every room and take photos
- [ ] Read the meters: power, gas, water
- [ ] Hand back keys and cards, and get a signed receipt

## After
- [ ] Final bills paid and the bond back
- [ ] Records archived, for as long as they must be kept
- [ ] Address updated where it’s listed: website, maps listings, the ATO, ASIC, the bank
- [ ] A short close-down report to whoever needs it
`;

const BRIEF = `---
description: One page that agrees what a project is before the work starts.
type: brief
status: draft
date: {{date}}
project: "[[{{project}}]]"
tags: [brief]
---
## Background
Why this is happening, and why now.

## Goal
What done looks like, in a way you could check: for example, every laptop on Windows 11 by 30 June, or the new office open on 1 March.

## Scope
**In:**

-

**Out:**

-

## What gets delivered
-

## Timeline
| Milestone | Date |
| --- | --- |
| Start | {{date:D MMM YYYY}} |
|  |  |
| Done | |

## Budget
What it’s expected to cost, and who approves spending.

## People
- **Sponsor:** signs it off
- **Lead:** runs it day to day
- **Team and suppliers:**

## Risks and assumptions
-

## How we’ll report
A weekly status update every Friday, and the project in the monthly update.
`;

const DAILY = `---
description: The day’s focus, meetings, and what got done.
tags: [daily]
---
## Focus
- Type the day’s focus here, or make it a task: - [ ] …

## Meetings


## Notes


## Done today
-

## Tomorrow
- Type what’s next here, or make it a task: - [ ] …
`;

const MONTHLY = `---
description: The month gathered in one place, ready to become the monthly update. When it is ready, export it as a PDF or ask the assistant to draft the update from it.
type: monthly-update
month: "{{date:MMMM YYYY}}"
tags: [monthly-update]
---
**{{date:MMMM YYYY}}** · For:

## Highlights
Three things that went well, a line each.

-
-
-

## Each project
### Project name
- **Status:** On track / At risk / Off track
- **Done this month:**
- **Next month:**
- **Help needed:**

## Numbers
| Measure | Last month | This month | Note |
| --- | --- | --- | --- |
|  |  |  |  |

## Risks and issues
-

## Decisions needed
-

## Next month
-
`;

// Project shapes. Dates count from the day the project is made; every one is the person's to change.
const IT_ROLLOUT = `---
type: project-template
description: A small office IT project — new computers or a new system, from the inventory to sign-off.
status: planning
health: on track
due: {{date+10w:YYYY-MM-DD}}
tags: [it-rollout]
---
# {{title}}

## Summary

What’s changing, for whom, and what done looks like (for example: everyone in the office on a new laptop, set up, shown the basics and signed off by the end of next month).

## What’s next

- [ ] Take an inventory: who has what, and what needs replacing — by {{date+1w:D MMM YYYY}}
- [ ] Order the equipment and licences — by {{date+2w:D MMM YYYY}}
- [ ] Set up and test one first, then the rest — by {{date+4w:D MMM YYYY}}
- [ ] Write a short how-to: what changes, when, and who to ask — by {{date+5w:D MMM YYYY}}
- [ ] Hand each one over and show people the basics — by {{date+7w:D MMM YYYY}}
- [ ] Get sign-off that everything works, and note what was done

## Key dates

| When | What | Status |
| --- | --- | --- |
| {{date:D MMM YYYY}} | Kick-off | planned |
| {{date+2w:D MMM YYYY}} | Order placed | planned |
| {{date+5w:D MMM YYYY}} | Set up and tested | planned |
| {{date+8w:D MMM YYYY}} | Handed over, training done | planned |
| {{date+10w:D MMM YYYY}} | Signed off | planned |

## Risks and issues

- **High** — The equipment or licences arrive late; order early.
- **Medium** — A program people rely on doesn’t work on the new setup; test the main ones first.
- **Medium** — People are away when their handover is due.
- **Low** — Old files or settings don’t come across; back them up before the swap.

## Notes
`;

const SITE_OPENING = `---
type: project-template
description: Opening a new site or office — internet, fit-out, devices and day-one support.
status: planning
health: on track
due: {{date+9w:YYYY-MM-DD}}
tags: [site-opening]
---
# {{title}}

## Summary

Where the site is, when it opens, how many people work there, and what they need on day one.

## What’s next

- [ ] Confirm the opening date and the site contact — by {{date+1w:D MMM YYYY}}
- [ ] Order the internet service (new business services can take weeks) and a mobile backup — by {{date+1w:D MMM YYYY}}
- [ ] Plan power, data points and where the comms cupboard or rack goes — by {{date+2w:D MMM YYYY}}
- [ ] Order devices, printers and phones — by {{date+3w:D MMM YYYY}}
- [ ] Set up building access, alarm codes and keys — by {{date+7w:D MMM YYYY}}
- [ ] Install and test the network, Wi-Fi and printers — by {{date+8w:D MMM YYYY}}
- [ ] Show staff how things work, and who to call — by {{date+9w:D MMM YYYY}}

## Key dates

| When | What | Status |
| --- | --- | --- |
| {{date+2w:D MMM YYYY}} | Site handed over | planned |
| {{date+6w:D MMM YYYY}} | Internet live | planned |
| {{date+7w:D MMM YYYY}} | Fit-out done, IT installed | planned |
| {{date+8w:D MMM YYYY}} | Everything tested | planned |
| {{date+9w:D MMM YYYY}} | Opening day | planned |

## Risks and issues

- **High** — The internet service isn’t live in time; order early and have a mobile backup ready.
- **Medium** — The fit-out runs late and squeezes the IT install.
- **Medium** — Equipment arrives late.
- **Low** — Access cards or the alarm aren’t set up for the first morning.

## Notes
`;

const SITE_CLOSE = `---
type: project-template
description: Closing a site or office — notice on contracts, equipment out, data safe, keys back.
status: planning
health: on track
due: {{date+8w:YYYY-MM-DD}}
tags: [site-close-down]
---
# {{title}}

## Summary

Which site is closing, when, why, and where its people and equipment are going.

## What’s next

- [ ] Confirm the closing date, and tell staff before anyone else — by {{date+1w:D MMM YYYY}}
- [ ] Check every contract (lease, power, internet, phones, cleaning, security) for its end date and notice period — by {{date+1w:D MMM YYYY}}
- [ ] Give notice in writing and keep the confirmations — by {{date+2w:D MMM YYYY}}
- [ ] List every device and asset, and where each one goes — by {{date+3w:D MMM YYYY}}
- [ ] Move shared files and back up anything kept only on site — by {{date+5w:D MMM YYYY}}
- [ ] Book removalists and an e-waste recycler that gives certificates — by {{date+5w:D MMM YYYY}}
- [ ] Final walk-through, meter readings, keys handed back — by {{date+8w:D MMM YYYY}}

## Key dates

| When | What | Status |
| --- | --- | --- |
| {{date:D MMM YYYY}} | Closure confirmed | planned |
| {{date+2w:D MMM YYYY}} | Notice given on contracts | planned |
| {{date+6w:D MMM YYYY}} | Last working day | planned |
| {{date+7w:D MMM YYYY}} | Equipment out | planned |
| {{date+8w:D MMM YYYY}} | Keys handed back | planned |

## Risks and issues

- **High** — A notice period is missed and a service keeps billing after the site closes.
- **Medium** — Data leaves on devices that aren’t wiped; wipe them and keep the proof.
- **Medium** — Staff or customers hear about it late, or second-hand.
- **Low** — Equipment goes missing between sites; count it out and count it in.

## Notes
`;

const EVENT = `---
type: project-template
description: An event — a launch, a conference day, a training session or a team day.
status: planning
health: on track
due: {{date+7w:YYYY-MM-DD}}
tags: [event]
---
# {{title}}

## Summary

What the event is, who it’s for, how many are coming, and what a good day looks like.

## What’s next

- [ ] Set the date, the audience and the budget — by {{date+1w:D MMM YYYY}}
- [ ] Book the venue — by {{date+1w:D MMM YYYY}}
- [ ] Send a save-the-date, then invitations — by {{date+2w:D MMM YYYY}}
- [ ] Line up speakers, and when their slides are due — by {{date+3w:D MMM YYYY}}
- [ ] Catering: numbers and dietary needs — by {{date+6w:D MMM YYYY}}
- [ ] Sound and screens: microphones, the projector, Wi-Fi, any recording — by {{date+6w:D MMM YYYY}}
- [ ] Run sheet for the day, minute by minute — by {{date+6w:D MMM YYYY}}
- [ ] Afterwards: thank-yous, photos and a short feedback survey

## Key dates

| When | What | Status |
| --- | --- | --- |
| {{date+1w:D MMM YYYY}} | Venue booked | planned |
| {{date+2w:D MMM YYYY}} | Invitations out | planned |
| {{date+5w:D MMM YYYY}} | RSVPs close | planned |
| {{date+6w:D MMM YYYY}} | Run sheet final | planned |
| {{date+7w:D MMM YYYY}} | Event day | planned |

## Risks and issues

- **Medium** — Fewer people come than planned; send a reminder a week out.
- **Medium** — Catering numbers are wrong; confirm them three business days before.
- **Medium** — The sound or screen fails; test everything the morning of.
- **Low** — Bad weather; anything outdoors needs a wet-weather plan.

## Notes
`;

const MONTHLY_REPORTING = `---
type: project-template
description: The monthly update across projects — gathered, written, checked and sent on the same day each month.
status: active
health: on track
tags: [monthly-reporting]
---
# {{title}}

## Summary

Who gets the monthly update, when it goes out each month, and where the figures come from.

## What’s next

- [ ] Agree who gets it and the day it goes out (for example, the fifth business day) — by {{date+1w:D MMM YYYY}}
- [ ] Ask each project lead for their status two business days before — by {{date+3w:D MMM YYYY}}
- [ ] Draft the update (the Portfolio update template sets out its layout) — by {{date+4w:D MMM YYYY}}
- [ ] Check the figures and each status with the project leads
- [ ] Send it, and keep a copy in Reports

## Key dates

| When | What | Status |
| --- | --- | --- |
| {{date+3w:D MMM YYYY}} | Status in from every project | planned |
| {{date+4w:D MMM YYYY}} | First draft | planned |
| {{date+1m:D MMM YYYY}} | First update sent | planned |

## Risks and issues

- **Medium** — Status arrives late or not at all; send a reminder two days before it’s due.
- **Low** — Figures don’t match other reports; use one source for each figure.

## Notes
`;

const BLANK_PROJECT = `---
type: project-template
description: Just the name — write in the rest as you go.
status: planning
health: on track
---
# {{title}}

## Summary

What this project is for, and what done looks like.

## What’s next

- [ ] Write down what done looks like

## Notes
`;

// Layout presets (21 Oct 2026, docs/LAYOUTS.md): a new project that opens with its dashboard — the keys and sections its
// layout reads, in the contract's exact names, filled with a start the person writes over.
const LAYOUT_PROGRAMME = `---
type: project-template
description: A programme of work — workstreams with owners and progress, milestones, risks and the next actions.
layout: programme
status: planning
health: on track
progress: 0
phase: Initiation
due: {{date+12w:YYYY-MM-DD}}
---
# {{title}}

## Summary

What the programme delivers, for whom, and what done looks like.

## What’s next

- [ ] Agree the scope and who sponsors it — by {{date+1w:D MMM YYYY}}
- [ ] Name an owner for each workstream — by {{date+1w:D MMM YYYY}}

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| {{date+1w:D MMM YYYY}} | Scope agreed | next |
| {{date+6w:D MMM YYYY}} | Halfway review | |
| {{date+12w:D MMM YYYY}} | Done | |

## Risks and issues

| Risk | Impact | Owner | Status |
| --- | --- | --- | --- |
| Something that could hold it up | Medium | | open |

## Notes

## Workstreams

| Workstream | Owner | Status | Progress | Next step |
| --- | --- | --- | --- | --- |
| Planning | | on track | 10 | Agree the scope |
| Delivery | | not started | 0 | |
`;

const LAYOUT_SITE = `---
type: project-template
description: A site opening, close-down or event — a countdown to the day, the run sheet phase by phase, and who to call.
layout: site
site_kind: opening
go_live: {{date+8w:YYYY-MM-DD}}
phase: Eight weeks out
status: planning
health: on track
due: {{date+8w:YYYY-MM-DD}}
---
# {{title}}

## Summary

What is happening, where, on what day, and what has to be ready by then.

## Key dates

| Date | Milestone | Status |
| --- | --- | --- |
| {{date+2w:D MMM YYYY}} | Suppliers booked | next |
| {{date+7w:D MMM YYYY}} | Everything tested | |
| {{date+8w:D MMM YYYY}} | The day | |

## Notes

## Run sheet

### Eight weeks out

- [ ] Confirm the date and the contact on site — by {{date+1w:D MMM YYYY}}
- [ ] Book the suppliers

### Two weeks out

- [ ] Confirm deliveries, access and keys

### The day

- [ ] Walk through everything first thing

### After

- [ ] Close off with the suppliers and thank everyone

## Suppliers and contacts

| Name | Role | Company | Contact |
| --- | --- | --- | --- |
| | Site contact | | |
`;

const LAYOUT_REGISTER = `---
type: project-template
description: A register of things — devices, stock, assets, licences — as a grid you can sort and filter, with totals.
layout: register
register_of: item
status: active
health: on track
---
# {{title}}

## Summary

What is kept in this register, and who looks after it.

## Notes

## Register

| Item | Status | Qty | Location | Notes |
| --- | --- | --- | --- | --- |
| The first item | In use | 1 | | |
`;

const LAYOUT_TRACKER = `---
type: project-template
description: A tracker — numbers from a log charted against their targets, how often each week, the latest entry and the plan.
layout: fitness
goal: What you are working towards, in a line.
start: {{date:YYYY-MM-DD}}
end: {{date+8w:YYYY-MM-DD}}
sessions_per_week: 3
status: active
health: on track
---
# {{title}}

## Summary

Why this matters, and how you will know it is working.

## Plan

| Day | Session |
| --- | --- |
| Monday | |
| Wednesday | |
| Friday | |

## Notes

Add an entry from the page (Add entry): the first one starts this project’s log with the measures you name. A target for
a measure goes in the properties as target_ and its name (target_score: 80).
`;

const LAYOUT_HABIT = `---
type: project-template
description: A habit — a streak and its milestones, the last two weeks of check-ins, and the latest entry.
layout: wellbeing
streak_start: {{date:YYYY-MM-DD}}
streak_label: Habit kept
milestones: [7, 14, 30, 90]
status: active
health: on track
---
# {{title}}

## Summary

The habit, why it matters, and what helps on a hard day.

## Plan

What you do each day, and who you can call.

## Notes

Check in each day from the page (Add entry): a yes or no for the habit, and anything else worth keeping track of.
`;

const LAYOUT_VENTURE = `---
type: project-template
description: A business or side venture — its stage, a board of the pipeline, what’s due, and the people involved.
layout: venture
stage: idea
status: active
health: on track
---
# {{title}}

## Summary

What it is, who it is for, and what the next stage looks like.

## What’s next

- [ ] Talk to three people who would use it — by {{date+2w:D MMM YYYY}}

## Notes

## Pipeline

| Item | Stage | Owner | Due | Notes |
| --- | --- | --- | --- | --- |
| First customer conversation | Idea | | {{date+1w:D MMM YYYY}} | |

## Campaigns

| Item | Stage | Owner | Due | Notes |
| --- | --- | --- | --- | --- |
| Launch announcement | Planned | | {{date+4w:D MMM YYYY}} | |

## Suppliers and contacts

| Name | Role | Company | Contact |
| --- | --- | --- | --- |
`;

export const BUILT_INS: BuiltInTemplate[] = [
  { id: 'meeting-notes', folder: 'Notes', name: 'Meeting notes', aliases: ['Meeting', 'Meeting note', 'Meetings', 'Minutes'], text: MEETING },
  { id: 'weekly-status', folder: 'Notes', name: 'Weekly status update', aliases: ['Weekly status', 'Status update', 'Weekly update', 'Weekly report'], text: WEEKLY },
  { id: 'decision-record', folder: 'Notes', name: 'Decision record', aliases: ['Decision', 'Decision log'], text: DECISION },
  { id: 'site-visit', folder: 'Notes', name: 'Site visit', aliases: ['Site visit report', 'Site inspection'], text: SITE_VISIT },
  { id: 'risk-log', folder: 'Notes', name: 'Risk log', aliases: ['Risk register', 'Risks'], text: RISK_LOG },
  { id: 'close-down-checklist', folder: 'Notes', name: 'Close-down checklist', aliases: ['Close down checklist', 'Closure checklist'], text: CLOSE_DOWN },
  { id: 'project-brief', folder: 'Notes', name: 'Project brief', aliases: ['Brief', 'Project charter'], text: BRIEF },
  { id: 'daily-note', folder: 'Notes', name: 'Daily note', aliases: ['Daily', 'Daily notes', 'Today'], text: DAILY },
  { id: 'project-it-rollout', folder: 'Projects', name: 'IT rollout', aliases: [], text: IT_ROLLOUT },
  { id: 'project-site-opening', folder: 'Projects', name: 'Site opening', aliases: [], text: SITE_OPENING },
  { id: 'project-site-close-down', folder: 'Projects', name: 'Site close-down', aliases: ['Site closure'], text: SITE_CLOSE },
  { id: 'project-event', folder: 'Projects', name: 'Event', aliases: [], text: EVENT },
  { id: 'project-monthly-reporting', folder: 'Projects', name: 'Monthly reporting', aliases: [], text: MONTHLY_REPORTING },
  { id: 'project-blank', folder: 'Projects', name: 'Blank', aliases: ['Blank project'], text: BLANK_PROJECT },
  { id: 'project-layout-programme', folder: 'Projects', name: 'Programme', aliases: [], text: LAYOUT_PROGRAMME },
  { id: 'project-layout-site', folder: 'Projects', name: 'Site or event', aliases: [], text: LAYOUT_SITE },
  { id: 'project-layout-register', folder: 'Projects', name: 'Register', aliases: [], text: LAYOUT_REGISTER },
  { id: 'project-layout-tracker', folder: 'Projects', name: 'Tracker', aliases: [], text: LAYOUT_TRACKER },
  { id: 'project-layout-habit', folder: 'Projects', name: 'Habit', aliases: [], text: LAYOUT_HABIT },
  { id: 'project-layout-venture', folder: 'Projects', name: 'Venture', aliases: [], text: LAYOUT_VENTURE },
  // Docs (src/shared/doc-file.ts): how something is set up and run, a process, a runbook.
  ...DOC_TEMPLATES.map((d) => ({ id: d.id, folder: 'Docs' as const, name: d.name, aliases: d.aliases, text: d.text })),
  { id: 'monthly-update', folder: 'Reports', name: 'Monthly update', aliases: ['Monthly report'], text: MONTHLY },
  { id: 'report-progress', folder: 'Reports', name: 'Progress report', aliases: [], text: PROGRESS_TEMPLATE },
  { id: 'report-portfolio', folder: 'Reports', name: 'Portfolio update', aliases: [], text: PORTFOLIO_TEMPLATE },
];

/** Where a ready-made template goes in a library whose templates folder is `root`. */
export const builtInPath = (root: string, b: BuiltInTemplate) => `${root ? `${root}/` : ''}${b.folder}/${b.name}.md`;

/** The files a ready-made template is written through (the library), so this module can be checked without one. */
export interface TemplateStore {
  /** Whether anything is at this path. */
  any(rel: string): Promise<boolean>;
  /** A new note, never over one that is there. */
  create(rel: string, text: string): Promise<void>;
  /** Every note's path in the library (to find the person's own template of the same name anywhere in the folder). */
  notes(): string[];
}

/** What Ironleaf has written (or found the person's own) before: never written again unless brought back. */
export interface TemplateRecord {
  written: string[];
}

const titleOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, ' ').trim();

/**
 * Writes the ready-made templates that aren't there. A template already there (ours, or the person's own of the same
 * name or kind anywhere in the templates folder) is left alone and remembered; one written before and since deleted is
 * not written again, unless `restore` (the person asked to bring them back). Returns the notes written.
 */
export async function ensureBuiltIns(store: TemplateStore, root: string, record: TemplateRecord, opts: { restore?: boolean; only?: string[]; theirs?: (b: BuiltInTemplate) => boolean } = {}): Promise<{ made: string[]; record: TemplateRecord }> {
  const written = new Set(record.written ?? []);
  const made: string[] = [];
  const inFolder = store.notes().filter((p) => !root || p.toLowerCase().startsWith(`${root.toLowerCase()}/`));
  const names = new Set(inFolder.map((p) => norm(titleOf(p))));
  for (const b of BUILT_INS) {
    if (opts.only && !opts.only.includes(b.id)) continue;
    const rel = builtInPath(root, b);
    const present = (await store.any(rel)) || [b.name, ...b.aliases].some((n) => names.has(norm(n))) || !!opts.theirs?.(b);
    if (present) {
      written.add(b.id);
      continue;
    }
    if (written.has(b.id) && !opts.restore) continue;
    await store.create(rel, b.text);
    written.add(b.id);
    made.push(rel);
  }
  return { made, record: { written: [...written].sort() } };
}

/** The ready-made templates the person deleted (written, or found as theirs, and not there now): what "Bring them back"
 * would add. One never written yet is not "deleted": it is added the next time the library opens. */
export async function missingBuiltIns(store: TemplateStore, root: string, record: TemplateRecord): Promise<BuiltInTemplate[]> {
  const written = new Set(record.written ?? []);
  const inFolder = store.notes().filter((p) => !root || p.toLowerCase().startsWith(`${root.toLowerCase()}/`));
  const names = new Set(inFolder.map((p) => norm(titleOf(p))));
  const out: BuiltInTemplate[] = [];
  for (const b of BUILT_INS) if (written.has(b.id) && !(await store.any(builtInPath(root, b))) && ![b.name, ...b.aliases].some((n) => names.has(norm(n)))) out.push(b);
  return out;
}

/** A report's layout: the person's (Templates/Reports), else Ironleaf's own words when they deleted it. */
export function reportTemplatePath(root: string, kind: 'progress' | 'portfolio'): string {
  return `${root ? `${root}/` : ''}${REPORTS_FOLDER}/${kind === 'portfolio' ? 'Portfolio update' : 'Progress report'}.md`;
}
export const reportTemplateText = (kind: 'progress' | 'portfolio') => (kind === 'portfolio' ? PORTFOLIO_TEMPLATE : PROGRESS_TEMPLATE);

/** The templates in the library, for the Templates page and the pickers: what each is for and where it is used. */
export function listTemplates(notes: { path: string; mtime: number; text: string }[], root: string, daily: string | null): TemplateInfo[] {
  const builtInByPath = new Map(BUILT_INS.map((b) => [builtInPath(root, b).toLowerCase(), b.id]));
  const out: TemplateInfo[] = [];
  for (const n of notes) {
    if (root && !n.path.startsWith(`${root}/`)) continue;
    const kind = templateKind(n.text);
    const info: TemplateInfo = {
      path: n.path,
      name: titleOf(n.path),
      group: templateGroup(n.path, root, kind),
      kind,
      description: templateDescription(n.text),
      usedFor: templateUsedFor({ kind, text: n.text, path: n.path }, daily),
      modified: n.mtime,
      text: n.text,
    };
    const id = builtInByPath.get(n.path.toLowerCase());
    if (id) info.builtIn = id;
    if (kind === 'project') info.counts = projectTemplateCounts(n.text);
    out.push(info);
  }
  // Ironleaf's in the order they are listed above (the order people need them), the person's own after, by name.
  const order = (t: TemplateInfo) => (t.builtIn ? BUILT_INS.findIndex((b) => b.id === t.builtIn) : 1000);
  return out.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}
