import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath, runnersOutbox} from '#db/index.js';
import {createRunnerTokenAuthMethod, routes} from '#presentation/index.js';

export type {RunnerToken} from '#core/index.js';
export {RunningJobNotFoundError} from '#core/index.js';
export type {ClaimedJob, EnqueueJobParams} from '#db/index.js';
export {
  claimJob,
  completeJob,
  createRunnerToken,
  db,
  enqueueJob,
  migrationsPath,
  resolveRunnerTokenByHash,
  revokeRunnerToken,
  runnersOutbox,
} from '#db/index.js';
export {createRunnerTokenAuthMethod, routes} from '#presentation/index.js';

export const runnersModule: ShipfoxModule = {
  name: 'runners',
  database: {db, migrationsPath},
  auth: [createRunnerTokenAuthMethod()],
  routes,
  publishers: [{name: 'runners', table: runnersOutbox, db}],
};
