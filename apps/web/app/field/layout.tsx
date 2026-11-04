import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terrain', manifest: '/manifest.webmanifest' };

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-xl bg-white">{children}</div>;
}
