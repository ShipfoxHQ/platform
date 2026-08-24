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
export {
  getSessionDataKey,
  insertSessionDataKeyIfAbsent,
} from './data-keys.js';
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
export {
  getSessionById,
  hasSessionReferencingObjectKey,
  listExpiredSessions,
  listSegmentPruneCandidates,
  retireSessionsForRunAttempt,
} from './retention.js';
export {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';
export {sessionDataKeys} from './schema/data-keys.js';
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
  assertValidSessionKey,
  carryOverSessions,
  claimSession,
  commitSessionHead,
  createSession,
  getSessionByRunAttemptAndKey,
  listStaleClaimedSessions,
  releaseSession,
  releaseSessionClaimsHeldByStepAttempts,
} from './sessions.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
