import {Button} from '@shipfox/react-ui/button';
import {FormField, FormFieldInput} from '@shipfox/react-ui/form-field';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {Text} from '@shipfox/react-ui/typography';
import {type ReactNode, useEffect, useRef, useState} from 'react';

export type SlugAvailabilityStatus = 'unchecked' | 'checking' | 'available' | 'taken';

export interface SlugFieldProps {
  id: string;
  label: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string | undefined;
  description?: ReactNode;
  placeholder?: string;
  className?: string;
  currentSlug?: string | undefined;
  checkEnabled?: boolean;
  debounceMs?: number;
  isValid: (value: string) => boolean;
  checkAvailability: (value: string) => Promise<boolean> | boolean;
}

export function SlugField({
  id,
  label,
  name,
  value,
  onChange,
  onBlur,
  error,
  description,
  placeholder,
  className,
  currentSlug,
  checkEnabled = true,
  debounceMs = 300,
  isValid,
  checkAvailability,
}: SlugFieldProps) {
  const [availability, setAvailability] = useState<{
    value: string;
    status: SlugAvailabilityStatus;
  }>({value, status: 'unchecked'});
  const requestId = useRef(0);

  useEffect(() => {
    const currentRequestId = ++requestId.current;
    if (currentSlug !== undefined && value === currentSlug) {
      setAvailability({value, status: 'unchecked'});
      return;
    }
    if (!checkEnabled || !isValid(value)) {
      setAvailability({value, status: 'unchecked'});
      return;
    }

    setAvailability({value, status: 'checking'});
    let disposed = false;
    const timer = window.setTimeout(() => {
      Promise.resolve(checkAvailability(value)).then(
        (available) => {
          if (disposed || requestId.current !== currentRequestId) return;
          setAvailability({value, status: available ? 'available' : 'taken'});
        },
        () => {
          if (disposed || requestId.current !== currentRequestId) return;
          setAvailability({value, status: 'unchecked'});
        },
      );
    }, debounceMs);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [checkAvailability, checkEnabled, currentSlug, debounceMs, isValid, value]);

  const liveError =
    error ??
    (availability.value === value && availability.status === 'taken'
      ? 'This slug is already taken.'
      : undefined);
  const liveStatus =
    availability.value !== value
      ? undefined
      : availability.status === 'checking'
        ? 'Checking availability…'
        : availability.status === 'available'
          ? 'Slug is available.'
          : undefined;

  return (
    <FormField
      label={label}
      id={id}
      error={liveError}
      description={
        description || liveStatus ? (
          <span aria-live="polite">
            {description}
            {description && liveStatus ? ' ' : null}
            {liveStatus}
          </span>
        ) : undefined
      }
    >
      <FormFieldInput
        autoComplete="off"
        className={className}
        name={name}
        placeholder={placeholder}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </FormField>
  );
}

export function SlugChangeWarning({
  open,
  onOpenChange,
  entityLabel,
  isLoading = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityLabel: string;
  isLoading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Change {entityLabel} slug?</ModalTitle>
        </ModalHeader>
        <ModalBody className="gap-16">
          <Text size="sm">Changing the slug changes the URL for this {entityLabel}.</Text>
          <ul className="list-disc pl-20 text-sm text-foreground-neutral-base">
            <li>Links and bookmarks pointing at the old URL stop working.</li>
            <li>The old slug becomes available for someone else to take.</li>
            <li>Any place the slug has been written down by hand needs updating.</li>
          </ul>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} isLoading={isLoading}>
            Change slug
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
