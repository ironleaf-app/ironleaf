/** A source position in the original Markdown. Offsets are UTF-16 positions, as in the editor. */
export function notePage(path: string, text: string, requested: number, size = 12000) {
  const pages = Math.max(1, Math.ceil(text.length / size));
  const page = Math.max(1, Math.min(pages, Number.isSafeInteger(requested) ? requested : 1));
  const offset = (page - 1) * size;
  const prefix = text.slice(0, offset);
  return { path, page, pages, offset, line: 1 + (prefix.match(/\n/g)?.length ?? 0), text: text.slice(offset, offset + size), nextPage: page < pages ? page + 1 : null };
}
export type NotePage = ReturnType<typeof notePage>;
