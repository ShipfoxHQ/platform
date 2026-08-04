import {AuthShell} from '@shipfox/client-shell/runtime';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput} from '@shipfox/react-ui/form-field';
import type {HeaderProps} from '@shipfox/react-ui/typography';
import type {FormEvent, ReactNode, Ref} from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';

const EIGHT_DIGIT_CODE_RE = /^\d{8}$/u;

export interface EmailCodeVerificationProps {
  destination: string;
  expiresAt?: string | undefined;
  nextResendAvailableAt?: string | undefined;
  isResending?: boolean;
  isVerifying?: boolean;
  error?: string | undefined;
  title?: string;
  description?: string;
  children?: ReactNode;
  headingProps?: Omit<HeaderProps, 'children' | 'id'> | undefined;
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  onResend: () => void | Promise<void>;
  onUseAnotherEmail: () => void;
  onVerify: (code: string) => void | Promise<void>;
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function EmailCodeVerification({
  destination,
  expiresAt,
  nextResendAvailableAt,
  isResending = false,
  isVerifying = false,
  error,
  title = 'Check your email',
  description = `We sent an eight-digit verification code to ${destination}.`,
  children,
  headingProps,
  headingRef,
  onResend,
  onUseAnotherEmail,
  onVerify,
}: EmailCodeVerificationProps) {
  const [code, setCode] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [codeError, setCodeError] = useState<string>();
  const localHeadingRef = useRef<HTMLHeadingElement>(null);
  const resendAvailableAt = timestamp(nextResendAvailableAt);
  const expiration = timestamp(expiresAt);
  const resendRemainingSeconds = resendAvailableAt
    ? Math.max(0, Math.ceil((resendAvailableAt - now) / 1_000))
    : 0;
  const isResendCoolingDown = resendRemainingSeconds > 0;
  const isExpired = expiration !== undefined && expiration <= now;
  const isPending = isResending || isVerifying;

  useEffect(() => {
    const isPending = (tickNow: number) =>
      (resendAvailableAt !== undefined && resendAvailableAt > tickNow) ||
      (expiration !== undefined && expiration > tickNow);

    const tickNow = Date.now();
    setNow(tickNow);
    if (!isPending(tickNow)) return;

    const interval = window.setInterval(() => {
      const nextTick = Date.now();
      setNow(nextTick);
      if (!isPending(nextTick)) {
        window.clearInterval(interval);
      }
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [expiration, resendAvailableAt]);

  useEffect(() => {
    localHeadingRef.current?.focus();
  }, []);

  const setHeadingRef = useCallback(
    (heading: HTMLHeadingElement | null) => {
      localHeadingRef.current = heading;
      if (typeof headingRef === 'function') {
        headingRef(heading);
      } else if (headingRef) {
        headingRef.current = heading;
      }
    },
    [headingRef],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isExpired || isVerifying) return;
    if (!validateCode()) return;
    void onVerify(code);
  }

  function validateCode() {
    const error = EIGHT_DIGIT_CODE_RE.test(code)
      ? undefined
      : 'Enter the eight-digit verification code.';
    setCodeError(error);
    return error === undefined;
  }

  return (
    <AuthShell
      title={title}
      description={description}
      headingProps={headingProps}
      headingRef={setHeadingRef}
    >
      {error ? (
        <Callout role="alert" type="error">
          {error}
        </Callout>
      ) : null}
      {isExpired ? (
        <Callout role="alert" type="error">
          This verification code has expired. Use another email to try again.
        </Callout>
      ) : null}
      <form className="flex flex-col gap-inline" noValidate onSubmit={submit}>
        <FormField label="Verification code" id="verification-code" error={codeError}>
          <FormFieldInput
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={8}
            pattern="[0-9]{8}"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/gu, '').slice(0, 8));
              setCodeError(undefined);
            }}
            onBlur={validateCode}
          />
        </FormField>
        <Button className="w-full" type="submit" disabled={isExpired} isLoading={isVerifying}>
          Verify email
        </Button>
        <Button
          aria-disabled={isResendCoolingDown ? true : undefined}
          className="w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-70"
          variant="secondary"
          type="button"
          isLoading={isResending}
          onClick={() => {
            if (!isResendCoolingDown && !isResending) void onResend();
          }}
        >
          {isResending
            ? 'Sending email...'
            : isResendCoolingDown
              ? `Resend in ${resendRemainingSeconds}s`
              : 'Resend verification email'}
        </Button>
      </form>
      <Button
        className="w-full"
        variant="transparent"
        type="button"
        disabled={isPending}
        onClick={onUseAnotherEmail}
      >
        Use another email
      </Button>
      {children}
    </AuthShell>
  );
}
