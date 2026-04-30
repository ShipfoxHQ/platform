'use client';

import {Button, Icon} from '@shipfox/react-ui';
import {CtaButton} from '../cta/cta-button';
import {Eyebrow} from '../shared/eyebrow';
import {DagFigure} from './hero-dag-figure';

export function Hero() {
  return (
    <section
      id="hero"
      className="border-b-color-alpha-white-6 relative overflow-hidden border-b px-0 pb-100 pt-[110px]"
    >
      <div
        aria-hidden
        className="bg-grid-dots pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(900px 380px at 80% -10%, rgba(255,75,0,.18), transparent 65%),
            radial-gradient(rgba(255,255,255,.05) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 16px 16px',
        }}
      />
      <div className="wrap relative">
        <Eyebrow>Shipfox: continuous shipping platform</Eyebrow>

        <h1 className="font-display text-foreground-neutral-base mt-18 max-w-[880px] text-[76px] font-medium leading-[82px] tracking-[-0.035em]">
          Your <em className="text-color-primary-400 not-italic">software factory.</em>
        </h1>

        <p className="font-display text-foreground-neutral-subtle mt-24 max-w-[600px] text-lg font-normal leading-[30px]">
          A continuous shipping platform for engineering teams. Workflows live in your repo. Agents
          are first-class. Tickets, alerts, and PRs trigger pipelines directly, no webhook glue.
        </p>

        <div className="mt-36 flex flex-wrap items-center gap-14">
          <CtaButton size="lg">Get started</CtaButton>
          <Button variant="secondary" size="lg" iconLeft="githubFill">
            Star on GitHub
            <span className="text-foreground-neutral-muted font-code ml-6 text-xs font-normal">
              8.4k
            </span>
          </Button>
        </div>

        <div className="text-foreground-neutral-muted font-code mt-28 flex flex-wrap items-center gap-20 text-xs leading-none">
          <MetaItem>MIT licensed</MetaItem>
          <MetaSep />
          <MetaItem>Self-host or managed</MetaItem>
          <MetaSep />
          <MetaItem>Use any model</MetaItem>
          <MetaSep />
          <MetaItem>Full GitOps</MetaItem>
        </div>

        <DagFigure />
      </div>
    </section>
  );
}

function MetaItem({children}: {children: React.ReactNode}) {
  return (
    <span className="inline-flex items-center gap-6">
      <Icon name="checkboxCircleFill" className="text-color-green-400 size-14" />
      {children}
    </span>
  );
}

function MetaSep() {
  return <span className="opacity-40">·</span>;
}
