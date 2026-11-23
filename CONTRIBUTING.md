# Contributing to Ironleaf

Thank you for helping. Ironleaf is open source (AGPL-3.0-or-later) and maintained by Kaitiaki IT Pty Ltd.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Security problems: do not open an issue; see [SECURITY.md](SECURITY.md).
- Be kind: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Set up

```bash
npm ci
npm run dev        # the app with hot reload
```

Node.js 22 or later. Never commit `node_modules`, build output (`out/`, `dist/`), a real vault, recordings or
screenshots of real notes. Test fixtures are always made up.

## Guidance for people and coding agents

- [AGENTS.md](AGENTS.md): the brief every coding agent works from (Claude Code reads it through `CLAUDE.md`).
- [docs/DESIGN.md](docs/DESIGN.md): how Ironleaf looks, feels and reads: tokens, spacing, density, controls, words.
- Modern Web Guidance (a pinned devDependency): `npx modern-web-guidance search "<what you are building>"` before
  writing UI, so the platform does the work instead of extra JavaScript.
- `tests/ui-ratchet.test.mjs` holds the line: hard-coded colours, raw spacing, `!important`, clickable elements with no
  role and legacy web patterns may only go down.

## Checks

```bash
npm run typecheck
npm run build
npm run test:fast  # what CI runs on Linux and Windows
npm test           # everything, including UI walks (Linux: xvfb-run -a npm test)
```

A pull request needs typecheck, build and `test:fast` green on Linux and Windows, and the CLA check passed. Add or update tests for what you change: most checks
bundle the TypeScript they test with rolldown (see any `tests/*.test.mjs`) and need no window.

## Pull requests

What happens to a pull request: CI and the CLA check run (for a first-time contributor, CI starts once a maintainer
approves the run), the maintainer reviews it, and it is squash-merged into `main` as one commit. Every change needs
the maintainer's approval; see [docs/MAINTAINING.md](docs/MAINTAINING.md).

- One topic per pull request, with a short description of what changes for the person using Ironleaf.
- Keep the clean-room rules ([docs/CLEAN-ROOM.md](docs/CLEAN-ROOM.md)): write from scratch, use only open formats, no
  other app's code, text, icons or assets. Every new asset goes in [ASSETS.md](ASSETS.md) with its licence.
- New dependencies must be under a licence compatible with AGPL-3.0-or-later; run `npm run notices` and commit the
  updated `THIRD_PARTY_NOTICES.md`.
- Words in the app are plain Australian English.
- No telemetry, no analytics, no network call the person did not ask for.

## Licence headers

The repository licence ([LICENSE](LICENSE)) applies to every file unless the file says otherwise. New source files
start with `// SPDX-License-Identifier: AGPL-3.0-or-later` (or the comment form of the language). Existing files
without the line are covered by the repository licence; we add the line when a file is next touched rather than in
one sweeping change.

## Contributor licence agreement

Before we can merge your first pull request we need a signed **Contributor Licence Agreement** ([CLA.md](CLA.md)).
You keep the copyright in your contribution; the CLA gives Kaitiaki IT the right to distribute it under the AGPL and
under other licences, which is what lets us offer a commercial licence to organisations that cannot use the AGPL
while keeping Ironleaf itself free and open source.

Signing takes one comment. On your first pull request the CLA check posts a comment and fails until you have
signed. Read [CLA.md](CLA.md), then reply on the pull request with exactly:

```
I have read the CLA Document and I hereby sign the CLA
```

The check records your GitHub username with the date and pull request, then passes. You sign once; later pull
requests pass straight away. If the check does not update, comment `recheck`. Everyone who authored a commit in the
pull request must sign, so make your commits with the email address of your GitHub account. If you contribute for
your employer, they may need to sign the entity version: ask in your pull request.

There is no DCO: the CLA is the only sign-off needed, and no `Signed-off-by:` line is required on commits.
