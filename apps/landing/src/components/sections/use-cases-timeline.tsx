'use client';

import {Icon, type IconName} from '@shipfox/react-ui';
import type {ReactNode} from 'react';

type Event = {id: string; icon: IconName; iconColor?: string; content: ReactNode};
type Lane = {id: string; day: ReactNode; events: Event[]};

const LANES: Lane[] = [
  {
    id: 'day-0',
    day: (
      <>
        Day <b className="text-color-primary-400">0</b>
      </>
    ),
    events: [
      {
        id: 'd0-trigger',
        icon: 'flashlightFill',
        iconColor: 'text-color-primary-400',
        content: 'linear:ENG-412 assigned to @shipfox',
      },
      {
        id: 'd0-plan',
        icon: 'quillPenLine',
        iconColor: 'text-color-purple-400',
        content: (
          <>
            planner posts proposed plan as gh issue{' '}
            <span className="text-foreground-neutral-muted">#1284</span>
          </>
        ),
      },
      {
        id: 'd0-sleep',
        icon: 'zzzLine',
        iconColor: 'text-foreground-neutral-muted',
        content: 'sleep · runner released',
      },
    ],
  },
  {
    id: 'day-1',
    day: (
      <>
        Day <b className="text-color-primary-400">1</b>
      </>
    ),
    events: [
      {
        id: 'd1-comments',
        icon: 'chat3Line',
        iconColor: 'text-color-blue-400',
        content: '4 comments · debounced 5m · planner wakes',
      },
      {
        id: 'd1-revised',
        icon: 'quillPenLine',
        iconColor: 'text-color-purple-400',
        content: (
          <>
            plan revised <span className="text-foreground-neutral-muted">v2</span>
          </>
        ),
      },
    ],
  },
  {
    id: 'day-4',
    day: (
      <>
        Day <b className="text-color-primary-400">4</b>
      </>
    ),
    events: [
      {
        id: 'd4-comments',
        icon: 'chat3Line',
        iconColor: 'text-color-blue-400',
        content: '2 comments · planner wakes',
      },
      {
        id: 'd4-revised',
        icon: 'quillPenLine',
        iconColor: 'text-color-purple-400',
        content: (
          <>
            plan revised <span className="text-foreground-neutral-muted">v3</span>
          </>
        ),
      },
    ],
  },
  {
    id: 'day-6',
    day: (
      <>
        Day <b className="text-color-primary-400">6</b>
      </>
    ),
    events: [
      {
        id: 'd6-approve',
        icon: 'checkboxCircleFill',
        iconColor: 'text-color-green-400',
        content: (
          <>
            /approve from <b className="text-foreground-neutral-base">@rohan</b>
          </>
        ),
      },
      {
        id: 'd6-build',
        icon: 'flashlightFill',
        iconColor: 'text-color-primary-400',
        content: 'coder + reviewer loop · pr opened in 14m',
      },
    ],
  },
];

export function UseCaseTimeline() {
  return (
    <div
      className="bg-background-neutral-base border-color-alpha-white-8 mt-14 grid overflow-hidden rounded-14 border"
      style={{gridTemplateColumns: '1fr'}}
    >
      <div className="flex flex-col gap-8 px-36 py-20">
        <div className="text-foreground-neutral-muted font-code inline-flex items-center gap-6 text-xs font-medium uppercase leading-none tracking-[.08em]">
          <Icon name="timeLine" className="size-13" />
          Lifetime of a plan-and-build run
        </div>
        <div className="p-24">
          {LANES.map((lane, i) => (
            <div
              key={lane.id}
              className={[
                'grid items-start gap-16 py-10',
                i > 0 ? 'border-t-color-alpha-white-6 border-t' : '',
              ].join(' ')}
              style={{gridTemplateColumns: '80px 1fr'}}
            >
              <span className="text-foreground-neutral-muted font-code pt-4 text-xs font-medium uppercase leading-none tracking-[.06em]">
                {lane.day}
              </span>
              <div className="flex flex-col gap-6">
                {lane.events.map((ev) => (
                  <span
                    key={ev.id}
                    className="bg-background-neutral-base border-color-alpha-white-8 text-foreground-neutral-subtle font-code inline-flex w-max max-w-full items-center gap-8 rounded-6 border px-10 py-6 text-xs leading-[16px]"
                  >
                    <Icon name={ev.icon} className={['size-13', ev.iconColor].join(' ')} />
                    {ev.content}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
