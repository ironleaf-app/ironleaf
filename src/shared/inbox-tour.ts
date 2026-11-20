// The one short explanation of where things go (5 Nov 2026; 9 Nov 2026, t119 one-tap filing: nothing files
// itself — each capture shows its best home, and one tap files it there). Inbox, project, doc, note. Once,
// for a first-time person, in the app's tour system (ModuleTour's seen keys). Nothing more.
export const INBOX_TOUR_ID = 'inbox-rule';
export const INBOX_TOUR_SEEN_KEY = 'nv.tour.inbox-rule';
export interface InboxTourStep {
  title: string;
  body: string;
}
/** Four words, four short steps: where a thing goes without working it out. */
export const INBOX_TOUR_STEPS: InboxTourStep[] = [
  { title: 'Inbox', body: 'Not sure where it goes? Put it in the Inbox. Each capture shows its best home, and one click files it there.' },
  { title: 'Project', body: 'Work with an end becomes a project, with its tasks and dates.' },
  { title: 'Doc', body: 'How something works becomes a doc, one per subject, kept up to date.' },
  { title: 'Note', body: 'Anything else stays a plain note, linked where it helps.' },
];
