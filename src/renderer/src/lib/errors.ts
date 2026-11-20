// One cleaner for failures and engine-supplied words (9.2 uplift F22, F23, F60, F98): every error the person
// meets reads through errorMessage, every successful job result through resultWords, Markdown through
// stripMarkdown. Raw detail (paths, codes, engine wrappers) goes to the console, never the toast or the card.
// Pure, so tests pin it directly; every renderer surface calls it rather than stripping prefixes of its own.

/** Electron's remote-method wrapper off an error's message (the words the main side threw, if it threw words). */
const unwrap = (raw: string): string => raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').trim();

/** Failures the person meets, in their own words. Anything else passes through as the main side said it. */
const KNOWN: [RegExp, string][] = [
  // Disk-full and file-locked failures only ever come from saving (Nov 2026, nv-save F4): the words say the save
  // didn't land, and the editor keeps the words and tries again — never a code.
  [/ENOSPC|EDQUOT/i, 'The disk is full, so that couldn’t be saved.'],
  [/EBUSY/i, 'Another program has that file open, so it couldn’t be saved just now.'],
  [/ENOENT/i, 'A file it needed is missing.'],
  // A renamed note past what the file system keeps (t212, 11 Nov 2026: a 2,000-character rename met the one
  // calm line with no hint it was the name): the name is the news.
  [/ENAMETOOLONG/i, 'That name is too long.'],
  [/EACCES|EPERM/i, 'It didn’t have permission to do that.'],
  [/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i, 'The network didn’t answer.'],
  [/\b(cancelled|canceled|aborted?)\b/i, 'Stopped.'],
  // A failure the platform itself couldn't name (t18, 8 Nov 2026: a canvas save failed with 'Unknown
  // system error -122' and the code toasted as written): no code or number the person could use.
  [/\bUnknown system error\b/i, 'Something didn’t work just then.'],
];

/** Whether a message still looks like engine output (a path, a code, a wrapped error) rather than words. */
const looksEngine = (words: string): boolean =>
  /[A-Za-z]:[\\/]|(?:^|[\s("'])\/(?:[\w\-. ]+\/)+[\w\-. ]+|\b[A-Z][A-Za-z]+Error\b|\bError: /.test(words);

/** JavaScript and browser failures (a bug's words, never the person's): "Cannot read properties of…", "Failed to
 *  execute…", "…is not a function" (p14-words, 4 Nov 2026: they passed through as written, into toasts). */
const ENGINE: RegExp[] = [
  /cannot (read|set) propert/i, // V8: Cannot read/set properties of undefined/null
  /can't access property/i, // SpiderMonkey
  /(undefined|null) is not an object/i, // JavaScriptCore
  /is not a function/i,
  /is not defined/i,
  /failed to execute/i, // a Web API refused its arguments
  /illegal (constructor|invocation)/i,
];

/** A bare value or a status the person could never act on (t207, 10 Nov 2026: 'undefined' and
 *  'HTTP 500' passed through as written, into toasts). */
const BARE: RegExp[] = [
  /^(undefined|null|\[object [^\]]*\])$/,
  /^\[object /,
  /HTTP \d/,
  /status code \d/i,
];

/** A failure in plain words for the person. Never empty; never a path, a code, or an engine wrapper. */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const words = unwrap(raw);
  for (const [pattern, said] of KNOWN) if (pattern.test(words)) return said;
  if (!words || looksEngine(words) || ENGINE.some((p) => p.test(words)) || BARE.some((p) => p.test(words))) {
    if (raw && raw !== words) console.warn('Ironleaf kept engine detail from the person:', raw);
    return 'Something didn’t work just then.';
  }
  return words;
}

/** A successful job's result in words fit for a toast: unwrapped, unmarked, trimmed. Never engine output. */
export function resultWords(r: unknown): string {
  if (typeof r !== 'string') return '';
  const words = stripMarkdown(unwrap(r));
  return !words || looksEngine(words) ? '' : words;
}

/** Markdown and inline HTML out of engine-supplied words (summaries, reasons): at most four lines as one. */
export function stripMarkdown(text: string): string {
  return String(text ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .split('\n')
    .map((l) => l.trim())
    // Rules (---, ***, ===) and list markers are drawing, not words.
    .map((l) => l.replace(/^(?:[-+]\s+|\d+[.)]\s+|\[[ xX]\]\s*)/, ''))
    .filter((l) => l && !/^[-=*_\s]{3,}$/.test(l))
    .slice(0, 4)
    .join(' ');
}
