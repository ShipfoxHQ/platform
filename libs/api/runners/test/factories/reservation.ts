import {Factory} from 'fishery';
import {db} from '#db/db.js';
import {reservations} from '#db/schema/reservations.js';

interface ReservationAttrs {
  workspaceId: string;
  provisionerId: string;
  requiredLabels: string[];
  count: number;
  kind?: 'bound' | 'launch';
  expiresAt: Date;
}

export const reservationFactory = Factory.define<ReservationAttrs>(({onCreate}) => {
  onCreate(async (attrs) => {
    const [row] = await db().insert(reservations).values(attrs).returning();
    if (!row) throw new Error('Insert returned no rows');
    return {
      workspaceId: row.workspaceId,
      provisionerId: row.provisionerId,
      requiredLabels: row.requiredLabels,
      count: row.count,
      kind: row.kind,
      expiresAt: row.expiresAt,
    };
  });

  return {
    workspaceId: crypto.randomUUID(),
    provisionerId: crypto.randomUUID(),
    requiredLabels: ['linux'],
    count: 1,
    expiresAt: new Date(Date.now() + 60_000),
  };
});
