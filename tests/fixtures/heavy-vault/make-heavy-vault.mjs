// tests/fixtures/heavy-vault/make-heavy-vault.mjs — a heavy made-up vault for the layout walk (round 2, 20 Nov 2026).
//
// A user judged round 1 on a real vault and the walk had used a five-note sample. This vault is shaped like a real one
// (the counts, not the words): areas Work, Business, Home, Health, Me and Publications; 15 projects; 40 people; 20
// meetings with minutes and open actions; 130+ open tasks of which 100+ carry no date; a brand kit with three logos,
// four colours and two fonts; 75 assets across many folders, tags and collections; captures waiting in the Inbox. Every
// name and word is made up. Dates are relative to the day it is written, so Today always has late, today's, this week's
// and undated work.
//  node tests/fixtures/heavy-vault/make-heavy-vault.mjs <dir>          (writes into <dir>, adding to what is there)
//   SHOT_VAULT=heavy node tools/shots.mjs . <out>                        (the walk writes it into its throwaway copy)
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 86400000;
const iso = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// A tiny PNG (solid colour with a darker band), so the asset grid has real pictures of different colours.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    const band = y > h * 0.62;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const k = band ? 0.7 : 1 - (x / w) * 0.15;
      raw[o] = Math.round(r * k); raw[o + 1] = Math.round(g * k); raw[o + 2] = Math.round(b * k);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const logoSvg = (fg, bg, word) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160"><rect width="320" height="160" fill="${bg}"/><path d="M60 40 L110 40 L95 80 L120 80 L70 128 L82 90 L56 90 Z" fill="${fg}"/>${word ? `<text x="132" y="96" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="${fg}">${word}</text>` : ''}</svg>\n`;
const iconSvg = (fg, i) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="${6 + (i % 4)}" fill="none" stroke="${fg}" stroke-width="2"/><rect x="${8 + (i % 3)}" y="8" width="6" height="6" fill="${fg}"/></svg>\n`;

export function writeHeavyVault(dir, now = Date.now()) {
  let seed = 20261120;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pick = (a) => a[rnd(a.length)];
  const put = (rel, text) => { const p = path.join(dir, ...rel.split('/')); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); };
  const day = (n) => iso(now + n * DAY);

  // Areas: the set, so Today's area chips read as theirs do.
  const areas = [
    ['work', 'Work', 'briefcase', 'slate'], ['business', 'Business', 'chart', 'clay'], ['home', 'Home', 'home', 'ochre'],
    ['health', 'Health', 'heart', 'sage'], ['me', 'Me', 'person', 'sky'], ['publications', 'Publications', 'book', 'plum'],
    ['library', 'Library', 'bookmark', 'stone'],
  ].map(([id, name, icon, color]) => ({ id, name, folder: name, icon, color, about: `${name} things`, ...(id === 'library' ? { quiet: true } : {}) }));
  put('.neuralvault/areas.json', JSON.stringify({ version: 1, areas, home: 'work' }, null, 2) + '\n');

  // 40 people.
  const first = ['Aria', 'Ben', 'Carla', 'Dev', 'Elena', 'Farid', 'Grace', 'Hugo', 'Isla', 'Jonah', 'Kiri', 'Leo', 'Maya', 'Nico', 'Olive', 'Pavel', 'Quinn', 'Rosa', 'Sione', 'Tara'];
  const last = ['Whitfield', 'Okoro', 'Lindqvist', 'Moreau', 'Tanaka', 'Hargreaves', 'Delacroix', 'Petrov', 'Aldana', 'Ferreira'];
  const orgs = ['Fernhill Supply', 'Northgate Logistics', 'Bluewren Hotels', 'Tallis & Co', 'Copperline AV', 'Harbourview Council', 'Kestrel Print', 'Marlow Group'];
  const roles = ['Programme manager', 'Site lead', 'Lighting engineer', 'Procurement', 'Finance partner', 'Studio manager', 'Designer', 'Vendor account manager', 'IT lead', 'Editor'];
  const people = [];
  for (let i = 0; i < 40; i++) {
    const name = `${first[i % 20]} ${last[(i * 7 + Math.floor(i / 20)) % 10]}`;
    if (people.includes(name)) continue;
    people.push(name);
    const area = i < 28 ? 'Work' : 'Business';
    put(`${area}/People/${name}.md`, `---\ntype: person\nrole: ${roles[i % roles.length]}\norganisation: ${orgs[i % orgs.length]}\nemail: ${name.toLowerCase().replace(/ /g, '.')}@example.invalid\ntags: [${i % 3 ? 'colleague' : 'vendor'}]\n---\n# ${name}\n\n${roles[i % roles.length]} at ${orgs[i % orgs.length]}. Prefers a short agenda the day before and answers fastest in the morning.\n\n## Notes\n\n- Met on the ${pick(['Northgate rollout', 'Bluewren refit', 'Harbourview screens', 'Kestrel print run'])}\n- Likes decisions written down the same day\n`);
  }
  const who = () => people[rnd(people.length)];

  // 15 projects, each with dated and (mostly) undated steps; a few notes each with undated tasks.
  const projects = [
    ['Work', 'Northgate hall lighting', 'at risk'], ['Work', 'Bluewren hotel meeting rooms', 'on track'], ['Work', 'Harbourview council screens', 'on track'],
    ['Work', 'Office network refresh', 'at risk'], ['Work', 'Copperline vendor transition', 'on track'], ['Work', 'Board room upgrade Level 12', 'on track'],
    ['Work', 'Laptop replacement plan', 'off track'], ['Work', 'Service desk handover', 'on track'], ['Business', 'Fernhill Supply website', 'on track'],
    ['Business', 'Spring product launch', 'at risk'], ['Business', 'Wholesale pricing review', 'on track'], ['Home', 'Kitchen renovation', 'on track'],
    ['Home', 'Garden and fence', 'on track'], ['Health', 'Half marathon training', 'on track'], ['Publications', 'The Fernhill Quarterly, winter edition', 'on track'],
  ];
  const verbs = ['Confirm', 'Chase', 'Draft', 'Review', 'Book', 'Send', 'Check', 'Update', 'Order', 'Agree', 'Write up', 'Ring', 'Price', 'Test', 'Sign off'];
  const things = ['the floor plan with the site team', 'the revised quote and delivery dates', 'the cabling schedule for level 2', 'the handover pack for the service desk', 'the screen mounts and the spare stock', 'the risk register with the new dates', 'the budget line against the purchase order', 'the vendor contacts list and escalation path', 'the test plan for the first two rooms', 'the training slots for the front desk', 'the photos for the launch page', 'the copy for the newsletter feature', 'the asset tags on the returned laptops', 'the licence count against the invoice', 'the room booking panels firmware'];
  let undated = 0, dated = 0;
  projects.forEach(([area, name, health], pi) => {
    const owner = who();
    const steps = [];
    const n = 5 + (pi % 3);
    for (let s = 0; s < n; s++) {
      const text = `${verbs[(pi + s) % verbs.length]} ${things[(pi * 3 + s) % things.length]}`;
      // About one step in four is dated: a few late, a few this week, some later.
      const r = (pi * 11 + s * 5) % 16;
      const due = r === 0 ? day(-3 - (s % 5)) : r === 1 ? day(0) : r === 2 || r === 3 ? day(1 + ((pi + s) % 6)) : r === 4 ? day(12 + s) : null;
      if (due) dated++; else undated++;
      steps.push(`- [ ] ${text} — ${who()}${due ? ` · due ${due}` : ''}`);
    }
    steps.push(`- [x] Kick-off held — ${owner}`);
    const team = [owner, who(), who(), who()];
    put(`${area}/Projects/${name}/${name}.md`, `---\ntype: project\nstatus: ${pi === 14 ? 'planning' : 'active'}\nhealth: ${health}\nprogress: ${10 + ((pi * 17) % 80)}\nowner: ${owner}\ndue: "${day(20 + pi * 6)}"\nupdated: "${day(-(pi % 5))}"\n---\n# ${name}\n\n## Summary\n\n${name} for ${orgs[pi % orgs.length]}: scope agreed, suppliers chosen, the first rooms booked. The remaining risk is lead time on hardware and the sign-off dates.\n\n## What’s next\n\n${steps.join('\n')}\n\n## Key dates\n\n- ${day(4 + pi)}: Design sign-off (milestone)\n- ${day(25 + pi * 3)}: Go-live (milestone)\n\n## People\n\n${team.map((p, i) => `- **${p}** — ${i ? roles[(pi + i) % roles.length] : 'Owner'}`).join('\n')}\n\n## Risks and issues\n\n- **${pick(['High', 'Medium', 'Low'])}** — Hardware lead time slips past the go-live\n- **Medium** — Sign-off needs two people who are both away in December\n\n## Decisions\n\n- **${day(-10 - pi)}** — Do the work one floor at a time. *Why:* fewer rooms out at once.\n`);
    for (let k = 0; k < (pi % 3 === 0 ? 2 : 1); k++) {
      const tasks = [];
      for (let t = 0; t < 2 + ((pi + k) % 3); t++) { tasks.push(`- [ ] ${verbs[(k + t + pi) % verbs.length]} ${things[(t * 4 + k + pi) % things.length]}`); undated++; }
      put(`${area}/Projects/${name}/Notes/${['Working notes', 'Supplier call', 'Site walk'][k]} ${day(-k * 6 - pi)}.md`, `---\ntags: [${name.split(' ')[0].toLowerCase()}, notes]\n---\n# ${['Working notes', 'Supplier call', 'Site walk'][k]}\n\nAbout [[${name}]] with [[${team[1]}]]. Most of the open questions are about timing; nothing blocks the next step yet.\n\n${tasks.join('\n')}\n`);
    }
  });

  // Loose notes with dated and undated tasks (late, today, this week).
  const loose = [['Me', 'Personal admin'], ['Home', 'House jobs'], ['Health', 'Training log'], ['Business', 'Marketing ideas'], ['Work', 'Inbox follow-ups']];
  loose.forEach(([area, name], i) => {
    const tasks = [];
    for (let t = 0; t < 6; t++) {
      const r = (i * 3 + t) % 7;
      const due = r === 0 ? day(-1 - t) : r === 1 ? day(0) : r === 2 ? day(2 + t) : null;
      if (due) dated++; else undated++;
      tasks.push(`- [ ] ${verbs[(i + t * 2) % verbs.length]} ${things[(i * 5 + t) % things.length]}${due ? ` 📅 ${due}` : ''}`);
    }
    put(`${area}/${name}.md`, `# ${name}\n\nThe running list.\n\n${tasks.join('\n')}\n- [x] Done last week\n`);
  });

  // 20 meetings: 15 past with minutes and open actions, 2 today, 3 coming.
  for (let m = 0; m < 20; m++) {
    const p = projects[m % 8];
    const offset = m < 15 ? -(1 + m * 2) : m < 17 ? 0 : 2 + (m - 17) * 3;
    const att = [who(), who(), who()];
    const title = `${['Weekly sync', 'Supplier review', 'Design walk-through', 'Steering group', 'Site visit debrief'][m % 5]} — ${p[1].split(' ').slice(0, 2).join(' ')}${m > 4 ? ` ${m}` : ''}`;
    const past = offset < 0;
    put(`Work/Meetings/${title}.md`, `---\ntype: meeting\ndate: ${day(offset)}\ntime: "${String(9 + (m % 7)).padStart(2, '0')}:${m % 2 ? '30' : '00'}"\nproject: "[[${p[1]}]]"\nattendees: [${att.join(', ')}]\ntags: [meeting]\n---\n${past ? `## Summary\n\nThe group went through the open items on [[${p[1]}]]. Delivery dates hold except the screens, which slip a week. Budget is on track; the change request goes to the steering group.\n\n## Decisions\n\n- Keep the staged rollout by floor\n- Move the training to the week after go-live\n\n## Actions\n\n- [ ] ${att[0]}: ${verbs[m % verbs.length].toLowerCase()} ${things[m % things.length]}\n- [ ] ${att[1]}: ${verbs[(m + 3) % verbs.length].toLowerCase()} ${things[(m + 5) % things.length]}\n- [x] ${att[2]}: send the slides\n` : `## Agenda\n\n- Progress since last time\n- Risks and dates\n- Anything else\n`}`);
  }

  // The Inbox: captures waiting to be filed.
  for (let c = 0; c < 9; c++) put(`Inbox/Capture ${day(-c)} ${c + 1}.md`, `${['Idea: a one-page handover checklist for every room', 'Call back the fence quote', 'Photo of the whiteboard from the steering group', 'Link: wholesale price benchmark', 'Remember the passport renewal', 'Draft intro for the winter edition', 'Question for finance about the PO split', 'Book the physio', 'Screen mount part number'][c]}\n`);

  // Assets: 75 files across kinds and folders, tagged and collected, with one brand kit (3 logos, 4 colours, 2 fonts).
  const A = 'Assets';
  const entries = {};
  const tagsPool = ['brand', 'print', 'web', 'launch', 'office', 'site photo', 'northgate', 'bluewren', 'harbourview', 'newsletter', 'winter', 'product', 'team', 'signage', 'social', 'archive', 'draft', 'final'];
  const cols = ['Brand', 'Launch photos', 'Site photos', 'Newsletter', 'Signage'];
  const add = (rel, data, meta = {}) => { put(rel, data); entries[rel] = { tags: [pick(tagsPool), pick(tagsPool)].filter((t, i, a) => a.indexOf(t) === i), ...(rnd(3) === 0 ? { collections: [pick(cols)] } : {}), added: day(-rnd(60)), ...meta }; };
  add(`${A}/Logos/Fernhill logo.svg`, logoSvg('#1f5f3f', '#ffffff', 'Fernhill'), { description: 'The main logo, for light backgrounds.', alt: 'Fernhill Supply logo', tags: ['brand'], collections: ['Brand'] });
  add(`${A}/Logos/Fernhill logo on dark.svg`, logoSvg('#ffffff', '#1f5f3f', 'Fernhill'), { description: 'For dark backgrounds and photos.', alt: 'Fernhill Supply logo, white', tags: ['brand'], collections: ['Brand'] });
  add(`${A}/Logos/Fernhill mark.svg`, logoSvg('#1f5f3f', '#f3efe6', ''), { description: 'The square mark.', alt: 'Fernhill mark', tags: ['brand'], collections: ['Brand'] });
  for (let i = 0; i < 4; i++) add(`${A}/Logos/Partner logo ${i + 1}.svg`, logoSvg(['#8a2d2d', '#2d4f8a', '#6b4b8a', '#8a6a2d'][i], '#ffffff', ['Northgate', 'Bluewren', 'Harbour', 'Kestrel'][i]));
  const hues = [[214, 120, 80], [80, 140, 200], [120, 170, 110], [200, 170, 90], [150, 110, 180], [90, 90, 100], [220, 200, 170], [60, 120, 120]];
  const imgFolders = ['Images', 'Images/Launch', 'Images/Sites', 'Images/Team'];
  for (let i = 0; i < 26; i++) add(`${A}/${imgFolders[i % 4]}/${['Shopfront', 'Warehouse floor', 'Meeting room', 'Product shot', 'Team photo', 'Screen wall', 'Loading dock'][i % 7]} ${i + 1}.png`, png(240, 160, hues[i % hues.length]), { alt: 'A made-up placeholder picture' });
  for (let i = 0; i < 10; i++) add(`${A}/Icons/${['arrow', 'check', 'warning', 'room', 'screen', 'cable', 'phone', 'mail', 'pin', 'star'][i]}.svg`, iconSvg('#1f5f3f', i));
  const docs = ['Brand guidelines.pdf', 'Rate card 2027.pdf', 'Floor plan level 2.pdf', 'Supplier contract.pdf', 'Handover checklist.docx', 'Budget FY27.xlsx', 'Launch deck.pptx', 'Room standards.pdf', 'Training guide.docx', 'Price list.xlsx', 'Signage spec.pdf', 'Press release.docx', 'Winter edition proofs.pdf', 'Insurance schedule.pdf', 'Warranty terms.pdf', 'Org chart.pdf', 'Cabling standard.pdf', 'Fence quote.pdf'];
  docs.forEach((d, i) => add(`${A}/Documents/${i < 9 ? '' : 'Archive/'}${d}`, `Made-up document ${d}\n`));
  for (let i = 0; i < 6; i++) add(`${A}/Video and audio/${['Site walk', 'Launch teaser', 'Interview', 'Voice memo', 'Training clip', 'Podcast intro'][i]}.${i % 2 ? 'mp4' : 'm4a'}`, 'made-up\n');
  for (let i = 0; i < 8; i++) add(`${A}/Other/${['fonts', 'palette', 'export', 'backup', 'notes', 'swatches', 'sizes', 'misc'][i]}.${['zip', 'ase', 'csv', 'json', 'txt', 'aco', 'csv', 'dat'][i]}`, 'made-up\n');
  const brand = {
    name: 'Fernhill Supply',
    footer: 'Fernhill Supply · Made-up company for the layout walk',
    logos: { primary: `${A}/Logos/Fernhill logo.svg`, onDark: `${A}/Logos/Fernhill logo on dark.svg`, icon: `${A}/Logos/Fernhill mark.svg` },
    colours: [
      { name: 'Fern', hex: '#1f5f3f', use: 'Headings and the logo' },
      { name: 'Moss', hex: '#6b8f4e', use: 'Highlights' },
      { name: 'Paper', hex: '#f3efe6', use: 'Backgrounds' },
      { name: 'Clay', hex: '#b5643c', use: 'Calls to action' },
    ],
    fonts: [{ name: 'Georgia', use: 'Headings' }, { name: 'Arial', use: 'Body text' }],
  };
  put(`${A}/assets.json`, JSON.stringify({ about: 'Ironleaf’s asset index (made-up fixture)', version: 1, brand, collections: cols, assets: entries }, null, 2) + '\n');
  return { people: people.length, projects: projects.length, meetings: 20, assets: Object.keys(entries).length, openTasks: dated + undated, undated };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node make-heavy-vault.mjs <dir>'); process.exit(2); }
  console.log(writeHeavyVault(path.resolve(dir)));
}
