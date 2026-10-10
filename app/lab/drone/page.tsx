import type { Metadata } from 'next';
import { DroneLab } from '@/components/drone-lab';

export const metadata: Metadata = {
  title: 'Drone sounds — unlisted preview',
  description: 'Unlisted comparison of drone tones. Not part of the public site.',
  robots: { index: false, follow: false },
};

// Vinext fails the whole static export when any route prerenders as non-OK,
// including notFound(). Production removes this route's files after a
// successful build when VERCEL_ENV === 'production'.
export default function DronePreviewPage() {
  return <DroneLab />;
}
