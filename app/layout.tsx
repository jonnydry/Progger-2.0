import type { Metadata } from 'next';
import { Silkscreen } from 'next/font/google';
import { SkipLink } from '@/components/skip-link';
import './globals.css';
import './night-swim.css';
import './day-swim.css';
import './theme-transition.css';
import './scene-palettes.css';
import './scene-art.css';
import './scene-picker.css';
import './voicing-audition.css';
import './drone-controls.css';
import './practice-view.css';
import './reference-panels.css';
import './connected-neck.css';
import './match-welcome.css';
import { chunkReloadBootstrap } from '@/lib/chunk-reload';
import { themeBootstrap } from '@/lib/theme';

const arcade = Silkscreen({
  variable: '--font-arcade',
  adjustFontFallback: false,
  weight: '400',
  subsets: ['latin'],
});

export const metadata: Metadata = {
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
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <script dangerouslySetInnerHTML={{ __html: chunkReloadBootstrap }} />
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
