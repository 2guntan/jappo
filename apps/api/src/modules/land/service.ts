import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { newId } from '../../db/columns';
import { transition, blockMachine, allowedActions as machineActions, type BlockStatus } from '@jappo/domain';
import type { GeoArea, GeoPolygon } from '@jappo/contracts';
import type { Db, DbOrTx } from '../../db/client';
import { blockAssets, blocks, communityGrievances, landDocuments, plotAllocations, plots } from './schema';
import { farmers } from '../farmers/schema';
import { files } from '../../core/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, requireOrg } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { nextRef } from '../../core/refs';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors';
import { hasPermission } from '../../core/authz/permissions';
import { visibleTo } from '../../core/authz/visibility';
import { asGeoJson, geomFromGeoJson, qcol } from '../../core/geo';
import { assertVersion } from '../../core/etag';
import { decodeCursor, toPage } from '../../core/pagination';
import { assertOperator } from '../farmers/service';
import type { ModuleContext } from '../../core/module';
import { linkFile } from '../files/service';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
type BlockRow = typeof blocks.$inferSelect;

// ---------------------------------------------------------------- visibility

export const blockVisible = (actor: ActorContext) => visibleTo(actor, blocks.ownerOrgId, [{ type: 'block', idCol: blocks.id }]);

/** Load a block visible to the actor (404 otherwise). `write` requires ownership. */
export async function loadBlock(db: DbOrTx, actor: ActorContext, id: string, write = false): Promise<BlockRow> {
  const [b] = await db.select().from(blocks).where(and(eq(blocks.id, id), blockVisible(actor)));
  if (!b) throw notFound('Block');
  if (write && b.ownerOrgId !== actor.orgId) throw notFound('Block');
  if (write && b.status === 'archived') throw conflict('BLOCK_ARCHIVED', 'The block is archived');
  return b;
}

/** Automatic `draft → documenting` on first land document or plot (SPEC §8.1). */
export async function touchDocumenting(tx: DbOrTx, actor: ActorContext, b: BlockRow) {
  if (b.status !== 'draft') return;
  const next = transition(blockMachine, b.status, 'document');
  await tx.update(blocks).set({ status: next, version: sql`${blocks.version} + 1` }).where(eq(blocks.id, b.id));
  await audit(tx, actor, { action: 'block.documenting', resourceType: 'block', resourceId: b.id, before: { status: b.status }, after: { status: next } });
  await emit(tx, actor, 'block.document', { type: 'block', id: b.id }, { from: b.status, to: next });
}

// ---------------------------------------------------------------- blocks

const blockSelect = {
  b: blocks,
  boundaryJson: asGeoJson(blocks.boundary),
  centroidJson: asGeoJson(blocks.centroid),
  plotCount: sql<number>`(select count(*)::int from ${plots} p where p.block_id = ${qcol(blocks.id)} and p.archived_at is null)`,
  plotsArea: sql<string>`(select coalesce(sum(p.area_ha), 0) from ${plots} p where p.block_id = ${qcol(blocks.id)} and p.archived_at is null and p.status <> 'excluded')`,
  farmerCount: sql<number>`(select count(distinct pa.farmer_id)::int from ${plotAllocations} pa where pa.block_id = ${qcol(blocks.id)} and pa.status = 'active')`,
  womenCount: sql<number>`(select count(distinct pa.farmer_id)::int from ${plotAllocations} pa join ${farmers} f on f.id = pa.farmer_id where pa.block_id = ${qcol(blocks.id)} and pa.status = 'active' and f.sex = 'F')`,
  docsVerified: sql<number>`(select count(*)::int from ${landDocuments} d where d.block_id = ${qcol(blocks.id)} and d.status = 'verified')`,
};
type BlockSel = { b: BlockRow; boundaryJson: unknown; centroidJson: unknown; plotCount: number; plotsArea: string; farmerCount: number; womenCount: number; docsVerified: number };

export function blockDto(r: BlockSel, actor: ActorContext) {
  const b = r.b;
  const own = b.ownerOrgId === actor.orgId;
  const actions: string[] = [];
  if (own && b.status !== 'archived') {
    if (hasPermission(actor.permissions, 'block:update')) actions.push('update', 'set_boundary');
    if (hasPermission(actor.permissions, 'plot:create')) actions.push('add_plot', 'auto_grid');
    if (hasPermission(actor.permissions, 'land_document:create')) actions.push('add_land_document');
    if (hasPermission(actor.permissions, 'block:archive') && machineActions(blockMachine, b.status).includes('archive') && !['in_financing', 'financed', 'active'].includes(b.status)) actions.push('archive');
    if (machineActions(blockMachine, b.status).includes('check_readiness')) actions.push('check_readiness');
  }
  return {
    id: b.id,
    ref: b.ref,
    ownerOrgId: b.ownerOrgId,
    name: b.name,
    region: b.region,
    department: b.department,
    commune: b.commune,
    village: b.village,
    boundary: (r.boundaryJson as never) ?? null,
    areaHa: num(b.areaHa),
    centroid: (r.centroidJson as never) ?? null,
    waterSource: b.waterSource,
    irrigationType: b.irrigationType,
    tenureType: b.tenureType,
    farmerGroupOrgId: b.farmerGroupOrgId,
    solidarityMode: b.solidarityMode,
    solidarityCapPct: Number(b.solidarityCapPct),
    status: b.status,
    description: b.description,
    stats: { plots: r.plotCount, plotsAreaHa: Number(r.plotsArea), farmers: r.farmerCount, womenFarmers: r.womenCount, landDocsVerified: r.docsVerified },
    version: b.version,
    createdAt: b.createdAt.toISOString(),
    allowedActions: actions,
  };
}

export async function blockOut(db: DbOrTx, actor: ActorContext, id: string) {
  const [r] = await db.select(blockSelect).from(blocks).where(and(eq(blocks.id, id), blockVisible(actor)));
  if (!r) throw notFound('Block');
  return blockDto(r as BlockSel, actor);
}

export async function listBlocks(db: Db, actor: ActorContext, q: { limit: number; cursor?: string; q?: string; status?: string }) {
  const conds: SQL[] = [blockVisible(actor)];
  if (q.status) conds.push(eq(blocks.status, q.status as BlockStatus));
  else conds.push(ne(blocks.status, 'archived'));
  if (q.q) conds.push(or(ilike(blocks.name, `%${q.q}%`), ilike(blocks.ref, `%${q.q}%`), ilike(blocks.village, `%${q.q}%`))!);
  const c = decodeCursor(q.cursor);
  if (c) conds.push(lt(blocks.id, c.id));
  const rows = (await db.select(blockSelect).from(blocks).where(and(...conds)).orderBy(desc(blocks.id)).limit(q.limit + 1)) as BlockSel[];
  return toPage(rows.map((r) => ({ ...r, id: r.b.id })), q.limit, (r) => blockDto(r, actor));
}

type BlockInput = Partial<Omit<typeof blocks.$inferInsert, 'solidarityCapPct'>> & { solidarityCapPct?: number };

export async function createBlock(db: Db, actor: ActorContext, body: BlockInput & { name: string; region: string; tenureType: BlockRow['tenureType'] }) {
  assertOperator(actor);
  const orgId = requireOrg(actor);
  return db.transaction(async (tx) => {
    const ref = await nextRef(tx, 'BLK');
    const [b] = await tx
      .insert(blocks)
      .values({ ...body, solidarityCapPct: body.solidarityCapPct === undefined ? undefined : String(body.solidarityCapPct), ref, ownerOrgId: orgId, createdBy: actorUserId(actor) })
      .returning();
    await audit(tx, actor, { action: 'block.created', resourceType: 'block', resourceId: b!.id, after: { ref, name: b!.name } });
    await emit(tx, actor, 'block.created', { type: 'block', id: b!.id }, { ref });
    return b!.id;
  });
}

export async function updateBlock(db: Db, actor: ActorContext, id: string, expected: number, body: BlockInput) {
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, id, true);
    assertVersion(expected, b.version);
    if (body.solidarityMode === 'group' && !(body.farmerGroupOrgId ?? b.farmerGroupOrgId)) {
      throw unprocessable('FARMER_GROUP_REQUIRED', 'Solidarity mode "group" requires a farmer group');
    }
    const set = { ...body, solidarityCapPct: body.solidarityCapPct === undefined ? undefined : String(body.solidarityCapPct), version: b.version + 1 };
    const [u] = await tx.update(blocks).set(set).where(and(eq(blocks.id, id), eq(blocks.version, b.version))).returning({ id: blocks.id });
    if (!u) throw conflict('VERSION_CONFLICT');
    await audit(tx, actor, { action: 'block.updated', resourceType: 'block', resourceId: id, after: body });
    await emit(tx, actor, 'block.updated', { type: 'block', id }, { changed: Object.keys(body) });
  });
}

export async function archiveBlock(db: Db, actor: ActorContext, id: string, expected: number) {
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, id, true);
    assertVersion(expected, b.version);
    if (['in_financing', 'financed', 'active'].includes(b.status)) throw unprocessable('BLOCK_HAS_ACTIVE_FINANCING', 'A block with financing in progress or an active facility cannot be archived');
    const next = transition(blockMachine, b.status, 'archive');
    await tx.update(blocks).set({ status: next, archivedAt: new Date(), version: b.version + 1 }).where(eq(blocks.id, id));
    await audit(tx, actor, { action: 'block.archived', resourceType: 'block', resourceId: id, before: { status: b.status }, after: { status: next } });
    await emit(tx, actor, 'block.archived', { type: 'block', id }, {});
  });
}

// ---------------------------------------------------------------- boundary

/** Extract polygons from GeoJSON (geometry / Feature / FeatureCollection) or KML text. */
export function parseBoundaryFile(text: string, mime: string): GeoArea {
  if (mime.includes('kml')) {
    const polys: number[][][][] = [];
    for (const m of text.matchAll(/<Polygon[\s\S]*?<\/Polygon>/gi)) {
      const rings: number[][][] = [];
      for (const c of m[0].matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)) {
        const ring = c[1]!.trim().split(/\s+/).map((t) => t.split(',').slice(0, 2).map(Number));
        if (ring.length >= 4 && ring.every((p) => p.length === 2 && p.every(Number.isFinite))) rings.push(ring);
      }
      if (rings.length) polys.push(rings);
    }
    if (!polys.length) throw unprocessable('BOUNDARY_INVALID', 'No polygon found in KML');
    return { type: 'MultiPolygon', coordinates: polys as never };
  }
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw unprocessable('BOUNDARY_INVALID', 'File is not valid GeoJSON');
  }
  const polys: unknown[] = [];
  const visit = (g: Record<string, unknown> | null | undefined): void => {
    if (!g) return;
    if (g.type === 'FeatureCollection') (g.features as Record<string, unknown>[]).forEach(visit);
    else if (g.type === 'Feature') visit(g.geometry as Record<string, unknown>);
    else if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') (g.coordinates as unknown[]).forEach((c) => polys.push(c));
    else if (g.type === 'GeometryCollection') (g.geometries as Record<string, unknown>[]).forEach(visit);
  };
  visit(j as Record<string, unknown>);
  if (!polys.length) throw unprocessable('BOUNDARY_INVALID', 'No polygon found in GeoJSON');
  return { type: 'MultiPolygon', coordinates: polys as never };
}

export async function setBoundary(ctx: ModuleContext, actor: ActorContext, id: string, expected: number, input: { geometry: GeoArea } | { fileId: string }) {
  const db = ctx.db;
  let geometry: GeoArea;
  if ('fileId' in input) {
    const [f] = await db.select().from(files).where(and(eq(files.id, input.fileId), eq(files.ownerOrgId, requireOrg(actor))));
    if (!f) throw badRequest('FILE_NOT_FOUND', 'File not found', [{ path: 'body.fileId', message: 'unknown file' }]);
    if (!f.mime.includes('geo+json') && !f.mime.includes('kml')) throw unprocessable('BOUNDARY_FILE_TYPE', 'Use a GeoJSON or KML file');
    geometry = parseBoundaryFile((await ctx.storage.get(f.objectKey)).toString('utf8'), f.mime);
  } else geometry = input.geometry;

  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, id, true);
    assertVersion(expected, b.version);
    const g = sql`ST_Multi(ST_CollectionExtract(ST_MakeValid(${geomFromGeoJson(geometry)}), 3))`;
    const chk = await tx.execute<{ valid: boolean; empty: boolean; area: string }>(sql`
      with g as (select ${g} as geom) select ST_IsValid(geom) as valid, ST_IsEmpty(geom) as empty, coalesce(ST_Area(geom::geography) / 10000, 0) as area from g`);
    const c = chk.rows[0]!;
    if (c.empty || !c.valid || Number(c.area) <= 0) throw unprocessable('BOUNDARY_INVALID', 'Boundary must be a valid, non-empty polygon');
    if (Number(c.area) > 100_000) throw unprocessable('BOUNDARY_TOO_LARGE', 'Boundary larger than 100 000 ha');
    const outside = await tx.execute<{ code: string }>(sql`
      select p.code from ${plots} p where p.block_id = ${id} and p.archived_at is null
      and not ST_Within(p.geometry, ST_Buffer((${g})::geography, 1)::geometry)`);
    if (outside.rows.length) throw unprocessable('PLOTS_OUTSIDE_BOUNDARY', `Plots outside the new boundary: ${outside.rows.map((r) => r.code).join(', ')}`);
    await tx.execute(sql`
      update ${blocks} set boundary = ${g}, area_ha = round((ST_Area((${g})::geography) / 10000)::numeric, 4),
        centroid = ST_PointOnSurface(${g}), version = version + 1, updated_at = now() where id = ${id}`);
    await audit(tx, actor, { action: 'block.boundary_updated', resourceType: 'block', resourceId: id, after: { areaHa: Number(Number(c.area).toFixed(4)) } });
    await emit(tx, actor, 'block.boundary_updated', { type: 'block', id }, { areaHa: Number(c.area) });
  });
}

// ---------------------------------------------------------------- plots

const plotSelect = {
  p: plots,
  geom: asGeoJson(plots.geometry),
};

async function plotFarmers(db: DbOrTx, plotIds: string[]) {
  const m = new Map<string, { farmerId: string; name: string; sharePct: number; allocationId: string }[]>();
  if (!plotIds.length) return m;
  const rows = await db
    .select({ a: plotAllocations, fn: farmers.firstName, ln: farmers.lastName })
    .from(plotAllocations)
    .innerJoin(farmers, eq(farmers.id, plotAllocations.farmerId))
    .where(and(inArray(plotAllocations.plotId, plotIds), eq(plotAllocations.status, 'active')));
  for (const r of rows) m.set(r.a.plotId, [...(m.get(r.a.plotId) ?? []), { farmerId: r.a.farmerId, name: `${r.fn} ${r.ln}`, sharePct: Number(r.a.sharePct), allocationId: r.a.id }]);
  return m;
}

function plotDto(r: { p: typeof plots.$inferSelect; geom: unknown }, fs: { farmerId: string; name: string; sharePct: number; allocationId: string }[] = []) {
  return {
    id: r.p.id,
    blockId: r.p.blockId,
    code: r.p.code,
    geometry: r.geom as GeoPolygon,
    areaHa: Number(r.p.areaHa),
    soilType: r.p.soilType,
    irrigated: r.p.irrigated,
    status: r.p.status,
    allocatedPct: fs.reduce((s, f) => s + f.sharePct, 0),
    farmers: fs,
    version: r.p.version,
    createdAt: r.p.createdAt.toISOString(),
  };
}

export async function listPlots(db: DbOrTx, actor: ActorContext, blockId: string) {
  await loadBlock(db, actor, blockId);
  const rows = await db.select(plotSelect).from(plots).where(and(eq(plots.blockId, blockId), isNull(plots.archivedAt))).orderBy(asc(plots.code));
  const fs = await plotFarmers(db, rows.map((r) => r.p.id));
  return rows.map((r) => plotDto(r, fs.get(r.p.id)));
}

export async function loadPlot(db: DbOrTx, actor: ActorContext, plotId: string, write = false) {
  const [r] = await db.select(plotSelect).from(plots).where(and(eq(plots.id, plotId), isNull(plots.archivedAt)));
  if (!r) throw notFound('Plot');
  const block = await loadBlock(db, actor, r.p.blockId, write).catch(() => {
    throw notFound('Plot');
  });
  return { ...r, block };
}

export async function plotOut(db: DbOrTx, actor: ActorContext, plotId: string) {
  const r = await loadPlot(db, actor, plotId);
  return plotDto(r, (await plotFarmers(db, [plotId])).get(plotId));
}

/** SPEC §7.4: plot within boundary (1 m tolerance) and no overlap > 1 % with another active plot. */
async function assertPlotGeometry(tx: DbOrTx, blockId: string, g: SQL, exceptPlotId?: string) {
  const r = await tx.execute<{ valid: boolean; within: boolean | null; area: string }>(sql`
    with g as (select ${g} as geom)
    select ST_IsValid(g.geom) as valid,
      (select ST_Within(g.geom, ST_Buffer(b.boundary::geography, 1)::geometry) from ${blocks} b where b.id = ${blockId}) as within,
      ST_Area(g.geom::geography) / 10000 as area from g`);
  const c = r.rows[0]!;
  if (!c.valid || Number(c.area) <= 0) throw unprocessable('PLOT_GEOMETRY_INVALID', 'Plot geometry must be a valid polygon');
  if (c.within === null) throw unprocessable('BOUNDARY_REQUIRED', 'Set the block boundary before adding plots');
  if (!c.within) throw unprocessable('PLOT_OUTSIDE_BOUNDARY', 'The plot must lie within the block boundary');
  const overlaps = await tx.execute<{ code: string }>(sql`
    with g as (select ${g} as geom)
    select p.code from ${plots} p, g where p.block_id = ${blockId} and p.archived_at is null and p.status <> 'excluded'
      ${exceptPlotId ? sql`and p.id <> ${exceptPlotId}` : sql``}
      and ST_Intersects(p.geometry, g.geom)
      and ST_Area(ST_Intersection(p.geometry, g.geom)::geography) > 0.01 * ST_Area(g.geom::geography)`);
  if (overlaps.rows.length) throw unprocessable('PLOT_OVERLAP', `The plot overlaps: ${overlaps.rows.map((o) => o.code).join(', ')}`);
}

async function nextPlotCode(tx: DbOrTx, blockId: string, prefix = 'P-'): Promise<string> {
  const r = await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${plots} where block_id = ${blockId}`);
  let n = Number(r.rows[0]!.n) + 1;
  for (;;) {
    const code = `${prefix}${String(n).padStart(3, '0')}`;
    const [ex] = await tx.select({ id: plots.id }).from(plots).where(and(eq(plots.blockId, blockId), eq(plots.code, code), isNull(plots.archivedAt)));
    if (!ex) return code;
    n += 1;
  }
}

export async function createPlot(tx: DbOrTx, actor: ActorContext, blockId: string, body: { code?: string; geometry: GeoPolygon; soilType?: string | null; irrigated?: boolean }) {
  const b = await loadBlock(tx, actor, blockId, true);
  const g = sql`ST_MakeValid(${geomFromGeoJson(body.geometry)})`;
  await assertPlotGeometry(tx, blockId, g);
  const code = body.code ?? (await nextPlotCode(tx, blockId));
  const [dup] = await tx.select({ id: plots.id }).from(plots).where(and(eq(plots.blockId, blockId), eq(plots.code, code), isNull(plots.archivedAt)));
  if (dup) throw conflict('PLOT_CODE_TAKEN', `Plot code ${code} already exists in this block`);
  const r = await tx.execute<{ id: string }>(sql`
    insert into ${plots} (id, block_id, owner_org_id, code, geometry, area_ha, soil_type, irrigated, created_by, updated_at)
    values (${newId()}, ${blockId}, ${b.ownerOrgId}, ${code}, ${g}, round((ST_Area((${g})::geography) / 10000)::numeric, 4),
      ${body.soilType ?? null}, ${body.irrigated ?? b.irrigationType !== 'none'}, ${actorUserId(actor)}, now()) returning id`);
  const id = r.rows[0]!.id;
  await touchDocumenting(tx, actor, b);
  await audit(tx, actor, { action: 'plot.created', resourceType: 'plot', resourceId: id, after: { blockId, code } });
  await emit(tx, actor, 'plot.created', { type: 'plot', id }, { blockId, code });
  return id;
}

export async function updatePlot(tx: DbOrTx, actor: ActorContext, plotId: string, expected: number, body: { code?: string; geometry?: GeoPolygon; soilType?: string | null; irrigated?: boolean; status?: 'available' | 'fallow' | 'excluded' }) {
  const { p, block } = await loadPlot(tx, actor, plotId, true);
  assertVersion(expected, p.version);
  if (body.status && body.status !== 'available') {
    const [act] = await tx.select({ id: plotAllocations.id }).from(plotAllocations).where(and(eq(plotAllocations.plotId, plotId), eq(plotAllocations.status, 'active')));
    if (act) throw unprocessable('PLOT_HAS_ALLOCATIONS', 'End active allocations before changing the plot status');
  }
  const sets: SQL[] = [sql`version = version + 1`, sql`updated_at = now()`];
  if (body.geometry) {
    const g = sql`ST_MakeValid(${geomFromGeoJson(body.geometry)})`;
    await assertPlotGeometry(tx, block.id, g, plotId);
    sets.push(sql`geometry = ${g}`, sql`area_ha = round((ST_Area((${g})::geography) / 10000)::numeric, 4)`);
  }
  if (body.code !== undefined) sets.push(sql`code = ${body.code}`);
  if (body.soilType !== undefined) sets.push(sql`soil_type = ${body.soilType}`);
  if (body.irrigated !== undefined) sets.push(sql`irrigated = ${body.irrigated}`);
  if (body.status !== undefined) sets.push(sql`status = ${body.status}`);
  await tx.execute(sql`update ${plots} set ${sql.join(sets, sql`, `)} where id = ${plotId} and version = ${p.version}`);
  await audit(tx, actor, { action: 'plot.updated', resourceType: 'plot', resourceId: plotId, after: { ...body, geometry: body.geometry ? 'changed' : undefined } });
  await emit(tx, actor, 'plot.updated', { type: 'plot', id: plotId }, { blockId: block.id });
}

export async function archivePlot(db: Db, actor: ActorContext, plotId: string) {
  return db.transaction(async (tx) => {
    const { p } = await loadPlot(tx, actor, plotId, true);
    const [act] = await tx.select({ id: plotAllocations.id }).from(plotAllocations).where(and(eq(plotAllocations.plotId, plotId), eq(plotAllocations.status, 'active')));
    if (act) throw unprocessable('PLOT_HAS_ALLOCATIONS', 'End active allocations before archiving the plot');
    await tx.update(plots).set({ archivedAt: new Date(), version: p.version + 1 }).where(eq(plots.id, plotId));
    await audit(tx, actor, { action: 'plot.archived', resourceType: 'plot', resourceId: plotId });
  });
}

/**
 * Split the block boundary into N plots of equal area along its longest axis (SPEC §10.4 helper).
 * Works in the local UTM projection; cut positions found by bisection on the cumulative area.
 */
export async function autoGrid(db: Db, actor: ActorContext, blockId: string, body: { count?: number; targetAreaHa?: number; codePrefix: string; irrigated?: boolean; soilType?: string | null }) {
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, blockId, true);
    if (!b.boundary) throw unprocessable('BOUNDARY_REQUIRED', 'Set the block boundary before generating plots');
    const [existing] = await tx.select({ id: plots.id }).from(plots).where(and(eq(plots.blockId, blockId), isNull(plots.archivedAt)));
    if (existing) throw conflict('PLOTS_EXIST', 'The block already has plots; archive them before auto-grid');
    const info = (
      await tx.execute<{ srid: number; xmin: number; xmax: number; ymin: number; ymax: number; area: number; area_ha: number }>(sql`
      with b as (select boundary, (32600 + floor((ST_X(ST_PointOnSurface(boundary)) + 180) / 6) + 1 + case when ST_Y(ST_PointOnSurface(boundary)) < 0 then 100 else 0 end)::int as srid from ${blocks} where id = ${blockId}),
      u as (select srid, ST_Transform(boundary, srid) as g, ST_Area(boundary::geography) / 10000 as area_ha from b)
      select srid, ST_XMin(g) as xmin, ST_XMax(g) as xmax, ST_YMin(g) as ymin, ST_YMax(g) as ymax, ST_Area(g) as area, area_ha from u`)
    ).rows[0]!;
    const n = body.count ?? Math.max(1, Math.round(Number(info.area_ha) / body.targetAreaHa!));
    if (n > 500) throw unprocessable('TOO_MANY_PLOTS', 'At most 500 plots per auto-grid');
    const srid = sql.raw(String(Math.trunc(Number(info.srid))));
    const alongX = Number(info.xmax) - Number(info.xmin) >= Number(info.ymax) - Number(info.ymin);
    const [lo0, hi0] = alongX ? [Number(info.xmin), Number(info.xmax)] : [Number(info.ymin), Number(info.ymax)];
    const env = (a: number, c: number) =>
      alongX
        ? sql`ST_MakeEnvelope(${a}, ${Number(info.ymin) - 1}, ${c}, ${Number(info.ymax) + 1}, ${srid})`
        : sql`ST_MakeEnvelope(${Number(info.xmin) - 1}, ${a}, ${Number(info.xmax) + 1}, ${c}, ${srid})`;
    const ug = sql`(select ST_Transform(boundary, ${srid}) from ${blocks} where id = ${blockId})`;
    const areaBelow = async (c: number) => Number((await tx.execute<{ a: number }>(sql`select ST_Area(ST_Intersection(${ug}, ${env(lo0 - 1, c)})) as a`)).rows[0]!.a);
    const cuts = [lo0 - 1];
    for (let k = 1; k < n; k++) {
      const target = (Number(info.area) * k) / n;
      let lo = cuts[k - 1]!;
      let hi = hi0;
      for (let it = 0; it < 50 && hi - lo > 0.001; it++) {
        const mid = (lo + hi) / 2;
        if ((await areaBelow(mid)) < target) lo = mid;
        else hi = mid;
      }
      cuts.push((lo + hi) / 2);
    }
    cuts.push(hi0 + 1);
    const ids: string[] = [];
    for (let k = 1; k <= n; k++) {
      const code = `${body.codePrefix}${String(k).padStart(3, '0')}`;
      const strip = sql`(select (ST_Dump(ST_Transform(ST_Intersection(${ug}, ${env(cuts[k - 1]!, cuts[k]!)}), 4326))).geom as g order by ST_Area((ST_Dump(ST_Transform(ST_Intersection(${ug}, ${env(cuts[k - 1]!, cuts[k]!)}), 4326))).geom) desc limit 1)`;
      const id = newId();
      await tx.execute(sql`
        insert into ${plots} (id, block_id, owner_org_id, code, geometry, area_ha, soil_type, irrigated, created_by, updated_at)
        select ${id}, ${blockId}, ${b.ownerOrgId}, ${code}, s.g, round((ST_Area(s.g::geography) / 10000)::numeric, 4), ${body.soilType ?? null},
          ${body.irrigated ?? b.irrigationType !== 'none'}, ${actorUserId(actor)}, now()
        from (select ST_MakeValid(${strip}) as g) s`);
      ids.push(id);
    }
    await touchDocumenting(tx, actor, b);
    await audit(tx, actor, { action: 'plot.auto_grid', resourceType: 'block', resourceId: blockId, after: { count: n } });
    await emit(tx, actor, 'plot.auto_grid', { type: 'block', id: blockId }, { count: n });
    return ids;
  });
}

// ---------------------------------------------------------------- allocations

export async function listAllocations(db: DbOrTx, actor: ActorContext, plotId: string) {
  await loadPlot(db, actor, plotId);
  const rows = await db
    .select({ a: plotAllocations, fn: farmers.firstName, ln: farmers.lastName, code: farmers.code })
    .from(plotAllocations)
    .innerJoin(farmers, eq(farmers.id, plotAllocations.farmerId))
    .where(eq(plotAllocations.plotId, plotId))
    .orderBy(desc(plotAllocations.id));
  return rows.map(allocationDto);
}

const allocationDto = ({ a, fn, ln, code }: { a: typeof plotAllocations.$inferSelect; fn: string; ln: string; code: string }) => ({
  id: a.id,
  plotId: a.plotId,
  farmerId: a.farmerId,
  farmerName: `${fn} ${ln}`,
  farmerCode: code,
  startDate: a.startDate,
  endDate: a.endDate,
  sharePct: Number(a.sharePct),
  status: a.status,
  contractId: a.contractId,
});

export async function allocate(tx: DbOrTx, actor: ActorContext, plotId: string, body: { farmerId: string; sharePct: number; startDate?: string }) {
  const { p, block } = await loadPlot(tx, actor, plotId, true);
  if (p.status === 'excluded' || p.status === 'fallow') throw unprocessable('PLOT_NOT_ALLOCATABLE', `Plot is ${p.status}`);
  await tx.execute(sql`select id from ${plots} where id = ${plotId} for update`);
  const [f] = await tx.select().from(farmers).where(and(eq(farmers.id, body.farmerId), eq(farmers.ownerOrgId, block.ownerOrgId)));
  if (!f) throw badRequest('FARMER_NOT_FOUND', 'Farmer not found in your organisation', [{ path: 'body.farmerId', message: 'unknown farmer' }]);
  if (f.status !== 'active') throw unprocessable('FARMER_INACTIVE', 'Farmer is inactive');
  const active = await tx.select().from(plotAllocations).where(and(eq(plotAllocations.plotId, plotId), eq(plotAllocations.status, 'active')));
  if (active.some((a) => a.farmerId === body.farmerId)) throw conflict('ALREADY_ALLOCATED', 'This farmer already holds an active allocation on the plot');
  const used = active.reduce((s, a) => s + Number(a.sharePct), 0);
  if (used + body.sharePct > 100.0001) throw unprocessable('SHARE_EXCEEDED', `Only ${(100 - used).toFixed(2)} % of this plot remains available`);
  const [a] = await tx
    .insert(plotAllocations)
    .values({ plotId, farmerId: body.farmerId, blockId: block.id, ownerOrgId: block.ownerOrgId, startDate: body.startDate ?? new Date().toISOString().slice(0, 10), sharePct: String(body.sharePct), createdBy: actorUserId(actor) })
    .returning();
  if (p.status !== 'allocated') await tx.update(plots).set({ status: 'allocated', version: p.version + 1 }).where(eq(plots.id, plotId));
  await audit(tx, actor, { action: 'plot.allocated', resourceType: 'plot_allocation', resourceId: a!.id, after: { plotId, farmerId: body.farmerId, sharePct: body.sharePct } });
  await emit(tx, actor, 'plot.allocated', { type: 'plot', id: plotId }, { allocationId: a!.id, farmerId: body.farmerId, blockId: block.id });
  return allocationDto({ a: a!, fn: f.firstName, ln: f.lastName, code: f.code });
}

export async function endAllocation(db: Db, actor: ActorContext, id: string, endDate?: string) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(plotAllocations).where(eq(plotAllocations.id, id));
    if (!a) throw notFound('Allocation');
    await loadPlot(tx, actor, a.plotId, true).catch(() => {
      throw notFound('Allocation');
    });
    if (a.status !== 'active') throw conflict('INVALID_STATE_TRANSITION', 'Allocation already ended');
    const end = endDate ?? new Date().toISOString().slice(0, 10);
    if (end < a.startDate) throw unprocessable('END_BEFORE_START', 'End date is before the start date');
    await tx.update(plotAllocations).set({ status: 'ended', endDate: end, version: a.version + 1 }).where(eq(plotAllocations.id, id));
    const [left] = await tx.select({ id: plotAllocations.id }).from(plotAllocations).where(and(eq(plotAllocations.plotId, a.plotId), eq(plotAllocations.status, 'active')));
    if (!left) await tx.update(plots).set({ status: 'available' }).where(and(eq(plots.id, a.plotId), eq(plots.status, 'allocated')));
    await audit(tx, actor, { action: 'plot.allocation_ended', resourceType: 'plot_allocation', resourceId: id, after: { endDate: end } });
    await emit(tx, actor, 'plot.allocation_ended', { type: 'plot', id: a.plotId }, { allocationId: id });
    const [f] = await tx.select().from(farmers).where(eq(farmers.id, a.farmerId));
    const [after] = await tx.select().from(plotAllocations).where(eq(plotAllocations.id, id));
    return allocationDto({ a: after!, fn: f!.firstName, ln: f!.lastName, code: f!.code });
  });
}

// ---------------------------------------------------------------- land documents

const landDocDto = (d: typeof landDocuments.$inferSelect, blockName?: string) => ({
  id: d.id,
  blockId: d.blockId,
  ...(blockName ? { blockName } : {}),
  ownerOrgId: d.ownerOrgId,
  docType: d.docType,
  number: d.number,
  issuedBy: d.issuedBy,
  issueDate: d.issueDate,
  expiryDate: d.expiryDate,
  fileId: d.fileId,
  status: d.expiryDate && d.status === 'verified' && d.expiryDate < new Date().toISOString().slice(0, 10) ? ('expired' as const) : d.status,
  verifiedAt: iso(d.verifiedAt),
  comment: d.comment,
  createdAt: d.createdAt.toISOString(),
});

export async function listLandDocs(db: DbOrTx, actor: ActorContext, blockId: string) {
  await loadBlock(db, actor, blockId);
  return (await db.select().from(landDocuments).where(eq(landDocuments.blockId, blockId)).orderBy(desc(landDocuments.id))).map((d) => landDocDto(d));
}

export async function addLandDoc(db: Db, actor: ActorContext, blockId: string, body: { docType: typeof landDocuments.$inferInsert.docType; fileId: string; number?: string | null; issuedBy?: string | null; issueDate?: string | null; expiryDate?: string | null }) {
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, blockId, true);
    if (body.issueDate && body.expiryDate && body.expiryDate < body.issueDate) throw unprocessable('EXPIRY_BEFORE_ISSUE', 'Expiry date is before issue date');
    await linkFile(tx, actor, body.fileId, 'block', blockId);
    const [d] = await tx.insert(landDocuments).values({ ...body, blockId, ownerOrgId: b.ownerOrgId, createdBy: actorUserId(actor) }).returning();
    await touchDocumenting(tx, actor, b);
    await audit(tx, actor, { action: 'land_document.submitted', resourceType: 'land_document', resourceId: d!.id, after: { blockId, docType: body.docType } });
    await emit(tx, actor, 'land_document.submitted', { type: 'land_document', id: d!.id }, { blockId, docType: body.docType });
    return landDocDto(d!);
  });
}

export async function listLandDocQueue(db: Db, status: string | undefined, limit: number, cursor?: string) {
  const conds: SQL[] = [];
  if (status) conds.push(eq(landDocuments.status, status as 'submitted'));
  const c = decodeCursor(cursor);
  if (c) conds.push(lt(landDocuments.id, c.id));
  const rows = await db
    .select({ d: landDocuments, blockName: blocks.name })
    .from(landDocuments)
    .innerJoin(blocks, eq(blocks.id, landDocuments.blockId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(landDocuments.id))
    .limit(limit + 1);
  return toPage(rows.map((r) => ({ ...r, id: r.d.id })), limit, (r) => landDocDto(r.d, r.blockName));
}

export async function reviewLandDoc(db: Db, actor: ActorContext, id: string, decision: 'verify' | 'reject', comment?: string) {
  if (decision === 'reject' && !comment) throw badRequest('COMMENT_REQUIRED', 'A reason is required to reject', [{ path: 'body.comment', message: 'required' }]);
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(landDocuments).where(eq(landDocuments.id, id)).for('update');
    if (!d) throw notFound('Land document');
    if (d.status !== 'submitted') throw conflict('INVALID_STATE_TRANSITION', `Document is ${d.status}`);
    if (decision === 'verify' && d.expiryDate && d.expiryDate < new Date().toISOString().slice(0, 10)) throw unprocessable('LAND_DOC_EXPIRED', 'The document is already expired');
    const status = decision === 'verify' ? ('verified' as const) : ('rejected' as const);
    const [after] = await tx.update(landDocuments).set({ status, verifiedBy: actorUserId(actor), verifiedAt: new Date(), comment: comment ?? null, version: d.version + 1 }).where(eq(landDocuments.id, id)).returning();
    await audit(tx, actor, { action: `land_document.${status}`, resourceType: 'land_document', resourceId: id, before: { status: d.status }, after: { status, comment } });
    await emit(tx, actor, `land_document.${status}`, { type: 'land_document', id }, { blockId: d.blockId, docType: d.docType }, d.ownerOrgId);
    return landDocDto(after!);
  });
}

// ---------------------------------------------------------------- assets & grievances

const assetDto = (r: { a: typeof blockAssets.$inferSelect; loc: unknown }) => ({
  id: r.a.id,
  blockId: r.a.blockId,
  type: r.a.type,
  description: r.a.description,
  capexItemId: r.a.capexItemId,
  location: (r.loc as never) ?? null,
  commissionedAt: r.a.commissionedAt,
  createdAt: r.a.createdAt.toISOString(),
});

export async function listAssets(db: DbOrTx, actor: ActorContext, blockId: string) {
  await loadBlock(db, actor, blockId);
  return (await db.select({ a: blockAssets, loc: asGeoJson(blockAssets.location) }).from(blockAssets).where(eq(blockAssets.blockId, blockId)).orderBy(asc(blockAssets.id))).map(assetDto);
}

export async function addAsset(db: Db, actor: ActorContext, blockId: string, body: { type: typeof blockAssets.$inferInsert.type; description: string; capexItemId?: string | null; location?: unknown; commissionedAt?: string | null }) {
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, blockId, true);
    const [a] = await tx
      .insert(blockAssets)
      .values({ blockId, ownerOrgId: b.ownerOrgId, type: body.type, description: body.description, capexItemId: body.capexItemId ?? null, commissionedAt: body.commissionedAt ?? null, location: (body.location ? geomFromGeoJson(body.location) : null) as unknown as string, createdBy: actorUserId(actor) })
      .returning({ id: blockAssets.id });
    await audit(tx, actor, { action: 'block_asset.created', resourceType: 'block_asset', resourceId: a!.id, after: { blockId, type: body.type } });
    const [r] = await tx.select({ a: blockAssets, loc: asGeoJson(blockAssets.location) }).from(blockAssets).where(eq(blockAssets.id, a!.id));
    return assetDto(r!);
  });
}

const grievanceDto = (g: typeof communityGrievances.$inferSelect) => ({
  id: g.id,
  blockId: g.blockId,
  reportedAt: g.reportedAt.toISOString(),
  reporter: g.reporter,
  category: g.category,
  description: g.description,
  status: g.status,
  resolution: g.resolution,
  resolvedAt: iso(g.resolvedAt),
  version: g.version,
});

export async function listGrievances(db: DbOrTx, actor: ActorContext, blockId: string) {
  await loadBlock(db, actor, blockId);
  return (await db.select().from(communityGrievances).where(eq(communityGrievances.blockId, blockId)).orderBy(desc(communityGrievances.id))).map(grievanceDto);
}

export async function addGrievance(db: Db, actor: ActorContext, blockId: string, body: { reporter: string; category: string; description: string; reportedAt?: string }) {
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, blockId, true);
    const [g] = await tx
      .insert(communityGrievances)
      .values({ blockId, ownerOrgId: b.ownerOrgId, reporter: body.reporter, category: body.category, description: body.description, reportedAt: body.reportedAt ? new Date(body.reportedAt) : new Date(), createdBy: actorUserId(actor) })
      .returning();
    await audit(tx, actor, { action: 'grievance.created', resourceType: 'community_grievance', resourceId: g!.id, after: { blockId, category: body.category } });
    await emit(tx, actor, 'grievance.created', { type: 'block', id: blockId }, { grievanceId: g!.id });
    return grievanceDto(g!);
  });
}

export async function updateGrievance(db: Db, actor: ActorContext, id: string, expected: number, body: { status?: typeof communityGrievances.$inferInsert.status; resolution?: string | null }) {
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(communityGrievances).where(eq(communityGrievances.id, id));
    if (!g) throw notFound('Grievance');
    await loadBlock(tx, actor, g.blockId, true).catch(() => {
      throw notFound('Grievance');
    });
    assertVersion(expected, g.version);
    if ((body.status === 'resolved' || body.status === 'closed') && !(body.resolution ?? g.resolution)) throw unprocessable('RESOLUTION_REQUIRED', 'Describe the resolution');
    const resolved = body.status === 'resolved' || body.status === 'closed';
    const [after] = await tx
      .update(communityGrievances)
      .set({ ...body, resolvedAt: resolved ? (g.resolvedAt ?? new Date()) : body.status ? null : g.resolvedAt, version: g.version + 1 })
      .where(eq(communityGrievances.id, id))
      .returning();
    await audit(tx, actor, { action: 'grievance.updated', resourceType: 'community_grievance', resourceId: id, before: { status: g.status }, after: body });
    return grievanceDto(after!);
  });
}

// ---------------------------------------------------------------- map

/** GeoJSON FeatureCollection for the block map (SPEC §10.4). */
export async function blockMap(db: Db, actor: ActorContext, blockId: string) {
  const b = await blockOut(db, actor, blockId);
  const ps = await listPlots(db, actor, blockId);
  const as = await listAssets(db, actor, blockId);
  const features: { type: 'Feature'; id: string; geometry: unknown; properties: Record<string, unknown> }[] = [];
  if (b.boundary) features.push({ type: 'Feature', id: b.id, geometry: b.boundary, properties: { kind: 'boundary', name: b.name, ref: b.ref, areaHa: b.areaHa, status: b.status } });
  for (const p of ps) features.push({ type: 'Feature', id: p.id, geometry: p.geometry, properties: { kind: 'plot', code: p.code, areaHa: p.areaHa, status: p.status, farmers: p.farmers.map((f) => f.name).join(', ') } });
  for (const a of as) if (a.location) features.push({ type: 'Feature', id: a.id, geometry: a.location, properties: { kind: 'asset', type: a.type, description: a.description } });
  return { type: 'FeatureCollection' as const, features: features as never[] };
}
