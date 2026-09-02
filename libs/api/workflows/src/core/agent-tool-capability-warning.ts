import {
  type AnnotationsInterModuleClient,
  annotationsInterModuleContract,
} from '@shipfox/annotations-dto/inter-module';
import {
  harnessSchema,
  type MaterializedAgentStepConfigDto,
  materializedAgentStepConfigSchema,
} from '@shipfox/api-agent-dto';
import type {LeasedJobContext} from '@shipfox/api-auth-context';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {recordWorkflowAgentToolWarningFailed} from '#metrics/instance.js';
import {annotationTargetFromLease} from './annotation-target.js';
import type {Step} from './entities/step.js';

const TOOL_LIST_LIMIT = 10;

type WarningFailureReason = 'budget' | 'lookup' | 'write';
type WarningReason = 'known-absence' | 'harness-not-advertised' | 'unknown-or-stale';

export async function warnAgentToolCapabilityMismatchOnDispatch(params: {
  annotations: AnnotationsInterModuleClient;
  runners: RunnersInterModuleClient;
  leaseIdentity: LeasedJobContext;
  step: Step;
}): Promise<void> {
  const config = parseAgentConfig(params.step);
  if (!config) return;

  const requestedTools = config.tools ?? [];
  if (requestedTools.length === 0) return;

  const harness = harnessSchema.safeParse(config.harness);
  if (!harness.success) return;

  let effective: Awaited<
    ReturnType<RunnersInterModuleClient['getEffectiveRunnerToolCapabilities']>
  >;
  try {
    effective = await params.runners.getEffectiveRunnerToolCapabilities({
      runnerSessionId: params.leaseIdentity.runnerSessionId,
    });
  } catch (error) {
    recordWarningWriteFailure('lookup');
    logger().warn(
      {error, jobExecutionId: params.leaseIdentity.jobExecutionId, stepId: params.step.id},
      'Failed to read runner tool capabilities for agent tool warning',
    );
    return;
  }

  const advertised = new Set(effective.capabilities.harnesses[harness.data]?.tools ?? []);
  const missing = requestedTools.filter((tool) => !advertised.has(tool));
  const context = `agent-tool-capability:${params.step.id}`;

  const operation =
    missing.length === 0
      ? {context, style: 'warning' as const, op: 'remove' as const}
      : {
          context,
          style: 'warning' as const,
          op: 'replace' as const,
          body: warningBody({
            harness: harness.data,
            missing,
            reason: warningReason({
              reportFresh: effective.reportFresh,
              harnessKnown: effective.capabilities.harnesses[harness.data] !== undefined,
            }),
          }),
        };

  try {
    await params.annotations.replaceOrRemoveAnnotation({
      ...annotationTargetFromLease(params.leaseIdentity),
      originStepId: params.step.id,
      originStepAttempt: params.step.currentAttempt,
      context,
      annotation: operation.op === 'remove' ? {op: 'remove'} : operation,
    });
  } catch (error) {
    const reason = isAnnotationBudgetError(error) ? 'budget' : 'write';
    recordWarningWriteFailure(reason);
    logger().warn(
      {
        error,
        reason,
        jobExecutionId: params.leaseIdentity.jobExecutionId,
        stepId: params.step.id,
      },
      'Failed to write agent tool capability warning annotation',
    );
    return;
  }

  if (missing.length > 0) {
    logger().warn(
      {
        jobExecutionId: params.leaseIdentity.jobExecutionId,
        stepId: params.step.id,
        harness: harness.data,
        missing,
        reason: warningReason({
          reportFresh: effective.reportFresh,
          harnessKnown: effective.capabilities.harnesses[harness.data] !== undefined,
        }),
      },
      'Runner missing requested agent tools; dispatch is continuing',
    );
  }
}

function parseAgentConfig(step: Step): MaterializedAgentStepConfigDto | null {
  if (step.type !== 'agent') return null;

  const parsed = materializedAgentStepConfigSchema.safeParse(step.config);
  return parsed.success ? parsed.data : null;
}

function warningBody(params: {
  harness: string;
  missing: readonly string[];
  reason: WarningReason;
}): string {
  const tools = formatToolList(params.missing);
  const harness = markdownInlineCode(params.harness);
  if (params.reason === 'known-absence') {
    return [
      '**Runner missing requested agent tools**',
      '',
      `The matched runner advertised a ${harness} tool set without: ${tools}.`,
      'Execution is continuing on this runner because labels matched; the step may fail if the harness cannot provide these tools.',
    ].join('\n');
  }

  if (params.reason === 'harness-not-advertised') {
    return [
      '**Runner missing requested agent harness tools**',
      '',
      `The matched runner advertised fresh tool capabilities, but did not advertise a ${harness} tool set. Support for ${tools} could not be confirmed.`,
      'Execution is continuing on this runner because labels matched; the step may fail if the harness cannot provide these tools.',
    ].join('\n');
  }

  return [
    '**Could not confirm runner agent tools**',
    '',
    `The matched runner reported no or stale tool capabilities, so support for ${tools} could not be confirmed.`,
    'Execution is continuing on this runner because labels matched.',
  ].join('\n');
}

function formatToolList(tools: readonly string[]): string {
  const visible = tools.slice(0, TOOL_LIST_LIMIT).map(markdownInlineCode);
  const remaining = tools.length - visible.length;
  return remaining > 0 ? `${visible.join(', ')} ...and ${remaining} more` : visible.join(', ');
}

function markdownInlineCode(value: string): string {
  const maxBacktickRun = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  const delimiter = '`'.repeat(maxBacktickRun + 1);
  const needsPadding = value.startsWith('`') || value.endsWith('`');
  const content = needsPadding ? ` ${value} ` : value;
  return `${delimiter}${content}${delimiter}`;
}

function warningReason(params: {reportFresh: boolean; harnessKnown: boolean}): WarningReason {
  if (params.harnessKnown) return 'known-absence';
  return params.reportFresh ? 'harness-not-advertised' : 'unknown-or-stale';
}

function isAnnotationBudgetError(error: unknown): boolean {
  return isInterModuleKnownError(
    annotationsInterModuleContract.methods.replaceOrRemoveAnnotation,
    error,
  );
}

function recordWarningWriteFailure(reason: WarningFailureReason): void {
  recordWorkflowAgentToolWarningFailed(reason);
}
