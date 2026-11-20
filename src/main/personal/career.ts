// Career on the main side (Wave 7 part a; src/shared/career.ts). Its notes read from the index with the CVs kept in
// Documents and ID (one home per record: Career reads them and links to them), each change one property or one cell of an
// application's interviews (every other character kept), a move to another stage written to the application's timeline,
// a cover letter started from the last one, a new CV version made in Documents and ID with its file, the bell told of
// interviews and follow-ups (each said once), the Inbox's letters and notes filed, and its tools through each agent's
// gate.

import path from 'node:path';
import { partOn } from '../../shared/life-modules';
import { newDocumentText, documentName } from '../../shared/id-documents';
import { APPLICATION_PROPS, CAREER_CELL, CAREER_TABLES, INTERVIEWS_TABLE, LETTER_PROPS, TIMELINE_HEADING, answerCareerTool, applicationName, findApplication, careerModel, interviewWords, letterBody, newApplicationText, newLetterText, planApplicationAdd, planContactAdd, planInterview, planStage, type ApplicationInput, type CareerModel } from '../../shared/career';
import { dayWords, linkName, readDay, readTime, tableWithRow, withLogLine } from '../../shared/personal-records';
import type { VaultIndex } from '../indexer';
import type { WorkModules, WorkNotice } from '../work-modules';
import { itemWords, namedIn, personalRecords, S, withProps, remindDaysOption, type PersonalPart } from './common';

export type CareerView = CareerModel & { folder: string; people: string[]; documentsOn: boolean };

const TYPES = ['job-application', 'cover-letter'];
const isCv = (_p: string, props: Record<string, unknown>) => String(props.type ?? '').toLowerCase() === 'id-document' && /^(cv|resume|curriculum vitae)$/i.test(String(props.kind ?? '').trim());

export function makeCareer(w: WorkModules): PersonalPart {
  const r = personalRecords(w, {
    module: 'career',
    types: TYPES,
    tables: CAREER_TABLES,
    props: { application: APPLICATION_PROPS, letter: LETTER_PROPS },
    cells: { interview: { table: INTERVIEWS_TABLE, map: CAREER_CELL.interview } },
    // A stage changed where it shows (the pipeline's board, a page's stage) is written to the application's timeline.
    afterProp: async (rel, key, value) => {
      if (key !== 'stage' || typeof value !== 'string') return null;
      const m = await model();
      const a = m.applications.find((x) => x.path === rel);
      if (!a) return null;
      const plan = planStage({ ...a, stage: '' }, value, m.today);
      await w.change(rel, (text) => withProps(withLogLine(text, TIMELINE_HEADING, 'Timeline', plan.line), plan.props.applied && !a.applied ? { applied: plan.props.applied } : {}));
      return null;
    },
  });
  const model = async (index: VaultIndex = w.d.index): Promise<CareerModel> => careerModel(await r.notes(index, true, isCv), w.today(), await w.remindDays('career'), index === w.d.index ? await r.people() : []);
  const view = async (): Promise<CareerView> => ({ ...(await model()), folder: await w.moduleFolder('career'), people: (await r.people()).map((p) => p.name), documentsOn: w.allOn().includes('documents') });
  const app = async (rel: unknown) => {
    const m = await model();
    const a = m.applications.find((x) => x.path === S(rel, 1000));
    if (!a) throw new Error('That application isn’t there any more.');
    return { m, a };
  };

  const addApplication = async (input: unknown): Promise<string> => {
    const i = (input ?? {}) as ApplicationInput;
    const role = S(i.role, 100);
    const company = linkName(i.company).slice(0, 100);
    if (!role && !company) throw new Error('An application needs the role or the company.');
    for (const k of ['applied', 'next_date'] as const) if (S(i[k]) && !readDay(i[k])) throw new Error('Give days like 2026-10-24.');
    const name = applicationName(role, company);
    return w.newNote(await w.folderOf('job-application'), name, newApplicationText({ ...i, role, company, applied: readDay(i.applied), next_date: readDay(i.next_date), contacts: Array.isArray(i.contacts) ? i.contacts.map((x) => S(x, 80)).filter(Boolean) : [] }, w.todayIso()));
  };

  const setStage = async (rel: unknown, stage: unknown, note: unknown): Promise<string> => {
    const { m, a } = await app(rel);
    const plan = planStage(a, S(stage, 30), m.today, S(note, 200) || undefined);
    if (plan.props.stage === a.stage) return plan.words;
    await w.change(a.path, (text) => withLogLine(withProps(text, plan.props), TIMELINE_HEADING, 'Timeline', plan.line));
    return plan.words;
  };

  const addInterview = async (rel: unknown, values: unknown): Promise<string> => {
    const { m, a } = await app(rel);
    const v = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>;
    const plan = planInterview({ application: a.name, date: v.date, time: v.time, kind: v.kind, with: v.with, where: v.where }, { ...m, applications: [a] });
    await w.change(a.path, (text) => tableWithRow(text, INTERVIEWS_TABLE, { ...plan.values, notes: S(v.notes, 200) }));
    if (plan.stage) await setStage(a.path, plan.stage, '');
    return plan.words;
  };

  /** A cover letter for an application, started from another letter's words (or the last one written), linked to it. */
  const writeLetter = async (rel: unknown, from: unknown): Promise<string> => {
    const { m, a } = await app(rel);
    const source = S(from, 1000) ? m.letters.find((l) => l.path === S(from, 1000)) : m.letters[0];
    const body = source ? letterBody(w.noteText(source.path)) : '';
    const name = `Cover letter ${a.company || a.role || a.name}`.trim();
    const version = String(m.letters.filter((l) => a.company && l.company.toLowerCase() === a.company.toLowerCase()).length + 1);
    const out = await w.newNote(await w.folderOf('cover-letter'), name, newLetterText({ application: a.name, company: a.company, version: version === '1' ? '' : `v${version}`, body }, m.today));
    await r.setProps(a.path, { letter: `[[${path.posix.basename(out, '.md')}]]` });
    return out;
  };

  /** A new CV version: a Documents and ID record of kind CV (its file kept beside it), optionally linked to an application. */
  const addCv = async (input: unknown): Promise<string> => {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const m = await model();
    const version = S(o.version, 20) || `v${m.cvs.length + 1}`;
    const holder = S(o.holder, 80);
    const name = documentName({ kind: 'CV', holder, version });
    if (m.cvs.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a ${name}.`);
    const rel = await w.newNote(await w.folderOf('id-document'), name, newDocumentText({ kind: 'CV', holder, version, issued: readDay(o.issued) ?? m.today }));
    const files = Array.isArray(o.files) ? o.files.filter((f): f is string => typeof f === 'string') : [];
    if (files.length) await w.keepFiles(rel, files);
    if (S(o.application, 1000)) await r.setProps(S(o.application, 1000), { cv: `[[${path.posix.basename(rel, '.md')}]]` });
    return rel;
  };

  const addContact = async (rel: unknown, name: unknown): Promise<string> => {
    const { a } = await app(rel);
    const who = linkName(name).slice(0, 80);
    if (!who) throw new Error('Give the person’s name.');
    if (a.contacts.some((c) => c.toLowerCase() === who.toLowerCase())) return `${who} is already a contact for ${a.name}.`;
    await r.setProps(a.path, { contacts: [...a.contacts, who].map((x) => `[[${x}]]`) });
    return `Added ${who} to ${a.name}.`;
  };
  const removeContact = async (rel: unknown, name: unknown): Promise<string> => {
    const { a } = await app(rel);
    const who = S(name, 80).toLowerCase();
    const left = a.contacts.filter((c) => c.toLowerCase() !== who);
    await r.setProps(a.path, { contacts: left.length ? left.map((x) => `[[${x}]]`) : null });
    return `Took ${S(name, 80)} off ${a.name}. Their card is kept.`;
  };

  const ops: PersonalPart['ops'] = {
    ...r.fileOps,
    model: () => view(),
    'add-application': (input) => addApplication(input),
    'set-stage': (rel, stage, note) => setStage(rel, stage, note),
    'add-interview': (rel, values) => addInterview(rel, values),
    'write-letter': (rel, from) => writeLetter(rel, from),
    'add-cv': (input) => addCv(input),
    'add-contact': (rel, name) => addContact(rel, name),
    'remove-contact': (rel, name) => removeContact(rel, name),
    'add-note': async (rel, words) => {
      const { m, a } = await app(rel);
      const t = S(words, 400);
      if (!t) throw new Error('Write what happened.');
      await w.change(a.path, (text) => withLogLine(text, TIMELINE_HEADING, 'Timeline', `${m.today} — ${t}`));
      return `Added to ${a.name}’s timeline.`;
    },
    options: async (patch) => ({ remindDays: await remindDaysOption(w, 'career', patch) }),
  };

  return {
    id: 'career',
    ops,
    async check(): Promise<WorkNotice[]> {
      const sw = w.d.prefs().modules;
      const m = await model();
      const out: WorkNotice[] = [];
      if (partOn(sw, 'career', 'interviews'))
        for (const i of m.upcoming.filter((x) => x.days! <= 1))
          out.push({ key: `career-interview:${i.application}:${i.date}:${i.time}`, kind: 'career', title: `${interviewWords(i, m.today)}: ${i.applicationName}`, body: [i.with && `with ${i.with}`, i.where, dayWords(i.date!, m.today)].filter(Boolean).join(' · '), path: i.application });
      if (partOn(sw, 'career', 'followups'))
        for (const a of m.followUps.filter((x) => x.nextDays! <= 0))
          out.push({ key: `career-follow:${a.path}:${a.nextDate}`, kind: 'career', title: `${a.name}: ${a.nextStep || 'follow up'}`, body: [a.stage, a.nextDays === 0 ? 'Today' : `Was due ${dayWords(a.nextDate!, m.today)}`].join(' · '), path: a.path });
      return out;
    },
    async tool(name, args, ctx) {
      const mine = await model(ctx.gated);
      const refused = await r.refused(ctx, mine.applications.length + mine.letters.length);
      const read = answerCareerTool({ model: mine, on: w.isOn('career'), refused, agent: ctx.agent }, name, args);
      if (read !== null) return read;
      if (name === 'career_application_add') {
        const plan = planApplicationAdd(args, mine);
        const rel = await w.freeNote(await w.folderOf('job-application'), plan.name);
        ctx.check?.(rel);
        await w.d.requireCreate();
        await w.d.writeNote(rel, plan.text);
        return `${plan.words} [${rel}]`;
      }
      if (name === 'career_set_stage') {
        const a = findApplication(mine, args.application);
        if (!a) return `There is no application for “${S(args.application)}” in Career.`;
        ctx.check?.(a.path);
        return `${await setStage(a.path, args.stage, args.note)} [${a.path}]`;
      }
      if (name === 'career_contact_add') {
        const plan = planContactAdd(args, mine);
        ctx.check?.(plan.app.path);
        await r.setProps(plan.app.path, { contacts: plan.contacts.map((x) => `[[${x}]]`) });
        return `${plan.words} [${plan.app.path}]`;
      }
      if (name === 'career_interview_add') {
        const plan = planInterview(args, mine);
        ctx.check?.(plan.app.path);
        if (S(args.time) && !readTime(args.time)) return 'Give the time as HH:MM.';
        await w.change(plan.app.path, (text) => tableWithRow(text, INTERVIEWS_TABLE, plan.values));
        if (plan.stage) await setStage(plan.app.path, plan.stage, '');
        return `${plan.words} [${plan.app.path}]`;
      }
      return `There is no tool called ${name}.`;
    },
    rules: () => 'Career: use career_application_list, career_application_get (interviews, timeline, the CV and letter sent) and career_interviews; career_prep puts a prep sheet together and career_outcomes looks back at past hunts and the salaries written; add with career_application_add, career_contact_add and career_interview_add, and move one on with career_set_stage, only with what the person said happened (never guess a day, a salary or an outcome). A CV is a Papers record.',
    async inbox(item) {
      const m = await model();
      const words = itemWords(item);
      const a = namedIn(
        words,
        m.applications.filter((x) => x.open),
        (x) => [x.company, x.name],
      );
      if (!a) return null;
      return { target: { kind: 'module', module: 'career', type: 'job-application', path: a.path, name: a.name, label: item.kind === 'line' ? `Add to ${a.name}’s timeline` : `Keep with ${a.name}` }, why: `Names ${a.company || a.name}` };
    },
    async fileInbox(item, target) {
      const { m, a } = await app(target.path);
      if (item.kind !== 'line') return { words: `Kept ${item.path.split('/').pop()} with ${a.name}.`, paths: [a.path], keepWith: a.path };
      await w.change(a.path, (text) => withLogLine(text, TIMELINE_HEADING, 'Timeline', `${m.today} — ${S(item.words, 400)}`));
      return { words: `Added to ${a.name}’s timeline.`, paths: [a.path] };
    },
  };
}

