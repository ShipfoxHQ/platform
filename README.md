<div align="center">
  <img src="https://www.shipfox.io/og-image.png" alt="Shipfox" width="640" />
</div>

<p align="center">
  <a href="https://www.shipfox.io/docs"><b>Docs</b></a> ·
  <a href="#getting-started"><b>Getting started</b></a> ·
  <a href="#core-concepts"><b>Concepts</b></a> ·
  <a href="https://join.slack.com/t/shipfoxcommunity/shared_invite/zt-42wdu4lvl-KiYxEKCzzHUCafiC0EjbVA"><b>Slack community</b></a> ·
  <a href="CONTRIBUTING.md"><b>Contributing</b></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" />
</p>

**Build your software factory.**

Shipfox is a continuous shipping platform for workflows that reason and react:
every step is a shell command or an AI agent, and events drive the run from start
to finish. A software factory that assembles itself in your repo.

```yaml
name: Fix new Sentry issues
runner: ubuntu-latest
triggers:
  on_issue:
    source: sentry_acme            # a new Sentry issue starts the run
    event: issue.created
jobs:
  fix:
    steps:
      - run: npm install
      - key: fix                    # an agent step
        model: claude-opus-4-8
        prompt: >
          Sentry reported "${{ event.title }}" (${{ event.webUrl }}).
          Reproduce it in this repository, find the root cause, and fix it.
      - run: npm test               # verify the fix
        gate:
          on_failure:
            restart_from: fix        # send the agent back until the tests pass
            feedback: Unit tests are failing
```

If you've written GitHub Actions, you already know how to read this file, and
that's deliberate. What's different is what a step can be and the control flow
around it: a Sentry issue starts the run, an agent reproduces and fixes the cause,
then a `gate` reruns the tests and sends the agent back until they pass.

## Highlights

- **Workflows as code.** YAML under `.shipfox/workflows/`, versioned and reviewed
  like the rest of your repo. No plugin, no action, no glue.
- **Trigger from your whole stack.** Start runs from GitHub, Sentry, Slack, Linear,
  and more through integrations. Missing one? Point it at the generic webhook
  integration and trigger on its events too. Connect several of the same provider
  and target each independently.
- **Automatic retry loops.** Guard a step with a check (a *gate*): when it fails,
  the workflow loops back to an earlier step and tries again, up to a safe limit.
  That is how an agent keeps going until the tests pass, with no scripting.
- **Long-running, event-driven agents.** A listening job stays alive across a run
  and runs an agent on each new batch of events (PR review comments, new issues)
  until a resolution condition is met. Asynchronous agent loops, not one-shot runs.
- **See the agent think.** Agent steps stream structured events (messages,
  thinking, tool calls, token usage, and cost), rather than raw text.
- **Pick the agent, not the model.** Run an agent step on the `pi` harness
  (any of 30+ providers) or the `claude` harness (the Claude Agent SDK on your
  Anthropic key), chosen per step.
- **Isolated, outbound-only runs.** Each job runs isolated in a runner that polls
  outbound for work, so nothing connects in. Bring your own keys across 30+ model
  providers.

## Core concepts

| Concept | Summary |
|---|---|
| **Workflow** | A YAML file under `.shipfox/workflows/`, versioned and reviewed like code. One file, one workflow. |
| **Trigger** | What starts a run: an event from a connected integration, or an on-demand fire. |
| **Integration** | A connection to an external tool (GitHub, Sentry, Slack, Linear, ...) whose events start runs. Use the [generic webhook](apps/docs/content/docs/integrations/webhooks/index.mdx) to connect anything not built in. |
| **Job** | A group of steps on one runner. Jobs form a DAG via `needs` and are isolated, so each re-clones the repo. |
| **Step** | A `run` shell command or an agent (`model` + `prompt`, on the `pi` or `claude` harness). Runs in order within a job. |
| **Gate** | A pass/fail [check on a step](apps/docs/content/docs/understand/feedback-loops.mdx) that retries from an earlier step when it fails. Bounded retry loops, no scripting. |
| **Listening job** | A [job that waits on events](apps/docs/content/docs/understand/listening-jobs.mdx) and runs again per batch inside the same run, until a resolution condition. Drives event-driven, asynchronous workflows. |
| **Runner** | The application that runs a job's steps. |

## Getting started

Try Shipfox on your machine with the
[Local Evaluation guide](https://www.shipfox.io/docs/installation/local): it runs
the full stack locally, then walks you through connecting a project, registering a
runner, and firing your first run. To run Shipfox for your team, see the
[installation docs](https://www.shipfox.io/docs/installation).

Working on Shipfox itself? See [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

Full documentation is published at [shipfox.io/docs](https://www.shipfox.io/docs).

## Community

- **Slack:** join the [Shipfox community Slack](https://join.slack.com/t/shipfoxcommunity/shared_invite/zt-42wdu4lvl-KiYxEKCzzHUCafiC0EjbVA)
  for help, ideas, and release news.
- **Issues:** report bugs and request features on
  [GitHub Issues](https://github.com/ShipfoxHQ/shipfox/issues).

## Security

Report vulnerabilities privately by emailing **security@shipfox.io** rather
than opening a public issue. See [SECURITY.md](SECURITY.md) for details. Shipfox's
token and trust model is documented in the
[auth security model](libs/api/auth/README.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull request. Its task
map links to the engineering guide for each change.

## License

[MIT](LICENSE) © Shipfox
