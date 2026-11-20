// The vault-care vault (p11, Nov 2026): a made-up vault as big as a real one, so the task lists are
// judged with lots of real, long content, not three short rows. One project with 37 long tasks, 23
// notes, 57 files and 12 people. Part of tests/vault-care-rows.test.mjs; not a test itself. Dates
// sit around the day the vault is written, so late / today / future read the same whenever it runs.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PEOPLE = [
  ['Mia Tran', 'Project owner'],
  ['Jack Doyle', 'Site lead'],
  ['Priya Nair', 'Designer'],
  ['Sarah Kim', 'Planner'],
  ['Tom Nguyen', 'Electrician'],
  ['Lucy Wang', 'Councils'],
  ['Ben Carter', 'Builder'],
  ['Ava Singh', 'Data cabling'],
  ['Leo Martin', 'Aircon'],
  ['Ruby Clarke', 'Accounts'],
  ['Max Taylor', 'Security'],
  ['Zoe Anderson', 'Fit-out'],
];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (d) => `${d.getDate()} ${MON[d.getMonth()]}`;
const at = (off) => {
  const d = new Date();
  d.setDate(d.getDate() + off);
  return d;
};

// 37 long next steps: late, today, future, no date, a bare state ("Open" says
// nothing and must read as an empty cell; "Ongoing" reads quietly), an owner
// written in the title's own words ("- Jack Doyle", display only), and two done.
function steps() {
  const t = (off) => dm(at(off));
  const rows = [
    ['Get the updated racking plan from Sarah and check your aisles against the fire egress lines', 'Mia Tran', t(-5)],
    ['Ask Jack Doyle to confirm his 26 Oct concrete pour sign-off to the certifier in writing', 'Mia Tran', t(-2)],
    ['Open the depot survey workbook (access granted 29 Oct) and the cable schedule and mark every drop', 'Mia Tran', t(2)],
    ['Audit column Q of the survey workbook and chase the sites that have not commented', 'Mia Tran', t(0)],
    ['Ava answers the wholesaler eight challenge questions on the cable schedule (see the depot action register)', 'Priya Nair', t(2)],
    ['Ava gives the depot update Sarah asked for on 29 Oct, with the revised delivery dates', 'Priya Nair', t(2)],
    ['Ava sends the detailed switchboard breakdown, a refreshed quote and confirms the comms room slide', 'Ava Singh', t(2)],
    ['Decide the switchboard vendor selection (RACI row: vendor choice still open)', 'Tom Nguyen', null],
    ['Decide whether the mezzanine steel order stands or is cut back to stage one only', 'Jack Doyle', null],
    ['Narrow the showroom estimate to the agreed fit-out scope and reissue it', 'Zoe Anderson', null],
    ['Deliver the depot 2026, 2027 and 2028 capacity plan: leads accept or reject the staging advice', 'Mia Tran', t(9)],
    ['Send Sarah milestone reports each Friday; coordinate local sparkies and country freight', 'Mia Tran', 'Ongoing'],
    ['Follow up with Lucy on the council framing approval for the mezzanine', 'Lucy Wang', 'Open'],
    ['Open the depot survey workbook; ask Jack to confirm his 26 Oct pour sign-off in writing', 'Mia Tran', t(-5)],
    ['Audit column Q of the depot survey workbook; chase Mackay, Cairns and Townsville depots', 'Mia Tran', t(0)],
    ['Read the switchboard schedule and the cable map; ask Sarah for the 7 Nov kick-off recording', 'Mia Tran', t(3)],
    ['Set the 2026, 2027, 2028 budgets in the depot schedule: Brisbane 47k, Cairns 80k, rest to 2027', 'Mia Tran', t(9)],
    ['Move Townsville and Mackay to 2027 in the depot schedule and tell their leads', 'Mia Tran', t(9)],
    ['Check the Teams comments in the workbook and update the depot schedule to match', 'Mia Tran', t(9)],
    ['Talk to Sarah about the York Street tenancy: finance has 20k, might be half the wiring', 'Mia Tran', null],
    ['Get the Cairns cost summary correction and the racking plan; confirm call attendance - Jack Doyle', null, null],
    ['Ask the certifier whether the 4:30 pm Friday inspection can move to Monday morning', 'Lucy Wang', t(1)],
    ['Book the crane for the mezzanine steel delivery window on Chelmer Street', 'Ben Carter', t(4)],
    ['Confirm the aircon commissioning date with Leo before the ceiling goes in', 'Leo Martin', t(5)],
    ['Chase the security panel quote from Max; the insurer wants it before handover', 'Max Taylor', t(-1)],
    ['Pay the progress claim for the slab pour once Ruby signs the variation', 'Ruby Clarke', t(6)],
    ['Walk the site with Ben and photograph every defect before the Friday meeting', 'Ben Carter', t(1)],
    ['Send the updated fire services layout to the certifier for the occupancy permit', 'Lucy Wang', t(7)],
    ['Order the LED high bays for aisle four; check the lux levels against the plan', 'Tom Nguyen', t(8)],
    ['Confirm the racking delivery date with the Brisbane supplier and book the forklift', 'Jack Doyle', t(2)],
    ['Write up the toolbox talk notes and file them with the safety folder', 'Ben Carter', null],
    ['Ask Zoe for the final paint schedule so the-carpenters can start on Monday', 'Zoe Anderson', t(3)],
    ['Reconcile the October invoices against the purchase orders before month end', 'Ruby Clarke', t(-3)],
    ['Test the emergency lighting on level two and log the results for the certifier', 'Tom Nguyen', t(4)],
    ['File the asbestos clearance certificate with the principal contractor records', 'Lucy Wang', null],
    ['Sign off the completed dock leveller installation with the supplier', 'Mia Tran', null, true],
    ['Approve the final clean scope for the ground floor handover', 'Mia Tran', null, true],
  ];
  return rows;
}

export function writeCareVault(dir) {
  const w = (rel, text) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  const proj = 'Projects/Brisbane Depot Refit';
  const filesDir = path.join(dir, ...`${proj}/Files`.split('/'));

  const next = steps()
    .map(([what, who, when, done]) => {
      const tail = [who, when ? `by ${when}` : ''].filter(Boolean).join(' · ');
      return `- [${done ? 'x' : ' '}] ${what}${tail ? ` — ${tail}` : ''}`;
    })
    .join('\n');

  w(
    `${proj}/Brisbane Depot Refit.md`,
    `---\ntype: project\nstatus: active\nhealth: at risk\nowner: Mia Tran\ndue: ${iso(at(9))}\nfolder: ${filesDir}\n---\n# Brisbane Depot Refit\n\n## Summary\n\nThe Salisbury depot gets new racking, a mezzanine and a comms room before the Christmas freight peak. Steel, sparkies and certifier in that order.\n\n## What's next\n\n${next}\n\n## Workstreams\n\n| Workstream | Owner | Status | Next step |\n|---|---|---|---|\n| Steel | Jack Doyle | in progress | Book the crane for the Chelmer Street delivery |\n| Electrical | Tom Nguyen | in progress | Order the LED high bays for aisle four |\n| Certification | Lucy Wang | at risk | Move the Friday inspection to Monday |\n\n## Key dates\n\n- ${iso(at(2))}: Racking delivery (milestone)\n- ${iso(at(9))}: Depot handover (milestone)\n\n## Decisions\n\n- ${iso(at(-2))}: Steel before sparkies, certifier last (decided by Mia Tran)\n\n## Risks\n\n- Crane booking slips past the steel delivery (owner: Jack Doyle, level: high)\n- Certifier availability in December (owner: Lucy Wang, level: medium)\n\n## People\n\n- Mia Tran (owner)\n- Jack Doyle (site lead)\n- Priya Nair\n`,
  );

  // 23 notes: site notes, dailies with dated tasks, meetings with actions, docs.
  const noteTasks = [
    `- [ ] Confirm the headcount for the Friday walk — Mia Tran 📅 ${iso(at(1))}`,
    `- [ ] Chase the crane booking reference from the hire company 📅 ${iso(at(-1))}`,
    `- [ ] Water the site office plants`,
  ].join('\n');
  const made = [];
  made.push(['Notes/Depot action register.md', `---\ntype: note\ntags: [depot]\n---\n# Depot action register\n\nThe [[Brisbane Depot Refit|refit plan]] in short. Steel first, sparkies second, certifier last.\n\n${noteTasks}\n`]);
  made.push(['Notes/Cable schedule.md', `---\ntype: note\ntags: [depot, electrical]\n---\n# Cable schedule\n\nEvery drop in the [[Brisbane Depot Refit|refit plan]], aisle by aisle. Ava owns the updates.\n\n- [ ] Mark every unlabelled drop on level two 📅 ${iso(at(0))}\n`]);
  made.push(['Notes/Racking plan.md', `---\ntype: note\ntags: [depot]\n---\n# Racking plan\n\nThe supplier plan for the [[Brisbane Depot Refit|refit plan]] aisles, with the egress lines Sarah drew.\n`]);
  for (let i = 1; i <= 8; i++) {
    made.push([
      `Notes/Site note ${i}.md`,
      `---\ntype: note\ntags: [depot, site]\n---\n# Site note ${i}\n\nWalk ${i} of the [[Brisbane Depot Refit|refit plan]] floors. Long edges, dusty corners, and the one door that never shuts.\n\n- [ ] Photograph defect ${i} before Friday 📅 ${iso(at(i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : 5))}\n`,
    ]);
  }
  made.push(['Daily/' + iso(at(0)) + '.md', `# ${dm(at(0))}\n\n- [ ] Walk the site with Ben 📅 ${iso(at(0))}\n- [ ] Call the certifier about Monday 📅 ${iso(at(0))} 09:00\n- [x] Read the brief\n`]);
  made.push(['Daily/' + iso(at(-1)) + '.md', `# ${dm(at(-1))}\n\n- [ ] Late: confirm the crane reference 📅 ${iso(at(-1))}\n`]);
  made.push([
    'Meetings/Friday walk.md',
    `---\ntype: meeting\ndate: ${iso(at(-2))}\nattendees: [Mia Tran, Jack Doyle, Ben Carter]\nproject: Projects/Brisbane Depot Refit/Brisbane Depot Refit.md\n---\n# Friday walk\n\nAbout the [[Brisbane Depot Refit|refit plan]].\n\n## Agenda\n\n- Steel delivery\n- Defects\n\n## Actions\n\n- [ ] Book the crane for the steel delivery — Ben Carter\n- [ ] Photograph every defect — Ben Carter\n`,
  ]);
  made.push([
    'Meetings/Certifier call.md',
    `---\ntype: meeting\ndate: ${iso(at(-4))}\nattendees: [Mia Tran, Lucy Wang]\nproject: Projects/Brisbane Depot Refit/Brisbane Depot Refit.md\n---\n# Certifier call\n\nAbout the [[Brisbane Depot Refit|refit plan]].\n\n## Actions\n\n- [ ] Send the fire services layout — Lucy Wang\n`,
  ]);
  made.push(['Docs/Safety folder.md', `---\ntype: doc\n---\n# Safety folder\n\n## Summary\n\nToolbox talks for the [[Brisbane Depot Refit|refit plan]] site, filed by week.\n`]);
  made.push(['Docs/Handover checklist.md', `---\ntype: doc\n---\n# Handover checklist\n\n## Summary\n\nWhat the [[Brisbane Depot Refit|refit plan]] handover needs: clean, lights, certifier sign-off.\n`]);
  made.push(['Inbox.md', `# Inbox\n\n- [ ] Call the hire company about the crane reference 📅 ${iso(at(0))}\n- [ ] A quote for the dock bumpers: $2,400 — decide by Friday\n- Idea: shade cloth over the western dock\n`]);
  // Pad to exactly 23 notes (counted as .md files outside Projects/People/Templates).
  let n = made.length;
  for (let i = n; i < 23; i++) {
    made.push([`Notes/Depot filing ${i + 1}.md`, `# Depot filing ${i + 1}\n\nNotes from the [[Brisbane Depot Refit|refit plan]] folder, kept for the record.\n`]);
  }
  for (const [rel, text] of made) w(rel, text);

  // 12 people.
  for (const [name, role] of PEOPLE) {
    w(`People/${name}.md`, `---\ntype: person\nrole: ${role}\n---\n# ${name}\n\n${role} on the [[Brisbane Depot Refit|refit plan]].\n`);
  }

  // 57 files in the project folder.
  // No .md here: the indexer reads Markdown as notes, so a .md "file" would leak into Notes.
  const exts = ['pdf', 'xlsx', 'jpg', 'png', 'docx', 'txt', 'csv', 'zip'];
  const kinds = ['plan', 'quote', 'photo', 'schedule', 'spec', 'invoice', 'permit', 'drawing'];
  for (let i = 0; i < 57; i++) {
    const ext = exts[i % exts.length];
    const kind = kinds[i % kinds.length];
    w(`${proj}/Files/${kind}-${String(i + 1).padStart(2, '0')}.${ext}`, `made-up ${kind} file ${i + 1} for the refit\n`);
  }

  w('Templates/Standup.md', `# Standup\n\n## Agenda\n\n## Actions\n`);
  w('.neuralvault/areas.json', JSON.stringify({ version: 1, areas: [{ id: 'me', name: 'Me', folder: 'Me' }] }));
  return dir;
}

export const CARE_PEOPLE = PEOPLE.map(([name]) => name);
