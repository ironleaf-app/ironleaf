// The popup: what to clip, where it lands, tags and a note. States: loading, the Vault closed, the clipper off,
// pairing, and ready. Plain words throughout; nothing here reaches past the person's own PC and tab.
const app = document.getElementById('app');
const query = new URLSearchParams(location.search);
const hasChrome = typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

const state = { status: null, places: null, queued: 0, page: null, kind: 'article', said: null, busy: false, code: '', codeError: '' };

function head(vault) {
  return `<div class="phead"><span class="mark">N</span><b>Clip to Ironleaf</b>${vault ? `<span class="vault">${esc(vault)}</span>` : ''}</div>`;
}

function queuedLine() {
  if (!state.queued) return '';
  return `<div class="queued"><span class="dot"></span><span>${state.queued} clip${state.queued === 1 ? '' : 's'} waiting for Ironleaf</span><button id="flush">Send now</button></div>`;
}

function wireFlush() {
  const flush = document.getElementById('flush');
  if (flush) flush.onclick = () => send({ kind: 'flush' }).then(boot);
}

function viewLoading() {
  app.innerHTML = `${head()}<div class="center"><span class="glyph">◧</span><h2>Finding Ironleaf…</h2><p>Talking to your own PC.</p></div>${queuedLine()}`;
  wireFlush();
}

function viewClosed() {
  app.innerHTML =
    `${head()}<div class="center"><span class="glyph">◧</span><h2>Ironleaf is not running</h2>` +
    `<p>Open Ironleaf and try again. Anything you clip while it is closed is kept and sent when it runs.</p>` +
    `<div class="btnrow"><button class="btn pri" id="retry">Try again</button></div></div>${queuedLine()}`;
  document.getElementById('retry').onclick = boot;
  wireFlush();
}

function viewOff() {
  app.innerHTML =
    `${head()}<div class="center"><span class="glyph">◧</span><h2>The web clipper is off</h2>` +
    `<p>Switch it on in Ironleaf Settings, under Quick add, then come back.</p>` +
    `<div class="btnrow"><button class="btn pri" id="retry">Try again</button></div></div>${queuedLine()}`;
  document.getElementById('retry').onclick = boot;
  wireFlush();
}

function viewPair() {
  app.innerHTML =
    `${head()}<div class="center" style="padding-top:6px"><span class="glyph">⌗</span><h2>Pair this browser</h2>` +
    `<p>Enter the code shown in <b>Ironleaf Settings</b>, under <b>Quick add</b> and <b>Web clipper</b>. Once only.</p></div>` +
    `<div class="frow"><input class="input code" id="code" maxlength="9" placeholder="XXXX XXXX" autocomplete="off" spellcheck="false" value="${esc(state.code)}"></div>` +
    `${state.codeError ? `<p class="said err">${esc(state.codeError)}</p>` : ''}` +
    `<div class="btnrow"><button class="btn pri" id="pair">Pair</button></div>` +
    `<p class="hint">Nothing leaves your PC. The code only proves this browser is yours.</p>${queuedLine()}`;
  const input = document.getElementById('code');
  input.focus();
  input.oninput = () => {
    const clean = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    input.value = clean.length > 4 ? `${clean.slice(0, 4)} ${clean.slice(4)}` : clean;
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') pair(input.value);
  };
  document.getElementById('pair').onclick = () => pair(input.value);
  wireFlush();
}

async function pair(code) {
  state.busy = true;
  viewPair();
  document.getElementById('pair').disabled = true;
  const res = await send({ kind: 'pair', code });
  state.busy = false;
  if (res?.paired) {
    state.code = '';
    state.codeError = '';
    await boot();
    return;
  }
  state.code = code;
  state.codeError = res?.error || 'That code is not right. Check it in Ironleaf Settings.';
  viewPair();
}

function kindTabs() {
  const kinds = [
    ['article', 'Article'],
    ['selection', 'Selection'],
    ['bookmark', 'Bookmark'],
    ['screenshot', 'Screenshot'],
  ];
  const hasSel = !!state.page?.selection;
  return `<div class="kindtabs" role="tablist">${kinds
    .map(([id, label]) => `<button role="tab" data-kind="${id}" class="${state.kind === id ? 'on' : ''}" ${id === 'selection' && !hasSel ? 'disabled title="Mark something on the page first"' : ''}>${label}</button>`)
    .join('')}</div>`;
}

function placeOptions() {
  const folders = state.places?.folders ?? [];
  const projects = state.places?.projects ?? [];
  const def = state.places?.defaultFolder || 'Clippings';
  let html = `<option value="">${esc(def)} (default)</option>`;
  if (folders.length) html += `<optgroup label="Folders">${folders.map((f) => `<option value="folder:${esc(f)}">${esc(f)}</option>`).join('')}</optgroup>`;
  if (projects.length) html += `<optgroup label="Projects">${projects.map((p) => `<option value="project:${esc(p.path)}">${esc(p.name)}</option>`).join('')}</optgroup>`;
  return html;
}

function kindHint() {
  if (state.kind === 'article') return 'The whole page as a clean article, with its pictures.';
  if (state.kind === 'selection') return state.page?.selection ? 'Only what is marked on the page.' : 'Mark something on the page first.';
  if (state.kind === 'bookmark') return 'The title, link, summary and picture.';
  return 'A picture of the visible page.';
}

function viewReady() {
  const title = state.page?.title || 'This page';
  app.innerHTML =
    `${head(state.status?.vault)}<div class="ptitle" title="${esc(title)}">${esc(title)}</div>${kindTabs()}` +
    `<p class="hint" style="margin:0 0 10px">${kindHint()}</p>` +
    `<div class="frow"><label class="lbl" for="place">Put it in</label><select class="select" id="place">${placeOptions()}</select></div>` +
    `<div class="frow"><label class="lbl" for="tags">Tags</label><input class="input" id="tags" placeholder="reads, cooking" autocomplete="off" spellcheck="false"></div>` +
    `<div class="frow"><label class="lbl" for="note">Note</label><textarea class="area" id="note" rows="2" placeholder="Why this matters…"></textarea></div>` +
    `<div class="btnrow"><button class="btn pri" id="clip">Clip ${state.kind}</button></div>` +
    `${state.said ? `<p class="said ${state.said.tone}">${esc(state.said.words)}</p>` : ''}` +
    `${queuedLine()}`;
  app.querySelectorAll('[data-kind]').forEach((b) => {
    b.onclick = () => {
      state.kind = b.dataset.kind;
      state.said = null;
      viewReady();
    };
  });
  document.getElementById('clip').onclick = clip;
  wireFlush();
}

async function clip() {
  const placeRaw = document.getElementById('place').value;
  const tags = document.getElementById('tags').value.split(',').map((t) => t.trim()).filter(Boolean);
  const note = document.getElementById('note').value.trim();
  const btn = document.getElementById('clip');
  btn.disabled = true;
  state.said = { tone: '', words: 'Clipping…' };
  const said = document.querySelector('.said');
  if (said) {
    said.className = 'said';
    said.textContent = 'Clipping…';
  }
  let place = null;
  if (placeRaw.startsWith('folder:')) place = { kind: 'folder', path: placeRaw.slice(7) };
  else if (placeRaw.startsWith('project:')) place = { kind: 'project', path: placeRaw.slice(8) };
  const res = await send({ kind: 'clip', clip: { kind: state.kind, place, tags, note } });
  if (res?.done) {
    state.said = { tone: 'ok', words: `${res.done.words}${res.flushed ? ` ${res.flushed} waiting clip${res.flushed === 1 ? '' : 's'} sent too.` : ''}` };
  } else if (res?.queued) {
    state.said = { tone: 'warn', words: 'Kept. It will send when Ironleaf runs.' };
    state.queued = res.waiting;
  } else {
    state.said = { tone: 'err', words: res?.error || 'The clip could not be saved. Try again.' };
    if (res?.code === 'unpaired' || res?.code === 'refused' || res?.code === 'off' || res?.code === 'not-running') {
      await boot();
      return;
    }
  }
  viewReady();
}

async function boot() {
  viewLoading();
  const res = await send({ kind: 'state' }).catch(() => null);
  if (!res) {
    viewClosed();
    return;
  }
  state.queued = res.queued ?? 0;
  if (!res.status) {
    if (res.code === 'off') viewOff();
    else viewClosed();
    return;
  }
  state.status = res.status;
  state.places = res.places;
  if (!res.status.enabled) {
    viewOff();
    return;
  }
  if (!res.status.paired) {
    viewPair();
    return;
  }
  const page = await send({ kind: 'page' }).catch(() => null);
  if (page?.page) {
    state.page = page.page;
    if (state.kind === 'selection' && !page.page.selection) state.kind = 'article';
  } else {
    state.page = null;
  }
  state.said = page?.error && !page?.page ? { tone: 'err', words: page.error } : null;
  viewReady();
}

// Without the browser (screenshots): filled-in states from ?demo=ready|pair|offline.
function demo() {
  const which = query.get('demo') || 'ready';
  if (which === 'pair') {
    state.code = '';
    state.codeError = '';
    viewPair();
    return;
  }
  if (which === 'offline') {
    viewClosed();
    return;
  }
  state.status = { vault: 'Harbour Lane' };
  state.places = { defaultFolder: 'Clippings', folders: ['Clippings', 'Notes/Reading', 'Projects/Store Upgrade'], projects: [{ path: 'Projects/Store Upgrade/Store Upgrade.md', name: 'Store Upgrade' }] };
  state.page = { title: 'Harbour tunnel decision due before Christmas', selection: null };
  state.kind = 'article';
  state.queued = 1;
  viewReady();
}

if (hasChrome && !query.has('demo')) void boot();
else demo();
