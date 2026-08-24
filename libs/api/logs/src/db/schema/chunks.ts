import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {bigint, bigserial, index, integer, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {attemptStreams} from './attempt-streams.js';
import {bytea, pgTable} from './common.js';

/**
 * Hot, append-only log bytes for open streams, pending compaction.
 *
 * The active append writer has one byte-CAS axis, and the stored chunk table has a separate read
 * axis (`seq`). Runner-origin and server-origin writers are mutually exclusive for a stream because
 * the runner's local spool cursor cannot represent bytes inserted by another origin. `origin` is
 * `runner` for bytes accepted from a runner append after ingest normalization, `server` for records
 * appended by the server-origin writer through the same CAS and budget, and `control` for a
 * server-injected tombstone. Control chunks do not advance `committed_length`; `stream_offset` is
 * the active writer's CAS position and is informational for control chunks. The reader and
 * compactor still walk every stored chunk by `seq`.
 */
export const logChunks = pgTable(
  'chunks',
  {
    id: uuidv7PrimaryKey(),
    streamId: uuid('stream_id')
      .notNull()
      .references(() => attemptStreams.id, {onDelete: 'cascade'}),
    seq: bigserial('seq', {mode: 'number'}).notNull(),
    streamOffset: bigint('stream_offset', {mode: 'number'}).notNull(),
    byteLen: integer('byte_len').notNull(),
    data: bytea('data').notNull(),
    origin: text('origin', {enum: ['runner', 'control', 'server']}).notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  (table) => [index('logs_chunks_stream_seq_idx').on(table.streamId, table.seq)],
);

export type LogChunkDb = typeof logChunks.$inferSelect;
export type LogChunkInsertDb = typeof logChunks.$inferInsert;

export type ChunkOrigin = 'runner' | 'control' | 'server';
