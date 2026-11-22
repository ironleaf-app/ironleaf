# Publishing the public repository: checklist

The exact steps to put Ironleaf on GitHub at `github.com/ironleaf-app/ironleaf`, private first, then public,
with the 2.0.13 installers on a GitHub release. Run them in order from the private checkout that holds the
`public-main` branch (one orphan commit, authored `Ironleaf <noreply@kaitiaki-it.com>`). Each step says what
"done" looks like; stop at the first one that does not match.

Needs: `git`, `gh` (logged in as an owner of the `ironleaf-app` organisation: `gh auth login`), `node` 22, `curl`,
`jq`, `sha256sum`. The repository lives in the organisation, never under a personal account, and nothing in it
names a person: the code owner is the `@ironleaf-app/maintainers` team and the CLA exemption reads the repository
secret `MAINTAINER_LOGINS` (docs/MAINTAINING.md).

```bash
REPO=ironleaf-app/ironleaf
```

## 1. Check the branch you are about to push

```bash
git log --format='%H %an <%ae> %s' public-main            # exactly one commit, author Ironleaf <noreply@kaitiaki-it.com>
git rev-list --count public-main                         # 1
git ls-tree -r --name-only public-main | grep -E '^(docs/walk|tools/shots)' || echo "clean"   # clean
git show public-main:package.json | jq -r .version       # 2.0.13
```

## 2. Create the repository, private

The organisation `ironleaf-app` must exist (github.com/organizations/plan, the Free plan). Hide your own membership
of it straight away (the setup script does it again in step 4):

```bash
gh api --method DELETE "orgs/ironleaf-app/public_members/$(gh api user -q .login)"
```

```bash
gh repo create "$REPO" --private \
  --description "Free, open-source notes app: plain Markdown on your PC with Today, projects, people, meetings, a graph and an MCP server for any AI." \
  --homepage https://ironleaf.kaitiaki-it.com
```

Done when `gh repo view "$REPO" --json visibility -q .visibility` prints `PRIVATE`. Do not add a README, licence
or .gitignore on GitHub: the repository must be empty.

## 3. Push public-main as main (and nothing else)

```bash
git push "https://github.com/$REPO.git" public-main:refs/heads/main
```

Push this one refspec only: never `--all`, `--mirror` or `--tags` (the private history and branches stay private).
Done when `gh api "repos/$REPO/branches" -q '.[].name'` prints only `main`.

## 4. Run the one-time GitHub setup

From a checkout of `public-main` (the script is in the tree):

```bash
tools/github-setup.sh --dry-run --repo "$REPO"   # read every call first; nothing is sent
tools/github-setup.sh --repo "$REPO"
```

It creates the `maintainers` team (closed: visible to organisation members only), adds you to it as a maintainer
with admin rights on the repository, sets your organisation membership to private, stores your login in the
repository secret `MAINTAINER_LOGINS` for the CLA check, and sets the default branch, merge rules, description, homepage and topics, Actions permissions, security features,
the `cla-signatures` branch, the `release` environment and branch protection on `main` (docs/MAINTAINING.md says
why). While the repository is private, steps marked "[paid if private]" may only warn; step 7 runs it again.

Check the privacy and the code owner:

```bash
gh api orgs/ironleaf-app/public_members -q '.[].login'     # prints nothing: no member is public
gh api "repos/$REPO/codeowners/errors" -q '.errors'          # []: the team in CODEOWNERS is valid
gh secret list --repo "$REPO"                                # MAINTAINER_LOGINS is listed
```

Any later commit you push must not carry a personal name or address either. In your checkout of the public
repository: `git config user.name Ironleaf` and `git config user.email noreply@kaitiaki-it.com`. GitHub still shows
which account merged a pull request, published a release or approved a run, so do those from an account whose
login and profile name no one can tie to a person (a dedicated maintainer account is simplest).

## 5. Check CI

The push in step 3 starts the CI workflow (`.github/workflows/ci.yml`: `npm ci`, typecheck, build,
`npm run test:fast` on Ubuntu and Windows, and the licence check on Ubuntu).

```bash
gh run list --repo "$REPO" --workflow ci.yml --limit 3
gh run watch --repo "$REPO" "$(gh run list --repo "$REPO" --workflow ci.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Done when both jobs, `check (ubuntu-latest)` and `check (windows-latest)`, are green. If one is red, read the log
(`gh run view --repo "$REPO" --log-failed`), fix it on the private branch, re-cut `public-main` and force-push it
(still private, so a force-push is harmless): `git push --force "https://github.com/$REPO.git" public-main:refs/heads/main`.
If the run did not start, `gh workflow run ci.yml --repo "$REPO" --ref main`.

## 6. Look at the repository page as a visitor would

```bash
gh browse --repo "$REPO"
```

The README renders with its badges (the release badge says "no releases" until step 8) and the four screenshots in
`docs/images/`; LICENSE is detected as AGPL-3.0; the Security tab shows SECURITY.md.

## 7. Make it public

```bash
gh repo edit "$REPO" --visibility public --accept-visibility-change-consequences
tools/github-setup.sh --repo "$REPO"     # again: the public-only features (secret scanning, push protection,
                                         # private vulnerability reporting, branch protection) now apply
```

Done when `gh repo view "$REPO" --json visibility -q .visibility` prints `PUBLIC` and the setup ends without
warnings.

## 8. The GitHub release with the 2.0.13 installers

Download the installers the website serves, and check them against `latest.json` and its signature before uploading:

```bash
mkdir -p release-2.0.13 && cd release-2.0.13
BASE=https://ironleaf.kaitiaki-it.com/download
curl -fsSLO "$BASE/latest.json" && curl -fsSLO "$BASE/latest.json.sig"
jq -r .version latest.json                                   # 2.0.13
WIN=$(jq -r .windows.versioned latest.json)                  # Ironleaf-Setup-2.0.13.exe
LNX=$(jq -r .linux.versioned latest.json)                    # Ironleaf-2.0.13.AppImage
curl -fsSLO "$BASE/$WIN" && curl -fsSLO "$BASE/$LNX"
echo "$(jq -r .windows.sha256 latest.json)  $WIN" | sha256sum -c -
echo "$(jq -r .linux.sha256 latest.json)  $LNX"   | sha256sum -c -
# The signature, with the release key the app embeds (run from the checkout root, one level up):
(cd .. && node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  import { verifyLatest, embeddedUpdateKey } from './tools/update-sign.mjs';
  const ok = await verifyLatest(readFileSync('release-2.0.13/latest.json', 'utf8'), readFileSync('release-2.0.13/latest.json.sig', 'utf8'), embeddedUpdateKey('.'));
  console.log(ok ? 'signature OK' : 'SIGNATURE BAD'); process.exit(ok ? 0 : 1);")
sha256sum "$WIN" "$LNX" > SHA256SUMS
```

Done when both `sha256sum -c` lines say `OK` and the signature check prints `signature OK`. Then the release notes
(the 2.0.13 section of CHANGELOG.md) and the release itself, tagged on `main`:

```bash
awk '/^## 2\.0\.4 /{on=1; next} /^## /{if(on) exit} on' ../CHANGELOG.md > notes.md
cat >> notes.md <<'EOF'

**Download:** Windows `Ironleaf-Setup-2.0.13.exe`, Linux `Ironleaf-2.0.13.AppImage` (below, or from
https://ironleaf.kaitiaki-it.com/download/). Installed copies update themselves; every update is signed with
Kaitiaki IT's release key. SHA-256 sums are in `SHA256SUMS`.
EOF
gh release create v2.0.13 --repo "$REPO" --target main --title "Ironleaf 2.0.13" --notes-file notes.md --latest \
  "$WIN" "$LNX" SHA256SUMS
```

Done when `gh release view v2.0.13 --repo "$REPO"` lists the three files and the README's release badge shows
`v2.0.13`. The in-app updater keeps reading the website's `latest.json`; the GitHub release is for people who look
for downloads on GitHub.

## 9. Description and topics

`tools/github-setup.sh` sets them (its `DESCRIPTION`, `HOMEPAGE` and `TOPICS`). To set or change them by hand:

```bash
gh repo edit "$REPO" \
  --description "Free, open-source notes app: plain Markdown on your PC with Today, projects, people, meetings, a graph and an MCP server for any AI." \
  --homepage https://ironleaf.kaitiaki-it.com \
  --add-topic notes,markdown,note-taking,knowledge-base,local-first,electron,desktop-app,mcp,graph,agpl
```

## After launch

- Watch the first pull requests: CI runs on every one, and the `cla` check asks first-time contributors to sign.
- Dependabot (`.github/dependabot.yml`) opens update pull requests weekly; CI must pass before they merge.
- Later releases: tag and upload the same way (step 8) after `tools/release.mjs` has published to the website.
