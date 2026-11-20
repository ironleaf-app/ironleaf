// Documents and ID (Wave 5, 24 Oct 2026; module 14 of the catalogue: "Passports, licences, certificates, insurance, CV
// versions · Expiry reminders; viewable only when unlocked · Personal (locked)"). Each document is a note of the module's
// ID document type (src/shared/module-records.ts DOCUMENTS), plain Markdown the person owns:
//
//   Me/Documents and ID/Passport (Alex).md   kind, holder, issuer, number, issued, expires, remind (days before), version
//   Me/Documents and ID/Files/Passport (Alex)/passport-scan.pdf   its files, beside it (src/shared/file-records.ts)
//
// The number is never written in the note: it is a locked link to Secrets ("[locked](secret:…)"), shown masked and only
// with Secrets unlocked (components/SecretLink.tsx), and never given to an agent (src/shared/sensitivity.ts LOCKED_WORDS).
// A document's expiry comes to Today and the bell `remind` days before (the module's own number when it has none).
//
// Pure: no files, no Node, no DOM.

import { readIsoDay, daysFrom, isoOf, dueWords, whenWords } from './finance';
import { secretIdsIn } from './sensitivity';

export interface DocumentNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  /** The files kept with it (paths in the vault), newest first when the caller knows. */
  files?: string[];
}

export type DocStatus = 'Expired' | 'Expires soon' | 'Valid' | 'No expiry' | 'Renewed';

export interface IdDocument {
  path: string;
  name: string;
  kind: string;
  holder: string;
  issuer: string;
  /** The locked link's secret id, when the number is kept in Secrets. */
  secret: string | null;
  /** A number written in the note itself (it should move to Secrets: the page offers to). */
  plainNumber: boolean;
  issued: string | null;
  expires: string | null;
  /** Days before it expires that it is said (its own, else the module's). */
  remind: number;
  days: number | null;
  status: DocStatus;
  version: string;
  files: string[];
}

const str = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : v === null || v === undefined ? '' : String(v)).trim();

/** How long before it runs out each kind is first said, when the document and the module say nothing (30 Oct 2026,
 *  8.3 wave 1: a passport wants six months to sort a renewal, a licence a month). Null: the module's own days. */
export function defaultRemindForKind(kind: string): number | null {
  const k = kind.toLowerCase();
  if (/passport/.test(k)) return 180;
  if (/visa/.test(k)) return 90;
  if (/licen[cs]e|medic/.test(k)) return 30;
  if (/insurance|policy/.test(k)) return 30;
  if (/certificate/.test(k)) return 30;
  if (/id card/.test(k)) return 60;
  return null;
}

export function readDocument(n: DocumentNote, today: string, remindDefault = 60): IdDocument {
  const p = n.props;
  const expires = readIsoDay(p.expires);
  const remindOwn = Number(str(p.remind));
  const remind = Number.isFinite(remindOwn) && str(p.remind) !== '' ? Math.max(0, Math.min(730, Math.round(remindOwn))) : (defaultRemindForKind(str(p.kind)) ?? remindDefault);
  const days = expires ? daysFrom(today, expires) : null;
  // An old copy that was renewed (renewed_by names the new one) is kept for the record and never said again (30 Oct
  // 2026: after Renewed, the old passport still read Expiring soon and To renew beside the new one).
  const status: DocStatus = str(p.renewed_by) ? 'Renewed' : days === null ? 'No expiry' : days < 0 ? 'Expired' : days <= remind ? 'Expires soon' : 'Valid';
  const number = str(p.number);
  const secret = secretIdsIn(number)[0] ?? null;
  return {
    path: n.path,
    name: n.title,
    kind: str(p.kind) || 'Other',
    holder: str(p.holder).replace(/^\[\[|\]\]$/g, ''),
    issuer: str(p.issuer),
    secret,
    plainNumber: !!number && !secret,
    issued: readIsoDay(p.issued),
    expires,
    remind,
    days,
    status,
    version: str(p.version),
    files: n.files ?? [],
  };
}

export interface DocumentsModel {
  documents: IdDocument[];
  /** Expired, or expiring within each one's reminder window, soonest first. */
  expiring: IdDocument[];
  /** CVs, newest version first. */
  cvs: IdDocument[];
  today: string;
}

/** A version as a number to sort by ("v3", "3.1", "2026 Oct" → 3, 3.1, 0). */
const versionNumber = (v: string) => Number(/(\d+(?:\.\d+)?)/.exec(v)?.[1] ?? 0);

export function documentsModel(notes: readonly DocumentNote[], today: Date = new Date(), remindDefault = 60): DocumentsModel {
  const t = isoOf(today);
  const documents = notes.map((n) => readDocument(n, t, remindDefault)).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const expiring = documents.filter((d) => d.status === 'Expired' || d.status === 'Expires soon').sort((a, b) => (a.expires ?? '').localeCompare(b.expires ?? ''));
  const cvs = documents.filter((d) => /^(cv|resume|résumé|curriculum vitae)$/i.test(d.kind)).sort((a, b) => versionNumber(b.version) - versionNumber(a.version) || (b.issued ?? '').localeCompare(a.issued ?? ''));
  return { documents, expiring, cvs, today: t };
}

/** "Expired 3 days ago", "Expires in 40 days (Tue 3 Dec)", "Valid until Mar 2031", "No expiry". */
export function expiryWords(d: IdDocument, today: string): string {
  if (d.status === 'Renewed') return `Renewed: the old copy${d.expires ? `, ran to ${dueWords(d.expires, today)}` : ''}`;
  if (!d.expires || d.days === null) return 'No expiry';
  if (d.days < 0) return `Expired ${whenWords(d.days)}`;
  if (d.status === 'Expires soon') return `Expires ${whenWords(d.days)} (${dueWords(d.expires, today)})`;
  return `Valid until ${dueWords(d.expires, today)}`;
}

const yamlWords = (s: string) => (s === '' || /^[\s\-?:,[\]{}#&*!|>'"%@`]|:\s|:$|\s#|\s$/.test(s) || /^(true|false|yes|no|null|on|off|~)$/i.test(s) || /^[\d.+-]+$/.test(s) ? JSON.stringify(s) : s);

export interface DocumentInput {
  kind: string;
  holder?: string;
  issuer?: string;
  /** A locked link to the secret holding the number ("[locked](secret:…)"), made by the caller; never the number. */
  number?: string;
  issued?: string | null;
  expires?: string | null;
  remind?: number | null;
  version?: string;
}

/** A new ID document note's words. */
export function newDocumentText(d: DocumentInput): string {
  const front = [
    'type: id-document',
    `kind: ${yamlWords(d.kind || 'Other')}`,
    `holder: ${yamlWords(d.holder ?? '')}`,
    `issuer: ${yamlWords(d.issuer ?? '')}`,
    d.number ? `number: ${JSON.stringify(d.number)}` : 'number:',
    `issued: ${d.issued ?? ''}`,
    `expires: ${d.expires ?? ''}`,
    `remind: ${d.remind ?? ''}`,
    `version: ${yamlWords(d.version ?? '')}`,
  ].map((l) => l.replace(/: ""$/, ':').trimEnd());
  return `---\n${front.join('\n')}\n---\n## Files\n\n\n## Notes\n\n`;
}

/** What a photographed or scanned document was read as, checked before anything is filed (30 Oct 2026, 8.3 wave 1).
 *  The person's model reads the photo; this keeps only what may go on the record. A number in the reading is dropped,
 *  never kept: it belongs in Secrets, added by the person in the window, and `numberDropped` says so. Dates must read
 *  as days; a kind is matched to the usual kinds when it plainly is one. */
export function documentFromReading(reading: Record<string, unknown>): { input: DocumentInput; numberDropped: boolean } {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = reading[k];
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
    }
    return '';
  };
  const kindRaw = pick('kind', 'type', 'document_type').slice(0, 40);
  const kind = ['Passport', 'Driver licence', 'ID card', 'Medicare card', 'Certificate', 'Insurance policy', 'CV', 'Visa', 'Birth certificate'].find((k) => k.toLowerCase() === kindRaw.toLowerCase()) ?? (/passport/i.test(kindRaw) ? 'Passport' : /licen[cs]e/i.test(kindRaw) ? 'Driver licence' : /insurance|policy/i.test(kindRaw) ? 'Insurance policy' : /visa/i.test(kindRaw) ? 'Visa' : /certificate/i.test(kindRaw) ? 'Certificate' : kindRaw || 'Other');
  const numberDropped = !!pick('number', 'document_number', 'documentNumber', 'id_number');
  const expires = readIsoDay(pick('expires', 'expiry', 'expiry_date', 'valid_until'));
  const issued = readIsoDay(pick('issued', 'issued_date', 'issue_date'));
  return { input: { kind, holder: pick('holder', 'name', 'whose').slice(0, 80), issuer: pick('issuer', 'issued_by', 'authority').slice(0, 80), issued, expires, remind: defaultRemindForKind(kind), version: pick('version').slice(0, 20) }, numberDropped };
}

/** A renewed document's new note, and its old note with the renewal kept in it (30 Oct 2026, 8.3 wave 1: "Renewed in
 *  one tap: new expiry, the old copy kept"). The new copy carries the same locked number link (the person changes it
 *  in Secrets when the new document's number differs); neither words ever hold a number itself. */
export function renewedDocumentTexts(old: { name: string; kind: string; holder: string; issuer: string; secretLink?: string | null; oldText: string; oldExpires: string | null }, input: { expires: string; issued?: string | null; today: string; newName?: string }): { newText: string; oldText: string } {
  const newText = newDocumentText({ kind: old.kind, holder: old.holder, issuer: old.issuer, ...(old.secretLink ? { number: old.secretLink } : {}), issued: input.issued ?? input.today, expires: input.expires, remind: defaultRemindForKind(old.kind) });
  const history = `\n## Renewal history\n\n- Renewed on ${input.today}: this copy ran to ${old.oldExpires ?? 'no day written'}; the new copy runs to ${input.expires}.\n`;
  const withHistory = /^##\s+renewal history\s*$/im.test(newText) ? newText : `${newText.replace(/\s*$/, '')}\n${history}`;
  const oldMark = `\nRenewed on ${input.today} (new copy kept beside this one; this is the old copy, kept for the record).\n`;
  const marked = /^##\s+notes\s*$/im.test(old.oldText) ? old.oldText.replace(/^(##\s+notes\s*)$/im, `$1${oldMark}`) : `${old.oldText.replace(/\s*$/, '')}\n\n## Notes\n${oldMark}`;
  // The old copy says which copy replaced it, so it stops being said as expiring (renewed_by in its properties).
  const by = yamlWords(input.newName ? `[[${input.newName}]]` : input.today);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(marked);
  const oldText = fm ? `---\n${fm[1].replace(/^renewed_by:.*$/m, '').replace(/\s*$/, '')}\nrenewed_by: ${by}\n---${marked.slice(fm[0].length)}` : `---\nrenewed_by: ${by}\n---\n${marked}`;
  return { newText: withHistory, oldText };
}

/** A document's name from what it is and whose ("Passport (Alex Example)", "CV v3"). */
export function documentName(d: Pick<DocumentInput, 'kind' | 'holder' | 'version'>): string {
  const kind = d.kind || 'Document';
  if (/^cv$/i.test(kind)) return `CV${d.version ? ` ${d.version}` : ''}${d.holder ? ` (${d.holder})` : ''}`;
  return `${kind}${d.holder ? ` (${d.holder})` : ''}`;
}
