---
name: commit
description: "ALWAYS use this skill when committing changes. Follows Shipfox conventions for branch safety, validation checks, commit messages, and Linear ticket references. Trigger on commit, commit changes, save changes, make a commit, or create commit."
allowed-tools: Bash
---

# Commit Changes

Commit staged changes, or all modified files if nothing is staged, following
Shipfox's engineering practices.

This skill is shared by Claude and Codex. Claude loads it from
`.claude/skills/commit`; Codex loads the same directory through
`.codex/skills/commit`.

## Prerequisites

Before committing, check the current branch:

```bash
git branch --show-current
```

If you're on `main`, create a feature branch first. Do not ask for confirmation
when a clear branch name can be inferred, and do not commit directly to `main`.

Derive a short, kebab-case branch name from the intent of the changes. If a
Linear ticket is in the command arguments or inferrable from context, prefix
the branch with it:

```bash
# With a ticket reference
git checkout -b fox-123-add-label-validation

# Without a ticket reference
git checkout -b add-label-validation
```

## Process

### Step 1: Understand the Changes

```bash
git status
git diff
git diff --cached
```

Review what is staged vs. unstaged. Stage the appropriate files if nothing is
already staged.

### Step 2: Run Conformity Checks

Run all three checks before committing. If any check fails, stop and report the
error. Do not commit failing changes.

```bash
mise exec -- turbo build --filter '...[origin/main]'
mise exec -- turbo test --filter '...[origin/main]'
mise exec -- turbo check --filter '...[origin/main]'
```

### Step 3: Write the Commit Message

**Format:**

```text
<subject>

<body>

<footer>
```

Only the subject is required. Add a body when the change needs context beyond
what the subject conveys. Add a footer to reference Linear tickets.

**Subject line rules:**

- Short sentence describing the change at a high level from a business/product
  perspective
- Use imperative mood: "Add runner label validation" not "Added runner label
  validation"
- Maximum ~70 characters
- No period at the end
- Never includes a `Co-authored-by` or `Co-Authored-By` trailer

**Body guidelines:**

- Explain what and why, not how
- Include motivation for the change
- Contrast with previous behavior when relevant

**Footer - Linear ticket references:**

```text
Fixes LINEAR-123   # links and signals the ticket is resolved
Refs LINEAR-123    # links without closing
```

### Step 4: Create the Commit

```bash
git commit -m "$(cat <<'EOF'
Subject line here

Optional body explaining why.

Refs LINEAR-123
EOF
)"
```

If command arguments or the user request provide commit message guidance, use
them. Otherwise infer the message from the diff.

## Examples

### Simple Fix

```text
Fix registration token expiry not being enforced

Tokens were validated by existence but not by expiry date, allowing
stale tokens to register new runners. Add the expiry check and return
401 when the token is expired.

Fixes LINEAR-456
```

### Feature

```text
Add per-organization runner concurrency limits

Prevents a single org from exhausting the shared runner pool by
introducing a configurable per-org cap.

Refs LINEAR-123
```

### Refactor

```text
Extract token validation into a shared helper

Duplicate parsing logic existed in three route handlers. No behavior
change.
```

## Principles

- Each commit should be a single, stable change
- The repository should be in a working state after each commit
- Commits should be independently reviewable
