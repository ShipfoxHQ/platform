import type {ReactNode} from 'react';
import {Kicker} from './kicker';

export function SectionHead({
  kicker,
  title,
  description,
}: {
  kicker: string;
  title: ReactNode;
  description: ReactNode;
}) {
  return (
    <div className="mb-56 max-w-[760px]">
      <Kicker>{kicker}</Kicker>
      <h2 className="font-display text-foreground-neutral-base mt-14 text-[44px] leading-[52px] font-medium tracking-[-0.025em]">
        {title}
      </h2>
      <p className="font-display text-foreground-neutral-subtle mt-18 max-w-[660px] text-[17px] leading-[28px] font-normal">
        {description}
      </p>
    </div>
  );
}
