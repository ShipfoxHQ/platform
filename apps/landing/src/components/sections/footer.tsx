'use client';

import {Icon} from '@shipfox/react-ui';

const COLUMNS: {title: string; links: string[]}[] = [
  {
    title: 'Product',
    links: ['What it is', 'Integrations', 'Use cases', 'Platform', 'Pricing'],
  },
  {
    title: 'Resources',
    links: ['Docs', 'Changelog', 'Status', 'Blog', 'Security'],
  },
  {
    title: 'Company',
    links: ['About', 'Customers', 'Careers', 'Brand', 'Contact'],
  },
  {
    title: 'Legal',
    links: ['Terms', 'Privacy', 'DPA', 'SOC 2'],
  },
];

const PRODUCT_HASHES = ['#what', '#integrations', '#use-cases', '#platform', '#pricing'];

export function Footer() {
  return (
    <>
      <footer className="bg-color-neutral-1000 px-0 pb-24 pt-56">
        <div className="wrap grid gap-32" style={{gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr'}}>
          <div>
            <Icon name="shipfoxLogo" className="mb-14 h-22 w-auto" />
            <p className="font-display text-foreground-neutral-muted m-0 max-w-[280px] text-sm font-normal leading-[20px]">
              Continuous shipping for engineering teams. Open source, managed cloud, or fully
              self-hosted.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-foreground-neutral-muted font-code mb-14 text-xs font-medium uppercase leading-none tracking-[.08em]">
                {col.title}
              </h4>
              {col.links.map((link, i) => {
                const href =
                  col.title === 'Product' && PRODUCT_HASHES[i]
                    ? PRODUCT_HASHES[i]
                    : `/${link.toLowerCase().replace(/\s+/g, '-')}`;
                return (
                  <a
                    key={link}
                    href={href}
                    className="font-display text-foreground-neutral-subtle hover:text-foreground-neutral-base block py-6 text-sm font-normal leading-none no-underline"
                  >
                    {link}
                  </a>
                );
              })}
            </div>
          ))}
        </div>
      </footer>
      <div className="border-t-color-alpha-white-6 text-foreground-neutral-muted font-code border-t py-18 text-xs leading-none">
        <div className="wrap flex items-center">
          <span className="text-color-primary-400">/shipfox · 2026</span>
          <span className="mx-12 opacity-40">·</span>
          <span>region eu-west-1 · all systems operational</span>
          <div className="ml-auto flex gap-18">
            <a href="/status" className="text-foreground-neutral-muted no-underline">
              Status ↗
            </a>
            <a href="/github" className="text-foreground-neutral-muted no-underline">
              GitHub ↗
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
