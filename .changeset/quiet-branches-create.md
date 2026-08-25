---
"@shipfox/api-integration-github": minor
---

Adds the `create_branch` agent tool to the GitHub integration catalog. The tool
creates a branch via `POST /repos/{owner}/{repo}/git/refs` from a commit oid or
an existing branch name. It requires the `contents: write` GitHub permission.
Existing branches that already point at the requested commit are reused; other
conflicts are reported as `provider-rejected` errors.
