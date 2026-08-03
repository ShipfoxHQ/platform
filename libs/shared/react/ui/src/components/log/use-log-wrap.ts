'use client';

import {useCallback, useMemo, useState} from 'react';
import {
  createWrapState,
  type LogLineId,
  resolveRowWrap,
  setGlobalWrap,
  toggleGlobalWrap,
  toggleLineWrap,
  type WrapState,
} from './wrap-state.js';

export interface UseLogWrapResult {
  globalWrap: boolean;
  /** How many lines currently differ from the global default. */
  overriddenCount: number;
  /** The `wrap` value for a row: `undefined` inherits the global default. */
  rowWrap: (id: LogLineId) => boolean | undefined;
  /** Whether a line currently overrides the global default. */
  isOverridden: (id: LogLineId) => boolean;
  toggleLine: (id: LogLineId) => void;
  /** Flip the global default, clearing every per-line override. */
  toggleGlobal: () => void;
  /** Set the global default; a real change clears the overrides. */
  setGlobal: (wrap: boolean) => void;
}

/**
 * Owns interactive wrap state for a log surface: one global default plus the
 * lines that deliberately differ from it. A global change clears the per-line
 * overrides, so the global control always wins. State is keyed by line id, so a
 * per-line choice survives the row scrolling out of and back into a virtualized
 * window.
 */
export function useLogWrap(defaultWrap = false): UseLogWrapResult {
  const [state, setState] = useState<WrapState>(() => createWrapState(defaultWrap));

  const rowWrap = useCallback((id: LogLineId) => resolveRowWrap(state, id), [state]);
  const isOverridden = useCallback((id: LogLineId) => state.exceptions.has(id), [state]);
  const toggleLine = useCallback((id: LogLineId) => setState((s) => toggleLineWrap(s, id)), []);
  const toggleGlobal = useCallback(() => setState(toggleGlobalWrap), []);
  const setGlobal = useCallback((wrap: boolean) => setState((s) => setGlobalWrap(s, wrap)), []);

  return useMemo(
    () => ({
      globalWrap: state.globalWrap,
      overriddenCount: state.exceptions.size,
      rowWrap,
      isOverridden,
      toggleLine,
      toggleGlobal,
      setGlobal,
    }),
    [state, rowWrap, isOverridden, toggleLine, toggleGlobal, setGlobal],
  );
}
