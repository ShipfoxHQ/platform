'use client';

import {Icon} from '@shipfox/react-ui';
import {CtaButton} from '../cta/cta-button';

export function Nav() {
  return (
    <nav className="border-b-color-alpha-white-6 sticky top-0 z-50 flex h-56 items-center border-b bg-[rgba(15,15,16,.78)] backdrop-blur-md">
      <div className="wrap flex w-full items-center gap-28">
        <a href="#hero" className="flex items-center gap-8">
          <Icon name="shipfoxLogo" className="h-22 w-auto" />
        </a>
        <ul className="flex list-none gap-24 p-0 m-0">
          <li>
            <NavLink href="#what">Product</NavLink>
          </li>
          <li>
            <NavLink href="#integrations">Integrations</NavLink>
          </li>
          <li>
            <NavLink href="#use-cases">Use cases</NavLink>
          </li>
          <li>
            <NavLink href="#platform">Platform</NavLink>
          </li>
          <li>
            <NavLink href="#pricing">Pricing</NavLink>
          </li>
        </ul>
        <div className="ml-auto flex items-center gap-14">
          <a
            href="/sign-in"
            className="text-foreground-neutral-base hover:text-foreground-neutral-base text-sm font-medium leading-none no-underline"
          >
            Sign in
          </a>
          <CtaButton size="sm">Get started</CtaButton>
        </div>
      </div>
    </nav>
  );
}

function NavLink({href, children}: {href: string; children: React.ReactNode}) {
  return (
    <a
      href={href}
      className="text-foreground-neutral-subtle hover:text-foreground-neutral-base text-sm font-medium leading-none no-underline transition-colors"
    >
      {children}
    </a>
  );
}
