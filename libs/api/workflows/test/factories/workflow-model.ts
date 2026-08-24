import {
  DEFAULT_JOB_CHECKOUT,
  type WorkflowModel,
  type WorkflowModelToolWithTemplate,
  type WorkflowModelToolWithTemplates,
  type WorkflowModelToolWithValue,
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
  readonly method?: string | undefined;
  readonly connection?: string | undefined;
  readonly provider?: string | undefined;
  readonly with: Readonly<Record<string, WorkflowModelToolWithValue>>;
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
      ...(step.connection === undefined ? {} : {connection: step.connection}),
      ...(step.provider === undefined ? {} : {provider: step.provider}),
      tool: step.tool,
      ...(step.method === undefined ? {} : {method: step.method}),
      with: step.with,
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
  const withTemplates = toolWithTemplates(step.with);
  const name = step.name === undefined ? undefined : fieldTemplate('step.name', step.name);
  const workingDirectory =
    step.workingDirectory === undefined
      ? undefined
      : fieldTemplate('step.working_directory', step.workingDirectory);
  if (withTemplates === undefined && name === undefined && workingDirectory === undefined) {
    return {};
  }
  return {
    templates: {
      ...(withTemplates === undefined ? {} : {with: withTemplates}),
      ...(name === undefined ? {} : {name}),
      ...(workingDirectory === undefined ? {} : {workingDirectory}),
    },
  };
}

/**
 * Builds the parallel `with` template tree mirroring normalize-tool-step: a
 * node exists only where a string leaf below it carries a `${{ }}` template,
 * and sequence items and record fields keep their authored positions so
 * materialization can walk both trees in lockstep.
 */
function toolWithTemplates(
  withValues: Readonly<Record<string, WorkflowModelToolWithValue>>,
): WorkflowModelToolWithTemplates | undefined {
  const templates: Record<string, WorkflowModelToolWithTemplate | undefined> = Object.create(
    null,
  ) as Record<string, WorkflowModelToolWithTemplate | undefined>;
  let hasTemplate = false;
  for (const [key, value] of Object.entries(withValues)) {
    const node = toolWithValueTemplate(value);
    if (node !== undefined) hasTemplate = true;
    templates[key] = node;
  }
  return hasTemplate ? templates : undefined;
}

function toolWithValueTemplate(value: unknown): WorkflowModelToolWithTemplate | undefined {
  if (typeof value === 'string') {
    if (!value.includes('$' + '{{')) return undefined;

    const template = fieldTemplate('tool.with', value);
    if (template !== undefined) return {kind: 'field', template};
    // An all-literal parse means every `${{` opener was escaped with `$${{`;
    // record a literal node so materialization unescapes the leaf like every
    // other template field, mirroring normalize-tool-step.
    return {
      kind: 'field',
      template: [{kind: 'literal' as const, value: unescapeTemplateSource(value)}],
    };
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => toolWithValueTemplate(item));
    return items.some((item) => item !== undefined) ? {kind: 'sequence', items} : undefined;
  }

  if (typeof value === 'object' && value !== null) {
    const fields: Record<string, WorkflowModelToolWithTemplate | undefined> = Object.create(
      null,
    ) as Record<string, WorkflowModelToolWithTemplate | undefined>;
    let hasTemplate = false;
    for (const [key, child] of Object.entries(value)) {
      const node = toolWithValueTemplate(child);
      if (node !== undefined) hasTemplate = true;
      fields[key] = node;
    }
    return hasTemplate ? {kind: 'record', fields} : undefined;
  }

  return undefined;
}

function unescapeTemplateSource(source: string): string {
  return parseWorkflowTemplate(source)
    .map((segment) => (segment.kind === 'literal' ? segment.text : segment.expression.source))
    .join('');
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
