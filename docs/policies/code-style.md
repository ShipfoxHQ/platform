# Code style policy

This policy defines repository-wide rules for code comments, module exports,
and readable control flow. It applies when writing or reviewing code. Package
and subsystem guides may add local conventions when their boundary needs them.

## Comments

Default to fewer comments. Well-named functions, types, and variables explain
intent. A comment that restates code adds reading cost. It can also drift from
the code. Add a comment only when a competent reader would otherwise be
surprised or stuck.

### Explain why, not what

A useful comment captures intent that code cannot express. It can record a
constraint, workaround, tradeoff, or behavior that looks wrong at first. Do not
narrate the next line.

```ts
// Algorithm-confusion guard: nothing outside the HS256 allowlist may verify.
```

```ts
// Bad: restates the code.
process.env.FOO = 'bar';
```

Prefer making a comment unnecessary. Extract a named function. Improve a
variable name. Use an idiomatic construct before adding explanation. When a
comment needs a paragraph, refactor the code first when practical.

### Use JSDoc for shared APIs

Use JSDoc for exported APIs in shared packages when callers need details that a
signature cannot show. These details include constraints, ordering, side
effects, and examples. Document behavior that is not obvious from a symbol's
name or type. Do not restate the type or name.

Use JSDoc for an internal symbol only when the same explanation helps at each
call site. Otherwise, use a short comment beside the relevant code.

### Keep process out of code

Do not add TODOs, release plans, follow-up work, or plan references to source
comments. Track future work in the issue tracker, `TODOS.md`, or a design
document.

## Module exports and imports

Avoid broad barrel files inside modules. Import from the file that owns a
symbol. For example, use `#core/auth.js` or `#presentation/dto/user.js`. Do not
use a catch-all index file.

Keep package-root exports small. Export shared entities and functions that are
part of the package's public API. Do not export internal database helpers,
routes, auth wiring, or test utilities unless another package needs them.

## Readable control flow

Use `while (true)` for an unconditional loop. Don't use `for (;;)`, because
its empty clauses hide that intent.

Name a conditional decision before branching when it combines multiple ideas.
A name such as `hasPendingStep` or `shouldRetry` makes the branch read as a
sentence. Inline checks work for obvious single comparisons.

Split a function when it mixes distinct jobs. These jobs include loading state,
checking preconditions, building a payload, handling an error, and applying a
change. Keep the top-level function as the main path. Move self-contained
branches into helpers with names that describe the decision or action. Do not
extract tiny helpers without a clear benefit.
