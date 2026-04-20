import {setTimeout} from 'node:timers/promises';
import {logger} from '@shipfox/node-opentelemetry';
import {completeJob, requestJob} from '#api-client.js';
import {config} from '#config.js';
import {executeJob} from '#executor.js';
import {killActiveProcess} from '#run-step.js';

let running = true;
let shuttingDown = false;

export async function startRunner(): Promise<void> {
  setupSignalHandlers();

  logger().info(
    {apiUrl: config.SHIPFOX_API_URL, pollInterval: config.SHIPFOX_POLL_INTERVAL_MS},
    'Runner started',
  );

  let currentInterval = config.SHIPFOX_POLL_INTERVAL_MS;

  while (running) {
    try {
      const job = await requestJob();

      if (!job) {
        logger().debug({interval: currentInterval}, 'No jobs available, backing off');
        currentInterval = Math.min(currentInterval * 1.5, config.SHIPFOX_POLL_MAX_INTERVAL_MS);
        await interruptableSleep(currentInterval);
        continue;
      }

      currentInterval = config.SHIPFOX_POLL_INTERVAL_MS;
      logger().info(
        {jobId: job.job_id, jobName: job.job_name, steps: job.steps.length},
        'Job received',
      );

      try {
        const result = await executeJob(job);
        await completeJob({jobId: job.job_id, status: result.status, output: result.output});
        logger().info({jobId: job.job_id, status: result.status}, 'Job completed');
      } catch (execError) {
        logger().error({err: execError, jobId: job.job_id}, 'Job execution failed');
        try {
          await completeJob({jobId: job.job_id, status: 'failed', output: String(execError)});
        } catch (reportError) {
          logger().error({err: reportError, jobId: job.job_id}, 'Failed to report job failure');
        }
      }
    } catch (pollError) {
      logger().error({err: pollError}, 'Poll cycle failed');
      currentInterval = Math.min(currentInterval * 1.5, config.SHIPFOX_POLL_MAX_INTERVAL_MS);
      await interruptableSleep(currentInterval);
    }
  }

  logger().info('Runner stopped');
}

function setupSignalHandlers(): void {
  const handleSignal = (signal: string) => {
    if (shuttingDown) {
      logger().info({signal}, 'Second signal received, force-killing');
      killActiveProcess();
      process.exit(1);
    }

    shuttingDown = true;
    running = false;
    logger().info({signal}, 'Shutting down gracefully, waiting for current job to finish...');
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}

async function interruptableSleep(ms: number): Promise<void> {
  const ac = new AbortController();
  const onStop = () => ac.abort();

  if (!running) return;

  process.once('SIGINT', onStop);
  process.once('SIGTERM', onStop);

  try {
    await setTimeout(ms, undefined, {signal: ac.signal});
  } catch {
    // AbortError from signal interruption — expected
  } finally {
    process.removeListener('SIGINT', onStop);
    process.removeListener('SIGTERM', onStop);
  }
}
