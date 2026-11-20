// A card seen from far out: what it is at a glance, at a size that can be read. Its title on one line (ending in an
// ellipsis when the card is too narrow), a small mark of its kind (a step's tick, a person's initials, a risk's level,
// a file's type), and quiet lines in its colour standing for the rest. Pictures stay pictures. Drawn at screen size
// (styles/canvas-overview.css undoes the canvas's zoom for it), so it never grows past its card or onto another.

import { memo } from 'react';
import type { ProjectDate, ProjectDocument, ProjectNext, ProjectPerson, ProjectRisk } from '../../../../shared/project-file';
import { parseItem, type CanvasNode } from '../../../../shared/project-canvas';
import { Icon } from '../../components/Icon';
import { fileUrl, isImage } from '../../lib/resolve';
import { fileKind, healthTone, initials, personHue } from '../../lib/projectLook';
import { cardTitle } from './CardFace';
import { pcFileUrl, type BoundHandlers } from './BoundCards';

/** Words without their Markdown marks (links show their words). */
export const plain = (s: string) =>
  s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_m, t: string) => t.split('/').pop()!.replace(/\.md$/i, ''))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const LEVEL_TONE: Record<string, string> = { critical: 'bad', high: 'bad', medium: 'warn', low: 'calm' };
const isPicture = (p: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(p);
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const extOf = (p: string) => (p.includes('.') ? p.slice(p.lastIndexOf('.') + 1) : '');

interface Look {
  title: string;
  mark?: React.ReactNode;
  picture?: string;
  /** The title is the card's whole point (a person, a file): no lines under it. */
  bare?: boolean;
  /** The title is words (a step, a risk, a note), so it may take two lines when the card has room. */
  words?: boolean;
}

function lookOf(node: CanvasNode, h: Pick<BoundHandlers, 'project' | 'entries'>): Look {
  const b = node.neuralvault;
  if (b?.part === 'project' || b?.part === 'portfolio-project') {
    const p = b.part === 'project' ? h.project : h.entries.get(b.project);
    return { title: p?.name ?? cardTitle(node), mark: <span className={`cv-ov-dot tone-${healthTone(p?.health)}`} />, words: true };
  }
  if (b?.part === 'notes') return { title: plain((node.text ?? '').split('\n').find((l) => l.trim()) ?? '').replace(/^#+\s*|^[-+]\s+/, ''), words: true };
  if (b?.part === 'file') {
    const folder = h.project?.folder;
    if (folder && isPicture(b.rel)) return { title: baseName(b.rel), picture: pcFileUrl(folder, b.rel) };
    const k = fileKind(extOf(b.rel));
    return { title: baseName(b.rel), mark: <span className={`cv-ov-kind kind-${k.kind}`}>{k.label}</span>, bare: true };
  }
  if (b?.part === 'item') {
    const item = parseItem(b.section, node.text ?? '');
    if (!item) return { title: '' };
    switch (b.section) {
      case 'next': {
        const n = item as ProjectNext;
        return { title: plain(n.what), mark: <span className={`cv-ov-tick${n.done ? ' done' : ''}`} />, words: true };
      }
      case 'dates': {
        const d = item as ProjectDate;
        return { title: plain(`${d.when} · ${d.what}`), mark: <span className="cv-ov-cal" />, words: true };
      }
      case 'people': {
        const x = item as ProjectPerson;
        return { title: plain(x.name), mark: <span className="cv-ov-avatar" style={{ ['--hue' as string]: personHue(x.name) }}>{initials(x.name)}</span>, bare: !x.role };
      }
      case 'risks': {
        const r = item as ProjectRisk;
        return { title: plain(r.what), mark: <span className={`cv-ov-dot tone-${LEVEL_TONE[r.level ?? ''] ?? 'none'}`} />, words: true };
      }
      case 'documents': {
        const d = item as ProjectDocument;
        const folder = h.project?.folder;
        if (folder && isPicture(d.path)) return { title: baseName(d.path), picture: pcFileUrl(folder, d.path) };
        const k = fileKind(extOf(d.path));
        return { title: baseName(d.path), mark: <span className={`cv-ov-kind kind-${k.kind}`}>{k.label}</span> };
      }
    }
  }
  if (node.type === 'file' && node.file) {
    if (isImage(node.file)) return { title: cardTitle(node), picture: fileUrl(node.file) };
    if (/\.md$/i.test(node.file)) return { title: cardTitle(node), mark: <Icon name="notes" size={11} className="cv-ov-icon" /> };
    const k = fileKind(extOf(node.file));
    return { title: cardTitle(node), mark: <span className={`cv-ov-kind kind-${k.kind}`}>{k.label}</span>, bare: true };
  }
  if (node.type === 'link') return { title: cardTitle(node), mark: <Icon name="link" size={11} className="cv-ov-icon" />, bare: true };
  return { title: plain(cardTitle(node)), words: true };
}

export const Overview = memo(function Overview({ node, h }: { node: CanvasNode; h: Pick<BoundHandlers, 'project' | 'entries'> }) {
  const look = lookOf(node, h);
  if (look.picture)
    return (
      <div className="cv-ov is-picture" aria-hidden>
        <img src={look.picture} alt="" draggable={false} />
      </div>
    );
  return (
    <div className={`cv-ov${look.bare ? ' is-bare' : ''}${look.words ? ' is-words' : ''}${look.title ? '' : ' is-untitled'}`} aria-hidden>
      {look.title && (
        <div className="cv-ov-head">
          {look.mark && <span className="cv-ov-mark">{look.mark}</span>}
          <span className="cv-ov-title">{look.title}</span>
        </div>
      )}
      <span className="cv-ov-ghost" />
      <span className="cv-ov-lines">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
});
