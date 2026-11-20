# The ironleaf command, ironleaf:// links and files from outside the vault

Gap G26, added 21 Oct 2026. Code: `src/shared/cli.ts`, `src/shared/uri.ts`, `src/main/cli.ts`, `src/main/external.ts`,
`src/main/loose-files.ts` and `src/main/windows-entry.ts`.

## Where it is set up

Each time an installed Ironleaf starts on Windows, it adds these for the current Windows user only. That means
`HKCU\Software\Classes` and the user's own PATH, so no administrator is needed. It writes only what is missing or
different. A development copy does this only when
`NV_REGISTER_WINDOWS=1`.

- **ironleaf:// links**: `HKCU\Software\Classes\ironleaf`, and `HKCU\Software\Classes\neuralvault` for the old
  `neuralvault://` links (kept from before the rename to Ironleaf; both open the same way).
- **Open with › Ironleaf** for `.md` and `.markdown`: a `Ironleaf.Markdown` ProgID listed under each extension's
  `OpenWithProgids`. It never takes over the person's own default app.
- **The command**: `ironleaf.cmd` and `ironleaf.ps1` in Ironleaf's data folder under `bin`, and the same scripts as
  `neuralvault.cmd` and `neuralvault.ps1` (the command's name before the rename, kept so scripts and AI apps set up
  with `neuralvault mcp` keep working). That folder is
  added to the user's PATH, keeping the PATH's existing type (`REG_EXPAND_SZ`), and Windows is told the PATH changed.

A host that embeds Ironleaf can pass other arguments in `launchArgs`. `unregisterWindows()` removes all of it.
Ironleaf listens for `second-instance` itself once it is running.

## The command

```
ironleaf open <note>                                  open a note in Ironleaf's window
ironleaf read <note>                                  print a note as written
ironleaf search <words> [--limit 10]                  search ("phrases", OR, -word, tag:#x, path:folder)
ironleaf create <path> [--text <words>] [--open]      make a note (text can come in on the pipe)
ironleaf append <note> <words> [--heading <h>]        add to the end of a note, or under a heading
ironleaf daily:append <words> [--heading <h>]         add to today's note
ironleaf property:set <note> <name> <value> [--list]  set a property (an empty value removes it)
ironleaf tasks [--done | --all] [--note <note>]       list tick-boxes
ironleaf mcp                                        run the Vault's MCP server for other AI apps (used by their
                                                       set-up, not typed by hand)
ironleaf help [verb] | version
```

You can name a note by its title (`"Site walk"`) or by its path (`"Meetings/Site walk.md"`). Exit codes are `0` for
done, `1` when it couldn't be done (the reason goes to stderr), and `2` when the command was written wrongly.

**How it works:**

- The running Ironleaf listens on `127.0.0.1`, on a random port. It writes the port and a secret to `cli.json` in
  its own data folder, never in the notes.
- The script reads that file and POSTs `{args, stdin}` to `/cli` with the header `x-neuralvault-cli: <secret>`.
- Ironleaf refuses any request that has no secret, has the wrong secret, carries an `Origin` header, or has a
  `Host` other than 127.0.0.1. So a web page can't use it.
- If Ironleaf isn't running, the script starts it and waits up to 60 seconds.

**What the verbs do:**

- The verbs are the same ones agents use (`AgentAccess.asPerson`: `vault_search`, `note_read`, `note_create`,
  `note_append`), run as the person.
- Nothing waits for approval, and nothing is logged as an agent's.
- File recovery keeps every earlier version.

**`mcp` (the Vault as a connector, 31 Oct 2026):** Claude Code, Claude Desktop, Cursor and VS Code on this PC run
`ironleaf mcp` from their set-up (Settings › Agents › Use the Vault from other AI apps shows the exact JSON for
each). The script then bridges stdio: each stdin line is one JSON-RPC message, POSTed to `/mcp` on the same local
connection (same secret and Host checks as `/cli`), each answer line written to stdout. Code: `src/shared/mcp-local.ts`
(the fixed tools and set-up JSON), `src/main/mcp-local.ts` (the JSON-RPC speaking), `AgentAccess.asLocalMcp` (the same
dispatch agents use, with the person's switch and Read only / Read and write honoured, every change in What agents did
with Undo). Off until switched on. Typed by hand it says where to go instead of bridging.
- Private notes are never reached.
- A project's file is changed only on its project page.

## Links

| link | what it does | asks first |
| --- | --- | --- |
| `ironleaf://open` | opens the app | never |
| `ironleaf://open?note=<title or path>` | opens the note | never |
| `ironleaf://note?path=<vault-relative path>` | opens the note (other apps' form; never outside the vault) | never |
| `ironleaf://capture?text=<words>` | makes a note in the Inbox and opens it | yes |
| `ironleaf://search?q=<words>` | opens Search with the words | never |
| `ironleaf://new?name=<title>&folder=<folder>&text=<words>` | makes a note (a free name, never over another) and opens it | yes |
| `ironleaf://append?note=<note>&text=<words>&heading=<h>` | adds to a note | yes |
| `ironleaf://daily?text=<words>&heading=<h>` | adds to today's note | yes |

`neuralvault:open?…` and `ironleaf:///open?…` work too. Anything else is ignored, and the window says why.

**Before a link changes anything**, Ironleaf asks. The question names the note and shows the words it would add,
and **Cancel** is the default button.

**Skipping the question:**

- Ticking "Don't ask again for links that …" allows that kind of link from then on.
- The person can change this in Settings › Files and links › Links from other apps and the command line.
- The list is kept in `links.json` in Ironleaf's data folder. It starts empty, so every link that changes notes asks.

## Files from outside the vault

You can open a `.md` file (also `.markdown` and `.txt`) from outside the vault in three ways:

- **Open with › Ironleaf** in File Explorer. The program gets `--neuralvault-open=<path>` as one argument.
- **Drag it onto the window.**
- **Open a Markdown file from this PC…** (Ctrl+Shift+O, also on the command list, under More and in the File menu).

**How it behaves:**

- It opens in a tab of its own, with Ironleaf's editor, and is saved where it is a moment after each change.
- It doesn't join the notes (no index, links or graph) unless the person chooses **Copy into your notes**.
- The window can read and save it only by the number Ironleaf gave it when it was opened, never by a path.
- A file that is already inside the vault opens as the note it is.
