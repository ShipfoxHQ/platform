import type {ReactNode} from 'react';

export function Kicker({children}: {children: ReactNode}) {
  return (
    <span className="font-code text-color-primary-400 text-xs font-medium uppercase tracking-[.08em]">
      {children}
    </span>
  );
}
