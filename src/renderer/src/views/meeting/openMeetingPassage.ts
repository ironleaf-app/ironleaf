import { readMeeting, type MeetingItem } from '../../../../shared/work-meetings';
import { openPath } from '../../state/actions';
import { docs } from '../../state/docs';
import { showError, toast } from '../../state/store';

export async function openMeetingPassage(path: string, kind: 'agenda' | 'decisions', item: Pick<MeetingItem, 'text' | 'line'>, where: 'tab' | 'current' = 'current') {
  try {
    await docs.changedOnDisk([path]);
    const content = docs.text(path) ?? await window.nv.notes.read(path);
    const matches = readMeeting({ path, title: '', props: {}, content })[kind].filter((row) => row.text === item.text);
    if (matches.length === 1) openPath(path, { where, mode: 'live', line: matches[0].line, span: 0 });
    else {
      openPath(path, { where });
      toast(matches.length ? 'This passage appears several times. Opened the meeting.' : 'This passage has changed. Opened the meeting.');
    }
  } catch (error) {
    showError(error);
  }
}
