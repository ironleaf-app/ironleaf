# Working on Ironleaf (for AI coding agents and the people steering them)

Ironleaf is an Electron + React 19 + TypeScript notes app (AGPL-3.0-or-later). This file is the brief every coding
agent works from: Claude Code reads it through `CLAUDE.md`, and Codex, Cursor, Gemini and others read `AGENTS.md`
directly. People: [CONTRIBUTING.md](CONTRIBUTING.md) has the same rules in long form.

## The three sources of guidance

1. **Modern Web Guidance** (Chrome team, Apache-2.0) for anything in the window: HTML, CSS, layout, forms, dialogs,
   popovers, accessibility, performance, security. Before writing or changing UI, search it and follow the guide:

   ```bash
   npx modern-web-guidance search "light dismiss dialog"   # 2–5 words, one capability, no framework names
   npx modern-web-guidance retrieve <id>[,<id>]
   ```

   It is a devDependency, pinned, so it works offline. Claude Code also loads it as a plugin
   (`.claude/settings.json`). Never add a library or hand-written JavaScript for something the platform does
   (`<dialog>`, `popover`, `:has()`, container queries, anchor positioning, view transitions, `field-sizing`).
2. **[docs/DESIGN.md](docs/DESIGN.md)**: Ironleaf's own design rules: tokens, spacing, type, colour emphasis,
   elevation, density at wide windows, words. They draw on the ideas of Meta's Astryx design system and on
   Anthropic's frontend-design guidance, written for this app.
3. **The house rules in the tests.** `npm run test:fast` enforces them (for example: CSS sets capitals, never
   `toUpperCase`; nothing cut off with "..."; no dead white space at wide windows). A failing rule test is the rule
   speaking: change the code, not the test, unless the behaviour was changed on purpose.

## Runtime policy (what you may use)

- **The app's window is Electron's Chromium only** (`electron` in package.json). Any HTML, CSS or JS feature that
  Chromium ships may be used **without fallbacks or polyfills**; Modern Web Guidance's Safari/Firefox fallbacks do not
  apply inside the app. Feature-detect only what Electron itself gates.
- **Pages people open in their own browser** (the printable and published pages Ironleaf writes, and anything
  shared) follow Baseline Widely available, with the guide's fallbacks.
- Node APIs only in `src/main` and `src/preload`; the renderer talks to them through the preload bridge.

## The UI ratchet

`tests/ui-ratchet.test.mjs` counts what the guidance says to move away from, against `tests/ui-ratchet.json`:
hard-coded colours outside `palettes.css`, raw pixel spacing instead of the `--space-*` scale, `!important`,
clickable elements with no role, and every Modern Web Guidance `legacy-scan` finding in `src/renderer`.
**A count may only go down.** When your change lowers one, lower the number in `tests/ui-ratchet.json` in the same
commit (the test tells you the new figure). Never raise a number to make the test pass.

## Before you hand back

```bash
npm run typecheck
npm run test:fast        # Linux and Windows CI run exactly this
```

For UI changes, look at the screen as well as the tests: run the app (`npm run dev`) and check it at a narrow
window (about 1000 px) and a wide one (about 2560 px), in the light and dark palettes, with the keyboard alone.

## Public-repository rules

- No credentials, tokens, keys, hostnames, IP addresses or server paths in code, tests, comments or commits.
  Endpoints come from settings or the person's own configuration.
- No real notes, people, companies or machines in fixtures or comments: test data is made up.
- Clean room: [docs/CLEAN-ROOM.md](docs/CLEAN-ROOM.md). New dependencies need an AGPL-compatible licence and
  `npm run notices`.
- Words in the app are plain Australian English, sentence case, written for the person using it (they manage
  "notifications", not "webhook config").
