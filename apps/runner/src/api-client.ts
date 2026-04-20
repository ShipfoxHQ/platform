import {type JobPayloadDto, jobPayloadResponseSchema} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError} from 'ky';
import {config} from '#config.js';

const api = ky.create({
  prefixUrl: config.SHIPFOX_API_URL,
  headers: {
    Authorization: `Bearer ${config.SHIPFOX_RUNNER_TOKEN}`,
  },
});

export async function requestJob(): Promise<JobPayloadDto | null> {
  logger().debug('Polling for job');

  const response = await api.post('runners/jobs/request');

  if (response.status === 204) {
    return null;
  }

  const body = await response.json();
  return jobPayloadResponseSchema.parse(body);
}

export async function completeJob(params: {
  jobId: string;
  status: 'succeeded' | 'failed';
  output?: string;
}): Promise<void> {
  logger().info({jobId: params.jobId, status: params.status}, 'Reporting job completion');

  await api.post(`runners/jobs/${params.jobId}/complete`, {
    json: {
      status: params.status,
      output: params.output,
    },
  });
}

export {HTTPError};
