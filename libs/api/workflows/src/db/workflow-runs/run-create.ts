import {createWorkflowModelSnapshot, type WorkflowModel} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {
  analyzeContextKeyAccess,
  type ResolvedFieldSegment,
  type WorkflowExpression,
} from '@shipfox/expression';
import {logger} from '@shipfox/node-opentelemetry';
import {eq} from 'drizzle-orm';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import {
  createAgentToolMaterializationSnapshot,
  loadAgentToolMaterializationContext,
} from '#core/agent-tools.js';
import type {
  TriggerPayload,
  WorkflowRun,
  WorkflowSourceSnapshot,
} from '#core/entities/workflow-run.js';
import {InterpolationUnresolvableError} from '#core/errors.js';
import {assembleCreationContext} from '#core/step-config/assemble-run-context.js';
import type {MaterializedWorkflowJob} from '#core/step-config/materialize-workflow-model.js';
import type {WorkflowStepTemplateDiagnostic} from '#core/step-config/resolve-step-config.js';
import {resolveWorkflowRunName} from '#core/step-config/resolve-workflow-run-name.js';
import {
  deriveInitialJobExecutionPlan,
  materializeWorkflowRunJobs,
} from '#core/workflow-run-creation.js';
import {
  recordWorkflowDisplayNameResolutionDegraded,
  recordWorkflowRunCreated,
} from '#metrics/instance.js';
import {db} from '../db.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from '../schema/workflow-runs.js';
import {type MaterializedRunGraphJob, persistMaterializedRunGraph} from './run-graph.js';

export type WorkflowModelJob = WorkflowModel['jobs'][number];

export interface ReferencedVariable {
  readonly key: string;
  readonly field: InterpolationUnresolvableError['field'];
  readonly source: string;
  readonly envKey?: string | undefined;
}

export interface CreateWorkflowRunParams {
  workspaceId: string;
  projectId: string;
  definitionId: string;
  name?: string | undefined;
  model: WorkflowModel;
  triggerPayload: TriggerPayload;
  inputs?: Record<string, unknown> | undefined;
  sourceSnapshot?: WorkflowSourceSnapshot | null | undefined;
  triggerIdempotencyKey?: string | undefined;
  resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'> | undefined;
  integrations?: IntegrationsModuleClient | undefined;
  projects?: ProjectsModuleClient | undefined;
}

export async function createWorkflowRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
  const staticName = params.name ?? params.model.name;
  const agentToolContext =
    params.integrations === undefined
      ? undefined
      : await loadAgentToolMaterializationContext({
          model: params.model,
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          integrations: params.integrations,
          projects: params.projects,
        });
  const agentToolMaterialization = createAgentToolMaterializationSnapshot({
    model: params.model,
    context: agentToolContext,
  });
  const result = await db().transaction(async (tx) => {
    const insertResult = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        definitionId: params.definitionId,
        name: null,
        workflowName: staticName,
        status: 'pending',
        currentAttempt: 1,
        triggerProvider: params.triggerPayload.provider ?? null,
        triggerSource: params.triggerPayload.source,
        triggerEvent: params.triggerPayload.event,
        triggerPayload: params.triggerPayload,
        inputs: params.inputs ?? null,
        sourceSnapshot: params.sourceSnapshot ?? null,
        triggerIdempotencyKey: params.triggerIdempotencyKey ?? null,
      })
      .onConflictDoNothing({target: workflowRuns.triggerIdempotencyKey})
      .returning();

    const runRow = insertResult[0];
    if (!runRow) {
      // Conflict path: skip jobs/steps/outbox so the first insert keeps ownership of side effects.
      if (!params.triggerIdempotencyKey) {
        throw new Error('Insert returned no rows');
      }
      const existing = await tx
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.triggerIdempotencyKey, params.triggerIdempotencyKey))
        .limit(1);
      const existingRow = existing[0];
      if (!existingRow) {
        throw new Error(
          `Idempotency conflict but existing run missing for key ${params.triggerIdempotencyKey}`,
        );
      }
      return {run: toWorkflowRun(existingRow), created: false};
    }

    // Resolving run-creation templates and predicates here gives them a stable variable snapshot
    // and interpolation access to the inserted run id. Run-name resolution is display-only and
    // persists only a resolved override. If resolution fails, the transaction rolls back the run,
    // jobs, steps, and outbox event together. Listening steps are resolved later when a job
    // execution is created.
    const provisionalRun = toWorkflowRun(runRow);
    const oneShotJobs = params.model.jobs.filter((job) => job.mode !== 'listening');
    const vars = await loadReferencedVariables({
      model: params.model,
      jobs: oneShotJobs,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      definitionId: params.definitionId,
      secrets: params.secrets,
    });
    const runNameResolution = resolveWorkflowRunName({
      runName: params.model.runName,
      context: assembleCreationContext({
        run: provisionalRun,
        triggerPayload: params.triggerPayload,
        inputs: params.inputs ?? null,
        vars,
      }).values,
    });
    const [resolvedRunRow] = await tx
      .update(workflowRuns)
      .set({name: runNameResolution.value, updatedAt: new Date()})
      .where(eq(workflowRuns.id, provisionalRun.id))
      .returning();
    if (!resolvedRunRow)
      throw new Error(`Workflow run missing after name resolution: ${runRow.id}`);
    const run = toWorkflowRun(resolvedRunRow);
    const [attemptRow] = await tx
      .insert(workflowRunAttempts)
      .values({
        workflowRunId: runRow.id,
        attempt: 1,
        status: 'pending',
        model: createWorkflowModelSnapshot(params.model),
        vars,
        agentToolMaterialization,
      })
      .returning();
    if (!attemptRow) throw new Error('Insert returned no rows');

    const materializedJobs = await materializeWorkflowRunJobs({
      run,
      model: params.model,
      triggerPayload: params.triggerPayload,
      inputs: params.inputs ?? null,
      vars,
      resolveAgentDefaults: params.resolveAgentDefaults,
      definitionId: params.definitionId,
      agentToolContext,
      agentToolSnapshot: agentToolMaterialization,
    });

    const graphJobs = materializeRunGraphJobs({
      params,
      run,
      vars,
      materializedJobs,
    });
    await persistMaterializedRunGraph(tx, {
      run,
      workflowRunAttempt: attemptRow,
      materializedJobs: graphJobs,
    });

    logTemplateDiagnostics({
      workflowRunId: runRow.id,
      diagnostics: materializedJobs.flatMap((job) =>
        job.steps.flatMap((step) =>
          (step.diagnostics ?? []).map((diagnostic) => ({
            jobKey: job.key,
            stepName: step.name,
            ...diagnostic,
          })),
        ),
      ),
    });

    return {
      run,
      created: true,
      nameDegradation: runNameResolution.degradation,
    };
  });

  if (result.created && result.nameDegradation !== undefined) {
    recordWorkflowDisplayNameResolutionDegraded('workflow.run_name', result.nameDegradation.cause);
    logger().warn(
      {
        workflowRunId: result.run.id,
        definitionId: result.run.definitionId,
        field: 'workflow.run_name',
        cause: result.nameDegradation.cause,
        ...(result.nameDegradation.expression === undefined
          ? {}
          : {expression: result.nameDegradation.expression.slice(0, 256)}),
      },
      'Workflow run name resolution degraded to the static workflow name',
    );
  }

  if (result.created) {
    recordWorkflowRunCreated(result.run.triggerPayload.provider ?? result.run.triggerSource);
  }

  return result.run;
}

export async function loadReferencedVariables(params: {
  readonly model: WorkflowModel;
  readonly jobs?: readonly WorkflowModelJob[] | undefined;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'> | undefined;
}): Promise<Record<string, string> | undefined> {
  const references = referencedVariables(params.model, params.jobs ?? params.model.jobs);
  const keys = [...new Set(references.map((reference) => reference.key))].sort();
  if (keys.length === 0) return undefined;

  const requiresSecrets = (reference: ReferencedVariable) =>
    reference.field !== 'job.execution_name' && reference.field !== 'workflow.run_name';
  const requiredReferences = references.filter(requiresSecrets);
  const requiredKeys = new Set(requiredReferences.map((reference) => reference.key));
  if (!params.secrets) {
    if (requiredKeys.size === 0) return undefined;
    throw new Error('Secrets client is not configured.');
  }
  const {values: vars} = await params.secrets.getVariablesByNamespace({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    namespace: '',
  });
  const missingKey = [...requiredKeys].find((key) => !(key in vars));
  if (missingKey !== undefined) {
    const reference = requiredReferences.find((candidate) => candidate.key === missingKey);
    throw new InterpolationUnresolvableError(params.definitionId, {
      field: reference?.field ?? 'env',
      source: reference?.source ?? `vars.${missingKey}`,
      ...(reference?.envKey === undefined ? {} : {envKey: reference.envKey}),
    });
  }

  const referencedVars: Record<string, string> = {};
  for (const key of keys) {
    const value = vars[key];
    if (value !== undefined) referencedVars[key] = value;
  }
  return referencedVars;
}

function materializeRunGraphJobs(params: {
  readonly params: CreateWorkflowRunParams;
  readonly run: WorkflowRun;
  readonly vars: Record<string, string> | undefined;
  readonly materializedJobs: readonly MaterializedWorkflowJob[];
}): readonly MaterializedRunGraphJob[] {
  return params.materializedJobs.map((job, jobIndex) => ({
    job: {
      key: job.key,
      mode: job.mode,
      name: job.name ?? null,
      status: 'pending' as const,
      checkoutPersistCredentials: job.checkout.persistCredentials,
      checkoutPermissionsContents: job.checkout.permissions.contents,
      success: job.success ?? null,
      executionTimeoutMs: job.executionTimeoutMs ?? null,
      listeningTimeoutMs: job.listening?.timeoutMs ?? null,
      maxExecutions: job.listening?.maxExecutions ?? null,
      onResolve: job.listening?.onResolve ?? null,
      batchDebounceMs: job.listening?.batch?.debounceMs ?? null,
      batchMaxSize: job.listening?.batch?.maxSize ?? null,
      batchMaxWaitMs: job.listening?.batch?.maxWaitMs ?? null,
      listeningOn: job.listening?.on ? [...job.listening.on] : null,
      listeningUntil: job.listening?.until ? [...job.listening.until] : null,
      dependencies: [...job.dependencies],
      runner: job.runner.length === 0 ? null : [...job.runner],
      position: job.position,
    },
    createExecution: (jobRow) => {
      if (jobRow.mode === 'listening') return undefined;

      const fallbackName = jobRow.name ?? jobRow.key;
      const modelJob = params.params.model.jobs[jobIndex];
      if (!modelJob) return undefined;
      const executionPlan = deriveInitialJobExecutionPlan({
        run: params.run,
        modelJob,
        job,
        jobId: jobRow.id,
        sequence: 1,
        fallbackName,
        triggerPayload: params.params.triggerPayload,
        inputs: params.params.inputs ?? null,
        vars: params.vars,
      });

      return {
        sequence: 1,
        // Persist only the resolved override. The core entity supplies the
        // static job name/key when this is null.
        name: executionPlan.nameOverride,
        runner: [...executionPlan.runner],
        status: 'pending' as const,
        evaluationTrace:
          executionPlan.evaluationTrace?.length === 0 ? null : executionPlan.evaluationTrace,
      };
    },
    createSteps: () =>
      job.steps.map((step) => ({
        key: step.key,
        name: step.name,
        sourceLocation: step.sourceLocation,
        status: step.status,
        type: step.type,
        config: step.config,
        condition: step.condition ?? null,
        configPlan: step.configPlan ?? null,
        authoredConfig: step.authoredConfig,
        position: step.position,
      })),
  }));
}

function referencedVariables(
  model: WorkflowModel,
  jobs: readonly WorkflowModelJob[],
): readonly ReferencedVariable[] {
  const references: ReferencedVariable[] = [];

  for (const job of model.jobs) {
    collectPredicateVariableReferences(job.if, references);
    collectPredicateVariableReferences(job.success, references);

    for (const trigger of [...(job.listening?.on ?? []), ...(job.listening?.until ?? [])]) {
      collectPredicateVariableReferences(trigger.filter, references);
    }

    for (const step of job.steps) {
      collectPredicateVariableReferences(step.if, references);
      collectPredicateVariableReferences(step.gate?.success, references);
    }
  }

  collectFieldVariableReferences(model.runName, references, {field: 'workflow.run_name'});

  if (jobs.length > 0) {
    collectTemplateVariableReferences(model.templates?.env, references);
  }

  for (const job of jobs) {
    collectFieldVariableReferences(job.executionName, references, {field: 'job.execution_name'});
    for (const template of job.runnerTemplates ?? []) {
      collectFieldVariableReferences(template, references, {field: 'job.runner'});
    }
    collectTemplateVariableReferences(job.outputs, references, {field: 'job.outputs'});
    collectTemplateVariableReferences(job.templates?.env, references);

    for (const step of job.steps) {
      collectFieldVariableReferences(step.templates?.name, references, {field: 'step.name'});
      if (step.kind === 'run') {
        collectFieldVariableReferences(step.templates?.command, references, {field: 'run'});
        collectTemplateVariableReferences(step.templates?.env, references);
      } else {
        collectFieldVariableReferences(step.templates?.prompt, references, {field: 'agent.prompt'});
        collectFieldVariableReferences(step.templates?.model, references, {field: 'agent.model'});
        collectFieldVariableReferences(step.templates?.provider, references, {
          field: 'agent.provider',
        });
      }
    }
  }

  return references;
}

function collectPredicateVariableReferences(
  expression: WorkflowExpression | string | undefined,
  references: ReferencedVariable[],
): void {
  if (expression === undefined) return;

  const keyAccess = analyzeContextKeyAccess(expression);
  for (const reference of keyAccess.references) {
    if (reference.root !== 'vars') continue;
    references.push({
      key: reference.key,
      field: 'env',
      source: typeof expression === 'string' ? expression : expression.source,
    });
  }
}

function collectTemplateVariableReferences(
  templates: Readonly<Record<string, readonly ResolvedFieldSegment[]>> | undefined,
  references: ReferencedVariable[],
  source?: {
    readonly field: InterpolationUnresolvableError['field'];
  },
): void {
  for (const [envKey, template] of Object.entries(templates ?? {})) {
    collectFieldVariableReferences(
      template,
      references,
      source === undefined ? {field: 'env', envKey} : source,
    );
  }
}

function collectFieldVariableReferences(
  template: readonly ResolvedFieldSegment[] | undefined,
  references: ReferencedVariable[],
  source: {
    readonly field: InterpolationUnresolvableError['field'];
    readonly envKey?: string | undefined;
  },
): void {
  for (const segment of template ?? []) {
    if (segment.kind === 'literal') continue;
    const keyAccess = analyzeContextKeyAccess(segment.expression);
    for (const reference of keyAccess.references) {
      if (reference.root !== 'vars') continue;
      references.push({
        key: reference.key,
        field: source.field,
        source: segment.expression.source,
        envKey: source.envKey,
      });
    }
  }
}

function logTemplateDiagnostics(params: {
  readonly workflowRunId: string;
  readonly diagnostics: readonly (WorkflowStepTemplateDiagnostic & {
    readonly jobKey: string;
    readonly stepName: string;
  })[];
}): void {
  if (params.diagnostics.length === 0) return;

  logger().warn(
    {workflowRunId: params.workflowRunId, diagnostics: params.diagnostics},
    'Workflow interpolation resolved with diagnostics',
  );
}
