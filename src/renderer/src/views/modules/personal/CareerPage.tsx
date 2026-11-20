// Career's page (Wave 7 part a; src/shared/career.ts, src/main/personal/career.ts). Made of the work modules' shared
// blocks: an Overview of where each application is up to, interviews coming up and what to follow up; the Pipeline as a
// board (drag an application to move it on, written to its timeline), Applications, Interviews, Letters and CVs, and
// Contacts; and each application's own page ("application:<path>"): its stages, interviews changed cell by cell, its
// timeline, the CV version and cover letter sent with it, its contacts and files. Everything shown changes where it is.

import { useMemo, useState } from 'react';
import { partOn } from '../../../../../shared/life-modules';
import { APPLICATION_STAGES, CAREER, INTERVIEW_KINDS, INTERVIEW_OUTCOMES, OPEN_STAGES, WORK_TYPES } from '../../../../../shared/personal-modules';
import { careerRecords, careerSectionViews, CAREER_EDITABLE, interviewWords, type Application, type CareerModel } from '../../../../../shared/career';
import type { WsRecord } from '../../../../../shared/workspace-records';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import { initials } from '../../../lib/projectLook';
import * as A from '../../../state/actions';
import { openTour } from '../../../state/moduleFills';
import { openModule, useModules } from '../../../state/modules';
import { peek } from '../../../state/peek';
import { showError, useApp } from '../../../state/store';
import { useWork, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { openRecordForm, valueWords } from '../RecordForm';
import { AskFloat, PackSection, PackShell, packName, shortDay, weekdayOf, type Tint } from '../pack87';
import { Card, dayText, inDays, openDetail, Pill, placeOf, useWorkCtx, WithRecords, WorkViews } from '../work/WorkShell';
import { caller, EditTable, FilesList, Inline, keepFiles, plural } from './PersonalParts';

type CareerView = CareerModel & { folder: string; people: string[]; documentsOn: boolean };

const MOD = 'career';
const call = caller(MOD);
const openApp = (rel: string) => openDetail(MOD, 'application', rel);
const STEPS = ['Saved', 'Applied', 'Interview', 'Offer', 'Accepted'] as const;
const peekNote = (rel: string, title: string) => peek({ type: 'note', path: rel }, { title, type: 'note' });

// ── Doing things ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function save(kind: string, rel: string, field: string, value: string, row?: { row: number; title: string }): Promise<boolean> {
  return (await workDid(call<string | null>('set-field', { kind, path: rel, field, value, ...(row ? { ref: { row: row.row }, title: row.title } : {}) }).then((said) => ({ said })), (x) => x.said ?? '')) !== null;
}

function newApplication(m: CareerView | null, prefill: { stage?: string } = {}): void {
  openRecordForm({
    title: 'New application',
    icon: 'briefcase',
    line: 'Where it is up to, its interviews, and the letter and CV you sent go with it.',
    ok: 'Add the application',
    fields: [
      { key: 'role', label: 'Role', kind: 'text', required: true, placeholder: 'Data analyst' },
      { key: 'company', label: 'Company', kind: 'text', required: true, placeholder: 'Brightwater' },
      { key: 'stage', label: 'Stage', kind: 'segment', options: ['Saved', 'Applied', 'Interview', 'Offer'], value: prefill.stage ?? 'Applied' },
      { key: 'applied', label: 'Applied', kind: 'date', value: m?.today ?? '', show: (v) => v.stage !== 'Saved' },
      { key: 'source', label: 'Found through', kind: 'text', placeholder: 'A job board, a recruiter, a friend' },
      { key: 'url', label: 'Job ad', kind: 'text', placeholder: 'https://…' },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'work_type', label: 'Work type', kind: 'choice', options: ['', ...WORK_TYPES] },
      { key: 'salary', label: 'Salary', kind: 'text' },
      { key: 'cv', label: 'CV sent', kind: 'choice', options: ['', ...(m?.cvs.map((c) => c.name) ?? [])], hint: m?.cvs.length ? undefined : `CV versions are kept in ${packName('documents', 'Papers')}: add one on Letters and CVs.` },
      { key: 'next_step', label: 'Next step', kind: 'text', placeholder: 'Follow up with the recruiter' },
      { key: 'next_date', label: 'By', kind: 'date' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-application', Object.fromEntries(['role', 'company', 'stage', 'applied', 'source', 'url', 'location', 'work_type', 'salary', 'cv', 'next_step', 'next_date'].map((k) => [k, valueWords(v, k)])));
      await workDid(Promise.resolve(rel), `Added ${A.titleOf(rel)}.`, { label: 'Open', run: () => openApp(rel) });
    },
  });
}

function newInterview(a: Application, m: CareerView): void {
  openRecordForm({
    title: `Interview for ${a.name}`,
    icon: 'calendar',
    line: 'It comes to Today and the bell the day before. The application moves to Interview if it was earlier.',
    ok: 'Add the interview',
    fields: [
      { key: 'date', label: 'Day', kind: 'date', required: true },
      { key: 'time', label: 'Time', kind: 'text', placeholder: '10:00' },
      { key: 'kind', label: 'Kind', kind: 'choice', options: ['', ...INTERVIEW_KINDS] },
      { key: 'with', label: 'With', kind: 'choice', options: ['', ...a.contacts, ...m.people.filter((p) => !a.contacts.includes(p))], own: true },
      { key: 'where', label: 'Where', kind: 'text', wide: true, placeholder: 'An address, or the video link' },
    ],
    submit: async (v) => {
      await workDid(call<string>('add-interview', a.path, Object.fromEntries(['date', 'time', 'kind', 'with', 'where'].map((k) => [k, valueWords(v, k)]))));
    },
  });
}

function moveStage(a: Application, stage: string): void {
  if (stage === 'Declined' || stage === 'Rejected' || stage === 'Withdrawn') {
    openRecordForm({
      title: stage === 'Declined' ? `Decline ${a.name}` : stage === 'Rejected' ? `${a.name}: not successful` : `Withdraw from ${a.name}`,
      icon: 'close',
      line: 'It leaves the pipeline and is kept with its history.',
      ok: 'Save it',
      fields: [{ key: 'note', label: 'A note for its timeline (optional)', kind: 'text', wide: true }],
      submit: async (v) => {
        await workDid(call<string>('set-stage', a.path, stage, valueWords(v, 'note')));
      },
    });
    return;
  }
  void workDid(call<string>('set-stage', a.path, stage, ''));
}

function nextStepForm(a: Application): void {
  openRecordForm({
    title: `Next step for ${a.name}`,
    icon: 'flag',
    ok: 'Save',
    fields: [
      { key: 'next_step', label: 'Next step', kind: 'text', wide: true, value: a.nextStep, placeholder: 'Follow up by email' },
      { key: 'next_date', label: 'By', kind: 'date', value: a.nextDate ?? '' },
    ],
    submit: async (v) => {
      await save('application', a.path, 'next_step', valueWords(v, 'next_step'));
      await save('application', a.path, 'next_date', valueWords(v, 'next_date'));
    },
  });
}

function newCv(m: CareerView | null, app?: Application): void {
  openRecordForm({
    title: 'New CV version',
    icon: 'idcard',
    line: `Kept in ${packName('documents', 'Papers')} with its file, so every application can say which version it went with.`,
    ok: 'Add the version',
    fields: [
      { key: 'version', label: 'Version', kind: 'text', value: `v${(m?.cvs.length ?? 0) + 1}` },
      { key: 'holder', label: 'Whose', kind: 'text', placeholder: 'Your name (optional)' },
      { key: 'files', label: 'The CV file', kind: 'files', wide: true },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-cv', { version: valueWords(v, 'version'), holder: valueWords(v, 'holder'), files: Array.isArray(v.files) ? v.files : [], application: app?.path ?? '' });
      await workDid(Promise.resolve(rel), `Added ${A.titleOf(rel)}${app ? ` and linked it to ${app.name}` : ''}.`);
    },
  });
}

async function writeLetter(a: Application): Promise<void> {
  const rel = await workDid(call<string>('write-letter', a.path, ''), (r) => `Started ${A.titleOf(r)} from your last letter. It is linked to ${a.name}.`);
  if (rel) A.openPath(rel, { where: 'tab' });
}

async function addContact(a: Application, m: CareerView): Promise<void> {
  openRecordForm({
    title: `A contact for ${a.name}`,
    icon: 'person',
    line: 'Someone from People, or a new name (a People card is made for them).',
    ok: 'Add them',
    fields: [
      { key: 'name', label: 'Name', kind: 'choice', options: ['', ...m.people.filter((p) => !a.contacts.includes(p))], own: true, required: true },
      { key: 'role', label: 'Role', kind: 'text', placeholder: 'Recruiter, hiring manager', show: (v) => !!valueWords(v, 'name') && !m.people.includes(valueWords(v, 'name')) },
    ],
    submit: async (v) => {
      const name = valueWords(v, 'name');
      // Found first, however it was capitalised (W5-32); the contact links only once the person exists.
      const existing = m.people.find((x) => x.trim().toLowerCase() === name.trim().toLowerCase());
      if (!existing) {
        try {
          await window.nv.life.people.make([{ name, type: 'person', ...(valueWords(v, 'role') ? { role: valueWords(v, 'role') } : {}), area: 'me' }]);
        } catch (e) {
          console.warn('Ironleaf could not add the contact:', e instanceof Error ? e.message : String(e));
          showError(new Error('That contact couldn’t be added just now.'));
          return;
        }
      }
      await workDid(call<string>('add-contact', a.path, existing ?? name));
    },
  });
}

/** "10:00" → "10:00 am". */
function timeWords(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return t;
  const h = Number(m[1]);
  const am = h < 12;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${am ? 'am' : 'pm'}`;
}

/** "Thursday 6 Nov" for an interview day. */
function fullDay(iso: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return `${days[d.getDay()]} ${Number(iso.slice(8, 10))} ${months[Number(iso.slice(5, 7)) - 1]}`;
}

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

// ── The board ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A board card's tag: the next interview, the CV and day, where it came from, or the offer's pay. Nothing when there
 *  is nothing specific to say (8.7 round 2: never a tag repeating the column it sits in, as drawn). */
function cardTag(a: Application): { tone: Tint; words: string } | null {
  if (a.stage === 'Interview') {
    const next = [...a.interviews].filter((i) => i.date && (i.days === null || i.days >= 0)).sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''))[0];
    if (next?.date) return { tone: 'amber', words: `${weekdayOf(next.date)}${next.time ? ` ${timeWords(next.time)}` : ''}` };
    return null;
  }
  if (a.stage === 'Applied') {
    if (a.cv && a.applied) return { tone: 'slate', words: `${a.cv} · ${shortDay(a.applied)}` };
    if (a.applied) return { tone: 'slate', words: `applied ${shortDay(a.applied)}` };
    return null;
  }
  if (a.stage === 'Offer') return a.salary || a.nextStep ? { tone: 'slate', words: a.salary || a.nextStep } : null;
  if (a.nextDate) return { tone: 'slate', words: `closes ${shortDay(a.nextDate)}` };
  if (a.source) return { tone: 'slate', words: `via ${a.source}` };
  return null;
}

const AVA_TINTS = ['', 'green', 'blue'] as const;

function BoardCard({ a, canEdit }: { a: Application; canEdit: boolean }) {
  const tag = cardTag(a);
  const who = a.company || a.name;
  const tint = AVA_TINTS[[...who].reduce((s, c) => s + c.charCodeAt(0), 0) % AVA_TINTS.length];
  return (
    <div className="bcard" draggable={canEdit} onDragStart={(e) => e.dataTransfer.setData('text/career-application', a.path)} onClick={() => openApp(a.path)} role="button" tabIndex={0} aria-label={`${a.name}, ${a.stage}`} title={`${a.name} · drag it to another stage to move it on`} onKeyDown={(e) => e.key === 'Enter' && openApp(a.path)}>
      <div className="t">{a.role && a.company ? `${a.role} · ${a.company}` : a.name}</div>
      {tag ? (
        <div className="tags">
          <span className={`tag ${tag.tone}`}>{tag.words}</span>
        </div>
      ) : null}
      <div className="who">
        <i className={`miniava${tint ? ` ${tint}` : ''}`} aria-hidden="true">
          {initials(who)}
        </i>
        {who}
      </div>
    </div>
  );
}

function Overview({ m, canEdit }: { m: CareerView; canEdit: boolean }) {
  const open = m.applications.filter((a) => a.open);
  const closed = m.applications.filter((a) => !a.open);
  const colTone = (s: string): Tint => (s === 'Interview' ? 'amber' : s === 'Offer' ? 'green' : 'slate');
  return (
    <PackShell
      glyph="◆"
      tint="blue"
      title={packName(MOD, 'Career')}
      sub="Applications from saved to offer, with letters, CVs and interviews."
      facts={[{ k: 'In play', v: [`${open.length} ${open.length === 1 ? 'application' : 'applications'}`, m.upcoming.length ? `${m.upcoming.length} ${m.upcoming.length === 1 ? 'interview' : 'interviews'}` : '', m.followUps.length ? `${m.followUps.length} follow-ups due` : ''].filter(Boolean).join(' · ') }]}
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={() => newApplication(m)}>
          + Save an application
        </button>
      }
      menu={() => careerMenu(m, canEdit)}
    >
      <div className="glabel" style={{ margin: '18px 0 8px' }}>
        Applications board
      </div>
      <div className="boardwrap">
        <div className="board">
          {OPEN_STAGES.map((s) => (
            <div
              key={s}
              className="bcol"
              onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
              onDrop={
                canEdit
                  ? (e) => {
                      e.preventDefault();
                      const rel = e.dataTransfer.getData('text/career-application');
                      const a = m.applications.find((x) => x.path === rel);
                      if (a && a.stage !== s) moveStage(a, s);
                    }
                  : undefined
              }
            >
              <div className="bhead">
                <span className={`tag ${colTone(s)}`}>{s}</span>
                <span className="c">{open.filter((a) => a.stage === s).length}</span>
              </div>
              {open
                .filter((a) => a.stage === s)
                .map((a) => (
                  <BoardCard key={a.path} a={a} canEdit={canEdit} />
                ))}
              <button type="button" className="badd" disabled={!canEdit} onClick={() => newApplication(m, { stage: s })}>
                + Add a card
              </button>
            </div>
          ))}
        </div>
      </div>
      {closed.length > 0 && (
        <p style={{ marginTop: 12 }}>
          <button type="button" className="btn quiet" onClick={() => openModule(MOD, 'applications')}>
            {closed.length} closed{(m.stages.Accepted ?? 0) ? ` · ${m.stages.Accepted} accepted` : ''}
          </button>
        </p>
      )}
    </PackShell>
  );
}

// ── An application's page ────────────────────────────────────────────────────────────────────────────────────────────

function Stages({ a, canEdit }: { a: Application; canEdit: boolean }) {
  const closed = ['Declined', 'Rejected', 'Withdrawn'].includes(a.stage);
  const at = STEPS.indexOf(a.stage as (typeof STEPS)[number]);
  return (
    <div className="pm-steps-wrap">
      <ol className={`pm-steps${closed ? ' is-closed' : ''}`} aria-label="Stage">
        {STEPS.map((s, i) => (
          <li key={s} className={`pm-step${i < at ? ' is-past' : i === at ? ' is-on' : ''}`}>
            <button type="button" disabled={!canEdit || s === a.stage} onClick={() => moveStage(a, s)} title={s === a.stage ? `At ${s}` : `Move it to ${s}`}>
              <span className="pm-step-dot" aria-hidden="true">
                {i < at ? <Icon name="check" size={10} /> : null}
              </span>
              {s}
            </button>
          </li>
        ))}
      </ol>
      {closed ? (
        <Pill tone="none">{a.stage === 'Rejected' ? 'Not successful' : a.stage === 'Withdrawn' ? 'Withdrew' : 'Declined'}</Pill>
      ) : (
        <button
          type="button"
          className="text-button pm-steps-more"
          disabled={!canEdit}
          onClick={(e) =>
            openMenu(e.currentTarget, [
              { label: 'Not successful…', icon: 'close', run: () => moveStage(a, 'Rejected') },
              { label: 'Decline it…', icon: 'close', run: () => moveStage(a, 'Declined') },
              { label: 'Withdraw…', icon: 'close', run: () => moveStage(a, 'Withdrawn') },
            ])
          }
        >
          It ended <Icon name="chevronDown" size={11} />
        </button>
      )}
    </div>
  );
}

function ApplicationPage({ a, m, canEdit }: { a: Application; m: CareerView; canEdit: boolean }) {
  const prop = (field: string) => (v: string) => save('application', a.path, field, v);
  const [line, setLine] = useState('');
  const interviews = [...a.interviews].sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));
  const timeline = [...a.timeline].reverse();
  const letter = m.letters.find((l) => l.path === a.letterPath);
  const next = interviews.filter((i) => i.date && (i.days === null || i.days >= 0))[0] ?? null;
  const done = interviews.filter((i) => (i.days !== null && i.days < 0) || i.outcome).length;
  const tint: Tint = a.stage === 'Interview' ? 'amber' : a.stage === 'Offer' || a.stage === 'Accepted' ? 'green' : a.stage === 'Saved' || a.stage === 'Applied' ? 'blue' : 'slate';
  return (
    <PackShell
      glyph="◆"
      tint={tint}
      title={`${a.stage} · ${a.role || a.name}`}
      sharePath={a.path}
      sub={[a.location, next?.date ? `${fullDay(next.date)}${next.time ? `, ${timeWords(next.time)}` : ''}${next.with ? `, with ${next.with}` : ''}` : a.applied ? `Applied ${dayText(a.applied)}` : null].filter(Boolean).join('. ') + '.'}
      facts={[
        { k: 'Stage', v: <span className={`pill ${tint}`}>{a.stage === 'Interview' && next ? `${a.stage} · round ${done + 1}` : a.stage}</span> },
        { k: 'Sent', v: <>{[a.letter && 'Cover letter', a.cv || 'No CV yet'].filter(Boolean).join(' · ')}{a.applied ? <span className="meta"> · {shortDay(a.applied)}</span> : null}</> },
        ...(a.nextStep || a.nextDate ? [{ k: 'Next', v: <>{a.nextStep || 'Follow up'}{a.nextDate ? <span className="meta"> · {a.nextDays !== null && a.nextDays < 0 ? `was due ${shortDay(a.nextDate)}` : a.nextDays === 0 ? 'today' : inDays(a.nextDate, m.today)}</span> : null}</> }] : []),
      ]}
      menu={() => [
        { label: packName(MOD, 'Career'), icon: 'career', run: () => openModule(MOD, 'overview') },
        { label: 'Applications', icon: 'table', run: () => openModule(MOD, 'applications') },
        { separator: true },
        ...APPLICATION_STAGES.filter((s) => s !== a.stage).map((s) => ({ label: s === 'Rejected' ? 'Not successful…' : s === 'Withdrawn' ? 'Withdraw…' : s === 'Declined' ? 'Decline it…' : `Move to ${s}`, icon: 'forward' as const, disabled: !canEdit, run: () => moveStage(a, s) })),
        { separator: true },
        { label: 'Add an interview…', icon: 'calendar', disabled: !canEdit, run: () => newInterview(a, m) },
        { label: 'Set the next step…', icon: 'flag', disabled: !canEdit, run: () => nextStepForm(a) },
        { label: 'Write a cover letter', icon: 'pencil', disabled: !canEdit, run: () => void writeLetter(a) },
        { label: 'New CV version', icon: 'idcard', disabled: !canEdit, run: () => newCv(m, a) },
        { label: 'Add a contact…', icon: 'person', disabled: !canEdit, run: () => void addContact(a, m) },
        { label: 'Keep files with it…', icon: 'paperclip', disabled: !canEdit, run: () => void keepFiles(MOD, a.path, a.name, 'documents') },
        { separator: true },
        { label: 'Open its note', icon: 'notes', run: () => A.openPath(a.path, { where: 'tab' }) },
        { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(a.path).catch(showError) },
      ]}
    >
      <PackSection label="Prep sheet" pad>
        <p style={{ fontSize: 14 }}>
          <b>Role:</b> <Inline value={a.prepRole} label="The role" kind="long" placeholder="What the role is: the team, the work, the pay" canEdit={canEdit} onSave={prop('prep_role')} />
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          <b>Likely questions:</b> <Inline value={a.prepQuestions} label="Likely questions" kind="long" placeholder="What they will probably ask" canEdit={canEdit} onSave={prop('prep_questions')} />
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          <b>Ask them:</b> <Inline value={a.prepAsk} label="Ask them" kind="long" placeholder="What to ask them" canEdit={canEdit} onSave={prop('prep_ask')} />
        </p>
      </PackSection>
      <PackSection label="With you" bare={!(a.cv || a.letter)}>
        {a.cv || a.letter ? (
          <>
            {a.cv && (
              <div className="trow">
                <span className="gtile xs slate" aria-hidden="true">
                  ▤
                </span>
                <button type="button" onClick={() => a.cvPath && peekNote(a.cvPath, a.cv)} className="t" title={a.cv} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: a.cvPath ? 'pointer' : 'default', textAlign: 'left' }}>
                  {a.cv} · the one they have
                </button>
                <span className="end">
                  <span className="meta">{packName('documents', 'Papers')} · CV versions</span>
                </span>
              </div>
            )}
            {a.letter && (
              <div className="trow">
                <span className="gtile xs slate" aria-hidden="true">
                  ✎
                </span>
                <button type="button" onClick={() => a.letterPath && A.openPath(a.letterPath, { where: 'tab' })} className="t" title={a.letter} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: a.letterPath ? 'pointer' : 'default', textAlign: 'left' }}>
                  {a.letter}
                </button>
                <span className="end">
                  <span className="meta">{letter?.written ? `written ${shortDay(letter.written)}` : 'cover letter'}</span>
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="vsub">
            Nothing sent with it yet.{' '}
            {canEdit && (
              <>
                <button type="button" className="btn quiet" style={{ height: 26 }} onClick={() => void writeLetter(a)}>
                  Write a cover letter
                </button>{' '}
                <button type="button" className="btn quiet" style={{ height: 26 }} onClick={() => newCv(m, a)}>
                  New CV version
                </button>
              </>
            )}
          </p>
        )}
      </PackSection>
      <div className="glabel" style={{ margin: '20px 0 8px' }}>
        Stage
      </div>
      <Stages a={a} canEdit={canEdit} />
      <PackSection label="Interviews" pad>
        {interviews.length ? (
          <EditTable
            label={`Interviews for ${a.name}`}
            rows={interviews.map((i) => ({ row: i.row, className: i.days !== null && i.days >= 0 && i.days <= 1 ? 'is-soon' : undefined, values: { date: i.date ?? i.dateWords, time: i.time, interview_kind: i.kind, with: i.with, place: i.where, outcome: i.outcome } }))}
            cols={[
              { key: 'date', label: 'Day', kind: 'date', strong: true },
              { key: 'time', label: 'Time', kind: 'time' },
              { key: 'interview_kind', label: 'Kind', kind: 'choice', options: ['', ...INTERVIEW_KINDS] },
              { key: 'with', label: 'With', kind: 'text' },
              { key: 'place', label: 'Where', kind: 'text' },
              { key: 'outcome', label: 'Outcome', kind: 'choice', options: ['', ...INTERVIEW_OUTCOMES], shown: (x) => <Pill tone={x === 'Went well' || x === 'Done' ? 'ok' : x === 'Not progressed' ? 'bad' : 'none'}>{x}</Pill> },
            ]}
            title="date"
            canEdit={canEdit}
            onSave={(row, title, field, value) => save('interview', a.path, field, value, { row, title })}
            onRemove={(row, title) => void workDid(call<string>('remove-row', a.path, 'interviews', row, title))}
          />
        ) : (
          <p className="vsub">No interviews yet. Add one when it is booked: it comes to Today the day before.</p>
        )}
      </PackSection>
      <PackSection label="Timeline" pad>
        {canEdit && (
          <form
            className="pm-addline"
            onSubmit={(e) => {
              e.preventDefault();
              if (!line.trim()) return;
              void workDid(call<string>('add-note', a.path, line)).then((r) => r !== null && setLine(''));
            }}
          >
            <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="What happened? (“Called the recruiter”)" aria-label="Add to the timeline" />
            <button type="submit" className="button small" disabled={!line.trim()}>
              Add
            </button>
          </form>
        )}
        {timeline.length ? (
          <ol className="pm-timeline">
            {timeline.map((t, i) => (
              <li key={i}>
                <span className="pm-timeline-day">{t.date ? dayText(t.date) : ''}</span>
                <span className="pm-timeline-words">{t.words}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="vsub">Each move to another stage is written here.</p>
        )}
      </PackSection>
      <PackSection label="Details" pad>
        <div className="prow">
          <span className="k">Company</span>
          <span className="v">
            <Inline value={a.company} label="Company" canEdit={canEdit} onSave={prop('company')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Role</span>
          <span className="v">
            <Inline value={a.role} label="Role" canEdit={canEdit} onSave={prop('role')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Applied</span>
          <span className="v">
            <Inline value={a.applied ?? ''} shown={a.applied ? dayText(a.applied) : undefined} label="Applied" kind="date" canEdit={canEdit} onSave={prop('applied')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Location</span>
          <span className="v">
            <Inline value={a.location} label="Location" canEdit={canEdit} onSave={prop('location')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Work type</span>
          <span className="v">
            <Inline value={a.workType} label="Work type" kind="choice" options={['', ...WORK_TYPES]} canEdit={canEdit} onSave={prop('work_type')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Salary</span>
          <span className="v">
            <Inline value={a.salary} label="Salary" canEdit={canEdit} onSave={prop('salary')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Found</span>
          <span className="v">
            <Inline value={a.source} label="Found through" canEdit={canEdit} onSave={prop('source')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Job ad</span>
          <span className="v">
            <Inline value={a.url} shown={a.url ? <span className="pm-link">{a.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</span> : undefined} label="Job ad" placeholder="Add the link" canEdit={canEdit} onSave={prop('url')} />
            {a.url && (
              <button type="button" className="btn quiet" style={{ height: 26 }} onClick={() => window.open(/^[a-z]+:/i.test(a.url) ? a.url : `https://${a.url}`, '_blank')}>
                Open the job ad
              </button>
            )}
          </span>
        </div>
        <div className="prow">
          <span className="k">Next step</span>
          <span className="v">
            <Inline value={a.nextStep} label="Next step" placeholder="Add one" canEdit={canEdit} onSave={prop('next_step')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">By</span>
          <span className="v">
            <Inline value={a.nextDate ?? ''} shown={a.nextDate ? `${dayText(a.nextDate)} · ${inDays(a.nextDate, m.today)}` : undefined} label="Next step by" kind="date" canEdit={canEdit} onSave={prop('next_date')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">CV</span>
          <span className="v">
            <Inline value={a.cv} label="CV sent" kind="choice" options={['', ...m.cvs.map((c) => c.name)]} placeholder={m.cvs.length ? 'Choose one' : 'None yet'} canEdit={canEdit && m.cvs.length > 0} onSave={prop('cv')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Letter</span>
          <span className="v">
            <Inline value={a.letter} label="Cover letter" kind="choice" options={['', ...m.letters.map((l) => l.name)]} placeholder={m.letters.length ? 'Choose one' : 'None yet'} canEdit={canEdit && m.letters.length > 0} onSave={prop('letter')} />
          </span>
        </div>
      </PackSection>
      <PackSection label="Contacts" bare={!a.contacts.length}>
        {a.contacts.length ? (
          <ul className="pm-people">
            {a.contacts.map((name) => {
              const c = m.contacts.find((x) => x.name.toLowerCase() === name.toLowerCase());
              return (
                <li key={name}>
                  <button type="button" className="pm-person" disabled={!c?.path} onClick={() => c?.path && peekNote(c.path, c.name)}>
                    <span className="pm-avatar" aria-hidden="true">
                      {name
                        .split(/\s+/)
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join('')}
                    </span>
                    <span className="pm-person-words">
                      <span className="pm-person-name">{name}</span>
                      <span className="pm-faint">{[c?.role, c?.email || c?.phone].filter(Boolean).join(' · ') || (c?.path ? 'People card' : 'No card yet')}</span>
                    </span>
                  </button>
                  <button type="button" className="icon-button small" aria-label={`Take ${name} off`} title="Take them off (their card is kept)" disabled={!canEdit} onClick={() => void workDid(call<string>('remove-contact', a.path, name))}>
                    <Icon name="close" size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="vsub">The recruiter, the hiring manager or the friend who referred you.</p>
        )}
      </PackSection>
      <PackSection label="Files" bare={!a.files.length}>
        <FilesList files={a.files} empty="Keep the ad, the position description or the offer letter here." />
      </PackSection>
      <AskFloat hint="Rehearse likely answers…" question={(w) => `About my application for ${a.role || a.name} at ${a.company}: ${w}`} />
    </PackShell>
  );
}

// ── Letters and CVs, contacts ────────────────────────────────────────────────────────────────────────────────────────

function Letters({ m, canEdit }: { m: CareerView; canEdit: boolean }) {
  const records = useMemo(() => careerRecords(m), [m]);
  return (
    <div className="rm-overview">
      <div className="rm-cols">
        <Card id="cvs" title="CV versions" count={m.cvs.length} actions={canEdit ? <button type="button" className="text-button" onClick={() => newCv(m)}><Icon name="plus" size={12} /> New version</button> : undefined}>
          {m.cvs.length ? (
            <ul className="rm-rows">
              {m.cvs.map((c, i) => (
                <li key={c.path} className="rm-row">
                  <button type="button" className="rm-row-main" onClick={() => peekNote(c.path, c.name)}>
                    <span className="rm-row-icon" aria-hidden="true">
                      <Icon name="idcard" size={14} />
                    </span>
                    <span className="rm-row-words">
                      <span className="rm-row-name">
                        {c.name} {i === 0 && <Pill tone="next">Latest</Pill>}
                      </span>
                      <span className="rm-row-sub">{[c.issued && dayText(c.issued), c.usedBy.length ? `sent with ${plural(c.usedBy.length, 'application')}` : 'not sent yet', c.files.length ? plural(c.files.length, 'file') : 'no file kept'].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                  {c.files[0] && (
                    <span className="rm-row-end">
                      <button type="button" className="icon-button small" aria-label={`Open ${c.name}’s file`} title="Open the file" onClick={() => A.openPath(c.files[0], { where: 'tab' })}>
                        <Icon name="file" size={13} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rm-none">No CV versions yet. Add one with its file: it is kept in {packName('documents', 'Papers')}{m.documentsOn ? '' : ' (that pack can stay off)'}.</p>
          )}
        </Card>
        <Card id="letters" title="Cover letters" count={m.letters.length}>
          {m.letters.length ? (
            <ul className="rm-rows">
              {m.letters.map((l) => (
                <li key={l.path} className="rm-row">
                  <button type="button" className="rm-row-main" onClick={() => A.openPath(l.path, { where: 'tab' })}>
                    <span className="rm-row-icon" aria-hidden="true">
                      <Icon name="mail" size={14} />
                    </span>
                    <span className="rm-row-words">
                      <span className="rm-row-name">{l.name}</span>
                      <span className="rm-row-sub">{[l.application || l.company, l.written && dayText(l.written), plural(l.words, 'word')].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rm-none">Open an application and choose Write a cover letter: each new one starts from your last.</p>
          )}
        </Card>
      </div>
      {records.some((r) => r.kind === 'letter' || r.kind === 'cv') && <WorkViews module={MOD} section="letters" made={careerSectionViews('letters')} records={records} />}
    </div>
  );
}

function Contacts({ m }: { m: CareerView }) {
  if (!m.contacts.length) return <EmptyState size="panel" icon="people" title="No contacts yet" line="Add the recruiter or hiring manager to an application: they show here with every application they are part of." />;
  return (
    <ul className="pm-contacts">
      {m.contacts.map((c) => (
        <li key={c.name} className="pm-contact">
          <button type="button" className="pm-person" disabled={!c.path} onClick={() => c.path && peekNote(c.path, c.name)}>
            <span className="pm-avatar" aria-hidden="true">
              {c.name
                .split(/\s+/)
                .map((w) => w[0])
                .slice(0, 2)
                .join('')}
            </span>
            <span className="pm-person-words">
              <span className="pm-person-name">{c.name}</span>
              <span className="pm-faint">{[c.role, c.org].filter(Boolean).join(' · ') || (c.path ? 'People card' : 'No People card yet')}</span>
              {(c.email || c.phone) && <span className="pm-faint">{[c.email, c.phone].filter(Boolean).join(' · ')}</span>}
            </span>
          </button>
          <div className="pm-contact-apps">
            {c.applications.map((x) => (
              <button key={x.path} type="button" className="pm-chip" onClick={() => openApp(x.path)}>
                {x.name} <span className="pm-chip-n">{x.stage}</span>
              </button>
            ))}
          </div>
          {c.last && <span className="pm-faint pm-contact-last">Last {dayText(c.last)}</span>}
        </li>
      ))}
    </ul>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function CareerPage({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const sections = CAREER.sections;
  const { section, detail } = placeOf(tab, CAREER, sections);
  const { data: m, error } = useWork<CareerView>(MOD);
  const records = useMemo(() => (m ? careerRecords(m) : []), [m]);
  const ctx = useWorkCtx(MOD, records, {
    editable: (r) => CAREER_EDITABLE[r.kind] ?? [],
    people: m?.people ?? [],
    open: (r: WsRecord, e) => {
      if (!r.path) return;
      if (e?.ctrlKey || e?.metaKey || r.kind === 'letter') return A.openPath(r.path, { where: 'tab' });
      if (r.kind === 'cv') return peekNote(r.path, r.title);
      openApp(r.path);
    },
  });
  const a = detail?.kind === 'application' && m ? m.applications.find((x) => x.path === detail.key) : undefined;
  const info = sections.find((s) => s.id === section) ?? CAREER.sections[0];
  const add = section === 'letters' ? { label: 'New CV version', run: () => newCv(m) } : { label: 'Save an application', run: () => newApplication(m) };
  return (
    <WithRecords ctx={ctx}>
      {error ? (
        <div className="nv-page full p87">
          <p className="rm-failed">{error}</p>
        </div>
      ) : !m ? (
        <div className="nv-page full p87">
          <div className="view-loading" />
        </div>
      ) : detail ? (
        a ? (
          <ApplicationPage a={a} m={m} canEdit={canEdit} />
        ) : (
          <PackShell glyph="◆" tint="blue" title="That application isn’t here any more" sub="It may have been renamed, moved or taken out." menu={() => careerMenu(m, canEdit)}>
            <p>
              <button type="button" className="btn" onClick={() => openModule(MOD, 'applications')}>
                Applications
              </button>
            </p>
          </PackShell>
        )
      ) : !m.applications.length && section !== 'letters' ? (
        <PackShell glyph="◆" tint="blue" title={packName(MOD, 'Career')} sub="Applications from saved to offer, with letters, CVs and interviews." menu={() => careerMenu(m, canEdit)}>
          <EmptyState icon="career" title="Your job search, from applied to offer" line="Add each job you apply for to follow it through its interviews, with the cover letter and CV version you sent and the people you dealt with." action={{ label: 'Add your first application', icon: 'plus', run: () => newApplication(m), disabled: !canEdit }} also={{ label: 'Add a CV version', icon: 'idcard', run: () => newCv(m), disabled: !canEdit }} />
        </PackShell>
      ) : section === 'overview' ? (
        <Overview m={m} canEdit={canEdit} />
      ) : (
        <PackShell
          glyph="◆"
          tint="blue"
          title={info.label}
          sub={info.line}
          actions={
            <button type="button" className="btn pri" disabled={!canEdit} onClick={add.run}>
              + {add.label}
            </button>
          }
          menu={() => careerMenu(m, canEdit)}
        >
          {section === 'letters' ? <Letters m={m} canEdit={canEdit} /> : section === 'contacts' ? <Contacts m={m} /> : <WorkViews module={MOD} section={section} made={careerSectionViews(section)} records={records} />}
        </PackShell>
      )}
    </WithRecords>
  );
}

/** Every Career page and action in the one menu, so nothing is more than a tap away. */
function careerMenu(m: CareerView | null, canEdit: boolean): MenuItem[] {
  if (!m) return [];
  const name = packName(MOD, 'Career');
  return [
    { label: name, icon: 'career', run: () => openModule(MOD, 'overview') },
    { label: 'Pipeline', icon: 'board', run: () => openModule(MOD, 'pipeline') },
    { label: 'Applications', icon: 'table', run: () => openModule(MOD, 'applications') },
    { label: 'Interviews', icon: 'calendar', run: () => openModule(MOD, 'interviews') },
    { label: 'Letters and CVs', icon: 'doc', run: () => openModule(MOD, 'letters') },
    { label: 'Contacts', icon: 'people', run: () => openModule(MOD, 'contacts') },
    { separator: true },
    { label: 'Save an application', icon: 'briefcase', disabled: !canEdit, run: () => newApplication(m) },
    { label: 'New CV version', icon: 'idcard', disabled: !canEdit, run: () => newCv(m) },
    { separator: true },
    { label: 'Show the folder', icon: 'folder', run: () => A.revealInExplorer(m.folder) },
    { separator: true },
    { label: `Show me around ${name}`, icon: 'help', run: () => openTour(MOD) },
  ];
}

// ── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function CareerToday() {
  const modules = useModules();
  const iOn = partOn(modules, MOD, 'interviews');
  const fOn = partOn(modules, MOD, 'followups');
  const { data: m } = useWork<CareerView>(MOD, 'model', [], iOn || fOn);
  if (!m) return null;
  const interviews = iOn ? m.upcoming.filter((i) => i.days! <= Math.max(1, m.remindDays)) : [];
  const follow = fOn ? m.followUps.filter((a) => a.nextDays! <= 0) : [];
  if (!interviews.length && !follow.length) return null;
  return (
    <section className="td-section rm-today pm-today" data-section="career" aria-labelledby="td-h-career">
      <header className="td-section-head">
        <h2 id="td-h-career">
          Career
          <span className="td-count">{interviews.length + follow.length}</span>
        </h2>
        <button type="button" className="td-section-link" onClick={() => openModule(MOD)}>
          <Icon name="career" size={13} /> Career
        </button>
      </header>
      <ul className="rm-today-rows">
        {interviews.map((i) => (
          <li key={`${i.application}:${i.row}`} className={`rm-today-row${i.days === 0 ? ' is-change' : ''}`}>
            <button type="button" className="rm-today-main" onClick={() => openApp(i.application)}>
              <span className="rm-today-name">
                {interviewWords(i, m.today)}: {i.applicationName}
              </span>
              <span className="rm-today-sub">{[i.with && `with ${i.with}`, i.where].filter(Boolean).join(' · ') || i.company}</span>
            </button>
          </li>
        ))}
        {follow.map((a) => (
          <li key={a.path} className={`rm-today-row${a.nextDays! < 0 ? ' is-late' : ''}`}>
            <button type="button" className="rm-today-main" onClick={() => openApp(a.path)}>
              <span className="rm-today-name">
                {a.nextStep || 'Follow up'}: {a.name}
              </span>
              <span className="rm-today-sub">{a.nextDays === 0 ? 'Today' : `Was due ${dayText(a.nextDate)}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
