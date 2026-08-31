import type {ProvisionerTemplate} from '#types.js';

/**
 * GitHub Actions-style subset matching: a runner started from `offered` labels can
 * serve demand for `required` labels when every required label is present. Order and
 * extra offered labels do not matter.
 */
export function labelsSatisfiedBy(
  required: readonly string[],
  offered: readonly string[],
): boolean {
  const offeredSet = new Set(offered);
  return required.every((label) => offeredSet.has(label));
}

/**
 * Deterministic preference order when several templates satisfy the same reservation
 * label set: cheapest first, then the most specific match (fewest extra labels, so a
 * generic job does not consume a specialized box), then template key for a stable tie
 * break. The ordering depends only on the templates, never on input order, so
 * selection is reproducible and testable.
 */
export function rankTemplatesForLabels<Spec>(
  required: readonly string[],
  templates: readonly ProvisionerTemplate<Spec>[],
): ProvisionerTemplate<Spec>[] {
  return templates
    .filter((template) => labelsSatisfiedBy(required, template.labels))
    .sort(compareTemplatePreference);
}

/**
 * The single template the provisioner would pick for a reservation, ignoring
 * capacity. Capacity-aware fan-out lives in `planLaunches`; this is the simple
 * deterministic choice for one label set.
 */
export function selectTemplate<Spec>(
  required: readonly string[],
  templates: readonly ProvisionerTemplate<Spec>[],
): ProvisionerTemplate<Spec> | undefined {
  return rankTemplatesForLabels(required, templates)[0];
}

// The backend attributes a label-set reservation to templates by label count then key
// (it has no cost signal); the provisioner fills by cost first. The two orderings can
// pick different templates, and that is intentional: grants are count- and
// label-set-scoped (never template-bound), the provisioner owns template choice by
// design, and it re-advertises true per-template capacity every poll, so any mismatch
// self-corrects within one reservation TTL and can never over-launch.
function compareTemplatePreference<Spec>(
  a: ProvisionerTemplate<Spec>,
  b: ProvisionerTemplate<Spec>,
): number {
  if (a.cost !== b.cost) return a.cost - b.cost;
  if (a.labels.length !== b.labels.length) return a.labels.length - b.labels.length;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}
