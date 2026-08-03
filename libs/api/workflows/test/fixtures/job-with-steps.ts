import type {Step} from '#core/entities/step.js';
import {createWorkflowRun, getJobsByWorkflowRunId, getStepsByJobId} from '#db/workflow-runs.js';
import {stripSetupStep} from '#test/fixtures/strip-setup-step.js';
import {workflowModel} from '#test/index.js';

// Jobs and steps have no standalone factory: they only exist as children
// materialized from a WorkflowModel by createWorkflowRun, which also prepends a
// synthetic "Set up job" step to every job. This fixture exercises step-execution
// mechanics in isolation, so it strips that step (see stripSetupStep) to keep the
// arrangement focused. The setup step's own behavior is covered by materialize /
// createWorkflowRun / runner tests.
export async function arrangeJobWithSteps(
  stepCount: number,
): Promise<{jobId: string; steps: Step[]}> {
  const model = workflowModel({
    name: 'Test Workflow',
    jobs: {
      build: {steps: Array.from({length: stepCount}, (_, i) => ({run: `echo step-${i}`}))},
    },
  });

  const run = await createWorkflowRun({
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    model,
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
  });

  const jobs = await getJobsByWorkflowRunId(run.id);
  const jobId = jobs[0]?.id as string;

  await stripSetupStep(jobId);

  const steps = await getStepsByJobId(jobId);
  return {jobId, steps};
}
