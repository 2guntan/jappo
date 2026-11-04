import { z } from 'zod';

const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).rest(z.number());
const Ring = z.array(Position).min(4);
export const GeoPoint = z.object({ type: z.literal('Point'), coordinates: Position }).meta({ id: 'GeoPoint' });
export const GeoPolygon = z.object({ type: z.literal('Polygon'), coordinates: z.array(Ring).min(1) }).meta({ id: 'GeoPolygon' });
export const GeoMultiPolygon = z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(Ring).min(1)).min(1) }).meta({ id: 'GeoMultiPolygon' });
export const GeoArea = z.union([GeoPolygon, GeoMultiPolygon]);
export type GeoPolygon = z.infer<typeof GeoPolygon>;
export type GeoArea = z.infer<typeof GeoArea>;

export const Feature = z.object({
  type: z.literal('Feature'),
  id: z.string().optional(),
  geometry: z.union([GeoPoint, GeoPolygon, GeoMultiPolygon]).nullable(),
  properties: z.record(z.string(), z.unknown()),
});
export const FeatureCollection = z.object({ type: z.literal('FeatureCollection'), features: z.array(Feature) }).meta({ id: 'FeatureCollection' });
