# Writing guide

Rules for every piece of technical writing in this repository: docs pages
(`apps/docs/content/`), package READMEs, and any long-form guide or runbook.
They keep our writing easy to read, easy to skim, and clear for readers whose
first language is not English.

Surface-specific rules build on top of this guide:

- Docs app pages: [apps/docs/WRITING.md](apps/docs/WRITING.md)
  (page types, templates, schema rules).
- Package READMEs: [the package README standard](#package-readmes) below.
- Code comments and shared code style: [the code style policy](docs/policies/code-style.md).

## Placement and ownership

If you need to decide where documentation belongs or which source owns it,
read the [engineering documentation map](docs/README.md). It defines
documentation placement, scope, and contextual-link rules.

## Structure for skimming

Most readers skim. Write so a skimmer still gets the point.

- Use lists to express key points instead of long connected prose.
- Use tables for conditions, properties, and anything with repeated shape.
- Use generous headings. Each heading is an anchor someone can link to.
- Bold the key point of a paragraph.
- Prefer code with comments over long prose explanations.
- Link a name the first time it appears on a page.
- Put expert or debugging detail in collapsible sections, not inline.

## Sentences

- One idea per sentence. Split any sentence with two comma-joined clauses.
- Put the subject first. "The runner polls the API" reads faster than
  "Polling of the API is done by the runner."
- Keep paragraphs under about 5 lines.
- Active voice, present tense.
- Never chain steps with "first... then...". Readers read top to bottom;
  use a list or numbered steps instead.

<!-- vale off -->
## Words

- Plain words over clever words: "uses" not "leverages", "checks" not
  "validates", "sends" not "dispatches". Keep project nouns (Drizzle,
  Temporal, CEL) as they are.
- Cut filler: "you can", "please", "you may try", "simply", "just".
- No marketing adjectives: "powerful", "seamless", "robust", "battle-tested".
- Say "you" only when instructing. Everything else reads as description.
- Define acronyms on first use.
<!-- vale on -->

## Punctuation

**No Unicode em dash (U+2014), ever.** This is an absolute rule for all produced
content: docs, READMEs, code comments, generated copy, commit messages, and PR
descriptions. Do not type or paste the character, even when explaining this
rule. Rewrite the sentence with whichever form fits:

| Instead of | Use |
| --- | --- |
| A parenthetical aside | Parentheses: `the value (shown once) expires` |
| Two closely related clauses | A semicolon: `labels route jobs; see Runners` |
| A clause that introduces an explanation | A colon: `one rule matters: cardinality` |
| Two complete thoughts | Two sentences: `The agent edits. The gate loops.` |

Regular hyphens in compound words (`single-job`, `read-only`) are fine.

## Language level

Write for a competent reader whose English may be a second language.

Check any prose-heavy file with the readability script, from the repo root:

```sh
node .agents/skills/readme-writer/scripts/readability.mjs <path/to/file.md>
```

Targets: Flesch-Kincaid grade <= 9 and top-1000 vocabulary coverage >= 60%.
Treat the output as guidance, not a gate:

- The grade signal is the one to chase. A high grade almost always means one
  sentence is trying to say three things; split it.
<!-- vale off -->
- Domain terms (workflow, provisioner, idempotent, repository) inflate both
  numbers. Keep them when they carry meaning; hunt only for words like
  "utilize", "facilitate", or "subsequent" that add nothing.
<!-- vale on -->
- Reference material (field tables, env-var lists) is exempt from the
  vocabulary floor; field names skew the count.

## Package READMEs

Package READMEs explain one package's purpose, public use, configuration, and
local constraints. They follow this guide and keep repository-wide policy in
its canonical source. Read the [engineering documentation map](docs/README.md)
when deciding whether information belongs in a package README.

Use the sections that apply, in this order:

```text
# <Display Name>             required
<one-line description>       required

## What it does              required
## Installation / Setup      required
## Usage                     required, with one runnable snippet
## Environment               when the package reads process.env
## Routes / API / Data Model when the package exposes one of these
## Behavior Notes            optional, for non-obvious semantics
## Development               required
## License                   required
```

### Title and description

Use a human-readable title for `@shipfox/*` runtime packages. Use the literal
package name for tooling packages whose CLI name matters. Match the convention
of neighboring packages.

Write one sentence that answers what the package is for. Start with the noun
phrase. Do not use marketing language.

### Public surface and setup

List the public surface under **What it does**. Start each bullet with the
bolded exported symbol or concept, then explain it in one sentence. Group
related exports when individual bullets would add noise.

Under **Installation / Setup**, show the dependency command or `workspace:*`
snippet that matches the package's distribution. Do not document unexported
symbols or internal helpers.

### Usage and reference details

Include one small runnable TypeScript example that exercises the primary entry
point. Import from the package root, not an internal path. If setup is needed,
show it as a second smaller block in the same section.

Use **Environment**, **Routes**, **API**, or **Data Model** only when they
apply. Use a table for more than three repeated rows and bullets otherwise.
Link to executable configuration or schemas instead of copying fast-changing
defaults and accepted values.

### Development and license

Use the package-scoped commands that apply:

```sh
turbo check --filter=@shipfox/<name>
turbo type --filter=@shipfox/<name>
turbo test --filter=@shipfox/<name>
```

Omit `test` when the package has no test task. Add `turbo build` only when the
package emits build output. Mention required services or fixtures in one
sentence and link to their owner.

End every package README with:

```md
## License

MIT
```
