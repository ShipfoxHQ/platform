import * as sentry from '@sentry/node';
import {flushErrorMonitoring} from './index.js';

test('exports the non-closing flush operation for bounded runtimes', () => {
  expect(flushErrorMonitoring).toBe(sentry.flush);
});
