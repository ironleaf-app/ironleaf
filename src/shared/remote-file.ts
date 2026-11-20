// SPDX-License-Identifier: AGPL-3.0-or-later
// A picture's address that would make this PC reach another computer for a file (security review, 20 Nov 2026).
// A note that says ![](//host/x.png), ![](\\host\share\x.png) or ![](file://host/share/x.png) would, in a window shown
// from file://, open an SMB connection to that host on Windows, which sends the person's sign-in (an NTLM hash) to
// it. The window draws a "blocked remote file" placeholder for these instead; the main side cancels any such request
// that still gets through (src/main/file-url-guard.ts).

/** True for a protocol-relative or UNC address (//host/…, \\host\…) and a file: address naming a host. */
export function isRemoteFileSource(src: string): boolean {
  let s = String(src ?? '').trim();
  // Percent-encoded slashes and backslashes are read as what they are (%5C%5Chost is \\host to the browser).
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(s); i++) {
    try {
      s = decodeURIComponent(s);
    } catch {
      break;
    }
  }
  // Tabs and newlines inside an address are dropped by the URL parser, and backslashes read as slashes.
  s = s.replace(/[\t\n\r]/g, '').replace(/\\/g, '/');
  if (s.startsWith('//')) return true;
  const file = /^file:(.*)$/i.exec(s);
  if (!file) return false;
  const rest = file[1];
  if (!rest.startsWith('//')) return false;
  if (rest.startsWith('////')) return true; // file:////host/share: UNC
  const host = rest.slice(2).split('/')[0];
  return host !== '' && host.toLowerCase() !== 'localhost';
}

/** The words a blocked picture shows in place of itself. */
export const BLOCKED_REMOTE_FILE = 'Blocked remote file';
