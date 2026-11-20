// A long file name that wraps where a person would break it: after an underscore, a dash, a space or a dot inside the
// name, and before its extension (".xlsx" stays whole), never in the middle of a word.
import { Fragment, type ReactNode } from 'react';

/** The places a file name may break, as the pieces between them (exported for tests). */
export function breakPieces(name: string): string[] {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const pieces = stem.split(/(?<=[_\-.])/).filter(Boolean);
  return ext ? [...pieces, ext] : pieces;
}

export function Breakable({ name }: { name: string }): ReactNode {
  const pieces = breakPieces(name);
  return pieces.map((p, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {p}
    </Fragment>
  ));
}
