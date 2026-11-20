# Ironleaf Clipper (Chrome and Edge)

Clip the open page into your Vault notes: the whole page as a clean article, the marked part only, a bookmark, or a screenshot of the visible page. Pick where it lands, add tags and a note. The extension talks only to your own PC (the Vault listening on 127.0.0.1), paired once with the code in Vault Settings under Quick add and Web clipper. When the Vault is closed, clips wait and send when it runs.

## Load it for now (unpacked)

1. Open Vault Settings, Quick add, Web clipper, and choose Show the folder. This folder opens.
2. In Chrome, open `chrome://extensions`. In Edge, open `edge://extensions`.
3. Switch on Developer mode (top right in Chrome, left side in Edge).
4. Choose Load unpacked and pick this folder.
5. Pin the clipper to the toolbar, open it on any page, and enter the pairing code from Settings. Once only.

## Files

- `manifest.json`: Manifest V3 for Chrome and Edge.
- `popup.html`, `popup.css`, `popup.js`: the popup (states: finding the Vault, pairing, clipping).
- `background.js`: the worker (reads the tab, fetches its pictures, sends, keeps what waits).
- `content.js`: reads the open page, only while clipping.
- `api.js`: talks to the Vault on this PC (ports, pairing token, plain words on failure).
- `queue.js`: clips waiting for the Vault.

The publishing step (the Chrome Web Store and Edge Add-ons) is still to come. These files are the whole extension.
