import {createRequire} from 'node:module';
import {startInstanceInstrumentation} from '@shipfox/node-opentelemetry';

const {version} = createRequire(import.meta.url)('../package.json') as {version: string};

// The metrics API has no proxy meter: instruments created before this preload
// completes bind to a no-op provider for the process lifetime.
await startInstanceInstrumentation({
  serviceName: 'api',
  serviceVersion: version,
  instrumentations: {fastify: true, http: true, pg: true, awsSdk: true, pino: true},
});
