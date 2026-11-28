// node --test tests/a11vault-fixes.test.mjs — the 10.0 second-round vault fixes, one guard per finding
// (inputs/a11vault-findings.md, N1-N19). The first round guarded only the lines it named and the same faults
// survived elsewhere; every words/style guard here scans the whole tree instead — every renderer .tsx/.ts and
// shared module, never named lines: sentence case (real acronyms and codes listed), no em dash in product words,
// no raw ISO date shown, counts and rows from one list, one frame bar per page. Each test fails without its fix.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length)).replace(/\/\/.*$/gm, '');

/** Every source file under a dir, minus vendored bundles and node modules. */
function gather(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(path.join(root, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'assets') walk(p);
      } else if (/\.(tsx?|mts|cts)$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

const RENDERER = gather('src/renderer/src');
const SHARED = gather('src/shared');

/** Blank the templates in src (nesting-aware: a backtick closes only outside ${}); emit each one's words. */
function scanTemplates(src, emit) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] !== '`') {
      out += src[i];
      i++;
      continue;
    }
    const at = i;
    i++;
    let depth = 0;
    let text = '';
    let closed = false;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        text += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '$' && src[i + 1] === '{') {
        depth++;
        text += '${';
        i += 2;
        continue;
      }
      if (c === '}' && depth > 0) {
        depth--;
        text += '}';
        i++;
        continue;
      }
      if (c === '`' && depth === 0) {
        closed = true;
        i++;
        break;
      }
      text += c;
      i++;
    }
    if (closed) {
      emit(text, at);
      out += ' '.repeat(i - at);
    } else {
      out += src.slice(at);
      break;
    } // an unbalanced backtick hides nothing past itself
  }
  return out;
}

/** A file's words with line numbers: string literals (multi-line templates included) and JSX text. */
function wordsOf(f) {
  const src = noComments(read(f));
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const lineOf = (at) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const out = [];
  // Quoted literals first (a backtick inside one is not a template), then regexes (a backtick or brace inside one
  // is not code structure), then templates, then JSX text. Every blanking keeps its length, so lines hold.
  let rest = src.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, (m, at) => {
    out.push({ line: lineOf(at), text: m.slice(1, -1) });
    return ' '.repeat(m.length);
  });
  rest = rest.replace(/\/(?![/*])(?:\\.|[^/\n\\[]|\[[^\]\n\\]*(?:\\.[^\]\n\\]*)*\])+\/[dgimsuvy]*/g, (m) => ' '.repeat(m.length));
  rest = scanTemplates(rest, (text, at) => out.push({ line: lineOf(at), text }));
  // JSX text exists only in .tsx: in .ts a `>`…`<` span is code (comparisons, generics), never words.
  if (f.endsWith('.tsx')) {
    for (const m of rest.matchAll(/>((?:[^{<>]|\{(?:[^{}]|\{[^{}]*\})*\})*)</gs)) {
      let t = m[1];
      let was = '';
      while (was !== t) {
        was = t;
        t = t.replace(/\{[^{}]*\}/g, ' ');
      }
      if (t.trim()) out.push({ line: lineOf(m.index), text: t });
    }
  }
  return out;
}

const stripInterp = (t) => {
  let was = '';
  while (was !== t) {
    was = t;
    t = t.replace(/\$\{[^{}]*\}/g, ' ');
  }
  return t;
};

// ── N1: one frame for every page ─────────────────────────────────────────────────────────────────────────────

test('N1: one bar per page — the frame sets decide it once, and every page obeys', () => {
  const ws = read('src/renderer/src/views/Workspace.tsx');
  const setOf = (name) => new Set([...ws.match(new RegExp(`const ${name} = new Set<W\\.ViewType>\\(\\[(.*?)\\]\\)`, 's'))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const self = setOf('SELF_HEADER');
  const own = setOf('OWN_HEADER');
  assert.ok(self.has('tidy') && !self.has('abilities'), 'the tidy draws its own bar; Abilities takes the frame’s');
  assert.ok(!own.has('graph') && !own.has('view'), 'the map and a saved view draw no bar of their own');
  // The dispatch: each tab type to the component that renders it (consecutive tab.type matches are one || chain).
  const body = ws.split('<PageGuard key={tab.id} name={tab.type}>')[1].split('</PageGuard>')[0];
  const hits = [...body.matchAll(/tab\.type === '([a-z0-9-]+)'/g)].map((m) => ({ type: m[1], at: m.index, end: m.index + m[0].length }));
  const groups = [];
  for (const h of hits) {
    const last = groups[groups.length - 1];
    if (last && /^\s*\|\|\s*$/.test(body.slice(last.end, h.at))) {
      last.types.push(h.type);
      last.end = h.end;
    } else groups.push({ types: [h.type], end: h.end });
  }
  const imports = new Map();
  for (const m of ws.matchAll(/import \{([^}]+)\} from '([^']+)';/g)) {
    for (const n of m[1].split(',')) {
      const name = n.trim().replace(/^type /, '');
      if (name && !name.includes('*')) imports.set(name, m[2]);
    }
  }
  // 5 Nov 2026, views load with their route (code split per route, ~6 MB off the boot): most views arrive
  // through lazy(), so the map follows those too — same dispatch, same files, only loaded later.
  for (const m of ws.matchAll(/const ([A-Z][A-Za-z0-9]*) = lazy\(\(\) => import\('([^']+)'\)/g)) {
    if (!imports.has(m[1])) imports.set(m[1], m[2]);
  }
  const resolve = (from, spec) => {
    const base = path.posix.join(path.posix.dirname(from), spec);
    for (const ext of ['.tsx', '.ts']) {
      try {
        readFileSync(path.join(root, 'src/renderer/src', `${base}${ext}`));
        return `src/renderer/src/${base}${ext}`;
      } catch {
        /* try the next */
      }
    }
    return null;
  };
  const roots = new Map();
  for (const g of groups) {
    const comp = body.slice(g.end, g.end + 400).match(/<([A-Z][A-Za-z0-9]+)/)?.[1] ?? assert.fail(`no component past ${g.types.join('/')}`);
    const file = imports.has(comp) ? resolve('views/Workspace.tsx', imports.get(comp)) : null;
    assert.ok(file, `${comp} resolves to a file`);
    for (const t of g.types) {
      if (!roots.has(t)) roots.set(t, []);
      roots.get(t).push(file);
    }
  }
  // Residual types render EmptyView (the dispatch's final else).
  const viewTypes = new Set([...read('src/renderer/src/state/workspace.ts').match(/export type ViewType =([^;]+);/)?.[1].matchAll(/'([^']+)'/g) ?? []].map((m) => m[1]));
  // A file's top-level components that draw a bar themselves (WeeklyReview imports only Pill from ProjectPage,
  // so the walk follows an import only into a component the importer actually renders).
  const headerComps = (f) => {
    const src = noComments(read(f));
    const defs = [...src.matchAll(/^(?:export\s+)?(?:function|const)\s+([A-Z][A-Za-z0-9]*)/gm)].map((m) => ({ name: m[1], at: m.index }));
    const out = new Set();
    defs.forEach((d, i) => {
      const slice = src.slice(d.at, i + 1 < defs.length ? defs[i + 1].at : src.length);
      if (/<ViewHeader\b|\bcreateElement\(ViewHeader,/.test(slice)) out.add(d.name);
    });
    return out;
  };
  const rendered = (f) => new Set([...noComments(read(f)).matchAll(/<([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]));
  const importsOf = (f) => {
    const uses = rendered(f);
    const out = [];
    for (const m of noComments(read(f)).matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
      const names = m[1].split(',').map((n) => n.trim().replace(/^type /, '')).filter((n) => n && !n.includes('*'));
      const target = resolve(f.slice('src/renderer/src/'.length), m[2]);
      if (!target) continue;
      const heads = headerComps(target);
      if (names.some((n) => uses.has(n) && heads.has(n))) out.push(target);
    }
    return out;
  };
  const visit = (file, seen) => {
    if (seen.has(file) || seen.size > 600) return;
    seen.add(file);
    for (const next of importsOf(file)) visit(next, seen);
  };
  const emptyFile = resolve('views/Workspace.tsx', './EmptyView');
  const emptySeen = new Set();
  visit(emptyFile, emptySeen);
  // An empty tab showing Home renders Today, which draws its own bar while the frame draws none (Workspace.tsx);
  // the quiet page draws no bar, so the frame's is its only one (5 Nov 2026, Home folded into Today: both routes
  // draw Today, today-start.test.mjs guards it too).
  assert.ok(emptyFile && noComments(read('src/renderer/src/views/EmptyView.tsx')).includes('<TodayView'), 'the empty page showing Home renders Today');
  assert.deepEqual([...emptySeen].filter((f) => headerComps(f).size > 0 && !f.endsWith('views/TodayView.tsx')), [], 'the quiet empty page draws no bar of its own');
  assert.ok(viewTypes.size > 0, 'the ViewType union parses');
  const listedSeen = new Set();
  for (const t of viewTypes) {
    const files = roots.get(t) ?? [emptyFile];
    const seen = new Set();
    for (const r of files) visit(r, seen);
    const has = [...seen].some((f) => headerComps(f).size > 0);
    // 'empty' renders Today (listed above), which draws its own bar; the frame draws none then (Workspace.tsx).
    const listed = self.has(t) || own.has(t) || t === 'timeline' || t === 'empty';
    if (listed) for (const f of seen) listedSeen.add(f);
    assert.equal(has, listed, `${t}: ${has ? 'draws its own bar' : 'takes the frame’s bar'} but the sets say ${listed ? 'own' : 'frame'}`);
  }
  // No orphan bar: every file drawing one is reached from a listed root (a dynamically rendered bar would fail here).
  // 5 Nov 2026, Home folded into Today: the Home page renders nowhere (proven below), so its bar file is skipped —
  // unreachable, kept as the cards' home, never a second bar on any page a person can open.
  assert.ok(!/<HomeView[\s>]/.test(body), 'no dispatch branch renders the Home page');
  for (const f of RENDERER.filter((x) => x.endsWith('.tsx') && x !== 'src/renderer/src/views/Workspace.tsx')) {
    if (f.endsWith('views/HomeView.tsx')) continue;
    if (headerComps(f).size > 0) assert.ok(listedSeen.has(f), `${f} draws a bar no listed page renders`);
  }
});

// ── N3: sentence case everywhere ─────────────────────────────────────────────────────────────────────────────────

// Real acronyms, codes and names a person may read in caps. Closed sets (days, months, currencies, units, sizes,
// keys, date-format tokens) plus attested file badges, formats, places and content conventions. Anything else in
// all caps is a label to sentence-case.
const ACRONYMS = new Set(
  `PC PCS AI PDF CSV USB NAS HTTPS HTTP SSH URL ID IDS MB KB GB TB OK OR MCP NS RTF HTML MD ENEX
   VLAN CV GP VIN PO QF ABC NRMA LF DS HC AV VM TV SUV LPG CRM POS TBC VS NV UI UTF JSON API DNS VPN CSS ATX SHA AWS
   RIFF WAVE MIME PIN NFC NFD NFKD NFKC INPUT SELECT BUTTON BR DESC ASC DTSTART DTEND SUMMARY LOCATION DESCRIPTION
   IMG MAIL FILE VID DOC XLS PPT KEY ODT ODS PAGES JPG JPEG PNG GIF WEBP SVG BMP AVIF MP3 WAV OGG MP4 MOV WEBM
   DOCX XLSX PPTX ICS ZIP EPUB TXT YAML
   MON TUE WED THU FRI SAT SUN JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC GST VAT ABN BSB
   AUD NZD USD EUR GBP SGD AED CAD JPY CHF CNY HKD SEK NOK DKK ZAR KRW INR TWD THB MYR IDR PHP VND
   AM PM AU NZ UK US USA EU S M L XL XS XXL CTRL ALT SHIFT TAB ESC DEL CMD OPT FN YYYY YY MM DD HH MMM MMMM
   TABLE DIV ASIDE FIGURE
   ONE RULE STRUCTURE ANSWER BOLAND HARBOUR LIGHTHOUSE GULL SKILL`
    .split(/\s+/)
    .filter(Boolean),
);
// ONE/RULE/STRUCTURE: emphasis inside agent prompts (model-facing, ONE RULE pinned by agent-files); ANSWER/BOLAND/
// HARBOUR/LIGHTHOUSE/GULL: crossword answers and archive examples (content caps, exempt since a10 finding 10);
// DESC/ASC: stored sort directions; ATX/DTSTART/…: parser and calendar field names; DS: .DS_Store; HC: a site-code
// example; LF: project-initials example; VS/NV: VS Code and the NV font families; TBC: quoted day words.
// TABLE/DIV/ASIDE/FIGURE: tagName comparisons in the brand print paginator's embedded script (code a person never
// reads, 5 Nov 2026 vault suite) — the same class as INPUT/SELECT/BUTTON above.
// SKILL: the file name the open Agent Skills shape fixes (SKILL.md, 24 Nov 2026), a name like .DS_Store, not a label.

/** All-caps words (2+ letters) in a words-chunk that no acronym covers. */
function capsFaults(chunk) {
  let t = chunk;
  t = stripInterp(t); // interpolations first: their code (regexes, constants) is not words
  t = t.replace(/#[0-9A-Za-z]{3,8}\b/g, ' '); // hex colours
  t = t.replace(/\S*\/\S*/g, ' '); // paths and urls
  t = t.replace(/\S*\\\S*/g, ' '); // windows paths
  if (/```|@@|\\u0000|\$\{|&&/.test(t)) return []; // code fences, markers, shell: syntax, not words
  if (/-----/.test(t)) return []; // key armor and separators (content shape)
  if (/\\rtf1|\\fonttbl|\\colortbl/.test(chunk)) return []; // binary-format magic (the RTF preamble: bytes, never words; raw — the strips above eat its escapes)
  if (/[=;]|=>|\|\||\.\.\.|\(\)|const |let |return |import |require\(/.test(t)) return []; // code the tag matcher caught, not words
  if (/[A-Z][A-Z0-9_]*\[/.test(t)) return []; // indexed constants (code), never a label
  if (/\bas\s+(readonly|const|string|number|boolean|unknown|never|any|Record|Partial)\b/.test(t)) return []; // type casts
  if (/\b\w+\[\]/.test(t)) return []; // typed arrays
  const faults = [];
  for (const m of t.matchAll(/[A-Za-z0-9][A-Za-z0-9'’]*/g)) {
    const w = m[0].replace(/['’]s$/i, '');
    if (/\d/.test(w)) continue; // codes, refs, hashes
    if (!/^[A-Z][A-Z]+$/.test(w)) continue;
    if (w.length > 12) continue; // alphabets and fills (code data)
    if (!ACRONYMS.has(w)) faults.push(w);
  }
  return faults;
}

test('N3: sentence case in every product word — no all-caps labels anywhere', () => {
  for (const f of [...RENDERER, ...SHARED]) {
    for (const { line, text } of wordsOf(f)) {
      const faults = capsFaults(text);
      assert.deepEqual(faults, [], `${f}:${line}: all-caps ${JSON.stringify(faults)} a person reads (${JSON.stringify(text.slice(0, 120))})`);
    }
  }
});

test('N3: no generated caps — toUpperCase only capitalises, initials or badges', () => {
  for (const f of [...RENDERER, ...SHARED]) {
    const src = noComments(read(f));
    for (const m of src.matchAll(/\.toUpperCase\(\)/g)) {
      const window = src.slice(Math.max(0, m.index - 80), m.index);
      const before = window.split('\n').at(-1);
      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 24).split('\n')[0];
      const ok =
        /charAt\(0\)\s*$/.test(before) || // first-letter capital
        /\[\s*0\s*\]!?\s*$/.test(before) || // capitals and initials
        (/\[\s*\d+\s*\]!?\s*$/.test(before) && /Speaker/i.test(before)) || // a transcript speaker letter
        (/w\[1\]\s*$/.test(before) && /WINDOWS_NAME/.test(window)) || // a PC name as matched (data, never a label)
        /slice\(0,\s*[145]\)\s*$/.test(before) || // first letter, or a file-extension badge
        /(?:^|[^A-Za-z])hex\s*$/.test(before) || // hex codes
        /\.toString\(16\)\s*$/.test(before) || // a number read as hex (an id in hex, never a label)
        /length\s*===\s*1/.test(before) || // single-char keys
        /f\(\[1-9\]\|1/.test(before) || // function-key display names (F1..F24)
        /=>\s*\w\s*(\+\s*\w\s*)?$/.test(before) || // capitalising one letter in a mapper
        /currency/i.test(before) || // typed currencies become ISO codes
        /exec/.test(before) || // an extracted file extension
        /(?:^|[^A-Za-z])ext/i.test(before) || // file-kind badge words (never `text`: no leading letter)
        (/[{(:]\s*e\s*$/.test(before) && /csv|tsv|png|jpe?g|gif|webp|bmp|avif|heic|ext/i.test(before)) || // a badge from its extension
        /rego/i.test(before) || // number-plate normalisation (data, never a label)
        /String\(raw[^)]*\)\s*$/.test(before) || // a typed pairing code as kept (code data)
        /atLeast\('upper'/.test(before) || // the UPPER() formula (the person's own function)
        /inAnswers\s*$/.test(before) || // a matched puzzle answer (caps by crossword convention)
        /\.words\s*$/.test(before) || // a puzzle's answer words (caps by convention)
        (/^\s*$/.test(before) && /normalize\('NF[KD]/.test(window)) || // a normalise-then-capitalise chain (grid words)
        /\$\{[a-zA-Z]\s*$/.test(before) || // capitalising one letter in a template (a dropped filler's next letter)
        /AM\|PM/.test(after) || // a matched time's am/pm as kept
        /^\s*\}\s*file/.test(after) || // `${ext} file` badge words
        /^\s*\|\|\s*'\?'/.test(after); // initials with their fallback
      assert.ok(ok, `${f}: generated caps (${before.slice(-48).trim()}.toUpperCase())`);
    }
  }
});

// ── N7: no em dash in product words ──────────────────────────────────────────────────────────────────────────────

/** True when a words-chunk's em dash is note content, code or convention — never product prose. */
function dashExempt(t) {
  const u = stripInterp(t);
  if (!u.includes('—')) return true;
  if (/^[\s’“”"'.—,–-]*$/.test(u)) return true; // a bare dash marker (empty states in print and tables)
  if (/(^|\n|\\n)\s*(?:- |#{1,6}\s|>|\||\+ |\d+\.\s|```|---|… |\*\*|!\[)/.test(u)) return true; // note lines, lists, fences, templates
  if (/^\s*[a-z][a-z0-9-]*:/.test(u)) return true; // frontmatter keys (template starter content)
  if (/— \$\{/.test(t)) return true; // a field join (task lines, citations, reports), not prose
  if (/— Part /.test(u)) return true; // transcript separators
  if (/^\s*— /.test(u)) return true; // a lead dash (owner markers, attributions: the conventions that stay)
  if (/— [“"']/.test(u)) return true; // a dash introducing a quote (citations)
  if (/— page \$\{/.test(t)) return true; // paginated names in model turns (model-facing)
  if (/\b[mn]dash\b/.test(u)) return true; // entity maps
  if (/\b(ANSWER|HARBOUR|LIGHTHOUSE|GULL)\b/.test(u)) return true; // crossword clue formats (parser-accepted)
  if (/["“]ANSWER/.test(u)) return true;
  if (/join\(' — '\)|split\(' — '\)/.test(t)) return true; // separators parsed and rebuilt, never shown
  if (/\(\?:|\\[sdw]|\(\?=|\(\?!/.test(u)) return true; // a regex in template form (note-format parsing)
  return false;
}

test('N7: no em dash in product words — renderer, shared words and the backend place words', () => {
  for (const f of [...RENDERER, ...SHARED, 'src/main/vault-place.ts']) {
    const lines = read(f).split('\n');
    for (const { line, text } of wordsOf(f)) {
      if (!text.includes('—') || dashExempt(text)) continue;
      const context = `${lines[line - 2] ?? ''}\n${lines[line - 1] ?? ''}`;
      if (/description:\s*($|['"`])/.test(context)) continue; // tool descriptions go to the model, never the person
      assert.fail(`${f}:${line}: em dash in product words (${JSON.stringify(text.slice(0, 120))})`);
    }
  }
});

// ── N2/N16/N17: dates shown in words, counts that travel ────────────────────────────────────────────────────────

test('N2: the catch-up banner never prints a raw ISO day', () => {
  const src = read('src/shared/project-checks.ts');
  assert.ok(!src.includes('since ${s.updated}'), 'an ISO day renders as day words, never raw');
});

test('no raw ISO stamp shown anywhere — day words, input hints and data only', () => {
  for (const f of [...RENDERER, ...SHARED]) {
    const lines = read(f).split('\n');
    for (const { line, text } of wordsOf(f)) {
      const t = stripInterp(text);
      if (!/\b\d{4}-\d{2}-\d{2}\b/.test(t)) continue;
      if (/^\s*\d{4}-\d{2}-\d{2}\s*$/.test(t)) continue; // a bare date value (sort sentinels, keys)
      if (/\blike |Try |such as |as a day\b|Give the |A day: |\(20\d\d-\d\d-\d\d\)/.test(t)) continue; // input-format hints
      if (/^(min|max)=/.test(t)) continue; // date-input bounds
      const context = `${lines[line - 2] ?? ''}\n${lines[line - 1] ?? ''}`;
      if (/description:\s*($|['"`])/.test(context)) continue; // tool descriptions go to the model
      assert.fail(`${f}:${line}: raw ISO date shown (${JSON.stringify(t.slice(0, 120))})`);
    }
  }
  for (const f of RENDERER.filter((x) => x.includes('/views/') || x.includes('/components/') || x.includes('/panels/'))) {
    const src = noComments(read(f));
    for (const m of src.matchAll(/\.toISOString\(\)/g)) {
      const line = src.slice(0, m.index).split('\n').at(-1) + src.slice(m.index, m.index + 40).split('\n')[0];
      const data = /(===|!==|<=|>=)/.test(line) || /[)\w\]]\s*[<>]\s*new Date/.test(line) || /toISOString\(\)\s*[<>]/.test(line) || /isoWords\(|isoOf|setMonth|began|syncedAt|caught/.test(line);
      assert.ok(data, `${f}: an ISO stamp rendered where a person reads (${line.trim().slice(0, 100)})`);
    }
  }
});

test('N16: every shown count travels — no bare locale call', () => {
  for (const f of [...RENDERER, ...SHARED]) {
    const src = noComments(read(f));
    assert.ok(!/\.(toLocaleString|toLocaleDateString|toLocaleTimeString)\(\s*\)/.test(src), `${f}: a bare locale call`);
  }
});

// ── N4/N19: counts and rows from one list ──────────────────────────────────────────────────────────────────────

test('N4/N19: a count never disagrees with the rows it counts', () => {
  const people = read('src/renderer/src/views/PeoplePage.tsx');
  assert.ok(people.includes('const count = shown?.length ?? 0;'), 'People counts the rows on show');
  assert.ok(people.includes('count={count}') && people.includes('{shown.map('), 'the title and the list read one list');
  const timeline = read('src/renderer/src/views/TimelineView.tsx');
  assert.ok(timeline.includes('lead={lead}'), 'the Timeline carries a lead');
  assert.ok(timeline.includes('findProblems(filtered, today)'), 'its figures count the rows on show');
  assert.ok(timeline.includes('Nothing matches these filters.'), 'filtered-empty is worded');
});

// ── N5/N12/N18: search, foot bar, foot tabs ───────────────────────────────────────────────────────────────────

test('N5: the top search is one bar centred by the grid; crowded page actions yield into their menu (3 Nov sweep D: one row; Round 6: exactly centred by construction)', () => {
  const kit = read('src/renderer/src/styles/kit.css');
  assert.ok(/\.topbar\s*\{[^}]*display:\s*grid/s.test(kit), 'the bar is a 3-column grid');
  assert.ok(kit.includes('grid-template-columns: minmax(0, 1fr) minmax(360px, 520px) minmax(0, 1fr)'), 'the search centred between always-equal sides, 360px to 520px');
  const rule = kit.split('.topbar .top-search')[1].split('}')[0];
  assert.ok(rule.includes('width: 100%') && rule.includes('max-width: 520px') && !rule.includes('position: absolute'), 'the bar fills the middle track, 520px max on every page it fits (shell parity, 4 Nov 2026: the host app\'s 520 max), never absolutely placed');
  assert.ok(!kit.includes('@container topbar (min-width: 1000px)'), 'no wider step: 520px is already the max');
  assert.ok(!kit.includes('width: 280px') && !kit.includes('width: 240px'), 'no width step under the floor (the old 280/240px steps crushed the bar in the real window)');
  assert.ok(read('src/renderer/src/lib/headerOverflow.ts').includes('HEADER_SEARCH_FLOOR = 360'), 'the 360px floor under the middle track');
  // Page actions yield measured on the grid (Round 6, 4 Nov 2026, the reviewer: nothing can overlap by
  // construction): while their side crowds its cell they ride in their page's ⋯ menu, one by one from the
  // least used, the most used last.
  assert.ok(!kit.includes('.topbar-room') && !kit.includes('.topbar-tight {'), 'no fixed width step left for buttons');
  assert.ok(kit.includes('.topbar [data-overflow].is-overflow-hidden { display: none; }'), 'hidden buttons hide');
  assert.ok(kit.includes('.topbar .navbtn.topbar-tight-only { display: none; }'), 'the tight menu stays out until needed');
  assert.ok(kit.includes('.topbar .navbtn.topbar-tight-only.is-shown { display: inline-grid; }'), 'and only shows while carrying');
  // The final yield is the measured 40px button (was the 500/360px container steps).
  assert.ok(kit.includes('.topbar.is-squeezed { grid-template-columns: minmax(0, 1fr) 40px minmax(0, 1fr); }'), 'too narrow for the bare sides: the middle track squeezes');
  assert.ok(kit.includes('.topbar.is-squeezed .top-search .clip, .topbar.is-squeezed .top-search kbd { display: none; }'), 'the words and the key go, leaving a search button');
});

test('N12/N18: the note foot wraps its Filter and heads its one list quietly', () => {
  // One Linked list (5 Nov 2026, rest-quieten and v6): sections, not tabs — the underline went with the tabs.
  // The bar wraps, the Filter wraps under it, and the folded title and the section heads read as quiet words
  // with soft counts, no pill anywhere.
  const css = read('src/renderer/src/styles/note-foot.css');
  assert.ok(css.split('.foot-bar')[1].split('}')[0].includes('flex-wrap: wrap'), 'the bar wraps');
  const search = css.split('.foot-search')[1].split('}')[0];
  assert.ok(search.includes('flex: 1 0 168px') && search.includes('min-width: min(168px, 100%)'), 'the Filter wraps under the bar');
  assert.ok(!css.includes('.foot-tab'), 'no tab rules left');
  const title = css.split('.foot-title')[1].split('}')[0];
  assert.ok(title.includes('color: var(--text)') && !title.includes('background:'), 'the title reads as words, no pill');
  const head = css.split('.foot-section-head')[1].split('}')[0];
  assert.ok(head.includes('font-weight: 600') && head.includes('color: var(--text-muted)'), 'section heads read as quiet kit words');
  assert.ok(!css.includes('the chosen tab a soft pill'), 'the pill comment is gone');
});

// ── N6/N17: the model door, the paste name ───────────────────────────────────────────────────────────────────

test('N17: one pasted-picture namer for notes and canvas', () => {
  const attach = read('src/renderer/src/lib/attach.ts');
  assert.ok(attach.includes('export function pastedPictureName'), 'the namer is shared');
  assert.ok(attach.includes('prepareAttachment') && attach.includes('pastedPictureName()'), 'notes use it');
  const canvas = read('src/renderer/src/views/CanvasView.tsx');
  assert.ok(canvas.includes("from '../lib/attach'") && canvas.includes('pastedPictureName('), 'canvas uses it');
  assert.ok(!canvas.includes('toISOString().slice(0, 19)'), 'no ISO stamp in a name');
});

// ── N8/N9/N10/N14/N15: the small words ────────────────────────────────────────────────────────────────────────

test('N8/N9/N10/N14/N15: statuses stand up, fragments take colons, deeds stay deeds', () => {
  const meetings = read('src/renderer/src/views/modules/work/MeetingsPage.tsx');
  assert.ok(meetings.includes('>No agenda yet</span>') && meetings.includes("'No tasks'"), 'standalone statuses stand up (t248: meeting screens say Tasks)');
  assert.ok(meetings.includes("action still open' : 'actions still open'"), 'the stat pluralises');
  assert.ok(meetings.includes('No upcoming meeting is in that project.'), 'upcoming, never coming');
  const people = read('src/renderer/src/views/PeoplePage.tsx');
  assert.ok(people.includes('· No card yet</span>'), 'no card stands up');
  assert.ok(people.includes('>Owes you {c.owesYou}</span>') && people.includes('>You owe {c.youOwe}</span>'), 'the tags stand up');
  assert.ok(people.includes('>Nothing open</span>'), 'nothing open stands up');
  assert.ok(people.includes('`owes you: ${c.owesYouItems[0].title}`'), 'owes you takes a colon and keeps the capital');
  assert.ok(people.includes('`you owe: ${c.youOweItems[0].title}`'), 'you owe takes a colon and keeps the capital');
  assert.ok(read('src/renderer/src/views/ProjectsHome.tsx').includes('Due</span>'), 'the review pill stands up');
  const tidy = read('src/renderer/src/views/WeeklyTidyView.tsx');
  assert.ok(tidy.includes('every applied fix can be undone.') && !tidy.includes('every applied line undoes'), 'fixes undo');
  assert.ok(!read('src/renderer/src/views/ProjectsHome.tsx').includes('Tap'), 'choosing, never tapping (the help line under the list is gone: the row explains itself)');
  // 8 Nov 2026, the living graph: the card map's help line went with it; the canvas teaches double-click, never tap.
  assert.ok(read('src/renderer/src/views/GraphTab.tsx').includes('Click a point to see its links. Double-click to open it.'), 'choose, never tap');
});
