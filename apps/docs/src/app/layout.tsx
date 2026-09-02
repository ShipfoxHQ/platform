import '@/app/global.css';
import {RootProvider} from 'fumadocs-ui/provider/next';
import localFont from 'next/font/local';
import type {ReactNode} from 'react';
import {DocsAnalyticsTracker} from '@/app/components/docs-analytics-tracker';
import {basePath} from '@/url';

// Commit Mono is self-hosted (the same woff2 the product ships in @shipfox/react-ui)
// so code, logs, YAML, and refs render exactly as they do in the app.
const commitMono = localFont({
  src: [
    {path: '../fonts/commitmono-400-regular.woff2', weight: '400', style: 'normal'},
    {path: '../fonts/commitmono-700-regular.woff2', weight: '700', style: 'normal'},
  ],
  variable: '--font-commit-mono',
});

export default function Layout({children}: {children: ReactNode}) {
  return (
    <html lang="en" className={commitMono.variable} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <DocsAnalyticsTracker />
        {/* The search client fetches this URL as-is; Next does not apply basePath to
            it, so it must carry the /docs prefix in production (empty in dev). */}
        <RootProvider search={{options: {api: `${basePath}/api/search`}}}>{children}</RootProvider>
      </body>
    </html>
  );
}
