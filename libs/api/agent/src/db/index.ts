import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {
  type AgentWorkspaceDefaultsSnapshot,
  getAgentWorkspaceDefaultsSnapshot,
} from './agent-defaults-snapshot.js';
export {
  getAgentWorkspaceSettings,
  setDefaultHarness,
  setDefaultModelProvider,
} from './agent-workspace-settings.js';
export {closeDb, db, schema, type Transaction} from './db.js';
export type {
  InsertCustomModelProviderConfigParams,
  UpsertModelProviderConfigParams,
} from './model-provider-configs.js';
export {
  deleteModelProviderConfig,
  getModelProviderConfig,
  insertCustomModelProviderConfig,
  listModelProviderConfigs,
  updateModelProviderDefaultModel,
  upsertModelProviderConfig,
} from './model-provider-configs.js';
export {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';
export {modelProviderConfigs} from './schema/model-provider-configs.js';
export {sessions} from './schema/sessions.js';
export type {
  ClaimSessionParams,
  CommitSessionHeadParams,
  CommitSessionHeadResult,
  CreateSessionParams,
  HeadFlipOutcome,
} from './sessions.js';
export {
  carryOverSessions,
  claimSession,
  commitSessionHead,
  createSession,
  releaseSession,
} from './sessions.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
