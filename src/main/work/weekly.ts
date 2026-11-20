// Weekly Updates on the main side (Wave 6 part b; src/shared/weekly-updates.ts): one note a week in the module's folder,
// read from the index; every change on the page is one change of that week's note (its words read, changed, written back
// with the person's own properties kept); a progress line or a risk written into the linked project through the project
// page's own path (its history, so Undo takes it back); the update sent as text, a Word document or a PDF; an older long
// note of updates brought in, one note a week, the old note left as it was; "due" said in the bell once a week.

import { parseProject, openSteps } from '../../shared/project-file';
import { projectNameKeys } from '../../shared/work-modules';
import { formatDate } from '../../shared/dates';
import { sameWhat } from '../../shared/meetings';
import { applyWeeklyEdit, audienceFrom, gatheredSections, historyWords, importWeeklyNote, looksLikeWeeklyNote, mondayOf, newWeekly, readDayWords, readWeekly, streamKey, sureProject, weekShort, weekTitle, weeklyDocx, weeklyFileName, weeklyModel, weeklyText, writeWeekly, FLAGS, type ExportBrand, type ProjectInfo, type WeeklyEdit, type WeeklyUpdate } from '../../shared/weekly-updates';
import type { ToolCtx, WorkModules, WorkNotice, WorkPart } from '../work-modules';
import type { VaultIndex } from '../indexer';

const S = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function makeWeekly(w: WorkModules): WorkPart {
  const settings = async () => ({ dueDay: await w.setting('weekly', 'dueDay', 3), audience: await w.setting('weekly', 'audience', ''), sentBy: await w.setting('weekly', 'sentBy', '') });

  async function updates(index: VaultIndex = w.d.index): Promise<WeeklyUpdate[]> {
    const notes = await w.notesOf(index, ['weekly-update']);
    return notes.map((n) => readWeekly(n.path, n.content)).filter((u) => u.week);
  }

  /** Every project as a section's link shows it (health, due, open next steps), with what its updates and risks say. */
  function projectInfos(index: VaultIndex = w.d.index): (ProjectInfo & { updates: string[]; risks: string[] })[] {
    const out: (ProjectInfo & { updates: string[]; risks: string[] })[] = [];
    for (const c of w.d.projects()) {
      const text = index.content(c.path);
      if (text === undefined) continue;
      const p = parseProject(text, c.path);
      out.push({ path: c.path, name: c.name, health: p.health ?? '', status: p.status ?? '', due: p.due ?? '', progress: typeof p.progress === 'number' ? p.progress : null, next: openSteps(p).slice(0, 30), updates: p.updates.map((u) => sameWhat(u.what)), risks: p.risks.map((r) => sameWhat(r.what)) });
    }
    return out;
  }
  const projectOf = (name: string, infos: ProjectInfo[]) => {
    const n = name.trim().toLowerCase();
    return n ? (infos.find((p) => p.name.toLowerCase() === n) ?? infos.find((p) => p.path.toLowerCase().replace(/\.md$/, '').endsWith(`/${n}`))) : undefined;
  };

  /** Long notes of weekly updates that could be brought in (one heading a week), with how many weeks each holds. */
  function importable(): { path: string; title: string; weeks: number }[] {
    const out: { path: string; title: string; weeks: number }[] = [];
    for (const m of w.d.index.allMeta()) {
      if (!/\.md$/i.test(m.path)) continue;
      const text = w.d.index.content(m.path) ?? '';
      if (!/^##\s+(?:week\s+|w\/c\s+)/im.test(text) || !looksLikeWeeklyNote(text, m.props ?? {})) continue;
      const weeks = importWeeklyNote(text, { year: new Date(m.mtime).getFullYear() }).length;
      if (weeks) out.push({ path: m.path, title: m.title, weeks });
    }
    return out.slice(0, 20);
  }

  async function model() {
    const s = await settings();
    const all = await updates();
    const m = weeklyModel(all, w.today(), s.dueDay);
    const infos = projectInfos();
    const have = new Set(all.map((u) => u.week));
    const imports = importable()
      .map((x) => ({ ...x, new: importWeeklyNote(w.d.index.content(x.path) ?? '', { year: w.today().getFullYear() }).filter((wk) => !have.has(wk.week)).length }))
      .filter((x) => x.new > 0);
    return { ...m, projects: infos, settings: s, folder: await w.folderOf('weekly-update'), importable: imports };
  }

  function updateAt(rel: string): WeeklyUpdate {
    return readWeekly(rel, w.noteText(rel));
  }

  async function weekNote(week: string, index: VaultIndex = w.d.index): Promise<WeeklyUpdate | null> {
    const monday = mondayOf(week);
    return (await updates(index)).find((u) => u.week === monday) ?? null;
  }

  async function create(week: string, opts: { fromLast?: boolean; audience?: string } = {}): Promise<string> {
    w.need('weekly');
    const monday = mondayOf(readDayWords(week) ?? w.todayIso());
    const all = await updates();
    const there = all.find((u) => u.week === monday);
    if (there) return there.path;
    const last = opts.fromLast === false ? null : ([...all].filter((u) => u.week < monday).sort((a, b) => b.week.localeCompare(a.week))[0] ?? null);
    const s = await settings();
    const u = newWeekly(monday, last, { audience: S(opts.audience, 120) || s.audience });
    return w.newNote(await w.folderOf('weekly-update'), weeklyFileName(monday), writeWeekly(u));
  }

  async function edit(rel: string, edits: WeeklyEdit | WeeklyEdit[]): Promise<string> {
    w.need('weekly');
    const before = w.noteText(rel);
    const u = readWeekly(rel, before);
    const list = (Array.isArray(edits) ? edits : [edits]).slice(0, 200);
    const said = list.map((e) => applyWeeklyEdit(u, e)).filter(Boolean);
    const after = writeWeekly(u, before);
    if (after !== before) await w.d.writeNote(rel, after);
    return said.length === 1 ? said[0] : said.length ? `Made ${said.length} changes.` : '';
  }

  /** A first draft gathered from the projects' own updates, next steps and risks (30 Oct 2026); the person corrects it. */
  async function gather(rel: string): Promise<string> {
    const before = w.noteText(rel);
    const u = readWeekly(rel, before);
    const g = gatheredSections(projectInfos(), u.sections);
    if (!g.added && !g.sectionsAdded) return 'Nothing new to gather from your projects this week.';
    u.sections = g.sections;
    await w.d.writeNote(rel, writeWeekly(u, before));
    return `Gathered a first draft: ${g.added} ${g.added === 1 ? 'line' : 'lines'} from your projects${g.sectionsAdded ? `, ${g.sectionsAdded} new ${g.sectionsAdded === 1 ? 'workstream' : 'workstreams'}` : ''}. Check it and change anything that is not right.`;
  }

  async function markSent(rel: string, opts: { date?: string; by?: string } = {}): Promise<string> {
    const s = await settings();
    const day = readDayWords(S(opts.date, 20)) ?? w.todayIso();
    const u = updateAt(rel);
    await edit(rel, [
      { kind: 'header', field: 'status', value: 'Sent' },
      { kind: 'header', field: 'sent', value: day },
      { kind: 'header', field: 'sentBy', value: S(opts.by, 120) || u.sentBy || s.sentBy },
    ]);
    return `${weekTitle(u.week)} marked sent.`;
  }

  /** A progress line written into the linked project's updates, or a blocker into its risks (each once). */
  async function toProject(rel: string, section: number, what: 'progress' | 'risk', index: number): Promise<string> {
    const u = updateAt(rel);
    const s = u.sections[section];
    if (!s) throw new Error('That workstream isn’t in this update any more.');
    const p = projectOf(s.project, projectInfos());
    if (!p) throw new Error(s.project ? `There’s no project called ${s.project} now.` : `${s.name} isn’t linked to a project yet. Link one first.`);
    const line = what === 'progress' ? s.progress[index] : s.blockers[index];
    if (!line) throw new Error('That line isn’t there any more.');
    const proj = parseProject(w.noteText(p.path), p.path);
    const list = what === 'progress' ? proj.updates.map((x) => x.what) : proj.risks.map((x) => x.what);
    if (list.some((x) => sameWhat(x) === sameWhat(line))) return `That’s in ${p.name}’s ${what === 'progress' ? 'updates' : 'risks'} already.`;
    const day = formatDate('D MMM YYYY', w.today());
    await w.d.editProject(p.path, what === 'progress' ? { kind: 'add', list: 'updates', item: { what: line, date: day, from: `Weekly update, ${weekShort(u.week)}` } } : { kind: 'add', list: 'risks', item: { what: line, level: 'medium' } }, 'you', what === 'progress' ? `Added an update to ${p.name} from the weekly update.` : `Added a risk to ${p.name} from the weekly update.`);
    return what === 'progress' ? `Written into ${p.name}’s updates.` : `Added to ${p.name}’s risks.`;
  }

  async function importPlan(rel: string) {
    const text = w.noteText(rel);
    const meta = w.d.index.get(rel);
    const have = new Set((await updates()).map((u) => u.week));
    const weeks = importWeeklyNote(text, { year: new Date(meta?.mtime ?? Date.now()).getFullYear(), audience: audienceFrom(meta?.props ?? {}), thisWeek: mondayOf(w.todayIso()) });
    const projects = w.d.projects();
    return {
      path: rel,
      title: meta?.title ?? rel,
      audience: audienceFrom(meta?.props ?? {}),
      weeks: weeks.map((x) => ({ week: x.week, heading: x.heading, exists: have.has(x.week), sections: x.update.sections.map((s) => ({ name: s.name, project: s.project || sureProject(s.name, projects), metrics: s.metrics.length, progress: s.progress.length })), attachments: x.update.attachments.length, status: x.update.status })),
    };
  }

  async function importNote(rel: string, opts: { audience?: string; link?: boolean } = {}): Promise<{ created: string[]; skipped: string[]; words: string }> {
    w.need('weekly');
    const text = w.noteText(rel);
    const meta = w.d.index.get(rel);
    const all = await updates();
    const have = new Set(all.map((u) => u.week));
    const audience = S(opts.audience, 120) || audienceFrom(meta?.props ?? {});
    const weeks = importWeeklyNote(text, { year: new Date(meta?.mtime ?? Date.now()).getFullYear(), audience, thisWeek: mondayOf(w.todayIso()) });
    const projects = w.d.projects();
    const created: string[] = [];
    const skipped: string[] = [];
    const folder = await w.folderOf('weekly-update');
    for (const x of weeks) {
      if (have.has(x.week)) {
        skipped.push(x.week);
        continue;
      }
      // A workstream links to the one project it surely means (its words), never a guess between two.
      if (opts.link !== false) for (const s of x.update.sections) if (!s.project) s.project = sureProject(s.name, projects);
      // Where it came from, after the module's own properties (where a later save keeps it).
      const note = writeWeekly(x.update).replace(/\n---\n/, `\nsource: "[[${rel.replace(/\.md$/i, '')}]]"\n---\n`);
      created.push(await w.newNote(folder, weeklyFileName(x.week), note));
      have.add(x.week);
    }
    const words = created.length ? `Brought in ${created.length} ${created.length === 1 ? 'week' : 'weeks'} from ${meta?.title ?? 'the note'}${skipped.length ? ` (${skipped.length} already here)` : ''}. The note itself is left as it was.` : skipped.length ? 'Every week in that note is here already.' : 'No weeks were found in that note (a heading such as “Week of 19 October 2026” starts each one).';
    return { created, skipped, words };
  }

  async function attach(rel: string, files?: string[]): Promise<string> {
    const picked = files?.length ? files : await w.pickFiles('Files to send with this update');
    if (!picked.length) return '';
    const kept = await w.keepFiles(rel, picked);
    if (!kept.length) return 'Those files couldn’t be kept.';
    await edit(rel, kept.map((k) => ({ kind: 'add-attachment' as const, link: k, name: k.split('/').pop() ?? k })));
    return kept.length === 1 ? `Attached ${kept[0].split('/').pop()}.` : `Attached ${kept.length} files.`;
  }

  async function exportWord(rel: string, brand: ExportBrand = {}): Promise<string | null> {
    const u = updateAt(rel);
    return w.d.saveFile({ title: 'Save the update as a Word document', name: `${weekTitle(u.week)}`, ext: 'docx', filter: 'Word document', data: weeklyDocx(u, brand) });
  }

  /** One value of the History table changed (a week's audience, status, sent day or sender). */
  async function setField(input: { path?: string | null; field?: string; value?: unknown }): Promise<string | null> {
    const rel = S(input?.path, 1000);
    if (!rel) throw new Error('That can’t be changed here.');
    const field = S(input.field, 40);
    const map: Record<string, 'audience' | 'status' | 'sent' | 'sentBy'> = { audience: 'audience', status: 'status', sent: 'sent', sent_by: 'sentBy' };
    if (!map[field]) throw new Error('That can’t be changed here.');
    return (await edit(rel, { kind: 'header', field: map[field], value: String(input.value ?? '') })) || null;
  }

  /** What the project's page shows: each week's line for the workstreams linked to it. */
  async function forProject(projectPath: string) {
    const p = w.d.projects().find((x) => x.path === projectPath);
    if (!p) return { tile: null, attention: [] };
    const keys = projectNameKeys(p);
    const rows: { words: string; sub?: string; path?: string; detail?: { kind: string; key: string }; tone?: string }[] = [];
    const attention: { words: string; path: string; tone: 'bad' | 'warn' }[] = [];
    const all = await updates();
    for (const u of all.sort((a, b) => b.week.localeCompare(a.week)))
      for (const s of u.sections)
        if (s.project && keys.includes(s.project.toLowerCase())) {
          rows.push({ words: `${weekShort(u.week)} · ${s.flag || 'No flag'}`, sub: s.status || s.name, detail: { kind: 'week', key: u.week }, ...(s.flag ? { tone: s.flag } : {}) });
          if (rows.length === 1 && (s.flag === 'Blocked' || s.flag === 'At risk')) attention.push({ words: `${s.name} was ${s.flag.toLowerCase()} in the weekly update (${weekShort(u.week)})`, path: u.path, tone: s.flag === 'Blocked' ? 'bad' : 'warn' });
        }
    return { tile: rows.length ? { title: 'Weekly updates', rows: rows.slice(0, 8) } : null, attention };
  }

  // ── Notices ──────────────────────────────────────────────────────────────────────────────────────────────────────

  async function check(): Promise<WorkNotice[]> {
    const s = await settings();
    const m = weeklyModel(await updates(), w.today(), s.dueDay);
    if (m.due.state === 'sent') return [];
    if (!m.due.dueToday && !m.due.overdue) return [];
    const words = m.due.state === 'none' ? 'Not started yet: start it from last week’s.' : `A draft with ${m.current!.sections.length} ${m.current!.sections.length === 1 ? 'workstream' : 'workstreams'}, not marked sent.`;
    return [{ key: `weekly:${m.thisWeek}:${m.due.overdue ? 'late' : 'due'}`, kind: 'weekly', title: m.due.overdue ? 'This week’s update is overdue' : 'This week’s update is due today', body: words, path: m.current?.path ?? '' }];
  }

  // ── The agents' tools ────────────────────────────────────────────────────────────────────────────────────────────

  async function tool(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
    const day = readDayWords(S(args.week, 20)) ?? w.todayIso();
    const monday = mondayOf(day);
    const mine = await updates(ctx.gated);
    const refused = ctx.gated === w.d.index ? 0 : (await updates()).length - mine.length;
    const refusedWords = refused ? `\n${refused} ${refused === 1 ? 'weekly update is' : 'weekly updates are'} at a level ${ctx.agent} isn’t allowed (Ironleaf › Settings › Privacy and secrets). Don’t guess at ${refused === 1 ? 'it' : 'them'}.` : '';
    if (name === 'weekly_update_get') {
      const ws = S(args.workstream, 120);
      if (ws) {
        const hist = weeklyModel(mine, w.today()).workstreams;
        const h = hist.find((x) => x.key === streamKey(ws)) ?? hist.find((x) => x.key.includes(streamKey(ws)) || streamKey(ws).includes(x.key));
        if (!h) return `No workstream called ${ws} in the weekly updates.${hist.length ? ` They have: ${hist.map((x) => x.name).join(', ')}.` : ''}${refusedWords}`;
        return historyWords(h, w.today().getFullYear()) + refusedWords;
      }
      const u = mine.find((x) => x.week === monday);
      if (!u) {
        const latest = [...mine].sort((a, b) => b.week.localeCompare(a.week))[0];
        return `There’s no update for the ${weekTitle(monday).replace(/^Week/, 'week')} yet.${latest ? ` The latest is the ${weekTitle(latest.week).replace(/^Week/, 'week')} (${latest.status.toLowerCase()}).` : ''}${refusedWords}`;
      }
      return `${weekTitle(u.week)} (${u.status.toLowerCase()}${u.status === 'Sent' && u.sent ? ` ${u.sent}` : ''}${u.audience ? `, to ${u.audience}` : ''}) [${u.path}]\n\n${weeklyText(u, { title: false })}${refusedWords}`;
    }
    // Writes: the week's note, made from last week's when it isn't there.
    if (name === 'weekly_update_create') {
      const there = mine.find((x) => x.week === monday);
      if (there) return `There’s already an update for the ${weekTitle(monday).replace(/^Week/, 'week')} [${there.path}].`;
      const folder = await w.folderOf('weekly-update');
      const rel = await w.freeNote(folder, weeklyFileName(monday));
      ctx.check?.(rel);
      const last = args.from_last === false ? null : ([...mine].filter((u) => u.week < monday).sort((a, b) => b.week.localeCompare(a.week))[0] ?? null);
      const s = await settings();
      await w.d.requireCreate();
      await w.d.writeNote(rel, writeWeekly(newWeekly(monday, last, { audience: S(args.audience, 120) || s.audience })));
      return `Started the ${weekTitle(monday).replace(/^Week/, 'week')}${last ? ` from the ${weekTitle(last.week).replace(/^Week/, 'week')} (${last.sections.length} workstreams carried on, numbers to fill)` : ''} [${rel}].`;
    }
    let u = mine.find((x) => x.week === monday);
    let started = '';
    if (!u) {
      const res = await tool('weekly_update_create', { week: monday }, ctx);
      const rel = /\[([^\]]+)\]\.?$/.exec(res)?.[1];
      if (!rel) return res;
      u = updateAt(rel);
      started = `Started the ${weekTitle(monday).replace(/^Week/, 'week')} from last week first. `;
    }
    ctx.check?.(u.path);
    const sectionIndex = (ws: string) => u!.sections.findIndex((s) => streamKey(s.name) === streamKey(ws));
    if (name === 'weekly_update_add_section') {
      const ws = S(args.workstream, 120);
      if (!ws) return 'Give the workstream’s name.';
      const edits: WeeklyEdit[] = [];
      let i = sectionIndex(ws);
      if (i < 0) {
        edits.push({ kind: 'add-section', name: ws, project: S(args.project, 200) });
        i = u.sections.length;
      } else if (S(args.project, 200)) edits.push({ kind: 'section', section: i, field: 'project', value: S(args.project, 200) });
      const flag = S(args.flag, 20);
      if (flag) {
        if (!FLAGS.some((f) => f.toLowerCase() === flag.toLowerCase())) return `The flag is one of ${FLAGS.join(', ')}.`;
        edits.push({ kind: 'section', section: i, field: 'flag', value: flag });
      }
      if (S(args.status, 1000)) edits.push({ kind: 'section', section: i, field: 'status', value: S(args.status, 1000) });
      const cur = u.sections[i];
      const lines = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 1000)).slice(0, 40) : []);
      const fresh = (list: string[], have: string[] = []) => list.filter((x) => !have.some((h) => sameWhat(h) === sameWhat(x)));
      for (const t of fresh(lines(args.progress), cur?.progress)) edits.push({ kind: 'add-item', section: i, list: 'progress', text: t });
      for (const t of fresh(lines(args.next_steps), cur?.next)) edits.push({ kind: 'add-item', section: i, list: 'next', text: t });
      const blockers = lines(args.blockers);
      if (blockers.length === 1 && /^none\b/i.test(blockers[0])) edits.push({ kind: 'none', section: i, none: true });
      else for (const t of fresh(blockers, cur?.blockers)) edits.push({ kind: 'add-item', section: i, list: 'blockers', text: t });
      await edit(u.path, edits);
      return `${started}${cur ? 'Brought' : 'Added'} ${ws} ${cur ? 'up to date in' : 'to'} the ${weekTitle(monday).replace(/^Week/, 'week')} [${u.path}].`;
    }
    if (name === 'weekly_update_set_metric') {
      const ws = S(args.workstream, 120);
      const i = sectionIndex(ws);
      if (i < 0) return `${ws} isn’t in the ${weekTitle(monday).replace(/^Week/, 'week')}. Add it with weekly_update_add_section first.`;
      const value = typeof args.value === 'number' ? args.value : Number(String(args.value ?? '').replace(/[,%$\s]/g, ''));
      if (!Number.isFinite(value)) return 'The value is a number (1047, 96.4).';
      await edit(u.path, { kind: 'metric', section: i, name: S(args.measure, 120), value, ...(args.unit !== undefined ? { unit: S(args.unit, 12) } : {}), ...(args.group !== undefined ? { group: S(args.group, 80) } : {}) });
      return `${started}Set ${S(args.measure, 120)} to ${value}${S(args.unit, 12) === '%' ? '%' : S(args.unit, 12) ? ` ${S(args.unit, 12)}` : ''} for ${u.sections[i].name} [${u.path}].`;
    }
    if (name === 'weekly_update_gather') return `${started}${await gather(u.path)} [${u.path}]`;
    if (name === 'weekly_update_send') {
      const to = (Array.isArray(args.to) ? args.to : []).map((x) => S(x, 200)).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
      if (!to.length) return 'Give the email addresses it goes to (never guessed).';
      if (!w.d.sendMail) return 'No mail is connected to Ironleaf, so nothing was sent. The update is not marked sent.';
      const sent = await w.d.sendMail({ to, subject: S(args.subject, 200) || weekTitle(u.week), text: weeklyText(u) });
      if (!sent.ok) return `Not sent: ${sent.words} The update is not marked sent.`;
      return `${started}${await markSent(u.path, {})} It went to ${to.join(', ')}. [${u.path}]`;
    }
    if (name === 'weekly_update_mark_sent') return `${started}${await markSent(u.path, { date: S(args.date, 20), by: S(args.sent_by, 120) })} [${u.path}]`;
    return `There is no tool called ${name}.`;
  }

  const str = (v: unknown, max = 1000) => S(v, max);
  return {
    id: 'weekly',
    ops: {
      model: () => model(),
      create: (week: unknown, opts: unknown) => create(str(week, 20) || w.todayIso(), (opts ?? {}) as { fromLast?: boolean; audience?: string }),
      edit: (rel: unknown, edits: unknown) => edit(str(rel), (edits ?? []) as WeeklyEdit[]),
      'mark-sent': (rel: unknown, opts: unknown) => markSent(str(rel), (opts ?? {}) as { date?: string; by?: string }),
      gather: (rel: unknown) => gather(str(rel)),
      'to-project': (rel: unknown, section: unknown, what: unknown, index: unknown) => toProject(str(rel), Number(section), what === 'risk' ? 'risk' : 'progress', Number(index)),
      'export-text': (rel: unknown) => weeklyText(updateAt(str(rel))),
      'export-word': (rel: unknown, brand: unknown) => exportWord(str(rel), (brand ?? {}) as ExportBrand),
      'import-plan': (rel: unknown) => importPlan(str(rel)),
      import: (rel: unknown, opts: unknown) => importNote(str(rel), (opts ?? {}) as { audience?: string }),
      attach: (rel: unknown, files: unknown) => attach(str(rel), Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : undefined),
      'set-field': (input: unknown) => setField((input ?? {}) as { path?: string }),
      options: (patch: unknown) => w.setOptions('weekly', { settings: (patch ?? {}) as Record<string, string | number | boolean> }),
      project: (rel: unknown) => forProject(str(rel)),
      week: async (week: unknown) => (await weekNote(str(week, 20) || w.todayIso()))?.path ?? null,
    },
    check,
    tool,
    rules: () => 'Weekly: weekly_update_get reads a week (or a workstream’s history); draft with weekly_update_create, weekly_update_gather (a first draft from the projects’ own updates, next steps and risks, for the person to correct), weekly_update_add_section and weekly_update_set_metric from the person’s own words and numbers (never invent progress or figures); send it with weekly_update_send to the addresses they give (asked first, as every send is; marked sent only when it has gone) and weekly_update_mark_sent only when they say it went. This is the update sent to other people; it is not the Goals weekly review (a personal look-back) or a project catch-up.',
  };
}
