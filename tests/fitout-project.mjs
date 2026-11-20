// A made-up project of realistic size (t141, 9 Nov 2026): about 40 notes,
// 16 open steps and 6 done, 13 risks, 8 people with roles, 5 meetings, 3 key dates, 6 files (xlsx, docx,
// pdf), 2 chats and a budget table. Made-up people, places and figures throughout; no real client data.
// Used by the live walk (screenshots) and the durable test, so both see the same project. Each meeting
// carries its own actions besides the lines it shares with the project; the kickoff was touched yesterday
// (its day stays 20 Oct) and the risks file worst-first, so meeting order and risk rank prove themselves.
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const HALL_PATH = 'Projects/Southern Cross Hall Refurbishment/Southern Cross Hall Refurbishment.md';
export const HALL_NAME = 'Southern Cross Hall Refurbishment';

const PEOPLE = [
  ['Sarah Mitchell', 'Project lead', 'Bayside Council'],
  ['James O’Connor', 'Site lead, Northside', 'Bayside Council'],
  ['Priya Sharma', 'Design lead', 'Tessaly'],
  ['Tom Baker', 'Install lead', 'Tessaly'],
  ['Lisa Wang', 'Procurement', 'Bayside Council'],
  ['David Nguyen', 'Electrician', 'Bayside Council'],
  ['Emma Thompson', 'Volunteer coordinator', 'Bayside Council'],
  ['Michael Roberts', 'Site rep', 'Tessaly'],
];

const DAY = 86400000;
// Fixed clock: the brief runs 9 Nov 2026, so late, today and coming read the same every run.
const TODAY = Date.UTC(2026, 10, 9, 2, 0, 0);

function w(dir, rel, text, mtime) {
  const p = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
  if (mtime !== undefined) {
    const d = new Date(mtime);
    utimesSync(p, d, d);
  }
}

export function hallProjectText() {
  return `---
type: project
status: active
health: at risk
owner: Sarah Mitchell
due: 2026-12-18
started: 2026-08-04
tags: [hall, refurb]
---

# Southern Cross Hall Refurbishment

## Summary

Eleven rooms across Northside, Southside and Eastside get the same lighting and sound before the Christmas break, with Tessaly doing the install and the hall committee holding the wiring and bookings. Northside goes first because the board meets there in December; Southside follows once the acoustic work is done; Eastside is last because the lease starts late. The network upgrade in Northside is the critical path: without it the December community meeting runs on the old lights.

The budget holds at A$86,000 with A$38,000 contingency left. The main worries are the Northside power shutdown slipping, the Southside acoustic panels arriving late, and two rooms in Eastside still waiting on landlord approval for the ceiling fans.

## What’s next

- [ ] Confirm the Northside power shutdown with David Nguyen — Sarah Mitchell — due 2026-11-05
- [ ] Chase the Southside acoustic panels, order K-2210 — Lisa Wang — due 2026-11-06
- [ ] Send the Eastside landlord the ceiling fan drawings — James O’Connor — due 2026-11-07
- [ ] Book the December community meeting dry run — Emma Thompson — due 2026-11-08
- [ ] Sign off the Northside main hall sound desk settings — Priya Sharma — due 2026-11-09
- [ ] Walk through the Southside craft room with the facilities team — James O’Connor — due 2026-11-09
- [ ] Order the Eastside curtain rails, six rooms — Lisa Wang — due 2026-11-11
- [ ] Patch the Northside hall switchboard fuses — David Nguyen — due 2026-11-12
- [ ] Run the Northside safety checks, rooms 1 to 4 — Tom Baker — due 2026-11-14
- [ ] Publish the hall booking guide for Northside — Emma Thompson — due 2026-11-15
- [ ] Agree the Eastside install dates with the landlord — Michael Roberts — due 2026-11-20
- [ ] Commission the Southside stage lights, upstairs — Tom Baker — due 2026-11-25
- [ ] Hand over the Northside caretaker handbook — David Nguyen — due 2026-12-02
- [ ] Hold the Southside lessons learned session — Sarah Mitchell — due 2026-12-10
- [ ] Draft the Eastside comms for the January move — Emma Thompson
- [ ] File the Tessaly stage two invoice once Northside signs off — Lisa Wang
- [x] Approve the Northside room designs — Sarah Mitchell — due 2026-10-28
- [x] Complete the Northside wiring survey — David Nguyen — due 2026-10-22
- [x] Order the Northside stage lights, eight rooms — Lisa Wang — due 2026-10-15
- [x] Sign the Tessaly statement of work — Sarah Mitchell — due 2026-09-30
- [x] Confirm the Southside room list with facilities — James O’Connor
- [x] Set up the project folder and filing — Sarah Mitchell

## Key dates

- 2026-10-30: Northside designs signed off (milestone)
- 2026-11-20: Northside rooms live (milestone)
- 2026-12-15: Southside rooms live (milestone)

## People

- Sarah Mitchell — Project lead
- James O’Connor — Site lead, Northside
- Priya Sharma — Design lead
- Tom Baker — Install lead
- Lisa Wang — Procurement
- David Nguyen — Electrician
- Emma Thompson — Volunteer coordinator
- Michael Roberts — Site rep

## Risks and issues

| Risk | Impact | Owner | Status |
| --- | --- | --- | --- |
| Stage two invoice disputed | Low | Lisa Wang | Open |
| Tessaly install crew double booked in Nov | Medium | Tom Baker | Open |
| Northside power shutdown slips past 14 Nov | High | David Nguyen | Open |
| Handover docs incomplete at go live | Low | Tom Baker | Open |
| Southside acoustic panels arrive late | High | Lisa Wang | Open |
| Curtain rails out of stock, six week lead | Medium | Lisa Wang | Open |
| Eastside landlord refuses ceiling fans | High | Michael Roberts | Open |
| Southside craft room access restricted | Medium | James O’Connor | Open |
| Northside community meeting runs on old lights | High | Sarah Mitchell | Open |
| Old wiring trips the new lights | Medium | David Nguyen | Open |
| Northside sound desk settings drifts from standard | Low | Priya Sharma | Open |
| Hall booking guide ignored, complaints spike | Medium | Emma Thompson | Open |
| Eastside install dates clash with the builders | Medium | Michael Roberts | Open |

## Decisions

- 2026-10-25: Standardise on the Tessaly hall kit for all eleven rooms *Why:* one caretaker handbook, one spare set
- 2026-10-18: Northside goes first, Southside second, Eastside last *Why:* the December community meeting and the term dates decide it
- 2026-10-10: Ceiling fans in main halls, pedestal fans elsewhere *Why:* the acoustic report favoured ceilings only where ceilings allow
- 2026-09-28: Hold A$38,000 contingency to December *Why:* the Eastside landlord risk is still open

## Updates

- 2026-11-08: Northside rooms 1 and 2 cabled, rooms 3 and 4 start Monday *From:* Tom Baker
- 2026-11-05: Shared the Northside site survey (Northside site survey.pdf) with the client *From:* Priya Sharma
- 2026-11-02: Southside acoustic quote approved, order K-2210 placed *From:* Lisa Wang

## Budget

| Item | Budget | Spent | Left |
| --- | --- | --- | --- |
| Materials, Northside, eight rooms | $168,000 | $142,000 | $26,000 |
| Materials, Southside, two rooms | $44,000 | $12,000 | $32,000 |
| Materials, Eastside, one room | $22,000 | $0 | $22,000 |
| Install labour, Tessaly | $96,000 | $41,000 | $55,000 |
| Design and acoustic advice | $28,000 | $21,000 | $7,000 |
| Wiring upgrade, Northside | $16,000 | $9,000 | $7,000 |
| Contingency | $38,000 | $0 | $38,000 |

## Notes

My own running notes: keep Northside ahead of Southside by a week, and never let Eastside block the other two. Ring Michael each Friday about the landlord.
`;
}

// Plain working notes (typeless, as hand-written ones are): their titles carry no meeting words, since the
// app reads a typeless note by its name and these are notes, not meetings.
const NOTE_TITLES = [
  'Northside main hall acoustic treatment options and supplier quotes compared',
  'Southside upstairs craft room dimensions and seating plan notes',
  'Eastside landlord approval process for ceiling fans explained',
  'Tessaly hall kit standard parts list with spares held in Northside',
  'Switchboard fuse ratings tested with the stage lights',
  'Northside rooms 1 to 4 cable paths and containment photos',
  'Southside acoustic panel supplier lead times and freight options',
  'Curtain rail fit check for the six Eastside rooms',
  'Sound desk settings for the main halls and how to verify it',
  'Hall booking guide draft for Northside with screenshots of each step',
  'Northside safety check script for rooms 1 to 4 with sign off',
  'Southside facilities walkthrough actions from 28 October with owners',
  'Eastside builders clash check between the lighting install and builder works',
  'Caretaker handbook outline for Northside with escalation contacts listed',
  'Comms plan for the January Eastside move with dates',
  'Lessons learned template for the Southside session in December',
  'Northside power shutdown request and fallback dates if it slips',
  'Stage light mounting heights measured in Northside rooms 1 and 2',
  'Ceiling fan placement drawings for Eastside sent to the landlord',
  'Tessaly stage two invoice breakdown checked against the statement of work',
  'Northside community dry run agenda for early December rehearsal',
  'Southside stage light commissioning checklist for upstairs rooms',
  'Procurement tracker for orders K-2201 to K-2215 with due dates',
  'Risk review notes from 6 November with owners confirmed',
  'Northside caretaker handover notes with the bookings desk',
  'Eastside room naming and signage schedule agreed with facilities',
  'Power point schedule for Northside rooms with circuits noted',
  'Acoustic report summary for Southside with panel counts per room',
  'Northside hall booking pilot feedback from the first two weeks',
  'Southside training schedule for floor wardens and hosts',
  'Eastside install crew induction requirements from the builder',
  'Tessaly weekly progress report 30 October with photos attached',
  'Northside cable labelling standard and how the installers follow it',
  'Southside hall booking integration test results with the calendar',
  'Eastside landlord 22 October outcomes and next steps',
  'Contingency drawdown rules agreed with finance in September',
  'Northside dry run invite list for the December community session',
  'Southside lessons learned invite list and pre-read attached',
  'Eastside comms draft for staff about the January room changes',
  'Project governance cadence with steering dates to December',
];

const DOC_TITLES = [
  'Lighting design standard for the rooms, version 3 with markups',
  'Wiring readiness checklist for the rooms used in Northside',
  'Procurement policy extract for orders over twenty thousand dollars',
  'Impact assessment for the Northside hall booking switch',
  'Caretaker roster for the rooms after handover to the bookings desk',
];

const MEETINGS = [
  {
    file: 'Meetings/2026-10-20 gallery fit-out kickoff.md',
    date: '2026-10-20',
    title: '2026-10-20 gallery fit-out kickoff',
    attendees: ['Sarah Mitchell', 'James O’Connor', 'Priya Sharma', 'Tom Baker', 'Michael Roberts'],
    agenda: ['Room list', 'Order of sites', 'Risks'],
    actions: [
      ['Confirm the Southside room list with facilities', 'James O’Connor', '2026-10-24', true],
      ['Send the Tessaly statement of work for signing', 'Michael Roberts', '2026-10-22', true],
      ['Book the Northside wiring survey', 'David Nguyen', '2026-10-22', true],
      ['Share the kickoff notes with the steering group', 'Emma Thompson', '2026-10-24', false],
    ],
    decisions: ['Northside goes first, Southside second, Eastside last'],
    // Touched yesterday (its date stays 20 Oct): meeting order reads the meeting day, never the file's age.
    touched: TODAY - DAY,
  },
  {
    file: 'Meetings/2026-10-27 Northside design review.md',
    date: '2026-10-27',
    title: '2026-10-27 Northside design review',
    attendees: ['Sarah Mitchell', 'Priya Sharma', 'Tom Baker', 'David Nguyen'],
    agenda: ['Main hall sound desk', 'Cable paths', 'Test script'],
    actions: [
      ['Approve the Northside room designs', 'Sarah Mitchell', '2026-10-28', true],
      ['Order the Northside stage lights, eight rooms', 'Lisa Wang', '2026-10-15', true],
      ['Confirm the Northside power shutdown with David Nguyen', 'Sarah Mitchell', '2026-11-05', false],
      ['Order the spare HDMI cables for Northside', 'Lisa Wang', '2026-11-13', false],
    ],
    decisions: ['Standardise on the Tessaly hall kit for all eleven rooms'],
  },
  {
    file: 'Meetings/2026-11-03 Southside planning.md',
    date: '2026-11-03',
    title: '2026-11-03 Southside planning',
    attendees: ['Sarah Mitchell', 'James O’Connor', 'Lisa Wang', 'Emma Thompson'],
    agenda: ['Acoustic panels', 'Training room access', 'Comms'],
    actions: [
      ['Chase the Southside acoustic panels, order K-2210', 'Lisa Wang', '2026-11-06', false],
      ['Walk through the Southside craft room with the facilities team', 'James O’Connor', '2026-11-09', false],
      ['Publish the hall booking guide for Northside', 'Emma Thompson', '2026-11-15', false],
      ['Confirm the December training hall bookings', 'James O’Connor', '2026-11-16', false],
    ],
    decisions: ['Hold A$38,000 contingency to December'],
  },
  {
    file: 'Meetings/2026-11-05 Eastside landlord catchup.md',
    date: '2026-11-05 Eastside landlord catchup',
    title: '2026-11-05 Eastside landlord catchup',
    attendees: ['Sarah Mitchell', 'James O’Connor', 'Michael Roberts'],
    agenda: ['Ceiling fans', 'Install dates', 'Fit-out clash'],
    actions: [
      ['Send the Eastside landlord the ceiling fan drawings', 'James O’Connor', '2026-11-07', false],
      ['Agree the Eastside install dates with the landlord', 'Michael Roberts', '2026-11-20', false],
      ['Send the refurbishment drawings to the builder', 'Michael Roberts', '2026-11-06', true],
    ],
    decisions: ['Ceiling fans in main halls, pedestal fans elsewhere'],
  },
  {
    file: 'Meetings/2026-11-08 Northside install standup.md',
    date: '2026-11-08',
    title: '2026-11-08 Northside install standup',
    attendees: ['Tom Baker', 'David Nguyen', 'Priya Sharma', 'Sarah Mitchell'],
    agenda: ['Rooms 1 and 2', 'Firmware', 'Acceptance tests'],
    actions: [
      ['Patch the Northside hall switchboard fuses', 'David Nguyen', '2026-11-12', false],
      ['Run the Northside safety checks, rooms 1 to 4', 'Tom Baker', '2026-11-14', false],
      ['Sign off the Northside main hall sound desk settings', 'Priya Sharma', '2026-11-09', false],
      ['Confirm the acceptance test dates with the board secretary', 'Sarah Mitchell', '2026-11-11', false],
    ],
    decisions: [],
  },
];

function meetingText(m) {
  const actions = m.actions.map(([what, who, when, done]) => `- [${done ? 'x' : ' '}] ${what} — ${who} — due ${when}`).join('\n');
  const decisions = m.decisions.length ? `\n## Decisions\n\n${m.decisions.map((d) => `- ${d}`).join('\n')}\n` : '';
  return `---
type: meeting
date: ${m.date}
attendees: [${m.attendees.join(', ')}]
project: ${HALL_PATH}
---
# ${m.title}

## Agenda

${m.agenda.map((a) => `- ${a}`).join('\n')}

## Actions

${actions}
${decisions}`;
}

function noteText(title, i) {
  return `# ${title}

${title} — working notes for the ${HALL_NAME}. This note holds what was found, who said it and what happens next, so the project file stays short and the detail stays findable.

The Northside rooms went first because the December community meeting needs them. Southside follows once the acoustic panels land. Eastside waits on the landlord for the ceiling fans. Each site keeps its own drawings, quotes and test sheets in the project folder.

Next: confirm the owner, set a date, and file any action back in the project file or the meeting where it was agreed. Note ${i + 1} of the set.
`;
}

function docText(title) {
  return `---
type: doc
---
# ${title}

${title}. This document is the controlled copy: when it changes, the version number moves and the project update names the change.

Kept with the ${HALL_NAME} so the install crew, the designers and the client all read the same words.
`;
}

/** Write the lighting-shaped project, its notes, meetings and people into a vault dir. */
export function writeFitoutProject(dir) {
  w(dir, HALL_PATH, hallProjectText(), TODAY - 2 * DAY);
  NOTE_TITLES.forEach((t, i) => {
    const n = i + 1;
    w(dir, `Projects/Southern Cross Hall Refurbishment/Notes/${String(n).padStart(2, '0')} ${t}.md`, noteText(t, i), TODAY - i * DAY);
  });
  DOC_TITLES.forEach((t, i) => {
    w(dir, `Projects/Southern Cross Hall Refurbishment/Notes/Docs ${i + 1} ${t}.md`, docText(t), TODAY - (i + 3) * DAY);
  });
  MEETINGS.forEach((m) => {
    const [y, mo, d] = m.date.split('-').map(Number);
    w(dir, m.file, meetingText(m), m.touched ?? Date.UTC(y, mo - 1, d, 4, 0, 0));
  });
  PEOPLE.forEach(([name, role, org], i) => {
    w(
      dir,
      `People/${name}.md`,
      `---
type: person
role: ${role}
org: ${org}
---
# ${name}

${role} at ${org}, on the [[${HALL_NAME}]]. Contact for ${i % 2 ? 'site and install questions' : 'design and planning questions'}.
`,
      TODAY - (i + 1) * DAY,
    );
  });
  w(
    dir,
    'Notes/lighting lessons from last year.md',
    `# lighting lessons from last year

What last year's fit-out taught: order mounts early, test firmware before install week, and keep one spare stage light in Northside. Relevant to the [[${HALL_NAME}]].
`,
    TODAY - 30 * DAY,
  );
  w(
    dir,
    'Notes/Board meeting dates December.md',
    `# Board meeting dates December

The December board meets in Northside on the 12th. The [[${HALL_NAME}]] dry run is the week before.
`,
    TODAY - 20 * DAY,
  );
}

/** Six files for the harness project:files channel (2 xlsx, 2 docx, 2 pdf). */
export function hallProjectFiles() {
  const f = (rel, size, ageDays) => ({ rel, name: rel.split('/').pop(), ext: rel.split('.').pop().toLowerCase(), size, modified: TODAY - ageDays * DAY });
  const groups = [
    { name: 'Budget', files: [f('Budget/lighting budget v3.xlsx', 45000, 2), f('Budget/Quotes compared.xlsx', 38000, 6)] },
    { name: 'Design', files: [f('Design/Boardroom layout.docx', 120000, 4), f('Design/Acoustic report.docx', 95000, 9)] },
    { name: 'Surveys', files: [f('Surveys/Northside site survey.pdf', 2400000, 5), f('Surveys/Southside site survey.pdf', 2100000, 12)] },
  ];
  return { folder: '/fake/Southern Cross Hall Refurbishment', exists: true, groups, total: 6, more: 0 };
}

/** Two chats for the harness project:work channel (one working now). */
export function hallChats() {
  return [
    { id: 'hall_sound_desk', title: 'sound desk settings for Northside main hall', updatedAt: TODAY - 3600000, running: true, kind: 'code' },
    { id: 'av_standup_notes', title: 'Weekly standup notes and actions', updatedAt: TODAY - 86400000, running: false, kind: 'chat' },
  ];
}
