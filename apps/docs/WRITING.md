# Docs writing guide

Rules specific to the docs app (`content/docs/`). They sit on top of the
repo-wide [WRITING.md](../../WRITING.md), which owns the general structure,
sentence, word, and punctuation rules (including the strict no-em-dash rule)
and sentence-length limits. Read that first.

## Absolute punctuation rule

Never use the Unicode em dash (U+2014). This applies to prose, frontmatter,
examples, code comments, and generated markers. Use a comma, colon, semicolon,
parentheses, or a new sentence instead. A docs change is not complete while a
scan for U+2014 finds a match.

## Page types

Every page serves one reader need from the
[Diataxis framework](https://diataxis.fr/). Do not mix types on one page.

| Type | Primary section | Reader need | Page job |
| --- | --- | --- | --- |
| [Tutorial](https://diataxis.fr/tutorials/) | `getting-started/`, `tutorials/` | Learn through a guided experience | Lead the learner through a reliable, complete project with visible results. |
| [Explanation](https://diataxis.fr/explanation/) | `understand/` | Understand a subject | Provide context, rationale, connections, implications, and useful comparisons. |
| [How-to](https://diataxis.fr/how-to-guides/) | `how-to/` | Complete a real task or solve a problem | Guide an already-competent reader to a concrete, verified result. |
| [Reference](https://diataxis.fr/reference/) | `reference/` | Find authoritative facts while working | Describe the shipped product accurately, completely, neutrally, and predictably. |

Directory names help navigation, but they do not create another page type.
`operations/`, `installation/`, and `integrations/` are subject areas. Each page
inside them must still be a tutorial, explanation, how-to guide, or reference
page. Split a page when its subject requires more than one reader mode.

## Product terminology

Use **integration connection** for the workspace resource created when an
integration is connected. Do not use **connection** by itself for this resource,
especially in titles, navigation, prerequisites, and other text that readers may
see without surrounding context. Use **the slug of an integration connection**
for its workflow identifier. Keep the schema field name as `connection` in code.

`integration connection` is a fixed compound. Do not put another noun directly
before it. Use a prepositional phrase instead: write "the slug of your GitHub
integration connection", not "your GitHub integration connection slug".

### Identifier terms

Qualify `slug` at first use in each document. Use these terms consistently:

| Term | Meaning |
| --- | --- |
| Workspace slug | A mutable, globally unique value used in client URLs. |
| Project slug | A mutable value unique within a workspace and used in client URLs. |
| Slug of an integration connection | The workflow `source` value for an integration connection. It is not a client URL identifier. |
| Feature id | A stable namespaced composition identifier such as `shipfox.workflows`. Do not call it a feature slug. |

After the first qualified use, shorten a term only when the surrounding section
still makes its owner clear. Keep `integration connection` qualified in product
documentation, even when the page already discusses integrations.

### Choose the type before writing

Write one sentence that names the reader need before drafting:

- **Tutorial:** After this lesson, the learner has built `<result>` and has
  encountered `<skills and concepts>` through the work.
- **Explanation:** After reading, the reader understands why `<subject>` works
  this way and how it connects to `<related subjects>`.
- **How-to:** If the reader needs `<specific result>`, this guide gets them there
  from `<starting state>`.
- **Reference:** While working with `<product surface>`, the reader can look up
  every shipped `<field, value, behavior, or constraint>` here.

If the sentence needs two types, split the page. A tutorial may link to an
explanation, a how-to may link to reference, and reference may link to a how-to.
The linked page carries the other reader need.

### Prerequisites belong to the page

Do not apply an online-runner, integration, provider, or permission prerequisite
to an entire section. Put each prerequisite on the tutorial or how-to guide that
needs it. Link to the task that creates the missing starting state.

### One canonical home per fact

Every exact fact lives on one reference page: field tables and accepted values
in `reference/workflow-schema.mdx`, provider ids in
`reference/model-providers.mdx`, numbers and defaults in
`reference/limits.mdx`, and environment variables in the matching reference
page. Other pages use only the facts needed to serve their reader and link to
the canonical home instead of copying it.

A concept may appear in several page types, but its treatment changes:

| Subject | Tutorial | Explanation | How-to | Reference |
| --- | --- | --- | --- | --- |
| Listening jobs | Build one in a controlled project and observe it respond. | Explain why later events remain in the same run. | Add a bounded listener to an existing workflow. | List the fields, types, defaults, and validation rules. |

## Tutorials

A tutorial is a lesson, not a long how-to guide. The author owns the learner's
successful experience. Choose one concrete path, remove optional branches, and
make every promised result reproducible.

### Tutorial rules

- Show the completed result near the beginning so the learner knows where the
  journey leads.
- State the exact supported starting environment. Prefer a controlled project
  or fixture over the learner's production repository.
- Lead with actions. Keep explanation short and link to Understand for depth.
- Use small steps that produce visible results early and often.
- Tell the learner what result to expect after each meaningful action.
- Point out what the learner should notice, without pausing for a theory lesson.
- Choose one path. Do not offer model, provider, trigger, or deployment options
  while the learner is trying to complete it.
- Make destructive or paid actions explicit. Prefer reversible and repeatable
  exercises.
- Test the complete tutorial from its documented starting state.

### Tutorial template

1. **Outcome.** Show what the learner will build and what success looks like.
2. **Before you begin.** List the exact account, workspace, integration connection, runner,
   provider, repository, and permission state required by this lesson.
3. `## Build <first visible part>`. Give a short sequence of actions.
4. **Checkpoint.** Show the expected UI state, log line, output, or file.
5. Repeat the build and checkpoint pattern in small stages.
6. `## Complete the project`. Join the pieces and run the full journey.
7. `## Verify the result`. Confirm every promised external and Shipfox state.
8. `## What you built`. Recap the accomplished result and link to explanations,
   how-to guides, and reference for independent work.

Do not add alternatives, exhaustive field descriptions, deep rationale, or
general troubleshooting to the tutorial path. Link them at the moment they
become relevant.

## Explanations

An explanation changes how the reader understands a bounded subject. Start from
a real or implied why question. Make connections, provide context, and discuss
consequences or tradeoffs that are not visible from the schema alone.

### What an explanation may contain

- Definitions and the design rationale behind the subject.
- Connections to related Shipfox concepts and familiar external systems.
- The bigger picture, constraints, implications, alternatives, and tradeoffs.
- Mechanics and behavior tables when they support the mental model.
- One minimal annotated YAML example per sub-topic when an example helps.
- A short correction for a misconception that readers actually encounter.

### What an explanation must not contain

- A sequence of dashboard actions or commands for completing a task.
- Field-by-field schema tables, environment-variable tables, or accepted-value
  lists.
- A limit or default without a link to its canonical reference.
- A complete tutorial journey disguised as a concept example.
- A `## Related pages` card grid that duplicates the sidebar. Link names in
  context, with at most one next-step Card at the end.
- Implementation vocabulary in the opening. Lead with reader terms such as
  trigger, job, step, agent step, feedback loop, output, and secret. Introduce
  execution, attempt, lease, and harness only when the mental model needs them.

### Explanation template

1. **Definition and purpose.** Use one to three short paragraphs with no heading.
   Bold the term. A reader who stops here knows what it is and why it exists.
2. **The motivating question.** Answer the real why question, design constraint,
   or choice that makes this subject worth explaining.
3. `## How it fits`. Connect the subject to the surrounding workflow and to
   familiar alternatives where useful.
4. `## How it works`. Explain the mental model, lifecycle, boundaries, and
   evaluation semantics without listing every field.
5. `## Consequences and tradeoffs`. Describe what the design makes possible,
   what it costs, and when another approach fits better.
6. Optional: one minimal annotated example for each genuinely distinct
   sub-topic.
7. Optional: one correction for a proven misconception and at most one next
   Card.

Do not manufacture history, alternatives, or controversy. Include them only
when they help the reader reason about Shipfox.

## How-to guides

A how-to guide addresses a real user project, not an operation the product can
perform. The reader already knows the result they need. Product controls, shell
commands, UI actions, diagnosis, and judgment are tools in reaching that result.

A how-to guide does not need to be an end-to-end lesson. It starts and ends at
meaningful points in competent work. It does need an executable, adaptable path
from its stated starting state to its promised result.

### How-to rules

- Name one concrete result or problem in the title and opening.
- State the starting state and only the prerequisites this task needs.
- Keep action in the main path. Link explanations and exhaustive facts.
- Order work according to the reader's activity and thinking, not the product's
  settings hierarchy.
- Use conditional instructions when the real problem branches.
- Ask the reader to make a judgment when no universal procedure exists.
- Omit actions that a competent reader can infer from a standard control unless
  the action has a non-obvious consequence.
- End with verification of the promised result.
- Link expected failure states to focused recovery guides.
- Split the page when it solves two independently searchable problems.

### How-to template

1. **Goal and fit.** State the result and the situation in which this approach
   applies. Keep this to one or two short paragraphs.
2. **Before you begin.** List the required workspace, project, runner,
   integration, provider, repository, and permission state. Omit anything the
   task does not need.
3. `## <First meaningful action>`. Begin from the documented starting state.
4. Continue with action headings in their logical order. Use `Steps` for a
   linear sequence and ordinary headings or a decision table for branches.
5. Add short decision guidance exactly where the reader must choose.
6. `## Verify <result>`. Confirm observable Shipfox and external state.
7. Optional: `## If <expected problem> occurs`, or link to a dedicated
   troubleshooting guide.

Do not add a generic concepts section, full field table, broad product tour,
unrelated next steps, or a teaching narrative. If the reader needs to learn the
whole system, write a tutorial. If they need to understand why, link to
Understand.

### Recipes are how-to guides

`how-to/recipes/` contains complete, adaptable workflows for recognizable
engineering outcomes. A recipe assumes competence and helps someone do real
work. It is not a tutorial and does not teach every concept it uses.

A recipe must:

- Promise one recognizable result, such as checks on every push or Sentry issue
  triage.
- State every integration, runner, provider, and permission prerequisite.
- Include one complete workflow as its primary artifact.
- Mark every value the reader must replace.
- Explain adaptation points without cataloging every option.
- Verify both the Shipfox run and the external result it promises.

## Reference

Reference describes the shipped product. Organize it according to the machinery
the reader is consulting, not according to a learning journey or user project.
Readers should be able to scan predictable headings and tables for authoritative
facts.

### Reference rules

- Be neutral, factual, precise, complete, and concise.
- Mirror the structure and naming of the shipped product.
- Use standard tables and repeated field shapes consistently.
- Include types, accepted values, defaults, limits, constraints, failure
  behavior, and security warnings where the product defines them.
- Use short examples to illustrate facts, not to lead the reader through a task.
- Generate tables from the source of truth where practical.
- Link to tutorials, how-to guides, and explanation instead of embedding them.
- Do not include opinions, speculative advice, task walkthroughs, or marketing
  claims.

### Reference template

1. **Scope.** State exactly which product surface the page describes.
2. `## <Product structure>`. Follow the product's own hierarchy.
3. Use consistent tables for repeated facts such as field, type, required state,
   default, description, and constraints.
4. Put validation, failure behavior, and security rules next to the fact they
   constrain.
5. Include minimal examples only when they clarify representation or usage.
6. Link to a how-to guide for a complete task and to Understand for rationale.

## Integration provider pages

An integration provider uses a predictable set of focused pages. Each page has
exactly one Diataxis type. Keep setup actions in the how-to page and product
facts in the reference pages.

| File | Route | Type | Create it when |
| --- | --- | --- | --- |
| `index.mdx` | `/integrations/<provider>` | Reference | Always. |
| `setup.mdx` | `/integrations/<provider>/setup` | How-to | The provider is connectable. |
| `events.mdx` | `/integrations/<provider>/events` | Reference | The provider stamps Shipfox event names into deliveries. |
| `tools.mdx` | `/integrations/<provider>/tools` | Reference | Its registry-derived `capabilities[]` includes `agent_tools`. |
| `meta.json` | None | None | Always. List only the pages that exist, in the order `index`, `setup`, `events`, `tools`. |

Put these files in `content/docs/integrations/<provider>/`. Register the provider
directory in `content/docs/integrations/meta.json`. The provider's `meta.json`
groups its pages so the integrations sidebar can nest the pages under one
provider entry instead of flattening every page into the top level.

Provider pages use `integrations/<provider>/{index,setup,events,tools}.mdx`.
The canonical `events.mdx` and `tools.mdx` pages import generated event and tool
fragments.

### Capabilities

Do not create an empty capability page. Create `events.mdx` only when Shipfox
assigns an event name to the provider's deliveries. Create `tools.mdx` only
when the provider advertises `agent_tools`. The overview's `## Capabilities`
block lists only the provider's shipped capabilities. Omit capabilities that
are not shipped. Follow
[Schema fields: document only shipped surface](#schema-fields-document-only-shipped-surface)
when deciding what to document.

### Canonical homes for provider facts

Extend the [one canonical home per fact](#one-canonical-home-per-fact) rule with
these provider-specific homes:

| Fact | Canonical page | Source of truth |
| --- | --- | --- |
| Purpose, authentication method, required access, integration connection slug pattern, and capability summary | Provider overview (`index.mdx`) | Provider registry capabilities and provider `src/config.ts`. |
| Shipfox event names, emission conditions, and fields Shipfox normalizes or exposes on `event` | Provider events page (`events.mdx`) | `libs/api/integration/core-dto/src/events.ts`, each provider's `src/core/webhook.ts`, and its webhook DTO schemas. |
| Raw pass-through webhook payload fields | The provider's upstream webhook reference | The provider owns and versions this schema. Link to it from `events.mdx`; do not reproduce it. |
| Tool selectors, methods, sensitivity, sensitive status, required provider permissions, scope, inputs, and outputs | Provider tools page (`tools.mdx`) | The provider's `src/core/agent-tools.ts` catalog and its schemas. |
| Trigger `source`, `event`, `filter`, and `with` fields, plus the agent `integrations:` block | [Workflow schema reference](/reference/workflow-schema) | The workflow schema. Link to it instead of restating the contract. |
| Inspecting, pausing, or deleting an integration connection | The matching `how-to/set-up-work/manage-*` guide | The connection lifecycle implementation. |

Shipfox owns the event name, emission condition, and any payload shape it
normalizes. For a pass-through provider, Shipfox does not own or version the raw
body handed to a run as `event`. An upstream link prevents a copied schema from
drifting or implying false ownership.

### Provider overview template (Reference)

Use the overview to answer what the provider is and what it can do. It is the
hub for all provider pages.

````mdx
---
title: "<Provider> integration"
sidebarTitle: "Overview"
description: "<State what the provider connects and how workflows use it.>"
---

## Authentication

<State the authentication method and the least provider access required.>

## Integration connection identity

<State the default integration connection slug pattern.>

```yaml
triggers:
  on_provider_event:
    source: <provider>_acme
    event: <event-name>
```

## Capabilities

| Capability | Details |
| --- | --- |
| Source control | <Link to the relevant reference.> |
| Events | [View events](/integrations/<provider>/events). |
| Agent tools | [View agent tools](/integrations/<provider>/tools). |

<If `setup.mdx` exists, link to [Set up this integration](/integrations/<provider>/setup).
Otherwise, omit this line.>
````

The capability section includes only rows that apply to the provider. The
overview always covers purpose, authentication method, required access,
integration connection slug behavior, capability summary, and links to its
sibling pages.

### Provider setup template (How-to)

Use the setup page to connect one provider and prove that the integration
connection works. Link back to the overview in context.

```mdx
---
title: "Connect <Provider> to a Shipfox workspace"
sidebarTitle: "Setup"
description: "<State the connection result and when this guide fits.>"
---

<State the goal, fit, and link to the [<Provider> overview](/integrations/<provider>).>

## Before you begin

<List the required workspace access, provider account access, and prerequisites.>

## Connect <Provider>

<Steps>
  <Step>

    **Start the integration connection**

    <Give the action that starts the connection.>
  </Step>
  <Step>

    **Grant the least required access**

    <State the provider permissions and scope to grant.>
  </Step>
  <Step>

    **Record the integration connection slug**

    <State where to find the slug and how workflows use it.>
  </Step>
</Steps>

## Verify the integration connection

<Verify both observable Shipfox state and the expected provider-side state.>
```

The final verification must cover both systems. Keep event names, payload fields,
and workflow schema details on their reference pages.

### Provider events template (Reference)

Use this page only for a provider that emits Shipfox-named events. Link back to
the overview and to the workflow schema reference.

````mdx
---
title: "<Provider> events"
sidebarTitle: "Events"
description: "<State the provider event surface this reference describes.>"
---

<State the event surface and link to the [<Provider> overview](/integrations/<provider>).>

## Event names

| Shipfox event name | Emitted when | Upstream reference |
| --- | --- | --- |
| `<event-name>` | <State the exact emission condition.> | <Link to the provider reference when it owns the raw payload.> |

## Payload

<State whether Shipfox normalizes the payload or passes it through. List the
fields Shipfox exposes on `event`. For a pass-through payload, link to the
provider-owned schema instead of copying it.>

## Trigger fragment

Replace `<provider>_acme` with the integration connection slug:

```yaml
triggers:
  on_provider_event:
    source: <provider>_acme
    event: <event-name>
```

For trigger field rules, see the [workflow schema reference](/reference/workflow-schema#trigger-fields).
````

The event-name table records exact Shipfox names and their emission conditions.
The payload section distinguishes Shipfox-owned normalized fields from a raw
provider payload, which remains provider-owned.

### Provider tools template (Reference)

Use this page only when `capabilities[]` includes `agent_tools`. Link back to
the overview and to the workflow schema reference.

```mdx
---
title: "<Provider> agent tools"
sidebarTitle: "Tools"
description: "<State the provider tools this reference describes.>"
---

<State the tool surface and link to the [<Provider> overview](/integrations/<provider>).>

## Selectors

Use `family`, `family.method`, `family.*`, or a standalone selector. For the
agent `integrations:` contract, see the [workflow schema reference](/reference/workflow-schema#agent-integration-fields).

## Tool catalog

<State the least-access and write opt-in model, with a link to [Integration
connections and tools](/understand/integrations-connections-and-tools).>

| Selector token | Sensitivity | Sensitive | Required provider scope |
| --- | --- | --- | --- |
| `<family>` | Read | No | `<scope>` |

<Accordions type="single">
  <Accordion title="<family>">
    **Methods:** `<family.method>`

    **Inputs:** <List the Shipfox-owned input fields.>

    **Outputs:** <List the Shipfox-owned output fields.>
  </Accordion>
</Accordions>
```

Keep the table compact and scannable. Group it by the provider's tool category
when that makes a large catalog easier to scan. Wrap the tool accordions in one
`<Accordions>` and use one `<Accordion>` per tool or tool family for methods,
inputs, and outputs. The provider's `src/core/agent-tools.ts` catalog owns these
schemas, so reproduce them here rather than linking to an upstream schema.
`sensitivity` describes read or write behavior. `sensitive` states whether the
tool needs sensitive handling; it is not a separate approval policy.

### New provider checklist

1. Read the provider registry's `capabilities[]` and enabled flag, then confirm
   that the provider is shipped before documenting it.
2. Write `index.mdx` with purpose, authentication method, required access,
   integration connection slug behavior, the shipped capability rows, and links
   to every sibling page.
3. Write `setup.mdx` when the provider is connectable.
4. Write `events.mdx` only when the provider emits Shipfox-named events.
   Otherwise, omit Events from the overview capability table.
5. Write `tools.mdx` only when `capabilities[]` includes `agent_tools`.
   Otherwise, omit Agent tools from the overview capability table.
6. Add the provider `meta.json`, list only the existing pages in order, and
   register the provider directory in `integrations/meta.json`.
7. Run the docs checks before review.

### Authored and generated reference

Keep setup prose authored. The events `## Event names` table and tools
`## Tool catalog` table are candidates for Git-ignored MDX fragments generated
from provider catalogs. The tracked `events.mdx` and `tools.mdx` pages import
those fragments, keeping their navigation and authored context in the canonical
page. Docs development, build, and test commands must generate the fragments
before they read, build, or check those pages. Do not use inline markers.

## Schema fields: document only shipped surface

Document a schema field only when its feature works end to end on `main`. A field
that parses but does nothing stays undocumented. When in doubt, check the
feature's spec and Linear project. The Zod schema
(`libs/shared/workflow/document`) is the source of truth for field shapes, not
for docs visibility.

The rule cuts both ways: docs must not lag shipped features any more than they
may lead them. When a feature ships, its docs update in the same slice.

Two gates keep pages honest:

- **Executable examples.** Validate every complete workflow from the documented
  starting state. Label incomplete blocks as fragments and state where they
  belong.
- **Same-slice references.** A page may not merge before the reference facts it
  links to are corrected. No slice ships a claim that another page contradicts.

## Workflow examples

Every YAML block is one of three kinds. Make the kind clear in the sentence that
introduces it.

### Complete workflow

A complete workflow can sync and start in a fresh configured workspace after the
reader makes every documented replacement. It must:

- Contain the complete document, including `name`, a runner selection, a start
  mechanism, and at least one job.
- State every required integration connection, provider, runner, repository file, script,
  secret, variable, and permission before the block.
- Use placeholder integration connection slugs such as `github_acme` and place the
  replacement instruction next to the example.
- Pass `workflowDocumentSchema` and `normalizeWorkflowDocument`.
- Use only shipped behavior.
- Include steps that let the reader verify the promised result.

A schema-valid document without a trigger or other documented start mechanism
is not a runnable complete example.

### Fragment

A fragment demonstrates an edit inside an existing workflow. Introduce it with
an exact insertion point, such as "Add this job under the existing `jobs` map" or
"Add this field to the agent step." A fragment must:

- Include the smallest surrounding structure needed to place it correctly.
- Name the complete example or starting workflow it modifies.
- Avoid instructions to commit, sync, or run the fragment as if it were a full
  document.
- Remain schema-correct when inserted at the documented location.

### Illustrative pseudocode

Use illustrative YAML when representation, not execution, is the subject. Label
it as illustrative before the block. Never ask
the reader to run it, and never let it appear to document shipped behavior.

### Rules for every workflow example

- Steps referenced by `restart_from` use `key:`. Never use step-level `name:` as
  a reference target.
- Gate syntax is `gate.success` with `step.exit_code` and
  `gate.on_failure.{restart_from, feedback}`.
- Do not enumerate accepted values in tutorial, explanation, or how-to examples.
  Link to Reference.
- Bind untrusted event, input, listening-event, and output values through `env`
  before using them in a shell command. Quote the shell variable.
- Keep secrets out of prompts. Bind a secret only where the shipped trust model
  permits it.
- Do not imply that separate jobs share a filesystem, process environment, logs,
  or undeclared results.
- Use "workflow", never "pipeline" except when quoting another system.

## Page-type review checklist

Review the page against its declared type before reviewing style.

### Tutorial

- [ ] The page is learning-oriented and gives the learner a meaningful project.
- [ ] The author controls the path, prerequisites, and choices.
- [ ] Actions are concrete, small, and logically ordered.
- [ ] The learner sees expected results early and at every checkpoint.
- [ ] The complete journey works from the documented starting state.
- [ ] Explanation and reference detail are linked rather than embedded.

### Explanation

- [ ] The page answers a real or implied why question.
- [ ] It provides context, connections, implications, and relevant tradeoffs.
- [ ] It is bounded around one coherent subject.
- [ ] It does not instruct the reader through a task.
- [ ] Exact facts remain in canonical reference pages.
- [ ] Examples support reflection instead of becoming the page's main activity.

### How-to

- [ ] The title and opening promise one real-world result or resolution.
- [ ] The starting state and task-specific prerequisites are explicit.
- [ ] Actions follow the reader's work and include necessary decisions.
- [ ] The guide omits teaching, broad explanation, and exhaustive reference.
- [ ] The result is adaptable to realistic cases.
- [ ] The final state is observable and verified.

### Reference

- [ ] The page scope matches a shipped product surface.
- [ ] Facts are authoritative, neutral, complete, and consistently structured.
- [ ] Names, types, defaults, limits, constraints, and failure behavior match the
  source of truth.
- [ ] The structure follows the machinery readers consult.
- [ ] Examples illustrate facts without becoming task walkthroughs.
- [ ] Rationale, instruction, speculation, and marketing are absent.

Reject the page when it mixes two types. Split it and connect the new pages with
contextual links.

## Docs-app specifics

- Use the `Steps` component so each step gets a meaningful heading.
- Diagrams follow the `public/img/diagrams/*.mmd` plus rendered `.png` pattern.
  Reference the PNG only after it is rendered.
- Prefer generated content over hand-maintained tables
  (`scripts/generate.mjs` regions, checked by `turbo test`).
- Put expert or debugging detail in `Accordions`, not inline.

## Frontmatter

- `title`: becomes the H1. Tutorial and how-to titles name the concrete project
  or result. Explanation titles name the subject. Reference titles name the
  product surface.
- `sidebarTitle`: stays short. For explanation pages, it must sell the capability
  when the subject name alone does not. For task pages, it names the result.
- `description`: states the page's reader need and promised value in one or two
  sentences. It must not promise a result the body does not produce.
