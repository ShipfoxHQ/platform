---
"@shipfox/api-integration-github": minor
---

Adds the `create_commit` agent tool, which creates commits signed by GitHub and attributed to the GitHub App bot. The tool takes a repository (`owner/name`), branch, expected head OID, commit message, and file additions and deletions. When the expected head OID no longer matches, or inputs collide or reference missing files, the tool rejects the request with a readable provider error.
