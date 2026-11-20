// The front door's side of the window (t243, 12 Nov 2026): an email or PDF lands from a drop, a picker,
// pasted text, the mail connection or a project's linked folder — then the one question is asked ("Which
// project, and what is the next step?"), and answering files it with the next step made a Task. Anything not
// answered waits in the Inbox with its real subject or title.
import type { LandedArrival } from '../../../shared/life-api';
import { isProjectProps } from '../../../shared/project-file';
import { isFinished } from '../../../shared/finished';
import { arrivalQuestion, multiline } from '../components/Dialogs';
import { pick } from '../components/Pickers';
import { fuzzyFilter } from '../lib/fuzzy';
import * as A from './actions';
import { lifeChanged } from './life';
import { getState, showError, toast } from './store';

const isEmailName = (name: string): boolean => /\.(eml|msg)$/i.test(name);
const isPdfName = (name: string): boolean => /\.pdf$/i.test(name);

/** The open projects, for the question's other choices. */
function openProjects(): { path: string; name: string }[] {
  return getState()
    .notes.filter((n) => isProjectProps(n.props) && !isFinished(n.props?.status))
    .map((n) => ({ path: n.path, name: n.label || n.title }));
}

/** The one question for an arrival; answering files it (with Undo), not answering leaves it in the Inbox. */
export async function askArrival(landed: LandedArrival): Promise<void> {
  lifeChanged();
  const projects = landed.suggestions.filter((s) => s.target.kind === 'project' && s.target.path).map((s) => ({ path: s.target.path!, name: s.target.name, why: s.why }));
  const all = openProjects();
  // The suggested project first, else the choice stands open (never a guess the vault didn't make).
  const picked = projects[0]?.path && all.some((p) => p.path === projects[0].path) ? projects[0].path : '';
  const answer = await arrivalQuestion(landed.title, landed.person?.name ?? '', projects, all, picked);
  if (!answer) {
    toast(`“${landed.title}” is waiting in the Inbox.`, { label: 'Open', run: () => A.openPath(landed.path) });
    return;
  }
  try {
    const r = await window.nv.life.intake.answer(landed.id, answer.project, answer.step ?? '');
    const undo = !r.undo ? undefined : { label: 'Undo', run: () => void window.nv.life.inbox.undoAuto(r.undo!).then((u) => (toast(u.words), lifeChanged()), showError) };
    const open = r.paths.find((p) => p !== 'Inbox.md');
    toast(r.words, undo ?? (open ? { label: 'Open', run: () => A.openPath(answer.project) } : undefined));
    lifeChanged();
  } catch (err) {
    showError(err);
  }
}

/** Dropped or picked files: emails and PDFs land, each asked its one question; anything else says so. */
export async function landFiles(files: File[]): Promise<void> {
  const emails = files.filter((f) => isEmailName(f.name));
  const pdfs = files.filter((f) => isPdfName(f.name));
  const rest = files.filter((f) => !isEmailName(f.name) && !isPdfName(f.name));
  if (rest.length) toast(rest.length === 1 ? `“${rest[0].name}” isn’t an email or a PDF, so it stayed where it is.` : `${rest.length} files aren’t emails or PDFs, so they stayed where they are.`);
  for (const f of [...emails, ...pdfs]) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const landed = isEmailName(f.name) ? await window.nv.life.intake.email(f.name, bytes) : await window.nv.life.intake.pdf(f.name, bytes);
      if (landed.madeCard) toast(`Made a card for ${landed.person!.name}.`);
      await askArrival(landed);
    } catch (err) {
      showError(err);
    }
  }
}

/** Pasted email text: saved as an email, then its one question. */
export async function pasteEmail(): Promise<void> {
  const text = await multiline('Paste the email', { message: 'The whole email, headers and all when you have them.', placeholder: 'From: …\nSubject: …\n\n…', ok: 'Save it' });
  if (!text) return;
  try {
    const landed = await window.nv.life.intake.paste(text);
    if (landed.madeCard) toast(`Made a card for ${landed.person!.name}.`);
    await askArrival(landed);
  } catch (err) {
    showError(err);
  }
}


/** An email saved from Gmail or Outlook through the connection already there (never a new one). */
export async function saveFromMail(): Promise<void> {
  let boxes: { id: string; label: string; address: string }[] = [];
  try {
    boxes = await window.nv.life.intake.mailboxes();
  } catch (err) {
    showError(err);
    return;
  }
  if (!boxes.length) {
    toast('No mailbox is connected on this PC.');
    return;
  }
  const box = boxes.length === 1 ? boxes[0].id : await pick({ placeholder: 'Save from which mailbox?', items: (q) => fuzzyFilter(boxes, q, (b) => `${b.label} ${b.address}`, 20).map((b) => ({ id: b.id, label: b.label || b.address, detail: b.address })), footer: '↑↓ to move · Enter to look in it · Esc to cancel' });
  if (!box) return;
  let rows: { uid: number; from: string; date: string; subject: string; words: string; unread: boolean }[] = [];
  try {
    rows = await window.nv.life.intake.mailList(box, 15);
  } catch (err) {
    showError(err);
    return;
  }
  if (!rows.length) {
    toast('No recent mail there.');
    return;
  }
  const uid = await pick({
    placeholder: 'Save which email?',
    items: (q) => fuzzyFilter(rows, q, (r) => `${r.subject} ${r.from}`, 40).map((r) => ({ id: String(r.uid), label: `${r.unread ? '● ' : ''}${r.subject || '(no subject)'}`, detail: `${r.from} · ${r.date}`, sub: r.words })),
    footer: '↑↓ to move · Enter to save it · Esc to cancel',
  });
  if (!uid) return;
  try {
    const landed = await window.nv.life.intake.mailSave(box, Number(uid));
    if (landed.madeCard) toast(`Made a card for ${landed.person!.name}.`);
    await askArrival(landed);
  } catch (err) {
    showError(err);
  }
}

/** A PDF chosen from a project's linked folder on this PC. */
export async function pdfFromProjectFolder(): Promise<void> {
  const all = openProjects();
  const path = await pick({ placeholder: 'From which project’s folder?', items: (q) => fuzzyFilter(all, q, (p) => p.name, 60).map((p) => ({ id: p.path, label: p.name })), footer: '↑↓ to move · Enter to look in it · Esc to cancel' });
  if (!path) return;
  let folder = '';
  let pdfs: { rel: string; name: string }[] = [];
  try {
    const files = await window.nv.projects.files(path);
    if (!files || !files.exists || files.folder.startsWith('remote:')) {
      toast('That project has no folder on this PC. Drop the PDF in instead.');
      return;
    }
    folder = files.folder;
    pdfs = files.groups.flatMap((g) => g.files).filter((f) => /\.pdf$/i.test(f.name)).map((f) => ({ rel: f.rel, name: f.name }));
  } catch (err) {
    showError(err);
    return;
  }
  if (!pdfs.length) {
    toast('No PDFs in that folder. Drop one in instead.');
    return;
  }
  const rel = await pick({ placeholder: 'Keep which PDF?', items: (q) => fuzzyFilter(pdfs, q, (f) => f.name, 60).map((f) => ({ id: f.rel, label: f.name, detail: f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '' })), footer: '↑↓ to move · Enter to keep it · Esc to cancel' });
  if (!rel) return;
  try {
    const landed = await window.nv.life.intake.pdfFrom(`${folder}${folder.endsWith('/') || folder.endsWith('\\') ? '' : '/'}${rel}`);
    await askArrival(landed);
  } catch (err) {
    showError(err);
  }
}
