// Who a "who" names (moved verbatim from src/shared/project-hub.ts, p12-task-writes round 2, 4 Nov 2026: the write
// check in src/shared/task-write.ts is built into the former host app's plugins by tools/build-embedded.mjs, and
// importing it from project-hub dragged layouts, front matter and the yaml library into that small bundle — one small
// module both sides share instead, project-hub re-exports it so its readers move nowhere).

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Whether a "who" names this person: their whole name, a bare first name, or last-name-first ("Lee, Alex"). A fuller name with another last name ("Alex Morgan") never does. */
export function namesPerson(who: string, me: string): boolean {
  const w = ` ${norm(who)} `;
  const full = norm(me);
  if (!full) return false;
  if (w.includes(` ${full} `)) return true;
  const parts = full.split(' ').filter(Boolean);
  const first = parts[0];
  if (first.length < 3 || !w.includes(` ${first} `) || w.includes(` ${first} s `)) return false;
  const whoWords = norm(who).split(' ').filter(Boolean);
  if (whoWords.length < 2) return true;
  return whoWords[whoWords.length - 1] === parts[parts.length - 1] || whoWords[0] === parts[parts.length - 1];
}
