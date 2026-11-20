# Plugins, a first small door

Added 31 Oct 2026. Code: `src/shared/plugins.ts` (manifest, permissions, views), `src/main/plugins.ts` (the manager
and sandbox), `src/main/plugin-example.ts` (the Word count example), Settings › Plugins, `src/renderer/src/state/plugins.ts`.

## What a plugin is

A folder in the vault's plugins folder (`.neuralvault/plugins/` inside the vault: open it from Settings › Plugins ›
Add your own › Open plugins folder), with two files:

- `plugin.json`, the manifest: its id, name, what it wants.
- `plugin.js`, the one script: `activate(api)` adds a command to the palette and a card to Home.

```json
{
  "id": "word-count",
  "name": "Word count",
  "version": "1.0.0",
  "description": "How many words your notes hold, on Home.",
  "permissions": ["read-notes"],
  "command": { "id": "count", "title": "Count words in notes" },
  "card": { "id": "count", "title": "Word count" }
}
```

Ids are lowercase, numbers and dashes. Permissions are `read-notes` and `write-notes`: that is all there is. Secrets
and Private notes are never on offer: the API refuses them before a script's code sees them.

## The API

`activate` gets one object, `api`. It can be async. Everything answers in words when it cannot be done.

| Call | What it does |
| ---- | ------------ |
| `await api.listNotes()` | Every note's path (never Private notes). Needs `read-notes`. |
| `await api.readNote(path)` | A note as written. Needs `read-notes`. |
| `await api.writeNote(path, text)` | Replace a note that is there (a project's file is refused: change it on the project's page). Needs `write-notes`. Every write shows a toast with Undo, and File recovery keeps the earlier version either way. |
| `api.toast(words)` | Say something in the corner. |
| `api.addCommand({ id, title }, handler)` | One command in the palette (`handler` can be async). |
| `api.setCard(handler)` | Home's card: `handler` returns `{ title, lines }` (up to six plain lines), drawn each time Home opens. |

The script runs in a sandbox: no `require`, no files, no network, no timers. `console.log` writes to Ironleaf's log
with the plugin's name. A script that runs too long (5 seconds straight, 15 for a handler) is stopped. A crash anywhere
(starting, a command, a card) is logged and shown in words; the app is never taken down.

## On, allowed, removed

- Off until switched on in Settings › Plugins.
- Switching one on the first time asks for it, with what it wants. A plugin whose folder changed since it was allowed
  goes off and asks again.
- Remove moves its folder to the Recycle Bin, where it can be brought back.

## The example, line by line

Word count (`src/main/plugin-example.ts`, written into every new plugins folder, off until switched on) counts the words
in every note:

- `module.exports.activate = async (api) => { … }`: what Ironleaf calls once the plugin is on.
- `api.listNotes()` then `api.readNote(p)` for each: the count, Private notes never included.
- `api.setCard(async () => ({ title: 'Word count', lines: […] }))`: Home's card.
- `api.addCommand({ id: 'count', title: 'Count words in notes' }, …)`: the palette command, answering with a toast.

## What this door does not open yet

One command and one card per plugin; notes only (no packs, no projects, no files); no settings of its own; no timers or
background work. Each is a later door, kept small the same way.
