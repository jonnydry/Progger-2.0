import type { Metadata } from 'next';
import { Silkscreen } from 'next/font/google';
import { SkipLink } from '@/components/skip-link';
import './globals.css';
import './night-swim.css';

const arcade = Silkscreen({
  variable: '--font-arcade',
  adjustFontFallback: false,
  weight: '400',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  icons: { icon: { url: '/favicon.png', type: 'image/png', sizes: '64x64' } },
  title: 'Progger — Find your next note',
  description:
    'Explore guitar scales, modes, chords and three-notes-per-string patterns across all 24 frets.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="preload"
          href="/fonts/maple-mono/MapleMono-Regular.ttf.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className={`${arcade.variable} antialiased`}>
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
