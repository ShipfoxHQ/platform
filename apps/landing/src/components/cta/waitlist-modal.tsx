'use client';

import {Button, Icon, Text} from '@shipfox/react-ui';
import {type FormEvent, useEffect, useState} from 'react';
import {useCta} from './cta-context';

export function WaitlistModal() {
  const {isOpen, close} = useCta();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setEmail('');
      setSubmitted(false);
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(close, 1800);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="waitlist-title"
      className="bg-color-alpha-black-88 fixed inset-0 z-[100] flex items-center justify-center p-32 backdrop-blur-md"
      style={{animation: 'fade-in 200ms cubic-bezier(.2,0,0,1)'}}
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={close}
        className="absolute inset-0 cursor-default bg-transparent"
      />
      <div className="bg-background-neutral-base border-color-alpha-white-10 relative w-full max-w-[460px] rounded-14 border p-28 shadow-[0_40px_100px_rgba(0,0,0,.6),0_0_0_1px_rgba(255,255,255,.04)]">
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="text-foreground-neutral-muted hover:bg-background-components-hover hover:text-foreground-neutral-base absolute right-14 top-14 flex size-28 items-center justify-center rounded-6 bg-transparent"
        >
          <Icon name="closeLine" className="size-18" />
        </button>

        <Icon name="shipfoxLogo" className="mb-18 h-28 w-auto" />

        {submitted ? (
          <div className="flex flex-col items-center gap-8 py-20 text-center">
            <Icon name="checkboxCircleFill" className="text-color-green-400 size-36" />
            <Text className="text-foreground-neutral-base text-lg font-medium leading-[22px]">
              You're on the list.
            </Text>
            <Text className="text-foreground-neutral-subtle text-md leading-[20px]">
              We'll email{' '}
              <b className="text-foreground-neutral-base font-code font-medium">{email}</b> with
              your access link.
            </Text>
          </div>
        ) : (
          <>
            <h3
              id="waitlist-title"
              className="text-foreground-neutral-base text-2xl font-medium leading-[28px] tracking-[-0.015em]"
            >
              Join the Shipfox waitlist.
            </h3>
            <Text className="text-foreground-neutral-subtle mt-8 text-md leading-[22px]">
              We haven't launched yet. Drop your work email and we'll add you to the waitlist, we'll
              be in touch as soon as we have updates to share on the project.
            </Text>

            <form onSubmit={onSubmit} className="mt-20" autoComplete="off">
              <label
                htmlFor="modal-email"
                className="text-foreground-neutral-muted font-code mb-8 block text-xs font-medium uppercase tracking-[.06em]"
              >
                Work email
              </label>
              <input
                id="modal-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="bg-background-subtle-base border-color-alpha-white-10 text-foreground-neutral-base focus:border-color-primary-400 h-40 w-full rounded-6 border px-12 text-md outline-none focus:shadow-[0_0_0_4px_rgba(255,75,0,.18)]"
              />

              <div className="mt-18 flex gap-10">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1 justify-center"
                  onClick={close}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="secondary"
                  iconLeft="mailAddLine"
                  className="bg-color-primary-400 text-color-neutral-1000 shipfox-shadow-cta hover:bg-color-primary-300 flex-1 justify-center"
                >
                  Join waitlist
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
