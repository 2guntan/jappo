import { customType, integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

export const newId = (): string => uuidv7();

export const pk = () => uuid('id').primaryKey().$defaultFn(newId);
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const createdAt = () => tstz('created_at').notNull().defaultNow();
export const updatedAt = () =>
  tstz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Standard columns for mutable tables (SPEC §4.2). */
export const stdCols = () => ({
  id: pk(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by'),
});

/** Standard columns for append-only tables. */
export const appendCols = () => ({
  id: pk(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: uuid('created_by'),
});

/** PostGIS geometry stored/returned as EWKT/GeoJSON through SQL helpers in services. */
export const geometry = (name: string, type: 'MultiPolygon' | 'Polygon' | 'Point') =>
  customType<{ data: string; driverData: string }>({
    dataType: () => `geometry(${type}, 4326)`,
  })(name);
