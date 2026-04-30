'use client';

import {SectionHead} from '../shared/section-head';

const STEPS = [
  {
    num: '1',
    title: 'Review',
    badge: 'automatic',
    body: 'After every run, the system reviews what worked, what failed, what was slow, and what cost too much. No manual triage required.',
  },
  {
    num: '2',
    title: 'Suggest',
    badge: 'opens PRs',
    body: 'It proposes concrete changes: better prompts, tighter output schemas, missing edge cases in your YAML, or fixes directly in the codebase. Changes are submitted as PRs you review like anything else.',
  },
  {
    num: '3',
    title: 'Remember',
    badge: 'project memory',
    body: 'Patterns, past failures, conventions, and decisions accumulate into a shared project memory that every agent in every workflow can read. The tenth workflow is cheaper and faster than the first.',
  },
];

export function SelfImprovementSection() {
  return (
    <section
      id="self-improvement"
      className="border-b-color-alpha-white-6 relative border-b py-[110px]"
    >
      <div className="wrap">
        <SectionHead
          kicker="/self-improvement"
          title="Every run makes the next one better."
          description="Workflows aren't write-once. After every execution, Shipfox reflects on what happened, drafts changes, and accumulates a project memory that all your agents share."
        />

        <div className="grid items-center gap-56" style={{gridTemplateColumns: '1fr 460px'}}>
          <div className="flex flex-col gap-16">
            {STEPS.map((s) => (
              <div
                key={s.num}
                className="bg-background-neutral-base border-color-alpha-white-8 hover:border-[rgba(255,75,0,.3)] grid gap-16 rounded-12 border px-22 py-18 transition-colors"
                style={{gridTemplateColumns: '36px 1fr'}}
              >
                <div className="text-color-primary-400 font-code flex size-36 items-center justify-center rounded-8 border border-[rgba(255,75,0,.28)] bg-[rgba(255,75,0,.12)] text-md font-medium leading-none">
                  {s.num}
                </div>
                <div>
                  <h3 className="font-display text-foreground-neutral-base m-0 flex items-center gap-10 text-lg font-medium leading-[22px]">
                    {s.title}
                    <span className="bg-background-subtle-base border-color-alpha-white-8 text-foreground-neutral-muted font-code rounded-4 border px-6 py-3 text-[10px] font-medium uppercase leading-none tracking-[.06em]">
                      {s.badge}
                    </span>
                  </h3>
                  <p className="font-display text-foreground-neutral-subtle mt-6 text-sm font-normal leading-[21px] m-0">
                    {s.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <FlowSvg />
        </div>
      </div>
    </section>
  );
}

function FlowSvg() {
  return (
    <svg className="flow-svg block h-auto w-full" viewBox="0 0 460 460" aria-hidden="true">
      <defs>
        <radialGradient id="memGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255,75,0,.28)" />
          <stop offset="70%" stopColor="rgba(255,75,0,.04)" />
          <stop offset="100%" stopColor="rgba(255,75,0,0)" />
        </radialGradient>
      </defs>

      <circle className="mem-glow" cx="230" cy="230" r="200" fill="url(#memGlow)" />
      <circle
        cx="230"
        cy="230"
        r="190"
        fill="none"
        stroke="rgba(255,255,255,.05)"
        strokeDasharray="1 5"
      />
      <circle className="arc-track" cx="230" cy="230" r="150" />
      <circle className="arc-fg s1" cx="230" cy="230" r="150" pathLength={286} />
      <circle className="arc-fg s2" cx="230" cy="230" r="150" pathLength={286} />
      <circle className="arc-fg s3" cx="230" cy="230" r="150" pathLength={286} />
      <circle className="arc-fg s4" cx="230" cy="230" r="150" pathLength={286} />

      <g className="mem-bubble">
        <circle
          cx="230"
          cy="230"
          r="62"
          fill="var(--color-neutral-900)"
          stroke="rgba(255,75,0,.45)"
          strokeWidth="1"
        />
        <circle cx="230" cy="230" r="62" fill="rgba(255,75,0,.06)" />
        <text
          x="230"
          y="220"
          textAnchor="middle"
          fontFamily="Inter"
          fontSize="10"
          fill="var(--color-neutral-500)"
          fontWeight="500"
          letterSpacing=".08em"
        >
          PROJECT
        </text>
        <text
          x="230"
          y="238"
          textAnchor="middle"
          fontFamily="Inter"
          fontSize="16"
          fill="var(--color-primary-400)"
          fontWeight="500"
        >
          memory
        </text>
        <text
          x="230"
          y="254"
          textAnchor="middle"
          fontFamily="Commit Mono"
          fontSize="9"
          fill="var(--color-neutral-500)"
        >
          2.1k entries
        </text>
      </g>

      <g>
        <circle className="traveler" r="4">
          <animateMotion
            dur="9s"
            repeatCount="indefinite"
            rotate="auto"
            path="M 230 80 A 150 150 0 0 1 380 230 A 150 150 0 0 1 230 380 A 150 150 0 0 1 80 230 A 150 150 0 0 1 230 80 Z"
          />
        </circle>
      </g>

      <FlowNode
        x={230}
        y={80}
        num="01"
        label="Run"
        labelFill="var(--color-primary-400)"
        cls="is-run"
      />
      <FlowNode x={380} y={230} num="02" label="Review" labelFill="#60a5fa" cls="is-review" />
      <FlowNode x={230} y={380} num="03" label="Suggest" labelFill="#a78bfa" cls="is-suggest" />
      <FlowNode x={80} y={230} num="04" label="Remember" labelFill="#34d399" cls="is-remember" />
    </svg>
  );
}

function FlowNode({
  x,
  y,
  num,
  label,
  labelFill,
  cls,
}: {
  x: number;
  y: number;
  num: string;
  label: string;
  labelFill: string;
  cls: string;
}) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle className={`node-pulse ${cls}`} r="36" />
      <circle className={`node-ring ${cls}`} r="36" />
      <text
        y="-4"
        textAnchor="middle"
        fontFamily="Inter"
        fontSize="9"
        fill="var(--color-neutral-500)"
        fontWeight="500"
        letterSpacing=".08em"
      >
        {num}
      </text>
      <text
        y="13"
        textAnchor="middle"
        fontFamily="Inter"
        fontSize="13"
        fill={labelFill}
        fontWeight="500"
      >
        {label}
      </text>
    </g>
  );
}
