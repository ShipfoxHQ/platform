# Architecture decision records

Architecture decision records (ADRs) preserve durable engineering decisions.
They record the context, alternatives, decision, and consequences at the time
of the choice. They are not the complete operating guide for a system.

Read an ADR when a change crosses its decision boundary. For the current
documentation model and other engineering sources, start with the
[engineering documentation map](../README.md).

| ADR | Status | It owns |
| --- | --- | --- |
| [0001: Public client composition contract](0001-client-composition-contract.md) | Accepted | The public contract for composing Shipfox client features. |
| [0002: Server inter-module architecture](0002-api-inter-module-architecture.md) | Accepted, amended by ADR 0004 | Producer-owned server contracts and bounded-context crossings. |
| [0003: Client state and domain architecture](0003-client-state-and-domain-architecture.md) | Accepted | Client state ownership and feature-domain boundaries. |
| [0004: Shared semantic packages and server dependency boundaries](0004-shared-semantic-packages-and-server-dependency-boundaries.md) | Accepted; amends ADR 0002 | Shared package admission and server dependency boundaries. |
| [0005: Repository documentation architecture](0005-repository-documentation-architecture.md) | Accepted | Documentation ownership, routing, and progressive disclosure. |
| [0006: Database ownership boundaries](0006-database-ownership-boundaries.md) | Accepted; amends ADR 0002 | Owner-only database access and stable database namespaces. |
| [0007: Cross-repository architecture validation](0007-cross-repository-architecture-validation.md) | Accepted | Validation layers, shared policy distribution, and downstream package metadata. |
| [0008: Administration controls](0008-administration-controls.md) | Accepted | Fixed instance-administrator roles, module-owned administration behavior, and suspension semantics. |
| [0009: Client URLs and resource identity](0009-client-urls-resource-identity.md) | Accepted; amends ADR 0001 | Slug-based client URL prefixes, UUID API identities, scoped settings anchors, run-number display semantics, and composition-time route-path validation. |
| [0010: Prose standard and enforcement](0010-prose-standard-and-enforcement.md) | Accepted | The repository prose standard, its sources, accepted divergences, and enforcement model. |
| [0011: Semantic spacing layer](0011-semantic-spacing-layer.md) | Accepted | Semantic spacing roles, the component boundary, the sizing exclusion, and density posture. |

When a decision changes, add a new ADR that supersedes or amends the earlier
record. Keep the original record intact so readers can understand why the
repository made the earlier choice.
