import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import type {WorkflowExpression} from '@shipfox/expression';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {
  AgentToolMaterializationContext,
  AgentToolMaterializationSnapshot,
} from '#core/agent-tools.js';
import type {StepConfigDispatchPlan} from '#core/entities/step.js';
import {resolveStepConfig, type WorkflowStepTemplateDiagnostic} from './resolve-step-config.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowSourceLocation = NonNullable<WorkflowModelStep['sourceLocation']>;

const FIRST_LINE_PATTERN = /\r?\n/;

export interface MaterializedWorkflowStep {
  readonly key: string | null;
  readonly name: string;
  readonly sourceLocation: WorkflowSourceLocation | null;
  readonly status: 'pending';
  readonly type: WorkflowModelStep['kind'] | 'setup';
  readonly config: Readonly<Record<string, unknown>>;
  readonly condition?: WorkflowExpression;
  readonly configPlan?: StepConfigDispatchPlan;
  readonly authoredConfig: Readonly<Record<string, unknown>> | null;
  readonly diagnostics?: readonly WorkflowStepTemplateDiagnostic[];
  readonly position: number;
}

export interface MaterializeJobExecutionStepsParams {
  readonly model: WorkflowModel;
  readonly job: WorkflowModelJob;
  readonly context: WorkflowEvaluationContext;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId?: string | undefined;
  readonly agentToolContext?: AgentToolMaterializationContext | undefined;
  readonly agentToolSnapshot?: AgentToolMaterializationSnapshot | null | undefined;
}

// Synthetic "Set up job" step prepended when a job execution's steps are materialized.
// The runner prepares the workspace here; failures report through the normal step
// protocol instead of hanging the job until the lease/timeout fires. Its config is
// credential-free.
const SETUP_STEP: MaterializedWorkflowStep = {
  key: null,
  name: 'Set up job',
  sourceLocation: null,
  status: 'pending',
  type: 'setup',
  config: {},
  authoredConfig: null,
  position: 0,
};

export async function materializeJobExecutionSteps(
  params: MaterializeJobExecutionStepsParams,
): Promise<readonly MaterializedWorkflowStep[]> {
  const {
    model,
    job,
    context,
    resolveAgentDefaults,
    definitionId = model.name,
    agentToolContext,
    agentToolSnapshot,
  } = params;

  return [
    SETUP_STEP,
    ...(await Promise.all(
      job.steps.map(async (step, stepPosition) => {
        const stepContext = {
          ...context.values,
          job: {key: job.key, name: job.name ?? job.key},
        };
        const resolved = await resolveStepConfig({
          jobKey: job.key,
          step,
          workflowEnv: model.env,
          workflowEnvTemplates: model.templates?.env,
          jobEnv: job.env,
          jobEnvTemplates: job.templates?.env,
          context: stepContext,
          site: context.site,
          resolveAgentDefaults,
          definitionId,
          agentToolContext,
          agentToolSnapshot,
        });
        return {
          key: step.key ?? null,
          name: resolved.name ?? stepDisplayName(step),
          sourceLocation: step.sourceLocation ?? null,
          status: 'pending' as const,
          type: step.kind,
          config: resolved.config,
          ...(step.if === undefined ? {} : {condition: step.if}),
          authoredConfig: resolved.authoredConfig,
          ...materializedConfigPlan(resolved.configPlan, resolved.trace),
          ...(resolved.diagnostics.length === 0 ? {} : {diagnostics: resolved.diagnostics}),
          position: stepPosition + 1,
        };
      }),
    )),
  ];
}

function materializedConfigPlan(
  configPlan: StepConfigDispatchPlan | null,
  trace: NonNullable<StepConfigDispatchPlan['trace']>,
): {readonly configPlan?: StepConfigDispatchPlan} {
  if (configPlan === null && trace.length === 0) return {};
  return {configPlan: {...(configPlan ?? {}), ...(trace.length === 0 ? {} : {trace})}};
}

function stepDisplayName(step: WorkflowModelStep): string {
  const {kind} = step;
  switch (kind) {
    case 'run':
      return firstLine(step.command.value);
    case 'agent':
      return step.model === undefined
        ? firstLine(step.prompt)
        : `${step.model} · ${firstLine(step.prompt)}`;
    case 'checkout':
      return 'Checkout';
    default:
      return assertNever(step);
  }
}

function firstLine(value: string): string {
  return value.split(FIRST_LINE_PATTERN, 1)[0]?.trim() || value.trim();
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workflow step kind: ${JSON.stringify(value)}`);
}
