// Every link Ironleaf writes for the person (a dropped or pasted file, a suggestion, [[ completions, Link to a note,
// a moved selection): what it names follows Settings › Files and links › New links name, and how it is written follows
// Write new links as [[Note name]] (else a Markdown link).

import { encodeLinkPath } from '../../../shared/markdown';
import { folderOfPath, relativePath } from '../../../shared/paths';
import { getState, prefs } from '../state/store';

const isNote = (rel: string) => /\.md$/i.test(rel);
const nameOf = (rel: string) => rel.split('/').pop() ?? rel;

/** What a new link to a note or file names, written in the note at `from`. */
export function linkTarget(rel: string, from?: string): string {
  const bare = isNote(rel) ? rel.replace(/\.md$/i, '') : rel;
  const format = prefs().linkFormat;
  if (format === 'absolute') return bare;
  if (format === 'relative' && from !== undefined) return relativePath(folderOfPath(from), bare);
  // The shortest: the name alone, unless another note (or file) has the same name.
  const name = nameOf(bare);
  const { notes, files } = getState();
  const same = isNote(rel)
    ? notes.filter((n) => n.title.toLowerCase() === name.toLowerCase()).length
    : files.filter((f) => nameOf(f.rel).toLowerCase() === name.toLowerCase()).length;
  return same > 1 ? bare : name;
}

/** A whole new link: [[…]] or [label](…), with ! to show the thing (a picture, a PDF, a recording), a heading, a label. */
export function writeLink(rel: string, from: string | undefined, options: { embed?: boolean; heading?: string; alias?: string } = {}): string {
  const target = linkTarget(rel, from);
  const bang = options.embed ? '!' : '';
  if (prefs().wikilinks) return `${bang}[[${target}${options.heading ? `#${options.heading}` : ''}${options.alias ? `|${options.alias}` : ''}]]`;
  const label = options.alias ?? (isNote(rel) ? nameOf(rel).replace(/\.md$/i, '') : options.embed ? '' : nameOf(rel));
  const path = isNote(rel) ? `${target}.md` : target;
  return `${bang}[${label}](${encodeLinkPath(path)}${options.heading ? `#${encodeURIComponent(options.heading)}` : ''})`;
}

/** Things a link shows in place rather than names: pictures, PDFs, sound and video. */
export const shownInPlace = (rel: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif|pdf|mp3|wav|m4a|ogg|oga|flac|aac|weba|mp4|webm|mov|mkv|ogv|m4v)$/i.test(rel);
