'use client';

import {Icon, type IconName} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
import {SectionHead} from '../shared/section-head';

type Chip = {label: string; icon?: IconName; iconColor?: string; swatch?: string};
type Group = {label: string; chips: Chip[]};

const IN_GROUPS: Group[] = [
  {
    label: 'Source control',
    chips: [
      {label: 'GitHub', icon: 'githubFill'},
      {label: 'GitLab', icon: 'gitlabFill', iconColor: 'text-color-orange-400'},
      {label: 'Bitbucket', icon: 'bitCoinLine', iconColor: 'text-color-blue-400'},
    ],
  },
  {
    label: 'Ticketing',
    chips: [
      {label: 'Linear', swatch: '#5e6ad2'},
      {label: 'Jira', swatch: '#0052cc'},
      {label: 'Asana', swatch: '#f06a6a'},
      {label: 'Shortcut', swatch: '#ce415e'},
    ],
  },
  {
    label: 'Alerting & monitoring',
    chips: [
      {label: 'Sentry', swatch: '#7c3aed'},
      {label: 'Datadog', swatch: '#632ca6'},
      {label: 'PagerDuty', swatch: '#06ac38'},
      {label: 'OpsGenie', swatch: '#172d72'},
    ],
  },
  {
    label: 'Comms',
    chips: [
      {label: 'Slack', icon: 'slackFill', iconColor: 'text-color-purple-400'},
      {label: 'Teams', icon: 'microsoftLine', iconColor: 'text-color-blue-400'},
      {label: 'Discord', icon: 'discordFill', iconColor: 'text-color-blue-400'},
    ],
  },
  {
    label: 'Generic',
    chips: [
      {label: 'Webhook', icon: 'link'},
      {label: 'Cron', icon: 'timeLine'},
    ],
  },
];

const OUT_GROUPS: {label: string; chips: {icon: IconName; label: string}[]}[] = [
  {
    label: 'Code changes',
    chips: [
      {icon: 'gitPullRequestLine', label: 'Open a pull request'},
      {icon: 'gitMergeLine', label: 'Merge when checks pass'},
    ],
  },
  {
    label: 'Tickets',
    chips: [
      {icon: 'addCircleLine', label: 'Create a ticket'},
      {icon: 'editLine', label: 'Comment on a ticket'},
      {icon: 'checkboxCircleLine', label: 'Update status'},
    ],
  },
  {
    label: 'Communication',
    chips: [
      {icon: 'chat3Line', label: 'Send a message'},
      {icon: 'notification3Line', label: 'Page oncall'},
    ],
  },
  {
    label: 'Deploy',
    chips: [
      {icon: 'rocket2Line', label: 'Trigger a deploy'},
      {icon: 'arrowGoBackLine', label: 'Roll back'},
    ],
  },
  {
    label: 'Anything else',
    chips: [
      {icon: 'plugLine', label: 'MCP servers'},
      {icon: 'toolsLine', label: 'Skills'},
      {icon: 'terminalBoxLine', label: 'CLI tools'},
    ],
  },
];

export function IntegrationsSection() {
  return (
    <section
      id="integrations"
      className="border-b-color-alpha-white-6 relative border-b py-[110px]"
    >
      <div className="wrap">
        <SectionHead
          kicker="/integrations"
          title="Plugs into the tools your team already ships with."
          description="Tickets in, pull requests out. Sentry alerts in, fixes out. Every integration is a first-class trigger or a tool an agent can call."
        />

        <div
          className="mt-32 grid items-stretch gap-24"
          style={{gridTemplateColumns: '1fr 280px 1fr'}}
        >
          <div className="flex flex-col gap-14">
            {IN_GROUPS.map((g) => (
              <IntegGroup key={g.label} label={g.label} arrowColor="text-color-primary-400">
                {g.chips.map((c) => (
                  <ChipIn key={c.label} chip={c} />
                ))}
              </IntegGroup>
            ))}
          </div>

          <Engine />

          <div className="flex flex-col gap-14">
            {OUT_GROUPS.map((g) => (
              <IntegGroup
                key={g.label}
                label={g.label}
                arrowColor="text-color-green-400"
                borderColor="border-[rgba(52,211,153,.2)]"
                labelColor="text-color-green-400"
              >
                {g.chips.map((c) => (
                  <ChipOut key={c.label} icon={c.icon} label={c.label} />
                ))}
              </IntegGroup>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function IntegGroup({
  label,
  arrowColor,
  labelColor = 'text-foreground-neutral-muted',
  borderColor = 'border-color-alpha-white-8',
  children,
}: {
  label: string;
  arrowColor: string;
  labelColor?: string;
  borderColor?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={['bg-background-neutral-base rounded-10 border px-16 py-14', borderColor].join(
        ' ',
      )}
    >
      <div
        className={[
          'font-code mb-10 flex items-center gap-6 text-[10px] font-medium uppercase leading-none tracking-[.08em]',
          labelColor,
        ].join(' ')}
      >
        <Icon name="arrowRightLine" className={['size-12', arrowColor].join(' ')} />
        {label}
      </div>
      <div className="flex flex-wrap gap-6">{children}</div>
    </div>
  );
}

function ChipIn({chip}: {chip: Chip}) {
  return (
    <span className="bg-background-subtle-base border-color-alpha-white-8 text-foreground-neutral-base font-code inline-flex items-center gap-6 rounded-6 border px-10 py-5 text-xs font-medium leading-none">
      {chip.icon && <Icon name={chip.icon} className={['size-13', chip.iconColor].join(' ')} />}
      {chip.swatch && (
        <span className="size-8 rounded-2" style={{background: chip.swatch}} aria-hidden />
      )}
      {chip.label}
    </span>
  );
}

function ChipOut({icon, label}: {icon: IconName; label: string}) {
  return (
    <span className="border-[rgba(52,211,153,.2)] text-foreground-neutral-base font-code inline-flex items-center gap-6 rounded-6 border bg-[rgba(52,211,153,.06)] px-10 py-5 text-xs font-medium leading-none">
      <Icon name={icon} className="text-color-green-400 size-13" />
      {label}
    </span>
  );
}

function Engine() {
  return (
    <div className="relative flex flex-col items-center justify-center rounded-14 border border-[rgba(255,75,0,.4)] bg-gradient-to-b from-[rgba(255,75,0,.14)] to-[rgba(255,75,0,.04)] px-24 py-32 text-center shadow-[0_0_0_1px_rgba(255,75,0,.1),0_30px_80px_rgba(255,75,0,.08)]">
      <Icon name="shipfoxLogo" className="size-56" />
      <h4 className="font-display text-foreground-neutral-base mb-1 mt-14 text-lg font-medium leading-[24px] tracking-[-0.01em]">
        Shipfox engine
      </h4>
      <div className="text-foreground-neutral-subtle font-code text-xs leading-[18px]">
        User defined pipelines
      </div>
      <svg
        width="100%"
        height="56"
        viewBox="0 0 240 56"
        className="mt-18"
        role="img"
        aria-labelledby="engine-conn-title"
      >
        <title id="engine-conn-title">Engine connector dots</title>
        <g stroke="rgba(255,75,0,.45)" strokeDasharray="2 4">
          <line x1="0" y1="14" x2="240" y2="14" />
          <line x1="0" y1="28" x2="240" y2="28" />
          <line x1="0" y1="42" x2="240" y2="42" />
        </g>
        <g fill="var(--color-primary-400)">
          <circle cx="120" cy="14" r="3" />
          <circle cx="120" cy="28" r="3" />
          <circle cx="120" cy="42" r="3" />
        </g>
      </svg>
    </div>
  );
}
