---
"@shipfox/api-integration-github": minor
---

Adds the `create_commit` agent tool, which creates commits signed by GitHub and attributed to the GitHub App bot. The tool takes a repository (`owner/name`), branch, expected head OID (40 or 64 hexadecimal characters), commit message, and file additions and deletions. Inputs are validated server-side: paths must be repository-relative (no `..` or `.git` segments), contents are bounded to about 1 MiB per call, and malformed encodings are rejected. When the expected head OID no longer matches, or inputs collide or reference missing files, the tool rejects the request with a readable provider error, and rate-limited calls carry retry context.

The `GithubAgentToolCategory` union gains a `repository` member, so consumers that switch over the union exhaustively must handle the new member. Workflow documents that reference `create_commit` are forward-only: they stop materializing on deployments where the agent tool catalog predates this tool. Branch protection rules are the only barrier to writing the default branch, and dependent commits should be sequenced by deriving each `expected_head_oid` from the previous commit's returned oid.
