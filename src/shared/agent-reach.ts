// What every AI reaching Ironleaf was missing (8.0 V1, TR3, V6 and V7; 28 Oct 2026). Four tools, part of the one
// catalogue (src/shared/vault-tools.ts), so Ironleaf's side chat, the former host app's conversations, a chat bot
// and its bots, and outside agents over MCP all have them:
//  - files_find: "where did my X go" answered from the vault itself: every file Ironleaf keeps, with the record it
//    belongs to (a project, a meeting, a person, an area, a module's record), where it came from and when;
//  - tasks_list and calendar_get: the person's tasks across the notes and today's calendar, as Today shows them;
//  - reminder_set: one meaning of "remind me": Ironleaf's own ⏰ line, which its bell, Today and a chat bot all say.
// The main side is src/main/agent-access.ts (dispatch).

import type { AgentToolDef } from './agent-access';

const S = (description: string) => ({ type: 'string', description });
const N = (description: string) => ({ type: 'number', description });

/** The four tools, from the least they can do to the most. */
export const REACH_TOOLS: AgentToolDef[] = [
  {
    name: 'files_find',
    title: 'Find a file',
    level: 'read',
    readOnly: true,
    description:
      'Where a file is in Ironleaf, answered from the vault itself: every file it keeps (filed beside a project, a meeting, a person, an area or a module’s record, in the asset store, or linked where it is on this PC) and the files in projects’ folders, matched by name, title, what it is and where it came from (a file filed from Downloads is found by its old name and folder too). Each one says the record it belongs to (that page shows it), its path, kind, size, when it was added and from where, newest first. Use it whenever the person wants to know where a file went or whether something was filed, and to check a filing before saying it is done.',
    input: { query: S('Words from its name, what it is, or where it came from ("keg steamer", "logo", "Downloads").'), limit: N('At most this many (default 15, at most 40).') },
    required: ['query'],
  },
  {
    name: 'tasks_list',
    title: 'Tasks',
    level: 'read',
    readOnly: true,
    description:
      'The tasks across the notes (every tick-box line, reminders too), as the Tasks view lists them: the words, the note and project each is in, its day and time; overdue first. when: overdue, today, week (the next 7 days), none (no day) or any (the default). status: open (the default), done or all. Use it for what the person has to do, by when.',
    input: {
      when: { type: 'string', enum: ['any', 'overdue', 'today', 'week', 'none'] },
      status: { type: 'string', enum: ['open', 'done', 'all'] },
      text: S('Only tasks whose words (or their note’s name) have these words.'),
      project: S('Only tasks in this project (its name).'),
      limit: N('At most this many (default 50).'),
    },
  },
  {
    name: 'calendar_get',
    title: 'Today’s calendar',
    level: 'read',
    readOnly: true,
    description: 'Today’s events from the connected calendar, as Today shows them: time, title, where and who; or why there are none (not connected, signed out). A meeting note for one is made with template_apply or note_create.',
    input: {},
  },
  {
    name: 'reminder_set',
    title: 'Set a reminder',
    level: 'edit',
    description:
      'Remind the person of something at a moment: Ironleaf’s reminder (a task line with ⏰ and its moment), which its bell, a Windows notification, and Today all say when it comes due; the person can snooze or tick it. Whenever the person wants to be told of something at a moment, however they say it, this is the reminder. what: the thing, in the person’s words. when: the moment exactly as they said it (“on Friday”, “tomorrow at 3pm”, “in 2 hours”, “23 Oct”, “every Monday at 6pm”); never add a time or day they didn’t say. note: only when it belongs in a particular note (a project, a meeting); otherwise it goes in Reminders. When a reminder already set is close to this one (its words overlap at about the same moment), nothing is written: the answer names it — ask the person whether to replace it or keep both, then call again with the same what and when plus "replace": true (this one takes its place) or "replace": false (set as well). Returns the day and time it is set for.',
    input: { what: S('What to remind them of, in their words.'), when: S('When, exactly as they said it.'), note: S('A note’s path or title, only when the reminder belongs in it.'), replace: { type: 'boolean', description: 'Answering a Replace-or-Keep offer: true replaces the reminder it named, false sets this one as well.' } },
    required: ['what', 'when'],
  },
];
