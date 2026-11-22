// Settings › About and updates (20 Nov 2026). One page: the app's mark, name, the installed version with its release
// date and channel; the update card with one primary button that follows the update (Check for updates → Checking… →
// up to date / available with its notes → progress in MB → Restart to update → Updated to X), errors in plain words
// with Try again and the website; the two switches; What's new in this version; and every release, newest first, each
// opening to its notes, with the full history on the website. The words for each stage are lib/aboutStatus.ts; the
// history is CHANGELOG.md merged with the website's versions.json (aboutState.ts). Its own stylesheet.
import { useEffect, useRef, useState } from 'react';
import markUrl from '../../assets/ironleaf-mark-tile.svg?url&no-inline';
import { Row, Toggle } from '../Settings';
import { Icon } from '../Icon';
import { ago, longDate, updateCard, type CardAction } from '../../lib/aboutStatus';
import { channelOf, entryFor, noteLines, type ReleaseEntry } from '../../../../shared/version-history';
import { takeAboutRequest, takeState, useAboutRequestTick, useUpdateState, useVersionHistory } from './aboutState';
import '../../styles/about.css';
import { SupporterMark } from '../account/SupporterBadge';

type Info = { version: string; packaged: boolean; platform: string; historyPage: string };
const HISTORY_PAGE = 'https://ironleaf.kaitiaki-it.com/download/#history';
const SITE = 'https://ironleaf.kaitiaki-it.com';

function Notes({ notes, className }: { notes: string; className?: string }) {
  const lines = noteLines(notes);
  if (!lines.length) return null;
  return (
    <ul className={`about-notes${className ? ' ' + className : ''}`}>
      {lines.map((l, i) => (l.heading ? <li key={i} className="about-notes-head">{l.text}</li> : <li key={i}>{l.text}</li>))}
    </ul>
  );
}

function openLink(url: string): void {
  window.open(url, '_blank', 'noopener');
}

function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function UpdateCardView({ info, autoCheck }: { info: Info | null; autoCheck: number }) {
  const state = useUpdateState();
  const now = useNow();
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const api = window.nvUpdate;
  const check = () => {
    if (!api || checking) return;
    const before = state?.checkedAt ?? null;
    setChecking(true);
    setCheckFailed(false);
    const started = Date.now();
    void api.check().then(
      (s) => {
        // A check answers in a moment; the words stay up long enough to be read as a check.
        window.setTimeout(() => {
          takeState(s);
          setChecking(false);
          setCheckFailed(!s.checkedAt || s.checkedAt === before);
        }, Math.max(0, 600 - (Date.now() - started)));
      },
      () => {
        setChecking(false);
        setCheckFailed(true);
      },
    );
  };
  // Asked for with a check (the tray, Help › Check for updates…, the palette): it starts as the page opens.
  useEffect(() => {
    if (autoCheck) check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck]);
  const run = (action: CardAction) => {
    if (!api) return action === 'website' ? openLink(`${SITE}/download/`) : undefined;
    if (action === 'check') return check();
    if (action === 'none') return;
    setBusy(true);
    const p = action === 'download' ? api.download() : action === 'install' ? api.install() : api.openPage().then(() => null);
    void p.then(
      (s) => {
        if (s) takeState(s);
        setBusy(false);
      },
      () => setBusy(false),
    );
  };
  const card = updateCard(api ? state : null, { checking, checkFailed, now });
  if (api && !state) return <section className="about-update" data-tone="idle" aria-busy="true" />;
  return (
    <section className="about-update" data-tone={card.tone} data-stage={card.stage} aria-live="polite">
      <div className="about-update-main">
        <span className="about-update-icon" aria-hidden="true">
          <Icon name={card.tone === 'error' ? 'warning' : card.tone === 'ok' ? 'check' : card.tone === 'busy' ? 'refresh' : card.tone === 'news' || card.tone === 'ready' ? 'download' : 'refresh'} size={18} />
        </span>
        <div className="about-update-words">
          <div className="about-update-title">{card.title}</div>
          <div className="about-update-detail">{card.detail}</div>
        </div>
        <div className="about-update-actions">
          {card.secondary && (
            <button type="button" className="button" disabled={busy} onClick={() => run(card.secondary!.action)}>
              {card.secondary.label}
            </button>
          )}
          {card.primary && (
            <button type="button" className={`button${card.primary.action === 'check' ? '' : ' primary'}`} disabled={busy || card.primary.disabled} onClick={() => run(card.primary!.action)}>
              {card.primary.label}
            </button>
          )}
        </div>
      </div>
      {card.progress !== null && (
        <div className="about-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={card.progress} aria-label="Download progress">
          <div style={{ width: `${card.progress}%` }} />
        </div>
      )}
      {card.notes && card.notesVersion !== state?.current && (
        <div className="about-update-notes">
          <div className="about-eyebrow">What’s new in {card.notesVersion}</div>
          <Notes notes={card.notes} />
        </div>
      )}
      {state && info?.packaged === false && <div className="about-update-foot">A development build: it checks only when it is given a stand-in site.</div>}
      {state && (
        <div className="about-switches">
          <Row title="Check for updates automatically" hint={state.enabled ? `Once a day${state.checkedAt ? `, last ${ago(state.checkedAt, now)}` : ''}. Nothing about you or your notes is sent.` : 'Off: Ironleaf only checks when you ask.'}>
            <Toggle value={state.enabled} label="Check for updates automatically" onChange={(on) => void api!.setEnabled(on).then(takeState)} />
          </Row>
          <Row title="Download updates automatically" hint={state.autoDownload ? 'A new version downloads in the background; you choose when to restart.' : 'Off: a new version downloads when you click Update now.'}>
            <Toggle value={state.autoDownload} label="Download updates automatically" onChange={(on) => void api!.setAutoDownload(on).then(takeState)} />
          </Row>
        </div>
      )}
    </section>
  );
}

function HistoryRow({ e, current, open, onToggle }: { e: ReleaseEntry; current: string; open: boolean; onToggle(): void }) {
  const lines = noteLines(e.notes);
  const first = lines.find((l) => !l.heading)?.text ?? '';
  return (
    <li className={`about-hist${open ? ' open' : ''}`}>
      <button type="button" className="about-hist-head" aria-expanded={open} onClick={onToggle} disabled={!lines.length}>
        <span className="about-hist-ver">{e.version}</span>
        {e.version === current && <span className="about-chip">Installed</span>}
        <span className="about-hist-date">{longDate(e.date)}</span>
        <span className="about-hist-first" title={open ? undefined : first}>{open ? '' : first}</span>
        {lines.length > 0 && <Icon name={open ? 'chevronDown' : 'chevron'} size={13} />}
      </button>
      {open && <Notes notes={e.notes} className="about-hist-notes" />}
    </li>
  );
}

export function AboutPage() {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    void window.nvUpdate?.about?.().then(setInfo, () => {});
  }, []);
  const state = useUpdateState();
  const { list, online } = useVersionHistory();
  const version = info?.version ?? state?.current ?? '';
  const mine = entryFor(list, version);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const whatsNew = useRef<HTMLElement>(null);
  const tick = useAboutRequestTick();
  const [autoCheck, setAutoCheck] = useState(0);
  useEffect(() => {
    const req = takeAboutRequest();
    if (!req) return;
    if (req.check) setAutoCheck(Date.now());
    if (req.focus === 'whats-new') window.setTimeout(() => whatsNew.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
  }, [tick]);
  const shown = showAll ? list : list.slice(0, 6);
  return (
    <div className="about-page">
      <header className="about-hero">
        <img className="about-mark" src={markUrl} width={56} height={56} alt="" />
        <div className="about-id">
          <div className="about-name">Ironleaf <SupporterMark link /></div>
          <div className="about-ver">
            <span>Version {version || '…'}</span>
            {mine?.date && <span>Released {longDate(mine.date)}</span>}
            {info && <span>{channelOf(version, info.packaged)}</span>}
          </div>
          <div className="about-sub">Plain Markdown notes on your PC. Formerly NeuralVault.</div>
        </div>
        <div className="about-links">
          <button type="button" className="link-button" onClick={() => openLink(SITE)}>
            Website <Icon name="external" size={12} />
          </button>
        </div>
      </header>
      <div className="about-col">
        <UpdateCardView info={info} autoCheck={autoCheck} />
        <section className="about-section" ref={whatsNew} data-setting="What’s new in this version">
          <h3>What’s new in {version || 'this version'}</h3>
          {mine?.notes ? <Notes notes={mine.notes} /> : <p className="about-quiet">No notes were written for this version.</p>}
        </section>
      </div>
      <section className="about-section about-history" data-setting="Version history">
        <div className="about-history-head">
          <h3>Version history</h3>
          <button type="button" className="link-button" onClick={() => openLink(info?.historyPage ?? HISTORY_PAGE)}>
            Full history on the website <Icon name="external" size={12} />
          </button>
        </div>
        <ul className="about-hist-list">
          {shown.map((e) => (
            <HistoryRow key={e.version} e={e} current={version} open={!!openRows[e.version]} onToggle={() => setOpenRows((o) => ({ ...o, [e.version]: !o[e.version] }))} />
          ))}
        </ul>
        <div className="about-history-foot">
          {list.length > shown.length && (
            <button type="button" className="link-button" onClick={() => setShowAll(true)}>
              Show all {list.length} versions
            </button>
          )}
          <span className="about-quiet">{online ? 'Includes releases listed on ironleaf.kaitiaki-it.com.' : 'The history this copy was built with.'}</span>
        </div>
      </section>
    </div>
  );
}
