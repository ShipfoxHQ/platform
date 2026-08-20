'use client';

import {useEffect, useRef} from 'react';

// Radix's dismissable layer locks `body { pointer-events: none }` while a modal
// layer is mounted and restores the previous value when that layer unregisters.
// The restore runs in a passive effect, so a layer torn down in the same commit
// that closed it leaves no slack: a click landing in that window is swallowed,
// and a restore that never runs leaves the whole page inert until a reload.
// Releasing the lock here bounds that failure to a few hundred milliseconds.

// Anything Radix renders that may still hold the lock legitimately. While one of
// these is in the document the lock is somebody else's to release.
const ACTIVE_LAYER_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-radix-popper-content-wrapper]',
].join(',');

// Re-checked across the window in which Radix and its exit animations settle.
const CHECKPOINTS_MS = [0, 120, 400];

function releaseBodyPointerEvents(): void {
  if (typeof document === 'undefined') return;
  if (document.body.style.pointerEvents !== 'none') return;
  if (document.querySelector(ACTIVE_LAYER_SELECTOR) !== null) return;

  document.body.style.removeProperty('pointer-events');
}

function scheduleRelease(): void {
  if (typeof window === 'undefined') return;

  for (const delay of CHECKPOINTS_MS) {
    window.setTimeout(releaseBodyPointerEvents, delay);
  }
}

/**
 * Guarantees the body pointer-events lock is released once a modal surface has
 * closed, including when it unmounts while still open.
 */
export function useBodyPointerEventsRelease(open: boolean): void {
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;

    wasOpen.current = false;
    scheduleRelease();
  }, [open]);

  useEffect(() => {
    return () => {
      if (wasOpen.current) scheduleRelease();
    };
  }, []);
}
