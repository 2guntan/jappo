'use client';

import dynamic from 'next/dynamic';

/** Client-only map (MapLibre needs the browser). */
export const BlockMap = dynamic(() => import('./block-map').then((m) => m.BlockMap), {
  ssr: false,
  loading: () => <div className="h-[420px] w-full animate-pulse rounded-lg bg-neutral-100" />,
});
export type { MapFeature } from './block-map';
