import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Mon espace producteur' };

export default function FarmerLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-xl bg-white">{children}</div>;
}
