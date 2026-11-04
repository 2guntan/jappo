import type { TestProject } from 'vitest/node';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '../src/db/migrate';

let container: StartedPostgreSqlContainer | undefined;

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Integration tests run against PostGIS: a Testcontainers `postgis/postgis:16-3.4` instance,
 * or TEST_DATABASE_URL when provided (CI service container / local compose).
 */
export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4').withDatabase('jappo_test').withUsername('jappo').withPassword('jappo').start();
    url = container.getConnectionUri();
  }
  await runMigrations(url);
  project.provide('databaseUrl', url);
  return async () => {
    await container?.stop();
  };
}
