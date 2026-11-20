// Files attached to the assistant's chat, made ready where they are dropped, pasted or chosen (src/shared/chat-attach.ts):
// a picture drawn again at a sensible size (at most 1600 px on its longest side; a small PNG or JPEG kept exactly as it
// is), a document read for its words by Ironleaf's main process from the bytes handed over here, and a PDF with no
// words of its own (a scan) drawn here, its first pages as pictures, with the PDF.js the Files grid uses.

import { ATTACH_LIMITS, isPicture } from '../../../shared/chat-attach';
import type { ChatAttachment } from '../../../shared/types';
import { pdfjs } from './pdfThumb';

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('It couldn’t be read.'));
    reader.readAsDataURL(blob);
  });
}

async function picture(file: File, name: string): Promise<ChatAttachment> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That picture couldn’t be opened.');
  }
  const edge = Math.max(bitmap.width, bitmap.height);
  // Already fine as it is: a PNG or JPEG of a sensible size goes exactly as it is.
  if (/^image\/(png|jpeg)$/.test(file.type) && edge <= ATTACH_LIMITS.imageEdge && file.size <= 1_500_000) {
    bitmap.close();
    return { id: newId(), name, kind: 'image', size: file.size, mediaType: file.type, data: await base64Of(file) };
  }
  const scale = Math.min(1, ATTACH_LIMITS.imageEdge / edge);
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d')!;
  g.drawImage(bitmap, 0, 0, w, h);
  // A screenshot stays a PNG (its words stay sharp) while it is small; a photo becomes a JPEG on white.
  let blob = file.type === 'image/jpeg' ? null : await canvas.convertToBlob({ type: 'image/png' });
  if (!blob || blob.size > 1_500_000) {
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
  }
  bitmap.close();
  return { id: newId(), name, kind: 'image', size: blob.size, mediaType: blob.type, data: await base64Of(blob) };
}

/** A scan's first pages as JPEG pictures (white behind, 1400 px on the longest side): the pictures and its page count. */
async function scanPages(bytes: Uint8Array): Promise<{ pages: { mediaType: string; data: string }[]; pageCount: number }> {
  const m = await pdfjs();
  const task = m.getDocument({ data: bytes, isEvalSupported: false, disableAutoFetch: true, disableStream: true });
  try {
    const doc = await task.promise;
    const pages: { mediaType: string; data: string }[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, ATTACH_LIMITS.scanPages); n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, 1400 / Math.max(base.width, base.height, 1)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      if (blob) pages.push({ mediaType: 'image/jpeg', data: await base64Of(blob) });
    }
    return { pages, pageCount: doc.numPages };
  } finally {
    void task.destroy().catch(() => {});
  }
}

/** A pasted picture's name ("Pasted picture 02:30:00 pm.png"): the one namer for a note attach and a canvas
 *  drop (10.0 second round N17), so the same action names the same. The main side's cleanFileName makes it safe
 *  to save. */
export function pastedPictureName(ext: string = 'png'): string {
  return `Pasted picture ${new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.${ext}`;
}

/** One file made ready to send, or why it can't be attached (in words for the person). */
export async function prepareAttachment(file: File): Promise<ChatAttachment> {
  // A pasted screenshot has no name of its own.
  const name = file.name && file.name !== 'image.png' ? file.name : pastedPictureName();
  if (file.size > ATTACH_LIMITS.fileBytes) throw new Error('It is too big to attach (60 MB at most).');
  if (isPicture(name, file.type)) return picture(file, name);
  if (file.type.startsWith('image/') || /\.(heic|heif|tiff?|svg|psd|raw|cr2|nef)$/i.test(name)) throw new Error('This kind of picture can’t be sent. Save it as a PNG or JPEG and attach that.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The main process takes its own copy (the bytes are sent across), so a scan can still be drawn from these.
  const r = await window.nv.ai.attachmentText(name, bytes);
  if ('error' in r && r.scanned) {
    const scan = await scanPages(bytes).catch(() => null);
    if (!scan?.pages.length) throw new Error(r.error);
    return { id: newId(), name, kind: 'pages', size: file.size, pages: scan.pages, pageCount: scan.pageCount, cut: scan.pageCount > scan.pages.length };
  }
  if ('error' in r) throw new Error(r.error);
  return { id: newId(), name, kind: 'text', size: file.size, text: r.text, cut: r.cut };
}

/** "2.4 MB", "640 KB". */
export function sizeWords(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
