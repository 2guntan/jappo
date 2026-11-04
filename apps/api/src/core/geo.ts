import { getTableName, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/** SQL: GeoJSON text → geometry(4326). */
export const geomFromGeoJson = (g: unknown): SQL => sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(g)}), 4326)`;
/** SQL: geometry column → GeoJSON object (6 decimals ≈ 0.1 m). */
export const asGeoJson = (col: unknown): SQL<unknown> => sql`ST_AsGeoJSON(${col}, 7)::json`;
/** SQL: area in hectares on the ellipsoid (SPEC §4.2). */
export const areaHa = (geom: SQL | unknown): SQL<string> => sql<string>`round((ST_Area((${geom})::geography) / 10000)::numeric, 4)`;

/** Fully qualified column reference ("table"."column") — required inside correlated subqueries. */
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const qcol = (col: AnyColumn): SQL => sql.raw(`"${getTableName(col.table)}"."${snake(col.name)}"`);
