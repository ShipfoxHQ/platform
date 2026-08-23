import {defineConfig} from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/db/schema/definitions.ts',
    './src/db/schema/outbox.ts',
    './src/db/schema/sync-states.ts',
    './src/db/schema/workflows.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
});
