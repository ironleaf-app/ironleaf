// The brain vault (9 Nov 2026): a made-up vault shaped like a real one, for the brain prototype's tests and
// pictures - about 170 notes in Work, Me, Business, Publications, Home and Health, with people, projects and
// meetings, and edit dates spread over a month. Deterministic (seeded), so every run sees the same brain.
//   writeBrainVault(dir, now?) -> { total, areas }
// Part of tests/brain-graph.test.mjs; not a test itself.
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import path from 'node:path';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOPICS = {
  Work: ['Cart retry', 'Receipts review', 'Roster gap', 'Supplier call', 'Till roll order', 'Awning quote', 'Menu print', 'Till outage', 'Delivery run', 'Price board', 'Staff keys', 'Fridge alarm', 'Council permit', 'Bin roster'],
  Me: ['Morning walk', 'Read list', 'Yoga pass', 'Dentist book', 'Library holds', 'Journal', 'Guitar practice', 'Sleep log', 'Vitamin order', 'Bike service', 'Photo sort', 'Letter to Mum'],
  Business: ['Winter menu', 'Catering quote', 'Lease renewal', 'Insurance check', 'Bean supplier', 'Loyalty cards'],
  Publications: ['Southerly recipe', 'Winter bake notes', 'Market stall flyer', 'Preserves label'],
  Home: ['Gutter clean', 'Spare bulbs', 'Pantry stock', 'Fuse box map'],
  Health: ['Physio plan', 'Script refill', 'Swim pass'],
  People: ['Alex Chen', 'Priya Nair', 'Sam Ortiz', 'Mia Wong', 'Tom Baker', 'Lucy Hart', 'Jack Dunn', 'Ruby Vale', 'Nina Moss', 'Omar Haddad', 'Kate Bell', 'Finn Cole', 'Ava Reid', 'Leo Marsh'],
  Projects: ['Harbourline Cart Fix', 'Bakery Winter Menu', 'Stallholder Flyer', 'Pantry Restock', 'Ferry Timetable Fix', 'Roster Overhaul', 'Loyalty Launch', 'Menu Board Print'],
  Meetings: ['Cart standup', 'Menu tasting', 'Roster review', 'Supplier intro', 'Lease chat', 'Flyer check', 'Till training', 'Winter planning'],
};

const PLAN = [['Work', 52], ['Me', 40], ['Business', 16], ['Publications', 12], ['Home', 12], ['Health', 8], ['People', 14], ['Projects', 8], ['Meetings', 8]];

export function writeBrainVault(dir, now = Date.now()) {
  const rnd = mulberry32(20261109);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const files = new Map();
  const titles = new Map(); // id -> title
  for (const [area, n] of PLAN) {
    const topics = TOPICS[area];
    for (let i = 0; i < n; i++) {
      const base = area === 'People' || area === 'Projects' || area === 'Meetings' ? topics[i % topics.length] : `${pick(topics)} ${i + 1}`;
      const title = area === 'People' || area === 'Projects' || area === 'Meetings' ? base : `${base}`;
      // Titles stay unique: a number suffix where the topic repeats.
      const seen = [...titles.values()].filter((t) => t === title).length;
      const finalTitle = seen ? `${title} (${seen + 1})` : title;
      const id = `${area}/${finalTitle}.md`;
      titles.set(id, finalTitle);
      files.set(id, { area, title: finalTitle });
    }
  }
  const ids = [...files.keys()];
  const byArea = (a) => ids.filter((id) => id.startsWith(a + '/'));
  // Six notes stay deliberately unlinked: loose thoughts. Plain unique prose, no tags, no names shared.
  const loose = [byArea('Work')[3], byArea('Me')[5], byArea('Home')[2], byArea('Business')[4], byArea('Publications')[6], byArea('Health')[1]];
  const looseSet = new Set(loose);
  const linkTo = (id) => `[[${titles.get(id)}]]`;
  const w = (rel, text, ageDays) => {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
    const t = new Date(now - ageDays * 86400000);
    utimesSync(p, t, t);
  };
  for (const id of ids) {
    const { area, title } = files.get(id);
    // A quarter touched this week (recent), the rest spread over the month.
    const recent = rnd() < 0.28;
    const age = recent ? rnd() * 6.5 : 7.5 + rnd() * 22;
    if (looseSet.has(id)) {
      w(id, `# ${title}\n\nA stray note about the ${title.toLowerCase()} kept aside, linked to nothing yet.\n`, age);
      continue;
    }
    const lines = [`# ${title}`, ''];
    if (area === 'People') lines.push('A card for ' + title + ', met through the market stall.', '');
    if (area === 'Projects') lines.push('---', 'type: project', 'status: active', '---', '', `The ${title.toLowerCase()} work, week by week.`, '');
    if (area === 'Meetings') lines.push('---', 'type: meeting', `date: 2026-10-${String(10 + Math.floor(rnd() * 18))}`, '---', '', 'Notes and actions.', '');
    const inArea = byArea(area).filter((x) => x !== id && !looseSet.has(x));
    const outs = new Set();
    // Within-area threads: each note links one or two neighbours, so lobes hold together.
    for (let k = 0; k < 1 + Math.floor(rnd() * 2) && inArea.length; k++) outs.add(pick(inArea));
    // Hubs: the first note of Work and Me gathers many links.
    if ((area === 'Work' || area === 'Me') && rnd() < 0.3) outs.add(byArea(area)[0]);
    if (id === byArea('Work')[0] || id === byArea('Me')[0]) {
      for (let k = 0; k < 6 && inArea.length; k++) outs.add(pick(inArea));
    }
    // Cross-area fibres: people, projects and meetings tie the lobes together.
    if (area === 'People' && rnd() < 0.7) outs.add(pick(byArea('Projects')));
    if (area === 'Projects') {
      outs.add(pick(byArea('Work')));
      if (rnd() < 0.6) outs.add(pick(byArea('Meetings')));
      if (rnd() < 0.5) outs.add(pick(byArea('People')));
    }
    if (area === 'Meetings') {
      outs.add(pick(byArea('People')));
      if (rnd() < 0.5) outs.add(pick(byArea('Work')));
    }
    if ((area === 'Business' || area === 'Publications' || area === 'Home' || area === 'Health') && rnd() < 0.35) {
      outs.add(pick(byArea('Work')));
    }
    if (rnd() < 0.12) outs.add(pick(ids.filter((x) => x !== id && !looseSet.has(x))));
    outs.delete(id);
    for (const o of looseSet) outs.delete(o);
    lines.push('Links: ' + [...outs].slice(0, 6).map(linkTo).join(', ') + '.');
    lines.push('');
    lines.push(`Kept for the ${area.toLowerCase()} lobe: ${title.toLowerCase()} notes and dates.`);
    w(id, lines.join('\n') + '\n', age);
  }
  return { total: ids.length, loose, areas: PLAN.map(([a, n]) => [a, n]) };
}
