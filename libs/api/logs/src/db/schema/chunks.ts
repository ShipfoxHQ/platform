import {uuidv7PrimaryKey} from '@shipfox/node-drizzle';
import {bigint, bigserial, index, integer, text, timestamp, uuid} from 'drizzle-orm/pg-core';
import {attemptStreams} from './attempt-streams.js';
import {bytea, pgTable} from './common.js';

/**
 * Hot, append-only log bytes for open streams, pending compaction.
 *
 * Two byte axes meet here and MUST stay distinct:
 *
 *   Runner spool (CAS axis)          Stored chunk stream (read axis, by seq)
 *   offset 0 ┌────────────┐  ───►  seq 1 │ normalized chunk A │ origin=runner
 *      100   ├─ chunk A ──┤  ───►  seq 2 │ normalized chunk B │ origin=server
 *      250   ├─ chunk B ──┤  ───►  seq 3 │ {capped}           │ origin=control ← server-injected;
 *            └────────────┘                                      does NOT advance committed_length
 *
 * `origin` is `runner` for bytes accepted from a runner append after ingest normalization, `server`
 * for records appended by a server-origin writer (the tool step executor) through the same CAS and
 * budget, and `control` for a server-injected tombstone. `stream_offset` is the runner-axis position
 * of a runner chunk; for a server chunk it is the tail it was appended at and for a `control` chunk it
 * is informational. `seq` (insertion order) is the read axis the reader walks, so server records
 * interleave correctly with normalized runner records.
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
