// Publications' agent tools (Wave 6 part a, 24 Oct 2026; the rule for every module: "Agents get tools per module … and
// access per sensitivity level"). Offered to the side chat, outside agents, the former host app and a chat bot
// (through src/shared/module-tools.ts) only while Publications is on; every call goes through the asking agent's gate
// at the level of the notes it reads or writes (Family-private unless the person set another), carried out by
// src/main/publications.ts. Pure: words and schemas only.

export interface PublicationToolDef {
  name: string;
  module: 'publications';
  write: boolean;
  title: string;
  step: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
}

const PUB = { type: 'string', description: 'The publication by its name (the only one when there is just one).' };
const ITEM = {
  type: 'object',
  properties: {
    kind: { type: 'string', description: 'Headline story, Brief, Weather, Sports table, Image, Cartoon strip, Quote or On this day (puzzles come from puzzle_generate).' },
    section: { type: 'string', description: 'The section it goes in (one of the publication’s sections).' },
    headline: { type: 'string' },
    deck: { type: 'string', description: 'A standfirst under a story’s headline (optional).' },
    body: { type: 'string', description: 'The words, as Markdown. Weather and sports tables as a Markdown table.' },
    source: { type: 'string', description: 'Where it came from (the outlet’s name). Needed where the section says so.' },
    source_url: { type: 'string' },
    credit: { type: 'string', description: 'A picture’s or cartoon’s credit.' },
    who: { type: 'string', description: 'Who said a quote.' },
    image: { type: 'string', description: 'A picture already in the vault, by its path.' },
    lead: { type: 'boolean', description: 'The front page’s lead story.' },
  },
  required: ['kind', 'headline'],
  additionalProperties: false,
};

export const PUBLICATION_TOOLS: PublicationToolDef[] = [
  {
    name: 'publication_list',
    module: 'publications',
    write: false,
    title: 'Publications',
    step: 'Looked through your publications',
    description: 'The person’s publications (Ironleaf › Publications): each one’s masthead, schedule and delivery, its sections with their page budgets, sources and rules, the latest editions with their status, and when the next one is due. Read this before building an edition: the sources and rules are the person’s.',
    parameters: { type: 'object', properties: { publication: PUB }, additionalProperties: false },
  },
  {
    name: 'publication_search',
    module: 'publications',
    write: false,
    title: 'Search the archive',
    step: 'Searched every edition',
    description: 'Search every edition and piece of the person’s publications, puzzles’ answers and the editions’ PDFs included, in plain words: "the crossword with BOLAND in it", "every Storm story", "the cartoon about the long weekend". Each hit says which edition it ran in.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, publication: PUB }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'publication_edition',
    module: 'publications',
    write: false,
    title: 'An edition',
    step: 'Looked at an edition',
    description: 'One edition (the latest unless a number is given): its status, its pieces section by section with their sources, how its pages fill against each section’s budget, its PDF and how it was delivered.',
    parameters: { type: 'object', properties: { publication: PUB, number: { type: 'number' } }, additionalProperties: false },
  },
  {
    name: 'publication_next',
    module: 'publications',
    write: false,
    title: 'Is the next edition ready?',
    step: 'Checked whether the next edition is ready',
    description: 'Whether the next edition is ready, in plain words: when it is due, who receives it (Telegram, email, print, as set), each section’s page budget, the pieces waiting for each section, and any section with nothing waiting. Use it a day or so before an edition is due.',
    parameters: { type: 'object', properties: { publication: PUB }, additionalProperties: false },
  },
  {
    name: 'publication_edition_build',
    module: 'publications',
    write: true,
    title: 'Build an edition',
    step: 'Put an edition together',
    description: 'Put the day\'s edition together in one call: its pieces (each with its source) and pieces kept earlier (by path), in the sections given. One edition per day: building again for that day replaces its pieces and keeps its number, so give every piece it should have each time (never a test or second edition). Each piece is kept inside the edition\'s note, never a note of its own; the last edition’s puzzle answers are added on their own. Says how each section fills its page budget and what runs over. With pdf true it also lays the pages out and keeps the PDF with the edition. Never make up news, results or sources.',
    parameters: {
      type: 'object',
      properties: {
        publication: PUB,
        date: { type: 'string', description: 'YYYY-MM-DD (today unless given).' },
        number: { type: 'number', description: 'Its number (the next one unless given).' },
        items: { type: 'array', items: ITEM, description: 'New pieces.' },
        pieces: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, section: { type: 'string' } }, required: ['path'], additionalProperties: false }, description: 'Pieces kept earlier (puzzles from puzzle_generate), by path: they stay in the edition.' },
        template: { type: 'string', description: 'Broadsheet, Classic or Tabloid (the publication’s own unless given).' },
        pdf: { type: 'boolean', description: 'Lay out the pages and keep the PDF (default true).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'publication_item_add',
    module: 'publications',
    write: true,
    title: 'Add a piece',
    step: 'Added a piece to Publications',
    description: 'Put one piece (a story, brief, weather, sports table, picture, cartoon, quote or on-this-day) with its source into the day’s edition (made when there is none), inside its note. A piece with the same headline is replaced. For a whole edition use publication_edition_build once instead. A section that names its sources takes only those.',
    parameters: { type: 'object', properties: { publication: PUB, ...ITEM.properties }, required: ['kind', 'headline'], additionalProperties: false },
  },
  {
    name: 'publication_setup',
    module: 'publications',
    write: true,
    title: 'Set up a publication',
    step: 'Set up a publication',
    description: 'Set a paper or newsletter up in one call, made when it is new: its masthead and motto, schedule ("Mon, Fri 07:00"), sections (name, pages, sources, rules), delivery (Telegram, email, printer, print) and look (template Broadsheet, Classic or Tabloid; ink; greyscale; justify; masthead, headline and body fonts and the crest, as files on this PC or in the vault). Only what is given changes. Then each edition is research and one publication_edition_build.',
    parameters: {
      type: 'object',
      properties: {
        publication: { type: 'string', description: 'Its name (made when there is none by that name).' },
        masthead: { type: 'string' },
        motto: { type: 'string' },
        schedule: { type: 'string', description: 'Days and a time, like "Mon, Fri 07:00".' },
        template: { type: 'string', description: 'Broadsheet, Classic or Tabloid.' },
        sections: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, pages: { type: 'number' }, sources: { type: 'string' }, rules: { type: 'string' } }, required: ['name'], additionalProperties: false } },
        telegram: { type: 'boolean' },
        email: { type: 'array', items: { type: 'string' } },
        printer: { type: 'string' },
        print: { type: 'boolean' },
        ink: { type: 'string', description: 'A colour like #111111.' },
        greyscale: { type: 'boolean' },
        justify: { type: 'boolean' },
        masthead_font: { type: 'string', description: 'A font file on this PC or in the vault.' },
        head_font: { type: 'string' },
        body_font: { type: 'string' },
        body_faces: { type: 'array', items: { type: 'string' }, description: 'The body font\'s bold and italic files.' },
        crest: { type: 'string', description: 'A picture on this PC or in the vault.' },
      },
      required: ['publication'],
      additionalProperties: false,
    },
  },
  {
    name: 'puzzle_generate',
    module: 'publications',
    write: true,
    title: 'Make a puzzle',
    step: 'Made a puzzle',
    description: 'Make a puzzle and keep it, with its answers, as a piece of a publication: a crossword from answers and clues ("clues": lines of "ANSWER — clue"), a sudoku (difficulty easy, medium or hard; it always has exactly one answer), a word search (words; ways easy or hard) or a daily word (answer, or words to choose from). Its answers print in the next edition by themselves.',
    parameters: {
      type: 'object',
      properties: {
        publication: PUB,
        kind: { type: 'string', enum: ['crossword', 'sudoku', 'wordsearch', 'dailyword'] },
        title: { type: 'string', description: 'Its title ("Around the house").' },
        section: { type: 'string', description: 'The section it goes in (the publication’s puzzles section unless given).' },
        clues: { type: 'string', description: 'Crossword: one per line, "ANSWER — clue".' },
        words: { type: 'array', items: { type: 'string' }, description: 'Word search: the words to hide. Daily word: words to choose the answer from.' },
        answer: { type: 'string', description: 'Daily word: the word to find.' },
        difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
        ways: { type: 'string', enum: ['easy', 'hard'] },
        size: { type: 'number', description: 'Crossword or word search: the most squares across.' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'puzzle_solve_time',
    module: 'publications',
    write: true,
    title: 'Record a solve time',
    step: 'Recorded a solve time',
    description: 'Record how long someone in the household took to solve a puzzle ("Mia did the crossword in 12:30"). The puzzle by its path, or by kind and edition number (the latest edition unless given).',
    parameters: { type: 'object', properties: { publication: PUB, puzzle: { type: 'string', description: 'The puzzle piece’s path.' }, kind: { type: 'string', enum: ['crossword', 'sudoku', 'wordsearch', 'dailyword'] }, number: { type: 'number', description: 'The edition it was in.' }, who: { type: 'string' }, time: { type: 'string', description: '"12:30", "4 min 5 s".' }, day: { type: 'string', description: 'YYYY-MM-DD (today unless given).' } }, required: ['who', 'time'], additionalProperties: false },
  },
  {
    name: 'publication_edition_deliver',
    module: 'publications',
    write: true,
    title: 'Send or print an edition',
    step: 'Sent an edition',
    description: 'Send a built edition’s PDF the ways the publication is set to (email, print, or a chat when one is connected) and print it on the publication’s printer, now. "how" picks some of them. Only after the person asks for it to go out.',
    parameters: { type: 'object', properties: { publication: PUB, number: { type: 'number', description: 'The edition (the latest unless given).' }, how: { type: 'array', items: { type: 'string', enum: ['telegram', 'email', 'print'] } } }, additionalProperties: false },
  },
];

export const PUBLICATION_TOOL_NAMES = PUBLICATION_TOOLS.map((t) => t.name);
export const isPublicationTool = (name: string) => PUBLICATION_TOOL_NAMES.includes(name);
