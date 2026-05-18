# pi-gh-cli

Structured GitHub CLI (`gh`) tools for Pi agents.

## Install

```bash
pi install npm:pi-gh-cli
```

Or try without installing:

```bash
pi -e npm:pi-gh-cli
```

Requires GitHub CLI:

```bash
gh auth login
```

## Tools (Layer 1 primitives)

One tool per GitHub resource. Agent owns orchestration.

- `gh_issue` — list/view/create/comment/edit/close/reopen issues
- `gh_pr` — list/view/checks/diff/create/comment/review/merge/close/reopen/ready/checkout/update_branch PRs
- `gh_repo` — view/list/default/create/edit repositories
- `gh_run` — list/view/watch/rerun/cancel/download GitHub Actions runs
- `gh_workflow` — list/view/run/enable/disable workflows
- `gh_release` — list/view/create/edit/delete/upload/download releases
- `gh_label` — list/create/edit/delete/clone labels
- `gh_search` — repos/issues/prs/code/commits search
- `gh_secret` — list/set/delete Actions/Codespaces/Dependabot secrets
- `gh_variable` — list/get/set/delete Actions variables
- `gh_gist` — list/view/create/edit/delete/clone gists
- `gh_api` — escape-hatch authenticated `gh api` requests (REST + GraphQL)
- `gh_auth_status` — read-only auth check, never shows tokens

## Result envelope

Each tool returns:

- `content[0].text` — formatted stdout (JSON pretty-printed when possible)
- `details.command` — full `gh` argv
- `details.parsed` — parsed JSON if applicable
- `details.actionClass` — `read` | `local_mutation` | `github_mutation` | `destructive`
- `details.warnings` — e.g. missing repo on mutation, unread pagination
- `details.nextSuggested` — hints for follow-up calls
- `details.fullOutputPath` — set when truncated

## Safety

- Argument arrays, no shell quoting.
- Defaults to `gh --json` fields where available; pass `fields=` to override.
- Tools never request interactive confirmation. State-changing actions run non-interactively when invoked.
- Destructive actions (`delete`) auto-pass `--yes`; caller intent gates tool invocation.
- Output truncates to Pi defaults: 2000 lines or 50KB. Full output saved to a temp file when truncated.
- Bodies/notes/secrets accept `bodyFile` / `notesFile` to avoid shell quoting and accidental logging.

## Agent usage patterns

Read before write:

1. `gh_pr` `action=view` with `fields=number,title,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup,headRefOid`
2. Decide based on returned state.
3. `gh_pr` `action=merge` with `mergeMethod=squash` and `matchHeadCommit=<headRefOid>`.

Always pass `repo=OWNER/REPO` for mutations to avoid current-directory inference.

For endpoints not covered, use `gh_api`. Prefer the typed tool when available.

## Examples

Ask Pi:

> List open PRs in this repo

> Show failed logs for latest failing Actions run

> Comment on issue #123 with this summary

For GitHub endpoints not covered by the specific tools, use `gh_api`.
