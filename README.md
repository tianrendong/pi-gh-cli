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

## Tools

- `gh_issue` — list/view/create/comment/edit/close/reopen issues
- `gh_pr` — list/view/checks/diff/create/comment/review/merge/close/reopen/ready/checkout/update_branch PRs
- `gh_repo` — view/list/default/create/edit repositories
- `gh_run` — list/view/watch/rerun/cancel/download GitHub Actions runs
- `gh_workflow` — list/view/run/enable/disable workflows
- `gh_api` — structured authenticated `gh api` requests
- `gh_auth_status` — read-only auth check, never shows tokens

## Safety

- Uses argument arrays, not shell strings.
- Defaults to `gh --json` fields where available.
- State-changing actions require interactive confirmation, or `confirm=true` in non-interactive mode.
- Output truncates to Pi defaults: 2000 lines or 50KB. Full output is saved to a temp file when truncated.

## Examples

Ask Pi:

> List open PRs in this repo

> Show failed logs for latest failing Actions run

> Comment on issue #123 with this summary

For GitHub endpoints not covered by the specific tools, use `gh_api`.
