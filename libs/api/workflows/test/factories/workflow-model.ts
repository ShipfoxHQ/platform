import {
  DEFAULT_JOB_CHECKOUT,
  type WorkflowJsonTemplateTree,
  type WorkflowJsonValue,
  type WorkflowModel,
} from '@shipfox/api-definitions-dto';
import {
  createWorkflowExpression,
  parseWorkflowTemplate,
  planInterpolationField,
  type ResolvedFieldSegment,
  type WorkflowInterpolationField,
} from '@shipfox/expression';

type ModelStep = WorkflowModel['jobs'][number]['steps'][number];
type AgentThinking = Extract<ModelStep, {kind: 'agent'}>['thinking'];
type Harness = Extract<ModelStep, {kind: 'agent'}>['harness'];
type Checkout = Extract<ModelStep, {kind: 'checkout'}>['checkout'];
type WorkflowEnvTemplates = NonNullable<NonNullable<WorkflowModel['templates']>['env']>;

interface TestWorkflowStepBase {
  readonly key?: string | undefined;
  readonly name?: string | undefined;
  readonly workingDirectory?: string | undefined;
  readonly sourceLocation?: WorkflowModel['jobs'][number]['steps'][number]['sourceLocation'];
  readonly if?: ModelStep['if'] | undefined;
  readonly gate?: WorkflowModel['jobs'][number]['steps'][number]['gate'] | undefined;
}

interface TestRunStep extends TestWorkflowStepBase {
  readonly run: string;
  readonly env?: WorkflowModel['env'] | undefined;
}

interface TestAgentStep extends TestWorkflowStepBase {
  readonly harness?: Harness | undefined;
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  readonly prompt: string;
  readonly thinking?: AgentThinking | undefined;
  readonly tools?: readonly string[] | undefined;
  readonly integrations?: Extract<ModelStep, {kind: 'agent'}>['integrations'] | undefined;
}

interface TestCheckoutStep extends TestWorkflowStepBase {
  readonly checkout: Checkout;
}

interface TestToolStep extends TestWorkflowStepBase {
  readonly tool: string;
  readonly connection?: string | undefined;
  readonly with?: WorkflowJsonValue | undefined;
  readonly outputs?: Readonly<Record<string, string>> | undefined;
}

type TestWorkflowStep = TestRunStep | TestAgentStep | TestCheckoutStep | TestToolStep;

const DEFAULT_RUNNER_LABELS = ['ubuntu-latest'] as const;

interface TestWorkflowJob {
  readonly needs?: string | readonly string[] | undefined;
  readonly name?: string | undefined;
  readonly executionName?: string | undefined;
  readonly runner?: string | readonly string[] | undefined;
  readonly runnerTemplates?: readonly string[] | undefined;
  readonly checkout?: WorkflowModel['jobs'][number]['checkout'] | undefined;
  readonly if?: string | undefined;
  readonly success?: string | undefined;
  readonly outputs?: Readonly<Record<string, string>> | undefined;
  readonly outputTypes?: WorkflowModel['jobs'][number]['outputTypes'] | undefined;
  readonly env?: WorkflowModel['env'] | undefined;
  readonly listening?: WorkflowModel['jobs'][number]['listening'] | undefined;
  readonly steps: readonly TestWorkflowStep[];
}

interface TestWorkflowModelInput {
  readonly name?: string | undefined;
  readonly runName?: string | undefined;
  readonly runner?: string | readonly string[] | undefined;
  readonly env?: WorkflowModel['env'] | undefined;
  readonly jobs?: Readonly<Record<string, TestWorkflowJob>> | undefined;
}

export function workflowModel(input: TestWorkflowModelInput = {}): WorkflowModel {
  const jobs = input.jobs ?? {
    build: {
      steps: [{run: 'echo hello'}],
    },
  };
  const modelJobs = Object.entries(jobs).map(([key, job]) => {
    const jobId = stableId(key);
    return {
      id: jobId,
      key,
      mode: job.listening === undefined ? ('one_shot' as const) : ('listening' as const),
      runner: normalizeStringArray(job.runner ?? input.runner ?? DEFAULT_RUNNER_LABELS),
      ...(job.runnerTemplates === undefined
        ? {}
        : {
            runnerTemplates: job.runnerTemplates.map((template) =>
              requiredFieldTemplate('job.runner', template),
            ),
          }),
      checkout: job.checkout ?? DEFAULT_JOB_CHECKOUT,
      ...(job.if === undefined ? {} : {if: workflowExpression(job.if)}),
      ...(job.success === undefined ? {} : {success: job.success}),
      ...(job.outputs === undefined ? {} : {outputs: outputTemplates(job.outputs)}),
      ...(job.outputTypes === undefined ? {} : {outputTypes: job.outputTypes}),
      ...(job.name === undefined ? {} : {name: job.name}),
      ...(job.executionName === undefined
        ? {}
        : {
            executionName: fieldTemplate('job.execution_name', job.executionName) ?? [
              {kind: 'literal' as const, value: job.executionName},
            ],
          }),
      ...(job.listening === undefined ? {} : {listening: job.listening}),
      ...optionalScopedEnv(job.env),
      dependencies: normalizeStringArray(job.needs).map(stableId),
      steps: job.steps.map((step, stepIndex) => normalizeStep(step, jobId, stepIndex)),
    };
  });

  return {
    kind: 'workflow',
    name: input.name ?? 'Test Workflow',
    ...(input.runName === undefined
      ? {}
      : {
          runName: fieldTemplate('workflow.run_name', input.runName) ?? [
            {kind: 'literal' as const, value: input.runName},
          ],
        }),
    ...optionalScopedEnv(input.env),
    triggers: [],
    jobs: modelJobs,
    dependencies: modelJobs.flatMap((job) =>
      job.dependencies.map((dependency) => ({from: dependency, to: job.id})),
    ),
  };
}

function workflowExpression(source: string) {
  return createWorkflowExpression({
    source,
    check: {mode: 'syntax'},
  });
}

function outputTemplates(outputs: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    Object.entries(outputs).map(([key, source]) => [
      key,
      fieldTemplate('job.outputs', source) ?? [{kind: 'literal' as const, value: source}],
    ]),
  );
}

function normalizeStep(step: TestWorkflowStep, jobId: string, stepIndex: number): ModelStep {
  const base = stepBase(step, jobId, stepIndex);
  if ('run' in step) {
    return {
      ...base,
      kind: 'run',
      command: {kind: 'shell', value: step.run},
      ...optionalRunTemplates(step),
      ...optionalStepEnv(step.env),
    };
  }

  if ('prompt' in step) {
    return {
      ...base,
      kind: 'agent',
      ...(step.harness === undefined ? {} : {harness: step.harness}),
      ...(step.model === undefined ? {} : {model: step.model}),
      ...(step.provider === undefined ? {} : {provider: step.provider}),
      ...(step.thinking === undefined ? {} : {thinking: step.thinking}),
      ...(step.tools === undefined ? {} : {tools: step.tools}),
      ...(step.integrations === undefined ? {} : {integrations: step.integrations}),
      prompt: step.prompt,
      ...optionalAgentTemplates(step),
    };
  }

  if ('tool' in step) {
    return {
      ...base,
      kind: 'tool',
      tool: splitToolId(step.tool),
      ...(step.connection === undefined ? {} : {connection: step.connection}),
      ...(step.with === undefined ? {} : {with: step.with}),
      ...(step.outputs === undefined ? {} : {outputMappings: outputMappings(step.outputs)}),
      ...optionalToolTemplates(step),
    };
  }

  return {
    ...base,
    kind: 'checkout',
    checkout: step.checkout,
  };
}

function stepBase(step: TestWorkflowStep, jobId: string, stepIndex: number) {
  return {
    id:
      step.key === undefined ? `${jobId}-step-${stepIndex + 1}` : `${jobId}-${stableId(step.key)}`,
    ...(step.key === undefined ? {} : {key: step.key}),
    ...(step.name === undefined ? {} : {name: step.name}),
    ...(step.workingDirectory === undefined ? {} : {workingDirectory: step.workingDirectory}),
    ...(step.sourceLocation === undefined ? {} : {sourceLocation: step.sourceLocation}),
    ...(step.if === undefined ? {} : {if: step.if}),
    ...(step.gate === undefined ? {} : {gate: step.gate}),
  };
}

function normalizeStringArray(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

function optionalScopedEnv(
  env: WorkflowModel['env'] | undefined,
):
  | {env: NonNullable<WorkflowModel['env']>; templates: {env: WorkflowEnvTemplates}}
  | {env: NonNullable<WorkflowModel['env']>}
  | Record<string, never> {
  if (env === undefined || Object.keys(env).length === 0) return {};
  const templates = envTemplates(env);
  return templates === undefined ? {env} : {env, templates: {env: templates}};
}

function optionalStepEnv(
  env: WorkflowModel['env'] | undefined,
): {env: NonNullable<WorkflowModel['env']>} | Record<string, never> {
  if (env === undefined || Object.keys(env).length === 0) return {};
  return {env};
}

function optionalRunTemplates(step: TestRunStep) {
  const command = fieldTemplate('run', step.run);
  const name = step.name === undefined ? undefined : fieldTemplate('step.name', step.name);
  const workingDirectory =
    step.workingDirectory === undefined
      ? undefined
      : fieldTemplate('step.working_directory', step.workingDirectory);
  const env = envTemplates(step.env);
  if (
    command === undefined &&
    name === undefined &&
    workingDirectory === undefined &&
    env === undefined
  ) {
    return {};
  }
  return {
    templates: {
      ...(command === undefined ? {} : {command}),
      ...(name === undefined ? {} : {name}),
      ...(workingDirectory === undefined ? {} : {workingDirectory}),
      ...(env === undefined ? {} : {env}),
    },
  };
}

function optionalAgentTemplates(step: TestAgentStep) {
  const prompt = fieldTemplate('agent.prompt', step.prompt);
  const model = step.model === undefined ? undefined : fieldTemplate('agent.model', step.model);
  const provider =
    step.provider === undefined ? undefined : fieldTemplate('agent.provider', step.provider);
  const thinking =
    step.thinking === undefined ? undefined : fieldTemplate('agent.thinking', step.thinking);
  const name = step.name === undefined ? undefined : fieldTemplate('step.name', step.name);
  const workingDirectory =
    step.workingDirectory === undefined
      ? undefined
      : fieldTemplate('step.working_directory', step.workingDirectory);
  if (
    prompt === undefined &&
    model === undefined &&
    provider === undefined &&
    thinking === undefined &&
    name === undefined &&
    workingDirectory === undefined
  ) {
    return {};
  }
  return {
    templates: {
      ...(prompt === undefined ? {} : {prompt}),
      ...(model === undefined ? {} : {model}),
      ...(provider === undefined ? {} : {provider}),
      ...(thinking === undefined ? {} : {thinking}),
      ...(name === undefined ? {} : {name}),
      ...(workingDirectory === undefined ? {} : {workingDirectory}),
    },
  };
}

function optionalToolTemplates(step: TestToolStep) {
  const withTree = step.with === undefined ? undefined : withTemplateTree(step.with);
  const name = step.name === undefined ? undefined : fieldTemplate('step.name', step.name);
  if (withTree === undefined && name === undefined) return {};
  return {
    templates: {
      ...(withTree === undefined ? {} : {with: withTree}),
      ...(name === undefined ? {} : {name}),
    },
  };
}

function withTemplateTree(value: WorkflowJsonValue): WorkflowJsonTemplateTree | undefined {
  if (Array.isArray(value)) {
    const trees = value.map((child) => withTemplateTree(child));
    return trees.every((tree) => tree === undefined) ? undefined : trees;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).flatMap(([key, child]) => {
      const tree = withTemplateTree(child);
      return tree === undefined ? [] : [[key, tree] as const];
    });
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
  }
  if (typeof value !== 'string') return undefined;
  return fieldTemplate('tool.with', value);
}

function outputMappings(outputs: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    Object.entries(outputs).map(([key, source]) => {
      const template = fieldTemplate('tool.outputs', source);
      const segment = template?.find((candidate) => candidate.kind === 'deferred');
      if (segment === undefined || segment.kind !== 'deferred') {
        throw new Error(`Expected test tool output mapping expression for ${key}: ${source}`);
      }
      return [key, segment.expression];
    }),
  );
}

function splitToolId(source: string): {readonly id: string; readonly method?: string} {
  const dotIndex = source.indexOf('.');
  if (dotIndex < 1 || dotIndex === source.length - 1) return {id: source};
  return {id: source.slice(0, dotIndex), method: source.slice(dotIndex + 1)};
}

function envTemplates(env: WorkflowModel['env'] | undefined): WorkflowEnvTemplates | undefined {
  if (env === undefined) return undefined;

  const templates = Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) => {
      const template = fieldTemplate('env.value', value);
      return template === undefined ? [] : [[key, template]];
    }),
  );

  return Object.keys(templates).length === 0 ? undefined : templates;
}

function fieldTemplate(
  field: WorkflowInterpolationField,
  source: string,
): readonly ResolvedFieldSegment[] | undefined {
  const segments = parseWorkflowTemplate(source);
  if (!segments.some((segment) => segment.kind === 'expr')) return undefined;
  const plan = planInterpolationField({field, segments});
  if (!plan.ok) {
    throw new Error(
      `Invalid test workflow template for ${field}: ${plan.violations
        .map((violation) => violation.source)
        .join(', ')}`,
    );
  }
  return plan.plan.field.segments;
}

function requiredFieldTemplate(
  field: WorkflowInterpolationField,
  source: string,
): readonly ResolvedFieldSegment[] {
  const template = fieldTemplate(field, source);
  if (template === undefined) {
    throw new Error(`Expected test workflow template for ${field}: ${source}`);
  }
  return template;
}

function stableId(sourceName: string): string {
  const id = sourceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return id.length === 0 ? 'unnamed' : id;
}
