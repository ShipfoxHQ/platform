---
"@shipfox/api-integration-github": minor
---

Adds the `create_branch` agent tool to the GitHub integration catalog. The tool
creates a branch via `POST /repos/{owner}/{repo}/git/refs` from a commit oid or
an existing branch name, requires the `contents: write` GitHub permission, and
reports existing or unresolvable source refs as `provider-rejected` errors.
