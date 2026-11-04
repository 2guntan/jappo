type Ring = number[][];
type Geo = { type: string; coordinates: unknown } | null | undefined;

function rings(g: Geo): Ring[] {
  if (!g) return [];
  if (g.type === 'Polygon') return (g.coordinates as Ring[]).slice(0, 1);
  if (g.type === 'MultiPolygon') return (g.coordinates as Ring[][]).map((p) => p[0]!).filter(Boolean);
  return [];
}

/** Static block map as inline SVG (equirectangular, latitude-corrected), for PDFs. */
export function svgMap(boundary: Geo, plots: { code: string; geometry: Geo }[], width = 640, height = 360): string {
  const all = [...rings(boundary), ...plots.flatMap((p) => rings(p.geometry))].flat();
  if (!all.length) return '';
  const lats = all.map((p) => p[1]!);
  const k = Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180));
  const xs = all.map((p) => p[0]! * k);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...lats), maxY = Math.max(...lats);
  const pad = 12;
  const s = Math.min((width - 2 * pad) / (maxX - minX || 1), (height - 2 * pad) / (maxY - minY || 1));
  height = Math.min(height, Math.ceil((maxY - minY) * s + 2 * pad));
  const pt = (p: number[]) => `${(pad + (p[0]! * k - minX) * s).toFixed(1)},${(height - pad - (p[1]! - minY) * s).toFixed(1)}`;
  const path = (r: Ring) => `M${r.map(pt).join('L')}Z`;
  const centroid = (r: Ring) => [r.reduce((a, p) => a + p[0]!, 0) / r.length, r.reduce((a, p) => a + p[1]!, 0) / r.length];
  const plotSvg = plots
    .map((p) => {
      const r = rings(p.geometry)[0];
      if (!r) return '';
      const [cx, cy] = pt(centroid(r)).split(',');
      return `<path d="${path(r)}" fill="#d8f3e1" stroke="#23804a" stroke-width="1"/><text x="${cx}" y="${cy}" font-size="9" text-anchor="middle" fill="#133f27">${p.code}</text>`;
    })
    .join('');
  const b = rings(boundary).map((r) => `<path d="${path(r)}" fill="none" stroke="#133f27" stroke-width="2.5"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">${plotSvg}${b}</svg>`;
}

/** Grouped bar chart (two series) as inline SVG. */
export function svgBars(groups: { label: string; a: number; b: number }[], labels: [string, string], width = 640, height = 220): string {
  if (!groups.length) return '';
  const max = Math.max(1, ...groups.flatMap((g) => [g.a, g.b]));
  const gw = (width - 40) / groups.length;
  const bw = gw / 3;
  const y = (v: number) => height - 30 - (v / max) * (height - 50);
  const bars = groups
    .map((g, i) => {
      const x = 30 + i * gw;
      return `<rect x="${x + bw * 0.3}" y="${y(g.a)}" width="${bw}" height="${height - 30 - y(g.a)}" fill="#23804a"/><rect x="${x + bw * 1.4}" y="${y(g.b)}" width="${bw}" height="${height - 30 - y(g.b)}" fill="#d97706"/><text x="${x + gw / 2}" y="${height - 12}" font-size="9" text-anchor="middle">${g.label}</text>`;
    })
    .join('');
  const legend = `<rect x="30" y="4" width="10" height="10" fill="#23804a"/><text x="44" y="13" font-size="10">${labels[0]}</text><rect x="180" y="4" width="10" height="10" fill="#d97706"/><text x="194" y="13" font-size="10">${labels[1]}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${legend}<line x1="28" y1="${height - 30}" x2="${width}" y2="${height - 30}" stroke="#999"/>${bars}</svg>`;
}

/** Line chart of a numeric series (e.g. cumulative cash flow) as inline SVG. */
export function svgLine(values: number[], width = 640, height = 200): string {
  if (!values.length) return '';
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const sx = (i: number) => 30 + (i / Math.max(1, values.length - 1)) * (width - 40);
  const sy = (v: number) => height - 20 - ((v - min) / (max - min || 1)) * (height - 40);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><line x1="30" y1="${sy(0)}" x2="${width}" y2="${sy(0)}" stroke="#999" stroke-dasharray="3"/><path d="${d}" fill="none" stroke="#23804a" stroke-width="2"/></svg>`;
}
