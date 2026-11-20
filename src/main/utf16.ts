// One safe way to read UTF-16 (11 Nov 2026, t225: Node's own UTF-16 decode corrupts the heap when the bytes it is
// handed start at an odd offset — decoding subarray(1) as UTF-16 crashed the former host app's runtime with
// STATUS_HEAP_CORRUPTION on a user's and a customer's PC. A subarray's start is only even against its parent: against
// the process heap it can still be odd, so every decode below copies to a fresh even-length buffer first and decodes
// with the platform decoder, never the buffer's own UTF-16 decode. Callers pass the whole buffer with a start; nothing
// else in nv/src decodes UTF-16 (tests/utf16-decode.test.mjs scans for the raw shape)).

const le = new TextDecoder('utf-16le');

/** Fresh even-length copy of buf[start..end]: byte offset 0, so no decoder ever sees an odd start or length. A
 * trailing odd byte is left off, as Node's own decode does (swap16 would throw on it instead). */
function freshEven(buf: Buffer, start: number, end: number): Buffer {
  const s = Math.max(0, Math.min(start | 0, buf.length));
  const e = Math.max(s, Math.min(end | 0, buf.length));
  const take = buf.subarray(s, e);
  const even = take.length - (take.length % 2);
  const out = Buffer.alloc(even);
  take.copy(out, 0, 0, even);
  return out;
}

/** buf[start..end] as little-endian text (a trailing odd byte is left off, never throws). */
export function decodeUtf16le(buf: Buffer, start = 0, end: number = buf.length): string {
  return le.decode(freshEven(buf, start, end));
}

/** buf[start..end] as big-endian text (bytes swapped on the fresh copy, never in place). */
export function decodeUtf16be(buf: Buffer, start = 0, end: number = buf.length): string {
  return le.decode(freshEven(buf, start, end).swap16());
}
