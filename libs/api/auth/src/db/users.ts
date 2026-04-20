import {eq} from 'drizzle-orm';
import type {User} from '#core/entities/user.js';
import {db} from './db.js';
import {toUser, users} from './schema/users.js';

export interface CreateUserParams {
  email: string;
  hashedPassword: string;
  name?: string | null;
}

export async function createUser(params: CreateUserParams): Promise<User> {
  const rows = await db()
    .insert(users)
    .values({
      email: params.email,
      hashedPassword: params.hashedPassword,
      name: params.name ?? null,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toUser(row);
}

export async function findUserByEmail(params: {email: string}): Promise<User | undefined> {
  const rows = await db().select().from(users).where(eq(users.email, params.email)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toUser(row);
}

export async function findUserById(params: {id: string}): Promise<User | undefined> {
  const rows = await db().select().from(users).where(eq(users.id, params.id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toUser(row);
}

export interface UpdateUserPasswordParams {
  userId: string;
  hashedPassword: string;
}

export async function updateUserPassword(
  params: UpdateUserPasswordParams,
): Promise<User | undefined> {
  const rows = await db()
    .update(users)
    .set({
      hashedPassword: params.hashedPassword,
      updatedAt: new Date(),
    })
    .where(eq(users.id, params.userId))
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toUser(row);
}

export async function markEmailVerified(params: {userId: string}): Promise<User | undefined> {
  const rows = await db()
    .update(users)
    .set({emailVerifiedAt: new Date(), updatedAt: new Date()})
    .where(eq(users.id, params.userId))
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toUser(row);
}
