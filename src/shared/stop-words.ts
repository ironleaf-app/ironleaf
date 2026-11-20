// Small words with no matching substance (5 Nov 2026, v8-vault-assistant: the records kept this list to themselves,
// and reminders false-matched "Call the caterer" with "Send the receipt v2 for review" on the word "the"). One list
// for every near-duplicate check, read from here.

/** Words ignored when matching two things by their words (reminders, record links). */
export const STOP_WORDS: ReadonlySet<string> = new Set(
  'the a an and or but if so as at on in of for with by from to into onto about after before during until our my your their his her its this that these those there here we you they he she it is are was were be been being have has had do does did will would should could can may might must not no yes all any each every some more most other than then also only just very via per new old next last first second third one two three four five week weeks day days month months year years today tomorrow monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december aedt aest am pm et utc gmt usd gbp aud nzd eur open closed done high medium low status owner review send get make set check confirm follow up update draft read call meeting meetings notes note project projects team site sites office budget quote plan design'.split(
    ' ',
  ),
);
