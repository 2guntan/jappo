import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://jappo:jappo@localhost:5432/jappo' },
  extensionsFilters: ['postgis'],
  casing: 'snake_case',
});
