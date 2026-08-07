import {sql} from 'drizzle-orm';
import type {Tx} from './db.js';

export async function lockRunnerReservationAdvisoryKeysTx(
  tx: Tx,
  params: {provisionerId: string; reservationIds: readonly string[]},
): Promise<void> {
  const reservationIds = [...new Set(params.reservationIds)].sort();
  if (reservationIds.length === 0) return;

  const lockKeys = sql.join(
    reservationIds.map(
      (reservationId) => sql`(${`runners_assignment:${params.provisionerId}:${reservationId}`})`,
    ),
    sql`, `,
  );
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtext(lock_key))
    from (values ${lockKeys}) as reservation_locks(lock_key)
    order by lock_key
  `);
}
