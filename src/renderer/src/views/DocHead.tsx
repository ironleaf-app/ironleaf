// A doc's head (src/shared/doc-file.ts): its title, what it is in a line (click to change it), its tags and when it
// last changed, and a slim list of its sections that jumps to each. It heads the page above the body, in Live Preview
// and Reading alike (t239: the editor widget it used to sit in never attached, so nothing showed).

import { useMemo } from 'react';
import { parseDoc, setDocProp } from '../../../shared/doc-file';
import { prompt } from '../components/Dialogs';
import { DocFactsLine } from '../components/DocFacts';
import { Icon } from '../components/Icon';

export interface DocHeadProps {
  path: string;
  text: string;
  canEdit: boolean;
  /** Reading mode: the title is drawn here too. */
  withTitle?: boolean;
  /** The context rail is open: On this page and tags live there instead, never in both places. */
  railOpen?: boolean;
  onChangeText(next: string): void;
  /** Go to a section by its heading line (0-based, in the whole file). */
  onJump(line: number, heading: string): void;
  onTag(tag: string): void;
}

export function DocHead({ path, text, canEdit, withTitle, railOpen, onChangeText, onJump, onTag }: DocHeadProps) {
  const doc = useMemo(() => parseDoc(text, path), [text, path]);
  const latest = doc.changes.find((c) => c.date)?.date;
  const editAbout = async () => {
    if (!canEdit) return;
    const next = await prompt(doc.about ? 'What this doc is about' : 'Add a line on what this is', {
      value: doc.about,
      placeholder: 'For example: How the family Minecraft server is set up and run.',
      ok: 'Save',
      message: 'One line, shown under the title, in search and in the side bar.',
    });
    if (next === null) return;
    onChangeText(setDocProp(text, 'about', next.replace(/\s+/g, ' ').trim()));
  };
  const contents = [...doc.sections.map((s) => ({ heading: s.heading, line: s.line, quiet: false })), ...(doc.changesLine >= 0 ? [{ heading: 'Changes', line: doc.changesLine, quiet: true }] : [])];
  return (
    <div className={`doc-head${withTitle ? ' with-title' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
      {withTitle && <h1 className="doc-head-title">{doc.name}</h1>}
      <div className="doc-head-meta">
        <span className="doc-kind" title="A doc: how something is set up and run, kept up to date in place">
          <Icon name="doc" size={12} />
          Doc
        </span>
        {doc.about ? (
          <button className="doc-about" disabled={!canEdit} onClick={() => void editAbout()} title={canEdit ? 'Change what this doc is about' : undefined}>
            {doc.about}
          </button>
        ) : (
          canEdit && (
            <button className="doc-about is-empty" onClick={() => void editAbout()}>
              Add a line on what this is
            </button>
          )
        )}
      </div>
      <DocFactsLine path={path} text={text} kind="Doc" canEdit={canEdit} showWhenPlain onChangeText={onChangeText} />
      {((!railOpen && doc.tags.length > 0) || latest || doc.hostname || doc.key) && (
        <div className="doc-head-facts">
          {(doc.hostname || doc.key) && (
            <span className="doc-fact doc-computer" title={doc.key ? `Known as ${doc.key}` : undefined}>
              <Icon name={doc.key.startsWith('local:') && !doc.hostname ? 'folder' : 'computer'} size={12} />
              {doc.hostname ? `On ${doc.hostname}` : doc.key.startsWith('local:') ? `About ${doc.key.slice(6).split(/[\\/]/).filter(Boolean).pop() ?? 'a folder'}` : 'About a remote computer'}
            </span>
          )}
          {latest && (
            <span className="doc-fact" title="The newest line in Changes">
              <Icon name="history" size={12} />
              Changed {latest}
            </span>
          )}
          {!railOpen &&
            doc.tags.map((t) => (
              <button key={t} className="doc-tag" onClick={() => onTag(t)}>
                #{t}
              </button>
            ))}
        </div>
      )}
      {/* On this page lives here only while the rail is shut, and only past two headings (5 Nov 2026). */}
      {!railOpen && contents.length >= 3 && (
        <nav className="doc-toc" aria-label="Sections in this doc">
          <span className="doc-toc-label">On this page</span>
          {contents.map((c) => (
            <button key={`${c.line}:${c.heading}`} className={`doc-toc-link${c.quiet ? ' is-quiet' : ''}`} onClick={() => onJump(c.line, c.heading)}>
              {c.heading}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
