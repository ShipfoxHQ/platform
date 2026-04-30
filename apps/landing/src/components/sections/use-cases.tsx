'use client';

import {Icon, type IconName} from '@shipfox/react-ui';
import {type ReactNode, useState} from 'react';
import {CtaButton} from '../cta/cta-button';
import {SectionHead} from '../shared/section-head';
import {UseCaseTimeline} from './use-cases-timeline';

type Chip = {icon: IconName; iconColor: string; label: string};

type Panel = {
  num: string;
  kicker: string;
  tab: string;
  title: ReactNode;
  body: ReactNode;
  chips: Chip[];
  yaml: ReactNode;
  yamlFile: string;
  extra?: ReactNode;
};

const PANELS: Panel[] = [
  {
    num: '01',
    kicker: 'auto-triage and fix',
    tab: 'Auto-triage & fix',
    title: 'Sentry alert → triage → fix or escalate.',
    body: 'A Sentry issue fires the workflow. A diagnostician agent analyzes the error and decides: auto-fixable or needs a human? The fix path writes a patch, runs tests, and opens a PR. The escalate path pages oncall with full context.',
    chips: [
      {icon: 'timeLine', iconColor: 'text-color-primary-400', label: '~12s end-to-end'},
      {icon: 'flowChart', iconColor: 'text-color-purple-400', label: 'branch on agent output'},
    ],
    yamlFile: 'triage-sentry.yml',
    yaml: (
      <pre className="font-code text-foreground-neutral-base m-0 flex-1 overflow-auto px-20 py-18 text-[12.5px] leading-[22px]">
        <Tk>triggers</Tk>:{'\n  - '}
        <Hover tip="Pipeline starts from a Sentry webhook, not a git event">
          <Tk>source</Tk>: <Ta>sentry</Ta>
        </Hover>
        {'\n    '}
        <Tk>event</Tk>: <Ts>new_issue</Ts>
        {'\n\n'}
        <Tk>jobs</Tk>:{'\n  '}
        <Tv>triage</Tv>:{'\n    '}
        <Hover tip="Reusable agent defined in .shipfox/agents/diagnostician.yml">
          <Tk>agent</Tk>: <Ta>diagnostician</Ta>
        </Hover>
        {'\n    '}
        <Tk>output</Tk>:{'\n      '}
        <Hover tip="Structured output drives the branch — no hardcoded rules">
          <Tk>action</Tk>: <Ts>enum(fix, escalate)</Ts>
        </Hover>
        {'\n\n  '}
        <Tv>route</Tv>:{'\n    '}
        <Tk>needs</Tk>: <Ta>triage</Ta>
        {'\n    '}
        <Hover tip="Agent output decides the path: auto-fix ships a PR; escalate pages oncall">
          <Tk>branch</Tk>:
        </Hover>
        {'\n      '}
        <Tk>fix</Tk>:{'      '}
        <Ts>coder → pytest → gh pr create</Ts>
        {'\n      '}
        <Tk>escalate</Tk>: <Ts>page #oncall with context</Ts>
      </pre>
    ),
  },
  {
    num: '02',
    kicker: 'adversarial code review',
    tab: 'Adversarial review',
    title: 'Coder vs. reviewer. Until approved.',
    body: 'A producer agent writes a fix. Ordered gates verify it: first tests, then a reviewer agent. If anything fails, the producer gets the feedback and tries again. Sessions persist across rounds so the reviewer remembers what it already flagged.',
    chips: [
      {icon: 'loopLeftLine', iconColor: 'text-color-primary-400', label: 'max 3 rounds'},
      {icon: 'historyLine', iconColor: 'text-color-purple-400', label: 'persistent sessions'},
    ],
    yamlFile: 'review-pr.yml',
    yaml: (
      <pre className="font-code text-foreground-neutral-base m-0 flex-1 overflow-auto px-20 py-18 text-[12.5px] leading-[22px]">
        <Tk>loop</Tk>:{'\n  '}
        <Hover tip="Producer retries up to 3 times before the loop fails out">
          <Tk>max_rounds</Tk>: <Tn>3</Tn>
        </Hover>
        {'\n  '}
        <Tk>producer</Tk>:{'\n    '}
        <Tk>agent</Tk>: <Ta>coder</Ta>
        {'\n    '}
        <Hover tip="The coder keeps its full conversation history across rounds">
          <Tk>session</Tk>: <Ts>persistent</Ts>
        </Hover>
        {'\n  '}
        <Tk>gates</Tk>:{'\n    - '}
        <Tk>type</Tk>: <Ts>shell</Ts>
        {'\n      '}
        <Hover tip="First gate: tests must pass before reaching the reviewer">
          <Tk>run</Tk>:{'  '}
          <Ts>pytest tests/ -x</Ts>
        </Hover>
        {'\n    - '}
        <Tk>type</Tk>: <Ts>agent</Ts>
        {'\n      '}
        <Tk>agent</Tk>: <Ta>reviewer</Ta>
        {'\n      '}
        <Hover tip="The reviewer remembers round 1 when reviewing round 2">
          <Tk>session</Tk>: <Ts>persistent</Ts>
        </Hover>
        {'\n      '}
        <Hover tip="Loop exits only when the reviewer outputs verdict == approve">
          <Tk>approve_when</Tk>: <Ts>verdict == "approve"</Ts>
        </Hover>
      </pre>
    ),
  },
  {
    num: '03',
    kicker: 'ticket to plan to production',
    tab: 'Plan & build over days',
    title: 'Linear ticket → plan → human review → ship.',
    body: (
      <>
        A Linear ticket assigned to{' '}
        <code className="text-color-primary-400 font-code">@shipfox</code> triggers a planner agent
        that posts a proposed plan as a GitHub issue. The workflow then sleeps, releasing its
        runner. When a human comments, it wakes, revises the plan, and sleeps again. When the
        reviewer comments <code className="text-color-green-400 font-code">/approve</code>,
        implementation begins with full context. A pipeline that runs over days, not minutes.
      </>
    ),
    chips: [
      {icon: 'pauseCircleLine', iconColor: 'text-color-primary-400', label: 'wakes on comments'},
      {icon: 'calendarLine', iconColor: 'text-color-purple-400', label: 'runs over days'},
    ],
    yamlFile: 'plan-and-build.yml',
    yaml: (
      <pre className="font-code text-foreground-neutral-base m-0 flex-1 overflow-auto px-20 py-18 text-[12.5px] leading-[22px]">
        <Tk>jobs</Tk>:{'\n  '}
        <Tv>review-plan</Tv>:{'\n    '}
        <Tk>on</Tk>:{'\n      '}
        <Tk>events</Tk>:{'\n        - '}
        <Tk>source</Tk>: <Ta>github</Ta>
        {'\n          '}
        <Hover tip="Job wakes each time a comment is posted on the GitHub issue">
          <Tk>event</Tk>: <Ts>issue.comment</Ts>
        </Hover>
        {'\n      '}
        <Hover tip="The loop ends when a reviewer posts /approve">
          <Tk>until</Tk>: <Ts>event.body contains "/approve"</Ts>
        </Hover>
        {'\n      '}
        <Hover tip="Rapid comments are batched into a single wake-up">
          <Tk>debounce</Tk>: <Ts>5m</Ts>
        </Hover>
        {'\n    '}
        <Tk>agent</Tk>: <Ta>planner</Ta>
        {'\n    '}
        <Hover tip="Planner keeps full context across every wake-up, even days apart">
          <Tk>session</Tk>: <Ts>persistent</Ts>
        </Hover>
        {'\n    '}
        <Hover tip="Inherits the original plan conversation; no context lost">
          <Tk>inherit_session</Tk>: <Ts>create-plan.planner</Ts>
        </Hover>
      </pre>
    ),
    extra: <UseCaseTimeline />,
  },
  {
    num: '04',
    kicker: 'multi-model best-of-N',
    tab: 'Best-of-N',
    title: '3 models. 3 patches. 1 winner.',
    body: 'The same bug sent to three different LLMs in parallel. Each gets its own copy-on-write worktree, so there are no conflicts. A reviewer agent compares all patches and picks the best one.',
    chips: [
      {icon: 'gridLine', iconColor: 'text-color-primary-400', label: 'matrix execution'},
      {icon: 'gitBranchLine', iconColor: 'text-color-purple-400', label: 'COW worktrees'},
    ],
    yamlFile: 'best-of-n.yml',
    yaml: (
      <pre className="font-code text-foreground-neutral-base m-0 flex-1 overflow-auto px-20 py-18 text-[12.5px] leading-[22px]">
        <Tk>jobs</Tk>:{'\n  '}
        <Tv>race</Tv>:{'\n    '}
        <Tk>matrix</Tk>:{'\n      '}
        <Tk>each</Tk>: <Ts>model</Ts>
        {'\n      '}
        <Hover tip="Matrix iterates over models, not numbers — same prompt, different reasoning">
          <Tk>in</Tk>: <Ts>[opus-4.7, gpt-5.4, qwen3.6-max]</Ts>
        </Hover>
        {'\n    '}
        <Tk>concurrency</Tk>: <Tn>3</Tn>
        {'\n    '}
        <Hover tip="Each model gets a COW snapshot — 3 independent repos, zero conflicts">
          <Tk>isolation</Tk>: <Ts>worktree</Ts>
        </Hover>
        {'\n    '}
        <Tk>agent</Tk>: <Ta>coder</Ta>
        {'\n    '}
        <Hover tip="Model is injected from the matrix; swap providers without rewriting">
          <Tk>model</Tk>: <Ts>{'"{{ matrix.model }}"'}</Ts>
        </Hover>
        {'\n\n  '}
        <Tv>judge</Tv>:{'\n    '}
        <Tk>needs</Tk>: <Ta>race</Ta>
        {'\n    '}
        <Hover tip="Reviewer compares all patches side-by-side and picks the winner">
          <Tk>agent</Tk>: <Ta>reviewer</Ta>
        </Hover>
        {'\n    '}
        <Tk>prompt</Tk>: <Ts>Pick the best patch.</Ts>
      </pre>
    ),
  },
];

export function UseCasesSection() {
  const [active, setActive] = useState(0);

  return (
    <section id="use-cases" className="border-b-color-alpha-white-6 relative border-b py-[110px]">
      <div className="wrap">
        <SectionHead
          kicker="/use-cases"
          title="From alert to PR. From ticket to production."
          description="Four patterns that cover most of what engineering teams automate. Each one is a single YAML file in your repo. Hover any highlighted line to see what it does."
        />

        <div
          role="tablist"
          className="border-b-color-alpha-white-8 mb-22 flex flex-wrap gap-8 border-b"
        >
          {PANELS.map((p, i) => (
            <button
              key={p.num}
              role="tab"
              type="button"
              aria-selected={active === i}
              onClick={() => setActive(i)}
              className={[
                'font-display relative -mb-px inline-flex cursor-pointer items-center gap-10 rounded-t-8 border border-transparent border-b-0 px-18 pb-14 pt-12 text-sm font-medium leading-none transition-colors',
                active === i
                  ? 'bg-background-neutral-base border-color-alpha-white-8 text-foreground-neutral-base'
                  : 'text-foreground-neutral-muted hover:bg-color-alpha-white-2 hover:text-foreground-neutral-subtle',
              ].join(' ')}
              style={active === i ? {borderBottomColor: 'var(--color-neutral-900)'} : undefined}
            >
              {active === i && (
                <span
                  aria-hidden
                  className="bg-color-primary-400 absolute inset-x-0 top-0 h-[2px] rounded-t-2"
                />
              )}
              <span
                className={[
                  'font-code text-[11px] font-medium leading-none',
                  active === i ? 'text-color-primary-400' : 'text-foreground-neutral-muted',
                ].join(' ')}
              >
                {p.num}
              </span>
              {p.tab}
            </button>
          ))}
        </div>

        <div className="relative overflow-hidden rounded-14">
          <div
            className="flex transition-transform duration-[420ms]"
            style={{
              transform: `translateX(${-active * 100}%)`,
              transitionTimingFunction: 'cubic-bezier(.6,.05,.2,1)',
              willChange: 'transform',
            }}
          >
            {PANELS.map((p) => (
              <div key={p.num} role="tabpanel" className="min-w-0 shrink-0 grow-0 basis-full">
                <UseCaseCard panel={p} />
                {p.extra}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-32 flex justify-center">
          <CtaButton size="lg">Get started</CtaButton>
        </div>
      </div>
    </section>
  );
}

function UseCaseCard({panel}: {panel: Panel}) {
  return (
    <div
      className="bg-background-neutral-base border-color-alpha-white-8 grid overflow-hidden rounded-14 border"
      style={{gridTemplateColumns: '1fr 1.2fr'}}
    >
      <div className="flex flex-col justify-center gap-14 px-36 py-32">
        <div className="flex items-center gap-10">
          <span className="text-color-primary-400 font-code flex size-24 items-center justify-center rounded-6 bg-[rgba(255,75,0,.14)] text-[11px] font-semibold leading-none">
            {panel.num}
          </span>
          <span className="text-color-primary-400 font-code text-xs font-medium uppercase leading-none tracking-[.08em]">
            {panel.kicker}
          </span>
        </div>
        <h3 className="font-display text-foreground-neutral-base text-2xl font-medium leading-[32px] tracking-[-0.015em] m-0">
          {panel.title}
        </h3>
        <p className="font-display text-foreground-neutral-subtle text-md font-normal leading-[24px] m-0">
          {panel.body}
        </p>
        <div className="mt-6 flex flex-wrap gap-8">
          {panel.chips.map((c) => (
            <span
              key={c.label}
              className="bg-background-subtle-base border-color-alpha-white-8 text-foreground-neutral-base font-code inline-flex items-center gap-6 rounded-6 border px-10 py-5 text-xs font-medium leading-none"
            >
              <Icon name={c.icon} className={['size-13', c.iconColor].join(' ')} />
              {c.label}
            </span>
          ))}
        </div>
      </div>
      <div className="bg-background-subtle-base border-l-color-alpha-white-6 relative min-h-[380px] border-l">
        <div className="flex h-full flex-col">
          <div className="border-b-color-alpha-white-6 text-foreground-neutral-muted font-code flex h-32 items-center gap-8 border-b bg-[rgba(255,255,255,.02)] px-14 text-[11px] leading-none">
            <span className="bg-color-neutral-700 size-9 rounded-full" />
            <Icon name="fileTextLine" className="text-color-primary-400 size-13" />
            {panel.yamlFile}
            <span className="text-foreground-neutral-muted ml-auto inline-flex items-center gap-4">
              <Icon name="eyeLine" className="size-13" />
              hover lines
            </span>
          </div>
          {panel.yaml}
        </div>
      </div>
    </div>
  );
}

function Hover({tip, children}: {tip: string; children: ReactNode}) {
  return (
    <span className="yaml-hover" data-tip={tip}>
      {children}
    </span>
  );
}
function Tk({children}: {children: ReactNode}) {
  return <span className="yaml-token-k">{children}</span>;
}
function Ts({children}: {children: ReactNode}) {
  return <span className="yaml-token-s">{children}</span>;
}
function Ta({children}: {children: ReactNode}) {
  return <span className="yaml-token-a">{children}</span>;
}
function Tv({children}: {children: ReactNode}) {
  return <span className="yaml-token-v">{children}</span>;
}
function Tn({children}: {children: ReactNode}) {
  return <span className="yaml-token-n">{children}</span>;
}
