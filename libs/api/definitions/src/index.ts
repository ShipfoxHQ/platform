import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {
  DEFINITION_RESOLVED,
  type DefinitionsEventMap,
  definitionsEventSchemas,
} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {
  PROJECT_SOURCE_BOUND,
  PROJECT_SOURCE_COMMIT_OBSERVED,
  type ProjectsEventMap,
} from '@shipfox/api-projects-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {createDefinitionsSourceControl} from '#core/integrations.js';
import {db, definitionsOutbox, migrationsPath} from '#db/index.js';
import {createDefinitionRoutes} from '#presentation/index.js';
import {createDefinitionsInterModulePresentation} from '#presentation/inter-module.js';
import {
  onProjectSourceBound,
  onProjectSourceCommitObserved,
} from '#presentation/subscribers/index.js';
import {createDefinitionSyncActivities, DEFINITIONS_TASK_QUEUE} from '#temporal/index.js';
import {definitionWorkflowPath} from './config.js';

export type {
  WorkflowDefinition,
  WorkflowDefinitionPayload,
  WorkflowEnvTemplates,
  WorkflowModel,
  WorkflowModelJobCheckout,
  WorkflowSourceSnapshot,
  WorkflowSpec,
} from '#core/index.js';
export {
  DEFAULT_JOB_CHECKOUT,
  DEFAULT_JOB_SUCCESS,
  DEFAULT_RUN_TIMEOUT_MS,
  normalizeWorkflowDocument,
} from '#core/index.js';
export {db, definitionsOutbox, getDefinitionById, migrationsPath} from '#db/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<DefinitionsEventMap & ProjectsEventMap>();

export interface CreateDefinitionsModuleOptions {
  projects: ProjectsModuleClient;
  agent: AgentInterModuleClient;
  integrations: IntegrationsModuleClient;
}

export function createDefinitionsModule({
  projects,
  agent,
  integrations,
}: CreateDefinitionsModuleOptions): ShipfoxModule {
  const sourceControl = createDefinitionsSourceControl(integrations);

  return {
    name: 'definitions',
    database: {db, migrationsPath, databaseNamespace: 'definitions'},
    routes: createDefinitionRoutes({projects, agent, integrations}),
    publishers: [
      {name: 'definitions', table: definitionsOutbox, db, eventSchemas: definitionsEventSchemas},
    ],
    subscribers: [
      subscriber(DEFINITION_RESOLVED, (_payload, event) => {
        logger().info({event}, 'Definition resolved');
        return Promise.resolve();
      }),
      subscriber(PROJECT_SOURCE_BOUND, onProjectSourceBound),
      subscriber(PROJECT_SOURCE_COMMIT_OBSERVED, onProjectSourceCommitObserved),
    ],
    workers: [
      {
        taskQueue: DEFINITIONS_TASK_QUEUE,
        workflowsPath,
        activities: () =>
          createDefinitionSyncActivities(sourceControl, agent, integrations, {
            workflowPath: definitionWorkflowPath,
          }),
        workflows: [],
      },
    ],
    interModulePresentations: [createDefinitionsInterModulePresentation()],
  };
}
