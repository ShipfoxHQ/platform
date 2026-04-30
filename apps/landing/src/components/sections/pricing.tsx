'use client';

import {Button, Icon, type IconName} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
import {CtaButton} from '../cta/cta-button';
import {SectionHead} from '../shared/section-head';

export function PricingSection() {
  return (
    <section id="pricing" className="border-b-color-alpha-white-6 relative border-b py-[110px]">
      <div className="wrap">
        <SectionHead
          kicker="/deployment"
          title="Run it your way."
          description="The same engine, same YAML, same agents. Start free on your own infra, move to managed cloud when you stop wanting to wake up at 3am, or keep it all in your VPC."
        />

        <div className="grid grid-cols-3 gap-18">
          <Plan
            tag="/open-source"
            title="Open source"
            description="The core engine, fully open source. Fork it, audit it, extend it. Run on your own infrastructure."
            price={
              <>
                <PriceBig>$0</PriceBig>
                <PriceSmall>forever · MIT licensed</PriceSmall>
              </>
            }
            features={[
              'Full source code',
              'Community plugins',
              'Self-managed runners',
              'Community support',
            ]}
            actions={
              <>
                <CtaButton variant="secondary" size="md" className="w-full justify-center">
                  Get started
                </CtaButton>
                <Button
                  variant="transparent"
                  size="md"
                  iconLeft="githubFill"
                  className="w-full justify-center"
                >
                  View on GitHub
                </Button>
              </>
            }
          />
          <Plan
            featured
            tag="/cloud"
            title="Cloud"
            description="Managed control plane, runners, and inference. A predictable per-seat baseline that covers most teams, pay for overage only when usage spikes."
            customPrice={
              <div className="bg-background-subtle-base border-color-alpha-white-8 flex flex-col gap-8 rounded-8 border p-12">
                <Submodel
                  icon="userLine"
                  iconColor="text-color-primary-400"
                  title="Per developer · baseline"
                  badge={{label: 'included'}}
                  body="Each seat includes a monthly compute allocation and a pool of token-inference credits. Most teams stay within the baseline."
                />
                <Submodel
                  icon="arrowUpLine"
                  iconColor="text-color-blue-400"
                  title="Above baseline · usage"
                  badge={{
                    label: 'overage',
                    className: 'text-color-blue-400 bg-[rgba(96,165,250,.14)]',
                  }}
                  body="Heavy compute or inference workloads are billed by the minute and by the token. Set hard caps in the dashboard so spend can't surprise you."
                />
              </div>
            }
            features={[
              'Managed or self-hosted runners',
              'Managed or BYO inference',
              'Org-wide spend caps & alerts',
              'SOC 2 Type II · 99.9 % SLA',
            ]}
            actions={
              <CtaButton size="md" className="w-full justify-center">
                Get started
              </CtaButton>
            }
          />
          <Plan
            tag="/enterprise"
            title="Enterprise"
            description="Cloud or fully self-hosted. Enterprise license with SSO, RBAC, air-gapped deployments, and a dedicated CSM."
            price={
              <>
                <PriceBig>Custom</PriceBig>
                <PriceSmall>· talk to sales</PriceSmall>
              </>
            }
            features={[
              'Cloud or on-prem deployment',
              'SSO / SAML',
              'Role-based access control',
              'Air-gapped support',
              'Priority support · dedicated CSM',
            ]}
            actions={
              <>
                <CtaButton variant="secondary" size="md" className="w-full justify-center">
                  Get started
                </CtaButton>
                <Button variant="transparent" size="md" className="w-full justify-center">
                  Talk to sales →
                </Button>
              </>
            }
          />
        </div>
      </div>
    </section>
  );
}

function Plan({
  tag,
  title,
  description,
  price,
  customPrice,
  features,
  actions,
  featured,
}: {
  tag: string;
  title: string;
  description: string;
  price?: ReactNode;
  customPrice?: ReactNode;
  features: string[];
  actions: ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      className={[
        'relative flex flex-col gap-18 rounded-14 border p-28',
        featured
          ? 'bg-background-neutral-base border-[rgba(255,75,0,.4)] shadow-[0_0_0_4px_rgba(255,75,0,.06),0_30px_60px_rgba(255,75,0,.08)]'
          : 'bg-background-neutral-base border-color-alpha-white-8',
      ].join(' ')}
    >
      {featured && (
        <span className="bg-color-primary-400 text-color-neutral-1000 font-code absolute -top-10 right-24 rounded-4 px-8 py-5 text-[10px] font-semibold uppercase leading-none tracking-[.06em]">
          Most teams
        </span>
      )}
      <div className="flex flex-col gap-6">
        <span className="text-foreground-neutral-muted font-code text-xs font-medium uppercase leading-none tracking-[.06em]">
          {tag}
        </span>
        <h3 className="font-display text-foreground-neutral-base m-0 text-[22px] font-medium leading-[28px] tracking-[-0.005em]">
          {title}
        </h3>
        <div className="font-display text-foreground-neutral-subtle text-sm font-normal leading-[20px]">
          {description}
        </div>
      </div>
      {price && <div className="mt-1 flex items-baseline gap-8">{price}</div>}
      {customPrice}
      <ul className="m-0 flex list-none flex-col gap-9 p-0">
        {features.map((f) => (
          <li
            key={f}
            className="font-display text-foreground-neutral-base flex items-start gap-10 text-sm font-normal leading-[20px]"
          >
            <Icon
              name="checkboxCircleFill"
              className="text-color-primary-400 mt-3 size-13 shrink-0"
            />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-8">{actions}</div>
    </div>
  );
}

function PriceBig({children}: {children: ReactNode}) {
  return (
    <b
      className="font-display text-foreground-neutral-base text-[36px] font-medium leading-[40px] tracking-[-0.02em]"
      style={{fontFeatureSettings: '"tnum","lnum"'}}
    >
      {children}
    </b>
  );
}

function PriceSmall({children}: {children: ReactNode}) {
  return (
    <small className="text-foreground-neutral-muted font-code text-xs leading-none">
      {children}
    </small>
  );
}

function Submodel({
  icon,
  iconColor,
  title,
  badge,
  body,
}: {
  icon: IconName;
  iconColor: string;
  title: string;
  badge: {label: string; className?: string};
  body: string;
}) {
  return (
    <div className="border-t-color-alpha-white-8 first:border-t-0 first:pt-0 flex flex-col gap-4 border-t border-dashed py-8">
      <div className="font-display text-foreground-neutral-base flex items-center justify-between text-xs font-medium leading-[16px]">
        <span className="inline-flex items-center gap-6">
          <Icon name={icon} className={['size-13', iconColor].join(' ')} />
          {title}
        </span>
        <span
          className={[
            'font-code text-color-primary-400 rounded-3 bg-[rgba(255,75,0,.12)] px-6 py-2 text-[10px] font-medium leading-none',
            badge.className,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {badge.label}
        </span>
      </div>
      <div className="font-display text-foreground-neutral-muted text-[11px] font-normal leading-[16px]">
        {body}
      </div>
    </div>
  );
}
