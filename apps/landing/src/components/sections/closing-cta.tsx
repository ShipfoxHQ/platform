'use client';

import {Button, Icon} from '@shipfox/react-ui';
import {type FormEvent, useState} from 'react';

export function ClosingCta() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <section
      id="footer-cta"
      className="bg-color-neutral-1000 relative overflow-hidden border-b-0 px-0 pb-[120px] pt-[140px]"
      style={{
        backgroundImage:
          'radial-gradient(800px 360px at 50% 0%, rgba(255,75,0,.18), transparent 70%)',
      }}
    >
      <div aria-hidden className="bg-grid-dots pointer-events-none absolute inset-0" />
      <div className="wrap relative text-center">
        <h2 className="font-display text-foreground-neutral-base mx-auto m-0 max-w-[780px] text-[56px] font-medium leading-[62px] tracking-[-0.03em]">
          Your software factory,{' '}
          <em className="text-color-primary-400 not-italic">in your repo.</em>
        </h2>
        <p className="font-display text-foreground-neutral-subtle mx-auto mt-18 max-w-[580px] text-[17px] font-normal leading-[28px]">
          One versioned system for the way engineering teams actually ship: tickets, alerts,
          reviews, agents, humans.
        </p>

        {submitted ? (
          <div className="mx-auto mt-40 flex max-w-[480px] flex-col items-center gap-8 py-20 text-center">
            <Icon name="checkboxCircleFill" className="text-color-green-400 size-36" />
            <div className="font-display text-foreground-neutral-base text-lg font-medium leading-[22px]">
              You're on the list.
            </div>
            <div className="font-display text-foreground-neutral-subtle text-sm font-normal leading-[20px]">
              We'll email{' '}
              <b className="text-foreground-neutral-base font-code font-medium">{email}</b> with
              your access link.
            </div>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            autoComplete="off"
            className="bg-background-neutral-base border-color-alpha-white-10 mx-auto mt-40 flex max-w-[480px] items-center gap-8 rounded-12 border p-6 shadow-[0_20px_60px_rgba(0,0,0,.4)]"
          >
            <input
              type="email"
              required
              name="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="text-foreground-neutral-base placeholder:text-foreground-neutral-muted font-display h-40 flex-1 border-0 bg-transparent px-14 text-md outline-none"
            />
            <Button
              type="submit"
              variant="secondary"
              iconLeft="flashlightFill"
              className="bg-color-primary-400 text-color-neutral-1000 shipfox-shadow-cta hover:bg-color-primary-300 h-40"
            >
              Get started
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
