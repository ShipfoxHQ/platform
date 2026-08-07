import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {sql} from 'drizzle-orm';
import {check, index, integer, pgEnum, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import type {Reservation} from '#core/entities/reservation.js';
import {pgTable} from './common.js';

export const reservationKindEnum = pgEnum('runners_reservation_kind', ['bound', 'launch']);

export const reservations = pgTable(
  'reservations',
  {
    id: uuidv7PrimaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    provisionerId: uuid('provisioner_id').notNull(),
    requiredLabels: text('required_labels').array().notNull(),
    count: integer('count').notNull(),
    kind: reservationKindEnum('kind').notNull().default('launch'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
  },
  (table) => [
    index('runners_reservations_workspace_expires_idx').on(table.workspaceId, table.expiresAt),
    index('runners_reservations_expires_idx').on(table.expiresAt),
    check('runners_reservations_count_positive_ck', sql`${table.count} > 0`),
  ],
);

export type ReservationDb = typeof reservations.$inferSelect;
export type ReservationInsertDb = typeof reservations.$inferInsert;

export function toReservation(row: ReservationDb): Reservation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provisionerId: row.provisionerId,
    requiredLabels: row.requiredLabels,
    count: row.count,
    kind: row.kind,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
