import {DEFINITION_RESOLVED} from '@shipfox/api-definitions-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {db, definitionsOutbox, migrationsPath} from '#db/index.js';
import {routes} from '#presentation/index.js';

export type {Job, RunStep, Trigger, WorkflowDefinition, WorkflowSpec} from '#core/index.js';
export {db, definitionsOutbox, getDefinitionById, migrationsPath} from '#db/index.js';
export {routes} from '#presentation/index.js';

export const definitionsModule: ShipfoxModule = {
  name: 'definitions',
  database: {db, migrationsPath},
  routes,
  publishers: [{name: 'definitions', table: definitionsOutbox, db}],
  subscribers: [
    {
      event: DEFINITION_RESOLVED,
      handler: (event) => {
        logger().info({event}, 'Definition resolved');
        return Promise.resolve();
      },
    },
  ],
};
