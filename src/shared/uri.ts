// ironleaf:// links (and ironleaf://, the name before the rename, still read) and what Ironleaf is started with (21 Oct 2026, gap G26). A link on a web page, in another app or
// in a script can open a note, search, or (after the person says yes) make a note or add to one. Every link that would
// change the notes asks first, unless the person allowed that kind of link without asking (Settings › Files and links ›
// Links from other apps). Anything not listed here is ignored. Documented in docs/CLI-AND-LINKS.md.
//
// Pure: a link read into an action, whether it must ask, the words it asks with, and the files and links in a start's
// arguments. Shared by the app and the tests.

export const URI_SCHEME = 'ironleaf';
/** The scheme before the rename to Ironleaf (20 Nov 2026). Kept as an alias: links people saved and other apps' set-ups
 *  still open, and the installer and Windows' entries register both. */
export const LEGACY_URI_SCHEME = 'neuralvault';
export const URI_SCHEMES = [URI_SCHEME, LEGACY_URI_SCHEME] as const;

export type UriAction =
  | { kind: 'open'; note: string; place?: string; folder?: string; newNote?: boolean; settings?: string; row?: string }
  | { kind: 'search'; query: string }
  | { kind: 'new'; name: string; folder: string; text: string; open: boolean }
  | { kind: 'append'; note: string; text: string; heading: string }
  | { kind: 'daily'; text: string; heading: string };

export type UriKind = UriAction['kind'];
export type UriParsed = { ok: true; action: UriAction } | { ok: false; error: string };

/** The kinds of link that change notes, with the words Settings lists them by. */
export const URI_WRITES: { kind: Exclude<UriKind, 'open' | 'search'>; label: string; words: string }[] = [
  { kind: 'new', label: 'Make a new note', words: 'ironleaf://new?name=…&text=…' },
  { kind: 'append', label: 'Add to a note', words: 'ironleaf://append?note=…&text=…' },
  { kind: 'daily', label: 'Add to today’s note', words: 'ironleaf://daily?text=…' },
];

export const isWriteKind = (k: string): k is 'new' | 'append' | 'daily' => URI_WRITES.some((w) => w.kind === k);

/** Words a link may carry (a note's worth). */
export const URI_TEXT_MAX = 20_000;
/** A link longer than this is ignored (Windows passes about 32,000 characters at most). */
export const URI_MAX = 32_000;

const clip = (s: string | null, max: number) => (s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);

/** A link read into what it asks for. Written as ironleaf://open?note=…, ironleaf:open?…, or ironleaf:///open?… (and the
 *  same with neuralvault:, the alias kept from before the rename).
 *  The local link (16 Nov 2026, "make sure they all communicate"): ironleaf://open (the app), ironleaf://note?path=
 *  (one note, vault-relative, never outside the vault) and ironleaf://capture?text= (a new note in the Inbox). */
export function parseVaultUri(link: string): UriParsed {
  const raw = String(link ?? '').trim();
  if (raw.length > URI_MAX) return { ok: false, error: 'That link is too long.' };
  if (/^(?:ironleaf|neuralvault):(?:\/\/)?\/?(?:#.*)?$/i.test(raw)) return { ok: true, action: { kind: 'open', note: '' } };
  const m = /^(?:ironleaf|neuralvault):(?:\/\/\/?)?([a-z-]+)\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(raw);
  if (!m) return { ok: false, error: 'That isn’t an Ironleaf link.' };
  const verb = m[1].toLowerCase();
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(m[2] ?? '');
  } catch {
    return { ok: false, error: 'That link can’t be read.' };
  }
  const get = (...names: string[]) => {
    for (const n of names) {
      const v = q.get(n);
      if (v !== null) return v;
    }
    return null;
  };
  const note = clip(get('note', 'path', 'file'), 600).trim();
  const text = clip(get('text', 'content'), URI_TEXT_MAX);
  const heading = clip(get('heading'), 120).replace(/^#+\s*/, '').trim();
  switch (verb) {
    case 'open': {
      // Deep landing (16 Nov 2026, apps-together part 3): The former host app's doors send place,
      // folder, new and settings; each lands on that exact page, not just the app.
      const place = clip(get('place'), 20).trim().toLowerCase();
      const folder = clip(get('folder'), 400).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
      const fresh = (get('new') ?? '').trim() === '1';
      const settings = clip(get('settings'), 20).trim();
      // A settings row rides with its section (16 Nov 2026 audit finding 13): the row's title as shown.
      const row = clip(get('row'), 80).trim();
      const validPlace = ['today', 'inbox', 'projects', 'tasks', 'meetings', 'notes', 'people', 'graph'].includes(place) ? place : '';
      const validFolder = folder && !folder.split('/').some((s) => s === '..' || s === '.') ? folder : '';
      const validSettings = /^[a-z-]{2,20}$/.test(settings) ? settings : '';
      const validRow = validSettings && row ? row : '';
      if (!note && !validPlace && !validFolder && !fresh && !validSettings) return { ok: true, action: { kind: 'open', note } };
      if (note) return { ok: true, action: { kind: 'open', note } };
      return { ok: true, action: { kind: 'open', note: '', ...(validPlace ? { place: validPlace } : {}), ...(validFolder ? { folder: validFolder } : {}), ...(fresh ? { newNote: true } : {}), ...(validSettings ? { settings: validSettings } : {}), ...(validRow ? { row: validRow } : {}) } };
    }
    case 'note': {
      const rel = note.replace(/\\/g, '/');
      if (!note || /^(?:[a-z]:|\/)/i.test(rel) || rel.split('/').some((s) => s === '..' || s === '.')) return { ok: false, error: 'That note isn’t inside your notes.' };
      return { ok: true, action: { kind: 'open', note } };
    }
    case 'capture': {
      const first = text.split('\n').map((l) => l.trim()).find((l) => l) ?? '';
      const name = first.replace(/[#>*`_~[\]()]/g, '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Capture';
      return { ok: true, action: { kind: 'new', name, folder: 'Inbox', text, open: true } };
    }
    case 'search': {
      const query = clip(get('query', 'q'), 300).trim();
      return query ? { ok: true, action: { kind: 'search', query } } : { ok: false, error: 'The link doesn’t say what to search for.' };
    }
    case 'new': {
      const name = clip(get('name', 'title'), 180).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
      const folder = clip(get('folder'), 400).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
      if (folder.split('/').some((s) => s === '..' || s === '.')) return { ok: false, error: 'That folder isn’t inside your notes.' };
      return { ok: true, action: { kind: 'new', name, folder, text, open: get('open') !== 'false' } };
    }
    case 'append':
      if (!note) return { ok: false, error: 'The link doesn’t say which note to add to.' };
      return text.trim() ? { ok: true, action: { kind: 'append', note, text, heading } } : { ok: false, error: 'The link has no words to add.' };
    case 'daily':
      return text.trim() ? { ok: true, action: { kind: 'daily', text, heading } } : { ok: false, error: 'The link has no words to add.' };
    default:
      return { ok: false, error: `Ironleaf links don’t do “${verb.slice(0, 30)}”.` };
  }
}

/** Whether a link must ask before it runs: every change does, unless the person allowed its kind without asking. Opening
 *  a note and searching never change anything. */
export function needsConfirm(action: UriAction, allowed: readonly string[]): boolean {
  return isWriteKind(action.kind) && !allowed.includes(action.kind);
}

/** The allow-list as kept: known write kinds only, each once. */
export function cleanAllowList(raw: unknown): ('new' | 'append' | 'daily')[] {
  if (!Array.isArray(raw)) return [];
  return URI_WRITES.map((w) => w.kind).filter((k) => raw.includes(k));
}

// Whole words: dialog details wrap and scroll (t207 pass 2).
const preview = (text: string, _max = 400) => {
  const t = text.trim();
  return t;
};

/** What Ironleaf asks before a link changes the notes: a title, a sentence and the words it would write. */
export function confirmWords(action: UriAction, where: string): { title: string; message: string; detail: string; ok: string } {
  switch (action.kind) {
    case 'new':
      return { title: 'Make a note from a link?', message: `A link from another app wants to make the note “${where}”.`, detail: action.text.trim() ? `It would hold:\n${preview(action.text)}` : 'It would be empty.', ok: 'Make the note' };
    case 'append':
      return { title: 'Add to a note from a link?', message: `A link from another app wants to add to “${where}”${action.heading ? ` under ${action.heading}` : ''}.`, detail: `It would add:\n${preview(action.text)}`, ok: 'Add it' };
    case 'daily':
      return { title: 'Add to today’s note from a link?', message: `A link from another app wants to add to today’s note (${where})${action.heading ? ` under ${action.heading}` : ''}.`, detail: `It would add:\n${preview(action.text)}`, ok: 'Add it' };
    default:
      return { title: 'Open from a link?', message: '', detail: '', ok: 'Open' };
  }
}

/** The switch a file is opened with when Windows starts Ironleaf for it ("Open with"), one argument so the path stays
 *  with its switch however Chromium orders a second start's arguments. */
export const OPEN_FILE_ARG = '--neuralvault-open='; // kept: Windows' "Open with" entries earlier versions wrote pass it

/** What a start (or a second start while Ironleaf runs) asks for: ironleaf:// (or ironleaf://) links, and Markdown files to open. */
export function launchTargets(argv: readonly unknown[]): { links: string[]; files: string[] } {
  const links: string[] = [];
  const files: string[] = [];
  for (const a of Array.isArray(argv) ? argv : []) {
    if (typeof a !== 'string') continue;
    const s = a.trim();
    if (/^(?:ironleaf|neuralvault):/i.test(s)) {
      if (!links.includes(s) && s.length <= URI_MAX) links.push(s);
      continue;
    }
    let p = '';
    if (s.toLowerCase().startsWith(OPEN_FILE_ARG)) p = s.slice(OPEN_FILE_ARG.length).trim().replace(/^"|"$/g, '');
    else if (/\.(md|markdown|mdown|mkd)$/i.test(s) && !s.startsWith('-')) p = s;
    if (!p || /[\u0000-\u001f"]/.test(p) || !/\.(md|markdown|mdown|mkd|txt)$/i.test(p)) continue;
    // Only whole paths (C:\…, \\server\…, /…): a bare name could be anything in the folder Ironleaf started in.
    if (!/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(p)) continue;
    if (!files.includes(p)) files.push(p);
  }
  return { links, files };
}
