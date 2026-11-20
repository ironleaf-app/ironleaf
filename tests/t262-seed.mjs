// t262's rich vault (13 Nov 2026): 70 meetings with actions, decisions and questions, and a full
// inbox — the shape t261 measured (Past 5.30 screens, Every action 6.09, Every decision 3.35,
// Inbox 3.84). Shared by tests/t262-find.test.mjs and the /tmp/t262-shots.mjs pictures, so the
// proofs and the pictures show the same vault. Made-up people and words only.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PEOPLE = ['Alex Chen', 'Bettina Maddox', 'Darcy Lin', 'Priya Nair', 'June Park', 'Tom Bradley', 'Mia Tran', 'Sam Lee', 'Lucy Wang', 'Jack Doyle', 'Emma Wilson', 'Harry Singh'];

const KINDS = ['Site walk', 'Supplier call', 'Design review', 'Roster planning', 'Budget check', 'Safety briefing', 'Client update', 'Stocktake', 'Crew briefing', 'Lease review'];
const PROJECTS = ['Festival Build', 'North Wharf Refit', 'Stall Program'];

// Rare words, each in exactly the rows named (nothing else in the vault carries them):
// - marquee: 3 past titles, 2 open actions, 2 decisions (chip to chip with the words kept;
//   the actions and decisions of the 3 marquee meetings match through their meeting column too:
//   11 of 212 actions, 5 of 71 decisions).
// - harbour: inbox lines and files only (Inbox: 3 lines + 1 file).
// - generator: 2 open actions (Tasks: exactly 2 rows).
// - sourdough: one note's title (Notes).
// - maddox: Bettina Maddox (People).

/** 70 meetings: 60 past, 10 coming up. Returns { past: 60, upcoming: 10 }. */
export function seedMeetings(w, D) {
  const marqueeTitles = new Set([4, 23, 47]);
  const generatorActions = new Set([9, 51]);
  const marqueeActions = new Set([15, 44]);
  const marqueeDecisions = new Set([14, 38]);
  for (let i = 0; i < 70; i++) {
    const past = i < 60;
    const date = past ? D(-180 + i * 3) : D(1 + (i - 60));
    const title = marqueeTitles.has(i) ? `Marquee ${KINDS[i % KINDS.length].toLowerCase()} ${i + 1}` : `Festival ${KINDS[i % KINDS.length].toLowerCase()} ${i + 1}`;
    const a = PEOPLE[i % PEOPLE.length];
    const b = PEOPLE[(i + 4) % PEOPLE.length];
    const c = PEOPLE[(i + 7) % PEOPLE.length];
    const project = i % 3 === 2 ? '' : PROJECTS[i % 3];
    const action1 = generatorActions.has(i)
      ? `Confirm the generator fuel delivery for the stalls — ${b} — due ${D(-150 + i * 3)}`
      : marqueeActions.has(i)
        ? `Confirm the marquee peg delivery for the stalls — ${b} — due ${D(-150 + i * 3)}`
        : `Follow up on session ${i + 1} with the crew — ${b} — due ${D(-150 + i * 3)}`;
    const action2 = `- [ ] Send the ${KINDS[(i + 1) % KINDS.length].toLowerCase()} notes to ${a.split(' ')[0]} — ${c}`;
    const done = `- [x] Book the room for session ${i + 1} — ${a}`;
    const decision = marqueeDecisions.has(i) ? 'The marquee fabric is ordered before Friday' : `Session ${i + 1} opens with the stalls walk`;
    const questions = i % 3 === 0 ? `\n## Questions\n\n- ? Who books the night crew for session ${i + 1} — ${b}\n` : '';
    w(
      `Meetings/${date} ${title}.md`,
      `---\ntype: meeting\ndate: ${date}\nattendees: [${a}, ${b}]\nproject: ${project}\n---\n# ${title}\n\n## Agenda\n\n- The stalls and the power walk\n${questions}\n## Actions\n\n- [ ] ${action1}\n${action2}\n${done}\n\n## Decisions\n\n- ${decision}\n`,
    );
  }
  return { past: 60, upcoming: 10 };
}

/** Three small projects (actions group by project; the projects room reads real). */
export function seedProjects(w, D) {
  for (const [i, name] of PROJECTS.entries()) {
    w(
      `Projects/${name}/${name}.md`,
      `---\ntype: project\nstatus: active\nhealth: on track\nowner: ${PEOPLE[i]}\ndue: ${D(30 + i * 10)}\n---\n# ${name}\n\n## Summary\n\nThe festival ${name.toLowerCase()} across the showground.\n\n## What's next\n\n- [ ] Open the ${name.toLowerCase()} job — ${PEOPLE[i]} — due ${D(5 + i)}\n- [ ] Price the ${name.toLowerCase()} extras — ${PEOPLE[(i + 1) % PEOPLE.length]}\n`,
    );
  }
}

/** A full inbox: 38 capture lines plus 8 files in the Inbox folder. */
export function seedInbox(w) {
  const lines = [
    '- [ ] Call the bank about the card reader',
    '- [ ] A quote for the shop awning: $1,200 — decide by Friday',
    '- Buy milk',
    '- [ ] Ring ShadeCo about the marquee poles',
    '- The marquee quote came in under budget',
    '- [ ] Book the food truck for opening night',
    '- Voicemail from the electrician about the site board',
    '- [ ] Pay the power bill before Thursday',
    '- Photo of the cracked tile in the cold room',
    '- [ ] Order more till rolls for the front counter',
    '- Ask Mia about the weekend roster gap',
    '- [ ] Confirm the delivery window with the nursery',
    '- Book the harbour cruise for the staff dinner',
    '- [ ] Renew the food licence this month',
    '- The plumber moved the Thursday visit to Friday',
    '- [ ] Get a second quote for the coolroom service',
    '- [ ] File the BAS before the end of the month',
    '- The harbour car park is full on Saturdays',
    '- [ ] Update the price board for the new menu',
    '- Reminder: council pickup is a day early this week',
    '- [ ] Chase the invoice from the sign writer',
    '- The marquee pegs are missing from the shed box',
    '- [ ] Water the front planters before the weekend',
    '- Quote: reprint the takeaway menus, 500 copies',
    '- [ ] Check the first aid kit expiry dates',
    '- Voicemail from mum about Sunday lunch',
    '- [ ] Drop the dry cleaning off on the way in',
    '- The front door closer slams — needs adjusting',
    '- [ ] Reorder coffee beans, two bags',
    '- Idea: winter soup special with the bakery rolls',
    '- [ ] Confirm the window cleaner for next Tuesday',
    '- The storeroom light flickers when it rains',
    '- [ ] Back up the laptop before the trip',
    '- Pick up the harbour festival flyers',
    '- [ ] Service the ute before the new year',
    '- The neighbour offered their ladder for the gutters',
    '- [ ] Post the signed lease copy back',
    '- Idea: staff dinner after the busy season',
  ];
  w('Inbox.md', `# Inbox\n\n${lines.join('\n')}\n`);
  const files = [
    ['Awning quote.md', '# Awning quote\n\nThe awning quote is $1,200 from ShadeCo.\n'],
    ['Marquee measurements.md', '# Marquee measurements\n\nThe front marquee measures six by three metres.\n'],
    ['Till receipt.md', '# Till receipt\n\nThe spare till receipt for the warranty claim.\n'],
    ['Menu draft.md', '# Menu draft\n\nWinter menu draft with the new soup special.\n'],
    ['Roster photo.md', '# Roster photo\n\nA photo of the roster whiteboard from Sunday.\n'],
    ['Harbour supplier card.md', '# Harbour supplier card\n\nThe new harbour supplier business card from the expo.\n'],
    ['Parking fine.md', '# Parking fine\n\nThe parking fine from Tuesday, due in three weeks.\n'],
    ['Recipe clipping.md', '# Recipe clipping\n\nA slow-cooker recipe from the weekend paper.\n'],
  ];
  for (const [name, text] of files) w(`Inbox/${name}`, text);
  return { lines: lines.length, files: files.length };
}

/** Fifteen plain notes (one titled with sourdough) plus people cards for two. */
export function seedNotes(w) {
  const notes = [
    'Sourdough starter log',
    'Winter menu ideas',
    'Roster notes',
    'Supplier contacts',
    'Shopfront paint colours',
    'Till troubleshooting',
    'Staff leave balances',
    'Cold room service history',
    'Market day checklist',
    'Bakery order template',
    'Cleaning roster',
    'Incident report draft',
    'New hire induction list',
    'Power bill comparison',
    'End of year stocktake plan',
  ];
  for (const [i, name] of notes.entries()) w(`Notes/${name}.md`, `# ${name}\n\nNotes about ${name.toLowerCase()}, kept while working.\n`);
  w('People/Bettina Maddox.md', '---\ntype: person\nrole: Operations lead\norg: Festival Group\n---\n# Bettina Maddox\n\nRuns the festival operations crew.\n');
  w('People/Alex Chen.md', '---\ntype: person\nrole: Site manager\norg: Festival Group\n---\n# Alex Chen\n\nManages the festival site build.\n');
}

/** The whole rich vault in one call. */
export function seedT262Vault(vaultDir, D) {
  const w = (rel, text) => {
    const p = path.join(vaultDir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const meetings = seedMeetings(w, D);
  seedProjects(w, D);
  const inbox = seedInbox(w);
  seedNotes(w);
  return { meetings, inbox };
}
