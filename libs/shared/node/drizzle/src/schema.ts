import {sql} from 'drizzle-orm';
import {uuid} from 'drizzle-orm/pg-core';

export function uuidv7PrimaryKey() {
  return uuid('id').primaryKey().default(sql`uuidv7()`);
}
