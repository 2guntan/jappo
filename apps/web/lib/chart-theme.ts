/** Recharts styling shared by every chart: brand green for the primary series, ink for the secondary, amber for debt/warnings. */
export const CHART = {
  brand: '#256b46',
  ink: '#1b1a17',
  amber: '#d97706',
  muted: '#a8a399',
  grid: '#e8e5df',
  tick: '#7b766c',
  cursor: 'rgba(28, 26, 23, 0.04)',
  tooltip: { borderRadius: 8, border: '1px solid #e8e5df', boxShadow: '0 4px 12px -2px rgb(28 26 23 / 0.08)', fontSize: 12, padding: '8px 10px' } as const,
  legend: { fontSize: 12, paddingTop: 8 } as const,
} as const;
