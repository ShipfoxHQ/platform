'use client';

import {useCallback, useEffect, useRef} from 'react';

// Radix's dismissable layer locks `body { pointer-events: none }` while a modal
// layer is open and restores the previous value when the last layer unregisters.
// That restore runs in a passive effect, so a layer torn down in the same commit
// that closed it leaves no slack: a click landing in that window is swallowed,
// and a restore that never runs leaves the page inert until a reload.

// Only an open layer can hold the lock. Radix hands it back the moment a surface
// closes, so a closed node still playing its exit animation owns nothing.
const OPEN_LAYER_SELECTOR = [
  '[data-state="open"][role="dialog"]',
  '[data-state="open"][role="alertdialog"]',
  '[data-state="open"][role="menu"]',
  '[data-state="open"][role="listbox"]',
].join(',');

// Spread across the window in which Radix and its exit animations settle.
const CHECKPOINTS_MS = [0, 120, 400, 1000];

function releaseBodyPointerEvents(inheritedPointerEvents: string): void {
  if (typeof document === 'undefined') return;
  // The page was already locked before this surface opened, so the lock belongs
  // to someone else and stays untouched.
  if (inheritedPointerEvents === 'none') return;
  if (document.body.style.pointerEvents !== 'none') return;
  if (document.querySelector(OPEN_LAYER_SELECTOR) !== null) return;

  document.body.style.removeProperty('pointer-events');
}

function scheduleRelease(inheritedPointerEvents: string): void {
  if (typeof window === 'undefined') return;

  for (const delay of CHECKPOINTS_MS) {
    window.setTimeout(() => releaseBodyPointerEvents(inheritedPointerEvents), delay);
  }
}

/**
 * Guarantees the body pointer-events lock is released once a modal surface has
 * closed, including when it unmounts while still open.
 *
 * Pass `open` for controlled surfaces. The returned callback covers uncontrolled
 * ones and should be called from the surface's `onOpenChange`.
 */
export function useBodyPointerEventsRelease(open?: boolean): (nextOpen: boolean) => void {
  const inheritedPointerEvents = useRef('');
  const wasOpen = useRef(false);

  const trackOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      if (!wasOpen.current && typeof document !== 'undefined') {
        inheritedPointerEvents.current = document.body.style.pointerEvents;
      }
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;

    wasOpen.current = false;
    scheduleRelease(inheritedPointerEvents.current);
  }, []);

  useEffect(() => {
    if (open === undefined) return;
    trackOpenChange(open);
  }, [open, trackOpenChange]);

  useEffect(() => {
    return () => {
      if (wasOpen.current) scheduleRelease(inheritedPointerEvents.current);
    };
  }, []);

  return trackOpenChange;
}
