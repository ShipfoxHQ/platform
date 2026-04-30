'use client';

import {Icon, type IconName} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
import {SectionHead} from '../shared/section-head';

export function PlatformSection() {
  return (
    <section id="platform" className="border-b-color-alpha-white-6 relative border-b py-[110px]">
      <div className="wrap">
        <SectionHead
          kicker="/platform"
          title="Full visibility. Any model. Predictable costs."
          description="The control plane teams need to operate this safely at scale: every run logged, every model swappable, every dollar accounted for."
        />

        <div className="grid grid-cols-3 gap-18">
          <PillarCol
            iconColor="text-color-blue-400"
            icon="pulseLine"
            title="Workflow observability"
            body="Every run logged end-to-end: trigger source, agent sessions, tool calls, outputs, duration, cost. Full audit trail across your entire fleet. No black boxes."
            visual={<ObservabilityMini />}
            bullets={[
              'Run history with full replay',
              'Agent session logs',
              'Tool call traces',
              'Cost attribution per workflow',
            ]}
          />
          <PillarCol
            iconColor="text-color-purple-400"
            icon="stackLine"
            title="Use any model"
            body="Not locked into one provider. Use Anthropic, OpenAI, Google, Mistral, Qwen, DeepSeek, or any open-weight model. Plug in your own inference APIs or API keys. Mix models within a single workflow. Switch without rewriting."
            visual={<ModelsMini />}
            bullets={[
              'Any public model provider',
              'Bring your own API keys',
              'Custom or self-hosted endpoints',
              'Mix models per workflow',
            ]}
          />
          <PillarCol
            iconColor="text-color-green-400"
            icon="coinLine"
            title="Cost control"
            body="Set budgets per workflow, per team, or per model. Hard caps and soft alerts. Real-time spend dashboard. No surprise bills from a runaway agent loop."
            visual={<CostMeter />}
            bullets={[
              'Per-workflow budgets',
              'Per-team limits',
              'Spend alerts and hard caps',
              'Real-time cost dashboard',
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function PillarCol({
  iconColor,
  icon,
  title,
  body,
  visual,
  bullets,
}: {
  iconColor: string;
  icon: IconName;
  title: string;
  body: string;
  visual: ReactNode;
  bullets: string[];
}) {
  return (
    <div className="bg-background-neutral-base border-color-alpha-white-8 flex min-h-[380px] flex-col gap-14 rounded-12 border p-24">
      <div
        className={[
          'bg-background-subtle-base border-color-alpha-white-8 flex size-36 items-center justify-center rounded-8 border text-lg',
          iconColor,
        ].join(' ')}
      >
        <Icon name={icon} className="size-18" />
      </div>
      <h3 className="font-display text-foreground-neutral-base m-0 text-lg font-medium leading-[24px] tracking-[-0.005em]">
        {title}
      </h3>
      <p className="font-display text-foreground-neutral-subtle text-sm font-normal leading-[22px] m-0">
        {body}
      </p>
      <div className="mt-8">{visual}</div>
      <ul className="mb-0 mt-auto flex list-none flex-col gap-8 p-0">
        {bullets.map((b) => (
          <li
            key={b}
            className="font-display text-foreground-neutral-base flex items-start gap-10 text-sm font-normal leading-[20px]"
          >
            <Icon
              name="checkboxCircleFill"
              className="text-color-primary-400 mt-3 size-13 shrink-0"
            />
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ObservabilityMini() {
  const rows: {name: string; pct: number; dur: string; barColor: string}[] = [
    {name: 'triage-sentry', pct: 38, dur: '12.4s', barColor: 'bg-color-primary-400'},
    {name: 'review-pr', pct: 64, dur: '2m 04s', barColor: 'bg-color-purple-400'},
    {name: 'plan-and-build', pct: 88, dur: '6d 02h', barColor: 'bg-color-blue-400'},
    {name: 'best-of-n', pct: 52, dur: '48.1s', barColor: 'bg-color-green-400'},
  ];
  return (
    <div className="bg-background-subtle-base border-color-alpha-white-8 flex flex-col gap-6 rounded-8 border p-12">
      {rows.map((r) => (
        <div
          key={r.name}
          className="font-code grid items-center gap-8 text-[11px] leading-[16px]"
          style={{gridTemplateColumns: '1fr 60px 50px'}}
        >
          <span className="text-foreground-neutral-subtle">{r.name}</span>
          <span className="bg-color-alpha-white-8 h-6 overflow-hidden rounded-3">
            <span
              className={['block h-full rounded-3', r.barColor].join(' ')}
              style={{width: `${r.pct}%`}}
            />
          </span>
          <span
            className="text-foreground-neutral-muted text-right"
            style={{fontFeatureSettings: '"tnum"'}}
          >
            {r.dur}
          </span>
        </div>
      ))}
    </div>
  );
}

function ModelsMini() {
  return (
    <div className="bg-background-subtle-base border-color-alpha-white-8 grid grid-cols-3 gap-6 rounded-8 border p-4">
      <ModelCell color="#fb923c">Anthropic</ModelCell>
      <ModelCell color="#34d399">OpenAI</ModelCell>
      <ModelCell color="#60a5fa">Google</ModelCell>
      <ModelCell color="#fb7185">Mistral</ModelCell>
      <ModelCell color="#a78bfa">Qwen</ModelCell>
      <ModelCell color="#e4e4e7">DeepSeek</ModelCell>
      <ModelCell color="var(--color-primary-400)" span={3}>
        Self-hosted · vLLM, TGI, Ollama
      </ModelCell>
    </div>
  );
}

function ModelCell({
  color,
  span = 1,
  children,
}: {
  color: string;
  span?: number;
  children: ReactNode;
}) {
  return (
    <span
      className="bg-background-neutral-base text-foreground-neutral-subtle font-code flex items-center gap-6 rounded-5 px-10 py-8 text-[11px] font-medium leading-[14px]"
      style={span > 1 ? {gridColumn: `span ${span}`} : undefined}
    >
      <span className="size-6 rounded-full" style={{background: color}} aria-hidden />
      {children}
    </span>
  );
}

function CostMeter() {
  return (
    <div className="bg-background-subtle-base border-color-alpha-white-8 flex flex-col gap-10 rounded-8 border p-14">
      <div className="text-foreground-neutral-muted font-code flex justify-between text-[11px] leading-[14px]">
        <span>this month · platform-team</span>
        <span>
          <b
            className="text-foreground-neutral-base font-medium"
            style={{fontFeatureSettings: '"tnum","lnum"'}}
          >
            $3,840
          </b>{' '}
          / $6,000
        </span>
      </div>
      <div className="bg-color-alpha-white-8 relative h-8 overflow-hidden rounded-4">
        <span
          className="block h-full rounded-4"
          style={{
            width: '64%',
            background: 'linear-gradient(90deg, #34d399, #fb923c, #fb7185)',
          }}
        />
        <span
          className="bg-foreground-neutral-base absolute -top-3 -bottom-3 w-px"
          style={{right: '10%'}}
          title="hard cap"
        />
      </div>
      <div className="text-foreground-neutral-muted font-code mt-1 flex justify-between text-[11px] leading-[14px]">
        <span className="text-color-orange-400">⚠ alert at 80 %</span>
        <span>hard cap at 90 %</span>
      </div>
    </div>
  );
}
