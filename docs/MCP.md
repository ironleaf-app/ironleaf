# Connect an AI: Ironleaf's MCP server

Ironleaf serves your library to any AI app that speaks the Model Context Protocol (MCP): Claude Desktop, Claude
Code, Cursor, VS Code, ChatGPT desktop and others. Nothing else needs to be installed, and nothing leaves this PC
except what the AI app you connect sends to its own service.

Renamed from NeuralVault (20 Nov 2026): set-ups made before the rename keep working. The `neuralvault` command
(`neuralvault mcp`) stays on the PATH beside `ironleaf`, and `neuralvault://note/<path>` resource links are still read.
New set-ups use `ironleaf`; the server now calls itself `ironleaf` (`serverInfo.name`).

- **Off until you switch it on**: Settings › Connect an AI.
- **Read only** (the default) serves the tools that look things up. **Read and write** also serves the tools that
  make and change things.
- **Private notes and Secrets are never reachable**, at either level.
- **Every change is listed** in Settings › Connect an AI › What agents did, with Undo. Deleting goes to the Bin, and
  File recovery keeps earlier versions of every note.
- Left out on purpose: chat, and deleting a whole folder.

## Two ways in

| Way | For | How it is protected |
| --- | --- | --- |
| **stdio**: the app runs `ironleaf mcp` | Claude Desktop, Claude Code, Cursor, VS Code, anything that starts a command | Only programs running as you on this PC can start it. |
| **Local URL**: `http://127.0.0.1:47731/mcp` (Streamable HTTP) | ChatGPT desktop and any app that connects by URL | Listens on 127.0.0.1 only, and every request must carry your token (`Authorization: Bearer <token>`). Off until you switch on Local URL. |

`ironleaf mcp` is a small bridge: it passes each message to the Ironleaf running on this PC (starting it when
it isn't running), so the AI app always sees the library you have open. On Windows the command is `ironleaf` (`neuralvault` also works)
(set up when Ironleaf is installed); on Linux and macOS it is Ironleaf's own program followed by `mcp`
(for example `/opt/Ironleaf/Ironleaf.AppImage mcp`). Settings › Connect an AI shows the exact path on your PC
in each snippet, ready to copy. It needs a desktop session (it is the Ironleaf program itself).

The local URL answers each POST with plain JSON (no event stream; GET answers 405). The port is 47731 unless you
choose another, and **Make a new token** replaces the token (every app given the old one must be given the new one).

## Set-up for each app

Switch on **Connect an AI** first. Replace `<command>` with the path Settings shows, and `<token>` with the token
Settings shows. Restart the AI app after pasting.

### Claude Desktop

Settings › Developer › Edit Config opens `claude_desktop_config.json` (Windows: `%APPDATA%\Claude`, macOS:
`~/Library/Application Support/Claude`, Linux: `~/.config/Claude`).

```json
{
  "mcpServers": {
    "ironleaf": { "command": "<command>", "args": ["mcp"] }
  }
}
```

### Claude Code

One line:

```sh
claude mcp add ironleaf -- <command> mcp
```

or by URL: `claude mcp add --transport http ironleaf http://127.0.0.1:47731/mcp --header "Authorization: Bearer <token>"`.
Or paste into `.mcp.json` in the project:

```json
{
  "mcpServers": {
    "ironleaf": { "command": "<command>", "args": ["mcp"] }
  }
}
```

### Cursor

`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "ironleaf": { "command": "<command>", "args": ["mcp"] }
  }
}
```

By URL: `{ "mcpServers": { "ironleaf": { "url": "http://127.0.0.1:47731/mcp", "headers": { "Authorization": "Bearer <token>" } } } }`.

### VS Code

`.vscode/mcp.json` in the project (or run **MCP: Add Server**):

```json
{
  "servers": {
    "ironleaf": { "type": "stdio", "command": "<command>", "args": ["mcp"] }
  }
}
```

By URL: `{ "servers": { "ironleaf": { "type": "http", "url": "http://127.0.0.1:47731/mcp", "headers": { "Authorization": "Bearer <token>" } } } }`.

### ChatGPT desktop

ChatGPT adds MCP servers by URL: Settings › Connectors › Advanced › Developer mode, then Create. Switch on
**Local URL** in Ironleaf and give ChatGPT the address `http://127.0.0.1:47731/mcp` with the token as a Bearer
token. A ChatGPT that only reaches servers on the internet (not this PC) needs a tunnel to this PC; Ironleaf does
not make one.

### Any other MCP app

Either run the command over stdio:

```json
{
  "mcpServers": {
    "ironleaf": { "command": "<command>", "args": ["mcp"] }
  }
}
```

or connect to `http://127.0.0.1:47731/mcp` (Streamable HTTP) with the header `Authorization: Bearer <token>`.

### Trying it by hand

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"hand","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | <command> mcp
```

## What the server speaks

`initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, `resources/read`
(each note is a resource, `ironleaf://note/<path>`; Private notes are never among them), `prompts/list` and `prompts/get`
(each skill is a prompt: `/word-documents`, `/meeting-minutes` and so on). Every tool has a name, a title, a description and a JSON input schema; a tool that fails answers with
`isError: true` and plain words. While Connect an AI is off the read tools still list (so set-up reads right) and
every call is refused with where to switch it on. More than 10 changes in one call are refused: split them.

## The tools (86)

40 at Read only; all 86 at Read and write. A path is the note's path in the library
(`Notes/Oven service.md`) or its title.

### Notes

| Tool | Needs | What it does |
| --- | --- | --- |
| `vault_overview` | Read only | Start here. How this Ironleaf library is laid out. |
| `note_read` | Read only | Read one note in full (Markdown, its properties first). |
| `notes_list` | Read only | The notes in a folder (each one’s path and the day it last changed, newest first) and the folders inside it. |
| `notes_recent` | Read only | The notes changed in the last days, newest first. |
| `note_create` | Read and write | Make a new note. |
| `note_append` | Read and write | Add text to the end of a note, or under one of its headings (made at the end when it isn’t there). |
| `note_replace` | Read and write | Replace one exact piece of a note’s text (find must appear exactly once). |
| `note_delete` | Read and write | Delete a note (to the Bin; File recovery keeps a copy). |
| `note_write` | Read and write | Replace the whole text of a note (made when it isn’t there). |
| `note_move` | Read and write | Move or rename a note, a file or a folder in the library. |
| `folder_create` | Read and write | Make a folder in the library (and the folders above it as needed). |
| `note_rename` | Read and write | Give a note a new name in the same folder. |

### Search, links, graph, tags and properties

| Tool | Needs | What it does |
| --- | --- | --- |
| `vault_search` | Read only | Search the notes by their words. |
| `connected_to` | Read only | Everything connected to one thing in the vault. |
| `note_links` | Read only | The links in one note (to other notes, with the ones not written yet marked) and its backlinks. |
| `graph_neighbours` | Read only | The graph around one note. |
| `tags_list` | Read only | Every tag in the library with how many notes carry it, most used first. |
| `note_properties` | Read only | A note’s properties (the YAML at its top) as JSON. |
| `meaning_search` | Read only | Search the notes by what they mean, not only their words (the on-device meaning index; word matches first, then notes that say the same thing in other words). |
| `related_notes` | Read only | The notes most related to one note. |
| `note_set_properties` | Read and write | Set a note’s properties (the YAML at its top). |

### Tasks, Today, the daily note and reminders

| Tool | Needs | What it does |
| --- | --- | --- |
| `today_get` | Read only | The person’s day across every project, as compact JSON. |
| `timeline_get` | Read only | Dates across the projects in a window (default 14 days back to 60 days ahead). |
| `tasks_list` | Read only | The tasks across the notes (every tick-box line, reminders too), as the Tasks view lists them. |
| `calendar_get` | Read only | Today’s events from the connected calendar, as Today shows them. |
| `reminders_list` | Read only | Every reminder set in the notes (a task line with a ⏰ time), with its note and when it is due. |
| `capture` | Read and write | Capture a thought or a task as Quick capture does. |
| `daily_note` | Read and write | Today’s daily note. |
| `reminder_set` | Read and write | Remind the person of something at a moment. |
| `note_add_task` | Read and write | Add a task (a tick-box line) to the end of a note, or under one of its headings (made at the end when it isn’t there). |
| `task_set_done` | Read and write | Tick a task off (or untick it) in the note that holds it. |

### Projects

| Tool | Needs | What it does |
| --- | --- | --- |
| `projects_list` | Read only | Every project at a glance, as compact JSON. |
| `project_get` | Read only | One project in full, as compact JSON. |
| `project_files_list` | Read only | The files and folders in a project’s folder. |
| `project_create` | Read and write | Start a new project. |
| `project_set_field` | Read and write | Change one fact of a project. |
| `project_add_next_step` | Read and write | Add a next step to a project. |
| `project_tick_next_step` | Read and write | Tick off a next step (done false puts it back on the list). |
| `project_log_update` | Read and write | Add a line to a project’s Updates (newest first). |
| `project_add_item` | Read and write | Add to a project’s other lists. |
| `project_change_item` | Read and write | Change one line of a project’s list by its number from project_get. |
| `project_remove_item` | Read and write | Remove one line from a project’s list by its number from project_get. |
| `project_save_file` | Read and write | Deliver a file you made (PDF, Word, PowerPoint, Excel, pictures, CSV, Markdown, zip…) into a project, so the person finds it there. |
| `project_set_details` | Read and write | Change what project_set_field doesn’t. |
| `project_move_item` | Read and write | Move one line of a project’s list to another place (numbers from project_get, 1 is the top). |
| `project_archive` | Read and write | Put a finished or dropped project away. |
| `project_pin_file` | Read and write | Pin a file in the project’s folder to its Documents (or unpin it with pinned false), with what it is. |

### People and meetings

| Tool | Needs | What it does |
| --- | --- | --- |
| `meetings_list` | Read only | Meeting notes from the last days, newest first. |
| `meeting_actions` | Read only | The actions in one meeting note, read plainly (what, who, by when), and which are already in a project. |
| `person_open_items` | Read only | What is open with a person. |
| `meeting_items` | Read only | One meeting's items. |
| `people_list` | Read only | The people the library has a page for (a note typed person, or kept in People or Contacts). |

### Templates, canvases and bookmarks

| Tool | Needs | What it does |
| --- | --- | --- |
| `templates_list` | Read only | The library’s templates. |
| `canvas_get` | Read only | Read a canvas (a board of cards and lines). |
| `bookmarks_list` | Read only | The person’s bookmarks. |
| `template_apply` | Read and write | Make a new note from a note template (its path from templates_list). |
| `template_create` | Read and write | Make a new template in the templates folder. |
| `template_from_note` | Read and write | Save an existing note (or a project’s file) as a new template, its own words kept as the shape. |
| `canvas_create` | Read and write | Make a new canvas (a board for laying out ideas, plans and files) with cards and lines on it when given. |
| `canvas_add` | Read and write | Add cards and lines to a canvas. |
| `canvas_change` | Read and write | Change or move cards (by their ids from canvas_get). |
| `canvas_remove` | Read and write | Remove cards or lines from a canvas by their ids (a card’s lines go with it). |

### Files, attachments and export

| Tool | Needs | What it does |
| --- | --- | --- |
| `files_search` | Read only | Search inside the documents in the projects’ folders on this PC (Word, Excel, PowerPoint, PDF, text, CSV). |
| `file_read` | Read only | Read the words of one file in a project’s folder (its project and its path from files_search or project_get). |
| `brand_kit_get` | Read only | The business’s brand kit. |
| `assets_search` | Read only | Find files in the asset store (the library’s logos, pictures, icons, documents, video and audio) by name, tags, collections and description. |
| `files_find` | Read only | Where a file is in Ironleaf, answered from the vault itself. |
| `note_attach_file` | Read and write | Attach a file to a note (a meeting, a person, any note). |
| `note_to_pdf` | Read and write | This is how a person’s note becomes a finished branded PDF, set in their brand kit (their logo, colours and fonts). |
| `design_document` | Read and write | This is how a person’s note becomes a designed document in their brand kit, laid out by the AI, printed and checked page by page: a report (a designed cover, then every word), a one-pager, a proposal, a handout (two pages), a poster, or slides (16:9). |
| `asset_add` | Read and write | Copy a file into the asset store. |
| `asset_update` | Read and write | Change what the asset store says about a file (its path from assets_search). |
| `brand_kit_set` | Read and write | Change the brand kit. |

### Recovery, reviews and tidying

| Tool | Needs | What it does |
| --- | --- | --- |
| `reviews_list` | Read only | The weekly reviews written, newest first (read one with note_read), and when the last one was done. |
| `tidy_list` | Read only | The weekly tidy’s waiting lines. |
| `note_versions` | Read only | The earlier versions File recovery keeps of a note, newest first. |
| `note_version_read` | Read only | The text of one earlier version of a note (its id from note_versions). |
| `tidy_apply` | Read and write | Apply one waiting line of the weekly tidy (its id from tidy_list). |
| `review_draft` | Read and write | Draft this week’s review across every project, as the Weekly review page does. |
| `review_apply` | Read and write | Save a weekly review from a draft (review_draft’s, changed or not). |
| `note_version_restore` | Read and write | Put a note back as it was in an earlier version (its id from note_versions). |

### Skills

Know-how for particular jobs (Settings › AI › Skills): the ones built into Ironleaf and the person’s own, kept in
their notes as a folder with a SKILL.md. An AI sees each skill’s name and what it is for, and loads the full
instructions only when a job needs them.

| Tool | Needs | What it does |
| --- | --- | --- |
| `skills_list` | Read only | Every skill there is, with what each is for. |
| `skill_use` | Read only | Load a skill’s instructions for the job at hand, and the names of its other files. |
| `skill_file` | Read only | Read one of a skill’s other files (a checklist, an example) when its instructions point to it. |
| `skill_save` | Read and write | Save a skill of the person’s own in their notes, or bring one up to date. |
| `office_make` | Read and write | Make a new Word document, Excel workbook or PowerPoint deck at once, in the brand kit, kept with its project or note. |

### Records and packs

Each pack you have switched on (Settings › Packs) adds its own record tools (list, read, add, change), served at
the same two levels. They appear in `tools/list` as soon as the pack is on.

## Where it lives in the code

| File | What |
| --- | --- |
| `src/shared/mcp-local.ts` | The catalogue, the two levels, each app's set-up JSON |
| `src/shared/mcp-tools.ts`, `src/main/mcp-tools.ts` | The MCP-only tools (links, graph, tags, properties, meaning search, people, reminders, bookmarks, ticking a task, versions, rename) |
| `src/main/mcp-local.ts` | JSON-RPC: one handler for stdio and the URL |
| `src/main/mcp-bridge.ts` | `ironleaf mcp`: stdio to the running Ironleaf |
| `src/main/mcp-http.ts` | The local URL (Streamable HTTP, 127.0.0.1, token) |
| `src/main/agent-access.ts` (`asLocalMcp`) | Every call: the switch, the level, Private notes, Undo |
| `src/renderer/src/components/ConnectAiSettings.tsx` | Settings › Connect an AI |
| `tests/mcp-server.test.mjs`, `tests/mcp-local.test.mjs` | The checks |
