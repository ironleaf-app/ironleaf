// The secret scanner (Wave 4, 24 Oct 2026; the plan, 22 Oct: "passcodes sit in plain project files (the Wexley St iPad
// passcode…) … a scanner that finds passwords, passcodes and card numbers already sitting in notes and offers to move
// them into Secrets"). It reads a note's words and finds what looks like a secret by its shape and the words around it,
// and is careful to stay quiet otherwise: "the password reset is booked" or "PIN the file to the project" is not a
// secret.
//
// What it finds, each with the words that name it ("Wexley St iPad passcode"):
//   password      after "password", "passphrase", "Wi-Fi key"… (":" "=" "is"), in a URL (https://user:pass@host), in a
//                 KEY=value line (SOMETHING_PASSWORD=…), or under a Password column in a table
//   passcode      a PIN, passcode, door, alarm, gate or lock code: 4 to 10 digits
//   card          a payment card number (13 to 19 digits that pass the Luhn check and start as a card does), and a CVV
//                 written beside its label
//   api-key       a key or token by its known shape (sk-…, ghp_…, AKIA…, a Telegram bot token, xoxb-…) or after "API key",
//                 "secret key", "access token"
//   private-key   a "-----BEGIN … PRIVATE KEY-----" block
//   licence       a licence, product or activation key, or a serial number, after its label (or a 5×5 product key)
//   id-number     a passport, driver licence, tax file, Medicare or social security number after its label
//   bank          an account number, BSB or IBAN after its label
//
// Nothing found ever leaves as the value itself except to the main side's own move into Secrets: the window gets each
// finding masked, and a finding's fingerprint is made from where it is and the masked line, never from the value.

export type SecretKind = 'password' | 'passcode' | 'card' | 'api-key' | 'private-key' | 'licence' | 'id-number' | 'bank';

/** File names that hold secrets by their name alone (.env files, private keys, key stores, credential files): never
 *  read out to the assistant, whatever is inside. */
const SECRET_NAMES: { re: RegExp; words: string }[] = [
  { re: /(^|\/)\.env(\.|$)(?!example$|sample$|template$|dist$)/i, words: 'a .env file' },
  { re: /\.(pem|key|ppk|pfx|p12|jks|keystore)$/i, words: 'a private key file' },
  { re: /(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)([._-].*)?$/i, words: 'a private key file' },
  { re: /(^|\/|[-_.])(credentials|secrets?)([._-][^/]*)?\.(json|ya?ml|toml|ini|cfg|txt)$/i, words: 'a credentials file' },
  { re: /(^|\/)\.?secrets?$/i, words: 'a credentials file' },
  { re: /(^|\/)(\.npmrc|\.pypirc)$/i, words: 'a credentials file' },
];

/** Why a path is never read out as words, or null when its name is ordinary. */
export function secretFileWhy(filePath: unknown): string | null {
  const name = String(filePath ?? '').replace(/\\/g, '/');
  if (!name.trim()) return null;
  if (/(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)([._-].*)?\.pub$/i.test(name)) return null;
  return SECRET_NAMES.find((s) => s.re.test(name))?.words ?? null;
}

export const KIND_LABELS: Record<SecretKind, string> = {
  password: 'Password',
  passcode: 'Passcode or PIN',
  card: 'Card number',
  'api-key': 'Key or token',
  'private-key': 'Private key',
  licence: 'Licence key',
  'id-number': 'ID number',
  bank: 'Bank account',
};
export const SECRET_KINDS = Object.keys(KIND_LABELS) as SecretKind[];

export interface Finding {
  kind: SecretKind;
  /** The words that name it ("Wexley St iPad passcode"), for the secret's name. */
  label: string;
  /** Where the value is in the text (characters). */
  start: number;
  end: number;
  /** Line number (1 is the first). */
  line: number;
  /** The line with the value masked ("iPad passcode: ••••••"). */
  context: string;
  /** The value masked ("••••••", "sk-…f3"). */
  masked: string;
  confidence: 'high' | 'medium';
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A value as bullets (keys keep their first three and last two characters, so two keys can be told apart). */
export function maskValue(value: string, kind?: SecretKind): string {
  const v = value.trim();
  if (kind === 'private-key') return '-----BEGIN PRIVATE KEY----- ••• -----END-----';
  if ((kind === 'api-key' || kind === 'licence') && v.length >= 14) return `${v.slice(0, 3)}${'•'.repeat(6)}${v.slice(-2)}`;
  if (kind === 'card' && v.replace(/\D/g, '').length >= 12) return `•••• •••• •••• ${v.replace(/\D/g, '').slice(-4)}`;
  return '•'.repeat(Math.min(Math.max(v.length, 4), 12));
}

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** A card number's shape: its length and first digits as card schemes issue them. */
function cardShape(d: string): boolean {
  const n = d.length;
  if (/^4/.test(d)) return n === 13 || n === 16 || n === 19;
  if (/^5[1-5]/.test(d) || /^(222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(d)) return n === 16;
  if (/^3[47]/.test(d)) return n === 15;
  if (/^(6011|65|64[4-9])/.test(d)) return n === 16 || n === 19;
  if (/^3(0[0-5]|[68])/.test(d)) return n === 14 || n === 16;
  if (/^35(2[89]|[3-8]\d)/.test(d)) return n >= 16 && n <= 19;
  return false;
}

/** Values that are a stand-in, not a secret: blanks, bullets, template fields, variables, "TBC", "see above". */
const PLACEHOLDER = /^(?:[*•·x.\-_#?]{3,}|<[^>]*>|\{\{?[^}]*\}\}?|\$\{?[A-Za-z_][\w]*\}?|%[A-Za-z_]\w*%|\[[^\]]*\]|\(.*\)|tbc|tba|tbd|n\/?a|na|none|nil|null|unknown|unset|blank|empty|redacted|hidden|removed|same|todo|xxx+|\.\.\.|…)$/i;
/** Words after a label that say something about the secret rather than being it. */
const ABOUT = new Set(
  'a an the is are was were be been being to of for in on at by via with from and or not no yes reset resets resetting changed change changes changing expired expires expiry expire required needed need needs protected protect policy policies manager managers vault locked lock unlocked sent send provided provide below above here there same set setup see ask asked asking request requested please forgot forgotten lost new old current default your my our their his her its it this that these those when if as so then also only every each any all strong weak complex length rules rule update updated updating hint hints prompt prompted screen field fields box entry login logins sign signin account accounts user users holder holders owner owned access only stored store saved save kept keep shared share sharing reader readers pad pads number numbers code codes key keys entered enter typed type use used using works working worked will would should could can may might must does do did done check checked checking'.split(' '),
);

const LINE_END_PUNCT = /[.,;:!?)\]}'"”’]+$/;

/** The words before a label on its line that name what it is for ("Wexley St iPad"), cleaned of list marks and markup. */
function nameBefore(line: string, labelAt: number, labelWords: string): string {
  let before = line.slice(0, labelAt);
  // Only what follows the last sentence break or separator on the line.
  before = before.split(/(?:[.;!?,](?:\s|$)|\s[-–—|]\s|\|)/).pop() ?? before;
  before = before.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').replace(/[*_`#>]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = before.split(' ').filter(Boolean).slice(-4).join(' ').replace(/[:,(]+$/, '').trim();
  const label = labelWords.replace(/\s+/g, ' ').trim();
  const name = `${words ? `${words} ` : ''}${label}`.trim();
  return name.length > 60 ? name.slice(name.length - 60).replace(/^\S*\s/, '') : name;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** A name never carries a value: words with three or more digits (a number beside the label) and leading articles go. */
export function cleanName(s: string): string {
  const words = s
    .replace(/[*_`#>|]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && (w.match(/\d/g)?.length ?? 0) < 3 && !/[=:@]/.test(w.replace(/:$/, '')));
  while (words.length > 1 && /^(the|a|an|our|my|its)$/i.test(words[0])) words.shift();
  return cap(words.join(' ').replace(/[,:;(]+$/, '').trim());
}

// ── Labels ───────────────────────────────────────────────────────────────────────────────────────────────────────────

interface LabelRule {
  kind: SecretKind;
  /** The label, as a regular expression source (no groups of its own). */
  label: string;
  /** Whether a value is this kind's (after the separator). */
  value(v: string, strict: boolean): boolean;
  /** A label that may stand straight before digits with no ":" ("PIN 4821"). */
  bare?: boolean;
}

const DIGITS = (min: number, max: number) => (v: string) => new RegExp(`^\\d{${min},${max}}$`).test(v);
const passwordValue = (v: string, strict: boolean) => {
  if (v.length < 4 || v.length > 128 || PLACEHOLDER.test(v)) return false;
  if (/^https?:\/\//i.test(v) || /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(v)) return false;
  const low = v.toLowerCase();
  if (ABOUT.has(low)) return false;
  const mixed = /\d/.test(v) || /[^A-Za-z0-9]/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v.slice(1)));
  // A plain word counts only where the line gives it as the value ("Password: sunshine", nothing after it).
  return mixed || (strict && /^[A-Za-z]{5,}$/.test(v));
};

const RULES: LabelRule[] = [
  { kind: 'password', label: '(?:wi-?fi|wireless|network|router|admin|login|account|user|e-?mail|app|master|root|vpn|guest|pc|laptop|windows)?\\s?(?:password|passwd|pass\\s?word|pass\\s?phrase|pwd|pw)', value: passwordValue },
  { kind: 'password', label: '(?:wi-?fi|wireless|network|wpa2?|wep)\\s(?:key|pass)', value: passwordValue },
  { kind: 'password', label: '(?:recovery|backup)\\s(?:codes?|key|phrase)', value: (v) => v.length >= 6 && /\d/.test(v) && !PLACEHOLDER.test(v) },
  { kind: 'passcode', label: '(?:pass\\s?code|pin(?:\\s?(?:code|number|no\\.?))?|door\\s?code|alarm\\s?code|gate\\s?code|lock\\s?code|unlock\\s?code|keypad\\s?code|access\\s?code|entry\\s?code|safe\\s?code|combination|combo)', value: (v) => /^\d{4,10}$/.test(v) || /^\d{2}(?:[-\s]\d{2}){2,3}$/.test(v), bare: true },
  { kind: 'card', label: '(?:cvv2?|cvc2?|card\\s?security\\s?code|security\\s?code)', value: DIGITS(3, 4), bare: true },
  { kind: 'api-key', label: '(?:api[\\s_-]?(?:key|token|secret)|secret[\\s_-]?key|access[\\s_-]?(?:token|key)|auth(?:entication)?[\\s_-]?token|bearer[\\s_-]?token|client[\\s_-]?secret|app[\\s_-]?secret|private[\\s_-]?token|personal\\saccess\\stoken|bot\\stoken|webhook\\ssecret)', value: (v) => v.length >= 16 && v.length <= 400 && /[A-Za-z]/.test(v) && /\d/.test(v) && !/\s/.test(v) && !PLACEHOLDER.test(v) },
  { kind: 'licence', label: '(?:licen[cs]e\\s?(?:key|code)|product\\s?key|activation\\s?(?:key|code)|registration\\s?(?:key|code)|serial\\s?(?:number|no\\.?|key)|cd\\s?key)', value: (v) => (/^[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8}){2,7}$/i.test(v) && /\d/.test(v)) || (/^[A-Z0-9]{10,40}$/i.test(v) && /\d/.test(v) && /[A-Z]/i.test(v)) },
  { kind: 'id-number', label: '(?:passport\\s?(?:number|no\\.?|#)?|driver[\'’]?s?\\s?licen[cs]e\\s?(?:number|no\\.?|#)?|licen[cs]e\\s?(?:number|no\\.?)|tax\\sfile\\s(?:number|no\\.?)|tfn|medicare\\s?(?:card\\s?)?(?:number|no\\.?)?|ird\\s?(?:number|no\\.?)|social\\ssecurity\\s(?:number|no\\.?)|ssn|national\\sinsurance\\s(?:number|no\\.?)|ni\\snumber)', value: (v) => /^[A-Z0-9][A-Z0-9 -]{4,14}[A-Z0-9]$/i.test(v) && (v.match(/\d/g)?.length ?? 0) >= 5 },
  { kind: 'bank', label: '(?:(?:bank\\s)?account\\s?(?:number|no\\.?|#)|acct\\s?(?:number|no\\.?|#)?|bsb|iban|routing\\s(?:number|no\\.?)|sort\\scode)', value: (v) => /^\d[\d -]{4,20}\d$/.test(v) || /^[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}$/.test(v) },
];

// ── Finding ──────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Hit extends Omit<Finding, 'line' | 'context' | 'masked'> {}

function lineOf(text: string, at: number): { line: number; start: number; end: number } {
  let line = 1;
  let start = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < at; i = text.indexOf('\n', i + 1)) {
    line++;
    start = i + 1;
  }
  const end = text.indexOf('\n', at);
  return { line, start, end: end === -1 ? text.length : end };
}

/** Spans of the text never looked in: links to Secrets already made. */
function lockedSpans(text: string): [number, number][] {
  return [...text.matchAll(/\[[^\]\n]{0,80}\]\(secret:[A-Za-z0-9_-]{6,40}\)/g)].map((m) => [m.index!, m.index! + m[0].length]);
}

/** The value after a label: quoted, in backticks, or the next run of characters up to a space (punctuation at the end of
 *  the line left off); with whether it ends the line (nothing but punctuation after it). */
function valueAt(text: string, from: number, lineEnd: number): { start: number; end: number; value: string; last: boolean } | null {
  let i = from;
  while (i < lineEnd && (text[i] === ' ' || text[i] === '\t')) i++;
  if (i >= lineEnd) return null;
  const open = text[i];
  const pairs: Record<string, string> = { '"': '"', "'": "'", '`': '`', '“': '”', '‘': '’' };
  if (pairs[open]) {
    const close = text.indexOf(pairs[open], i + 1);
    if (close === -1 || close > lineEnd || close - i - 1 < 1) return null;
    const rest = text.slice(close + 1, lineEnd);
    return { start: i + 1, end: close, value: text.slice(i + 1, close), last: !/[A-Za-z0-9]/.test(rest) };
  }
  // A stand-in in brackets ("<your password>", "{{password}}", "(see Secrets)"): taken whole, so it is seen as one.
  const closers: Record<string, string> = { '<': '>', '{': '}', '[': ']', '(': ')' };
  if (closers[open]) {
    const close = text.indexOf(closers[open], i + 1);
    if (close !== -1 && close < lineEnd) {
      const end = open === '{' && text[close + 1] === '}' ? close + 2 : close + 1;
      return { start: i, end, value: text.slice(i, end), last: !/[A-Za-z0-9]/.test(text.slice(end, lineEnd)) };
    }
  }
  // Bold or code marks around it ("**1234**").
  let j = i;
  while (j < lineEnd && !/[\s|]/.test(text[j])) j++;
  let raw = text.slice(i, j);
  let start = i;
  const lead = /^[*_]+/.exec(raw)?.[0].length ?? 0;
  raw = raw.slice(lead);
  start += lead;
  raw = raw.replace(/[*_]+$/, '');
  const trimmed = raw.replace(LINE_END_PUNCT, '');
  if (!trimmed) return null;
  const rest = text.slice(start + trimmed.length, lineEnd);
  return { start, end: start + trimmed.length, value: trimmed, last: !/[A-Za-z0-9]/.test(rest.replace(/^[*_]+/, '')) };
}

function labelled(text: string, hits: Hit[]): void {
  for (const rule of RULES) {
    // The label as a word, then optional words in brackets ("Wi-Fi password (guest)"), then the separator.
    const re = new RegExp(`(?<![\\w-])(${rule.label})(?![\\w-])(\\s*\\([^)\\n]{1,30}\\))?(\\s*(?::|=|=>|-|–|—|\\bis\\b|\\bwas\\b)\\s*|(\\s+))`, 'gi');
    for (const m of text.matchAll(re)) {
      const sep = m[3];
      const bareSpace = m[4] !== undefined;
      if (bareSpace && !rule.bare) continue;
      const at = m.index!;
      const { start: ls, end: le } = lineOf(text, at);
      const v = valueAt(text, at + m[0].length, le);
      if (!v) continue;
      // A number written in groups ("123 456 782", "1234 5678") is one value for ID and bank numbers.
      if ((rule.kind === 'id-number' || rule.kind === 'bank') && /^\d+$/.test(v.value)) {
        const more = /^(?:[ -]\d{2,6}){1,4}(?!\w)/.exec(text.slice(v.end, le));
        if (more) {
          v.end += more[0].length;
          v.value = text.slice(v.start, v.end);
          v.last = !/[A-Za-z0-9]/.test(text.slice(v.end, le));
        }
      }
      // "is" or a dash as the separator: only when the value ends the sentence or line ("the PIN is 4821.").
      const soft = /\bis\b|\bwas\b|[-–—]/.test(sep) || bareSpace;
      const strict = /[:=]/.test(sep) && v.last;
      if (bareSpace && !/^\d{3,10}$/.test(v.value)) continue;
      if (!rule.value(v.value, strict)) continue;
      if (soft && rule.kind === 'password' && !strict && !v.last) continue;
      // A year straight after a bare label ("PIN 2026 plan") isn't a PIN.
      if (bareSpace && /^(19|20)\d\d$/.test(v.value) && !v.last) continue;
      const line = text.slice(ls, le);
      hits.push({ kind: rule.kind, label: cleanName(nameBefore(line, at - ls, m[1])), start: v.start, end: v.end, confidence: strict || rule.kind !== 'password' ? 'high' : 'medium' });
    }
  }
}

const SHAPES: { kind: SecretKind; re: RegExp; label: string }[] = [
  { kind: 'api-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, label: 'Anthropic key' },
  { kind: 'api-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g, label: 'OpenAI key' },
  { kind: 'api-key', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}/g, label: 'Stripe key' },
  { kind: 'api-key', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g, label: 'GitHub token' },
  { kind: 'api-key', re: /\bgithub_pat_[A-Za-z0-9_]{50,}/g, label: 'GitHub token' },
  { kind: 'api-key', re: /\bglpat-[A-Za-z0-9_-]{20,}/g, label: 'GitLab token' },
  { kind: 'api-key', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, label: 'Slack token' },
  { kind: 'api-key', re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS access key' },
  { kind: 'api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: 'Google API key' },
  { kind: 'api-key', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g, label: 'Telegram bot token' },
  { kind: 'api-key', re: /\bnvk_[A-Za-z0-9_-]{30,}/g, label: 'Ironleaf agent key' },
  { kind: 'api-key', re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/g, label: 'Slack webhook' },
];

function shaped(text: string, hits: Hit[]): void {
  // KEY=value lines: SOMETHING_PASSWORD=…, API_KEY: …
  for (const m of text.matchAll(/(?<![\w])([A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY)[A-Z0-9_]*)[ \t]*[=:][ \t]*/g)) {
    const { end: le } = lineOf(text, m.index!);
    const v = valueAt(text, m.index! + m[0].length, le);
    if (!v || v.value.length < 4 || PLACEHOLDER.test(v.value) || /^(true|false|yes|no|null|none|\d{1,3})$/i.test(v.value)) continue;
    const kind: SecretKind = /PASSWORD|PASSWD|PWD/.test(m[1]) ? 'password' : 'api-key';
    hits.push({ kind, label: m[1], start: v.start, end: v.end, confidence: 'high' });
  }
  for (const s of SHAPES)
    for (const m of text.matchAll(s.re)) {
      const { start: ls, end: le } = lineOf(text, m.index!);
      const line = text.slice(ls, le);
      const named = nameBefore(line, m.index! - ls, '').replace(/[:=]\s*$/, '').trim();
      hits.push({ kind: s.kind, label: cleanName(named && named.length > 2 ? named : s.label) || s.label, start: m.index!, end: m.index! + m[0].length, confidence: 'high' });
    }
  // Private key blocks.
  for (const m of text.matchAll(/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]{20,}?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g))
    hits.push({ kind: 'private-key', label: 'Private key', start: m.index!, end: m.index! + m[0].length, confidence: 'high' });
  // A password in a web address: https://user:password@host.
  for (const m of text.matchAll(/\b[a-z][a-z0-9+.-]{1,15}:\/\/([^\s:/@]{1,64}):([^\s/@]{3,128})@[\w.-]+/gi)) {
    const pw = m[2];
    if (PLACEHOLDER.test(pw)) continue;
    const start = m.index! + m[0].indexOf(`:${pw}@`) + 1;
    hits.push({ kind: 'password', label: `Password for ${m[1]}`, start, end: start + pw.length, confidence: 'high' });
  }
}

function cards(text: string, hits: Hit[]): void {
  for (const m of text.matchAll(/(?<!\d|\d[.,/:-])(?:\d[ -]?){12,18}\d(?!\d|[.,/-]\d|:\d)/g)) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !cardShape(digits) || !luhn(digits) || /^(\d)\1+$/.test(digits)) continue;
    // Groups as cards are printed (4-4-4-4, 4-6-5) or all together; a phone number's groups aren't.
    const groups = raw.split(/[ -]/).map((g) => g.length);
    if (groups.length > 1 && !(groups.every((g) => g === 4 || (groups.length === 5 && g <= 4)) || groups.join('-') === '4-6-5' || groups.join('-') === '4-6-4')) continue;
    const { start: ls, end: le } = lineOf(text, m.index!);
    const line = text.slice(ls, le);
    const near = /(card|visa|master\s?card|amex|american express|credit|debit|diners|discover|jcb|eftpos)/i.test(line);
    const before = cleanName(nameBefore(line, m.index! - ls, ''));
    const named = /(card|visa|master\s?card|amex|american express|credit|debit|eftpos)/i.test(before) ? before : '';
    hits.push({ kind: 'card', label: named || 'Card number', start: m.index!, end: m.index! + raw.length, confidence: near ? 'high' : 'medium' });
  }
}

/** Tables: a cell that is a label with the value in the next cell, or a column headed by a label. */
function tables(text: string, hits: Hit[]): void {
  const lines = text.split('\n');
  let offset = 0;
  let header: string[] | null = null;
  const offsets: number[] = [];
  for (const l of lines) {
    offsets.push(offset);
    offset += l.length + 1;
  }
  const cellsOf = (l: string) => {
    const out: { text: string; start: number }[] = [];
    if (!/^\s*\|/.test(l)) return out;
    let i = l.indexOf('|') + 1;
    while (i < l.length) {
      const j = l.indexOf('|', i);
      const end = j === -1 ? l.length : j;
      const raw = l.slice(i, end);
      const lead = raw.length - raw.trimStart().length;
      out.push({ text: raw.trim(), start: i + lead });
      if (j === -1) break;
      i = j + 1;
    }
    if (out.length && !out[out.length - 1].text) out.pop();
    return out;
  };
  const kindOf = (cell: string): LabelRule | null => {
    const c = cell.replace(/[*_`]/g, '').trim();
    if (!c || c.length > 40) return null;
    for (const r of RULES) if (new RegExp(`^(?:[\\w’'.-]+\\s){0,3}${r.label}$`, 'i').test(c)) return r;
    return null;
  };
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];
    const cells = cellsOf(l);
    if (!cells.length) {
      header = null;
      continue;
    }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c.text))) continue;
    const isHeader = n + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[n + 1]);
    if (isHeader) {
      header = cells.map((c) => c.text);
      continue;
    }
    cells.forEach((c, i) => {
      const value = c.text.replace(/^[*_`]+|[*_`]+$/g, '');
      const lead = c.text.indexOf(value);
      const abs = offsets[n] + c.start + Math.max(0, lead);
      // Label in the cell before.
      const before = i > 0 ? kindOf(cells[i - 1].text) : null;
      // Or the column's heading.
      const column = header?.[i] ? kindOf(header[i]) : null;
      const rule = before ?? column;
      if (!rule || !value || !rule.value(value, true)) return;
      const rowName = cells.find((x, k) => k !== i && k !== i - 1 && x.text && !kindOf(x.text))?.text.replace(/[*_`]/g, '').trim();
      const labelWords = (before ? cells[i - 1].text : header![i]).replace(/[*_`]/g, '').trim();
      hits.push({ kind: rule.kind, label: cleanName(rowName ? `${rowName} ${labelWords.toLowerCase()}` : labelWords).slice(0, 60), start: abs, end: abs + value.length, confidence: 'high' });
    });
  }
}

/**
 * What looks like a secret in a note's words, in the order it appears. Overlapping finds are one (the surest and widest).
 */
export function scanText(text: string): Finding[] {
  const s = String(text ?? '');
  if (!s.trim()) return [];
  const hits: Hit[] = [];
  shaped(s, hits);
  labelled(s, hits);
  tables(s, hits);
  cards(s, hits);
  const locked = lockedSpans(s);
  const kept: Hit[] = [];
  const rank = (h: Hit) => (h.confidence === 'high' ? 2 : 1) * 1000 + (h.end - h.start);
  for (const h of hits.sort((a, b) => rank(b) - rank(a))) {
    if (locked.some(([a, b]) => h.start < b && h.end > a)) continue;
    if (kept.some((k) => h.start < k.end && h.end > k.start)) continue;
    kept.push(h);
  }
  kept.sort((a, b) => a.start - b.start);
  return kept.map((h) => {
    const { line, start, end } = lineOf(s, h.start);
    const masked = maskValue(s.slice(h.start, h.end), h.kind);
    // The line as it reads, with every secret found on it masked (never one beside it in the clear).
    const stop = Math.max(end, Math.min(h.end, start + 400));
    let context = '';
    let at = start;
    for (const k of kept.filter((x) => x.start < stop && x.end > start)) {
      context += s.slice(at, Math.max(at, k.start)) + maskValue(s.slice(k.start, k.end), k.kind);
      at = Math.max(at, k.end);
    }
    context = (context + s.slice(at, stop)).replace(/\s+/g, ' ').trim().slice(0, 200);
    return { ...h, line, context, masked };
  });
}

/** A finding's fingerprint (for "Not a secret"): where it is, its kind and its masked line; never the value. */
export async function fingerprint(path: string, f: Pick<Finding, 'kind' | 'context' | 'label'>): Promise<string> {
  const data = new TextEncoder().encode(`${path.toLowerCase()}\n${f.kind}\n${f.label.toLowerCase()}\n${f.context}`);
  const sub = (globalThis as { crypto?: { subtle?: { digest(a: string, d: Uint8Array): Promise<ArrayBuffer> } } }).crypto?.subtle;
  if (sub) return [...new Uint8Array(await sub.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  // No Web Crypto: a plain 53-bit hash (enough to tell findings apart).
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const b of data) {
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  return ((h2 >>> 0).toString(16) + (h1 >>> 0).toString(16)).padStart(16, '0').slice(0, 24);
}

/** The note with each finding's value replaced by a locked link, from the end so earlier places stay right. */
export function lockFindings(text: string, items: { start: number; end: number; id: string }[]): string {
  let out = text;
  for (const it of [...items].sort((a, b) => b.start - a.start)) out = `${out.slice(0, it.start)}[locked](secret:${it.id})${out.slice(it.end)}`;
  return out;
}

/** A secret's name from a finding and its note ("Wexley St iPad passcode", else "Password in Wexley St notes"). */
export function nameFor(f: Pick<Finding, 'label' | 'kind'>, noteTitle: string): string {
  const label = f.label.trim();
  const generic = !label || /^(password|passcode|pin|code|key|token|card number|private key)$/i.test(label);
  return (generic ? `${KIND_LABELS[f.kind]} in ${noteTitle}` : label).slice(0, 80);
}
