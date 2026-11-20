// tests/t200-vault.mjs — The t200 made-up vault (10 Nov 2026), shared: a vault shaped like a real one
// (Business, Me, Projects — the flagship with 16 open steps and 13 risks — People, Bills, Inbox, Docs,
// meetings with minutes; 3,000 notes; long names; long notes). Moved here from t200-real-content.test.mjs
// (t238) so the vault tidy proves itself on the same vault the walk judges. Made-up people and projects only.
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writeVault } from './vault-controls-harness.mjs';

export function writeT200Vault(dir) {
  writeVault(dir);
  const { mkdirSync: mk, writeFileSync: w0 } = { mkdirSync, writeFileSync };
  let seed = 20261110;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const w = (rel, text) => {
    const p = path.join(dir, ...rel.split('/'));
    mk(path.dirname(p), { recursive: true });
    w0(p, text);
  };
  const people = ['Alex Chen', 'Priya Nair', 'Sam Ortega', 'June Park', 'Tom Bradley', 'Lucy Hammond'];
  const roles = ['Shop developer', 'Designer of the new receipts', 'Weekend manager at the museum', 'Bookkeeper for the shop and the market stall', 'Electrician, rewiring the back room', 'Caterer for Friday late openings'];
  people.forEach((p, i) => w(`People/${p}.md`, `---\ntype: person\nrole: ${roles[i]}\nemail: ${p.toLowerCase().replace(/ /g, '.')}@example.invalid\n---\n# ${p}\n\n${roles[i][0].toUpperCase() + roles[i].slice(1)}. Works with [[Harbourline Cart Fix]] most weeks and answers quickly on weekday mornings.\n\n## Notes\n\nPrefers short meetings with an agenda sent the day before. Takes notes by hand and sends a photo of the page afterwards, which then needs typing up before Friday.\n`));
  const steps = [
    'Chase the 2 carts that failed on Friday (PAY-101, PAY-102) — Alex Chen — due 2026-11-05',
    'Retry the failed payment twice before showing an error, then check the Saturday orders line by line — Priya Nair — due 2026-11-06',
    'Send the receipt v2 for review with the tax line fixed and the totals double-checked — Alex Chen — due 2026-11-04',
    'Ring ShadeCo about the awning quote before it lapses on Friday afternoon — Alex Chen — due 2026-11-07',
    'Confirm the Saturday soak test window with the shop and roster Sam to watch the till — Sam Ortega — due 2026-11-09',
    'Write the rollback note for the retry fix in case Friday goes badly — Priya Nair — due 2026-11-08',
    'Reconcile the October invoices against the bank feed before the bookkeeper visit — June Park — due 2026-11-11',
    'Order the new receipt rolls and the spare till drawer key for the Friday rush — Sam Ortega — due 2026-11-12',
    'Photograph the back room wiring before Tom starts the refit on Monday — Alex Chen — due 2026-11-13',
    'Draft the December late-opening roster with cover for all four Friday nights — Priya Nair — due 2026-11-14',
    'Taste the caterer shortlist and confirm the December late night menus — Lucy Hammond — due 2026-11-15',
    'File the council permit paperwork for the awning before the November cutoff — June Park — due 2026-11-16',
    'Check the card reader logs from Saturday morning for the double-failure pattern — Alex Chen — due 2026-11-10',
    'Send June the October totals with the tax line explained in plain words — Priya Nair — due 2026-11-11',
    'Book the room for the December roster sign-off with Sam and the weekend crew — Sam Ortega — due 2026-11-12',
    'Ring both Friday customers back and offer the delivery refund in store credit — Alex Chen — due 2026-11-07',
  ];
  const risks = [
    'Repeat failures on old Safari (owner: Priya Nair, level: medium)',
    'The awning quote lapses on Friday and ShadeCo books out for December (owner: Alex Chen, level: high)',
    'The Saturday soak test finds a third failure mode the week of release (owner: Priya Nair, level: medium)',
    'The card reader fails again on a busy Saturday with no spare on site (owner: Alex Chen, level: high)',
    'The receipt tax line still reads wrong on the October sample invoices (owner: Priya Nair, level: medium)',
    'The roster leaves a Friday night uncovered and the shop opens short-handed (owner: Sam Ortega, level: low)',
    'The caterer cannot cover December and the late nights run without food (owner: Lucy Hammond, level: low)',
    'The council permit arrives late and the awning fitting slips into January (owner: June Park, level: medium)',
    'The back room rewiring overruns and blocks the December stock intake (owner: Tom Bradley, level: medium)',
    'The bank feed lags again and the October reconciliation has to be redone by hand (owner: June Park, level: low)',
    'Two key weekend crew members overlap leave across the December late nights (owner: Sam Ortega, level: medium)',
    'The till PC dies mid-rush and the spare laptop is not yet set up (owner: Alex Chen, level: high)',
    'ShadeCo raises the fitted price after the quote lapses on Friday (owner: Alex Chen, level: medium)',
  ];
  w('Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', ['---', 'type: project', 'status: active', 'health: on track', 'owner: Alex Chen', 'due: 2026-11-20', '---', '# Harbourline Cart Fix', '', '## Summary', '', "The shop's cart drops about one order in forty at payment. Fix the retry, then the receipt. See the [[Receipts spec]] for what v2 shows.", '', "## What's next", '', ...steps.map((s) => `- [ ] ${s}`), '', '## Workstreams', '', '| Workstream | Owner | Status | Next step |', '|---|---|---|---|', '| Wave list | Alex Chen | in progress | Upgrade or chase the 13 still to do at 26 Oct |', '| Receipts | Priya Nair | ready to send | Send v2 (reviewer PASS) |', '| Saturday soak test with twenty real orders in a row | Sam Ortega | not started | Book the test window with the shop |', '| December late-opening roster with cover for all four Friday nights | Priya Nair | at risk | Fill the last 3 Friday nights |', '', '## Key dates', '', '- 2026-11-06: Retry fix live (milestone)', '- 2026-11-20: Cart fix done (milestone)', '- 2026-11-27: Awning fitted before the December rush (milestone)', '', '## Decisions', '', '- 2026-11-01: Retry twice, then fail loud (decided by Alex Chen)', '- 2026-10-29: The receipt shows every line including tax, no summary rows (decided by Priya Nair)', '', '## Risks', '', ...risks.map((r) => `- ${r}`), '', '## People', '', '- Alex Chen (owner)', '- Priya Nair', ''].join('\n'));
  for (let i = 1; i <= 8; i++) w(`Projects/Harbourline Cart Fix/Notes/Kickoff note ${i} with decisions from the Tuesday session.md`, `---\ntype: note\ntags: [harbourline, kickoff]\n---\n# Kickoff note ${i} with decisions from the Tuesday session\n\nMet with [[Alex Chen]] about the [[Harbourline Cart Fix|cart fix]]. The [[Receipts v2]] design is linked. See the [[Receipts spec]].\n\nThe room agreed the retry should fail loud after two tries, and that the receipt must show every line. Priya will send v2 once the tax line matches the October invoices.\n`);
  w('Projects/The December refit of the back room, the awning and the late-opening roster/The December refit of the back room, the awning and the late-opening roster.md', `---\ntype: project\nstatus: active\nhealth: at risk\nowner: Priya Nair\ndue: 2026-12-20\n---\n# The December refit of the back room, the awning and the late-opening roster\n\n## Summary\n\nEverything that must land before the December rush: the wiring, the awning, the roster and the catering.\n\n## What's next\n\n- [ ] Publish the November roster with cover for all four Friday nights — Priya Nair — due 2026-10-28\n- [x] Confirm the caterer — Priya Nair\n\n## Workstreams\n\n| Workstream | Owner | Status | Next step |\n|---|---|---|---|\n| Roster | Priya Nair | at risk | Fill the last 3 Friday nights |\n| Catering for the late openings through December | Lucy Hammond | on track | Confirm the December dates |\n`);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJ5ErkJggg==', 'base64');
  const ap = path.join(dir, 'Docs', 'assets', 'awning-photo.png');
  mk(path.dirname(ap), { recursive: true });
  w0(ap, png);
  w('Docs/The awning decision, with quotes, photos and the December dates.md', `---\ntype: doc\n---\n# The awning decision, with quotes, photos and the December dates\n\nShadeCo quoted twelve hundred dollars fitted; see [[Harbourline Cart Fix]] for why it matters before December.\n\n## Quotes on the table\n\n| Supplier | Price | Fitted by | Notes |\n|---|---|---|---|\n| ShadeCo | $1,200 | 27 Nov | Includes the side screen and the wind sensor |\n| ClearSpan Sails and Awnings of Alexandria | $1,450 | 4 Dec | Longer wait, heavier fabric, ten-year warranty |\n| The hardware store kit, fitted by Tom | $640 | Unknown | Tom is rewiring the back room all November |\n\n## The photo June sent\n\n![The shop front on a rainy Tuesday, showing where the awning would hang](assets/awning-photo.png)\n\n## Links worth keeping\n\n- The [[Receipts spec]] for the tax line\n- [ShadeCo's awning care guide](https://example.invalid/awning-care)\n- [[Alex Chen]] to ring before Friday\n`);
  w('Business/October invoices reconciled against the bank feed, line by line.md', `---\ntype: note\ntags: [business, invoices]\n---\n# October invoices reconciled against the bank feed, line by line\n\nWent through every October invoice with [[June Park]] and matched each to the bank feed.\n\n## What matched\n\n| Invoice | Total | Bank line | Status |\n|---|---|---|---|\n| INV-1041 October stock | $812.40 | 12 Oct card settlement | Matched |\n| INV-1042 Receipt rolls and till parts | $96.10 | 14 Oct card settlement | Matched |\n| INV-1043 Catering deposit for December | $600.00 | 19 Oct transfer | Matched, see [[Museum Late Shift]] |\n\n## What did not\n\nThe power bill for the shop through October reads $214.50 but the bank shows $214.05; June is ringing them.\n`);
  const meetings = [
    ['2026-11-03 Cart standup', '2026-11-03', 'Alex Chen, Priya Nair', 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', ['Retry the failed payment twice before showing an error — Priya Nair — due 2026-11-06', 'Send the receipt v2 for review with the tax line fixed — Alex Chen — due 2026-11-04'], 'Retry twice, then fail loud'],
    ['2026-11-06 Receipt review with Priya before the Friday release', '2026-11-06', 'Alex Chen, Priya Nair, June Park', 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', ['Fix the tax line on the October sample receipt and resend it — Priya Nair — due 2026-11-07', 'Check the resend against the bank feed before Friday — June Park — due 2026-11-08'], 'The receipt shows every line including tax'],
    ['2026-11-10 Tuesday standup on the retry fix before the Friday release', '2026-11-10', 'Alex Chen, Priya Nair', 'Projects/Harbourline Cart Fix/Harbourline Cart Fix.md', ['Run the Saturday soak test with twenty real orders in a row — Sam Ortega — due 2026-11-09', 'Write the rollback note for the retry fix in case Friday goes badly — Priya Nair — due 2026-11-08'], 'Soak test before the Friday release'],
    ['2026-10-28 Roster planning for the November late openings', '2026-10-28', 'Priya Nair, Sam Ortega', 'Projects/Museum Late Shift/Museum Late Shift.md', ['Ask the weekend crew about cover for the last three Friday nights — Sam Ortega — due 2026-10-30', 'Publish the November roster with cover for all four Friday nights — Priya Nair — due 2026-10-28'], 'No Friday opens short-handed'],
    ['2026-11-12 Roster sign-off for the December late openings with Sam', '2026-11-12', 'Priya Nair, Sam Ortega', 'Projects/Museum Late Shift/Museum Late Shift.md', ['Confirm the December dates with the caterer before sign-off — Lucy Hammond — due 2026-11-11', 'File the signed December roster where the crew can see it — Sam Ortega — due 2026-11-13'], 'December roster signed by the 13th'],
    ['2026-10-21 Wiring quote walkthrough for the back room refit', '2026-10-21', 'Tom Bradley, Alex Chen', '', ['Photograph the back room wiring before Tom starts the refit on Monday — Alex Chen — due 2026-11-13', 'Accept the wiring quote in writing so Tom holds the date — Alex Chen — due 2026-10-25'], 'Tom holds the Monday start'],
    ['2026-11-05 Caterer tasting and Friday roster confirmation', '2026-11-05', 'Lucy Hammond, Sam Ortega', 'Projects/Museum Late Shift/Museum Late Shift.md', ['Taste the caterer shortlist and confirm the December late night menus — Lucy Hammond — due 2026-11-15', 'Confirm the Friday roster with the weekend crew — Sam Ortega — due 2026-11-06'], 'Caterer confirmed for December'],
    ['2026-11-14 Awning deposit and December bookings review with June', '2026-11-14', 'Alex Chen, June Park', '', ['Ring ShadeCo about the awning quote before it lapses on Friday afternoon — Alex Chen — due 2026-11-07', 'Pay the awning deposit once the October reconciliation lands — June Park — due 2026-11-12'], 'Deposit paid before December books fill'],
  ];
  for (const [title, date, who, proj, actions, decision] of meetings) {
    w(`Meetings/${title}.md`, `---\ntype: meeting\ndate: ${date}\nattendees: [${who}]\n${proj ? `project: ${proj}\n` : ''}---\n# ${title}\n\n## Agenda\n\n- The retry fix and whether it is ready for Friday\n- The receipt review and who sends it\n- Anything blocking the weekend roster\n\n## Discussion\n\nThe retry now fails twice before showing an error, which the shop tested on Saturday morning with twenty orders in a row and no drops. The receipt still needs its tax line checked against the October invoices before anyone calls it done.\n\n## Actions\n\n${actions.map((a) => `- [ ] ${a}`).join('\n')}\n- [x] Book the room for next Tuesday — Alex Chen\n\n## Decisions\n\n- ${decision}\n`);
  }
  const bills = [
    ['Harbour Internet', 'Bill', '89.00', 'Monthly', '2026-11-12', 'Phone and internet', 'Everyday', '', 'No', 'Active', '', ''],
    ['Streamly annual family plan renewal', 'Subscription', '169.99', 'Yearly', '2026-11-10', 'Subscriptions', 'Everyday', '', 'Yes', 'Active', '', ''],
    ['Power for the shop through October', 'Bill', '214.50', 'Monthly', '2026-11-20', 'Home and utilities', 'Everyday', '', 'No', 'Active', '', ''],
    ['Water', 'Bill', '120.00', 'Quarterly', '', 'Home and utilities', '', '', 'No', 'Active', '', ''],
    ['Council Rates for the shop premises', 'Bill', '480.00', 'Quarterly', '', 'Home and utilities', '', '', 'No', 'Active', '', ''],
    ['Harbour Credit Card minimum for November', 'Bill', '150.00', 'Monthly', '2026-11-08', 'Loans and cards', 'Everyday', '', 'Yes', 'Active', '', ''],
    ['Phone for Alex and the shop spare', 'Bill', '45.00', 'Monthly', '2026-11-15', 'Phone and internet', 'Everyday', '', 'Yes', 'Active', '', ''],
    ['Museum catering deposit for December late nights', 'Bill', '600.00', 'Once', '2026-11-25', 'Other', 'Savings', '', 'No', 'Active', '', ''],
  ];
  const billsText = `---\ntype: bills-table\ntable: bills\nversion: 1\n---\n# Bills\n\nOne line per bill. You can read this file; the Money page reads it too.\n\n| Name | Kind | Amount | Cycle | Due | Category | Account | Project | Autopay | Status | Paid | Note file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${bills.map((b) => `| ${b.join(' | ')} |`).join('\n')}\n`;
  w('Me/Finance/Bills.md', billsText);
  w('Finance/Bills.md', billsText);
  w('Inbox.md', `# Inbox\n\n- [ ] Call the bank about the card reader that failed twice on Saturday morning\n- [ ] A quote for the shop awning: $1,200 from ShadeCo, decide by Friday before it lapses\n- Buy milk and the long-life cartons for the back room\n`);
  w('Inbox/awning-quote.md', `# Awning quote from ShadeCo, twelve hundred dollars fitted\n\nThe awning quote is $1,200 from ShadeCo, fitted, with the deposit due Friday before the December books fill up.\n`);
  w('Inbox/the-long-email-from-the-bank-about-the-card-reader-failure.md', `# The long email from the bank about the card reader failure\n\nThe bank wrote back about the Saturday double failure; they want the logs from the till PC before they send a technician.\n`);
  const countMd = (d) => {
    let n = 0;
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) n += countMd(p);
      else if (e.endsWith('.md')) n++;
    }
    return n;
  };
  const have = countMd(dir);
  const AREAS = ['Business', 'Me', 'Work', 'Publications', 'Home', 'Health'];
  const paras = [
    'The shop was quiet on Tuesday morning, so there was time to go through the October invoices line by line and check the totals against the bank feed.',
    'Priya sent the receipt mock late in the evening with a note about the tax line, which still reads ten dollars too high on the October sample.',
    'The roster for November is nearly done; three Friday nights still need cover and Sam said he would ask around the weekend crew.',
    'Ordered the new receipt rolls and the spare till drawer key. The delivery is due Thursday, in time for the Friday rush.',
    'Went through the awning quote with June: twelve hundred dollars fitted, and ShadeCo can start the week after next if we pay the deposit now.',
  ];
  let i = 0;
  for (let n = have; n < 3000; n++) {
    i++;
    const area = AREAS[i % AREAS.length];
    const long = i % 7 === 0 ? ` with the long follow-up from the Tuesday session and the Friday deadline` : '';
    const next = `${area} note ${i + 6}${(i + 6) % 7 === 0 ? ` with the long follow-up from the Tuesday session and the Friday deadline` : ''}`;
    const link = i % 6 === 0 ? '' : ` See [[${next}]].` + (i % 25 === 0 ? ` See [[Harbourline Cart Fix]].` : '') + (i % 11 === 0 ? ` See [[2026-11-03 Cart standup]].` : '');
    const task = i % 3 === 0 ? `\n\n- [ ] Follow up on ${area.toLowerCase()} note ${i} before Friday afternoon — ${people[rnd(people.length)]} — due 2026-11-${10 + rnd(15)}\n` : '\n';
    w(`${area}/Filler/${area} note ${i}${long}.md`, `# ${area} note ${i}${long}\n\n${paras[rnd(paras.length)]}${link}\n\n${paras[rnd(paras.length)]}${task}`);
  }
  return countMd(dir);
}
