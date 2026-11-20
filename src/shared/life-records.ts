// Five more modules of the catalogue (Wave 7 part b, 24 Oct 2026; the plan's section 5.3, rows 11, 17, 18, 19 and 21):
//   Memories and Media        "Photo albums, family creative projects (posters, cards), videos · Albums by person and
//                              event; protected faces" (Family-private)
//   Business                  "Releases, customers, marketing campaigns, support, site health · Release log, campaign
//                              board, customer list" (Business: Work-confidential)
//   Systems and Home Lab      "Servers, services, credentials (linked to Secrets), runbooks, monitoring · Service map,
//                              runbooks, health" (Personal; credentials only as links to Secrets)
//   Goals and Habits          "Goals, habits, streaks, reviews · Weekly review, streak calendar" (Health)
//   Reading, Watching and Lists  "Shows, articles, shopping, wish lists · Simple lists with status" (Personal)
//
// Each is made of the vault's shared blocks like the work modules (src/shared/work-modules.ts): its records are plain
// notes of its own note types kept in its folder inside its area; its pages are record views and the shared page parts;
// Today, the bell and its agent tools come from the same notes; its level is its types' default whether the module is
// on or off. Nothing here names anyone's own things. Pure: no files, no Node, no DOM.

import type { RecordModule } from './module-records';

// ── Words each module's records choose from ──────────────────────────────────────────────────────────────────────────

export const ALBUM_KINDS = ['Event', 'Person', 'Trip', 'Year', 'Everyday', 'Collection'] as const;
export const CREATIVE_KINDS = ['Poster', 'Card', 'Invitation', 'Photo book', 'Video', 'Slideshow', 'Craft', 'Story', 'Other'] as const;
export const CREATIVE_STATUSES = ['Idea', 'Making', 'Done', 'Shared'] as const;

export const RELEASE_STATUSES = ['Planned', 'In progress', 'Released', 'Pulled'] as const;
export const CUSTOMER_STATUSES = ['Lead', 'Trial', 'Active', 'Paused', 'Churned'] as const;
export const CUSTOMER_PERIODS = ['Once', 'Monthly', 'Yearly'] as const;
export const CAMPAIGN_CHANNELS = ['LinkedIn', 'Email', 'Website', 'YouTube', 'Instagram', 'Facebook', 'Event', 'Ads', 'Press', 'Other'] as const;
export const CAMPAIGN_STATUSES = ['Idea', 'Planned', 'Live', 'Done', 'Dropped'] as const;
export const POST_STATUSES = ['Draft', 'Scheduled', 'Posted'] as const;
export const SUPPORT_STATUSES = ['New', 'Open', 'Waiting', 'Solved', 'Closed'] as const;
export const SUPPORT_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'] as const;
export const SUPPORT_CHANNELS = ['Email', 'Chat', 'Phone', 'Form', 'Social', 'Other'] as const;
export const WEBSITE_KINDS = ['Website', 'Shop', 'Portal', 'API', 'Docs', 'Other'] as const;
export const WEBSITE_STATUSES = ['Up', 'Slow', 'Down', 'Unknown'] as const;

export const MACHINE_KINDS = ['Server', 'NAS', 'PC', 'Laptop', 'VM', 'Container host', 'Router', 'Raspberry Pi', 'Cloud', 'Other'] as const;
export const MACHINE_STATUSES = ['Up', 'Down', 'Maintenance', 'Retired'] as const;
export const SERVICE_KINDS = ['Web app', 'Database', 'Media', 'Game server', 'Backup', 'DNS', 'VPN', 'Monitoring', 'Storage', 'Automation', 'Other'] as const;
export const SERVICE_STATUSES = ['Up', 'Degraded', 'Down', 'Stopped'] as const;
export const RUNBOOK_EVERY = ['On demand', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'] as const;
export const RUN_RESULTS = ['Done', 'Done with problems', 'Failed'] as const;

export const GOAL_CATEGORIES = ['Health', 'Fitness', 'Money', 'Career', 'Learning', 'Family', 'Home', 'Creative', 'Other'] as const;
export const GOAL_STATUSES = ['Not started', 'On track', 'At risk', 'Achieved', 'Dropped'] as const;
export const HABIT_STATUSES = ['Active', 'Paused', 'Stopped'] as const;
export const REVIEW_MOODS = ['Great', 'Good', 'Okay', 'Hard'] as const;

export const LIST_KINDS = ['Watching', 'Reading', 'Listening', 'Shopping', 'Wish list', 'Places', 'Other'] as const;

// ── The modules ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const MEMORIES: RecordModule = {
  id: 'memories',
  name: 'Memories',
  icon: 'image',
  about: 'Photo albums by event and by person, with who is in each photo, and the family’s creative projects (posters, cards, videos) with their brief and every version.',
  holds: 'Photo albums, videos and family creative projects',
  level: 'family',
  area: 'family',
  folder: 'Memories and Media',
  locked: 'Every photo here is Family-private: an assistant needs your OK each time it uses one.',
  types: [
    {
      id: 'album',
      name: 'Album',
      plural: 'Albums',
      icon: 'image',
      color: 'rose',
      hint: 'Photos and videos of one event, trip, person or year: who is in each and what it was',
      fields: [
        { key: 'kind', kind: 'choice', options: [...ALBUM_KINDS], initial: 'Event' },
        { key: 'date', kind: 'date' },
        { key: 'end', kind: 'date' },
        { key: 'place', kind: 'text' },
        { key: 'people', kind: 'links', linkType: 'person' },
        { key: 'cover', kind: 'text' },
      ],
      template: '## Photos\n\n| File | Who | Caption | Date |\n| --- | --- | --- | --- |\n\n## Notes\n\n',
      sub: 'Albums',
      aliases: ['albums', 'photo album', 'photo albums'],
      empty: { title: 'No albums yet.', line: 'Make an album for an event, a trip or a person, and keep its photos with it.' },
      columns: ['kind', 'date', 'people', 'place'],
      dateProp: 'date',
    },
    {
      id: 'creative-project',
      name: 'Creative project',
      plural: 'Creative projects',
      icon: 'canvas',
      color: 'plum',
      hint: 'A poster, card, invitation, photo book or video the family is making: its brief, who it is for and each version',
      fields: [
        { key: 'kind', kind: 'choice', options: [...CREATIVE_KINDS], initial: 'Poster' },
        { key: 'occasion', kind: 'text' },
        { key: 'people', kind: 'links', linkType: 'person' },
        { key: 'status', kind: 'choice', options: [...CREATIVE_STATUSES], initial: 'Idea' },
        { key: 'due', kind: 'date' },
        { key: 'album', kind: 'link', linkType: 'album' },
      ],
      template: '## Brief\n\n- Purpose: \n- Audience: \n- Tone: \n- Must-haves: \n\n## Notes\n\n',
      sub: 'Creative projects',
      aliases: ['creative projects', 'family project'],
      empty: { title: 'No creative projects yet.', line: 'Start a poster, card or video with its brief, and keep each version with it.' },
      columns: ['kind', 'status', 'due', 'people'],
      dateProp: 'due',
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'image', line: 'On this day, recent albums, the people in them and what the family is making.' },
    { id: 'albums', label: 'Albums', icon: 'image', line: 'Every album by event, trip, person and year. Open one for its photos.' },
    { id: 'people', label: 'By person', icon: 'people', line: 'Each person with the photos they are in, across every album.' },
    { id: 'creative', label: 'Creative projects', icon: 'canvas', line: 'Posters, cards, invitations and videos from idea to shared, each with its brief and versions.' },
  ],
  tools: ['memory_album_list', 'memory_album_get', 'memory_album_add', 'creative_project_list', 'creative_project_add'],
};

export const BUSINESS: RecordModule = {
  id: 'business',
  name: 'Business',
  icon: 'chart',
  about: 'A business of your own: its release log, customers, marketing campaigns and their posts, support items and the health of its websites.',
  holds: 'Releases, customers, campaigns, support and websites',
  level: 'work',
  area: 'business',
  // The Business area is the business: its records go in the area's own folder.
  folder: '',
  locked: 'Logins for its sites and tools go in Secrets, never in a note.',
  types: [
    {
      id: 'release',
      name: 'Release',
      plural: 'Releases',
      icon: 'flag',
      color: 'sky',
      hint: 'A version you shipped or plan to: its product, number, day and what changed',
      fields: [
        { key: 'product', kind: 'text' },
        { key: 'version', kind: 'text' },
        { key: 'date', kind: 'date' },
        { key: 'status', kind: 'choice', options: [...RELEASE_STATUSES], initial: 'Released' },
        { key: 'link', kind: 'url' },
      ],
      template: '## What changed\n\n- \n\n## Notes\n\n',
      sub: 'Releases',
      aliases: ['releases', 'version'],
      empty: { title: 'No releases yet.', line: 'Log each version with its day and what changed.' },
      columns: ['product', 'version', 'date', 'status'],
      dateProp: 'date',
    },
    {
      id: 'customer',
      name: 'Customer',
      plural: 'Customers',
      icon: 'person',
      color: 'clay',
      hint: 'Someone who buys from you: their plan, what they pay, since when and when it renews',
      fields: [
        { key: 'contact', kind: 'text' },
        { key: 'email', kind: 'email' },
        { key: 'plan', kind: 'text' },
        { key: 'status', kind: 'choice', options: [...CUSTOMER_STATUSES], initial: 'Active' },
        { key: 'since', kind: 'date' },
        { key: 'value', kind: 'number' },
        { key: 'period', kind: 'choice', options: [...CUSTOMER_PERIODS], initial: 'Monthly' },
        { key: 'renews', kind: 'date' },
        { key: 'source', kind: 'text' },
      ],
      template: '## Notes\n\n',
      sub: 'Customers',
      aliases: ['customers', 'client', 'clients'],
      empty: { title: 'No customers yet.', line: 'Add a customer with their plan and what they pay.' },
      columns: ['status', 'plan', 'value', 'since'],
      dateProp: 'renews',
    },
    {
      id: 'campaign',
      name: 'Campaign',
      plural: 'Campaigns',
      icon: 'bolt',
      color: 'ochre',
      hint: 'A marketing push: its channel, dates, goal, budget and each post',
      fields: [
        { key: 'channel', kind: 'choice', options: [...CAMPAIGN_CHANNELS], initial: 'LinkedIn' },
        { key: 'status', kind: 'choice', options: [...CAMPAIGN_STATUSES], initial: 'Idea' },
        { key: 'starts', kind: 'date' },
        { key: 'ends', kind: 'date' },
        { key: 'goal', kind: 'text' },
        { key: 'budget', kind: 'number' },
        { key: 'result', kind: 'text' },
      ],
      template: '## Posts\n\n| Date | Channel | What | Status | Link |\n| --- | --- | --- | --- | --- |\n\n## Notes\n\n',
      sub: 'Campaigns',
      aliases: ['campaigns', 'marketing campaign'],
      empty: { title: 'No campaigns yet.', line: 'Plan a campaign and its posts on the board.' },
      columns: ['channel', 'status', 'starts', 'ends'],
      dateProp: 'starts',
    },
    {
      id: 'support-item',
      name: 'Support item',
      plural: 'Support items',
      icon: 'chat',
      color: 'rose',
      hint: 'A question or problem from a customer: who, when, how urgent and where it is up to',
      fields: [
        { key: 'customer', kind: 'link', linkType: 'customer' },
        { key: 'received', kind: 'date' },
        { key: 'status', kind: 'choice', options: [...SUPPORT_STATUSES], initial: 'New' },
        { key: 'priority', kind: 'choice', options: [...SUPPORT_PRIORITIES], initial: 'Normal' },
        { key: 'product', kind: 'text' },
        { key: 'version', kind: 'text' },
        { key: 'channel', kind: 'choice', options: [...SUPPORT_CHANNELS], initial: 'Email' },
      ],
      template: '## What they said\n\n\n## What we did\n\n',
      sub: 'Support',
      aliases: ['support items', 'support ticket', 'ticket'],
      empty: { title: 'No support items yet.', line: 'Add a customer’s question or problem to follow it to solved.' },
      columns: ['customer', 'status', 'priority', 'received'],
      dateProp: 'received',
    },
    {
      id: 'website',
      name: 'Website',
      plural: 'Websites',
      icon: 'globe',
      color: 'teal',
      hint: 'A site, shop or service of the business: its address, its health checks, and when its domain and certificate renew',
      fields: [
        { key: 'url', kind: 'url' },
        { key: 'kind', kind: 'choice', options: [...WEBSITE_KINDS], initial: 'Website' },
        { key: 'status', kind: 'choice', options: [...WEBSITE_STATUSES], initial: 'Unknown' },
        { key: 'checked', kind: 'date' },
        { key: 'host', kind: 'text' },
        { key: 'domain_renews', kind: 'date' },
        { key: 'cert_expires', kind: 'date' },
      ],
      template: '## Checks\n\n| Date | Status | Response | Note |\n| --- | --- | --- | --- |\n\n## Notes\n\n',
      sub: 'Websites',
      aliases: ['websites', 'site health'],
      empty: { title: 'No websites yet.', line: 'Add a site to keep its health checks and renewal days.' },
      columns: ['url', 'status', 'checked', 'domain_renews'],
      dateProp: 'domain_renews',
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'chart', line: 'The latest release, customers, live campaigns, open support and how the sites are.' },
    { id: 'releases', label: 'Release log', icon: 'flag', line: 'Every release, newest first, with what changed.' },
    { id: 'customers', label: 'Customers', icon: 'people', line: 'Every customer with their plan, what they pay and when it renews.' },
    { id: 'campaigns', label: 'Campaigns', icon: 'board', line: 'Each campaign on the board from idea to done, with its posts.' },
    { id: 'support', label: 'Support', icon: 'chat', line: 'Questions and problems from customers, most urgent first.' },
    { id: 'sites', label: 'Website health', icon: 'globe', line: 'Each site’s last checks, and when its domain and certificate renew.' },
  ],
  tools: ['business_release_log', 'business_release_add', 'business_customer_list', 'business_campaign_board', 'business_support_open', 'business_support_add', 'business_site_health'],
};

export const SYSTEMS: RecordModule = {
  id: 'systems',
  name: 'Systems',
  icon: 'computer',
  about: 'Your machines and the services on them as a map, runbooks you can tick through, monitoring notes, and each login linked to Secrets.',
  holds: 'Machines, services, runbooks and monitoring notes',
  level: 'personal',
  area: 'home',
  folder: 'Systems and Home Lab',
  locked: 'Passwords and keys stay in Secrets: a machine or service only links to them, so no note and no assistant ever holds one.',
  types: [
    {
      id: 'machine',
      name: 'Machine',
      plural: 'Machines',
      icon: 'layers',
      color: 'slate',
      hint: 'A server, NAS, PC, VM or router: where it is, its address, what it runs and its health',
      fields: [
        { key: 'kind', kind: 'choice', options: [...MACHINE_KINDS], initial: 'Server' },
        { key: 'role', kind: 'text' },
        { key: 'os', kind: 'text' },
        { key: 'address', kind: 'text' },
        { key: 'location', kind: 'text' },
        { key: 'status', kind: 'choice', options: [...MACHINE_STATUSES], initial: 'Up' },
        { key: 'checked', kind: 'date' },
      ],
      // A new machine writes only what it holds (5 Nov 2026, "your notes are yours"): no empty headings.
      // Credentials appears with the first login, the health log with the first note (src/shared/systems.ts).
      template: '',
      sub: 'Machines',
      aliases: ['machines', 'server', 'servers'],
      empty: { title: 'No machines yet.', line: 'Add a server, NAS or PC to put its services on the map.' },
      columns: ['kind', 'address', 'os', 'status'],
    },
    {
      id: 'service',
      name: 'Service',
      plural: 'Services',
      icon: 'bolt',
      color: 'teal',
      hint: 'Something that runs on a machine (a web app, a database, a game server): its address, port, health and runbook',
      fields: [
        { key: 'kind', kind: 'choice', options: [...SERVICE_KINDS], initial: 'Web app' },
        { key: 'runs_on', kind: 'link', linkType: 'machine' },
        { key: 'url', kind: 'url' },
        { key: 'port', kind: 'text' },
        { key: 'status', kind: 'choice', options: [...SERVICE_STATUSES], initial: 'Up' },
        { key: 'depends_on', kind: 'links', linkType: 'service' },
        { key: 'runbook', kind: 'link', linkType: 'runbook' },
        { key: 'checked', kind: 'date' },
      ],
      // A new service writes only what it holds (5 Nov 2026, "your notes are yours"): no empty headings.
      // Credentials appears with the first login, the health log with the first note (src/shared/systems.ts).
      template: '',
      sub: 'Services',
      aliases: ['services'],
      empty: { title: 'No services yet.', line: 'Add what runs on your machines to see the map and its health.' },
      columns: ['kind', 'runs_on', 'port', 'status'],
    },
    {
      id: 'runbook',
      name: 'Runbook',
      plural: 'Runbooks',
      icon: 'task',
      color: 'sage',
      hint: 'Steps to do a job the same way each time (an update, a restore, a restart), with each run kept',
      fields: [
        { key: 'for', kind: 'links' },
        { key: 'every', kind: 'choice', options: [...RUNBOOK_EVERY], initial: 'On demand' },
        { key: 'last_run', kind: 'date' },
      ],
      template: '## Steps\n\n1. \n\n## Runs\n\n| Date | Result | Note |\n| --- | --- | --- |\n\n## Notes\n\n',
      sub: 'Runbooks',
      aliases: ['runbooks', 'procedure'],
      empty: { title: 'No runbooks yet.', line: 'Write the steps for a job you do now and then, and tick through them next time.' },
      columns: ['for', 'every', 'last_run'],
      dateProp: 'last_run',
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'computer', line: 'What is down, runbooks due and logins not yet in Secrets.' },
    { id: 'map', label: 'Service map', icon: 'graph', line: 'Each machine with the services on it and what they depend on.' },
    { id: 'machines', label: 'Machines', icon: 'server', line: 'Every machine with its address, system and health.' },
    { id: 'services', label: 'Services', icon: 'bolt', line: 'Every service with where it runs, its port and health.' },
    { id: 'runbooks', label: 'Runbooks', icon: 'task', line: 'Steps for each job, when each was last run and what is due.' },
    { id: 'health', label: 'Monitoring', icon: 'chart', line: 'Every health note from every machine and service, newest first.' },
  ],
  tools: ['system_map', 'system_find', 'system_runbook_get', 'system_health_note', 'system_runbook_mark_run', 'system_machine_add', 'system_service_add', 'system_check_now', 'system_status', 'system_action_plan', 'system_runbooks_write', 'system_action_result'],
};

export const GOALS: RecordModule = {
  id: 'goals',
  name: 'Goals',
  icon: 'target',
  about: 'Goals with their milestones and progress, habits ticked off each day on a streak calendar, and a weekly review that writes itself from both.',
  holds: 'Goals, milestones, habits and weekly reviews',
  level: 'health',
  area: 'me',
  folder: 'Goals and Habits',
  locked: '',
  types: [
    {
      id: 'goal',
      name: 'Goal',
      plural: 'Goals',
      icon: 'flag',
      color: 'sage',
      hint: 'Something you are working towards: why, by when, its milestones and how far along it is',
      fields: [
        { key: 'category', kind: 'choice', options: [...GOAL_CATEGORIES], initial: 'Other' },
        { key: 'status', kind: 'choice', options: [...GOAL_STATUSES], initial: 'Not started' },
        { key: 'started', kind: 'date' },
        { key: 'by', kind: 'date' },
        { key: 'unit', kind: 'text' },
        { key: 'start_value', kind: 'number' },
        { key: 'target_value', kind: 'number' },
        { key: 'current', kind: 'number' },
      ],
      template: '## Why\n\n\n## Milestones\n\n| Milestone | Due | Done |\n| --- | --- | --- |\n\n## Notes\n\n',
      sub: 'Goals',
      aliases: ['goals', 'objective'],
      empty: { title: 'No goals yet.', line: 'Set a goal with its milestones to see how far along you are.' },
      columns: ['category', 'status', 'by', 'current'],
      dateProp: 'by',
    },
    {
      id: 'habit',
      name: 'Habit',
      plural: 'Habits',
      icon: 'task',
      color: 'ochre',
      hint: 'Something you do each day or a few times a week, ticked off on its streak calendar',
      fields: [
        { key: 'goal', kind: 'link', linkType: 'goal' },
        { key: 'days_a_week', kind: 'number', initial: '7' },
        { key: 'status', kind: 'choice', options: [...HABIT_STATUSES], initial: 'Active' },
        { key: 'started', kind: 'date' },
      ],
      template: '## Log\n\n\n## Notes\n\n',
      sub: 'Habits',
      aliases: ['habits'],
      empty: { title: 'No habits yet.', line: 'Add a habit to tick it off each day and keep your streak.' },
      columns: ['goal', 'days_a_week', 'status'],
    },
    {
      id: 'goal-review',
      name: 'Goals review',
      plural: 'Goals reviews',
      icon: 'calendar',
      color: 'stone',
      hint: 'One week looked back on: wins, what got in the way, next week’s focus, and how each goal and habit went',
      fields: [
        { key: 'week', kind: 'date' },
        { key: 'mood', kind: 'choice', options: ['', ...REVIEW_MOODS] },
      ],
      template: '## Wins\n\n\n## What got in the way\n\n\n## Focus next week\n\n',
      sub: 'Reviews',
      aliases: ['goals reviews', 'goal review'],
      empty: { title: 'No reviews yet.', line: 'Look back on the week: it starts from your goals and habits.' },
      columns: ['week', 'mood'],
      dateProp: 'week',
    },
  ],
  sections: [
    { id: 'overview', label: 'Overview', icon: 'target', line: 'Today’s habits, each goal’s progress and next milestone, and this week’s review.' },
    { id: 'goals', label: 'Goals', icon: 'flag', line: 'Every goal with its progress, milestones and the day it is due.' },
    { id: 'habits', label: 'Habits', icon: 'check', line: 'Each habit on its streak calendar. Click a day to tick it.' },
    { id: 'review', label: 'Weekly review', icon: 'review', line: 'This week looked back on, started from your goals and habits; earlier weeks below.' },
  ],
  tools: ['goal_list', 'goal_add', 'goal_milestone_done', 'habit_log', 'habit_streaks', 'goal_review_week'],
};

export const LISTS: RecordModule = {
  id: 'lists',
  name: 'Lists',
  icon: 'list',
  about: 'Simple lists with a status for each item: shows to watch, articles and books to read, shopping, wish lists and places to go.',
  holds: 'Watch lists, reading lists, shopping and wish lists',
  level: 'personal',
  area: 'me',
  folder: 'Lists',
  locked: '',
  types: [
    {
      id: 'list',
      name: 'List',
      plural: 'Lists',
      icon: 'task',
      color: 'stone',
      hint: 'A list of things with a status each: shows, books, articles, shopping or a wish list',
      fields: [
        { key: 'kind', kind: 'choice', options: [...LIST_KINDS], initial: 'Other' },
        { key: 'for', kind: 'text' },
      ],
      template: '## Items\n\n| Item | Status | Link | Note | Added |\n| --- | --- | --- | --- | --- |\n',
      sub: '',
      aliases: ['lists', 'watch list', 'reading list', 'shopping list', 'wish list'],
      empty: { title: 'No lists yet.', line: 'Start a watch list, a reading list or the shopping.' },
      columns: ['kind', 'for'],
    },
  ],
  sections: [
    { id: 'overview', label: 'Lists', icon: 'list', line: 'Every list with what is next on it. Add to any of them from here.' },
    { id: 'next', label: 'In progress', icon: 'play', line: 'What you are watching, reading and listening to now.' },
    { id: 'items', label: 'Every item', icon: 'table', line: 'Every item on every list, by list.' },
  ],
  tools: ['list_overview', 'list_get', 'list_add_item', 'list_set_status', 'list_create', 'list_share'],
};

/** These modules, in the order Settings › Packs shows them. */
export const LIFE_RECORD_MODULES: RecordModule[] = [MEMORIES, BUSINESS, SYSTEMS, GOALS, LISTS];
export const LIFE_RECORD_IDS = LIFE_RECORD_MODULES.map((m) => m.id);

/** How many days ahead each says something is coming (a module's options can change it). */
export const LIFE_RECORD_REMIND: Record<string, number> = { memories: 7, business: 30, systems: 7, goals: 7, lists: 0 };

