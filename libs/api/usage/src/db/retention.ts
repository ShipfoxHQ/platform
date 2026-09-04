import {sql} from 'drizzle-orm';
import {config} from '#config.js';
import {db} from './db.js';

const MS_PER_DAY = 86_400_000;
const PARTITION_NAME = /^usage_(?:job_executions|inference_segments)_(\d{4})_(\d{2})$/;

export interface DropExpiredUsagePartitionsParams {
  retentionDays?: number;
  now?: Date;
}

export interface DropExpiredUsagePartitionsResult {
  dropped: number;
  partitions: string[];
}

/** Drops complete monthly children only; the current and partial cutoff month stay intact. */
export function dropExpiredUsagePartitions(
  params: DropExpiredUsagePartitionsParams = {},
): Promise<DropExpiredUsagePartitionsResult> {
  const retentionDays = params.retentionDays ?? config.USAGE_RETENTION_DAYS;
  const now = params.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);

  return db().transaction(async (tx) => {
    const result = await tx.execute(sql`
      select child.relname as name
      from pg_inherits
      join pg_class parent on parent.oid = pg_inherits.inhparent
      join pg_class child on child.oid = pg_inherits.inhrelid
      where parent.relname in ('usage_job_executions', 'usage_inference_segments')
        and child.relname like 'usage_%'
    `);
    const partitions = result.rows
      .map((row) => (typeof row.name === 'string' ? row.name : null))
      .filter((name): name is string => name !== null)
      .filter((name) => isExpiredPartition(name, cutoff));

    for (const partition of partitions) {
      // The name was produced by the catalog and passed the strict month pattern above.
      await tx.execute(
        sql`drop table if exists /* validated monthly partition */ ${sql.identifier(partition)}`,
      );
    }

    return {dropped: partitions.length, partitions};
  });
}

function isExpiredPartition(name: string, cutoff: Date): boolean {
  const match = PARTITION_NAME.exec(name);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return false;
  const partitionEnd = new Date(Date.UTC(year, month, 1));
  return partitionEnd <= cutoff;
}
