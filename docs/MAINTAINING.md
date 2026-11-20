# Maintaining Ironleaf

How changes from outside get into Ironleaf, who says yes, how releases are made and how security reports are
handled. The GitHub settings behind this are made by `tools/github-setup.sh` (run once by a maintainer after creating
the repository in the `ironleaf-app` organisation; `--dry-run` shows every call it would make).

## Who approves

The maintainers: the `@ironleaf-app/maintainers` team, the code owner of every file
([.github/CODEOWNERS](../.github/CODEOWNERS)). Nothing reaches `main` without a maintainer's approving review.

Who is on the team is not published: the team is visible to organisation members only, and each maintainer keeps
their organisation membership private (`tools/github-setup.sh` sets both). The CLA check exempts the maintainers
by login, read from the repository secret **`MAINTAINER_LOGINS`** (comma-separated GitHub logins, e.g.
`login-one,login-two`), never from a file in the repository. It is a secret rather than a variable because a public
workflow log prints a step's inputs and only secrets are masked there. `tools/github-setup.sh` sets it to the
maintainer it adds; when the team changes, update it in Settings › Secrets and variables › Actions, or with
`gh secret set MAINTAINER_LOGINS --repo ironleaf-app/ironleaf`.

An AI assistant may read a pull request, run the checks, summarise what it changes and recommend approve or "changes
needed". It never approves, merges or closes a pull request itself, and GitHub Actions is not allowed to approve
pull requests. A maintainer reads the summary and the diff and clicks **Approve** and **Squash and merge**.

## How an outside change flows

1. **Issue first** for anything bigger than a small fix, so the approach is agreed before work starts
   ([CONTRIBUTING.md](../CONTRIBUTING.md)).
2. **Pull request** from the contributor's fork to `main`, using the pull request template.
3. **Workflows wait for approval.** For contributors from outside, GitHub holds the CI run until a maintainer clicks
   "Approve and run" on the pull request. Look at the diff first, especially anything under `.github/`, `tools/`
   or `package.json`, since CI runs that code.
4. **CI** (`.github/workflows/ci.yml`): typecheck, build, the fast tests and the licence check, on Linux and
   Windows. Pull requests from forks get a read-only token and no secrets.
5. **CLA check** (`.github/workflows/cla.yml`): a contributor who has not signed [CLA.md](../CLA.md) is asked to
   reply on the pull request with *"I have read the CLA Document and I hereby sign the CLA"*. The signature is kept
   in `signatures/version1/cla.json` on the `cla-signatures` branch, so each person signs once, for all their
   pull requests. The maintainers and bots (Dependabot) are exempt. The check never runs the pull request's code.
6. **Review** by a maintainer. Branch protection on `main` requires: one approving review from the code owner, the
   checks `check (ubuntu-latest)`, `check (windows-latest)` and `cla` passing, the branch up to date with `main`,
   and every review conversation resolved. A new push after approval dismisses the approval, so a maintainer always
   approves the code that is merged.
7. **Squash merge.** Squash is the only merge button: one commit on `main` per pull request, with the pull request's
   title and description as the message, and a linear history. The branch is deleted after merging.

Nobody can force-push to `main` or delete it. As administrators the maintainers can still push a hotfix straight
to `main` or merge their own pull request without a second reviewer; use this for urgent fixes, not as the normal
path.

## Dependency updates

Dependabot opens grouped pull requests every Monday ([.github/dependabot.yml](../.github/dependabot.yml)): one for
all minor and patch npm updates, one per major update, one for GitHub Actions. They go through CI and a maintainer's
review like any other change. Security alerts and automatic security updates are on. `@earendil-works/pi-ai` is
left out on purpose: it is patched by `tools/patch-pi-ai.mjs` and upgraded by hand.

Workflows pin every action to a full commit SHA, and the repository only allows GitHub's own actions, the CLA
action and Dependabot's. Adding another action means allowing it in Settings › Actions › General (or in
`tools/github-setup.sh`).

## Releases

Releases are cut from `main` only, by a maintainer, with `npm run release` on a build machine:
see [RELEASING.md](RELEASING.md). Bump the version and the changelog in a pull request first, merge it, then
release from that commit on `main`. The release workflow on GitHub (`.github/workflows/release.yml`) is switched off
until code signing and a publish target are set up; when it is turned on, its signing key lives in the `release`
environment, which only runs from `main` and waits for a maintainer's approval.

## Security reports

Security problems are reported privately, never in a public issue: through GitHub's private vulnerability reporting
(the repository's Security tab, "Report a vulnerability") or by email, as described in
[SECURITY.md](../SECURITY.md). The maintainers acknowledge within 3 working days, assess within 10, prepare the fix
in a private security advisory (with a temporary private fork when needed), release it, then publish the
advisory and credit the reporter unless they would rather not be named. Secret scanning with push protection
stops keys and tokens from being pushed by accident.
