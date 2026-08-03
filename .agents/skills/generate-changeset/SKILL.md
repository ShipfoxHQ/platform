---
name: generate-changeset
description: "Generate a Changeset file for the current branch using Shipfox agent automation. Trigger when the user asks to add a Changeset, document a change for release, bump versions, or prepare a PR that touches published packages."
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Generate Changeset

Agents cannot drive the interactive `pnpm exec changeset` prompt. This skill
creates the equivalent `.changeset/*.md` file directly.

When a change may affect a published package, read the
[Changesets and publishing workflow](../../../docs/guides/local-development-and-release-workflow.md#publish-packages-with-changesets).
It owns when a Changeset is required, package eligibility, bump levels, and
the shared summary rules.

Before writing the summary, read the [repository writing guide](../../../WRITING.md).
Apply its word, terminology, contraction, and sentence-length rules. Changeset
summaries are published as release notes and are checked by the prose policy.

## Process

1. Inspect `git diff origin/main...HEAD --name-only` and apply the shared
   workflow to decide whether a Changeset is required.
2. For each changed package, walk upward to its nearest `package.json`. Read
   its `name` and `private` fields. Include only eligible published packages.
3. Apply the shared bump-level policy. If the change is breaking, explain the
   major-version impact and ask the user before writing it.
4. Generate an unused three-word filename under `.changeset/` and write the
   standard Changesets front matter with the selected package names and bumps.
5. Write the summary using the shared workflow. Do not create a release pull
   request or run the publisher.
6. Report the filename, package bumps, and summary. The calling workflow is
   responsible for committing the file with the implementation.

## File shape

```markdown
---
"@shipfox/api-runners": minor
---

Adds per-organization runner concurrency limits.
```

Use one front-matter entry per affected package.
