import {isDeepStrictEqual} from 'node:util';

export interface AgentPrerequisite {
  /** Stable name used in diagnostics and completion checks. */
  readonly id: string;
  /** Model-facing tool name, or the suffix after a connection prefix. */
  readonly toolName: string;
  /** Optional method argument for method-dispatching integration tools. */
  readonly method?: string;
  /** Optional exact argument values that must be present on the successful call. */
  readonly arguments?: Readonly<Record<string, unknown>>;
}

export interface AgentPrerequisiteContract {
  /** Runtime prerequisites required before an output-complete turn may stop. */
  readonly required: readonly (AgentPrerequisite | string)[];
  /** Prerequisites established by the caller before model execution. */
  readonly satisfied?: readonly string[];
}

/**
 * Tracks deterministic runtime facts that gate an agent output contract.
 *
 * The ledger is deliberately independent of prompt text. A caller can seed it with
 * facts established before model execution, and the harness can record successful
 * matching tool calls as the model executes them.
 */
export class PrerequisiteLedger {
  readonly #requirements: readonly AgentPrerequisite[];
  readonly #satisfied: Set<string>;

  constructor(contract: AgentPrerequisiteContract | undefined) {
    this.#requirements = (contract?.required ?? []).map(normalizePrerequisite);
    const requirementIds = new Set(this.#requirements.map((requirement) => requirement.id));
    if (requirementIds.size !== this.#requirements.length) {
      const duplicateIds = this.#requirements
        .map((requirement) => requirement.id)
        .filter((id, index, ids) => ids.indexOf(id) !== index);
      throw new TypeError(
        `Agent prerequisite IDs must be unique: ${[...new Set(duplicateIds)].join(', ')}.`,
      );
    }
    this.#satisfied = new Set((contract?.satisfied ?? []).filter((id) => requirementIds.has(id)));
  }

  markSatisfied(id: string): void {
    if (this.#requirements.some((requirement) => requirement.id === id)) {
      this.#satisfied.add(id);
    }
  }

  recordToolSuccess(toolName: string, args: unknown): void {
    for (const requirement of this.#requirements) {
      if (this.#satisfied.has(requirement.id)) continue;
      if (matchesToolCall(requirement, toolName, args)) this.#satisfied.add(requirement.id);
    }
  }

  missing(): string[] {
    return this.#requirements
      .filter((requirement) => !this.#satisfied.has(requirement.id))
      .map((requirement) => requirement.id);
  }

  hasRequirements(): boolean {
    return this.#requirements.length > 0;
  }

  isComplete(): boolean {
    return this.missing().length === 0;
  }
}

function normalizePrerequisite(value: AgentPrerequisite | string): AgentPrerequisite {
  if (typeof value !== 'string') return value;

  const separator = value.lastIndexOf('.');
  if (separator === -1) return {id: value, toolName: value};
  return {
    id: value,
    toolName: value.slice(0, separator),
    method: value.slice(separator + 1),
  };
}

function matchesToolCall(requirement: AgentPrerequisite, toolName: string, args: unknown): boolean {
  const toolNameMatches =
    toolName === requirement.toolName || toolName.endsWith(`__${requirement.toolName}`);
  if (!toolNameMatches) return false;
  if (requirement.method === undefined && requirement.arguments === undefined) return true;
  if (!isRecord(args)) return false;
  if (requirement.method !== undefined && args.method !== requirement.method) return false;
  if (requirement.arguments === undefined) return true;

  return Object.entries(requirement.arguments).every(([key, value]) =>
    isDeepStrictEqual(args[key], value),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
