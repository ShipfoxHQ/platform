# Architecture decision record 0010: Prose standard and enforcement

- **Status:** Accepted.
- **Date:** 2026-08-03.
- **Decision owners:** Repository documentation.

## Context

**The writing guides had no executable contract.** `WRITING.md` prohibited
Unicode dash punctuation, marketing language, and filler, but repository checks
did not enforce those rules. Equivalent guidance was spread across the root
guide, the product documentation guide, and agent skills.

**The measured corpus did not match the stated standard.** A scan of the
repository found 317 Unicode em dash and en dash characters across 42 packages.
It also found 28 prohibited filler or marketing terms. The package README
template prescribed 29 title-case headings even though the guide uses sentence
case elsewhere.

**Readability scores competed with direct rules.** The README skill used
Flesch-Kincaid grade and top-1000 vocabulary coverage. Domain terms distorted
both scores, while the checks reported the same long sentences that a direct
sentence-length rule could identify.

**The product documentation guide contained a roadmap exception.** It required
authors to document only behavior that works end to end on `main`, but it also
defined `status: "soon"`, coming-soon callouts, and unavailable provider pages.
Those rules allowed product documentation to describe a future surface and left
shipped integrations marked as unavailable.

**A shared rule needs a shared owner and an explicit decision record.** ADR 0005
places repository-wide prose rules in `WRITING.md`. It also requires agent skills
and surface-specific guides to consume that shared source. The rationale,
alternatives, and adoption measurements belong in an ADR rather than in the
operating guide.

## Decision

**Shipfox adopts a repository prose standard based on ASD-STE100 principles and
a selected Google style baseline.** `WRITING.md` remains the current operating
guide. This record owns why the repository selected the rules, their enforcement
model, and the deliberate divergences from the source standards.

### Sentence and word rules

**Sentence length is measured directly.** Descriptive and reference prose has a
25-word maximum. Tutorials, getting-started pages, and how-to guides have a
20-word maximum. This maps the ASD-STE100 descriptive and procedural limits onto
the repository's Diataxis structure.

**Negative contractions are preferred and other contractions are expanded.** A
scanning reader can miss the separate word `not`. Forms such as `it's` can mean
`it is`, `it has`, or appear near a possessive, so expanded forms reduce
ambiguity. Authors restructure sentences when negation remains easy to miss.

**The repository uses a house acronym glossary.** API, DTO, ADR, CEL, MIT, YAML,
MDX, JWT, SDK, CLI, HTTP, URL, UI, SQL, OAuth, MCP, E2E, and CI need no first-use
expansion. Product documentation defines other acronyms on first use.
Engineering documents may assume established domain vocabulary.

**Plain words, American spelling, and restrained claims remain the default.**
Repository rules replace vague or inflated wording with direct terms. A curated
British-to-American substitution rule enforces spelling variety separately from
the spelling checker.

### Voice and punctuation

**Shipfox does not adopt the ASD-STE100 passive-voice ban.** Reference pages
describe system behavior where the actor is often unknown or irrelevant. Vale
reports passive voice outside reference pages as a suggestion. Authors still
prefer active voice when the actor matters.

**Unicode em dash and en dash characters are prohibited.** The rule applies to
documentation, READMEs, code comments, generated copy, commit messages, and pull
request descriptions. Authors split complete thoughts into two sentences by
default. Colons, semicolons, and parentheses remain available when their
relationship is more precise.

### Product terminology and scope

**Product documentation authoring contains no roadmap convention.** New pages
describe shipped or connectable Preview behavior. The authoring standard does
not use `status: "soon"`, coming-soon callouts, or unavailable-provider page
templates. Existing Linear and Slack pages remain migration exceptions until
their shipped-provider documentation lands under ENG-1460. They do not establish
authoring precedent. A feature and its product documentation ship in the same
slice.

**`integration connection` is a fixed compound.** Authors do not place another
noun before it. A prepositional phrase keeps noun clusters readable: use "the
slug of your GitHub integration connection" instead of "your GitHub integration
connection slug". Renaming the resource would reintroduce ambiguity with the
schema field `connection` or misstate the identity of multiple connections to
one integration.

### Enforcement

**Vale is the prose enforcement mechanism.** The private
`@shipfox/prose-policy` package vendors its selected Google and Microsoft rules
and defines repository-owned Shipfox rules. Vendoring keeps CI independent of
network access and makes rule changes visible in review.

**Only error-level findings block verification.** Errors cover mechanical rules
that need no author judgment, including Unicode dash punctuation, prohibited
marketing terms, and filler. Warnings cover contractions, terminology, plain
words, sentence length, spelling variety, and spelling. Suggestions cover
signals such as passive voice and noun clusters.

**The policy checks reader-facing authored prose.** Its scope includes product
documentation, engineering documentation, package READMEs, root prose, and
Changeset summaries. Changeset summaries are included because they become
release notes without a separate documentation review. Generated changelogs are
not authored inputs.

**Agent skills consume the shared guide.** The README writer uses the prose
policy instead of a separate readability script. The Changeset generator reads
the root word, terminology, contraction, and sentence-length rules before it
writes a summary.

## Consequences

**Authors receive one result for each rule.** Direct sentence limits replace the
overlapping readability score. Vale provides the rule name and a local message,
while `WRITING.md` explains how to revise the prose.

**The repository can adopt the gate without making judgment subjective.**
Mechanical violations block CI. Warnings and suggestions remain visible for
authors and reviewers without preventing a merge.

**Rule changes cross a documented decision boundary.** A change to the prose
standard updates this record when it changes the rationale, accepted sources,
enforcement model, or a deliberate divergence. Operational wording changes stay
in `WRITING.md`.

**Vendored styles need maintenance.** A packaged style update is a reviewed
dependency change. The repository evaluates changed rules against its corpus
before adopting them.

## Rejected alternatives

### Use the complete ASD-STE100 standard and vocabulary

**ASD-STE100 supplies useful rules but not a suitable repository vocabulary.**
Its Part 2 dictionary is copyrighted by ASD Brussels and cannot be redistributed
in an MIT repository. Its aerospace maintenance vocabulary also conflicts with
software meanings, including ordinary uses of `run`.

### Enforce the complete Google or Microsoft Vale packages

**Packaged styles contain product-specific assumptions.** The Google package
flags semicolons and parentheses that this guide prescribes as punctuation
options. Its vocabulary rules also reinterpret valid product states. The
Microsoft terms rule produced 97 findings, including 79 requests to replace
`agent` with `personal digital assistant`. Shipfox enables only measured rules
that provide useful and actionable findings.

### Keep the readability script

**Readability formulas give indirect and conflicting signals.** Technical nouns
raise grade and vocabulary scores even when the sentence is clear. The script
also duplicates sentence-length enforcement with a different result. Direct
word limits are easier to explain, check, and revise.

### Keep roadmap placeholders in product documentation

**Roadmap pages contradict the shipped-surface rule.** They can drift from the
implementation and make available capabilities appear absent. Linear remains
the source for planned work; product documentation describes the product a
reader can use.

### Treat Changeset summaries as release metadata outside prose policy

**Changeset summaries are published prose.** Measurement found a product term
error in an authored summary. Keeping them in scope prevents that wording from
shipping to package consumers without documentation review.

## Adoption measurements

The initial measurement used Vale 3.16.0 against the repository corpus.

| Finding | Measured result | Decision impact |
| --- | --- | --- |
| Unicode em dash and en dash characters | 317 across 42 packages; 109 in Markdown and MDX | Add a blocking repository rule and clean all authored surfaces. |
| Prohibited filler and marketing terms | 28 | Add blocking Shipfox rules. |
| Non-negative contractions | 19 plus manual review | Add a warning and document the negative-contraction preference. |
| Sentences over the selected limit | 22 over 25 words; 79 over 20 words in procedural paths | Use direct limits as warnings. |
| Package README headings | 29 headings used the old title-case names | Adopt sentence-case section names. |
| Spelling alerts before project vocabulary | 1,281 alerts over about 250 distinct technical words | Maintain a project vocabulary and separate American spelling from typo detection. |
| Authored Changeset summaries | 18 findings in 12 of 39 summaries | Include Changesets and suppress known imperative-verb noun-cluster noise. |

The adoption gate starts with zero error-level findings. Warnings and
suggestions remain a review queue rather than migration blockers.

## Sources

- [ASD-STE100](https://www.asd-ste100.org/), for its procedural and descriptive
  writing rules and sentence limits.
- [Google developer documentation style guide](https://developers.google.com/style/),
  used as a selected baseline rather than the repository authority.
- [Vale Google package](https://vale.sh/explorer/google) and
  [Vale Microsoft package](https://vale.sh/explorer/microsoft), evaluated rule by
  rule against the repository corpus.
- [Prose policy package](../../tools/prose-policy/README.md), for the executable
  scope, local command, and maintenance workflow.
