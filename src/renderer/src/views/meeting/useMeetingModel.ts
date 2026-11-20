// One meeting read two ways (t248, 12 Nov 2026): the note below is the meeting, so its Tasks, Decisions
// and Questions sections all read the same model — the saved note's meeting context (whether it is a
// meeting, its project, its people) plus the live text read where it shows (shared/work-meetings
// readMeeting: the same actions, questions and decisions the Meetings room reads, in the same order).
// Typing moves the rows at once; the context turns with the revision, as the old panel did.
import { useEffect, useMemo, useState } from 'react';
import type { MeetingContext } from '../../../../main/reviews';
import { displayTitle } from '../../../../shared/markdown';
import { isMeetingNote } from '../../../../shared/meetings';
import { isPrivatePath } from '../../../../shared/private';
import { readMeeting, type MeetingRec } from '../../../../shared/work-meetings';
import { useApp } from '../../state/store';

export interface MeetingModel {
  ctx: MeetingContext | null;
  model: MeetingRec | null;
}

export function useMeetingModel(path: string, text: string): MeetingModel {
  const revision = useApp((s) => s.revision);
  const props = useApp((s) => s.byPath.get(path)?.props);
  const [ctx, setCtx] = useState<MeetingContext | null>(null);
  // Looked up only on a meeting (t146, 9 Nov 2026): every note asked the bridge for its meeting
  // context on every open and all but meetings threw the answer away.
  const looksMeeting = !isPrivatePath(path) && isMeetingNote(path, props ?? {});
  useEffect(() => {
    if (!looksMeeting) {
      setCtx(null);
      return;
    }
    let alive = true;
    window.nv.meetings.context(path).then(
      (c) => alive && setCtx(c),
      () => alive && setCtx(null),
    );
    return () => {
      alive = false;
    };
  }, [path, revision, looksMeeting]);
  useEffect(() => {
    setCtx(null);
  }, [path]);
  // The rows from the live text (a tick lands while typing, never on the last save).
  const model = useMemo(() => (ctx?.meeting ? readMeeting({ path, title: displayTitle(path, props), props: props ?? {}, content: text }) : null), [ctx?.meeting, path, props, text]);
  return { ctx, model };
}
