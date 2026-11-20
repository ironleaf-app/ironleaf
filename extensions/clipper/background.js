// The clipper's worker: the popup's hands (reading the tab, fetching its pictures, sending the clip, keeping what
// waits). Talks only to the person's own PC (api.js) and the open tab; nothing leaves the PC.
import { ClipperApi } from './api.js';
import { createQueue } from './queue.js';

const storage = {
  async get(k) {
    return (await chrome.storage.local.get(k))[k];
  },
  async set(k, v) {
    await chrome.storage.local.set({ [k]: v });
  },
  async remove(k) {
    await chrome.storage.local.remove(k);
  },
};
const api = new ClipperApi({ storage });
const queue = createQueue(storage);
const IMAGE_MAX = 8 * 1024 * 1024;

/** The tab's own fetch for its pictures (the worker carries the page's permission). */
async function fetchImage(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(type)) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length || buf.length > IMAGE_MAX) return null;
  let bin = '';
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  return { url, data: btoa(bin), type };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/** The open page read for clipping (the collector injected only now, nowhere else). */
async function collect(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const page = await chrome.tabs.sendMessage(tabId, { kind: 'nvault-collect' });
  if (!page || page.error) throw new Error(page?.error || 'The page could not be read.');
  return page;
}

/** Queued clips sent in order; stops where the Vault stops answering (the rest wait). */
async function flush() {
  const waiting = await queue.all();
  let sent = 0;
  for (const item of waiting) {
    try {
      await api.clip(item.clip);
    } catch (err) {
      if (err.code === 'not-running') break;
      if (err.code === 'unpaired' || err.code === 'refused' || err.code === 'off') break;
      // A clip the Vault refuses for its own sake is left waiting rather than dropped: the person still has it.
      break;
    }
    await queue.remove(item.id);
    sent += 1;
  }
  return { sent, waiting: (await queue.count()) };
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    if (!msg || typeof msg !== 'object') return { error: 'Nothing asked.' };
    // How things stand: the Vault, where a clip can land, what waits.
    if (msg.kind === 'state') {
      try {
        const status = await api.status();
        let places = null;
        if (status.paired && status.enabled) places = await api.places().catch(() => null);
        return { status, places, queued: await queue.count() };
      } catch (err) {
        return { status: null, error: err.words || err.message, code: err.code, queued: await queue.count() };
      }
    }
    // The open page, read for the popup (its title, what is marked, whether a selection exists).
    if (msg.kind === 'page') {
      const tab = await activeTab();
      if (!tab?.id) return { error: 'No page is open to clip.' };
      try {
        const page = await collect(tab.id);
        return { page: { ...page, html: undefined, images: page.images } };
      } catch (err) {
        return { error: err.message || 'This page cannot be clipped. Try an ordinary web page.' };
      }
    }
    // Paired once with the code Settings shows; waiting clips go straight away.
    if (msg.kind === 'pair') {
      try {
        await api.pair(msg.code);
        const after = await flush().catch(() => ({ sent: 0, waiting: 0 }));
        return { paired: true, flushed: after.sent };
      } catch (err) {
        return { error: err.words || err.message, code: err.code };
      }
    }
    // A clip sent (kept waiting when the Vault is not running).
    if (msg.kind === 'clip') {
      const tab = await activeTab();
      if (!tab?.id) return { error: 'No page is open to clip.' };
      let page;
      try {
        page = await collect(tab.id);
      } catch (err) {
        return { error: err.message || 'This page cannot be clipped. Try an ordinary web page.' };
      }
      const kind = msg.clip?.kind;
      if (kind !== 'article' && kind !== 'selection' && kind !== 'bookmark' && kind !== 'screenshot') return { error: 'Pick what to clip first.' };
      const payload = {
        kind,
        url: page.url,
        title: page.title,
        ...(page.description ? { description: page.description } : {}),
        ...(page.author ? { author: page.author } : {}),
        ...(page.published ? { published: page.published } : {}),
        ...(page.site ? { site: page.site } : {}),
        ...(msg.clip.place ? { place: msg.clip.place } : {}),
        ...(msg.clip.tags?.length ? { tags: msg.clip.tags } : {}),
        ...(msg.clip.note ? { note: msg.clip.note } : {}),
      };
      if (kind === 'article') {
        payload.html = page.html;
        payload.images = [];
        for (const src of page.images.slice(0, 30)) {
          const img = await fetchImage(src).catch(() => null);
          if (img) payload.images.push(img);
        }
      } else if (kind === 'selection') {
        if (!page.selection) return { error: 'Nothing is marked on the page. Mark what to clip first.' };
        payload.html = page.selection.html;
        payload.text = page.selection.text;
        payload.images = [];
        for (const src of page.images.slice(0, 10)) {
          const img = await fetchImage(src).catch(() => null);
          if (img) payload.images.push(img);
          if (payload.images.length >= 10) break;
        }
      } else if (kind === 'bookmark') {
        if (page.image) {
          const img = await fetchImage(page.image).catch(() => null);
          if (img) payload.images = [img];
        }
      } else {
        const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }).catch(() => null);
        if (!shot) return { error: 'The screenshot did not come through. Try again.' };
        payload.screenshot = { url: '', data: shot, type: 'image/png' };
      }
      try {
        const done = await api.clip(payload);
        const after = await flush().catch(() => ({ sent: 0 }));
        return { done, flushed: after.sent };
      } catch (err) {
        // The Vault closed: kept to send when it runs. Anything else is said plainly.
        if (err.code === 'not-running') {
          await queue.add(payload);
          return { queued: true, waiting: await queue.count() };
        }
        return { error: err.words || err.message, code: err.code };
      }
    }
    // Waiting clips sent now.
    if (msg.kind === 'flush') {
      try {
        return await flush();
      } catch (err) {
        return { error: err.words || err.message };
      }
    }
    return { error: 'Nothing asked.' };
  })()
    .then(send)
    .catch((err) => send({ error: err.words || err.message || 'Something went wrong. Try again.' }));
  return true;
});

// Waiting clips go when the Vault runs again (checked every few minutes, and whenever the popup opens).
chrome.runtime.onStartup.addListener(() => void flush().catch(() => undefined));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'nvault-flush') void flush().catch(() => undefined);
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('nvault-flush', { periodInMinutes: 5 }).catch(() => undefined);
});
