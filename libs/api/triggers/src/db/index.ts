import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {
  advanceCronSchedule,
  claimDueCronSchedules,
  countDueCronSchedules,
  deleteCronScheduleForSubscription,
  getCronScheduleBySubscriptionId,
  syncCronSchedule,
} from './cron-schedules.js';
export {closeDb, db, type Executor, schema, type Tx} from './db.js';
export {
  getTriggerEventById,
  type ListTriggerEventFacetsResult,
  type ListTriggerEventsParams,
  type ListTriggerEventsResult,
  listDecisionsByReceivedEventId,
  listReplaysOfTriggerEvent,
  listTriggerEventFacets,
  listTriggerEvents,
  type TriggerEventCursor,
  type TriggerEventFacet,
  type TriggerEventListFilters,
  type TriggerEventReplay,
} from './event-queries.js';
export {
  type FindMatchingJobListenerSubscriptionsParams,
  findMatchingJobListenerSubscriptions,
  type ListenerMatcher,
  type ProjectJobListenerSubscriptionsParams,
  projectJobListenerSubscriptions,
  removeJobListenerSubscriptionsForJob,
} from './job-listener-subscriptions.js';
export {
  type CronScheduleDb,
  type CronScheduleInsertDb,
  toCronSchedule,
  triggersCronSchedules,
} from './schema/cron-schedules.js';
export {jobListenerSubscriptions} from './schema/job-listener-subscriptions.js';
export {triggersOutbox} from './schema/outbox.js';
export {triggerSubscriptions} from './schema/subscriptions.js';
export {
  deleteSubscriptionsForDefinition,
  findMatchingSubscriptions,
  getManualSubscriptionByDefinitionId,
  getTriggerSubscriptionById,
  listSubscriptionsByWorkflowDefinitionIds,
  projectDefinitionTriggers,
} from './subscriptions.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
