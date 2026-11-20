// Settings › Capture: Quick capture's Windows-wide keys (src/main/capture.ts), where captures without a project go, and
// whether pictures go to the assets.

import { useEffect, useState } from 'react';
import { acceleratorOf, DEFAULT_CAPTURE_KEY, keyWords, type CaptureStatus } from '../../../shared/capture';
import { codeWords } from '../../../shared/clipper';
import type { Prefs } from '../../../shared/prefs';
import type { ClipperStatus } from '../../../main/clipper';
import { comboFromEvent } from '../lib/hotkeys';
import { CaptureFlowsSettings } from './CaptureFlowsSettings';
import { Icon } from './Icon';
import { Row, Segmented, Toggle } from './Settings';

export function CaptureSettings({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [recording, setRecording] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // How the key stands, again after each change (the main side holds it once the change is saved).
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => void window.nv.capture.status().then((s) => live && setStatus(s)), 150);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [prefs.captureKey]);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) return setRecording(false);
      const combo = comboFromEvent(e);
      if (!combo) return;
      const key = acceleratorOf(combo);
      if (!key) {
        setSaid('Use Ctrl, Alt or the Windows key with another key, so typing never opens it.');
        return;
      }
      setSaid(null);
      setRecording(false);
      set({ captureKey: key });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, set]);
  const on = !!prefs.captureKey;
  const tone = status?.state === 'ready' ? 'ok' : status && status.state !== 'off' ? 'warn' : '';
  return (
    <>
      <h3>Opening it</h3>
      <Row title="Quick capture" hint="A small box over whatever you’re doing: note something down, add a next step to a project, or take a screenshot, without leaving what you’re in.">
        <Toggle label="Quick capture" value={on} onChange={(v) => set({ captureKey: v ? DEFAULT_CAPTURE_KEY : '' })} />
      </Row>
      {on && (
        <Row
          title="Keys"
          hint={
            <>
              {status && <span className={`capture-status ${tone}`}>{status.words}</span>}
              {said && <span className="capture-status warn">{said}</span>}
            </>
          }
        >
          <div className="field-row">
            {recording ? (
              <span className="keys-recording">Press the keys… (Esc to stop)</span>
            ) : (
              <button className="keys-combo" title="Change" onClick={() => setRecording(true)}>
                <kbd>{keyWords(prefs.captureKey)}</kbd>
              </button>
            )}
            {prefs.captureKey !== DEFAULT_CAPTURE_KEY && !recording && (
              <button className="icon-button small" title={`Back to ${keyWords(DEFAULT_CAPTURE_KEY)}`} onClick={() => set({ captureKey: DEFAULT_CAPTURE_KEY })}>
                <Icon name="undo" size={13} />
              </button>
            )}
            <button className="button" onClick={() => void window.nv.capture.show()}>
              Try it
            </button>
          </div>
        </Row>
      )}
      <h3>Where captures go</h3>
      <Row title="With no project" hint="A note or a task filed under No project goes here, under “Captured”. The Inbox is where everything waiting to be filed is sorted, in one place.">
        <Segmented value={prefs.captureNoProject} options={[{ id: 'inbox', label: 'The Inbox' }, { id: 'daily', label: 'Today’s note' }]} onChange={(captureNoProject) => set({ captureNoProject, captureNoProjectChosen: true })} />
      </Row>
      <Row title="Pictures and files" hint="Off: with a note, beside it in the project’s notes; on their own, in the project’s folder on this PC › Captures. On: in your assets. The box’s Save to assets remembers your last choice.">
        <Toggle label="Save to assets" value={prefs.captureToAssets} onChange={(captureToAssets) => set({ captureToAssets })} />
      </Row>
      {/* "Capture to…" a project's log, the Inbox or a note (21 Oct 2026, gap G27). */}
      <CaptureFlowsSettings prefs={prefs} set={set} />
      <ClipperSettings prefs={prefs} set={set} />
    </>
  );
}

/** Settings › Quick add › Web clipper (8.8): the browser extension's pairing code, on or off, and its folder. */
function ClipperSettings({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const [status, setStatus] = useState<ClipperStatus | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    void window.nv.clipper.status().then((s) => live && setStatus(s), () => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [prefs.clipperEnabled]);
  const on = prefs.clipperEnabled !== false;
  const flip = async (next: boolean) => {
    set({ clipperEnabled: next });
    try {
      setStatus(await window.nv.clipper.set(next));
    } catch {
      // The toggle stands: the status arrives with the next look.
    }
  };
  const copy = async () => {
    if (!status?.code) return;
    try {
      await navigator.clipboard.writeText(status.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Left selected below instead.
    }
  };
  const pairedWords = !status ? '' : status.paired === 0 ? 'No browser paired yet.' : status.paired === 1 ? '1 browser paired.' : `${status.paired} browsers paired.`;
  return (
    <>
      <h3>Web clipper</h3>
      <Row title="Web clipper" hint="Clip pages from Chrome or Edge into your notes: articles, selections, bookmarks and screenshots. It talks only to this PC.">
        <Toggle label="Web clipper" value={on} onChange={(v) => void flip(v)} />
      </Row>
      {on && (
        <>
          <Row title="Pairing code" hint={`Enter it in the extension once. ${pairedWords}`}>
            <div className="field-row">
              <span className="keys-combo" aria-label="Pairing code">
                <kbd>{status ? codeWords(status.code) : '…'}</kbd>
              </span>
              <button className="button" style={{ height: 32 }} disabled={!status?.code} onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </Row>
          <Row title="Get the extension" hint="In Chrome or Edge, load the clipper folder unpacked (Show the folder finds it).">
            <button className="button" style={{ height: 32 }} onClick={() => void window.nv.clipper.reveal()}>
              Show the folder
            </button>
          </Row>
        </>
      )}
    </>
  );
}
