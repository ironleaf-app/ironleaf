# Ironleaf version history

What changed in each version, newest first, in plain words. The app shows this list in Settings › About and
updates, and adds any newer release from https://ironleaf.kaitiaki-it.com/download/versions.json when it can reach
the website. `tools/release.mjs` takes a release's notes from here when `--notes` is not given.

Format: one `## <version> — <YYYY-MM-DD>` heading a release, then one `- ` line a change.

## 2.0.17 — 2026-11-24

- Skills: ready-made know-how the assistant loads when a job needs it. Built in: Word documents, Excel workbooks, PowerPoint decks, PDFs, designed documents, meeting minutes, project status reports, organising notes and making a skill. Settings › AI › Skills switches each on or off.
- Your own skills: a folder in your notes with a SKILL.md. Ask the assistant to “make that a skill”, start one with New skill, make a built-in one yours, or bring in one someone published (its SKILL.md, or a .zip or .skill file) with Add a skill. Skills are words only: nothing in one is ever run.
- The assistant makes a new Word document, Excel workbook (with working formulas) or PowerPoint deck at once, in your brand kit, kept with the project or note it is for.
- Claude Desktop, Cursor and other AI apps connected to Ironleaf see the same skills: as tools, and as prompts to pick by name.

## 2.0.16 — 2026-11-23

- One design language across the app: one spacing scale, quieter menus and dialogs, one strong button per page, and every screen checked at a normal window, a 2560 px monitor and in dark.
- Meetings: a past meeting without a recording no longer leaves a tall empty pane; actions, people and decisions sit side by side, and minutes give decisions and actions room together.
- Settings, Packs, Keyboard shortcuts and What Ironleaf can do use a wide window in columns instead of one narrow strip; the red "!" tile on Home cards is gone.
- Today's columns end together on a big monitor, Inbox captures read as rows with a fairer list width, and the weekly review is flat and easy to scan.
- Empty pages sit at the page's edge with a clear next step, and Locked is a calm two-part screen.
- Long names in the breadcrumb and the Files panel are no longer cut off.
- In dark, a switch that is on shows its knob again, and drop-downs keep room for their arrow.
- Typing Chinese, Japanese or Korean: Enter now confirms the characters instead of submitting, renaming or closing mid-word.

## 2.0.15 — 2026-11-23

- Slide decks look like a consultancy made them on the first pass: type set at slide size, one frame on every slide, an at-a-glance slide of key figures, and one highlight colour for the point that matters. Content grows to fill the room under each headline, and the PowerPoint file matches. Decks take about half the AI tokens they did.
- Meetings without minutes give the side panel the whole row, and a meeting's title lines up with the list it opens from.
- Long names in the account menu, About's version history and the side rail are cut cleanly instead of trailing dots.
- Packs at a wide window: a quiet section's week and figures use the rest of its line.

## 2.0.14 — 2026-11-22

- Design with AI is one click away: a Design button beside Share on every note, project and meeting.
- Designs save as PowerPoint, Word and Excel as well as PDF. Slides become a PowerPoint deck that looks like the design, with every word still editable; reports, one-pagers, proposals, handouts and posters become a branded Word document; a note's tables and key figures become an Excel workbook whose totals are live formulas. Ask the chat for any of them too.
- The design check also catches figures squeezed out of their columns and numbers broken across lines.

## 2.0.13 — 2026-11-22

- Design with AI gets it right first time: one well-planned draft, with a further pass only when a page measures as broken, so a design is ready in about half the time on about half the AI tokens.
- Designed pages keep an even spacing rhythm instead of spreading sections apart, and a page that is a little too full is fitted above its footer.

## 2.0.12 — 2026-11-22

- Opening a Markdown file from outside the vault no longer opens it in tab after tab, and a window that had piled up those tabs opens cleanly again.
- New: Design with AI. Turn a note into a finished report, one-pager, proposal, handout, poster or slide deck in your brand kit, saved as a PDF. Your own AI lays out the pages, Ironleaf prints and checks every page, and you can ask for changes in plain words. The note itself is never changed.

## 2.0.11 — 2026-11-21

- AI replies can no longer be broken by a doubly patched model library (the build's patch step now patches once, whatever state it finds).
- Meetings: a long summary in the minutes card reads as short paragraphs, and the word-correction box keeps its 360 px width.
- Chat: a long title under an answer's sources wraps instead of being cut mid-word.

## 2.0.10 — 2026-11-21

- Project pages: Notes and files (and every other long tab) scrolls again on a big window; opening a big project and switching its tabs no longer freezes for a second or two.
- Lists stay quick while they change: Today, Tasks and Notes do their style work in milliseconds instead of seconds as rows come and go.
- Choosing a template at a 1600 px window shows its preview again.
- A person's page fills a small window again instead of a narrow column.

## 2.0.9 — 2026-11-21

- PDFs open about four times faster, and zooming and scrolling a big PDF no longer freeze the window: the page you're looking at is drawn first, and the selectable words are laid in one go.

## 2.0.8 — 2026-11-21

- PDFs zoom smoothly: the pages stretch at once and sharpen when you stop, instead of every page being laid out again for each step of the wheel.
- The window no longer gets stuck busy (and stops scrolling) when a PDF's scrollbar comes and goes.

## 2.0.7 — 2026-11-20

- Security updates: Electron 44.11.5 (it no longer trusts certificates from a compromised authority), and patched versions of the Markdown, diagram (mermaid) and maths (KaTeX) libraries.

## 2.0.6 — 2026-11-20

- Tidier sample and help text throughout, and plain Ironleaf wording in the AI library's network messages.
- The licence in the project files now reads AGPL-3.0, as the app is.

## 2.0.5 — 2026-11-20

- An update that is announced but not on the website yet no longer sends you to the website: About says it isn't ready to download yet, and Ironleaf tries again at its next check.
- AI apps connected through `ironleaf mcp` no longer start their own update, plan or policy checks; only the Ironleaf window does.
- Under a team or organisation policy, Settings offers only the AI connections and the MCP access that policy allows.
- Publications no longer offer sending through a chat bot that isn't part of Ironleaf.
- A smaller, faster app: the shipped code is minified.

## 2.0.4 — 2026-11-20

- Ironleaf Sync: your notes on every PC, end-to-end encrypted with your own passphrase (the server never sees names or contents). Settings › Backups and sync. Needs a Sync plan.
- Ironleaf Teams: shared team vaults, members and roles, invites, and the team's policy applied on every member's PC. Settings › Teams. Needs a Teams plan.
- Your account at the bottom left: your name and plan, with one menu for Account and plan, billing, Settings, About and Sign out.
- Supporter shows as yours to keep, not as a date.

## 2.0.3 — 2026-11-20

- Sign in to Ironleaf (optional): Settings › Account and plan shows your plan, devices and billing. Your notes never need an account.
- Supporter badge, and plans for Sync and Teams are ready for when they launch.
- Updates are now signed: Ironleaf only installs an update signed with Kaitiaki IT's release key.
- Security: images in notes can no longer point at network shares; linked files keep their place on each PC, and programs never open from a click.
- Safer updates: the installer is checked again just before it runs, and a check during a download can't mix up versions.
- Files a drive can't read keep their place in search and their open tabs.
- The old built-in agent connections are removed; Connect an AI is unchanged.

## 2.0.2 — 2026-11-20

- Made for big screens, including ultrawide: list pages are full-height panes (list, the item itself, and what it connects to), and nothing stops half-way down the window.
- Every layout is fluid, from a small laptop to a 3440-wide ultrawide, with the chat panel open or closed.
- The meeting page fills the window: the minutes, the recording and transcript in their own full-height pane, and the words to check and links beside them.
- Today uses three balanced columns on a wide screen.
- Meetings opens on your newest meeting with content, and the voices are one row above the transcript.
- Notes grow with the window; task lists, decisions and tables use the full width.

## 2.0.1 — 2026-11-20

- Pages are composed to fill the window: Today puts your work on the left and your day on the right in balanced columns, and long lists fold into one row ("167 tasks with no date · Review").
- One Meetings card on Today, with New meeting and Record a meeting in its header.
- Files and assets: one row of filters with dropdowns for the rest; the Brand kit shows its preview, details and logos side by side.
- Padding inside every card, row and panel, so nothing sits against an edge.
- Settings › Help › About and updates: your version, a clear update button with progress, what's new, and the full version history. The version also shows at the foot of the sidebar.
- Fixed: the assistant could not list the notes in a folder or see what changed recently.
- Files a drive refuses to read (such as cloud-only OneDrive files) are skipped instead of stopping a folder list.

## 2.0.0 — 2026-11-20

- Ironleaf is its own app now, renamed from NeuralVault. Your notes, settings and shortcuts came across as they were, and earlier installs update in place.
- AI runs on your own connection: Anthropic, OpenAI, Gemini, Ollama or any OpenAI-compatible service, with your own key. Nothing goes through anyone else.
- An MCP server built in, so Claude, ChatGPT, Cursor, VS Code and other AI apps can read your notes, and write to them when you allow it.
- Ironleaf keeps running in the tray when you close the window, so reminders, backups, sync and AI access carry on.
- Updates come into the app: it checks once a day, downloads in the background with its progress shown, checks the file, and asks you to restart. Small fixes download only what changed.
- Pages use one width system: no more wide empty bands on big screens, and Settings and lists use the room well.
- Faster, safer imports: a vault of 1,600 notes comes in in seconds, and an import never rewrites what it brings in.
- Data safety: a rename keeps what you type during it, a delete waits until the Bin has the file, and a case-only rename never replaces another file.
- "Ask before the assistant changes a note" is on by default for new installs.

## 1.0.3 — 2026-11-17

- A switch at the top of the window for moving between related apps (taken out again in 2.0.0).

## 1.0.2 — 2026-11-17

- Fixes from a full audit: every way to link notes is listed, updates install silently with their progress shown, and no console windows flash up on Windows.

## 1.0.1 — 2026-11-16

- Its own icon on the taskbar and in the installer, and branded installer pages.

## 1.0.0 — 2026-10-16

- The first full version: tabs and split views, Live Preview, note properties, a full file list, canvases, the graph, search with operators, file recovery, PDF export, slides and Settings in sections.

## 0.1.0 — 2026-10-16

- The first working version.
