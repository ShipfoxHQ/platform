<div align="center">
  <img width="1200" height="630" alt="shipfox-og" src="https://github.com/user-attachments/assets/4a977e17-c81d-4ab5-b815-7f4439b320ef" />
</div>

<p align="center">
  <a href="https://www.shipfox.io/docs"><b>Docs</b></a> ·
  <a href="https://www.shipfox.io/docs/getting-started"><b>Getting started</b></a> ·
  <a href="https://www.shipfox.io/docs/understand"><b>Concepts</b></a> ·
  <a href="https://join.slack.com/t/shipfoxcommunity/shared_invite/zt-42wdu4lvl-KiYxEKCzzHUCafiC0EjbVA"><b>Slack community</b></a> ·
  <a href="CONTRIBUTING.md"><b>Contributing</b></a>
</p>

**Shipfox is an agentic workflows platform for engineering teams.**

Shipfox turns engineering work into automated workflows built from AI agents and
shell commands. Workflows live as YAML in your repository and react to events
across your stack. Shipfox handles orchestration, secure tool access, isolated
execution, and monitoring.

[Get your first workflow running now](https://www.shipfox.io/docs/getting-started).

## Highlights

- **Agents that stay under control.** Agent steps, where a model decides what to
  do, sit next to shell steps that run your exact commands. You set the
  structure. The model works inside it.
- **Loops that run until the result is correct.** A
  [gate](https://www.shipfox.io/docs/understand/feedback-loops) is a pass/fail
  check on a step. When it fails, the workflow loops back to an earlier step and
  tries again, up to a safe limit. That is how an agent keeps going until the
  tests pass, with no scripting.
- **Long-running, event-driven agents.** A [listening
  job](https://www.shipfox.io/docs/understand/listening-jobs) stays alive across
  a run and runs an agent on each new batch of events (PR review comments, new
  issues) until a resolution condition is met. Asynchronous agent loops, not
  one-shot runs.
- **Triggers from your whole stack.** Start runs from GitHub, Sentry, Slack,
  Linear, and more through integrations. Missing one? Point it at the [generic
  webhook](https://www.shipfox.io/docs/integrations/webhooks) and trigger on its
  events too. Connect several of the same provider and target each independently.
- **Secure by design.** Each job runs isolated in a runner next to your code that
  polls outbound for work, so nothing connects in. No data stays between two
  runs, and each agent reaches only the tools you allow.
- **One place to control everything.** Every run streams its jobs, steps, agent
  messages, thinking, tool calls, tokens, and cost while it happens.
- **Your harness, your keys.** Run an agent step on the `pi` harness (any of 30+
  model providers) or the `claude` harness (the Claude Agent SDK on your
  Anthropic key), chosen per step.
- **Open source and self-hostable.** The whole platform is MIT licensed. Run it
  on your own infrastructure so that your code and your credentials never leave
  it.

## What teams build with Shipfox

- **Triage monitoring errors.** A new error starts an agent that produces a fix
  and opens a pull request.
- **Turn tickets into code.** An assigned ticket starts an agent that opens a
  pull request and responds to review comments.
- **Fix failing CI.** A failing check starts an agent that produces a fix and
  makes the check pass again.
- **Review pull requests.** Each new pull request gets an agent review based on
  the team's guidelines, with follow-up on later changes.

## Getting started

Start with the [Getting Started guide](https://www.shipfox.io/docs/getting-started).
Self-hosting Shipfox? See the
[installation docs](https://www.shipfox.io/docs/installation).

Contributing to Shipfox? Read [CONTRIBUTING.md](CONTRIBUTING.md).

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

[MIT License](LICENSE)
