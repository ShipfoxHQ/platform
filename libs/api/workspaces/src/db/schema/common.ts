import {pgTableCreator} from 'drizzle-orm/pg-core';

export const pgTable = pgTableCreator((name) =>
  name === 'workspaces' ? name : `workspaces_${name}`,
);
