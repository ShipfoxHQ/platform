import {logger} from '@shipfox/node-opentelemetry';
import {startRunner} from '#runner.js';

try {
  await startRunner();
} catch (error) {
  logger().error({error}, 'Fatal runner error');
  process.exit(1);
}
