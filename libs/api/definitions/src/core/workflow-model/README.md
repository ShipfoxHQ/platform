# Workflow Model

Code that turns a checked workflow document into the model used by definitions.

## What it does

- **`WorkflowModel`**: Defines the stable workflow graph used after document
  parsing.
- **`normalizeWorkflowDocument(document)`**: Expands shorthand fields, assigns
  stable ids, validates explicit providers, and builds graph edges.
- **Step gates**: Parse run-step `gate.success` as a server-evaluated CEL
  predicate against context roots available at step reporting, and check
  `gate.on_failure.restart_from` against earlier named steps in the same job.
  Tool-step gates validate against the no-`exit_code` report environment.
- **Tool steps**: `normalizeToolStep` splits `family.method` tool ids, parses
  `with` interpolation trees and `outputs` mappings, types known closed catalog
  schemas, keeps open or unknown shapes dynamic, records the `steps.<key>` type
  overlay, and validates the connection, tool, and inputs against the optional
  integration context.
- **`InvalidWorkflowModelError`**: Reports semantic workflow errors found during
  normalization.

Use this module after a workflow document has passed the shared document checks.
It gives later code one shape for jobs, steps, runners, and graph edges. This is
useful even when YAML is the only file format. YAML is for people to write. The
model is for Shipfox code to use.

This split keeps each step clear. The document package checks the public shape.
This module decides what that shape means for jobs and run order. Later code can
use the model without asking how the workflow was written.

Think of this as the hand off from what a person wrote to what the system can
run. A person may use short forms and names that are easy to read. The system
needs one clear form. This module makes that form once, so the rest of the code
does not have to guess.

This is why the module is here. It gives the rest of the app a clear way to do
its work. A test can set up one case, call one thing, and check what comes back.
That keeps the next step easy to read.
It is small.

## Installation and setup

This code is part of `@shipfox/api-definitions`. It is not a standalone package.

```json
{
  "dependencies": {
    "@shipfox/api-agent-dto": "workspace:*",
    "@shipfox/workflow-document": "workspace:*"
  }
}
```

## Usage

```ts
import {normalizeWorkflowDocument} from '#core/workflow-model/index.js';

const model = normalizeWorkflowDocument({
  name: 'simple build',
  runner: 'ubuntu-latest',
  jobs: {
    build: {
      steps: [{run: 'npm test'}],
    },
  },
});

console.log(model.jobs[0]?.steps[0]?.command.value);
```

## Behavior notes

The model does not own project ids, commit shas, refs, dates, database rows, or
file paths. Those fields belong to `WorkflowDefinition`.

Trigger filters stay as source strings in this module until event schemas define
the expression context needed to type-check them.

Event selectors use one document shape, `{source, event, with, filter}`, in
three roles. Workflow `triggers` start a run. Job `listening.on` fires job
executions. Job `listening.until` resolves the listening job.

The persisted `workflow_document` keeps author-provided runner labels exactly as
written. Canonical and defaulted labels live on `workflow_model.jobs[].runner`;
downstream consumers should read the model, not `document.runner`.

Run-step gate expressions are different. They are server-evaluated predicates,
so this module parses them against the shared context registry, rejects
runner-host roots, and checks that each root is available at step reporting. The
accepted model stores a `WorkflowExpression` with `language: 'cel'`, the
original source string, and the strongest check mode the referenced roots allow.

Agent steps keep omitted `provider`, `model`, and `thinking` fields omitted in
the definition model. Run materialization resolves runner-ready catalog defaults
before execution. Explicit providers are checked against the shared provider
catalog; explicit model ids are preserved because the shared seed catalog does
not yet carry each provider's full model list.

For now, run-step gates can use typed roots such as `step.exit_code`,
`step.status`, open output fields such as `step.outputs.pass`, and other server
roots that are available by step reporting. Guard optional output keys with
`has(step.outputs.pass)` before reading them so missing keys fail as a normal
false predicate instead of an uncheckable evaluation error.

Tool output mappings use the catalog `outputSchema` when it proves a closed,
all-required shape. Open objects, optional properties, and provider schemas with
an unknown shape produce `map` or `dyn` values, so mapped outputs are persisted
as schema-less JSON while retaining numeric, boolean, and structured values at
runtime. A tool without an output schema keeps its reserved `result` root open.

`on_failure.restart_from` must name an earlier step in the same job. The runtime
host does not execute restart semantics yet. This module only records the
accepted meaning in the model.

If a rule needs project data or database state, put that rule in another layer.
This module should stay pure and easy to test.

If a rule can be checked from the document alone, it can live here. If a rule
needs a project, a user, a commit, or a database row, it should live with that
data.

Run this step before saving a new definition. That way bad links, bad ids, and
bad gate rules stop early, while the caller still knows which file field caused
the problem.

This also makes the next step simpler. The next step can read one clear shape
instead of checking many short forms again.

## Development

```sh
turbo check --filter=@shipfox/api-definitions
turbo type --filter=@shipfox/api-definitions
turbo test --filter=@shipfox/api-definitions
```

## License

MIT
