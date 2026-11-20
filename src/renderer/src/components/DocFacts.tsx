// A document's facts at the top of its page (t239, 12 Nov 2026): what it is, its version and whether it is the
// latest, its status and who signed it when, with its earlier versions one click down: "Contract · v2, latest ·
// Signed by June Park on 3 Oct" with "Earlier versions (1)". Setting the status or adding a new version takes one
// click here. Plain documents (nothing carried) show nothing — shown only when asked for document kinds.

import { useEffect, useMemo, useState } from 'react';
import { DOC_STATUSES, NEXT_STATUS, STATUS_WORDS, docChain, docStatusWords, docVersionWords, hasDocFacts, readDocFacts, type DocChain, type DocNode, type DocStatus } from '../../../shared/doc-versions';
import { isoDay, readDay as parseDay } from '../../../shared/days';
import { readProps } from '../../../shared/frontmatter';
import { setNoteProp } from '../../../shared/views';
import { fileChainNodes, noteChainNodes } from '../lib/docNodes';
import { readDate, shortDate } from '../lib/projectLook';
import * as A from '../state/actions';
import { form, prompt } from './Dialogs';
import { openMenu } from './Menu';
import { getState, showError, useApp } from '../state/store';

const whenWords = (iso: string): string => {
  if (!iso.trim()) return '';
  const ms = readDate(iso);
  // A date the vault can't read shows as written, never as nothing.
  return ms === null ? iso.trim() : shortDate(ms);
};

export function DocFacts({ kind, chain, canEdit, showWhenPlain = false, onStatus, onSigned, onSigner, onNewVersion, onOpenVersion }: {
  /** What it is ("Contract", "Doc", "Quote"). */
  kind: string;
  chain: DocChain;
  canEdit: boolean;
  /** Document kinds show the line even while plain, so the status is one click away. */
  showWhenPlain?: boolean;
  /** The status chosen (draft, sent, or cleared). */
  onStatus(next: DocStatus | null): void;
  /** Signed chosen, with who signed it and when (asked here, written by the caller in one write). */
  onSigned(signer: string, signedOn: string): void;
  /** Who signed it is asked for (the caller prompts). */
  onSigner(): void;
  onNewVersion(): void;
  /** An earlier version opened (a file's carries the project listing it; middle-click opens it beside). */
  onOpenVersion(path: string, project: string | undefined, newTab: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const facts = chain.facts;
  if (!hasDocFacts(facts) && !showWhenPlain) return null;
  const next = NEXT_STATUS[facts.status ?? ''] ?? 'draft';
  const status = docStatusWords(facts, whenWords(facts.signedOn));
  /** The status's choices shown, never flipped unseen (t248, 12 Nov 2026, look N5): Draft, Sent, Signed,
   *  and clearing it. Choosing Signed asks who signed it and when. */
  const chooseStatus = (anchor: HTMLElement) => {
    openMenu(anchor, [
      { heading: 'Status' },
      ...DOC_STATUSES.map((s) => ({ label: STATUS_WORDS[s], checked: facts.status === s, run: () => void pickStatus(s) })),
      ...(facts.status ? [{ separator: true } as const, { label: 'Clear the status', icon: 'close' as const, run: () => onStatus(null) }] : []),
    ]);
  };
  const pickStatus = async (picked: DocStatus) => {
    if (picked !== 'signed') {
      if (picked === facts.status) return;
      onStatus(picked);
      return;
    }
    const said = await form('Who signed it?', {
      fields: [
        { id: 'signer', label: 'Who signed it', value: facts.signer, placeholder: 'For example: June Park' },
        { id: 'when', label: 'When', value: facts.signedOn || isoDay(new Date()), placeholder: '3 Nov 2026' },
      ],
      ok: 'Save',
    });
    if (!said) return;
    const signer = (said.values.signer ?? '').replace(/\s+/g, ' ').trim();
    if (!signer) {
      showError(new Error('Say who signed it.'));
      return;
    }
    const when = parseDay((said.values.when ?? '').trim(), new Date());
    const day = when ? isoDay(when) : facts.signedOn || isoDay(new Date());
    if (day > isoDay(new Date())) {
      showError(new Error('That day is still to come. Give the day it was signed.'));
      return;
    }
    onSigned(signer, day);
  };
  return (
    <div className="doc-head-facts doc-facts-line">
      <span className="doc-fact">{kind}</span>
      {(hasDocFacts(facts) || facts.replaces) && <span className="doc-fact">{docVersionWords(chain.version, chain.latest)}</span>}
      {status ? (
        canEdit ? (
          <button type="button" className="doc-tag" title={`Change the status (now ${STATUS_WORDS[facts.status!]}; next ${next ? STATUS_WORDS[next] : 'none'})`} onClick={(e) => chooseStatus(e.currentTarget)}>
            {status}
          </button>
        ) : (
          <span className="doc-fact">{status}</span>
        )
      ) : (
        canEdit && (
          <button type="button" className="doc-tag" title="Set the status: draft, sent or signed" onClick={(e) => chooseStatus(e.currentTarget)}>
            Set status
          </button>
        )
      )}
      {facts.status === 'signed' && !facts.signer && canEdit && (
        <button type="button" className="doc-tag" title="Say who signed it" onClick={onSigner}>
          Add who signed
        </button>
      )}
      {chain.earlier.length > 0 && (
        <button type="button" className="doc-tag" aria-expanded={open} title={open ? 'Hide earlier versions' : 'Show earlier versions'} onClick={() => setOpen((v) => !v)}>
          Earlier versions ({chain.earlier.length})
        </button>
      )}
      {canEdit && (
        <button type="button" className="doc-tag" title="Add a new version of this document" onClick={onNewVersion}>
          New version
        </button>
      )}
      {open &&
        chain.earlier.map((d, i) => (
          <button key={d.path} type="button" className="doc-tag" title={`Open ${d.title}`} onClick={(e) => onOpenVersion(d.path, d.project, e.ctrlKey || e.metaKey)} onAuxClick={(e) => e.button === 1 && onOpenVersion(d.path, d.project, true)}>
            {d.title} · {docVersionWords(chain.version - i - 1, false)}
            {d.facts.status ? ` · ${STATUS_WORDS[d.facts.status]}` : ''}
          </button>
        ))}
    </div>
  );
}

/** A note's first heading retitled (a new version's copy carries the old name; only an exact match moves). */
function retitleFirstHeading(body: string, from: string, to: string): string {
  const lines = body.split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++;
  }
  for (; i < lines.length; i++) {
    const m = /^(#{1,6}\s+)(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    if (m[2].trim().toLowerCase() === from.trim().toLowerCase()) lines[i] = `${m[1]}${to}`;
    break;
  }
  return lines.join('\n');
}

/** The facts line wired for a note (front matter read and written through the note's own save, so typing is kept and
 *  Ctrl+Z undoes). The open note's own facts read from its live text (a tap answers at once, saved or not); the
 *  rest of the chain reads from the index. Used by the note's head and the doc's head alike. */
export function DocFactsLine({ path, text, kind, canEdit, showWhenPlain, onChangeText }: { path: string; text: string; kind: string; canEdit: boolean; showWhenPlain: boolean; onChangeText(next: string): void }) {
  const revision = useApp((s) => s.revision);
  const [fileNodes, setFileNodes] = useState<DocNode[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fileChainNodes().then((n) => alive && setFileNodes(n));
    return () => {
      alive = false;
    };
  }, [revision]);
  const chain = useMemo(() => {
    const self: DocNode = { path, title: getState().byPath.get(path)?.title ?? A.titleOf(path), facts: readDocFacts(readProps(text)) };
    const rest = noteChainNodes().filter((n) => n.path !== path);
    return docChain([...rest, self, ...(fileNodes ?? [])], path);
  }, [path, text, fileNodes, revision]); // eslint-disable-line react-hooks/exhaustive-deps -- the cached nodes turn with the revision
  const facts = chain.facts;
  const setStatus = (next: DocStatus | null) => {
    onChangeText(setNoteProp(text, 'doc_status', next));
  };
  const setSigned = (signer: string, signedOn: string) => {
    let nextText = setNoteProp(text, 'doc_status', 'signed');
    nextText = setNoteProp(nextText, 'signed_by', signer || null);
    nextText = setNoteProp(nextText, 'signed_on', signedOn);
    onChangeText(nextText);
  };
  const askSigner = async () => {
    const signer = await prompt('Who signed it?', { value: facts.signer, placeholder: 'For example: June Park', ok: 'Save' });
    if (signer === null) return;
    let nextText = setNoteProp(text, 'signed_by', signer.replace(/\s+/g, ' ').trim() || null);
    if (facts.status !== 'signed') {
      nextText = setNoteProp(nextText, 'doc_status', 'signed');
      if (!facts.signedOn) nextText = setNoteProp(nextText, 'signed_on', isoDay(new Date()));
    }
    onChangeText(nextText);
  };
  /** A new version beside this one (one click): a copy linking what it replaces, opened to work in. */
  const newVersion = () => {
    const title = getState().byPath.get(path)?.title ?? A.titleOf(path);
    const stem = title.replace(/\s+v\d+\s*$/i, '').trim() || title;
    const base = `${stem} v${chain.version + 1}`;
    let nextText = setNoteProp(text, 'doc_status', 'draft');
    nextText = setNoteProp(nextText, 'signed_by', null);
    nextText = setNoteProp(nextText, 'signed_on', null);
    nextText = setNoteProp(nextText, 'replaces', `[[${path.replace(/\.md$/i, '')}]]`);
    void A.newNote(A.folderOf(path), 'current', retitleFirstHeading(nextText, title, base), base);
  };
  const openVersion = (at: string, project: string | undefined, newTab: boolean) => {
    const where = newTab ? ('tab' as const) : ('current' as const);
    if (getState().byPath.has(at)) return A.openPath(at, { where });
    if (project) return A.openFolderFile(project, at, where);
  };
  return <DocFacts kind={kind} chain={chain} canEdit={canEdit} showWhenPlain={showWhenPlain || chain.newer !== null || chain.earlier.length > 0} onStatus={setStatus} onSigned={setSigned} onSigner={() => void askSigner()} onNewVersion={newVersion} onOpenVersion={openVersion} />;
}
