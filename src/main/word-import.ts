import { needsWindowsRepair } from '../shared/paths';
// Word documents as notes (9.5 nv-import F9): a folder of .docx files becomes notes — headings, lists, tables,
// bold and italic, links, pictures and tick boxes — with the originals kept beside them. Read from the open
// Office format (ECMA-376) alone: document.xml for the words, numbering.xml for lists, the rels for links and
// pictures, media files unpacked beside the note. Headers and footers (repeated chrome) stay out; footnotes,
// comments and tracked deletions stay out and are said. Older .doc binaries are refused plainly (save as .docx).
// Only Node's own modules plus the small zip reader in ./doc-text.

import { decodeXml, zipEntries, zipRead } from './doc-text';

export interface WordFile { name: string; data: Buffer }
export interface WordOut { markdown: string; files: WordFile[]; skipped: { what: string; why: string }[] }

const attr = (tag: string, name: string): string => {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : '';
};

/** The rels (word/_rels/document.xml.rels): id → its target and whether it leaves the file. */
function parseRels(xml: string): Map<string, { target: string; external: boolean }> {
  const out = new Map<string, { target: string; external: boolean }>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const t = m[0];
    const id = attr(t, 'Id');
    if (id) out.set(id, { target: attr(t, 'Target'), external: /External/.test(attr(t, 'TargetMode')) });
  }
  return out;
}

interface NumLevel { bullet: boolean }
interface NumDef { levels: Map<number, NumLevel> }

/** numbering.xml: each list (numId) per indent level, bullet or numbered. Abstract definitions shared by reference. */
function parseNumbering(xml: string): Map<string, NumDef> {
  const abstracts = new Map<string, Map<number, NumLevel>>();
  for (const m of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="([^"]*)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const levels = new Map<number, NumLevel>();
    for (const l of m[2].matchAll(/<w:lvl\b[^>]*w:ilvl="([^"]*)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
      const fmt = /<w:numFmt\b[^>]*w:val="([^"]*)"/.exec(l[2])?.[1] ?? '';
      const text = /<w:lvlText\b[^>]*w:val="([^"]*)"/.exec(l[2])?.[1] ?? '';
      const bullet = /bullet|diamond|square|circle|tick|box|check|arrow/i.test(fmt) || /^[•·o▪●○■□✓✔✕\-–]$/.test(decodeXml(text));
      levels.set(Number(l[1]), { bullet });
    }
    abstracts.set(m[1], levels);
  }
  const out = new Map<string, NumDef>();
  for (const m of xml.matchAll(/<w:num\b[^>]*w:numId="([^"]*)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const abs = /<w:abstractNumId\b[^>]*w:val="([^"]*)"/.exec(m[2])?.[1] ?? '';
    // Level overrides on the num itself win over the abstract's.
    const levels = new Map(abstracts.get(abs) ?? []);
    for (const l of m[2].matchAll(/<w:lvlOverride\b[^>]*w:ilvl="([^"]*)"[^>]*>([\s\S]*?)<\/w:lvlOverride>/g)) {
      const start = /<w:startOverride\b[^>]*w:val="([^"]*)"/.exec(l[2]);
      if (!start) levels.delete(Number(l[1]));
    }
    out.set(m[1], { levels });
  }
  return out;
}

interface Run { text: string; bold: boolean; italic: boolean; strike: boolean; link: string | null; picture: { id: string; alt: string } | null; br: boolean; tab: boolean }

/** One paragraph's runs: text with its bold/italic/strike, links, pictures, breaks. Field codes and deletions left out. */
function parseRuns(pXml: string, rels: Map<string, { target: string; external: boolean }>): Run[] {
  const runs: Run[] = [];
  // Hyperlinks wrap runs: <w:hyperlink r:id="rId5"><w:r>…</w:r></w:hyperlink>.
  const parts: { link: string | null; xml: string }[] = [];
  let rest = pXml;
  const linkRe = /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g;
  let last = 0;
  for (let m = linkRe.exec(pXml); m; m = linkRe.exec(pXml)) {
    if (m.index > last) parts.push({ link: null, xml: pXml.slice(last, m.index) });
    const rid = /r:id="([^"]*)"/.exec(m[1])?.[1] ?? '';
    const anchor = /w:anchor="([^"]*)"/.exec(m[1])?.[1] ?? '';
    const rel = rels.get(rid);
    parts.push({ link: rel?.external ? rel.target : anchor ? `#${anchor}` : null, xml: m[2] });
    last = m.index + m[0].length;
  }
  if (last < pXml.length) parts.push({ link: null, xml: pXml.slice(last) });
  rest = parts.map((p) => p.xml).join('');
  void rest;
  for (const part of parts) {
    for (const rm of part.xml.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
      const rXml = rm[1];
      const pr = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(rXml)?.[1] ?? '';
      const bold = /<w:b\b/.test(pr) && !/<w:b\b[^>]*w:val="0"/.test(pr);
      const italic = /<w:i\b/.test(pr) && !/<w:i\b[^>]*w:val="0"/.test(pr);
      const strike = /<w:(strike|dstrike)\b/.test(pr);
      // A picture: a:blip's embed id plus the drawing's description.
      const drawing = /<w:drawing\b[\s\S]*?<\/w:drawing>/.exec(rXml)?.[0];
      let picture: Run['picture'] = null;
      if (drawing) {
        const id = /r:embed="([^"]*)"/.exec(drawing)?.[1] ?? /r:link="([^"]*)"/.exec(drawing)?.[1] ?? '';
        const alt = /<wp:docPr\b[^>]*descr="([^"]*)"/.exec(drawing)?.[1] ?? /<wp:docPr\b[^>]*name="([^"]*)"/.exec(drawing)?.[1] ?? '';
        if (id) picture = { id, alt: decodeXml(alt) };
      }
      const texts = [...rXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => decodeXml(t[1])).join('');
      const br = /<w:(br|cr)\b/.test(rXml);
      const tab = /<w:tab\b/.test(rXml);
      // Deleted words (tracked changes) and field codes are left out; the field's result text (w:t) is kept.
      if (!texts && !picture && !br && !tab) continue;
      runs.push({ text: texts, bold, italic, strike, link: part.link, picture, br, tab });
    }
    // Breaks and tabs outside runs (rare) still break.
    if (!/<w:r\b/.test(part.xml)) {
      if (/<w:(br|cr)\b/.test(part.xml)) runs.push({ text: '', bold: false, italic: false, strike: false, link: part.link, picture: null, br: true, tab: false });
    }
  }
  return runs;
}

/** A tick-box content control (Word's checkbox): checked or not, or null when this paragraph holds none. */
function checkboxOf(pXml: string): boolean | null {
  const sdt = /<w:sdt\b[\s\S]*?<\/w:sdt>/.exec(pXml)?.[0];
  if (!sdt || !/<w14:checkbox>|<w:checkbox>/.test(sdt)) return null;
  const checked = /<w14:checked\b[^>]*w14:val="([^"]*)"/.exec(sdt)?.[1] ?? /<w:checked\b[^>]*w:val="([^"]*)"/.exec(sdt)?.[1];
  // No explicit value means unchecked (Word writes the element only when ticked, or val="0" when not).
  return checked === undefined ? /<w14:checked\b/.test(sdt) : !/^(0|false)$/i.test(checked);
}

interface Para { style: string; num: { ilvl: number; numId: string } | null; runs: Run[]; tick: boolean | null }

function parseParas(bodyXml: string, rels: Map<string, { target: string; external: boolean }>, pic: (id: string, alt: string) => string): (Para | { table: Para[][] })[] {
  const out: (Para | { table: Para[][] })[] = [];
  const paraOf = (pXml: string): Para => {
    const pPr = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(pXml)?.[1] ?? '';
    const style = /<w:pStyle\b[^>]*w:val="([^"]*)"/.exec(pPr)?.[1] ?? '';
    const numPr = /<w:numPr\b[^>]*>([\s\S]*?)<\/w:numPr>/.exec(pPr)?.[1];
    const num = numPr ? { ilvl: Number(/<w:ilvl\b[^>]*w:val="([^"]*)"/.exec(numPr)?.[1] ?? 0), numId: /<w:numId\b[^>]*w:val="([^"]*)"/.exec(numPr)?.[1] ?? '' } : null;
    return { style, num, runs: parseRuns(pXml, rels), tick: checkboxOf(pXml) };
  };
  // Tables and paragraphs in order (a table consumed whole, so its cells' paragraphs never read as top-level).
  const blocks: { tag: string; xml: string }[] = [];
  for (const m of bodyXml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>|<w:sdt\b[\s\S]*?<\/w:sdt>/g)) {
    const xml = m[0];
    blocks.push({ tag: xml.startsWith('<w:tbl') ? 'w:tbl' : xml.startsWith('<w:sdt') ? 'w:sdt' : 'w:p', xml });
  }
  for (const b of blocks) {
    const xml = b.xml;
    if (b.tag === 'w:sdt') {
      // A block content control (a tick box around paragraphs): its paragraphs with its tick state.
      const tick = checkboxOf(xml);
      const inner = /<w:sdtContent\b[^>]*>([\s\S]*)<\/w:sdtContent>/.exec(xml)?.[1] ?? xml;
      for (const pm of inner.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
        const p = paraOf(pm[0]);
        if (tick !== null && p.tick === null) p.tick = tick;
        out.push(p);
      }
      continue;
    }
    if (b.tag === 'w:tbl') {
      const rows: Para[][] = [];
      for (const rm of xml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
        const cells: Para[] = [];
        for (const cm of rm[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
          const paras = [...cm[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((p) => paraOf(p[0]));
          // A cell's paragraphs joined with <br> (a table cell holds one line in Markdown).
          cells.push(paras.length <= 1 ? (paras[0] ?? { style: '', num: null, runs: [], tick: null }) : { style: '', num: null, runs: [{ text: paras.map((p) => runsText(p.runs, rels, pic)).join('<br>'), bold: false, italic: false, strike: false, link: null, picture: null, br: false, tab: false }], tick: null });
        }
        rows.push(cells);
      }
      // A header row only when Word marks one (tblHeader), else every row stays data (as F12's HTML tables).
      const header = /<w:tblHeader\b/.test(xml);
      (out as { table: Para[][]; header?: boolean }[]).push({ table: rows, ...(header ? { header: true } : {}) });
    } else {
      out.push(paraOf(xml));
    }
  }
  return out;
}

/** Runs as Markdown words (pictures become tokens for the caller to resolve against the media it unpacks). */
function runsText(runs: Run[], _rels: Map<string, { target: string; external: boolean }>, pic: (id: string, alt: string) => string): string {
  let s = '';
  for (const r of runs) {
    if (r.picture) {
      s += pic(r.picture.id, r.picture.alt);
      if (r.text) s += runText(r);
    } else s += runText(r);
    if (r.tab) s += '\t';
    if (r.br) s += '\n';
  }
  return s;
}

function runText(r: Run): string {
  if (!r.text) return '';
  let t = r.text.replace(/([*_~[\]|])/g, '\\$1');
  if (r.bold && r.italic) t = `***${t}***`;
  else if (r.bold) t = `**${t}**`;
  else if (r.italic) t = `*${t}*`;
  if (r.strike) t = `~~${t}~~`;
  if (r.link && !r.link.startsWith('#')) t = `[${t}](${r.link.replace(/ /g, '%20')})`;
  return t;
}

const HEADING: Record<string, number> = { Title: 1, Heading1: 1, Heading2: 2, Heading3: 3, Heading4: 4, Heading5: 5, Heading6: 6, Subtitle: 2 };

/**
 * A .docx file's words as Markdown: headings, lists (bullets and numbers by numbering.xml), tables, bold/italic/
 * strike, links and pictures (unpacked to `filesDir` beside the note). Returns the note text plus the media files.
 */
export async function docxToMarkdown(buf: Buffer, filesDir: string): Promise<WordOut> {
  const entries = zipEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const textOf = async (name: string): Promise<string | null> => {
    const e = byName.get(name);
    return e ? (await zipRead(buf, e)).toString('utf8') : null;
  };
  const doc = await textOf('word/document.xml');
  if (doc === null) throw new Error('Not a Word document.');
  const rels = parseRels((await textOf('word/_rels/document.xml.rels')) ?? '');
  const numbering = parseNumbering((await textOf('word/numbering.xml')) ?? '');
  const skipped: { what: string; why: string }[] = [];
  if (byName.has('word/footnotes.xml')) skipped.push({ what: 'Footnotes', why: 'footnotes stay in the Word file' });
  if (byName.has('word/comments.xml') || byName.has('word/commentsExtended.xml')) skipped.push({ what: 'Comments', why: 'comments stay in the Word file' });
  if (/<w:del\b|<w:delText\b/.test(doc)) skipped.push({ what: 'Tracked deletions', why: 'deleted words stay out' });

  // Media: each referenced part unpacked once.
  const media = new Map<string, WordFile>();
  const picToken = (id: string, alt: string): string => {
    const rel = rels.get(id);
    const target = rel && !rel.external ? rel.target.replace(/^\//, '') : '';
    const part = target.startsWith('word/') ? target : target ? `word/${target.replace(/^\.\//, '')}` : '';
    const valid = /^word\/media\/[^/]+$/i.test(part) && !needsWindowsRepair(part.slice('word/media/'.length));
    const e = valid ? byName.get(part) : undefined;
    if (!e) return alt ? `(${alt} — picture not in the file)` : '(a picture not in the file)';
    const key = part.toLowerCase();
    if (!media.has(key)) {
      const base = part.split('/').pop() ?? 'image';
      media.set(key, { name: base, data: Buffer.alloc(0), part } as WordFile & { part: string });
    }
    return `![${alt}](${filesDir}/${(media.get(key) as WordFile).name.replace(/ /g, '%20')})`;
  };

  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(doc)?.[1] ?? doc;
  const blocks = parseParas(body, rels, picToken);
  const lines: string[] = [];
  for (const b of blocks) {
    if ('table' in b) {
      const rows = b.table.map((cells) => cells.map((c) => runsText(c.runs, rels, picToken).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()));
      const width = Math.max(0, ...rows.map((r) => r.length));
      if (!width || !rows.length) continue;
      const fill = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
      const head = (b as { header?: boolean }).header ? [fill(rows[0]), `|${Array(width).fill(' --- ').join('|')}|`, ...rows.slice(1).map(fill)] : [fill([]), `|${Array(width).fill(' --- ').join('|')}|`, ...rows.map(fill)];
      lines.push('', ...head, '');
      continue;
    }
    const text = runsText(b.runs, rels, picToken).replace(/[ \t]+$/gm, '').trim();
    if (!text && b.tick === null) continue;
    // A tick box makes the paragraph a task (its box character, if any, is the control's, not words).
    if (b.tick !== null) {
      const words = text.replace(/^[☐☑☒☐\s]+/, '').trim();
      lines.push(`- [${b.tick ? 'x' : ' '}] ${words}`);
      continue;
    }
    const level = HEADING[b.style];
    if (level) {
      lines.push('', `${'#'.repeat(level)} ${text.replace(/\n+/g, ' ').trim()}`, '');
      continue;
    }
    if (/^Quote|IntenseQuote/.test(b.style)) {
      lines.push('', ...text.split('\n').map((l) => `> ${l}`), '');
      continue;
    }
    if (b.num && b.num.numId !== '0') {
      const def = numbering.get(b.num.numId);
      const lvl = def?.levels.get(b.num.ilvl);
      const bullet = lvl ? lvl.bullet : true;
      const indent = '  '.repeat(Math.min(Math.max(b.num.ilvl, 0), 8));
      lines.push(`${indent}${bullet ? '-' : '1.'} ${text.replace(/\n/g, ' ')}`);
      continue;
    }
    lines.push(text);
  }
  // Media bytes, now that every referenced part is known.
  const files: WordFile[] = [];
  for (const [key, f] of media) {
    const e = byName.get([...byName.keys()].find((k) => k.toLowerCase() === key) ?? '');
    if (!e) continue;
    files.push({ name: f.name, data: await zipRead(buf, e) });
  }
  const markdown = `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  return { markdown: markdown === '\n' ? '' : markdown, files, skipped };
}

/** Whether bytes look like a .docx (a zip holding word/document.xml). */
export function isDocx(buf: Buffer): boolean {
  try {
    return zipEntries(buf).some((e) => e.name === 'word/document.xml');
  } catch {
    return false;
  }
}
