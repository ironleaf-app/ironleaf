#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# One-time GitHub setup for the public Ironleaf repository in the ironleaf-app organisation, run by a maintainer
# ONCE after creating the repository and pushing `main`. Safe to run again: every step either sets a value
# (PUT/PATCH) or checks before it creates something.
#
#   tools/github-setup.sh --dry-run           # print every API call, make none (no network, no gh needed)
#   tools/github-setup.sh                     # do it (needs `gh auth login` as an owner of the organisation)
#   tools/github-setup.sh --repo org/name     # another repository (default ironleaf-app/ironleaf)
#   tools/github-setup.sh --maintainer LOGIN  # who joins the maintainers team (default: the account gh is logged in as)
#
# No person's login is written in this repository: the maintainer is whoever runs the script (or --maintainer).
# The script puts them in the organisation's `maintainers` team (the code owner in .github/CODEOWNERS), keeps their
# organisation membership private, and stores their login in the repository secret MAINTAINER_LOGINS, which the
# CLA check reads (.github/workflows/cla.yml).
#
# Only documented GitHub REST endpoints (API version 2022-11-28) through `gh api`. What each step is for, and the
# rules it sets, are explained in docs/MAINTAINING.md.
#
# Plans: on a PUBLIC repository everything here works on GitHub Free. On a PRIVATE repository, steps marked
# [paid if private] need a paid plan (branch protection and rulesets: Pro/Team; secret scanning and push
# protection: GitHub Secret Protection; private vulnerability reporting: public repositories only; environment
# required reviewers: Enterprise for private). Those steps warn and carry on instead of stopping the script.
set -euo pipefail

REPO=ironleaf-app/ironleaf
TEAM=maintainers
MAINTAINER=""
DRY=0

# Required status checks on main: the CI jobs (.github/workflows/ci.yml, job `check`, one per OS) and the CLA job
# (.github/workflows/cla.yml, job `cla`). 15368 is the GitHub Actions app: only checks reported by Actions count.
CHECKS=("check (ubuntu-latest)" "check (windows-latest)" "cla")
ACTIONS_APP_ID=15368

DESCRIPTION="Free, open-source notes app: plain Markdown on your PC with Today, projects, people, meetings, a graph and an MCP server for any AI."
HOMEPAGE="https://ironleaf.kaitiaki-it.com"
TOPICS=(notes markdown note-taking knowledge-base local-first electron desktop-app mcp graph agpl)

CLA_BRANCH=cla-signatures
CLA_FILE=signatures/version1/cla.json

usage() { sed -n '4,19p' "$0" | sed 's/^# \{0,1\}//'; }

while (($#)); do
  case $1 in
    --dry-run) DRY=1 ;;
    --repo) REPO=${2:?--repo needs owner/name}; shift ;;
    --repo=*) REPO=${1#--repo=} ;;
    --maintainer) MAINTAINER=${2:?--maintainer needs a GitHub login}; shift ;;
    --maintainer=*) MAINTAINER=${1#--maintainer=} ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if ((DRY)); then
  echo "DRY RUN for $REPO: showing the API calls; nothing is sent."
else
  command -v gh >/dev/null || { echo "gh (GitHub CLI) is not installed." >&2; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first (as an owner of ${REPO%%/*})." >&2; exit 1; }
  echo "Setting up $REPO"
fi
ORG=${REPO%%/*}
if ((DRY)); then ME='<your-login>'; else ME=$(gh api user --jq .login); fi
MAINTAINER=${MAINTAINER:-$ME}

WARNINGS=()
step() { printf '\n== %s\n' "$*"; }
warn() { WARNINGS+=("$*"); printf '   WARNING: %s\n' "$*"; }

# gh api with the documented headers. Prints the call (and body) first; in dry-run stops there.
#   call METHOD PATH [JSON-BODY]     -> prints the response body on stdout (dry-run: nothing)
call() {
  local method=$1 path=$2 body=${3-}
  printf '   %s /%s\n' "$method" "$path" >&2
  [[ -n $body ]] && printf '%s\n' "$body" | sed 's/^/       /' >&2
  ((DRY)) && return 0
  local args=(api --method "$method" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "$path")
  if [[ -n $body ]]; then printf '%s' "$body" | gh "${args[@]}" --input -; else gh "${args[@]}"; fi
}
# Same, output discarded.
run() { call "$@" >/dev/null; }
# Same, but a failure (paid plan, feature not available) only warns.
soft() {
  local label=$1; shift
  run "$@" || warn "$label failed (see above). It may need a paid plan for a private repository; set it by hand in Settings."
}
# GET that answers "does it exist?" quietly. Dry-run: says it would check and answers "no".
exists() {
  printf '   GET /%s (exists?)\n' "$1" >&2
  ((DRY)) && return 1
  gh api -H "X-GitHub-Api-Version: 2022-11-28" "$1" >/dev/null 2>&1
}
# GET one value with gh's built-in jq filter. Dry-run: prints a placeholder.
value() {
  local path=$1 filter=$2 placeholder=$3
  printf '   GET /%s (%s)\n' "$path" "$filter" >&2
  if ((DRY)); then printf '%s' "$placeholder"; return 0; fi
  gh api -H "X-GitHub-Api-Version: 2022-11-28" "$path" --jq "$filter"
}
# POST/PUT that returns the new object's sha. Dry-run: prints a placeholder.
sha_of() {
  local method=$1 path=$2 body=$3 placeholder=$4
  printf '   %s /%s\n' "$method" "$path" >&2
  printf '%s\n' "$body" | sed 's/^/       /' >&2
  if ((DRY)); then printf '%s' "$placeholder"; return 0; fi
  printf '%s' "$body" | gh api --method "$method" -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" "$path" --input - --jq .sha
}
json_list() { local out="" x; for x in "$@"; do out+="${out:+,}\"$x\""; done; printf '[%s]' "$out"; }

# --- 0. The repository and main must exist --------------------------------------------------------------------------
step "Check the repository and its main branch"
VISIBILITY=$(value "repos/$REPO" .visibility public)
echo "   visibility: $VISIBILITY"
[[ $VISIBILITY == public ]] || warn "The repository is $VISIBILITY: steps marked [paid if private] may fail on a free plan."
if ((DRY)); then
  printf '   GET /%s (exists? the script stops here if main has not been pushed)\n' "repos/$REPO/branches/main"
elif ! exists "repos/$REPO/branches/main"; then
  echo "There is no 'main' branch in $REPO yet. Push it first: git push -u origin main" >&2
  exit 1
fi

# --- 0b. The maintainers team, its member, and the member's privacy ---------------------------------------------------
# The team is the code owner (.github/CODEOWNERS). CODEOWNERS only accepts a visible team, so it is "closed" (seen by
# organisation members, not by the public); who is in it is not public either. The maintainer's own membership of the
# organisation is set to private, so their account is not listed on the organisation's public page.
step "Team $ORG/$TEAM (closed), $MAINTAINER in it, membership private"
if exists "orgs/$ORG/teams/$TEAM"; then
  echo "   team already there"
else
  run POST "orgs/$ORG/teams" "{\"name\": \"$TEAM\", \"description\": \"Ironleaf maintainers: code owners of the repository\", \"privacy\": \"closed\"}"
fi
run PUT "orgs/$ORG/teams/$TEAM/memberships/$MAINTAINER" '{"role": "maintainer"}'
run PUT "orgs/$ORG/teams/$TEAM/repos/$REPO" '{"permission": "admin"}'
# Conceal: only the member themselves can do this, so it works when the maintainer runs the script as themselves.
if [[ $MAINTAINER == "$ME" ]]; then
  run DELETE "orgs/$ORG/public_members/$MAINTAINER"
else
  warn "$MAINTAINER must hide their own organisation membership: github.com/orgs/$ORG/people, Organization visibility: Private."
fi
TEAM_ID=$(value "orgs/$ORG/teams/$TEAM" .id '<team-id>')

step "Repository secret MAINTAINER_LOGINS (the CLA check's allowlist; a secret so run logs mask it)"
printf '   gh secret set MAINTAINER_LOGINS --repo %s\n' "$REPO" >&2
if ((!DRY)); then printf '%s' "$MAINTAINER" | gh secret set MAINTAINER_LOGINS --repo "$REPO" >/dev/null; fi

# --- 1. Repository settings -----------------------------------------------------------------------------------------
step "Default branch main; squash merge only; delete merged branches; no wiki or projects; description"
run PATCH "repos/$REPO" "$(cat <<EOF
{
  "default_branch": "main",
  "description": "$DESCRIPTION",
  "homepage": "$HOMEPAGE",
  "has_issues": true,
  "has_wiki": false,
  "has_projects": false,
  "allow_squash_merge": true,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "allow_auto_merge": false,
  "allow_update_branch": true,
  "delete_branch_on_merge": true,
  "squash_merge_commit_title": "PR_TITLE",
  "squash_merge_commit_message": "PR_BODY"
}
EOF
)"

step "Topics"
run PUT "repos/$REPO/topics" "{\"names\": $(json_list "${TOPICS[@]}")}"

# --- 2. Actions: read-only token by default, only the actions we use, approval for outside contributors -------------
step "Actions: default GITHUB_TOKEN read-only; workflows may not approve pull requests"
run PUT "repos/$REPO/actions/permissions/workflow" \
  '{"default_workflow_permissions": "read", "can_approve_pull_request_reviews": false}'

# GitHub's own actions (actions/*, github/*), the CLA action and Dependabot's. Adding another action to a workflow
# means adding it here (or in Settings > Actions > General).
step "Actions: allow only GitHub's own actions, the CLA action and Dependabot"
run PUT "repos/$REPO/actions/permissions" '{"enabled": true, "allowed_actions": "selected"}'
run PUT "repos/$REPO/actions/permissions/selected-actions" \
  '{"github_owned_allowed": true, "verified_allowed": false, "patterns_allowed": ["contributor-assistant/github-action@*", "dependabot/*"]}'

step "Actions: workflows from outside contributors' pull requests wait for a maintainer's approval"
soft "Fork pull request approval policy" PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" \
  '{"approval_policy": "all_external_contributors"}'

# --- 3. Security features -------------------------------------------------------------------------------------------
step "Secret scanning and push protection [paid if private]"
soft "Secret scanning / push protection" PATCH "repos/$REPO" "$(cat <<'EOF'
{
  "security_and_analysis": {
    "secret_scanning": {"status": "enabled"},
    "secret_scanning_push_protection": {"status": "enabled"}
  }
}
EOF
)"

step "Dependabot alerts and security updates"
run PUT "repos/$REPO/vulnerability-alerts"
run PUT "repos/$REPO/automated-security-fixes"

step "Private vulnerability reporting [public repositories only]"
soft "Private vulnerability reporting" PUT "repos/$REPO/private-vulnerability-reporting"

# --- 4. CLA signatures branch ---------------------------------------------------------------------------------------
# The CLA action stores signatures in $CLA_FILE on $CLA_BRANCH. The branch must exist and must not need pull
# requests (the action commits to it). It is created as an orphan branch holding only the (empty) signatures file:
# CLA Assistant Lite v2.6.1 does not create the file itself when it is missing.
step "CLA signatures branch '$CLA_BRANCH' with an empty $CLA_FILE"
if exists "repos/$REPO/git/ref/heads/$CLA_BRANCH"; then
  echo "   already there; left as it is"
else
  CONTENT='{\n  \"signedContributors\": []\n}\n'
  TREE=$(sha_of POST "repos/$REPO/git/trees" \
    "{\"tree\": [{\"path\": \"$CLA_FILE\", \"mode\": \"100644\", \"type\": \"blob\", \"content\": \"$CONTENT\"}]}" '<tree-sha>')
  COMMIT=$(sha_of POST "repos/$REPO/git/commits" \
    "{\"message\": \"CLA: create the signatures file\", \"tree\": \"$TREE\", \"parents\": []}" '<commit-sha>')
  run POST "repos/$REPO/git/refs" "{\"ref\": \"refs/heads/$CLA_BRANCH\", \"sha\": \"$COMMIT\"}"
fi

step "Ruleset: '$CLA_BRANCH' cannot be deleted or force-pushed (the action's normal commits still work) [paid if private]"
RULESET='{
  "name": "cla-signatures",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["refs/heads/'"$CLA_BRANCH"'"], "exclude": []}},
  "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}]
}'
RULESET_ID=$(value "repos/$REPO/rulesets" '.[] | select(.name == "cla-signatures") | .id' '' || true)
if [[ -n $RULESET_ID ]]; then
  soft "Ruleset for $CLA_BRANCH" PUT "repos/$REPO/rulesets/$RULESET_ID" "$RULESET"
else
  soft "Ruleset for $CLA_BRANCH" POST "repos/$REPO/rulesets" "$RULESET"
fi

# --- 5. Environment for the (disabled) release workflow -------------------------------------------------------------
step "Environment 'release': a maintainer approves each run; main only [paid if private]"
soft "Environment 'release'" PUT "repos/$REPO/environments/release" "$(cat <<EOF
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [{"type": "Team", "id": ${TEAM_ID}}],
  "deployment_branch_policy": {"protected_branches": true, "custom_branch_policies": false}
}
EOF
)"

# --- 6. Branch protection on main -----------------------------------------------------------------------------------
step "Protect main [paid if private]: PR + 1 code-owner approval, checks, linear history, no force-push or deletion"
CHECKS_JSON=""
for c in "${CHECKS[@]}"; do CHECKS_JSON+="${CHECKS_JSON:+, }{\"context\": \"$c\", \"app_id\": $ACTIONS_APP_ID}"; done
# enforce_admins false: a maintainer (an admin) can still push a hotfix or merge without waiting, on purpose.
soft "Branch protection on main" PUT "repos/$REPO/branches/main/protection" "$(cat <<EOF
{
  "required_status_checks": {"strict": true, "checks": [${CHECKS_JSON}]},
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
EOF
)"

# --- Done -----------------------------------------------------------------------------------------------------------
step "Done"
if ((DRY)); then echo "   Dry run: nothing was changed."; fi
cat <<'EOF'
   Still by hand, when the time comes (Settings in the browser):
   - Release workflow: put IRONLEAF_UPDATE_SIGNING_KEY in Environments > release > secrets, then remove `false &&`
     from .github/workflows/release.yml.
   - Check Settings > Branches > main shows the three required checks once CI and the CLA check have run once.
EOF
if ((${#WARNINGS[@]})); then
  printf '\n   %d warning(s):\n' "${#WARNINGS[@]}"
  printf '   - %s\n' "${WARNINGS[@]}"
fi
