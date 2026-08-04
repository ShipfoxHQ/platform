import type {BaseLayoutProps} from 'fumadocs-ui/layouts/shared';
import {basePath} from '@/url';

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  githubUrl: 'https://github.com/ShipfoxHQ/shipfox',
  nav: {
    title: (
      <div className="flex items-center px-row">
        <picture className="dark:hidden">
          <img src={`${basePath}/logo-light.svg`} alt="Shipfox" className="max-h-6" />
        </picture>
        <picture className="hidden dark:block">
          <img src={`${basePath}/logo.svg`} alt="Shipfox" className="max-h-6" />
        </picture>
      </div>
    ),
    url: 'https://www.shipfox.io',
  },
  themeSwitch: {enabled: true},
};
