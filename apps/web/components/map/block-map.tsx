'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';

export type Geo = { type: string; coordinates: unknown };
export interface MapFeature {
  type: 'Feature';
  id?: string;
  geometry: Geo | null;
  properties: Record<string, unknown>;
}

const TILE = process.env.NEXT_PUBLIC_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const STATUS_COLORS: Record<string, string> = {
  available: '#a3a3a3', allocated: '#23804a', fallow: '#d97706', excluded: '#dc2626',
  draft: '#a3a3a3', documenting: '#0284c7', ready: '#23804a', in_financing: '#7c3aed', financed: '#16a34a', active: '#15803d',
};

function bounds(features: MapFeature[]): LngLatBoundsLike | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      minX = Math.min(minX, c[0] as number); maxX = Math.max(maxX, c[0] as number);
      minY = Math.min(minY, c[1] as number); maxY = Math.max(maxY, c[1] as number);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  features.forEach((f) => f.geometry && walk(f.geometry.coordinates));
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

/**
 * MapLibre map showing a block boundary, plots (coloured by status), assets or block markers.
 * With `drawMode`, the user draws one polygon (terra-draw); `onDrawn` receives its GeoJSON.
 */
export function BlockMap({ features, drawMode = false, onDrawn, onSelect, height = 420 }: { features: MapFeature[]; drawMode?: boolean; onDrawn?: (g: { type: 'Polygon'; coordinates: number[][][] }) => void; onSelect?: (id: string) => void; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const cb = useRef({ onDrawn, onSelect });
  cb.current = { onDrawn, onSelect };

  useEffect(() => {
    if (!ref.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: ref.current,
        style: { version: 8, sources: { osm: { type: 'raster', tiles: [TILE], tileSize: 256, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
        center: [-16.27, 12.58],
        zoom: 13,
      });
    } catch {
      return; // WebGL unavailable: the tables/forms remain fully usable
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => {
      map.addSource('jappo', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'fill', type: 'fill', source: 'jappo', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['coalesce', ['get', '_color'], '#23804a'], 'fill-opacity': ['case', ['==', ['get', 'kind'], 'boundary'], 0.08, 0.35] } });
      map.addLayer({ id: 'line', type: 'line', source: 'jappo', filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]], paint: { 'line-color': ['case', ['==', ['get', 'kind'], 'boundary'], '#133f27', '#ffffff'], 'line-width': ['case', ['==', ['get', 'kind'], 'boundary'], 2.5, 1] } });
      map.addLayer({ id: 'mfill', type: 'fill', source: 'jappo', filter: ['==', ['geometry-type'], 'MultiPolygon'], paint: { 'fill-color': '#23804a', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'points', type: 'circle', source: 'jappo', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': ['coalesce', ['get', '_color'], '#0284c7'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'labels', type: 'symbol', source: 'jappo', filter: ['has', 'code'], layout: { 'text-field': ['get', 'code'], 'text-size': 11 }, paint: { 'text-color': '#111', 'text-halo-color': '#fff', 'text-halo-width': 1 } });
      for (const layer of ['fill', 'points']) {
        map.on('click', layer, (e) => {
          const id = e.features?.[0]?.properties?._id as string | undefined;
          if (id) cb.current.onSelect?.(id);
        });
      }
      map.fire('jappo:ready');
    });
    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('jappo') as GeoJSONSource | undefined;
      if (!src) return;
      const data = features.filter((f) => f.geometry).map((f) => ({ ...f, properties: { ...f.properties, _id: f.id, _color: STATUS_COLORS[String(f.properties.status)] } }));
      src.setData({ type: 'FeatureCollection', features: data } as never);
      const b = bounds(features);
      if (b) map.fitBounds(b, { padding: 40, maxZoom: 17, duration: 0 });
    };
    if (map.isStyleLoaded() && map.getSource('jappo')) apply();
    else map.once('jappo:ready' as never, apply);
  }, [features]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const start = () => {
      if (!drawMode) {
        drawRef.current?.stop();
        drawRef.current = null;
        return;
      }
      const draw = new TerraDraw({ adapter: new TerraDrawMapLibreGLAdapter({ map }), modes: [new TerraDrawPolygonMode()] });
      draw.start();
      draw.setMode('polygon');
      draw.on('finish', (id) => {
        const f = draw.getSnapshot().find((x) => x.id === id);
        if (f && f.geometry.type === 'Polygon') cb.current.onDrawn?.(f.geometry as { type: 'Polygon'; coordinates: number[][][] });
        draw.clear();
      });
      drawRef.current = draw;
    };
    if (map.isStyleLoaded()) start();
    else map.once('load', start);
    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
    };
  }, [drawMode]);

  return <div ref={ref} style={{ height }} className="w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100" data-testid="block-map" />;
}
