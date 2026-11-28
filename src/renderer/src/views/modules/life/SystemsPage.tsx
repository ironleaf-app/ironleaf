// Systems and Home Lab's page (Wave 7 part b; src/shared/systems.ts, src/main/life-records/systems.ts). The Overview says
// what needs you (something down, a runbook due, a password written in a note); the Service map shows each machine with
// the services on it and what they depend on; each machine, service and runbook has its own page where every value
// changes where it shows. Logins are kept in Secrets and only linked here: shown, copied or unlinked, never written in.

import { useEffect, useMemo, useState } from 'react';
import { MACHINE_KINDS, MACHINE_STATUSES, RUN_RESULTS, RUNBOOK_EVERY, SERVICE_KINDS, SERVICE_STATUSES, SYSTEMS } from '../../../../../shared/life-records';
import type { LineContext } from '../../../../../shared/types';
import { partOn } from '../../../../../shared/life-modules';
import type { SecretView, SecretsStatus } from '../../../../../shared/secrets';
import { alertsOf, historyOf, serviceObserved, machineState, machineTone, SYSTEM_EDITABLE, systemRecords, systemSectionViews, type Credential, type HealthNote, type Machine, type Runbook, type Service, type SystemsModel } from '../../../../../shared/systems';
import { joinNames } from '../../../../../shared/words';
import { splitRowPath } from '../../../../../shared/system-tables';
import { EmptyState } from '../../../components/EmptyState';
import { Icon, type IconName } from '../../../components/Icon';
import { errorMessage } from '../../../lib/errors';
import { openMenu, type MenuItem } from '../../../components/Menu';
import * as A from '../../../state/actions';
import { openTour } from '../../../state/moduleFills';
import { moduleChanged, openModule, useModules } from '../../../state/modules';
import { getState, showError, toast, useApp, usePrefs } from '../../../state/store';
import { unlockedPhrase } from '../../../../../shared/prefs';
import { withStepUp } from '../../../lib/step-up';
import { useWork, workCall, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { openRecordForm, valueWords } from '../RecordForm';
import { PackSection, PackShell, Tick, checkedWords, packName, rowContext, rowMenu, shortDay, weekdayOf, type Tint } from '../pack87';
import { Card, dayText, inDays, openDetail, Pill, placeOf, useWorkCtx, WithRecords, WorkViews } from '../work/WorkShell';
import { Fact, hostOf, hrefOf, Inline, plural, QuickAdd, saved } from './parts';

interface FoundGroup { machinePath: string; machineName: string; services: { name: string; kind: string; port: string }[]; runbooks: { name: string; template: string; for: string }[] }
interface MoveStateView { offer: boolean; deferred: boolean; done: { at: string; folded: number; backup: string } | null; interrupted: boolean; undoable: boolean; pcsBlock: { names: string[]; words: string } | null; counts: { fold: number; stay: number }; missingLists: string[]; missingWords: string[]; backupExists: boolean; stoppedWords?: string[] }
interface MovePreview { words: string[]; fold: { rel: string; name: string; kind: string; why: string }[]; stay: { rel: string; name: string; kind: string; why: string }[]; tables: Record<string, string>; pcsBlock: { names: string[]; words: string } | null; clash: string | null }
interface SysConflict { kind: string; name: string; path: string; kept: Record<string, string>; keptNote: string | null; others: { name: string; cells: Record<string, string>; note: string | null }[] }
type SystemsView = SystemsModel & { folder: string; found?: FoundGroup[]; tablesClash?: string[]; conflicts?: SysConflict[]; move?: MoveStateView };
/** A list row's path (its record page all the same). */
const isRow = (p: string): boolean => !!splitRowPath(p);

const call = <T,>(name: string, ...args: unknown[]) => workCall<T>('systems', name, ...args);
/** Something made that undoes together (5 Nov 2026): every note and row from one press, back with one Undo. */
async function didMake(job: Promise<{ words: string; created: string[] }>): Promise<void> {
  try {
    const r = await job;
    moduleChanged();
    toast(r.words, r.created.length ? { label: 'Undo', run: () => void workDid(call<{ words: string }>('undo-created', { paths: r.created }), (u) => u.words) } : undefined, r.created.length ? 9000 : 5000);
  } catch (err) {
    showError(err);
  }
}
const openMachine = (rel: string, name?: string) => openDetail('systems', 'machine', rel, name);
const openService = (rel: string, name?: string) => openDetail('systems', 'service', rel, name);
const openRunbook = (rel: string, name?: string) => openDetail('systems', 'runbook', rel, name);
const openRun = (rel: string, name?: string) => openDetail('systems', 'run', rel, name);
/** A row's menu: its page, its list (rows have no note of their own), and taking it out of the list. */
function sysRowMenu(path: string, name: string, open: () => void): MenuItem[] {
  const row = splitRowPath(path);
  if (!row) return rowMenu(path, name, open);
  return [
    { label: `Open ${name}`, icon: 'notes', run: open },
    { label: 'Open its list', icon: 'doc', run: () => A.openPath(row.table, { where: 'tab' }) },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, disabled: !getState().canEdit, run: () => void workDid(call<string>('remove-record', path)).catch(showError) },
  ];
}
/** Delete from a record's own page: a note to the Bin as always, a row out of its list (then back to the lists). */
function removeRecord(kind: 'machine' | 'service' | 'runbook', path: string): void {
  if (!isRow(path)) {
    void A.trashPath(path).catch(showError);
    return;
  }
  void workDid(call<string>('remove-record', path)).then((ok) => {
    if (ok !== null) openModule('systems', kind === 'machine' ? 'machines' : kind === 'service' ? 'services' : 'runbooks');
  }).catch(showError);
}
/** Its note, or its list when it is a row with no note of its own. */
function openNoteOrList(path: string): void {
  const row = splitRowPath(path);
  A.openPath(row ? row.table : path, { where: 'tab' });
}
const MACHINE_ICON: Record<string, IconName> = { Server: 'server', NAS: 'layers', PC: 'computer', Laptop: 'computer', VM: 'layers', 'Container host': 'grid', Router: 'branch', 'Raspberry Pi': 'bolt', Cloud: 'cloud' };
const SERVICE_ICON: Record<string, IconName> = { 'Web app': 'globe', Database: 'table', Media: 'video', 'Game server': 'star', Backup: 'history', DNS: 'branch', VPN: 'lock', Monitoring: 'chart', Storage: 'folder', Automation: 'flow' };
const statusTone = (s: string): 'ok' | 'warn' | 'bad' | 'none' => (/^up$/i.test(s) ? 'ok' : /^(down)$/i.test(s) ? 'bad' : /^(degraded|maintenance|stopped)$/i.test(s) ? 'warn' : 'none');
const set = (kind: string, rel: string, field: string) => (v: string) => saved(call('set-field', { kind, path: rel, field, value: v }));

// ── Doing things ─────────────────────────────────────────────────────────────────────────────────────────────────────

const NEW_LOGIN = 'Make a new login in Secrets';

/** Add a machine's login (30 Oct 2026, fourth pass): choose one already in Secrets, or make a new one there. The
 *  value is never typed into the note; linking it checks the machine straight away when it has an address. */
function addLoginFor(rel: string, name: string): void {
  void (async () => {
    const status = await window.nv.secrets.status().catch(() => null);
    if (!status?.unlocked) {
      toast(status?.exists ? 'Open Locked first: the login goes into the locked store.' : 'Set up Locked first (Settings › Privacy and secrets).', { label: 'Locked', run: () => A.openLocked('secrets') });
      return;
    }
    const list = await window.nv.secrets.list().catch(() => []);
    openRecordForm({
      title: `Add a login for ${name}`,
      icon: 'key',
      line: 'Choose a login already in Secrets, or make a new one there. The note keeps a locked link; the value never leaves Secrets.',
      ok: 'Add its login',
      fields: [
        { key: 'login', label: 'Login', kind: 'choice', options: [...list.map((s) => s.name), NEW_LOGIN], value: list[0]?.name ?? NEW_LOGIN, required: true },
        { key: 'label', label: 'Call the new login', kind: 'text', placeholder: 'Admin login', show: (v) => valueWords(v, 'login') === NEW_LOGIN },
        { key: 'username', label: 'Username', kind: 'text', show: (v) => valueWords(v, 'login') === NEW_LOGIN },
        { key: 'value', label: 'Password or key', kind: 'secret', required: true, wide: true, hint: 'Goes straight into Secrets.', show: (v) => valueWords(v, 'login') === NEW_LOGIN },
      ],
      submit: async (v) => {
        const choice = valueWords(v, 'login');
        if (choice === NEW_LOGIN) {
          const label = valueWords(v, 'label') || 'Admin login';
          const s = await window.nv.secrets.add({ name: `${name} ${label}`.slice(0, 80), kind: 'password', value: valueWords(v, 'value'), username: valueWords(v, 'username') || undefined, where: name });
          await workDid(call<string>('link-secret', rel, label, s.id));
          return;
        }
        const s = list.find((x) => x.name === choice);
        if (!s) throw new Error('Choose a login from Secrets.');
        await workDid(call<string>('link-secret', rel, s.name, s.id));
      },
    });
  })();
}

function newMachine(): void {
  void (async () => {
    const status = await window.nv.secrets.status().catch(() => null);
    const list = status?.unlocked ? await window.nv.secrets.list().catch(() => []) : [];
    openRecordForm({
      title: 'New machine',
      icon: 'server',
      line: 'A server, NAS, PC, VM or router. Its services go on the map under it; its logins are kept in Secrets.',
      ok: 'Add the machine',
      fields: [
        { key: 'name', label: 'Name', kind: 'text', required: true, wide: true, placeholder: 'Media box' },
        { key: 'kind', label: 'Kind', kind: 'choice', options: [...MACHINE_KINDS], value: 'Server' },
        { key: 'role', label: 'What it does', kind: 'text', placeholder: 'Media and backups' },
        { key: 'address', label: 'Address', kind: 'text', placeholder: '192.168.1.20 or nas.local' },
        { key: 'os', label: 'System', kind: 'text', placeholder: 'Debian 12' },
        { key: 'location', label: 'Where it is', kind: 'text', placeholder: 'Garage rack' },
        // Its login, asked for in the same form (fourth pass): already in Secrets, or made new there; never in the note.
        { key: 'login', label: 'Login in Secrets', kind: 'choice', options: ['Add it later', ...list.map((s) => s.name), ...(status?.unlocked ? [NEW_LOGIN] : [])], value: 'Add it later', hint: status?.unlocked ? 'With its address and login, it is checked straight away.' : 'Secrets is not unlocked, so add its login after from its page.' },
        { key: 'label', label: 'Call the new login', kind: 'text', placeholder: 'Admin login', show: (v) => valueWords(v, 'login') === NEW_LOGIN },
        { key: 'username', label: 'Username', kind: 'text', show: (v) => valueWords(v, 'login') === NEW_LOGIN },
        { key: 'value', label: 'Password or key', kind: 'secret', required: true, wide: true, hint: 'Goes straight into Secrets.', show: (v) => valueWords(v, 'login') === NEW_LOGIN },
      ],
      submit: async (v) => {
        const name = valueWords(v, 'name');
        const rel = await call<string>('add-machine', Object.fromEntries(['name', 'kind', 'role', 'address', 'os', 'location'].map((k) => [k, valueWords(v, k)])));
        const choice = valueWords(v, 'login');
        if (choice && choice !== 'Add it later') {
          await workDid((async () => {
            if (choice === NEW_LOGIN) {
              const label = valueWords(v, 'label') || 'Admin login';
              const s = await window.nv.secrets.add({ name: `${name} ${label}`.slice(0, 80), kind: 'password', value: valueWords(v, 'value'), username: valueWords(v, 'username') || undefined, where: name });
              return call<string>('link-secret', rel, label, s.id);
            }
            const s = list.find((x) => x.name === choice);
            if (!s) throw new Error('Choose a login from Secrets.');
            return call<string>('link-secret', rel, s.name, s.id);
          })(), undefined, { label: 'Open', run: () => openMachine(rel, name) });
          return;
        }
        await workDid(Promise.resolve(rel), `Added ${name}.`, { label: 'Open', run: () => openMachine(rel, name) });
      },
    });
  })();
}

function newService(m: SystemsView | null, prefill: { runs_on?: string } = {}): void {
  openRecordForm({
    title: 'New service',
    icon: 'bolt',
    line: 'Something that runs on a machine: a web app, a database, a game server, backups.',
    ok: 'Add the service',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true, wide: true, placeholder: 'Photo library' },
      { key: 'kind', label: 'Kind', kind: 'choice', options: [...SERVICE_KINDS], value: 'Web app' },
      { key: 'runs_on', label: 'Runs on', kind: 'choice', options: ['', ...(m?.machines.map((x) => x.name) ?? [])], value: prefill.runs_on ?? '' },
      { key: 'url', label: 'Address', kind: 'text', placeholder: 'http://media.local:2342' },
      { key: 'port', label: 'Port', kind: 'text', placeholder: '2342' },
      { key: 'depends_on', label: 'Depends on', kind: 'text', placeholder: 'Database, Reverse proxy', hint: 'Other services it needs, separated by commas.' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-service', Object.fromEntries(['name', 'kind', 'runs_on', 'url', 'port', 'depends_on'].map((k) => [k, valueWords(v, k)])));
      await workDid(Promise.resolve(rel), `Added ${valueWords(v, 'name')}.`, { label: 'Open', run: () => openService(rel, valueWords(v, 'name')) });
    },
  });
}

function newRunbook(m: SystemsView | null, prefill: { for?: string } = {}): void {
  openRecordForm({
    title: 'New runbook',
    icon: 'task',
    line: 'Steps for a job you do now and then (an update, a restore, a restart), so it goes the same way each time.',
    ok: 'Add the runbook',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true, wide: true, placeholder: 'Update the NAS' },
      { key: 'for', label: 'For', kind: 'choice', options: ['', ...(m ? [...m.machines.map((x) => x.name), ...m.services.map((x) => x.name)] : [])], value: prefill.for ?? '', own: true },
      { key: 'every', label: 'How often', kind: 'choice', options: [...RUNBOOK_EVERY], value: 'On demand' },
      { key: 'steps', label: 'Steps', kind: 'text', wide: true, placeholder: 'Back up the config; Install updates; Restart; Check the shares', hint: 'Separate them with ;, or add them on its page one by one.' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-runbook', { name: valueWords(v, 'name'), for: valueWords(v, 'for'), every: valueWords(v, 'every'), steps: valueWords(v, 'steps').split(/\s*;\s*/).filter(Boolean) });
      await workDid(Promise.resolve(rel), `Added the runbook ${valueWords(v, 'name')}.`, { label: 'Open', run: () => openRunbook(rel, valueWords(v, 'name')) });
    },
  });
}

function healthForm(rel: string, name: string, kind: 'machine' | 'service', status: string): void {
  openRecordForm({
    title: `Health note for ${name}`,
    icon: 'chart',
    line: 'What you saw, and its status now. The day is today unless you change it.',
    ok: 'Add the note',
    fields: [
      { key: 'status', label: 'Status now', kind: 'segment', options: kind === 'machine' ? [...MACHINE_STATUSES].filter((s) => s !== 'Retired') : [...SERVICE_STATUSES], value: status },
      { key: 'date', label: 'Day', kind: 'date' },
      { key: 'note', label: 'What you saw', kind: 'text', wide: true, required: true, placeholder: 'Disk at 92%; cleared old logs' },
    ],
    submit: async (v) => {
      await workDid(call<string>('health-note', rel, { status: valueWords(v, 'status'), date: valueWords(v, 'date'), note: valueWords(v, 'note') }));
    },
  });
}

async function moveToSecrets(rel: string, name: string): Promise<void> {
  const found = await workDid(call<{ fp: string; name: string }[]>('findings', rel), '');
  if (!found?.length) return void toast(`Nothing in ${name} looks like a password any more.`);
  const status = await window.nv.secrets.status().catch(() => null);
  if (!status?.unlocked) {
    toast(status?.exists ? 'Open Locked first: the values go into the locked store.' : 'Set up Locked first (Settings › Privacy and secrets).', { label: 'Locked', run: () => A.openLocked('secrets') });
    return;
  }
  await workDid(
    window.nv.scan.move(found.map((f) => ({ path: rel, fp: f.fp, name: f.name }))),
    (r) => `Moved ${plural(r.moved, 'password')} into Secrets. ${name} now holds locked links only.`,
  );
}

// ── Logins (linked to Secrets) ───────────────────────────────────────────────────────────────────────────────────────

function useSecrets(): { status: SecretsStatus | null; list: SecretView[]; again(): void } {
  const [status, setStatus] = useState<SecretsStatus | null>(null);
  const [list, setList] = useState<SecretView[]>([]);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    void window.nv.secrets.status().then(
      async (s) => {
        if (!live) return;
        setStatus(s);
        setList(s.unlocked ? await window.nv.secrets.list().catch(() => []) : []);
      },
      () => live && setStatus(null),
    );
    return () => {
      live = false;
    };
  }, [n]);
  return { status, list, again: () => setN((x) => x + 1) };
}

function LoginsCard({ rel, name, credentials, plain, canEdit }: { rel: string; name: string; credentials: Credential[]; plain: number; canEdit: boolean }) {
  const { status, list, again } = useSecrets();
  const prefs = usePrefs();
  const unlocked = !!status?.unlocked;
  const lockNow = () => void window.nv.private.lock().then(again, again);
  const known = (id: string) => list.find((s) => s.id === id);
  const link = () =>
    openRecordForm({
      title: `Link a login to ${name}`,
      icon: 'key',
      line: 'A login already in Secrets. The note keeps a locked link; the value never leaves Secrets.',
      ok: 'Link it',
      fields: [
        { key: 'secret', label: 'Login in Secrets', kind: 'choice', options: list.map((s) => s.name), required: true },
        { key: 'label', label: 'Call it', kind: 'text', placeholder: 'Admin login' },
      ],
      submit: async (v) => {
        const s = list.find((x) => x.name === valueWords(v, 'secret'));
        if (!s) throw new Error('Choose a login from Secrets.');
        await workDid(call<string>('link-secret', rel, valueWords(v, 'label') || s.name, s.id));
      },
    });
  const keepNew = () =>
    openRecordForm({
      title: `New login for ${name}`,
      icon: 'key',
      line: 'Kept in your locked Secrets; the note holds only a locked link, and no assistant can ever read it.',
      ok: 'Keep it in Secrets',
      fields: [
        { key: 'label', label: 'What it is', kind: 'text', required: true, placeholder: 'Admin login' },
        { key: 'username', label: 'Username', kind: 'text' },
        { key: 'value', label: 'Password or key', kind: 'secret', required: true, wide: true, hint: 'Goes straight into Secrets.' },
      ],
      submit: async (v) => {
        const label = valueWords(v, 'label');
        const s = await window.nv.secrets.add({ name: `${name} ${label}`.slice(0, 80), kind: 'password', value: valueWords(v, 'value'), username: valueWords(v, 'username') || undefined, where: name });
        await workDid(call<string>('link-secret', rel, label, s.id));
        again();
      },
    });
  return (
    <Card
      id="logins"
      title="Logins"
      count={credentials.length}
      actions={
        canEdit && unlocked ? (
          <>
            {list.length > 0 && (
              <button type="button" className="text-button" onClick={link}>
                <Icon name="link" size={12} /> Link
              </button>
            )}
            <button type="button" className="text-button" onClick={keepNew}>
              <Icon name="plus" size={12} /> New
            </button>
          </>
        ) : undefined
      }
    >
      {plain > 0 && (
        <div className="lr-warn">
          <Icon name="warning" size={14} />
          <span>
            {plain === 1 ? 'A password is' : `${plain} passwords are`} written in this note. Move {plain === 1 ? 'it' : 'them'} to Secrets so no one reading the note, and no assistant, can see {plain === 1 ? 'it' : 'them'}.
          </span>
          <button type="button" className="button small" disabled={!canEdit} onClick={() => void moveToSecrets(rel, name).then(again)}>
            Move to Secrets
          </button>
        </div>
      )}
      {credentials.length ? (
        <ul className="lr-logins">
          {credentials.map((c) => (
            <li key={c.id} className="lr-login">
              <span className="lr-login-icon" aria-hidden="true">
                <Icon name="lock" size={13} />
              </span>
              <span className="lr-login-words">
                <span className="lr-login-name">{c.label}</span>
                <span className="lr-login-sub">{unlocked ? (known(c.id) ? [known(c.id)!.username, known(c.id)!.masked].filter(Boolean).join(' · ') : 'Not found in Secrets') : 'Locked in Secrets'}</span>
              </span>
              <button type="button" className="icon-button small" aria-label={`Copy ${c.label}`} title="Copy (cleared from the clipboard soon after)" disabled={!unlocked} onClick={() => void withStepUp(() => window.nv.secrets.copy(c.id)).then((r) => toast(`Copied. It clears from the clipboard in ${plural(r.seconds, 'second')}.`), (e) => toast(e instanceof Error ? errorMessage(e) : 'It couldn’t be copied.'))}>
                <Icon name="copy" size={12} />
              </button>
              <button
                type="button"
                className="icon-button small"
                aria-label={`More for ${c.label}`}
                onClick={(e) =>
                  openMenu(e.currentTarget, [
                    { label: 'Show it', icon: 'eye', run: () => void import('../../../components/SecretLink').then((x) => x.showSecret(c.id)) },
                    { label: 'Open Locked', icon: 'key', run: () => A.openLocked('secrets') },
                    { separator: true },
                    { label: 'Take the link off', icon: 'trash', danger: true, disabled: !canEdit, run: () => void workDid(call<string>('unlink-secret', rel, c.id)) },
                  ])
                }
              >
                <Icon name="more" size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rm-none">{unlocked ? 'No logins linked. Keep a new one in Secrets, or link one already there.' : 'No logins linked yet.'}</p>
      )}
      {unlocked ? (
        <p className="lr-hint">
          Unlocked on this PC {unlockedPhrase(prefs.secretsKeepUnlocked, prefs.privateLockMinutes)}.{' '}
          <button type="button" className="text-button" onClick={lockNow}>
            Lock now
          </button>
        </p>
      ) : (
        <p className="lr-hint">
          {status?.exists ? 'Your logins are locked on this PC. ' : 'Locked isn’t set up yet. '}
          <button type="button" className="text-button" onClick={() => A.openLocked('secrets')}>
            {status?.exists ? 'Unlock it' : 'Set it up'}
          </button>{' '}
          to link or copy a login. Once unlocked, they stay unlocked on this PC {unlockedPhrase(prefs.secretsKeepUnlocked, prefs.privateLockMinutes)}.
        </p>
      )}
    </Card>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function Dot({ status, tone }: { status: string; tone?: 'ok' | 'warn' | 'bad' | 'none' }) {
  return <span className={`lr-dot tone-${tone ?? statusTone(status)}`} aria-label={status} title={status} />;
}

function HealthCard({ rel, name, kind, status, health, canEdit }: { rel: string; name: string; kind: 'machine' | 'service'; status: string; health: HealthNote[]; canEdit: boolean }) {
  const rows = [...health].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return (
    <Card id="health" title="Health log" count={health.length} actions={canEdit ? <button type="button" className="text-button" onClick={() => healthForm(rel, name, kind, status)}><Icon name="plus" size={12} /> Add a note</button> : undefined}>
      {rows.length ? (
        <ul className="lr-health">
          {rows.slice(0, 12).map((h) => (
            <li key={h.row} className="lr-health-row">
              <span className="lr-health-date">{h.date ? dayText(h.date) : 'No date'}</span>
              {h.status ? <Pill tone={statusTone(h.status) === 'none' ? undefined : statusTone(h.status)}>{h.status}</Pill> : <span />}
              <span className="lr-health-note">{h.note}</span>
              <button type="button" className="icon-button small" aria-label="Take this note out" title="Take it out" disabled={!canEdit} onClick={() => void workDid(call<string>('remove-health', rel, h.row, h.date))}>
                <Icon name="trash" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rm-none">No health notes yet. Note what you see when you check it: disk space, an update, an outage.</p>
      )}
    </Card>
  );
}

function ServiceRow({ s }: { s: Service }) {
  const href = hrefOf(s.url);
  return (
    <li className={`lr-svc tone-${statusTone(s.status)}`}>
      <button type="button" className="lr-svc-main" onClick={() => openService(s.path, s.name)}>
        <Dot status={s.status} />
        <Icon name={SERVICE_ICON[s.kind] ?? 'bolt'} size={13} />
        <span className="lr-svc-name">{s.name}</span>
        {s.port && <span className="lr-svc-port">:{s.port}</span>}
      </button>
      {s.dependsOn.length > 0 && (
        <span className="lr-svc-deps">
          needs{' '}
          {s.dependsOn.map((d, i) => (
            <span key={d.name}>
              {i > 0 && ', '}
              {d.path ? (
                <button type="button" className="text-button" onClick={() => openService(d.path!, d.name)}>
                  {d.name}
                </button>
              ) : (
                d.name
              )}
            </span>
          ))}
        </span>
      )}
      {href && (
        <a className="icon-button small" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${hostOf(href)}`} title={href}>
          <Icon name="external" size={11} />
        </a>
      )}
      {s.status !== 'Up' && <Pill tone={statusTone(s.status) === 'none' ? undefined : statusTone(s.status)}>{s.status}</Pill>}
    </li>
  );
}

function ServiceMap({ m, canEdit }: { m: SystemsView; canEdit: boolean }) {
  const loose = m.services.filter((s) => !s.machinePath);
  return (
    <ul className="lr-map">
      {m.machines.filter((x) => x.status !== 'Retired' || x.services.length).map((x) => {
        const svcs = x.services.map((p) => m.services.find((s) => s.path === p)!).filter(Boolean);
        const st = machineState(x);
        return (
          <li key={x.path} className={`lr-node tone-${st.tone}${x.status === 'Retired' ? ' is-retired' : ''}`}>
            <button type="button" className="lr-node-head" onClick={() => openMachine(x.path, x.name)}>
              <span className="lr-node-icon" aria-hidden="true">
                <Icon name={MACHINE_ICON[x.kind] ?? 'server'} size={16} />
              </span>
              <span className="lr-node-words">
                <span className="lr-node-name">
                  <Dot status={st.words} tone={st.tone} /> {x.name}
                </span>
                <span className="lr-node-sub">{[x.kind, x.address, x.os, st.words !== x.status ? st.words : ''].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
            {svcs.length ? (
              <ul className="lr-svcs">
                {svcs.map((s) => (
                  <ServiceRow key={s.path} s={s} />
                ))}
              </ul>
            ) : (
              <p className="lr-node-empty">No services on it yet.</p>
            )}
            {canEdit && (
              <button type="button" className="lr-node-add" onClick={() => newService(m, { runs_on: x.name })}>
                <Icon name="plus" size={11} /> Add a service here
              </button>
            )}
          </li>
        );
      })}
      {loose.length > 0 && (
        <li className="lr-node is-loose">
          <div className="lr-node-head">
            <span className="lr-node-icon" aria-hidden="true">
              <Icon name="cloud" size={16} />
            </span>
            <span className="lr-node-words">
              <span className="lr-node-name">Not on a machine</span>
              <span className="lr-node-sub">Hosted elsewhere, or its machine isn’t written yet</span>
            </span>
          </div>
          <ul className="lr-svcs">
            {loose.map((s) => (
              <ServiceRow key={s.path} s={s} />
            ))}
          </ul>
        </li>
      )}
    </ul>
  );
}

function RunbookRow({ r, today }: { r: Runbook; today: string }) {
  return (
    <li className={`rm-row${r.days !== null && r.days < 0 ? ' is-late' : ''}`}>
      <button type="button" className="rm-row-main" onClick={() => openRunbook(r.path, r.name)}>
        <span className="rm-row-icon" aria-hidden="true">
          <Icon name="task" size={14} />
        </span>
        <span className="rm-row-words">
          <span className="rm-row-name">{r.name}</span>
          <span className="rm-row-sub">{[r.for.map((f) => f.name).join(', '), r.every, r.lastRun ? `last run ${dayText(r.lastRun)}` : 'never run', r.nextDue && (r.days! <= 0 ? (r.lastRun ? `due ${r.days === 0 ? 'today' : `since ${dayText(r.nextDue)}`}` : 'due now') : `next ${dayText(r.nextDue)}, ${inDays(r.nextDue, today)}`)].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
      <span className="rm-row-end">
        <button type="button" className="button small" onClick={() => openRun(r.path, r.name)}>
          <Icon name="play" size={11} /> Run it
        </button>
      </span>
    </li>
  );
}

function MachineActions({ x, canEdit }: { x: Machine; canEdit: boolean }) {
  const run = (action: string, service?: string) => void workDid(call<string>('run-action', x.path, { action, ...(service ? { service } : {}) }));
  if (!canEdit) return null;
  return <span className="sys-actions"><button type="button" className="button small" onClick={() => run('install-updates')}>Install updates</button><button type="button" className="button small" onClick={() => run('free-disk')}>Free disk space</button><button type="button" className="button small" onClick={() => run('reboot')}>Reboot when done</button></span>;
}

/** Notes on a row record (records as data, 5 Nov 2026): the first words written make it a note of its own. */
/** A record's disagreement, when it has one: changed on two PCs, so the list keeps each version. Only a
 *  record that lives in a list can disagree (a note of its own never matches, even one sharing the name). */
function conflictOf(m: SystemsView, kind: string, rec: { name: string; path: string; rowPath?: string }): SysConflict | null {
  if (!isRow(rec.path) && !rec.rowPath) return null;
  return (m.conflicts ?? []).find((x) => x.kind === kind && x.name.toLowerCase() === rec.name.toLowerCase()) ?? null;
}

const CONFLICT_LABELS: Record<string, Record<string, string>> = {
  machine: { kind: 'Kind', role: 'What it does', os: 'System', address: 'Address', location: 'Where it is', status: 'Status', checked: 'Last checked', logins: 'Logins', note: 'Note file' },
  service: { kind: 'Kind', runsOn: 'Runs on', url: 'Address', port: 'Port', status: 'Status', dependsOn: 'Depends on', runbook: 'Runbook', checked: 'Last checked', logins: 'Logins', note: 'Note file' },
  runbook: { for: 'For', every: 'How often', lastRun: 'Last run', pattern: 'Pattern', note: 'Note file' },
};

/** A cell's plain words, as the bills card reads them: every [[link]] reads as its name (an alias wins).
 *  Compared and shown the same way, so versions differing only in brackets never read as a difference
 *  (8 Nov 2026, item 4). */
const plainCell = (v: string): string =>
  String(v ?? '')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias: string | undefined) => (alias ?? target.split('/').pop()!.replace(/\.md$/i, '')).trim())
    .trim();

/** The one way to choose: each version with the facts where they differ, one choice, one button.
 *  Exported for tests/folder-followups-systems.test.mjs, which draws the real card in the headless shell. */
export function SystemsConflictCard({ conflict, canEdit }: { conflict: SysConflict; canEdit: boolean }) {
  const [keep, setKeep] = useState(0);
  const [busy, setBusy] = useState(false);
  const versions = [{ name: conflict.name, cells: conflict.kept, note: conflict.keptNote }, ...conflict.others];
  const labels = CONFLICT_LABELS[conflict.kind] ?? {};
  const cellOf = (v: { cells: Record<string, string>; note: string | null }, k: string) => (k === 'note' ? (v.note ?? '') : plainCell(v.cells[k] ?? ''));
  const keys = Object.keys(labels).filter((k) => new Set(versions.map((v) => cellOf(v, k))).size > 1);
  const nameDiffers = new Set(versions.map((v) => v.name)).size > 1;
  const choose = () => {
    if (busy) return;
    setBusy(true);
    void workDid(call<{ words: string }>('resolve-conflict', { kind: conflict.kind, name: conflict.name, keep }), (r) => r.words).finally(() => setBusy(false));
  };
  return (
    <Card id="conflict" title="Changed on two PCs" count={versions.length}>
      <p className="vsub">{conflict.name} was changed on two PCs, so the list keeps each version. You are seeing one of them. Choose which one to keep.</p>
      <ul className="sys-conflict-vers">
        {versions.map((v, i) => (
          <li key={i}>
            <label className={`sys-conflict-ver${keep === i ? ' is-on' : ''}`}>
              <span className="sys-conflict-head">
                <input type="radio" name={`conflict-${conflict.kind}-${conflict.name}`} checked={keep === i} onChange={() => setKeep(i)} disabled={!canEdit || busy} />
                {i === 0 ? 'Shown now' : versions.length === 2 ? 'The other version' : `Version ${i + 1}`}
              </span>
              <ul className="sys-conflict-facts">
                {nameDiffers && (
                  <li>
                    <span className="k">Name</span>
                    <span>{v.name}</span>
                  </li>
                )}
                {keys.map((k) => (
                  <li key={k}>
                    <span className="k">{labels[k]}</span>
                    <span>{cellOf(v, k) || 'Not set'}</span>
                  </li>
                ))}
              </ul>
            </label>
          </li>
        ))}
      </ul>
      <p className="sys-actions">
        <button type="button" className="button small primary" disabled={!canEdit || busy} onClick={choose}>
          {busy ? 'Keeping…' : 'Keep chosen'}
        </button>
      </p>
    </Card>
  );
}

/** What links to this record (notes and folded rows alike, through the index's one backlinks): each a
 *  click away. Quiet when nothing does. */
function RecordLinks({ path }: { path: string }) {
  const [links, setLinks] = useState<LineContext[] | null>(null);
  useEffect(() => {
    let live = true;
    setLinks(null);
    void window.nv.index.backlinks(path).then(
      (b) => live && setLinks(b.filter((x) => x.source !== path)),
      () => live && setLinks([]),
    );
    return () => {
      live = false;
    };
  }, [path]);
  if (!links?.length) return null;
  const sources = [...new Map(links.map((l) => [l.source, l])).entries()];
  return (
    <Card id="links" title="Links to this record" count={sources.length}>
      {sources.map(([src, l]) => (
        <div key={src} className="backlink-group">
          <div className="backlink-head" role="button" tabIndex={0} onClick={() => A.openPath(src, { where: 'tab' })} onKeyDown={(e) => e.key === 'Enter' && A.openPath(src, { where: 'tab' })}>
            <span className="backlink-title">{l.sourceTitle}</span>
            {!src.includes('#') && src.includes('/') && <span className="result-folder">{src.slice(0, src.lastIndexOf('/'))}</span>}
            <span className="result-count">{links.filter((x) => x.source === src).length}</span>
          </div>
        </div>
      ))}
    </Card>
  );
}

function NotesCard({ path, name, canEdit, open }: { path: string; name: string; canEdit: boolean; open: (rel: string) => void }) {
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const save = () => {
    const text = words.trim();
    if (!text || busy) return;
    setBusy(true);
    void call<string>('note-words', path, text).then(
      (rel) => {
        moduleChanged();
        setWords('');
        toast('It is a note of its own now.');
        open(rel);
      },
      (err) => showError(err),
    ).finally(() => setBusy(false));
  };
  return (
    <Card id="notes" title="Notes">
      <p className="vsub">Write about {name}. The first words make it a note of its own.</p>
      <textarea className="sys-notes-box" value={words} rows={3} placeholder={`Something about ${name}…`} aria-label={`Notes about ${name}`} disabled={!canEdit || busy} onChange={(e) => setWords(e.target.value)} />
      <p className="sys-actions">
        <button type="button" className="button small" disabled={!canEdit || !words.trim() || busy} onClick={save}>
          {busy ? 'Writing…' : 'Write it down'}
        </button>
      </p>
    </Card>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Good, At risk, Down — or, when it was never checked, grey "Not checked yet" (the app's rule: a machine never
 *  checked is never shown as up or Good). */
function machineWords(m: SystemsModel, x: Machine): { tone: Tint; words: string } {
  const tone = machineTone(m, x);
  if (!machineState(x).checked) return { tone: 'slate', words: 'Not checked yet' };
  if (/^maintenance$/i.test(x.status ?? '')) return { tone: 'amber', words: 'In maintenance' };
  if (tone === 'ok') return { tone: 'green', words: 'Good' };
  if (tone === 'warn') return { tone: 'amber', words: 'At risk' };
  if (tone === 'bad') return { tone: 'red', words: 'Down' };
  return { tone: 'slate', words: machineState(x).words };
}

/** A runbook's due tag: how late, its due day, or when needed. */
function runbookTag(r: Runbook): { tone: Tint; words: string } {
  if (r.days === null || !r.nextDue) return { tone: 'slate', words: 'When needed' };
  if (r.days < 0) return { tone: 'red', words: r.days === -1 ? '1 day late' : `${-r.days} days late` };
  if (r.days === 0) return { tone: 'amber', words: 'Due today' };
  if (r.days <= 7) return { tone: 'amber', words: `Due ${weekdayOf(r.nextDue)}` };
  return { tone: 'slate', words: `Due ${shortDay(r.nextDue)}` };
}

function RunbookTrow({ r }: { r: Runbook }) {
  const tag = runbookTag(r);
  const title = r.for.length ? `${r.name} · ${r.for.map((f) => f.name).join(', ')}` : r.name;
  return (
    <div className="trow" {...rowContext(() => sysRowMenu(r.path, r.name, () => openRunbook(r.path, r.name)))}>
      <Tick label={`Run ${r.name}`} onTick={() => openRun(r.path, r.name)} />
      <button type="button" onClick={() => openRunbook(r.path, r.name)} className="t" title={title} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {title}
      </button>
      <span className="end">
        <span className="meta">{`${r.steps.length} ${r.steps.length === 1 ? 'step' : 'steps'}`} ·</span>
        <span className={`tag ${tag.tone}`}>{tag.words}</span>
      </span>
    </div>
  );
}

function MachineTrow({ x, m }: { x: Machine; m: SystemsView }) {
  const svcs = x.services.map((p) => m.services.find((s) => s.path === p)!).filter(Boolean);
  const st = machineState(x);
  const tone = machineTone(m, x);
  const tag = machineWords(m, x);
  const alerts = alertsOf(m).filter((a) => a.path === x.path);
  const bad = m.trouble.find((t) => t.path === x.path);
  // A machine reads Down when one of its services is down even though the machine itself answers: the row then
  // names the service, never "no reply". Likewise an At risk row names what is off before falling back to its address.
  // Maintenance is its own state (packs uplift item 4): never its own outage, and the row keeps its health note.
  const ownDown = /^down$/i.test(x.status ?? '');
  const inMaint = /^maintenance$/i.test(x.status ?? '');
  const maintNote = inMaint ? [...x.health].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]?.note?.trim() : '';
  const downSvcs = svcs.filter((sv) => /^(down|degraded)$/i.test(sv.status));
  const offSvcs = svcs.filter((sv) => !/^up$/i.test(sv.status));
  const svcWords = (list: typeof svcs) => list.map((sv) => `${sv.name} is ${sv.status.toLowerCase()}`).join(', ');
  const meta = !st.checked
    ? (st.needsAddress ? 'needs its address' : st.needsLogin ? 'needs its login' : 'never checked')
    : inMaint
      ? (maintNote || 'in maintenance')
      : tone === 'bad'
      ? (ownDown ? (bad?.note || (x.checked ? `no reply since ${checkedWords(x.checked, m.today).toLowerCase()}` : 'no reply')) : (svcWords(downSvcs) || bad?.note || 'not up'))
      : tone === 'warn' && alerts.length
        ? alerts[0].title.replace(`${x.name}’s `, '').replace(`${x.name} `, '').replace(/^is /, '')
        : tone === 'warn' && offSvcs.length
          ? svcWords(offSvcs)
          : x.address || '';
  const title = svcs.length ? `${x.name} · ${x.kind} · ${svcs.map((sv) => sv.name).join(', ')}` : x.role ? `${x.name} · ${x.role}` : `${x.name} · ${x.kind}`;
  return (
    <div className="trow" {...rowContext(() => sysRowMenu(x.path, x.name, () => openMachine(x.path, x.name)))}>
      <span className={`gtile xs ${tag.tone}`} aria-hidden="true">
        ▣
      </span>
      <button type="button" onClick={() => openMachine(x.path, x.name)} className="t" title={title} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {title}
      </button>
      <span className="end">
        {meta ? <span className="meta">{meta} ·</span> : null}
        <span className={`tag ${tag.tone}`}>{tag.words}</span>
      </span>
    </div>
  );
}

function Overview({ m, canEdit }: { m: SystemsView; canEdit: boolean }) {
  const modules = useModules();
  const runbooksOn = partOn(modules, 'systems', 'runbooks');
  const live = m.machines.filter((x) => x.status !== 'Retired');
  const tones = live.map((x) => machineTone(m, x));
  const down = tones.filter((t) => t === 'bad').length;
  const risk = tones.filter((t) => t === 'warn').length;
  const good = tones.filter((t) => t === 'ok').length;
  const fresh = tones.filter((t) => t === 'none').length;
  const needLogin = live.filter((x) => machineState(x).needsLogin).length;
  const lastChecked = live.map((x) => x.checked ?? '').filter(Boolean).sort().slice(-1)[0] ?? null;
  const due = runbooksOn ? m.runbooksDue : [];
  // An empty section that says nothing is not shown; runbooks keep their one quiet line once any exist.
  const showMachines = live.length > 0;
  const showRunbooks = runbooksOn && m.runbooks.length > 0;
  return (
    <PackShell
      glyph="▣"
      tint="slate"
      title={packName('systems', 'Systems')}
      sub={`Servers, PCs and services as a map, with runbooks and logins${lastChecked ? `. Checked ${checkedWords(lastChecked, m.today).toLowerCase()}` : ''}.`}
      facts={[
        {
          k: 'Right now',
          v: (
            <>
              {down ? <span className="pill red">{`${down} down`}</span> : null}
              {risk ? <span className="pill amber">{`${risk} at risk`}</span> : null}
              {good ? <span className="pill green">{`${good} good`}</span> : null}
              {fresh ? <span className="pill slate">{`${fresh} not checked`}</span> : null}
              {!live.length ? <span className="pill slate">No machines yet</span> : null}
            </>
          ),
        },
        { k: 'Due', v: [runbooksOn ? `${due.length} ${due.length === 1 ? 'runbook' : 'runbooks'}` : null, `${needLogin} ${needLogin === 1 ? 'login' : 'logins'} not yet kept`, m.plain.length ? `${m.plain.length} ${m.plain.length === 1 ? 'password' : 'passwords'} written in a note` : null].filter(Boolean).join(' · ') || 'Nothing due' },
      ]}
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={() => newMachine()}>
          + Add a machine
        </button>
      }
      menu={() => systemsMenu(m, canEdit)}
    >
      <MoveCard m={m} canEdit={canEdit} />
      {(m.move?.missingLists?.length ?? 0) > 0 && (
        <PackSection label="A list is missing">
          {(m.move!.missingWords ?? []).map((w, i) => (
            <p key={i} className="vsub">{w}</p>
          ))}
          {m.move!.undoable && canEdit && (
            <p className="sys-actions">
              <button type="button" className="button small primary" onClick={() => void workDid(call<string>('move-undo'))}>
                Put them back
              </button>
            </p>
          )}
        </PackSection>
      )}
      {(m.tablesClash?.length ?? 0) > 0 && (
        <PackSection label="Lists waiting">
          {m.tablesClash!.map((rel) => (
            <p key={rel} className="vsub">“{rel.split('/').pop()}” is already a note you wrote. Rename that note first, then the list can move in.</p>
          ))}
        </PackSection>
      )}
      {showMachines && (
        <PackSection label="Machines">
          {live.map((x) => (
            <MachineTrow key={x.path} x={x} m={m} />
          ))}
        </PackSection>
      )}
      <FoundList found={m.found ?? []} canEdit={canEdit} />
      {showRunbooks && (
        <PackSection label="Runbooks due" bare={!due.length}>
          {due.length ? (
            due.map((r) => <RunbookTrow key={r.path} r={r} />)
          ) : (
            <p className="vsub">No runbook is due.</p>
          )}
        </PackSection>
      )}
    </PackShell>
  );
}

// ── A machine's or service's own page ───────────────────────────────────────────────────────────────────────────────

function MachinePage({ x, m, canEdit }: { x: Machine; m: SystemsView; canEdit: boolean }) {
  const svcs = x.services.map((p) => m.services.find((s) => s.path === p)!).filter(Boolean);
  const runbooks = m.runbooks.filter((r) => r.for.some((f) => f.path === x.path) || svcs.some((s) => s.runbookPath === r.path));
  const needs = alertsOf(m).filter((a) => a.path === x.path || svcs.some((s) => s.path === a.path));
  const st = machineState(x);
  const tag = machineWords(m, x);
  const days = historyOf(x.health, m.today);
  const disk = [...days].reverse().find((d) => d.disk !== null)?.disk ?? null;
  const sub = [`${x.os || x.kind}${x.location ? ` in ${x.location}` : ''}`, svcs.length ? `Runs ${svcs.map((s) => s.name).join(', ')}` : null].filter(Boolean).join('. ') + '.';
  return (
    <PackShell
      glyph="▣"
      tint={tag.tone}
      title={`${x.name} · ${x.kind}`}
      sub={sub}
      {...(isRow(x.path) ? {} : { sharePath: x.path })}
      facts={[
        { k: 'Health', v: <><span className={`pill ${tag.tone}`}>{tag.words}</span><span className="meta">{[disk !== null ? `${disk}% full` : null, x.checked ? `checked ${checkedWords(x.checked, m.today).toLowerCase()}` : 'never checked'].filter(Boolean).join(' · ')}</span></> },
        { k: 'Address', v: <><Inline value={x.address} label="Address" placeholder="Add" canEdit={canEdit} onSave={set('machine', x.path, 'address')} />{x.os ? ` · ${x.os}` : ''}</> },
        {
          k: 'Login',
          v: x.credentials.length ? (
            <><span className="pill green">{`${x.credentials.length} linked`}</span><span className="meta">kept locked, never in a note</span></>
          ) : (
            <><button type="button" className="pill amber" style={{ border: 0, cursor: 'pointer', font: 'inherit' }} disabled={!canEdit} onClick={() => addLoginFor(x.path, x.name)} title="Keep its login in Secrets">Add its login</button><span className="meta">kept locked, never in a note</span></>
          ),
        },
      ]}
      actions={<CheckNow x={x} />}
      menu={() => [
        { label: packName('systems', 'Systems'), icon: 'computer', run: () => openModule('systems', 'overview') },
        { label: 'Service map', icon: 'graph', run: () => openModule('systems', 'map') },
        { separator: true },
        { label: 'Add a service on it', icon: 'bolt', disabled: !canEdit, run: () => newService(m, { runs_on: x.name }) },
        { label: 'Add a runbook for it', icon: 'task', disabled: !canEdit, run: () => newRunbook(m, { for: x.name }) },
        { label: 'Write the runbooks it needs', icon: 'doc', disabled: !canEdit, run: () => void didMake(call<{ words: string; created: string[] }>('ensure-runbooks', x.path)) },
        { separator: true },
        { label: isRow(x.path) ? 'Open its list' : 'Open its note', icon: 'notes', run: () => openNoteOrList(x.path) },
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => removeRecord('machine', x.path) },
      ]}
    >
      {conflictOf(m, 'machine', x) && <SystemsConflictCard conflict={conflictOf(m, 'machine', x)!} canEdit={canEdit} />}
      {needs.length > 0 && (
        <PackSection label="Needs you">
          {needs.map((a) => (
            <div key={a.key} className="trow">
              <span className="t">{a.title}</span>
              <span className="end">
                <span className="meta">{a.nextStep}</span>
                {a.key.startsWith('not-checked:') && st.needsLogin && !st.needsAddress ? (
                  <button type="button" className="btn" style={{ height: 28 }} disabled={!canEdit} onClick={() => addLoginFor(x.path, x.name)}>
                    Add its login
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </PackSection>
      )}
      <PackSection label="Last 7 days" pad>
        <div className="p87-strip" role="img" aria-label={`Last 7 days for ${x.name}`}>
          {days.map((d) => (
            <div key={d.date} className={d.up === null ? 'none' : !d.up ? 'bad' : d.disk !== null && d.disk > 85 ? 'warn' : ''} title={`${d.date}${d.disk !== null ? `, disk ${d.disk}% used` : ''}${d.memoryPct !== null ? `, memory ${d.memoryPct}%` : ''}`}>
              <i />
              <span>{weekdayOf(d.date)}</span>
            </div>
          ))}
        </div>
      </PackSection>
      <div className="glabel" style={{ margin: '20px 0 8px' }}>Fix</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <MachineActions x={x} canEdit={canEdit} />
        {canEdit && svcs.map((s) => (
          <button key={s.path} type="button" className="btn" onClick={() => void workDid(call<string>('run-action', x.path, { action: 'restart-service', service: s.name }))}>
            Restart {s.name}
          </button>
        ))}
      </div>
      <FoundList found={(m.found ?? []).filter((g) => g.machinePath === x.path)} canEdit={canEdit} />
      <PackSection label="Services on it" bare={!svcs.length}>
        {svcs.length ? (
          <ul className="lr-svcs">
            {svcs.map((sv) => (
              <ServiceRow key={sv.path} s={sv} />
            ))}
          </ul>
        ) : (
          <p className="vsub">{x.address && x.credentials.length ? 'Nothing read from it yet. Check now signs in with its login and lists what runs on it.' : x.address ? 'Add its login, and Check now lists what runs on it.' : 'Add its address and login, and Check now lists what runs on it.'}</p>
        )}
      </PackSection>
      <PackSection label="Runbooks for this machine" bare={!runbooks.length}>
        {runbooks.length ? (
          runbooks.map((r) => <RunbookTrow key={r.path} r={r} />)
        ) : (
          <p className="vsub">
            No runbooks for it yet. They are written when you ask for them.{' '}
            {canEdit && (
              <button type="button" className="btn quiet" style={{ height: 26 }} onClick={() => void didMake(call<{ words: string; created: string[] }>('ensure-runbooks', x.path))}>
                Write the runbooks it needs
              </button>
            )}
          </p>
        )}
      </PackSection>
      <HealthCard rel={x.path} name={x.name} kind="machine" status={x.status} health={x.health} canEdit={canEdit} />
      {(x.credentials.length > 0 || x.plain > 0) && <LoginsCard rel={x.path} name={x.name} credentials={x.credentials} plain={x.plain} canEdit={canEdit} />}
      {isRow(x.path) && <NotesCard path={x.path} name={x.name} canEdit={canEdit} open={(rel) => openMachine(rel, x.name)} />}
      <PackSection label="Details" pad>
        <div className="prow">
          <span className="k">Status</span>
          <span className="v">
            <Inline value={x.status} shown={<Pill tone={st.tone === 'none' ? undefined : st.tone}>{st.words}</Pill>} label="Status" kind="choice" options={[...MACHINE_STATUSES]} canEdit={canEdit} onSave={set('machine', x.path, 'status')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Kind</span>
          <span className="v">
            <Inline value={x.kind} label="Kind" kind="choice" options={[...MACHINE_KINDS]} canEdit={canEdit} onSave={set('machine', x.path, 'machine_kind')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">What it does</span>
          <span className="v">
            <Inline value={x.role} label="What it does" placeholder="Add" canEdit={canEdit} onSave={set('machine', x.path, 'role')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">System</span>
          <span className="v">
            <Inline value={x.os} label="System" placeholder="Add" canEdit={canEdit} onSave={set('machine', x.path, 'os')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Where it is</span>
          <span className="v">
            <Inline value={x.location} label="Where it is" placeholder="Add" canEdit={canEdit} onSave={set('machine', x.path, 'location')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Last checked</span>
          <span className="v">
            <Inline value={x.checked ?? ''} shown={x.checked ? dayText(x.checked) : undefined} label="Last checked" kind="date" placeholder="Add" canEdit={canEdit} onSave={set('machine', x.path, 'checked')} />
          </span>
        </div>
      </PackSection>
      <RecordLinks path={x.path} />
    </PackShell>
  );
}

/** Every Systems page and action in the one menu, so nothing is more than a tap away. */
function systemsMenu(m: SystemsView | null, canEdit: boolean): MenuItem[] {
  if (!m) return [];
  const name = packName('systems', 'Systems');
  return [
    { label: name, icon: 'computer', run: () => openModule('systems', 'overview') },
    { label: 'Service map', icon: 'graph', run: () => openModule('systems', 'map') },
    { label: 'Machines', icon: 'server', run: () => openModule('systems', 'machines') },
    { label: 'Services', icon: 'bolt', run: () => openModule('systems', 'services') },
    { label: 'Runbooks', icon: 'task', run: () => openModule('systems', 'runbooks') },
    { label: 'Monitoring', icon: 'chart', run: () => openModule('systems', 'health') },
    { separator: true },
    { label: 'New machine', icon: 'server', disabled: !canEdit, run: () => newMachine() },
    { label: 'New service', icon: 'bolt', disabled: !canEdit, run: () => newService(m) },
    { label: 'New runbook', icon: 'task', disabled: !canEdit, run: () => newRunbook(m) },
    { separator: true },
    { label: 'Show the folder', icon: 'folder', run: () => A.revealInExplorer(m.folder) },
    { separator: true },
    { label: `Show me around ${name}`, icon: 'help', run: () => openTour('systems') },
  ];
}

function ServicePage({ s, m, canEdit }: { s: Service; m: SystemsView; canEdit: boolean }) {
  const href = hrefOf(s.url);
  const dependents = s.dependents.map((p) => m.services.find((x) => x.path === p)!).filter(Boolean);
  return (
    <div className="lr-detail">
      <div className="lr-detail-main">
        {conflictOf(m, 'service', s) && <SystemsConflictCard conflict={conflictOf(m, 'service', s)!} canEdit={canEdit} />}
        {canEdit && s.machinePath && <p className="sys-actions"><button type="button" className="button small" onClick={() => void workDid(call<string>('run-action', s.machinePath, { action: 'restart-service', service: s.name }))}>Restart {s.name}</button></p>}
        <HealthCard rel={s.path} name={s.name} kind="service" status={s.status} health={s.health} canEdit={canEdit} />
        {isRow(s.path) && <NotesCard path={s.path} name={s.name} canEdit={canEdit} open={(rel) => openService(rel, s.name)} />}
        <Card id="links" title="Depends on and needed by">
          <div className="lr-facts">
            <Fact label="Depends on" wide>
              <Inline value={s.dependsOn.map((d) => d.name).join(', ')} label="Depends on" kind="choice" own options={m.services.filter((x) => x.path !== s.path).map((x) => x.name)} placeholder="Add the services it needs" canEdit={canEdit} onSave={set('service', s.path, 'depends_on')} />
            </Fact>
            <Fact label="Needed by" wide>
              {dependents.length ? (
                <span className="lr-chiprow">
                  {dependents.map((d) => (
                    <button key={d.path} type="button" className="lr-filter" onClick={() => openService(d.path, d.name)}>
                      <span className={`lr-dot tone-${statusTone(d.status)}`} /> {d.name}
                    </button>
                  ))}
                </span>
              ) : (
                <span className="lr-faint">Nothing written depends on it.</span>
              )}
            </Fact>
          </div>
        </Card>
        <RecordLinks path={s.path} />
      </div>
      <aside className="lr-detail-side">
        <Card id="details" title="Details">
          <div className="lr-facts">
            <Fact label="Status">
              <Inline value={s.status} shown={<Pill tone={statusTone(s.status) === 'none' ? undefined : statusTone(s.status)}>{s.status}</Pill>} label="Status" kind="choice" options={[...SERVICE_STATUSES]} canEdit={canEdit} onSave={set('service', s.path, 'status')} />
            </Fact>
            <Fact label="Kind">
              <Inline value={s.kind} label="Kind" kind="choice" options={[...SERVICE_KINDS]} canEdit={canEdit} onSave={set('service', s.path, 'service_kind')} />
            </Fact>
            <Fact label="Runs on">
              <Inline value={s.runsOn} shown={s.machinePath ? <span className="lr-linkish">{s.runsOn}</span> : undefined} label="Runs on" kind="choice" options={['', ...m.machines.map((x) => x.name)]} placeholder="Choose" canEdit={canEdit} onSave={set('service', s.path, 'runs_on')} />
            </Fact>
            <Fact label="Port">
              <Inline value={s.port} label="Port" placeholder="Add" canEdit={canEdit} onSave={set('service', s.path, 'port')} className="lr-mono" />
            </Fact>
            <Fact label="Address" wide>
              <span className="lr-link-cell">
                <Inline value={s.url} label="Address" placeholder="Add" canEdit={canEdit} onSave={set('service', s.path, 'url')} className="lr-mono" />
                {href && (
                  <a className="icon-button small" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${hostOf(href)}`} title="Open in your browser">
                    <Icon name="external" size={12} />
                  </a>
                )}
              </span>
            </Fact>
            <Fact label="Runbook">
              <Inline value={s.runbook} label="Runbook" kind="choice" options={['', ...m.runbooks.map((r) => r.name)]} placeholder="Choose" canEdit={canEdit} onSave={set('service', s.path, 'runbook')} />
            </Fact>
            {s.runbookPath && <button type="button" className="text-button" onClick={() => openRunbook(s.runbookPath!, s.runbook)}>Open {s.runbook}</button>}
            <Fact label="Last checked">
              <span>{serviceObserved(s, m.today)}</span>
              <Inline value={s.checked ?? ''} shown={s.checked ? dayText(s.checked) : undefined} label="Last checked" kind="date" placeholder="Add" canEdit={canEdit} onSave={set('service', s.path, 'checked')} />
            </Fact>
          </div>
          {s.machinePath && (
            <button type="button" className="text-button lr-goto" onClick={() => openMachine(s.machinePath!, s.runsOn)}>
              <Icon name="server" size={12} /> {s.runsOn}
            </button>
          )}
        </Card>
        <LoginsCard rel={s.path} name={s.name} credentials={s.credentials} plain={s.plain} canEdit={canEdit} />
      </aside>
    </div>
  );
}

// ── A runbook ────────────────────────────────────────────────────────────────────────────────────────────────────────

function RunbookPage({ r, m, canEdit, running }: { r: Runbook; m: SystemsView; canEdit: boolean; running: boolean }) {
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<string>('Done');
  const [note, setNote] = useState('');
  const runs = [...r.runs].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const all = r.steps.length > 0 && ticked.size === r.steps.length;
  const finish = async () => {
    const ok = await workDid(call<string>('mark-run', r.path, { result, note }));
    if (ok !== null) {
      setTicked(new Set());
      setNote('');
      openRunbook(r.path, r.name);
    }
  };
  return (
    <div className="lr-detail">
      <div className="lr-detail-main">
        {conflictOf(m, 'runbook', r) && <SystemsConflictCard conflict={conflictOf(m, 'runbook', r)!} canEdit={canEdit} />}
        <Card
          id="steps"
          title={running ? 'Running it' : 'Steps'}
          count={r.steps.length}
          actions={
            running ? (
              <button type="button" className="text-button" onClick={() => openRunbook(r.path, r.name)}>
                Stop
              </button>
            ) : r.steps.length ? (
              <button type="button" className="text-button" onClick={() => openRun(r.path, r.name)}>
                <Icon name="play" size={12} /> Run it
              </button>
            ) : undefined
          }
        >
          {running && r.steps.length > 0 && <p className="lr-run-line">{ticked.size === r.steps.length ? 'Every step done.' : `${ticked.size} of ${plural(r.steps.length, 'step')} done. Tick each as you go.`}</p>}
          {!running && isRow(r.path) && r.steps.length > 0 && <p className="vsub">These steps come from the shared pattern{r.for.length ? ` for ${r.for.map((f) => f.name).join(', ')}` : ''}. Changing them makes this runbook its own note.</p>}
          {r.steps.length ? (
            <ol className={`lr-steps${running ? ' is-running' : ''}`}>
              {r.steps.map((st) => (
                <li key={st.index} className={`lr-step${ticked.has(st.index) ? ' is-done' : ''}`}>
                  {running ? (
                    <button type="button" className={`lr-check${ticked.has(st.index) ? ' is-on' : ''}`} role="checkbox" aria-checked={ticked.has(st.index)} aria-label={`Step ${st.index + 1}`} onClick={() => setTicked((t) => (t.has(st.index) ? new Set([...t].filter((x) => x !== st.index)) : new Set([...t, st.index])))}>
                      {ticked.has(st.index) && <Icon name="check" size={11} />}
                    </button>
                  ) : (
                    <span className="lr-step-n">{st.index + 1}</span>
                  )}
                  <span className="lr-step-text">{running ? st.text : <Inline value={st.text} label={`Step ${st.index + 1}`} canEdit={canEdit} onSave={(v) => saved(call('step', r.path, { at: st.index, words: v }))} />}</span>
                  {!running && (
                    <button type="button" className="icon-button small" aria-label={`Take step ${st.index + 1} out`} title="Take it out" disabled={!canEdit} onClick={() => void workDid(call<string>('step', r.path, { remove: st.index }))}>
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="rm-none">No steps yet. Add them one by one below.</p>
          )}
          {!running && <QuickAdd compact placeholder="Add a step and press Enter" canEdit={canEdit} onAdd={(w) => saved(call('step', r.path, { add: w }))} />}
          {running && (
            <div className="lr-run-end">
              <div className="lr-chips" role="group" aria-label="How it went">
                {RUN_RESULTS.map((x) => (
                  <button key={x} type="button" className={`lr-filter${result === x ? ' is-on' : ''}`} aria-pressed={result === x} onClick={() => setResult(x)}>
                    {x}
                  </button>
                ))}
              </div>
              <input className="lr-run-note" type="text" value={note} placeholder="A note about this run (optional)" aria-label="A note about this run" onChange={(e) => setNote(e.target.value)} />
              <button type="button" className="button primary" disabled={!canEdit} onClick={() => void finish()}>
                <Icon name="check" size={13} /> {all ? 'Mark it run' : 'Mark it run anyway'}
              </button>
            </div>
          )}
        </Card>
        <Card id="runs" title="Runs" count={r.runs.length}>
          {runs.length ? (
            <ul className="lr-health">
              {runs.slice(0, 12).map((x) => (
                <li key={x.row} className="lr-health-row">
                  <span className="lr-health-date">{x.date ? dayText(x.date) : 'No date'}</span>
                  {x.result ? <Pill tone={/fail/i.test(x.result) ? 'bad' : /problem/i.test(x.result) ? 'warn' : 'ok'}>{x.result}</Pill> : <span />}
                  <span className="lr-health-note">{x.note}</span>
                  <span />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rm-none">Not run yet. Run it to keep a record of each time.</p>
          )}
        </Card>
        <RecordLinks path={r.path} />
      </div>
      <aside className="lr-detail-side">
        <Card id="details" title="Details">
          <div className="lr-facts">
            <Fact label="For" wide>
              <Inline value={r.for.map((f) => f.name).join(', ')} label="For" kind="choice" own options={[...m.machines.map((x) => x.name), ...m.services.map((x) => x.name)]} placeholder="Add what it is for" canEdit={canEdit} onSave={set('runbook', r.path, 'for_what')} />
            </Fact>
            <Fact label="How often">
              <Inline value={r.every} label="How often" kind="choice" options={[...RUNBOOK_EVERY]} canEdit={canEdit} onSave={set('runbook', r.path, 'every')} />
            </Fact>
            <Fact label="Last run">
              <Inline value={r.lastRun ?? ''} shown={r.lastRun ? dayText(r.lastRun) : undefined} label="Last run" kind="date" placeholder="Never" canEdit={canEdit} onSave={set('runbook', r.path, 'last_run')} />
            </Fact>
            <Fact label="Next due">{r.nextDue ? <span className={r.days! < 0 ? 'lr-late' : ''}>{`${dayText(r.nextDue)} · ${inDays(r.nextDue, m.today)}`}</span> : <span className="lr-faint">When needed</span>}</Fact>
          </div>
        </Card>
        {isRow(r.path) && <NotesCard path={r.path} name={r.name} canEdit={canEdit} open={(rel) => openRunbook(rel, r.name)} />}
      </aside>
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function SystemsPage({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const modules = useModules();
  const sections = SYSTEMS.sections.filter((s) => (s.id !== 'runbooks' || partOn(modules, 'systems', 'runbooks')) && (s.id !== 'health' || partOn(modules, 'systems', 'monitoring')));
  const { section, detail } = placeOf(tab, SYSTEMS, sections);
  const { data: m, error } = useWork<SystemsView>('systems');
  const records = useMemo(() => (m ? systemRecords(m) : []), [m]);
  const ctx = useWorkCtx('systems', records, {
    editable: (r) => SYSTEM_EDITABLE[r.kind] ?? [],
    open: (r) => {
      if (!r.path) return;
      if (r.kind === 'machine') return openMachine(r.path, r.title);
      if (r.kind === 'service') return openService(r.path, r.title);
      if (r.kind === 'runbook') return openRunbook(r.path, r.title);
      const isMachine = m?.machines.some((x) => x.path === r.path);
      return isMachine ? openMachine(r.path, r.title) : openService(r.path, r.title);
    },
    removeRecord: (r) => {
      if (!r.path) return;
      if (r.kind === 'machine' || r.kind === 'service' || r.kind === 'runbook') return removeRecord(r.kind, r.path);
      void A.trashPath(r.path).catch(showError);
    },
  });
  const machine = detail?.kind === 'machine' && m ? m.machines.find((x) => x.path === detail.key || x.rowPath === detail.key) : undefined;
  const service = detail?.kind === 'service' && m ? m.services.find((x) => x.path === detail.key || x.rowPath === detail.key) : undefined;
  const runbook = (detail?.kind === 'runbook' || detail?.kind === 'run') && m ? m.runbooks.find((x) => x.path === detail.key || x.rowPath === detail.key) : undefined;
  const info = sections.find((s) => s.id === section) ?? SYSTEMS.sections[0];
  const add = section === 'services' ? { label: 'New service', run: () => newService(m) } : section === 'runbooks' ? { label: 'New runbook', run: () => newRunbook(m) } : section === 'health' ? null : { label: 'New machine', run: () => newMachine() };
  const empty = m && !m.machines.length && !m.services.length && !m.runbooks.length;
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
        machine ? (
          <MachinePage x={machine} m={m} canEdit={canEdit} />
        ) : service ? (
          <PackShell
            glyph="▣"
            tint="slate"
            title={service.name}
            sub={[service.kind, service.runsOn && `on ${service.runsOn}`, service.port && `port ${service.port}`].filter(Boolean).join(' · ')}
            {...(isRow(service.path) ? {} : { sharePath: service.path })}
            menu={() => [
              { label: packName('systems', 'Systems'), icon: 'computer', run: () => openModule('systems', 'overview') },
              { label: 'Service map', icon: 'graph', run: () => openModule('systems', 'map') },
              { separator: true },
              { label: isRow(service.path) ? 'Open its list' : 'Open its note', icon: 'notes', run: () => openNoteOrList(service.path) },
              { separator: true },
              { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => removeRecord('service', service.path) },
            ]}
          >
            <ServicePage s={service} m={m} canEdit={canEdit} />
          </PackShell>
        ) : runbook ? (
          <PackShell
            glyph="▣"
            tint="slate"
            title={runbook.name}
            sub={[runbook.every, runbook.for.map((f) => f.name).join(', '), plural(runbook.steps.length, 'step')].filter(Boolean).join(' · ')}
            {...(isRow(runbook.path) ? {} : { sharePath: runbook.path })}
            menu={() => [
              { label: packName('systems', 'Systems'), icon: 'computer', run: () => openModule('systems', 'overview') },
              { label: 'Runbooks', icon: 'task', run: () => openModule('systems', 'runbooks') },
              { separator: true },
              { label: isRow(runbook.path) ? 'Open its list' : 'Open its note', icon: 'notes', run: () => openNoteOrList(runbook.path) },
              { separator: true },
              { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => removeRecord('runbook', runbook.path) },
            ]}
          >
            <RunbookPage key={`${runbook.path}:${detail.kind}`} r={runbook} m={m} canEdit={canEdit} running={detail.kind === 'run'} />
          </PackShell>
        ) : (
          <PackShell glyph="▣" tint="slate" title="That isn’t here any more" sub="It may have been renamed, moved or taken out." menu={() => systemsMenu(m, canEdit)}>
            <p>
              <button type="button" className="btn" onClick={() => openModule('systems', 'map')}>
                Service map
              </button>
            </p>
          </PackShell>
        )
      ) : empty && section === 'overview' ? (
        <PackShell glyph="▣" tint="slate" title={packName('systems', 'Systems')} sub="Servers, PCs and services as a map, with runbooks and logins." menu={() => systemsMenu(m, canEdit)}>
          <EmptyState icon="computer" title="Your machines and services, on one map" line="Add a server, NAS or PC, then the services on it. Write runbooks for the jobs you do now and then, and keep every login in Secrets with only a locked link here." action={{ label: 'Add your first machine', icon: 'plus', run: () => newMachine(), disabled: !canEdit }} also={{ label: 'Add a service', icon: 'bolt', run: () => newService(m), disabled: !canEdit }} />
        </PackShell>
      ) : section === 'overview' ? (
        <Overview m={m} canEdit={canEdit} />
      ) : (
        <PackShell
          glyph="▣"
          tint="slate"
          title={info.label}
          sub={info.line}
          actions={add ? <button type="button" className="btn pri" disabled={!canEdit} onClick={add.run}>+ {add.label}</button> : undefined}
          menu={() => systemsMenu(m, canEdit)}
        >
          {section === 'map' ? (
            <ServiceMap m={m} canEdit={canEdit} />
          ) : section === 'runbooks' ? (
            <Card id="runbooks" title="Runbooks" count={m.runbooks.length}>
              {m.runbooks.length ? (
                <ul className="rm-rows">
                  {m.runbooks.map((r) => (
                    <RunbookRow key={r.path} r={r} today={m.today} />
                  ))}
                </ul>
              ) : (
                <p className="rm-none">No runbooks yet. Write the steps for an update, a restore or a restart.</p>
              )}
            </Card>
          ) : (
            <WorkViews module="systems" section={section} made={systemSectionViews(section)} records={records} />
          )}
        </PackShell>
      )}
    </WithRecords>
  );
}

// ── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function SystemsToday() {
  const modules = useModules();
  const monitoring = partOn(modules, 'systems', 'monitoring');
  const runbooksOn = partOn(modules, 'systems', 'runbooks');
  const { data: m } = useWork<SystemsView>('systems', 'model', [], monitoring || runbooksOn);
  if (!m) return null;
  const trouble = monitoring ? m.trouble.filter((t) => /^(down|degraded)$/i.test(t.status)) : [];
  const alerts = monitoring ? alertsOf(m).filter((a) => !a.key.startsWith('down:')) : [];
  // Waiting updates say the same thing per machine, so they fold into one row naming every machine
  // (8 Nov 2026, calm list); each machine still opens from Systems. Other alerts keep their rows.
  const updates = alerts.filter((a) => a.key.startsWith('updates:'));
  const rest = alerts.filter((a) => !a.key.startsWith('updates:'));
  const due = runbooksOn ? m.runbooksDue.filter((r) => r.days !== null && r.days <= 0) : [];
  if (!trouble.length && !alerts.length && !due.length && !m.plain.length) return null;
  return (
    <section className="td-section rm-today lr-systems-today" data-section="systems" aria-labelledby="td-h-systems">
      <header className="td-section-head">
        <h2 id="td-h-systems">
          Systems
          <span className="td-count">{trouble.length + (updates.length ? 1 : 0) + rest.length + due.length + m.plain.length}</span>
        </h2>
        <button type="button" className="td-section-link" onClick={() => openModule('systems')}>
          <Icon name="computer" size={13} /> Systems
        </button>
      </header>
      <ul className="rm-today-rows">
        {trouble.map((t) => (
          <li key={t.path} className={`rm-today-row${t.status === 'Down' ? ' is-late' : ' is-change'}`}>
            <button type="button" className="rm-today-main" onClick={() => (t.kind === 'machine' ? openMachine(t.path, t.name) : openService(t.path, t.name))}>
              <span className="rm-today-name">
                {t.name} is {t.status.toLowerCase()}
              </span>
              <span className="rm-today-sub">{[t.kind === 'machine' ? 'Machine' : 'Service', t.note].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
        {updates.length > 0 && (
          <li className="rm-today-row is-change">
            <button type="button" className="rm-today-main" onClick={() => openModule('systems')} title="Open Systems">
              <span className="rm-today-name">Security updates have waited over a week on {joinNames(updates.map((a) => a.name))}</span>
              <span className="rm-today-sub">Next step: install the updates on each machine</span>
            </button>
          </li>
        )}
        {rest.map((a) => (
          <li key={a.key} className="rm-today-row is-change">
            <button type="button" className="rm-today-main" onClick={() => openMachine(a.kind === 'machine' ? a.path : (m.services.find((s) => s.path === a.path)?.machinePath ?? a.path), a.title)}>
              <span className="rm-today-name">{a.title}</span>
              <span className="rm-today-sub">Next step: {a.nextStep}</span>
            </button>
          </li>
        ))}
        {due.map((r) => (
          <li key={r.path} className="rm-today-row is-change">
            <button type="button" className="rm-today-main" onClick={() => openRun(r.path, r.name)}>
              <span className="rm-today-name">Time to run {r.name}</span>
              <span className="rm-today-sub">{[r.every, r.lastRun ? `last run ${dayText(r.lastRun)}` : 'never run yet'].join(' · ')}</span>
            </button>
          </li>
        ))}
        {m.plain.map((p) => (
          <li key={p.path} className="rm-today-row is-late">
            <button type="button" className="rm-today-main" onClick={() => (m.machines.some((x) => x.path === p.path) ? openMachine(p.path, p.name) : openService(p.path, p.name))}>
              <span className="rm-today-name">A password is written in {p.name}</span>
              <span className="rm-today-sub">Move it to Secrets and keep a locked link instead.</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Check now (26 Oct 2026): the machine read over SSH with its own login; its system, status, a health line and what runs
 *  on it filled in by Ironleaf (src/main/life-records/systems.ts checkMachine). A person asked, so what it finds is
 *  still added, as rows in the lists, saying how many first when more than a few, with one Undo taking them back out. */
function CheckNow({ x }: { x: Machine }) {
  const [busy, setBusy] = useState(false);
  const ready = !!x.address && x.credentials.length > 0;
  return (
    <button
      type="button"
      className="btn"
      disabled={busy || !ready}
      title={ready ? `Sign in to ${x.name} and read what runs on it` : 'Needs its address and a linked login'}
      onClick={() => {
        setBusy(true);
        void didMake(call<{ words: string; created: string[] }>('check', x.path)).finally(() => setBusy(false));
      }}
    >
      <Icon name="refresh" size={12} /> {busy ? 'Checking…' : 'Check now'}
    </button>
  );
}

/** What the beat found but never made (5 Nov 2026): quiet, one line per machine, Add them or Not now. Nothing else
 *  speaks up about them: no Today, no bell. One OK takes every found service and runbook at once, with one Undo. */
function FoundList({ found, canEdit }: { found: FoundGroup[]; canEdit: boolean }) {
  if (!found.length) return null;
  const line = (g: FoundGroup): string => {
    const bits: string[] = [];
    if (g.services.length) bits.push(`${g.services.length} new service${g.services.length === 1 ? '' : 's'}`);
    if (g.runbooks?.length) bits.push(`${g.runbooks.length} runbook${g.runbooks.length === 1 ? '' : 's'} it needs`);
    return `Found ${bits.join(' and ')} on ${g.machineName}`;
  };
  return (
    <PackSection label="Found on your machines">
      {found.map((g) => (
        <div key={g.machinePath} className="trow">
          <span className="t">{line(g)}</span>
          <span className="end">
            <button type="button" className="btn" style={{ height: 28 }} disabled={!canEdit} onClick={() => void didMake(call<{ words: string; created: string[] }>('found-add', g.machinePath))}>
              {g.services.length + (g.runbooks?.length ?? 0) === 1 ? 'Add it' : 'Add them'}
            </button>
            <button type="button" className="btn quiet" style={{ height: 28 }} disabled={!canEdit} onClick={() => void workDid(call<string>('found-dismiss', g.machinePath))}>
              Not now
            </button>
          </span>
        </div>
      ))}
      {found.length > 1 && (
        <p className="sys-actions">
          <button type="button" className="button small" disabled={!canEdit} onClick={() => void didMake(call<{ words: string; created: string[] }>('found-add-all'))}>
            Add everything from every machine
          </button>
        </p>
      )}
    </PackSection>
  );
}

/** The one-time tidy-up (records as data, 5 Nov 2026): offered once and calmly, a preview in plain words, one button,
 *  and one Undo. Never runs by itself; carries on where it stopped when the app died part way. */
function MoveCard({ m, canEdit }: { m: SystemsView; canEdit: boolean }) {
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const move = m.move;
  if (!move) return null;
  const loadPreview = () => {
    setBusy(true);
    void call<MovePreview>('move-preview').then(
      (p) => setPreview(p),
      (err) => showError(err),
    ).finally(() => setBusy(false));
  };
  const run = () => {
    setBusy(true);
    void call<string>('move-run').then(
      (words) => {
        moduleChanged();
        setPreview(null);
        toast(words, { label: 'Undo', run: () => void workDid(call<string>('move-undo')) }, 12000);
      },
      (err) => showError(err),
    ).finally(() => setBusy(false));
  };
  if (move.interrupted) {
    // Whatever stopped it, in plain words (kept in the receipt), with Carry on beside it.
    const why = move.stoppedWords?.length ? move.stoppedWords.join(' ') : 'Nothing is half done: carry on, or put back what moved so far.';
    return (
      <PackSection label="Tidying up">
        <p className="vsub">The tidy-up did not finish. {why}</p>
        <p className="sys-actions">
          <button type="button" className="button small primary" disabled={!canEdit || busy} onClick={() => void workDid(call<string>('move-resume'))}>
            Carry on
          </button>
          <button type="button" className="button small" disabled={!canEdit || busy} onClick={() => void workDid(call<string>('move-undo'))}>
            Put back
          </button>
        </p>
      </PackSection>
    );
  }
  if (move.done) {
    return (
      <PackSection label="Tidying up">
        <p className="vsub">
          Folded {move.done.folded} {move.done.folded === 1 ? 'note' : 'notes'} your checks made into the lists.
          {move.undoable && canEdit ? (
            <>
              {' '}
              <button type="button" className="text-button" onClick={() => void workDid(call<string>('move-undo'))}>
                Put them back
              </button>
            </>
          ) : null}
        </p>
      </PackSection>
    );
  }
  if (preview) {
    const blocked = preview.pcsBlock ?? (preview.clash ? { names: [], words: preview.clash } : null);
    return (
      <PackSection label="Tidying up">
        {preview.words.map((w, i) => (
          <p key={i} className="vsub">{w}</p>
        ))}
        {blocked && <p className="rm-failed">{blocked.words}</p>}
        <div className="sys-move-lists">
          {!!preview.stay.length && (
            <div className="sys-move-group">
              <div className="glabel">Stay as notes ({preview.stay.length})</div>
              <ul className="sys-move-names">
                {preview.stay.map((s) => (
                  <li key={s.rel}>
                    <span className="t">{s.name}</span> <span className="meta">{s.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!preview.fold.length && (
            <div className="sys-move-group">
              <div className="glabel">Fold into the lists ({preview.fold.length})</div>
              <ul className="sys-move-names">
                {preview.fold.map((s) => (
                  <li key={s.rel}>
                    <span className="t">{s.name}</span> <span className="meta">{s.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <p className="sys-actions">
          {!blocked && preview.fold.length > 0 && (
            <button type="button" className="button small primary" disabled={!canEdit || busy} onClick={run}>
              {busy ? 'Folding…' : 'Fold them into the lists'}
            </button>
          )}
          <button type="button" className="button small" disabled={busy} onClick={() => setPreview(null)}>
            Back
          </button>
        </p>
      </PackSection>
    );
  }
  if (move.offer) {
    return (
      <PackSection label="Tidying up">
        <p className="vsub">
          Your checks made {move.counts.fold} {move.counts.fold === 1 ? 'note' : 'notes'}. Fold them into three lists you can read, and keep the {move.counts.stay} with your words as notes?
        </p>
        <p className="sys-actions">
          <button type="button" className="button small" disabled={!canEdit || busy} onClick={loadPreview}>
            {busy ? 'Looking…' : 'See what would change'}
          </button>
          <button type="button" className="button small" disabled={!canEdit || busy} onClick={() => void workDid(call<string>('move-defer'))}>
            Not now
          </button>
        </p>
      </PackSection>
    );
  }
  if (move.deferred && move.counts.fold > 0) {
    return (
      <p className="vsub">
        <button type="button" className="text-button" disabled={!canEdit || busy} onClick={loadPreview}>
          Fold check-made notes into the lists
        </button>
      </p>
    );
  }
  return null;
}
