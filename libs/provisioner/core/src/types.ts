import type {ProvisionerClient} from '#api-client.js';
import type {ProviderRunnerTracker} from '#tracker.js';

/**
 * A machine template the provisioner can start runners from. The control loop is
 * provider-agnostic and only reads the fields needed to match demand and respect
 * capacity; provider-specific details (a Docker image, a Kubernetes pod spec, an
 * EC2 launch template) live opaquely in `spec` and are read by the launcher.
 */
export interface ProvisionerTemplate<Spec = unknown> {
  /** Stable, unique key identifying the template within the provisioner config. */
  readonly key: string;
  /** Canonical labels a runner started from this template registers with. */
  readonly labels: readonly string[];
  /** Maximum runners the provisioner will keep alive concurrently for this template. */
  readonly maxConcurrency: number;
  /** Enrolled, unassigned runners this template keeps ready without demand. */
  readonly targetConcurrency?: number;
  /**
   * Selection cost; lower is preferred when several templates satisfy the same
   * reservation. Providers map this to whatever they optimize for (Docker uses
   * an explicit cost when set and falls back to vCPU count when it is omitted).
   */
  readonly cost: number;
  /** Provider-specific launch details, opaque to the control loop. */
  readonly spec: Spec;
}

/** Live counts of provisioned runners the provisioner is managing for one template. */
export interface TemplateCounts {
  readonly starting: number;
  readonly running: number;
}

/**
 * One runner the control loop has decided to start. The bootstrap token is a
 * single-use secret and must never be logged.
 */
export interface ProviderRunnerLaunch<Spec = unknown> {
  readonly runnerInstanceId: string;
  readonly providerRunnerId: string;
  readonly reservationId?: string;
  readonly template: ProvisionerTemplate<Spec>;
  readonly bootstrapToken: string;
  /** Environment to inject into the runner process (carries the bootstrap token). */
  readonly runnerEnv: Readonly<Record<string, string>>;
}

/** Facts about the provider launch lifecycle after the provider attempted the side effect. */
export interface LaunchOutcome {
  readonly containerStarted: boolean;
  readonly identityAttached: boolean;
  readonly reported: boolean;
}
/** Starts one provisioned runner. Legacy adapters may still resolve without an outcome. */
export type LaunchRunner<Spec = unknown> = (
  launch: ProviderRunnerLaunch<Spec>,
  // biome-ignore lint/suspicious/noConfusingVoidType: preserve compatibility with existing adapters that only signal completion
) => Promise<LaunchOutcome | void>;

/** Applies the current provider-termination snapshot; an empty list withdraws the intent. */
export type TerminateRunners = (providerRunnerIds: readonly string[]) => Promise<void>;

export interface ProvisionerIdentity {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly scope?: 'workspace' | 'installation';
}

export interface ProvisionerRuntime {
  readonly client: ProvisionerClient;
  readonly identity: ProvisionerIdentity;
  readonly tracker: ProviderRunnerTracker;
}

/**
 * The provider plug-in the control loop drives. A provider supplies its templates
 * (parsed and validated from local config) and a launcher that actually starts a
 * runner from a bootstrap token.
 */
export interface ProvisionerAdapter<Spec = unknown> {
  loadTemplates(): Promise<readonly ProvisionerTemplate<Spec>[]>;
  /** Optional provider details added to the startup configuration record. */
  onConfigure?(args: {
    templates: readonly ProvisionerTemplate<Spec>[];
  }): Promise<Readonly<Record<string, unknown>>>;
  readonly launch: LaunchRunner<Spec>;
  readonly terminate?: TerminateRunners;
  onStart?(runtime: ProvisionerRuntime): Promise<void>;
  onTick?(): Promise<void>;
  onStop?(): Promise<void>;
}
