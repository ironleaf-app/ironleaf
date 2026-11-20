// The ironleaf command (21 Oct 2026, gap G26): Ironleaf from a terminal, a script or another program. The command is
// a small script registered with the installed app (src/main/windows-entry.ts); it hands its words to the running
// Ironleaf on this PC (src/main/cli.ts), which reads them here and runs the same verbs agents use. Documented in
// docs/CLI-AND-LINKS.md.
//
// Pure: the words read into a command, and the help. Shared by the app and the tests.

import { isBoxDone } from './finished';
import { TASK_LINE, trackFence, type Fence } from './markdown';

export type CliVerb = 'open' | 'read' | 'search' | 'create' | 'append' | 'daily:append' | 'property:set' | 'tasks' | 'mcp' | 'help' | 'version';

export type CliCommand =
  | { verb: 'open'; note: string }
  | { verb: 'read'; note: string }
  | { verb: 'search'; query: string; limit: number }
  | { verb: 'create'; path: string; text: string; open: boolean }
  | { verb: 'append'; note: string; text: string; heading: string }
  | { verb: 'daily:append'; text: string; heading: string }
  | { verb: 'property:set'; note: string; name: string; value: string; list: boolean }
  | { verb: 'tasks'; show: 'open' | 'done' | 'all'; note: string; limit: number }
  | { verb: 'mcp' }
  | { verb: 'help'; about: string }
  | { verb: 'version' };

export type CliParsed = { ok: true; command: CliCommand } | { ok: false; error: string };

/** Each verb: how it is written, and what it does (the help, in this order). */
export const CLI_VERBS: { verb: CliVerb; usage: string; words: string; writes: boolean }[] = [
  { verb: 'open', usage: 'ironleaf open <note>', words: 'Open a note in Ironleaf’s window (by its title or its path).', writes: false },
  { verb: 'read', usage: 'ironleaf read <note>', words: 'Print a note as it is written, its properties first.', writes: false },
  { verb: 'search', usage: 'ironleaf search <words> [--limit 10]', words: 'Search the notes: "quoted phrases", OR, -word, tag:#name and path:folder work.', writes: false },
  { verb: 'create', usage: 'ironleaf create <path> [--text <words>] [--open]', words: 'Make a new note (folders are made as needed). Text can also come in on the pipe.', writes: true },
  { verb: 'append', usage: 'ironleaf append <note> <words> [--heading <heading>]', words: 'Add words to the end of a note, or under one of its headings.', writes: true },
  { verb: 'daily:append', usage: 'ironleaf daily:append <words> [--heading <heading>]', words: 'Add words to today’s note (made when it isn’t there yet).', writes: true },
  { verb: 'property:set', usage: 'ironleaf property:set <note> <name> <value> [--list]', words: 'Set one of a note’s properties. An empty value takes it away; --list keeps a comma-separated value as a list.', writes: true },
  { verb: 'tasks', usage: 'ironleaf tasks [--done | --all] [--note <note>] [--limit 200]', words: 'List the tick-boxes in your notes: open ones unless --done or --all.', writes: false },
  { verb: 'mcp', usage: 'ironleaf mcp', words: 'Run the Vault’s MCP server for other AI apps on this PC (used by their set-up, not typed by hand).', writes: true },
  { verb: 'help', usage: 'ironleaf help [verb]', words: 'Show this help, or one verb’s.', writes: false },
  { verb: 'version', usage: 'ironleaf version', words: 'Show Ironleaf’s version.', writes: false },
];

/** Words longer than this aren't taken from a command line (a pipe can bring a whole note). */
export const CLI_TEXT_MAX = 200_000;

const FLAGS: Record<string, { value: boolean; verbs: CliVerb[] }> = {
  limit: { value: true, verbs: ['search', 'tasks'] },
  text: { value: true, verbs: ['create', 'append', 'daily:append'] },
  heading: { value: true, verbs: ['append', 'daily:append'] },
  open: { value: false, verbs: ['create'] },
  list: { value: false, verbs: ['property:set'] },
  done: { value: false, verbs: ['tasks'] },
  all: { value: false, verbs: ['tasks'] },
  note: { value: true, verbs: ['tasks'] },
};

const ALIASES: Record<string, CliVerb> = { find: 'search', new: 'create', daily: 'daily:append', 'property-set': 'property:set', 'daily-append': 'daily:append', '--help': 'help', '-h': 'help', '/?': 'help', '--version': 'version', '-v': 'version' };

/** A command's words read. `stdin` is what came in on the pipe (it stands in for missing words, or for a lone "-"). */
export function parseCli(argv: readonly string[], stdin = ''): CliParsed {
  const args = argv.map((a) => String(a ?? ''));
  if (!args.length) return { ok: true, command: { verb: 'help', about: '' } };
  const first = args[0].trim().toLowerCase();
  const verb = (CLI_VERBS.find((v) => v.verb === first)?.verb ?? ALIASES[first]) as CliVerb | undefined;
  if (!verb) return { ok: false, error: `There is no command called “${args[0].slice(0, 60)}”. Type ironleaf help to see them.` };
  const words: string[] = [];
  const flags: Record<string, string | true> = {};
  let rest = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (rest || !a.startsWith('--') || a === '--' ) {
      if (a === '--' && !rest) {
        rest = true;
        continue;
      }
      words.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = (eq > 0 ? a.slice(2, eq) : a.slice(2)).toLowerCase();
    const spec = FLAGS[name];
    if (!spec || !spec.verbs.includes(verb)) return { ok: false, error: `${verb} doesn’t take --${name.slice(0, 40)}. Type ironleaf help ${verb}.` };
    if (!spec.value) {
      flags[name] = true;
      continue;
    }
    const value = eq > 0 ? a.slice(eq + 1) : args[++i];
    if (value === undefined) return { ok: false, error: `--${name} needs a value after it.` };
    flags[name] = value;
  }
  const piped = stdin.replace(/\r\n?/g, '\n');
  const textOf = (given: string | undefined): string => {
    const t = given === undefined || given === '-' ? piped : given.replace(/\r\n?/g, '\n');
    return t.slice(0, CLI_TEXT_MAX);
  };
  const limitOf = (fallback: number, max: number): number | string => {
    if (flags.limit === undefined) return fallback;
    const n = Number(flags.limit);
    return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : '--limit is a whole number, such as 10.';
  };
  const need = (n: number, what: string): string | null => (words.length < n ? `${verb} needs ${what}. Type ironleaf help ${verb}.` : null);
  const tooMany = (n: number): string | null => (words.length > n ? `${verb} was given more words than it uses. Put words with spaces in quotes.` : null);
  const fail = (error: string): CliParsed => ({ ok: false, error });

  switch (verb) {
    case 'help':
      return { ok: true, command: { verb, about: (words[0] ?? '').toLowerCase() } };
    case 'version':
      return { ok: true, command: { verb } };
    case 'open':
    case 'read': {
      const e = need(1, 'a note’s title or path') ?? tooMany(1);
      return e ? fail(e) : { ok: true, command: { verb, note: words[0].trim() } };
    }
    case 'search': {
      if (!words.length) return fail('search needs the words to look for.');
      const limit = limitOf(10, 50);
      if (typeof limit === 'string') return fail(limit);
      const query = words.join(' ').trim().slice(0, 300);
      return query ? { ok: true, command: { verb, query, limit } } : fail('search needs the words to look for.');
    }
    case 'create': {
      const e = need(1, 'the new note’s path, such as "Inbox/Idea.md"') ?? tooMany(2);
      if (e) return fail(e);
      const text = textOf(typeof flags.text === 'string' ? flags.text : words[1] ?? (piped ? '-' : ''));
      return { ok: true, command: { verb, path: words[0].trim(), text, open: flags.open === true } };
    }
    case 'append': {
      const e = need(1, 'the note to add to') ?? tooMany(2);
      if (e) return fail(e);
      const text = textOf(typeof flags.text === 'string' ? flags.text : words[1]);
      if (!text.trim()) return fail('append needs the words to add (after the note, in quotes, or on the pipe).');
      return { ok: true, command: { verb, note: words[0].trim(), text, heading: typeof flags.heading === 'string' ? flags.heading.trim() : '' } };
    }
    case 'daily:append': {
      const e = tooMany(1);
      if (e) return fail(e);
      const text = textOf(typeof flags.text === 'string' ? flags.text : words[0]);
      if (!text.trim()) return fail('daily:append needs the words to add (in quotes, or on the pipe).');
      return { ok: true, command: { verb, text, heading: typeof flags.heading === 'string' ? flags.heading.trim() : '' } };
    }
    case 'property:set': {
      const e = need(2, 'a note and a property’s name (then its value)') ?? tooMany(3);
      if (e) return fail(e);
      const name = words[1].trim();
      if (!/^[^\s:#][^:\n]{0,80}$/.test(name)) return fail('A property’s name is a short word or two, without a colon.');
      return { ok: true, command: { verb, note: words[0].trim(), name, value: (words[2] ?? '').slice(0, 2000), list: flags.list === true } };
    }
    case 'tasks': {
      const e = tooMany(0);
      if (e) return fail(e);
      if (flags.done && flags.all) return fail('Choose --done or --all, not both.');
      const limit = limitOf(200, 2000);
      if (typeof limit === 'string') return fail(limit);
      return { ok: true, command: { verb, show: flags.all ? 'all' : flags.done ? 'done' : 'open', note: typeof flags.note === 'string' ? flags.note.trim() : '', limit } };
    }
    case 'mcp': {
      const e = tooMany(0);
      if (e) return fail(e);
      return { ok: true, command: { verb } };
    }
  }
}

/** The help: every verb, or one. */
export function cliHelp(about = ''): string {
  const one = CLI_VERBS.find((v) => v.verb === about || ALIASES[about] === v.verb);
  if (one) return `${one.usage}\n  ${one.words}${one.writes ? '\n  It changes your notes; File recovery keeps the earlier version.' : ''}\n`;
  const width = Math.max(...CLI_VERBS.map((v) => v.usage.length));
  return [
    'ironleaf: your Ironleaf notes from the command line.',
    '',
    ...CLI_VERBS.map((v) => `  ${v.usage.padEnd(width)}  ${v.words}`),
    '',
    'A note is named by its title ("Site walk") or its path ("Meetings/Site walk.md"). Words with spaces go in quotes.',
    'Ironleaf opens by itself when it isn’t running. Private notes are never reached from here.',
    '',
  ].join('\n');
}

/** Whether a command changes the notes. */
export const cliWrites = (c: CliCommand): boolean => CLI_VERBS.find((v) => v.verb === c.verb)?.writes ?? false;

/** A property's value as written on the command line: true/false, numbers, an empty value (taken away) or words; with
 *  --list, words split at commas. */
export function propertyValue(raw: string, list = false): string | number | boolean | string[] | null {
  const s = raw.trim();
  if (!s) return null;
  if (list) return s.split(',').map((x) => x.trim()).filter(Boolean);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^-?\d{1,15}(\.\d+)?$/.test(s) && !/^-?0\d/.test(s)) return Number(s);
  return s;
}

export interface TaskLine {
  path: string;
  line: number;
  done: boolean;
  text: string;
}

/** The tick-boxes in a note's words (fenced code is skipped), with their line numbers from 1. */
export function tasksIn(path: string, content: string): TaskLine[] {
  const out: TaskLine[] = [];
  let fence: Fence | null = null;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const st = trackFence(l, fence);
    fence = st.fence;
    if (st.skip) continue;
    const m = TASK_LINE.exec(l);
    if (m) out.push({ path, line: i + 1, done: isBoxDone(m[2]), text: m[4].trim() });
  }
  return out;
}
