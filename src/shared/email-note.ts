// An email as a note (t243 vault front door, 12 Nov 2026). A saved email (.eml, .msg), one mailed in from Gmail
// or Outlook, or pasted text lands as one note of type email: from, to, cc, date, subject and attachments kept
// as fields, its words as the body, its attachments beside it. The sender is matched to a person by address, or
// a card is made for a stranger (the organisation read from the domain, as person cards already do). Filed under
// a project it carries that project's typed link; the project lists it, and the sender's Timeline names it —
// linked both ways, never copied into other notes. Pure: no files, no DOM.
import { senderAddress, senderName, splitAddresses, type EmailDoc } from './email-file';
import { organisationFromEmail } from './people';
import { cleanFileName } from './paths';
/** An email's fields as the note keeps them (a parsed file, the mail connection's, or pasted text read as one). */
export interface EmailFields {
  from: string;
  to: string;
  cc: string;
  date: string;
  /** The internet message id when the email carried one (t244: the same email dropped twice lands once). */
  id: string;
  subject: string;
  words: string;
  files: { name: string; kind: string; size: number }[];
}
export const fieldsOf = (email: Pick<EmailDoc, 'from' | 'to' | 'cc' | 'date' | 'messageId' | 'subject' | 'words' | 'files'>): EmailFields => ({ from: email.from, to: email.to, cc: email.cc, date: email.date, id: email.messageId, subject: email.subject, words: email.words, files: email.files.map((f) => ({ name: f.name, kind: f.kind, size: f.size })) });
const yamlText = (v: string): string => (/^[\w .,'()&-]+$/.test(v) && !/^(true|false|null|yes|no|\d+)$/i.test(v.trim()) && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(v) ? v : JSON.stringify(v));
const oneLine = (v: string): string => String(v ?? '').replace(/\s+/g, ' ').trim();
/** The sender's card as a typed link ("[[June Park]]"), by name (renames follow, as every link does). */
export const senderLink = (name: string): string => `[[${name}]]`;
/** A landed email's note: its fields, its sender linked when known, its project linked when filed, its words, and
 *  its attachments as embeds (the files sit beside the note). */
export function emailNoteText(email: EmailFields, opts: { sender?: string; project?: string } = {}): string {
  const front = ['type: email'];
  if (oneLine(email.subject)) front.push(`subject: ${yamlText(oneLine(email.subject))}`);
  if (oneLine(email.from)) front.push(`email_from: ${yamlText(oneLine(email.from))}`);
  if (oneLine(email.to)) front.push(`email_to: ${yamlText(oneLine(email.to))}`);
  if (oneLine(email.cc)) front.push(`email_cc: ${yamlText(oneLine(email.cc))}`);
  if (oneLine(email.date)) front.push(`email_date: ${yamlText(oneLine(email.date))}`);
  if (oneLine(email.id)) front.push(`email_id: ${yamlText(oneLine(email.id))}`);
  if (opts.sender) front.push(`sender: ${yamlText(senderLink(opts.sender))}`);
  if (opts.project) front.push(`project: ${yamlText(senderLink(opts.project))}`);
  const subject = oneLine(email.subject) || 'An email';
  const lines = ['---', ...front, '---', `# ${subject}`, ''];
  // Who it is from, plainly (the date stays in the fields: a raw mail date reads as file-speak in a row).
  const who = senderName(email.from) || senderAddress(email.from) || 'unknown';
  lines.push(`From ${who}`, '');
  if (email.words.trim()) lines.push(email.words.trim(), '');
  if (email.files.length) {
    lines.push('## Attachments', '');
    for (const f of email.files) lines.push(`- ![[${f.name}]] (${f.kind}, ${f.size < 1024 ? `${f.size} bytes` : f.size < 1048576 ? `${Math.round(f.size / 1024)} KB` : `${(f.size / 1048576).toFixed(1)} MB`})`);
    lines.push('');
  }
  return lines.join('\n');
}
export interface EmailFacts {
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  id: string;
  sender: string;
  project: string;
}
/** An email note's facts from its indexed properties (an older note without them reads plain). */
export function readEmailFacts(props: Record<string, unknown> | undefined): EmailFacts {
  const clean = (v: unknown): string => String(v ?? '').trim();
  return { subject: clean(props?.subject), from: clean(props?.email_from), to: clean(props?.email_to), cc: clean(props?.email_cc), date: clean(props?.email_date), id: clean(props?.email_id), sender: clean(props?.sender), project: clean(props?.project) };
}
/** An email already kept with this message id: its path, else null (t244: the same email dropped twice lands
 *  once, however it arrives — file, paste, or the connection. Compared case-insensitively; an empty id never
 *  matches, so mail without one lands as it always did). */
export function findEmailById(notes: readonly { path: string; props?: Record<string, unknown> }[], id: string): string | null {
  const want = String(id ?? '').trim().toLowerCase();
  if (!want) return null;
  for (const n of notes) {
    if (!isEmailProps(n.props)) continue;
    if (String(n.props?.email_id ?? '').trim().toLowerCase() === want) return n.path;
  }
  return null;
}
/** Whether these properties are an email note's. */
export const isEmailProps = (props: Record<string, unknown> | undefined): boolean => String(props?.type ?? '').toLowerCase() === 'email';
/** A person card matched by the sender's address (exact, case-insensitive); null when no card carries it. */
export function matchPersonByAddress<T extends { title: string; path: string; email?: string }>(people: readonly T[], from: string): T | null {
  const want = senderAddress(from);
  if (!want) return null;
  for (const p of people) {
    const have = splitAddresses(p.email ?? '').map((w) => w.address.toLowerCase()).filter(Boolean);
    if (have.includes(want)) return p;
  }
  return null;
}
/** A stranger's card name: their name as mailed, else their address's local part read plain ("june.park" →
 *  "June Park"), else the address itself (a short opaque local part like "ops" is a role, not a name: the address
 *  stays, for the person to name). */
export function strangerName(from: string): string {
  const name = senderName(from);
  if (name && !name.includes('@')) return name;
  const address = senderAddress(from);
  const local = address.split('@')[0] ?? '';
  if (/^[a-z][a-z0-9._-]*[a-z0-9]$/.test(local) && /[a-z]/.test(local)) {
    const words = local.split(/[._-]+/).filter(Boolean);
    const named = words.length > 1 || (words.length === 1 && words[0].length >= 4);
    if (named && words.every((w) => /^[a-z]+$/.test(w))) return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return address || 'Someone new';
}
/** A stranger card's organisation: from the domain, as person cards already read it (free mail gives none). */
export const strangerOrg = (from: string): string | undefined => organisationFromEmail(senderAddress(from));
/** Whether a note's text is an email note's (its front matter says type: email). The Bin reads this, not the
 *  index, so an email's attachments travel with it however it is taken out. */
export function isEmailNoteText(text: string): boolean {
  const lines = String(text ?? '').slice(0, 4000).split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return false;
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)\s*$/.test(lines[i])) return false;
    const m = /^type\s*:\s*(.+?)\s*(#.*)?$/.exec(lines[i]);
    if (m && m[1].replace(/^['"]|['"]$/g, '').trim().toLowerCase() === 'email') return true;
  }
  return false;
}
/** An email note's attachments folder, wherever it landed (t244 break-it, 12 Nov 2026: the Bin left them
 *  behind, orphaned, because only the front door knew where they sit). Beside an unanswered arrival
 *  (`Inbox/Attachments/<stem>`), beside it under Done (`Inbox/Done/<stem>`), or with its project when filed
 *  (`<folder>/Files/<stem>` for a note at `<folder>/Notes/<stem>.md`). Always the note's own stem, so the
 *  folder matches its note however either was renamed. Null when the note is nowhere emails land. One rule:
 *  the front door files through here and the Bin moves through here, so the two can never disagree. */
export function emailAttachmentsFor(noteRel: string): string | null {
  const rel = String(noteRel ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (!rel || rel.split('/').includes('..')) return null;
  const stem = (rel.split('/').pop() ?? '').replace(/\.md$/i, '');
  if (!stem) return null;
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  if (dir === 'Inbox') return `Inbox/Attachments/${stem}`;
  if (dir.startsWith('Inbox/')) return `${dir}/${stem}`;
  if (dir.endsWith('/Notes')) return `${dir.slice(0, -'/Notes'.length)}/Files/${stem}`;
  return null;
}
/** The note file's stem: the subject, else who it is from (cleaned for a file name, never blank). */
export function emailFileStem(subject: string, from: string): string {
  const s = oneLine(subject);
  if (s) return cleanFileName(s, 'Email');
  const who = senderName(from) || senderAddress(from) || 'Someone new';
  return cleanFileName(`Email from ${who}`, 'Email');
}
