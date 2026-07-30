import type {
  ExpressionType,
  OutputDeclarations,
  ResolvedFieldSegment,
  WorkflowExpression,
} from '@shipfox/expression';
import type {AgentThinking, Harness} from '@shipfox/workflow-document';
import {z} from 'zod';

export const DEFAULT_RUN_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_JOB_SUCCESS = "!executions.exists(e, e.status == 'failed')";

export interface WorkflowModelJobCheckout {
  readonly permissions: {readonly contents: 'read' | 'write'};
  readonly persistCredentials: boolean;
}

export const DEFAULT_JOB_CHECKOUT: WorkflowModelJobCheckout = {
  permissions: {contents: 'read'},
  persistCredentials: true,
};

export type WorkflowFieldTemplate = readonly ResolvedFieldSegment[];
export type WorkflowEnvTemplates = Readonly<Record<string, WorkflowFieldTemplate>>;
export type WorkflowOutputTemplates = Readonly<Record<string, WorkflowFieldTemplate>>;

export interface WorkflowModel {
  readonly kind: 'workflow';
  readonly name: string;
  readonly runName?: WorkflowFieldTemplate;
  readonly env?: Readonly<Record<string, string>>;
  readonly templates?: {readonly env?: WorkflowEnvTemplates};
  readonly triggers: readonly WorkflowModelTrigger[];
  readonly jobs: readonly WorkflowModelJob[];
  readonly dependencies: readonly WorkflowModelDependency[];
}

export interface WorkflowModelTrigger {
  readonly id: string;
  readonly key: string;
  readonly source: string;
  readonly event: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly filter?: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface WorkflowModelJob {
  readonly id: string;
  readonly key: string;
  readonly mode: 'one_shot' | 'listening';
  readonly runner: readonly string[];
  readonly runnerTemplates?: readonly WorkflowFieldTemplate[];
  readonly checkout: WorkflowModelJobCheckout;
  readonly if?: WorkflowExpression;
  readonly success?: string;
  readonly outputs?: WorkflowOutputTemplates;
  readonly outputTypes?: Readonly<Record<string, ExpressionType>>;
  readonly executionTimeoutMs?: number;
  readonly listening?: WorkflowModelJobListening;
  readonly name?: WorkflowFieldTemplate;
  readonly executionName?: WorkflowFieldTemplate;
  readonly env?: Readonly<Record<string, string>>;
  readonly templates?: {readonly env?: WorkflowEnvTemplates};
  readonly dependencies: readonly string[];
  readonly steps: readonly WorkflowModelStep[];
}

export interface WorkflowModelJobListening {
  readonly on: readonly WorkflowModelListeningTrigger[];
  readonly until?: readonly WorkflowModelListeningTrigger[];
  readonly timeoutMs?: number;
  readonly maxExecutions?: number;
  readonly batch?: WorkflowModelListeningBatch;
  readonly onResolve: 'finish' | 'cancel';
}
export interface WorkflowModelListeningTrigger {
  readonly source: string;
  readonly event: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly filter?: string;
}
export interface WorkflowModelListeningBatch {
  readonly debounceMs?: number;
  readonly maxSize?: number;
  readonly maxWaitMs?: number;
}
export type WorkflowModelStep = WorkflowModelRunStep | WorkflowModelAgentStep;
interface WorkflowModelStepBase {
  readonly id: string;
  readonly key?: string;
  readonly if?: WorkflowExpression;
  readonly name?: string;
  readonly workingDirectory?: string;
  readonly outputs?: OutputDeclarations;
  readonly gate?: WorkflowModelStepGate;
  readonly sourceLocation?: WorkflowSourceLocation;
}
export interface WorkflowModelRunStep extends WorkflowModelStepBase {
  readonly kind: 'run';
  readonly command: {readonly kind: 'shell'; readonly value: string};
  readonly env?: Readonly<Record<string, string>>;
  readonly templates?: {
    readonly command?: WorkflowFieldTemplate;
    readonly name?: WorkflowFieldTemplate;
    readonly workingDirectory?: WorkflowFieldTemplate;
    readonly env?: WorkflowEnvTemplates;
  };
}
export interface WorkflowModelAgentStep extends WorkflowModelStepBase {
  readonly kind: 'agent';
  readonly harness?: Harness;
  readonly model?: string;
  readonly provider?: string;
  readonly thinking?: AgentThinking;
  readonly tools?: readonly string[];
  readonly integrations?: readonly WorkflowModelStepIntegration[];
  readonly prompt: string;
  readonly templates?: {
    readonly prompt?: WorkflowFieldTemplate;
    readonly model?: WorkflowFieldTemplate;
    readonly provider?: WorkflowFieldTemplate;
    readonly workingDirectory?: WorkflowFieldTemplate;
    readonly name?: WorkflowFieldTemplate;
  };
}
export interface WorkflowModelStepIntegration {
  readonly connection?: string;
  readonly include: readonly string[];
  readonly exclude?: readonly string[];
  readonly allowWrite: boolean;
}
export interface WorkflowSourceLocation {
  readonly startLine: number;
  readonly endLine: number;
}
export type WorkflowStepSourceLocationMap = ReadonlyMap<
  string,
  ReadonlyMap<number, WorkflowSourceLocation>
>;
export interface WorkflowModelStepGate {
  readonly success?: WorkflowExpression;
  readonly onFailure?: WorkflowModelStepFailureAction;
}
export interface WorkflowModelStepFailureAction {
  readonly restartFrom: string;
  readonly feedback?: string;
  readonly feedbackTemplate?: WorkflowFieldTemplate;
}
export interface WorkflowModelDependency {
  readonly from: string;
  readonly to: string;
}
export interface WorkflowSourceSnapshot {
  readonly content: string;
  readonly format: 'yaml';
}

const workflowModelSchema = z.custom<WorkflowModel>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as {kind?: unknown}).kind === 'workflow',
  {message: 'Expected a normalized workflow model'},
);

export const workflowModelSnapshotSchema = z.object({
  version: z.literal(1),
  model: workflowModelSchema,
});
export type WorkflowModelSnapshot = z.infer<typeof workflowModelSnapshotSchema>;

export function createWorkflowModelSnapshot(model: WorkflowModel): WorkflowModelSnapshot {
  return {version: 1, model};
}

export function workflowModelFromSnapshot(snapshot: WorkflowModelSnapshot): WorkflowModel {
  switch (snapshot.version) {
    case 1:
      return snapshot.model;
  }
}

/** Reads both current snapshots and the unversioned attempt rows written before snapshots existed. */
export function readPersistedWorkflowModel(
  value: WorkflowModel | WorkflowModelSnapshot,
): WorkflowModel {
  if ('version' in value)
    return workflowModelFromSnapshot(workflowModelSnapshotSchema.parse(value));
  return workflowModelSchema.parse(value);
}
