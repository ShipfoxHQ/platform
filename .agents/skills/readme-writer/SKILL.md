---
name: readme-writer
description: "Use this skill to write or revise a README.md for a Shipfox workspace package (libs/*, tools/*). It applies the shared package README standard and repository prose policy. Trigger on write a README, draft README, rewrite README, document this package, or improve the README."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# README Writer

Use this workflow to document one package. It does not apply to the repository
root README, design documents, or RFCs.

Before drafting a package README, read the
[package README standard](../../../WRITING.md#package-readmes). It owns the
required structure, prose style, public-surface rules, development guidance,
and license section for human and agent authors.

When deciding whether detail belongs in the package README, read the
[engineering documentation map](../../../docs/README.md). It owns
documentation placement and canonical ownership.

## Gather the package contract

Read the public package surface in this order:

1. `package.json` for its name, exports, binaries, scripts, and dependencies.
2. The root export entry point for consumer-visible symbols.
3. Additional source files only as needed to understand those exports.
4. A sibling `*-dto` package when it owns public DTO or event names.
5. `drizzle/` or `migrations/` when the package owns persistent data.

Do not document symbols that the package does not export or ship.

## Workflow

1. Apply the package README standard, including only the sections that fit the
   package.
2. Use the inspected public contract for the package description, setup, and
   runnable usage example. Link to schemas or configuration sources instead of
   copying fast-changing values.
3. Check nearby package READMEs only for local conventions or comparable
   examples. They do not override the shared standard.
4. Run `mise exec -- turbo verify --filter=@shipfox/prose-policy` and review its
   warnings and suggestions for the README.
5. Apply the guidance in `WRITING.md` to improve the result, then reread the
   README as a package consumer.

Report the public sources inspected, the sections included, and the prose-policy
result.
