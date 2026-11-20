// Life modules (Wave 5, 24 Oct 2026; the module catalogue, 22 Oct: "Each module below is first-class like Projects: its
// own record type with set fields, its own views, what Today shows from it, automations, agent tools, and a default
// sensitivity level"). A module is switched on in Settings › Packs, off by default. Off, it adds nothing: no place on the
// left side, no page, nothing on Today, no agent tools, no background work and no data files; switched off again it hides
// and keeps everything it holds. A module can have parts (Health and Fitness: training, food and water, sleep…), each
// with its own switch under the module's.
//
// The switches are the person's (personal.json, so they follow them to their other PCs); what each module holds lives
// where its own file says (Health and Fitness: an encrypted store on this PC, src/main/health-store.ts; Family: notes in
// the vault's Family area, src/shared/family.ts). Pure: no files, no Node, no DOM.

import type { Level } from './sensitivity';

export interface ModulePart {
  id: string;
  name: string;
  words: string;
}

export interface LifeModule {
  id: string;
  name: string;
  /** Earlier names the pack still answers to (30 Oct 2026: short names everywhere, old names still find the pack):
   *  Settings search and the assistants match these as well as the name. */
  aliases?: string[];
  /** The icon's name (components/Icon.tsx). */
  icon: string;
  /** What it holds, in a line (Settings › Packs, its page's header). */
  words: string;
  /** The area of life it belongs with (src/shared/areas.ts), and the level its records get unless the person says. */
  area: string;
  level: Level;
  /** Where its records are kept, in words (Settings says it beside the switch). */
  kept: string;
  parts: ModulePart[];
  /** Its offer on Today while it is off and the vault shows it would be used (src/shared/module-records.ts moduleOffers):
   *  what those notes are about (a record module's own `holds` unless given), what switching it on does, and the words that
   *  say a note or an Inbox item is about it (a record module's own note types count as well). Every module has one
   *  (tests/module-offers.test.mjs), so a module added to this catalogue is offered in its own words, never another's. */
  offer?: ModuleOfferWords;
  /** Set up your life (8.0 Phase 5): the plain question on Today that switches it on with a Yes ("Do you have a car?"). */
  ask: string;
  /** What fills it on its own and how (8.0 Phase 5, "fills itself"): the first words of its empty pages and its tour. */
  fills: string;
  /** Its first-open tour's example: one record as it would look, made up and labelled as an example. */
  example: { title: string; lines: string[] };
}

export interface ModuleOfferWords {
  about?: string;
  does: string;
  signals?: RegExp;
}

export const LIFE_MODULES: LifeModule[] = [
  {
    id: 'health',
    name: 'Health',
    aliases: ['Health and Fitness'],
    icon: 'heart',
    words: 'Training, food, sleep and check-ups, with streaks and trends.',
    area: 'health',
    level: 'health',
    kept: 'Kept on this PC only, encrypted, with the key protected by Windows. Never sent to an assistant unless you ask it something specific, and then only the entries that answer it.',
    parts: [
      { id: 'checkin', name: 'Daily check-in', words: 'A few quick questions a day, with streaks.' },
      { id: 'training', name: 'Training', words: 'Plans, sessions, exercises and personal bests.' },
      { id: 'food', name: 'Food and water', words: 'Meals, water and daily targets.' },
      { id: 'sleep', name: 'Sleep', words: 'Hours slept and how well.' },
      { id: 'body', name: 'Body', words: 'Weight and measurements, with estimates labelled as estimates.' },
      { id: 'habits', name: 'Habits', words: 'Any yes or no you want to keep each day, with streaks.' },
      { id: 'appointments', name: 'Appointments and results', words: 'GP and other visits, reminders, and results.' },
    ],
    offer: {
      about: 'training, sleep, food and health appointments',
      does: 'Switch it on for a daily check-in, training and sleep with their trends, and appointments with reminders, kept encrypted on this PC.',
      signals: /\b(workouts?|gym (?:session|day)|training (?:plan|session|log)|personal best|\bpb\b|hours? (?:of )?sleep|sleep (?:log|score)|calories|kcal|weigh-?in|body fat|blood pressure|gp appointment|physio|check-?up)\b/i,
    },
    ask: 'Do you want to keep track of training, food, sleep or your weight?',
    fills: 'A short daily check-in fills it as you answer, and the assistant logs a session, a meal or a measurement when you tell it in the chat.',
    example: { title: 'Today’s check-in', lines: ['Slept 7 h 20 min, felt good', 'Walked 6.2 km, 2 glasses of water so far', 'Weight 78.4 kg (down 0.6 kg this month)'] },
  },
  {
    id: 'family',
    name: 'Family',
    // Memories merged into Family (packs uplift item 5, 5 Nov 2026): the old names still find the pack.
    aliases: ['Memories', 'Memories and Media', 'photo albums'],
    icon: 'people',
    words: 'Who’s where, milestones, rewards, documents and photo albums.',
    area: 'family',
    level: 'family',
    kept: 'Kept as notes in your Family area, marked Family-private: agents read them only if you allow it, and a family photo needs your OK each time it is used.',
    parts: [
      { id: 'calendar', name: 'Who’s where', words: 'School, activities and events on one calendar.' },
      { id: 'milestones', name: 'Milestones', words: 'Firsts and big moments, by person.' },
      { id: 'rewards', name: 'Reward trackers', words: 'Streaks that earn rewards at the days you choose.' },
      { id: 'documents', name: 'Documents', words: 'Each person’s documents in one place.' },
      { id: 'albums', name: 'Photo albums', words: 'Photo albums for events, trips, people and years.' },
      { id: 'people', name: 'Who is in each photo', words: 'Name the people in a photo to see every photo of someone, across albums.' },
      { id: 'creative', name: 'Creative projects', words: 'Posters, cards and videos with their brief and each version.' },
      { id: 'onthisday', name: 'On this day', words: 'An album from this day in an earlier year, on Today.' },
    ],
    offer: {
      about: 'the family’s school, activities, events, milestones and photo albums',
      does: 'Switch it on for one calendar of who’s where, milestones by person, reward trackers and protected photo albums.',
      signals: /\b(school (?:pick-?up|drop-?off|run|holidays|newsletter|excursion|concert|assembly)|parent-teacher|swimming lessons?|(?:soccer|footy|netball|dance|piano) (?:practice|training|lessons?|game)|birthday party|pocket money|chore chart|reward chart|first (?:tooth|steps|day of school)|photo albums?|holiday photos|family photos|birthday photos|wanted poster|invitations?|photo book|slideshow|home videos?)\b/i,
    },
    ask: 'Do you want to keep the family’s school, activities, events and photo albums in one place?',
    fills: 'Events, activities and milestones go on the calendar as you add them; school and club notices you capture in the Inbox file here in one click; photos you add fill the albums.',
    example: { title: 'Mia: swimming', lines: ['Every Tuesday 4:30 pm at the aquatic centre', 'Next: carnival Friday 14 Nov', 'Reward: 8 of 10 practice days ticked'] },
  },
  // Finance and Documents and ID (Wave 5 part a): their records are notes of their own types in the module's folder
  // inside an area (src/shared/module-records.ts, src/shared/finance.ts, src/shared/id-documents.ts).
  {
    id: 'finance',
    name: 'Money',
    aliases: ['Finance'],
    icon: 'wallet',
    words: 'Bills and subscriptions, spending, budgets and accounts.',
    area: 'me',
    level: 'personal',
    kept: 'Kept as notes in Me › Finance, marked Personal. Account numbers and logins go in Secrets, never in a note.',
    parts: [
      { id: 'bills', name: 'Bills and subscriptions', words: 'Due days on Today and in the bell, price changes noticed.' },
      { id: 'spending', name: 'Spending and budgets', words: 'Monthly spend from your bank’s CSV and receipts, beside your budgets.' },
      { id: 'accounts', name: 'Accounts', words: 'The accounts bills come out of, with balances.' },
    ],
    offer: { does: 'Switch it on to see what’s due on Today and where the money goes.' },
    ask: 'Do you pay bills or subscriptions, or want to see where your money goes?',
    fills: 'Import your bank’s CSV and each month’s spending fills itself by category, and bills found in your notes are offered; Add from a file keeps statements and receipts for the chat assistant to read.',
    example: { title: 'Internet: $89.00 monthly', lines: ['Due 3 Nov, paid by direct debit from Everyday', 'Category: Phone and internet', 'Went up from $79.00 in August'] },
  },
  {
    id: 'documents',
    name: 'Papers',
    aliases: ['Documents and ID'],
    icon: 'idcard',
    words: 'Passports, licences and policies, with reminders before expiry.',
    area: 'me',
    level: 'personal',
    kept: 'Kept as notes in Me › Documents and ID, marked Personal. Numbers are kept in Secrets and shown only when Secrets are unlocked.',
    parts: [],
    offer: { does: 'Switch it on to be reminded before each one expires, with its number kept in Secrets.' },
    ask: 'Do you want a reminder before a passport, licence or policy expires?',
    fills: 'Expiry reminders come by themselves once a document is added (its expiry day, never the number, which you keep in Secrets); Add from a file keeps scans for the chat assistant to read.',
    example: { title: 'Passport: Alex', lines: ['Issued by the Australian Passport Office', 'Expires 12 Mar 2029, reminder 60 days before', 'Number locked in Secrets'] },
  },
  // Home, Vehicles, Career and Travel (Wave 7 part a): their records are notes in their folders inside the Home and Me
  // areas (src/shared/personal-modules.ts; each module's own file: house.ts, vehicles.ts, career.ts, travel.ts).
  {
    id: 'house',
    name: 'House',
    aliases: ['Home'],
    icon: 'home',
    words: 'Appliances, warranties, maintenance and household notes.',
    area: 'home',
    level: 'personal',
    kept: 'Kept as notes in Home › House, marked Personal, manuals and receipts beside each appliance. Wi-Fi and router passwords go in Secrets, never in a note.',
    parts: [
      { id: 'maintenance', name: 'Maintenance schedule', words: 'Jobs that come round, on Today and in the bell when due.' },
      { id: 'warranties', name: 'Warranty reminders', words: 'A reminder before an appliance’s warranty ends.' },
    ],
    offer: {
      about: 'appliances, warranties, maintenance and utilities at home',
      does: 'Switch it on to keep appliances with their warranties and manuals, and be told when maintenance is due.',
      signals: /\b(appliances?|dishwasher|washing machine|air ?con(?:ditioner)?|hot water (?:system|service)|clean(?:ing)? the gutters|smoke alarms?|warranty card|user manual|electricity bill|gas bill|water bill|landlord)\b/i,
    },
    ask: 'Do you want your home’s appliances, warranties and upkeep in one place?',
    fills: 'Jobs that come round put themselves on Today when due; Add from a file keeps manuals, labels, receipts and invoices for the chat assistant to read.',
    example: { title: 'Dishwasher: Bosch Serie 6', lines: ['Kitchen, bought 4 Feb 2025 from The Good Guys', 'Warranty until 4 Feb 2027', 'Filter cleaned 2 Oct; next due 2 Jan'] },
  },
  {
    id: 'vehicles',
    name: 'Cars',
    aliases: ['Vehicles'],
    icon: 'car',
    words: 'Rego, insurance, services, fuel and the distance log.',
    area: 'home',
    level: 'personal',
    kept: 'Kept as a note per vehicle in Home › Vehicles, marked Personal, with its papers beside it.',
    parts: [
      { id: 'fuel', name: 'Fuel log', words: 'Fill-ups with their price, and fuel use between full tanks.' },
      { id: 'reminders', name: 'Rego, insurance and service reminders', words: 'On Today and in the bell before each is due.' },
    ],
    offer: {
      about: 'cars, rego, servicing and fuel',
      does: 'Switch it on to be told before rego, insurance or a service is due, and to see your fuel use trend.',
      signals: /\b(rego|registration (?:due|renewal)|car insurance|odometer|log ?book service|car service|fill(?:ed)? up|petrol|diesel|tyres|roadworthy)\b/i,
    },
    ask: 'Do you have a car, motorbike, trailer or boat?',
    fills: 'Reminders for rego, insurance and the next service come by themselves; the rego papers, the insurance certificate and fuel receipts go in as you add them.',
    example: { title: 'Family wagon: Subaru Outback', lines: ['Rego ABC123, due 14 Mar 2027', 'Insured with NRMA until 31 Jan 2027', 'Next service at 85,000 km or 1 Feb'] },
  },
  {
    id: 'career',
    name: 'Career',
    icon: 'career',
    words: 'Applications, interviews, letters and the people you deal with.',
    area: 'me',
    level: 'personal',
    kept: 'Kept as notes in Me › Career, marked Personal. CV versions stay in Papers; an application links to the one it went with.',
    parts: [
      { id: 'interviews', name: 'Interview reminders', words: 'An interview on Today and in the bell the day before.' },
      { id: 'followups', name: 'Follow-ups', words: 'An application’s next step on Today when its day comes.' },
    ],
    offer: {
      about: 'job applications, cover letters and interviews',
      does: 'Switch it on to follow each application from applied to offer, with its interviews, letter and CV.',
      signals: /\b(job application|applied for|cover letter|job interview|interview (?:with|for|on)|recruiter|job offer|offer letter|hiring manager|position description)\b/i,
    },
    ask: 'Are you looking for work, or want to keep your applications and CVs in order?',
    fills: 'Interviews and follow-ups come onto Today by themselves; Add from a file keeps job ads, CVs and cover letters for the chat assistant to read.',
    example: { title: 'Product designer at Harbour Lane', lines: ['Applied 20 Oct with CV v4 and its cover letter', 'Interview Thursday 6 Nov, 10:00 am', 'Next: send the portfolio link'] },
  },
  {
    id: 'travel',
    name: 'Trips',
    aliases: ['Travel'],
    icon: 'plane',
    words: 'Flights, hotels, itineraries, documents and trip spending.',
    area: 'me',
    level: 'personal',
    kept: 'Kept as a note per trip in Me › Travel, marked Personal, boarding passes and bookings beside each trip.',
    parts: [
      { id: 'reminders', name: 'Trip reminders', words: 'A trip coming up, and the day’s flights and check-ins while away, on Today and in the bell.' },
      { id: 'forecast', name: 'Budget and forecast', words: 'Spending against each trip’s budget, and travel’s forecast by month.' },
    ],
    offer: {
      about: 'trips, flights and hotels',
      does: 'Switch it on to keep each trip’s flights, hotels and documents together, and spending against its budget.',
      signals: /\b(flights?|boarding pass|itinerary|hotel booking|booking (?:ref(?:erence)?|confirmation)|check-?in|airport|trip to|travel insurance|accommodation)\b/i,
    },
    ask: 'Are you planning a trip, or want bookings and itineraries in one place?',
    fills: 'Trip spending adds up against the budget by itself; Add from a file keeps bookings and tickets for the chat assistant to read.',
    example: { title: 'Tasmania: 10 to 17 Jan', lines: ['Flight QF1517, 7:05 am, booking ref XK7PQ2', 'Hobart apartment, 7 nights', 'Spent $1,240 of a $2,500 budget'] },
  },
  // The work modules (Wave 6 part b): their records are notes in the Work area (src/shared/work-modules.ts); a meeting is
  // the vault's own Meeting note.
  {
    id: 'meetings',
    name: 'Meetings',
    icon: 'calendar',
    words: 'Notes, decisions and actions for every meeting, with prep packs.',
    area: 'work',
    level: 'open',
    kept: 'Kept as your meeting notes in Work › Meetings. A meeting in a project has its actions as that project’s tasks.',
    parts: [
      { id: 'series', name: 'Series', words: 'Meetings that come round, each started from the last.' },
      { id: 'prep', name: 'Prep packs', words: 'Before a meeting, what is open with the people coming.' },
    ],
    offer: { does: 'Switch it on to see what’s coming up with a prep pack, and each meeting’s actions as its project’s tasks.' },
    ask: 'Do you have meetings whose notes, decisions and actions you want kept?',
    fills: 'The meeting recorder or a transcript you bring in fills a meeting’s notes, decisions and actions; meetings in your calendar come up with a prep pack; a meeting in a project has its actions as that project’s tasks.',
    example: { title: 'Weekly site check-in', lines: ['Tue 4 Nov, 9:00 am with Sam and Priya', 'Decided: order the second router', 'Action: Priya to book the electrician by Friday'] },
  },
  {
    id: 'weekly',
    name: 'Weekly',
    aliases: ['Weekly Update'],
    icon: 'review',
    words: 'One status update a week, started from last week’s.',
    area: 'work',
    level: 'open',
    kept: 'Kept as one note a week in Work › Weekly Updates. Metrics are kept as numbers, so each one shows as a trend.',
    parts: [],
    offer: { does: 'Switch it on to keep each week’s update by workstream, start the next from the last, and send it as text, Word or PDF.' },
    ask: 'Do you send a weekly status update?',
    fills: 'Each week’s update starts from last week’s, workstream by workstream; the assistant drafts it from your projects’ notes and numbers when you ask, and it goes out as text, Word or PDF.',
    example: { title: 'Week of 27 Oct', lines: ['Fit-out: on track, 70% (was 60%)', 'Network: at risk, waiting on the switch delivery', 'Next: hand-over walk-through Friday'] },
  },
  {
    id: 'sites',
    name: 'Sites',
    aliases: ['Sites and Equipment'],
    icon: 'server',
    words: 'Sites, rooms, devices, patch points and warranty dates.',
    area: 'work',
    level: 'open',
    kept: 'Kept as notes in Work › Sites and Equipment, a note per site and per device, photos beside each.',
    parts: [
      { id: 'patch', name: 'Patch points', words: 'Each site’s patch points and the patch schedule.' },
      { id: 'lifecycle', name: 'Warranty and end of life', words: 'Warranty and end-of-life dates on Today and in the bell.' },
    ],
    offer: { does: 'Switch it on to keep each site’s rooms, devices, patch points and warranties in one register.' },
    ask: 'Do you look after sites, rooms and equipment (devices, serials, patch points)?',
    fills: 'Warranty and end-of-life dates come onto Today by themselves; Add from a file keeps device labels, inventories and patch spreadsheets for the chat assistant to read.',
    example: { title: 'Level 2 comms room', lines: ['Switch: Cisco C9200, serial FOC2234X0AB', 'Patch panel A, ports 1–24 mapped', 'Warranty ends 30 Jun 2027'] },
  },
  {
    id: 'vendors',
    name: 'Suppliers',
    aliases: ['Vendors, Quotes and Contracts', 'Vendors Quotes and Contracts'],
    icon: 'briefcase',
    words: 'Vendors, quotes, orders and contracts, compared and reminded.',
    area: 'work',
    level: 'work',
    kept: 'Kept as notes in Work › Vendors and Contracts, marked Work-confidential: agents read them only if you allow it.',
    parts: [
      { id: 'orders', name: 'Purchase orders', words: 'Orders raised with vendors, from raised to paid.' },
      { id: 'contracts', name: 'Contracts', words: 'Contracts with their notice and renewal dates.' },
    ],
    offer: { does: 'Switch it on to be told before a quote lapses or a contract ends, and to compare quotes side by side.' },
    ask: 'Do you deal with vendors, quotes, purchase orders or contracts?',
    fills: 'A reminder comes before a quote lapses or a contract ends; Add from a file keeps quotes and contracts for the chat assistant to read.',
    example: { title: 'Quote: Harbour Electrical', lines: ['$4,820 inc. GST for the switchboard upgrade', 'Valid until 21 Nov', 'Linked to the Shopfront project'] },
  },
  // Memories and Media, Business, Systems and Home Lab, Goals and Habits, and Reading, Watching and Lists (Wave 7 part b):
  // their records are notes in their folders inside their areas (src/shared/life-records.ts). Memories stood here
  // until the packs uplift item 5 (5 Nov 2026) merged it into Family: one home for albums, by-person and creative
  // projects under Family, with the old id resolving there (MODULE_ALIASES) and the record machinery untouched
  // (src/shared/life-records.ts MEMORIES still answers when Family is on).
  {
    id: 'business',
    name: 'Business',
    icon: 'chart',
    words: 'Releases, customers, campaigns, support and site health.',
    area: 'business',
    level: 'work',
    kept: 'Kept as notes in your Business area, marked Work-confidential: agents read them only if you allow it.',
    parts: [
      { id: 'support', name: 'Support', words: 'Questions and problems from customers, on Today while open.' },
      { id: 'sites', name: 'Website health', words: 'Health checks, and a reminder before a domain or certificate runs out.' },
    ],
    offer: {
      about: 'releases, customers, campaigns and support for your business',
      does: 'Switch it on to keep the release log, customers, campaigns, support and site health of your business together.',
      signals: /\b(release notes?|changelog|customers?|churn(?:ed)?|subscribers?|marketing campaigns?|launch posts?|support (?:tickets?|requests?|items?)|domain renew\w*|ssl cert\w*)\b/i,
    },
    ask: 'Do you run a business of your own?',
    fills: 'Releases, campaigns and support items are logged here as they happen; drop in a customer’s email or a screenshot and it is added; your websites’ health is checked for you.',
    example: { title: 'Release 2.4', lines: ['Shipped 27 Oct: new checkout and faster search', 'Campaign: spring sale, 3 posts scheduled', '2 support items open'] },
  },
  {
    id: 'systems',
    name: 'Systems',
    aliases: ['Systems and Home Lab'],
    icon: 'computer',
    words: 'Machines and services as a map, with runbooks and logins.',
    area: 'home',
    level: 'personal',
    kept: 'Kept as notes in Home › Systems and Home Lab, marked Personal. Passwords and keys stay in Secrets: a note only links to them.',
    parts: [
      { id: 'runbooks', name: 'Runbooks', words: 'Steps for each job, and a reminder when one is due.' },
      { id: 'monitoring', name: 'Monitoring', words: 'Health notes, and what is down on Today.' },
    ],
    offer: {
      about: 'servers, services and the home lab',
      does: 'Switch it on to map your machines and services, keep runbooks you can tick through, and link each login to Secrets.',
      signals: /\b(home ?lab|proxmox|unraid|truenas|docker(?: compose)?|containers?|reverse proxy|runbooks?|ip address|hostname|uptime kuma|backup jobs?|nas)\b/i,
    },
    ask: 'Do you run servers, a NAS or a home lab?',
    fills: 'It checks each machine on its own every 15 minutes once it has its address and login, writes its runbooks, and says so when one drops; logins stay in Secrets.',
    example: { title: 'NAS: syn-01', lines: ['Synology DS920+, 192.168.1.20', 'Running: Plex, Hyper Backup, Docker', 'Health: good, 41% full, checked today'] },
  },
  {
    id: 'goals',
    name: 'Goals',
    aliases: ['Goals and Habits'],
    icon: 'target',
    words: 'Goals with milestones, habits with streaks, weekly review.',
    area: 'me',
    level: 'health',
    kept: 'Kept as notes in Me › Goals and Habits, marked Health: agents read them only if you allow it.',
    parts: [
      { id: 'habits', name: 'Habits and streaks', words: 'Tick habits each day, from Today too.' },
      { id: 'review', name: 'Weekly review', words: 'A look back on each week, on Today on its day.' },
    ],
    offer: {
      about: 'goals and habits',
      does: 'Switch it on to keep goals with milestones, tick habits on a streak calendar and look back on each week.',
      signals: /\b(my goals?|goals? for|new habits?|habit tracker|streak|milestones? (?:for|towards)|resolutions?|save up for)\b/i,
    },
    ask: 'Do you have goals or habits you want to keep track of?',
    fills: 'Add a goal or a habit here and tick it to keep the streak; the weekly review starts itself from both, and Health’s habits join in.',
    example: { title: 'Run a half marathon', lines: ['Milestone: 15 km by 1 Dec (12 km done)', 'Habit: run 3 times a week, 5-week streak', 'Weekly review: on track'] },
  },
  {
    id: 'lists',
    name: 'Lists',
    aliases: ['Reading, Watching and Lists', 'Reading Watching and Lists'],
    icon: 'list',
    words: 'Watch, reading, shopping and wish lists, each item with a status.',
    area: 'me',
    level: 'personal',
    kept: 'Kept as one note per list in Me › Lists, marked Personal.',
    parts: [{ id: 'shopping', name: 'Shopping on Today', words: 'What is still needed on a shopping list, on Today.' }],
    offer: {
      about: 'things to watch, read and buy',
      does: 'Switch it on to keep watch lists, reading lists, shopping and wish lists with a status for each item.',
      signals: /\b(watch ?list|to watch|reading list|to read|shopping list|wish ?list|grocer(?:y|ies) list|shows? to watch|podcasts? to)\b/i,
    },
    ask: 'Do you keep lists of shows, books, shopping or places to go?',
    fills: 'Tell the assistant “add Severance to my watch list” in the chat and it goes on the list; a link to a book or a show you capture in the Inbox files here in one click.',
    example: { title: 'Watch list', lines: ['Severance: watching, season 2', 'The Bear: to watch', 'Slow Horses: watched, 5 stars'] },
  },
  // Publications (Wave 6 part a): publications, editions and their pieces are notes in the Publications area
  // (src/shared/publication-module.ts, src/shared/publications.ts).
  {
    id: 'publications',
    name: 'Publications',
    icon: 'newspaper',
    words: 'Household newsletters and papers, laid out, printed and sent.',
    area: 'publications',
    level: 'family',
    kept: 'Kept as notes in Publications, marked Family-private: agents read them only if you allow it. Each edition’s PDF is kept with it.',
    parts: [
      { id: 'puzzles', name: 'Puzzle engine', words: 'Crosswords, sudoku, word searches and the daily word, with answers next edition and solve times.' },
      { id: 'delivery', name: 'Printing and sending on a schedule', words: 'Each edition printed on your printer and sent by email at the publication’s time.' },
    ],
    offer: { does: 'Switch it on to lay out each edition on real pages, keep every piece with its source, and print or send it on a schedule.' },
    ask: 'Would you like a household newsletter or paper made for you?',
    fills: 'Once set up, each edition builds itself on its schedule from its sections’ sources, then prints and sends by email; pieces and puzzles fill in as each edition is made.',
    example: { title: 'The Weekend Post, No. 12', lines: ['Front page: the school fete raised $3,400', 'Inside: weather, footy ladder, a crossword', 'Emailed to the family, Saturday 7:00 am'] },
  },
];

/** A pack id that no longer stands alone, and the pack that answers for it now (packs uplift item 5, 5 Nov 2026:
 *  Memories merged into Family; old tabs, links and saved switches read as Family so nothing saved breaks). */
export const MODULE_ALIASES: Record<string, string> = { memories: 'family' };
export const resolveModule = (id: string): string => MODULE_ALIASES[id] ?? id;

export const moduleInfo = (id: string): LifeModule | undefined => LIFE_MODULES.find((m) => m.id === resolveModule(id));

/** Modules grouped by the area of life each belongs to, as the person's Areas setting says (8.0 R2): the areas in
 *  their order and under their own names, then any area a module names that the setting doesn't have. Used by
 *  Settings › Packs and by Today › Set up your life, so both always agree. */
export function modulesByArea(mods: readonly LifeModule[], areas: readonly { id: string; name: string }[] | null | undefined, defaults: readonly { id: string; name: string }[] = []): { id: string; name: string; mods: LifeModule[] }[] {
  const nameOf = (id: string) => areas?.find((a) => a.id === id)?.name ?? defaults.find((a) => a.id === id)?.name ?? id;
  const order = [...(areas ?? defaults).map((a) => a.id), ...mods.map((m) => m.area)].filter((v, i, a) => a.indexOf(v) === i);
  return order.map((id) => ({ id, name: nameOf(id), mods: mods.filter((m) => m.area === id) })).filter((g) => g.mods.length);
}

/** One module's switches as kept: on or off, and its parts that are switched off (every part is on unless listed). */
export interface ModuleSwitch {
  on: boolean;
  off?: string[];
}
export type ModuleSwitches = Record<string, ModuleSwitch>;

/** The switches checked (an older or hand-edited file: anything it doesn't understand is left out). */
export function cleanModules(raw: unknown, current: ModuleSwitches = {}): ModuleSwitches {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return current;
  const out: ModuleSwitches = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>).slice(0, 40)) {
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(id) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const off = Array.isArray(o.off) ? [...new Set(o.off.filter((x): x is string => typeof x === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(x)))].slice(0, 30) : [];
    out[id] = { on: o.on === true, ...(off.length ? { off } : {}) };
  }
  // Memories merged into Family (packs uplift item 5): a vault that had Memories on keeps its albums page
  // (Family switches on), with its parts' switches carried across. Idempotent: converges once the key is gone.
  const mem = out.memories;
  if (mem) {
    delete out.memories;
    const fam = out.family ?? { on: false };
    const off = [...new Set([...(fam.off ?? []), ...(mem.off ?? [])])];
    out.family = { on: fam.on || mem.on, ...(off.length ? { off } : {}) };
  }
  return out;
}

/** Whether a module is on (off by default, every pack alike; 3 Nov 2026 audit f F2: Meetings is a real
 *  pack now, so off hides all of it — no row, no page, no tools — and on shows it, like every other pack). */
export const moduleOn = (switches: ModuleSwitches | undefined, id: string): boolean => !!switches?.[resolveModule(id)]?.on && !!moduleInfo(id);

/** Whether one of a module's parts shows (the module on, and the part not switched off). */
export const partOn = (switches: ModuleSwitches | undefined, id: string, part: string): boolean => moduleOn(switches, id) && !switches?.[resolveModule(id)]?.off?.includes(part);

/** The modules switched on, in the catalogue's order. */
export const modulesOn = (switches: ModuleSwitches | undefined): LifeModule[] => LIFE_MODULES.filter((m) => moduleOn(switches, m.id));

/** The switches with one module (or one of its parts) turned on or off. */
export function withSwitch(switches: ModuleSwitches | undefined, id: string, on: boolean, part?: string): ModuleSwitches {
  const now = { ...(switches ?? {}) };
  const was = now[id] ?? { on: false };
  if (!part) {
    now[id] = { ...was, on };
    return now;
  }
  const off = new Set(was.off ?? []);
  if (on) off.delete(part);
  else off.add(part);
  now[id] = { on: was.on, ...(off.size ? { off: [...off] } : {}) };
  return now;
}
