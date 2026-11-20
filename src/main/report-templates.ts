// Report templates (16 Oct 2026): notes in Templates/Reports that say how an AI writes a project's progress report and
// an update across every project. The person changes them like any note, and every report after follows them. They are
// among Ironleaf's ready-made templates (src/main/templates.ts): written when they aren't there, never over the
// person's; deleted, a report follows these words without writing them back.

export const REPORTS_FOLDER = 'Reports';

export const PROGRESS_TEMPLATE = `---
type: report-template
report: progress
description: How a project’s progress report is laid out — change it, and every report after follows.
---
# Progress report

How a project’s progress report is written. Change anything here, and every report after follows it.

## Cover
- The project’s name, “Progress report”, the date it is as of, and who it is for.
- A status pill (On track, At risk or Off track) and how far through the project is, as a progress bar.

## Summary
Three to five sentences: where the project is, what changed since the last report, and anything that needs a decision.

## Done since the last report
What was finished, with dates, from the project’s tasks, decisions and documents.

## Key dates
A table: when, what, and whether it is done, on track or late.

## Risks and issues
Each one with how much it matters and what is being done about it.

## Decisions needed
What the reader is asked to decide, with the options and a recommendation.

## Next steps
What happens next, who does it, and by when.

## Look
- A4, portrait. Plain headings, short paragraphs, tables where they help.
- Status in colour: green on track, amber at risk, red off track.
- Only facts from the project’s notes and documents. Anything unknown is marked as unknown.
`;

export const PORTFOLIO_TEMPLATE = `---
type: report-template
report: portfolio
description: How one update across every project is laid out, such as the monthly update.
---
# Portfolio update

How one update across every project is written (a monthly update, say). Change anything here, and every update after follows it.

## Cover
- “Portfolio update”, the month it covers, and who it is for.
- How many projects are on track, at risk and off track.

## At a glance
One table: each project with its status, health, progress and what’s next.

## Each project
Half a page each, in the order of the projects list: status pill, progress, what was done, what’s next, risks and decisions needed.

## Across the projects
Risks, dependencies and people shared between projects.

## Decisions needed
Everything the reader is asked to decide, in one list.

## Look
- A4. The at-a-glance table landscape, the rest portrait.
- Status in colour: green on track, amber at risk, red off track.
- Only facts from the projects’ notes and documents. Anything unknown is marked as unknown.
`;
