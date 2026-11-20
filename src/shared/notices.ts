// The bell's notices (inside the former host app): finished tasks, approvals and questions waiting, automations that ran
// and work handed to the former host app, kept by the former host app (its src/task-tray.cjs) for both apps' bells.
// Reminders that came due (19 Oct 2026, src/main/reminders.ts) are Ironleaf's own: kept by Ironleaf, shown with the
// former host app's, and handed to the former host app's bell too when it takes them (HostNotices.add).

export type NoticeKind = 'done' | 'failed' | 'approval' | 'question' | 'plan' | 'automation' | 'automation-result' | 'automation-approval' | 'reminder';

export interface TaskNotice {
  id: string;
  at: number;
  kind: NoticeKind | string;
  title: string;
  body: string;
  /** The the former host app conversation it is about ('' for none). */
  sessionId: string;
  read: boolean;
  /** A reminder's: the note it is in and its line there (a click opens it), which reminder (to snooze or tick it from
   *  the bell), and when it was due. */
  note?: string;
  line?: number;
  reminder?: string;
  due?: number;
  /** Where a former host app notice comes from (chat, code, cowork, bot) and, for a bot's, the bot's name (9 Nov
   *  2026, t53-today-needs-you: Today's the former host app rows read these; the bell ignores them, as
   *  before). */
  surface?: string;
  bot?: string;
}

export interface NoticesView {
  items: TaskNotice[];
  unread: number;
}

/** Ironleaf's own kinds that the former host app's bell keeps a copy of (3 Nov 2026: reminders were mirrored
 *  but finance, documents and tidy lived only here, so the two bells counted differently). */
export const MIRRORED_KINDS = ['reminder', 'finance', 'documents', 'tidy'] as const;
export type MirroredKind = (typeof MIRRORED_KINDS)[number];

export interface MirroredNotice {
  kind: MirroredKind;
  title: string;
  body: string;
  note: string;
  line: number;
  due: number;
  missed: boolean;
}

/** The former host app's side (the host's `notices`). */
export interface HostNotices {
  list(): NoticesView;
  read(id?: string): NoticesView;
  /** Read, and the former host app forward on its conversation. */
  open(id: string): { opened: boolean };
  clear(): NoticesView;
  onChange(fn: () => void): () => void;
  /** A notice Ironleaf said, for the former host app's own bell too (when the former host app takes them: its
   *  task-notice words each mirrored kind). Ironleaf's bell leaves the former host app's copies out, showing
   *  its own. */
  add?(notice: MirroredNotice): unknown;
}

/** A host's answer made safe to hand the window. */
export function cleanNotices(value: unknown): NoticesView {
  const v = value as { items?: unknown; unread?: unknown } | null;
  const items = (Array.isArray(v?.items) ? v!.items : [])
    .filter((i): i is TaskNotice => !!i && typeof (i as TaskNotice).id === 'string' && typeof (i as TaskNotice).title === 'string')
    .slice(0, 40)
    .map((i) => ({
      id: i.id,
      at: Number(i.at) || 0,
      kind: String(i.kind || 'done'),
      title: String(i.title).slice(0, 120),
      body: String(i.body || '').slice(0, 400),
      sessionId: typeof i.sessionId === 'string' ? i.sessionId : '',
      read: i.read === true,
      ...(typeof i.note === 'string' && i.note ? { note: i.note, line: Number.isInteger(i.line) && i.line! >= 0 ? i.line : 0 } : {}),
      ...(typeof i.reminder === 'string' ? { reminder: i.reminder } : {}),
      ...(typeof i.due === 'number' ? { due: i.due } : {}),
      ...(typeof i.surface === 'string' && ['chat', 'code', 'cowork', 'bot'].includes(i.surface) ? { surface: i.surface } : {}),
      ...(typeof i.bot === 'string' && i.bot.trim() ? { bot: i.bot.trim().slice(0, 60) } : {}),
    }));
  return { items, unread: items.filter((i) => !i.read).length };
}

/** The bell's list: Ironleaf's own notices with the former host app's (its copies of the mirrored kinds left
 *  out, showing ours), newest first. */
export function mergeNotices(own: TaskNotice[], host: NoticesView | null): NoticesView {
  const theirs = (host?.items ?? []).filter((i) => !(MIRRORED_KINDS as readonly string[]).includes(i.kind));
  return cleanNotices({ items: [...own, ...theirs].sort((a, b) => b.at - a.at) });
}
