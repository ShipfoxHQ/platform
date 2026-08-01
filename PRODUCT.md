# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is any engineer who wants to automate engineering work with AI
agents that react to events. They write workflows as YAML in their own
repository, wire them to the tools they already use (GitHub, Sentry, Slack,
Linear, generic webhooks), and monitor runs live in the dashboard. They are
comfortable reading a GitHub Actions file, live in terminals and logs, and expect
data density, unambiguous status, and no marketing fluff.

## Product Purpose

Shipfox is your AI software factory. It turns engineering work into automated
workflows built from shell commands and AI agents. Workflows plug into the tools
that power an engineering team, such as ticketing, monitoring, chat, and source
control, through one secured layer. The same connection that starts a workflow
when something happens also lets the workflow act back on those tools. Runs
happen in ephemeral, sandboxed environments and are fully observable end to end,
so teams can see what their agents did, why, and at what cost.

Success is that a user connects a repository and gets their first real workflow
running in minutes, then keeps coming back to run agent workflows that react to
events from their stack.

## Positioning

Shipfox sits between two categories and beats each on its own ground.

**Versus CI platforms** (GitHub Actions, GitLab CI). Shipfox starts work from far
more of an engineering team's tools than a code push, and treats AI agents as a
native building block instead of something you script by hand. Its control flow is
built for agent loops: a workflow can retry until a check passes, and a job can
stay alive and react to each new batch of events. Declaring these loops replaces
hand-written orchestration.

**Versus agent frameworks** (LangGraph and similar). A framework hands you a
library and leaves you to build, deploy, maintain, and keep updating a new service
around it. Shipfox is a platform that absorbs that operational work, so teams
spend their time defining workflows and nothing else.

Across both, Shipfox wins on the time it takes to launch a first agent workflow,
and on how far a team can scale and control their factory from there.

## Operating Context

- **Authoring.** Workflows are YAML files under `.shipfox/workflows/`, versioned
  and reviewed like the rest of the repo. If you can read a GitHub Actions file,
  you can read a Shipfox workflow.
- **Triggering.** Runs start from events on connected integrations (GitHub,
  Sentry, Slack, Linear, and a generic webhook for anything else) or on demand.
- **Execution.** Workflows run in ephemeral, sandboxed runners. On cloud, Shipfox
  provides and manages them. Teams can also register their own runners or have
  Shipfox provision them on demand in their own infrastructure.
- **Observation.** The dashboard gives full visibility into every run, so teams can
  troubleshoot failures, monitor how workflows behave over time, and fine-tune
  them.

## Capabilities and Constraints

Confirmed vocabulary (canonical terms, keep them consistent):

- **Workflow:** one YAML file under `.shipfox/workflows/`; one file, one workflow.
- **Trigger:** what starts a run, an integration event or an on-demand fire.
- **Integration:** a connection to an external tool whose events start runs.
- **Job:** a group of steps on one runner; jobs form a DAG via `needs` and are
  isolated (each re-clones the repo).
- **Step:** a `run` shell command or an agent (`model` + `prompt`), run in order
  within a job.
- **Gate:** a pass/fail check on a step that retries from an earlier step on
  failure, up to a safe limit.
- **Listening job:** a job that waits on events and runs again per batch inside
  the same run until a resolution condition.
- **Runner:** the sandboxed process that executes a job. Shipfox provides and
  manages runners on cloud; users can also register their own or have Shipfox
  provision them in their infrastructure.
- **Harness:** the agent runtime for an agent step. `pi` runs any of 30+
  providers; `claude` runs the Claude Agent SDK on the user's Anthropic key,
  chosen per step.

Shipfox works with multiple agent harnesses and models, and adapts to what a
repository already defines, such as its skills.

Constraints:

- Workflows are authored only as YAML in the user's repository, one file per
  workflow.
- Shipfox is not a model provider yet; every agent step runs through a model
  provider the user connects with their own key.

## Brand Commitments

- **Name:** Shipfox. Domain: shipfox.io.
- **Tagline:** "Your AI software factory."
- **Voice:** direct, technical, no marketing fluff. Written for engineers who read
  logs at 2am. See `WRITING.md` and `apps/docs/WRITING.md` for repository prose
  conventions; product docs terminology there is binding.
- The existing visual design system is documented in `DESIGN.md` and implemented
  in `@shipfox/react-ui`.

## Evidence on Hand

- **Working product and docs.** Full stack in this monorepo; published docs at
  shipfox.io/docs (`apps/docs/`); public repo at github.com/ShipfoxHQ/shipfox.
- **Real demonstration assets.** Dashboard run videos exist
  (`apps/docs/public/img/job-run-*.mp4`) showing an agent step streaming thinking
  and tool calls live. The `og-image.png` and marketing assets live on shipfox.io.
- **Community proof.** Public Slack community and GitHub Issues.
- No customer testimonials, named logos, benchmarks, or pricing numbers are
  established here. Future work must not fabricate them; source them from the
  business before using them as proof.

## Product Principles

1. **Minutes to first run.** The distance from a connected repository to a real
   run is the one number the product optimizes above all else, especially on
   cloud. Every surface earns its place by not adding to it.
2. **Build on what engineers already trust.** Workflows live as versioned YAML in
   the user's repository, authored and reviewed like the rest of their code. We
   extend the conventions engineers already know instead of inventing new ones,
   because familiarity is the shortest path to adoption.
3. **Low floor, high ceiling.** The fast path never caps what is possible.
   Defaults get a user running immediately, and depth is there the moment they
   reach for it, never required to start. Speed and control do not trade off.
4. **Open by default.** Shipfox fits into a team's existing stack rather than
   asking them to standardize on ours. Managed defaults keep the fast path fast;
   when a team needs to bring their own or reach something we do not natively
   cover, the door is always open. No lock-in.
5. **Observability is how teams scale.** Full visibility into every run turns a
   first workflow into a system a team depends on. Troubleshooting, watching
   behavior over time, and tuning are the path from one run to running an
   operation on Shipfox.

## Delivery Model

Three tiers, with the design center of gravity on cloud:

- **Open source (MIT), self-hostable.** Limited and accessible; aimed at
  individuals evaluating or running Shipfox for themselves. The whole stack can be
  self-hosted.
- **Hosted cloud.** The main experience Shipfox optimizes for, because it delivers
  the "running in minutes" promise. Onboarding and growth surfaces are cloud-only
  (`ShipfoxHQ/cloud`).
- **Enterprise, full-featured self-hostable.** The complete platform run on the
  customer's own infrastructure for teams that require self-hosting.
