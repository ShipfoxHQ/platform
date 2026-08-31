import type {TimestampIdCursor} from '@shipfox/node-drizzle';
import type {AdministratorUserSummary} from '#core/entities/administrator-read-model.js';
import {
  findAdministratorUserSummary,
  type ListAdministratorUserSummariesResult,
  listAdministratorUserSummaries,
} from './admin-user-summary.js';
import {db} from './db.js';

export type AdministratorUserRecord = AdministratorUserSummary;

type AdministratorUserLookup = {id: string; email?: never} | {email: string; id?: never};

export async function findAdministratorUser(
  params: AdministratorUserLookup,
): Promise<AdministratorUserRecord | undefined> {
  return await findAdministratorUserSummary(db(), params);
}

export interface ListAdministratorUsersParams {
  actorId: string;
  limit: number;
  cursor?: TimestampIdCursor | undefined;
  search?: string | undefined;
  status?: AdministratorUserSummary['status'] | undefined;
  eligible?: boolean | undefined;
}

export async function listAdministratorUsers(
  params: ListAdministratorUsersParams,
): Promise<ListAdministratorUserSummariesResult> {
  return await listAdministratorUserSummaries(db(), params);
}
