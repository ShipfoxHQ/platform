'use client';

import {Icon, type IconName} from '@shipfox/react-ui';
import {SectionHead} from '../shared/section-head';

type Pillar = {
  num: string;
  icon: IconName;
  title: string;
  body: React.ReactNode;
};

const PILLARS: Pillar[] = [
  {
    num: '01',
    icon: 'gitRepositoryLine',
    title: 'Lives in your repo',
    body: (
      <>
        Workflows are YAML files in <Code>.shipfox/</Code>. Version-controlled, reviewable,
        auditable. No separate platform to configure.
      </>
    ),
  },
  {
    num: '02',
    icon: 'robot2Line',
    title: 'Agents are first-class',
    body: (
      <>
        Define reusable agents with a model, tools, MCP servers, system prompt, and structured
        output schema. Reuse the <Code>CLAUDE.md</Code> / <Code>AGENTS.md</Code> and Claude skills
        already in your repo; agents pick them up automatically.
      </>
    ),
  },
  {
    num: '03',
    icon: 'flowChart',
    title: 'Jobs form a pipeline',
    body: (
      <>
        Each job runs in its own VM with your code checked out; isolated, reproducible, parallel by
        default. Compose them into arbitrarily complex graphs: fan-out, fan-in, branches, loops,
        matrices, event-driven waits.
      </>
    ),
  },
  {
    num: '04',
    icon: 'plugLine',
    title: 'Starts from your tools',
    body: (
      <>
        A Sentry alert, a Linear ticket, a GitHub push, a Slack message, a cron schedule, a raw
        webhook. Every integration is a native trigger, not glue code.
      </>
    ),
  },
];

export function WhatSection() {
  return (
    <section id="what" className="border-b-color-alpha-white-6 relative border-b py-[110px]">
      <div className="wrap">
        <SectionHead
          kicker="/how-it-works"
          title="A workflow engine that lives in your codebase."
          description={
            <>
              Shipfox is a GitOps workflow orchestration engine for engineering teams. Define
              workflows and agents in YAML under{' '}
              <code className="text-color-primary-400 font-code">.shipfox/</code>. They're versioned
              with your code, reviewed in PRs, and snapshotted at every trigger. If you've written a
              CI pipeline, you already know how this works.
            </>
          }
        />

        <div className="grid gap-x-56 items-start" style={{gridTemplateColumns: '1.1fr 1fr'}}>
          <div className="grid grid-cols-2 gap-16">
            {PILLARS.map((p) => (
              <PillarCard key={p.num} {...p} />
            ))}
          </div>
          <FileTreeCard />
        </div>
      </div>
    </section>
  );
}

function PillarCard({num, icon, title, body}: Pillar) {
  return (
    <div className="bg-background-neutral-base border-color-alpha-white-8 hover:border-color-alpha-white-16 flex min-h-[200px] flex-col gap-10 rounded-12 border p-22 transition-colors">
      <span className="text-color-primary-400 font-code text-xs font-medium leading-none tracking-[.06em]">
        {num}
      </span>
      <div className="text-color-primary-400 mb-4 flex size-34 items-center justify-center rounded-8 bg-[rgba(255,75,0,.10)]">
        <Icon name={icon} className="size-18" />
      </div>
      <h3 className="font-display text-foreground-neutral-base text-lg font-medium leading-[24px] tracking-[-0.005em] m-0">
        {title}
      </h3>
      <p className="font-display text-foreground-neutral-subtle m-0 text-sm font-normal leading-[21px]">
        {body}
      </p>
    </div>
  );
}

function Code({children}: {children: React.ReactNode}) {
  return <code className="text-color-primary-400 font-code">{children}</code>;
}

function FileTreeCard() {
  return (
    <div className="bg-background-neutral-base border-color-alpha-white-8 sticky top-80 overflow-hidden rounded-12 border shadow-[0_20px_60px_rgba(0,0,0,.4)]">
      <div className="border-b-color-alpha-white-6 text-foreground-neutral-muted font-code flex h-34 items-center gap-8 border-b bg-[rgba(255,255,255,.02)] px-14 text-[11px] leading-none">
        <span className="bg-color-neutral-700 size-9 rounded-full" />
        <span className="bg-color-neutral-700 size-9 rounded-full" />
        <span className="bg-color-neutral-700 size-9 rounded-full" />
        <span className="ml-8">
          your-repo/<span className="text-color-primary-400">.shipfox/</span>
        </span>
      </div>
      <div className="text-foreground-neutral-subtle font-code px-18 py-16 text-sm leading-[24px]">
        <pre className="font-code m-0 leading-[24px]">
          <span className="text-color-primary-400">.shipfox/</span>
          {'\n'}
          <Tree>├──</Tree> <span className="text-color-primary-400">workflows/</span>
          {'\n'}
          <Tree>│ ├──</Tree> <File>triage-sentry</File>
          <Yml>.yml</Yml>
          {'\n'}
          <Tree>│ ├──</Tree> <File>review-pr</File>
          <Yml>.yml</Yml>
          {'\n'}
          <Tree>│ ├──</Tree> <File>plan-and-build</File>
          <Yml>.yml</Yml>
          {'\n'}
          <Tree>│ └──</Tree> <File>best-of-n</File>
          <Yml>.yml</Yml>
          {'\n'}
          <Tree>└──</Tree> <span className="text-color-primary-400">agents/</span>
          {'\n'}
          <Tree> ├──</Tree> <Agent>coder</Agent>
          <Yml>.yml</Yml>
          {'\n'}
          <Tree> ├──</Tree> <Agent>reviewer</Agent>
          <Yml>.yml</Yml>
          {'\n'}
          <Tree> ├──</Tree> <Agent>planner</Agent>
          <Yml>.yml</Yml>
          {'\n'}
          <Tree> └──</Tree> <Agent>diagnostician</Agent>
          <Yml>.yml</Yml>
        </pre>
        <div className="border-t-color-alpha-white-6 text-foreground-neutral-muted font-code mt-18 flex items-center gap-10 border-t pt-14 text-[11px] leading-[16px]">
          <Icon name="gitCommitLine" className="text-color-primary-400 size-12" />
          <span>versioned, reviewed in PRs</span>
        </div>
      </div>
    </div>
  );
}

function Tree({children}: {children: React.ReactNode}) {
  return <span className="text-foreground-neutral-muted">{children}</span>;
}
function File({children}: {children: React.ReactNode}) {
  return <span className="text-foreground-neutral-base">{children}</span>;
}
function Yml({children}: {children: React.ReactNode}) {
  return <span className="text-foreground-neutral-muted">{children}</span>;
}
function Agent({children}: {children: React.ReactNode}) {
  return <span className="text-color-purple-400">{children}</span>;
}
