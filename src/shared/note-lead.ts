// A note's lead: its opening words for a peek that summarises instead of re-listing the page
// (t7-note-window, 8 Nov 2026). Past the front matter and the title heading, links unwrapped to the
// words a person reads, the first 60 words. Pure: tested in tests/t7-note-window.test.mjs.
export function noteLead(text: string): string {
  // Past the front matter (the properties the peek's facts already say) and the title heading.
  const body = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, '')
    .replace(/^\s*#[ \t]+[^\n]*\r?\n/, '')
    .trim();
  if (!body) return '';
  // Links read as their words ("[[People/Sam Lee|Sam]]" as "Sam", "[[Kickoff]]" as "Kickoff").
  const words = body
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias: string) =>
      (alias || target.split('/').pop() || target).trim())
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 60);
  return words.join(' ');
}
