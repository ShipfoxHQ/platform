import {Icon} from '@shipfox/react-ui/icon';
import {Header, type HeaderProps, Text} from '@shipfox/react-ui/typography';
import type {PropsWithChildren, ReactNode, Ref} from 'react';

export interface AuthShellProps {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  headingProps?: Omit<HeaderProps, 'children' | 'id'> | undefined;
  headingRef?: Ref<HTMLHeadingElement> | undefined;
}

export function AuthShell({
  title,
  description,
  children,
  className,
  headingProps,
  headingRef,
}: AuthShellProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background-subtle-base px-frame py-frame max-[520px]:items-start max-[520px]:px-row max-[520px]:pt-[56px]">
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[380px] w-full max-w-[880px] -translate-x-1/2 -translate-y-[120px] opacity-55 max-[520px]:-translate-y-[170px] max-[520px]:opacity-35"
        aria-hidden="true"
        style={{
          maskImage:
            'radial-gradient(ellipse 85% 100% at 50% 0%, #000 0%, #000 24%, transparent 78%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 85% 100% at 50% 0%, #000 0%, #000 24%, transparent 78%)',
        }}
      >
        <div className="h-full w-full bg-[radial-gradient(circle,rgba(230,62,0,0.48)_1.6px,transparent_1.8px)] bg-[length:44px_44px]" />
      </div>
      <section
        className={
          className ?? 'relative flex w-full max-w-[384px] flex-col items-stretch gap-region'
        }
        aria-labelledby="auth-title"
      >
        <div className="flex flex-col items-center gap-group">
          <div className="flex size-64 items-center justify-center rounded-12 border border-border-neutral-base bg-background-neutral-base p-tight shadow-button-neutral">
            <Icon name="shipfox" className="size-42 text-background-highlight-interactive" />
          </div>
          <div className="flex min-w-[128px] flex-col items-center gap-tight text-center">
            <Header
              id="auth-title"
              variant="h1"
              tabIndex={-1}
              {...headingProps}
              {...(headingRef ? ({ref: headingRef} as HeaderProps) : {})}
            >
              {title}
            </Header>
            <Text size="sm" className="text-foreground-neutral-subtle">
              {description}
            </Text>
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}

export function AuthActions({children}: PropsWithChildren) {
  return <div className="flex flex-col gap-section">{children}</div>;
}
