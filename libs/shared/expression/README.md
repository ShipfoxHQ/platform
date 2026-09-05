# Expression

CEL checks and run-time evaluation for Shipfox workflow expressions.

## What it does

- **`createWorkflowExpression`**: Checks source text in `syntax` or `typed`
  mode.
- **`WorkflowExpression`**: Stores the CEL tag, source, and check level.
- **`ExpressionTypeEnvironment`**: Lists names and field types for typed checks.
- **`ExpressionType`**: Represents scalar, structured, open-map, and dynamic
  (`dyn`) values in typed expression metadata.
- **`evaluateWorkflowExpression`**: Runs a checked value against caller data.
- **`createWorkflowEnvironment`**: Creates an isolated evaluator with the shared
  `list.first()`, `list.last()`, `range()`, `toJson()`, and `fromJson()`
  functions.
- **`evaluateWorkflowExpressionWithEnvironment`**: Runs a checked value against
  a caller-owned CEL environment for explicitly scoped custom functions.
- **`WorkflowExpressionEnvironment`**: The evaluate-only environment shape
  accepted by the scoped evaluator.
- **`evaluateWorkflowPredicateFailClosed`**: Reports evaluation failures,
  including non-boolean predicate results, alongside the boolean value.
- **`createRangeEnvironment`**: Compatibility alias for
  `createWorkflowEnvironment`.
- **`MAX_RANGE_ELEMENTS`**: The per-evaluation range materialization limit,
  currently 1,000 values.
- **`MAX_RANGE_FANOUT_BYTES`**: The per-evaluation context-sized range fan-out
  limit, currently 1,000,000 bytes.
- **`MAX_JSON_OUTPUT_BYTES`**: The per-evaluation `toJson()` output limit,
  currently 1,000,000 UTF-8 bytes.
- **`evaluateWorkflowPredicate`**: Returns `true` only for the boolean `true`.
- **`classifyShellCodePosition`**: Finds named workflow bindings passed directly
  to shell positions that re-evaluate their arguments.
- **`parseWorkflowTemplate`**: Splits strings with `${{ ... }}` spans into
  ordered literal and expression segments.
- **`extractCelContextRoots`**: Returns the sorted top-level CEL identifiers mentioned
  by an expression for downstream context and agent-selection checks.
- **`analyzeContextPathAccess`**: Returns exact literal context paths per root and
  reports dynamic access as unknown for conservative snapshot planning. Its
  `ContextPath*` types describe path segments, references, and unknown accesses.
- **Typed errors**: Reports bad text and run failures with stable error classes.
- **`workflowContextDefinitions`**: Names the workflow contexts (`run`,
  `trigger`, `event`, `inputs`, `job`, `executions`, `execution`, `jobs`, `step`) and
  gives each a shape, availability site, sensitivity, and host.
  Known-shape contexts ship a typed environment; open ones use `syntax`.
- **`buildTypedRootsEnvironment`**: Builds typed step and job roots. Tool steps
  expose `outputs.result` from their catalog schema and omit `exit_code`.
- **`toolStepReportTypeEnvironment`** and **`WorkflowStepKind`**: Describe the
  gate context and kind metadata for tool-step expression checks.
- **`workflowInterpolationFieldPolicies`**: Defines the host, fill-site, and
  failure constraints for each interpolatable field. Use
  `workflowInterpolationFieldAcceptsHost` for host checks and
  `getWorkflowInterpolationFieldTypeEnvironment` for field-specific types.
- **`workflowPredicateContextRoots`**: Defines the exact context roots each
  predicate field receives. Read it with `getWorkflowPredicateContextRoots`,
  narrow runtime context with `projectWorkflowPredicateContext`, and read
  predicate-specific property shapes with
  `getWorkflowPredicateFieldTypeEnvironment`.

Use this package where workflow code accepts or runs expression text. It keeps
the CEL parser behind a Shipfox API. Other packages do not need to depend on the
vendor parser.

Call it near the place where a person, file, or tool gives us text. If the text
is wrong, stop there and show the error near that field. If the text is good,
save the small value this package returns. Later, pass that value and plain data
back to this package to get the result for one run.

## Installation and setup

```sh
pnpm add @shipfox/expression
```

## Usage

```ts
import {
  createWorkflowExpression,
  evaluateWorkflowPredicate,
} from '@shipfox/expression';

const expression = createWorkflowExpression({
  source: 'event.conclusion == "success"',
  check: {
    mode: 'typed',
    typeEnvironment: {
      event: {kind: 'object', fields: {conclusion: 'string'}},
    },
  },
});

const passed = evaluateWorkflowPredicate(expression, {
  event: {conclusion: 'success'},
});
```

## Behavior notes

- Use `syntax` when fields are not known yet.
- Use `typed` when the caller knows the names and field types in scope.
- `dyn` represents a value whose shape is not known at check time. It can be
  used in any expected scalar position; the runtime still checks operations and
  predicate results.
- `fromJson()` results and lookups through open maps are `dyn`. Closed object
  schemas continue to reject unknown fields during typed checking.
- Predicate evaluation narrows the supplied context to the roots
  `workflowPredicateContextRoots` declares for that field, so a reference
  outside the policy fails closed rather than reading an incidental value.
- `evaluateWorkflowPredicate` preserves its boolean-only mapping: only `true`
  passes, while a non-boolean result returns `false`. Use
  `evaluateWorkflowPredicateFailClosed` when callers must distinguish that
  result from an evaluation failure.
- Context values can include external data. Interpolatable fields rely on their
  structural sink guarantees, while host and availability checks remain enforced.
- Evaluation is deterministic and has no side effects.
- Workflow evaluation includes the shared `list.first()`, `list.last()`,
  `range()`, `toJson()`, and `fromJson()` functions. Use a caller-owned
  environment when a custom function is intentionally needed outside that
  registry.
- `list.first()` and `list.last()` return the first or final element and
  preserve its type. An empty list causes an evaluation error.
- `range()` accepts CEL integers and safe integer values from JavaScript
  contexts. An environment is built once and reused, and each evaluation gets
  its own materialization budget, shared by nested range calls and restored when
  a context accessor re-enters the evaluator; each evaluation can materialize at
  most 1,000 values and 1,000,000 context-byte fan-out units.
- `toJson()` writes integers outside the safe-integer range as quoted strings, so
  a round trip through `fromJson()` returns them as strings rather than numbers.
  Safe JSON numbers parsed by `fromJson()` become CEL integers, and all
  `toJson()` output shares a 1,000,000-byte budget per evaluation.
- Field resolution remains string-based by default. Callers rendering config
  objects may opt into raw values for an exact single expression with
  `preserveSingleExpressionType: true`; mixed literal and expression fields
  remain strings. Under the `fail` policy, missing exact typed fields fail
  rather than silently becoming an empty string; `runner-fill` segments remain
  deferred for the runner instead of being hard-failed server-side.
- The caller must pass values that match the checked data shape.
- The evaluator does not read secrets, database rows, events, files, or external
  services.
- Template parsing throws only `InvalidWorkflowTemplateError`. The error includes
  the full source, the span `offset`, and a reason; invalid inner CEL is wrapped
  with the inner expression error available as `cause`.
- Write a literal `${{` in template text as `$${{`. The escape is greedy from
  left to right, so `$$${{` emits literal `$${{`; there is no separate way to
  write literal `$$` immediately before a real expression opener.
  Put the dollar inside the expression when it must be dynamic, such as
  `${{ "$" + string(inputs.amount) }}`.
- Template closing scans are string-aware, line-comment-aware, and brace-aware,
  so `}}` inside CEL strings, `//` comments, or map literals does not close the
  expression span.
- Context root extraction fails closed for context checks. It skips only identifiers
  that are provably not context roots and may over-include comprehension variables or
  struct keys; downstream code maps context roots to the known workflow contexts.
- Run command interpolation hoists expression values into generated environment
  variables and references them through double-quoted shell expansion. This keeps
  interpolated values from being parsed as shell syntax, but it does not make
  commands and shell positions that deliberately re-evaluate their arguments
  safe, such as `eval`, `sh -c "$value"`, `let`, `declare -i`, arithmetic
  expressions, or array subscripts like `array[$value]`. Use
  `classifyShellCodePosition` with the generated binding names and workflow env
  names to detect these direct code-position references. The analysis is pure,
  intentionally shallow, and may miss indirect shell data flow; it is designed
  to avoid false-positive warnings.
Trigger filters can use `syntax` while integration event payloads are still open.
Gate expressions can use `typed` because their local fields are known.

The stored value does not include vendor ASTs, checked data, protobuf bytes, or
compiled objects. It stores only the CEL tag, source, and check level.

Keep this package free of state. Code that needs a database row, event payload,
secret, file, or network call must load that data first. Then it can pass the
data in one object. This keeps tests small and makes each run easy to reason
about.

## Development

```sh
turbo build --filter=@shipfox/expression
turbo check --filter=@shipfox/expression
turbo type --filter=@shipfox/expression
turbo test --filter=@shipfox/expression
```

## License

MIT
