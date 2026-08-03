# @shipfox/prose-policy

Repository prose verification for the writing standard.

## What it does

- **Vale gate** checks product documentation, engineering documentation,
  package README files, root prose, and authored Changeset summaries.
- **Shipfox rules** enforce the repository writing standard for punctuation,
  word choice, terminology, spelling, sentence length, and noun clusters.
- **Checked-in styles** keep the Google and Microsoft rule inputs pinned and
  available without network access.

## Installation and setup

Install the repository tools and workspace dependencies from the repository root:

```sh
mise install
mise exec -- pnpm install
```

## Usage

Run the package verifier through Turbo:

```sh
mise exec -- turbo verify --filter=@shipfox/prose-policy
```

The root `pnpm verify` command includes the same package task.

## Development

Update `.vale.ini` and `tools/prose-policy/styles/` together. Record the reason
for each disabled packaged rule beside its configuration entry.

## License

MIT
