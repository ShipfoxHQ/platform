import {DocsLayout} from 'fumadocs-ui/layouts/docs';
import type {ReactNode} from 'react';
import {baseOptions, ShipfoxDashboardButton} from '@/app/layout.config';
import {source} from '@/lib/source';

// Per-page metadata (title, description, and OG/Twitter images) is generated in
// [[...slug]]/page.tsx, which is the only segment that receives the real slug.

export default function Layout({children}: {children: ReactNode}) {
  return (
    <DocsLayout
      tree={source.pageTree}
      {...baseOptions}
      sidebar={{footer: <ShipfoxDashboardButton />}}
    >
      {/* @ts-ignore: fuma-docs and monorepo react versions seem to be incompatible */}
      {children}
    </DocsLayout>
  );
}
