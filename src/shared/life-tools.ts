// Health and Fitness's and Family's tools for assistants and agents (Wave 5, 24 Oct 2026; the rule: "Agents get tools per
// module (e.g. health_checkin_log, family_event_add) and access per sensitivity level"). Offered only while the module is
// on; every call goes through the asking agent's gate: Health tools need the Health level, Family tools the
// Family-private level (Settings › Privacy and secrets), and every call is in the audit trail. Health answers carry only
// the rows asked for (one measure, the days named), never the whole store. Pure: words and schemas, shared by the side
// chat, outside agents (src/shared/agent-access.ts) and the former host app (built into its desktop plugin).

import { MODULE_TOOLS, type ModuleToolDef } from './module-tools';

const S = (description: string) => ({ type: 'string', description });
const N = (description: string) => ({ type: 'number', description });
const DAY = S('The day, YYYY-MM-DD (default today).');

export const HEALTH_TOOLS: ModuleToolDef[] = [
  {
    module: 'health',
    name: 'health_measures',
    title: 'What the health store keeps',
    level: 'read',
    readOnly: true,
    step: 'Looked at what your health store keeps',
    description: 'The measures kept in the person’s Health store (names, units, yes/no or a score) and the daily check-in’s questions. No figures: use health_trend for one measure’s figures.',
    input: {},
  },
  {
    module: 'health',
    name: 'health_trend',
    title: 'One measure over some days',
    level: 'read',
    readOnly: true,
    step: 'Looked at one health measure',
    description: 'One measure’s entries over a span of days (default the last 30) and their summary (latest, change, average, a week’s trend). Only for a specific question the person asked; ask for the one measure and the days that answer it. Figures such as body fat are estimates; never give medical advice.',
    input: { measure: S('The measure, as health_measures names it (e.g. "Weight", "Sleep").'), days: N('The last this many days (default 30, at most 366).'), from: S('Or a first day, YYYY-MM-DD.'), to: S('And a last day, YYYY-MM-DD (default today).') },
    required: ['measure'],
  },
  {
    module: 'health',
    name: 'health_checkin_log',
    title: 'Log a check-in',
    level: 'edit',
    step: 'Logged a health check-in',
    description: 'Log figures for a day into the health store: measures by name with their values (numbers, yes/no, a score, words), e.g. {"Weight": 82.4, "Sleep": 7.5, "Water": 6}. Only measures the store keeps (health_measures); a value for a day already logged replaces it.',
    input: { values: { type: 'object', description: 'Measure name → value.', additionalProperties: true }, day: DAY, note: S('A line for the day (optional).') },
    required: ['values'],
  },
  {
    module: 'health',
    name: 'health_session_log',
    title: 'Log a training session',
    level: 'edit',
    step: 'Logged a training session',
    description: 'Log a training session: its title, kind (strength, cardio, mobility, sport, other), minutes, effort 1-10, and its exercises with their sets ({name, sets: [{reps, weight (kg), seconds, distance (km)}]}).',
    input: {
      title: S('What it was ("Upper body", "5 km run").'),
      kind: { type: 'string', enum: ['strength', 'cardio', 'mobility', 'sport', 'other'] },
      minutes: N('How long, in minutes.'),
      effort: N('How hard it felt, 1 to 10.'),
      exercises: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '[{name, sets: [{reps, weight, seconds, distance}]}]' },
      notes: S('Anything else (optional).'),
      day: DAY,
    },
    required: ['title'],
  },
  {
    module: 'health',
    name: 'health_meal_log',
    title: 'Log a meal',
    level: 'edit',
    step: 'Logged a meal',
    description: 'Log a meal or snack: which (breakfast, lunch, dinner, snack), what it was, and its energy and protein when known (never guessed).',
    input: { meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] }, what: S('What it was.'), kcal: N('Energy in kcal (only when known).'), protein: N('Protein in grams (only when known).'), day: DAY },
    required: ['what'],
  },
  {
    module: 'health',
    name: 'health_week',
    title: 'This week in numbers',
    level: 'read',
    readOnly: true,
    step: 'Looked at this week’s health numbers',
    description: 'This week in numbers: training sessions done against the aim the person set, and how many days the daily check-in was answered. Counts only, no figures and no medical advice. Use it for "how is my week going?".',
    input: {},
  },
  {
    module: 'health',
    name: 'health_appointments',
    title: 'Upcoming appointments',
    level: 'read',
    readOnly: true,
    step: 'Looked at your upcoming appointments',
    description: 'Booked health appointments in the next days (default 30): who with, when, where and why. Results are not included.',
    input: { days: N('How many days ahead (default 30).') },
  },
  {
    module: 'health',
    name: 'health_appointment_add',
    title: 'Add an appointment',
    level: 'edit',
    step: 'Added a health appointment',
    description: 'Add a booked appointment (a GP, dentist, physio, a test) with its day, time, place and reason; Ironleaf reminds the person the day before unless told otherwise.',
    input: { who: S('Who it is with ("GP", "Dr Lee", "Physio").'), day: S('The day, YYYY-MM-DD.'), time: S('The time, HH:MM (24-hour), when known.'), where: S('Where (optional).'), why: S('What it is for (optional).'), remind: N('Days before to remind (default 1; 0 on the day).') },
    required: ['who', 'day'],
  },
];

export const FAMILY_TOOLS: ModuleToolDef[] = [
  {
    module: 'family',
    name: 'family_members',
    title: 'The family',
    level: 'read',
    readOnly: true,
    step: 'Looked at your family’s cards',
    description: 'The family members kept in Ironleaf: name, relation, age, school.',
    input: {},
  },
  {
    module: 'family',
    name: 'family_events',
    title: 'Who’s where',
    level: 'read',
    readOnly: true,
    step: 'Looked at who’s where',
    description: 'Who’s where over some days (default the next 7): each day’s activities, events and birthdays with times, people and places. Give who to keep to one person.',
    input: { from: S('The first day, YYYY-MM-DD (default today).'), days: N('How many days (default 7, at most 31).'), who: S('One family member’s name (optional).') },
  },
  {
    module: 'family',
    name: 'family_week_ahead',
    title: 'The week ahead, ready to share',
    level: 'read',
    readOnly: true,
    step: 'Wrote out the family’s week ahead',
    description: 'The week ahead as one short plain message, ready to copy into a family chat: each day’s activities, events and birthdays with times and people. Give who to keep to one person, and from or days to change the span.',
    input: { from: S('The first day, YYYY-MM-DD (default today).'), days: N('How many days (default 7, at most 31).'), who: S('One family member’s name (optional).') },
  },
  {
    module: 'family',
    name: 'family_event_add',
    title: 'Add a family event',
    level: 'edit',
    step: 'Added a family event',
    description: 'Add a one-day event to the family calendar (a school concert, a party, a game): its date, time, who and where.',
    input: { date: S('The day, YYYY-MM-DD.'), what: S('What it is.'), time: S('The time, HH:MM (optional).'), who: S('Who it is for, names joined by commas (optional; blank is everyone).'), where: S('Where (optional).') },
    required: ['date', 'what'],
  },
  {
    module: 'family',
    name: 'family_activity_add',
    title: 'Add a weekly activity',
    level: 'edit',
    step: 'Added a weekly family activity',
    description: 'Add something that happens each week (a sport, a lesson, a school pickup): who, what, which days ("Tue", "Mon, Wed", "weekdays"), the time, where, and until when.',
    input: { who: S('Who, names joined by commas.'), what: S('What it is.'), day: S('Which days.'), time: S('The time (optional).'), where: S('Where (optional).'), until: S('The last day, YYYY-MM-DD (optional).') },
    required: ['what', 'day'],
  },
  {
    module: 'family',
    name: 'family_milestone_add',
    title: 'Keep a milestone',
    level: 'edit',
    step: 'Kept a family milestone',
    description: 'Keep a milestone (a first, an award, a big moment) with who and the day.',
    input: { who: S('Who.'), what: S('The milestone.'), date: DAY },
    required: ['what'],
  },
  {
    module: 'family',
    name: 'family_reward_log',
    title: 'Mark a reward tracker’s day',
    level: 'edit',
    step: 'Marked a reward tracker',
    description: 'Mark a day yes or no on a reward tracker (by the person it is for, or its title), and say the streak and any reward now earned.',
    input: { tracker: S('Who it is for, or the tracker’s title.'), yes: { type: 'boolean', description: 'Done (default true).' }, day: DAY },
    required: ['tracker'],
  },
];

for (const t of [...HEALTH_TOOLS, ...FAMILY_TOOLS]) if (!MODULE_TOOLS.some((x) => x.name === t.name)) MODULE_TOOLS.push(t);
