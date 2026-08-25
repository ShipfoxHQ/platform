---
"@shipfox/api-integration-github": minor
---

Adds the `create_commit` agent tool, which creates commits through the GitHub GraphQL `createCommitOnBranch` mutation. Commits are authored by the GitHub App bot, signed by GitHub, and show the Verified badge. The tool takes a repository (`owner/name`), branch, `expected_head_oid` (compare-and-swap), commit message, and file additions and deletions. The server transcodes utf8 contents to base64 and rejects empty change sets at validation. Stale-head, unique-path, and nonexistent-deletion failures surface as readable provider rejections.
