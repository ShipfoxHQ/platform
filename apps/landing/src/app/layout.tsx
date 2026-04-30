import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {Providers} from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Shipfox — Your software factory',
  description:
    'A continuous shipping platform for engineering teams. Workflows live in your repo. Agents are first-class.',
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="bg-color-neutral-1000 text-foreground-neutral-base font-display antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
