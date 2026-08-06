import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {useMediaQuery} from '#hooks/useMediaQuery.js';

interface TimeTickContextValue {
  tick: number;
  registerInterval: (id: string, intervalMs: number) => void;
  unregisterInterval: (id: string) => void;
}

const TimeTickContext = createContext<TimeTickContextValue | null>(null);

export function TimeTickerProvider({
  children,
  intervalMs,
  reducedMotionIntervalMs = intervalMs,
}: {
  children: ReactNode;
  intervalMs: number;
  reducedMotionIntervalMs?: number;
}) {
  const parentContext = useContext(TimeTickContext);
  const isRoot = parentContext === null;
  const registrationId = useId();
  const [tick, setTick] = useState(0);
  const [registeredIntervals, setRegisteredIntervals] = useState<Map<string, number>>(
    () => new Map(),
  );
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const activeIntervalMs = reducedMotion ? reducedMotionIntervalMs : intervalMs;
  const registerInterval = useCallback((id: string, nextIntervalMs: number) => {
    setRegisteredIntervals((current) => {
      if (current.get(id) === nextIntervalMs) return current;
      const next = new Map(current);
      next.set(id, nextIntervalMs);
      return next;
    });
  }, []);
  const unregisterInterval = useCallback((id: string) => {
    setRegisteredIntervals((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);
  const minimumIntervalMs = Math.min(activeIntervalMs, ...registeredIntervals.values());
  const parentRegisterInterval = parentContext?.registerInterval;
  const parentUnregisterInterval = parentContext?.unregisterInterval;

  useEffect(() => {
    if (isRoot || !parentRegisterInterval || !parentUnregisterInterval) return undefined;

    parentRegisterInterval(registrationId, activeIntervalMs);
    return () => parentUnregisterInterval(registrationId);
  }, [activeIntervalMs, isRoot, parentRegisterInterval, parentUnregisterInterval, registrationId]);

  useEffect(() => {
    if (!isRoot) return undefined;
    if (typeof document === 'undefined') return;

    let interval: number | undefined;
    const bumpTick = () => setTick((current) => current + 1);

    const start = () => {
      if (interval !== undefined) return;
      interval = window.setInterval(bumpTick, minimumIntervalMs);
    };

    const stop = () => {
      if (interval === undefined) return;
      window.clearInterval(interval);
      interval = undefined;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }

      bumpTick();
      start();
    };

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isRoot, minimumIntervalMs]);

  const contextValue = useMemo(
    () => ({tick, registerInterval, unregisterInterval}),
    [registerInterval, tick, unregisterInterval],
  );

  if (!isRoot) return <>{children}</>;
  return <TimeTickContext.Provider value={contextValue}>{children}</TimeTickContext.Provider>;
}

export function useTimeTick(): number {
  return useContext(TimeTickContext)?.tick ?? 0;
}
