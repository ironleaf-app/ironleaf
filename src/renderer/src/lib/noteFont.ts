// A note's own font and text size (5.2.0; the formatting bar's Aa menu writes them as the note's properties `font` and
// `text size`; NoteView applies them). The fonts are ones Windows has, plus Ironleaf's own; '' is the default from
// Settings › Appearance.
export const NOTE_FONTS: { label: string; value: string; css: string }[] = [
  { label: 'Default', value: '', css: 'var(--font-text)' },
  { label: 'Segoe UI', value: 'Segoe UI', css: '"Segoe UI", sans-serif' },
  { label: 'Calibri', value: 'Calibri', css: 'Calibri, sans-serif' },
  { label: 'Arial', value: 'Arial', css: 'Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana', css: 'Verdana, sans-serif' },
  // The value stays (notes already carrying it keep their choice); the shipped face is retired (10.0), so it reads Georgia.
  { label: 'Source Serif', value: 'Ironleaf Serif', css: 'Georgia, serif' },
  { label: 'Georgia', value: 'Georgia', css: 'Georgia, serif' },
  { label: 'Cambria', value: 'Cambria', css: 'Cambria, serif' },
  { label: 'Times New Roman', value: 'Times New Roman', css: '"Times New Roman", serif' },
  { label: 'Garamond', value: 'Garamond', css: 'Garamond, serif' },
  { label: 'Consolas', value: 'Consolas', css: 'Consolas, monospace' },
  { label: 'Cascadia Code', value: 'Cascadia Code', css: '"Cascadia Code", monospace' },
];
export const NOTE_SIZES = [0, 14, 15, 16, 17, 18, 20, 22, 24];

/** The CSS a note's `font` property stands for (a name not listed is used as given, after the default). */
export function noteFontCss(font: unknown): string | null {
  if (typeof font !== 'string' || !font.trim()) return null;
  const known = NOTE_FONTS.find((f) => f.value === font);
  if (known) return known.css;
  return `"${font.replace(/["\\]/g, '')}", 'Geist', 'Segoe UI', system-ui, sans-serif`;
}
