// The extra far-side capture's contained process (6 Nov 2026, m6-any-speaker-capture: a call on any output, not just
// the Windows default). Chromium's loopback hears only the default speakers; this captures the missed output's loopback
// (WASAPI, through the vendored native-recorder-nodejs) and sends 16 kHz mono sound to the manager. It runs apart from
// the app — Electron's utility process in the product, a fork anywhere else — so a crash here is an exit code, never a
// lost recording: the manager's died path carries the meeting on as it is today.
//
// Shipped verbatim beside the embed (tools/build-embedded.mjs copies this file); plain CommonJS with only Node's own
// modules, so it loads wherever the child runs. argv[2] is the vendored library's folder. Speaks over the utility
// process's parent port, else fork IPC. Never requires anything when the library is missing: it says `unavailable' and
// leaves cleanly.
'use strict';
const path = require('node:path');

const vendor = process.argv[2] || '';
const port = typeof process.parentPort !== 'undefined' && process.parentPort ? process.parentPort : null;
const post = (m) => {
  try {
    if (port) port.postMessage(m);
    else if (process.send) process.send(m);
  } catch {
    // The manager is gone; nothing more to say.
  }
};
if (port) port.on('message', (e) => void onMessage(e && e.data));
else process.on('message', (m) => void onMessage(m));
// A fork whose manager died takes nothing with it.
process.on('disconnect', () => process.exit(0));
process.on('uncaughtException', () => {
  // A last word if the channel still takes one; out either way.
  try {
    if (port) {
      post({ t: 'error', message: 'the extra capture stopped' });
      process.exit(1);
    } else if (process.send) {
      process.send({ t: 'error', message: 'the extra capture stopped' }, () => process.exit(1));
    } else {
      process.exit(1);
    }
  } catch {
    process.exit(1);
  }
});

let Api = null;
try {
  const lib = require(path.join(vendor, 'dist', 'index.js'));
  Api = lib && lib.AudioRecorder ? lib.AudioRecorder : null;
  if (!Api) throw new Error('no AudioRecorder');
} catch {
  Api = null;
}
/** A last word sent first: fork IPC only flushes on its own tick, so an exit straight after would eat it. */
function postAndExit(m, code) {
  if (port) {
    post(m);
    process.exit(code);
  } else if (process.send) {
    process.send(m, () => process.exit(code));
  } else {
    process.exit(code);
  }
}
if (!Api) {
  postAndExit({ t: 'unavailable', reason: 'its sound library could not be loaded' }, 0);
  return;
}
post({ t: 'ready' });
// Alive while quiet too (a silent route sends no sound): the manager's watch tells quiet from dead by this.
const tick = setInterval(() => post({ t: 'tick' }), 2000);
if (tick.unref) tick.unref();

/** 16-bit stereo-or-more sound at the device's rate, as one mono float frame each. */
function toMono(data, channels) {
  const frames = Math.floor(data.length / 2 / Math.max(1, channels));
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data.readInt16LE((f * channels + c) * 2) / 0x8000;
    mono[f] = sum / channels;
  }
  return mono;
}

/** Mono sound at one rate made into 16 kHz (each new sample the average of the old ones it covers; a lower rate takes
 *  the nearest sample). Speech loses nothing. */
function to16k(mono, from) {
  const to = 16000;
  if (from === to) return mono;
  if (from < to) {
    const out = new Float32Array(Math.floor((mono.length * to) / from));
    for (let i = 0; i < out.length; i++) out[i] = mono[Math.min(mono.length - 1, Math.floor((i * from) / to))];
    return out;
  }
  const ratio = from / to;
  const out = new Float32Array(Math.floor(mono.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(mono.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += mono[j];
    out[i] = b > a ? sum / (b - a) : (mono[a] ?? 0);
  }
  return out;
}

const rmsOf = (mono) => {
  if (!mono.length) return 0;
  let sum = 0;
  for (let i = 0; i < mono.length; i++) sum += mono[i] * mono[i];
  return Math.sqrt(sum / mono.length);
};

/** Samples per sound message (about a quarter of a second): few messages, each worth sending. */
const FRAME = 4096;
let capture = null;
let format = null;
let pending = new Float32Array(0);
let seq = 0;
const probes = new Map();
let probeTimer = null;

async function stopRecorder(rec) {
  try {
    await rec.stop();
  } catch {
    // Already stopped or never started.
  }
}

async function stopCapture() {
  if (capture) {
    const rec = capture;
    capture = null;
    await stopRecorder(rec);
  }
  pending = new Float32Array(0);
}

async function stopProbes() {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  const recs = [...probes.values()];
  probes.clear();
  for (const rec of recs) await stopRecorder(rec);
}

function sendFrame() {
  while (pending.length >= FRAME) {
    const frame = pending.subarray(0, FRAME);
    pending = pending.subarray(FRAME);
    const pcm = Buffer.alloc(FRAME * 2);
    for (let i = 0; i < FRAME; i++) {
      const s = Math.max(-1, Math.min(1, frame[i]));
      pcm.writeInt16LE(Math.round(s * 0x7fff), i * 2);
    }
    seq++;
    post({ t: 'audio', seq, pcm, rms: Math.round(rmsOf(frame) * 10000) / 10000 });
  }
}

async function onMessage(m) {
  const t = m && m.t;
  if (t === 'devices') {
    try {
      const devices = Api.getDevices().map((d) => ({
        id: String(d && d.id ? d.id : ''),
        name: String(d && d.name ? d.name : ''),
        type: d && d.type === 'input' ? 'input' : 'output',
        isDefault: (d && d.isDefault) === true,
      }));
      post({ t: 'devices', devices });
    } catch (err) {
      post({ t: 'error', message: 'the speakers could not be listed' });
    }
  } else if (t === 'probe' && Array.isArray(m.ids)) {
    await stopCapture();
    await stopProbes();
    for (const id of m.ids.slice(0, 6)) {
      if (typeof id !== 'string' || !id) continue;
      try {
        const rec = new Api();
        const fmt = Api.getDeviceFormat(id);
        probes.set(id, rec);
        rec.on('data', (data) => {
          if (!probes.has(id)) return;
          post({ t: 'level', id, rms: Math.round(rmsOf(toMono(data, fmt.channels || 2)) * 10000) / 10000 });
        });
        rec.on('error', () => {
          probes.delete(id);
          post({ t: 'level', id, rms: 0 });
        });
        await rec.start({ deviceType: 'output', deviceId: id });
      } catch {
        post({ t: 'level', id, rms: 0 });
      }
    }
    // Probes never run past their welcome (the manager stops them sooner).
    probeTimer = setTimeout(() => void stopProbes(), 10000);
    if (probeTimer.unref) probeTimer.unref();
  } else if (t === 'probe-stop') {
    await stopProbes();
    post({ t: 'probed' });
  } else if (t === 'start' && typeof m.id === 'string' && m.id) {
    await stopProbes();
    await stopCapture();
    try {
      format = Api.getDeviceFormat(m.id);
    } catch {
      post({ t: 'error', message: 'that speaker could not be opened' });
      return;
    }
    const rate = (format && format.sampleRate) || 48000;
    const channels = (format && format.channels) || 2;
    const rec = new Api();
    capture = rec;
    rec.on('data', (data) => {
      if (capture !== rec) return;
      const mono = to16k(toMono(data, channels), rate);
      const next = new Float32Array(pending.length + mono.length);
      next.set(pending);
      next.set(mono, pending.length);
      pending = next;
      sendFrame();
    });
    rec.on('error', () => {
      // The device went away mid-meeting (unplugged, its profile switched): said, then out, so the manager's died
      // path carries the meeting on with Chromium's sound alone.
      if (capture !== rec) return;
      capture = null;
      postAndExit({ t: 'error', message: 'the extra capture stopped' }, 1);
    });
    try {
      await rec.start({ deviceType: 'output', deviceId: m.id });
    } catch (err) {
      if (capture === rec) capture = null;
      post({ t: 'error', message: err instanceof Error && err.message ? err.message.slice(0, 200) : 'that speaker could not be opened' });
    }
  } else if (t === 'stop') {
    await stopCapture();
    post({ t: 'stopped' });
  } else if (t === 'quit') {
    await stopProbes();
    await stopCapture();
    process.exit(0);
  }
}
