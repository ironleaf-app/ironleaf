// A moment of a meeting's recording played from a link ("[[Recording – Supplier call….m4a#12:03|12:03]]", as the
// meeting recorder writes beside each decision; 22 Oct 2026): the meeting's own player plays from there when it is on
// screen (views/MeetingPlayback.tsx registers itself), else the recording opens in its tab at that moment
// (views/MediaView.tsx takes the time waiting for it).

type Player = (seconds: number) => void;

const players = new Map<string, Set<Player>>();
const waiting = new Map<string, number>();
const key = (rel: string) => rel.replace(/\\/g, '/').toLowerCase();

/** A player on screen for a recording (returns how to take it away). */
export function registerPlayer(rel: string, play: Player): () => void {
  const k = key(rel);
  const set = players.get(k) ?? new Set<Player>();
  set.add(play);
  players.set(k, set);
  return () => {
    set.delete(play);
    if (!set.size) players.delete(k);
  };
}

/** Plays a recording from a moment in a player on screen; false when none is (the caller opens the recording). */
export function playAt(rel: string, seconds: number): boolean {
  const set = players.get(key(rel));
  if (!set?.size) {
    waiting.set(key(rel), seconds);
    return false;
  }
  for (const play of set) play(seconds);
  return true;
}

/** The moment a recording opened in its tab should start from (taken once). */
export function takeWaiting(rel: string): number | null {
  const k = key(rel);
  const at = waiting.get(k);
  waiting.delete(k);
  return at ?? null;
}

/** "12:03", "t=723", "1:02:03" as seconds (null: not a moment of a recording). */
export function momentOf(heading: string | undefined): number | null {
  if (!heading) return null;
  let h = heading;
  try {
    h = decodeURIComponent(heading);
  } catch {
    // As written.
  }
  const t = /^\s*t=(\d+(?:\.\d+)?)\s*$/i.exec(h);
  if (t) return Number(t[1]);
  const m = /^\s*(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)\s*$/.exec(h);
  return m ? (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]) : null;
}
