// Starter templates (8.8, 31 Oct 2026: rival notes apps): ten one-click starts (a CRM, habits, reading, content, a
// trip, a client project, a meeting series, a weekly review, a budget, recipes). Each makes real notes, records and
// saved views in a folder the person names, using only the app's own formats: plain Markdown notes with properties,
// project files written by src/shared/project-file.ts, and saved views written by src/shared/views.ts. No new
// formats. Pure: the window writes the files (state/starterTemplates.ts) and opens the main one; the tests build
// every template and prove each note, record and view opens.

import { emptyProject, serializeProject } from './project-file';
import { cleanFileName } from './paths';
import { defaultView, writeView, type ViewDef } from './views';

export interface StarterFile {
  /** The file's path in the vault, folder first ("CRM/Deals/Acme van signs.md"). */
  path: string;
  text: string;
}

export interface StarterTemplate {
  id: string;
  name: string;
  /** One plain line: what it sets up. */
  words: string;
  /** The folder name offered (the person can change it). */
  folder: string;
  /** Which made file opens after (a view, a project page, a note). */
  open: string;
  /** Every file, with example records dated around `today` (YYYY-MM-DD). */
  files(folder: string, today: string): StarterFile[];
}

/** `today` moved by `days`, still YYYY-MM-DD (calendar arithmetic in UTC: the day is already world-time midnight,
 *  month ends handled by the calendar, not by counting). */
export function plusDays(today: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today.trim());
  const base = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date();
  base.setUTCDate(base.getUTCDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${base.getUTCFullYear()}-${p(base.getUTCMonth() + 1)}-${p(base.getUTCDate())}`;
}

/** "26 Oct 2026" for headings and bodies (en-AU, no leading zero). */
export function longDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${+m[3]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1]} ${m[1]}`;
}

const note = (path: string, front: string, body: string): StarterFile => ({ path, text: `---\n${front}\n---\n${body}` });

function view(path: string, def: ViewDef): StarterFile {
  return { path, text: writeView(def) };
}

function tableView(folder: string, columns: string[], o: { sort?: { prop: string; dir: 'asc' | 'desc' }; summaries?: Record<string, 'count' | 'sum'> } = {}): ViewDef {
  return { ...defaultView({ kind: 'folder', value: folder }, 'table'), columns, ...(o.sort ? { sort: o.sort } : {}), ...(o.summaries ? { summaries: o.summaries } : {}) };
}

// ── 1. CRM: people, companies and a deals board ──────────────────────────────────────────────────────────────

function crmFiles(folder: string, today: string): StarterFile[] {
  const F = (rest: string) => `${folder}/${rest}`;
  return [
    note(F('Start here.md'), 'tags: [crm]', `# Starting your CRM\n\nPeople and companies live as notes, linked to each deal. Move a deal along its board and the deal note keeps the new stage.\n\n- Add a person: a note in People, with their organisation linked.\n- Add a deal: a note in Deals, with its company, contact, value and closing day.\n- The board and the people table read these notes, so they stay current by themselves.\n`),
    note(F('People/Ava Reed.md'), 'type: person\nrole: Office manager\norg: "[[Acme Bakeries]]"\nemail: ava.reed@example.com\nphone: "0412 345 678"', `# Ava Reed\n\nRuns the office at Acme. Prefers email, answers within a day.\n`),
    note(F('People/Liam Cole.md'), 'type: person\nrole: Director\norg: "[[Harbourline Signs]]"\nemail: liam.cole@example.com\nphone: "0423 456 789"', `# Liam Cole\n\nDecides on sign spending. Met at the trade show in September.\n`),
    note(F('Companies/Acme Bakeries.md'), 'industry: Food wholesaler\nsize: "40 staff"\nwebsite: acme-bakeries.example', `# Acme Bakeries\n\nA wholesale bakery supplying cafes across the inner west. Their twelve delivery vans need new signs.\n`),
    note(F('Companies/Harbourline Signs.md'), 'industry: Signwriting\nsize: "8 staff"\nwebsite: harbourline.example', `# Harbourline Signs\n\nSigns for shopfronts and vans. Referred by Priya.\n`),
    note(
      F('Deals/Acme van signs.md'),
      `company: "[[Acme Bakeries]]"\ncontact: "[[Ava Reed]]"\nvalue: 45000\nstage: Prospect\nclose: "${plusDays(today, 21)}"`,
      `# Acme van signs\n\nSigns for twelve vans plus design. Quote sent ${longDay(plusDays(today, -2))}, follow up next week.\n`,
    ),
    note(
      F('Deals/Harbourline install.md'),
      `company: "[[Harbourline Signs]]"\ncontact: "[[Liam Cole]]"\nvalue: 18000\nstage: Negotiation\nclose: "${plusDays(today, 9)}"`,
      `# Harbourline install\n\nThree meeting rooms. Waiting on their cabling dates before signing.\n`,
    ),
    note(
      F('Deals/Bakery shopfront sign.md'),
      `company: "[[Acme Bakeries]]"\ncontact: "[[Ava Reed]]"\nvalue: 3200\nstage: Won\nclose: "${plusDays(today, -6)}"`,
      `# Bakery shopfront sign\n\nOne lit sign for their own bakery. Paid on delivery.\n`,
    ),
    view(F('Views/Deals board.view.json'), { ...defaultView({ kind: 'folder', value: `${folder}/Deals` }, 'board'), groupBy: 'stage', groupOrder: ['Prospect', 'Negotiation', 'Won', 'Lost'], cardProps: ['value', 'close'] }),
    view(F('Views/People.view.json'), tableView(`${folder}/People`, ['role', 'org', 'email'])),
  ];
}

// ── 2. Habit tracker ────────────────────────────────────────────────────────────────────────────────────────

function habitsFiles(folder: string, today: string): StarterFile[] {
  const F = (rest: string) => `${folder}/${rest}`;
  const habit = (name: string, target: string, line: string) =>
    note(F(`${name}.md`), `target: "${target}"\nstreak: 0`, `# ${name}\n\n${line}\n\nTick the days below as you go. The streak counts itself from the ticks, starting at 0, the run here is yours to earn.\n\nWhen today is done, add \`- [x] ${longDay(today)}\` under this line.\n`);
  return [
    note(F('Start here.md'), 'tags: [habits]', `# Keeping your habits\n\nOne note per habit, with its target and its current run. Open a habit and tick today when it is done.\n\n- The table shows every habit with its target and run.\n- Add a habit with a new note: give it a target and a streak of 0.\n`),
    habit('Exercise', '30 minutes, 5 days a week', 'A walk counts. So does the gym.'),
    habit('Read', '20 pages a day', 'Before bed, phone in the other room.'),
    habit('Meditate', '10 minutes a day', 'Morning, after coffee.'),
    habit('In bed by 10', 'Lights out by 10 pm', 'The one that makes the others possible.'),
    view(F('Views/Habits.view.json'), tableView(folder, ['target', 'streak'], { sort: { prop: 'streak', dir: 'desc' } })),
    view(F('Views/Habit cards.view.json'), { ...defaultView({ kind: 'folder', value: folder }, 'cards'), columns: ['target', 'streak'] }),
  ];
}

// ── 3. Reading list ─────────────────────────────────────────────────────────────────────────────────────────

function readingFiles(folder: string, today: string): StarterFile[] {
  const F = (rest: string) => `${folder}/${rest}`;
  const book = (name: string, author: string, status: string, extra: string, line: string) =>
    note(F(`${name}.md`), `type: resource\nauthor: "${author}"\nstatus: ${status}${extra}`, `# ${name}\n\n${line}\n`);
  return [
    note(F('Start here.md'), 'tags: [reading]', `# Your reading list\n\nOne note per book, with where it is up to. Move a book along the board as you start and finish it.\n`),
    book('The Yield', 'Tara June Winch', 'Finished', `\nrating: 5\nfinished: "${plusDays(today, -12)}"`, 'A stunner. Lent it to Mum.'),
    book('any ordinary day', 'Leigh Sales', 'Reading', '\nprogress: "40%"', 'Up to the chapter on grief. Heavy but worth it.'),
    book('The Rosie Project', 'Graeme Simsion', 'To read', '', 'For the plane. Everyone says it is funny.'),
    book('Dark Emu', 'Bruce Pascoe', 'To read', '', 'Book club pick for next month.'),
    book('Boy Swallows Universe', 'Trent Dalton', 'To read', '', 'Brisbane in the eighties. On every list.'),
    view(F('Views/Reading board.view.json'), { ...defaultView({ kind: 'folder', value: folder }, 'board'), groupBy: 'status', groupOrder: ['To read', 'Reading', 'Finished'], cardProps: ['author', 'rating'] }),
    view(F('Views/Books.view.json'), tableView(folder, ['author', 'status', 'rating', 'finished'])),
  ];
}

// ── 4. Content calendar ─────────────────────────────────────────────────────────────────────────────────────

function contentFiles(folder: string, today: string): StarterFile[] {
  const F = (rest: string) => `${folder}/${rest}`;
  const post = (name: string, channel: string, status: string, publish: string, line: string) =>
    note(F(`${name}.md`), `channel: ${channel}\nstatus: ${status}\npublish: "${publish}"`, `# ${name}\n\n${line}\n`);
  return [
    note(F('Start here.md'), 'tags: [content]', `# Your content calendar\n\nOne note per post, with its channel, stage and publishing day. The calendar shows what goes out when, the board shows what needs writing.\n`),
    post('Winter menu launch', 'Blog', 'Draft', plusDays(today, 5), 'Photos booked Thursday. Keep it short: three dishes, one story each.'),
    post('Price rise letter', 'Newsletter', 'Scheduled', plusDays(today, 2), 'Goes to the mailing list Tuesday morning. Proofread once more.'),
    post('Behind the counter video', 'Social', 'Idea', plusDays(today, 12), 'Sixty seconds, morning prep. Ask Jay if he will film.'),
    post('New supplier story', 'Blog', 'Idea', plusDays(today, 19), 'The mill visit. Take the camera.'),
    post('Easter hours', 'Social', 'Published', plusDays(today, -9), 'Went out on both accounts. Pinned for the week.'),
    view(F('Views/Publishing calendar.view.json'), { ...defaultView({ kind: 'folder', value: folder }, 'calendar'), dateProp: 'publish', cardProps: ['channel', 'status'] }),
    view(F('Views/Content board.view.json'), { ...defaultView({ kind: 'folder', value: folder }, 'board'), groupBy: 'status', groupOrder: ['Idea', 'Draft', 'Scheduled', 'Published'], cardProps: ['channel', 'publish'] }),
  ];
}

// ── 5. Trip planner ─────────────────────────────────────────────────────────────────────────────────────────

function tripFiles(folder: string, today: string): StarterFile[] {
  const F = (rest: string) => `${folder}/${rest}`;
  const start = plusDays(today, 30);
  return [
    note(F('Trip.md'), `from: "${start}"\nto: "${plusDays(today, 37)}"\nbudget: 4500\ntravellers: 2`, `# The trip\n\nEight days, two of us. Flights booked, hotels half done. Everything below feeds the calendar and the bookings table.\n\n## Plan\n\n- [x] Flights\n- [x] Travel insurance\n- Hotels for the last three nights\n- Rail passes\n`),
    note(F(`Bookings/Flight over.md`), `date: "${start}"\ncost: 1290\nref: "QF0024"\nwith: Airline`, `# Flight over\n\nSydney to Tokyo, direct. Seats picked, meals ordered.\n`),
    note(F(`Bookings/Hotel in Asakusa.md`), `date: "${start}"\ncost: 980\nref: "HTL88123"\nwith: Hotel`, `# Hotel in Asakusa\n\nFour nights. Cancel free until a week before.\n`),
    note(F(`Bookings/Rail pass.md`), `date: "${plusDays(today, 31)}"\ncost: 410\nref: "RP55401"\nwith: Rail`, `# Rail pass\n\nSeven day pass each. Collect at the airport counter.\n`),
    note(F(`Days/Day 1 arrive.md`), `date: "${start}"`, `# Day 1: arrive\n\nLand mid afternoon. Check in, find dinner near the hotel, early night.\n`),
    note(F(`Days/Day 2 Asakusa.md`), `date: "${plusDays(today, 31)}"`, `# Day 2: Asakusa\n\nMorning markets, the temple, then the river cruise at sunset.\n`),
    view(F('Views/Bookings.view.json'), tableView(`${folder}/Bookings`, ['date', 'cost', 'with', 'ref'], { sort: { prop: 'date', dir: 'asc' }, summaries: { cost: 'sum' } })),
    view(F('Views/Trip calendar.view.json'), { ...defaultView({ kind: 'folder', value: folder }, 'calendar'), dateProp: 'date', cardProps: ['cost'] }),
  ];
}

// ── 6. Client project ───────────────────────────────────────────────────────────────────────────────────────

function clientFiles(folder: string, today: string): StarterFile[] {
  const F = (rest: string) => `${folder}/${rest}`;
  const p = emptyProject('Website refresh');
  p.status = 'active';
  p.health = 'on track';
  p.progress = 15;
  p.owner = 'Mia Tran';
  p.started = today;
  p.due = plusDays(today, 42);
  p.updated = today;
  p.tags = ['client'];
  p.summary = 'A new site for Harbourline Signs: five pages, their words, our build.';
  p.next = [
    { what: 'Send the homepage draft', done: false, who: 'Mia', when: plusDays(today, 4) },
    { what: 'Confirm the photo shoot day', done: false, who: 'Liam', when: plusDays(today, 7) },
    { what: 'Write the services page', done: false },
  ];
  p.dates = [{ when: longDay(plusDays(today, 42)), what: 'Site live', status: 'planned' }];
  p.people = [{ name: 'Liam Cole', role: 'Client' }];
  p.risks = [{ level: 'Medium', what: 'Their photos may arrive late.' }];
  return [
    { path: F('Website refresh.md'), text: serializeProject(p) },
    note(F('Start here.md'), 'tags: [client]', `# Running this client project\n\nThe project page holds the next steps, dates and risks. Meeting notes and working notes sit beside it and show in the table.\n`),
    note(
      F('Meetings/Kickoff.md'),
      `type: meeting\ndate: "${plusDays(today, -3)}"\nattendees: ["Mia Tran", "Liam Cole"]`,
      `# Kickoff\n\nFirst meeting. Liam wants it live before Christmas.\n\n## Decisions\n\n- Five pages, no shop yet.\n- They write, we edit.\n\n## Actions\n\n- [ ] Mia: send the homepage draft\n- [ ] Liam: confirm the photo shoot day\n`,
    ),
    note(F('Notes/Goals.md'), 'tags: [client]', `# Goals\n\nWhat good looks like, agreed at kickoff.\n\n- Live before Christmas.\n- Enquiry form working from day one.\n- Liam can update the gallery himself.\n`),
    view(F('Views/Project notes.view.json'), tableView(folder, ['type', 'date'])),
  ];
}

// ── 7. Meeting series ───────────────────────────────────────────────────────────────────────────────────────

function meetingsFiles(folder: string, today: string): StarterFile[] {
  const F = (rest: string) => `${folder}/${rest}`;
  const last = (n: number) => plusDays(today, -7 * n);
  const instance = (n: number, decisions: string, actions: string) =>
    note(
      F(`Team meeting ${longDay(last(n))}.md`),
      `type: meeting\ndate: "${last(n)}"\nattendees: ["Mia Tran", "Priya Shah", "Tom Nguyen"]`,
      `# Team meeting, ${longDay(last(n))}\n\n## Decisions\n\n${decisions}\n\n## Actions\n\n${actions}\n`,
    );
  return [
    note(F('Series.md'), 'when: "Mondays 10 am"\nwhere: "Front meeting room"\nwho: ["Mia Tran", "Priya Shah", "Tom Nguyen"]', `# Team meeting\n\nHalf an hour, Mondays at 10. What moved, what is stuck, what is next.\n\nStart each week from last week's note: carry the open actions forward.\n`),
    instance(1, '- The oven order goes ahead.', '- [x] Mia: send the oven order\n- [ ] Priya: book the oven fitting'),
    instance(2, '- Easter hours agreed.', '- [x] Tom: confirm the cabling day\n- [x] Mia: file the stock report'),
    view(F('Views/Meetings.view.json'), tableView(folder, ['date', 'attendees'], { sort: { prop: 'date', dir: 'desc' } })),
    view(F('Views/Meetings calendar.view.json'), { ...defaultView({ kind: 'folder', value: folder }, 'calendar'), dateProp: 'date', cardProps: [] }),
  ];
}

// ── 8. Weekly review ────────────────────────────────────────────────────────────────────────────────────────

function weeklyFiles(folder: string, today: string): StarterFile[] {
  const F = (rest: string) => `${folder}/${rest}`;
  const weekOf = (daysAgo: number) => {
    const end = plusDays(today, -daysAgo);
    return { label: `${longDay(plusDays(end, -6))} to ${longDay(end)}`, end };
  };
  const last = weekOf(1);
  const current = weekOf(-6);
  return [
    note(F('How to run it.md'), 'tags: [review]', `# The weekly review\n\nThirty minutes, same time each week.\n\n1. Read last week's review.\n2. List what got done and what slipped, honestly.\n3. Look at next week's calendar and projects.\n4. Pick the three things that matter most.\n5. Write this week's review from the note below.\n`),
    note(
      F('This week.md'),
      `week: "${current.label}"\nstatus: Draft`,
      `# This week: ${current.label}\n\n## Done\n\n- \n\n## Slipped\n\n- \n\n## Next week matters most\n\n1. \n2. \n3. \n`,
    ),
    note(
      F(`Week of ${last.label}.md`),
      `week: "${last.label}"\nstatus: Done`,
      `# Week of ${last.label}\n\n## Done\n\n- Oven order sent.\n- Oven fitting booked.\n\n## Slipped\n\n- Stock report filed late.\n\n## Next week matters most\n\n1. Oven fitting goes well.\n2. Stock report on time.\n3. Book the photo shoot.\n`,
    ),
    view(F('Views/Reviews.view.json'), { ...defaultView({ kind: 'folder', value: folder }, 'list'), columns: ['week', 'status'], sort: { prop: 'week', dir: 'desc' } }),
  ];
}

// ── 9. Simple budget ────────────────────────────────────────────────────────────────────────────────────────

function budgetFiles(folder: string, today: string): StarterFile[] {
  const F = (rest: string) => `${folder}/${rest}`;
  const spend = (name: string, daysAgo: number, amount: number, category: string, shop: string) =>
    note(F(`Spending/${name}.md`), `date: "${plusDays(today, -daysAgo)}"\namount: ${amount}\ncategory: ${category}\nshop: "${shop}"`, `# ${name}\n\n${shop}, ${longDay(plusDays(today, -daysAgo))}.\n`);
  return [
    note(F('Start here.md'), 'tags: [budget]', `# Your budget\n\nOne note per spend, with its day, amount and category. The table adds each category up, the board groups the spending.\n\n- Monthly targets live in Budgets below.\n- Add a spend with a new note in Spending.\n`),
    note(F('Budgets.md'), 'month: monthly', `# Monthly budgets\n\nWhat each category gets a month. Change the numbers to yours.\n\n| Category | Budget |\n| --- | --- |\n| Groceries | 800 |\n| Eating out | 250 |\n| Transport | 180 |\n| Home and utilities | 320 |\n| Subscriptions | 60 |\n`),
    spend('Weekly shop', 1, 142, 'Groceries', 'Harris Farm'),
    spend('Weekly shop', 8, 158, 'Groceries', 'Harris Farm'),
    spend('Dinner out', 3, 86, 'Eating out', 'Spice Room'),
    spend('Opal top up', 5, 50, 'Transport', 'Opal'),
    spend('Power bill', 9, 214, 'Home and utilities', 'Energy Co'),
    spend('Music plan', 12, 13, 'Subscriptions', 'Music Co'),
    view(F('Views/Spending.view.json'), tableView(`${folder}/Spending`, ['date', 'amount', 'category', 'shop'], { sort: { prop: 'date', dir: 'desc' }, summaries: { amount: 'sum' } })),
    view(F('Views/Spending by category.view.json'), { ...defaultView({ kind: 'folder', value: `${folder}/Spending` }, 'board'), groupBy: 'category', cardProps: ['amount', 'date'] }),
  ];
}

// Budget's two "Weekly shop" notes would land on the same file: the second is dated, so each file is its own.
function datedBudgetFiles(folder: string, today: string): StarterFile[] {
  const files = budgetFiles(folder, today);
  const seen = new Map<string, number>();
  return files.map((f) => {
    const n = (seen.get(f.path) ?? 0) + 1;
    seen.set(f.path, n);
    if (n === 1 || !f.path.endsWith('.md')) return f;
    const dated = f.text.match(/^date: "(\d{4}-\d{2}-\d{2})"/m)?.[1] ?? plusDays(today, -n);
    return { ...f, path: f.path.replace(/\.md$/, ` ${dated}.md`) };
  });
}

// ── 10. Recipe book ─────────────────────────────────────────────────────────────────────────────────────────

function recipesFiles(folder: string, today: string): StarterFile[] {
  void today;
  const F = (rest: string) => `${folder}/${rest}`;
  const recipe = (name: string, time: string, serves: number, tags: string, ingredients: string, steps: string) =>
    note(F(`${name}.md`), `time: "${time}"\nserves: ${serves}\ntags: [${tags}]`, `# ${name}\n\n## Ingredients\n\n${ingredients}\n\n## Steps\n\n${steps}\n`);
  return [
    note(F('Start here.md'), 'tags: [recipes]', `# Your recipe book\n\nOne note per recipe, with its time and serves. The cards show them all, the table sorts by time.\n`),
    recipe('Pumpkin soup', '40 min', 6, 'dinner, winter', '- 1 butternut pumpkin\n- 2 onions\n- 1 litre stock\n- Cream to serve', '1. Roast the pumpkin and onion until soft.\n2. Blend with the stock.\n3. Warm through and serve with cream.'),
    recipe('Fried rice', '20 min', 4, 'dinner, quick', '- 3 cups cooked rice\n- 4 eggs\n- Frozen peas and corn\n- Soy sauce', '1. Fry the rice until crisp at the edges.\n2. Push aside and scramble the eggs.\n3. Stir through the rest with soy sauce.'),
    recipe('Banana bread', '1 hr 10 min', 8, 'baking', '- 3 ripe bananas\n- 2 cups flour\n- 1 cup sugar\n- 2 eggs', '1. Mash the bananas and mix everything.\n2. Bake at 170C for an hour.\n3. Cool before slicing.'),
    recipe('Greek salad', '15 min', 4, 'lunch, quick', '- 4 tomatoes\n- 1 cucumber\n- Feta\n- Olives and olive oil', '1. Chop everything chunky.\n2. Crumble the feta over.\n3. Dress with oil and rest five minutes.'),
    view(F('Views/Recipe cards.view.json'), { ...defaultView({ kind: 'folder', value: folder }, 'cards'), columns: ['time', 'serves'] }),
    view(F('Views/Recipes.view.json'), tableView(folder, ['time', 'serves'], { sort: { prop: 'time', dir: 'asc' } })),
  ];
}

// ── The ten ───────────────────────────────────────────────────────────────────────────────────────────────────

export const STARTER_TEMPLATES: StarterTemplate[] = [
  { id: 'crm', name: 'CRM', words: 'People, companies and a deals board, linked together.', folder: 'CRM', open: 'Views/Deals board.view.json', files: crmFiles },
  { id: 'habits', name: 'Habit tracker', words: 'A note per habit with its target, run and ticks.', folder: 'Habits', open: 'Views/Habits.view.json', files: habitsFiles },
  { id: 'reading', name: 'Reading list', words: 'Books with their stage, from to read to finished.', folder: 'Reading', open: 'Views/Reading board.view.json', files: readingFiles },
  { id: 'content', name: 'Content calendar', words: 'Posts with channel, stage and publishing day.', folder: 'Content', open: 'Views/Publishing calendar.view.json', files: contentFiles },
  { id: 'trip', name: 'Trip planner', words: 'Bookings with costs and a day by day plan.', folder: 'Trip', open: 'Views/Trip calendar.view.json', files: tripFiles },
  { id: 'client', name: 'Client project', words: 'A project page with meetings and working notes.', folder: 'Client project', open: 'Website refresh.md', files: clientFiles },
  { id: 'meetings', name: 'Meeting series', words: 'A series with past notes, decisions and actions.', folder: 'Team meeting', open: 'Views/Meetings.view.json', files: meetingsFiles },
  { id: 'weekly', name: 'Weekly review', words: 'How to run it, this week blank, last week filled.', folder: 'Weekly reviews', open: 'This week.md', files: weeklyFiles },
  { id: 'budget', name: 'Simple budget', words: 'Spends with amounts and monthly targets.', folder: 'Budget', open: 'Views/Spending.view.json', files: datedBudgetFiles },
  { id: 'recipes', name: 'Recipe book', words: 'Recipes with time and serves, as cards.', folder: 'Recipes', open: 'Views/Recipe cards.view.json', files: recipesFiles },
];

export const STARTER_IDS = STARTER_TEMPLATES.map((t) => t.id);

export const starterById = (id: string): StarterTemplate | undefined => STARTER_TEMPLATES.find((t) => t.id === id);

/** A folder name the person typed, tidied (blank falls back to the template's own). */
export function cleanStarterFolder(name: string, fallback: string): string {
  // Dot segments never survive (fnv3 F39): a typed folder stays inside the vault by construction.
  const clean = String(name ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => cleanFileName(s, '', 80))
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
  return clean || fallback;
}

/** Every file a template makes in `folder` (the folder first in each path), dated around `today`. Every note is
 *  stamped `starter: <id>`, so example notes are never mistaken for the person's own records — and a manifest note
 *  lists the run, so the examples can be found and removed in one go. */
export function starterFiles(id: string, folder: string, today: string): StarterFile[] {
  const t = starterById(id);
  if (!t) throw new Error(`There is no starter template called "${id}".`);
  const at = cleanStarterFolder(folder, t.folder);
  const files = t.files(at, today).map((f) =>
    f.path.toLowerCase().endsWith('.md') && f.text.startsWith('---\n') ? { ...f, text: f.text.replace(/^---\n/, `---\nstarter: ${id}\n`) } : f,
  );
  const manifest = note(
    `${at}/Starter manifest.md`,
    `starter: ${id}\ntemplate: ${t.name}`,
    `# Starter manifest: ${t.name}\n\nThese notes are examples from the “${t.name}” starter, made ${longDay(today)}. They are not your records. Change them into your own, or delete the “${at}” folder to remove them all.\n\n${files.map((f) => `- ${f.path}`).join('\n')}\n`,
  );
  return [...files, manifest];
}

/** Which made file opens after a template is started (the full path in the vault). */
export function starterOpenPath(id: string, folder: string): string {
  const t = starterById(id);
  if (!t) throw new Error(`There is no starter template called "${id}".`);
  return `${cleanStarterFolder(folder, t.folder)}/${t.open}`;
}

/** A starter file split for window.nv.files.create (folder, base name, extension). */
export function splitStarterPath(path: string): { folder: string; base: string; ext: '.md' | '.view.json' } {
  const ext: '.md' | '.view.json' = path.toLowerCase().endsWith('.view.json') ? '.view.json' : '.md';
  const without = path.slice(0, -ext.length);
  const slash = without.lastIndexOf('/');
  return slash < 0 ? { folder: '', base: without, ext } : { folder: without.slice(0, slash), base: without.slice(slash + 1), ext };
}
