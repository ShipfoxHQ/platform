import {readFile} from 'node:fs/promises';
import {fetchStepLogs} from '@shipfox/e2e-observe-logs';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';

const LOG_ATTACHMENT_NAME_PART_RE = /[^a-zA-Z0-9._-]+/g;

export interface Attachment {
  name: string;
  contentType: string;
  body: string;
}

export type AttachFn = (attachment: Attachment) => Promise<void>;

export interface StepLogAttachmentRequest {
  path: string;
  stepId: string;
  attempt: number;
}

export function logAttachmentName(path: string): string {
  return path.replaceAll(LOG_ATTACHMENT_NAME_PART_RE, '_').replace(/^_+|_+$/g, '');
}

export function collectStepLogAttachmentRequests(
  observation: WorkflowRunObservation,
): StepLogAttachmentRequest[] {
  const requests: StepLogAttachmentRequest[] = [];
  for (const job of observation.jobs) {
    for (const execution of job.executions) {
      for (const step of execution.steps) {
        requests.push({
          path: `jobs.${job.key}.executions.${execution.sequence}.steps.${
            step.key ?? logAttachmentName(step.name)
          }`,
          stepId: step.id,
          attempt: step.current_attempt,
        });
      }
    }
  }
  return requests;
}

export async function fetchLogAttachment(
  request: StepLogAttachmentRequest,
  token: string,
): Promise<Attachment> {
  try {
    const logs = await fetchStepLogs({
      stepId: request.stepId,
      attempt: request.attempt,
      token,
    });
    return {
      name: `logs-${logAttachmentName(request.path)}.ndjson`,
      contentType: 'application/x-ndjson',
      body: logs.ndjson,
    };
  } catch (error) {
    return {
      name: `logs-${logAttachmentName(request.path)}.error.txt`,
      contentType: 'text/plain',
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function attachLocalRunnerLog(attach: AttachFn, runnerLogFile: string): Promise<void> {
  try {
    await attach({
      name: `runner-${logAttachmentName(runnerLogFile)}.log`,
      contentType: 'text/plain',
      body: await readFile(runnerLogFile, 'utf8'),
    });
  } catch (error) {
    await attach({
      name: `runner-${logAttachmentName(runnerLogFile)}.error.txt`,
      contentType: 'text/plain',
      body: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }
}
