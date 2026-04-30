'use client';

import {Icon, type IconName} from '@shipfox/react-ui';
import {useEffect, useRef, useState} from 'react';

type Status = 'done' | 'run' | 'queue' | 'skip';

type DagNodeProps = {
  id: string;
  icon: IconName;
  title: string;
  meta?: React.ReactNode;
  stat: string;
  status: Status;
  variant?: 'trigger' | 'output';
  agentTag?: {label: string; tone?: 'purple' | 'blue'};
  branchTag?: string;
};

const COLUMN_LABELS = ['Trigger', 'Triage', 'Branch', 'Parallel jobs', 'Output'] as const;

export function DagFigure() {
  const [elapsed, setElapsed] = useState(12.4);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed((t) => (t + 0.2 > 18 ? 12.4 : t + 0.2));
    }, 200);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      id="heroDag"
      className="bg-background-neutral-base border-color-alpha-white-10 relative mt-56 overflow-hidden rounded-14 border px-40 pb-36 pt-28 shadow-[0_30px_80px_rgba(0,0,0,.55)]"
    >
      <div
        aria-hidden
        className="bg-grid-dots-subtle pointer-events-none absolute inset-0 opacity-50"
      />

      {/* Head */}
      <div className="border-b-color-alpha-white-6 text-foreground-neutral-muted font-code relative z-[1] mb-18 flex items-center gap-14 border-b pb-18 text-xs leading-none">
        <span className="text-foreground-neutral-base font-medium">workflow.triage-sentry</span>
        <span className="opacity-40">·</span>
        <span>run #4,128</span>
        <span className="opacity-40">·</span>
        <span className="inline-flex items-center gap-4">
          <Icon name="githubFill" className="size-12" />
          acme/payments-api
        </span>
        <span className="ml-auto inline-flex items-center gap-14">
          <span className="text-color-green-400 inline-flex items-center gap-6">
            <span
              className="bg-color-green-400 size-6 rounded-full shadow-[0_0_0_3px_rgba(52,211,153,.18)]"
              style={{animation: 'pulse-soft 1.6s ease-in-out infinite'}}
            />
            Live
          </span>
          <span>
            elapsed{' '}
            <b
              className="text-foreground-neutral-base font-medium"
              style={{fontFeatureSettings: '"tnum"'}}
            >
              {elapsed.toFixed(1)}s
            </b>
          </span>
        </span>
      </div>

      <DagGrid />

      {/* Footer strip */}
      <div className="border-t-color-alpha-white-6 text-foreground-neutral-muted font-code relative z-[1] mt-22 flex flex-wrap items-center gap-14 border-t pt-16 text-xs leading-none">
        <span className="text-color-primary-400 inline-flex items-center gap-6 rounded-4 border border-[rgba(255,75,0,.25)] bg-[rgba(255,75,0,.10)] px-8 py-3 font-medium uppercase tracking-[.06em]">
          running
        </span>
        <span className="inline-flex items-center gap-4">
          <Icon name="gitCommitLine" className="size-12" />
          8a3f2c1
        </span>
        <span className="opacity-40">·</span>
        <span>
          defined in{' '}
          <span className="text-foreground-neutral-base">.shipfox/workflows/triage-sentry.yml</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-14">
          <span className="inline-flex items-center gap-4">
            <Icon name="coinLine" className="size-12" />
            $0.043 spent
          </span>
          <span className="inline-flex items-center gap-4">
            <Icon name="timeLine" className="size-12" />3 of 5 jobs
          </span>
        </span>
      </div>
    </div>
  );
}

function DagGrid() {
  const dagRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    function draw() {
      const dag = dagRef.current;
      const svg = svgRef.current;
      if (!dag || !svg) return;
      const dr = dag.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${dr.width} ${dr.height}`);
      svg.setAttribute('width', String(dr.width));
      svg.setAttribute('height', String(dr.height));

      const get = (sel: string) => dag.querySelector<HTMLElement>(sel);
      const trigger = get('#n-trigger');
      const triage = get('#n-triage');
      const branch = get('#n-branch');
      const coder = get('#n-coder');
      const tests = get('#n-tests');
      const escalate = get('#n-escalate');
      const output = get('#n-output');
      if (!trigger || !triage || !branch || !coder || !tests || !escalate || !output) return;

      function rect(el: HTMLElement) {
        const r = el.getBoundingClientRect();
        return {x: r.left - dr.left, y: r.top - dr.top, w: r.width, h: r.height};
      }
      const rightMid = (el: HTMLElement) => {
        const r = rect(el);
        return [r.x + r.w, r.y + r.h / 2] as const;
      };
      const leftMid = (el: HTMLElement) => {
        const r = rect(el);
        return [r.x, r.y + r.h / 2] as const;
      };
      const curve = (x1: number, y1: number, x2: number, y2: number) => {
        const cx = (x1 + x2) / 2;
        return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
      };
      const arrow = (x: number, y: number, color: string) => {
        const s = 4.5;
        return `<path d="M ${x - s} ${y - s} L ${x} ${y} L ${x - s} ${y + s}" fill="none" stroke="${color}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>`;
      };

      const done = '#34d399';
      const active = '#FF4B00';
      const dim = 'rgba(255,255,255,.14)';
      const skip = 'rgba(255,255,255,.06)';

      const segs: string[] = [];
      function edge(
        from: HTMLElement,
        to: HTMLElement,
        color: string,
        opts: {animated?: boolean; dashed?: boolean; arrow?: boolean; width?: number} = {},
      ) {
        const [x1, y1] = rightMid(from);
        const [x2, y2] = leftMid(to);
        const tipX = x2 - 1;
        const dash = opts.animated
          ? 'stroke-dasharray="4 4" class="dag-edge-anim"'
          : opts.dashed
            ? 'stroke-dasharray="2 5"'
            : '';
        const w = opts.width ?? 1.25;
        segs.push(
          `<path d="${curve(x1, y1, tipX, y2)}" stroke="${color}" stroke-width="${w}" fill="none" ${dash} stroke-linecap="round"/>`,
        );
        if (opts.arrow !== false) segs.push(arrow(tipX, y2, color));
      }

      edge(trigger, triage, done);
      edge(triage, branch, done);
      edge(branch, coder, active, {animated: true, width: 1.5});
      edge(branch, tests, dim, {dashed: true});
      edge(branch, escalate, skip, {dashed: true, arrow: false});
      edge(coder, output, dim, {dashed: true});
      edge(tests, output, dim, {dashed: true});

      svg.innerHTML = segs.join('');
    }

    draw();
    const ro = new ResizeObserver(draw);
    if (dagRef.current) ro.observe(dagRef.current);
    window.addEventListener('resize', draw);
    if (document.fonts?.ready) document.fonts.ready.then(draw);
    const t1 = setTimeout(draw, 300);
    const t2 = setTimeout(draw, 1200);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', draw);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div
      ref={dagRef}
      className="dag relative z-[1] grid items-center gap-y-18"
      style={{
        gridTemplateColumns: '200px 36px 1fr 36px 1fr 36px 1fr 36px 200px',
      }}
    >
      {COLUMN_LABELS.map((label, i) => (
        <span
          key={label}
          className="text-foreground-neutral-muted font-code col-start-1 row-start-1 pb-4 text-center text-[10px] font-medium uppercase leading-none tracking-[.08em]"
          style={{gridColumnStart: 1 + i * 2, gridRowStart: 1}}
        >
          {label}
        </span>
      ))}

      <DagNode
        id="n-trigger"
        icon="errorWarningLine"
        title="sentry.new_issue"
        meta="SEN-2812 · NullPointer"
        stat="0.4s"
        status="done"
        variant="trigger"
        gridStart={1}
      />
      <DagNode
        id="n-triage"
        icon="robot2Line"
        title="triage"
        stat="8.2s · action: fix"
        status="done"
        agentTag={{label: 'diagnostician', tone: 'purple'}}
        gridStart={3}
      />
      <DagNode
        id="n-branch"
        icon="flowChart"
        title="route"
        stat="branch on output"
        status="done"
        branchTag="→ fix"
        gridStart={5}
      />

      <div
        className="flex flex-col gap-12"
        style={{gridColumnStart: 7, gridColumnEnd: 8, gridRowStart: 2}}
      >
        <DagNode
          id="n-coder"
          icon="codeSSlashLine"
          title="coder"
          stat="writing patch · 2.1s"
          status="run"
          agentTag={{label: 'claude-sonnet', tone: 'blue'}}
        />
        <DagNode
          id="n-tests"
          icon="testTubeLine"
          title="pytest tests/"
          stat="queued"
          status="queue"
        />
        <DagNode
          id="n-escalate"
          icon="alarmWarningLine"
          title="page #oncall"
          stat="skipped (branch)"
          status="skip"
        />
      </div>

      <DagNode
        id="n-output"
        icon="gitPullRequestLine"
        title="gh pr create"
        meta="acme/payments-api"
        stat="queued"
        status="queue"
        variant="output"
        gridStart={9}
      />

      <svg ref={svgRef} className="dag-svg" aria-hidden="true" />
    </div>
  );
}

function DagNode({
  id,
  icon,
  title,
  meta,
  stat,
  status,
  variant,
  agentTag,
  branchTag,
  gridStart,
}: DagNodeProps & {gridStart?: number}) {
  const baseBorder =
    status === 'done'
      ? 'border-[rgba(52,211,153,.35)]'
      : status === 'run'
        ? 'border-color-primary-400 shadow-[0_0_0_4px_rgba(255,75,0,.14),0_8px_24px_rgba(255,75,0,.18)]'
        : 'border-color-alpha-white-10';
  const opacity =
    status === 'queue' ? 'opacity-55' : status === 'skip' ? 'opacity-35 border-dashed' : '';
  const variantBg =
    variant === 'trigger'
      ? 'bg-gradient-to-b from-[rgba(167,139,250,.06)] to-[rgba(167,139,250,.02)] border-[rgba(167,139,250,.4)]'
      : variant === 'output'
        ? 'bg-gradient-to-b from-[rgba(52,211,153,.06)] to-[rgba(52,211,153,.02)] border-[rgba(52,211,153,.35)]'
        : 'bg-background-neutral-base';

  const statColor =
    status === 'done' || variant === 'output'
      ? 'text-color-green-400'
      : status === 'run'
        ? 'text-color-primary-400'
        : 'text-foreground-neutral-muted';

  const titleColor =
    status === 'skip' ? 'text-foreground-neutral-muted' : 'text-foreground-neutral-base';

  const iconColor =
    variant === 'trigger'
      ? 'text-color-purple-400'
      : variant === 'output'
        ? 'text-color-green-400'
        : '';

  return (
    <div
      id={id}
      className={[
        'relative flex flex-col gap-6 rounded-10 border p-12 transition-[border-color,box-shadow] duration-200',
        variantBg,
        baseBorder,
        opacity,
      ].join(' ')}
      style={gridStart ? {gridColumnStart: gridStart, gridRowStart: 2} : undefined}
    >
      <span
        className={['font-code flex items-center gap-8 text-xs font-medium', titleColor].join(' ')}
      >
        <Icon name={icon} className={['size-14', iconColor].join(' ')} />
        {title}
      </span>

      {agentTag && (
        <span
          className={[
            'font-code inline-flex w-max items-center gap-4 rounded-4 px-6 py-2 text-[10px] font-medium leading-[12px]',
            agentTag.tone === 'blue'
              ? 'text-color-blue-400 bg-[rgba(96,165,250,.12)]'
              : 'text-color-purple-400 bg-[rgba(167,139,250,.12)]',
          ].join(' ')}
        >
          <Icon name="cpuLine" className="size-10" />
          {agentTag.label}
        </span>
      )}

      {branchTag && (
        <span className="text-color-primary-400 font-code inline-flex w-max items-center gap-4 rounded-4 bg-[rgba(255,75,0,.12)] px-6 py-2 text-[10px] font-medium leading-[12px]">
          {branchTag}
        </span>
      )}

      {meta && (
        <span className="text-foreground-neutral-muted font-code text-[11px] leading-[14px]">
          {meta}
        </span>
      )}

      <span
        className={[
          'font-code mt-2 inline-flex items-center gap-4 text-[10px] leading-[12px]',
          statColor,
        ].join(' ')}
      >
        <span
          className="size-5 rounded-full bg-current"
          style={status === 'run' ? {animation: 'pulse-soft 1.2s ease-in-out infinite'} : undefined}
        />
        {stat}
      </span>
    </div>
  );
}
