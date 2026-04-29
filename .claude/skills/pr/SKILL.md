---
name: pr
description: "ALWAYS use this skill when creating pull requests. Follows Shipfox conventions for PR titles, descriptions, GitHub CLI usage, and Linear ticket references. Trigger on create PR, open PR, submit PR, make PR, push and create PR, or prepare changes for review."
allowed-tools: Bash
---

# Create Pull Request

Create pull requests following Shipfox's engineering practices.

This skill is shared by Claude and Codex. Claude loads it from `.claude/skills/pr`;
Codex loads the same directory through `.codex/skills/pr`.

**Requires**: GitHub CLI (`gh`) authenticated and available.

## Prerequisites

Before creating a PR, ensure all changes are committed.

If there are uncommitted changes:

- In Claude, invoke the `/commit` skill if it is available. Pass `$ARGUMENTS`
  through so it can use any ticket or hint provided.
- In Codex, commit the intended changes using the repository's normal commit
  workflow, or ask the user before committing if the requested scope is unclear.

```bash
# Check for uncommitted changes
git status --porcelain
```

## Process

### Step 1: Verify Branch State

```bash
# Check current branch, commits ahead of the PR base, and remote sync status
git status
git log origin/main..HEAD --oneline
```

Ensure:

- All intended changes are committed
- The branch is not `main` (PRs must come from a feature branch)
- Push the branch if not already on remote: `git push -u origin HEAD`

### Step 2: Analyze Changes

```bash
# Full commit history diverging from the PR base
git log origin/main..HEAD

# Full diff
git diff origin/main...HEAD
```

Understand the scope and purpose of all changes before writing the description.

### Step 3: Write the PR Description

Use this structure:

```markdown
<brief description of what the PR does>

<why these changes are being made - the motivation>

<alternative approaches considered, if any>

<any additional context reviewers need>
```

**Do include:**

- Clear explanation of the _why_, not just the _what_
- Linear ticket reference if one exists (see Issue References below)
- Notes on areas that need careful review

**Do NOT include:**

- "Test plan" sections
- Checkbox lists of testing steps
- Redundant summaries of the diff

### Step 4: Create the PR

```bash
gh pr create --base main --title "<title>" --body "$(cat <<'EOF'
<description body here>
EOF
)"
```

Pass `--draft` if the user request, command arguments, or task context contains
`draft` or `--draft`.

## Title Format

- If the change is scoped to a specific package, prefix with the package name in
  square brackets: `[runner] Add label validation`
- Otherwise use a short, business-level sentence:
  `Add label validation for self-hosted runners`
- Follow Google's "Writing good CL descriptions" guidelines: describe the change
  at a high level; say _what_ changed and _why_ in the title if it fits
  concisely.

## PR Description Examples

### Feature PR

```markdown
Add per-organization runner concurrency limits

Organizations could previously exhaust the shared runner pool by queuing
unbounded jobs. This introduces a per-org concurrency cap configurable
via the admin panel, preventing starvation for other tenants.

Considered a global queue with fair-scheduling, but per-org limits are
simpler to reason about and easier to tune per customer.

Refs LINEAR-123
```

### Bug Fix PR

```markdown
[runner] Fix registration token expiry not being enforced

Registration tokens were validated by existence but not by expiry date,
allowing tokens older than 1 hour to still register new runners. This
adds the expiry check and returns a 401 when the token is stale.

Fixes LINEAR-456
```

### Refactor PR

```markdown
[api/auth] Extract token validation into a shared helper

Duplicate token-parsing logic existed in three route handlers. Moves it
into `libs/api/auth/core/validateToken.ts`. No behavior change.

Prepares for adding rate-limiting per token in LINEAR-789.
```

## Issue References

Reference Linear tickets in the PR body:

| Syntax             | Effect                                   |
| ------------------ | ---------------------------------------- |
| `Fixes LINEAR-123` | Links and signals the ticket is resolved |
| `Refs LINEAR-123`  | Links without closing                    |

If a ticket is referenced in the user request, command arguments, or branch
name, include the appropriate reference in the PR body.

## Guidelines

- **One PR per feature/fix** - don't bundle unrelated changes
- **Keep PRs small** - smaller PRs get faster, better reviews
- **Explain the why** - code shows what; the description explains why
- **Use draft PRs** for early feedback before the work is complete

## Editing Existing PRs

Use `gh api` to update a PR after creation (more reliable than `gh pr edit`):

```bash
# Update description
gh api -X PATCH repos/{owner}/{repo}/pulls/PR_NUMBER -f body="$(cat <<'EOF'
Updated description here
EOF
)"

# Update title
gh api -X PATCH repos/{owner}/{repo}/pulls/PR_NUMBER -f title='[scope] New title'

# Update both
gh api -X PATCH repos/{owner}/{repo}/pulls/PR_NUMBER \
  -f title='[scope] New title' \
  -f body='New description'
```
