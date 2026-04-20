import {captureException} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {run} from '#core/run.js';

try {
  await run();
} catch (error) {
  logger().error({error}, 'Fatal startup error');
  captureException(error);
  process.exit(1);
}
