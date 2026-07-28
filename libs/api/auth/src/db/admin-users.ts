import type {AdministratorUserSummary} from '#core/entities/administrator-read-model.js';
import {findAdministratorUserSummary} from './admin-user-summary.js';
import {db} from './db.js';

export type AdministratorUserRecord = AdministratorUserSummary;

type AdministratorUserLookup = {id: string; email?: never} | {email: string; id?: never};

export async function findAdministratorUser(
  params: AdministratorUserLookup,
): Promise<AdministratorUserRecord | undefined> {
  return await findAdministratorUserSummary(db(), params);
}
